import { SettingsCard } from './SettingsSearch';
import { useEffect, useRef, useState } from 'react';
import { DeviceRefresh } from './DeviceRefresh';
import { invoke } from '@tauri-apps/api/core';
import type { AudioState } from './Decks';

type Device = { id: string; name: string; supported: boolean; sample_rate?: number; rate_ranges?: [number, number, number][] };
type Inventory = { sample_rate?: number; devices: Device[]; default_device: string | null; routes: { master: string | null; cue: string | null } };

export function Audio({ audio }: { audio: AudioState }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [master, setMaster] = useState('');
  const [cue, setCue] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshDevices = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let initial = true;
    let scanning = false;
    async function refresh() {
      if (scanning) return;
      scanning = true;
      clearTimeout(timer);
      try {
        const value = await invoke<Inventory>('get_audio_devices');
        if (!cancelled) {
          setInventory(value);
          if (initial) { setMaster(value.routes.master ?? ''); setCue(value.routes.cue ?? ''); initial = false; }
          setScanError(null);
        }
      } catch (e) { if (!cancelled) setScanError(String(e)); }
      scanning = false;
      if (!cancelled) timer = setTimeout(() => void refresh(), 2000);
    }
    refreshDevices.current = refresh;
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  const sameDevice = !!cue && cue === (master || inventory?.default_device);
  const missing = (id: string) => !!id && !inventory?.devices.some(device => device.id === id);
  const unsupported = (id: string) => inventory?.devices.some(device => device.id === id && !device.supported);
  const routesChanged = !!inventory && (master !== (inventory.routes.master ?? '') || cue !== (inventory.routes.cue ?? ''));
  const masterDevice = inventory?.devices.find(device => device.id === (master || inventory.default_device));
  const selectedRate = masterDevice?.sample_rate ?? audio.telemetry.sample_rate ?? 48000;
  const restarting = selectedRate !== (audio.telemetry.sample_rate ?? inventory?.sample_rate ?? 48000);
  const changed = routesChanged || restarting;
  const cueCompatible = (device: Device) => !device.rate_ranges || device.rate_ranges.some(([channels, low, high]) => channels >= 2 && low <= selectedRate && selectedRate <= high);
  const cueMismatch = !!cue && !!inventory?.devices.some(device => device.id === cue && !cueCompatible(device));
  async function apply() {
    setBusy(true); setError(null);
    try {
      await invoke('set_audio_devices', { master: master || null, cue: cue || null });
      setInventory(previous => previous && { ...previous, routes: { master: master || null, cue: cue || null } });
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  function options(selected: string, headphones = false) {
    return <>{missing(selected) && <option value={selected}>{selected} · disconnected</option>}{inventory?.devices.map(device => <option key={device.id} value={device.id} disabled={!device.supported || (headphones && !cueCompatible(device))}>{device.name}{!device.supported ? ' · unsupported output format' : headphones && !cueCompatible(device) ? ` · unavailable at ${selectedRate / 1000} kHz` : device.sample_rate ? ` · ${(headphones ? selectedRate : device.sample_rate) / 1000} kHz` : ''}</option>)}</>;
  }
  return <>
      <SettingsCard className="settings-card"><h3 className="device-list-heading">Output devices<DeviceRefresh label="Refresh audio devices" refresh={() => refreshDevices.current()} /></h3>
        <div className="settings-row"><div><strong>Master out</strong><p>The mix after channel faders and crossfader.{!master && inventory?.default_device && <> System default: {inventory.default_device}.</>}</p></div><select aria-label="Master out device" value={master} disabled={!inventory || busy} onChange={event => setMaster(event.target.value)}><option value="">System default</option>{options(master)}</select></div>
        <div className="settings-row"><div><strong>Cue headphones</strong><p>Before channel faders and crossfader; follows trim, EQ and filter.</p></div><select aria-label="Cue headphones device" value={cue} disabled={!inventory || busy} onChange={event => setCue(event.target.value)}><option value="">Off</option>{options(cue, true)}</select></div>
        <div className="audio-actions"><p className="audio-help">Select A, B or both with the headphone buttons above the channel faders. Use separate output devices.</p>
        {sameDevice && <p className="settings-error" role="alert">Choose different devices for master out and cue headphones.</p>}
        {cueMismatch && <p className="settings-error" role="alert">Cue headphones must support the master output rate ({selectedRate / 1000} kHz).</p>}
        {restarting && <p className="audio-help">Changing to {selectedRate / 1000} kHz restarts VIRA and clears the decks. Save any grid or patch edits first. Tracks will use a cache prepared at the new rate.</p>}
        {(error || scanError) && <p className="settings-error" role="alert">{error || scanError}</p>}
        <button disabled={!changed || busy || sameDevice || cueMismatch || missing(master) || missing(cue) || unsupported(master) || unsupported(cue)} onClick={() => void apply()}>{busy ? 'Applying…' : restarting ? 'Apply outputs & restart VIRA' : 'Apply outputs'}</button></div>
      </SettingsCard>
      <SettingsCard className="settings-card"><h3>Output status</h3>
        <div className="settings-row"><span>Master out</span><output className={audio.running ? 'settings-live' : undefined}>{audio.running ? 'Running' : 'Unavailable'}</output></div>
        <div className="settings-row"><span>Cue headphones</span><output className={audio.routing?.cue_running ? 'settings-live' : undefined}>{audio.routing?.cue_running ? 'Running' : audio.routing?.cue ? 'Unavailable' : 'Off'}</output></div>
        <div className="settings-row"><span>Format</span><output>Stereo · {(audio.telemetry.sample_rate ?? 48000) / 1000} kHz</output></div>
        {audio.error && <p className="settings-error" role="alert">{audio.error}</p>}
        {audio.routing?.cue_error && <p className="settings-error" role="alert">{audio.routing.cue_error}</p>}
      </SettingsCard>
  </>;
}
