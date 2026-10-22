import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMidiTargets } from './MidiMapping';
import { ParameterKnob } from './ParameterKnob';
type Parameter = {id:number;index:number;name:string;unit:string;min:number;max:number;default:number;steps:number;value:number;text:string;readonly:boolean};
export function PluginControls({id,name,compact=false}:{id:string;name:string;compact?:boolean}) {
  const [parameters,setParameters]=useState<Parameter[]>([]),[error,setError]=useState(''),[search,setSearch]=useState('');
  const key=`vira.plugin-controls.${id}`;
  const [chosen,setChosen]=useState<number[]>(()=>{try {return JSON.parse(localStorage.getItem(key) ?? '[]');} catch {return [];}});
  useEffect(()=>{let alive=true;const poll=()=>{void invoke<Parameter[]>('vst_parameters',{id}).then(p=>{if(alive && Array.isArray(p)) {setParameters(p);setError('');}}).catch(e=>{if(alive)setError(String(e));});};poll();const timer=window.setInterval(poll,500);return()=>{alive=false;window.clearInterval(timer);};},[id]);
  function pick(parameter:number,on:boolean) {const next=on?[...chosen,parameter]:chosen.filter(p=>p!==parameter);setChosen(next);localStorage.setItem(key,JSON.stringify(next));window.dispatchEvent(new CustomEvent('vira-plugin-controls',{detail:id}));}
  useEffect(()=>{const update=(e:Event)=>{if((e as CustomEvent).detail===id) {try {setChosen(JSON.parse(localStorage.getItem(key)??'[]'));} catch {}}};window.addEventListener('vira-plugin-controls',update);return()=>window.removeEventListener('vira-plugin-controls',update);},[id,key]);
  const visible=parameters.filter(p=>compact?chosen.includes(p.id):p.name.toLowerCase().includes(search.toLowerCase()));
  return <div className="plugin-parameters" onDoubleClick={e=>e.stopPropagation()}>
    {!compact && <><label>Find parameter <input aria-label={`${name} find parameter`} value={search} onChange={e=>setSearch(e.target.value)} /></label><p>Choose controls to include when this node is pinned. Each control supports MIDI mapping.</p></>}
    {error && <small role="status">{error}</small>}
    {compact && !visible.length && <small>Select this node to choose pinned parameters.</small>}
    {visible.slice(0,100).map(p=><div key={p.id} className="plugin-parameter-row">
      {!compact && <label><input type="checkbox" aria-label={`Pin ${p.name}`} checked={chosen.includes(p.id)} onChange={e=>pick(p.id,e.target.checked)} />Pin</label>}
      <ParameterKnob midiId={`plugin:${id}:${p.id}`} label={p.name} ariaLabel={`${name} ${p.name}`} value={p.value} min={p.min} max={p.max} defaultValue={p.default} step={p.steps>0?(p.max-p.min)/p.steps:undefined} disabled={p.readonly} formatValue={value=>value===p.value?`${p.text} ${p.unit}`:String(value)} onChange={value=>{setParameters(old=>old.map(q=>q.id===p.id?{...q,value,text:String(value)}:q));void invoke('vst_set_parameter',{id,parameter:p.id,value}).catch(e=>setError(String(e)));}} />
    </div>)}
    {!compact && visible.length>100 && <small>Showing 100 of {visible.length}. Use search to narrow the list.</small>}
  </div>;
}

// MIDI bindings stay active when the inspector is closed. Query only instances
// with saved plugin bindings; the canvas itself remains mounted across pages.
export function PluginMidiTargets({ids}:{ids:string[]}) {
  const [parameters,setParameters]=useState<{instance:string;parameter:Parameter}[]>([]);
  const signature=ids.join(',');
  useEffect(()=>{let alive=true;async function poll() {
    try {
      const bindings: {target:string}[]=JSON.parse(localStorage.getItem('vira.midi-bindings.v1')??'[]');
      const targets=new Map<string,Set<number>>();
      for(const binding of bindings) {const match=/^plugin:([^:]+):(\d+)$/.exec(binding.target);if(match && ids.includes(match[1])) {const set=targets.get(match[1])??new Set<number>();set.add(Number(match[2]));targets.set(match[1],set);}}
      const result=await Promise.all([...targets].map(async([instance,selected])=>({instance,parameters:await invoke<Parameter[]>('vst_parameters',{id:instance,ids:[...selected]}).catch(()=>[])})));
      if(alive)setParameters(result.flatMap(({instance,parameters})=>Array.isArray(parameters)?parameters.map(parameter=>({instance,parameter})):[]));
    } catch {if(alive)setParameters([]);}
  } void poll();const timer=window.setInterval(()=>{void poll();},1000);return()=>{alive=false;window.clearInterval(timer);};},[signature]);
  useMidiTargets(parameters.map(({instance,parameter:p})=>({id:`plugin:${instance}:${p.id}`,label:p.name,kind:'number',min:p.min,max:p.max,step:p.steps>0?(p.max-p.min)/p.steps:undefined,disabled:p.readonly,priority:-1,read:()=>p.value,apply:value=>{void invoke('vst_set_parameter',{id:instance,parameter:p.id,value}).catch(()=>{});}})));
  return null;
}
