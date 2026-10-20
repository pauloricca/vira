import { invoke } from '@tauri-apps/api/core';
import type { PositionSnapshot } from './transport';

export type DeckPosition = Omit<PositionSnapshot, 'duration' | 'start_seconds'>;
type Listener = (positions: DeckPosition[], received: number, sampled: number) => void;
const listeners = new Set<Listener>();
const period = 1000 / 60;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;
const isHidden = () => document.visibilityState === 'hidden';

// Both rolling rows share one small IPC request. Keep track metadata and React
// state on the slower feed; never overlap requests or poll a hidden window.
async function poll() {
  timer = undefined;
  if (pending || !listeners.size || isHidden()) return;
  pending = true;
  const sent = performance.now();
  try {
    const positions = await invoke<DeckPosition[]>('get_deck_positions');
    const received = performance.now();
    if (!isHidden() && Array.isArray(positions) && positions.length === 2) {
      for (const listener of listeners) listener(positions, received, (sent + received) / 2);
    }
  } catch { /* The display clock freezes safely if telemetry stops. */ }
  finally {
    pending = false;
    if (listeners.size && !isHidden()) {
      timer = setTimeout(() => void poll(), Math.max(0, period - (performance.now() - sent)));
    }
  }
}
function start() {
  if (!pending && timer === undefined) void poll();
}
export function subscribePositions(listener: Listener) {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { clearTimeout(timer); timer = undefined; }
  };
}
document.addEventListener('visibilitychange', () => {
  if (isHidden()) { clearTimeout(timer); timer = undefined; }
  else if (listeners.size) start();
});
