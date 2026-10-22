// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Patches } from './Patches';
import { Patterns } from './Patterns';
import { patchPortPoint } from './Patching';
import { connectMusical, newPattern, normaliseBank, type Bank } from './patternModel';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
let bank: Bank;
class TestPointer extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } }
beforeEach(() => {
  const p = newPattern(); p.id = 'p'; p.name = 'Melody'; p.output = 42;
  bank = normaliseBank({ patterns: [p], outputCompensation: {} });
  invoke.mockImplementation((cmd, args) => { if (cmd === 'teia_library') return Promise.resolve({files:['FM.json']}); if (cmd === 'patches_state') return Promise.resolve([{slot:0,state:{record:{name:'FM.json'}}}]); if (cmd === 'patterns_state') return Promise.resolve({ bank: structuredClone(bank), inputs: [{id:44,name:"Controller"}, {id:45,name:"Synth A"}], outputs: [{ id: 42, name: 'Synth A' }, { id: 43, name: 'Synth B' }], instruments: [{ slot: 0, name: 'FM.json', loaded: true, running: true }], deckKeys: [{ key: 7, scale: 1 }, null], voices: {}, beat: 10, bpm: 120, clockReady: true, error: null }); if (cmd === 'patterns_save') bank = structuredClone(args.bank); return Promise.resolve(); });
  vi.stubGlobal('PointerEvent', TestPointer);
  vi.stubGlobal('DragEvent', class extends MouseEvent {dataTransfer: DataTransfer; constructor(type:string,init:DragEventInit) {super(type,init); this.dataTransfer=init.dataTransfer!;}});
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 80, top: 100, width: 1440, height: 880, right: 1520, bottom: 980, x: 80, y: 100, toJSON: () => ({}) });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) });
});
afterEach(() => { cleanup(); invoke.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { render(<Patterns active />); await screen.findByLabelText('Expand Melody'); }
const canvas = () => document.querySelector('.musical-canvas')!;
async function saved() { await waitFor(() => expect(invoke).toHaveBeenCalledWith('patterns_save', expect.anything())); }
test('adds several patterns to an occupied device input in either drag direction', async () => {
  for (const id of ['q', 'r']) {
    bank.patterns.push({...newPattern(), id, name:`Pattern ${id}`});
    bank.graph!.nodes.push({id:`pattern-${id}`, kind:'pattern', pattern:id, label:id, x:430, y:id === 'q' ? 270 : 470});
  }
  await mount();
  fireEvent.pointerDown(screen.getByLabelText('pattern-q output midi'), {button:0,pointerId:1});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('midi-42 input midi'));
  fireEvent.pointerUp(canvas(), {pointerId:1});
  await waitFor(() => expect(bank.graph!.wires).toHaveLength(2));
  // Reconnect handles remain on the selected cable ports.
  const device = bank.graph!.nodes.find(n => n.id === 'midi-42')!;
  expect(Number.parseFloat(screen.getByLabelText('Reconnect musical cable target').style.left)).toBe(patchPortPoint(device, 0, false).x);
  const pattern = bank.graph!.nodes.find(n => n.id === 'pattern-q')!;
  expect(Number.parseFloat(screen.getByLabelText('Reconnect musical cable source').style.left)).toBe(patchPortPoint(pattern, 1, true).x);
  fireEvent.pointerDown(canvas(), {button:0});
  expect(screen.queryByLabelText('Reconnect musical cable target')).toBeNull();
  fireEvent.pointerDown(screen.getByLabelText('midi-42 input midi'), {button:0,pointerId:2});
  expect(screen.getByTestId('musical-wire-preview')).toBeTruthy();
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('pattern-r output midi'));
  fireEvent.pointerUp(canvas(), {pointerId:2});
  await waitFor(() => expect(bank.graph!.wires).toHaveLength(3));
  expect(bank.graph!.wires.map(w => [w.from,w.to])).toEqual(['p','q','r'].map(id => [`pattern-${id}`,'midi-42']));
  expect(new Set(bank.graph!.wires.map(w => w.route)).size).toBe(3);
  fireEvent.keyDown(window, {key:'Delete'});
  await waitFor(() => expect(bank.graph!.wires).toHaveLength(2));
  expect(bank.graph!.wires.map(w => w.from)).toEqual(['pattern-p','pattern-q']);
});
test('input-origin drags retain duplicate and single root input protections', async () => {
  await mount();
  fireEvent.pointerDown(screen.getByLabelText('midi-42 input midi'), {button:0,pointerId:1});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('pattern-p output midi'));
  fireEvent.pointerUp(canvas(), {pointerId:1});
  expect(screen.getByRole('alert').textContent).toContain('already exists');
  expect(bank.graph!.wires).toHaveLength(1);
  fireEvent.pointerDown(screen.getByLabelText('pattern-p input notes'), {button:0,pointerId:2});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('deck-0 output notes'));
  fireEvent.pointerUp(canvas(), {pointerId:2});
  await waitFor(() => expect(bank.graph!.wires).toHaveLength(2));
  fireEvent.pointerDown(screen.getByLabelText('pattern-p input notes'), {button:0,pointerId:3});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('deck-1 output notes'));
  fireEvent.pointerUp(canvas(), {pointerId:3});
  expect(screen.getByRole('alert').textContent).toContain('existing input cable');
  expect(bank.graph!.wires.find(w => w.kind === 'notes')?.from).toBe('deck-0');
});
test('device input-origin drags accept note outputs and cancel on incompatible ports', async () => {
  await mount();
  fireEvent.pointerDown(screen.getByLabelText('midi-42 input midi'), {button:0,pointerId:1});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('pattern-p output notes'));
  fireEvent.pointerUp(canvas(), {pointerId:1});
  await waitFor(() => expect(bank.graph!.wires).toHaveLength(2));
  expect(bank.graph!.wires[1]).toMatchObject({from:'pattern-p',to:'midi-42',kind:'notes'});
  fireEvent.pointerDown(screen.getByLabelText('midi-42 input midi'), {button:0,pointerId:2});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('deck-0 output scale'));
  fireEvent.pointerUp(canvas(), {pointerId:2});
  expect(bank.graph!.wires).toHaveLength(2);
});
test('opens on the canvas, expands on double-click, and restores without losing notes', async () => {
  await mount(); expect(screen.queryByLabelText('Pattern name')).toBeTruthy(); // editor exists but hidden
  expect((screen.getByLabelText('Pattern name').closest('.pattern-editor') as HTMLElement).hidden).toBe(true);
  fireEvent.doubleClick(document.querySelector('[data-musical-node="pattern-p"]')!);
  expect((screen.getByLabelText('Pattern name').closest('.pattern-editor') as HTMLElement).hidden).toBe(false);
  fireEvent.click(screen.getByLabelText('Collapse pattern editor'));
  expect((screen.getByLabelText('Pattern name').closest('.pattern-editor') as HTMLElement).hidden).toBe(true);
});
test('connects root independently of scale and disconnects it', async () => {
  await mount(); fireEvent.pointerDown(screen.getByLabelText('deck-0 output notes'), { button: 0, pointerId: 1 });
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('pattern-p input notes'));
  fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: 500, clientY: 300 }); await saved();
  expect(bank.graph!.wires.find(w => w.kind === 'notes')).toMatchObject({ from: 'deck-0', to: 'pattern-p' });
  fireEvent.click(screen.getByLabelText('Expand Melody'));
  expect((screen.getByLabelText('Pattern key') as HTMLSelectElement).value).toBe('7'); expect((screen.getByLabelText('Pattern scale') as HTMLSelectElement).value).toBe('0'); expect((screen.getByLabelText('Pattern key') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('Collapse pattern editor'));
  fireEvent.pointerDown(document.querySelector(`[data-musical-wire="${bank.graph!.wires.find(w => w.kind === 'notes')!.id}"]`)!, { button: 0 }); fireEvent.click(screen.getByText('Disconnect'));
  await waitFor(() => expect(bank.graph!.wires.some(w => w.kind === 'notes')).toBe(false));
});
test('reconnects MIDI to another instrument, preserves its owner slot, and cancels release outside', async () => {
  await mount(); fireEvent.doubleClick(screen.getByRole('button', {name:'Synth B'})); await saved();
  const instrument = bank.graph!.nodes.find(n => n.destination?.kind === 'midi' && n.destination.output === 43)!;
  fireEvent.pointerDown(document.querySelector('[data-musical-wire="route-p"]')!, { button: 0 });
  fireEvent.pointerDown(screen.getByLabelText('Reconnect musical cable target'), { button: 0, pointerId: 2 });
  fireEvent.pointerMove(canvas(), { pointerId: 2, clientX: 700, clientY: 300 });
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText(`${instrument.id} input midi`));
  fireEvent.pointerUp(canvas(), { pointerId: 2, clientX: 700, clientY: 300 });
  await waitFor(() => expect(bank.graph!.wires[0].to).toBe(instrument.id)); expect(bank.graph!.wires[0].route).toBe(0);
  fireEvent.pointerDown(screen.getByLabelText('Reconnect musical cable source'), { button: 0, pointerId: 3 });
  vi.mocked(document.elementFromPoint).mockReturnValue(null); fireEvent.pointerUp(canvas(), { pointerId: 3, clientX: 9999, clientY: 9999 });
  expect(bank.graph!.wires[0]).toMatchObject({ from: 'pattern-p', to: instrument.id });
  fireEvent.keyDown(window, { key: 'Delete' }); await waitFor(() => expect(bank.graph!.wires).toHaveLength(0));
  fireEvent.keyDown(window, { key: 'z', metaKey: true }); await waitFor(() => expect(bank.graph!.wires).toHaveLength(1));
});
test('adds a loaded Teia instrument and rejects incompatible MIDI-to-root connections', async () => {
  await mount(); fireEvent.doubleClick(await screen.findByRole('button', {name:'FM'})); await saved();
  expect(bank.graph!.nodes.find(n => n.destination?.kind === 'teia')?.destination).toEqual({ kind: 'teia', slot: 0 });
  expect(() => connectMusical(bank.graph!, { id: 'bad', kind: 'midi', from: 'deck-0', to: 'pattern-p' })).toThrow();
});

