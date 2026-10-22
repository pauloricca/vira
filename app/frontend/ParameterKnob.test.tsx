// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { ParameterKnob } from './ParameterKnob';
import { PinButton } from './pinnedComponents';

class TestPointer extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}
beforeEach(() => { vi.stubGlobal('PointerEvent',TestPointer); HTMLElement.prototype.setPointerCapture = vi.fn(); });
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
function Knob({max = 2,step = .01,label = 'Gain'}: {max?:number;step?:number;label?:string}) {
  const [value,setValue] = useState(1);
  return <ParameterKnob label={label} min={0} max={max} step={step} defaultValue={1} value={value} onChange={setValue} />;
}
test('dragging is bounded, preserves precision and resets on double-click', () => {
  const parent = vi.fn(), start = vi.fn(), finish = vi.fn(), change = vi.fn();
  render(<div onDoubleClick={parent}><ParameterKnob label="Gain" value={1} min={0} max={2} step={.01} defaultValue={1} onChange={change} onInteractionStart={start} onInteractionEnd={finish} /></div>);
  const knob = screen.getByRole('slider');
  fireEvent.pointerDown(knob,{button:0,pointerId:4,clientY:100});
  fireEvent.pointerMove(knob,{pointerId:4,clientY:65});
  expect(change).toHaveBeenLastCalledWith(1.5);
  fireEvent.pointerMove(knob,{pointerId:4,clientY:-500});
  expect(change).toHaveBeenLastCalledWith(2);
  fireEvent.pointerUp(knob,{pointerId:4}); fireEvent.lostPointerCapture(knob,{pointerId:4});
  expect(start).toHaveBeenCalledTimes(1); expect(finish).toHaveBeenCalledTimes(1);
  fireEvent.doubleClick(knob); expect(change).toHaveBeenLastCalledWith(1); expect(parent).not.toHaveBeenCalled();
});
test('keyboard controls clamp integer values and disabled knobs reject input', () => {
  const view = render(<Knob max={10} step={1} />);
  const knob = screen.getByRole('slider');
  fireEvent.keyDown(knob,{key:'End'}); expect(knob.getAttribute('aria-valuenow')).toBe('10');
  fireEvent.keyDown(knob,{key:'ArrowUp'}); expect(knob.getAttribute('aria-valuenow')).toBe('10');
  fireEvent.keyDown(knob,{key:'Home'}); expect(knob.getAttribute('aria-valuenow')).toBe('0');
  fireEvent.keyDown(knob,{key:'ArrowRight'}); expect(knob.getAttribute('aria-valuenow')).toBe('1');
  const change = vi.fn();
  view.rerender(<ParameterKnob label="Gain" value={1} min={0} max={2} defaultValue={1} disabled onChange={change} />);
  fireEvent.keyDown(screen.getByRole('slider'),{key:'End'}); fireEvent.doubleClick(screen.getByRole('slider'));
  fireEvent.pointerDown(screen.getByRole('slider'),{button:0,clientY:100}); fireEvent.pointerMove(screen.getByRole('slider'),{clientY:0});
  expect(change).not.toHaveBeenCalled();
});
test('unbounded values remain adjustable beyond the normal dial range', () => {
  const change = vi.fn();
  render(<ParameterKnob label="Timing advance" value={1500} min={0} step={1} defaultValue={0} defaultRange={100} onChange={change} />);
  const knob = screen.getByRole('slider');
  expect(knob.getAttribute('aria-valuemax')).toBe('1600');
  fireEvent.keyDown(knob,{key:'ArrowUp'}); expect(change).toHaveBeenLastCalledWith(1501);
  fireEvent.keyDown(knob,{key:'End'}); expect(change).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(knob,{button:0,clientY:200}); fireEvent.pointerMove(knob,{clientY:60});
  expect(change).toHaveBeenLastCalledWith(3101);
});
test('long labels retain their full accessible name and tooltip below the knob', () => {
  const label = 'A very long synthesizer parameter label';
  render(<Knob label={label} />);
  expect(screen.getByRole('slider',{name:label})).toBeTruthy();
  expect(screen.getByText(label).title).toBe(label);
  expect(screen.getByText(label).previousElementSibling?.getAttribute('role')).toBe('slider');
});
test('pin buttons use the approved pushpin rotated clockwise in both states', () => {
  render(<PinButton id="test:gain" name="Gain" />);
  const pin = screen.getByRole('button',{name:'Pin Gain'});
  expect(pin.querySelector('g')?.getAttribute('transform')).toBe('rotate(45 12 12)');
  expect(pin.querySelector('path')?.getAttribute('fill')).toBe('none');
  fireEvent.click(pin);
  expect(pin.getAttribute('aria-pressed')).toBe('true');
  expect(pin.querySelector('path')?.getAttribute('fill')).toBe('currentColor');
});
