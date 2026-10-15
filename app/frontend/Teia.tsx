import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { readDocument, type Patch } from '@pauloricca/teia-hosted';
import { gainPatch, prepare, type TeiaState } from './teiaModel';
type Library = { directory: string; files: string[]; state: TeiaState };
export function Teia({ active }: { active: boolean }) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [state, setState] = useState<TeiaState | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work(); } catch (error) { setError(String(error)); } finally { setBusy(false); } };
  const refresh = async () => { const next = await invoke<Library>('teia_library'); setLibrary(next); setState(next.state); setSelected(current => next.files.includes(current) ? current : next.files[0] ?? ''); };
  useEffect(() => {
    if (!active) return;
    void refresh().catch(e => setError(String(e)));
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { const next = await invoke<TeiaState>('teia_state'); if (!stopped) setState(next); } catch (e) { if (!stopped) setError(String(e)); } if (!stopped) timer = setTimeout(poll, 200); };
    timer = setTimeout(poll, 200);
    return () => { stopped = true; clearTimeout(timer); };
  }, [active]);
  const load = async () => { const source = await invoke<{ document: Patch; hash: string }>('teia_read', { name: selected }); const compiled = prepare(source.document); setState(await invoke<TeiaState>('teia_load', { name: selected, savedHash: source.hash, document: compiled.document, prepared: compiled })); };
  const editDraft = async () => {
    const source = await invoke<{hash: string}>('teia_read', {name: selected});
    const dry = prepare({...gainPatch, nodes: gainPatch.nodes.filter(n => n.type !== 'Params'), links: gainPatch.links.filter(l => l.from.node !== 'parameters')});
    setState(await invoke<TeiaState>('teia_load_draft', {name: selected, savedHash: source.hash, document: dry.document, prepared: dry}));
    await invoke('teia_open_editor'); await refresh();
  };
  const control = async (action: string, parameter?: string, value?: number) => { setState(await invoke<TeiaState>('teia_control', { action, parameter: parameter ?? null, value: value ?? null, generation: state?.generation ?? null })); };
  const record = state?.record;
  return <section className="settings-page teia-page" aria-label="Teia patches" hidden={!active} style={!active ? { display: 'none' } : undefined}><div className="settings-inner">
    <div className="settings-heading"><h2>Teia</h2><p>A live stereo effect on master output · headphones keep their existing cue mix.</p></div>
    <div className="settings-card"><h3>Patch library</h3><p className="settings-path">{library?.directory ?? 'Loading patch directory…'}</p>
      <div className="teia-actions"><select aria-label="Teia patch file" value={selected} onChange={e => setSelected(e.target.value)}>{!library?.files.length && <option value="">No patches yet</option>}{library?.files.map(name => <option key={name}>{name}</option>)}</select>
      <button disabled={busy} onClick={() => void run(refresh)}>Refresh patches</button>
      <button disabled={busy || !selected || !state?.running || state.editorOpen} onClick={() => void run(load)}>Load on master</button>
      <button title="Pass master audio through while editing this file; useful for missing media or invalid graphs" disabled={busy || !selected || !state?.running || state.editorOpen} onClick={() => void run(editDraft)}>Edit with dry master</button>
      <button disabled={busy} onClick={() => file.current?.click()}>Import JSON</button>
      <button disabled={busy || library?.files.includes('Stereo gain.json')} onClick={() => void run(async () => { await invoke('teia_import', { name: 'Stereo gain.json', document: prepare(gainPatch).document }); await refresh(); })}>Add stereo gain example</button></div>
      <input ref={file} type="file" accept=".json,application/json" hidden onChange={e => { const imported = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (!imported) return; void run(async () => { if (imported.size > 4 * 1024 * 1024) throw new Error('Patch is too large'); const parsed = readDocument(await imported.text()); if (!parsed.patch || parsed.diagnostics.some(d => d.severity === 'error' || d.code === 'discarded-content')) throw new Error(parsed.diagnostics.map(d => d.message).join('\n')); await invoke('teia_import', { name: imported.name, document: parsed.patch }); await refresh(); }); }} />
    </div>
    {state?.midi && <div className="settings-card"><h3>MIDI routing</h3>{!state.midi.available && <p>MIDI devices are unavailable or initializing.</p>}<p>One input and output for the master patch. Pitch bend uses a 2-semitone range. Device changes reset the DSP and release notes.</p>
      <label>Input<select aria-label="Teia MIDI input" disabled={busy || !state.midi.available} value={state.midi.input} onChange={e => void run(async () => setState(await invoke<TeiaState>('teia_midi_configure', { input: Number(e.target.value), output: state.midi?.output ?? 0 })))}><option value={0}>None</option>{state.midi.inputs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>Output<select aria-label="Teia MIDI output" disabled={busy || !state.midi.available} value={state.midi.output} onChange={e => void run(async () => setState(await invoke<TeiaState>('teia_midi_configure', { input: state.midi?.input ?? 0, output: Number(e.target.value) })))}><option value={0}>None</option>{state.midi.outputs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <p>Input drops {state.midi.inputDrops} · output drops {state.midi.outputDrops} · late inputs {state.midi.lateInputs}</p>
      {state.midi.muted && <p role="alert">MIDI paused after a queue overflow. Use Reset DSP to release notes and resume.</p>}
      {state.midi.error && <p role="alert">{state.midi.error}</p>}
    </div>}
    {record && <div className="settings-card"><h3>{record.name}</h3><p>Master insert {record.bypass ? 'bypassed' : 'active'} · edits apply to this instance; Save updates its file.</p>
      <div className="teia-actions"><button disabled={busy} onClick={() => void run(async () => { await invoke('teia_open_editor'); await refresh(); })}>Open Teia editor</button>
      <button disabled={busy || !state?.running} onClick={() => void run(() => control('bypass', undefined, record.bypass ? 0 : 1))}>{record.bypass ? 'Enable effect' : 'Bypass effect'}</button>
      <button disabled={busy || !state?.running} onClick={() => void run(() => control('reset'))}>Reset DSP</button>
      <button disabled={busy || !state?.running} onClick={() => void run(() => control('clock'))}>{record.clock_running ? 'Stop patch clock' : 'Run patch clock with decks stopped'}</button>
      <button disabled={busy || state?.editorOpen || !state?.running} onClick={() => void run(() => control('remove'))}>Remove effect</button></div>
      {record.prepared.parameters.map(p => <label className="teia-parameter" key={`${state.generation}:${p.id}`}><span>{p.name}</span><input aria-label={`Teia ${p.name}`} type="range" min={p.min} max={p.max} step={p.integer ? 1 : p.step ?? 'any'} value={state?.parameters?.[p.id] ?? record.overrides[p.id] ?? p.defaultValue} disabled={busy || !state?.running} onChange={e => { const value = Number(e.target.value); setState(current => current?.record ? { ...current, parameters: { ...current.parameters, [p.id]: value }, record: { ...current.record, overrides: { ...current.record.overrides, [p.id]: value } } } : current); void control('parameter', p.id, value).catch(e => setError(String(e))); }} /><output>{(state?.parameters?.[p.id] ?? record.overrides[p.id] ?? p.defaultValue).toFixed(2)}</output></label>)}
      <p>Peak {state?.peak.toFixed(3)} · runtime faults {state?.renderFailures} · repeat budget exhaustion {state?.repeatExhaustions ?? 0} · {state?.suspended ? 'runtime paused · dry master until Reset DSP' : state?.running ? 'native producer running' : 'native producer unavailable'}</p>
    </div>}
    <p className="teia-profile">Stereo audio, exposed parameters, oscillators, filters, envelopes and effects use Teia’s shared native runtime. Custom waves, sequencers, media, Buffers and bounded repeats are enabled. Nested repeats use up to 16 items per template, reduced to fit 1024 total pool slots within 64 MiB. Buffer capture, Button/Keys gestures, meters and scopes are enabled. Buffered effects/Buffer inside repeats await deadline validation; FFT remains unavailable.</p>
    {(error || state?.restoreError) && <p className="error" role="alert">{error || state?.restoreError}</p>}
  </div></section>;
}
