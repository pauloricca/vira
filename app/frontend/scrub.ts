import { useEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { DeckState } from './Decks';
type Control = (deck: number, action: string, value?: number) => Promise<void>;
/** One ordered stream per gesture; movement is coalesced while commands are pending. */
export function useScrub(state: DeckState, running: boolean, control: Control | undefined,
  positionAt: (element: Element, x: number, anchor: number, originX: number) => number,
  currentPosition: () => number, redraw: () => void, audible = true,
  playingPositionAt = positionAt) {
  const gesture = useRef<{pointer: number; position: number; anchor: number; originX: number} | null>(null);
  const queue = useRef<{action: string; position: number}[]>([]);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const version = useRef(0);
  async function flush() {
    timer.current = undefined;
    if (busy.current || !queue.current.length || !control) return;
    const command = queue.current.shift()!, epoch = version.current;
    busy.current = true;
    try { await control(state.deck, command.action, command.position); }
    finally {
      busy.current = false;
      if (version.current === epoch && queue.current.length) timer.current = setTimeout(() => void flush(), 16);
    }
  }
  function send(action: string, position: number) {
    const previous = queue.current.at(-1);
    if ((action === 'scrub' || action === 'seek') && previous?.action === action) previous.position = position;
    else queue.current.push({action, position});
    if (!busy.current && !timer.current) void flush();
  }
  useEffect(() => () => {
    version.current++;
    const active = gesture.current;
    gesture.current = null; queue.current = [];
    clearTimeout(timer.current); timer.current = undefined;
    if (active) void control?.(state.deck, audible ? 'scrub_pause' : 'seek', active.position);
  }, [state.generation, running]);
  function position(element: Element, x: number, anchor: number, originX: number) {
    return Math.max(state.track?.start_seconds ?? 0, Math.min(state.track?.duration_seconds ?? 0, positionAt(element, x, anchor, originX)));
  }
  function finish(event: PointerEvent<Element>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    gesture.current = null;
    send(audible ? 'scrub_pause' : 'seek', active.position);
    redraw();
  }
  return { gesture, handlers: {
    onPointerDown(event: PointerEvent<Element>) {
      if (!control || !running || !state.track || state.launch_pending || event.button !== 0 || gesture.current) return;
      if (state.playing) {
        event.preventDefault();
        const anchor = currentPosition();
        send('seek', Math.max(state.track.start_seconds ?? 0, Math.min(state.track.duration_seconds,
          playingPositionAt(event.currentTarget, event.clientX, anchor, event.clientX))));
        return;
      }
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      const anchor = currentPosition(), target = position(event.currentTarget, event.clientX, anchor, event.clientX);
      gesture.current = {pointer: event.pointerId, position: target, anchor, originX: event.clientX};
      send(audible ? 'scrub_start' : 'seek', target); redraw();
    },
    onPointerMove(event: PointerEvent<Element>) {
      const active = gesture.current;
      if (!active || active.pointer !== event.pointerId) return;
      const target = position(event.currentTarget, event.clientX, active.anchor, active.originX);
      if (target !== active.position) {active.position = target; send(audible ? 'scrub' : 'seek', target); redraw();}
    },
    onPointerUp(event: PointerEvent<Element>) {
      finish(event);
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel: finish, onLostPointerCapture: finish,
  }};
}
