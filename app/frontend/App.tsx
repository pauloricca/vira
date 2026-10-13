import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TimingEditor } from './Timing';
import { RenderProbe } from './RenderProbe';
import { Deck, Mixer, RollingWaveforms, TRACK_MIME, useDecks } from './Decks';

export type Track = {
  id: string; filename: string; title: string; artist: string;
  duration_seconds: number | null; size_bytes: number; modified_ns: string;
  status: 'ready' | 'unsupported' | 'unreadable'; error: string | null;
  source_hash: string | null; analysis: Analysis;
};
type KeyCandidate = { key: string; correlation: number };
type Result = {
  grid: { bpm: number; offset_seconds: number; residual_p95_ms: number; end_minus_start_residual_ms: number; tempo_spread_percent: number; thirds_bpm: number[] } | null;
  beats_seconds: number[]; keys: KeyCandidate[]; window_keys: unknown[]; flags: string[];
  tempo_alternatives?: number[]; tracker_bpm?: number; key_window_agreement?: number;
};
export type Analysis = { state: 'not_analysed' | 'queued' | 'analysing' | 'analysed' | 'needs_review' | 'stale' | 'failed'; result: Result | null; error: string | null };
export type Library = { schema_version: number; revision: number; instance_id: string; music_bin: string; tracks: Track[] };
const labels: Record<Analysis['state'], string> = { not_analysed: 'Not analysed', queued: 'Queued', analysing: 'Analysing', analysed: 'Analysed · draft', needs_review: 'Needs review', stale: 'Stale', failed: 'Failed' };

