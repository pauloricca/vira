import { useInstruments } from './instrumentModel';
import { PatchingPage, PatchingHeading, PatchingNodeHeader, patchPortTop, patchPortPoint, NodePalette, nodePlacement, paletteDrop, paletteDragOver, withoutPatchNode, usePatchingKeys, type PatchPoint } from './Patching';
import { canvasPosition, cablePath as path } from './routingGeometry';
import { useEffect, useRef, useState } from 'react';
import { addSessionPatch, usePatchLibrary, patchAudioInputs } from './patchLibrary';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

type Kind = 'input' | 'player' | 'trim' | 'eq' | 'filter' | 'fader' | 'crossfader' | 'cue' | 'output' | 'gain' | 'compressor' | 'oscillator' | 'ring_modulation' | 'patch';
export type RoutingNode = { id: string; kind: Kind; deck: number | null; label: string; x: number; y: number; value: number; patch_inputs?: { id: string; label: string }[] };
export type Wire = { from: string; output: string; to: string; input: string; gain: number };
export type Graph = { nodes: RoutingNode[]; wires: Wire[] };
export const inputs = (node: RoutingNode) => node.kind === 'patch' && node.patch_inputs ? node.patch_inputs.map(p => p.id) : node.kind === 'input' || node.kind === 'player' || node.kind === 'oscillator' ? [] : node.kind === 'crossfader' || node.kind === 'cue' ? ['A', 'B'] : node.kind === 'compressor' ? ['audio', 'sidechain'] : node.kind === 'ring_modulation' ? ['audio', 'carrier'] : ['audio'];
const outputs = (node: RoutingNode) => node.kind === 'output' ? [] : node.kind === 'compressor' || node.kind === 'ring_modulation' ? ['audio', 'dry'] : node.kind === 'oscillator' ? ['audio', 'cosine'] : ['audio'];
const removable = (node: RoutingNode) => node.kind === 'input' || node.kind === 'patch' || node.id.startsWith('instrument-out-') || isProcessor(node);
const isProcessor = (node: RoutingNode) => ['gain', 'compressor', 'oscillator', 'ring_modulation'].includes(node.kind);
const point = (node: RoutingNode, port: string, output: boolean) => patchPortPoint(node, (output ? outputs(node) : inputs(node)).indexOf(port), output);
const equal = (a: Graph | null, b: Graph | null) => JSON.stringify(a) === JSON.stringify(b);
type Selection = { node: string } | { wire: number } | null;
type Patch = { from: string; output: string; x: number; y: number; pointer: number; reconnect?: { index: number; wire: Wire; end: 'source' | 'target' } };
type Moving = { id: string; x: number; y: number; startX: number; startY: number; before: Graph; pointer: number };
const processors: Record<string, string> = { compressor: 'Compressor', gain: 'Gain', ring_modulation: 'Ring modulator', oscillator: 'Sine instrument' };