test('patches scale independently and reconnects notes to a deck input', async () => {
  await mount();
  fireEvent.pointerDown(screen.getByLabelText('deck-0 output scale'), {button:0,pointerId:1});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('pattern-p input scale'));
  fireEvent.pointerUp(canvas(), {pointerId:1}); await saved();
  fireEvent.click(screen.getByLabelText('Expand Melody'));
  expect((screen.getByLabelText('Pattern scale') as HTMLSelectElement).value).toBe('1');
  expect((screen.getByLabelText('Pattern key') as HTMLSelectElement).value).toBe('0');
  expect((screen.getByLabelText('Pattern key') as HTMLSelectElement).disabled).toBe(false);
  expect((screen.getByLabelText('Pattern scale') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Pattern key'), {target:{value:'2'}});
  await waitFor(() => expect(bank.patterns[0].key).toBe(2));
  fireEvent.click(screen.getByLabelText('Collapse pattern editor'));
  fireEvent.pointerDown(document.querySelector('[data-musical-wire="route-p"]')!, {button:0});
  fireEvent.pointerDown(screen.getByLabelText('Reconnect musical cable target'), {button:0,pointerId:2});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('deck-1 input midi'));
  fireEvent.pointerUp(canvas(), {pointerId:2});
  await waitFor(() => expect(bank.graph!.wires.find(w => w.id === 'route-p')?.to).toBe('deck-1'));
  expect(bank.graph!.wires.find(w => w.id === 'route-p')?.route).toBe(0);
});
test('migrates combined key connections to independent root and scale cables', () => {
  bank.graph!.wires.push({id:'old-key',from:'deck-0',to:'pattern-p',kind:'key'});
  const next = normaliseBank(bank);
  expect(next.graph!.wires.filter(w => w.kind !== 'midi').map(w => w.kind)).toEqual(['notes','scale']);
});