export function duration(seconds: number | null) {
  if (seconds === null) return '—';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function App() {
  useEffect(() => {
    const root = document.querySelector('main');
    if (!root) return;
    const removeTabStops = () => root.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, [tabindex]').forEach(element => { element.tabIndex = -1; });
    removeTabStops();
    const observer = new MutationObserver(removeTabStops);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const decks = useDecks();
  const [editing, setEditing] = useState<Track | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [beats, setBeats] = useState(32);
  const [driftRate, setDriftRate] = useState(() => {
    const value = Number(localStorage.getItem('vira.master-drift-rate'));
    return Number.isFinite(value) && value >= .01 && value <= 100 ? value : 1;
  });
  const [syncQuantum, setSyncQuantum] = useState<1 | 4>(() => localStorage.getItem('vira.sync-quantum') === '1' ? 1 : 4);
  const [masterEntry, setMasterEntry] = useState('120');
  useEffect(() => setMasterEntry(String(decks.audio.master_bpm ?? 120)), [decks.audio.master_bpm]);
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'drift_rate', driftRate); }, [decks.audio.running]);
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'sync_quantum', syncQuantum); }, [decks.audio.running]);
  const [view, setView] = useState<'decks' | 'settings'>('decks');
  const generation = useRef(0);
  const revision = useRef(-1);
  const instance = useRef('');
  const scanning = useRef(true);
  const driftClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (driftClickTimer.current) clearTimeout(driftClickTimer.current); }, []);
  function driftOrSet(deck: number, detail: number) {
    if (driftClickTimer.current) clearTimeout(driftClickTimer.current);
    if (detail === 0) { void decks.control(deck, 'drift'); return; }
    driftClickTimer.current = setTimeout(() => { driftClickTimer.current = null; void decks.control(deck, 'drift'); }, 500);
  }
  function setFromDeck(deck: number) {
    if (driftClickTimer.current) clearTimeout(driftClickTimer.current);
    driftClickTimer.current = null;
    const bpm = decks.audio.decks[deck].target_bpm;
    if (bpm && Number.isFinite(bpm)) void decks.control(deck, 'master_tempo', bpm);
  }
  function apply(value: Library, reset = false) {
    if (reset || (value.instance_id === instance.current && value.revision >= revision.current)) {
      instance.current = value.instance_id;
      revision.current = value.revision;
      setLibrary(value);
    }
  }
  async function refresh() {
    const current = ++generation.current;
    scanning.current = true;
    setBusy(true);
    setError(null);
    try { const value = await invoke<Library>('refresh_library'); if (generation.current === current) { apply(value, true); setRowErrors({}); setPollError(null); } }
    catch (e) { setError(String(e)); }
    finally { scanning.current = false; setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const connected = library !== null;
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const current = generation.current;
      if (!scanning.current) {
        try {
          const value = await invoke<Library>('get_library_state');
          if (!cancelled && current === generation.current && !scanning.current) {
            if (value.instance_id !== instance.current) setPollError('Preparation service restarted. Click Refresh to restore the library.');
            else { apply(value); setPollError(null); }
          }
        } catch (e) { if (!cancelled && current === generation.current) setPollError(String(e)); }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1000);
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [connected]);
  async function analyse(track: Track) {
    const current = generation.current;
    setPending(previous => new Set(previous).add(track.id));
    setRowErrors(previous => ({ ...previous, [track.id]: '' }));
    try {
      const value = await invoke<Library>('analyse_track', { trackId: track.id });
      if (current === generation.current) apply(value);
    } catch (e) { if (current === generation.current) setRowErrors(previous => ({ ...previous, [track.id]: String(e) })); }
    finally { setPending(previous => { const next = new Set(previous); next.delete(track.id); return next; }); }
  }
  function loadOnAvailableDeck(track: Track) {
    if (track.status !== 'ready' || !decks.audio.running) return;
    const available = decks.audio.decks.filter(deck => !deck.playing && !deck.loading && !decks.loading[deck.deck]);
    const target = available.find(deck => !deck.track) ?? available[0];
    if (target) void decks.load(target.deck, track.id);
  }
  const visibleTracks = library?.tracks.filter(track => `${track.title} ${track.artist} ${track.filename}`.toLowerCase().includes(search.toLowerCase()));
  return <main onClickCapture={event => { if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLElement && event.target.tagName === 'SUMMARY') event.target.blur(); }}>
    <header className="app-header"><h1>VIRA</h1>
      <nav aria-label="Workspace"><button className={view === 'decks' ? 'active' : undefined} aria-current={view === 'decks' ? 'page' : undefined} onClick={() => setView('decks')}>DECKS</button>{['SEQUENCE', 'MIX', 'LIBRARY'].map(label => <button key={label} disabled title="Coming later">{label}</button>)}<button className={view === 'settings' ? 'active' : undefined} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => { setEditing(null); setView('settings'); }}>SETTINGS</button></nav>
      <div className="master-tempo"><div className="master-drift-buttons"><button aria-label="Drift master tempo to deck A; double-click to set instantly" title="Click to drift · double-click to set instantly" disabled={!decks.audio.decks[0].grid || !!decks.audio.decks[0].synced} onClick={event => driftOrSet(0, event.detail)} onDoubleClick={() => setFromDeck(0)}>A →</button><button aria-label="Drift master tempo to deck B; double-click to set instantly" title="Click to drift · double-click to set instantly" disabled={!decks.audio.decks[1].grid || !!decks.audio.decks[1].synced} onClick={event => driftOrSet(1, event.detail)} onDoubleClick={() => setFromDeck(1)}>B →</button></div><output aria-label="Master BPM">{(decks.audio.master_bpm ?? 120).toFixed(1)}</output><span>BPM</span><small>{decks.audio.drift_target == null ? 'MASTER' : `DRIFT TO ${decks.audio.drift_target === 0 ? 'A' : 'B'}`}</small></div>
      <span className="meter-signature">4/4</span>
      {view === 'decks' && <label className="header-zoom"><span className="sr-only">Shared zoom</span><select aria-label="Shared zoom" value={beats} onChange={event => setBeats(Number(event.target.value))}>{[4, 8, 16, 32].map(value => <option key={value} value={value}>{value / 4} {value === 4 ? 'bar' : 'bars'}</option>)}</select></label>}
      <div className="header-actions">{['LINK', 'REC', 'MIDI', 'AUDIO'].map(label => <button key={label} disabled title="Coming later">{label === 'REC' && <i className="record-dot" />}{label}</button>)}</div>
    </header>
    {view === 'decks' ? <>
    <RollingWaveforms audio={decks.audio} beats={beats} />
    <section className="decks" aria-label="Decks">
      <Deck state={decks.audio.decks[0]} running={decks.audio.running} loading={decks.loading[0]} error={decks.errors[0]} load={decks.load} control={decks.control} syncQuantum={syncQuantum} showVolume={false} />
      <Mixer audio={decks.audio} control={decks.control} />
      <Deck state={decks.audio.decks[1]} running={decks.audio.running} loading={decks.loading[1]} error={decks.errors[1]} load={decks.load} control={decks.control} syncQuantum={syncQuantum} showVolume={false} />
    </section>
    {(decks.audio.error || decks.pollError) && <p className="error" role="alert">{decks.audio.error || decks.pollError}</p>}
    {editing && <div className="timing-overlay" role="dialog" aria-modal="true" aria-label={`Edit timing for ${editing.title}`}><TimingEditor key={editing.id} trackId={editing.id} title={editing.title} duration={editing.duration_seconds ?? 0} close={() => setEditing(null)} /></div>}
    <div className="lower-panels"><section className="library" aria-label="Music library" aria-busy={busy}>
      <div className="toolbar"><div><h2>Music library</h2>
        <p className="path" title={library?.music_bin}>All tracks · one collection</p>
      </div><button onClick={() => void refresh()} disabled={busy}>{busy ? 'Scanning…' : 'Refresh'}</button></div>
      <label className="library-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search music library" placeholder="Search tracks, artists…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {(error || pollError) && <div className="error" role="alert"><strong>Library unavailable</strong><p>{error || pollError}</p>
        {library && <p>The table shows the last successful scan; it may be out of date.</p>}</div>}
      <div className="table-wrap"><table className="collection-table"><colgroup><col className="number-col" /><col className="cover-col" /><col className="title-col" /><col className="artist-col" /><col className="bpm-col" /><col className="key-col" /><col className="length-col" /><col className="analysis-col" /><col className="action-col" /></colgroup><thead><tr>
        <th scope="col">#</th><th scope="col" aria-label="Cover" /><th scope="col">Title</th><th scope="col">Artist</th><th scope="col">BPM*</th><th scope="col">Key*</th><th scope="col">Length</th><th scope="col">Analysis</th><th scope="col" aria-label="Actions" />
      </tr></thead><tbody>{visibleTracks?.map((track, index) => <tr key={track.id} className={decks.audio.decks.some(deck => deck.track?.track_id === track.id) ? 'loaded-track' : undefined} draggable={track.status === 'ready'} onDoubleClick={event => { if (!(event.target instanceof Element && event.target.closest('.row-actions'))) loadOnAvailableDeck(track); }} onDragStart={event => { event.dataTransfer.setData(TRACK_MIME, track.id); event.dataTransfer.effectAllowed = 'copy'; }}>
        <td className="row-number numeric">{index + 1}</td><td><span className={`collection-cover cover-${index % 6}`} aria-hidden="true" /></td>
        <td><span className="collection-cell-text title" title={track.filename}>{track.title}</span></td>
        <td><span className="collection-cell-text" title={track.artist}>{track.artist}</span></td>
        <td className="numeric">{track.analysis.result?.grid?.bpm.toFixed(2) ?? '—'}</td><td><span className="collection-cell-text" title={track.analysis.result?.keys[0]?.key ?? ''}>{track.analysis.result?.keys[0]?.key ?? '—'}</span></td><td className="numeric">{duration(track.duration_seconds)}</td>
        <td><span className={`status ${track.status} ${track.analysis.state}`}>{track.status === 'ready' ? labels[track.analysis.state] : track.status === 'unsupported' ? 'Unsupported' : 'Unreadable'}</span>
          {(track.error || track.analysis.error) && <small className="row-error">{track.error || track.analysis.error}</small>}
          {rowErrors[track.id] && <small className="row-error" role="alert">{rowErrors[track.id]}</small>}</td>
        <td><details className="row-actions" onClick={event => { if (event.target instanceof HTMLButtonElement) event.currentTarget.removeAttribute('open'); }}><summary aria-label={`Actions for ${track.title}`}>•••</summary><div className="row-action-buttons"><button disabled={track.status !== 'ready'} onClick={() => setEditing(track)}>Timing</button><button onClick={() => void analyse(track)} disabled={busy || track.status !== 'ready' || pending.has(track.id) || ['queued', 'analysing'].includes(track.analysis.state)}
          aria-label={`${track.analysis.state === 'failed' ? 'Retry' : track.analysis.state === 'not_analysed' ? 'Analyse' : 'Reanalyse'} ${track.title}`}>
          {track.analysis.state === 'failed' ? 'Retry' : track.analysis.state === 'not_analysed' ? 'Analyse' : ['queued', 'analysing'].includes(track.analysis.state) ? labels[track.analysis.state] : 'Reanalyse'}
        </button><div className="row-loads"><button disabled={track.status !== 'ready' || !decks.audio.running} aria-label={`Load ${track.title} on deck A`} onClick={() => void decks.load(0, track.id)}>Load A</button>
          <button disabled={track.status !== 'ready' || !decks.audio.running} aria-label={`Load ${track.title} on deck B`} onClick={() => void decks.load(1, track.id)}>Load B</button></div></div></details></td>
      </tr>)}</tbody></table></div>
      {!busy && !error && !pollError && library?.tracks.length === 0 && <p className="empty">No files in the music bin. Add MP3 or PCM WAV files, then Refresh.</p>}
      {library && library.tracks.length > 0 && visibleTracks?.length === 0 && <p className="empty">No tracks match your search.</p>}
      <footer role="status">{busy ? 'Reading file metadata…' : library ? `${library.tracks.length} files · ${library.tracks.filter(t => t.status === 'ready').length} readable` : 'No scan available'}
        <span>*Automatic draft estimates; analysis status shows review needs.</span></footer>
    </section><section className="performance-slots" aria-label="Performance slots"><div className="toolbar"><h2>Performance slots</h2><div><button disabled>INSTRUMENTS</button><button disabled>EFFECTS</button></div><button disabled>+ Add slot</button></div><div className="slots-empty"><span>PERFORMANCE SLOTS</span><p>Instruments and effects · coming later</p></div></section></div>
    </> : <section className="settings-page" aria-label="Settings"><div className="settings-inner"><div className="settings-heading"><h2>Settings</h2><p>Workspace controls and system status</p></div><div className="settings-grid">
      <section className="settings-card"><h3>Display</h3><div className="settings-row"><div><strong>Shared waveform zoom</strong><p>Visible range around the playhead on both decks.</p></div><select aria-label="Shared waveform zoom" value={beats} onChange={event => setBeats(Number(event.target.value))}>{[4, 8, 16, 32].map(value => <option key={value} value={value}>{value / 4} {value === 4 ? 'bar' : 'bars'}</option>)}</select></div></section>
      <section className="settings-card"><h3>Music library</h3><div className="settings-row"><div><strong>Music folder</strong><p className="settings-path">{library?.music_bin ?? 'Waiting for library scan…'}</p></div><button onClick={() => void refresh()} disabled={busy}>{busy ? 'Scanning…' : 'Refresh'}</button></div><div className="settings-row"><span>Collection</span><output>{library ? `${library.tracks.length} tracks · ${library.tracks.filter(track => track.status === 'ready').length} readable` : 'Unavailable'}</output></div>{(error || pollError) && <p className="settings-error" role="alert">{error || pollError}</p>}</section>
      <section className="settings-card"><h3>Audio engine</h3><div className="settings-row"><span>Native output</span><output className={decks.audio.running ? 'settings-live' : undefined}>{decks.audio.running ? 'Running · stereo 48 kHz' : 'Starting / unavailable'}</output></div><div className="settings-row"><span>Starved frames</span><output>{decks.audio.telemetry.callback?.starved_frames ?? 0}</output></div><div className="settings-row"><span>Device errors</span><output>{decks.audio.telemetry.callback?.device_errors ?? 0}</output></div>{(decks.audio.error || decks.pollError) && <p className="settings-error" role="alert">{decks.audio.error || decks.pollError}</p>}</section>
      <section className="settings-card"><h3>Tempo</h3><div className="settings-row"><strong>Master BPM</strong><label><input type="number" aria-label="Set master BPM" min="15" max="600" step="0.01" value={masterEntry} onChange={event => setMasterEntry(event.target.value)} /> BPM</label><button disabled={!Number.isFinite(Number(masterEntry)) || Number(masterEntry) < 15 || Number(masterEntry) > 600} onClick={() => void decks.control(0, 'master_tempo', Number(masterEntry))}>Set</button></div><div className="settings-row"><div><strong>Master tempo drift</strong><p>How fast master BPM moves toward an unlocked deck.</p></div><label><input type="number" aria-label="Master tempo drift rate" min="0.01" max="100" step="0.01" value={driftRate} onChange={event => { const rate = Number(event.target.value); if (rate >= .01 && rate <= 100) { setDriftRate(rate); localStorage.setItem('vira.master-drift-rate', String(rate)); void decks.control(0, 'drift_rate', rate); } }} /> BPM/sec</label></div><div className="settings-row"><div><strong>Locked deck start</strong><p>Align a queued deck to the next matching master beat or bar.</p></div><select aria-label="Locked deck start" value={syncQuantum} onChange={event => { const quantum = Number(event.target.value) as 1 | 4; setSyncQuantum(quantum); localStorage.setItem('vira.sync-quantum', String(quantum)); void decks.control(0, 'sync_quantum', quantum); }}><option value={1}>Beat</option><option value={4}>Bar</option></select></div><div className="settings-row"><span>Time signature</span><output>4/4</output></div>{decks.errors[0] && <p className="settings-error" role="alert">{decks.errors[0]}</p>}</section>
    </div></div></section>}
    <div className="audio-status" role="status"><span className={decks.audio.running ? 'connection-live' : ''}>●</span> Native output: {decks.audio.running ? 'Running · R3 · stereo 48 kHz' : 'Starting / unavailable'} · starvation: {decks.audio.telemetry.callback?.starved_frames ?? 0} frames · device errors: {decks.audio.telemetry.callback?.device_errors ?? 0}<RenderProbe active={decks.audio.running && decks.audio.decks.some(state => state.playing)} stage="canvas" /></div>
  </main>;
}
