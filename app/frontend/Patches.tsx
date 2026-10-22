import { ParameterKnob } from './ParameterKnob';
import { MidiButton } from './MidiMapping';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { patchAudioInputs } from './patchLibrary';
import { type TeiaRecord, type TeiaState } from './teiaModel';
import { usePins, savePins, usePinnedSources, patchPin, instrumentPin } from './pinnedComponents';
import { useInstruments, type Instrument } from './instrumentModel';
type Entry = { slot: number; state: TeiaState };
const patchName = (record: TeiaRecord) => record.document?.name?.trim() || record.name.replace(/\.json$/, '');
const isControl = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('button, input, select, textarea, [role=slider], [contenteditable=true]'));
export { emptyPatch, preparePatchInstance } from './patchLibrary';
export { formatParameterValue as formatPatchValue } from './ParameterKnob';
function InstrumentTiming({ instrument }: { instrument: Instrument }) {
  const [value, setValue] = useState(instrument.advance_ms ?? 0);
  const [error, setError] = useState('');
  const writing = useRef(false);
  const pending = useRef<number | null>(null);
  useEffect(() => { if (!writing.current && pending.current === null) setValue(instrument.advance_ms ?? 0); }, [instrument.advance_ms]);
  async function flush() {
    if (writing.current) return;
    writing.current = true;
    try {
      while (pending.current !== null) {
        const next = pending.current; pending.current = null;
        const items = await invoke<Instrument[]>('get_instruments');
        await invoke('save_instruments', {items:items.map(i => i.id === instrument.id ? {...i,advance_ms:next} : i)});
      }
      setError('');
    } catch (e) { setError(String(e)); }
    finally { writing.current = false; }
  }
  return <><ParameterKnob midiId={`${instrumentPin(instrument.id)}:advance_ms`} label="Timing advance (ms)" ariaLabel={`${instrument.name} timing advance`} min={0} step={1} defaultValue={0} defaultRange={100} value={value} onChange={next => { setValue(next); pending.current = next; void flush(); }} />{error && <span role="alert">{error}</span>}</>;
}
export function Patches() {
  const pins = usePins(), sources = usePinnedSources();
  const instruments = useInstruments();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const pending = useRef(new Map<string, number>());
  const queues = useRef(new Map<number, Promise<unknown>>());
  const dragged = useRef<string | null>(null);
  const allowed = useRef(true);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{id:string;after:boolean} | null>(null);
  const busy = false;
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await invoke<Entry[]>('patches_state'); if (!stopped && Array.isArray(next)) { setEntries(next); setPollError(''); } }
      catch (e) { if (!stopped) setPollError(String(e)); }
      if (!stopped) timer = setTimeout(poll, 300);
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, []);
  const previousNames = useRef(new Map<number, string>());
  useEffect(() => {
    const renames = new Map<string,string>();
    for (const entry of entries) { const name = entry.state.record?.name, old = previousNames.current.get(entry.slot); if (old && name && old !== name) renames.set(patchPin(old), patchPin(name)); }
    previousNames.current = new Map(entries.filter(e => e.state.record).map(e => [e.slot,e.state.record!.name]));
    if (pins.some(id => renames.has(id))) savePins(pins.map(id => renames.get(id) ?? id));
  }, [entries, pins]);
  const control = (entry: Entry, action: string, parameter: string | null, value: number) => {
    const key = `${entry.slot}:${parameter ?? action}`;
    pending.current.set(key, value);
    setEntries(current => [...current]);
    const previous = queues.current.get(entry.slot) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const state = await invoke<TeiaState>('patches_control', { slot: entry.slot, action, parameter, value, generation: entry.state.generation });
      setEntries(current => current.map(e => e.slot === entry.slot ? { ...e, state } : e));
    }).catch(e => { if (!/recovering automatically|Runtime paused/i.test(String(e))) setError(String(e)); }).finally(() => { if (pending.current.get(key) === value) { pending.current.delete(key); setEntries(current => [...current]); } });
    queues.current.set(entry.slot, next);
  };
  const finish = () => { dragged.current = null; setDragging(null); setTarget(null); };
  const rows = new Map<string, {name:string;controls:ReactNode;edit?:()=>void}>(sources);
  for (const instrument of instruments) rows.set(instrumentPin(instrument.id), {name:instrument.name, controls:<InstrumentTiming instrument={instrument} />});
  for (const entry of entries.filter(e => e.state.record)) {
    const record = entry.state.record!;
    const bypass = pending.current.get(`${entry.slot}:bypass`) ?? (record.bypass ? 1 : 0);
    const passthrough = pending.current.get(`${entry.slot}:passthrough`) ?? (record.passthrough ? 1 : 0);
    const hasInputs = patchAudioInputs(record.installed_document ?? record.prepared.document).length > 0;
    rows.set(patchPin(record.name), {name:patchName(record), edit:() => { void invoke('teia_open_editor',{slot:entry.slot}).catch(e => setError(String(e))); }, controls:<>
        <MidiButton midiId={`patch:${record.name}:enabled`} className="patch-toggle" role="switch" aria-checked={!bypass} aria-label={`Enable ${patchName(record)}`} disabled={busy || !entry.state.running || Boolean(passthrough)} onClick={() => control(entry, 'bypass', null, bypass ? 0 : 1)}>{bypass ? 'OFF' : 'ON'}</MidiButton>
        <MidiButton midiId={`patch:${record.name}:bypass`} className="patch-bypass" aria-pressed={Boolean(passthrough)} aria-label={`Bypass ${patchName(record)}`} title={hasInputs ? 'Pass audio inputs directly to the patch destinations; OFF still silences the patch' : 'Bypass requires an audio input'} disabled={busy || !entry.state.running || !hasInputs} onClick={() => control(entry, 'passthrough', null, passthrough ? 0 : 1)}>BYPASS</MidiButton>

        {entry.state.suspended && <span className="patch-recovering" role="status">Recovering audio…</span>}
        {record.prepared.parameters.map(p => <ParameterKnob midiId={`patch:${record.name}:parameter:${p.id}`} key={`${entry.state.generation}:${p.id}`} label={p.name} min={p.min} max={p.max} step={p.integer ? 1 : p.step} defaultValue={p.defaultValue} value={pending.current.get(`${entry.slot}:${p.id}`) ?? entry.state.parameters?.[p.id] ?? record.overrides[p.id] ?? p.defaultValue} disabled={busy || !entry.state.running || Boolean(entry.state.suspended)} onChange={value => control(entry, 'parameter', p.id, value)} />)}

    {entry.state.restoreError && <span role="alert">{entry.state.restoreError}</span>}</>});
  }
  const active = pins.filter(id => rows.has(id));
  if (!active.length) return null;
  return <section className="performance-slots patches-panel" aria-label="Pinned components"><div className="patch-list" role="list" aria-label="Pinned components">{active.map(id => {
    const row = rows.get(id)!;
    return <div key={id} role="listitem" aria-label={row.name} className={`patch-row${dragging === id ? ' patch-dragging' : ''}${target?.id === id ? target.after ? ' drop-after' : ' drop-before' : ''}`} draggable title="Drag to reorder"
      onPointerDownCapture={e => { allowed.current = !isControl(e.target); }}
      onDragStart={e => { if (!allowed.current || isControl(e.target)) { e.preventDefault(); return; } dragged.current = id; setDragging(id); e.dataTransfer.setData('application/x-vira-pinned-component',id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={e => { if (!dragged.current || dragged.current === id) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const rect = e.currentTarget.getBoundingClientRect(); setTarget({id,after:e.clientY >= rect.top+rect.height/2}); }}
      onDrop={e => { const source = dragged.current; if (!source || source === id) return; e.preventDefault(); const next = pins.filter(value => value !== source), rect = e.currentTarget.getBoundingClientRect(); next.splice(next.indexOf(id)+(e.clientY >= rect.top+rect.height/2 ? 1 : 0),0,source); savePins(next); finish(); }} onDragEnd={finish}>
      {row.edit ? <button className="patch-name patch-title" title={`Open ${row.name} editor`} onClick={row.edit}>{row.name}</button> : <strong className="patch-name">{row.name}</strong>}{row.controls}
    </div>;
  })}</div>{(error || pollError) && <p role="alert" className="error">{error || pollError}</p>}</section>;
}
