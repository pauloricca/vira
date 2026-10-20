// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { RollingRow } from './RollingRow';
import { MidiProvider, MidiToggle, MidiEditor } from './MidiMapping';
import { AudioState, Deck, DeckState, Mixer, RollingWaveforms, TRACK_MIME, useDecks } from './Decks';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); localStorage.removeItem('vira.deck-0-locked'); localStorage.removeItem('vira.deck-1-locked'); });
const state: DeckState = { deck: 0, loading: false, error: null, playing: false, position_seconds: 0, gain: .8, generation: 1, requested_generation: 1,
  track: { track_id: 'a'.repeat(64), artifact_id: 'b'.repeat(64), title: 'Unanalysed song', artist: 'Test artist', filename: 'test.wav', duration_seconds: 100, frames: 4800000, peak_frames: 4800000, peaks: [[.2, .1]] } };
test('decoded audio can play and pause while the loading message stays visible', () => {
  const control = vi.fn();
  const pending = { ...state, loading: true, track: { ...state.track!, peaks: [] } };
  const props = { running: true, loading: true, loadingTitle: 'Unanalysed song', error: null, load: vi.fn(), control };
  const { rerender } = render(<Deck {...props} state={pending} />);
  fireEvent.click(screen.getByRole('button', { name: 'Play deck A' }));
  expect(control).toHaveBeenLastCalledWith(0, 'play_pause');
  expect(screen.getByText('Loading Unanalysed song')).toBeTruthy();
  rerender(<Deck {...props} state={{ ...pending, playing: true }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Pause deck A' }));
  expect(control).toHaveBeenLastCalledWith(0, 'play_pause');
  expect(screen.getByText('Loading Unanalysed song')).toBeTruthy();
  rerender(<Deck {...props} state={{ ...pending, track: null }} />);
  expect((screen.getByRole('button', { name: 'Play deck A' }) as HTMLButtonElement).disabled).toBe(true);
});

test('deck overview draws peaks arriving after playback audio for the same artifact', () => {
  const props = { running: true, error: null, load: vi.fn(), control: vi.fn() };
  const pending = { ...state, loading: true, track: { ...state.track!, peak_frames: 0, peaks: [] } };
  const { rerender } = render(<Deck {...props} state={pending} loading />);
  const waveform = screen.getByRole('slider', { name: 'Waveform seek deck A' });
  expect(waveform.querySelector('path[d="M0.00,50V70"]')).toBeNull();
  rerender(<Deck {...props} state={{ ...state, playing: true }} loading={false} />);
  expect(waveform.querySelector('path[d="M0.00,50V70"]')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Pause deck A' })).toBeTruthy();
  expect(screen.queryByText('Loading track')).toBeNull();
});

test('waveform metadata refreshes within the playing generation after early audio installation', async () => {
  let finished = false;
  const pending = { ...state, playing: true, loading: true, track: { ...state.track!, peaks: [] } };
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state'
    ? { running: true, error: null, telemetry: {}, decks: [finished ? { ...state, playing: true } : pending, { ...state, deck: 1 }] }
    : {}));
  const { result } = renderHook(() => useDecks());
  await waitFor(() => expect(result.current.audio.decks[0].loading).toBe(true));
  expect(result.current.audio.decks[0].playing).toBe(true);
  await waitFor(() => expect(invoke.mock.calls.some(([command, args]) => command === 'get_audio_state' && args.knownGenerations[0] === 0)).toBe(true));
  finished = true;
  await waitFor(() => expect(result.current.audio.decks[0].track?.peaks).toEqual(state.track!.peaks));
  expect(result.current.audio.decks[0].playing).toBe(true);
  expect(result.current.audio.decks[0].generation).toBe(1);
});
test('phrase jumps preserve fractional beat position and use the latest playhead', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const props = { running: true, loading: false, error: null, load: vi.fn(), control };
  const deck = { ...state, position_seconds: 18.375, grid: { bpm: 120, downbeat_seconds: .25, reviewed: true } };
  const { rerender } = render(<Deck {...props} state={deck} />);
  const forward = screen.getByRole('button', { name: 'Jump 4 bars forward on deck A' });
  fireEvent.pointerDown(forward);
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toHaveLength(0);
  fireEvent.click(forward);
  expect(control).toHaveBeenLastCalledWith(0, 'phrase_jump', 26.375);
  fireEvent.click(screen.getByRole('button', { name: 'Jump 8 bars back on deck A' }));
  expect(control).toHaveBeenLastCalledWith(0, 'phrase_jump', 2.375);
  rerender(<Deck {...props} state={{ ...deck, position_seconds: 21.125, position_epoch: 1 }} />);
  fireEvent.click(forward);
  expect(control).toHaveBeenLastCalledWith(0, 'phrase_jump', 29.125);
  rerender(<Deck {...props} state={state} />);
  expect(screen.queryByRole('button', { name: 'Jump 4 bars forward on deck A' })).toBeNull();
});
test('the first beat displays as zero and Home seeks to that playable boundary', () => {
  const control = vi.fn();
  render(<Deck state={{ ...state, position_seconds: .25, synced: true, track: { ...state.track!, start_seconds: .25 }, grid: { bpm: 120, downbeat_seconds: .25, reviewed: true } }} running loading={false} error={null} load={vi.fn()} control={control} />);
  const waveform = screen.getByRole('slider', { name: 'Waveform seek deck A' });
  expect(waveform.getAttribute('aria-valuenow')).toBe('0');
  expect(waveform.getAttribute('aria-valuemax')).toBe('99.75');
  expect(screen.getByLabelText('Time deck A').textContent).toBe('0:00.0 / 1:39.7');
  fireEvent.keyDown(waveform, { key: 'Home' });
  expect(control).toHaveBeenLastCalledWith(0, 'seek', .25);
  fireEvent.keyDown(waveform, { key: 'ArrowLeft' });
  expect(control).toHaveBeenLastCalledWith(0, 'seek', .25);
  fireEvent.click(screen.getByRole('button', { name: 'Loop 1 deck A' }));
  expect(control).toHaveBeenLastCalledWith(0, 'loop_length_aligned', 4);
});
test('deck locks survive a restart with empty decks and restore independently when a grid is loaded', async () => {
  const grid = { bpm: 120, downbeat_seconds: 0, reviewed: true };
  let native: AudioState = { running: true, error: null, telemetry: {}, decks: [{ ...state, grid, synced: true }, { ...state, deck: 1, grid, synced: false }] };
  invoke.mockImplementation((command: string, args?: { deck: number; action: string; value: number }) => {
    if (command === 'get_audio_state') return Promise.resolve(native);
    if (command === 'deck_control' && args?.action === 'sync') native = { ...native, decks: native.decks.map(d => d.deck === args.deck ? { ...d, synced: args.value === 1 } : d) };
    return Promise.resolve({});
  });
  const first = renderHook(() => useDecks());
  await waitFor(() => expect(localStorage.getItem('vira.deck-0-locked')).toBe('true'));
  expect(localStorage.getItem('vira.deck-1-locked')).toBe('false');
  first.unmount();
  native = { ...native, decks: native.decks.map(d => ({ ...d, track: null, grid: null, synced: false })) };
  const second = renderHook(() => useDecks());
  await waitFor(() => expect(second.result.current.audio.running).toBe(true));
  expect(localStorage.getItem('vira.deck-0-locked')).toBe('true');
  expect(invoke.mock.calls.filter(([command]) => command === 'deck_control')).toHaveLength(0);
  // A track without timing must not discard the remembered lock either.
  native = { ...native, decks: native.decks.map(d => ({ ...d, track: state.track })) };
  await waitFor(() => expect(second.result.current.audio.decks[0].track).toBeTruthy());
  expect(localStorage.getItem('vira.deck-0-locked')).toBe('true');
  native = { ...native, decks: native.decks.map(d => ({ ...d, grid })) };
  await waitFor(() => expect(second.result.current.audio.decks[0].synced).toBe(true));
  expect(invoke.mock.calls.filter(([command]) => command === 'deck_control')).toEqual([
    ['deck_control', { deck: 0, action: 'sync', value: 1, generation: 1 }],
  ]);
  await act(async () => { await second.result.current.control(0, 'sync', 0); });
  expect(localStorage.getItem('vira.deck-0-locked')).toBe('false');
  second.unmount();
  const third = renderHook(() => useDecks());
  await waitFor(() => expect(third.result.current.audio.running).toBe(true));
  expect(invoke.mock.calls.filter(([command, args]) => command === 'deck_control' && args.value === 1)).toHaveLength(1);
});

test('native automatic unlocks update the saved deck lock', async () => {
  let synced = true;
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state'
    ? { running: true, error: null, telemetry: {}, decks: [{ ...state, synced }, { ...state, deck: 1, synced: false }] }
    : {}));
  renderHook(() => useDecks());
  await waitFor(() => expect(localStorage.getItem('vira.deck-0-locked')).toBe('true'));
  synced = false;
  await waitFor(() => expect(localStorage.getItem('vira.deck-0-locked')).toBe('false'));
});

