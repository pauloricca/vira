import { JogSettings, useJogTargets } from './Jog';
import { Mixer as DeckMixer, type AudioState } from './Decks';
import { useMeterFeed } from './LevelMeter';
function Mixer(props: Omit<Parameters<typeof DeckMixer>[0], 'meters'>) {
 const meters = useMeterFeed(props.audio.running);
 return <DeckMixer {...props} meters={meters} />;
}
// @vitest-environment jsdom
import { invoke } from '@tauri-apps/api/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MidiProvider, MidiToggle, MidiSettings, MidiEditor, MidiInput, MidiButton, MidiSelect, mappedValue, wheelDelta, useMidiTargets, type MidiCc, type MidiMessage, type MidiBinding } from './MidiMapping';
const api = vi.hoisted(() => ({messages:[] as MidiMessage[]}));
vi.mock('@tauri-apps/api/core', () => ({invoke:vi.fn(async (command: string) => command === 'get_audio_levels' ? {running:false,decks:[0,0],master:[0,0]} : ({devices:[{id:42,name:'Controller'}],messages:api.messages.splice(0)}))}));
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); localStorage.setItem('vira.midi-behavior.v1', JSON.stringify('jump')); api.messages = []; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function tick(messages:MidiMessage[] = []) { api.messages.push(...messages); await act(async () => { await vi.advanceTimersByTimeAsync(40); }); }
const cc = (value:number, channel=1, device=42):MidiCc => ({device,channel,cc:7,value});
function Shell({children}:{children:React.ReactNode}) { return <MidiProvider>{children}<MidiToggle /><MidiSettings /><MidiEditor /></MidiProvider>; }
const binding:MidiBinding = {target:'test',label:'Test',device:42,channel:1,cc:7,min:-12,max:12,mode:'absolute',invert:false};
test('crossfader MIDI mapping is inactive while hidden and resumes when shown', async () => {
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 localStorage.setItem('vira.midi-bindings.v1',JSON.stringify([{...binding,target:'ui:Crossfader',min:-1,max:1}]));
 const control = vi.fn().mockResolvedValue(undefined);
 const audio:AudioState = {running:true,error:null,telemetry:{},decks:[0,1].map(deck => ({deck,loading:false,error:null,playing:false,position_seconds:0,gain:1,generation:0,requested_generation:0,track:null}))};
 const view = render(<Shell><Mixer audio={audio} control={control} showCrossfader={false} /></Shell>);
 expect(screen.queryByRole('slider',{name:'Crossfader'})).toBeNull();
 await tick([cc(127)]); expect(control).not.toHaveBeenCalled();
 view.rerender(<Shell><Mixer audio={audio} control={control} /></Shell>);
 await tick([cc(0)]); expect(control).toHaveBeenLastCalledWith(0,'crossfader',-1);
 control.mockClear();
 view.rerender(<Shell><Mixer audio={audio} control={control} showCrossfader={false} /></Shell>);
 await tick([cc(127),cc(0)]); expect(control).not.toHaveBeenCalled();
 expect(JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!)).toHaveLength(1);
 view.rerender(<Shell><Mixer audio={audio} control={control} /></Shell>);
 await tick([cc(127)]); expect(control).toHaveBeenLastCalledWith(0,'crossfader',1);
});
test('converts, inverts, quantizes and clamps numeric and discrete values', () => {
 const target = {id:'test',label:'Test',kind:'number' as const,min:-12,max:12,step:.5,apply:vi.fn()};
 expect(mappedValue(binding,target,0)).toBe(-12);
 expect(mappedValue({...binding,invert:true},target,0)).toBe(12);
 expect(mappedValue({...binding,min:-100,max:100},target,127)).toBe(12);
 expect(mappedValue({...binding,min:0,max:2},{...target,kind:'choice',choices:['a','b','c']},64)).toBe(1);
});
test('learns only from enabled sources, blocks normal UI changes, persists and filters channel', async () => {
 const change = vi.fn();
 render(<Shell><MidiInput aria-label="Gain" type="range" min={0} max={2} step={.01} value={0} onChange={e => change(+e.target.value)} /></Shell>);
 await tick(); fireEvent.click(screen.getByRole('button',{name:'MIDI map'}));
 fireEvent.click(screen.getByLabelText('Gain'));
 await tick([cc(40)]); expect(localStorage.getItem('vira.midi-bindings.v1')).toBe('[]');
 fireEvent.click(screen.getByLabelText('Enable MIDI mapping from Controller'));
 await tick([cc(40,2)]);
 expect(screen.getByLabelText('Gain').getAttribute('data-midi-mapped')).toBe('true'); expect(change).not.toHaveBeenCalled();
 expect(JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!)[0]).toMatchObject({device:42,channel:2,cc:7});
 fireEvent.click(screen.getByRole('button',{name:'MIDI map'}));
 await tick([cc(127,1),cc(127,2,99)]); expect(change).not.toHaveBeenCalled();
 await tick([cc(127,2)]); expect(change).toHaveBeenLastCalledWith(2);
 fireEvent.click(screen.getByLabelText('Enable MIDI mapping from Controller'));
 await tick([cc(0,2)]); expect(change).toHaveBeenCalledTimes(1);
});
test('button mappings fire on a rising press, never repeatedly or on release', async () => {
 localStorage.removeItem('vira.midi-behavior.v1');
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 localStorage.setItem('vira.midi-bindings.v1',JSON.stringify([{...binding,target:'ui:play',mode:'trigger'}]));
 const click = vi.fn(); render(<Shell><MidiButton midiId="play" onClick={click}>Play</MidiButton></Shell>);
 await tick([cc(127),cc(127),cc(0),cc(127)]); expect(click).toHaveBeenCalledTimes(2);
});
test('choice adapter maps to option values rather than their numeric indexes', async () => {
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 localStorage.setItem('vira.midi-bindings.v1',JSON.stringify([{...binding,target:'ui:division',min:0,max:2}]));
 const change = vi.fn(); render(<Shell><MidiSelect midiId="division" value="4" onChange={e => change(e.target.value)}>{[1,4,8].map(n => <option key={n} value={n}>{n}</option>)}</MidiSelect></Shell>);
 await tick([cc(127)]); expect(change).toHaveBeenLastCalledWith('8');
});
test('entity targets stay independent, use current handlers and stop when removed', async () => {
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 localStorage.setItem('vira.midi-bindings.v1',JSON.stringify([{...binding,target:'pattern:a:octave',min:2,max:5}]));
 const a=vi.fn(), b=vi.fn();
 function Targets({first=true}:{first?:boolean}) { useMidiTargets([...(first ? [{id:'pattern:a:octave',label:'Octave',kind:'number' as const,min:2,max:5,step:1,apply:a}] : []),{id:'pattern:b:octave',label:'Octave',kind:'number',min:2,max:5,step:1,apply:b}]); return null; }
 const view=render(<Shell><Targets /></Shell>); await tick([cc(127)]); expect(a).toHaveBeenLastCalledWith(5); expect(b).not.toHaveBeenCalled();
 view.rerender(<Shell><Targets first={false} /></Shell>); await tick([cc(0)]); expect(a).toHaveBeenCalledTimes(1);
});
test('held gate releases when its controller is disabled or mapping mode starts', async () => {
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 localStorage.setItem('vira.midi-bindings.v1',JSON.stringify([{...binding,target:'cue',mode:'gate'}]));
 const apply=vi.fn();
 function Cue() { useMidiTargets([{id:'cue',label:'Cue',kind:'switch',defaultMode:'gate',apply}]); return null; }
 render(<Shell><Cue /></Shell>);
 await tick([cc(127)]); expect(apply).toHaveBeenLastCalledWith(1);
 fireEvent.click(screen.getByLabelText('Enable MIDI mapping from Controller')); expect(apply).toHaveBeenLastCalledWith(0);
 fireEvent.click(screen.getByLabelText('Enable MIDI mapping from Controller'));
 await tick([cc(127)]); expect(apply).toHaveBeenLastCalledWith(1);
 fireEvent.click(screen.getByRole('button',{name:'MIDI map'})); expect(apply).toHaveBeenLastCalledWith(0);
});

