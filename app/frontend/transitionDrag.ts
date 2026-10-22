import { useEffect, useRef, type PointerEvent, type MouseEvent } from 'react';
import type { DeckState } from './Decks';
import type { TransitionPlan } from './TransitionGuides';

type Kind = 'auto_start' | 'auto_swap' | 'auto_finish' | 'auto_move';
type Handlers = { onPointerDown: (event: PointerEvent<Element>) => void; onPointerMove: (event: PointerEvent<Element>) => void; onPointerUp: (event: PointerEvent<Element>) => void; onPointerCancel: (event: PointerEvent<Element>) => void; onLostPointerCapture: (event: PointerEvent<Element>) => void };
export function transitionHit(plan: TransitionPlan | null | undefined, deck: number, seconds: number, tolerance: number): Kind | null {
  if (!plan || plan.started) return null;
  const points = plan.points[deck];
  const candidates: [Kind, number][] = [['auto_start', points[0]], ['auto_finish', points[4]]];
  if (plan.style !== 'crossfade') candidates.push(['auto_swap', points[3]]);
  candidates.sort((a, b) => Math.abs(a[1] - seconds) - Math.abs(b[1] - seconds));
  if (Math.abs(candidates[0][1] - seconds) <= tolerance) return candidates[0][0];
  return seconds > points[0] && seconds < points[4] ? 'auto_move' : null;
}
/** Intercept transition edits before the normal waveform seek/scrub gesture. */
export function useTransitionDrag(state: DeckState, running: boolean, plan: TransitionPlan | null | undefined,
  control: ((deck: number, action: string, value?: number) => Promise<void>) | undefined,
  secondsAt: (element: Element, clientX: number) => number, span: number, fallback: Handlers, beatsPerStep = 16): Handlers & { onPointerDownCapture: (event: PointerEvent<Element>) => void; onClickCapture: (event: MouseEvent<Element>) => void } {
  const drag = useRef<{ pointer: number; x: number; scale: number; origin: number; step: number; kind: Kind; last: number; moved: boolean } | null>(null);
  const consumed = useRef(false);
  const pending = useRef<{ kind: Kind; seconds: number } | null>(null);
  const busy = useRef(false);
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; drag.current = null; pending.current = null; }, [state.generation, running, plan?.started, plan?.from]);
  async function flush() {
    if (busy.current || !control) return;
    busy.current = true;
    const version = epoch.current;
    try {
      while (pending.current && epoch.current === version) {
        const next = pending.current; pending.current = null;
        await control(state.deck, next.kind, next.seconds);
      }
    } finally { busy.current = false; if (pending.current) void flush(); }
  }
  function hit(event: PointerEvent<Element>) {
    if (!running || !control || !state.track || !state.grid || state.loading || state.loop_out_seconds != null) return null;
    return transitionHit(plan, state.deck, secondsAt(event.currentTarget, event.clientX), 8 * span / Math.max(1, event.currentTarget.getBoundingClientRect().width));
  }
  function move(event: PointerEvent<Element>) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    if (!active.moved && Math.abs(event.clientX - active.x) < 4) return;
    active.moved = true;
    const steps = Math.round((event.clientX - active.x) * active.scale / active.step);
    if (steps === active.last) return;
    active.last = steps;
    pending.current = { kind: active.kind, seconds: active.origin + steps * active.step };
    void flush();
  }
  function finish(event: PointerEvent<Element>, cancelled = false) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return false;
    if (!cancelled) move(event);
    drag.current = null;
    if (!cancelled && !active.moved) {
      fallback.onPointerDown(event);
      fallback.onPointerUp(event);
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    return true;
  }
  return {
    onPointerDownCapture(event) {
      if (drag.current) { event.stopPropagation(); return; }
      consumed.current = false;
      const kind = event.button === 0 ? hit(event) : null;
      if (!kind || !plan || !state.grid) return;
      consumed.current = true;
      event.preventDefault(); event.stopPropagation();
      const index = kind === 'auto_swap' ? 3 : kind === 'auto_finish' ? 4 : 0;
      drag.current = { pointer: event.pointerId, x: event.clientX, scale: span / Math.max(1, event.currentTarget.getBoundingClientRect().width), origin: plan.points[state.deck][index], step: beatsPerStep * 60 / state.grid.bpm, kind, last: 0, moved: false };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerDown(event) { fallback.onPointerDown(event); },
    onClickCapture(event) {
      if (consumed.current) { event.preventDefault(); event.stopPropagation(); consumed.current = false; }
    },
    onPointerMove(event) {
      if (drag.current) { move(event); return; }
      const kind = hit(event);
      (event.currentTarget as HTMLElement | SVGElement).style.cursor = kind === 'auto_move' ? 'grab' : kind ? 'ew-resize' : '';
      fallback.onPointerMove(event);
    },
    onPointerUp(event) { if (!finish(event)) fallback.onPointerUp(event); },
    onPointerCancel(event) { if (!finish(event, true)) fallback.onPointerCancel(event); },
    onLostPointerCapture(event) { if (!finish(event, true)) fallback.onLostPointerCapture(event); },
  };
}