test('controls send independent deck commands and waveform supports pointer/keyboard seeks', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  render(<Deck state={state} running loading={false} error={null} load={vi.fn()} control={control} />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Play deck A' }));
  expect(screen.queryByRole('button', { name: 'Stop deck A' })).toBeNull();
  fireEvent.change(screen.getByRole('slider', { name: 'Volume deck A' }), { target: { value: '.4' } });
  const wave = screen.getByRole('slider', { name: 'Waveform seek deck A' });
  vi.spyOn(wave, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
  fireEvent.keyDown(wave, { key: 'Home' });
  fireEvent.keyDown(wave, { key: 'ArrowRight' });
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'play_pause'], [0, 'gain', .4], [0, 'seek', 0], [0, 'seek', 5]]);
});
test('clock swaps loop and time controls for compact timing tools and keeps transport available', async () => {
  const control = vi.fn().mockResolvedValue(undefined);
  render(<Deck state={{ ...state, grid: { bpm: 120, downbeat_seconds: 0, reviewed: true } }} trackKey="A minor" running loading={false} error={null} load={vi.fn()} control={control} />);
  const deck = screen.getByRole('article', { name: 'Deck A' });
  const toggle = screen.getByRole('button', { name: 'Timing controls deck A' });
  expect(deck.querySelector('.deck-header .deck-key')?.textContent).toContain('A minor');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByRole('spinbutton', { name: 'Track BPM' })).toBeNull();
  expect(Array.from(deck.querySelectorAll('.loop-controls button'), button => button.textContent)).toEqual(['IN', '1/32', '1/16', '1/8', '1/4', '1/2', 'SLIP', 'OUT', '1', '2', '4', '8', '16']);
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button', { name: 'AUTO NOW deck A' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Loop IN deck A' })).toBeNull();
  expect(screen.getByLabelText('Time deck A').hidden).toBe(true);
  expect(screen.getByRole('spinbutton', { name: 'Track BPM' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cue deck A' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Play deck A' })).toBeTruthy();
  expect(Array.from(deck.querySelectorAll('.deck-settings button'), button => button.textContent).join(' ')).not.toContain('BPM');
  expect(deck.textContent).not.toMatch(/Analysis:|Speed |supported 15|pitch preserved|Source 120/);
  fireEvent.click(toggle);
  expect(screen.getByRole('button', { name: 'Loop IN deck A' })).toBeTruthy();
  expect(screen.getByLabelText('Time deck A').hidden).toBe(false);
  expect(screen.queryByRole('spinbutton', { name: 'Track BPM' })).toBeNull();
  await waitFor(() => expect(control).toHaveBeenCalledWith(0, 'click_panel', 1));
});
test('loop controls toggle lengths and show in/out on the overview', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const looped = { ...state, grid: { bpm: 120, downbeat_seconds: 0, reviewed: true }, loop_in_seconds: 10, loop_out_seconds: 10.5, loop_length_beats: 1 };
  const { rerender } = render(<Deck state={looped} running loading={false} error={null} load={vi.fn()} control={control} />);
  const one = screen.getByRole('button', { name: 'Loop 1/4 deck A' });
  expect(one.getAttribute('aria-pressed')).toBe('true');
  expect(one.getAttribute('title')).toContain('1 beat');
  const wave = screen.getByRole('slider', { name: 'Waveform seek deck A' });
  expect(wave.querySelector('.loop-region')?.getAttribute('width')).toBe(String(0.5 / 100 * 1024));
  expect(wave.querySelectorAll('.loop-marker')).toHaveLength(2);
  fireEvent.click(one);
  fireEvent.click(screen.getByRole('button', { name: 'Loop 1 deck A' }));
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'loop_length_aligned', 1], [0, 'loop_length_aligned', 4]]);
  expect(screen.getByRole('button', { name: 'Loop 1 deck A' }).getAttribute('title')).toContain('1 bar');
  rerender(<Deck state={looped} alignLoops={false} running loading={false} error={null} load={vi.fn()} control={control} />);
  fireEvent.click(screen.getByRole('button', { name: 'Loop 4 deck A' }));
  expect(control).toHaveBeenLastCalledWith(0, 'loop_length', 16);
  fireEvent.click(screen.getByRole('button', { name: 'Loop 1/32 deck A' }));
  expect(control).toHaveBeenLastCalledWith(0, 'loop_length', 1 / 8);
  rerender(<Deck state={{ ...state, loop_in_seconds: 10 }} running loading={false} error={null} load={vi.fn()} control={control} />);
  expect(screen.getByRole('button', { name: 'Loop OUT deck A' }).getAttribute('disabled')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Loop OUT deck A' }));
  expect(control).toHaveBeenLastCalledWith(0, 'loop_out_snapped', undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Loop IN deck A' }));
  expect(control).toHaveBeenLastCalledWith(0, 'loop_in_snapped', undefined);
  rerender(<Deck state={{ ...state, loop_in_seconds: 10 }} snapLoopPoints={false} running loading={false} error={null} load={vi.fn()} control={control} />);
  fireEvent.click(screen.getByRole('button', { name: 'Loop OUT deck A' }));
  expect(control).toHaveBeenLastCalledWith(0, 'loop_out', undefined);
});
test('queued loop release remains active and explains the wait until native release', () => {
  const props = { running: true, loading: false, error: null, load: vi.fn(), control: vi.fn() };
  const looped = { ...state, playing: true, synced: true, loop_in_seconds: 10, loop_out_seconds: 10.5, loop_length_beats: 1, loop_release_pending: true };
  const { rerender } = render(<Deck state={looped} {...props} />);
  expect(screen.getByText('Loop release queued · waiting for locked deck start boundary').getAttribute('role')).toBe('status');
  expect(screen.getByRole('button', { name: 'Loop 1/4 deck A' }).getAttribute('aria-pressed')).toBe('true');
  rerender(<Deck state={{ ...looped, loop_out_seconds: null, loop_release_pending: false }} {...props} />);
  expect(screen.queryByText('Loop release queued · waiting for locked deck start boundary')).toBeNull();
  expect(screen.getByRole('button', { name: 'Loop 1/4 deck A' }).getAttribute('aria-pressed')).toBe('false');
});
test('SLIP toggles for its deck and shows native state', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const props = { running: true, loading: false, error: null, load: vi.fn(), control };
  const { rerender } = render(<Deck state={state} {...props} />);
  const slip = screen.getByRole('button', { name: 'Slip deck A' });
  expect(slip.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(slip);
  expect(control).toHaveBeenLastCalledWith(0, 'slip', 1);
  rerender(<Deck state={{ ...state, slip_enabled: true }} {...props} />);
  expect(slip.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(slip);
  expect(control).toHaveBeenLastCalledWith(0, 'slip', 0);
});
test('deck overview shows grid lines every eight bars from the downbeat', () => {
  render(<Deck state={{ ...state, grid: { bpm: 120, downbeat_seconds: 2, reviewed: true } }} running loading={false} error={null} load={vi.fn()} control={vi.fn()} />);
  const paths = screen.getByRole('slider', { name: 'Waveform seek deck A' }).querySelectorAll('path[stroke="currentColor"]');
  expect(Array.from(paths, path => path.getAttribute('d'))).toEqual(['M20.48,0V120', 'M184.32,0V120', 'M348.16,0V120', 'M512,0V120', 'M675.84,0V120', 'M839.68,0V120', 'M1003.52,0V120']);
});
test.each([[true, .8, false], [true, .001, false], [true, 0, true], [false, .8, true]] as const)('drop on playing=%s gain=%s accepts=%s', (playing, gain, allowed) => {
  const load = vi.fn();
  render(<Deck state={{ ...state, playing, gain }} running loading={false} error={null} load={load} control={vi.fn()} />);
  const deck = screen.getByRole('article', { name: 'Deck A' });
  const dataTransfer = { types: [TRACK_MIME], dropEffect: '', getData: () => 'c'.repeat(64) };
  fireEvent.dragOver(deck, { dataTransfer });
  expect(dataTransfer.dropEffect).toBe(allowed ? 'copy' : 'none');
  fireEvent.drop(deck, { dataTransfer });
  expect(load).toHaveBeenCalledTimes(allowed ? 1 : 0);
});
test.each([[true, .8, false], [true, .001, false], [true, 0, true], [false, .8, true]] as const)('shared load on playing=%s gain=%s accepts=%s', async (playing, gain, allowed) => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state'
    ? { running: true, error: null, telemetry: {}, decks: [{ ...state, playing, gain }, { ...state, deck: 1 }] }
    : command === 'timing_waveform' ? { artifact_id: state.track!.artifact_id } : {}));
  const hook = renderHook(() => useDecks());
  await waitFor(() => expect(hook.result.current.audio.running).toBe(true));
  await act(async () => { await hook.result.current.load(0, 'next'); });
  expect(invoke.mock.calls.filter(([command]) => command === 'load_track')).toHaveLength(allowed ? 1 : 0);
  if (!allowed) {
    expect(hook.result.current.errors[0]).toContain('fader to 0');
    expect(hook.result.current.loading[0]).toBe(false);
    expect(hook.result.current.audio.decks[0].track).toEqual(state.track);
  }
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
test('loading greys the deck while another dropped track can replace the load', () => {
  const load = vi.fn().mockResolvedValue(undefined);
  render(<Deck state={{ ...state, loading: true }} running loading loadingTitle="New song" error={null} load={load} control={vi.fn()} />);
  const deck = screen.getByRole('article', { name: 'Deck A' });
  expect(deck.classList.contains('is-loading')).toBe(true);
  expect(deck.getAttribute('aria-busy')).toBe('true');
  expect(screen.getByText('Loading New song')).toBeTruthy();
  fireEvent.drop(deck, { dataTransfer: { getData: (mime: string) => mime === TRACK_MIME ? 'c'.repeat(64) : '' } });
  expect(load).toHaveBeenCalledWith(0, 'c'.repeat(64));
});
test('late load errors cannot overwrite a newer request on the same deck', async () => {
  let rejectOld!: (reason: string) => void;
  const emptyAudio = { running: true, error: null, telemetry: {}, decks: [{ ...state, track: null }, { ...state, deck: 1, track: null }] };
  invoke.mockImplementation((command: string, args?: { trackId: string }) => command === 'get_audio_state' ? Promise.resolve(emptyAudio) : args?.trackId === 'old' ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve());
  function Harness() { const decks = useDecks(); return <><button onClick={() => void decks.load(0, 'old')}>Old</button><button onClick={() => void decks.load(0, 'new')}>New</button><output>{decks.errors[0]}</output><output aria-label="Requested track">{decks.loadingTrackIds[0]}</output></>; }
  render(<Harness />);
  await act(async () => { fireEvent.click(screen.getByText('Old')); fireEvent.click(screen.getByText('New')); });
  await act(async () => { rejectOld('Superseded load failed'); });
  expect(screen.queryByText('Superseded load failed')).toBeNull();
  expect(screen.getByLabelText('Requested track').textContent).toBe('new');
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

test('timing BPM controls correct the source instead of changing playback tempo',()=>{
  const control=vi.fn().mockResolvedValue(undefined);
  render(<Deck state={{...state,grid:{bpm:118.999072,downbeat_seconds:0,reviewed:false}}} running loading={false} error={null} load={vi.fn()} control={control} />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  fireEvent.click(screen.getByRole('button', { name: 'Half BPM' })); fireEvent.click(screen.getByRole('button', { name: 'Double BPM' }));
  fireEvent.click(screen.getByRole('button', { name: 'Original BPM' }));
  const input = screen.getByRole('spinbutton', { name: 'Track BPM' });
  expect((input as HTMLInputElement).value).toBe('118.999072');
  fireEvent.change(input, { target: { value: '125' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set BPM' }));
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0,'detected_bpm',118.999072*.5],[0,'detected_bpm',118.999072*2],[0,'original_bpm'],[0,'detected_bpm',125]]);
  expect(input.getAttribute('min')).toBe('30');
  expect(input.getAttribute('max')).toBe('300');
  const buttons = screen.getAllByRole('button').map(button => button.textContent);
  expect(buttons.indexOf('×2')).toBeLessThan(buttons.indexOf('Original'));
});
test('click is enabled while the deck is mounted without changing its volume', async () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const { unmount } = render(<Deck state={{ ...state, click_gain: .6, grid: { bpm: 120, downbeat_seconds: 0, reviewed: true } }} running loading={false} error={null} load={vi.fn()} control={control} />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  await waitFor(() => expect(control).toHaveBeenCalledWith(0, 'click_panel', 1));
  expect((screen.getByRole('slider', { name: /Click volume/ }) as HTMLInputElement).value).toBe('0.6');
  unmount();
  expect(control.mock.calls.at(-1)).toEqual([0, 'click_panel', 0]);
});
test('reference button uses the playhead and removes the clear deck button', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  render(<Deck state={{ ...state, position_seconds: 23.75, grid: { bpm: 120, downbeat_seconds: 0, reviewed: false } }} running loading={false} error={null} load={vi.fn()} control={control} />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  expect(screen.queryByRole('button', { name: 'Clear deck A' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Set reference beat' }));
  expect(control).toHaveBeenCalledWith(0, 'reference_beat', 23.75);
});
test.each(['needs_review', 'stale'])('%s analysis approval works while playing; beat and bar controls require a stopped deck', analysisState => {
  const control = vi.fn().mockResolvedValue(undefined);
  const approveAnalysis = vi.fn();
  const grid = { bpm: 120, downbeat_seconds: 0, reviewed: false };
  const { rerender } = render(<Deck state={{ ...state, playing: true, grid }} running loading={false} error={null} load={vi.fn()} control={control} analysisState={analysisState} approveAnalysis={approveAnalysis} />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  for (const name of ['Set reference beat', 'Shift bar start back one beat on deck A', 'Shift bar start forward one beat on deck A']) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  }
  for (const name of ['Set BPM', 'Half BPM', 'Double BPM', 'Original BPM']) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);
  }
  expect((screen.getByRole('button', { name: 'Approve grid deck A' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Approve grid deck A' }));
  expect(approveAnalysis).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Approve grid deck A' }).closest('.deck-header')).toBeTruthy();
  rerender(<Deck state={{ ...state, grid }} running loading={false} error={null} load={vi.fn()} control={control} analysisState={analysisState} approveAnalysis={approveAnalysis} />);
  fireEvent.click(screen.getByRole('button', { name: 'Approve grid deck A' }));
  expect(approveAnalysis).toHaveBeenCalledTimes(2);
});

test('reference edits load saved flags, save source timing, and replace the oldest flag', async () => {
  const grid = { bpm: 120, downbeat_seconds: 0, reviewed: false };
  const loaded = { ...state, grid };
  invoke.mockImplementation((command: string, args?: { grid?: typeof grid | null; referenceBeats?: number[] }) => {
    if (command === 'get_audio_state') return Promise.resolve({ running: true, error: null, telemetry: {}, decks: [loaded, { ...state, deck: 1, track: null }] });
    if (command === 'track_timing') return Promise.resolve({ grid: args?.grid ?? grid, reference_beats: args?.referenceBeats ?? [10] });
    if (command === 'timing_waveform') return Promise.resolve(state.track);
    return Promise.resolve();
  });
  function Harness() {
    const decks = useDecks();
    return <><output data-testid="references">{JSON.stringify(decks.audio.decks[0].reference_beats ?? [])}</output><button onClick={() => void decks.control(0, 'reference_beat', 18)}>Second flag</button><button onClick={() => void decks.control(0, 'reference_beat', 26)}>Third flag</button></>;
  }
  render(<Harness />);
  await waitFor(() => expect(screen.getByTestId('references').textContent).toBe('[10]'));
  expect(invoke).toHaveBeenCalledWith('timing_waveform', { deck: 0, generation: 1 });
  fireEvent.click(screen.getByText('Second flag'));
  await waitFor(() => expect(screen.getByTestId('references').textContent).toBe('[10,18]'));
  expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid: expect.objectContaining({ bpm: 120, downbeat_seconds: 0 }), referenceBeats: [10, 18] });
  fireEvent.click(screen.getByText('Third flag'));
  await waitFor(() => expect(screen.getByTestId('references').textContent).toBe('[18,26]'));
  expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid: expect.any(Object), referenceBeats: [18, 26] });
});
test('manual track BPM creates and applies a grid without analysis', async () => {
  let native: AudioState = { running: true, error: null, telemetry: {}, decks: [{ ...state, grid: null }, { ...state, deck: 1, track: null }] };
  invoke.mockImplementation((command: string, args?: { grid?: { bpm: number; downbeat_seconds: number; reviewed: boolean } }) => {
    if (command === 'get_audio_state') return Promise.resolve(native);
    if (command === 'track_timing') return Promise.resolve({ grid: args?.grid ?? null, suggestion: null, state: args?.grid ? 'draft' : 'unprepared', reference_beats: [] });
    if (command === 'apply_timing') native = { ...native, decks: native.decks.map(d => d.deck === 0 ? { ...d, grid: args!.grid, target_bpm: args!.grid!.bpm, speed: 1, synced: false } : d) };
    if (command === 'timing_waveform') return Promise.resolve(state.track);
    return Promise.resolve();
  });
  function Harness() {
    const decks = useDecks();
    return <Deck state={decks.audio.decks[0]} running={decks.audio.running} loading={false} error={decks.errors[0]} load={decks.load} control={decks.control} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  const input = screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  expect(input.value).toBe('');
  const set = screen.getByRole('button', { name: 'Set BPM' }) as HTMLButtonElement;
  expect(set.disabled).toBe(true);
  for (const value of ['29', '301', '']) {
    fireEvent.change(input, { target: { value } });
    expect(set.disabled).toBe(true);
  }
  fireEvent.change(input, { target: { value: '125' } });
  expect(set.disabled).toBe(false);
  fireEvent.click(set);
  const grid = { bpm: 125, downbeat_seconds: 0, reviewed: false };
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 0, generation: 1, grid, preserveSpeed: true }));
  expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid, referenceBeats: [] });
  await waitFor(() => expect(screen.getByRole('slider', { name: 'Waveform seek deck A' }).querySelectorAll('path[stroke="currentColor"]').length).toBeGreaterThan(0));
  expect((screen.getByRole('button', { name: 'Lock deck A to master tempo' }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole('button', { name: 'Set reference beat' }) as HTMLButtonElement).disabled).toBe(false);
  expect(invoke.mock.calls.some(([command]) => command === 'analyse_track')).toBe(false);
});

test('track BPM entry is available while playing and unavailable without a loaded track', () => {
  const props = { running: true, loading: false, error: null, load: vi.fn(), control: vi.fn() };
  const { rerender } = render(<Deck state={{ ...state, playing: true }} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).disabled).toBe(false);
  rerender(<Deck state={{ ...state, track: null }} {...props} />);
  expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).disabled).toBe(true);
});

