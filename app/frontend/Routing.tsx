import { PluginControls, PluginMidiTargets } from './PluginControls';
import { useVsts, type VstDescriptor } from './vstModel';
import { selectorPorts, SelectorControl } from './selector';
import { ParameterKnob } from './ParameterKnob';
import { PinButton, PinnedSource, instrumentPin, patchPin } from './pinnedComponents';
import { addMixerLine, arrangeMixerLines, mixerLine, mixerLines, lineColours, lineName, lineNodeWidth, mixerLineBounds, compactMixerGraph } from './mixerLines';
import type { AudioState } from './Decks';
import type { CSSProperties } from 'react';
import { Slider } from './Slider';
import { MidiButton, MidiSelect, useMidiTargets, useMidiMarkers } from './MidiMapping';
import { instrumentGraph, engineGraph } from './routingInstruments';
import { useInstruments } from './instrumentModel';
import { PatchSelectionBox, patchSelectionRect, patchIntersects, movePatchGroup, type PatchMarquee, snapPatchPoint, patchSize, PatchingPage, PatchingHeading, PatchingNodeHeader, patchPortTop, patchPortPoint, NodePalette, nodePlacement, paletteDrop, paletteDragOver, usePatchingKeys, type PatchPoint } from './Patching';
import { canvasPosition, cablePath as path } from './routingGeometry';
import { useEffect, useRef, useState } from 'react';
import { addSessionPatch, usePatchLibrary, patchAudioInputs } from './patchLibrary';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

type Kind = 'vst' | 'selector' | 'instrument' | 'input' | 'player' | 'trim' | 'eq' | 'filter' | 'fader' | 'cue_switch' | 'crossfader' | 'cue' | 'output' | 'gain' | 'compressor' | 'oscillator' | 'ring_modulation' | 'patch';
export type RoutingNode = { vst?: VstDescriptor; id: string; kind: Kind; deck: number | null; label: string; custom_label?: string; x: number; y: number; value: number; eq?: [number, number, number]; instrument_input?: boolean; instrument_output?: boolean; patch_inputs?: { id: string; label: string }[] };
export type Wire = { from: string; output: string; to: string; input: string; gain: number };
export type Graph = { nodes: RoutingNode[]; wires: Wire[] };
export const inputs = (node: RoutingNode) => node.kind === 'vst' ? node.vst?.inputs.map(b => b.id) ?? [] : node.kind === 'instrument' ? node.instrument_input ? ['audio'] : [] : (node.kind === 'patch' || node.kind === 'selector') && node.patch_inputs ? node.patch_inputs.map(p => p.id) : node.kind === 'input' || node.kind === 'player' || node.kind === 'oscillator' ? [] : node.kind === 'crossfader' || node.kind === 'cue' ? ['A', 'B'] : node.kind === 'compressor' ? ['audio', 'sidechain'] : node.kind === 'ring_modulation' ? ['audio', 'carrier'] : ['audio'];
export const outputs = (node: RoutingNode) => node.kind === 'vst' ? node.vst?.outputs.map(b => b.id) ?? [] : node.kind === 'instrument' ? node.instrument_output ? ['audio'] : [] : node.kind === 'output' ? [] : node.kind === 'compressor' || node.kind === 'ring_modulation' ? ['audio', 'dry'] : node.kind === 'oscillator' ? ['audio', 'cosine'] : ['audio'];
const removable = (node: RoutingNode) => (mixerLine(node) ?? -1) > 1 || node.kind === 'input' || node.kind === 'patch' || node.kind === 'instrument' || node.kind === 'vst' || isProcessor(node);
const liveParameter = (node: RoutingNode) => isProcessor(node) || (mixerLine(node) !== null && node.deck === null);
const isProcessor = (node: RoutingNode) => ['selector', 'gain', 'compressor', 'oscillator', 'ring_modulation'].includes(node.kind);
const point = (node: RoutingNode, port: string, output: boolean) => {
  if (mixerLine(node) === null) return patchPortPoint(node, (output ? outputs(node) : inputs(node)).indexOf(port), output);
  const width = lineNodeWidth(node);
  return {x:node.x + (output ? width : 0),y:node.y + 20};
};
const wirePath = (from: RoutingNode, to: RoutingNode, wire: Wire) => {
  return path(point(from, wire.output, true), point(to, wire.input, false));
};
const nodeSize = (node:RoutingNode) => ({width:mixerLine(node) !== null ? lineNodeWidth(node) : 160,height:mixerLine(node) !== null ? 40 : patchSize(Math.max(120,70+Math.max(inputs(node).length,outputs(node).length)*26)+(isProcessor(node) && node.kind !== 'ring_modulation' ? 52 : 0))});
const selectionIds = (selection:Selection) => selection && 'node' in selection ? selection.nodes ?? [selection.node] : [];
const expandLines = (graph:Graph,ids:string[]) => graph.nodes.filter(n => ids.includes(n.id) || mixerLine(n) !== null && graph.nodes.some(other => ids.includes(other.id) && mixerLine(other) === mixerLine(n))).map(n => n.id);
const sameWire = (a:Wire,b:Wire) => a.from === b.from && a.to === b.to && a.input === b.input && a.output === b.output;
const wireMidiId = (w:Wire) => `routing:wire:${JSON.stringify([w.from,w.output,w.to,w.input])}`;
const equal = (a: Graph | null, b: Graph | null) => JSON.stringify(a) === JSON.stringify(b);
type Selection = { node: string; nodes?: string[] } | { wire: number } | null;
type Patch = { from: string; output: string; x: number; y: number; pointer: number; reconnect?: { index: number; wire: Wire; end: 'source' | 'target' } };
type Moving = { ids: string[]; startX: number; startY: number; before: Graph; pointer: number };
const processors: Record<string, string> = { selector: 'Selector', compressor: 'Compressor', gain: 'Gain', ring_modulation: 'Ring modulator', oscillator: 'Sine instrument' };

