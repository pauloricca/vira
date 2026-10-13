// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { RollingRow } from './RollingRow';
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
  fireEvent.keyDown(wave, { key: 'Home' });
  fireEvent.keyDown(wave, { key: 'ArrowRight' });
  expect(control.mock.calls).toEqual([[0, 'play'], [0, 'stop'], [0, 'gain', .4], [0, 'seek', 0], [0, 'seek', 5]]);
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

test('half and double presets use the precise source BPM within the expanded limits',()=>{
  const control=vi.fn().mockResolvedValue(undefined);
  render(<Deck state={{...state,grid:{bpm:118.999072,downbeat_seconds:0,reviewed:false}}} running loading={false} error={null} load={vi.fn()} control={control} />);
  fireEvent.click(screen.getByText('Half speed')); fireEvent.click(screen.getByText('Double speed'));
  expect(control.mock.calls).toEqual([[0,'tempo',118.999072*.5],[0,'tempo',118.999072*2]]);
  expect(screen.getByRole('spinbutton',{name:'Target BPM'}).getAttribute('min')).toBe(String(118.999072*.5));
  expect(screen.getByRole('spinbutton',{name:'Target BPM'}).getAttribute('max')).toBe(String(118.999072*2));
});
test('click is enabled only while Timing & tempo is open without changing its volume', async () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const { unmount } = render(<Deck state={{ ...state, click_gain: .6, grid: { bpm: 120, downbeat_seconds: 0, reviewed: true } }} running loading={false} error={null} load={vi.fn()} control={control} />);
  const panel = screen.getByText(/Timing & tempo/).closest('summary')!;
  fireEvent.click(panel);
  await waitFor(() => expect(control).toHaveBeenCalledWith(0, 'click_panel', 1));
  fireEvent.click(panel);
  await waitFor(() => expect(control).toHaveBeenCalledWith(0, 'click_panel', 0));
  expect((screen.getByRole('slider', { name: /Click volume/ }) as HTMLInputElement).value).toBe('0.6');
  fireEvent.click(panel);
  await waitFor(() => expect(control.mock.calls.at(-1)).toEqual([0, 'click_panel', 1]));
  unmount();
  expect(control.mock.calls.at(-1)).toEqual([0, 'click_panel', 0]);
});
test('reference button uses the playhead and removes the clear deck button', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  render(<Deck state={{ ...state, position_seconds: 23.75, grid: { bpm: 120, downbeat_seconds: 0, reviewed: false } }} running loading={false} error={null} load={vi.fn()} control={control} />);
  expect(screen.queryByRole('button', { name: 'Clear deck A' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Set reference beat' }));
  expect(control).toHaveBeenCalledWith(0, 'reference_beat', 23.75);
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
  fireEvent.click(screen.getByText('Second flag'));
  await waitFor(() => expect(screen.getByTestId('references').textContent).toBe('[10,18]'));
  expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid: expect.objectContaining({ bpm: 120, downbeat_seconds: 0 }), referenceBeats: [10, 18] });
  fireEvent.click(screen.getByText('Third flag'));
  await waitFor(() => expect(screen.getByTestId('references').textContent).toBe('[18,26]'));
  expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid: expect.any(Object), referenceBeats: [18, 26] });
});
test('bar start buttons save and apply adjacent downbeats while retaining reference flags', async () => {
  const grid = { bpm: 120, downbeat_seconds: 0, reviewed: true };
  const loaded = { ...state, grid };
  invoke.mockImplementation((command: string, args?: { grid?: typeof grid | null; referenceBeats?: number[] }) => {
    if (command === 'get_audio_state') return Promise.resolve({ running: true, error: null, telemetry: {}, decks: [loaded, { ...state, deck: 1, track: null }] });
    if (command === 'track_timing') return Promise.resolve({ grid: args?.grid ?? grid, reference_beats: args?.referenceBeats ?? [10] });
    if (command === 'timing_waveform') return Promise.resolve(state.track);
    return Promise.resolve();
  });
  function Harness() {
    const decks = useDecks();
    return <Deck state={decks.audio.decks[0]} running={decks.audio.running} loading={false} error={null} load={decks.load} control={decks.control} />;
  }
  render(<Harness />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Shift bar start forward one beat on deck A' }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Shift bar start forward one beat on deck A' })));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 0, generation: 1, grid: { bpm: 120, downbeat_seconds: .5, reviewed: false } }));
  expect(invoke).toHaveBeenCalledWith('track_timing', { trackId: state.track!.track_id, grid: { bpm: 120, downbeat_seconds: .5, reviewed: false }, referenceBeats: [10] });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Shift bar start back one beat on deck A' })));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('apply_timing', { deck: 0, generation: 1, grid: { bpm: 120, downbeat_seconds: 0, reviewed: false } }));
});