test('BPM correction and original reset persist and apply the grid with its existing anchor and flags', async () => {
  const grid = { bpm: 120, downbeat_seconds: .25, reviewed: true };
  const loaded = { ...state, grid, target_bpm: 130, speed: 130 / 120, synced: true, playing: true };
  invoke.mockImplementation((command: string, args?: { grid?: typeof grid | null }) => {
    if (command === 'get_audio_state') return Promise.resolve({ running: true, error: null, telemetry: {}, decks: [loaded, { ...state, deck: 1, track: null }] });
    if (command === 'track_timing') return Promise.resolve({ grid: args?.grid ?? grid, suggestion: { ...grid, bpm: 118.999072 }, reference_beats: [10] });
    if (command === 'timing_waveform') return Promise.resolve(state.track);
    return Promise.resolve();
  });
  function Harness() {
    const decks = useDecks();
    return <Deck state={decks.audio.decks[0]} otherPlaying={false} running={decks.audio.running} loading={false} error={null} load={decks.load} control={decks.control} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  const input = await screen.findByRole('spinbutton', { name: 'Track BPM' });
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('120'));
  fireEvent.change(input, { target: { value: '125' } });
  fireEvent.click(screen.getByRole('button', { name: 'Set BPM' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 0, generation: 1, grid: { ...grid, bpm: 125, reviewed: false }, preserveSpeed: true }));
  expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid: { ...grid, bpm: 125, reviewed: false }, referenceBeats: [10] });
  fireEvent.click(screen.getByRole('button', { name: 'Original BPM' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 0, generation: 1, grid: { ...grid, bpm: 118.999072, reviewed: false }, preserveSpeed: true }));
  expect(invoke.mock.calls.some(([command, args]) => command === 'deck_control' && args.action !== 'click_panel')).toBe(false);
});
test.each([false, true])('bar start buttons retain speed, lock and reference flags (playing: %s)', async playing => {
  const grid = { bpm: 120, downbeat_seconds: 0, reviewed: true };
  const loaded = { ...state, grid, playing, synced: true, speed: 1.05, target_bpm: 126 };
  invoke.mockImplementation((command: string, args?: { grid?: typeof grid | null; referenceBeats?: number[] }) => {
    if (command === 'get_audio_state') return Promise.resolve({ running: true, error: null, telemetry: {}, decks: [loaded, { ...state, deck: 1, track: null }] });
    if (command === 'track_timing') return Promise.resolve({ grid: args?.grid ?? grid, reference_beats: args?.referenceBeats ?? [10] });
    if (command === 'timing_waveform') return Promise.resolve(state.track);
    return Promise.resolve();
  });
  function Harness() {
    const decks = useDecks();
    return <Deck state={decks.audio.decks[0]} otherPlaying={false} running={decks.audio.running} loading={false} error={null} load={decks.load} control={decks.control} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Shift bar start forward one beat on deck A' }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Shift bar start forward one beat on deck A' })));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 0, generation: 1, grid: { bpm: 120, downbeat_seconds: .5, reviewed: false }, preserveSpeed: true, ...(playing ? { followClock: true } : {}) }));
  expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid: { bpm: 120, downbeat_seconds: .5, reviewed: false }, referenceBeats: [10] });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Shift bar start back one beat on deck A' })));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 0, generation: 1, grid: { bpm: 120, downbeat_seconds: 0, reviewed: false }, preserveSpeed: true, ...(playing ? { followClock: true } : {}) }));
  for (let i = 0; i < 4; i++) {
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Shift bar start back one beat on deck A' })));
  }
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 0, generation: 1, grid: { bpm: 120, downbeat_seconds: 6, reviewed: false }, preserveSpeed: true, ...(playing ? { followClock: true } : {}) }));
  expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid: { bpm: 120, downbeat_seconds: 6, reviewed: false }, referenceBeats: [10] });
});

