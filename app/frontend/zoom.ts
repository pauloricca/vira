import { useEffect, useRef } from 'react';

export const waveformZoomIntervals = [4, 8, 16, 32];

/** Native WebKit gestures and Chromium trackpad pinches share the same snapped zoom. */
export function useWaveformZoom(beats: number, onChange?: (beats: number) => void) {
  const element = useRef<HTMLElement>(null);
  const latest = useRef({ beats, onChange });
  latest.current = { beats, onChange };
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    let accumulated = 0, lastWheel = -Infinity, scale = 1, nativeGesture = false;
    function advance(amount: number) {
      if (!Number.isFinite(amount)) return;
      accumulated += amount;
      const steps = Math.trunc(accumulated / 100);
      if (!steps) return;
      accumulated -= steps * 100;
      const index = waveformZoomIntervals.indexOf(latest.current.beats);
      const next = waveformZoomIntervals[Math.max(0, Math.min(waveformZoomIntervals.length - 1, index + steps))];
      if (next !== latest.current.beats) {
        latest.current.onChange?.(next);
        latest.current.beats = next;
      }
    }
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey || !latest.current.onChange) return;
      event.preventDefault();
      if (nativeGesture) return;
      const now = performance.now();
      if (now - lastWheel > 180) accumulated = 0;
      lastWheel = now;
      advance(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target!.clientHeight : 1));
    }
    function start(event: Event) {
      if (!latest.current.onChange) return;
      event.preventDefault();
      nativeGesture = true; accumulated = 0; scale = 1;
    }
    function change(event: Event) {
      if (!nativeGesture) return;
      event.preventDefault();
      const nextScale = (event as Event & { scale: number }).scale;
      if (!Number.isFinite(nextScale) || nextScale <= 0) return;
      advance(-Math.log2(nextScale / scale) * 240);
      scale = nextScale;
    }
    function end(event: Event) {
      if (!nativeGesture) return;
      event.preventDefault();
      nativeGesture = false; accumulated = 0; lastWheel = -Infinity;
    }
    target.addEventListener('wheel', wheel, { passive: false });
    target.addEventListener('gesturestart', start, { passive: false });
    target.addEventListener('gesturechange', change, { passive: false });
    target.addEventListener('gestureend', end, { passive: false });
    return () => {
      target.removeEventListener('wheel', wheel);
      target.removeEventListener('gesturestart', start);
      target.removeEventListener('gesturechange', change);
      target.removeEventListener('gestureend', end);
    };
  }, []);
  return element;
}
