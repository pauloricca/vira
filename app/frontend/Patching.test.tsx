// @vitest-environment jsdom
import { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { usePatchCanvas, patchCanvasBounds, NodePalette, nodePlacement, paletteDrop, PATCH_GRID, PATCH_NODE_WIDTH, patchSize, snapPatchPoint, snapPatchGraph } from './Patching';
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
  expect(nodePlacement(canvas,1600,.8)).toEqual({x:920,y:560});
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

test('shared canvas grid snaps positions and sizes to the visible dot pitch', () => {
  expect(PATCH_NODE_WIDTH % PATCH_GRID).toBe(0);
  expect(snapPatchPoint({x:113,y:347})).toEqual({x:120,y:340});
  expect(snapPatchPoint({x:99,y:101})).toEqual({x:100,y:100});
  expect(patchSize(173)).toBe(180);
  const graph = {nodes:[{id:'one',x:113,y:347}],wires:[]};
  expect(snapPatchGraph(graph).nodes[0]).toEqual({id:'one',x:120,y:340});
  expect(graph.nodes[0]).toEqual({id:'one',x:113,y:347});
});

test('canvas reserves half its content span on every side and grows beyond old limits', () => {
  const size = () => ({width:160,height:240});
  const nodes = [{x:-400,y:-300},{x:2600,y:1800}];
  const bounds = patchCanvasBounds(nodes,size,{width:1800,height:1100});
  expect(-400-bounds.x).toBeGreaterThanOrEqual((2760+400)/2);
  expect(-300-bounds.y).toBeGreaterThanOrEqual((2040+300)/2);
  expect(bounds.x+bounds.width-2760).toBeGreaterThanOrEqual((2760+400)/2);
  expect(bounds.y+bounds.height-2040).toBeGreaterThanOrEqual((2040+300)/2);
});
test('placement accepts negative positions and positions beyond the old canvas limits at zoom', () => {
  const viewport=document.createElement('div'); viewport.className='routing-scroll';
  const canvas=document.createElement('div'); viewport.append(canvas);
  canvas.dataset.originX='-1000'; canvas.dataset.originY='-600';
  vi.spyOn(canvas,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:3200,height:2000} as DOMRect);
  expect(nodePlacement(canvas,4000,.8,{clientX:400,clientY:240})).toEqual({x:-500,y:-300});
  expect(nodePlacement(canvas,4000,.8,{clientX:2880,clientY:1920})).toEqual({x:2600,y:1800});
});

test('expanding the scroll area preserves the visible world position, including first activation', () => {
  function Surface({x,active,zoom=.8}:{x:number;active:boolean;zoom?:number}) {
    const canvas=useRef<HTMLDivElement>(null);
    const bounds=usePatchCanvas(canvas,[{x,y:0}],()=>({width:160,height:240}),{width:1600,height:900},zoom,active);
    return <div className="routing-scroll"><div ref={canvas} data-origin-x={bounds.x} data-origin-y={bounds.y} /></div>;
  }
  const view=render(<Surface x={0} active={false} />);
  const viewport=view.container.firstElementChild!, canvas=viewport.firstElementChild as HTMLElement;
  expect(viewport.scrollLeft).toBe(0);
  view.rerender(<Surface x={0} active />);
  expect(viewport.scrollLeft+Number(canvas.dataset.originX)*.8).toBe(0);
  viewport.scrollLeft+=240;
  view.rerender(<Surface x={2800} active />);
  expect(viewport.scrollLeft+Number(canvas.dataset.originX)*.8).toBeCloseTo(240);
  view.rerender(<Surface x={-1000} active />);
  expect(viewport.scrollLeft+Number(canvas.dataset.originX)*.8).toBeCloseTo(240);
  view.rerender(<Surface x={-1000} active zoom={.5} />);
  expect(viewport.scrollLeft/.5+Number(canvas.dataset.originX)).toBeCloseTo(300);
});