test.each([true, false])('rolling waveform references work with timing open, existing BPM: %s', hasBpm => {
  const control = vi.fn().mockResolvedValue(undefined);
  const withGrid = { ...state, position_seconds: 50, speed: 2, grid: hasBpm ? { bpm: 120, downbeat_seconds: 0, reviewed: false } : null };
  const { rerender } = render(<RollingRow state={withGrid} running window={10} control={control} />);
  const wave = screen.getByRole('img', { name: 'Rolling waveform deck A' });
  vi.spyOn(wave, 'getBoundingClientRect').mockReturnValue({ left: 10, width: 100 } as DOMRect);
  fireEvent.doubleClick(wave, { clientX: 85 });
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toHaveLength(0);
  rerender(<RollingRow state={withGrid} running window={10} control={control} timingOpen />);
  fireEvent.doubleClick(wave, { clientX: 85 });
  expect(control).toHaveBeenCalledWith(0, 'reference_beat', 55);
});

test('deck lock lives beside BPM and disables manual tempo while locked', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const reviewed = { ...state, target_bpm: 120, grid: { bpm: 120, downbeat_seconds: 0, reviewed: false } };
  const { rerender } = render(<Deck state={reviewed} running loading={false} error={null} load={vi.fn()} control={control} />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  expect((screen.getByRole('button', { name: 'Lock deck A to master tempo' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Lock deck A to master tempo' }));
  expect(control).toHaveBeenCalledWith(0, 'sync', 1);
  rerender(<Deck state={{ ...reviewed, synced: true }} running loading={false} error={null} load={vi.fn()} control={control} />);
  expect(screen.getByLabelText('BPM deck A').getAttribute('aria-disabled')).toBe('true');
  expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Unlock deck A to master tempo' }));
  expect(control).toHaveBeenCalledWith(0, 'sync', 0);
});

test('a sole playing locked deck scrolls master BPM and disables edits when another deck starts', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const deck = { ...state, playing: true, synced: true, target_bpm: 124, grid: { bpm: 120, downbeat_seconds: 0, reviewed: true } };
  const props = { running: true, loading: false, error: null, load: vi.fn(), control };
  const { rerender } = render(<Deck {...props} state={deck} otherPlaying={false} />);
  const bpm = screen.getByLabelText('BPM deck A');
  expect(bpm.getAttribute('aria-disabled')).toBe('false');
  fireEvent.wheel(bpm, { deltaY: -100 });
  expect(control).toHaveBeenLastCalledWith(0, 'master_tempo', 124.1);
  expect(screen.getByRole('button', { name: 'Unlock deck A to master tempo' }).getAttribute('aria-pressed')).toBe('true');
  for (const [playing, otherPlaying, launch_pending] of [[true, true, false], [false, false, false], [true, false, true]]) {
    rerender(<Deck {...props} state={{ ...deck, playing, launch_pending }} otherPlaying={otherPlaying} />);
    control.mockClear();
    expect(bpm.getAttribute('aria-disabled')).toBe('true');
    fireEvent.wheel(bpm, { deltaY: -100 });
    expect(control).not.toHaveBeenCalled();
  }
});

test('double-clicking deck BPM unlocks before restoring the precise source tempo', async () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const grid = { bpm: 118.999072, downbeat_seconds: 0, reviewed: false };
  const { rerender } = render(<Deck state={{ ...state, target_bpm: 124, grid, synced: true }} running loading={false} error={null} load={vi.fn()} control={control} />);
  await act(async () => { fireEvent.doubleClick(screen.getByTitle('Double-click to unlock and restore original tempo')); });
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'sync', 0], [0, 'tempo', grid.bpm]]);
  control.mockClear();
  rerender(<Deck state={{ ...state, target_bpm: 124, grid, synced: false }} running loading={false} error={null} load={vi.fn()} control={control} />);
  await act(async () => { fireEvent.doubleClick(screen.getByTitle('Double-click to unlock and restore original tempo')); });
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'tempo', grid.bpm]]);
});

test('mixer changes the selected native deck gain with immediate feedback', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  render(<Mixer audio={{ running: true, error: null, telemetry: {}, decks: [state, { ...state, deck: 1 }] }} control={control} />);
  fireEvent.change(screen.getByRole('slider', { name: 'Volume deck B' }), { target: { value: '.35' } });
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[1, 'gain', .35]]);
  expect(screen.getByRole('slider', { name: 'Volume deck B' }).getAttribute('aria-valuetext')).toBe('-9.1 dB');
  expect(screen.getByRole('meter', { name: 'Deck B level' }).parentElement).toBe(screen.getByRole('slider', { name: 'Volume deck B' }).parentElement);
  fireEvent.change(screen.getByRole('slider', { name: 'Volume deck B' }), { target: { value: '0' } });
  expect(screen.getByRole('slider', { name: 'Volume deck B' }).getAttribute('aria-valuetext')).toBe('−∞ dB');
  fireEvent.change(screen.getByRole('slider', { name: 'Volume deck B' }), { target: { value: '1' } });
  expect(screen.getByRole('slider', { name: 'Volume deck B' }).getAttribute('aria-valuetext')).toBe('0.0 dB');
  expect(screen.queryByText('0.0 dB')).toBeNull();
  expect(screen.getByLabelText('Stereo master meters')).toBeTruthy();
  expect((screen.getByRole('slider', { name: 'Crossfader' }) as HTMLInputElement).disabled).toBe(false);
});

test('channel controls sit with their decks and centre mixer has no A, B or master heading', () => {
  const audio = { running: true, error: null, telemetry: {}, decks: [state, { ...state, deck: 1 }] };
  render(<Mixer audio={audio} control={vi.fn()} deckA={<div data-testid="deck-a" />} deckB={<div data-testid="deck-b" />} />);
  expect(screen.getByTestId('deck-a').parentElement?.querySelector('[aria-label="Deck A mixer controls"]')).toBeTruthy();
  expect(screen.getByTestId('deck-b').parentElement?.querySelector('[aria-label="Deck B mixer controls"]')).toBeTruthy();
  const centre = screen.getByRole('region', { name: 'Mixer' });
  expect(centre.textContent).toBe('LR');
  expect(centre.querySelectorAll('.mixer-channel')).toHaveLength(0);
});

test('meters refresh independently at 30 Hz without React commits or transport requests', async () => {
  const { Profiler } = await import('react');
  vi.useFakeTimers();
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.push(callback); return callbacks.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  let now = 16;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const commits = vi.fn();
  invoke.mockResolvedValue({ running: true, decks: [.8, 0], master: [.5, .25] });
  try {
    render(<Profiler id="meters" onRender={commits}><Mixer audio={{ running: true, error: null, telemetry: {}, decks: [state, { ...state, deck: 1 }] }} control={vi.fn()} /></Profiler>);
    const mounted = commits.mock.calls.length;
    await act(async () => {});
    act(() => callbacks.shift()?.(now));
    const deck = screen.getByRole('meter', { name: 'Deck A level' });
    expect(deck.getAttribute('aria-valuetext')).toBe('-1.9 dBFS peak');
    expect(deck.firstElementChild?.getAttribute('style')).toContain('inset(4.0');
    expect(screen.getByRole('meter', { name: 'Deck B level' }).getAttribute('aria-valuetext')).toBe('Silent');
    expect(screen.getByRole('meter', { name: 'Master left level' }).getAttribute('aria-valuetext')).toBe('-6.0 dBFS peak');
    expect(screen.getByRole('meter', { name: 'Master right level' }).getAttribute('aria-valuetext')).toBe('-12.0 dBFS peak');
    for (let i = 0; i < 5; i++) {
      now += 34;
      await act(async () => { await vi.advanceTimersByTimeAsync(34); callbacks.shift()?.(now); });
    }
    expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(invoke.mock.calls.every(([command]) => command === 'get_audio_levels')).toBe(true);
    expect(commits.mock.calls.length).toBe(mounted);
  } finally { cleanup(); clock.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); }
});

test('EQ dials send native controls and reset to unity', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const control = vi.fn().mockResolvedValue(undefined);
  render(<Mixer audio={{ running: true, error: null, telemetry: {}, decks: [state, { ...state, deck: 1 }] }} control={control} />);
  const dial = screen.getByRole('slider', { name: 'High EQ deck A' });
  fireEvent.pointerDown(dial, { pointerId: 1, clientY: 100 });
  fireEvent.pointerMove(dial, { pointerId: 1, clientY: 65 });
  expect(dial.getAttribute('aria-valuenow')).toBe('75');
  fireEvent.pointerUp(dial, { pointerId: 1 });
  fireEvent.keyDown(dial, { key: 'ArrowDown' });
  expect(dial.getAttribute('aria-valuenow')).toBe('75');
  expect(dial.getAttribute('tabindex')).toBe('-1');
  fireEvent.doubleClick(dial);
  expect(dial.getAttribute('aria-valuenow')).toBe('50');
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'eq_high', .75], [0, 'eq_high', .5]]);
});