export function Routing({ active = true }: { active?: boolean }) {
  const instruments = useInstruments(active);
  const [audioInputs, setAudioInputs] = useState<RoutingNode[]>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const current = useRef<Graph | null>(null);
  const [accepted, setAccepted] = useState<Graph | null>(null);
  const acceptedRef = useRef<Graph | null>(null);
  acceptedRef.current = accepted;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const {files} = usePatchLibrary(active);
  const [zoom, setZoom] = useState(.8);
  const [selected, setSelected] = useState<Selection>(null);
  const [patch, setPatch] = useState<Patch | null>(null);
  const patchRef = useRef<Patch | null>(null);
  const moving = useRef<Moving | null>(null);
  const [, setHistoryRevision] = useState(0);
  const past = useRef<Graph[]>([]), future = useRef<Graph[]>([]);
  const gesture = useRef<Graph | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const dirty = !equal(graph, accepted);
  const canvasHeight = Math.max(1000, ...(graph?.nodes.map(n => n.y + 180) ?? []));
  const showGraph = (value: Graph) => { current.current = value; setGraph(value); };
  const record = (before: Graph, after: Graph) => {
    if (equal(before, after)) return;
    past.current = [...past.current.slice(-99), before]; future.current = []; setHistoryRevision(v => v + 1);
  };
  const edit = (value: Graph) => {
    if (!current.current) return;
    if (!gesture.current) record(current.current, value);
    showGraph(value); setError(null);
  };
  const endGesture = () => { if (gesture.current && current.current) record(gesture.current, current.current); gesture.current = null; };
  const cancelPatch = () => { patchRef.current = null; setPatch(null); };
  const cancelInteraction = () => {
    cancelPatch();
    if (moving.current) { showGraph(moving.current.before); moving.current = null; }
    endGesture();
  };
  const receiveGraph = (value: Graph) => {
    const previous = acceptedRef.current;
    const added = value.nodes.filter(n => n.kind === 'patch' && !previous?.nodes.some(old => old.id === n.id));
    const removed = previous?.nodes.filter(n => (n.kind === 'patch' || n.id.startsWith('instrument-')) && !value.nodes.some(next => next.id === n.id)).map(n => n.id) ?? [];
    const merge = (draft: Graph): Graph => {
      const nodes = [...draft.nodes.filter(n => !removed.includes(n.id)).map(n => {
        const live = value.nodes.find(next => (next.kind === 'patch' || next.kind === 'input' || next.id.startsWith('instrument-out-') || next.id === 'headphones') && next.id === n.id);
        return live ? { ...n, label: live.label, patch_inputs: live.patch_inputs } : n;
      }), ...added.filter(n => !draft.nodes.some(old => old.id === n.id))];
      const valid = (w: Wire) => { const target = nodes.find(n => n.id === w.to); return nodes.some(n => n.id === w.from) && target && inputs(target).includes(w.input); };
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
    if (!active) return;
    let stopped = false, unlisten: (() => void) | undefined;
    const refresh = () => {
      void invoke<RoutingNode[]>('get_audio_inputs').then(value => { if (!stopped) setAudioInputs(Array.isArray(value) ? value : []); }).catch(e => { if (!stopped) setError(String(e)); });
      void invoke<Graph>('get_routing_graph').then(value => { if (!stopped) receiveGraph(value); }).catch(e => { if (!stopped) setError(String(e)); }); };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    void listen<Graph>('patch-routing-changed', event => { if (!stopped) receiveGraph(event.payload); }).then(stop => { if (stopped) stop(); else unlisten = stop; }).catch(() => undefined);
    return () => { stopped = true; window.clearInterval(timer); unlisten?.(); };
  }, [active]);
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
    return canvasPosition(event, rect, 1600, zoom);
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
      const node = graph.nodes.find(n => n.id === selected.node);
      if (!node || !removable(node)) return;
      edit(withoutPatchNode(graph, node.id));
    }
    setSelected(null);
  };
  usePatchingKeys(active, {cancel:cancelInteraction, remove:removeSelection, undo, redo, finish:endGesture}, busy);
  // Pointer capture on the canvas ensures release outside a port/window cancels.
  const finishPointer = (e: React.PointerEvent) => {
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
          if (value.wires.some((w, i) => i !== reconnect?.index && w.from === next.from && w.output === next.output && w.to === next.to && w.input === next.input)) setError('This connection already exists');
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
  const apply = async () => {
    if (!graph) return;
    endGesture(); setBusy(true); setError(null);
    try { await invoke('set_routing_graph', { graph }); setAccepted(graph); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const add = async (id: string, point = nodePlacement(canvas.current!, 1600, zoom)) => {
    if (!current.current || busy) return;
    setBusy(true);
    try {
      if (id.startsWith('instrument-in-') || id.startsWith('instrument-out-')) {
        const input = id.startsWith('instrument-in-');
        const instrument = instruments.find(i => id === `instrument-${input ? 'in' : 'out'}-${i.id}`);
        if (!instrument || !(input ? instrument.audio_input : instrument.audio_output)) throw new Error('Instrument connection is unavailable');
        const g = current.current!;
        if (!g.nodes.some(n => n.id === id) && g.nodes.length >= 128) throw new Error('Routing node limit reached (128)');
        const node: RoutingNode = {id, kind:input ? 'input' : 'output', deck:null, label:`${instrument.name} · audio ${input ? 'from' : 'to'}`, ...point, value:1};
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
        const node: RoutingNode = {id:`fx-${crypto.randomUUID()}`, kind:id as Kind, deck:null, label:processors[id], ...point, value:id === 'compressor' ? .25 : id === 'oscillator' ? 220 : 1};
        edit({...g, nodes:[...g.nodes, node]}); setSelected({node:node.id});
      }
    } catch (e) {setError(String(e));} finally {setBusy(false);}
  };
  const selectedWire = selected && 'wire' in selected ? graph?.wires[selected.wire] : null;
  const selectedNode = selected && 'node' in selected ? graph?.nodes.find(n => n.id === selected.node) : null;
  return <PatchingPage aria-label="Audio routing" hidden={!active}>
    <PatchingHeading title="Routing" description="Drag nodes from the palette · Drag ports to patch">
      <div className="routing-zoom"><label>Zoom <select aria-label="Routing zoom" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[.5, .65, .8, 1, 1.25].map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select></label><button onClick={() => { if (!graph || !canvas.current) return; const width = Math.max(...graph.nodes.map(n => n.x + 170), 900); const available = canvas.current.parentElement!.parentElement!.clientWidth - 30; setZoom([1.25, 1, .8, .65, .5].find(value => width * value <= available) ?? .5); }}>Fit</button></div>
      <button disabled={busy || !past.current.length} onClick={undo}>Undo</button><button disabled={busy || !future.current.length} onClick={redo}>Redo</button>
      <button disabled={busy || !dirty} onClick={() => { if (accepted) edit(accepted); setSelected(null); }}>Revert edits</button>
      <button disabled={busy} onClick={() => { setBusy(true); void invoke<Graph>('default_routing_graph').then(value => { edit(value); setSelected(null); }).catch(e => setError(String(e))).finally(() => setBusy(false)); }}>Default chain</button>
      <button className="routing-apply" disabled={busy || !graph || (!dirty && !graph.nodes.some(n => n.kind === 'input' && graph.wires.some(w => w.from === n.id)))} onClick={() => void apply()}>{busy ? 'Applying…' : 'Apply routing'}</button>
    </PatchingHeading>

    {error && <p className="routing-error" role="alert">{error}</p>}
    <div className="routing-body"><NodePalette disabled={busy} categories={[{label:'Input devices',items:audioInputs.filter(n => !graph?.nodes.some(added => added.id === n.id)).map(n => ({id:n.id,label:n.label}))}, {label:'Effects',items:Object.entries(processors).filter(([id]) => id !== 'oscillator').map(([id,label]) => ({id,label}))}, {label:'Instruments',items:instruments.flatMap(i => [...(i.audio_input ? [{id:`instrument-in-${i.id}`,label:`From ${i.name}`}] : []), ...(i.audio_output ? [{id:`instrument-out-${i.id}`,label:`To ${i.name}`}] : [])]).filter(i => !graph?.nodes.some(n => n.id === i.id))}, {label:'Generators',items:[{id:'oscillator',label:processors.oscillator}]}, {label:'Patches',footer:<button disabled={busy} onClick={() => void add('new-patch')}>+ New patch</button>,items:files.map(name => ({id:`patch:${name}`,label:name.replace(/\.json$/, '')}))}]} actions={null} onAdd={(id, point) => void add(id, point)} /><div className="routing-scroll" onDragOver={paletteDragOver} onDrop={e => paletteDrop(e, (id, point) => void add(id, point), canvas.current!, 1600, zoom)} onPointerDown={e => { if (e.target === e.currentTarget) { setSelected(null); } }}><div className="routing-canvas-space" style={{ width: 1600 * zoom, height: canvasHeight * zoom }}><div className="routing-canvas" ref={canvas} style={{ width:1600, height:canvasHeight, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      onPointerDownCapture={e => { const field = document.activeElement; if (field instanceof HTMLElement && field.matches('input, textarea, select') && field !== e.target && !field.contains(e.target as Node)) field.blur(); }}
      onPointerDown={e => { if (e.target === e.currentTarget) { setSelected(null); } }}
      onPointerMove={e => {
        const p = position(e), wire = patchRef.current, drag = moving.current;
        if (wire && wire.pointer === e.pointerId) { const next = { ...wire, ...p }; patchRef.current = next; setPatch(next); }
        if (drag && drag.pointer === e.pointerId && current.current && !busy) showGraph({ ...current.current, nodes: current.current.nodes.map(n => n.id === drag.id ? { ...n, x: Math.min(1440, Math.max(10, drag.x + p.x - drag.startX)), y: Math.min(800, Math.max(50, drag.y + p.y - drag.startY)) } : n) });
      }} onPointerUp={finishPointer} onPointerCancel={cancelInteraction} onLostPointerCapture={() => { if (patchRef.current || moving.current) cancelInteraction(); }}>
      {[0, 1].map(d => <div key={d} className={`routing-group deck-${d}`} style={{ top: 35 + d * 250 }}><strong>Deck {d === 0 ? 'A' : 'B'}</strong><span>Components controlled from the Decks page</span></div>)}
      <svg className="routing-wires" width="1600" height={canvasHeight} aria-label="Audio connections">{graph?.wires.map((wire, i) => {
        const from = graph.nodes.find(n => n.id === wire.from), to = graph.nodes.find(n => n.id === wire.to);
        if (!from || !to || patch?.reconnect?.index === i) return null;
        return <g key={i} className={selected && 'wire' in selected && selected.wire === i ? 'selected' : ''}><path className="routing-wire" d={path(point(from, wire.output, true), point(to, wire.input, false))} /><path className="routing-wire-hit" data-wire={i} d={path(point(from, wire.output, true), point(to, wire.input, false))} onPointerDown={e => { e.stopPropagation(); setSelected({ wire: i }); }}><title>{wire.from} → {wire.to} ({wire.input}) · gain {wire.gain}</title></path></g>;
      })}{patch && graph && (() => {
        const from = graph.nodes.find(n => n.id === patch.from);
        const to = graph.nodes.find(n => n.id === patch.reconnect?.wire.to);
        const source = patch.reconnect?.end === 'source';
        return from && (!source || to) && <path className="routing-wire preview" data-testid="wire-preview" d={source ? path(patch, point(to!, patch.reconnect!.wire.input, false)) : path(point(from, patch.output, true), patch)} />;
      })()}</svg>
      {graph?.nodes.map(node => <div key={node.id} data-node-id={node.id} className={`routing-node ${node.deck === null ? '' : `deck-${node.deck}`} ${selected && 'node' in selected && selected.node === node.id ? 'selected' : ''}`} style={{ left: node.x, top: node.y, minHeight: Math.max(115, 70 + Math.max(inputs(node).length, outputs(node).length) * 26) }} onDoubleClick={e => { if (node.kind !== 'patch') return; e.stopPropagation(); void invoke('teia_open_editor', { slot: Number(node.id.replace('patch-', '')) }).catch(e => setError(String(e))); }} onPointerDown={e => { e.stopPropagation(); setSelected({ node: node.id }); }}>
        <PatchingNodeHeader title={node.label} subtitle={node.deck === null ? node.id.startsWith('instrument-') ? 'Instrument audio' : node.kind === 'input' ? 'Audio input · channels 1–2' : node.kind : `Deck ${node.deck === 0 ? 'A' : 'B'}`} onPointerDown={e => { if (busy || e.button !== 0 || !graph) return; e.preventDefault(); const p = position(e); canvas.current?.setPointerCapture(e.pointerId); moving.current = { id: node.id, x: node.x, y: node.y, startX: p.x, startY: p.y, before: graph, pointer: e.pointerId }; }} />
        <div className="routing-ports" style={{ height: Math.max(72, Math.max(inputs(node).length, outputs(node).length) * 26 + 16) }}>{inputs(node).map((port, i) => <button key={port} className="routing-port input" style={{ top: patchPortTop(i) }} data-routing-input={port} data-node={node.id} aria-label={`${node.id} input ${port}`}><i /><span title={node.patch_inputs?.find(p => p.id === port)?.label ?? port}>{node.patch_inputs?.find(p => p.id === port)?.label ?? port}</span></button>)}{outputs(node).map((port, i) => <button key={port} className="routing-port output" style={{ top: patchPortTop(i) }} data-routing-output={port} data-node={node.id} aria-label={`${node.id} output ${port}`} disabled={busy} onPointerDown={e => { if (busy || e.button !== 0) return; e.preventDefault(); e.stopPropagation(); canvas.current?.setPointerCapture(e.pointerId); const wire = { from: node.id, output: port, ...position(e), pointer: e.pointerId }; patchRef.current = wire; setPatch(wire); }}><span>{port}</span><i /></button>)}</div>
        {isProcessor(node) && <div className="routing-parameter">{node.kind !== 'ring_modulation' && <label>{node.kind === 'oscillator' ? 'Hz' : node.kind === 'compressor' ? 'Threshold' : 'Gain'}<input aria-label={`${node.id} value`} disabled={busy} type="number" min={node.kind === 'oscillator' ? 20 : node.kind === 'compressor' ? .01 : 0} max={node.kind === 'oscillator' ? 2000 : node.kind === 'compressor' ? 1 : 2} step={node.kind === 'oscillator' ? 1 : .01} value={node.value} onFocus={() => { gesture.current = current.current; }} onBlur={endGesture} onChange={e => edit({ ...graph, nodes: graph.nodes.map(n => n.id === node.id ? { ...n, value: Number(e.target.value) } : n) })} /></label>}</div>}
      </div>)}
      {selectedWire && selected && 'wire' in selected && (['source', 'target'] as const).map(end => {
        const source = end === 'source';
        const node = graph?.nodes.find(n => n.id === (source ? selectedWire.from : selectedWire.to));
        if (!node) return null;
        const p = patch?.reconnect?.end === end ? patch : point(node, source ? selectedWire.output : selectedWire.input, source);
        return <button key={end} className="routing-wire-endpoint" aria-label={`Reconnect cable ${end}`} title={`Drag to reconnect cable ${end}`} disabled={busy} style={{ left: p.x, top: p.y, pointerEvents: patch ? 'none' : undefined }} onPointerDown={e => {
          if (busy || e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          canvas.current?.setPointerCapture(e.pointerId);
          const drag: Patch = { from: selectedWire.from, output: selectedWire.output, ...point(node, source ? selectedWire.output : selectedWire.input, source), pointer: e.pointerId, reconnect: { index: selected.wire, wire: selectedWire, end } };
          patchRef.current = drag; setPatch(drag);
        }} />;
      })}
    </div></div></div></div>
    {selected && <div className="patching-selection"><span>{selectedNode?.label ?? `${selectedWire?.from} → ${selectedWire?.to}`}</span>{selectedWire && 'wire' in selected && <label>Wire gain <input aria-label="Wire gain" disabled={busy} type="range" min="0" max="2" step="0.01" value={selectedWire.gain} onPointerDown={() => {gesture.current = current.current;}} onPointerUp={endGesture} onPointerCancel={endGesture} onChange={e => edit({...graph!, wires:graph!.wires.map((w,i) => i === selected.wire ? {...w,gain:Number(e.target.value)} : w)})} /><output>{selectedWire.gain.toFixed(2)}×</output></label>}<button disabled={busy || !!selectedNode && !removable(selectedNode)} title={selectedNode && !removable(selectedNode) ? 'Default routing nodes cannot be removed' : undefined} onClick={removeSelection}>{selectedNode ? 'Remove node' : 'Disconnect'}</button></div>}
  </PatchingPage>;
}