const note = (value:number, channel=1, device=42, number=7):MidiMessage => ({type:'note',device,channel,note:number,value});
test('learns Note On only, persists source type, and distinguishes notes from CCs', async () => {
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 const click=vi.fn(); render(<Shell><MidiButton midiId="note-button" onClick={click}>Button</MidiButton></Shell>);
 await tick(); fireEvent.click(screen.getByRole('button',{name:'MIDI map'})); fireEvent.click(screen.getByRole('button',{name:'Button'}));
 await tick([note(0),note(90,1,99)]); expect(localStorage.getItem('vira.midi-bindings.v1')).toBe('[]');
 await tick([note(1,2)]);
 expect(JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!)[0]).toMatchObject({type:'note',note:7,channel:2,mode:'trigger'});
 expect(screen.getByText(/Ch 2 · Note 7/, {selector:'span'})).toBeTruthy(); expect(click).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'MIDI map'}));
 await tick([cc(127,2),note(127,1),note(127,2,99),note(127,2,42,8)]); expect(click).not.toHaveBeenCalled();
 await tick([note(1,2),note(0,2),note(32,2),note(0,2)]); expect(click).toHaveBeenCalledTimes(2);
});
test('saved note buttons fire at every positive Note On, including low velocity', async () => {
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 localStorage.setItem('vira.midi-bindings.v1',JSON.stringify([{...binding,target:'ui:note-button',type:'note',note:7,mode:'trigger'}]));
 const click=vi.fn(); render(<Shell><MidiButton midiId="note-button" onClick={click}>Button</MidiButton></Shell>);
 await tick([note(1),note(20),note(0),cc(127)]); expect(click).toHaveBeenCalledTimes(2);
});
test.each(['gate', 'trigger'])('cue note gates press and release, including older %s bindings', async mode => {
 localStorage.removeItem('vira.midi-behavior.v1');
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 localStorage.setItem('vira.midi-bindings.v1',JSON.stringify([{...binding,target:'cue',type:'note',note:7,mode}]));
 const apply=vi.fn();
 function Cue() {useMidiTargets([{id:'cue',label:'Cue',kind:'switch',defaultMode:'gate',apply}]);return null;}
 render(<Shell><Cue /></Shell>); await tick([note(1),note(60),note(0),note(0)]);
 expect(apply.mock.calls).toEqual([[1],[0]]);
});
test('absolute note mappings use velocity and ignore note releases', async () => {
 localStorage.removeItem('vira.midi-behavior.v1');
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 localStorage.setItem('vira.midi-bindings.v1',JSON.stringify([{...binding,target:'ui:velocity',type:'note',note:7,min:0,max:2}]));
 const change=vi.fn(); render(<Shell><MidiInput midiId="velocity" type="range" min={0} max={2} step={.01} value={0} onChange={e => change(+e.target.value)} /></Shell>);
 await tick([note(127),note(0)]); expect(change.mock.calls).toEqual([[2]]);
});