test('gain trim is independent of volume and bipolar filter sends both polarities', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const control = vi.fn().mockResolvedValue(undefined);
  render(<Mixer audio={{ running: true, error: null, telemetry: {}, decks: [state, { ...state, deck: 1 }] }} control={control} />);
  const gain = screen.getByRole('slider', {name: 'Gain deck B'});
  fireEvent.pointerDown(gain, {pointerId:1,clientY:100});
  fireEvent.pointerMove(gain, {pointerId:1,clientY:30});
  fireEvent.pointerUp(gain, {pointerId:1});
  const filter = screen.getByRole('slider', {name:'Filter deck B'});
  fireEvent.pointerDown(filter, {pointerId:1,clientY:100});
  fireEvent.pointerMove(filter, {pointerId:1,clientY:170});
  fireEvent.pointerUp(filter, {pointerId:1});
  expect(filter.getAttribute('aria-valuetext')).toBe('Low-pass 100%');
  fireEvent.pointerDown(filter, {pointerId:1,clientY:170});
  fireEvent.pointerMove(filter, {pointerId:1,clientY:30});
  fireEvent.pointerUp(filter, {pointerId:1});
  expect(filter.getAttribute('aria-valuetext')).toBe('High-pass 100%');
  fireEvent.doubleClick(filter);
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[1,'trim',12],[1,'filter',-1],[1,'filter',1],[1,'filter',0]]);
});

test.each([false, true])('overview seeks silently; playing clicks do not start a drag, playing=%s', async playing => {
  vi.useFakeTimers(); vi.stubGlobal('PointerEvent', MouseEvent);
  const control = vi.fn().mockResolvedValue(undefined);
  try {
    render(<Deck state={{...state, playing}} running loading={false} error={null} load={vi.fn()} control={control} />);
    const wave = screen.getByRole('slider', {name:'Waveform seek deck A'});
    Object.assign(wave, {setPointerCapture: vi.fn(), releasePointerCapture: vi.fn()});
    vi.spyOn(wave, 'getBoundingClientRect').mockReturnValue({left:0,width:100} as DOMRect);
    await act(async () => {fireEvent.pointerDown(wave, {button:0,clientX:25});});
    if (playing) {
      expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0,'seek',25]]);
      await act(async () => {fireEvent.pointerMove(wave, {clientX:70}); fireEvent.pointerUp(wave);});
      expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0,'seek',25]]);
      return;
    }
    expect(control).toHaveBeenCalledWith(0,'seek',25);
    await act(async () => {fireEvent.pointerMove(wave, {clientX:70});});
    await act(async () => {fireEvent.pointerUp(wave, {clientX:80}); await vi.advanceTimersByTimeAsync(80);});
    expect(control.mock.calls.at(-1)).toEqual([0,'seek',70]);
    expect(control.mock.calls.filter(([, action]) => action !== 'click_panel').every(call => call[1] === 'seek')).toBe(true);
  } finally {cleanup();vi.useRealTimers();vi.unstubAllGlobals();}
});

test('playing rolling waveform clicks seek to the visible source position', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const control = vi.fn().mockResolvedValue(undefined);
  const now = vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    render(<RollingRow state={{...state,playing:true,position_seconds:50,speed:2}} running window={10} control={control} />);
    const wave=screen.getByRole('img',{name:'Rolling waveform deck A'});
    vi.spyOn(wave,'getBoundingClientRect').mockReturnValue({left:10,width:100} as DOMRect);
    await act(async()=>{fireEvent.pointerDown(wave,{button:0,clientX:85});});
    expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0,'seek',55]]);
    await act(async()=>{fireEvent.pointerMove(wave,{clientX:20});fireEvent.pointerUp(wave);});
    expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0,'seek',55]]);
  } finally {cleanup();now.mockRestore();vi.unstubAllGlobals();}
});

test('rolling waveform follows drag displacement beneath a fixed center playhead', async () => {
  vi.useFakeTimers(); vi.stubGlobal('PointerEvent', MouseEvent);
  const control = vi.fn().mockResolvedValue(undefined);
  try {
    render(<RollingRow state={{...state,position_seconds:50,speed:2}} running window={10} control={control} />);
    const wave=screen.getByRole('img',{name:'Rolling waveform deck A'});
    Object.assign(wave,{setPointerCapture:vi.fn()});
    vi.spyOn(wave,'getBoundingClientRect').mockReturnValue({left:0,width:100} as DOMRect);
    await act(async()=>{fireEvent.pointerDown(wave,{button:0,clientX:60});});
    expect(control).toHaveBeenCalledWith(0,'scrub_start',50);
    expect(wave.parentElement?.querySelector('.rolling-playhead')?.getAttribute('style')).toBeNull();
    await act(async()=>{fireEvent.pointerMove(wave,{clientX:85});fireEvent.pointerMove(wave,{clientX:35});fireEvent.pointerUp(wave);await vi.advanceTimersByTimeAsync(100);});
    expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0,'scrub_start',50],[0,'scrub',45],[0,'scrub',55],[0,'scrub_pause',55]]);
  } finally {cleanup();vi.useRealTimers();vi.unstubAllGlobals();}
});

test('Cue handles pointer release, keyboard repeat, cancellation and Play during preview', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const control = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(<Deck state={state} running loading={false} error={null} load={vi.fn()} control={control} />);
  const cue = screen.getByRole('button', { name: 'Cue deck A' });
  fireEvent.pointerDown(cue, { button: 0, pointerId: 1 });
  fireEvent.pointerUp(cue, { pointerId: 1 });
  fireEvent.lostPointerCapture(cue);
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'cue_press'], [0, 'cue_release']]);
  control.mockClear();
  fireEvent.keyDown(cue, { key: ' ', repeat: false });
  fireEvent.keyDown(cue, { key: ' ', repeat: true });
  fireEvent.keyUp(cue, { key: ' ' });
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'cue_press'], [0, 'cue_release']]);
  control.mockClear();
  fireEvent.pointerDown(cue, { button: 0, pointerId: 2 });
  fireEvent.blur(window);
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'cue_press'], [0, 'cue_release']]);
  rerender(<Deck state={{ ...state, playing: true, cue_preview: true, cue_seconds: 12 }} running loading={false} error={null} load={vi.fn()} control={control} />);
  control.mockClear();
  fireEvent.pointerDown(cue, { button: 0, pointerId: 3 });
  const play = screen.getByRole('button', { name: 'Play deck A' });
  fireEvent.blur(cue, { relatedTarget: play });
  fireEvent.click(play);
  fireEvent.pointerUp(cue, { pointerId: 3 });
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'cue_press'], [0, 'play_pause'], [0, 'cue_release']]);
  expect(screen.getByLabelText('Cue point deck A').getAttribute('d')).toBe('M122.88,0v120');
  vi.unstubAllGlobals();
});

test('crossfader sends global positions, centres on double-click and follows native state', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const audio = { running: true, error: null, telemetry: {}, crossfader: -.4, decks: [{ ...state, track: null }, { ...state, deck: 1, track: null }] };
  const { rerender } = render(<Mixer audio={audio} control={control} />);
  const slider = screen.getByRole('slider', { name: 'Crossfader' }) as HTMLInputElement;
  expect(slider.value).toBe('-0.4');
  expect(slider.disabled).toBe(false);
  fireEvent.change(slider, { target: { value: '1' } });
  expect(control).toHaveBeenLastCalledWith(0, 'crossfader', 1);
  fireEvent.doubleClick(slider);
  expect(control).toHaveBeenLastCalledWith(0, 'crossfader', 0);
  rerender(<Mixer audio={audio} control={control} showCrossfader={false} />);
  expect(screen.queryByRole('slider', { name: 'Crossfader' })).toBeNull();
});


test('headphone buttons toggle each deck independently and expose native selection', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const audio = { running: true, error: null, telemetry: {}, decks: [state, { ...state, deck: 1, headphone_cue: true }] };
  const { rerender } = render(<Mixer audio={audio} control={control} />);
  const a = screen.getByRole('button', { name: 'Headphone cue deck A' });
  expect(a.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(a);
  fireEvent.click(screen.getByRole('button', { name: 'Headphone cue deck B' }));
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'headphone_cue', 1], [1, 'headphone_cue', 0]]);
  rerender(<Mixer audio={{ ...audio, decks: [{ ...state, headphone_cue: true }, { ...state, deck: 1 }] }} control={control} />);
  expect(a.getAttribute('aria-pressed')).toBe('true');
});

test.each(['not_analysed', 'stale', 'failed', 'queued', 'analysing', 'analysed', 'needs_review', 'approved'])('deck Analyze availability for %s', analysisState => {
  const analyse = vi.fn();
  const props = { running: true, loading: false, error: null, load: vi.fn(), control: vi.fn(), analyse, analysisState };
  const { rerender } = render(<Deck state={state} {...props} />);
  const button = screen.queryByRole('button', { name: 'Analyse deck A' }) as HTMLButtonElement | null;
  if (['analysed', 'needs_review', 'approved'].includes(analysisState)) expect(button).toBeNull();
  else {
    expect(button).toBeTruthy();
    const busy = ['queued', 'analysing'].includes(analysisState);
    expect(button!.disabled).toBe(busy);
    fireEvent.click(button!);
    expect(analyse).toHaveBeenCalledTimes(busy ? 0 : 1);
  }
  rerender(<Deck state={{ ...state, track: null }} {...props} />);
  expect(screen.queryByRole('button', { name: 'Analyse deck A' })).toBeNull();
});

test('automatic buttons require an eligible outgoing deck and remain cancellable during overlap', () => {
  const control = vi.fn();
  const props = { state: { ...state, playing: true }, running: true, loading: false, error: null, load: vi.fn(), control };
  const view = render(<Deck {...props} autoAvailable />);
  const now = screen.getByRole<HTMLButtonElement>('button', { name: 'AUTO NOW deck A' });
  const end = screen.getByRole<HTMLButtonElement>('button', { name: 'AUTO END deck A' });
  expect(now.disabled).toBe(false);
  fireEvent.click(now);
  expect(control).toHaveBeenLastCalledWith(0, 'auto_now');
  fireEvent.click(end);
  expect(control).toHaveBeenLastCalledWith(0, 'auto_end');
  view.rerender(<Deck {...props} autoAvailable={false} autoMode={1} />);
  expect(now.disabled).toBe(false);
  expect(now.getAttribute('aria-pressed')).toBe('true');
  expect(now.classList.contains('auto-engaged')).toBe(true);
  expect(end.disabled).toBe(true);
  fireEvent.click(now);
  expect(control).toHaveBeenLastCalledWith(0, 'auto_now');
  view.rerender(<Deck {...props} autoAvailable={false} />);
  expect(now.disabled).toBe(true);
  expect(end.disabled).toBe(true);
});

