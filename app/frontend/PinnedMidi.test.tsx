// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MidiProvider, MidiToggle, type MidiMessage } from './MidiMapping';
import { Routing, type Graph } from './Routing';
import { Patches } from './Patches';
import type { AudioState } from './Decks';

const api = vi.hoisted(() => ({ invoke: vi.fn(), messages: [] as MidiMessage[] }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: api.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
const graph: Graph = { nodes: [
  {id:'a-eq',kind:'eq',deck:0,label:'EQ A',x:0,y:0,value:1},
  {id:'a-player',kind:'player',deck:0,label:'Player A',x:0,y:100,value:1},
  {id:'a-cue-switch',kind:'cue_switch',deck:0,label:'Cue A',x:0,y:200,value:0},
  {id:'fx-gain',kind:'gain',deck:null,label:'Gain',x:400,y:0,value:1},
], wires: [] };
const instrument = {id:'synth',name:'Synth',advance_ms:0,audio_input:null,audio_output:null,midi_input:null,midi_output:null};
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); api.messages = [];
  localStorage.setItem('vira.midi-enabled.v1','[42]');
  localStorage.setItem('vira.midi-behavior.v1','"jump"');
  localStorage.setItem('vira.pinned-components',JSON.stringify([...graph.nodes.map(n => `routing:${n.id}`),'instrument:synth']));
  api.invoke.mockImplementation(async (command, args) => {
    if (command === 'midi_mapping_poll') return {devices:[{id:42,name:'Controller'}],messages:api.messages.splice(0)};
    if (command === 'get_routing_graph') return structuredClone(graph);
    if (command === 'get_instruments') return [instrument];
    if (command === 'patches_state') return [];
    if (command === 'set_routing_parameters') return {...graph,nodes:graph.nodes.map(n => ({...n,...args.parameters.nodes.find((p:{id:string}) => p.id === n.id)}))};
  });
});
afterEach(() => { cleanup(); localStorage.clear(); api.invoke.mockReset(); vi.useRealTimers(); });
async function tick(messages: MidiMessage[] = []) {
  api.messages.push(...messages);
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
}
const cc = (number:number,value:number):MidiMessage => ({device:42,channel:1,cc:number,value});

test('learns pinned controls without activating them, then controls audio with Routing hidden', async () => {
  const control = vi.fn().mockResolvedValue(undefined);
  const audio = {running:true,decks:[{deck:0,playing:false,track:{track_id:'track'},eq:[.5,.5,.5],headphone_cue:false}]} as AudioState;
  render(<MidiProvider><Routing active={false} audio={audio} control={control} /><Patches /><MidiToggle /></MidiProvider>);
  await tick();
  const low = screen.getByRole('slider',{name:'EQ A Low'});
  const mid = screen.getByRole('slider',{name:'EQ A Mid'});
  const high = screen.getByRole('slider',{name:'EQ A High'});
  expect(new Set([low,mid,high].map(el => el.getAttribute('data-midi-target'))).size).toBe(3);
  const gain = screen.getByRole('slider',{name:'Gain Gain'});
  const play = screen.getByRole('button',{name:'Play'});
  const cue = screen.getByRole('button',{name:'Headphone cue'});
  const timing = screen.getByRole('slider',{name:'Synth timing advance'});
  fireEvent.click(screen.getByRole('button',{name:'MIDI map'}));
  for (const [index, element] of [low,gain,play,cue,timing].entries()) {
    fireEvent.click(element); await tick([cc(index,64)]);
    expect(element.getAttribute('data-midi-mapped')).toBe('true');
  }
  expect(control).not.toHaveBeenCalled();
  expect(api.invoke.mock.calls.some(([command]) => ['set_routing_parameters','save_instruments'].includes(command))).toBe(false);
  const bindings = JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!);
  expect(bindings.map((b:{target:string}) => b.target)).toEqual(['routing:a-eq:eq:0','routing:fx-gain:value','ui:deck:0:play','ui:routing:a-cue-switch:cue','instrument:synth:advance_ms']);
  expect(bindings[4]).toMatchObject({min:0,max:100});
  fireEvent.click(screen.getByRole('button',{name:'MIDI map'}));
  await tick([cc(0,127)]); expect(control).toHaveBeenLastCalledWith(0,'eq_low',1);
  await tick([cc(1,127)]);
  expect(api.invoke).toHaveBeenCalledWith('set_routing_parameters',{parameters:{nodes:[{id:'fx-gain',value:2}],wires:[]}});
  await tick([cc(2,127),cc(2,127),cc(2,0)]);
  expect(control.mock.calls.filter(([,action]) => action === 'play_pause')).toHaveLength(1);
  await tick([cc(3,127)]); expect(control).toHaveBeenLastCalledWith(0,'headphone_cue',1);
  await tick([cc(4,127)]);
  expect(api.invoke).toHaveBeenCalledWith('save_instruments',{items:[{...instrument,advance_ms:100}]});
});
