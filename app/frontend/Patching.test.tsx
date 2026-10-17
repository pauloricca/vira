// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { NodePalette, nodePlacement, paletteDrop } from './Patching';
afterEach(() => cleanup());
test('palette drags the same node identity it adds on double-click', () => {
  const add = vi.fn(), setData = vi.fn();
  render(<NodePalette categories={[{label:'Effects',items:[{id:'compressor',label:'Compressor'}]}]} actions={null} onAdd={add} />);
  const item = screen.getByRole('button',{name:'Compressor'});
  fireEvent.dragStart(item,{dataTransfer:{setData}});
  expect(setData).toHaveBeenCalledWith('application/x-vira-node','compressor');
  fireEvent.doubleClick(item); expect(add).toHaveBeenCalledWith('compressor');
});
test('drop and visible-center placement account for zoom and scroll', () => {
  const viewport = document.createElement('div'); viewport.className = 'routing-scroll';
  const canvas = document.createElement('div'); viewport.append(canvas);
  vi.spyOn(canvas,'getBoundingClientRect').mockReturnValue({left:-200,top:-80,width:1280,height:800} as DOMRect);
  vi.spyOn(viewport,'getBoundingClientRect').mockReturnValue({left:200,top:120,width:800,height:600} as DOMRect);
  expect(nodePlacement(canvas,1600,.8)).toEqual({x:927.5,y:565});
  const add = vi.fn(), preventDefault = vi.fn();
  paletteDrop({dataTransfer:{getData:()=> 'compressor'},clientX:440,clientY:320,preventDefault} as never,add,canvas,1600,.8);
  expect(add).toHaveBeenCalledWith('compressor',{x:800,y:500}); expect(preventDefault).toHaveBeenCalled();
});
test('pointer dragging creates a node only inside this workspace and Escape cancels it', () => {
  class TestPointer extends MouseEvent {pointerId=1;}
  vi.stubGlobal('PointerEvent',TestPointer);
  HTMLElement.prototype.setPointerCapture=vi.fn(); HTMLElement.prototype.hasPointerCapture=vi.fn(()=>false);
  const add=vi.fn();
  const view=render(<section className="routing-page"><NodePalette categories={[{label:'Effects',items:[{id:'gain',label:'Gain'}]}]} actions={null} onAdd={add} /><div className="routing-scroll"><div className="routing-canvas" /></div></section>);
  const canvas=view.container.querySelector<HTMLElement>('.routing-canvas')!, viewport=canvas.parentElement!;
  Object.defineProperty(canvas,'offsetWidth',{value:1600});
  vi.spyOn(canvas,'getBoundingClientRect').mockReturnValue({left:200,top:100,width:1280,height:800} as DOMRect);
  Object.defineProperty(document,'elementFromPoint',{configurable:true,value:vi.fn(()=>canvas)});
  const item=screen.getByRole('button',{name:'Gain'});
  fireEvent.pointerDown(item,{button:0,clientX:100,clientY:120}); fireEvent.pointerMove(item,{clientX:600,clientY:500}); fireEvent.pointerUp(item,{clientX:600,clientY:500});
  expect(add).toHaveBeenCalledWith('gain',{x:500,y:500});
  fireEvent.pointerDown(item,{button:0}); fireEvent.pointerMove(item,{clientX:600,clientY:500}); fireEvent.keyDown(window,{key:'Escape'}); fireEvent.pointerUp(item,{clientX:600,clientY:500});
  expect(add).toHaveBeenCalledTimes(1); expect(viewport.className).toBe('routing-scroll');
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
