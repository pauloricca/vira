import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useScrub } from './scrub';
import type { DeckState } from './Decks';
import { DisplayPosition, animate } from './transport';
import { WaveTiles, gridGeometry } from './waveform';
export const drawMetrics = { count: 0, total_ms: 0, max_ms: 0 };
export function RollingRow({ state, running, window, control, timingOpen = false, onInteract, active = false }: { state: DeckState; running: boolean; window: number; timingOpen?: boolean; onInteract?: (deck: number) => void; active?: boolean; control?: (deck: number, action: string, value?: number) => Promise<void> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ state, running, window, timingOpen });
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
  paint.current = now => {
    const element=canvas.current; if (!element || !visible) return;
    const {state,window,timingOpen}=latest.current, {width,height,dpr}=size.current;
    if (width<=0) return; const ctx=element.getContext('2d'); if (!ctx) return;
    const began=performance.now(), speed=state.speed ?? 1, position=gesture.current?.position ?? clock.current.at(now);
    const colour=state.deck===0 ? '#89d2ee' : '#efa264';
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
    tiles.current.draw(ctx,state.track,position-window*speed/2,window*speed,width,height,dpr,colour);
    const loopIn=state.loop_in_seconds, loopOut=state.loop_out_seconds;
    const loopX=(seconds:number)=>width*(.5+(seconds-position)/(window*speed));
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
    ctx.strokeStyle='#c8f3ff';
    const grid=gridGeometry(state.grid,position,window,speed,width,state.track?.duration_seconds ?? 0);
    for (const m of grid) {
      ctx.globalAlpha=(m.beat===1 ? 1 : .5)*(state.grid?.reviewed ? 1 : .7);
      ctx.lineWidth=m.beat===1 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(m.x,0); ctx.lineTo(m.x,height); ctx.stroke();
    }
    ctx.globalAlpha=1;
    if (timingOpen) for (const seconds of state.reference_beats ?? []) {
      const x = width * (.5 + (seconds - position) / (window * speed));
      if (x < 0 || x > width) continue;
      ctx.strokeStyle = '#f6d477'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.stroke();
      ctx.fillStyle = '#f6d477'; ctx.beginPath(); ctx.moveTo(x-5,0); ctx.lineTo(x+5,0); ctx.lineTo(x,9); ctx.fill();
    }
    const cost=performance.now()-began;
    drawMetrics.count++; drawMetrics.total_ms+=cost; drawMetrics.max_ms=Math.max(drawMetrics.max_ms,cost);
  };
  useLayoutEffect(() => {
    latest.current={state,running,window,timingOpen};
    const received=state.received_at ?? performance.now();
    clock.current.update({...state,playing:state.playing && !state.launch_pending && running,duration:state.track?.duration_seconds ?? 0},received,state.sampled_at ?? received);
    paint.current(performance.now());
  },[state,running,window,timingOpen]);
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
  return <div className={`rolling-row deck-${state.deck}`} onPointerDownCapture={() => onInteract?.(state.deck)} onFocusCapture={() => onInteract?.(state.deck)}><span className={`deck-badge${active ? ' active' : ''}`} title={`Deck ${state.deck===0 ? 'A' : 'B'}${active ? ' · active' : ''}`}>{state.deck===0 ? 'A' : 'B'}</span>
    <canvas {...handlers} ref={canvas} role="img" aria-label={`Rolling waveform deck ${state.deck===0 ? 'A' : 'B'}`}
      onPointerDownCapture={event => { if (event.detail <= 1) firstClick.current = { anchor: clock.current.at(performance.now()), at: performance.now() }; }}
      onDoubleClick={event => {
        if (!timingOpen || !running || state.playing || !state.track || !state.grid || !control) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const anchor = firstClick.current && performance.now() - firstClick.current.at < 700 ? firstClick.current.anchor : clock.current.at(performance.now());
        const seconds = Math.min(Math.max(0, anchor + ((event.clientX - bounds.left) / Math.max(1, bounds.width) - .5) * window * (state.speed ?? 1)), Math.max(0, state.track.duration_seconds - 1 / 48000));
        firstClick.current = null;
        void control(state.deck, 'reference_beat', seconds);
      }} />
    <div className="rolling-playhead" />
  </div>;
}
// Avoid shadowing the shared output-time `window` prop.
function windowGlobal() {return globalThis.window;}
function windowDevicePixelRatio() {return globalThis.devicePixelRatio || 1;}
