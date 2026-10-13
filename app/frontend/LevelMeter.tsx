import { useEffect, useLayoutEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { METER_FLOOR_DB, METER_POLL_MS, PeakMeter, meterDb } from './meter';
import { animate } from './transport';

type AudioLevels = { decks: [number, number]; master: [number, number]; running: boolean };

/** Poll only four peaks; transport, metadata and React updates stay at 5 Hz. */
export function useMeterFeed(running: boolean) {
  const meters = useRef([new PeakMeter(), new PeakMeter(), new PeakMeter(), new PeakMeter()] as const);
  useEffect(() => {
    const channels = meters.current;
    if (!running) { channels.forEach(meter => meter.reset(performance.now())); return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const sent = performance.now();
      try {
        const levels = await invoke<AudioLevels>('get_audio_levels');
        if (!cancelled && levels?.decks?.length === 2 && levels?.master?.length === 2) {
          const now = performance.now();
          if (levels.running) [...levels.decks, ...levels.master].forEach((peak, index) => channels[index].update(peak, now));
          else channels.forEach(meter => meter.reset(now));
        }
      } catch { /* The display decays to silence if the feed stalls. */ }
      if (!cancelled) timer = setTimeout(() => void poll(), Math.max(0, METER_POLL_MS - (performance.now() - sent)));
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [running]);
  return meters.current;
}

export function LevelMeter({ meter, label }: { meter: PeakMeter; label: string }) {
  const element = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    let lastDb = NaN;
    let lastReading = '';
    const draw = (now: number) => {
      const peak = meter.at(now);
      const db = meterDb(peak);
      if (db !== lastDb) {
        if (fill.current) fill.current.style.clipPath = `inset(${100 - (db - METER_FLOOR_DB) / -METER_FLOOR_DB * 100}% 0 0)`;
        lastDb = db;
      }
      const reading = peak > 0 ? `${(20 * Math.log10(peak)).toFixed(1)} dBFS peak` : 'Silent';
      if (reading !== lastReading) {
        element.current?.setAttribute('aria-valuenow', String(Math.round(db)));
        element.current?.setAttribute('aria-valuetext', reading);
        element.current?.setAttribute('title', reading);
        lastReading = reading;
      }
    };
    draw(performance.now());
    return animate(draw);
  }, [meter]);
  return <div ref={element} className="level-meter" role="meter" aria-label={label} aria-valuemin={METER_FLOOR_DB} aria-valuemax={0}>
    <div ref={fill} className="level-meter-fill" />
  </div>;
}
