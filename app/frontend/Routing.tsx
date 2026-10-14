import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type Kind = 'player' | 'trim' | 'eq' | 'filter' | 'fader' | 'crossfader' | 'cue' | 'output' | 'gain' | 'compressor' | 'oscillator' | 'ring_modulation';
type Processor = 'gain' | 'compressor' | 'oscillator' | 'ring_modulation';
export type RoutingNode = { id: string; kind: Kind; deck: number | null; label: string; x: number; y: number; value: number };
export type Wire = { from: string; output: string; to: string; input: string; gain: number };
export type Graph = { nodes: RoutingNode[]; wires: Wire[] };
export const inputs = (node: RoutingNode) => node.kind === 'player' || node.kind === 'oscillator' ? [] : node.kind === 'crossfader' || node.kind === 'cue' ? ['A', 'B'] : node.kind === 'compressor' ? ['audio', 'sidechain'] : node.kind === 'ring_modulation' ? ['audio', 'carrier'] : ['audio'];
const outputs = (node: RoutingNode) => node.kind === 'output' ? [] : node.kind === 'compressor' || node.kind === 'ring_modulation' ? ['audio', 'dry'] : node.kind === 'oscillator' ? ['audio', 'cosine'] : ['audio'];
const isProcessor = (node: RoutingNode) => ['gain', 'compressor', 'oscillator', 'ring_modulation'].includes(node.kind);
const point = (node: RoutingNode, port: string, output: boolean) => ({ x: node.x + (output ? 145 : 0), y: node.y + 56 + (output ? outputs(node) : inputs(node)).indexOf(port) * 26 });
const path = (a: { x: number; y: number }, b: { x: number; y: number }) => `M ${a.x} ${a.y} C ${a.x + Math.max(70, Math.abs(b.x - a.x) / 2)} ${a.y}, ${b.x - Math.max(70, Math.abs(b.x - a.x) / 2)} ${b.y}, ${b.x} ${b.y}`;
const equal = (a: Graph | null, b: Graph | null) => JSON.stringify(a) === JSON.stringify(b);
type Selection = { node: string } | { wire: number } | null;
type Patch = { from: string; output: string; x: number; y: number; pointer: number };
type Moving = { id: string; x: number; y: number; startX: number; startY: number; before: Graph; pointer: number };
const processors: Record<Processor, string> = { compressor: 'Compressor', gain: 'Gain', ring_modulation: 'Ring modulator', oscillator: 'Sine instrument' };

