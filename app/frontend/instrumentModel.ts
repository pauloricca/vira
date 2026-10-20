import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
export type AudioPort = { device: string; channels: number[] };
export type MidiPort = { device: number; channel: number | null; send_clock?: boolean; send_transport?: boolean; transport_bars?: 1 | 2 | 4 | 16 | 32 };
export type Instrument = { id: string; name: string; advance_ms?: number; audio_input: AudioPort | null; audio_output: AudioPort | null; midi_input: MidiPort | null; midi_output: MidiPort | null };
export type AudioDevice = { id: string; name: string; channels: number };
export function useInstruments(active = true) {
  const [items, setItems] = useState<Instrument[]>([]);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const refresh = () => void invoke<Instrument[]>('get_instruments').then(value => { if (!stopped && Array.isArray(value)) setItems(value); }).catch(() => undefined);
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [active]);
  return items;
}