test('transition guides appear on both overview and rolling waveforms and clear when cancelled', () => {
  const transition = { from: 0, style: 'smart' as const, started: false, points: [[16, 22, 22, 22, 32], [7, 13, 13, 13, 23]] as [[number, number, number, number, number], [number, number, number, number, number]], remaining_beats: [4, 16, 16, 16, 36] as [number, number, number, number, number] };
  const states = [state, { ...state, deck: 1 }];
  function Guides({ engaged }: { engaged: boolean }) {
    const plan = engaged ? transition : null;
    return <><RollingWaveforms audio={{ running: false, error: null, telemetry: {}, decks: states, auto_transition: plan }} />{states.map(d => <Deck key={d.deck} transition={plan} state={d} running={false} loading={false} error={null} load={vi.fn()} control={vi.fn()} />)}</>;
  }
  const view = render(<Guides engaged />);
  for (const deck of ['A', 'B']) {
    const overview = screen.getByRole('slider', { name: `Waveform seek deck ${deck}` });
    expect(overview.querySelector('[data-transition-marker="bass"]')).toBeTruthy();
    expect(overview.querySelector('[data-transition-marker="out"]')).toBeNull();
    expect(screen.getByRole('group', { name: `Automatic transition guides rolling deck ${deck}` }).textContent).toContain('BASS SWAP');
  }
  expect(screen.getByRole('group', { name: 'Automatic transition guides deck B' }).textContent).toContain('BASS SWAP at 0:13.0');
  view.rerender(<Guides engaged={false} />);
  expect(document.querySelector('[data-transition-marker]')).toBeNull();
  expect(screen.queryByRole('group', { name: /Automatic transition guides/ })).toBeNull();
});

test('planned transition points and areas intercept seeking on both overview and rolling waveforms', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  try {
    for (const rolling of [false, true]) for (const deck of [0, 1]) {
      for (const [x, action, target] of [[20, 'auto_start', 28], [40, 'auto_swap', 48], [60, 'auto_finish', 68], [30, 'auto_move', 28]] as const) {
        const control = vi.fn().mockResolvedValue(undefined);
        const deckState = { ...state, deck, position_seconds: 50, grid: { bpm: 120, downbeat_seconds: .25, reviewed: true } };
        const transition = { from: 0, style: 'bass-swap' as const, started: false, points: [[20,40,40,40,60], [20,40,40,40,60]] as [import('./TransitionGuides').TransitionPoints, import('./TransitionGuides').TransitionPoints], remaining_beats: [40,72,72,72,104] as import('./TransitionGuides').TransitionPoints };
        const view = render(rolling
          ? <RollingRow state={deckState} running window={100} transition={transition} control={control} />
          : <Deck state={deckState} running loading={false} error={null} load={vi.fn()} transition={transition} control={control} />);
        const waveform = screen.getByRole(rolling ? 'img' : 'slider', { name: `${rolling ? 'Rolling waveform' : 'Waveform seek'} deck ${deck === 0 ? 'A' : 'B'}` });
        vi.spyOn(waveform, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
        Object.assign(waveform, { setPointerCapture: vi.fn() });
        await act(async () => {
          fireEvent.pointerDown(waveform, { button: 0, clientX: x });
          fireEvent.pointerMove(waveform, { clientX: x + 3 }); // Less than half a phrase.
        });
        expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toHaveLength(0);
        await act(async () => {
          fireEvent.pointerMove(waveform, { clientX: x + 6 });
          fireEvent.pointerUp(waveform, { clientX: x + 6 });
        });
        expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[deck, action, target]]);
        view.unmount();
      }
    }
  } finally { vi.unstubAllGlobals(); }
});


test('double-clicking AUTO selects only the fast overlap and fast state blinks distinctly', () => {
  vi.useFakeTimers();
  try {
    const control = vi.fn();
    const props = { state: { ...state, playing: true }, running: true, loading: false, error: null, load: vi.fn(), control, autoAvailable: true, autoFastBars: 2 };
    const view = render(<Deck {...props} />);
    for (const mode of ['NOW', 'END']) {
      control.mockClear();
      const button = screen.getByRole('button', { name: `AUTO ${mode} deck A` });
      fireEvent.click(button, { detail: 1 });
      fireEvent.click(button, { detail: 2 });
      fireEvent.doubleClick(button);
      act(() => vi.advanceTimersByTime(500));
      expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, mode === 'NOW' ? 'auto_now_fast' : 'auto_end_fast', 2]]);
    }
    view.rerender(<Deck {...props} autoMode={2} autoFast />);
    const end = screen.getByRole('button', { name: 'AUTO END deck A' });
    expect(end.classList.contains('auto-fast')).toBe(true);
    control.mockClear();
    fireEvent.click(end, { detail: 1 });
    act(() => vi.advanceTimersByTime(400));
    expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'auto_end']]);
    view.rerender(<Deck {...props} autoMode={2} />);
    expect(end.classList.contains('auto-fast')).toBe(false);
  } finally { vi.useRealTimers(); }
});

test('transition dragging takes priority over phrase-jump arrows inside its region', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  try {
    const control = vi.fn().mockResolvedValue(undefined);
    const deckState = { ...state, playing: true, position_seconds: 46, grid: { bpm: 120, downbeat_seconds: 0, reviewed: true } };
    const transition = { from: 0, style: 'bass-swap' as const, started: false, points: [[20,40,40,40,60], [20,40,40,40,60]] as [import('./TransitionGuides').TransitionPoints, import('./TransitionGuides').TransitionPoints], remaining_beats: [40,72,72,72,104] as import('./TransitionGuides').TransitionPoints };
    render(<Deck state={deckState} transition={transition} running loading={false} error={null} load={vi.fn()} control={control} />);
    const waveform = screen.getByRole('slider', { name: 'Waveform seek deck A' });
    vi.spyOn(waveform, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
    Object.assign(waveform, { setPointerCapture: vi.fn() });
    const arrow = screen.getByRole('button', { name: 'Jump 8 bars back on deck A' });
    await act(async () => {
      fireEvent.pointerDown(arrow, { button: 0, clientX: 30 });
      fireEvent.pointerMove(waveform, { clientX: 38 });
      fireEvent.pointerUp(waveform, { clientX: 38 });
      fireEvent.click(arrow, { clientX: 38 });
    });
    expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'auto_move', 28]]);
  } finally { vi.unstubAllGlobals(); }
});

function GridEditHarness() {
  const decks = useDecks();
  return <><Deck state={decks.audio.decks[0]} running={decks.audio.running} loading={false} error={decks.errors[0]} load={decks.load} control={decks.control} /><RollingWaveforms audio={decks.audio} control={decks.control} /></>;
}
function mockGridAudio() {
  const grid = { bpm: 120, downbeat_seconds: 0, reviewed: true };
  const native: AudioState = { running: true, error: null, telemetry: {}, decks: [{ ...state, position_seconds: 8, grid }, { ...state, deck: 1, track: null }] };
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'get_audio_state' ? native : command === 'track_timing' ? { grid, reference_beats: [2, 3] } : {}));
  return native;
}
function dragGridMark(from: number, to: number) {
  const wave = screen.getByRole('img', { name: 'Rolling waveform deck A' });
  vi.spyOn(wave, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 160, height: 80 } as DOMRect);
  fireEvent.pointerDown(wave, { button: 0, clientX: from });
  fireEvent.pointerMove(wave, { clientX: to });
  fireEvent.pointerUp(wave, { clientX: to });
}
test('bar arrows edit the draft in both directions and save or discard with the grid', async () => {
  mockGridAudio();
  render(<GridEditHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  await waitFor(() => expect((screen.getByText('Edit grid') as HTMLButtonElement).disabled).toBe(false));
  await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
  const right = screen.getByRole('button', { name: 'Shift bar start forward one beat on deck A' });
  const left = screen.getByRole('button', { name: 'Shift bar start back one beat on deck A' });
  expect((right as HTMLButtonElement).disabled).toBe(false);
  await act(async () => { fireEvent.click(right); fireEvent.click(left); fireEvent.click(left); });
  expect(invoke.mock.calls.filter(([c, args]) => c === 'track_timing' && args.grid || c === 'apply_timing')).toHaveLength(0);
  await act(async () => { fireEvent.click(screen.getByText('Save grid')); });
  expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid: { bpm: 120, downbeat_seconds: 7.5, reviewed: false }, referenceBeats: [] });
  await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
  await act(async () => { fireEvent.click(right); });
  const writes = invoke.mock.calls.filter(([c, args]) => c === 'track_timing' && args.grid || c === 'apply_timing').length;
  await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
  expect(invoke.mock.calls.filter(([c, args]) => c === 'track_timing' && args.grid || c === 'apply_timing')).toHaveLength(writes);
  expect(screen.getByText('Edit grid')).toBeTruthy();
});

test.each([{ playing: true }, { launch_pending: true }])('draft bar shifts wait for a stopped deck: %j', async blocked => {
  const native = mockGridAudio();
  const hook = renderHook(() => useDecks());
  await waitFor(() => expect(hook.result.current.audio.running).toBe(true));
  await act(async () => { await hook.result.current.control(0, 'grid_edit'); await hook.result.current.control(0, 'grid_pin', 8); });
  const draft = hook.result.current.audio.decks[0].grid_edit;
  await act(async () => { await hook.result.current.control(0, 'shift_bar_start', 1); });
  expect(hook.result.current.audio.decks[0].grid_edit?.downbeat_seconds).toBe(.5);
  expect(hook.result.current.audio.decks[0].grid_pin).toBe(8);
  native.decks[0] = { ...native.decks[0], ...blocked };
  await waitFor(() => expect(hook.result.current.audio.decks[0]).toMatchObject(blocked));
  await act(async () => { await hook.result.current.control(0, 'shift_bar_start', -1); });
  expect(hook.result.current.audio.decks[0].grid_edit?.downbeat_seconds).toBe(.5);
  await act(async () => { await hook.result.current.control(0, 'grid_cancel'); });
  expect(hook.result.current.audio.decks[0].grid).toEqual(draft);
});