function setupGrab(bindings: MidiBinding[] = [{...binding,target:'ui:pickup',min:0,max:1}]) {
 localStorage.removeItem('vira.midi-behavior.v1');
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 localStorage.setItem('vira.midi-bindings.v1',JSON.stringify(bindings));
}
test('Grab is the persisted default, waits for real crossing, and keeps following after pickup', async () => {
 setupGrab(); const change=vi.fn();
 render(<Shell><MidiInput midiId="pickup" type="range" min={0} max={1} step={.001} value={.5} onChange={e => change(+e.target.value)} /></Shell>);
 expect((screen.getByLabelText('MIDI controller behaviour') as HTMLSelectElement).value).toBe('grab');
 expect(JSON.parse(localStorage.getItem('vira.midi-behavior.v1')!)).toBe('grab');
 await tick([cc(100),cc(90)]); expect(change).not.toHaveBeenCalled();
 await tick([cc(60),cc(20)]); expect(change.mock.calls.map(([value]) => Number(value.toFixed(3)))).toEqual([.472,.157]);
});
test('pickup reaches values between MIDI positions and re-arms after an external edit', async () => {
 setupGrab(); const change=vi.fn();
 const control=(value:number) => <Shell><MidiInput midiId="pickup" type="range" min={0} max={1} step={.001} value={value} onChange={e => change(+e.target.value)} /></Shell>;
 const view=render(control(.5));
 await tick([cc(64)]); expect(change).toHaveBeenLastCalledWith(.504);
 view.rerender(control(.504)); await tick([cc(80)]); expect(change).toHaveBeenLastCalledWith(.63);
 view.rerender(control(.2)); change.mockClear();
 await tick([cc(75),cc(40)]); expect(change).not.toHaveBeenCalled();
 await tick([cc(20)]); expect(change).toHaveBeenLastCalledWith(.157);
});
test('shared sources acquire each target independently with inverted and reversed ranges', async () => {
 setupGrab([{...binding,target:'ui:pickup',min:1,max:0,invert:true},{...binding,target:'ui:other',min:0,max:1}]);
 const a=vi.fn(),b=vi.fn();
 render(<Shell><MidiInput midiId="pickup" type="range" min={0} max={1} step={.001} value={.25} onChange={e => a(+e.target.value)} /><MidiInput midiId="other" type="range" min={0} max={1} step={.001} value={.75} onChange={e => b(+e.target.value)} /></Shell>);
 await tick([cc(0),cc(40)]); expect(a).toHaveBeenCalledTimes(1); expect(b).not.toHaveBeenCalled();
 await tick([cc(100)]); expect(b).toHaveBeenCalledTimes(1);
});
test('Jump applies immediately and is restored; switching back to Grab clears pickup', async () => {
 setupGrab(); const change=vi.fn();
 const control=<Shell><MidiInput midiId="pickup" type="range" min={0} max={1} step={.001} value={.5} onChange={e => change(+e.target.value)} /></Shell>;
 const view=render(control); await tick([cc(0)]); expect(change).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('MIDI controller behaviour'),{target:{value:'jump'}});
 await tick([cc(10)]); expect(change).toHaveBeenLastCalledWith(.079);
 view.unmount(); render(control);
 expect((screen.getByLabelText('MIDI controller behaviour') as HTMLSelectElement).value).toBe('jump');
 fireEvent.change(screen.getByLabelText('MIDI controller behaviour'),{target:{value:'grab'}});
 change.mockClear(); await tick([cc(100)]); expect(change).not.toHaveBeenCalled();
});
test('Grab uses discrete choice values and resets when controller permissions change', async () => {
 setupGrab([{...binding,target:'ui:division',min:0,max:2}]); const change=vi.fn();
 render(<Shell><MidiSelect midiId="division" value="4" onChange={e => change(e.target.value)}>{[1,4,8].map(n => <option key={n} value={n}>{n}</option>)}</MidiSelect></Shell>);
 await tick([cc(127)]); expect(change).not.toHaveBeenCalled();
 await tick([cc(64)]); expect(change).toHaveBeenLastCalledWith('4');
 fireEvent.click(screen.getByLabelText('Enable MIDI mapping from Controller'));
 fireEvent.click(screen.getByLabelText('Enable MIDI mapping from Controller'));
 change.mockClear(); await tick([cc(0)]); expect(change).not.toHaveBeenCalled();
});
test('Grab accepts delayed feedback from a batch of its own MIDI writes', async () => {
 setupGrab(); const change=vi.fn();
 const control=(value:number) => <Shell><MidiInput midiId="pickup" type="range" min={0} max={1} step={.001} value={value} onChange={e => change(+e.target.value)} /></Shell>;
 const view=render(control(.5)); await tick([cc(64),cc(80),cc(100)]);
 view.rerender(control(.63)); change.mockClear();
 await tick([cc(110)]); expect(change).toHaveBeenLastCalledWith(.866);
 view.rerender(control(.787)); await tick([cc(120)]); expect(change.mock.calls.at(-1)?.[0]).toBeCloseTo(.945);
});

