// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Routing, type Graph } from './Routing';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const graph: Graph = { nodes: [{ id: 'a-eq', label: 'EQ', kind: 'eq', deck: 0, x: 20, y: 60, value: 1 }, { id: 'a-fader', label: 'Fader', kind: 'fader', deck: 0, x: 220, y: 60, value: 1 }, { id: 'b-fader', label: 'Fader B', kind: 'fader', deck: 1, x: 220, y: 260, value: 1 }], wires: [{ from: 'a-eq', output: 'audio', to: 'a-fader', input: 'audio', gain: .6 }] };
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}
beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 80, top: 200, width: 1280, height: 800, right: 1360, bottom: 1000, x: 80, y: 200, toJSON: () => ({}) });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) });
});
afterEach(() => { cleanup(); invoke.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() {
  invoke.mockImplementation(command => Promise.resolve(command === 'get_routing_graph' || command === 'default_routing_graph' ? structuredClone(graph) : undefined));
  const view = render(<Routing />); await screen.findByRole('button', { name: 'a-eq output audio' }); return view;
}
const canvas = () => document.querySelector('.routing-canvas')!;
function create(kind = 'Compressor', wire = false) {
  fireEvent.doubleClick(wire ? document.querySelector('[data-wire="0"]')! : canvas(), { clientX: 480, clientY: 600 });
  fireEvent.click(screen.getByRole('menuitem', { name: kind === 'Sine instrument' ? 'Instruments ›' : 'Effects ›' }));
  fireEvent.click(screen.getByRole('menuitem', { name: kind }));
}
async function applied() {
  fireEvent.click(screen.getByRole('button', { name: 'Apply routing' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_routing_graph', expect.anything()));
  return invoke.mock.calls.filter(([command]) => command === 'set_routing_graph').at(-1)![1].graph as Graph;
}
test('drag preview follows viewport coordinates at zoom and release outside cancels', async () => {
  await mount();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'a-eq output audio' }), { button: 0, pointerId: 1, clientX: 212, clientY: 293 });
  fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 480, clientY: 600 });
  expect(screen.getByTestId('wire-preview').getAttribute('d')).toMatch(/500 500$/);
  fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: 480, clientY: 600 });
  expect(screen.queryByTestId('wire-preview')).toBeNull();
  expect((screen.getByRole('button', { name: 'Apply routing' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 700, clientY: 600 });
  expect(screen.queryByTestId('wire-preview')).toBeNull();
});
test('dragging onto an input branches without applying audio early', async () => {
  await mount();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'a-eq output audio' }), { button: 0, pointerId: 1 });
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByRole('button', { name: 'b-fader input audio' }));
  fireEvent.pointerUp(canvas(), { pointerId: 1 });
  expect(screen.queryByTestId('wire-preview')).toBeNull();
  expect(invoke).not.toHaveBeenCalledWith('set_routing_graph', expect.anything());
  expect((await applied()).wires).toEqual([...graph.wires, { ...graph.wires[0], to: 'b-fader', gain: 1 }]);
});
test('double-click cable menu inserts an effect and preserves the wire gain', async () => {
  await mount(); create('Compressor', true);
  expect(screen.getByRole('button', { name: /input sidechain/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /output dry/ })).toBeTruthy();
  const value = await applied();
  expect(value.nodes.at(-1)).toMatchObject({ kind: 'compressor', x: 500, y: 500 });
  expect(value.wires).toEqual([expect.objectContaining({ from: 'a-eq', to: value.nodes.at(-1)!.id, gain: .6 }), expect.objectContaining({ to: 'a-fader', gain: 1 })]);
  expect(screen.queryByRole('combobox', { name: 'Insert into wire' })).toBeNull();
});
test('empty-space categories create an instrument without inserting a wire', async () => {
  await mount(); create('Sine instrument');
  const value = await applied(); expect(value.nodes.at(-1)).toMatchObject({ kind: 'oscillator', x: 500, y: 500 }); expect(value.wires).toEqual(graph.wires);
});
test('draft, selection and undo history survive navigating away and back', async () => {
  const view = await mount(); create();
  view.rerender(<Routing active={false} />);
  fireEvent.keyDown(window, { key: 'Backspace' });
  view.rerender(<Routing active />);
  expect(screen.getByRole('button', { name: /input sidechain/ })).toBeTruthy();
  expect(document.querySelector('.routing-node.selected')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'z', metaKey: true });
  expect(screen.queryByRole('button', { name: /input sidechain/ })).toBeNull();
  fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
  expect(screen.getByRole('button', { name: /input sidechain/ })).toBeTruthy();
  expect(invoke.mock.calls.filter(([command]) => command === 'get_routing_graph')).toHaveLength(1);
});
test('delete selected node removes its connections; undo and redo restore whole edits', async () => {
  await mount(); create('Compressor', true);
  const node = document.querySelector('.routing-node.selected')!;
  expect(node).toBeTruthy(); fireEvent.keyDown(window, { key: 'Backspace' });
  expect(screen.queryByRole('button', { name: /input sidechain/ })).toBeNull();
  fireEvent.keyDown(window, { key: 'z', metaKey: true });
  expect(document.querySelectorAll('[data-wire]')).toHaveLength(2);
  expect(screen.getByRole('button', { name: /input sidechain/ })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
  expect(document.querySelectorAll('[data-wire]')).toHaveLength(0);
});
test('selected wires delete, empty-space deselects, and built-in nodes can be deleted', async () => {
  await mount();
  fireEvent.pointerDown(document.querySelector('[data-wire="0"]')!, { button: 0 });
  fireEvent.pointerDown(canvas(), { button: 0 });
  expect(document.querySelector('.routing-wires .selected')).toBeNull();
  fireEvent.keyDown(window, { key: 'Delete' }); expect(document.querySelector('[data-wire="0"]')).toBeTruthy();
  fireEvent.pointerDown(document.querySelector('[data-wire="0"]')!, { button: 0 });
  fireEvent.keyDown(window, { key: 'Delete' }); expect(document.querySelector('[data-wire="0"]')).toBeNull();
  fireEvent.pointerDown(document.querySelector('[data-node-id="a-eq"]')!, { button: 0 });
  fireEvent.keyDown(window, { key: 'Backspace' }); expect(screen.queryByRole('button', { name: 'a-eq output audio' })).toBeNull();
  fireEvent.keyDown(window, { key: 'z', metaKey: true }); expect(screen.getByRole('button', { name: 'a-eq output audio' })).toBeTruthy();
});
test('dragging a node is one undoable edit and release preserves selection', async () => {
  await mount();
  const title = document.querySelector('[data-node-id="a-eq"] .routing-node-title')!;
  fireEvent.pointerDown(title, { button: 0, pointerId: 1, clientX: 96, clientY: 248 });
  fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 176, clientY: 328 });
  fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 256, clientY: 408 });
  fireEvent.pointerUp(canvas(), { pointerId: 1 });
  expect((document.querySelector('[data-node-id="a-eq"]') as HTMLElement).style.left).toBe('220px');
  fireEvent.keyDown(window, { key: 'z', metaKey: true });
  expect((document.querySelector('[data-node-id="a-eq"]') as HTMLElement).style.left).toBe('20px');
  expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
});
test('shortcuts leave text editing alone and Escape cancels a wire/menu', async () => {
  await mount(); create();
  const field = screen.getByRole('spinbutton');
  fireEvent.keyDown(field, { key: 'Backspace' }); fireEvent.keyDown(field, { key: 'z', metaKey: true });
  expect(screen.getByRole('spinbutton')).toBeTruthy();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'a-eq output audio' }), { button: 0 });
  fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByTestId('wire-preview')).toBeNull();
  fireEvent.doubleClick(canvas(), { clientX: 480, clientY: 600 }); fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull();
});
test('failed validation keeps draft editable and revert restores the accepted graph', async () => {
  await mount(); create(); invoke.mockRejectedValueOnce('Feedback loops are not supported');
  fireEvent.click(screen.getByRole('button', { name: 'Apply routing' })); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Revert edits' }));
  expect(screen.queryByRole('button', { name: /input sidechain/ })).toBeNull();
  expect((screen.getByRole('button', { name: 'Apply routing' }) as HTMLButtonElement).disabled).toBe(true);
});

