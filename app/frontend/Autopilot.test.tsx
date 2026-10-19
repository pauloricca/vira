// @vitest-environment jsdom
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { chooseAutopilotTrack, chooseNextInList, defaultAutopilotWeights, useAutopilot } from './Autopilot';
import type { Track } from './App';
import type { AudioState } from './Decks';

afterEach(() => { cleanup(); localStorage.clear(); });
function track(id: string, bpm = 120, key = 'C major'): Track {
  return { id, title: id, artist: '', filename: id, status: 'ready', error: null, size_bytes: 0, modified_ns: '', source_hash: null, duration_seconds: 180,
    analysis: { state: 'analysed', error: null, result: { grid: { bpm, offset_seconds: 0, residual_p95_ms: 0, end_minus_start_residual_ms: 0, tempo_spread_percent: 0, thirds_bpm: [] }, keys: [{ key, correlation: 1 }], beats_seconds: [], window_keys: [], flags: [] } } };
}
const source = track('source');
const tempo = track('tempo', 121, 'F# major');
const tagged = track('tagged', 135, 'F# major');
const harmonic = track('harmonic', 135, 'G major');
const tags = [{ name: 'shared', tracks: ['source', 'tagged'] }];

test('list order follows the current track, wraps, and skips played or unreadable tracks', () => {
  const tracks = [tagged, source, { ...harmonic, status: 'unreadable' as const }, tempo];
  expect(chooseNextInList(tracks, source, new Set())).toBe(tempo);
  expect(chooseNextInList(tracks, tempo, new Set(['source']))).toBe(tagged);
  expect(chooseNextInList(tracks, undefined, new Set())).toBe(tagged);
  expect(chooseNextInList(tracks, track('outside'), new Set(['tagged']))).toBe(source);
  expect(chooseNextInList(tracks, source, new Set(['tempo', 'tagged']))).toBeUndefined();
});

test('selection defaults to automatic and persists list order', () => {
  const hook = setup(audio([null, null], [false, false]));
  expect(hook.result.current.selection).toBe('automatic');
  act(() => hook.result.current.changeSelection('list'));
  expect(localStorage.getItem('vira.autopilot-selection')).toBe('list');
  hook.unmount();
  const restored = setup(audio([null, null], [false, false]));
  expect(restored.result.current.selection).toBe('list');
});

test.each(['automatic', 'list'])('%s selection honours a manual queue including played tracks', async selection => {
  localStorage.setItem('vira.autopilot-selection', selection);
  const hook = setup(audio(['tempo', null], [true, false]), ['source', 'tagged']);
  act(() => hook.result.current.toggle());
  await waitFor(() => expect(hook.load).toHaveBeenCalledWith(1, 'source'));
  expect(hook.result.current.next).toEqual(['source', 'tagged']);
});

test('changing selection replaces an automatic choice and preserves manual plans', async () => {
  const hook = setup(audio(['source', null], [true, false]));
  act(() => hook.result.current.toggle());
  await waitFor(() => expect(hook.load).toHaveBeenCalled());
  act(() => hook.result.current.changeSelection('list'));
  await waitFor(() => expect(hook.result.current.next).toEqual(['tempo']));
  act(() => hook.result.current.prioritize('tagged'));
  act(() => hook.result.current.changeSelection('automatic'));
  expect(hook.result.current.next).toEqual(['tagged']);
});

test('list mode seeds the first eligible track without starting transport', async () => {
  localStorage.setItem('vira.autopilot-selection', 'list');
  const hook = setup(audio([null, null], [false, false]));
  act(() => hook.result.current.toggle());
  await waitFor(() => expect(hook.load).toHaveBeenCalledWith(0, 'tempo'));
  expect(hook.control).not.toHaveBeenCalled();
});

