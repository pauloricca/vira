import { invoke } from '@tauri-apps/api/core';
import { addSessionPatch, usePatchLibrary } from './patchLibrary';
import { PatchingPage, PatchingHeading, PatchingNodeHeader, patchPortTop, patchPortPoint, NodePalette, nodePlacement, paletteDrop, paletteDragOver, withoutPatchNode, usePatchingKeys, type PatchPoint } from './Patching';
import { useRef, useState, type PointerEvent } from 'react';
import { canvasPosition, cablePath } from './routingGeometry';
import { connectMusical, pitchLabel, linkedHarmony, keys, scales, uid, type Bank, type Harmony, type MusicalGraph, type MusicalNode, type MusicalWire, type Pattern } from './patternModel';
type Props = { activeDeck: number; deviceNotes: Record<string,number>; inputs: {id:number;name:string}[]; liveRoots: Record<string,number>; bank: Bank; outputs: { id: number; name: string }[]; instruments: { slot: number; name: string | null; loaded: boolean; running: boolean }[]; deckKeys: (Harmony | null)[]; active: boolean; status: (p: Pattern) => string; canPlay: (p: Pattern) => boolean; onGraph: (g: MusicalGraph) => void; onCreate: (point?: PatchPoint) => void; onExpand: (id: string) => void; onPlay: (p: Pattern) => void; error: (text: string) => void };
type CableDrag = { pointer: number; from: string; kind: MusicalWire['kind']; x: number; y: number; reconnect?: { wire: MusicalWire; end: 'source' | 'target' } };
const portPoint = (n: MusicalNode, output: boolean, kind: string) => patchPortPoint(n, kind === 'scale' || n.kind === 'transformation' && kind === 'midi' || output && n.kind !== 'deck' && kind === 'midi' ? 1 : 0, output);
export function PatternCanvas({ activeDeck, bank, deviceNotes, inputs, liveRoots, outputs, instruments, deckKeys, active, status, canPlay, onGraph, onCreate, onExpand, onPlay, error }: Props) {
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const {files} = usePatchLibrary(active);
  const graph = bank.graph!;
  const current = useRef(graph); current.current = graph;
  const [draft, setDraft] = useState<MusicalGraph | null>(null);
  const [selection, setSelection] = useState<{ wire: string } | { node: string } | null>(null);
  const [zoom, setZoom] = useState(.8);
  const [drag, setDrag] = useState<CableDrag | null>(null);
  const cable = useRef<CableDrag | null>(null);
  const moving = useRef<{ pointer: number; id: string; x: number; y: number; startX: number; startY: number } | null>(null);
  const moved = useRef<MusicalGraph | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const past = useRef<MusicalGraph[]>([]), future = useRef<MusicalGraph[]>([]);
  const [, redraw] = useState(0);
  const show = draft ?? graph;
  function edit(g: MusicalGraph) { past.current.push(current.current); future.current = []; current.current = g; onGraph(g); redraw(n => n + 1); }
  function cancel() { cable.current = null; setDrag(null); moving.current = null; moved.current = null; setDraft(null); }
  function undo(redo = false) {
    cancel(); const source = redo ? future : past, target = redo ? past : future; const g = source.current.pop();
    if (!g) return;
    const nodes = g.nodes.filter(n => n.kind !== 'pattern' || bank.patterns.some(p => p.id === n.pattern));
    const wires = g.wires.filter(w => nodes.some(n => n.id === w.from) && nodes.some(n => n.id === w.to));
    target.current.push(current.current); onGraph({ nodes, wires }); setSelection(null); redraw(n => n + 1);
  }
  function remove() {
    if (!selection) return;
    if ('wire' in selection) edit({ ...graph, wires: graph.wires.filter(w => w.id !== selection.wire) });
    else { const node = graph.nodes.find(n => n.id === selection.node); if (node) edit(withoutPatchNode(graph, node.id)); }
    setSelection(null);
  }
  usePatchingKeys(active, {cancel: () => {cancel(); setSelection(null);}, remove, undo: () => undo(), redo: () => undo(true)}, adding);
  const position = (event: { clientX: number; clientY: number }) => canvasPosition(event, canvas.current!.getBoundingClientRect(), 1800, zoom);
  function begin(event: PointerEvent, n: MusicalNode, kind: MusicalWire['kind'], reconnect?: CableDrag['reconnect']) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); canvas.current?.setPointerCapture(event.pointerId);
    const c = { pointer: event.pointerId, from: n.id, kind, ...position(event), reconnect }; cable.current = c; setDrag(c);
  }
  function finish(event: PointerEvent) {
    const c = cable.current;
    if (c?.pointer === event.pointerId) {
      const source = c.reconnect?.end === 'source';
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(source ? '[data-music-output]' : '[data-music-input]');
      const node = current.current.nodes.find(n => n.id === target?.dataset.node);
      const kind = source ? target?.dataset.musicOutput : target?.dataset.musicInput;
      const compatible = kind === c.kind || !source && c.kind === 'notes' && kind === 'midi';
      if (node && compatible) {
        const wire: MusicalWire = c.reconnect ? { ...c.reconnect.wire, ...(source ? { from: node.id } : { to: node.id }) } : { id: uid(), from: c.from, to: node.id, kind: c.kind };
        try { edit(connectMusical(current.current, wire, c.reconnect?.wire.id)); setSelection({ wire: wire.id }); error(''); } catch (e) { error(String(e)); }
      }
    }
    if (moving.current?.pointer === event.pointerId && moved.current) edit(moved.current);
    cancel(); if (canvas.current?.hasPointerCapture(event.pointerId)) canvas.current.releasePointerCapture(event.pointerId);
  }
  function addInstrument(value: string, point: PatchPoint) {
    if (!value) return;
    const [kind, id] = value.split(':');
    const destination = kind === 'input' ? { kind: 'midi' as const, output: outputs.find(o => o.name === inputs.find(i => i.id === Number(id))?.name)?.id ?? 0 } : kind === 'midi' ? { kind: 'midi' as const, output: Number(id) } : { kind: 'teia' as const, slot: Number(id) };
    const label = kind === 'input' ? inputs.find(i => i.id === Number(id))?.name : kind === 'midi' ? outputs.find(o => o.id === Number(id))?.name : instruments.find(i => i.slot === Number(id))?.name?.replace(/\.json$/, '');
    const n: MusicalNode = { id: uid(), kind: 'instrument', label: label ?? 'Instrument', destination, input: kind === 'input' ? Number(id) : null, ...point };
    edit({ ...graph, nodes: [...graph.nodes, n] }); setSelection({ node: n.id });
  }
  async function addNode(value: string, point = nodePlacement(canvas.current!, 1800, zoom)) {
    if (addingRef.current) return;
    addingRef.current = true; setAdding(true);
    try {
      if (value === 'new-pattern') { onCreate(point); return; }
      if (value.startsWith('patch:') || value === 'new-patch') {
        const entry = await addSessionPatch(value === 'new-patch' ? undefined : value.slice(6));
        const g = current.current;
        const existing = g.nodes.find(n => n.destination?.kind === 'teia' && n.destination.slot === entry.slot);
        const n: MusicalNode = existing ? {...existing, ...point} : {id:uid(), kind:'instrument', label:entry.state.record?.name.replace(/\.json$/, '') ?? 'Patch', destination:{kind:'teia', slot:entry.slot}, ...point};
        edit({...g, nodes:[...g.nodes.filter(old => old.id !== n.id), n]}); setSelection({node:n.id}); return;
      }
      if (value.startsWith('pattern:') || value.startsWith('deck:')) {
        const isPattern = value.startsWith('pattern:'), id = value.split(':')[1];
        const p = bank.patterns.find(p => p.id === id);
        const existing = graph.nodes.find(n => isPattern ? n.pattern === id : n.deck === Number(id));
        const n: MusicalNode = existing ? {...existing, ...point} : isPattern ? {id:uid(), kind:'pattern', pattern:id, label:p!.name, ...point} : {id:uid(), kind:'deck', deck:Number(id), label:Number(id) === 2 ? 'Active deck' : `Deck ${Number(id) === 0 ? 'A' : 'B'}`, ...point};
        edit({...graph, nodes:[...graph.nodes.filter(old => old.id !== n.id), n]}); setSelection({node:n.id}); return;
      }
      if (value === 'octaveShift' || value === 'filter') {
        const n: MusicalNode = {id:uid(), kind:'transformation', label:value === 'filter' ? 'Filter' : 'Octave shift', transformation:value === 'filter' ? {kind:'filter', direction:'above', note:60} : {kind:'octaveShift', octaves:1}, ...point};
        edit({...graph, nodes:[...graph.nodes, n]}); setSelection({node:n.id}); return;
      }
      addInstrument(value, point);
    } catch (e) {error(String(e));} finally {addingRef.current = false; setAdding(false);}
  }
  const categories = [
    {label:'Transformations', items:[{id:'octaveShift',label:'Octave shift'}, {id:'filter',label:'Filter'}]},
    {label:'Patterns', items:bank.patterns.map(p => ({id:`pattern:${p.id}`, label:p.name}))},
    {label:'Decks', items:[{id:'deck:0',label:'Deck A'}, {id:'deck:1',label:'Deck B'}, {id:'deck:2',label:'Active deck'}]},
    {label:'MIDI destinations', items:outputs.map(o => ({id:`midi:${o.id}`,label:o.name}))},
    {label:'MIDI sources', items:inputs.map(o => ({id:`input:${o.id}`,label:o.name}))},
    {label:'Patches', footer:<button disabled={adding} onClick={() => void addNode('new-patch')}>+ New patch</button>, items:[...new Set([...files, ...instruments.filter(i => i.loaded && i.name).map(i => i.name!)])].map(name => ({id:`patch:${name}`, label:name.replace(/\.json$/, '')}))},
  ];
  const selectedWire = selection && 'wire' in selection ? graph.wires.find(w => w.id === selection.wire) : undefined;
  const selectedNode = selection && 'node' in selection ? graph.nodes.find(n => n.id === selection.node) : undefined;
  function nodeTitle(n: MusicalNode) {
    if (n.kind === 'pattern') return bank.patterns.find(p => p.id === n.pattern)?.name ?? n.label;
    if (n.destination?.kind === 'midi') return outputs.find(o => o.id === (n.destination as { output: number }).output)?.name ?? n.label;
    if (n.destination?.kind === 'teia') return instruments.find(i => i.slot === (n.destination as { slot: number }).slot)?.name?.replace(/\.json$/, '') ?? n.label;
    return n.label;
  }
  return <PatchingPage className="pattern-patching" aria-label="Pattern patching canvas" hidden={!active}>
    <PatchingHeading title="Patterns" description="Drag ports to patch · Double-click a pattern to expand its editor"><label>Zoom <select aria-label="Pattern canvas zoom" value={zoom} onChange={e => setZoom(+e.target.value)}>{[.5,.65,.8,1,1.25].map(z => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}</select></label><span className="music-link-legend" aria-label="Link colours"><span className="legend-notes">Note</span><span className="legend-midi">MIDI</span><span className="legend-scale">Scale</span></span><button disabled={!past.current.length} onClick={() => undo()}>Undo</button><button disabled={!future.current.length} onClick={() => undo(true)}>Redo</button></PatchingHeading>
    <div className="routing-body"><NodePalette disabled={adding} categories={categories} onAdd={(id, point) => void addNode(id, point)} actions={<><button disabled={adding} onClick={() => void addNode('new-pattern')}>+ Pattern</button></>} /><div className="routing-scroll" onDragOver={paletteDragOver} onDrop={e => paletteDrop(e, (id, point) => void addNode(id, point), canvas.current!, 1800, zoom)}><div className="routing-canvas-space" style={{ width: 1800 * zoom, height: 1100 * zoom }}><div ref={canvas} className="routing-canvas musical-canvas" style={{ width:1800, height:1100, transform: `scale(${zoom})`, transformOrigin: 'top left' }} onPointerDown={e => { if (e.target === e.currentTarget) setSelection(null); }} onPointerMove={e => {
      const p = position(e); if (cable.current?.pointer === e.pointerId) { cable.current = { ...cable.current, ...p }; setDrag(cable.current); }
      const m = moving.current; if (m?.pointer === e.pointerId) { const g = { ...current.current, nodes: current.current.nodes.map(n => n.id === m.id ? { ...n, x: Math.max(0, Math.min(1500, m.x + p.x - m.startX)), y: Math.max(0, Math.min(900, m.y + p.y - m.startY)) } : n) }; moved.current = g; setDraft(g); }
    }} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={() => { if (cable.current || moving.current) cancel(); }}>
      <svg className="routing-wires" width="1800" height="1100" aria-label="Musical connections">{show.wires.map(w => {
        const from = show.nodes.find(n => n.id === w.from), to = show.nodes.find(n => n.id === w.to); if (!from || !to || drag?.reconnect?.wire.id === w.id) return null;
        const path = cablePath(portPoint(from, true, w.kind), portPoint(to, false, w.kind));
        return <g key={w.id} className={`${selection && 'wire' in selection && selection.wire === w.id ? 'selected' : ''} music-${w.kind}`}><path className="routing-wire" d={path} /><path className="routing-wire-hit" data-musical-wire={w.id} aria-label={`${w.kind} cable ${nodeTitle(from)} to ${nodeTitle(to)}`} d={path} onPointerDown={e => { e.stopPropagation(); setSelection({ wire: w.id }); }} /></g>;
      })}{drag && (() => { const from = show.nodes.find(n => n.id === drag.from), to = show.nodes.find(n => n.id === drag.reconnect?.wire.to); const source = drag.reconnect?.end === 'source'; return from && (!source || to) && <path className={`routing-wire preview music-wire-${drag.kind}`} data-testid="musical-wire-preview" d={source ? cablePath(drag, portPoint(to!, false, drag.kind)) : cablePath(portPoint(from, true, drag.kind), drag)} />; })()}</svg>
      {show.nodes.map(n => {
        const p = bank.patterns.find(p => p.id === n.pattern); const harmony = n.kind === 'deck' ? deckKeys[n.deck === 2 ? activeDeck : n.deck ?? 0] : n.harmony;
        const mapping = p ? { key: linkedHarmony(bank, p.id, deckKeys, 'root', liveRoots, activeDeck)?.harmony?.key ?? p.key, scale: linkedHarmony(bank, p.id, deckKeys, 'scale', liveRoots, activeDeck)?.harmony?.scale ?? p.scale } : null;
        const hasSource = n.destination?.kind === 'midi'
          ? inputs.some(i => n.input != null ? n.input !== 0 && i.id === n.input : i.name === (outputs.find(o => n.destination?.kind === 'midi' && o.id === n.destination.output)?.name ?? n.label))
          : n.destination?.kind === 'teia' && instruments.some(i => n.destination?.kind === 'teia' && i.slot === n.destination.slot && i.loaded && i.running);
        const outs: MusicalWire['kind'][] = n.kind === 'transformation' || n.kind === 'pattern' ? ['notes', 'midi'] : n.kind === 'instrument' ? hasSource ? ['notes', 'midi'] : [] : ['notes', 'scale']; const inputPorts: MusicalWire['kind'][] = n.kind === 'transformation' ? ['notes', 'midi'] : n.kind === 'pattern' ? ['notes', 'scale'] : n.destination?.kind === 'midi' && n.destination.output === 0 ? [] : ['midi'];
        const available = n.destination?.kind === 'midi' ? n.destination.output === 0 ? inputs.some(i => i.id === n.input) : outputs.some(o => o.id === (n.destination as { output: number }).output) : n.destination?.kind === 'teia' ? instruments.some(i => i.slot === (n.destination as { slot: number }).slot && i.loaded && i.running) : true;
        return <div key={n.id} data-musical-node={n.id} className={`routing-node musical-node ${n.kind === 'deck' ? `deck-${n.deck === 2 ? activeDeck : n.deck}` : ''} ${selection && 'node' in selection && selection.node === n.id ? 'selected' : ''}`} style={{ left: n.x, top: n.y }} onPointerDown={e => { e.stopPropagation(); setSelection({ node: n.id }); }} onDoubleClick={e => { e.stopPropagation(); if ((e.target as HTMLElement).closest('button')) return; if (p) onExpand(p.id); else if (n.destination?.kind === 'teia') void invoke('teia_open_editor', {slot:n.destination.slot}).catch(e => error(String(e))); }}>
          <PatchingNodeHeader title={nodeTitle(n)} subtitle={n.kind === 'transformation' ? 'TRANSFORMATION' : n.kind === 'pattern' ? `${p?.bars} bars · ${status(p!)} · CH ${p?.channel}` : n.kind === 'deck' ? n.deck === 2 ? `FOLLOWING DECK ${activeDeck === 0 ? 'A' : 'B'} · NOTE INPUT` : 'DECK · NOTE INPUT' : `${n.destination?.kind === 'teia' ? 'TEIA INSTRUMENT' : n.destination?.kind === 'midi' && n.destination.output === 0 ? 'MIDI SOURCE' : 'MIDI INSTRUMENT'}${available ? '' : ' · UNAVAILABLE'}`} onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); canvas.current?.setPointerCapture(e.pointerId); const point = position(e); moving.current = { pointer: e.pointerId, id: n.id, x: n.x, y: n.y, startX: point.x, startY: point.y }; }} />
          <div className="routing-ports">
          {inputPorts.map(input => <button key={input} className={`routing-port input music-${input}`} style={{ top: patchPortTop(input === 'scale' || n.kind === 'transformation' && input === 'midi' ? 1 : 0) }} data-music-input={input} data-node={n.id} aria-label={`${n.id} input ${input}`}><i /><span>{input === 'notes' ? n.kind === 'transformation' ? 'note in' : 'root note' : input === 'scale' ? 'scale' : n.kind === 'deck' ? 'note in' : 'MIDI in'}</span></button>)}
          {outs.map(out => <button key={out} className={`routing-port output music-${out}`} style={{ top: patchPortTop(out === 'scale' || n.kind !== 'deck' && out === 'midi' ? 1 : 0) }} data-music-output={out} data-node={n.id} aria-label={`${n.id} output ${out}`} onPointerDown={e => begin(e, n, out)}><span>{out === 'root' ? 'root note' : out === 'scale' ? 'scale' : out === 'notes' ? 'note out' : 'MIDI out'}</span><i /></button>)}
          </div>
          {n.transformation ? <div className="routing-node-details transformation-controls" onDoubleClick={e => e.stopPropagation()}>
            {n.transformation.kind === 'octaveShift' ? <label>Octaves<select aria-label={`${n.id} octaves`} value={n.transformation.octaves} onChange={e => edit({...graph, nodes:graph.nodes.map(old => old.id === n.id ? {...old, transformation:{kind:'octaveShift', octaves:Number(e.target.value)}} : old)})}>{Array.from({length:21}, (_, i) => i - 10).map(o => <option key={o} value={o}>{o > 0 ? '+' : ''}{o}</option>)}</select></label> : <>
              <label>Pass<select aria-label={`${n.id} filter direction`} value={n.transformation.direction} onChange={e => edit({...graph, nodes:graph.nodes.map(old => old.id === n.id ? {...old, transformation:{...n.transformation as {kind:'filter';note:number;direction:'above'|'below'}, direction:e.target.value as 'above'|'below'}} : old)})}><option value="above">Above</option><option value="below">Below</option></select></label>
              <label>Note<select aria-label={`${n.id} filter note`} value={n.transformation.note} onChange={e => edit({...graph, nodes:graph.nodes.map(old => old.id === n.id ? {...old, transformation:{...n.transformation as {kind:'filter';note:number;direction:'above'|'below'}, note:Number(e.target.value)}} : old)})}>{Array.from({length:128}, (_, note) => <option key={note} value={note}>{pitchLabel(note)} · {note}</option>)}</select></label><small>Strictly {n.transformation.direction} the selected note</small>
            </>}
          </div> : p ? <div className="routing-node-details musical-node-pattern"><small className="pattern-last-note">{deviceNotes[n.id] !== undefined ? `Last note ${pitchLabel(deviceNotes[n.id])}` : 'Waiting for note'}</small><small className="musical-pattern-key">{mapping && `${keys[mapping.key]} ${scales[mapping.scale]}`}</small><svg viewBox="0 0 176 38" aria-label={`${p.name} preview`}>{p.notes.map(note => <rect key={note.id} x={note.beat / (p.bars * 4) * 176} y={34 - ((note.octave + 2) * 7 + note.degree - 1)} width={Math.max(2, note.duration / (p.bars * 4) * 176)} height={2} />)}</svg><div className="routing-node-actions"><button aria-label={`${status(p) === 'Stopped' ? 'Play' : 'Stop'} ${p.name}`} disabled={status(p) === 'Stopped' && !canPlay(p)} onDoubleClick={e => e.stopPropagation()} onClick={() => onPlay(p)}>{status(p) === 'Stopped' ? '▶' : '■'}</button><button aria-label={`Expand ${p.name}`} onClick={() => onExpand(p.id)}>Expand ↗</button></div></div> : <p className="routing-node-details">{n.kind === 'instrument' ? deviceNotes[n.id] !== undefined ? `Last note ${pitchLabel(deviceNotes[n.id])}` : hasSource ? 'Waiting for note' : 'No MIDI source' : harmony ? `${keys[harmony.key]} ${scales[harmony.scale]}` : 'Key unavailable'}</p>}
        </div>;
      })}
      {selectedWire && (['source','target'] as const).map(end => { const source = end === 'source'; const node = show.nodes.find(n => n.id === (source ? selectedWire.from : selectedWire.to)); if (!node) return null; const point = drag?.reconnect?.end === end ? drag : portPoint(node, source, selectedWire.kind); return <button key={end} className="routing-wire-endpoint" aria-label={`Reconnect musical cable ${end}`} style={{ left: point.x, top: point.y, pointerEvents: drag ? 'none' : undefined }} onPointerDown={e => begin(e, show.nodes.find(n => n.id === selectedWire.from)!, selectedWire.kind, { wire: selectedWire, end })} />; })}
    </div></div></div></div>
    {selection && <div className="patching-selection"><span>{selectedNode ? nodeTitle(selectedNode) : selectedWire?.kind}</span>{selectedNode?.destination?.kind === 'midi' && <label>MIDI source<select aria-label="Device MIDI source" value={selectedNode.input ?? ''} onChange={e => edit({...graph, nodes:graph.nodes.map(n => n.id === selectedNode.id ? {...n, input:e.target.value === '' ? null : Number(e.target.value)} : n)})}><option value="">Auto-match device name</option><option value={0}>None</option>{inputs.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>}{selectedNode?.destination?.kind === 'midi' && <label>Channel<select aria-label="Device MIDI channel" value={selectedNode.channel ?? ''} onChange={e => edit({...graph, nodes:graph.nodes.map(n => n.id === selectedNode.id ? {...n, channel:e.target.value === '' ? null : Number(e.target.value)} : n)})}><option value="">All</option>{Array.from({length:16}, (_, i) => i + 1).map(channel => <option key={channel} value={channel}>{channel}</option>)}</select></label>}<button onClick={remove}>{selectedNode ? 'Remove node' : 'Disconnect'}</button></div>}
  </PatchingPage>;
}
