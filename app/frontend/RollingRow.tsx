import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DeckState } from './Decks';
import { DisplayPosition, animate } from './transport';
import { WaveTiles, gridGeometry } from './waveform';
export const drawMetrics = { count: 0, total_ms: 0, max_ms: 0 };
export function RollingRow({ state, running, window }: { state: DeckState; running: boolean; window: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ state, running, window });
  const clock = useRef(new DisplayPosition());
  const tiles = useRef(new WaveTiles());
  const size = useRef({width:0,height:100,dpr:1});
  const [visible,setVisible]=useState(true);
  const paint = useRef<(now:number)=>void>(()=>{});
  paint.current = now => {
    const element=canvas.current; if (!element || !visible) return;
    const {state,window}=latest.current, {width,height,dpr}=size.current;
    if (width<=0) return; const ctx=element.getContext('2d'); if (!ctx) return;
    const began=performance.now(), speed=state.speed ?? 1, position=clock.current.at(now);
    const colour=state.deck===0 ? '#89d2ee' : '#efa264';
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
    tiles.current.draw(ctx,state.track,position-window*speed/2,window*speed,width,height,dpr,colour);
    ctx.strokeStyle=colour; ctx.fillStyle=colour; ctx.font='11px -apple-system, sans-serif';
    ctx.globalAlpha=state.grid?.reviewed ? 1 : .5;
    const grid=gridGeometry(state.grid,position,window,speed,width,state.track?.duration_seconds ?? 0);
    const spacing=grid.length>1 ? grid[1].x-grid[0].x : width;
    const labelBars=Math.max(1,Math.ceil(36/(spacing*4)));
    for (const m of grid) {
      ctx.lineWidth=m.beat===1 ? 2 : .6;
      ctx.beginPath(); ctx.moveTo(m.x,16); ctx.lineTo(m.x,height); ctx.stroke();
      if(spacing>=36 || (m.beat===1 && m.bar%labelBars===0)) ctx.fillText(`${m.bar}.${m.beat}`,m.x+3,12);
    }
    ctx.globalAlpha=1;
    const cost=performance.now()-began;
    drawMetrics.count++; drawMetrics.total_ms+=cost; drawMetrics.max_ms=Math.max(drawMetrics.max_ms,cost);
  };
  useLayoutEffect(() => {
    latest.current={state,running,window};
    const received=state.received_at ?? performance.now();
    clock.current.update({...state,playing:state.playing && !state.launch_pending && running,duration:state.track?.duration_seconds ?? 0},received,state.sampled_at ?? received);
    paint.current(performance.now());
  },[state,running,window]);
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
  return <div className={`rolling-row deck-${state.deck}`}><span className="deck-badge" title={state.grid ? state.grid.reviewed ? 'Reviewed grid' : 'Draft grid' : 'No grid'}>{state.deck===0 ? 'A' : 'B'}</span>
    <canvas ref={canvas} role="img" aria-label={`Rolling waveform deck ${state.deck===0 ? 'A' : 'B'}`} />
  </div>;
}
// Avoid shadowing the shared output-time `window` prop.
function windowGlobal() {return globalThis.window;}
function windowDevicePixelRatio() {return globalThis.devicePixelRatio || 1;}