export function Routing({ active = true }: { active?: boolean }) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const current = useRef<Graph | null>(null);
  const [accepted, setAccepted] = useState<Graph | null>(null);
  const loaded = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(.8);
  const [selected, setSelected] = useState<Selection>(null);
  const [patch, setPatch] = useState<Patch | null>(null);
  const patchRef = useRef<Patch | null>(null);
  const moving = useRef<Moving | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; wire: number | null; category: 'effects' | 'instruments' | null } | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const past = useRef<Graph[]>([]), future = useRef<Graph[]>([]);
  const gesture = useRef<Graph | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const dirty = !equal(graph, accepted);
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
    endGesture(); setMenu(null);
  };
  useEffect(() => {
    if (!active || loaded.current) return;
    loaded.current = true;
    void invoke<Graph>('get_routing_graph').then(value => { showGraph(value); setAccepted(value); }).catch(e => { loaded.current = false; setError(String(e)); });
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
    const scale = rect.width > 0 ? rect.width / 1600 : zoom;
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
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
    cancelPatch(); setMenu(null);
    if ('wire' in selected) edit({ ...graph, wires: graph.wires.filter((_, i) => i !== selected.wire) });
    else {
      const node = graph.nodes.find(n => n.id === selected.node);
      if (!node) return;
      edit({ nodes: graph.nodes.filter(n => n.id !== node.id), wires: graph.wires.filter(w => w.from !== node.id && w.to !== node.id) });
    }
    setSelected(null); setMenu(null);
  };
  useEffect(() => {
    if (!active) return;
    const keydown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.closest('textarea, select, input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button])') || e.target.isContentEditable)) return;
      if (e.key === 'Escape') { e.preventDefault(); cancelInteraction(); return; }
      if (busy) return;
      if (e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (!e.metaKey && !e.ctrlKey && !e.altKey && ['Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); removeSelection(); }
    };
    window.addEventListener('keydown', keydown); window.addEventListener('blur', cancelInteraction); window.addEventListener('pointerup', endGesture);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('blur', cancelInteraction); window.removeEventListener('pointerup', endGesture); };
  }, [active, busy, graph, selected, historyRevision]);
  // Pointer capture on the canvas ensures release outside a port/window cancels.
  const finishPointer = (e: React.PointerEvent) => {
    const drag = moving.current;
    if (drag && drag.pointer === e.pointerId) {
      if (current.current) record(drag.before, current.current);
      moving.current = null;
    }
    const wire = patchRef.current;
    if (wire && wire.pointer === e.pointerId) {
      const port = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-routing-input]');
      const value = current.current;
      const node = value?.nodes.find(n => n.id === port?.dataset.node);
      const input = port?.dataset.routingInput;
      if (value && node && input && !busy) {
        if (value.wires.some(w => w.from === wire.from && w.output === wire.output && w.to === node.id && w.input === input)) setError('This connection already exists');
        else { edit({ ...value, wires: [...value.wires, { from: wire.from, output: wire.output, to: node.id, input, gain: 1 }] }); setSelected({ wire: value.wires.length }); }
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
  const add = (kind: Processor) => {
    if (!graph || !menu || graph.nodes.length >= 32 || busy) return;
    const wire = menu.wire === null ? undefined : graph.wires[menu.wire];
    if (wire && kind === 'oscillator') return;
    const node: RoutingNode = { id: `fx-${crypto.randomUUID()}`, kind, deck: null, label: processors[kind], x: Math.min(1440, Math.max(10, menu.x)), y: Math.min(800, Math.max(50, menu.y)), value: kind === 'compressor' ? .25 : kind === 'oscillator' ? 220 : 1 };
    const wires = [...graph.wires];
    if (wire) wires.splice(menu.wire!, 1, { ...wire, to: node.id, input: 'audio' }, { from: node.id, output: 'audio', to: wire.to, input: wire.input, gain: 1 });
    edit({ nodes: [...graph.nodes, node], wires }); setMenu(null); setSelected({ node: node.id });
  };
  const openMenu = (e: React.MouseEvent, wire: number | null) => {
    if (busy || !graph) return;
    e.stopPropagation(); cancelPatch(); setSelected(wire === null ? null : { wire });
    setMenu({ ...position(e), wire, category: null });
  };
  const selectedWire = selected && 'wire' in selected ? graph?.wires[selected.wire] : null;
  const selectedNode = selected && 'node' in selected ? graph?.nodes.find(n => n.id === selected.node) : null;
  return <section className="routing-page" aria-label="Audio routing" hidden={!active} style={!active ? { display: 'none' } : undefined}>
    <div className="routing-heading"><div><h2>Routing</h2><p>Drag ports to patch · Double-click space or a cable to add a node</p></div><div className="routing-actions">
      <div className="routing-zoom"><label>Zoom <select aria-label="Routing zoom" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[.5, .65, .8, 1, 1.25].map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select></label><button onClick={() => { if (!graph || !canvas.current) return; const width = Math.max(...graph.nodes.map(n => n.x + 170), 900); const available = canvas.current.parentElement!.parentElement!.clientWidth - 30; setZoom([1.25, 1, .8, .65, .5].find(value => width * value <= available) ?? .5); }}>Fit</button></div>
      <button disabled={busy || !past.current.length} onClick={undo}>Undo</button><button disabled={busy || !future.current.length} onClick={redo}>Redo</button>
      <button disabled={busy || !dirty} onClick={() => { if (accepted) edit(accepted); setSelected(null); }}>Revert edits</button>
      <button disabled={busy} onClick={() => { setBusy(true); void invoke<Graph>('default_routing_graph').then(value => { edit(value); setSelected(null); }).catch(e => setError(String(e))).finally(() => setBusy(false)); }}>Default chain</button>
      <button className="routing-apply" disabled={busy || !dirty || !graph} onClick={() => void apply()}>{busy ? 'Applying…' : 'Apply routing'}</button>
    </div></div>

    {error && <p className="routing-error" role="alert">{error} · Your current audio routing is retained.</p>}
    <div className="routing-body"><div className="routing-scroll" onPointerDown={e => { if (e.target === e.currentTarget) { setSelected(null); setMenu(null); } }}><div className="routing-canvas-space" style={{ width: 1600 * zoom, height: 1000 * zoom }}><div className="routing-canvas" ref={canvas} style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      onPointerDownCapture={e => { const field = document.activeElement; if (field instanceof HTMLElement && field.matches('input, textarea, select') && field !== e.target && !field.contains(e.target as Node)) field.blur(); }}
      onPointerDown={e => { if (e.target === e.currentTarget) { setSelected(null); setMenu(null); } }}
      onDoubleClick={e => { if (e.target === e.currentTarget) openMenu(e, null); }}
      onPointerMove={e => {
        const p = position(e), wire = patchRef.current, drag = moving.current;
        if (wire && wire.pointer === e.pointerId) { const next = { ...wire, ...p }; patchRef.current = next; setPatch(next); }
        if (drag && drag.pointer === e.pointerId && current.current && !busy) showGraph({ ...current.current, nodes: current.current.nodes.map(n => n.id === drag.id ? { ...n, x: Math.min(1440, Math.max(10, drag.x + p.x - drag.startX)), y: Math.min(800, Math.max(50, drag.y + p.y - drag.startY)) } : n) });
      }} onPointerUp={finishPointer} onPointerCancel={cancelInteraction} onLostPointerCapture={() => { if (patchRef.current || moving.current) cancelInteraction(); }}>
      {[0, 1].map(d => <div key={d} className={`routing-group deck-${d}`} style={{ top: 35 + d * 250 }}><strong>Deck {d === 0 ? 'A' : 'B'}</strong><span>Components controlled from the Decks page</span></div>)}
      <svg className="routing-wires" width="1600" height="1000" aria-label="Audio connections">{graph?.wires.map((wire, i) => {
        const from = graph.nodes.find(n => n.id === wire.from), to = graph.nodes.find(n => n.id === wire.to);
        if (!from || !to) return null;
        return <g key={i} className={selected && 'wire' in selected && selected.wire === i ? 'selected' : ''}><path className="routing-wire" d={path(point(from, wire.output, true), point(to, wire.input, false))} /><path className="routing-wire-hit" data-wire={i} d={path(point(from, wire.output, true), point(to, wire.input, false))} onPointerDown={e => { e.stopPropagation(); setSelected({ wire: i }); setMenu(null); }} onDoubleClick={e => openMenu(e, i)}><title>{wire.from} → {wire.to} ({wire.input}) · gain {wire.gain}</title></path></g>;
      })}{patch && graph && (() => { const from = graph.nodes.find(n => n.id === patch.from); return from && <path className="routing-wire preview" data-testid="wire-preview" d={path(point(from, patch.output, true), patch)} />; })()}</svg>
      {graph?.nodes.map(node => <div key={node.id} data-node-id={node.id} className={`routing-node ${node.deck === null ? '' : `deck-${node.deck}`} ${selected && 'node' in selected && selected.node === node.id ? 'selected' : ''}`} style={{ left: node.x, top: node.y }} onPointerDown={e => { e.stopPropagation(); setSelected({ node: node.id }); setMenu(null); }}>
        <div className="routing-node-title" onPointerDown={e => { if (busy || e.button !== 0 || !graph) return; e.preventDefault(); const p = position(e); canvas.current?.setPointerCapture(e.pointerId); moving.current = { id: node.id, x: node.x, y: node.y, startX: p.x, startY: p.y, before: graph, pointer: e.pointerId }; }}>{node.label}<small>{node.deck === null ? node.kind : `Deck ${node.deck === 0 ? 'A' : 'B'}`}</small></div>
        <div className="routing-ports">{inputs(node).map((port, i) => <button key={port} className="routing-port input" style={{ top: 44 + i * 26 }} data-routing-input={port} data-node={node.id} aria-label={`${node.id} input ${port}`}><i />{port}</button>)}{outputs(node).map((port, i) => <button key={port} className="routing-port output" style={{ top: 44 + i * 26 }} aria-label={`${node.id} output ${port}`} disabled={busy} onPointerDown={e => { if (busy || e.button !== 0) return; e.preventDefault(); e.stopPropagation(); setMenu(null); canvas.current?.setPointerCapture(e.pointerId); const wire = { from: node.id, output: port, ...position(e), pointer: e.pointerId }; patchRef.current = wire; setPatch(wire); }}><span>{port}</span><i /></button>)}</div>
        {isProcessor(node) && <div className="routing-parameter">{node.kind !== 'ring_modulation' && <label>{node.kind === 'oscillator' ? 'Hz' : node.kind === 'compressor' ? 'Threshold' : 'Gain'}<input aria-label={`${node.id} value`} disabled={busy} type="number" min={node.kind === 'oscillator' ? 20 : node.kind === 'compressor' ? .01 : 0} max={node.kind === 'oscillator' ? 2000 : node.kind === 'compressor' ? 1 : 2} step={node.kind === 'oscillator' ? 1 : .01} value={node.value} onFocus={() => { gesture.current = current.current; }} onBlur={endGesture} onChange={e => edit({ ...graph, nodes: graph.nodes.map(n => n.id === node.id ? { ...n, value: Number(e.target.value) } : n) })} /></label>}</div>}
      </div>)}
      {menu && <div className="routing-menu" role="menu" aria-label={menu.wire === null ? 'Add routing node' : 'Insert routing node'} style={{ left: Math.min(1360, menu.x), top: Math.min(770, menu.y) }} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
        <strong>{menu.wire === null ? 'Add node' : 'Insert into cable'}</strong>
        {menu.category === null ? <><button role="menuitem" onClick={() => setMenu({ ...menu, category: 'effects' })}>Effects ›</button><button role="menuitem" disabled={menu.wire !== null} title={menu.wire !== null ? 'Instruments are audio sources; add them in empty space' : undefined} onClick={() => setMenu({ ...menu, category: 'instruments' })}>Instruments ›</button></> : <><button role="menuitem" onClick={() => setMenu({ ...menu, category: null })}>‹ Categories</button>{(menu.category === 'effects' ? ['compressor', 'gain', 'ring_modulation'] : ['oscillator']).map(kind => <button key={kind} role="menuitem" disabled={graph !== null && graph.nodes.length >= 32} onClick={() => add(kind as Processor)}>{processors[kind as Processor]}</button>)}</>}
      </div>}
    </div></div></div><aside className="routing-inspector"><h3>{selectedNode ? 'Node' : 'Connection'}</h3>
      {selectedNode ? <><p>{selectedNode.label}</p><button disabled={busy} onClick={removeSelection}>Remove node</button></> : selectedWire && selected && 'wire' in selected ? <><p>{selectedWire.from}<br />↓<br />{selectedWire.to} / {selectedWire.input}</p><label>Wire gain <input aria-label="Wire gain" disabled={busy} type="range" min="0" max="2" step="0.01" value={selectedWire.gain} onPointerDown={() => { gesture.current = current.current; }} onPointerUp={endGesture} onPointerCancel={endGesture} onChange={e => edit({ ...graph!, wires: graph!.wires.map((w, i) => i === selected.wire ? { ...w, gain: Number(e.target.value) } : w) })} /></label><output>{selectedWire.gain.toFixed(2)}×</output><button disabled={busy} onClick={removeSelection}>Disconnect</button></> : <p>Select a node or cable. Click empty space to deselect.</p>}
      <hr /><p>Double-click space to add a node, or a cable to insert an effect.</p><p>Delete / Backspace removes the selection. ⌘Z undoes; ⌘⇧Z redoes. Edits stay here when switching pages.</p><p>Drag from an output to an input. Release elsewhere to cancel. Signals feeding the same input are summed.</p><p>Deck controls operate their matching nodes. Outputs use devices selected on AUDIO.</p><p>Apply validates ports and rejects feedback loops. Disconnected outputs are silent.</p>
    </aside></div>
  </section>;
}