test('grid edits survive polling, cancel restores the original, and save persists and applies the draft', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  try {
    mockGridAudio();
    render(<GridEditHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
    await waitFor(() => expect((screen.getByText('Edit grid') as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
    expect(screen.queryByText('Edit grid')).toBeNull();
    await act(async () => { dragGridMark(85, 90); });
    expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).value).toBe('120.00');
    await waitFor(() => expect(invoke.mock.calls.filter(([c]) => c === 'get_audio_state').length).toBeGreaterThan(1));
    expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).value).toBe('120.00');
    await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
    expect(screen.getByText('Edit grid')).toBeTruthy();
    expect(invoke.mock.calls.filter(([c, args]) => c === 'apply_timing' || c === 'track_timing' && args.grid)).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
    await act(async () => { dragGridMark(80, 90); });
    await act(async () => { fireEvent.click(screen.getByText('Save grid')); });
    const grid = { bpm: 120, downbeat_seconds: 1, reviewed: false };
    expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid, referenceBeats: [] });
    expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 0, generation: 1, grid, preserveSpeed: true });
    expect(screen.getByText('Edit grid')).toBeTruthy();
    expect(invoke.mock.calls.filter(([c, args]) => c === 'deck_control' && ['seek', 'scrub', 'scrub_start', 'auto_move'].includes(args.action))).toHaveLength(0);
  } finally { vi.unstubAllGlobals(); }
});
test('failed grid saves retain the editable draft and replacing the track discards it', async () => {
  const native = mockGridAudio();
  render(<GridEditHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  await waitFor(() => expect((screen.getByText('Edit grid') as HTMLButtonElement).disabled).toBe(false));
  await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
  invoke.mockImplementation((command: string) => command === 'track_timing' ? Promise.reject('Storage unavailable') : Promise.resolve(command === 'get_audio_state' ? native : {}));
  await act(async () => { fireEvent.click(screen.getByText('Save grid')); });
  expect(screen.getByRole('alert').textContent).toBe('Storage unavailable');
  expect(invoke.mock.calls.filter(([command]) => command === 'apply_timing').at(-1)).toEqual(['apply_timing', { deck: 0, generation: 1, grid: native.decks[0].grid, preserveSpeed: true }]);
  expect((screen.getByText('Save grid') as HTMLButtonElement).disabled).toBe(false);
  native.decks[0] = { ...native.decks[0], generation: 2 };
  await waitFor(() => expect(screen.getByText('Edit grid')).toBeTruthy());
});

test('Command-click pins any beat for scaling; repinning, unpinning and cancel restore shift mode', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  try {
    mockGridAudio();
    render(<GridEditHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
    await waitFor(() => expect((screen.getByText('Edit grid') as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
    const wave = screen.getByRole('img', { name: 'Rolling waveform deck A' });
    vi.spyOn(wave, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 160, height: 80 } as DOMRect);
    fireEvent.pointerMove(wave, { clientX: 85 });
    expect(wave.style.cursor).toBe('grab');
    fireEvent.pointerMove(wave, { clientX: 80 }); // Yellow mark.
    expect(wave.style.cursor).toBe('grab');
    fireEvent.pointerMove(wave, { clientX: 82.5 }); // Between beat marks.
    expect(wave.style.cursor).toBe('ew-resize');
    await act(async () => { dragGridMark(112.5, 117.5); });
    expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).value).toBe('120.00');
    await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
    await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
    const commandClick = async (x: number) => {
      await act(async () => {
        fireEvent.pointerDown(wave, { button: 0, clientX: x, metaKey: true });
        fireEvent.pointerUp(wave, { clientX: x, metaKey: true });
      });
    };
    fireEvent.pointerMove(wave, { clientX: 85, metaKey: true });
    expect(wave.style.cursor).toBe('grab');
    await commandClick(85); // Source time 8.5, a regular beat rather than a yellow mark.
    expect(screen.getByLabelText('Pinned beat deck A').style.left).toBe('53.125%');
    await waitFor(() => expect(invoke.mock.calls.filter(([c]) => c === 'get_audio_state').length).toBeGreaterThan(1));
    expect(screen.getByLabelText('Pinned beat deck A')).toBeTruthy();
    fireEvent.pointerMove(wave, { clientX: 85 });
    expect(wave.style.cursor).toBe('not-allowed');
    await act(async () => { dragGridMark(85, 95); });
    expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).value).toBe('120.00');
    fireEvent.pointerMove(wave, { clientX: 112.5 });
    expect(wave.style.cursor).toBe('ew-resize');
    await act(async () => { dragGridMark(112.5, 140); });
    expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).value).toBe('60.00');
    expect(screen.getByLabelText('Pinned beat deck A').style.left).toBe('53.125%');
    await commandClick(75); // Repin to source time 7.5 after scaling.
    expect(screen.getByLabelText('Pinned beat deck A').style.left).toBe('46.875%');
    await commandClick(75); // Clicking the same beat again returns to shifting.
    expect(screen.queryByLabelText('Pinned beat deck A')).toBeNull();
    await act(async () => { dragGridMark(110, 115); });
    expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).value).toBe('60.00');
    await act(async () => { fireEvent.click(screen.getByText('Save grid')); });
    expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid: { bpm: 60, downbeat_seconds: 8, reviewed: false }, referenceBeats: [] });
    await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
    expect(screen.queryByLabelText('Pinned beat deck A')).toBeNull();
    await commandClick(80);
    await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
    expect(screen.queryByLabelText('Pinned beat deck A')).toBeNull();
    expect(invoke.mock.calls.filter(([c, args]) => c === 'deck_control' && ['seek', 'scrub', 'scrub_start'].includes(args.action))).toHaveLength(0);
  } finally { vi.unstubAllGlobals(); }
});
test('scaling a stopped deck beyond the tempo limits holds the limit and recovers on the same drag', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  try {
    mockGridAudio();
    render(<GridEditHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
    await waitFor(() => expect((screen.getByText('Edit grid') as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
    const wave = screen.getByRole('img', { name: 'Rolling waveform deck A' });
    vi.spyOn(wave, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 160, height: 80 } as DOMRect);
    await act(async () => {
      fireEvent.pointerDown(wave, { button: 0, clientX: 80, metaKey: true });
      fireEvent.pointerUp(wave, { clientX: 80, metaKey: true });
    });
    await act(async () => { fireEvent.pointerDown(wave, { button: 0, clientX: 85 }); });
    await act(async () => { fireEvent.pointerMove(wave, { clientX: 110 }); });
    expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).value).toBe('30.00');
    await act(async () => { fireEvent.pointerMove(wave, { clientX: 75 }); });
    expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).value).toBe('300.00');
    await act(async () => { fireEvent.pointerUp(wave, { clientX: 90 }); });
    expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).value).toBe('60.00');
    expect(screen.getByLabelText('Pinned beat deck A').style.left).toBe('50%');
  } finally { vi.unstubAllGlobals(); }
});
test('reference beats and an audio poll do not cancel a grid drag between pointer events', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  try {
    mockGridAudio(); // Includes two saved reference beats.
    render(<GridEditHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
    await waitFor(() => expect((screen.getByText('Edit grid') as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
    const wave = screen.getByRole('img', { name: 'Rolling waveform deck A' });
    vi.spyOn(wave, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 160, height: 80 } as DOMRect);
    await act(async () => {
      fireEvent.pointerDown(wave, { button: 0, clientX: 80, metaKey: true });
      fireEvent.pointerUp(wave, { clientX: 80, metaKey: true });
    });
    const polls = () => invoke.mock.calls.filter(([command]) => command === 'get_audio_state').length;
    const before = polls();
    await waitFor(() => expect(polls()).toBeGreaterThan(before));
    await act(async () => { fireEvent.pointerDown(wave, { button: 0, clientX: 90 }); });
    const during = polls();
    await waitFor(() => expect(polls()).toBeGreaterThan(during));
    await act(async () => { fireEvent.pointerMove(wave, { clientX: 100 }); });
    expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).value).toBe('60.00');
    await act(async () => { fireEvent.pointerUp(wave, { clientX: 100 }); });
    await act(async () => { fireEvent.click(screen.getByText('Save grid')); });
    expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid: { bpm: 60, downbeat_seconds: 8, reviewed: false }, referenceBeats: [] });
  } finally { vi.unstubAllGlobals(); }
});
test('grid editing survives listen-adjust cycles, blocks gestures during playback, and Cancel restores audible timing', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  try {
    const native = mockGridAudio();
    invoke.mockImplementation((command: string, args?: { deck: number; action: string; grid: DeckState['grid'] }) => {
      if (command === 'apply_timing') native.decks[0] = { ...native.decks[0], grid: args!.grid };
      if (command === 'deck_control' && args?.action === 'play_pause') native.decks[0] = { ...native.decks[0], playing: !native.decks[0].playing };
      return Promise.resolve(command === 'get_audio_state' ? native : command === 'track_timing' ? { grid: native.decks[0].grid, reference_beats: [] } : {});
    });
    render(<GridEditHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
    await waitFor(() => expect((screen.getByText('Edit grid') as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
    await act(async () => { dragGridMark(85, 90); });
    const wave = screen.getByRole('img', { name: 'Rolling waveform deck A' });
    await act(async () => {
      fireEvent.pointerDown(wave, { button: 0, clientX: 90, metaKey: true });
      fireEvent.pointerUp(wave, { clientX: 90, metaKey: true });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play deck A' })); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause deck A' })).toBeTruthy());
    expect(native.decks[0].grid).toEqual({ bpm: 120, downbeat_seconds: .5, reviewed: false });
    const applied = invoke.mock.calls.findIndex(([command]) => command === 'apply_timing');
    const played = invoke.mock.calls.findIndex(([command, args]) => command === 'deck_control' && args.action === 'play_pause');
    expect(applied).toBeLessThan(played);
    expect(screen.getByRole('img', { name: 'Rolling waveform deck A' }).closest('.grid-listening')).toBeTruthy();
    expect(screen.getByLabelText('Pinned beat deck A')).toBeTruthy();
    const count = invoke.mock.calls.filter(([c]) => c === 'apply_timing').length;
    await act(async () => {
      dragGridMark(110, 140);
      fireEvent.pointerDown(wave, { button: 0, clientX: 90, metaKey: true });
      fireEvent.pointerUp(wave, { clientX: 90, metaKey: true });
    });
    fireEvent.pointerMove(wave, { clientX: 112.5 });
    expect(['grab', 'ew-resize']).toContain(wave.style.cursor);
    expect(invoke.mock.calls.filter(([c]) => c === 'apply_timing')).toHaveLength(count);
    expect(native.decks[0].grid).toEqual({ bpm: 120, downbeat_seconds: .5, reviewed: false });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pause deck A' })); });
    await waitFor(() => expect(screen.getByRole('img', { name: 'Rolling waveform deck A' }).closest('.grid-listening')).toBeNull());
    await act(async () => { dragGridMark(110, 130); }); // Scale about the pinned source-time beat at 9 seconds.
    expect((screen.getByRole('spinbutton', { name: 'Track BPM' }) as HTMLInputElement).value).toBe('60.00');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play deck A' })); });
    await waitFor(() => expect(screen.getByRole('img', { name: 'Rolling waveform deck A' }).closest('.grid-listening')).toBeTruthy());
    expect(native.decks[0].grid?.bpm).toBe(60);
    expect(invoke.mock.calls.filter(([c, args]) => c === 'track_timing' && args.grid)).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByText('Cancel')); });
    expect(screen.getByText('Edit grid')).toBeTruthy();
    expect(native.decks[0].grid).toEqual({ bpm: 120, downbeat_seconds: 0, reviewed: true });
    expect(native.decks[0].playing).toBe(true);
    expect(screen.queryByLabelText('Pinned beat deck A')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByText('Edit grid')); });
    expect(screen.getByRole('img', { name: 'Rolling waveform deck A' }).closest('.grid-listening')).toBeTruthy();
  } finally { vi.unstubAllGlobals(); }
});
test('direct grid commands cannot change or pin the draft while the deck is playing', async () => {
  const native = mockGridAudio();
  const hook = renderHook(() => useDecks());
  await waitFor(() => expect(hook.result.current.audio.running).toBe(true));
  await act(async () => { await hook.result.current.control(0, 'grid_edit'); });
  await act(async () => { await hook.result.current.control(0, 'grid_drag_start', 12); });
  native.decks[0] = { ...native.decks[0], playing: true };
  await waitFor(() => expect(hook.result.current.audio.decks[0].playing).toBe(true));
  await act(async () => {
    await hook.result.current.control(0, 'grid_drag', 2);
    await hook.result.current.control(0, 'grid_pin', 8);
  });
  expect(hook.result.current.audio.decks[0].grid_edit).toEqual(native.decks[0].grid);
  expect(hook.result.current.audio.decks[0].grid_pin).toBeUndefined();
  expect(hook.result.current.errors[0]).toBeNull();
});