test('devices expose latched note and full MIDI outputs, and note cables reconnect from root to deck', async () => {
  await mount();
  expect(screen.queryByLabelText('midi-42 output root')).toBeNull();
  expect(screen.queryByLabelText('midi-42 output scale')).toBeNull();
  expect(screen.getByLabelText('midi-42 output midi')).toBeTruthy();
  fireEvent.pointerDown(screen.getByLabelText('midi-42 output notes'), {button:0,pointerId:1});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('pattern-p input notes'));
  fireEvent.pointerUp(canvas(), {pointerId:1}); await saved();
  const root=bank.graph!.wires.find(w=>w.kind==='notes')!;
  expect(root).toMatchObject({from:'midi-42',to:'pattern-p'});
  fireEvent.pointerDown(document.querySelector(`[data-musical-wire="${root.id}"]`)!,{button:0});
  fireEvent.pointerDown(screen.getByLabelText('Reconnect musical cable target'),{button:0,pointerId:2});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('deck-1 input midi'));
  fireEvent.pointerUp(canvas(),{pointerId:2});
  await waitFor(()=>expect(bank.graph!.wires.find(w=>w.id===root.id)).toMatchObject({kind:'notes',to:'deck-1',route:1}));
});
test('routes generic device MIDI to another instrument and accepts input-only devices', async () => {
  await mount();fireEvent.doubleClick(screen.getByRole('button',{name:'Synth B'}));await saved();
  const target=bank.graph!.nodes.find(n=>n.destination?.kind==='midi'&&n.destination.output===43)!;
  fireEvent.pointerDown(screen.getByLabelText('midi-42 output midi'),{button:0,pointerId:1});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText(`${target.id} input midi`));fireEvent.pointerUp(canvas(),{pointerId:1});
  await waitFor(()=>expect(bank.graph!.wires.some(w=>w.from==='midi-42'&&w.to===target.id&&w.kind==='midi')).toBe(true));
  fireEvent.doubleClick(screen.getByRole('button',{name:'Controller'}));
  await waitFor(()=>expect(bank.graph!.nodes.some(n=>n.input===44&&n.destination?.kind==='midi'&&n.destination.output===0)).toBe(true));
  const controller=bank.graph!.nodes.find(n=>n.input===44)!;
  expect(screen.queryByLabelText(`${controller.id} input midi`)).toBeNull();
  expect(document.querySelector(`[data-musical-node="${controller.id}"]`)!.textContent).not.toContain('UNAVAILABLE');
});

