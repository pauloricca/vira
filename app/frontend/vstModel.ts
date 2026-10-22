import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
export type VstBus = { id: string; label: string; channels: number };
export type VstDescriptor = { format?: 'vst3' | 'clap' | 'au'; vendor?:string; midi_output?:boolean; offline_bypass?:boolean; path: string; uid: string; name: string; inputs: VstBus[]; outputs: VstBus[]; midi_input: boolean; effect: boolean; instrument: boolean };
export type VstCatalog = { scanning: boolean; plugins: VstDescriptor[]; errors: string[] };
export function useVsts(active = true) {
  const [catalog, setCatalog] = useState<VstCatalog>({ scanning: false, plugins: [], errors: [] });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const poll = () => { void invoke<VstCatalog>('vst_catalog').then(value => { if (alive && value?.plugins) setCatalog(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value); }).catch(() => {}); };
    poll(); const timer = window.setInterval(poll, 1500);
    return () => { alive = false; window.clearInterval(timer); };
  }, [active]);
  return catalog;
}
