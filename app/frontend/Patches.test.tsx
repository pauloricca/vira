// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Patches, emptyPatch, formatPatchValue, preparePatchInstance } from './Patches';
import { gainPatch, prepare } from './teiaModel';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
beforeEach(() => { localStorage.clear(); HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; });
afterEach(() => { cleanup(); invoke.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const state = { generation: '7', runtimeGeneration: '7', record: null, editorOpen: false, peak: 0, renderFailures: 0, restoreError: null, running: true };
const loaded = { ...state, record: { name: 'Gain.json', prepared: prepare(gainPatch), overrides: {}, bypass: false } };
test('clears a transient library error after polling recovers', async () => {
  let failed = true;
  invoke.mockImplementation((command: string) => command === 'teia_library'
    ? failed ? Promise.reject('Too many open files (os error 24)') : Promise.resolve({ files: [] })
    : Promise.resolve([]));
  render(<Patches />);
  await screen.findByRole('alert');
  failed = false;
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
test('new patches connect each stereo input channel to its matching output', () => {
  const patch = emptyPatch('Empty');
  expect(patch.nodes.map(n => n.type)).toEqual(['AudioInput', 'AudioOut']);
  expect(patch.links).toEqual([
    { from: { node: 'input', port: 'left' }, to: { node: 'output', port: 'left' } },
    { from: { node: 'input', port: 'right' }, to: { node: 'output', port: 'right' } },
  ]);
  expect(preparePatchInstance(patch).prepared.parameters).toEqual([]);
  expect(preparePatchInstance(patch).draft).toBe(false);
});
test.each([[4000, '4k'], [4200, '4.2k'], [-4200, '-4.2k'], [123.456, '123'], [0.123, '0.12'], [999999, '1M'], [0.00001, '1e-5']])('formats %s as %s', (value, result) => expect(formatPatchValue(Number(value))).toBe(result));
test('the patch panel follows the name edited in the document before and after saving', async () => {
  let record = { ...loaded.record, document: { ...gainPatch, name: 'My stereo effect' } };
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'teia_library' ? { files: [record.name] } : command === 'patches_state' ? [{ slot: 0, state: { ...loaded, record } }] : undefined));
  render(<Patches />);
  await screen.findByRole('listitem', { name: 'My stereo effect' });
  expect(screen.getByRole('switch', { name: 'Enable My stereo effect' })).toBeTruthy();
  expect(screen.getByText('My stereo effect').title).toBe('Gain.json');
  record = { ...record, name: 'My stereo effect.json' };
  await waitFor(() => expect(screen.getByText('My stereo effect').title).toBe('My stereo effect.json'));
});
test('the dropdown lists every saved patch, prevents duplicates, and adds the selected patch', async () => {
  let entries = [{ slot: 0, state: loaded }];
  invoke.mockImplementation((command: string) => {
    if (command === 'teia_library') return Promise.resolve({ files: ['Gain.json', 'Other.json'] });
    if (command === 'patches_state') return Promise.resolve(entries);
    if (command === 'teia_read') return Promise.resolve({ document: gainPatch, hash: 'hash' });
    if (command === 'patches_add') { const added = { slot: 1, state: { ...loaded, record: { ...loaded.record, name: 'Other.json' } } }; entries = [...entries, added]; return Promise.resolve(added); }
    return Promise.resolve();
  });
  render(<Patches />);
  await screen.findByRole('switch', { name: 'Enable Gain' });
  fireEvent.click(screen.getByRole('button', { name: '+ Add patch' }));
  expect(screen.getAllByRole('menuitem')[0].textContent).toBe('… New patch');
  expect((screen.getByRole('menuitem', { name: 'Gain · added' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Other' }));
  await screen.findByRole('switch', { name: 'Enable Other' });
  expect(invoke).toHaveBeenCalledWith('patches_add', expect.objectContaining({ name: 'Other.json', savedHash: 'hash' }));
});
test('new patch creates a unique library document, adds its instance and opens its editor', async () => {
  let entries: { slot: number; state: typeof state | typeof loaded }[] = [];
  invoke.mockImplementation((command: string) => {
    if (command === 'teia_library') return Promise.resolve({ files: ['New patch.json'] });
    if (command === 'patches_state') return Promise.resolve(entries);
    if (command === 'teia_read') return Promise.resolve({ document: emptyPatch('New patch 2'), hash: 'new-hash' });
    if (command === 'patches_add') { const added = { slot: 3, state: { ...loaded, record: { ...loaded.record, name: 'New patch 2.json' } } }; entries = [added]; return Promise.resolve(added); }
    return Promise.resolve();
  });
  render(<Patches />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patches_state'));
  fireEvent.click(screen.getByRole('button', { name: '+ Add patch' }));
  await screen.findByRole('menuitem', { name: 'New patch' });
  fireEvent.click(screen.getByRole('menuitem', { name: '… New patch' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('teia_open_editor', { slot: 3 }));
  expect(invoke).toHaveBeenCalledWith('teia_import', { name: 'New patch 2.json', document: emptyPatch('New patch 2') });
});
test('edit, toggle and parameter changes target the correct instance and generation', async () => {
  invoke.mockImplementation((command: string, args?: { value: number; action: string }) => Promise.resolve(command === 'teia_library' ? { files: ['Gain.json'] } : command === 'patches_state' ? [{ slot: 2, state: loaded }] : command === 'patches_control' ? { ...loaded, record: { ...loaded.record, bypass: args?.action === 'bypass' }, parameters: { 'vira-factory-stereo-gain': args?.value } } : undefined));
  render(<Patches />);
  const toggle = await screen.findByRole('switch');
  fireEvent.doubleClick(screen.getByRole('listitem', { name: 'Gain' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('teia_open_editor', { slot: 2 }));
  fireEvent.click(toggle);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patches_control', { slot: 2, action: 'bypass', parameter: null, value: 1, generation: '7' }));
  fireEvent.keyDown(screen.getByRole('slider', { name: 'gain' }), { key: 'End' });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patches_control', { slot: 2, action: 'parameter', parameter: 'vira-factory-stereo-gain', value: 2, generation: '7' }));
});

test('removal requires confirmation, cancels safely, and leaves the saved patch available to add again', async () => {
  let entries: { slot: number; state: typeof loaded }[] = [{ slot: 2, state: loaded }];
  invoke.mockImplementation((command: string) => {
    if (command === 'teia_library') return Promise.resolve({ files: ['Gain.json'] });
    if (command === 'patches_state') return Promise.resolve(entries);
    if (command === 'patches_remove') entries = [];
    return Promise.resolve();
  });
  render(<Patches />);
  const row = await screen.findByRole('listitem', { name: 'Gain' });
  fireEvent.click(row);
  fireEvent.keyDown(window, { key: 'Delete' });
  await screen.findByRole('dialog', { name: 'Remove patch?' });
  expect(invoke.mock.calls.some(([command]) => command === 'patches_remove')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('switch')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Delete' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove patch' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patches_remove', { slot: 2, generation: '7' }));
  await waitFor(() => expect(screen.queryByRole('switch')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '+ Add patch' }));
  expect((screen.getByRole('menuitem', { name: 'Gain' }) as HTMLButtonElement).disabled).toBe(false);
  expect(invoke.mock.calls.some(([command]) => command.includes('delete'))).toBe(false);
});
test('an open patch editor prevents removing its instance', async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'teia_library' ? { files: ['Gain.json'] } : [{ slot: 2, state: { ...loaded, editorOpen: true } }]));
  render(<Patches />);
  fireEvent.click(await screen.findByRole('listitem', { name: 'Gain' }));
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('alert').textContent).toMatch(/Close the patch editor/);
  expect(invoke.mock.calls.some(([command]) => command === 'patches_remove')).toBe(false);
});

test('click selects one patch, clicking anywhere else deselects, and deletion does not intercept text editing', async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'teia_library' ? { files: ['Gain.json', 'Other.json'] } : [{ slot: 0, state: loaded }, { slot: 1, state: { ...loaded, record: { ...loaded.record, name: 'Other.json' } } }]));
  render(<><Patches /><input aria-label="Outside search" /></>);
  const first = await screen.findByRole('listitem', { name: 'Gain' });
  const second = screen.getByRole('listitem', { name: 'Other' });
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove Gain' })).toBeNull();
  fireEvent.click(first);
  expect(first.getAttribute('aria-current')).toBe('true');
  fireEvent.click(second);
  expect(first.getAttribute('aria-current')).toBeNull();
  expect(second.getAttribute('aria-current')).toBe('true');
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Backspace' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('textbox'));
  expect(second.getAttribute('aria-current')).toBeNull();
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(first);
  fireEvent.click(screen.getByRole('button', { name: '+ Add patch' }));
  expect(first.getAttribute('aria-current')).toBeNull();
});
test('double-clicking a knob resets its value without opening the patch editor', async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'teia_library' ? { files: ['Gain.json'] } : command === 'patches_state' ? [{ slot: 0, state: loaded }] : loaded));
  render(<Patches />);
  fireEvent.doubleClick(await screen.findByRole('slider', { name: 'gain' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patches_control', expect.objectContaining({ parameter: 'vira-factory-stereo-gain', value: 1 })));
  expect(invoke.mock.calls.some(([command]) => command === 'teia_open_editor')).toBe(false);
});
test('dragging reorders patches, survives polling and remounting, and leaves audio routing alone', async () => {
  class TestDragEvent extends MouseEvent {
    dataTransfer: DataTransfer;
    constructor(type: string, init: MouseEventInit & { dataTransfer: DataTransfer }) { super(type, init); this.dataTransfer = init.dataTransfer; }
  }
  vi.stubGlobal('DragEvent', TestDragEvent);
  const entries = ['Gain', 'Other', 'Third'].map((name, slot) => ({ slot, state: { ...loaded, record: { ...loaded.record, name: `${name}.json` } } }));
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'teia_library' ? { files: entries.map(e => e.state.record.name) } : entries));
  const view = render(<Patches />);
  const first = await screen.findByRole('listitem', { name: 'Gain' });
  const third = screen.getByRole('listitem', { name: 'Third' });
  vi.spyOn(third, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 80 } as DOMRect);
  const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  fireEvent.pointerDown(screen.getAllByRole('slider')[0], { button: 0 });
  expect(fireEvent.dragStart(first, { dataTransfer })).toBe(false);
  expect(dataTransfer.setData).not.toHaveBeenCalled();
  fireEvent.pointerDown(first, { button: 0 });
  fireEvent.dragStart(first, { dataTransfer });
  fireEvent.dragOver(third, { dataTransfer, clientY: 175 });
  expect(third.classList.contains('drop-after')).toBe(true);
  fireEvent.drop(third, { dataTransfer, clientY: 175 });
  expect(screen.getAllByRole('listitem').map(e => e.getAttribute('aria-label'))).toEqual(['Other', 'Third', 'Gain']);
  expect(first.getAttribute('aria-current')).toBe('true');
  expect(JSON.parse(localStorage.getItem('vira.patch-order')!)).toEqual(['Other.json', 'Third.json', 'Gain.json']);
  await waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === 'patches_state').length).toBeGreaterThan(1));
  expect(screen.getAllByRole('listitem').map(e => e.getAttribute('aria-label'))).toEqual(['Other', 'Third', 'Gain']);
  view.unmount(); render(<Patches />);
  await screen.findByRole('listitem', { name: 'Gain' });
  expect(screen.getAllByRole('listitem').map(e => e.getAttribute('aria-label'))).toEqual(['Other', 'Third', 'Gain']);
  const lastAgain = screen.getByRole('listitem', { name: 'Gain' });
  const other = screen.getByRole('listitem', { name: 'Other' });
  vi.spyOn(other, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 80 } as DOMRect);
  fireEvent.dragStart(lastAgain, { dataTransfer });
  fireEvent.dragOver(other, { dataTransfer, clientY: 105 });
  expect(other.classList.contains('drop-before')).toBe(true);
  fireEvent.dragEnd(lastAgain);
  expect(screen.getAllByRole('listitem').map(e => e.getAttribute('aria-label'))).toEqual(['Other', 'Third', 'Gain']);
  fireEvent.dragStart(lastAgain, { dataTransfer });
  fireEvent.drop(other, { dataTransfer, clientY: 105 });
  expect(screen.getAllByRole('listitem').map(e => e.getAttribute('aria-label'))).toEqual(['Gain', 'Other', 'Third']);
  expect(invoke.mock.calls.some(([command]) => ['set_routing_graph', 'patches_remove', 'patches_control'].includes(command))).toBe(false);
  vi.unstubAllGlobals();
});

