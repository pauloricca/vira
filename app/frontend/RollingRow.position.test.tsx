// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { RollingRow } from './RollingRow';
import type { DeckState } from './Decks';
import type { DeckPosition } from './positionFeed';

const { subscribe, draw } = vi.hoisted(() => ({ subscribe: vi.fn(), draw: vi.fn() }));
vi.mock('./positionFeed', () => ({ subscribePositions: subscribe }));
vi.mock('./waveform', async importOriginal => ({
  ...await importOriginal<typeof import('./waveform')>(),
  WaveTiles: class { draw = draw; },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue({}) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); subscribe.mockReset(); draw.mockReset(); });

test('stopped jogs draw at feed cadence without React commits and ignore stale state and other generations', () => {
  const context = new Proxy({}, { get: () => vi.fn(), set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 100 } as DOMRect);
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  let receive!: (positions: DeckPosition[], received: number, sampled: number) => void;
  const stop = vi.fn();
  subscribe.mockImplementation(callback => { receive = callback; return stop; });
  const state: DeckState = {
    deck: 0, generation: 1, requested_generation: 1, position_epoch: 0, playing: false,
    loading: false, error: null, gain: 1, position_seconds: 10, received_at: 0, sampled_at: 0,
    track: { track_id: 'a', artifact_id: 'a', title: 'Test', artist: '', filename: '',
      duration_seconds: 100, frames: 4800000, peak_frames: 480, peaks: [] },
  };
  const commits = vi.fn();
  const row = (deck: DeckState) => <Profiler id="rolling" onRender={commits}><RollingRow state={deck} running window={4} /></Profiler>;
  const { rerender, unmount } = render(row(state));
  const mounted = commits.mock.calls.length;
  draw.mockClear();
  for (let frame = 1; frame <= 60; frame++) {
    now = frame * 1000 / 60;
    act(() => receive([0, 1].map(() => ({ generation: 1, playing: false, position_epoch: frame,
      position_seconds: 10 + frame / 60 })), now, now));
  }
  expect(draw).toHaveBeenCalledTimes(60);
  expect(draw.mock.calls.at(-1)![2]).toBe(9); // 11 seconds, centred in a 4-second window.
  expect(commits).toHaveBeenCalledTimes(mounted);
  rerender(row({ ...state, position_seconds: 10.5, received_at: 1000, sampled_at: 500 }));
  expect(draw.mock.calls.at(-1)![2]).toBe(9);
  act(() => receive([0, 1].map(() => ({ generation: 2, playing: false, position_seconds: 50 })), 1017, 1017));
  expect(draw.mock.calls.at(-1)![2]).toBe(9);
  unmount();
  expect(stop).toHaveBeenCalledOnce();
});
