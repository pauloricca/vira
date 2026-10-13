import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

// Displacement controls velocity, so holding still away from the origin keeps adjusting.
export function tempoDragRate(x: number, y: number) {
  const distance = x - y;
  return Math.sign(distance) * Math.pow(Math.max(0, Math.abs(distance) - 4) / 40, 1.5);
}

export function useTempoDrag(value: number, min: number, max: number, disabled: boolean, change: (value: number) => Promise<void>, identity?: unknown) {
  const latest = useRef({ value, min, max, disabled, change });
  latest.current = { value, min, max, disabled, change };
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => { if (disabled) stop.current?.(); }, [disabled]);
  useEffect(() => () => stop.current?.(), [identity]);
  return (event: ReactPointerEvent<HTMLElement>) => {
    if (latest.current.disabled || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    stop.current?.();
    const originX = event.clientX, originY = event.clientY, pointer = event.pointerId;
    const element = event.currentTarget;
    element.setPointerCapture?.(pointer);
    let rate = 0, target = latest.current.value, last = performance.now(), pending = false;
    const move = (e: PointerEvent) => {
      if (e.pointerId === pointer) rate = tempoDragRate(e.clientX - originX, e.clientY - originY);
    };
    const end = (e: PointerEvent) => { if (e.pointerId === pointer) stop.current?.(); };
    const timer = window.setInterval(() => {
      const now = performance.now(), seconds = Math.min((now - last) / 1000, .1);
      last = now;
      if (latest.current.disabled) { stop.current?.(); return; }
      if (pending || rate === 0) return;
      const next = Math.max(latest.current.min, Math.min(latest.current.max, target + rate * seconds));
      if (next === target) return;
      target = next;
      pending = true;
      void latest.current.change(target).finally(() => { pending = false; });
    }, 50);
    const cancel = () => {
      window.clearInterval(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', cancel);
      element.removeEventListener('lostpointercapture', end);
      stop.current = null;
      if (element.hasPointerCapture?.(pointer)) element.releasePointerCapture(pointer);
    };
    stop.current = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', cancel);
    element.addEventListener('lostpointercapture', end);
  };
}
