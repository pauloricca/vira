// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  expect(screen.getByLabelText('Stereo master meters unavailable')).toBeTruthy();
  expect((screen.getByRole('slider', { name: 'Crossfader coming later' }) as HTMLInputElement).disabled).toBe(true);
});

test('preview dials turn in either direction and double-click resets without audio commands', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const control = vi.fn().mockResolvedValue(undefined);
  render(<Mixer audio={{ running: true, error: null, telemetry: {}, decks: [state, { ...state, deck: 1 }] }} control={control} />);
  const dial = screen.getByRole('slider', { name: 'High EQ deck A preview' });
  fireEvent.pointerDown(dial, { pointerId: 1, clientY: 100 });
  fireEvent.pointerMove(dial, { pointerId: 1, clientY: 65 });
  expect(dial.getAttribute('aria-valuenow')).toBe('75');
  fireEvent.pointerUp(dial, { pointerId: 1 });
  fireEvent.keyDown(dial, { key: 'ArrowDown' });
  expect(dial.getAttribute('aria-valuenow')).toBe('73');
  fireEvent.doubleClick(dial);
  expect(dial.getAttribute('aria-valuenow')).toBe('50');
  expect(control).not.toHaveBeenCalled();
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
