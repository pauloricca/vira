// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { TrackArtwork } from './artwork';
import { beginDeckLoad } from './loadPriority';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); invoke.mockReset(); });

test('requests artwork only near the viewport and waits for every deck load', async () => {
  let intersect: IntersectionObserverCallback;
  const observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  invoke.mockResolvedValue(null);
  render(<TrackArtwork trackId="lazy-priority" className="cover" />);
  expect(observe).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
  const finishA = beginDeckLoad(), finishB = beginDeckLoad();
  await act(async () => { intersect!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => finishA());
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => finishB());
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(disconnect).toHaveBeenCalled();
});

test('bounds concurrent cover requests and drains the queue after failures', async () => {
  let active = 0, peak = 0;
  const finish: (() => void)[] = [];
  invoke.mockImplementation(() => new Promise((_resolve, reject) => {
    active++; peak = Math.max(peak, active);
    finish.push(() => { active--; reject(new Error('unavailable')); });
  }));
  render(<>{Array.from({ length: 20 }, (_, i) => <TrackArtwork key={i} trackId={`bounded-${i}`} className="cover" />)}</>);
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(4));
  for (let batch = 0; batch < 5; batch++) {
    finish.splice(0).forEach(done => done());
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(Math.min(20, (batch + 2) * 4)));
  }
  expect(peak).toBe(4);
  expect(active).toBe(0);
});
