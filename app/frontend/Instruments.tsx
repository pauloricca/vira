import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceRefresh } from './DeviceRefresh';
import type { Instrument, AudioDevice, AudioPort, MidiPort } from './instrumentModel';
type MidiDevice = { id: number; name: string };
export function Instruments() {
  const [items, setItems] = useState<Instrument[]>([]);
  const [saved, setSaved] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState('');
  const [ready, setReady] = useState(false);
  const [devices, setDevices] = useState<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>({ inputs: [], outputs: [] });
  const [midi, setMidi] = useState<{ inputs: MidiDevice[]; outputs: MidiDevice[] }>({ inputs: [], outputs: [] });
  const [error, setError] = useState('');
  const [scanError, setScanError] = useState('');
  const [busy, setBusy] = useState(false);
  const refreshDevices = useRef<(manual?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    let stopped = false;
    void invoke<Instrument[]>('get_instruments').then(value => { if (!stopped) { setItems(value); setSaved(value); setSelected(value[0]?.id ?? ''); setReady(true); } }).catch(e => { if (!stopped) setError(String(e)); });
    let scanning = false;
    const refresh = async (manual = false) => {
      if (scanning) return;
      scanning = true;
      try {
        const [audio, state] = await Promise.all([invoke<typeof devices>('get_instrument_devices'), invoke<typeof midi>(manual ? 'get_midi_devices' : 'patterns_state')]);
        if (!stopped) { setDevices(audio); setMidi({inputs:state.inputs ?? [], outputs:state.outputs ?? []}); setScanError(''); }
      } catch (e) { if (!stopped) setScanError(String(e)); }
      finally { scanning = false; }
    };
    refreshDevices.current = refresh;
    void refresh(); const timer = setInterval(() => void refresh(), 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
  const item = items.find(i => i.id === selected);
  const dirty = JSON.stringify(items) !== JSON.stringify(saved);
  function update(change: Partial<Instrument>) { setItems(items.map(i => i.id === selected ? {...i, ...change} : i)); }
  function audioField(key: 'audio_input' | 'audio_output', label: string, options: AudioDevice[]) {
    const port = item![key];
    const device = options.find(d => d.id === port?.device);
    const channels = Array.from({length: Math.max(device?.channels ?? 0, ...(port?.channels ?? [0]))}, (_, i) => i + 1);
    const change = (value: AudioPort | null) => update({[key]:value});
    return <section className="settings-card"><h3 className="device-list-heading">{label}<DeviceRefresh label={`Refresh ${label.toLowerCase()} devices`} refresh={() => refreshDevices.current(true)} /></h3><label>Device<select aria-label={`${label} device`} value={port?.device ?? ''} onChange={e => { const d = options.find(d => d.id === e.target.value); change(d ? {device:d.id, channels:d.channels > 1 ? [1,2] : [1]} : null); }}><option value="">None</option>{port && !device && <option value={port.device}>{port.device} · disconnected</option>}{options.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>{port && <><label>Mode<select aria-label={`${label} mode`} value={port.channels.length === 1 ? 'mono' : 'stereo'} onChange={e => change({...port, channels:e.target.value === 'mono' ? [port.channels[0]] : [port.channels[0], channels.find(c => c !== port.channels[0]) ?? 2]})}><option value="mono">Mono</option><option value="stereo" disabled={channels.length < 2}>Stereo</option></select></label>{port.channels.map((channel, index) => <label key={index}>{port.channels.length === 1 ? 'Channel' : index === 0 ? 'Left channel' : 'Right channel'}<select aria-label={`${label} ${port.channels.length === 1 ? 'channel' : index === 0 ? 'left channel' : 'right channel'}`} value={channel} onChange={e => change({...port, channels:port.channels.map((c, i) => i === index ? Number(e.target.value) : c)})}>{channels.map(c => <option key={c} value={c} disabled={port.channels.some((other, i) => i !== index && other === c)}>{c}</option>)}</select></label>)}</>}</section>;
  }
  function midiField(key: 'midi_input' | 'midi_output', label: string, options: MidiDevice[]) {
    const port = item![key];
    const change = (value: MidiPort | null) => update({[key]:value});
    return <section className="settings-card"><h3 className="device-list-heading">{label}<DeviceRefresh label={`Refresh ${label.toLowerCase()} devices`} refresh={() => refreshDevices.current(true)} /></h3><label>Device<select aria-label={`${label} device`} value={port?.device ?? 0} onChange={e => change(Number(e.target.value) ? {device:Number(e.target.value), channel:port?.channel ?? null} : null)}><option value={0}>None</option>{port && !options.some(d => d.id === port.device) && <option value={port.device}>Disconnected device ({port.device})</option>}{options.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>{port && <label>Channel<select aria-label={`${label} channel`} value={port.channel ?? ''} onChange={e => change({...port, channel:e.target.value ? Number(e.target.value) : null})}><option value="">All</option>{Array.from({length:16}, (_, i) => i + 1).map(c => <option key={c} value={c}>{c}</option>)}</select></label>}<p className="settings-hint">{key === 'midi_input' ? 'Receive from this device. All accepts every channel.' : 'Send to this device. All preserves the source channel.'}</p></section>;
  }
  async function save() {
    setBusy(true); setError('');
    try { await invoke('save_instruments', {items}); setSaved(items); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  return <section className="settings-page instruments-page" aria-label="Instruments"><div className="settings-inner"><div className="settings-heading"><h2>Instruments</h2><p>Name a set of audio and MIDI connections, then use it in Routing and Patterns.</p></div><div className="instrument-toolbar"><button disabled={!ready || busy || items.length >= 64} onClick={() => { const instrument: Instrument = {id:crypto.randomUUID(), name:'New instrument', audio_input:null, audio_output:null, midi_input:null, midi_output:null}; setItems([...items, instrument]); setSelected(instrument.id); }}>+ New instrument</button><button disabled={busy || !dirty || items.some(i => !i.name.trim())} onClick={() => void save()}>{busy ? 'Saving…' : 'Save instruments'}</button><button disabled={busy || !dirty} onClick={() => {setItems(saved); setSelected(saved.find(i => i.id === selected)?.id ?? saved[0]?.id ?? ''); setError('');}}>Revert edits</button><span role="status">{dirty ? 'Unsaved changes' : ready ? 'All changes saved' : 'Loading…'}</span></div>{error && <p role="alert" className="settings-error">{error}</p>}{scanError && <p role="alert" className="settings-error">Device scan: {scanError}</p>}<div className="instrument-layout"><aside aria-label="Instrument list">{items.map(i => <button key={i.id} className={selected === i.id ? 'active' : undefined} onClick={() => setSelected(i.id)}>{i.name || 'Unnamed instrument'}</button>)}</aside><fieldset disabled={busy || !ready} className="instrument-editor">{item ? <><div className="instrument-name"><label>Name<input aria-label="Instrument name" maxLength={80} value={item.name} onChange={e => update({name:e.target.value})} /></label><button onClick={() => {const next = items.filter(i => i.id !== item.id); setItems(next); setSelected(next[0]?.id ?? '');}}>Delete instrument</button></div><p className="settings-hint">Audio input receives sound from the instrument. Audio output sends sound to it. Each connection is optional. Mono input is duplicated to left and right; mono output sums stereo at half level.</p><label>Timing advance (ms)<input type="number" aria-label="Instrument timing advance" min={0} step={1} value={item.advance_ms ?? 0} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value >= 0) update({advance_ms:value}); }} /></label><p className="settings-hint">Send feeding patterns early to compensate for this instrument’s latency. Applies through filters and other transformations.</p><div className="settings-grid">{audioField('audio_input', 'Audio input', devices.inputs)}{audioField('audio_output', 'Audio output', devices.outputs)}{midiField('midi_input', 'MIDI input', midi.inputs)}{midiField('midi_output', 'MIDI output', midi.outputs)}</div></> : <p className="empty">Create an instrument to connect your hardware.</p>}</fieldset></div></div></section>;
}