test('deletes pattern and deck placements with cables, preserves reusable patterns, and restores with undo', async () => {
  await mount();
  fireEvent.pointerDown(document.querySelector('[data-musical-node="pattern-p"]')!, {button:0});
  fireEvent.keyDown(window, {key:'Delete'});
  await waitFor(() => expect(bank.graph!.nodes.some(n => n.pattern === 'p')).toBe(false));
  expect(bank.graph!.wires).toHaveLength(0); expect(bank.patterns).toHaveLength(1);
  fireEvent.keyDown(window,{key:'z',metaKey:true});
  await waitFor(() => expect(bank.graph!.wires).toHaveLength(1));
  fireEvent.pointerDown(document.querySelector('[data-musical-node="deck-0"]')!, {button:0}); fireEvent.keyDown(window,{key:'Delete'});
  await waitFor(() => expect(bank.graph!.nodes.some(n => n.deck === 0)).toBe(false));
  fireEvent.doubleClick(screen.getByRole('button',{name:'Deck A'}));
  await waitFor(() => expect(bank.graph!.nodes.some(n => n.deck === 0)).toBe(true));
});
test('empty canvas double-click does not add a pattern', async () => {
  await mount(); fireEvent.doubleClick(canvas()); expect(bank.patterns).toHaveLength(1);
  expect(document.querySelector('.routing-inspector')).toBeNull(); expect(screen.queryByLabelText('Add instrument')).toBeNull();
});
test('palette drop places a device at the pointer and undo removes it', async () => {
  await mount();
  fireEvent.drop(document.querySelector('.routing-scroll')!,{clientX:480,clientY:500,dataTransfer:{getData:()=> 'midi:43'}});
  await waitFor(() => expect(bank.graph!.nodes.find(n => n.destination?.kind === 'midi' && n.destination.output === 43)).toMatchObject({x:500,y:500}));
  fireEvent.keyDown(window,{key:'z',metaKey:true});
  await waitFor(() => expect(bank.graph!.nodes.some(n => n.destination?.kind === 'midi' && n.destination.output === 43)).toBe(false));
});
test('Active deck is a reusable moving deck node with root, scale and note input', async () => {
  await mount(); fireEvent.doubleClick(screen.getByRole('button',{name:'Active deck'})); await saved();
  const node=bank.graph!.nodes.find(n=>n.deck===2)!;
  expect(node.label).toBe('Active deck');
  expect(screen.getByLabelText(`${node.id} input midi`)).toBeTruthy();
  expect(screen.getByLabelText(`${node.id} output notes`)).toBeTruthy();
  expect(screen.getByLabelText(`${node.id} output scale`)).toBeTruthy();
});
test('Active deck harmony follows the selected physical deck without changing stored notes', async () => {
  const {linkedHarmony}=await import('./patternModel');
  bank.graph!.nodes.find(n=>n.id==='deck-0')!.deck=2;
  bank.graph!.wires.push({id:'active-root',from:'deck-0',to:'pattern-p',kind:'root'},{id:'active-scale',from:'deck-0',to:'pattern-p',kind:'scale'});
  const keys=[{key:0,scale:0},{key:7,scale:1}];
  expect(linkedHarmony(bank,'p',keys,'root',{},0)?.harmony).toEqual({key:0,scale:0});
  expect(linkedHarmony(bank,'p',keys,'scale',{},1)?.harmony).toEqual({key:7,scale:1});
  expect(bank.patterns[0].key).toBe(0);
  expect(()=>connectMusical(bank.graph!,{id:'feedback',from:'pattern-p',to:'deck-1',kind:'midi'})).toThrow(/cannot drive/);
  expect(()=>connectMusical(bank.graph!,{id:'note-feedback',from:'pattern-p',to:'deck-1',kind:'notes'})).toThrow(/cannot drive/);
});

 test('destination-only devices hide output pins until a MIDI source is assigned', async () => {
  await mount();
  fireEvent.doubleClick(screen.getByRole('button', {name:'Synth B'}));
  await saved();
  const target = bank.graph!.nodes.find(n => n.destination?.kind === 'midi' && n.destination.output === 43)!;
  expect(screen.getByLabelText(`${target.id} input midi`)).toBeTruthy();
  expect(screen.queryByLabelText(`${target.id} output midi`)).toBeNull();
  expect(screen.queryByLabelText(`${target.id} output notes`)).toBeNull();
  fireEvent.pointerDown(document.querySelector(`[data-musical-node="${target.id}"]`)!, {button:0});
  fireEvent.change(screen.getByLabelText('Device MIDI source'), {target:{value:'44'}});
  await waitFor(() => expect(screen.getByLabelText(`${target.id} output midi`)).toBeTruthy());
  expect(screen.getByLabelText(`${target.id} output notes`)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Device MIDI source'), {target:{value:'0'}});
  await waitFor(() => expect(screen.queryByLabelText(`${target.id} output midi`)).toBeNull());
  expect(screen.queryByLabelText(`${target.id} output notes`)).toBeNull();
});

test('patterns expose separate note and MIDI outputs and can play without MIDI cables', async () => {
  bank.graph!.wires = [];
  await mount();
  const note = screen.getByLabelText('pattern-p output notes');
  const midi = screen.getByLabelText('pattern-p output midi');
  expect(note.style.top).not.toBe(midi.style.top);
  expect((screen.getByLabelText('Play Melody') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.pointerDown(note, {button:0,pointerId:1});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('deck-1 input midi'));
  fireEvent.pointerUp(canvas(), {pointerId:1});
  await saved();
  expect(bank.graph!.wires).toMatchObject([{kind:'notes',from:'pattern-p',to:'deck-1'}]);
  expect(screen.getByLabelText('Link colours').textContent).toBe('NoteMIDIScaleCue gate');
});
test('device channel selection persists all or a numbered channel', async () => {
  await mount();
  fireEvent.pointerDown(document.querySelector('[data-musical-node="midi-42"]')!, {button:0,pointerId:1});
  const channel = screen.getByLabelText('Device MIDI channel') as HTMLSelectElement;
  expect(channel.options).toHaveLength(17);
  expect(channel.value).toBe('');
  fireEvent.change(channel, {target:{value:'4'}});
  await waitFor(() => expect(bank.graph!.nodes.find(n => n.id === 'midi-42')!.channel).toBe(4));
  fireEvent.change(screen.getByLabelText('Device MIDI channel'), {target:{value:''}});
  await waitFor(() => expect(bank.graph!.nodes.find(n => n.id === 'midi-42')!.channel).toBeNull());
});

test('adds transformations with inline settings and connects Note and MIDI ports', async () => {
  await mount();
  fireEvent.doubleClick(screen.getByRole('button', {name:'Octave shift'}));
  await waitFor(() => expect(bank.graph!.nodes.some(n => n.transformation?.kind === 'octaveShift')).toBe(true));
  const shift = bank.graph!.nodes.find(n => n.transformation?.kind === 'octaveShift')!;
  fireEvent.change(screen.getByLabelText(`${shift.id} octaves`), {target:{value:'-2'}});
  await waitFor(() => expect(bank.graph!.nodes.find(n => n.id === shift.id)?.transformation).toEqual({kind:'octaveShift',octaves:-2}));
  fireEvent.pointerDown(screen.getByLabelText('pattern-p output midi'), {button:0,pointerId:1});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText(`${shift.id} input midi`));
  fireEvent.pointerUp(canvas(), {pointerId:1});
  await waitFor(() => expect(bank.graph!.wires.some(w => w.to === shift.id && w.kind === 'midi')).toBe(true));
  fireEvent.doubleClick(screen.getByRole('button', {name:'Filter'}));
  await waitFor(() => expect(bank.graph!.nodes.some(n => n.transformation?.kind === 'filter')).toBe(true));
  const filter = bank.graph!.nodes.find(n => n.transformation?.kind === 'filter')!;
  fireEvent.change(screen.getByLabelText(`${filter.id} filter direction`), {target:{value:'below'}});
  fireEvent.change(screen.getByLabelText(`${filter.id} filter note`), {target:{value:'72'}});
  await waitFor(() => expect(bank.graph!.nodes.find(n => n.id === filter.id)?.transformation).toEqual({kind:'filter',direction:'below',note:72}));
  fireEvent.pointerDown(screen.getByLabelText(`${shift.id} output notes`), {button:0,pointerId:2});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText(`${filter.id} input notes`));
  fireEvent.pointerUp(canvas(), {pointerId:2});
  await waitFor(() => expect(bank.graph!.wires.some(w => w.from === shift.id && w.to === filter.id)).toBe(true));
  expect(() => connectMusical(bank.graph!, {id:'cycle',from:filter.id,to:shift.id,kind:'midi'}, bank.graph!.wires.find(w => w.to === shift.id)!.id)).toThrow(/feedback/);
  for (const from of ['pattern-p', 'midi-42']) {
    fireEvent.pointerDown(screen.getByLabelText(`${from} output midi`), {button:0,pointerId:3});
    vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText(`${filter.id} input midi`));
    fireEvent.pointerUp(canvas(), {pointerId:3});
    await waitFor(() => expect(bank.graph!.wires.some(w => w.from === from && w.to === filter.id && w.kind === 'midi')).toBe(true));
  }
  expect(bank.graph!.wires.filter(w => w.to === filter.id)).toHaveLength(3);
  expect(() => connectMusical(bank.graph!, {id:'duplicate',from:'midi-42',to:filter.id,kind:'midi'})).toThrow(/already exists/);
  expect(() => connectMusical(bank.graph!, {id:'merged-cycle',from:filter.id,to:shift.id,kind:'midi'})).toThrow(/feedback/);
});

