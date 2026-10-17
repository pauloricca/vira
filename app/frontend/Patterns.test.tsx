// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Patterns } from './Patterns';
import { newPattern, fitLength, pitch, type Bank } from './patternModel';
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
let bank: Bank;
let voices: Record<string, { start: number; stop: number | null }>;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  voices = {};
  const p = newPattern(); p.id = 'one'; p.name = 'Arp'; p.output = 42;
  bank = { patterns: [p], outputCompensation: {} };
  invoke.mockImplementation((cmd, args) => {
    if (cmd === 'patterns_state') return Promise.resolve({ bank: structuredClone(bank), outputs: [{ id: 42, name: 'Synth' }], voices, beat: 10, bpm: 120, clockReady: true, error: null });
    if (cmd === 'patterns_save') bank = structuredClone(args.bank);
    return Promise.resolve();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); invoke.mockReset(); });
async function mount() { render(<Patterns active />); const button = await screen.findByLabelText('Expand Arp'); fireEvent.click(button); await screen.findByDisplayValue('Arp'); }
test('edits preserve relative degrees across key and scale changes, and persist compensation', async () => {
  bank.patterns[0].notes = [{ id: 'n', degree: 3, octave: 1, beat: 0, duration: 1, velocity: 100 }];
  await mount();
  fireEvent.change(screen.getByLabelText('Pattern key'), { target: { value: '7' } });
  fireEvent.change(screen.getByLabelText('Pattern scale'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Output MIDI compensation'), { target: { value: '24' } });
  await waitFor(() => expect(bank.outputCompensation[42]).toBe(24));
  expect(bank.patterns[0].notes[0]).toMatchObject({ degree: 3, octave: 1 });
  expect(pitch(bank.patterns[0], 3, 1)).toBe(82);
});
test('duplicates have independent IDs and deleting requires explicit confirmation', async () => {
  bank.patterns[0].notes = [{ id: 'n', degree: 1, octave: 0, beat: 0, duration: 1, velocity: 100 }];
  await mount(); fireEvent.click(screen.getByText('Duplicate'));
  await waitFor(() => expect(bank.patterns).toHaveLength(2));
  expect(bank.patterns[1].id).not.toBe('one'); expect(bank.patterns[1].notes[0].id).not.toBe('n');
  fireEvent.click(screen.getByText('Delete')); expect(bank.patterns).toHaveLength(2);
  expect(screen.getByRole('dialog', { name: 'Delete pattern?' }).hasAttribute('open')).toBe(true);
  fireEvent.click(screen.getByText('Cancel'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(bank.patterns).toHaveLength(2);
  fireEvent.click(screen.getByText('Delete'));
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(bank.patterns).toHaveLength(2);
  fireEvent.click(screen.getByText('Delete'));
  fireEvent.click(screen.getByText('Delete pattern')); await waitFor(() => expect(bank.patterns).toHaveLength(1));
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('launch waits for saved edits and uses native transport', async () => {
  await mount(); fireEvent.click(screen.getByText('▶ Launch'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patterns_transport', { id: 'one', play: true }));
});
test('shortening a loop clips crossing notes and removes notes outside its boundary', () => {
  const p = newPattern(); p.notes = [{ id: 'a', beat: 3, duration: 3, degree: 1, octave: 0, velocity: 100 }, { id: 'b', beat: 7, duration: 1, degree: 5, octave: -1, velocity: 100 }];
  expect(fitLength(p, 1).notes).toEqual([{ ...p.notes[0], duration: 1 }]);
});
test('grid gestures create, move, resize, and delete the stored note', async () => {
  class TestPointer extends MouseEvent { pointerId = 1; }
  vi.stubGlobal('PointerEvent', TestPointer);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 770, right: 800, bottom: 770, x: 0, y: 0, toJSON: () => ({}) });
  await mount(); const grid = screen.getByLabelText('Scale degree note grid');
  fireEvent.pointerDown(grid, { button: 0, clientX: 100, clientY: 445 });
  await waitFor(() => expect(bank.patterns[0].notes).toHaveLength(1));
  expect(bank.patterns[0].notes[0]).toMatchObject({ beat: 1, degree: 1, octave: 0, duration: .25 });
  let note = screen.getByRole('button', { name: /Degree 1, C4/ });
  fireEvent.pointerDown(note, { button: 0, clientX: 100, clientY: 445 });
  fireEvent.pointerMove(note, { clientX: 200, clientY: 423 }); fireEvent.pointerUp(note, { clientX: 200, clientY: 423 });
  await waitFor(() => expect(bank.patterns[0].notes[0]).toMatchObject({ beat: 2, degree: 2, octave: 0 }));
  const end = screen.getByLabelText('Resize note');
  fireEvent.pointerDown(end, { button: 0, clientX: 225, clientY: 423 });
  fireEvent.pointerMove(end, { clientX: 300, clientY: 423 }); fireEvent.pointerUp(end, { clientX: 300, clientY: 423 });
  await waitFor(() => expect(bank.patterns[0].notes[0].duration).toBe(1));
  note = screen.getByRole('button', { name: /Degree 2, D4/ });
  fireEvent.pointerDown(note, { button: 0, clientX: 210, clientY: 423 }); fireEvent.pointerUp(note, { clientX: 210, clientY: 423 });
  await waitFor(() => expect(bank.patterns[0].notes).toHaveLength(0));
  vi.unstubAllGlobals();
});
test('both halves of a step create a note in that step while playing', async () => {
  class TestPointer extends MouseEvent { pointerId = 1; }
  vi.stubGlobal('PointerEvent', TestPointer);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 50, top: 0, width: 800, height: 770, right: 850, bottom: 770, x: 50, y: 0, toJSON: () => ({}) });
  voices = { one: { start: 0, stop: null } };
  await mount();
  const grid = screen.getByLabelText('Scale degree note grid');
  // Eight beats across 800px: each sixteenth-note cell is 25px wide.
  fireEvent.pointerDown(grid, { button: 0, clientX: 152, clientY: 445 });
  fireEvent.pointerDown(grid, { button: 0, clientX: 173, clientY: 423 });
  await waitFor(() => expect(bank.patterns[0].notes).toHaveLength(2));
  expect(bank.patterns[0].notes.map(n => n.beat)).toEqual([1, 1]);
  expect(invoke).not.toHaveBeenCalledWith('patterns_transport', expect.anything());
  vi.unstubAllGlobals();
});
test('failed saves block launching until a retry succeeds', async () => {
  await mount(); invoke.mockImplementation((cmd) => cmd === 'patterns_save' ? Promise.reject('Disk full') : Promise.resolve());
  fireEvent.change(screen.getByLabelText('Pattern key'), { target: { value: '2' } });
  await screen.findByText(/Changes not saved: Disk full/);
  fireEvent.click(screen.getByText('▶ Launch'));
  await waitFor(() => expect(screen.getByText('Unsaved changes', { exact: false })).toBeTruthy());
  expect(invoke).not.toHaveBeenCalledWith('patterns_transport', expect.anything());
});

test('stop remains available when saving fails', async () => {
  voices = { one: { start: 0, stop: null } };
  await mount();
  const working = invoke.getMockImplementation()!;
  invoke.mockImplementation((cmd, args) => cmd === 'patterns_save' ? Promise.reject('Disk full') : working(cmd, args));
  fireEvent.change(screen.getByLabelText('Pattern key'), { target: { value: '2' } });
  await screen.findByText(/Changes not saved: Disk full/);
  fireEvent.click(screen.getByText('■ Stop'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('patterns_transport', { id: 'one', play: false }));
});
