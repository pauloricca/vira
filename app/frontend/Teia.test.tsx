// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { prepare, gainPatch, hostNodeTypes } from './teiaModel';
import { Teia } from './Teia';
import { readDocument, writeDocument } from '@pauloricca/teia-hosted';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { cleanup(); invoke.mockReset(); });
const state = { generation: '7', runtimeGeneration: '7', record: null, editorOpen: false, peak: 0, renderFailures: 0, restoreError: null, running: true };
const library = { directory: '/patches', files: ['Gain.json'], state };
test('imports a supported factory patch with stable exposed identity and stereo input', () => {
  const compiled = prepare(gainPatch);
  expect(compiled.parameters[0].id).toBe('vira-factory-stereo-gain');
  expect(compiled.program.ops.filter(op => op.opcode === 11).map(op => op.b).sort()).toEqual([0, 1]);
});
test('Teia serialization preserves media by node identity despite sorting nodes', () => {
  const patch = structuredClone(gainPatch);
  patch.nodes.push({ id: 'sample', type: 'SamplePlayer', params: {}, sample: { name: 'sample', url: 'host:asset' } });
  patch.nodes.push({ id: 'seq', type: 'Sequencer', params: {} });
  const read = readDocument(writeDocument(patch));
  expect(read.patch?.nodes.find(n => n.id === 'sample')?.sample?.url).toBe('host:asset');
});
test('loading compiles source and sends a file concurrency token to native host', async () => {
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'teia_library' ? library : command === 'teia_read' ? { document: gainPatch, hash: 'source-hash' } : state));
  render(<Teia active />);
  await screen.findByRole('option', { name: 'Gain.json' });
  fireEvent.click(screen.getByRole('button', { name: 'Load on master' }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('teia_load', expect.objectContaining({ name: 'Gain.json', savedHash: 'source-hash', prepared: expect.objectContaining({ profile: 'native-scalar-v1' }) })));
});
test('an open editor prevents replacing its live instance from the library', async () => {
  invoke.mockResolvedValue({ ...library, state: { ...state, editorOpen: true } });
  render(<Teia active />);
  await screen.findByRole('option', { name: 'Gain.json' });
  expect((screen.getByRole('button', { name: 'Load on master' }) as HTMLButtonElement).disabled).toBe(true);
});
test('malformed graph reports an error without attempting native installation', async () => {
  const unsupported = structuredClone(gainPatch); unsupported.nodes[1].type = 'LowpassFilter';
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'teia_library' ? library : command === 'teia_read' ? { document: unsupported, hash: 'source-hash' } : state));
  render(<Teia active />); await screen.findByRole('option', { name: 'Gain.json' });
  fireEvent.click(screen.getByRole('button', { name: 'Load on master' }));
  await screen.findByRole('alert');
  expect(invoke.mock.calls.some(([command]) => command === 'teia_load')).toBe(false);
});
test('shared runtime compiles a connected lowpass effect', () => {
  const patch = structuredClone(gainPatch);
  patch.nodes.push({ id: 'filter', type: 'LowpassFilter', params: {} });
  patch.links = patch.links.filter(l => !(l.from.node === 'input' && l.from.port === 'left'));
  patch.links.push({ from: { node: 'input', port: 'left' }, to: { node: 'filter', port: 'signal' } },
    { from: { node: 'filter', port: 'signal' }, to: { node: 'output', port: 'left' } });
  expect(prepare(patch).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
});

test('the host offers resource nodes and keeps unavailable interaction and analysis gated', () => {
  for (const node of ['Meter', 'Scope', 'Button', 'Keys', 'MidiNoteOn', 'MidiNoteOff', 'CustomWave', 'Sequencer', 'Roll', 'Spread', 'Spawn', 'SamplePlayer', 'Image', 'Buffer', 'Playhead', 'Slider', 'Joystick', 'MidiNote', 'MidiCcSend']) expect(hostNodeTypes).toContain(node);
  for (const node of ['FFT']) expect(hostNodeTypes).not.toContain(node);
  const patch = { nodes: [{ id: 'wave', type: 'CustomWave' as const, params: {}, customWave: {mode: 'loop' as const, sustainStart: 0.5, sustainEnd: 0.75, points: [{x: 0, y: 0}, {x: 1, y: 1}] } }, {id: 'out', type: 'AudioOut' as const, params: {}}], links: [{from: {node: 'wave', port: 'signal'}, to: {node: 'out', port: 'left'}}] };
  expect(prepare(patch).program.customWaveBindings.length).toBe(1);
});
test('MIDI routing sends host-owned endpoint identities', async () => {
  const midi = {available: true, input: 0, output: 0, inputs: [{id: 123, name: 'Keyboard'}], outputs: [], inputDrops: 0, outputDrops: 0, lateInputs: 0};
  invoke.mockResolvedValue({...library, state: {...state, midi}});
  render(<Teia active />);
  const input = await screen.findByRole('combobox', {name: 'Teia MIDI input'});
  fireEvent.change(input, {target: {value: '123'}});
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('teia_midi_configure', {input: 123, output: 0}));
});