test('a wire gain drag is one undo action, including Cmd-Z while its slider has focus', async () => {
  await mount(); fireEvent.pointerDown(document.querySelector('[data-wire="0"]')!, { button: 0 });
  const slider = screen.getByRole('slider', { name: 'Wire gain' });
  fireEvent.focus(slider); fireEvent.pointerDown(slider, { button: 0 });
  fireEvent.change(slider, { target: { value: '.4' } }); fireEvent.change(slider, { target: { value: '.3' } });
  fireEvent.pointerUp(window);
  fireEvent.keyDown(slider, { key: 'z', metaKey: true });
  expect(document.querySelector('[data-wire="0"] title')?.textContent).toContain('gain 0.6');
  expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
  expect(document.querySelector('[data-wire="0"] title')?.textContent).toContain('gain 0.3');
});
test('selecting a node header exits numeric editing so Backspace deletes the node', async () => {
  await mount(); create();
  const field = screen.getByRole('spinbutton') as HTMLInputElement; field.focus();
  expect(document.activeElement).toBe(field);
  const title = document.querySelector('.routing-node.selected .routing-node-title')!;
  fireEvent.pointerDown(title, { button: 0, pointerId: 1, clientX: 480, clientY: 600 }); fireEvent.pointerUp(canvas(), { pointerId: 1 });
  expect(document.activeElement).not.toBe(field);
  fireEvent.keyDown(window, { key: 'Backspace' });
  expect(screen.queryByRole('spinbutton')).toBeNull();
});

test('leaving Routing releases field focus without discarding its draft', async () => {
  const view = await mount(); create();
  const field = screen.getByRole('spinbutton') as HTMLInputElement; field.focus();
  fireEvent.change(field, { target: { value: '.2' } });
  view.rerender(<Routing active={false} />);
  expect(document.activeElement).not.toBe(field);
  view.rerender(<Routing active />);
  expect((screen.getByRole('spinbutton') as HTMLInputElement).valueAsNumber).toBe(0.2);
});
