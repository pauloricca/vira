// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { VstSettings } from './VstSettings';
import { Routing, inputs, outputs, type Graph, type RoutingNode } from './Routing';
import type { VstDescriptor } from './vstModel';
const { invoke } = vi.hoisted(() => ({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(()=>Promise.resolve(()=>{}))}));
afterEach(()=>{cleanup();invoke.mockReset();});
const hybrid:VstDescriptor={path:'/Plugins/Synth.vst3',uid:'a'.repeat(32),name:'Hybrid',inputs:[{id:'in-0',label:'Audio',channels:2},{id:'in-1',label:'Sidechain',channels:1}],outputs:[{id:'out-0',label:'Main',channels:2},{id:'out-1',label:'Aux',channels:2}],midi_input:true,effect:true,instrument:true};
test('VST folder paths persist only after a successful save and scan failures stay visible',async()=>{
 invoke.mockImplementation((c)=>Promise.resolve(c==='vst_paths'?['/Plugins']:c==='vst_catalog'?{scanning:false,plugins:[hybrid],errors:['Broken.vst3: probe crashed']}:undefined));
 render(<VstSettings/>);await screen.findByText('/Plugins');
 fireEvent.change(screen.getByLabelText('VST scan folder'),{target:{value:'relative'}});fireEvent.click(screen.getByRole('button',{name:'Add folder'}));
 expect(await screen.findByRole('alert')).toBeTruthy();expect(invoke).not.toHaveBeenCalledWith('vst_save_paths',expect.anything());
 fireEvent.change(screen.getByLabelText('VST scan folder'),{target:{value:'/External/VST é'}});fireEvent.click(screen.getByRole('button',{name:'Add folder'}));
 await screen.findByText('/External/VST é');expect(invoke).toHaveBeenCalledWith('vst_save_paths',{paths:['/Plugins','/External/VST é']});
 expect(screen.getByText('Broken.vst3: probe crashed')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Scan now'}));expect(invoke).toHaveBeenCalledWith('vst_rescan');
});
test('hybrid plugins appear in both categories, create independent instances, expose buses and open their editor',async()=>{
 const graph:Graph={nodes:[],wires:[]};
 invoke.mockImplementation((c)=>Promise.resolve(c==='vst_catalog'?{scanning:false,plugins:[hybrid],errors:[]}:c==='get_routing_graph'?graph:c==='get_instruments'||c==='get_audio_inputs'?[]:c==='teia_library'?{files:[]}:c==='patches_state'?{entries:[]}:undefined));
 render(<Routing/>);
 const buttons=await screen.findAllByRole('button',{name:'Hybrid · VST3'});expect(buttons).toHaveLength(2);
 fireEvent.doubleClick(buttons[0]);await waitFor(()=>expect(invoke).toHaveBeenCalledWith('vst_prepare',expect.objectContaining({descriptor:hybrid})));
 const first=invoke.mock.calls.find(([c])=>c==='vst_prepare')![1].id;
 const node=await waitFor(()=>{const n=document.querySelector(`[data-node-id="${first}"]`);expect(n).toBeTruthy();return n as HTMLElement;});
 expect(within(node).getByRole('button',{name:`${first} input in-1`})).toBeTruthy();
 fireEvent.doubleClick(node);await waitFor(()=>expect(invoke).toHaveBeenCalledWith('vst_open_editor',{id:first}));
 fireEvent.doubleClick(buttons[1]);await waitFor(()=>expect(invoke.mock.calls.filter(([c])=>c==='vst_prepare')).toHaveLength(2));
 expect(invoke.mock.calls.filter(([c])=>c==='vst_prepare')[1][1].id).not.toBe(first);
 const model:RoutingNode={id:first,kind:'vst',deck:null,label:'Hybrid',x:0,y:0,value:1,vst:hybrid};
 expect(inputs(model)).toEqual(['in-0','in-1']);expect(outputs(model)).toEqual(['out-0','out-1']);
});