test('manual controller refresh scans current endpoints without consuming MIDI messages', async () => {
 render(<Shell><span /></Shell>);
 await tick();
 vi.mocked(invoke).mockResolvedValueOnce({inputs:[{id:43,name:'New controller'}],outputs:[]});
 await act(async () => { fireEvent.click(screen.getByRole('button', {name:'Refresh MIDI controllers'})); });
 expect(invoke).toHaveBeenLastCalledWith('get_midi_devices');
 expect(screen.getByLabelText('Enable MIDI mapping from New controller')).toBeTruthy();
 expect(screen.queryByLabelText('Enable MIDI mapping from Controller')).toBeNull();
});


test('decodes common wheel encodings and absolute wrap in both directions', () => {
 expect([1,127,0,64].map(v => wheelDelta('relative-twos',v))).toEqual([1,-1,0,0]);
 expect([65,63,64].map(v => wheelDelta('relative-offset',v))).toEqual([1,-1,0]);
 expect([1,65,0,64].map(v => wheelDelta('relative-sign',v))).toEqual([1,-1,0,0]);
 expect(wheelDelta('wheel-absolute',0)).toBe(0);
 expect(wheelDelta('wheel-absolute',0,127)).toBe(1);
 expect(wheelDelta('wheel-absolute',127,0)).toBe(-1);
});
test('wheel mappings bypass Grab, batch displacement, invert and respect disabled targets', async () => {
 setupGrab([{...binding,mode:'relative-twos',invert:true}]);
 const apply=vi.fn();
 function Wheel({disabled=false}:{disabled?:boolean}) { useMidiTargets([{id:'test',label:'Wheel',kind:'relative',disabled,apply}]); return null; }
 const view=render(<Shell><Wheel /></Shell>);
 await tick([cc(1),cc(2),cc(127),note(127)]);
 expect(apply.mock.calls).toEqual([[-2]]);
 view.rerender(<Shell><Wheel disabled /></Shell>);
 await tick([cc(5)]); expect(apply).toHaveBeenCalledTimes(1);
});