export function Routing({ active = true, audio, control }: { active?: boolean; audio?: AudioState; control?: (deck:number, action:string, value?:number) => Promise<void> }) {
  const instruments = useInstruments(active);
  const vsts = useVsts(active);
  const [audioInputs, setAudioInputs] = useState<RoutingNode[]>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const current = useRef<Graph | null>(null);
  const [accepted, setAccepted] = useState<Graph | null>(null);
  const acceptedRef = useRef<Graph | null>(null);
  acceptedRef.current = accepted;
  useEffect(()=>{const retain=()=>{const ids=[...new Set([...(current.current?.nodes ?? []),...(acceptedRef.current?.nodes ?? [])].filter(n=>n.kind==='vst').map(n=>n.id))];void invoke('vst_retain',{ids}).catch(()=>{});};const timer=window.setInterval(retain,5000);return()=>window.clearInterval(timer);},[]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveApplying, setLiveApplying] = useState(false);
  const lastLiveAttempt = useRef('');
  const writeInFlight = useRef(false);
  const {files, entries: patchEntries} = usePatchLibrary(active);
  const [zoom, setZoom] = useState(.8);
  const [selected, setSelected] = useState<Selection>(null);
  const [patch, setPatch] = useState<Patch | null>(null);
  const patchRef = useRef<Patch | null>(null);
  const moving = useRef<Moving | null>(null);
  const marquee = useRef<PatchMarquee|null>(null);
  const [box,setBox] = useState<PatchMarquee|null>(null);
  const selectedIds = selectionIds(selected);
  const selectedObjects = new Set(graph?.nodes.filter(n => selectedIds.includes(n.id)).map(n => mixerLine(n) === null ? n.id : `line:${mixerLine(n)}`)).size;
  const selectNodes = (ids:string[]) => setSelected(ids.length ? {node:ids[0],nodes:ids} : null);
  const selectNode = (id:string) => { if (current.current && !selectedIds.includes(id)) selectNodes(expandLines(current.current,[id])); };
  const beginMove = (e:React.PointerEvent,ids:string[]) => {
    if (busy || e.button !== 0 || !current.current) return;
    e.preventDefault(); e.stopPropagation();
    const chosen = ids.some(id => selectedIds.includes(id)) ? selectedIds : expandLines(current.current,ids);
    selectNodes(chosen); const p = position(e); canvas.current?.setPointerCapture(e.pointerId);
    moving.current = {ids:chosen,startX:p.x,startY:p.y,before:current.current,pointer:e.pointerId};
  };
  const updateMarquee = (p:PatchPoint) => {
    const drag = marquee.current, g = current.current; if (!drag || !g) return;
    const next = {...drag,end:p}; marquee.current = next; setBox(next);
    const rect = patchSelectionRect(drag.start,p);
    const ids = g.nodes.filter(n => {
      const line = mixerLine(n), nodes = line === null ? [n] : g.nodes.filter(other => mixerLine(other) === line);
      const bounds = line === null ? {...n,...nodeSize(n)} : mixerLineBounds(nodes);
      return patchIntersects(rect,bounds);
    }).map(n => n.id);
    selectNodes(expandLines(g,ids));
  };
  const [, setHistoryRevision] = useState(0);
  const past = useRef<Graph[]>([]), future = useRef<Graph[]>([]);
  const gesture = useRef<Graph | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const dirty = !equal(graph, accepted);
  const canvasWidth = Math.max(1600, ...(graph?.nodes.map(n => n.x + 220) ?? []));
  const canvasHeight = Math.max(900, ...(graph?.nodes.map(n => n.y + Math.max(180,nodeSize(n).height) + 40) ?? []));
  const showGraph = (value: Graph) => { current.current = value; setGraph(value); };
  const record = (before: Graph, after: Graph) => {
    if (equal(before, after)) return;
    past.current = [...past.current.slice(-99), before]; future.current = []; setHistoryRevision(v => v + 1);
  };
  const edit = (value: Graph) => {
    value = {...value,nodes:value.nodes.map(n => n.kind !== 'selector' ? n : {...n,patch_inputs:selectorPorts(value.wires.filter(w => w.to === n.id).map(w => w.input), inputs(n)[n.value] ?? 'A').map(id => ({id,label:id}))})};
    if (!current.current) return;
    if (!gesture.current) record(current.current, value);
    showGraph(value); setError(null);
  };
  const endGesture = () => { if (gesture.current && current.current) record(gesture.current, current.current); gesture.current = null; };
  const cancelPatch = () => { patchRef.current = null; setPatch(null); };
  const cancelInteraction = () => {
    if (marquee.current) selectNodes([]);
    marquee.current = null; setBox(null);
    cancelPatch();
    if (moving.current) { showGraph(moving.current.before); moving.current = null; }
    endGesture();
  };
  const receiveGraph = (raw: Graph) => {
    const normalized = instrumentGraph(raw, instruments);
    const value = compactMixerGraph(normalized);
    const previous = acceptedRef.current;
    const added = value.nodes.filter(n => n.kind === 'patch' && !previous?.nodes.some(old => old.id === n.id));
    const removed = previous?.nodes.filter(n => (n.kind === 'patch' || n.id.startsWith('instrument-')) && !value.nodes.some(next => next.id === n.id)).map(n => n.id) ?? [];
    const merge = (draft: Graph): Graph => {
      draft = instrumentGraph(draft, instruments);
      const nodes = [...draft.nodes.filter(n => !removed.includes(n.id)).map(n => {
        const live = value.nodes.find(next => (next.kind === 'patch' || next.kind === 'input' || next.kind === 'instrument' || next.id === 'headphones') && next.id === n.id);
        const previousNode = previous?.nodes.find(old => old.id === n.id);
        const parameters = value.nodes.find(next => next.id === n.id);
        if (parameters && previousNode) n = {...n, ...(n.value === previousNode.value ? {value:parameters.value} : {}), ...(JSON.stringify(n.eq) === JSON.stringify(previousNode.eq) ? {eq:parameters.eq} : {})};
        return live ? { ...n, label: live.label, patch_inputs: live.patch_inputs, instrument_input: live.instrument_input, instrument_output: live.instrument_output } : n;
      }), ...added.filter(n => !draft.nodes.some(old => old.id === n.id))];
      const valid = (w: Wire) => { const target = nodes.find(n => n.id === w.to); const source = nodes.find(n => n.id === w.from); return source && outputs(source).includes(w.output) && target && inputs(target).includes(w.input); };
      const wires = draft.wires.filter(valid);
      for (const wire of value.wires) {
        const old = previous?.nodes.find(n => n.id === wire.to);
        const newlyAdded = added.some(n => n.id === wire.from || n.id === wire.to);
        const newInput = value.nodes.some(n => n.id === wire.to && n.kind === 'patch') && old && !inputs(old).includes(wire.input);
        if ((newlyAdded || newInput) && valid(wire) && !wires.some(w => w.from === wire.from && w.to === wire.to && w.input === wire.input && w.output === wire.output)) wires.push(wire);
      }
      return { nodes, wires };
    };
    if (current.current && !equal(current.current, previous)) showGraph(merge(current.current));
    else showGraph(value);
    past.current = past.current.map(merge); future.current = future.current.map(merge);
    if (removed.length) setSelected(null);
    acceptedRef.current = value; setAccepted(value);
  };
  useEffect(() => {
    let stopped = false, unlisten: (() => void) | undefined;
    const refresh = () => {
      void invoke<RoutingNode[]>('get_audio_inputs').then(value => { if (!stopped) setAudioInputs(Array.isArray(value) ? value : []); }).catch(e => { if (!stopped) setError(String(e)); });
      void invoke<Graph>('get_routing_graph').then(value => { if (!stopped && !writeInFlight.current) receiveGraph(value); }).catch(e => { if (!stopped) setError(String(e)); }); };
    if (active || !current.current) refresh();
    const timer = window.setInterval(refresh, active ? 3000 : 6000);
    void listen<Graph>('patch-routing-changed', event => { if (!stopped) receiveGraph(event.payload); }).then(stop => { if (stopped) stop(); else unlisten = stop; }).catch(() => undefined);
    return () => { stopped = true; window.clearInterval(timer); unlisten?.(); };
  }, [active, instruments]);
  useEffect(() => {
    if (!active) {
      cancelInteraction();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && canvas.current?.closest('.routing-page')?.contains(focused)) focused.blur();
    }
  }, [active]);
  // Explicit CSS transforms give consistent viewport coordinates in WKWebView,
  // unlike CSS zoom's client-coordinate behavior. Include scroll/actual scale.
  const position = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.current!.getBoundingClientRect();
    return canvasPosition(event, rect, canvasWidth, zoom);
  };
  const undo = () => {
    if (busy || !current.current) return;
    cancelInteraction(); const previous = past.current.pop(); if (!previous) return;
    future.current.push(current.current); showGraph(previous); setSelected(null); setError(null); setHistoryRevision(v => v + 1);
  };
  const redo = () => {
    if (busy || !current.current) return;
    cancelInteraction(); const next = future.current.pop(); if (!next) return;
    past.current.push(current.current); showGraph(next); setSelected(null); setError(null); setHistoryRevision(v => v + 1);
  };
  const removeSelection = () => {
    if (busy || !graph || !selected) return;
    cancelPatch();
    if ('wire' in selected) edit({ ...graph, wires: graph.wires.filter((_, i) => i !== selected.wire) });
    else {
      const ids = selectedIds.filter(id => { const node = graph.nodes.find(n => n.id === id); return node && removable(node); });
      if (!ids.length) return;
      edit({nodes:graph.nodes.filter(n => !ids.includes(n.id)),wires:graph.wires.filter(w => !ids.includes(w.from) && !ids.includes(w.to))});
    }
    setSelected(null);
  };
  usePatchingKeys(active, {cancel:() => {cancelInteraction();if (selected && 'node' in selected) setSelected(null);}, remove:removeSelection, undo, redo, finish:endGesture}, busy);
  // Pointer capture on the canvas ensures release outside a port/window cancels.
  const finishPointer = (e: React.PointerEvent) => {
    if (marquee.current?.pointer === e.pointerId) { updateMarquee(position(e)); marquee.current = null; setBox(null); }
    const drag = moving.current;
    if (drag && drag.pointer === e.pointerId) {
      if (current.current) record(drag.before, current.current);
      moving.current = null;
    }
    const wire = patchRef.current;
    if (wire && wire.pointer === e.pointerId) {
      const reconnect = wire.reconnect;
      const source = reconnect?.end === 'source';
      const port = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(source ? '[data-routing-output]' : '[data-routing-input]');
      const value = current.current;
      const node = value?.nodes.find(n => n.id === port?.dataset.node);
      const pin = source ? port?.dataset.routingOutput : port?.dataset.routingInput;
      if (value && node && pin && (source ? outputs(node) : inputs(node)).includes(pin) && !busy) {
        const next: Wire = reconnect
          ? source ? { ...reconnect.wire, from: node.id, output: pin } : { ...reconnect.wire, to: node.id, input: pin }
          : { from: wire.from, output: wire.output, to: node.id, input: pin, gain: 1 };
        // A live patch update may have removed or reordered the cable mid-drag.
        if (!reconnect || value.wires[reconnect.index] === reconnect.wire) {
          if (node.kind === 'selector' && value.wires.some((w,i) => i !== reconnect?.index && w.to === next.to && w.input === next.input)) setError('Selector inputs accept one cable each');
          else if (value.wires.some((w, i) => i !== reconnect?.index && w.from === next.from && w.output === next.output && w.to === next.to && w.input === next.input)) setError('This connection already exists');
          else {
            const index = reconnect?.index ?? value.wires.length;
            edit({ ...value, wires: reconnect ? value.wires.map((w, i) => i === index ? next : w) : [...value.wires, next] });
            setSelected({ wire: index });
          }
        }
      }
      cancelPatch();
    }
  };
  const pinId = (node:RoutingNode) => node.kind === 'instrument' ? instrumentPin(node.id) : node.kind === 'patch' ? patchPin(patchEntries.find(e => e.slot === Number(node.id.replace('patch-', '')))?.state.record?.name ?? node.label) : `routing:${node.id}`;
  function pinnedControls(node:RoutingNode) {
    if (node.kind==='vst') return <PluginControls id={node.id} name={node.custom_label ?? node.label} compact />;
    const kinds = ['trim','eq','filter','fader','cue_switch','gain','compressor','oscillator','crossfader','player','selector'];
    if (!kinds.includes(node.kind)) return <small>No adjustable parameters</small>;
    const deck = node.deck === null ? undefined : audio?.decks[node.deck];
    const change = (value:number, band?:number) => {
      if (node.kind === 'crossfader' && control) { void control(0,'crossfader',value).catch(e => setError(String(e))); return; }
      if (node.deck !== null && control) {
        const action = band !== undefined ? ['eq_low','eq_mid','eq_high'][band] : node.kind === 'fader' ? 'gain' : node.kind === 'cue_switch' ? 'headphone_cue' : node.kind;
        void control(node.deck,action,value).catch(e => setError(String(e))); return;
      }
      const g = current.current; if (!g) return;
      edit({...g,nodes:g.nodes.map(n => n.id !== node.id ? n : band === undefined ? {...n,value} : {...n,eq:(n.eq ?? [.5,.5,.5]).map((v,i) => i === band ? value : v) as [number,number,number]})});
    };
    const field = (label:string,value:number,min:number,max:number | undefined,step:number,band?:number) => <ParameterKnob key={label} midiId={`routing:${node.id}:${band === undefined ? 'value' : `eq:${band}`}`} label={label} ariaLabel={`${node.custom_label ?? node.label} ${label}`} disabled={busy} value={value} min={min} max={max} step={step}
      defaultValue={node.kind === 'eq' ? .5 : ['trim','filter','crossfader'].includes(node.kind) ? 0 : node.kind === 'oscillator' ? 220 : node.kind === 'compressor' ? .25 : node.kind === 'fader' ? .8 : 1}
      onInteractionStart={() => { gesture.current = current.current; }} onInteractionEnd={endGesture} onChange={value => change(value,band)} />;
    if (node.kind === 'selector') return <SelectorControl id={`routing:${node.id}`} ports={inputs(node).filter(port => graph?.wires.some(w => w.to === node.id && w.input === port))} selected={inputs(node)[node.value] ?? 'A'} buttons disabled={busy} onChange={port => change(inputs(node).indexOf(port))} />;
    if (node.kind === 'player') return <MidiButton midiId={`deck:${node.deck}:play`} aria-pressed={!!deck?.playing} disabled={!audio?.running || !deck?.track} onClick={() => { if (control && node.deck !== null) void control(node.deck,'play_pause').catch(e => setError(String(e))); }}>{deck?.playing ? 'Pause' : 'Play'}</MidiButton>;
    if (node.kind === 'eq') return <>{(deck?.eq ?? node.eq ?? [.5,.5,.5]).map((value,i) => field(['Low','Mid','High'][i],value,0,1,.01,i))}</>;
    if (node.kind === 'cue_switch') { const value = deck ? deck.headphone_cue : !!node.value; return <MidiButton midiId={`routing:${node.id}:cue`} aria-pressed={value} disabled={busy || !!audio && !audio.running} onClick={() => change(value ? 0 : 1)}>Headphone cue</MidiButton>; }
    const value = node.kind === 'trim' ? deck?.trim_db ?? node.value : node.kind === 'filter' ? deck?.filter ?? node.value : node.kind === 'fader' ? deck?.gain ?? node.value : node.kind === 'crossfader' ? audio?.crossfader ?? node.value : node.value;
    return field(node.kind === 'oscillator' ? 'Hz' : node.kind === 'compressor' ? 'Threshold' : node.kind === 'trim' ? 'Trim (dB)' : node.kind === 'fader' ? 'Volume' : node.kind === 'filter' ? 'Filter' : node.kind === 'crossfader' ? 'Crossfader' : 'Gain',value,node.kind === 'trim' ? -12 : ['filter','crossfader'].includes(node.kind) ? -1 : node.kind === 'oscillator' ? 20 : node.kind === 'compressor' ? .01 : 0,node.kind === 'trim' ? 12 : node.kind === 'oscillator' ? 2000 : node.kind === 'gain' ? undefined : 1,node.kind === 'oscillator' ? 1 : .01);
  }
  const midi = useMidiMarkers();
  useMidiTargets([...(graph?.nodes ?? []).filter(n => isProcessor(n) && n.kind !== 'selector' && n.kind !== 'ring_modulation').map(node => ({
    id:`routing:${node.id}:value`,label:`${node.custom_label || node.label} · ${node.kind === 'oscillator' ? 'Hz' : node.kind === 'compressor' ? 'Threshold' : 'Gain'}`,kind:'number' as const,
    min:node.kind === 'oscillator' ? 20 : node.kind === 'compressor' ? .01 : 0,max:node.kind === 'oscillator' ? 2000 : node.kind === 'compressor' ? 1 : undefined,defaultMax:node.kind === 'gain' ? 2 : undefined,step:node.kind === 'oscillator' ? 1 : .01,disabled:busy,read:() => node.value,
    apply:(value:number) => { const g = current.current; if (g) edit({...g,nodes:g.nodes.map(n => n.id === node.id ? {...n,value} : n)}); },
  })), ...(graph?.wires ?? []).map(wire => ({id:wireMidiId(wire),label:`Cable ${wire.from} → ${wire.to} · Gain`,kind:'number' as const,min:0,max:2,step:.01,disabled:busy,read:() => wire.gain,apply:(value:number) => { const g=current.current; if (g) edit({...g,wires:g.wires.map(w => sameWire(w,wire) ? {...w,gain:value} : w)}); }}))]);
  const apply = async () => {
    if (!graph) return;
    endGesture(); setBusy(true); writeInFlight.current = true; setError(null);
    try { await invoke('set_routing_graph', { graph: engineGraph(graph) }); acceptedRef.current = graph; setAccepted(graph); window.dispatchEvent(new Event('vira-routing-applied')); }
    catch (e) { setError(String(e)); }
    finally { writeInFlight.current = false; setBusy(false); }
  };
  // Values are always live. This command contains no nodes or cables to add/remove.
  // Coalesce changes during a write, and keep structural Apply serialized with it.
  useEffect(() => {
    if (busy || liveApplying || !graph || !accepted) return;
    const parameters = {
      nodes:graph.nodes.filter(n => liveParameter(n) && n.kind !== 'ring_modulation' && accepted.nodes.some(old => old.id === n.id && old.kind === n.kind && (n.kind !== 'selector' || n.value < inputs(old).length) && (old.value !== n.value || JSON.stringify(old.eq) !== JSON.stringify(n.eq)))).map(n => ({id:n.id,value:n.value,...(n.eq ? {eq:n.eq} : {})})),
      wires:graph.wires.filter(w => accepted.wires.some(old => sameWire(old,w) && old.gain !== w.gain)),
    };
    const signature = JSON.stringify(parameters);
    if ((!parameters.nodes.length && !parameters.wires.length) || signature === lastLiveAttempt.current) return;
    lastLiveAttempt.current = signature;
    writeInFlight.current = true; setLiveApplying(true); setError(null);
    const engineParameters = {...parameters,wires:engineGraph({...graph,wires:parameters.wires}).wires};
    void invoke<Graph>('set_routing_parameters', {parameters:engineParameters}).then(raw => {
      const value = instrumentGraph(raw,instruments);
      lastLiveAttempt.current = '';
      acceptedRef.current = value; setAccepted(value);
    }).catch(e => setError(String(e))).finally(() => { writeInFlight.current = false; setLiveApplying(false); });
  }, [busy, liveApplying, graph, accepted]);
  const add = async (id: string, point = nodePlacement(canvas.current!, canvasWidth, zoom)) => {
    if (!current.current || busy) return;
    point = snapPatchPoint(point);
    setBusy(true);
    try {
      if (id.startsWith('vst:')) {
        const descriptor = vsts.plugins.find(p => `vst:${p.format ?? 'vst3'}:${p.path}:${p.uid}` === id);
        if (!descriptor) throw new Error('VST plugin is unavailable; scan its folder in Settings.');
        if (current.current.nodes.length >= 128) throw new Error('Routing node limit reached (128)');
        const instance = `vst-${crypto.randomUUID()}`;
        await invoke('vst_prepare', {id: instance, descriptor});
        const node: RoutingNode = {id: instance, kind:'vst', deck:null, label:descriptor.name, ...point, value:1, vst:descriptor};
        edit({...current.current, nodes:[...current.current.nodes, node]}); setSelected({node:instance});
      } else if (id === 'mixer-line') {
        edit(addMixerLine(current.current!));
      } else if (id.startsWith('instrument-')) {
        const instrument = instruments.find(i => id === `instrument-${i.id}`);
        if (!instrument || !(instrument.audio_input || instrument.audio_output)) throw new Error('Instrument connection is unavailable');
        const g = current.current!;
        if (!g.nodes.some(n => n.id === id) && g.nodes.length >= 128) throw new Error('Routing node limit reached (128)');
        const node: RoutingNode = {id, kind:'instrument', deck:null, label:instrument.name, ...point, value:1, instrument_input:!!instrument.audio_output, instrument_output:!!instrument.audio_input};
        edit({...g, nodes:[...g.nodes.filter(n => n.id !== id), node]}); setSelected({node:id});
      } else if (id.startsWith('input-')) {
        const source = audioInputs.find(n => n.id === id);
        if (!source) throw new Error('Input device is no longer available');
        const g = current.current!;
        if (!g.nodes.some(n => n.id === id) && g.nodes.length >= 128) throw new Error('Routing node limit reached (128)');
        edit({...g, nodes:[...g.nodes.filter(n => n.id !== id), {...source, ...point}]});
        setSelected({node:id});
      } else if (id.startsWith('patch:') || id === 'new-patch') {
        const entry = await addSessionPatch(id === 'new-patch' ? undefined : id.slice(6));
        const live = await invoke<Graph>('get_routing_graph');
        receiveGraph(live);
        const node: RoutingNode = live.nodes.find(n => n.id === `patch-${entry.slot}`) ?? {id:`patch-${entry.slot}`, kind:'patch', deck:null, label:entry.state.record!.name.replace(/\.json$/, ''), ...point, value:1, patch_inputs:patchAudioInputs(entry.state.record!.installed_document)};
        const g = current.current!;
        edit({...g, nodes:[...g.nodes.filter(n => n.id !== node.id), {...node, ...point}]}); setSelected({node:node.id});
      } else {
        if (!Object.hasOwn(processors, id)) throw new Error('Unknown routing node');
        const g = current.current!;
        if (g.nodes.length >= 128) throw new Error('Routing node limit reached (128)');
        const node: RoutingNode = {id:`fx-${crypto.randomUUID()}`, kind:id as Kind, deck:null, label:processors[id], ...point, ...(id === 'selector' ? {patch_inputs:[{id:'A',label:'A'}]} : {}), value:id === 'selector' ? 0 : id === 'compressor' ? .25 : id === 'oscillator' ? 220 : 1};
        edit({...g, nodes:[...g.nodes, node]}); setSelected({node:node.id});
      }
    } catch (e) {setError(String(e));} finally {setBusy(false);}
  };
  const selectedWire = selected && 'wire' in selected ? graph?.wires[selected.wire] : null;
  const selectedNode = selected && 'node' in selected ? graph?.nodes.find(n => n.id === selected.node) : null;
  return <PatchingPage aria-label="Audio routing" hidden={!active}>
    <PatchingHeading title="Routing" description="Drag nodes from the palette · Drag ports to patch">
      <div className="routing-zoom"><label>Zoom <MidiSelect aria-label="Routing zoom" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[.5, .65, .8, 1, 1.25].map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</MidiSelect></label><MidiButton onClick={() => { if (!graph || !canvas.current) return; const width = Math.max(...graph.nodes.map(n => n.x + 170), 900); const available = canvas.current.parentElement!.parentElement!.clientWidth - 30; setZoom([1.25, 1, .8, .65, .5].find(value => width * value <= available) ?? .5); }}>Fit</MidiButton></div>
      <MidiButton disabled={busy || !past.current.length} onClick={undo}>Undo</MidiButton><MidiButton disabled={busy || !future.current.length} onClick={redo}>Redo</MidiButton>
      <MidiButton disabled={busy || !dirty} onClick={() => { if (accepted) edit(accepted); setSelected(null); }}>Revert edits</MidiButton>
      <MidiButton disabled={busy} onClick={() => { setBusy(true); void invoke<Graph>('default_routing_graph').then(value => { edit(arrangeMixerLines(value)); setSelected(null); }).catch(e => setError(String(e))).finally(() => setBusy(false)); }}>Default chain</MidiButton>
      <span className="settings-hint">Parameters are live · Apply cable and node edits</span>
      <MidiButton midiId="routing:apply" className="routing-apply" disabled={busy || liveApplying || !graph || (!dirty && !graph.nodes.some(n => n.kind === 'input' && graph.wires.some(w => w.from === n.id)))} onClick={() => void apply()}>{busy || liveApplying ? 'Applying…' : 'Apply routing'}</MidiButton>
    </PatchingHeading>

    {vsts.scanning && <p role="status">Scanning plugins…</p>}
    {error && <p className="routing-error" role="alert">{error}</p>}
    <div className="routing-body"><NodePalette disabled={busy} categories={[{label:'Mixer lines',items:mixerLines(graph ?? {nodes:[],wires:[]}).length < 7 ? [{id:'mixer-line',label:'+ Mixer line'}] : []}, {label:'Input devices',items:audioInputs.filter(n => !graph?.nodes.some(added => added.id === n.id)).map(n => ({id:n.id,label:n.label}))}, {label:'Effects',items:[...Object.entries(processors).filter(([id]) => id !== 'oscillator').map(([id,label]) => ({id,label})), ...vsts.plugins.filter(p => p.effect).map(p => ({id:`vst:${p.format ?? 'vst3'}:${p.path}:${p.uid}`,label:`${p.name} · ${(p.format ?? 'vst3').toUpperCase()}`}))]}, {label:'Instruments',items:[...instruments.filter(i => i.audio_input || i.audio_output).map(i => ({id:`instrument-${i.id}`,label:i.name})).filter(i => !graph?.nodes.some(n => n.id === i.id)), ...vsts.plugins.filter(p => p.instrument).map(p => ({id:`vst:${p.format ?? 'vst3'}:${p.path}:${p.uid}`,label:`${p.name} · ${(p.format ?? 'vst3').toUpperCase()}`}))]}, {label:'Generators',items:[{id:'oscillator',label:processors.oscillator}]}, {label:'Patches',footer:<MidiButton disabled={busy} onClick={() => void add('new-patch')}>+ New patch</MidiButton>,items:files.map(name => ({id:`patch:${name}`,label:name.replace(/\.json$/, '')}))}]} actions={null} onAdd={(id, point) => void add(id, point)} /><div className="routing-scroll" onDragOver={paletteDragOver} onDrop={e => paletteDrop(e, (id, point) => void add(id, point), canvas.current!, canvasWidth, zoom)} onPointerDown={e => { if (e.target === e.currentTarget) { setSelected(null); } }}><div className="routing-canvas-space" style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}><div className="routing-canvas" ref={canvas} style={{ width:canvasWidth, height:canvasHeight, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      onPointerDownCapture={e => { const field = document.activeElement; if (field instanceof HTMLElement && field.matches('input, textarea, select') && field !== e.target && !field.contains(e.target as Node)) field.blur(); }}
      onPointerDown={e => { if (e.target !== e.currentTarget || busy || e.button !== 0) return; e.preventDefault(); setSelected(null); const p = position(e); const drag = {pointer:e.pointerId,start:p,end:p}; marquee.current = drag; setBox(drag); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => {
        const p = position(e), wire = patchRef.current, drag = moving.current;
        if (marquee.current?.pointer === e.pointerId) updateMarquee(p);
        if (wire && wire.pointer === e.pointerId) { const next = { ...wire, ...p }; patchRef.current = next; setPatch(next); }
        if (drag && drag.pointer === e.pointerId && !busy) showGraph(movePatchGroup(drag.before,drag.ids,{x:p.x-drag.startX,y:p.y-drag.startY},{x:20,y:60,width:canvasWidth-40,height:canvasHeight-80},nodeSize));
      }} onPointerUp={finishPointer} onPointerCancel={cancelInteraction} onLostPointerCapture={() => { if (patchRef.current || moving.current || marquee.current) cancelInteraction(); }}>
      {graph && mixerLines(graph).map(line => {
        const nodes = graph.nodes.filter(n => mixerLine(n) === line), bounds = mixerLineBounds(nodes);
        return <div key={line} className={`routing-mixer-line${nodes.some(n => selectedIds.includes(n.id)) ? ' selected' : ''}`} style={{left:bounds.x,top:bounds.y,width:bounds.width,height:bounds.height,'--line-colour':lineColours[line]} as CSSProperties} aria-label={`Mixer line ${lineName(line)}`} onPointerDown={e => { beginMove(e,nodes.map(n => n.id)); }}>
        </div>;
      })}
      <svg className="routing-wires" width={canvasWidth} height={canvasHeight} aria-label="Audio connections">{graph?.wires.map((wire, i) => {
        const from = graph.nodes.find(n => n.id === wire.from), to = graph.nodes.find(n => n.id === wire.to);
        if (!from || !to || patch?.reconnect?.index === i) return null;
        return <g key={i} className={selected && 'wire' in selected && selected.wire === i ? 'selected' : ''}><path className="routing-wire" style={selected && 'wire' in selected && selected.wire === i ? undefined : {stroke:lineColours[mixerLine(from) ?? from.deck ?? mixerLine(to) ?? to.deck ?? 0]}} d={wirePath(from, to, wire)} /><path className="routing-wire-hit" data-wire={i} d={wirePath(from, to, wire)} onPointerDown={e => { e.stopPropagation(); setSelected({ wire: i }); }}><title>{wire.from} → {wire.to} ({wire.input}) · gain {wire.gain}</title></path></g>;
      })}{patch && graph && (() => {
        const from = graph.nodes.find(n => n.id === patch.from);
        const to = graph.nodes.find(n => n.id === patch.reconnect?.wire.to);
        const source = patch.reconnect?.end === 'source';
        return from && (!source || to) && <path className="routing-wire preview" data-testid="wire-preview" d={source ? path(patch, point(to!, patch.reconnect!.wire.input, false)) : path(point(from, patch.output, true), patch)} />;
      })()}</svg>
      {graph?.nodes.map(node => <div key={node.id} data-node-id={node.id} className={`routing-node ${node.kind === 'player' && node.deck === 1 ? 'routing-player-right' : ''} ${mixerLine(node) !== null ? `routing-line-node stage-${node.kind}` : ''} ${node.deck === null ? '' : `deck-${node.deck}`} ${selectedIds.includes(node.id) ? 'selected' : ''}`} style={{ left: node.x, top: node.y, '--line-colour':lineColours[mixerLine(node) ?? node.deck ?? 0], width:mixerLine(node) !== null ? lineNodeWidth(node) : undefined, height: mixerLine(node) !== null ? 40 : patchSize(Math.max(120, 70 + Math.max(inputs(node).length, outputs(node).length) * 26) + (isProcessor(node) && node.kind !== 'ring_modulation' ? 52 : 0)) } as CSSProperties} onDoubleClick={e => { if (!['patch','vst'].includes(node.kind) || (e.target as Element).closest('button')) return; e.stopPropagation(); void (node.kind === 'vst' ? invoke('vst_open_editor', {id:node.id}) : invoke('teia_open_editor', { slot: Number(node.id.replace('patch-', '')) })).catch(e => setError(String(e))); }} onPointerDown={e => { e.stopPropagation(); selectNode(node.id); }}>
        <PinButton id={pinId(node)} name={node.custom_label ?? node.label} disabled={busy || node.kind === 'patch' && !patchEntries.some(e => e.slot === Number(node.id.replace('patch-', '')) && e.state.record)} />
        {node.kind !== 'patch' && node.kind !== 'instrument' && <PinnedSource id={pinId(node)} name={node.custom_label ?? node.label} show={false}>{pinnedControls(node)}</PinnedSource>}
        <PatchingNodeHeader title={node.custom_label ?? (node.kind === 'cue_switch' ? 'CUE' : node.label)} nameLabel={`${node.id} name`} disabled={busy} onRename={name => { const value = current.current; if (value) edit({ ...value, nodes: value.nodes.map(n => n.id === node.id ? { ...n, custom_label: name } : n) }); }} subtitle={node.deck === null ? node.id.startsWith('instrument-') ? 'Instrument audio' : node.kind === 'input' ? 'Audio input · channels 1–2' : node.kind : `Deck ${node.deck === 0 ? 'A' : 'B'}`} onPointerDown={e => { beginMove(e,[node.id]); }} />
        <div className="routing-ports" style={{ height: Math.max(72, Math.max(inputs(node).length, outputs(node).length) * 26 + 16) }}>{inputs(node).map((port, i) => <MidiButton key={port} className="routing-port input" style={mixerLine(node) !== null ? {left:point(node,port,false).x-node.x-12,top:point(node,port,false).y-node.y-12} : { top: patchPortTop(i) }} data-routing-input={port} data-node={node.id} aria-label={`${node.id} input ${port}`}><i /><span title={node.vst?.inputs.find(b => b.id === port)?.label ?? node.patch_inputs?.find(p => p.id === port)?.label ?? port}>{node.vst?.inputs.find(b => b.id === port)?.label ?? node.patch_inputs?.find(p => p.id === port)?.label ?? port}</span></MidiButton>)}{outputs(node).map((port, i) => <MidiButton key={port} className="routing-port output" style={mixerLine(node) !== null ? {left:point(node,port,true).x-node.x-12,top:point(node,port,true).y-node.y-12} : { top: patchPortTop(i) }} data-routing-output={port} data-node={node.id} aria-label={`${node.id} output ${port}`} disabled={busy} onPointerDown={e => { if (busy || e.button !== 0) return; e.preventDefault(); e.stopPropagation(); canvas.current?.setPointerCapture(e.pointerId); const wire = { from: node.id, output: port, ...position(e), pointer: e.pointerId }; patchRef.current = wire; setPatch(wire); }}>{mixerLine(node) === null && <span>{node.vst?.outputs.find(b => b.id === port)?.label ?? port}</span>}<i /></MidiButton>)}</div>
        {node.kind === 'selector' && <div className="routing-parameter"><SelectorControl id={`routing:${node.id}`} ports={inputs(node).filter(port => graph?.wires.some(w => w.to === node.id && w.input === port))} selected={inputs(node)[node.value] ?? 'A'} disabled={busy} onChange={port => edit({...graph,nodes:graph.nodes.map(n => n.id === node.id ? {...n,value:inputs(node).indexOf(port)} : n)})} /></div>}
        {isProcessor(node) && node.kind !== 'selector' && <div className="routing-parameter">{node.kind !== 'ring_modulation' && <label>{node.kind === 'oscillator' ? 'Hz' : node.kind === 'compressor' ? 'Threshold' : 'Gain'}<input {...midi(`routing:${node.id}:value`)} aria-label={`${node.id} value`} disabled={busy} type="number" min={node.kind === 'oscillator' ? 20 : node.kind === 'compressor' ? .01 : 0} max={node.kind === 'oscillator' ? 2000 : node.kind === 'compressor' ? 1 : undefined} step={node.kind === 'oscillator' ? 1 : .01} value={node.value} onFocus={() => { gesture.current = current.current; }} onBlur={endGesture} onChange={e => edit({ ...graph, nodes: graph.nodes.map(n => n.id === node.id ? { ...n, value: Number(e.target.value) } : n) })} /></label>}</div>}
      </div>)}
      {selectedWire && selected && 'wire' in selected && (['source', 'target'] as const).map(end => {
        const source = end === 'source';
        const node = graph?.nodes.find(n => n.id === (source ? selectedWire.from : selectedWire.to));
        if (!node) return null;
        const p = patch?.reconnect?.end === end ? patch : point(node, source ? selectedWire.output : selectedWire.input, source);
        return <MidiButton key={end} className="routing-wire-endpoint" aria-label={`Reconnect cable ${end}`} title={`Drag to reconnect cable ${end}`} disabled={busy} style={{ left: p.x, top: p.y, pointerEvents: patch ? 'none' : undefined }} onPointerDown={e => {
          if (busy || e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          canvas.current?.setPointerCapture(e.pointerId);
          const drag: Patch = { from: selectedWire.from, output: selectedWire.output, ...point(node, source ? selectedWire.output : selectedWire.input, source), pointer: e.pointerId, reconnect: { index: selected.wire, wire: selectedWire, end } };
          patchRef.current = drag; setPatch(drag);
        }} />;
      })}
      <PatchSelectionBox box={box} />
    </div></div></div></div>
    <PluginMidiTargets ids={(graph?.nodes??[]).filter(n=>n.kind==='vst').map(n=>n.id)} />
    {selectedNode?.kind==='vst' && <section className="plugin-inspector" aria-label={`${selectedNode.label} plugin controls`}>
      <button disabled={busy} onClick={()=>{void invoke('vst_open_editor',{id:selectedNode.id}).catch(e=>setError(String(e)));}}>Open editor</button>
      <button disabled={busy} onClick={()=>{const descriptor=vsts.plugins.find(p=>p.uid===selectedNode.vst?.uid && (p.format??'vst3')===(selectedNode.vst?.format??'vst3'));if(!descriptor){setError('Plugin is unavailable. Install it or add its folder in Settings and scan again.');return;}if(JSON.stringify(descriptor.inputs)!==JSON.stringify(selectedNode.vst?.inputs)||JSON.stringify(descriptor.outputs)!==JSON.stringify(selectedNode.vst?.outputs)){setError('This plugin now has different buses. Add a new instance and reconnect its ports.');return;}void invoke('vst_recover',{id:selectedNode.id,descriptor:{...descriptor,offline_bypass:selectedNode.vst?.offline_bypass??false}}).then(()=>apply()).catch(e=>setError(String(e)));}}>Recover / relink installed plugin</button>
      <label>If unavailable <select aria-label="Offline plugin behavior" value={selectedNode.vst?.offline_bypass?'bypass':'silence'} onChange={e=>edit({...graph!,nodes:graph!.nodes.map(n=>n.id===selectedNode.id?{...n,vst:{...n.vst!,offline_bypass:e.target.value==='bypass'}}:n)})}><option value="silence">Silence</option><option value="bypass">Pass audio through</option></select></label>
      <PluginControls key={selectedNode.id} id={selectedNode.id} name={selectedNode.custom_label??selectedNode.label} />
    </section>}
    {selected && <div className="patching-selection"><span>{selectedObjects > 1 ? `${selectedObjects} objects selected` : selectedNode?.label ?? `${selectedWire?.from} → ${selectedWire?.to}`}</span>{selectedWire && 'wire' in selected && <label>Wire gain <Slider {...midi(wireMidiId(selectedWire))} aria-label="Wire gain" disabled={busy} type="range" min="0" max="2" step="0.01" value={selectedWire.gain} onPointerDown={() => {gesture.current = current.current;}} onPointerUp={endGesture} onPointerCancel={endGesture} onChange={e => edit({...graph!, wires:graph!.wires.map((w,i) => i === selected.wire ? {...w,gain:Number(e.target.value)} : w)})} /><output>{selectedWire.gain.toFixed(2)}×</output></label>}<MidiButton disabled={busy || !!selectedNode && !graph?.nodes.some(n => selectedIds.includes(n.id) && removable(n))} title={selectedNode && !graph?.nodes.some(n => selectedIds.includes(n.id) && removable(n)) ? 'Default routing nodes cannot be removed' : undefined} onClick={removeSelection}>{selectedObjects > 1 ? 'Remove selected' : selectedNode ? 'Remove node' : 'Disconnect'}</MidiButton></div>}
  </PatchingPage>;
}