test('named instruments keep their identity and expose MIDI source and target ports', async () => {
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, args) => command === 'get_instruments' ? Promise.resolve([{id:'synth',name:'My synth',audio_input:null,audio_output:null,midi_input:{device:44,channel:2},midi_output:{device:43,channel:9}}]) : original(command,args));
  await mount();
  fireEvent.doubleClick(await screen.findByRole('button', {name:'My synth'})); await saved();
  expect(bank.graph!.nodes.find(n => n.id === 'instrument-synth')).toMatchObject({input:44,channel:9,destination:{kind:'midi',output:43}});
  expect(screen.getByLabelText('instrument-synth output midi')).toBeTruthy();
  expect(screen.getByLabelText('instrument-synth input midi')).toBeTruthy();
  expect(screen.queryByLabelText('Device MIDI channel')).toBeNull();
});

test('musical nodes snap to the dot grid while dragging and retain undo', async () => {
  await mount();
  const node = document.querySelector<HTMLElement>('[data-musical-node="pattern-p"]')!;
  const origin = {x:parseFloat(node.style.left),y:parseFloat(node.style.top)};
  const wires = structuredClone(bank.graph!.wires);
  fireEvent.pointerDown(node.querySelector('.routing-node-title')!,{button:0,pointerId:9,clientX:400,clientY:400});
  fireEvent.pointerMove(canvas(),{pointerId:9,clientX:413,clientY:427});
  expect(node.style.left).toBe(`${origin.x + 20}px`);
  expect(node.style.top).toBe(`${origin.y + 40}px`);
  fireEvent.pointerUp(canvas(),{pointerId:9});
  await waitFor(() => expect(bank.graph!.nodes.find(n => n.id === 'pattern-p')).toMatchObject({x:origin.x + 20,y:origin.y + 40}));
  expect(bank.graph!.wires).toEqual(wires);
  fireEvent.click(screen.getByRole('button',{name:'Undo'}));
  await waitFor(() => expect(bank.graph!.nodes.find(n => n.id === 'pattern-p')).toMatchObject(origin));
});

