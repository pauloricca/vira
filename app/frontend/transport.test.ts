import { expect, test } from 'vitest';
import { DisplayPosition } from './transport';
test('display position stays inside playable bounds even with stale or extrapolated positions', () => {
  const clock = new DisplayPosition();
  const snapshot = { position_seconds: 0, start_seconds: .25, duration: 10, generation: 1, playing: false };
  clock.update(snapshot, 0);
  expect(clock.at(100)).toBe(.25);
  clock.update({ ...snapshot, position_seconds: 12 }, 100);
  expect(clock.at(100)).toBe(10);
  clock.update({ ...snapshot, playing: true }, 200);
  expect(clock.at(200)).toBe(.25);
  clock.update({ ...snapshot, position_seconds: 9.9, playing: true }, 300);
  expect(clock.at(1000)).toBe(10);
});
import { gridGeometry, peakLevels, rangePeak, waveformColour } from './waveform';
const state={position_seconds:10,speed:1,playing:true,generation:1,position_epoch:0,duration:100};
test('late, uneven polls correct continuously without a backwards jump',()=>{
  const clock=new DisplayPosition(); clock.update(state,0);
  let previous=clock.at(0);
  for(let frame=1;frame<240;frame++) {
    const now=frame*1000/60;
    if(frame%12===0) clock.update({...state,position_seconds:10+now/1000-.04},now);
    const value=clock.at(now);
    expect(value).toBeGreaterThanOrEqual(previous); expect(value-previous).toBeLessThan(.02); previous=value;
  }
  expect(previous).toBeCloseTo(13.94,1);
});
test('explicit seeks, replacements and pause re-anchor immediately; stalled telemetry freezes',()=>{
  const clock=new DisplayPosition(); clock.update(state,0);
  clock.update({...state,position_seconds:10.1,position_epoch:1},200);
  expect(clock.at(200)).toBe(10.1); // small genuine seek must not be smoothed away
  clock.update({...state,playing:false,position_seconds:10.3},300);
  expect(clock.at(900)).toBe(10.3);
  clock.update({...state,generation:2,position_seconds:0},1000);
  expect(clock.at(1000)).toBe(0);
  expect(clock.at(2000)).toBe(.5); expect(clock.at(3000)).toBe(.5);
});
test('tempo changes preserve continuity and latency estimate is bounded at both extremes',()=>{
  const clock=new DisplayPosition(); clock.update(state,0);
  clock.update({...state,position_seconds:10.2,speed:2},200);
  expect(clock.at(200)).toBe(10.2); expect(clock.at(300)).toBeCloseTo(10.4);
  clock.update({...state,position_seconds:10.4,speed:.5},400,300);
  expect(clock.at(400)).toBeCloseTo(10.6);
  expect(clock.at(500)).toBeGreaterThan(clock.at(400));
});
test('display playhead wraps inside an active loop',()=>{
  const clock=new DisplayPosition();
  clock.update({...state,position_seconds:10.4,loop_in_seconds:10,loop_out_seconds:10.5},0);
  expect(clock.at(200)).toBeCloseTo(10.1);
  clock.update({...state,position_seconds:10.1,position_epoch:1,loop_in_seconds:10,loop_out_seconds:10.5},200);
  expect(clock.at(200)).toBeCloseTo(10.1);
});
test('max pyramid preserves narrow peaks at every zoom without resampling the full song',()=>{
  const peaks: [number,number][] = [[.1,.2],[.8,.1],[.3,.4],[.2,.95],[.1,.1]];
  const levels=peakLevels(peaks);
  expect(peakLevels(peaks)).toBe(levels);
  for(let start=0;start<5;start++) for(let end=start+1;end<=5;end++) expect(rangePeak(levels,start,end)).toBeCloseTo(Math.max(...peaks.slice(start,end).flat()));
});
test('output-time grids show equal spacing only for equal target tempos',()=>{
  const grid={bpm:120,downbeat_seconds:0,reviewed:false};
  const a=gridGeometry(grid,5,4,1,1024,100),b=gridGeometry(grid,5,4,.8,1024,100);
  expect(a[1].x-a[0].x).toBeCloseTo(128); expect(b[1].x-b[0].x).toBeCloseTo(160);
  expect(gridGeometry(null,5,4,1,1024,100)).toEqual([]);
  const opening = gridGeometry({ ...grid, downbeat_seconds: .25 }, .25, 4, 1, 1024, 100, .25);
  expect(opening[0]).toEqual({ x: 512, bar: 1, beat: 1 });
  expect(opening.every(marker => marker.x >= 512)).toBe(true);
});

test('slow rAF fallback remains a single visible display loop and stops when unused', async()=>{
  const {vi}=await import('vitest');
  vi.useFakeTimers();
  const callbacks: FrameRequestCallback[]=[];
  vi.stubGlobal('document', {visibilityState:'visible'});
  vi.stubGlobal('requestAnimationFrame', (callback:FrameRequestCallback)=>{callbacks.push(callback);return callbacks.length;});
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  let now=0; const clock=vi.spyOn(performance,'now').mockImplementation(()=>now);
  const {animate,animationMetrics}=await import('./transport');
  const draw=vi.fn(); const stop=animate(draw);
  try {
    for(let i=0;i<12;i++){now+=70; callbacks.shift()?.(now);}
    expect(animationMetrics.driver).toBe('paced-timer');
    for(let i=0;i<10;i++){now+=17; await vi.advanceTimersByTimeAsync(17);}
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(18);
    stop(); const frames=draw.mock.calls.length;
    now+=100; await vi.advanceTimersByTimeAsync(100);
    expect(draw.mock.calls.length).toBe(frames);
  } finally {stop();clock.mockRestore();vi.unstubAllGlobals();vi.useRealTimers();}
});

test('sustained treble stays tinted while a strong attack becomes white even over bass',()=>{
  expect(waveformColour('#89d2ee', [0, .95])).toBe('rgb(255,255,255)');
  expect(waveformColour('#89d2ee', [1, 0])).toBe('rgb(110,168,190)');
  expect(waveformColour('#89d2ee', [0, .4])).toBe(waveformColour('#89d2ee', [0, 0]));
  expect(waveformColour('#89d2ee', [0, 0])).toBe('rgb(55,84,95)');
});
