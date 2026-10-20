import { useMidiControl, MidiButton } from './MidiMapping';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { addSessionPatch, patchAudioInputs } from './patchLibrary';
import { type Parameter, type TeiaRecord, type TeiaState } from './teiaModel';

type Entry = { slot: number; state: TeiaState };
type Library = { files: string[] };
const ORDER_KEY = 'vira.patch-order';
const PATCH_MIME = 'application/x-vira-patch-slot';
const patchName = (record: TeiaRecord) => record.document?.name?.trim() || record.name.replace(/\.json$/, '');
const isControl = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('button, input, select, textarea, [role=slider], [contenteditable=true]'));
function savedOrder(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]'); return Array.isArray(value) ? [...new Set(value.filter((name): name is string => typeof name === 'string'))] : []; }
  catch { return []; }
}
export { emptyPatch, preparePatchInstance } from './patchLibrary';
export function formatPatchValue(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude > 0 && magnitude < .01) return value.toExponential(0);
  const scale = magnitude >= 999500 ? 1e6 : magnitude >= 999.5 ? 1e3 : 1;
  const scaled = value / scale;
  const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return `${Number(scaled.toFixed(scale === 1 ? decimals : Math.min(1, decimals)))}${scale === 1e6 ? 'M' : scale === 1e3 ? 'k' : ''}`;
}
function PatchKnob({ midiId, parameter: p, value, disabled, change }: { midiId: string; parameter: Parameter; value: number; disabled: boolean; change: (value: number) => void }) {
  const drag = useRef<{ pointer: number; y: number; value: number } | null>(null);
  const fraction = p.max === p.min ? 0 : (value - p.min) / (p.max - p.min);
  const angle = fraction * 300;
  const point = (degrees: number) => { const radians = (degrees + 120) * Math.PI / 180; return `${20 + 17 * Math.cos(radians)} ${20 + 17 * Math.sin(radians)}`; };
  const turn = (next: number) => {
    if (disabled) return;
    const step = p.integer ? 1 : p.step;
    const rounded = step ? p.min + Math.round((next - p.min) / step) * step : next;
    change(Math.min(p.max, Math.max(p.min, rounded)));
  };
  const midi = useMidiControl({id:midiId,label:p.name,kind:'number',min:p.min,max:p.max,step:p.integer ? 1 : p.step,disabled,read:() => value,apply:turn});
  return <div className="patch-parameter" title={`${p.name}: ${value}`}>
    <div {...midi} className="mixer-dial patch-knob" role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={p.name} aria-valuemin={p.min} aria-valuemax={p.max} aria-valuenow={value} aria-valuetext={String(value)}
      onPointerDown={e => { if (disabled || e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); drag.current = { pointer: e.pointerId, y: e.clientY, value }; e.currentTarget.setPointerCapture?.(e.pointerId); }}
      onPointerMove={e => { const start = drag.current; if (start?.pointer === e.pointerId) turn(start.value + (start.y - e.clientY) / 140 * (p.max - p.min)); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => turn(p.defaultValue)}
      onKeyDown={e => { if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); turn(e.key === 'Home' ? p.min : e.key === 'End' ? p.max : value + (['ArrowUp', 'ArrowRight'].includes(e.key) ? 1 : -1) * (p.integer ? 1 : p.step ?? (p.max - p.min) / 100)); }}>
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle className="mixer-dial-base" cx="20" cy="20" r="17" />{angle > .1 && <path className="mixer-dial-arc" d={`M${point(0)} A17 17 0 ${angle > 180 ? 1 : 0} 1 ${point(angle)}`} />}<text x="20" y="23" textAnchor="middle">{formatPatchValue(value)}</text></svg>
    </div><span>{p.name}</span>
  </div>;
}
export function Patches() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [order, setOrder] = useState(savedOrder);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ slot: number; after: boolean } | null>(null);
  const dragged = useRef<number | null>(null);
  const dragAllowed = useRef(true);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (removing) confirmation.current?.showModal(); }, [removing]);
  const root = useRef<HTMLElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const addMenu = useRef<HTMLDivElement>(null);
  const pending = useRef(new Map<string, number>());
  const queues = useRef(new Map<number, Promise<unknown>>());
  useEffect(() => {
    const choose = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element) || confirmation.current?.contains(target)) return;
      const row = target.closest<HTMLElement>('[data-patch-name]');
      setSelected(row && root.current?.contains(row) ? row.dataset.patchName ?? null : null);
    };
    document.addEventListener('pointerdown', choose, true); document.addEventListener('click', choose, true);
    return () => { document.removeEventListener('pointerdown', choose, true); document.removeEventListener('click', choose, true); };
  }, []);
  useEffect(() => {
    if (selected && !entries.some(e => e.state.record?.name === selected)) setSelected(null);
  }, [entries, selected]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!selected || busy || removing || menu || event.defaultPrevented || event.repeat || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !['Delete', 'Backspace'].includes(event.key)) return;
      if ((event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable=true]')) || document.querySelector('dialog[open]')) return;
      const entry = entries.find(e => e.state.record?.name === selected);
      if (!entry) return;
      event.preventDefault(); event.stopPropagation();
      if (entry.state.editorOpen) { setError('Close the patch editor before removing it.'); return; }
      if (!entry.state.running) { setError('The audio engine must be running to remove a patch.'); return; }
      setError(''); setRemoving(entry);
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [selected, entries, busy, removing, menu]);
  const saveOrder = (names: string[]) => {
    setOrder(names);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(names)); }
    catch { setError('Patch order changed, but could not be saved for the next launch.'); }
  };
  const previousNames = useRef(new Map<number, string>());
  useEffect(() => {
    const renames = new Map<string, string>();
    for (const entry of entries) {
      const name = entry.state.record?.name;
      const previous = previousNames.current.get(entry.slot);
      if (name && previous && name !== previous) renames.set(previous, name);
    }
    previousNames.current = new Map(entries.filter(e => e.state.record).map(e => [e.slot, e.state.record!.name]));
    if (renames.size) {
      saveOrder(order.map(name => renames.get(name) ?? name));
      setSelected(name => name ? renames.get(name) ?? name : null);
    }
  }, [entries]);

  const refresh = async () => {
    const [library, next] = await Promise.all([invoke<Library>('teia_library'), invoke<Entry[]>('patches_state')]);
    if (!Array.isArray(library?.files) || !Array.isArray(next)) throw new Error('Unable to read patches'); setFiles(library.files); setEntries(next);
  };
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { const [library, next] = await Promise.all([invoke<Library>('teia_library'), invoke<Entry[]>('patches_state')]); if (!stopped) { if (!Array.isArray(library?.files) || !Array.isArray(next)) throw new Error('Unable to read patches'); setFiles(library.files); setEntries(next); setPollError(''); } } catch (e) { if (!stopped) setPollError(String(e)); } if (!stopped) timer = setTimeout(poll, 300); };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: Event) => { const target = e.target as Node; if (!addMenu.current?.contains(target) && !addButton.current?.contains(target)) setMenu(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); e.stopPropagation(); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('click', outside, true); window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('click', outside, true); window.removeEventListener('keydown', escape); };
  }, [menu]);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  const add = async (file?: string) => {
    setMenu(false);
    await run(async () => {
      await addSessionPatch(file);
      await refresh();
    });
  };
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
  const remove = async () => {
    if (!removing) return;
    const entry = removing;
    await run(async () => {
      await queues.current.get(entry.slot);
      await invoke('patches_remove', { slot: entry.slot, generation: entry.state.generation });
      for (const key of pending.current.keys()) if (key.startsWith(`${entry.slot}:`)) pending.current.delete(key);
      queues.current.delete(entry.slot);
      setSelected(null); setRemoving(null);
      saveOrder(order.filter(name => name !== entry.state.record?.name));
      await refresh(); window.dispatchEvent(new Event('patches-changed'));
    });
  };
  const active = entries.filter(e => e.state.record).sort((a, b) => {
    const rank = (entry: Entry) => { const index = order.indexOf(entry.state.record!.name); return index < 0 ? order.length + entry.slot : index; };
    return rank(a) - rank(b);
  });
  const finishDrag = () => { dragged.current = null; setDragging(null); setDropTarget(null); };
  const reorder = (target: number, after: boolean) => {
    const source = active.find(entry => entry.slot === dragged.current);
    if (!source || source.slot === target) return;
    const next = active.filter(entry => entry.slot !== source.slot);
    const index = next.findIndex(entry => entry.slot === target);
    if (index < 0) return;
    next.splice(index + (after ? 1 : 0), 0, source);
    saveOrder(next.map(entry => entry.state.record!.name));
  };
  return <section className="performance-slots patches-panel" aria-label="Patches" ref={root}>
    <div className="toolbar"><h2>Patches</h2><button ref={addButton} disabled={busy || active.length >= 16} aria-haspopup="menu" aria-expanded={menu} onClick={() => { setMenu(!menu); }}>+ Add patch</button></div>
    {menu && <div ref={addMenu} className="patch-menu" role="menu" aria-label="Add patch"><button role="menuitem" onClick={() => void add()}>… New patch</button>{files.map(name => <button role="menuitem" key={name} disabled={active.some(e => e.state.record?.name === name)} onClick={() => void add(name)}>{name.replace(/\.json$/, '')}{active.some(e => e.state.record?.name === name) ? ' · added' : ''}</button>)}</div>}
    <div className="patch-list" role="list" aria-label="Session patches">{active.map(entry => {
      const record = entry.state.record!;
      const bypass = pending.current.get(`${entry.slot}:bypass`) ?? (record.bypass ? 1 : 0);
      const passthrough = pending.current.get(`${entry.slot}:passthrough`) ?? (record.passthrough ? 1 : 0);
      const hasInputs = patchAudioInputs(record.installed_document ?? record.prepared.document).length > 0;
      return <div className={`patch-row${bypass ? ' patch-off' : ''}${selected === record.name ? ' patch-selected' : ''}${dragging === entry.slot ? ' patch-dragging' : ''}${dropTarget?.slot === entry.slot ? dropTarget.after ? ' drop-after' : ' drop-before' : ''}`} key={entry.slot}
        role="listitem" aria-label={patchName(record)} aria-current={selected === record.name ? 'true' : undefined} data-patch-name={record.name} title="Click to select · Double-click to edit · Drag to reorder" tabIndex={-1} draggable={!busy}
        onPointerDownCapture={e => { dragAllowed.current = !isControl(e.target); if (dragAllowed.current && e.button === 0) e.currentTarget.focus({ preventScroll: true }); }}
        onDoubleClick={e => { if (busy || isControl(e.target)) return; setSelected(record.name); void run(async () => { await invoke('teia_open_editor', { slot: entry.slot }); }); }}
        onDragStart={e => {
          if (busy || !dragAllowed.current || isControl(e.target)) { e.preventDefault(); return; }
          dragged.current = entry.slot; setDragging(entry.slot); setSelected(record.name); setMenu(false);
          e.dataTransfer.setData(PATCH_MIME, String(entry.slot)); e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={e => {
          if (busy || dragged.current === null || dragged.current === entry.slot) return;
          e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          const rect = e.currentTarget.getBoundingClientRect();
          setDropTarget({ slot: entry.slot, after: e.clientY >= rect.top + rect.height / 2 });
        }}
        onDrop={e => {
          if (busy || dragged.current === null) return;
          e.preventDefault(); e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          reorder(entry.slot, e.clientY >= rect.top + rect.height / 2); finishDrag();
        }} onDragEnd={finishDrag}>
        <MidiButton midiId={`patch:${record.name}:enabled`} className="patch-toggle" role="switch" aria-checked={!bypass} aria-label={`Enable ${patchName(record)}`} disabled={busy || !entry.state.running || Boolean(passthrough)} onClick={() => control(entry, 'bypass', null, bypass ? 0 : 1)}>{bypass ? 'OFF' : 'ON'}</MidiButton>
        <MidiButton midiId={`patch:${record.name}:bypass`} className="patch-bypass" aria-pressed={Boolean(passthrough)} aria-label={`Bypass ${patchName(record)}`} title={hasInputs ? 'Pass audio inputs directly to the patch destinations; OFF still silences the patch' : 'Bypass requires an audio input'} disabled={busy || !entry.state.running || !hasInputs} onClick={() => control(entry, 'passthrough', null, passthrough ? 0 : 1)}>BYPASS</MidiButton>
        <strong className="patch-name" title={record.name}>{patchName(record)}</strong>
        {entry.state.suspended && <span className="patch-recovering" role="status">Recovering audio…</span>}
        {record.prepared.parameters.map(p => <PatchKnob midiId={`patch:${record.name}:parameter:${p.id}`} key={`${entry.state.generation}:${p.id}`} parameter={p} value={pending.current.get(`${entry.slot}:${p.id}`) ?? entry.state.parameters?.[p.id] ?? record.overrides[p.id] ?? p.defaultValue} disabled={busy || !entry.state.running || Boolean(entry.state.suspended)} change={value => control(entry, 'parameter', p.id, value)} />)}
      </div>;
    })}{!active.length && <div className="slots-empty"><span>PATCHES</span><p>Add a patch to start playing</p></div>}</div>
    {removing && <dialog className="patch-confirmation" ref={confirmation} aria-labelledby="remove-patch-title" onCancel={e => { e.preventDefault(); if (!busy) setRemoving(null); }} onKeyDown={e => e.stopPropagation()}>
      <h2 id="remove-patch-title">Remove patch?</h2>
      <p>Remove “{removing.state.record && patchName(removing.state.record)}” and its routing connections? The saved patch stays in your library.</p>
      <div><button autoFocus disabled={busy} onClick={() => setRemoving(null)}>Cancel</button><button disabled={busy} onClick={() => void remove()}>{busy ? 'Removing…' : 'Remove patch'}</button></div>
      {error && <p className="error" role="alert">{error}</p>}
    </dialog>}
    {pollError && <p className="error" role="alert">{pollError}</p>}
    {error && !removing && <p className="error" role="alert">{error}</p>}
    {entries.some(e => e.state.restoreError) && <p className="error" role="alert">{entries.find(e => e.state.restoreError)?.state.restoreError}</p>}
  </section>;
}