test('reverse box selection moves and deletes musical nodes together without deleting patterns', async () => {
  bank.graph!.nodes = bank.graph!.nodes.filter(n => ['pattern-p','midi-42'].includes(n.id)).map(n => ({...n,x:n.kind === 'pattern' ? 120 : 440,y:n.kind === 'pattern' ? 120 : 160}));
  await mount();
  const p = (x:number,y:number) => ({button:0,pointerId:14,clientX:80+x*.8,clientY:100+y*.8});
  fireEvent.pointerDown(canvas(),p(620,400));fireEvent.pointerMove(canvas(),p(100,100));fireEvent.pointerUp(canvas(),p(100,100));
  expect(screen.getByText('2 objects selected')).toBeTruthy();
  const node = document.querySelector('[data-musical-node="pattern-p"]')!;
  fireEvent.pointerDown(node.querySelector('.routing-node-title')!,p(140,140));fireEvent.pointerMove(canvas(),p(180,160));fireEvent.pointerUp(canvas(),p(180,160));
  await waitFor(() => expect(bank.graph!.nodes.find(n => n.id === 'pattern-p')).toMatchObject({x:160,y:140}));
  expect(bank.graph!.nodes.find(n => n.id === 'midi-42')).toMatchObject({x:480,y:180});
  fireEvent.click(screen.getByRole('button',{name:'Remove selected'}));
  await waitFor(() => expect(bank.graph!.nodes).toHaveLength(0));
  expect(bank.patterns.map(p => p.name)).toEqual(['Melody']); expect(bank.graph!.wires).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'Undo'}));
  await waitFor(() => expect(bank.graph!.nodes).toHaveLength(2));
  fireEvent.click(screen.getByRole('button',{name:'Undo'}));
  await waitFor(() => expect(bank.graph!.nodes.find(n => n.id === 'pattern-p')).toMatchObject({x:120,y:120}));
  expect(bank.graph!.nodes.find(n => n.id === 'midi-42')).toMatchObject({x:440,y:160});
});