test('waveform targets use independent persisted sensitivities and block playing locks', async () => {
 setupGrab([{...binding,target:'deck:0:jog',mode:'relative-twos',invert:false}]);
 const control=vi.fn(async () => {});
 function Deck({playing=false,locked=false,editing=false}:{playing?:boolean;locked?:boolean;editing?:boolean}) {
   const audio:AudioState = {running:true,error:null,telemetry:{},decks:[{deck:0,loading:false,error:null,track:{track_id:'track',artifact_id:'a',title:'Track',artist:'',filename:'t',duration_seconds:100,frames:4800000,peak_frames:240,peaks:[]},position_seconds:10,playing,synced:locked,gain:1,generation:1,requested_generation:1,grid_edit:editing ? {bpm:120,downbeat_seconds:0,reviewed:true} : null}]};
   useJogTargets(audio,control); return null;
 }
 const view=render(<Shell><Deck /><JogSettings /></Shell>);
 fireEvent.change(screen.getByLabelText('Waveform wheel stopped movement'),{target:{value:'30'}});
 fireEvent.change(screen.getByLabelText('Waveform wheel playing movement'),{target:{value:'3'}});
 expect(localStorage.getItem('vira.jog-stopped-ms')).toBe('30');
 expect(localStorage.getItem('vira.jog-playing-ms')).toBe('3');
 await tick([cc(2)]); expect(control).toHaveBeenLastCalledWith(0,'jog',.06);
 view.rerender(<Shell><Deck playing /><JogSettings /></Shell>);
 await tick([cc(127)]); expect(control).toHaveBeenLastCalledWith(0,'jog',-.003);
 control.mockClear();
 view.rerender(<Shell><Deck playing locked /><JogSettings /></Shell>);
 await tick([cc(1)]); expect(control).not.toHaveBeenCalled();
 view.rerender(<Shell><Deck locked /><JogSettings /></Shell>);
 await tick([cc(1)]); expect(control).toHaveBeenLastCalledWith(0,'jog',.03);
 control.mockClear();
 view.rerender(<Shell><Deck editing /><JogSettings /></Shell>);
 await tick([cc(1)]); expect(control).not.toHaveBeenCalled();
});

test('waveform learning accepts CC wheels and exposes persisted wheel encodings', async () => {
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 const apply=vi.fn();
 function Wheel() { useMidiTargets([{id:'wheel',label:'Rolling waveform deck A',kind:'relative',defaultMode:'relative-twos',apply}]); return <div role="img" aria-label="Wheel waveform" data-midi-target="wheel" />; }
 render(<Shell><Wheel /></Shell>); await tick();
 fireEvent.click(screen.getByRole('button',{name:'MIDI map'}));
 fireEvent.click(screen.getByLabelText('Wheel waveform'));
 await tick([note(127)]); expect(JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!)).toEqual([]);
 await tick([cc(1)]);
 expect(JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!)[0]).toMatchObject({target:'wheel',mode:'relative-twos',type:'cc'});
 fireEvent.change(screen.getByLabelText('MIDI mapping behavior'),{target:{value:'relative-offset'}});
 fireEvent.click(screen.getByRole('button',{name:'MIDI map'}));
 await tick([cc(65)]); expect(apply).toHaveBeenLastCalledWith(1);
 expect(JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!)[0].mode).toBe('relative-offset');
});

