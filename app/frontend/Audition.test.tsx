// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AuditionControls, useAudition } from './Audition';
import type { AudioState } from './Decks';
import type { Track } from './App';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); });
const track = { id: 'one', title: 'Song', duration_seconds: 120 } as Track;
const audio = { audition: { generation: 8, position_seconds: 30, playing: true } } as AudioState;
function Harness({ state = audio }: { state?: AudioState }) {
  const audition = useAudition(state);
  return <><button onClick={() => void audition.play(track)}>Audition</button><AuditionControls audition={audition} />{audition.error && <p role="alert">{audition.error}</p>}</>;
}
test('audition controls seek, pause and stop; Stop hides the player', async () => {
  invoke.mockResolvedValueOnce(8).mockResolvedValue(undefined);
  const { rerender } = render(<Harness />);
  expect(screen.queryByRole('group')).toBeNull();
  fireEvent.click(screen.getByText('Audition'));
  await screen.findByText('0:30 / 2:00');
  expect(invoke).toHaveBeenCalledWith('audition_track', { trackId: 'one', output: 'cue' });
  fireEvent.change(screen.getByLabelText('Audition position'), { target: { value: '60' } });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('audition_control', { action: 'seek', generation: 8, value: 60 }));
  fireEvent.click(screen.getByLabelText('Pause audition'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('audition_control', { action: 'play_pause', generation: 8, value: null }));
  rerender(<Harness state={{ ...audio, audition: { ...audio.audition!, playing: false } }} />);
  expect(screen.getByLabelText('Play audition')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Stop audition'));
  await waitFor(() => expect(screen.queryByRole('group')).toBeNull());
});
test('Stop while loading prevents a late load response from restoring controls', async () => {
  let finish!: (generation: number) => void;
  invoke.mockImplementation((command: string) => command === 'audition_track' ? new Promise<number>(resolve => { finish = resolve; }) : Promise.resolve());
  render(<Harness />);
  fireEvent.click(screen.getByText('Audition'));
  expect(screen.getByText('Loading…')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Stop audition'));
  await waitFor(() => expect(screen.queryByRole('group')).toBeNull());
  await act(async () => finish(8));
  expect(screen.queryByRole('group')).toBeNull();
});
test('an unavailable headphones output reports the native error', async () => {
  invoke.mockRejectedValue('Select Cue headphones on the Audio page');
  render(<Harness />);
  fireEvent.click(screen.getByText('Audition'));
  expect((await screen.findByRole('alert')).textContent).toContain('Select Cue headphones');
  expect(screen.queryByRole('group')).toBeNull();
});
test('an interrupted stream surfaces its native error after playback starts', async () => {
  invoke.mockResolvedValue(8);
  const { rerender } = render(<Harness />);
  fireEvent.click(screen.getByText('Audition'));
  await screen.findByText('0:30 / 2:00');
  rerender(<Harness state={{ ...audio, audition: { ...audio.audition!, playing: false, error: 'Audition stream: connection closed' } }} />);
  expect((await screen.findByRole('alert')).textContent).toContain('connection closed');
});
test('master output is passed to native audition and resets when a deck starts', async () => {
  invoke.mockResolvedValue(8);
  function OutputHarness({ playing }: { playing: boolean }) {
    const audition = useAudition({ ...audio, decks: [{ playing }] } as AudioState);
    return <><button onClick={() => audition.changeOutput('master')}>Master</button><button onClick={() => void audition.play(track)}>Start</button><output>{audition.output}</output></>;
  }
  const { rerender } = render(<OutputHarness playing={false} />);
  fireEvent.click(screen.getByText('Master'));
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('audition_track', { trackId: 'one', output: 'master' }));
  rerender(<OutputHarness playing={true} />);
  await screen.findByText('cue');
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('audition_control', expect.objectContaining({ action: 'stop' })));
});

test('Play All preloads in displayed order, follows native handoffs, and stops when a deck plays', async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'audition_track' ? 8 : undefined));
  const tracks = [track, { ...track, id: 'two', title: 'Second' }, { ...track, id: 'three', title: 'Third' }];
  function SequenceHarness({ index = 0, playing = false }: { index?: number; playing?: boolean }) {
    const audition = useAudition({ ...audio, audition: { ...audio.audition!, index }, decks: [{ playing }] } as AudioState, tracks, 32);
    return <><button onClick={audition.togglePlayAll} aria-pressed={audition.playAll}>Play All</button><button onClick={() => void audition.play(track)}>Start</button><AuditionControls audition={audition} /></>;
  }
  const { rerender } = render(<SequenceHarness />);
  fireEvent.click(screen.getByText('Play All'));
  fireEvent.click(screen.getByText('Start'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('queue_audition', { generation: 8, index: 0, trackId: 'two', output: 'cue', currentTrackId: 'one' }));
  expect(invoke).toHaveBeenCalledWith('audition_control', { action: 'sequence', generation: 8, value: 32 });
  rerender(<SequenceHarness index={1} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('queue_audition', { generation: 8, index: 1, trackId: 'three', output: 'cue', currentTrackId: 'two' }));
  expect(screen.getByRole('group').title).toContain('Second');
  invoke.mockClear();
  rerender(<SequenceHarness index={2} />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('audition_control', expect.objectContaining({ action: 'sequence' })));
  expect(invoke.mock.calls.some(([command]) => command === 'queue_audition')).toBe(false);
  rerender(<SequenceHarness index={2} playing />);
  await waitFor(() => expect(screen.queryByRole('group')).toBeNull());
  expect(screen.getByText('Play All').getAttribute('aria-pressed')).toBe('false');
});
