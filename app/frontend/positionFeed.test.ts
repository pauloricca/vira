// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { subscribePositions } from './positionFeed';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const positions = [0, 1].map(generation => ({ generation, position_epoch: 0, position_seconds: 1, playing: false }));
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach(stop => stop());
  vi.restoreAllMocks();
  vi.useRealTimers();
  invoke.mockReset();
});

test('two waveforms share display-cadence feedback, including stopped movement', async () => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  invoke.mockImplementation(() => Promise.resolve(positions.map(p => ({ ...p, position_seconds: Date.now() / 1000 }))));
  const a = vi.fn(), b = vi.fn();
  stops.push(subscribePositions(a), subscribePositions(b));
  await vi.advanceTimersByTimeAsync(1000);
  expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(58);
  expect(invoke.mock.calls.length).toBeLessThanOrEqual(65);
  expect(a.mock.calls.length).toBe(invoke.mock.calls.length);
  expect(b.mock.calls.length).toBe(a.mock.calls.length);
  expect(a.mock.calls.at(-1)![0][0].position_seconds).toBeGreaterThan(a.mock.calls[0][0][0].position_seconds);
  expect(invoke.mock.calls.every(([command]) => command === 'get_deck_positions')).toBe(true);
  stops.splice(0).forEach(stop => stop());
  const count = invoke.mock.calls.length;
  await vi.advanceTimersByTimeAsync(100);
  expect(invoke).toHaveBeenCalledTimes(count);
});

test('slow requests do not overlap and an unsubscribed row receives no late response', async () => {
  vi.useFakeTimers();
  let resolve!: (value: typeof positions) => void;
  invoke.mockImplementation(() => new Promise(done => { resolve = done; }));
  const receive = vi.fn();
  const stop = subscribePositions(receive); stops.push(stop);
  await vi.advanceTimersByTimeAsync(200);
  expect(invoke).toHaveBeenCalledTimes(1);
  stop();
  resolve(positions);
  await vi.advanceTimersByTimeAsync(100);
  expect(receive).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledTimes(1);
});

test('hidden windows suspend feedback and resume on visibility; errors recover', async () => {
  vi.useFakeTimers();
  let visibility: DocumentVisibilityState = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  invoke.mockRejectedValueOnce(new Error('temporarily unavailable')).mockResolvedValue(positions);
  const receive = vi.fn();
  stops.push(subscribePositions(receive));
  await vi.advanceTimersByTimeAsync(40);
  expect(receive).toHaveBeenCalled();
  visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
  const count = invoke.mock.calls.length;
  await vi.advanceTimersByTimeAsync(200);
  expect(invoke).toHaveBeenCalledTimes(count);
  visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(20);
  expect(invoke.mock.calls.length).toBeGreaterThan(count);
});
