// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {PluginControls} from './PluginControls';
const {invoke}=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke}));
afterEach(()=>{cleanup();localStorage.clear();invoke.mockReset();});
const parameters=[{id:47,index:0,name:'Cutoff',unit:'Hz',min:20,max:20000,default:1000,steps:0,value:500,text:'500',readonly:false},{id:90,index:1,name:'Meter',unit:'',min:0,max:1,default:0,steps:0,value:.5,text:'.5',readonly:true}];
test('native parameter ranges, read-only meters and selected pinned controls are exposed',async()=>{
 invoke.mockImplementation(c=>Promise.resolve(c==='vst_parameters'?parameters:undefined));
 const view=render(<PluginControls id="vst-test" name="Synth"/>);
 const cutoff=await screen.findByRole('slider',{name:'Synth Cutoff'});
 expect(cutoff.getAttribute('aria-valuemax')).toBe('20000');
 expect(screen.getByRole('slider',{name:'Synth Meter'}).getAttribute('aria-disabled')).toBe('true');
 fireEvent.keyDown(cutoff,{key:'ArrowUp'});
 await waitFor(()=>expect(invoke).toHaveBeenCalledWith('vst_set_parameter',expect.objectContaining({id:'vst-test',parameter:47})));
 fireEvent.click(screen.getByRole('checkbox',{name:'Pin Cutoff'}));
 expect(JSON.parse(localStorage.getItem('vira.plugin-controls.vst-test')!)).toEqual([47]);
 view.unmount();render(<PluginControls id="vst-test" name="Synth" compact/>);
 await screen.findByRole('slider',{name:'Synth Cutoff'});
 expect(screen.queryByRole('slider',{name:'Synth Meter'})).toBeNull();
});
