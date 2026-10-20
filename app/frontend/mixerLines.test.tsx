// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { addMixerLine, lineColours, lineId, lineOrder, lineStages, mixerLines, lineNodeWidth, compactMixerGraph } from './mixerLines';
import { Mixer, type AudioState } from './Decks';
import { PeakMeter } from './meter';
import type { Graph } from './Routing';
const { invoke } = vi.hoisted(() => ({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core', () => ({invoke}));
afterEach(() => {cleanup(); invoke.mockReset();});
const base: Graph = { nodes:[0,1].flatMap(deck => lineStages.map(kind => ({id:lineId(deck,kind),kind,deck,label:kind,x:0,y:0,value:1}))),wires:[] };

test('seven independent channel chains use unique colours and stay between A and B', () => {
  let graph = base;
  for (let i=2;i<7;i++) graph = addMixerLine(graph);
  expect(mixerLines(graph)).toEqual([0,1,2,3,4,5,6]);
  expect(lineOrder(graph)).toEqual([0,2,3,4,5,6,1]);
  expect(new Set(lineColours).size).toBe(7);
  for (let line=2;line<7;line++) {
    const stages = graph.nodes.filter(n => n.id.startsWith(`line-${line}-`));
    expect(stages.map(n => n.kind)).toEqual(lineStages);
    const fader = stages.find(n => n.kind === 'fader')!, cue = stages.find(n => n.kind === 'cue_switch')!;
    expect(fader.y).toBe(cue.y);
    expect(cue.x).toBe(fader.x + 100);
    expect(lineNodeWidth(fader)).toBe(80);
    expect(lineNodeWidth(cue)).toBe(80);
    expect(stages.every(n => n.x % 20 === 0 && n.y % 20 === 0 && lineNodeWidth(n) % 20 === 0)).toBe(true);
    expect(stages.every(n => n.deck === null)).toBe(true);
    expect(graph.wires.filter(w => stages.some(n => n.id === w.from) && !stages.some(n => n.id === w.to)).map(w => w.to)).toEqual(['master','headphones']);
    expect(graph.wires.some(w => w.from === lineId(line,'filter') && w.to === lineId(line,'cue_switch'))).toBe(true);
  }
  expect(() => addMixerLine(graph)).toThrow('All seven');
});

test('extra strips control routing parameters without issuing deck or auto-transition commands', async () => {
  const graph = addMixerLine(base);
  invoke.mockImplementation(async command => command === 'get_routing_graph' ? graph : undefined);
  const control = vi.fn();
  const audio: AudioState = {decks:[0,1].map(deck => ({deck,loading:false,error:null,track:null,position_seconds:0,playing:false,gain:.8,generation:0,requested_generation:0})),running:true,error:null,telemetry:{}};
  render(<Mixer audio={audio} control={control} meters={[new PeakMeter(),new PeakMeter()]} />);
  const fader = await screen.findByRole('slider',{name:'Volume deck C'});
  expect((fader as HTMLInputElement).disabled).toBe(false);
  expect(document.querySelector('.extra-mixer-lines')?.contains(fader)).toBe(true);
  fireEvent.change(fader,{target:{value:'.25'}});
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_routing_parameters',{parameters:{nodes:[{id:'line-2-fader',value:.25}],wires:[]}}));
  fireEvent.click(screen.getByRole('button',{name:'Headphone cue deck C'}));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('set_routing_parameters',{parameters:{nodes:[{id:'line-2-cue-switch',value:1}],wires:[]}}));
  expect(control).not.toHaveBeenCalled();
  expect(invoke.mock.calls.some(([command]) => command === 'deck_control')).toBe(false);
});

test('old vertical strips migrate together without overlapping the wider grid containers', () => {
  const legacy = {...base,nodes:base.nodes.map(n => ({...n,x:n.deck === 0 ? 300 : 485,y:110 + lineStages.indexOf(n.kind as typeof lineStages[number]) * 64}))};
  const migrated = compactMixerGraph(legacy);
  const a = migrated.nodes.find(n => n.id === 'a-trim')!, b = migrated.nodes.find(n => n.id === 'b-trim')!;
  expect(b.x - a.x).toBeGreaterThanOrEqual(240);
  expect(migrated.nodes.find(n => n.id === 'b-fader')?.y).toBe(migrated.nodes.find(n => n.id === 'b-cue-switch')?.y);
  const moved = {...migrated,nodes:migrated.nodes.map(n => n.deck === 1 ? {...n,x:n.x+40,y:n.y+20} : n)};
  expect(compactMixerGraph(moved)).toEqual(moved);
});