test('a pinned transformation edits the same pattern graph from Decks', async () => {
  localStorage.clear();
  bank.graph!.nodes.push({id:'shift',kind:'transformation',label:'Octave shift',x:800,y:200,transformation:{kind:'octaveShift',octaves:1}});
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation((cmd,args) => cmd === 'patches_state' || cmd === 'get_instruments' ? Promise.resolve([]) : original(cmd,args));
  const view = render(<><Patterns active /><Patches /></>);
  const pin = await screen.findByRole('button',{name:'Pin Octave shift'});
  fireEvent.pointerDown(pin,{button:0}); fireEvent.click(pin);
  expect(pin.getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('[data-musical-node="shift"]')?.classList.contains('selected')).toBe(false);
  view.rerender(<><Patterns active={false} /><Patches /></>);
  const field = await screen.findByRole('slider',{name:'shift octaves'});
  fireEvent.keyDown(field,{key:'ArrowUp'}); fireEvent.keyDown(field,{key:'ArrowUp'});
  await waitFor(() => expect(bank.graph!.nodes.find(n => n.id === 'shift')?.transformation).toEqual({kind:'octaveShift',octaves:3}));
  expect(JSON.parse(localStorage.getItem('vira.pinned-components')!)).toEqual(['patterns:shift']);
  localStorage.clear();
});