test('Add patch closes on clicks outside the dropdown, including within the patch panel and stopped pointer events', async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'teia_library' ? { files: ['Gain.json'] } : [{ slot: 0, state: loaded }]));
  render(<><Patches /><button onPointerDown={e => e.stopPropagation()}>Outside control</button></>);
  const row = await screen.findByRole('listitem', { name: 'Gain' });
  const add = screen.getByRole('button', { name: '+ Add patch' });
  fireEvent.click(add);
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.pointerDown(screen.getByRole('menu'));
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.pointerDown(row);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(add);
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside control' }));
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(add);
  fireEvent.click(screen.getByRole('heading', { name: 'Patches' }));
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(add);
  fireEvent.pointerDown(add);
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.click(add);
  expect(screen.queryByRole('menu')).toBeNull();
});

test('recovery status follows native suspension and clears automatically when processing resumes', async () => {
  let recovering = true;
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'teia_library' ? { files: ['Gain.json'] } : [{ slot: 0, state: { ...loaded, suspended: recovering } }]));
  render(<Patches />);
  expect((await screen.findByRole('status')).textContent).toBe('Recovering audio…');
  expect(screen.getByRole('slider', { name: 'gain' }).getAttribute('aria-disabled')).toBe('true');
  expect(screen.queryByRole('button', { name: /Reset DSP/ })).toBeNull();
  recovering = false;
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(screen.getByRole('slider', { name: 'gain' }).getAttribute('aria-disabled')).toBe('false');
  expect(screen.queryByRole('alert')).toBeNull();
});
test('transient recovery errors do not leave a stale manual reset warning', async () => {
  invoke.mockImplementation((command: string) => command === 'patches_control' ? Promise.reject('Patch audio is recovering automatically; try again shortly') : Promise.resolve(command === 'teia_library' ? { files: ['Gain.json'] } : [{ slot: 0, state: loaded }]));
  render(<Patches />);
  fireEvent.keyDown(await screen.findByRole('slider', { name: 'gain' }), { key: 'End' });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patches_control', expect.anything()));
  expect(screen.queryByRole('alert')).toBeNull();
});