test.each([[126, '↑ 5.0%'], [114, '↓ 5.0%'], [120, '↔ 0.0%']])('deck header compares source BPM with %s BPM', (target, indication) => {
  render(<Deck state={{ ...state, target_bpm: target as number, grid: { bpm: 120, downbeat_seconds: 0, reviewed: true } }} running loading={false} error={null} load={vi.fn()} control={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  expect(screen.getByLabelText('Original BPM deck A').textContent).toBe('120.0');
  expect(screen.getByLabelText('BPM deck A').textContent).toBe(Number(target).toFixed(1));
  expect(screen.getByLabelText('Tempo bias deck A').textContent).toBe(indication);
});

test('original BPM resets playback without changing the source grid; only current BPM scrolls', async () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const grid = { bpm: 118.999072, downbeat_seconds: 0, reviewed: true };
  const props = { running: true, loading: false, error: null, load: vi.fn(), control };
  const { rerender } = render(<Deck {...props} state={{ ...state, grid, target_bpm: 124, synced: true }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  await act(async () => { fireEvent.doubleClick(screen.getByLabelText('Original BPM deck A')); });
  expect(control.mock.calls.filter(([, action]) => action !== 'click_panel')).toEqual([[0, 'sync', 0], [0, 'tempo', grid.bpm]]);
  control.mockClear();
  fireEvent.wheel(screen.getByLabelText('BPM deck A'), { deltaY: -100 });
  expect(control).not.toHaveBeenCalled();
  rerender(<Deck {...props} state={{ ...state, grid, target_bpm: 124 }} />);
  fireEvent.wheel(screen.getByLabelText('Original BPM deck A'), { deltaY: -100 });
  expect(control).not.toHaveBeenCalled();
  fireEvent.wheel(screen.getByLabelText('BPM deck A'), { deltaY: -100 });
  expect(control).toHaveBeenLastCalledWith(0, 'tempo', 124.1);
  fireEvent.wheel(screen.getByLabelText('BPM deck A'), { deltaY: 100, shiftKey: true });
  expect(control.mock.calls.at(-1)?.[2]).toBeCloseTo(124.09);
});

test('tempo slider learns a percentage range and follows the current track source BPM', async () => {
  localStorage.setItem('vira.midi-behavior.v1', JSON.stringify('jump'));
  localStorage.setItem('vira.midi-enabled.v1', '[42]');
  localStorage.removeItem('vira.midi-bindings.v1');
  let messages: { device: number; channel: number; cc: number; value: number }[] = [];
  invoke.mockImplementation(() => Promise.resolve({ devices: [{id:42,name:'Tempo controller'}], messages: messages.splice(0) }));
  const control = vi.fn().mockResolvedValue(undefined);
  const props = { running: true, loading: false, error: null, load: vi.fn(), control };
  const deck = { ...state, grid: { bpm: 120, downbeat_seconds: 0, reviewed: true }, target_bpm: 120 };
  const ui = (value: DeckState, otherPlaying = true) => <MidiProvider><Deck {...props} state={value} otherPlaying={otherPlaying} /><MidiToggle /><MidiEditor /></MidiProvider>;
  const view = render(ui(deck));
  fireEvent.click(screen.getByRole('button', { name: 'MIDI map' }));
  fireEvent.click(screen.getByLabelText('Tempo bias deck A'));
  messages.push({device:42,channel:1,cc:7,value:64});
  await waitFor(() => expect(JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!)[0]).toMatchObject({ target:'deck:0:tempo_bias', min:-8, max:8 }));
  fireEvent.click(screen.getByRole('button', { name: 'MIDI map' }));
  for (const [raw, bpm] of [[0,110.4], [64,120], [127,129.6]]) {
    messages.push({device:42,channel:1,cc:7,value:raw});
    await waitFor(() => expect(control.mock.calls.at(-1)?.[2]).toBeCloseTo(bpm));
    expect(control.mock.calls.at(-1)?.slice(0, 2)).toEqual([0, 'tempo_smooth']);
  }
  view.rerender(ui({...deck,generation:2,grid:{...deck.grid,bpm:100}}));
  messages.push({device:42,channel:1,cc:7,value:127});
  await waitFor(() => expect(control.mock.calls.at(-1)?.[2]).toBeCloseTo(108));
  view.rerender(ui({...deck,synced:true}));
  control.mockClear();
  messages.push({device:42,channel:1,cc:7,value:0});
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
  expect(control).not.toHaveBeenCalled();
  view.rerender(ui({...deck,synced:true,playing:true}, false));
  messages.push({device:42,channel:1,cc:7,value:127});
  await waitFor(() => {
    expect(control.mock.calls.at(-1)?.slice(0, 2)).toEqual([0, 'master_tempo']);
    expect(control.mock.calls.at(-1)?.[2]).toBeCloseTo(129.6);
  });
  localStorage.removeItem('vira.midi-enabled.v1');
  localStorage.removeItem('vira.midi-bindings.v1');
  localStorage.removeItem('vira.midi-behavior.v1');
});

test.each(['analysed', 'needs_review', 'stale'])('no BPM hides approval for %s tracks and allows references', analysisState => {
  render(<Deck state={{ ...state, grid: null }} running loading={false} error={null} load={vi.fn()} control={vi.fn()} analysisState={analysisState} approveAnalysis={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Timing controls deck A' }));
  expect(screen.queryByRole('button', { name: 'Approve grid deck A' })).toBeNull();
  expect((screen.getByRole('button', { name: 'Set reference beat' }) as HTMLButtonElement).disabled).toBe(false);
});

test('two reference beats create timing without a detected or manual BPM', async () => {
  let native: AudioState = { running: true, error: null, telemetry: {}, decks: [{ ...state, grid: null }, { ...state, deck: 1, track: null }] };
  invoke.mockImplementation((command: string, args?: { grid?: { bpm: number; downbeat_seconds: number; reviewed: boolean }; referenceBeats?: number[] }) => {
    if (command === 'get_audio_state') return Promise.resolve(native);
    if (command === 'track_timing') return Promise.resolve({ grid: args?.grid ?? null, suggestion: null, state: 'unprepared', reference_beats: args?.referenceBeats ?? [] });
    if (command === 'apply_timing') native = { ...native, decks: native.decks.map(d => d.deck === 0 ? { ...d, grid: args!.grid } : d) };
    if (command === 'timing_waveform') return Promise.resolve(state.track);
    return Promise.resolve();
  });
  function Harness() {
    const decks = useDecks();
    return <><output data-testid="refs">{JSON.stringify(decks.audio.decks[0].reference_beats ?? [])}</output><button onClick={() => void decks.control(0, 'reference_beat', 10)}>First</button><button onClick={() => void decks.control(0, 'reference_beat', 12)}>Second</button></>;
  }
  render(<Harness />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('timing_waveform', { deck: 0, generation: 1 }));
  fireEvent.click(screen.getByText('First'));
  await waitFor(() => expect(screen.getByTestId('refs').textContent).toBe('[10]'));
  expect(invoke.mock.calls.filter(([command]) => command === 'apply_timing')).toHaveLength(0);
  fireEvent.click(screen.getByText('Second'));
  const grid = { bpm: 120, downbeat_seconds: 10, reviewed: false };
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 0, generation: 1, grid }));
  expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid, referenceBeats: [10, 12] });
  await waitFor(() => expect(screen.getByTestId('refs').textContent).toBe('[10,12]'));
});