test('Selector accepts mixed inputs, grows a spare pin and switches from pinned buttons', async () => {
  localStorage.clear();
  const original = invoke.getMockImplementation()!;
  invoke.mockImplementation((cmd,args) => cmd === 'patches_state' || cmd === 'get_instruments' ? Promise.resolve([]) : original(cmd,args));
  const view = render(<><Patterns active /><Patches /></>);
  const palette = await screen.findByRole('button',{name:'Selector'}); fireEvent.doubleClick(palette);
  await waitFor(() => expect(bank.graph!.nodes.some(n => n.transformation?.kind === 'selector')).toBe(true));
  const id = bank.graph!.nodes.find(n => n.transformation?.kind === 'selector')!.id;
  for (const [port,source,kind] of [['A','deck-0','scale'],['B','pattern-p','midi']]) {
    fireEvent.pointerDown(screen.getByLabelText(`${source} output ${kind}`),{button:0,pointerId:1});
    vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText(`${id} input ${port}`));
    fireEvent.pointerUp(canvas(),{pointerId:1});
    await waitFor(() => expect(bank.graph!.wires.some(w => w.to === id && w.input === port && w.kind === kind)).toBe(true));
  }
  expect(screen.getByLabelText(`${id} input C`)).toBeTruthy();
  expect(Array.from((screen.getByLabelText(`music:${id} selected input`) as HTMLSelectElement).options).map(o => o.value)).toEqual(['A','B']);
  fireEvent.pointerDown(screen.getByLabelText(`${id} output key`),{button:0,pointerId:2});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('midi-42 input midi'));
  fireEvent.pointerUp(canvas(),{pointerId:2});
  await waitFor(() => expect(bank.graph!.wires.some(w => w.from === id && w.to === 'midi-42' && w.kind === 'midi')).toBe(true));
  fireEvent.change(screen.getByLabelText(`music:${id} selected input`),{target:{value:'B'}});
  fireEvent.click(screen.getByRole('button',{name:'Pin Selector'}));
  view.rerender(<><Patterns active={false} /><Patches /></>);
  expect(screen.queryByRole('button',{name:'C'})).toBeNull();
  fireEvent.click(await screen.findByRole('button',{name:'A'}));
  await waitFor(() => expect(bank.graph!.nodes.find(n => n.id === id)?.transformation).toEqual({kind:'selector',selected:'A',ports:['A','B','C']}));
  localStorage.clear();
});

test('pattern node titles use and edit the pattern name with undo', async () => {
  await mount();
  const name = screen.getByLabelText('pattern-p name') as HTMLInputElement;
  expect(name.value).toBe('Melody');
  expect(name.parentElement?.querySelector('small')?.textContent).toBe('Melodic pattern');
  fireEvent.focus(name);
  fireEvent.change(name, {target:{value:'  Bass phrase  '}});
  fireEvent.blur(name);
  await waitFor(() => expect(bank.patterns[0].name).toBe('Bass phrase'));
  expect(bank.graph!.nodes.find(n => n.id === 'pattern-p')?.label).toBe('Bass phrase');
  expect(name.parentElement?.querySelector('small')?.textContent).toBe('Melodic pattern');
  fireEvent.click(screen.getByRole('button', {name:'Undo'}));
  await waitFor(() => expect(bank.patterns[0].name).toBe('Melody'));
  fireEvent.click(screen.getByRole('button', {name:'Redo'}));
  await waitFor(() => expect(bank.patterns[0].name).toBe('Bass phrase'));
  cleanup();
  render(<Patterns active />);
  await screen.findByLabelText('Expand Bass phrase');
  expect((screen.getByLabelText('pattern-p name') as HTMLInputElement).value).toBe('Bass phrase');
});

test('cue pattern ports connect to deck cue triggers and keep pitch inputs separate', async () => {
  const cue = {...newPattern('cue'), id:'cues',name:'Chop sequence'};
  bank.patterns.push(cue);
  bank.graph!.nodes.push({id:'cue-node',kind:'pattern',pattern:cue.id,label:cue.name,x:430,y:600});
  await mount();
  const node = document.querySelector('[data-musical-node="cue-node"]')!;
  expect((screen.getByLabelText('cue-node name') as HTMLInputElement).value).toBe('Chop sequence');
  expect(node.querySelector('.musical-node-pattern > small:not([class])')).toBeNull();
  expect(screen.queryByLabelText('cue-node output midi')).toBeNull();
  fireEvent.pointerDown(screen.getByLabelText('cue-node output cue'), {button:0,pointerId:1});
  vi.mocked(document.elementFromPoint).mockReturnValue(screen.getByLabelText('deck-0 input cue'));
  fireEvent.pointerUp(canvas(), {pointerId:1});
  await waitFor(() => expect(bank.graph!.wires.some(w => w.from === 'cue-node' && w.to === 'deck-0' && w.kind === 'cue')).toBe(true));
  expect(screen.getByLabelText('deck-0 input midi')).toBeTruthy();
});