test('rolling waveform double click marks the clicked source position only while timing is open', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const withGrid = { ...state, position_seconds: 50, speed: 2, grid: { bpm: 120, downbeat_seconds: 0, reviewed: false } };
  const { rerender } = render(<RollingRow state={withGrid} running window={10} control={control} />);
  const wave = screen.getByRole('img', { name: 'Rolling waveform deck A' });
  vi.spyOn(wave, 'getBoundingClientRect').mockReturnValue({ left: 10, width: 100 } as DOMRect);
  fireEvent.doubleClick(wave, { clientX: 85 });
  expect(control).not.toHaveBeenCalled();
  rerender(<RollingRow state={withGrid} running window={10} control={control} timingOpen />);
  fireEvent.doubleClick(wave, { clientX: 85 });
  expect(control).toHaveBeenCalledWith(0, 'reference_beat', 55);
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
  expect(screen.getByLabelText('Stereo master meters unavailable')).toBeTruthy();
  expect((screen.getByRole('slider', { name: 'Crossfader coming later' }) as HTMLInputElement).disabled).toBe(true);
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
  expect(dial.getAttribute('aria-valuenow')).toBe('73');
  fireEvent.doubleClick(dial);
  expect(dial.getAttribute('aria-valuenow')).toBe('50');
  expect(control.mock.calls).toEqual([[0, 'eq_high', .75], [0, 'eq_high', .73], [0, 'eq_high', .5]]);
  fireEvent.keyDown(dial, { key: 'Home' });
  expect(dial.getAttribute('aria-valuetext')).toBe('−∞ dB (kill)');
  fireEvent.keyDown(dial, { key: 'End' });
  expect(dial.getAttribute('aria-valuetext')).toBe('6.0 dB');
});

test('gain trim is independent of volume and bipolar filter sends both polarities', () => {
  const control = vi.fn().mockResolvedValue(undefined);
  render(<Mixer audio={{ running: true, error: null, telemetry: {}, decks: [state, { ...state, deck: 1 }] }} control={control} />);
  fireEvent.keyDown(screen.getByRole('slider', {name: 'Gain deck B'}), {key:'End'});
  const filter = screen.getByRole('slider', {name:'Filter deck B'});
  fireEvent.keyDown(filter, {key:'Home'});
  expect(filter.getAttribute('aria-valuetext')).toBe('Low-pass 100%');
  fireEvent.keyDown(filter, {key:'End'});
  expect(filter.getAttribute('aria-valuetext')).toBe('High-pass 100%');
  fireEvent.doubleClick(filter);
  expect(control.mock.calls).toEqual([[1,'trim',12],[1,'filter',-1],[1,'filter',1],[1,'filter',0]]);
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
      expect(control.mock.calls).toEqual([[0,'seek',25]]);
      await act(async () => {fireEvent.pointerMove(wave, {clientX:70}); fireEvent.pointerUp(wave);});
      expect(control.mock.calls).toEqual([[0,'seek',25]]);
      return;
    }
    expect(control).toHaveBeenCalledWith(0,'seek',25);
    await act(async () => {fireEvent.pointerMove(wave, {clientX:70});});
    await act(async () => {fireEvent.pointerUp(wave, {clientX:80}); await vi.advanceTimersByTimeAsync(80);});
    expect(control.mock.calls.at(-1)).toEqual([0,'seek',70]);
    expect(control.mock.calls.every(call => call[1] === 'seek')).toBe(true);
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
    expect(control.mock.calls).toEqual([[0,'seek',55]]);
    await act(async()=>{fireEvent.pointerMove(wave,{clientX:20});fireEvent.pointerUp(wave);});
    expect(control.mock.calls).toEqual([[0,'seek',55]]);
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
    expect(control.mock.calls).toEqual([[0,'scrub_start',50],[0,'scrub',45],[0,'scrub',55],[0,'scrub_pause',55]]);
  } finally {cleanup();vi.useRealTimers();vi.unstubAllGlobals();}
});
