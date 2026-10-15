// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Routing, type Graph } from './Routing';
const { invoke, routingEvents } = vi.hoisted(() => ({ invoke: vi.fn(), routingEvents: { callback: null as ((event: { payload: Graph }) => void) | null } }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn((_name, callback) => { routingEvents.callback = callback; return Promise.resolve(() => { routingEvents.callback = null; }); }) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const graph: Graph = { nodes: [{ id: 'a-eq', label: 'EQ', kind: 'eq', deck: 0, x: 20, y: 60, value: 1 }, { id: 'a-fader', label: 'Fader', kind: 'fader', deck: 0, x: 220, y: 60, value: 1 }, { id: 'b-fader', label: 'Fader B', kind: 'fader', deck: 1, x: 220, y: 260, value: 1 }], wires: [{ from: 'a-eq', output: 'audio', to: 'a-fader', input: 'audio', gain: .6 }] };
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
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
  expect(invoke.mock.calls.filter(([command]) => command === 'get_routing_graph')).toHaveLength(2);
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
test('new patch nodes join an existing routing draft and survive undo of its prior edit', async () => {
  const view = await mount(); create('Gain');
  view.rerender(<Routing active={false} />);
  const patch = { id: 'patch-0', kind: 'patch' as const, deck: null, label: 'New patch', x: 800, y: 500, value: 1 };
  invoke.mockResolvedValue({ nodes: [...graph.nodes, patch], wires: [...graph.wires, { from: 'a-fader', output: 'audio', to: patch.id, input: 'audio', gain: 1 }] });
  view.rerender(<Routing active />);
  await screen.findByRole('button', { name: 'patch-0 input audio' });
  expect(screen.getByRole('spinbutton')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'z', metaKey: true });
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(screen.getByRole('button', { name: 'patch-0 input audio' })).toBeTruthy();
});

test('removed patch nodes and wires disappear from a routing draft and cannot return through undo', async () => {
  const patch = { id: 'patch-0', kind: 'patch' as const, deck: null, label: 'Patch', x: 800, y: 500, value: 1 };
  invoke.mockResolvedValue({ nodes: [...graph.nodes, patch], wires: [...graph.wires, { from: 'a-fader', output: 'audio', to: patch.id, input: 'audio', gain: 1 }] });
  const view = render(<Routing />);
  await screen.findByRole('button', { name: 'patch-0 input audio' });
  create('Gain'); view.rerender(<Routing active={false} />);
  invoke.mockResolvedValue(structuredClone(graph));
  view.rerender(<Routing active />);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'patch-0 input audio' })).toBeNull());
  expect(screen.getByRole('spinbutton')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'z', metaKey: true });
  expect(screen.queryByRole('button', { name: 'patch-0 input audio' })).toBeNull();
  expect(screen.queryByRole('spinbutton')).toBeNull();
});

test('patch nodes have only their declared input pins and double-click opens their editor', async () => {
  const patch = { id: 'patch-3', kind: 'patch' as const, deck: null, label: 'Synth', x: 800, y: 500, value: 1, patch_inputs: [] };
  invoke.mockResolvedValue({ nodes: [...graph.nodes, patch], wires: graph.wires });
  render(<Routing />);
  await screen.findByRole('button', { name: 'patch-3 output audio' });
  expect(screen.queryByRole('button', { name: /patch-3 input/ })).toBeNull();
  fireEvent.doubleClick(document.querySelector('[data-node-id="patch-3"]')!);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('teia_open_editor', { slot: 3 }));
});
test('live editor updates add independent pins and their default wires while preserving drafts and undo', async () => {
  const patch = { id: 'patch-0', kind: 'patch' as const, deck: null, label: 'Patch', x: 800, y: 500, value: 1, patch_inputs: [] as { id: string; label: string }[] };
  invoke.mockResolvedValue({ nodes: [...graph.nodes, patch], wires: graph.wires });
  render(<Routing />);
  await screen.findByRole('button', { name: 'patch-0 output audio' }); create('Gain');
  const updated = { nodes: [...graph.nodes, { ...patch, patch_inputs: [{ id: 'first', label: 'First source' }, { id: 'second', label: 'Second source' }] }], wires: [...graph.wires, ...['first', 'second'].map(input => ({ from: 'a-fader', output: 'audio', to: 'patch-0', input, gain: 1 }))] };
  act(() => routingEvents.callback?.({ payload: updated }));
  expect(screen.getByRole('button', { name: 'patch-0 input first' }).textContent).toBe('First source');
  expect(screen.getByRole('button', { name: 'patch-0 input second' })).toBeTruthy();
  expect(screen.getByRole('spinbutton')).toBeTruthy();
  act(() => routingEvents.callback?.({ payload: { ...updated, nodes: [...graph.nodes, { ...patch, patch_inputs: [{ id: 'second', label: 'Second source' }] }], wires: updated.wires.filter(w => w.input !== 'first') } }));
  expect(screen.queryByRole('button', { name: 'patch-0 input first' })).toBeNull();
  fireEvent.keyDown(window, { key: 'z', metaKey: true });
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(screen.queryByRole('button', { name: 'patch-0 input first' })).toBeNull();
  expect(screen.getByRole('button', { name: 'patch-0 input second' })).toBeTruthy();
});
test('deleting a routing patch confirms removal of the session instance instead of leaving a silent panel entry', async () => {
  const patch = { id: 'patch-0', kind: 'patch' as const, deck: null, label: 'Patch', x: 800, y: 500, value: 1, patch_inputs: [] };
  let removed = false;
  invoke.mockImplementation(command => {
    if (command === 'patches_state') return Promise.resolve([{ slot: 0, state: { generation: '7', record: {} } }]);
    if (command === 'patches_remove') { removed = true; return Promise.resolve(); }
    return Promise.resolve(removed ? graph : { nodes: [...graph.nodes, patch], wires: graph.wires });
  });
  render(<Routing />);
  await screen.findByRole('button', { name: 'patch-0 output audio' });
  fireEvent.pointerDown(document.querySelector('[data-node-id="patch-0"]')!, { button: 0 });
  fireEvent.keyDown(window, { key: 'Delete' });
  await screen.findByRole('dialog', { name: 'Remove patch?' });
  expect(invoke.mock.calls.some(([command]) => command === 'patches_remove')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'patch-0 output audio' })).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Delete' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove patch' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patches_remove', { slot: 0, generation: '7' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'patch-0 output audio' })).toBeNull());
  expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
});

