import { SettingsCard } from './SettingsSearch';
import { useEffect, useRef, useState } from 'react';
import { DeviceRefresh } from './DeviceRefresh';
import { invoke } from '@tauri-apps/api/core';
import type { AudioState } from './Decks';

type Device = { id: string; name: string; supported: boolean; sample_rate?: number; rate_ranges?: [number, number, number][] };
type Pair = [number, number];
type Inventory = { sample_rate?: number; devices: Device[]; default_device: string | null; routes: { master: string | null; cue: string | null; master_channels?: Pair; cue_channels?: Pair } };

export function Audio({ audio }: { audio: AudioState }) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [master, setMaster] = useState('');
  const [cue, setCue] = useState('');
  const [masterPair, setMasterPair] = useState<Pair>([1, 2]);
  const [cuePair, setCuePair] = useState<Pair>([1, 2]);
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
          if (initial) { setMaster(value.routes.master ?? ''); setCue(value.routes.cue ?? ''); setMasterPair(value.routes.master_channels ?? [1, 2]); setCuePair(value.routes.cue_channels ?? [1, 2]); initial = false; }
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
  const overlap = sameDevice && masterPair.some(channel => cuePair.includes(channel));
  const missing = (id: string) => !!id && !inventory?.devices.some(device => device.id === id);
  const unsupported = (id: string) => inventory?.devices.some(device => device.id === id && !device.supported);
  const routesChanged = !!inventory && (master !== (inventory.routes.master ?? '') || cue !== (inventory.routes.cue ?? '') || masterPair.join() !== (inventory.routes.master_channels ?? [1,2]).join() || cuePair.join() !== (inventory.routes.cue_channels ?? [1,2]).join());
  const masterDevice = inventory?.devices.find(device => device.id === (master || inventory.default_device));
  const selectedRate = masterDevice?.sample_rate ?? audio.telemetry.sample_rate ?? 48000;
  const restarting = selectedRate !== (audio.telemetry.sample_rate ?? inventory?.sample_rate ?? 48000);
  const changed = routesChanged || restarting;
  const cueDevice = inventory?.devices.find(device => device.id === cue);
  const pairs = (device: Device | undefined, rate?: number): Pair[] => {
    const ranges = device?.rate_ranges?.filter(([, low, high]) => rate == null || (low <= rate && rate <= high));
    const channels = ranges?.length ? Math.max(...ranges.map(([count]) => count)) : device?.rate_ranges ? 0 : 2;
    return Array.from({ length: Math.floor(channels / 2) }, (_, index) => [index * 2 + 1, index * 2 + 2]);
  };
  const masterPairs = pairs(masterDevice, selectedRate);
  const cuePairs = pairs(cueDevice, sameDevice ? selectedRate : cueDevice?.sample_rate);
  const pairExists = (available: Pair[], pair: Pair) => available.some(value => value.join() === pair.join());
  const invalidPairs = !pairExists(masterPairs, masterPair) || (!!cue && !pairExists(cuePairs, cuePair));
  function chooseMaster(value: string) {
    setMaster(value);
    setMasterPair([1,2]);
    if (cue === (value || inventory?.default_device)) {
      const device = inventory?.devices.find(device => device.id === cue);
      setCuePair(pairs(device, device?.sample_rate).find(pair => !pair.includes(1) && !pair.includes(2)) ?? [1,2]);
    }
  }
  function chooseCue(value: string) {
    setCue(value);
    const shared = !!value && value === (master || inventory?.default_device);
    const device = inventory?.devices.find(device => device.id === value);
    setCuePair(shared ? pairs(device, selectedRate).find(pair => !pair.some(channel => masterPair.includes(channel))) ?? [1,2] : [1,2]);
  }
  function channelOptions(available: Pair[], selected: Pair) {
    return <>{!pairExists(available, selected) && <option value={selected.join(',')}>{selected.join('–')} · unavailable</option>}{available.map(pair => <option key={pair.join(',')} value={pair.join(',')}>{pair.join('–')}</option>)}</>;
  }
  async function apply() {
    setBusy(true); setError(null);
    try {
      await invoke('set_audio_devices', { master: master || null, cue: cue || null, masterChannels: masterPair, cueChannels: cuePair });
      setInventory(previous => previous && { ...previous, routes: { master: master || null, cue: cue || null, master_channels: masterPair, cue_channels: cuePair } });
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  function options(selected: string) {
    return <>{missing(selected) && <option value={selected}>{selected} · disconnected</option>}{inventory?.devices.map(device => <option key={device.id} value={device.id} disabled={!device.supported}>{device.name}{!device.supported ? ' · unsupported output format' : device.sample_rate ? ` · ${device.sample_rate / 1000} kHz` : ''}</option>)}</>;
  }
  return <>
      <SettingsCard className="settings-card"><h3 className="device-list-heading">Output devices<DeviceRefresh label="Refresh audio devices" refresh={() => refreshDevices.current()} /></h3>
        <div className="settings-row"><div><strong>Master out</strong><p>The mix after channel faders and crossfader.{!master && inventory?.default_device && <> System default: {inventory.default_device}.</>}</p></div><select aria-label="Master out device" value={master} disabled={!inventory || busy} onChange={event => chooseMaster(event.target.value)}><option value="">System default</option>{options(master)}</select></div>
        <div className="settings-row"><span>Master channels</span><select aria-label="Master output channels" value={masterPair.join(',')} disabled={!inventory || busy} onChange={event => setMasterPair(event.target.value.split(',').map(Number) as Pair)}>{channelOptions(masterPairs, masterPair)}</select></div>
        <div className="settings-row"><div><strong>Cue headphones</strong><p>Before channel faders and crossfader; follows trim, EQ and filter.</p></div><select aria-label="Cue headphones device" value={cue} disabled={!inventory || busy} onChange={event => chooseCue(event.target.value)}><option value="">Off</option>{options(cue)}</select></div>
        {!!cue && <div className="settings-row"><span>Cue channels</span><select aria-label="Cue output channels" value={cuePair.join(',')} disabled={!inventory || busy} onChange={event => setCuePair(event.target.value.split(',').map(Number) as Pair)}>{channelOptions(cuePairs, cuePair)}</select></div>}
        <div className="audio-actions"><p className="audio-help">Select A, B or both with the headphone buttons above the channel faders. Use separate channel pairs when sharing a device.</p>
        {overlap && <p className="settings-error" role="alert">Master and cue channels must not overlap on the same device.</p>}
        {!!cue && !sameDevice && cueDevice?.sample_rate != null && cueDevice.sample_rate !== selectedRate && <p className="audio-help">Cue uses {cueDevice.sample_rate / 1000} kHz; audio is adapted from the master's {selectedRate / 1000} kHz. Using one device for both outputs keeps them on the same clock.</p>}
        {sameDevice && !overlap && <p className="audio-help">Master and cue share one {selectedRate / 1000} kHz stream.</p>}
        {restarting && <p className="audio-help">Changing to {selectedRate / 1000} kHz restarts VIRA and clears the decks. Save any grid or patch edits first. Tracks will use a cache prepared at the new rate.</p>}
        {(error || scanError) && <p className="settings-error" role="alert">{error || scanError}</p>}
        <button disabled={!changed || busy || overlap || invalidPairs || missing(master) || missing(cue) || unsupported(master) || unsupported(cue)} onClick={() => void apply()}>{busy ? 'Applying…' : restarting ? 'Apply outputs & restart VIRA' : 'Apply outputs'}</button></div>
      </SettingsCard>
      <SettingsCard className="settings-card"><h3>Output status</h3>
        <div className="settings-row"><span>Master out</span><output className={audio.running ? 'settings-live' : undefined}>{audio.running ? 'Running' : 'Unavailable'}</output></div>
        <div className="settings-row"><span>Cue headphones</span><output className={audio.routing?.cue_running ? 'settings-live' : undefined}>{audio.routing?.cue_running ? 'Running' : audio.routing?.cue ? 'Unavailable' : 'Off'}</output></div>
        <div className="settings-row"><span>Master format</span><output>Stereo · {(audio.telemetry.sample_rate ?? 48000) / 1000} kHz</output></div>
        {audio.routing?.cue_running && audio.routing.cue_sample_rate != null && <div className="settings-row"><span>Cue format</span><output>Stereo · {audio.routing.cue_sample_rate / 1000} kHz</output></div>}
        {audio.error && <p className="settings-error" role="alert">{audio.error}</p>}
        {audio.routing?.cue_error && <p className="settings-error" role="alert">{audio.routing.cue_error}</p>}
      </SettingsCard>
  </>;
}
