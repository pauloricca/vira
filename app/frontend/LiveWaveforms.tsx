import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { animate } from './transport';
import { gridGeometry } from './waveform';
import { useOutsideDismiss } from './Dropdown';

export type LiveSource = { id: string; label: string; peaks: [number, number][] };
type Feed = { sample_rate?: number; global_beat?: number; master_bpm?: number | null; clock_running?: boolean; sources: LiveSource[]; output_frame: number; peak_frames: number; generation: number; sampled_at: number };
const empty: Feed = { sources: [], output_frame: 0, peak_frames: 240, generation: 0, sampled_at: 0 };
export function useRollingSources() {
  const [selected, setSelected] = useState<string[]>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem('vira.rolling-sources') ?? 'null'); if (Array.isArray(saved) && saved.every(s => typeof s === 'string')) return saved; } catch { /* Use defaults. */ }
    return ['deck-0', 'deck-1'];
  });
  const [feed, setFeed] = useState<Feed>(empty);
  const selection = useRef(selected);
  selection.current = selected;
  useEffect(() => { localStorage.setItem('vira.rolling-sources', JSON.stringify(selected)); }, [selected]);
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    let previous = empty, previousSelection = '';
    async function poll() {
      const ids = selection.current.filter(id => !id.startsWith('deck-'));
      const key = ids.join('|');
      const sent = performance.now();
      try {
        const value = await invoke<Feed>('get_rolling_waveforms', { selected: ids, after: key === previousSelection ? Math.max(0, previous.output_frame - 240) : 0 });
        if (!stopped && value?.sources) {
          const same = previous.generation === value.generation && previous.output_frame <= value.output_frame;
          const sources = value.sources.map(source => {
            const old = same && key === previousSelection ? previous.sources.find(s => s.id === source.id)?.peaks ?? [] : [];
            const first = source.peaks[0]?.[0] ?? Infinity;
            return { ...source, peaks: [...old.filter(([frame]) => frame < first && frame >= value.output_frame - (value.sample_rate ?? 48000) * 82), ...source.peaks] };
          });
          previous = { ...value, sources, sampled_at: (sent + performance.now()) / 2 };
          previousSelection = key;
          setFeed(previous);
        }
      } catch { /* Deck waveforms remain available if the native feed is unavailable. */ }
      if (!stopped) timer = setTimeout(() => void poll(), ids.length ? 40 : 500);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  return { feed, selected, toggle: (id: string) => setSelected(previous => previous.includes(id) ? previous.filter(s => s !== id) : [...previous, id]) };
}

export function SourcePicker({ sources, selected, toggle }: { sources: LiveSource[]; selected: string[]; toggle: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useOutsideDismiss(open, () => setOpen(false), region);
  const options = [{ id: 'deck-0', label: 'Deck A' }, { id: 'deck-1', label: 'Deck B' }, ...sources];
  return <div className="rolling-sources" ref={region} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus(); } }}>
    <button ref={button} type="button" aria-expanded={open} aria-controls="rolling-source-list" onClick={() => setOpen(!open)}>Sources ▾</button>
    {open && <div id="rolling-source-list" className="rolling-source-list" aria-label="Waveform sources">{options.map(source => <label key={source.id}><input type="checkbox" checked={selected.includes(source.id)} onChange={() => toggle(source.id)} />{source.label}</label>)}</div>}
  </div>;
}

export function masterGridGeometry(beat: number | undefined, bpm: number | null | undefined, span: number, width: number) {
  if (beat == null || !Number.isFinite(beat) || !bpm || !Number.isFinite(bpm) || bpm <= 0) return [];
  return gridGeometry({ bpm, downbeat_seconds: 0, reviewed: true }, beat * 60 / bpm, span, 1, width, Infinity, -Infinity);
}

export function LiveRollingRow({ source, feed, window: span, running }: { source: LiveSource; feed: Feed; window: number; running: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ source, feed, span, running });
  latest.current = { source, feed, span, running };
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    function paint(now: number) {
      const { source, feed, span, running } = latest.current;
      const { width, height } = element!.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      if (element!.width !== Math.round(width * dpr) || element!.height !== Math.round(height * dpr)) { element!.width = Math.round(width * dpr); element!.height = Math.round(height * dpr); }
      const ctx = element!.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
      const head = feed.output_frame + (running ? Math.min(100, Math.max(0, now - feed.sampled_at)) * (feed.sample_rate ?? 48000) / 1000 : 0);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width / 2, height); ctx.clip();
      ctx.strokeStyle = '#a8d6b0'; ctx.lineWidth = 1;
      // Aggregate into screen columns, preserving transients when zoomed out.
      const columns = new Float32Array(Math.ceil(width / 2));
      for (const [frame, peak] of source.peaks) {
        const x = Math.floor(width * (.5 + (frame - head) / ((feed.sample_rate ?? 48000) * span)));
        const end = Math.ceil(width * (.5 + (frame + feed.peak_frames - head) / ((feed.sample_rate ?? 48000) * span)));
        for (let column = Math.max(0, x); column < Math.min(columns.length, end); column++) columns[column] = Math.max(columns[column], peak);
      }
      ctx.beginPath();
      columns.forEach((peak, x) => { if (peak > 0) { const amplitude = Math.min(1, peak) * height * .45; ctx.moveTo(x + .5, height / 2 - amplitude); ctx.lineTo(x + .5, height / 2 + amplitude); } });
      ctx.stroke(); ctx.restore();
      const beat = feed.global_beat == null ? undefined : feed.global_beat + (feed.clock_running ? (head - feed.output_frame) / (feed.sample_rate ?? 48000) * (feed.master_bpm ?? 0) / 60 : 0);
      for (const mark of masterGridGeometry(beat, feed.master_bpm, span, width)) {
        ctx.strokeStyle = mark.beat === 1 && (mark.bar - 1) % 4 === 0 ? '#f6d477' : '#c8f3ff';
        ctx.globalAlpha = mark.beat === 1 ? 1 : .5;
        ctx.lineWidth = mark.beat === 1 ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(mark.x, 0); ctx.lineTo(mark.x, height); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    paint(performance.now());
    const stop = animate(paint);
    return stop;
  }, []);
  return <div className="rolling-row live-rolling-row"><span className="live-source-badge" title={source.label}>{source.label}</span><canvas ref={canvas} role="img" aria-label={`Rolling waveform ${source.label}, past audio only`} /><div className="rolling-playhead" /></div>;
}
