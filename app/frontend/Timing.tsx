import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { waveformColour } from './waveform';
import type { Prepared } from './Decks';
export type Grid = { bpm: number; downbeat_seconds: number; reviewed: boolean };
export type TimingRecord = { grid: Grid | null; suggestion: Grid | null; state: string; source_hash: string };
export function validGrid(grid: Grid, duration: number) {
  return Number.isFinite(grid.bpm) && grid.bpm >= 30 && grid.bpm <= 300 && Number.isFinite(grid.downbeat_seconds) && grid.downbeat_seconds >= 0 && grid.downbeat_seconds < duration;
}
export function markers(grid: Grid | null | undefined, start: number, end: number) {
  if (!grid || !Number.isFinite(start) || !Number.isFinite(end)) return [];
  const first = Math.ceil((start - grid.downbeat_seconds) * grid.bpm / 60);
  const last = Math.floor((end - grid.downbeat_seconds) * grid.bpm / 60);
  if (last - first > 2048) return [];
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => {
    const beat = first + i;
    return { seconds: grid.downbeat_seconds + beat * 60 / grid.bpm, bar: Math.floor(beat / 4) + 1, beat: ((beat % 4) + 4) % 4 + 1 };
  });
}
export function WaveDetail({ track, grid, start, end }: { track: Prepared | null; grid?: Grid | null; start: number; end: number }) {
  const width = end - start;
  const peaks = track?.fine_peaks ?? [];
  const step = (track?.fine_peak_frames ?? 240) / 48000;
  const first = Math.max(0, Math.floor(start / step));
  const last = Math.min(peaks.length, Math.ceil(end / step));
  // Aggregate only the visible fine buckets to at most one line per screen column.
  const stride = Math.max(1, Math.ceil((last - first) / 1024));
  const path = [];
  for (let i = first; i < last; i += stride) {
    let peak = 0, high = 0, transient = 0;
    for (let j = i; j < Math.min(i + stride, last); j++) { peak = Math.max(peak, ...peaks[j]); high = Math.max(high, track?.fine_features?.[j]?.[0] ?? 0); transient = Math.max(transient, track?.fine_features?.[j]?.[1] ?? 0); }
    const x = (i * step - start) / width * 1024;
    const amp = Math.min(1, peak) * 32;
    path.push(<path key={i} d={`M${x.toFixed(2)},${48 - amp}V${48 + amp}`} stroke={waveformColour('#89d2ee', [high, transient])} />);
  }
  return <>
    {markers(grid, Math.max(0, start), Math.min(track?.duration_seconds ?? 0, end)).map(m => <g key={m.seconds} className={m.beat === 1 ? 'bar-line' : 'beat-line'} opacity={grid?.reviewed ? 1 : .5}>
      <path d={`M${(m.seconds - start) / width * 1024},16V96`} />
      <text x={(m.seconds - start) / width * 1024 + 3} y="12">{m.bar}.{m.beat}</text>
    </g>)}
    {path}
  </>;
}
export function TimingEditor({ trackId, title, duration, prepared, position = 0, getPosition, deck, generation, seek, close }: {
  trackId: string; title: string; duration: number; prepared?: Prepared; position?: number; getPosition?: () => number; deck?: number; generation?: number;
  seek?: (seconds: number) => void; close: () => void;
}) {
  const [record, setRecord] = useState<TimingRecord | null>(null);
  const [wave, setWave] = useState<Prepared | null>(prepared ?? null);
  const [bpm, setBpm] = useState('120');
  const [anchor, setAnchor] = useState('0');
  const [reviewed, setReviewed] = useState(false);
  const [cursor, setCursor] = useState(position);
  const [zoom, setZoom] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Loading timing…');
  const [busy, setBusy] = useState(true);
  const grid = { bpm: Number(bpm), downbeat_seconds: Number(anchor), reviewed };
  const valid = bpm.trim() !== '' && anchor.trim() !== '' && validGrid(grid, duration);
  const start = cursor - zoom / 2;
  const end = cursor + zoom / 2;
  function fill(value: Grid) { setBpm(String(value.bpm)); setAnchor(String(value.downbeat_seconds)); setReviewed(value.reviewed); }
  useEffect(() => {
    let cancelled = false;
    void invoke<TimingRecord>('track_timing', { trackId, grid: null }).then(value => {
      if (cancelled) return;
      setRecord(value); if (value.grid) fill(value.grid); else if (value.state !== 'stale' && value.suggestion) fill(value.suggestion);
      setStatus(value.state === 'stale' ? 'Source changed: previous corrections are stale. Review this source explicitly.' : value.grid ? `User timing: ${value.state}` : value.suggestion ? 'Automatic fitted grid preview · unreviewed. Save creates separate user timing.' : 'No timing available. Enter a manual grid.');
      setBusy(false);
    }).catch(e => { if (!cancelled) { setError(String(e)); setBusy(false); } });
    if (!prepared) void invoke<Prepared>('timing_waveform', { trackId }).then(v => { if (!cancelled) setWave(v); }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [trackId]);
  async function save(apply: boolean) {
    if (!valid) return;
    setBusy(true); setError(null);
    try {
      const value = await invoke<TimingRecord>('track_timing', { trackId, grid }); setRecord(value);
      if (apply && deck !== undefined) await invoke('apply_timing', { deck, generation, grid });
      setStatus(apply ? 'Saved and applied to this deck; affected sync cleared.' : 'Saved. Loaded decks retain their applied timing until Apply or reload.');
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  function move(seconds: number) { const value = Math.max(0, Math.min(duration, seconds)); setCursor(value); seek?.(value); }
  return <section className="timing-editor" aria-label={`Timing editor for ${title}`}>
    <h3>Timing · {title}</h3>
    <p>Constant 4/4 · source BPM 30–300 · anchor = bar 1, beat 1. Earlier beats use bars 0, −1, … with beats 1–4. A fitted offset is a suggestion, not a detected downbeat.</p>
    <div className="timing-controls"><label>Source BPM <input type="number" min="30" max="300" step=".01" value={bpm} onChange={e => { setBpm(e.target.value); setReviewed(false); }} /></label>
      <button onClick={() => { setBpm(String(Number(bpm) / 2)); setReviewed(false); }}>Half BPM</button><button onClick={() => { setBpm(String(Number(bpm) * 2)); setReviewed(false); }}>Double BPM</button>
      <label>First downbeat (s) <input type="number" min="0" max={duration} step=".001" value={anchor} onChange={e => { setAnchor(e.target.value); setReviewed(false); }} /></label>
      <button onClick={() => { setAnchor(cursor.toFixed(6)); setReviewed(false); }}>Downbeat at cursor</button>
      {seek && <button onClick={() => setCursor(getPosition?.() ?? position)}>Inspect audible position</button>}
      <label>Window <select value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[2, 4, 8, 16, 32].map(s => <option key={s} value={s}>{s} seconds</option>)}</select></label>
    </div>
    <svg viewBox="0 0 1024 96" className="detail-wave" role="slider" tabIndex={-1} aria-label="Timing waveform cursor" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={cursor}
      onClick={e => { const b = e.currentTarget.getBoundingClientRect(); move(start + (e.clientX - b.left) / b.width * zoom); }}
      onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); move(e.key === 'Home' ? 0 : e.key === 'End' ? duration : cursor + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : .01)); } }}>
      <WaveDetail track={wave} grid={valid ? grid : null} start={start} end={end} /><path d="M512,0V96" stroke="white" strokeWidth="2" />
    </svg>
    <p>Editor preview · cursor {cursor.toFixed(3)} s · arrows ±10 ms (Shift ±1 s). Deck overlays change only after Apply.</p>
    <div className="timing-controls">{[0, duration / 2, Math.max(0, duration - .001)].map((s, i) => <button key={i} onClick={() => move(s)}>{['Beginning', 'Middle', 'End'][i]}</button>)}
      <button disabled={!record?.suggestion} onClick={() => { if (record?.suggestion) { fill({ ...record.suggestion, reviewed: false }); setStatus('Analysis suggestion restored in editor; unreviewed until explicitly checked.'); } }}>Reset to analysis suggestion</button>
      <label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />Reviewed by me</label>
      <button disabled={!valid || busy} onClick={() => void save(false)}>Save timing</button>
      {deck !== undefined && <button disabled={!valid || busy} onClick={() => void save(true)}>Apply to deck</button>}
      <button onClick={close}>Close timing</button>
    </div>
    {!valid && <p role="alert">Enter BPM 30–300 and a downbeat within the source.</p>}
    {error && <p role="alert" className="row-error">{error}</p>}<p role="status">{status}</p>
  </section>;
}
