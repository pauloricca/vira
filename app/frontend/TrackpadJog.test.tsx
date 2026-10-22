// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { DeckState } from './Decks';
import { RollingRow } from './RollingRow';
import { TrackpadJogSettings } from './TrackpadJog';
import { useWaveformZoom } from './zoom';

const state: DeckState = {deck:0,loading:false,error:null,playing:false,position_seconds:10,gain:.8,generation:1,requested_generation:1,
  track:{track_id:'a',artifact_id:'b',title:'Track',artist:'',filename:'a.wav',duration_seconds:100,frames:4800000,peak_frames:240,peaks:[]}};
const control = vi.fn<(deck:number,action:string,value?:number) => Promise<void>>();
const interact = vi.fn();
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); control.mockReset().mockResolvedValue(undefined); interact.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function Harness({deck=state,running=true,mapping=false}:{deck?:DeckState;running?:boolean;mapping?:boolean}) {
  const [beats,setBeats] = useState(16);
  const zoom = useWaveformZoom(beats,setBeats);
  return <div className={mapping ? 'midi-map-mode' : ''}><section ref={zoom}><RollingRow state={deck} running={running} window={8} control={control} onInteract={interact} /><output aria-label="Zoom">{beats}</output></section><TrackpadJogSettings /></div>;
}
function scroll(options:WheelEventInit) {
  const event = new WheelEvent('wheel',{bubbles:true,cancelable:true,...options});
  fireEvent(screen.getByLabelText('Rolling waveform deck A'),event);
  return event;
}
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(20); }); }

test('rolling waveform uses only horizontal displacement and leaves vertical scrolling untouched', async () => {
  render(<Harness />);
  expect(scroll({deltaX:10,deltaY:2}).defaultPrevented).toBe(true);
  expect(scroll({deltaY:-4}).defaultPrevented).toBe(false);
  scroll({deltaX:-4,deltaY:20});
  expect(control).not.toHaveBeenCalled();
  await tick();
  expect(control).toHaveBeenCalledTimes(1);
  expect(control.mock.calls[0].slice(0,2)).toEqual([0,'jog']);
  expect(control.mock.calls[0][2]).toBeCloseTo(.03);
  expect(interact).toHaveBeenCalledWith(0);
  scroll({deltaX:2,deltaMode:1}); await tick();
  expect(control).toHaveBeenLastCalledWith(0,'jog',.16);
});

test('vertical scrolling does not jog or select a deck', async () => {
  render(<Harness />);
  expect(scroll({deltaY:40}).defaultPrevented).toBe(false);
  await tick();
  expect(control).not.toHaveBeenCalled();
  expect(interact).not.toHaveBeenCalled();
});

test('playing and stopped sensitivity persist independently of MIDI and apply immediately', async () => {
  localStorage.setItem('vira.jog-playing-ms','2');
  const view=render(<Harness />);
  fireEvent.change(screen.getByLabelText('Waveform trackpad playing movement'),{target:{value:'0.8'}});
  fireEvent.change(screen.getByLabelText('Waveform trackpad stopped movement'),{target:{value:'8'}});
  scroll({deltaX:40}); await tick(); expect(control).toHaveBeenLastCalledWith(0,'jog',.32);
  view.rerender(<Harness deck={{...state,playing:true}} />);
  scroll({deltaX:40}); await tick(); expect(control).toHaveBeenLastCalledWith(0,'jog',.032);
  expect(localStorage.getItem('vira.jog-playing-ms')).toBe('2');
  view.unmount(); render(<Harness />);
  expect((screen.getByLabelText('Waveform trackpad stopped movement') as HTMLInputElement).value).toBe('8');
  expect((screen.getByLabelText('Waveform trackpad playing movement') as HTMLInputElement).value).toBe('0.8');
});

test('playing locks and unavailable decks block movement; stopped locked decks can move', async () => {
  const view=render(<Harness />);
  for (const props of [
    {deck:{...state,playing:true,synced:true}}, {deck:{...state,loading:true}},
    {deck:{...state,track:null}}, {deck:{...state,launch_pending:true}},
    {deck:{...state,grid_saving:true}},
    {deck:state,running:false}, {deck:state,mapping:true},
  ]) {
    view.rerender(<Harness {...props} />);
    expect(scroll({deltaX:10}).defaultPrevented).toBe(false);
    await tick();
  }
  expect(control).not.toHaveBeenCalled();
  view.rerender(<Harness deck={{...state,synced:true}} />);
  scroll({deltaX:10}); await tick(); expect(control).toHaveBeenLastCalledWith(0,'jog',.05);
});

test('pinching continues to zoom without jogging on Chromium and WebKit', async () => {
  render(<Harness />);
  scroll({deltaX:10});
  scroll({ctrlKey:true,deltaY:-100}); await tick();
  expect(screen.getByLabelText('Zoom').textContent).toBe('8');
  const canvas=screen.getByLabelText('Rolling waveform deck A');
  const gesture=(type:string,scale=1) => { const event=new Event(type,{bubbles:true,cancelable:true}); Object.assign(event,{scale}); fireEvent(canvas,event); };
  gesture('gesturestart'); gesture('gesturechange',.7);
  scroll({deltaX:30}); await tick();
  expect(control).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Zoom').textContent).toBe('16');
  gesture('gestureend'); scroll({deltaX:10}); await tick();
  expect(control).toHaveBeenLastCalledWith(0,'jog',.05);
});

test('queued movement is discarded on locking, playback changes, replacement, mapping mode, and unmount', async () => {
  const view=render(<Harness />);
  scroll({deltaX:10}); view.rerender(<Harness deck={{...state,playing:true}} />); await tick();
  scroll({deltaX:10}); view.rerender(<Harness deck={{...state,playing:true,synced:true}} />); await tick();
  view.rerender(<Harness />); scroll({deltaX:10}); view.rerender(<Harness deck={{...state,generation:2}} />); await tick();
  scroll({deltaX:10}); view.rerender(<Harness mapping />); await tick();
  view.rerender(<Harness />); scroll({deltaX:10}); view.unmount(); await tick();
  expect(control).not.toHaveBeenCalled();
});

test('slow commands retain accumulated movement without overlapping requests or losing the final packet', async () => {
  let finish!:() => void;
  control.mockImplementationOnce(() => new Promise<void>(resolve => {finish=resolve;}));
  render(<Harness />);
  scroll({deltaX:10}); await tick();
  scroll({deltaX:4}); scroll({deltaX:6}); await tick();
  expect(control).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); }); await tick();
  expect(control.mock.calls).toEqual([[0,'jog',.05],[0,'jog',.05]]);
});


test.each([false,true])('trackpad movement works in Edit grid mode without changing the draft or pin (playing: %s)', async playing => {
  const grid=Object.freeze({bpm:123,downbeat_seconds:.25,reviewed:true});
  const deck={...state,playing,synced:false,grid_edit:grid,grid_pin:4.25};
  const view=render(<Harness deck={deck} />);
  expect(scroll({deltaX:10}).defaultPrevented).toBe(true);
  await tick();
  expect(control.mock.calls).toEqual([[0,'jog',playing ? .005 : .05]]);
  expect(deck.grid_edit).toEqual({bpm:123,downbeat_seconds:.25,reviewed:true});
  expect(deck.grid_pin).toBe(4.25);
  // Listening to a draft must still honor the playing-deck lock.
  if (playing) {
    view.rerender(<Harness deck={{...deck,synced:true}} />);
    scroll({deltaY:10}); await tick();
    expect(control).toHaveBeenCalledTimes(1);
  }
});
