import { useMidiTargets, useMidiMarkers, type MidiTarget } from './MidiMapping';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { fitSteps, patternBeats, patternSteps, patternLengthLabel, keys, newPattern, pitch, pitchLabel, scales, snap, uid, type Bank, type Pattern, type PatternNote, type PercussionRow } from './patternModel';
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
  const [rowEdit, setRowEdit] = useState<PercussionRow | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const rollScroll = useRef<HTMLDivElement>(null);
  useEffect(() => { if (rollScroll.current) rollScroll.current.scrollTop = current.current?.patterns.find(p => p.id === selected)?.kind !== 'melodic' ? 0 : 220; }, [selected, expanded]);
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
  function editGraph(graph: MusicalGraph) { if (current.current) commit({ ...current.current, patterns: current.current.patterns.map(p => ({...p, name: graph.nodes.find(n => n.pattern === p.id)?.label ?? p.name})), graph }); }
  function removePattern(id: string) { if (!bank) return; const nodes = bank.graph!.nodes.filter(n => n.pattern !== id); commit({ ...bank, patterns: bank.patterns.filter(p => p.id !== id), graph: { nodes, wires: bank.graph!.wires.filter(w => nodes.some(n => n.id === w.from) && nodes.some(n => n.id === w.to)) } }); setSelected(bank.patterns.find(p => p.id !== id)?.id ?? ''); setDeleteId(''); if (bank.patterns.length === 1) setExpanded(false); }
  function canPlay(p: Pattern) { const node = bank?.graph?.nodes.find(n => n.pattern === p.id); return !!snapshot?.clockReady && !!node && (p.kind !== 'cue' || !!bank?.graph?.wires.some(w => w.from === node.id && w.kind === 'cue')); }
  function add(duplicate = false, point?: {x:number;y:number}, kind: Pattern['kind'] = 'melodic') {
    if (!bank || bank.patterns.length >= 128) return;
    setRowEdit(null);
    const p = duplicate && pattern ? { ...pattern, id: uid(), name: `${pattern.name} copy`, notes: pattern.notes.map(n => ({ ...n, id: uid() })) } : newPattern(kind);
    const node = { id: uid(), kind: 'pattern' as const, label: p.name, x: 430 + Math.floor(bank.patterns.length / 4) * 230 % 1000, y: 70 + bank.patterns.length % 4 * 200, pattern: p.id, ...point };
    commit({ ...bank, patterns: [...bank.patterns, p], graph: { ...bank.graph!, nodes: [...bank.graph!.nodes, node] } }); setSelected(p.id); setDeleteId('');
  }
  function addRow() {
    if (!pattern || (pattern.rows?.length ?? 0) >= 128) return;
    const row = { id: uid(), name: `Row ${(pattern.rows?.length ?? 0) + 1}`, note: 36, channel: null };
    update({ ...pattern, rows: [...(pattern.rows ?? []), row] }); setRowEdit(row);
  }
  async function transport(p: Pattern) {
    const play = !snapshot?.voices[p.id];
    if (play) { await queue.current; if (saveFailed.current) return; }
    try { await invoke('patterns_transport', { id: p.id, play }); const s = await invoke<Snapshot>('patterns_state'); setSnapshot(s); } catch (e) { setError(String(e)); }
  }
  function point(event: { clientX: number; clientY: number }, p: Pattern) {
    const rect = grid.current!.getBoundingClientRect();
    return { beat: Math.max(0, Math.min(Math.max(0, (Math.ceil(patternBeats(p) * p.grid) - 1) / p.grid), Math.floor((event.clientX - rect.left) / rect.width * patternBeats(p) * p.grid) / p.grid)), row: (p.kind === 'cue' ? [0,1,2,3] : p.kind === 'percussion' ? (p.rows ?? []).map((_, i) => i) : rows)[Math.max(0, Math.min((p.kind === 'cue' ? 4 : p.kind === 'percussion' ? p.rows?.length ?? 0 : rows.length) - 1, Math.floor((event.clientY - rect.top) / 22)))] };
  }
  function create(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pattern || event.button !== 0 || event.target !== event.currentTarget) return;
    if (pattern.kind === 'percussion' && !pattern.rows?.length) return;
    const { beat, row } = point(event, pattern); const relative = pattern.kind === 'cue' ? {degree:row + 1,octave:0} : pattern.kind === 'percussion' ? { degree: 1, octave: 0, row: pattern.rows![row].id } : rowDegree(row);
    if (pattern.kind === 'melodic' && (pitch(pattern, relative.degree, relative.octave) < 0 || pitch(pattern, relative.degree, relative.octave) > 127)) return;
    const note = { id: uid(), beat, duration: Math.min(1 / pattern.grid, patternBeats(pattern) - beat), ...relative, velocity: 100 };
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
      const rect = grid.current!.getBoundingClientRect(); const quantise = (value: number) => snapToGrid ? snap(value, original.grid) : value; const delta = quantise((e.clientX - origin.x) / rect.width * patternBeats(original));
      if (resize) latest = { ...note, duration: Math.min(patternBeats(original) - note.beat, Math.max(snapToGrid ? 1 / original.grid : 0.03125, quantise(note.duration + delta))) };
      else {
        const row = original.kind === 'cue' ? Math.max(0, Math.min(3, note.degree - 1 + Math.round((e.clientY - origin.y) / 22))) : pattern.kind === 'percussion' ? Math.max(0, Math.min((original.rows?.length ?? 1) - 1, (original.rows ?? []).findIndex(r => r.id === note.row) + Math.round((e.clientY - origin.y) / 22))) : Math.max(-14, Math.min(20, (note.octave * 7 + note.degree - 1) - Math.round((e.clientY - origin.y) / 22)));
        const rel = original.kind === 'cue' ? {degree:row + 1,octave:0} : original.kind === 'percussion' ? { row: original.rows![row].id } : rowDegree(row);
        latest = { ...note, beat: Math.max(0, Math.min(patternBeats(original) - note.duration, quantise(note.beat + delta))), ...rel };
        if (original.kind === 'melodic' && (pitch(original, latest.degree, latest.octave) < 0 || pitch(original, latest.degree, latest.octave) > 127)) return;
      }
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
  const position = pattern && voice && snapshot ? Math.max(0, snapshot.beat - voice.start) % (patternBeats(pattern)) : 0;
  const status = (p: Pattern) => { const v = snapshot?.voices[p.id]; return !v ? 'Stopped' : v.stop !== null ? 'Stopping' : (snapshot?.beat ?? 0) < v.start ? 'Queued' : 'Playing'; };
  const selectedNote = pattern?.notes.find(n => n.id === noteSelected);
  const midi = useMidiMarkers();
  useMidiTargets((bank?.patterns ?? []).flatMap(p => {
    const fields = [
      ['steps','Length (steps)',1,65536], ['key','Root note',0,11], ['scale','Scale',0,scales.length-1], ['octave','Octave',2,5], ['quantum','Launch / stop',1,4], ['stepDivision','Step size',0,3], ['grid','Grid',0,3], ['phraseSync','Clock alignment',0,1],
    ] as const;
    return [
      ...fields.map(([field,label,min,max]): MidiTarget => ({id:`pattern:${p.id}:${field}`,label:`${p.name} · ${label}`,kind:'number',min,max,step:1,
        read:() => field === 'steps' ? patternSteps(p) : field === 'stepDivision' ? [1,2,4,8].indexOf(p.stepDivision ?? 4) : field === 'grid' ? [1,2,4,8].indexOf(p.grid) : field === 'phraseSync' ? Number(p.phraseSync !== false) : p[field],
        disabled: p.kind !== 'melodic' && ['key', 'scale', 'octave'].includes(field) || (field === 'key' || field === 'scale') && !!linkedHarmony(bank!,p.id,snapshot?.deckKeys ?? [null,null],field === 'key' ? 'root':'scale',snapshot?.liveRoots,snapshot?.activeDeck ?? 0),
        apply:value => {
          const b = current.current, latest = b?.patterns.find(old => old.id === p.id); if (!b || !latest) return;
          const next = field === 'steps' ? fitSteps(latest,value) : field === 'stepDivision' ? fitSteps(latest,patternSteps(latest),[1,2,4,8][value]) : {...latest,[field]:field === 'quantum' ? value < 3 ? 1 : 4 : field === 'grid' ? [1,2,4,8][value] : field === 'phraseSync' ? !!value : value};
          commit({...b,patterns:b.patterns.map(old => old.id === p.id ? next : old)});
        }})),
      ...p.notes.map(note => ({id:`pattern:${p.id}:note:${note.id}:velocity`,label:`${p.name} · Note ${note.degree} velocity`,kind:'number' as const,min:1,max:127,step:1,read:() => note.velocity,apply:(value:number) => { const b = current.current; if (b) commit({...b,patterns:b.patterns.map(old => old.id === p.id ? {...old,notes:old.notes.map(n => n.id === note.id ? {...n,velocity:value} : n)} : old)}); }})),
      {id:`pattern:${p.id}:transport`,label:`${p.name} · Launch / stop`,kind:'action' as const,disabled:!snapshot?.voices[p.id] && !canPlay(p),apply:() => { void transport(p); }},
    ];
  }));
  return <section className={expanded ? 'patterns-workspace' : 'patterns-overview'} aria-label="Patterns" hidden={!active}>
    {bank && <PatternCanvas activeDeck={snapshot?.activeDeck ?? 0} deviceNotes={snapshot?.deviceNotes ?? {}} inputs={snapshot?.inputs ?? []} liveRoots={snapshot?.liveRoots ?? {}} bank={bank} outputs={snapshot?.outputs ?? []} instruments={snapshot?.instruments ?? []} deckKeys={snapshot?.deckKeys ?? [null, null]} active={active && !expanded} status={status} canPlay={canPlay} onGraph={editGraph} onCreate={(point, kind) => add(false, point, kind)} onExpand={id => { setSelected(id); setRowEdit(null); setExpanded(true); }} onPlay={p => void transport(p)} error={setError} />}
    {expanded && <aside className="patterns-sidebar"><div className="patterns-title"><h2>PATTERNS</h2></div><div className="pattern-create"><button onClick={() => add()} disabled={!bank || bank.patterns.length >= 128}>+ Melodic pattern</button><button onClick={() => add(false, undefined, 'percussion')} disabled={!bank || bank.patterns.length >= 128}>+ Percussion pattern</button><button onClick={() => add(false, undefined, 'cue')} disabled={!bank || bank.patterns.length >= 128}>+ Cue point pattern</button></div><p className="patterns-caption">MELODIC · PERCUSSION · CUE POINTS</p>
      <div className="patterns-list">{bank?.patterns.map(p => <div key={p.id} className={`pattern-item ${p.id === selected ? 'selected' : ''}`}><button className="pattern-select" onClick={() => { setSelected(p.id); setDeleteId(''); setNoteSelected(''); setRowEdit(null); }}><i className={`pattern-indicator ${status(p).toLowerCase()}`} /><span>{p.name}<small>{patternLengthLabel(p)} · {p.kind === 'cue' ? 'Cue points · A–D' : p.kind === 'percussion' ? `Percussion · ${p.rows?.length ?? 0} rows` : `${keys[p.key]} ${scales[p.scale]}`}</small></span></button><button {...midi(`pattern:${p.id}:transport`)} className="pattern-launch" aria-label={`${snapshot?.voices[p.id] ? 'Stop' : 'Play'} ${p.name}`} title={status(p)} disabled={(saving && !snapshot?.voices[p.id]) || (!snapshot?.voices[p.id] && !canPlay(p))} onClick={() => void transport(p)}>{snapshot?.voices[p.id] ? '■' : '▶'}</button></div>)}</div>
      <p className="patterns-caption">Multiple patterns can play together.<br />All patterns follow the master tempo.</p>
    </aside>}
    <div className="pattern-editor" hidden={!expanded}>{!bank ? <p className="pattern-empty">Loading patterns…</p> : !pattern ? <div className="pattern-empty"><h2>Start a pattern.</h2><p>Create a melodic pattern with scale degrees, or a percussion pattern with custom rows.</p><button onClick={() => add()}>Create melodic pattern</button><button onClick={() => add(false, undefined, 'percussion')}>Create percussion pattern</button><button onClick={() => add(false, undefined, 'cue')}>Create cue point pattern</button></div> : <>
      <div className="pattern-heading"><button aria-label="Collapse pattern editor" title="Return to patching canvas" onClick={() => setExpanded(false)}>↙ Canvas</button><input aria-label="Pattern name" value={pattern.name} maxLength={200} onChange={e => setBank({ ...bank, patterns: bank.patterns.map(p => p.id === pattern.id ? { ...p, name: e.target.value } : p) })} onBlur={e => update({ ...pattern, name: e.target.value.trim() || 'Untitled pattern' })} /><span className={`pattern-status ${status(pattern).toLowerCase()}`}>{status(pattern)}</span><button {...midi(`pattern:${pattern.id}:transport`)} disabled={(saving && !voice) || (!voice && !canPlay(pattern))} onClick={() => void transport(pattern)}>{voice ? '■ Stop' : '▶ Launch'}</button><button onClick={() => add(true)} disabled={bank.patterns.length >= 128}>Duplicate</button><button onClick={() => setDeleteId(pattern.id)}>Delete</button></div>
      {deleteId === pattern.id && <dialog className="patch-confirmation" ref={confirmation} aria-labelledby="delete-pattern-title" aria-describedby="delete-pattern-description" onCancel={e => { e.preventDefault(); setDeleteId(''); }} onKeyDown={e => e.stopPropagation()}>
        <h2 id="delete-pattern-title">Delete pattern?</h2>
        <p id="delete-pattern-description">Delete “{pattern.name}” and its notes? Its placements and connected cables will also be removed.</p>
        <div><button autoFocus onClick={() => setDeleteId('')}>Cancel</button><button onClick={() => removePattern(pattern.id)}>Delete pattern</button></div>
      </dialog>}
      <div className="pattern-settings">
        <label>Length (steps)<input type="number" {...midi(`pattern:${pattern.id}:steps`)} aria-label="Pattern steps" min={1} max={65536} step={1} key={`${pattern.id}-${patternSteps(pattern)}`} defaultValue={patternSteps(pattern)} onBlur={e => { const steps = +e.target.value; if (Number.isInteger(steps) && steps >= 1 && steps <= 65536) update(fitSteps(pattern, steps)); else e.target.value = String(patternSteps(pattern)); }} /></label>
        <label>Step size<select {...midi(`pattern:${pattern.id}:stepDivision`)} aria-label="Pattern step size" value={pattern.stepDivision ?? 4} onChange={e => update(fitSteps(pattern, patternSteps(pattern), +e.target.value))}>{[1, 2, 4, 8].map(n => <option key={n} value={n}>1/{n * 4}</option>)}</select></label>
        <label>Clock alignment<select {...midi(`pattern:${pattern.id}:phraseSync`)} aria-label="Pattern clock alignment" value={pattern.phraseSync === false ? 'tempo' : 'phrase'} onChange={e => update({ ...pattern, phraseSync: e.target.value === 'phrase' })}><option value="phrase">Master beat / bar</option><option value="tempo">Tempo only · independent phase</option></select></label>
        <label>Grid<select {...midi(`pattern:${pattern.id}:grid`)} aria-label="Pattern grid" value={pattern.grid} onChange={e => update({ ...pattern, grid: +e.target.value })}>{[1, 2, 4, 8].map(n => <option key={n} value={n}>1/{n * 4}</option>)}</select></label>
        <label><input type="checkbox" aria-label="Snap to grid" checked={snapToGrid} onChange={e => setSnapToGrid(e.target.checked)} /> Snap to grid</label>
        {pattern.kind === 'melodic' && <><label>Root note<select {...midi(`pattern:${pattern.id}:key`)} aria-label="Pattern key" disabled={!!rootLink} value={pattern.key} onChange={e => update({ ...pattern, key: +e.target.value })}>{keys.map((k, i) => <option key={k} value={i}>{k}</option>)}</select></label>
        <label>Scale<select {...midi(`pattern:${pattern.id}:scale`)} aria-label="Pattern scale" disabled={!!scaleLink} value={pattern.scale} onChange={e => update({ ...pattern, scale: +e.target.value })}>{scales.map((s, i) => <option key={s} value={i}>{s}</option>)}</select></label>
        <label>Octave<select {...midi(`pattern:${pattern.id}:octave`)} aria-label="Pattern octave" value={pattern.octave} onChange={e => update({ ...pattern, octave: +e.target.value })}>{[2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select></label>
        </>}<label>Launch / stop<select {...midi(`pattern:${pattern.id}:quantum`)} aria-label="Pattern launch quantisation" disabled={pattern.phraseSync === false} value={pattern.quantum} onChange={e => update({ ...pattern, quantum: +e.target.value })}><option value={1}>Next beat</option><option value={4}>Next bar</option></select></label>
        <small>{pattern.phraseSync === false ? 'Tempo only: launch and stop immediately; the loop keeps its own phase.' : 'Launch and stop on the selected master boundary; each loop repeats at its own length.'}</small>
      </div>
      {pattern.kind === 'percussion' && <div className="percussion-toolbar"><button onClick={addRow} disabled={(pattern.rows?.length ?? 0) >= 128}>+ Add row</button><small>{pattern.rows?.length ? 'Click a row header to configure its name, note and channel.' : 'No rows yet. Add a row to start your percussion pattern.'}</small></div>}
      {pattern.kind === 'percussion' && rowEdit && <form className="percussion-row-editor" aria-label="Configure percussion row" onSubmit={e => { e.preventDefault(); if (!rowEdit.name.trim()) return; update({ ...pattern, rows: (pattern.rows ?? []).map(r => r.id === rowEdit.id ? { ...rowEdit, name: rowEdit.name.trim() } : r) }); setRowEdit(null); }}>
        <label>Name<input autoFocus aria-label="Row name" required maxLength={200} value={rowEdit.name} onChange={e => setRowEdit({ ...rowEdit, name: e.target.value })} /></label>
        <label>Note<select aria-label="Row note" value={rowEdit.note} onChange={e => setRowEdit({ ...rowEdit, note: +e.target.value })}>{Array.from({length:128}, (_, note) => <option key={note} value={note}>{pitchLabel(note)} · {note}</option>)}</select></label>
        <label>Channel (optional)<select aria-label="Row channel" value={rowEdit.channel ?? ''} onChange={e => setRowEdit({ ...rowEdit, channel: e.target.value === '' ? null : +e.target.value })}><option value="">Use routed channel</option>{Array.from({length:16}, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>
        <button type="submit">Save row</button><button type="button" onClick={() => setRowEdit(null)}>Cancel</button><button type="button" onClick={() => { update({...pattern, rows:pattern.rows?.filter(r => r.id !== rowEdit.id), notes:pattern.notes.filter(n => n.row !== rowEdit.id)}); setRowEdit(null); }}>Delete row</button>
      </form>}
      {pattern.kind === 'cue' && <p className="cue-pattern-help">Connect cue gates to a deck’s cue trigger input. Each note holds its cue for its duration; resize to play more or less of the track. Empty cues are skipped.</p>}
      <div ref={rollScroll} className="pattern-roll-scroll"><div className={`pattern-roll ${pattern.kind === 'percussion' ? 'percussion-roll' : pattern.kind === 'cue' ? 'cue-roll' : ''}`} style={{ minWidth: Math.max(640, patternBeats(pattern) * 40) }}><div className="pattern-ruler"><span>{pattern.kind === 'cue' ? 'CUE POINT' : pattern.kind === 'percussion' ? 'PERCUSSION' : 'DEGREE'}</span><div>{Array.from({ length: Math.ceil(patternBeats(pattern)) }, (_, i) => <span key={i} className={i % 4 === 0 ? 'bar' : ''} style={{ left: `${i / (patternBeats(pattern)) * 100}%` }}>{Math.floor(i / 4) + 1}.{i % 4 + 1}</span>)}</div></div>
        <div className="pattern-roll-body"><div className="pattern-pitches">{pattern.kind === 'cue' ? ['A','B','C','D'].map((label, slot) => <div key={label} className={`cue-row hot-cue-${slot}`}><span>{label}</span><small>Cue {label}</small></div>) : pattern.kind === 'percussion' ? (pattern.rows ?? []).map(r => <button key={r.id} className="percussion-row-header" aria-label={`Configure ${r.name}`} title={`${r.name} · ${pitchLabel(r.note)} (${r.note}) · ${r.channel ? `CH ${r.channel}` : 'Use routed channel'}`} onClick={() => setRowEdit({...r})}><span>{r.name}</span><small>{pitchLabel(r.note)}{r.channel ? ` · ${r.channel}` : ''}</small></button>) : rows.map(row => { const r = rowDegree(row); const midi = pitch(pattern, r.degree, r.octave); return <div key={row} className={r.degree === 1 ? 'tonic' : ''}><span>{r.degree}<sup>{r.octave > 0 ? `+${r.octave}` : r.octave || ''}</sup></span><small>{midi >= 0 && midi <= 127 ? pitchLabel(midi) : '—'}</small></div>; })}</div>
        <div ref={grid} className="pattern-grid" aria-label={pattern.kind === 'cue' ? 'Cue point gate grid' : pattern.kind === 'percussion' ? 'Percussion note grid' : 'Scale degree note grid'} onPointerDown={create} style={{ height: pattern.kind === 'cue' ? 88 : pattern.kind === 'percussion' ? (pattern.rows?.length ?? 0) * 22 : 770, backgroundSize: `100% 22px, ${100 / (patternBeats(pattern) * pattern.grid)}% 100%` }}>
          {Array.from({ length: Math.ceil(patternBeats(pattern)) }, (_, i) => <i key={i} className={`pattern-division ${i % 4 === 0 ? 'bar' : ''}`} style={{ left: `${i / (patternBeats(pattern)) * 100}%` }} />)}
          {pattern.notes.map(n => <div key={n.id} role="button" aria-label={`${pattern.kind === 'cue' ? `Cue ${'ABCD'[n.degree - 1]}` : pattern.kind === 'percussion' ? pattern.rows?.find(r => r.id === n.row)?.name : `Degree ${n.degree}`}, ${pattern.kind === 'cue' ? 'gate' : pitchLabel(pattern.kind === 'percussion' ? pattern.rows?.find(r => r.id === n.row)?.note ?? 0 : pitch(pattern, n.degree, n.octave))}, beat ${n.beat + 1}, duration ${n.duration}`} className={`pattern-note ${pattern.kind === 'cue' ? `cue-note hot-cue-${n.degree - 1}` : ''} ${n.id === noteSelected ? 'selected' : ''}`} title={`${pattern.kind === 'cue' ? `Cue ${'ABCD'[n.degree - 1]}` : pattern.kind === 'percussion' ? pattern.rows?.find(r => r.id === n.row)?.name : `Degree ${n.degree}`} · ${pattern.kind === 'cue' ? 'gate' : pitchLabel(pattern.kind === 'percussion' ? pattern.rows?.find(r => r.id === n.row)?.note ?? 0 : pitch(pattern, n.degree, n.octave))} · velocity ${n.velocity}\nClick to delete · drag to move · drag right edge to resize`} style={{ left: `${n.beat / (patternBeats(pattern)) * 100}%`, width: `${n.duration / (patternBeats(pattern)) * 100}%`, top: (pattern.kind === 'cue' ? n.degree - 1 : pattern.kind === 'percussion' ? (pattern.rows ?? []).findIndex(r => r.id === n.row) : 20 - (n.octave * 7 + n.degree - 1)) * 22 + 2 }} onPointerDown={e => drag(e, n, false)}>{pattern.kind === 'cue' ? 'ABCD'[n.degree - 1] : pattern.kind === 'percussion' ? '●' : n.degree}<span className="pattern-note-end" aria-label="Resize note" onPointerDown={e => drag(e, n, true)} /></div>)}
          {voice && snapshot && snapshot.beat >= voice.start && <div className="pattern-playhead" style={{ left: `${position / (patternBeats(pattern)) * 100}%` }} />}
        </div></div></div></div>
      <div className="pattern-footer"><span>Click empty space to add · click a note to delete · drag to move · drag its right edge to resize</span>{selectedNote && <label>Velocity <input type="number" {...midi(`pattern:${pattern.id}:note:${selectedNote.id}:velocity`)} aria-label="Note velocity" min={1} max={127} value={selectedNote.velocity} onChange={e => { const value = +e.target.value; if (value >= 1 && value <= 127) update({ ...pattern, notes: pattern.notes.map(n => n.id === selectedNote.id ? { ...n, velocity: value } : n) }); }} /></label>}<small>{pattern.notes.length} notes · {patternLengthLabel(pattern)} · {saving ? 'Saving…' : saveFailed.current ? 'Unsaved changes' : 'Saved'}</small></div>
    </>}</div>{(error || snapshot?.error) && <p className="settings-error" role="alert">{error || snapshot?.error}{saveFailed.current && bank && <button onClick={() => commit(bank)}>Retry save</button>}</p>}{snapshot && !snapshot.clockReady && <p className="patterns-caption">Start the audio engine in Settings to run the master clock.</p>}
  </section>;
}
