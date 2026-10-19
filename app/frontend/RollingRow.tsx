import { useTrackpadJog } from './TrackpadJog';
import { useMidiMarkers } from './MidiMapping';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useScrub } from './scrub';
import { useTransitionDrag } from './transitionDrag';
import type { DeckState } from './Decks';
import { DisplayPosition, animate } from './transport';
import { WaveTiles, gridGeometry, trackSampleRate } from './waveform';
import { drawTransitionGuides, transitionMarkers, TransitionDescription, type TransitionPlan } from './TransitionGuides';
export const drawMetrics = { count: 0, total_ms: 0, max_ms: 0 };
export function RollingRow({ state, running, window, control, transition, masterBpm = 120, timingOpen = false, onInteract, active = false }: { transition?: TransitionPlan | null; masterBpm?: number; state: DeckState; running: boolean; window: number; timingOpen?: boolean; onInteract?: (deck: number) => void; active?: boolean; control?: (deck: number, action: string, value?: number) => Promise<void> }) {
  const midi = useMidiMarkers();
  const pinnedBeat = useRef<HTMLDivElement>(null);
  const hoverX = useRef<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useTrackpadJog(canvas, state, running, control, onInteract);
  const latest = useRef({ state, running, window, timingOpen, transition, masterBpm });
  const gridDrag = useRef<{ pointer: number; x: number; scale: number; position: number; cursor: 'grabbing' | 'ew-resize' } | null>(null);
  // Polls omit inactive flags; local edits use false. Neither transition should
  // cancel a gesture unless the actual editing availability has changed.
  useEffect(() => {
    gridDrag.current = null;
    if (canvas.current) canvas.current.style.cursor = '';
  }, [state.generation, !!state.grid_edit, !!state.grid_saving, !!state.grid_previewing, state.playing, !!state.launch_pending, state.grid_pin]);
  function gridTarget(element: HTMLCanvasElement, clientX: number, position = clock.current.at(performance.now())) {
    const bounds = element.getBoundingClientRect();
    const span = window * (state.speed ?? 1);
    const grid = state.grid_edit!;
    const x = clientX - bounds.left;
    const tolerance = Math.min(7, 60 / grid.bpm / span * bounds.width * .3);
    const mark = gridGeometry(grid, position, window, state.speed ?? 1, bounds.width, state.track?.duration_seconds ?? 0, state.track?.start_seconds ?? 0)
      .find(mark => Math.abs(mark.x - x) <= tolerance);
    const seconds = position + (x / Math.max(1, bounds.width) - .5) * span;
    return { beatSeconds: mark ? grid.downbeat_seconds + ((mark.bar - 1) * 4 + mark.beat - 1) * 60 / grid.bpm : undefined, seconds, position, scale: span / Math.max(1, bounds.width) };
  }
  function gridCursor(element: HTMLCanvasElement, clientX: number, position?: number) {
    const target = gridTarget(element, clientX, position);
    if (state.grid_pin != null) return target.beatSeconds != null && Math.abs(target.beatSeconds - state.grid_pin) < 1 / trackSampleRate(state.track) ? 'not-allowed' : 'ew-resize';
    return target.beatSeconds != null ? 'grab' : 'ew-resize';
  }
  function moveGrid(event: PointerEvent<HTMLCanvasElement>) {
    hoverX.current = event.clientX;
    if (state.playing || state.launch_pending || state.grid_saving || state.grid_previewing) {
      gridDrag.current = null;
      event.currentTarget.style.cursor = gridCursor(event.currentTarget, event.clientX);
      return;
    }
    const drag = gridDrag.current;
    if (drag && drag.pointer === event.pointerId) {
      event.currentTarget.style.cursor = drag.cursor;
      void control?.(state.deck, 'grid_drag', (event.clientX - drag.x) * drag.scale);
    } else if (!drag) event.currentTarget.style.cursor = gridCursor(event.currentTarget, event.clientX);
  }
  function finishGrid(event: PointerEvent<HTMLCanvasElement>, move = true) {
    if (move) moveGrid(event);
    gridDrag.current = null;
    if (state.grid_edit) event.currentTarget.style.cursor = gridCursor(event.currentTarget, event.clientX);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const firstClick = useRef<{ anchor: number; at: number } | null>(null);
  const clock = useRef(new DisplayPosition());
  const tiles = useRef(new WaveTiles());
  const size = useRef({width:0,height:100,dpr:1});
  const [visible,setVisible]=useState(true);
  const paint = useRef<(now:number)=>void>(()=>{});
  const {gesture, handlers} = useScrub(state, running, control,
    (element, x, anchor, originX) => { const bounds=element.getBoundingClientRect(); return anchor - (x-originX)/Math.max(1,bounds.width)*window*(state.speed ?? 1); },
    () => clock.current.at(performance.now()), () => paint.current(performance.now()), true,
    (element, x, anchor) => { const bounds=element.getBoundingClientRect(); return anchor + ((x-bounds.left)/Math.max(1,bounds.width)-.5)*window*(state.speed ?? 1); });
  const waveformHandlers = useTransitionDrag(state, running, transition, control,
    (element, x) => { const bounds = element.getBoundingClientRect(); return clock.current.at(performance.now()) + ((x - bounds.left) / Math.max(1, bounds.width) - .5) * window * (state.speed ?? 1); }, window * (state.speed ?? 1), handlers);
  paint.current = now => {
    const element=canvas.current; if (!element || !visible) return;
    const {state,window,timingOpen,transition,masterBpm}=latest.current, {width,height,dpr}=size.current;
    if (width<=0) return; const ctx=element.getContext('2d'); if (!ctx) return;
    const began=performance.now(), speed=state.speed ?? 1, position=gridDrag.current?.position ?? gesture.current?.position ?? clock.current.at(now);
    if (state.grid_edit && hoverX.current != null && !gridDrag.current) element.style.cursor = gridCursor(element, hoverX.current, position);
    const colour=state.deck===0 ? '#89d2ee' : '#efa264';
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
    tiles.current.draw(ctx,state.track,position-window*speed/2,window*speed,width,height,dpr,colour);
    const loopIn=state.loop_in_seconds, loopOut=state.loop_out_seconds;
    const loopX=(seconds:number)=>width*(.5+(seconds-position)/(window*speed));
    if (pinnedBeat.current && state.grid_pin != null) pinnedBeat.current.style.left = `${loopX(state.grid_pin) / width * 100}%`;
    if (loopIn != null && loopOut != null) {
      const left=loopX(loopIn), right=loopX(loopOut);
      ctx.fillStyle=state.deck===0 ? 'rgba(137,210,238,.16)' : 'rgba(239,162,100,.16)';
      ctx.fillRect(Math.max(0,left),0,Math.max(0,Math.min(width,right)-Math.max(0,left)),height);
    }
    for (const [seconds,label] of [[loopIn,'IN'],[loopOut,'OUT']] as const) {
      if (seconds == null) continue;
      const x=loopX(seconds);
      if (x < 0 || x > width) continue;
      ctx.strokeStyle=state.deck===0 ? '#89d2ee' : '#efa264'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.stroke();
      ctx.fillStyle=ctx.strokeStyle; ctx.font='bold 10px sans-serif'; ctx.fillText(label,Math.min(x+4,width-28),12);
    }
    const grid=gridGeometry(state.grid_edit ?? state.grid,position,window,speed,width,state.track?.duration_seconds ?? 0,state.track?.start_seconds ?? 0);
    for (const m of grid) {
      ctx.strokeStyle=m.beat===1 && (m.bar-1)%4===0 ? '#f6d477' : '#c8f3ff';
      ctx.globalAlpha=(m.beat===1 ? 1 : .5)*((state.grid_edit ?? state.grid)?.reviewed ? 1 : .7);
      ctx.lineWidth=m.beat===1 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(m.x,0); ctx.lineTo(m.x,height); ctx.stroke();
    }
    ctx.globalAlpha=1;
    if (timingOpen && !state.grid_edit) for (const seconds of state.reference_beats ?? []) {
      const x = width * (.5 + (seconds - position) / (window * speed));
      if (x < 0 || x > width) continue;
      ctx.strokeStyle = '#f6d477'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.stroke();
      ctx.fillStyle = '#f6d477'; ctx.beginPath(); ctx.moveTo(x-5,0); ctx.lineTo(x+5,0); ctx.lineTo(x,9); ctx.fill();
    }
    const markers = transitionMarkers(transition, state.deck);
    drawTransitionGuides(ctx, markers, marker => {
      if (state.playing && state.loop_out_seconds != null) {
        const elapsed = transition?.sampled_at == null ? 0 : Math.min(.5, Math.max(0, (now - transition.sampled_at) / 1000));
        return width * (.5 + (marker.remaining * 60 / masterBpm - elapsed) / window);
      }
      return loopX(marker.seconds);
    }, width, height);
    const cost=performance.now()-began;
    drawMetrics.count++; drawMetrics.total_ms+=cost; drawMetrics.max_ms=Math.max(drawMetrics.max_ms,cost);
  };
  useLayoutEffect(() => {
    latest.current={state,running,window,timingOpen,transition,masterBpm};
    const received=state.received_at ?? performance.now();
    clock.current.update({...state,playing:state.playing && !state.launch_pending && running,duration:state.track?.duration_seconds ?? 0,start_seconds:state.track?.start_seconds},received,state.sampled_at ?? received);
    paint.current(performance.now());
  },[state,running,window,timingOpen,transition,masterBpm]);
  useEffect(() => {
    const element=canvas.current; if (!element) return;
    function resize() {
      const bounds=element!.getBoundingClientRect(), dpr=Math.min(2,windowDevicePixelRatio());
      size.current={width:bounds.width,height:bounds.height,dpr};
      element!.width=Math.max(1,Math.round(bounds.width*dpr)); element!.height=Math.max(1,Math.round(bounds.height*dpr));
      paint.current(performance.now());
    }
    resize();
    const observer=typeof ResizeObserver==='undefined' ? null : new ResizeObserver(resize); observer?.observe(element);
    const intersection=typeof IntersectionObserver==='undefined' ? null : new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting)); intersection?.observe(element);
    windowGlobal().addEventListener('resize',resize);
    return () => {observer?.disconnect();intersection?.disconnect();windowGlobal().removeEventListener('resize',resize);};
  },[]);
  useEffect(() => {
    paint.current(performance.now());
    if (state.playing && !state.launch_pending && running && visible) return animate(now=>paint.current(now));
  },[state.playing,state.launch_pending,running,visible,state.generation]);
  return <div className={`rolling-row deck-${state.deck}${state.grid_edit ? ' editing-grid' : ''}${state.grid_pin != null ? ' grid-pinned' : ''}${state.grid_edit && (state.playing || state.launch_pending || state.grid_previewing) ? ' grid-listening' : ''}`} onPointerDownCapture={() => onInteract?.(state.deck)} onFocusCapture={() => onInteract?.(state.deck)}><span className={`deck-badge${active ? ' active' : ''}`} title={`Deck ${state.deck===0 ? 'A' : 'B'}${active ? ' · active' : ''}`}>{state.deck===0 ? 'A' : 'B'}</span>
    <canvas {...waveformHandlers} {...midi(`deck:${state.deck}:jog`)} ref={canvas} role="img" aria-label={`Rolling waveform deck ${state.deck===0 ? 'A' : 'B'}`}
      onPointerDown={event => { if (!state.grid_edit) waveformHandlers.onPointerDown(event); }}
      onPointerLeave={event => { hoverX.current = null; if (!gridDrag.current) event.currentTarget.style.cursor = ''; }}
      onPointerMove={event => { if (state.grid_edit) moveGrid(event); else waveformHandlers.onPointerMove(event); }}
      onPointerUp={event => { if (state.grid_edit) finishGrid(event); else waveformHandlers.onPointerUp(event); }}
      onPointerCancel={event => { if (state.grid_edit) finishGrid(event, false); else waveformHandlers.onPointerCancel(event); }}
      onLostPointerCapture={event => { if (state.grid_edit) finishGrid(event, false); else waveformHandlers.onLostPointerCapture(event); }}
      onPointerDownCapture={event => {
        if (state.grid_edit) {
          event.preventDefault();
          if (event.button !== 0 || state.grid_saving || state.grid_previewing || state.playing || state.launch_pending || !running || !control || gridDrag.current) return;
          const target = gridTarget(event.currentTarget, event.clientX);
          if (event.metaKey) {
            if (target.beatSeconds != null) void control(state.deck, 'grid_pin', target.beatSeconds);
            return;
          }
          if (gridCursor(event.currentTarget, event.clientX) === 'not-allowed') return;
          const cursor = state.grid_pin == null && target.beatSeconds != null ? 'grabbing' : 'ew-resize';
          gridDrag.current = { pointer: event.pointerId, x: event.clientX, scale: target.scale, position: target.position, cursor };
          event.currentTarget.style.cursor = cursor;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          void control(state.deck, 'grid_drag_start', target.seconds);
          return;
        }
        waveformHandlers.onPointerDownCapture(event); if (event.defaultPrevented) return; if (event.detail <= 1) firstClick.current = { anchor: clock.current.at(performance.now()), at: performance.now() }; }}
      onDoubleClick={event => {
        if (state.grid_edit || !timingOpen || !running || state.playing || !state.track || !control) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const anchor = firstClick.current && performance.now() - firstClick.current.at < 700 ? firstClick.current.anchor : clock.current.at(performance.now());
        const seconds = Math.min(Math.max(state.track.start_seconds ?? 0, anchor + ((event.clientX - bounds.left) / Math.max(1, bounds.width) - .5) * window * (state.speed ?? 1)), Math.max(0, state.track.duration_seconds - 1 / trackSampleRate(state.track)));
        firstClick.current = null;
        void control(state.deck, 'reference_beat', seconds);
      }} />
    <TransitionDescription plan={transition} deck={state.deck} rolling />
    <div className="rolling-playhead" />
    {state.grid_edit && state.grid_pin != null && <div ref={pinnedBeat} className="grid-pin" aria-label={`Pinned beat deck ${state.deck === 0 ? 'A' : 'B'}`} title="Pinned beat · Command-click to unpin" style={{ left: `${50 + (state.grid_pin - state.position_seconds) / (window * (state.speed ?? 1)) * 100}%` }} />}
  </div>;
}
// Avoid shadowing the shared output-time `window` prop.
function windowGlobal() {return globalThis.window;}
function windowDevicePixelRatio() {return globalThis.devicePixelRatio || 1;}
