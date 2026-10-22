// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Patches, emptyPatch, formatPatchValue, preparePatchInstance } from './Patches';
import { PinButton, PinnedSource } from './pinnedComponents';
import { gainPatch, prepare } from './teiaModel';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: (command:string, ...args:unknown[]) => command === 'get_instruments' ? Promise.resolve([]) : invoke(command, ...args) }));
beforeEach(() => { localStorage.clear(); localStorage.setItem('vira.pinned-components', JSON.stringify(['patch:Gain.json','patch:Other.json','patch:Third.json'])); HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; });
afterEach(() => { cleanup(); invoke.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const state = { generation: '7', runtimeGeneration: '7', record: null, editorOpen: false, peak: 0, renderFailures: 0, restoreError: null, running: true };
const loaded = { ...state, record: { name: 'Gain.json', prepared: prepare(gainPatch), overrides: {}, bypass: false } };
test('bypass disables ON/OFF until processing is restored', async () => {
  let current = { ...loaded, record: { ...loaded.record, passthrough: false } };
  invoke.mockImplementation((command: string, args?: { action: string; value: number }) => {
    if (command === 'teia_library') return Promise.resolve({ files: ['Gain.json'] });
    if (command === 'patches_state') return Promise.resolve([{ slot: 2, state: current }]);
    if (command === 'patches_control') {
      current = { ...current, record: { ...current.record, [args!.action]: Boolean(args!.value) } };
      return Promise.resolve(current);
    }
    return Promise.resolve();
  });
  render(<Patches />);
  const bypass = await screen.findByRole('button', { name: 'Bypass Gain' });
  fireEvent.click(bypass);
  await waitFor(() => expect(bypass.getAttribute('aria-pressed')).toBe('true'));
  expect(invoke).toHaveBeenCalledWith('patches_control', { slot: 2, action: 'passthrough', parameter: null, value: 1, generation: '7' });
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  fireEvent.click(screen.getByRole('switch'));
  expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
  expect(invoke).not.toHaveBeenCalledWith('patches_control', expect.objectContaining({ action: 'bypass' }));
  expect(bypass.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(bypass);
  await waitFor(() => expect(bypass.getAttribute('aria-pressed')).toBe('false'));
  expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'));
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
});
test('bypass is unavailable for patches without audio inputs', async () => {
  const record = { ...loaded.record, installed_document: { nodes: [], links: [] } };
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'teia_library' ? { files: ['Gain.json'] } : [{ slot: 0, state: { ...loaded, record } }]));
  render(<Patches />);
  expect((await screen.findByRole('button', { name: 'Bypass Gain' }) as HTMLButtonElement).disabled).toBe(true);
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
  expect(JSON.parse(localStorage.getItem('vira.pinned-components')!)).toContain('patch:Gain.json');
  record = { ...record, name: 'My stereo effect.json' };
  await waitFor(() => expect(JSON.parse(localStorage.getItem('vira.pinned-components')!)).toContain('patch:My stereo effect.json'));
  expect(screen.getByRole('listitem', {name:'My stereo effect'})).toBeTruthy();
});
test('edit, toggle and parameter changes target the correct instance and generation', async () => {
  invoke.mockImplementation((command: string, args?: { value: number; action: string }) => Promise.resolve(command === 'teia_library' ? { files: ['Gain.json'] } : command === 'patches_state' ? [{ slot: 2, state: loaded }] : command === 'patches_control' ? { ...loaded, record: { ...loaded.record, bypass: args?.action === 'bypass' }, parameters: { 'vira-factory-stereo-gain': args?.value } } : undefined));
  render(<Patches />);
  const toggle = await screen.findByRole('switch');
  fireEvent.click(screen.getByRole('button', { name: 'Gain' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('teia_open_editor', { slot: 2 }));
  fireEvent.click(toggle);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patches_control', { slot: 2, action: 'bypass', parameter: null, value: 1, generation: '7' }));
  fireEvent.keyDown(screen.getByRole('slider', { name: 'gain' }), { key: 'End' });
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patches_control', { slot: 2, action: 'parameter', parameter: 'vira-factory-stereo-gain', value: 2, generation: '7' }));
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
  expect(first.getAttribute('aria-current')).toBeNull();
  expect(JSON.parse(localStorage.getItem('vira.pinned-components')!)).toEqual(['patch:Other.json', 'patch:Third.json', 'patch:Gain.json']);
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

test('only explicit pins appear, with no heading, add action, selection or deletion', async () => {
  localStorage.clear();
  invoke.mockImplementation(command => Promise.resolve(command === 'patches_state' ? [{slot:0,state:loaded}] : []));
  render(<><PinButton id="patch:Gain.json" name="Gain" /><Patches /></>);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patches_state'));
  expect(screen.queryByRole('region', {name:'Pinned components'})).toBeNull();
  fireEvent.click(screen.getByRole('button', {name:'Pin Gain'}));
  const row = await screen.findByRole('listitem', {name:'Gain'});
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.queryByRole('button', {name:'+ Add patch'})).toBeNull();
  fireEvent.click(row); fireEvent.keyDown(window,{key:'Delete'}); fireEvent.keyDown(window,{key:'Backspace'});
  expect(row.getAttribute('aria-current')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(invoke.mock.calls.some(([cmd]) => cmd === 'patches_remove')).toBe(false);
  fireEvent.click(screen.getByRole('button', {name:'Pin Gain'}));
  expect(screen.queryByRole('region', {name:'Pinned components'})).toBeNull();
});
test('generic component pins share live controls and disappear when their source is removed', async () => {
  localStorage.setItem('vira.pinned-components', JSON.stringify(['routing:gain']));
  invoke.mockImplementation(() => Promise.resolve([]));
  const change = vi.fn();
  const source = <PinnedSource id="routing:gain" name="Gain" show={false}><input type="number" aria-label="Processor gain" defaultValue={1} onChange={e => change(Number(e.target.value))} /></PinnedSource>;
  const view = render(<>{source}<Patches /></>);
  fireEvent.change(await screen.findByRole('spinbutton', {name:'Processor gain'}),{target:{value:'2'}});
  expect(change).toHaveBeenCalledWith(2);
  view.rerender(<Patches />);
  await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull());
});