test('weights independently prefer close BPM, shared tags and harmonic neighbours', () => {
  const candidates = [tempo, tagged, harmonic];
  for (const [weights, expected] of [
    [{ bpm: 100, tags: 0, harmonic: 0 }, tempo],
    [{ bpm: 0, tags: 100, harmonic: 0 }, tagged],
    [{ bpm: 0, tags: 0, harmonic: 100 }, harmonic],
  ] as const) expect(chooseAutopilotTrack(candidates, source, new Set(), tags, { ...defaultAutopilotWeights, ...weights })).toBe(expected);
});
test.each(['C major', 'G major', 'F major', 'A minor'])('harmonic scoring recognises %s', key => {
  const compatible = track('compatible', 135, key);
  expect(chooseAutopilotTrack([tempo, compatible], source, new Set(), [], { ...defaultAutopilotWeights, bpm: 0, tags: 0, harmonic: 100 })).toBe(compatible);
});
test('never recommends played, current or unreadable tracks; supports random seeding and exhaustion', () => {
  const candidates = [source, tempo, tagged, { ...harmonic, status: 'unreadable' as const }];
  expect(chooseAutopilotTrack(candidates, source, new Set(['tempo']), tags, defaultAutopilotWeights)).toBe(tagged);
  expect(chooseAutopilotTrack(candidates, source, new Set(['tempo', 'tagged']), tags, defaultAutopilotWeights)).toBeUndefined();
  expect(chooseAutopilotTrack([tempo, tagged], undefined, new Set(), [], defaultAutopilotWeights, 0, () => .99)).toBe(tagged);
});
function audio(ids: (string | null)[], playing: boolean[], mode: [number, number] = [0, 0]): AudioState {
  return { running: true, error: null, telemetry: {}, auto_mode: mode, decks: ids.map((id, deck) => ({
    deck, track: id ? { track_id: id, artifact_id: id, title: id, artist: '', filename: id, duration_seconds: 180, frames: 1, peak_frames: 0, peaks: [] } : null,
    grid: { bpm: 120, downbeat_seconds: 0, reviewed: true }, playing: playing[deck], loading: false, error: null, position_seconds: 0, gain: .8, generation: id ? 1 : 0, requested_generation: id ? 1 : 0,
  })) };
}
function setup(initial: AudioState, initialQueue: string[] = []) {
  const load = vi.fn().mockResolvedValue(undefined);
  const control = vi.fn().mockResolvedValue(undefined);
  const startSession = vi.fn();
  const hook = renderHook(({ state }) => {
    const [next, setNext] = useState(initialQueue);
    const pilot = useAutopilot({ audio: state, loading: [false, false], tracks: [source, tempo, tagged], allTracks: [source, tempo, tagged], tags,
      next, setNext, played: new Set(['source']), startSession, load, control });
    return { ...pilot, next };
  }, { initialProps: { state: initial } });
  return { ...hook, load, control, startSession };
}
test('seeds empty decks without starting music and starts session tracking', async () => {
  const hook = setup(audio([null, null], [false, false]));
  act(() => hook.result.current.toggle());
  await waitFor(() => expect(hook.load).toHaveBeenCalledTimes(1));
  expect(hook.startSession).toHaveBeenCalledOnce();
  expect(hook.result.current.next).toHaveLength(1);
  expect(hook.control).not.toHaveBeenCalled();
  hook.rerender({ state: audio([null, null], [false, false]) });
  expect(hook.load).toHaveBeenCalledTimes(1);
});
test('preloads a queued track, arms AUTO END after telemetry confirms it, and honours manual replacements', async () => {
  const hook = setup(audio(['source', null], [true, false]), ['tempo']);
  act(() => hook.result.current.toggle());
  await waitFor(() => expect(hook.load).toHaveBeenCalledWith(1, 'tempo'));
  expect(hook.control).not.toHaveBeenCalled();
  hook.rerender({ state: audio(['source', 'tempo'], [true, false]) });
  await waitFor(() => expect(hook.control).toHaveBeenCalledWith(0, 'auto_end'));
  hook.rerender({ state: audio(['source', 'tempo'], [true, false], [2, 0]) });
  act(() => hook.result.current.prioritize('tagged'));
  await waitFor(() => expect(hook.load).toHaveBeenCalledWith(1, 'tagged'));
  expect(hook.result.current.next[0]).toBe('tagged');
  await act(() => hook.result.current.control(0, 'auto_end'));
  expect(hook.result.current.enabled).toBe(false);
});
test('AUTO NOW replaces AUTO END and keeps Autopilot running through the handoff', async () => {
  const hook = setup(audio(['source', 'tempo'], [true, false], [2, 0]), ['tempo']);
  act(() => hook.result.current.toggle());
  await act(() => hook.result.current.control(0, 'auto_now'));
  expect(hook.result.current.enabled).toBe(true);
  expect(hook.control).toHaveBeenCalledExactlyOnceWith(0, 'auto_now', undefined);
  hook.rerender({ state: audio(['source', 'tempo'], [true, false], [1, 0]) });
  expect(hook.control).toHaveBeenCalledTimes(1);
  hook.rerender({ state: audio(['source', 'tempo'], [true, true], [1, 0]) });
  expect(hook.load).not.toHaveBeenCalled();
  hook.rerender({ state: audio(['source', 'tempo'], [false, true]) });
  await waitFor(() => expect(hook.load).toHaveBeenCalledWith(0, 'tagged'));
  hook.rerender({ state: audio(['tagged', 'tempo'], [false, true]) });
  await waitFor(() => expect(hook.control).toHaveBeenCalledWith(1, 'auto_end'));
  expect(hook.result.current.enabled).toBe(true);
});
test('cancelling AUTO NOW disables Autopilot', async () => {
  const hook = setup(audio(['source', 'tempo'], [true, false], [1, 0]), ['tempo']);
  act(() => hook.result.current.toggle());
  await act(() => hook.result.current.control(0, 'auto_now'));
  expect(hook.result.current.enabled).toBe(false);
});
test('waits during a transition and replenishes on the deck that stopped', async () => {
  const hook = setup(audio(['source', 'tempo'], [true, true]));
  act(() => hook.result.current.toggle());
  expect(hook.load).not.toHaveBeenCalled();
  hook.rerender({ state: audio(['source', 'tempo'], [false, true]) });
  await waitFor(() => expect(hook.load).toHaveBeenCalledWith(0, 'tagged'));
});
test('manual selection replaces the automatic recommendation', async () => {
  const hook = setup(audio(['source', null], [true, false]));
  act(() => hook.result.current.toggle());
  await waitFor(() => expect(hook.result.current.next).toHaveLength(1));
  const original = hook.result.current.next[0];
  const replacement = original === 'tempo' ? 'tagged' : 'tempo';
  act(() => hook.result.current.prioritize(replacement));
  expect(hook.result.current.next).toEqual([replacement]);
});

