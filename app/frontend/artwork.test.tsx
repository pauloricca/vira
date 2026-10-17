// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { TrackArtwork } from './artwork';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(cleanup);

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