test('adds several controls to one parameter, edits and relearns independently, and restores them', async () => {
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 const change = vi.fn();
 const control = <Shell><MidiInput aria-label="Gain" type="range" min={0} max={2} step={.01} value={0} onChange={e => change(+e.target.value)} /></Shell>;
 const view = render(control); await tick();
 fireEvent.click(screen.getByRole('button',{name:'MIDI map'}));
 fireEvent.click(screen.getByLabelText('Gain')); await tick([cc(50)]);
 fireEvent.change(screen.getByLabelText('MIDI mapping max'),{target:{value:'1'}});
 fireEvent.click(screen.getByRole('button',{name:'Add another control'}));
 await tick([note(100,2)]);
 let saved = JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!);
 expect(saved).toHaveLength(2); expect(saved[0]).toMatchObject({cc:7,max:1});
 expect(saved[1]).toMatchObject({type:'note',note:7,channel:2,max:2});
 fireEvent.change(screen.getByLabelText('MIDI mapping max'),{target:{value:'1.5'}});
 fireEvent.click(screen.getByRole('button',{name:'Relearn'})); await tick([note(80,3)]);
 saved = JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!);
 expect(saved).toHaveLength(2); expect(saved[0]).toMatchObject({cc:7,max:1});
 expect(saved[1]).toMatchObject({type:'note',channel:3});
 // Adding the same source again keeps its configuration and does not create duplicates.
 fireEvent.click(screen.getByRole('button',{name:'Add another control'})); await tick([cc(100)]);
 saved = JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!);
 expect(saved).toHaveLength(2); expect(saved.find((b:MidiBinding) => b.type !== 'note').max).toBe(1);
 fireEvent.click(screen.getByRole('button',{name:'MIDI map'}));
 view.unmount(); render(control);
 await tick([cc(127),note(127,3)]); expect(change.mock.calls).toEqual([[1],[2]]);
 fireEvent.click(screen.getByRole('button',{name:'MIDI map'})); fireEvent.click(screen.getByLabelText('Gain'));
 const mappings = screen.getByLabelText('Saved MIDI mappings') as HTMLSelectElement;
 expect(mappings.options).toHaveLength(3);
 fireEvent.change(mappings,{target:{value:Array.from(mappings.options).find(option => option.text.includes('Ch 1 · CC 7'))!.value}});
 fireEvent.click(screen.getByRole('button',{name:'Remove'}));
 expect(JSON.parse(localStorage.getItem('vira.midi-bindings.v1')!)).toMatchObject([{type:'note',channel:3}]);
 expect(screen.getByLabelText('Gain').getAttribute('data-midi-mapped')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'MIDI map'})); change.mockClear();
 await tick([cc(0),note(127,3)]); expect(change.mock.calls).toEqual([[2]]);
});

test('Grab tracks crossing separately for multiple controls on the same parameter', async () => {
 setupGrab([{...binding,target:'ui:pickup',min:0,max:1},{...binding,target:'ui:pickup',channel:2,min:0,max:1}]);
 const change=vi.fn();
 render(<Shell><MidiInput midiId="pickup" type="range" min={0} max={1} step={.001} value={.5} onChange={e => change(+e.target.value)} /></Shell>);
 await tick([cc(100),cc(100,2),cc(40),cc(40,2)]);
 expect(change.mock.calls).toEqual([[.315],[.315]]);
});

test('multiple gate controls keep a parameter held until the last control releases', async () => {
 localStorage.setItem('vira.midi-enabled.v1','[42]');
 localStorage.setItem('vira.midi-bindings.v1',JSON.stringify([{...binding,target:'cue',mode:'gate'},{...binding,target:'cue',channel:2,mode:'gate'}]));
 const apply=vi.fn();
 function Cue() { useMidiTargets([{id:'cue',label:'Cue',kind:'switch',defaultMode:'gate',apply}]); return null; }
 render(<Shell><Cue /></Shell>);
 await tick([cc(127),cc(127,2),cc(0)]); expect(apply.mock.calls).toEqual([[1]]);
 await tick([cc(0,2)]); expect(apply.mock.calls).toEqual([[1],[0]]);
});