const directionOnly = { bpm: 0, tags: 0, harmonic: 0, direction: 100, randomness: 0 };
test.each([-1, 1])('BPM direction favours continuing a %i movement independently of its size', direction => {
  const down = track('down', 119);
  const up = track('up', 121);
  expect(chooseAutopilotTrack([down, up], source, new Set(), [], directionOnly, 0, () => 0, direction))
    .toBe(direction === 1 ? up : down);
  // Unknown direction and equal BPM contribute no directional preference.
  expect(chooseAutopilotTrack([down, up], source, new Set(), [], directionOnly, 0, () => 0, 0)).toBe(down);
  expect(chooseAutopilotTrack([track('same'), up], source, new Set(), [], directionOnly, 0, () => 0, 1)).toBe(up);
});
test('randomness can outweigh a stronger musical match and zero disables its contribution', () => {
  const exact = track('exact');
  const close = track('close', 121);
  const weights = { ...directionOnly, direction: 0, bpm: 100, randomness: 100 };
  const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(.99).mockReturnValue(0);
  expect(chooseAutopilotTrack([exact, close], source, new Set(), [], weights, 0, random)).toBe(close);
  expect(random).toHaveBeenCalledTimes(3);
  random.mockClear();
  expect(chooseAutopilotTrack([exact, close], source, new Set(), [], { ...weights, randomness: 0 }, 0, random)).toBe(exact);
  expect(random).toHaveBeenCalledTimes(1); // Only the existing tie selection uses RNG.
  expect(chooseAutopilotTrack([exact, close], source, new Set(['close']), [], weights, 0, () => .99)).toBe(exact);
});
test.each([110, 130, 120])('direction uses the completed handoff from %i BPM, observed while Autopilot is off', async previousBpm => {
  localStorage.setItem('vira.autopilot-weights', JSON.stringify(directionOnly));
  const prior = track('prior', previousBpm);
  const down = track('down', 119);
  const up = track('up', 121);
  const load = vi.fn().mockResolvedValue(undefined);
  const control = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(({ state }) => {
    const [next, setNext] = useState<string[]>([]);
    const pilot = useAutopilot({ audio: state, loading: [false, false], tracks: [down, up], allTracks: [prior, source, down, up], tags: [],
      next, setNext, played: new Set(['prior', 'source']), startSession: vi.fn(), load, control });
    return { ...pilot, next };
  }, { initialProps: { state: audio(['prior', null], [true, false]) } });
  hook.rerender({ state: audio(['prior', 'source'], [true, true]) });
  expect(load).not.toHaveBeenCalled();
  hook.rerender({ state: audio(['prior', 'source'], [false, true]) });
  // At equal BPM there is no direction bonus, so either candidate can win.
  act(() => hook.result.current.toggle());
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  if (previousBpm !== 120) expect(load).toHaveBeenCalledWith(0, previousBpm < 120 ? 'up' : 'down');
  else expect(['down', 'up']).toContain(hook.result.current.next[0]);
});
test('existing saved weights keep their values and get defaults for the new factors', () => {
  localStorage.setItem('vira.autopilot-weights', JSON.stringify({ bpm: 20, tags: 40, harmonic: 60 }));
  const hook = setup(audio([null, null], [false, false]));
  expect(hook.result.current.weights).toEqual({ bpm: 20, tags: 40, harmonic: 60, direction: 50, randomness: 0 });
});