test('selected cable exposes both endpoints and reconnecting its target preserves gain as one undoable edit', async () => {
  await mount();
  expect(screen.queryByRole('button', { name: 'Reconnect cable source' })).toBeNull();
  fireEvent.pointerDown(document.querySelector('[data-wire="0"]')!, { button: 0 });
  expect(screen.getByRole('button', { name: 'Reconnect cable source' })).toBeTruthy();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Reconnect cable target' }), { button: 0, pointerId: 4 });
  fireEvent.pointerMove(canvas(), { pointerId: 4, clientX: 480, clientY: 600 });
  expect(screen.getByTestId('wire-preview').getAttribute('d')).toMatch(/500 500$/);
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByRole('button', { name: 'b-fader input audio' }));
  fireEvent.pointerUp(canvas(), { pointerId: 4 });
  expect(invoke).not.toHaveBeenCalledWith('set_routing_graph', expect.anything());
  expect(screen.getByRole('slider', { name: 'Wire gain' }).getAttribute('value')).toBe('0.6');
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(document.querySelector('[data-wire="0"] title')?.textContent).toContain('a-eq → a-fader');
  expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  expect((await applied()).wires).toEqual([{ ...graph.wires[0], to: 'b-fader' }]);
});

test('source endpoint reconnects to a different output pin without creating an extra cable', async () => {
  await mount(); create('Sine instrument');
  fireEvent.pointerDown(document.querySelector('[data-wire="0"]')!, { button: 0 });
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Reconnect cable source' }), { button: 0, pointerId: 2 });
  fireEvent.pointerMove(canvas(), { pointerId: 2, clientX: 480, clientY: 600 });
  expect(screen.getByTestId('wire-preview').getAttribute('d')).toMatch(/^M 500 500/);
  const output = screen.getByRole('button', { name: /output cosine/ });
  vi.mocked(document.elementFromPoint).mockReturnValue(output);
  fireEvent.pointerUp(canvas(), { pointerId: 2 });
  expect((await applied()).wires).toEqual([{ ...graph.wires[0], from: output.getAttribute('data-node'), output: 'cosine' }]);
});

test('reconnect cancels on an incompatible port, empty space, Escape or pointer cancellation', async () => {
  await mount();
  fireEvent.pointerDown(document.querySelector('[data-wire="0"]')!, { button: 0 });
  for (const cancel of ['port', 'space', 'escape', 'pointer']) {
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Reconnect cable source' }), { button: 0, pointerId: 3 });
    if (cancel === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (cancel === 'pointer') fireEvent.pointerCancel(canvas(), { pointerId: 3 });
    else {
      vi.mocked(document.elementFromPoint).mockReturnValue(cancel === 'port' ? screen.getByRole('button', { name: 'b-fader input audio' }) : null);
      fireEvent.pointerUp(canvas(), { pointerId: 3 });
    }
    expect(screen.queryByTestId('wire-preview')).toBeNull();
    expect(document.querySelector('[data-wire="0"] title')?.textContent).toContain('a-eq → a-fader');
    expect((screen.getByRole('button', { name: 'Apply routing' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  }
});

test('reconnecting onto an existing connection rejects the duplicate and keeps the original', async () => {
  await mount();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'a-eq output audio' }), { button: 0, pointerId: 1 });
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByRole('button', { name: 'b-fader input audio' }));
  fireEvent.pointerUp(canvas(), { pointerId: 1 });
  fireEvent.pointerDown(document.querySelector('[data-wire="0"]')!, { button: 0 });
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Reconnect cable target' }), { button: 0, pointerId: 1 });
  fireEvent.pointerUp(canvas(), { pointerId: 1 });
  expect(screen.getByRole('alert').textContent).toContain('This connection already exists');
  expect((await applied()).wires).toEqual([...graph.wires, { ...graph.wires[0], to: 'b-fader', gain: 1 }]);
});
