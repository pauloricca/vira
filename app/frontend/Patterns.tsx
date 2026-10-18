import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { fitLength, keys, newPattern, pitch, pitchLabel, scales, snap, uid, type Bank, type Pattern, type PatternNote } from './patternModel';
import './patterns.css';
import { PatternCanvas } from './PatternCanvas';
import { normaliseBank, linkedHarmony, type Harmony, type MusicalGraph } from './patternModel';
type Snapshot = { activeDeck?: number; deviceNotes?:Record<string,number>; inputs?: {id:number;name:string}[]; liveRoots?: Record<string,number>; bank: Bank; outputs: { id: number; name: string }[]; voices: Record<string, { start: number; stop: number | null }>; beat: number; bpm: number; clockReady: boolean; instruments?: { slot: number; name: string | null; loaded: boolean; running: boolean }[]; deckKeys?: (Harmony | null)[]; error: string | null };
const rows = Array.from({ length: 35 }, (_, i) => 20 - i); // degrees from -2 to +2 octaves
const rowDegree = (row: number) => ({ degree: ((row % 7) + 7) % 7 + 1, octave: Math.floor(row / 7) });
export function Patterns({ active }: { active: boolean }) {
  const [bank, setBank] = useState<Bank | null>(null);
  const current = useRef<Bank | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState('');
  const confirmation = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (deleteId) confirmation.current?.showModal(); }, [deleteId]);
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);
  const saveFailed = useRef(false);
  const [noteSelected, setNoteSelected] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const rollScroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (rollScroll.current) rollScroll.current.scrollTop = 220; }, [selected, expanded]);
  useEffect(() => {
    let live = true;
    const refresh = () => invoke<Snapshot>('patterns_state').then(s => {
      if (!live) return;
      setSnapshot(s);
      if (!current.current) { current.current = normaliseBank(s.bank); setBank(current.current); setSelected(s.bank.patterns[0]?.id ?? ''); }
    }).catch(e => { if (live) setError(String(e)); });
    void refresh(); const timer = window.setInterval(refresh, active ? 50 : 500);
    return () => { live = false; window.clearInterval(timer); };
  }, [active]);
  function commit(next: Bank) {
    current.current = next; setBank(next); setSaving(true); pending.current++;
    queue.current = queue.current.then(() => invoke('patterns_save', { bank: next }).then(() => { saveFailed.current = false; setError(''); }).catch(e => { saveFailed.current = true; setError(`Changes not saved: ${e}`); })).finally(() => { pending.current--; if (!pending.current) setSaving(false); });
  }
  const rawPattern = bank?.patterns.find(p => p.id === selected);
  const rootLink = bank && rawPattern ? linkedHarmony(bank, rawPattern.id, snapshot?.deckKeys ?? [null, null], 'root', snapshot?.liveRoots, snapshot?.activeDeck ?? 0) : null;
  const scaleLink = bank && rawPattern ? linkedHarmony(bank, rawPattern.id, snapshot?.deckKeys ?? [null, null], 'scale', snapshot?.liveRoots, snapshot?.activeDeck ?? 0) : null;
  const pattern = rawPattern ? { ...rawPattern, key: rootLink?.harmony?.key ?? rawPattern.key, scale: scaleLink?.harmony?.scale ?? rawPattern.scale } : rawPattern;
  function update(p: Pattern) {
    const b = current.current; if (!b) return;
    const raw = b.patterns.find(old => old.id === p.id);
    const next = raw ? { ...p, key: rootLink ? raw.key : p.key, scale: scaleLink ? raw.scale : p.scale } : p;
    commit({ ...b, patterns: b.patterns.map(old => old.id === p.id ? next : old), graph: b.graph && { ...b.graph, nodes: b.graph.nodes.map(n => n.pattern === p.id ? { ...n, label: p.name } : n) } });
  }
  function editGraph(graph: MusicalGraph) { if (current.current) commit({ ...current.current, graph }); }
  function removePattern(id: string) { if (!bank) return; const nodes = bank.graph!.nodes.filter(n => n.pattern !== id); commit({ ...bank, patterns: bank.patterns.filter(p => p.id !== id), graph: { nodes, wires: bank.graph!.wires.filter(w => nodes.some(n => n.id === w.from) && nodes.some(n => n.id === w.to)) } }); setSelected(bank.patterns.find(p => p.id !== id)?.id ?? ''); setDeleteId(''); if (bank.patterns.length === 1) setExpanded(false); }
  function canPlay(p: Pattern) { return !!snapshot?.clockReady && !!bank?.graph?.nodes.some(n => n.pattern === p.id); }
  function add(duplicate = false, point?: {x:number;y:number}) {
    if (!bank) return;
    const p = duplicate && pattern ? { ...pattern, id: uid(), name: `${pattern.name} copy`, notes: pattern.notes.map(n => ({ ...n, id: uid() })) } : newPattern();
    const node = { id: uid(), kind: 'pattern' as const, label: p.name, x: 430 + Math.floor(bank.patterns.length / 4) * 230 % 1000, y: 70 + bank.patterns.length % 4 * 200, pattern: p.id, ...point };
    commit({ ...bank, patterns: [...bank.patterns, p], graph: { ...bank.graph!, nodes: [...bank.graph!.nodes, node] } }); setSelected(p.id); setDeleteId('');
  }
  async function transport(p: Pattern) {
    const play = !snapshot?.voices[p.id];
    if (play) { await queue.current; if (saveFailed.current) return; }
    try { await invoke('patterns_transport', { id: p.id, play }); const s = await invoke<Snapshot>('patterns_state'); setSnapshot(s); } catch (e) { setError(String(e)); }
  }
  function point(event: { clientX: number; clientY: number }, p: Pattern) {
    const rect = grid.current!.getBoundingClientRect();
    return { beat: Math.max(0, Math.min(p.bars * 4 - 1 / p.grid, Math.floor((event.clientX - rect.left) / rect.width * p.bars * 4 * p.grid) / p.grid)), row: rows[Math.max(0, Math.min(rows.length - 1, Math.floor((event.clientY - rect.top) / 22)))] };
  }
  function create(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pattern || event.button !== 0 || event.target !== event.currentTarget) return;
    const { beat, row } = point(event, pattern); const relative = rowDegree(row);
    if (pitch(pattern, relative.degree, relative.octave) < 0 || pitch(pattern, relative.degree, relative.octave) > 127) return;
    const note = { id: uid(), beat, duration: 1 / pattern.grid, ...relative, velocity: 100 };
    update({ ...pattern, notes: [...pattern.notes, note] }); setNoteSelected(note.id);
  }
  function drag(event: ReactPointerEvent, note: PatternNote, resize: boolean) {
    if (!pattern || event.button !== 0) return;
    event.stopPropagation(); event.preventDefault(); setNoteSelected(note.id);
    const target = event.currentTarget as HTMLElement; target.setPointerCapture(event.pointerId);
    const origin = { x: event.clientX, y: event.clientY }; let moved = false;
    const original = pattern; let latest = note;
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientX - origin.x) + Math.abs(e.clientY - origin.y) < 3 && !moved) return;
      moved = true;
      const rect = grid.current!.getBoundingClientRect(); const quantise = (value: number) => snapToGrid ? snap(value, original.grid) : value; const delta = quantise((e.clientX - origin.x) / rect.width * original.bars * 4);
      if (resize) latest = { ...note, duration: Math.min(original.bars * 4 - note.beat, Math.max(snapToGrid ? 1 / original.grid : 0.03125, quantise(note.duration + delta))) };
      else { const row = Math.max(-14, Math.min(20, (note.octave * 7 + note.degree - 1) - Math.round((e.clientY - origin.y) / 22))); const rel = rowDegree(row); if (pitch(original, rel.degree, rel.octave) < 0 || pitch(original, rel.degree, rel.octave) > 127) return; latest = { ...note, beat: Math.max(0, Math.min(original.bars * 4 - note.duration, quantise(note.beat + delta))), ...rel }; }
      setBank({ ...current.current!, patterns: current.current!.patterns.map(p => p.id === original.id ? { ...original, notes: original.notes.map(n => n.id === note.id ? latest : n) } : p) });
    };
    const finish = (e: PointerEvent) => {
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', finish); target.removeEventListener('pointercancel', cancel);
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
      if (moved) update({ ...original, notes: original.notes.map(n => n.id === note.id ? latest : n) });
      else if (!resize) { update({ ...original, notes: original.notes.filter(n => n.id !== note.id) }); setNoteSelected(''); }
    };
    const cancel = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', finish); target.removeEventListener('pointercancel', cancel); setBank(current.current); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', finish); target.addEventListener('pointercancel', cancel);
  }
  const voice = pattern && snapshot?.voices[pattern.id];
  const position = pattern && voice && snapshot ? Math.max(0, snapshot.beat - voice.start) % (pattern.bars * 4) : 0;
  const status = (p: Pattern) => { const v = snapshot?.voices[p.id]; return !v ? 'Stopped' : v.stop !== null ? 'Stopping' : (snapshot?.beat ?? 0) < v.start ? 'Queued' : 'Playing'; };
  const selectedNote = pattern?.notes.find(n => n.id === noteSelected);
  return <section className={expanded ? 'patterns-workspace' : 'patterns-overview'} aria-label="Patterns" hidden={!active}>
    {bank && <PatternCanvas activeDeck={snapshot?.activeDeck ?? 0} deviceNotes={snapshot?.deviceNotes ?? {}} inputs={snapshot?.inputs ?? []} liveRoots={snapshot?.liveRoots ?? {}} bank={bank} outputs={snapshot?.outputs ?? []} instruments={snapshot?.instruments ?? []} deckKeys={snapshot?.deckKeys ?? [null, null]} active={active && !expanded} status={status} canPlay={canPlay} onGraph={editGraph} onCreate={point => add(false, point)} onExpand={id => { setSelected(id); setExpanded(true); }} onPlay={p => void transport(p)} error={setError} />}
    {expanded && <aside className="patterns-sidebar"><div className="patterns-title"><h2>PATTERNS</h2><button onClick={() => add()} disabled={!bank || bank.patterns.length >= 128} aria-label="Create pattern">+ New</button></div><p className="patterns-caption">MELODIC · SCALE RELATIVE</p>
      <div className="patterns-list">{bank?.patterns.map(p => <div key={p.id} className={`pattern-item ${p.id === selected ? 'selected' : ''}`}><button className="pattern-select" onClick={() => { setSelected(p.id); setDeleteId(''); setNoteSelected(''); }}><i className={`pattern-indicator ${status(p).toLowerCase()}`} /><span>{p.name}<small>{p.bars} bars · {keys[p.key]} {scales[p.scale]}</small></span></button><button className="pattern-launch" aria-label={`${snapshot?.voices[p.id] ? 'Stop' : 'Play'} ${p.name}`} title={status(p)} disabled={(saving && !snapshot?.voices[p.id]) || (!snapshot?.voices[p.id] && !canPlay(p))} onClick={() => void transport(p)}>{snapshot?.voices[p.id] ? '■' : '▶'}</button></div>)}</div>
      <p className="patterns-caption">Multiple patterns can play together.<br />Launches follow the master clock.</p>
    </aside>}
    <div className="pattern-editor" hidden={!expanded}>{!bank ? <p className="pattern-empty">Loading patterns…</p> : !pattern ? <div className="pattern-empty"><h2>A melody, in any key.</h2><p>Create a pattern, then click the grid to add scale degrees.</p><button onClick={() => add()}>Create melodic pattern</button></div> : <>
      <div className="pattern-heading"><button aria-label="Collapse pattern editor" title="Return to patching canvas" onClick={() => setExpanded(false)}>↙ Canvas</button><input aria-label="Pattern name" value={pattern.name} maxLength={200} onChange={e => setBank({ ...bank, patterns: bank.patterns.map(p => p.id === pattern.id ? { ...p, name: e.target.value } : p) })} onBlur={e => update({ ...pattern, name: e.target.value.trim() || 'Untitled pattern' })} /><span className={`pattern-status ${status(pattern).toLowerCase()}`}>{status(pattern)}</span><button disabled={(saving && !voice) || (!voice && !canPlay(pattern))} onClick={() => void transport(pattern)}>{voice ? '■ Stop' : '▶ Launch'}</button><button onClick={() => add(true)} disabled={bank.patterns.length >= 128}>Duplicate</button><button onClick={() => setDeleteId(pattern.id)}>Delete</button></div>
      {deleteId === pattern.id && <dialog className="patch-confirmation" ref={confirmation} aria-labelledby="delete-pattern-title" aria-describedby="delete-pattern-description" onCancel={e => { e.preventDefault(); setDeleteId(''); }} onKeyDown={e => e.stopPropagation()}>
        <h2 id="delete-pattern-title">Delete pattern?</h2>
        <p id="delete-pattern-description">Delete “{pattern.name}” and its notes? Its placements and connected cables will also be removed.</p>
        <div><button autoFocus onClick={() => setDeleteId('')}>Cancel</button><button onClick={() => removePattern(pattern.id)}>Delete pattern</button></div>
      </dialog>}
      <div className="pattern-settings">
        <label>Length<select aria-label="Pattern bars" value={pattern.bars} onChange={e => update(fitLength(pattern, +e.target.value))}>{Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1} bars</option>)}</select></label>
        <label>Grid<select aria-label="Pattern grid" value={pattern.grid} onChange={e => update({ ...pattern, grid: +e.target.value })}>{[1, 2, 4, 8].map(n => <option key={n} value={n}>1/{n * 4}</option>)}</select></label>
        <label><input type="checkbox" aria-label="Snap to grid" checked={snapToGrid} onChange={e => setSnapToGrid(e.target.checked)} /> Snap to grid</label>
        <label>Root note<select aria-label="Pattern key" disabled={!!rootLink} value={pattern.key} onChange={e => update({ ...pattern, key: +e.target.value })}>{keys.map((k, i) => <option key={k} value={i}>{k}</option>)}</select></label>
        <label>Scale<select aria-label="Pattern scale" disabled={!!scaleLink} value={pattern.scale} onChange={e => update({ ...pattern, scale: +e.target.value })}>{scales.map((s, i) => <option key={s} value={i}>{s}</option>)}</select></label>
        <label>Octave<select aria-label="Pattern octave" value={pattern.octave} onChange={e => update({ ...pattern, octave: +e.target.value })}>{[2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></label>
        <label>Launch / stop<select aria-label="Pattern launch quantisation" value={pattern.quantum} onChange={e => update({ ...pattern, quantum: +e.target.value })}><option value={1}>Next beat</option><option value={4}>Next bar</option></select></label>
      </div>
      <div ref={rollScroll} className="pattern-roll-scroll"><div className="pattern-roll" style={{ minWidth: Math.max(640, pattern.bars * 160) }}><div className="pattern-ruler"><span>DEGREE</span><div>{Array.from({ length: pattern.bars * 4 }, (_, i) => <span key={i} className={i % 4 === 0 ? 'bar' : ''} style={{ left: `${i / (pattern.bars * 4) * 100}%` }}>{Math.floor(i / 4) + 1}.{i % 4 + 1}</span>)}</div></div>
        <div className="pattern-roll-body"><div className="pattern-pitches">{rows.map(row => { const r = rowDegree(row); const midi = pitch(pattern, r.degree, r.octave); return <div key={row} className={r.degree === 1 ? 'tonic' : ''}><span>{r.degree}<sup>{r.octave > 0 ? `+${r.octave}` : r.octave || ''}</sup></span><small>{midi >= 0 && midi <= 127 ? pitchLabel(midi) : '—'}</small></div>; })}</div>
        <div ref={grid} className="pattern-grid" aria-label="Scale degree note grid" onPointerDown={create} style={{ backgroundSize: `100% 22px, ${100 / (pattern.bars * 4 * pattern.grid)}% 100%` }}>
          {Array.from({ length: pattern.bars * 4 + 1 }, (_, i) => <i key={i} className={`pattern-division ${i % 4 === 0 ? 'bar' : ''}`} style={{ left: `${i / (pattern.bars * 4) * 100}%` }} />)}
          {pattern.notes.map(n => <div key={n.id} role="button" aria-label={`Degree ${n.degree}, ${pitchLabel(pitch(pattern, n.degree, n.octave))}, beat ${n.beat + 1}, duration ${n.duration}`} className={`pattern-note ${n.id === noteSelected ? 'selected' : ''}`} title={`Degree ${n.degree} · ${pitchLabel(pitch(pattern, n.degree, n.octave))} · velocity ${n.velocity}\nClick to delete · drag to move · drag right edge to resize`} style={{ left: `${n.beat / (pattern.bars * 4) * 100}%`, width: `${n.duration / (pattern.bars * 4) * 100}%`, top: (20 - (n.octave * 7 + n.degree - 1)) * 22 + 2 }} onPointerDown={e => drag(e, n, false)}>{n.degree}<span className="pattern-note-end" aria-label="Resize note" onPointerDown={e => drag(e, n, true)} /></div>)}
          {voice && snapshot && snapshot.beat >= voice.start && <div className="pattern-playhead" style={{ left: `${position / (pattern.bars * 4) * 100}%` }} />}
        </div></div></div></div>
      <div className="pattern-footer"><span>Click empty space to add · click a note to delete · drag to move · drag its right edge to resize</span>{selectedNote && <label>Velocity <input type="number" aria-label="Note velocity" min={1} max={127} value={selectedNote.velocity} onChange={e => { const value = +e.target.value; if (value >= 1 && value <= 127) update({ ...pattern, notes: pattern.notes.map(n => n.id === selectedNote.id ? { ...n, velocity: value } : n) }); }} /></label>}<small>{pattern.notes.length} notes · 4/4 · {saving ? 'Saving…' : saveFailed.current ? 'Unsaved changes' : 'Saved'}</small></div>
    </>}</div>{(error || snapshot?.error) && <p className="settings-error" role="alert">{error || snapshot?.error}{saveFailed.current && bank && <button onClick={() => commit(bank)}>Retry save</button>}</p>}{snapshot && !snapshot.clockReady && <p className="patterns-caption">Start the audio engine in Settings to run the master clock.</p>}
  </section>;
}
