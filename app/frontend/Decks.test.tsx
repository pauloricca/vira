// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Deck, DeckState, Mixer, TRACK_MIME, useDecks } from './Decks';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); });
const state: DeckState = { deck: 0, loading: false, error: null, playing: false, position_seconds: 0, gain: .8, generation: 1, requested_generation: 1,
  track: { track_id: 'a'.repeat(64), artifact_id: 'b'.repeat(64), title: 'Unanalysed song', artist: 'Test artist', filename: 'test.wav', duration_seconds: 100, frames: 4800000, peak_frames: 4800000, peaks: [[.2, .1]] } };
test('controls send independent deck commands and waveform supports pointer/keyboard seeks', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  render(<Deck state={state} running loading={false} error={null} load={vi.fn()} control={control} />);
  fireEvent.click(screen.getByRole('button', { name: 'Play deck A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stop deck A' }));
  fireEvent.change(screen.getByRole('slider', { name: 'Volume deck A' }), { target: { value: '.4' } });
  const wave = screen.getByRole('slider', { name: 'Waveform seek deck A' });
  vi.spyOn(wave, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
  fireEvent.click(wave, { clientX: 50 });
  fireEvent.keyDown(wave, { key: 'ArrowRight' });
  expect(control.mock.calls).toEqual([[0, 'play'], [0, 'stop'], [0, 'gain', .4], [0, 'seek', 50], [0, 'seek', 5]]);
});
test('drop accepts only internal track IDs and preparation failure preserves controls', () => {
  const load = vi.fn().mockResolvedValue(undefined);
  render(<Deck state={state} running loading error="Preparation failed" load={load} control={vi.fn()} />);
  const deck = screen.getByRole('article', { name: 'Deck A' });
  fireEvent.drop(deck, { dataTransfer: { getData: (mime: string) => mime === TRACK_MIME ? 'a'.repeat(64) : '' } });
  fireEvent.drop(deck, { dataTransfer: { getData: () => '/arbitrary/file.mp3' } });
  expect(load.mock.calls).toEqual([[0, 'a'.repeat(64)]]);
  expect((screen.getByRole('button', { name: 'Play deck A' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('alert').textContent).toBe('Preparation failed');
});
test('late load errors cannot overwrite a newer request on the same deck', async () => {
  let rejectOld!: (reason: string) => void;
  const emptyAudio = { running: true, error: null, telemetry: {}, decks: [{ ...state, track: null }, { ...state, deck: 1, track: null }] };
  invoke.mockImplementation((command: string, args?: { trackId: string }) => command === 'get_audio_state' ? Promise.resolve(emptyAudio) : args?.trackId === 'old' ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve());
  function Harness() { const decks = useDecks(); return <><button onClick={() => void decks.load(0, 'old')}>Old</button><button onClick={() => void decks.load(0, 'new')}>New</button><output>{decks.errors[0]}</output></>; }
  render(<Harness />);
  await act(async () => { fireEvent.click(screen.getByText('Old')); fireEvent.click(screen.getByText('New')); });
  await act(async () => { rejectOld('Superseded load failed'); });
  expect(screen.queryByText('Superseded load failed')).toBeNull();
});

test('animation updates playhead and time without React commits for each frame', async () => {
  const { Profiler } = await import('react');
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {callbacks.push(callback); return callbacks.length;});
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const now=vi.spyOn(performance,'now').mockReturnValue(0);
  const commits=vi.fn();
  try {
    render(<Profiler id="deck" onRender={commits}><Deck state={{...state,playing:true}} running loading={false} error={null} load={vi.fn()} control={vi.fn()} /></Profiler>);
    const mounted=commits.mock.calls.length;
    for(let frame=1;frame<=20;frame++) await act(async()=>callbacks.shift()?.(frame*16));
    expect(commits.mock.calls.length).toBe(mounted);
    expect(screen.getByLabelText('Time deck A').textContent).toContain('0:00.3');
  } finally {cleanup(); now.mockRestore(); vi.unstubAllGlobals();}
});

test('half and double presets use the precise source BPM within the expanded limits',()=>{
  const control=vi.fn().mockResolvedValue(undefined);
  render(<Deck state={{...state,grid:{bpm:118.999072,downbeat_seconds:0,reviewed:false}}} running loading={false} error={null} load={vi.fn()} control={control} />);
  fireEvent.click(screen.getByText('Half speed')); fireEvent.click(screen.getByText('Double speed'));
  expect(control.mock.calls).toEqual([[0,'tempo',118.999072*.5],[0,'tempo',118.999072*2]]);
  expect(screen.getByRole('spinbutton',{name:'Target BPM'}).getAttribute('min')).toBe(String(118.999072*.5));
  expect(screen.getByRole('spinbutton',{name:'Target BPM'}).getAttribute('max')).toBe(String(118.999072*2));
});

test('deck lock lives beside BPM and disables manual tempo while locked', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const reviewed = { ...state, target_bpm: 120, grid: { bpm: 120, downbeat_seconds: 0, reviewed: false } };
  const { rerender } = render(<Deck state={reviewed} running loading={false} error={null} load={vi.fn()} control={control} />);
  expect((screen.getByRole('button', { name: 'Lock deck A to master tempo' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Lock deck A to master tempo' }));
  expect(control).toHaveBeenCalledWith(0, 'sync', 1);
  rerender(<Deck state={{ ...reviewed, synced: true }} running loading={false} error={null} load={vi.fn()} control={control} />);
  expect((screen.getByRole('spinbutton', { name: 'Target BPM' }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Unlock deck A to master tempo' }));
  expect(control).toHaveBeenCalledWith(0, 'sync', 0);
});

test('double-clicking deck BPM unlocks before restoring the precise source tempo', async () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const grid = { bpm: 118.999072, downbeat_seconds: 0, reviewed: false };
  const { rerender } = render(<Deck state={{ ...state, target_bpm: 124, grid, synced: true }} running loading={false} error={null} load={vi.fn()} control={control} />);
  await act(async () => { fireEvent.doubleClick(screen.getByTitle('Double-click to unlock and restore original tempo')); });
  expect(control.mock.calls).toEqual([[0, 'sync', 0], [0, 'tempo', grid.bpm]]);
  control.mockClear();
  rerender(<Deck state={{ ...state, target_bpm: 124, grid, synced: false }} running loading={false} error={null} load={vi.fn()} control={control} />);
  await act(async () => { fireEvent.doubleClick(screen.getByTitle('Double-click to unlock and restore original tempo')); });
  expect(control.mock.calls).toEqual([[0, 'tempo', grid.bpm]]);
});

test('mixer changes the selected native deck gain with immediate feedback', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  render(<Mixer audio={{ running: true, error: null, telemetry: {}, decks: [state, { ...state, deck: 1 }] }} control={control} />);
  fireEvent.change(screen.getByRole('slider', { name: 'Volume deck B' }), { target: { value: '.35' } });
  expect(control.mock.calls).toEqual([[1, 'gain', .35]]);
  expect(screen.getByText('35%')).toBeTruthy();
  expect((screen.getByRole('slider', { name: 'Master volume coming later' }) as HTMLInputElement).disabled).toBe(true);
});
