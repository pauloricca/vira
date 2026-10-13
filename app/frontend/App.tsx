import { waveformZoomIntervals } from './zoom';
import { useTempoDrag } from './tempoDrag';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TimingEditor } from './Timing';
import { RenderProbe } from './RenderProbe';
import { Deck, Mixer, RollingWaveforms, TRACK_MIME, useDecks } from './Decks';
import { TrackArtwork } from './artwork';
import { Audio } from './Audio';
import { Shortcuts } from './Shortcuts';

export type Track = {
  id: string; filename: string; title: string; artist: string;
  duration_seconds: number | null; size_bytes: number; modified_ns: string;
  status: 'ready' | 'unsupported' | 'unreadable'; error: string | null;
  source_hash: string | null; analysis: Analysis;
  artwork_available?: boolean;
};
type KeyCandidate = { key: string; correlation: number };
type Result = {
  grid: { bpm: number; offset_seconds: number; residual_p95_ms: number; end_minus_start_residual_ms: number; tempo_spread_percent: number; thirds_bpm: number[] } | null;
  beats_seconds: number[]; keys: KeyCandidate[]; window_keys: unknown[]; flags: string[];
  tempo_alternatives?: number[]; tracker_bpm?: number; key_window_agreement?: number;
};
export type Analysis = { state: 'not_analysed' | 'queued' | 'analysing' | 'analysed' | 'needs_review' | 'approved' | 'stale' | 'failed'; result: Result | null; error: string | null };
export type Library = { schema_version: number; revision: number; instance_id: string; music_bin: string; tracks: Track[] };
const labels: Record<Analysis['state'], string> = { not_analysed: 'Not analysed', queued: 'Queued', analysing: 'Analysing', analysed: 'Analysed · draft', needs_review: 'Needs review', approved: 'Approved', stale: 'Stale', failed: 'Failed' };
type SortColumn = 'number' | 'cover' | 'title' | 'artist' | 'bpm' | 'key' | 'length' | 'analysis' | 'actions';
type SortDirection = 'ascending' | 'descending';
type Sort = { column: SortColumn; direction: SortDirection };
const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortValue(track: Track, column: SortColumn, originalIndex: number): string | number | null {
  switch (column) {
    case 'number': return originalIndex;
    case 'cover': return Number(!!track.artwork_available);
    case 'title': return track.title;
    case 'artist': return track.artist;
    case 'bpm': return track.analysis.result?.grid?.bpm ?? null;
    case 'key': return track.analysis.result?.keys[0]?.key ?? null;
    case 'length': return track.duration_seconds;
    case 'analysis': return track.status === 'ready' ? labels[track.analysis.state] : track.status === 'unsupported' ? 'Unsupported' : 'Unreadable';
    case 'actions': return Number(track.status === 'ready');
  }
}

function compareSortValues(left: string | number | null, right: string | number | null, direction: SortDirection) {
  // Missing metadata stays at the bottom in either direction.
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const comparison = typeof left === 'number' && typeof right === 'number'
    ? left - right : textCollator.compare(String(left), String(right));
  return direction === 'ascending' ? comparison : -comparison;
}

export function duration(seconds: number | null) {
  if (seconds === null) return '—';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function isTextInput(target: EventTarget | null) {
  return target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'].includes(target.type)
    || target instanceof HTMLTextAreaElement || target instanceof HTMLElement && target.isContentEditable;
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
  const dragMasterTempo = useTempoDrag(decks.audio.master_bpm ?? 120, 15, 600, false, value => decks.control(0, 'master_tempo', value));
  const [editing, setEditing] = useState<Track | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState<Set<string>>(new Set());
  const [queueingAll, setQueueingAll] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const trackRows = useRef(new Map<string, HTMLTableRowElement>());
  const [beats, setBeats] = useState(32);
  const [timingOpen, setTimingOpen] = useState([false, false]);
  const [activeDeck, setActiveDeck] = useState(0);
  const deckPositions = useRef<Array<() => number>>([]);
  const registerDeckPosition = (deck: number, getPosition: () => number) => { deckPositions.current[deck] = getPosition; };
  const timingOpenChange = (deck: number, open: boolean) => setTimingOpen(previous => previous.map((value, index) => index === deck ? open : value));
  const [driftRate, setDriftRate] = useState(() => {
    const value = Number(localStorage.getItem('vira.master-drift-rate'));
    return Number.isFinite(value) && value >= .01 && value <= 100 ? value : 1;
  });
  const [syncQuantum, setSyncQuantum] = useState<1 | 4>(() => localStorage.getItem('vira.sync-quantum') === '1' ? 1 : 4);
  const [preserveLock, setPreserveLock] = useState(() => localStorage.getItem('vira.preserve-lock-on-load') !== 'false');
  const [resetMixer, setResetMixer] = useState(() => localStorage.getItem('vira.reset-mixer-on-load') !== 'false');
  const [showCrossfader, setShowCrossfader] = useState(() => localStorage.getItem('vira.show-crossfader') !== 'false');
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'crossfader_enabled', showCrossfader ? 1 : 0); }, [decks.audio.running, showCrossfader]);
  const loadTrack = (deck: number, trackId: string) => { setActiveDeck(deck); return decks.load(deck, trackId, preserveLock, resetMixer); };
  const [masterEntry, setMasterEntry] = useState('120');
  useEffect(() => setMasterEntry(String(decks.audio.master_bpm ?? 120)), [decks.audio.master_bpm]);
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'drift_rate', driftRate); }, [decks.audio.running]);
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'sync_quantum', syncQuantum); }, [decks.audio.running]);
  const [view, setView] = useState<'decks' | 'settings' | 'shortcuts' | 'audio'>('decks');
  const spaceHeld = useRef(false);
  const lastPlayed = useRef([0, 0]);
  const wasPlaying = useRef([false, false]);
  const playOrder = useRef(0);
  useEffect(() => {
    for (const deck of decks.audio.decks) {
      if (deck.playing && !wasPlaying.current[deck.deck]) lastPlayed.current[deck.deck] = ++playOrder.current;
      wasPlaying.current[deck.deck] = deck.playing;
    }
  }, [decks.audio.decks]);
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
    const bpm = decks.audio.decks[deck].grid?.bpm;
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
  async function approve(trackId: string) {
    const track = library?.tracks.find(candidate => candidate.id === trackId);
    if (!track || !['analysed', 'needs_review'].includes(track.analysis.state) || approving.has(trackId)) return;
    const current = generation.current;
    setApproving(previous => new Set(previous).add(trackId));
    setRowErrors(previous => ({ ...previous, [trackId]: '' }));
    try {
      const value = await invoke<Library>('approve_track_analysis', { trackId });
      if (current === generation.current) apply(value);
    } catch (e) { if (current === generation.current) setRowErrors(previous => ({ ...previous, [trackId]: String(e) })); }
    finally { setApproving(previous => { const next = new Set(previous); next.delete(trackId); return next; }); }
  }
  function loadOnAvailableDeck(track: Track) {
    if (track.status !== 'ready' || !decks.audio.running) return;
    const available = decks.audio.decks.filter(deck => !deck.playing && !deck.loading && !decks.loading[deck.deck]);
    const target = available.sort((a, b) => Number(!!a.track) - Number(!!b.track) || lastPlayed.current[a.deck] - lastPlayed.current[b.deck] || a.deck - b.deck)[0];
    if (target) void loadTrack(target.deck, track.id);
  }
  const visibleTracks = library?.tracks
    .map((track, originalIndex) => ({ track, originalIndex }))
    .filter(({ track }) => `${track.title} ${track.artist} ${track.filename}`.toLowerCase().includes(search.toLowerCase()))
    .sort((left, right) => sort
      ? compareSortValues(sortValue(left.track, sort.column, left.originalIndex), sortValue(right.track, sort.column, right.originalIndex), sort.direction) || left.originalIndex - right.originalIndex
      : left.originalIndex - right.originalIndex)
    .map(({ track }) => track);
  const originalTrackNumbers = new Map(library?.tracks.map((track, index) => [track.id, index + 1]));
  function changeSort(column: SortColumn) {
    setSort(previous => ({ column, direction: previous?.column === column && previous.direction === 'ascending' ? 'descending' : 'ascending' }));
  }
  const unanalysedTracks = visibleTracks?.filter(track => track.status === 'ready' && ['not_analysed', 'stale', 'failed'].includes(track.analysis.state) && !pending.has(track.id)) ?? [];
  async function analyseAll() {
    if (queueingAll || busy || error || pollError) return;
    const tracks = [...unanalysedTracks];
    const current = generation.current;
    setQueueingAll(true);
    try {
      for (const track of tracks) {
        if (current !== generation.current) break;
        setPending(previous => new Set(previous).add(track.id));
        setRowErrors(previous => ({ ...previous, [track.id]: '' }));
        while (current === generation.current) {
          try {
            const value = await invoke<Library>('analyse_track', { trackId: track.id });
            if (current === generation.current) apply(value);
            break;
          } catch (e) {
            if (current !== generation.current) break;
            if (String(e).includes('Analysis queue is full')) {
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
            setRowErrors(previous => ({ ...previous, [track.id]: String(e) }));
            break;
          }
        }
        setPending(previous => { const next = new Set(previous); next.delete(track.id); return next; });
      }
    } finally { setQueueingAll(false); }
  }
  useEffect(() => {
    if (!visibleTracks?.length) {
      setSelectedTrackId(null);
    } else if (!visibleTracks.some(track => track.id === selectedTrackId)) {
      setSelectedTrackId(visibleTracks[0].id);
    }
  }, [visibleTracks, selectedTrackId]);
  useEffect(() => {
    if (view !== 'decks' || editing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey &&
          ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        if (isTextInput(event.target)) return;
        event.preventDefault();
        setActiveDeck(event.key === 'ArrowLeft' ? 0 : 1);
        return;
      }
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'l') {
        if (isTextInput(event.target)) return;
        event.preventDefault();
        if (event.repeat) return;
        const target = decks.audio.decks[activeDeck];
        if (decks.audio.running && target?.track && target.grid && !target.loading && !decks.loading[activeDeck]) {
          void decks.control(activeDeck, 'sync', 1);
        }
        return;
      }
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat &&
          ((event.key.toLowerCase() === 'b' && !event.shiftKey) ||
           (event.key.toLowerCase() === 'a' && event.shiftKey) ||
           (event.shiftKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)))) {
        event.preventDefault();
        const preferred = decks.audio.decks[activeDeck];
        const target = preferred?.track ? preferred : decks.audio.decks.find(candidate => candidate.track);
        if (!target || !decks.audio.running || target.loading || decks.loading[target.deck]) return;
        if (event.key.toLowerCase() === 'a') {
          void approve(target.track!.track_id);
        } else if (!target.playing && target.grid) {
          if (event.key.toLowerCase() === 'b') {
            const duration = target.track!.duration_seconds;
            const position = deckPositions.current[target.deck]?.() ?? target.position_seconds;
            void decks.control(target.deck, 'reference_beat', Math.min(Math.max(0, position), Math.max(0, duration - 1 / 48000)));
          } else {
            void decks.control(target.deck, 'shift_bar_start', event.key === 'ArrowRight' ? 1 : -1);
          }
        }
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        if (!isTextInput(event.target)) event.preventDefault();
        spaceHeld.current = !isTextInput(event.target);
        return;
      }
      if (spaceHeld.current && !event.repeat && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const deck = event.key === 'ArrowLeft' ? 0 : 1;
        const target = decks.audio.decks[deck];
        if (decks.audio.running && target?.track && !target.loading && !decks.loading[deck]) void decks.control(deck, 'play_pause');
        return;
      }
      const tracks = visibleTracks ?? [];
      if (event.metaKey && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const track = tracks.find(candidate => candidate.id === selectedTrackId);
        const deck = event.key === 'ArrowLeft' ? 0 : 1;
        const target = decks.audio.decks[deck];
        if (track?.status === 'ready' && decks.audio.running && target && !target.playing && !target.loading && !decks.loading[deck]) void loadTrack(deck, track.id);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (!tracks.length) return;
        event.preventDefault();
        const current = tracks.findIndex(track => track.id === selectedTrackId);
        const next = current < 0 ? 0 : Math.max(0, Math.min(tracks.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)));
        const id = tracks[next].id;
        setSelectedTrackId(id);
        trackRows.current.get(id)?.scrollIntoView?.({ block: 'nearest' });
        return;
      }
      if (event.key.length === 1 && !/\s/u.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey && event.target !== searchInput.current) {
        event.preventDefault();
        searchInput.current?.focus();
        setSearch(previous => previous + event.key);
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key === ' ' || event.code === 'Space') spaceHeld.current = false;
    }
    function clearSpaceHeld() { spaceHeld.current = false; }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearSpaceHeld);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearSpaceHeld);
    };
  }, [view, editing, visibleTracks, selectedTrackId, decks.audio, decks.loading, preserveLock, resetMixer, activeDeck, library, approving]);
  return <main onFocusCapture={event => { if (!isTextInput(event.target)) event.target.blur(); }} onClickCapture={event => { if (event.target instanceof HTMLElement && !isTextInput(event.target)) event.target.blur(); }}>
    <header className="app-header"><h1><img className="app-wordmark" src="/vira-wordmark.svg" alt="VIRA" /></h1>
      <nav aria-label="Workspace"><button className={view === 'decks' ? 'active' : undefined} aria-current={view === 'decks' ? 'page' : undefined} onClick={() => setView('decks')}>DECKS</button>{['SEQUENCE', 'MIX', 'LIBRARY'].map(label => <button key={label} disabled title="Coming later">{label}</button>)}<button className={view === 'settings' ? 'active' : undefined} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => { setEditing(null); setTimingOpen([false, false]); setView('settings'); }}>SETTINGS</button><button className={view === 'shortcuts' ? 'active' : undefined} aria-current={view === 'shortcuts' ? 'page' : undefined} onClick={() => { setEditing(null); setTimingOpen([false, false]); setView('shortcuts'); }}>SHORTCUTS</button></nav>
      <div className="master-tempo"><div className="master-drift-buttons"><button aria-label="Drift master tempo to deck A; double-click to set instantly" title="Click to drift · double-click to set instantly" disabled={!decks.audio.decks[0].grid} onClick={event => driftOrSet(0, event.detail)} onDoubleClick={() => setFromDeck(0)}>A ({decks.audio.decks[0].grid?.bpm.toFixed(1) ?? "—"}) →</button><button aria-label="Drift master tempo to deck B; double-click to set instantly" title="Click to drift · double-click to set instantly" disabled={!decks.audio.decks[1].grid} onClick={event => driftOrSet(1, event.detail)} onDoubleClick={() => setFromDeck(1)}>B ({decks.audio.decks[1].grid?.bpm.toFixed(1) ?? "—"}) →</button></div><output className="tempo-drag" title="Hold and move right/up to increase BPM, left/down to decrease; farther moves faster" onPointerDown={dragMasterTempo} aria-label="Master BPM">{(decks.audio.master_bpm ?? 120).toFixed(1)}</output><span className="tempo-drag" onPointerDown={dragMasterTempo}>BPM</span><small>{decks.audio.drift_target == null ? 'MASTER' : `DRIFT TO ${decks.audio.drift_target === 0 ? 'A' : 'B'}`}</small></div>
      <span className="meter-signature">4/4</span>
      {view === 'decks' && <label className="header-zoom"><span className="sr-only">Shared zoom</span><select aria-label="Shared zoom" value={beats} onChange={event => setBeats(Number(event.target.value))}>{waveformZoomIntervals.map(value => <option key={value} value={value}>{value / 4} {value === 4 ? 'bar' : 'bars'}</option>)}</select></label>}
      <div className="header-actions">{['LINK', 'REC', 'MIDI'].map(label => <button key={label} disabled title="Coming later">{label === 'REC' && <i className="record-dot" />}{label}</button>)}<button className={view === 'audio' ? 'active' : undefined} aria-current={view === 'audio' ? 'page' : undefined} onClick={() => { setEditing(null); setTimingOpen([false, false]); setView('audio'); }}>AUDIO</button></div>
    </header>
    {view === 'decks' ? <>
    <RollingWaveforms audio={decks.audio} beats={beats} onZoomChange={setBeats} control={decks.control} timingOpen={timingOpen} onInteract={setActiveDeck} activeDeck={activeDeck} />
    <section className="decks" aria-label="Decks">
      <Deck state={decks.audio.decks[0]} running={decks.audio.running} loading={decks.loading[0]} loadingTitle={library?.tracks.find(track => track.id === decks.loadingTrackIds[0])?.title} error={decks.errors[0]} load={loadTrack} control={decks.control} syncQuantum={syncQuantum} showVolume={false} onTimingOpenChange={timingOpenChange} onInteract={setActiveDeck} registerPosition={registerDeckPosition} active={activeDeck === 0} analysisState={library?.tracks.find(track => track.id === decks.audio.decks[0].track?.track_id)?.analysis.state} approveAnalysis={() => { const id = decks.audio.decks[0].track?.track_id; if (id) void approve(id); }} approving={approving.has(decks.audio.decks[0].track?.track_id ?? '')} approvalError={rowErrors[decks.audio.decks[0].track?.track_id ?? '']} />
      <Mixer audio={decks.audio} control={decks.control} showCrossfader={showCrossfader} />
      <Deck state={decks.audio.decks[1]} running={decks.audio.running} loading={decks.loading[1]} loadingTitle={library?.tracks.find(track => track.id === decks.loadingTrackIds[1])?.title} error={decks.errors[1]} load={loadTrack} control={decks.control} syncQuantum={syncQuantum} showVolume={false} onTimingOpenChange={timingOpenChange} onInteract={setActiveDeck} registerPosition={registerDeckPosition} active={activeDeck === 1} analysisState={library?.tracks.find(track => track.id === decks.audio.decks[1].track?.track_id)?.analysis.state} approveAnalysis={() => { const id = decks.audio.decks[1].track?.track_id; if (id) void approve(id); }} approving={approving.has(decks.audio.decks[1].track?.track_id ?? '')} approvalError={rowErrors[decks.audio.decks[1].track?.track_id ?? '']} />
    </section>
    {(decks.audio.error || decks.pollError) && <p className="error" role="alert">{decks.audio.error || decks.pollError}</p>}
    {editing && <div className="timing-overlay" role="dialog" aria-modal="true" aria-label={`Edit timing for ${editing.title}`}><TimingEditor key={editing.id} trackId={editing.id} title={editing.title} duration={editing.duration_seconds ?? 0} close={() => setEditing(null)} /></div>}
    <div className="lower-panels"><section className="library" aria-label="Music library" aria-busy={busy}>
      <div className="toolbar"><div><h2>Music library</h2>
      </div><div className="library-toolbar-actions"><button onClick={() => void analyseAll()} disabled={busy || !!error || !!pollError || queueingAll || unanalysedTracks.length === 0}>{queueingAll ? 'Queueing…' : 'Analyse all'}</button><button onClick={() => void refresh()} disabled={busy}>{busy ? 'Scanning…' : 'Refresh'}</button></div></div>
      <label className="library-search"><span aria-hidden="true">⌕</span><input ref={searchInput} type="search" aria-label="Search music library" placeholder="Search tracks, artists…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {(error || pollError) && <div className="error" role="alert"><strong>Library unavailable</strong><p>{error || pollError}</p>
        {library && <p>The table shows the last successful scan; it may be out of date.</p>}</div>}
      <div className="table-wrap"><table className="collection-table"><colgroup><col className="number-col" /><col className="cover-col" /><col className="title-col" /><col className="artist-col" /><col className="bpm-col" /><col className="key-col" /><col className="length-col" /><col className="analysis-col" /><col className="action-col" /></colgroup><thead><tr>
        {([['number', '#'], ['cover', 'Cover'], ['title', 'Title'], ['artist', 'Artist'], ['bpm', 'BPM*'], ['key', 'Key*'], ['length', 'Length'], ['analysis', 'Analysis'], ['actions', 'Actions']] as const).map(([column, label]) =>
          <th key={column} scope="col" aria-sort={sort?.column === column ? sort.direction : 'none'}><button className="sort-header" onClick={() => changeSort(column)} aria-label={`Sort by ${label.replace('*', '')}`} title={`Sort by ${label.replace('*', '')}`}>{column === 'cover' ? '▣' : column === 'actions' ? '•••' : label}<span className="sort-indicator" aria-hidden="true">{sort?.column === column ? sort.direction === 'ascending' ? '▲' : '▼' : '↕'}</span></button></th>)}
      </tr></thead><tbody>{visibleTracks?.map(track => {
        const originalNumber = originalTrackNumbers.get(track.id) ?? 1;
        const onDeckA = decks.audio.decks[0].track?.track_id === track.id;
        const onDeckB = decks.audio.decks[1].track?.track_id === track.id;
        return <tr key={track.id} ref={element => { if (element) trackRows.current.set(track.id, element); else trackRows.current.delete(track.id); }} className={selectedTrackId === track.id ? 'selected-track' : undefined} aria-selected={selectedTrackId === track.id} draggable={track.status === 'ready'} onClick={() => setSelectedTrackId(track.id)} onDoubleClick={event => { if (!(event.target instanceof Element && event.target.closest('.row-actions'))) loadOnAvailableDeck(track); }} onDragStart={event => { event.dataTransfer.setData(TRACK_MIME, track.id); event.dataTransfer.effectAllowed = 'copy'; }}>
        <td className="row-number numeric"><span className={`track-index${onDeckA ? ' on-deck-a' : ''}${onDeckB ? ' on-deck-b' : ''}`}>{originalNumber}</span></td><td><TrackArtwork trackId={track.id} available={!!track.artwork_available} className={`collection-cover cover-${(originalNumber - 1) % 6}`} /></td>
        <td><span className="collection-cell-text title" title={track.filename}>{track.title}</span></td>
        <td><span className="collection-cell-text" title={track.artist}>{track.artist}</span></td>
        <td className="numeric">{track.analysis.result?.grid?.bpm.toFixed(2) ?? '—'}</td><td><span className="collection-cell-text" title={track.analysis.result?.keys[0]?.key ?? ''}>{track.analysis.result?.keys[0]?.key ?? '—'}</span></td><td className="numeric">{duration(track.duration_seconds)}</td>
        <td><span className={`status ${track.status} ${track.analysis.state}`}>{track.status === 'ready' ? labels[track.analysis.state] : track.status === 'unsupported' ? 'Unsupported' : 'Unreadable'}</span>
          {(track.error || track.analysis.error) && <small className="row-error">{track.error || track.analysis.error}</small>}
          {rowErrors[track.id] && <small className="row-error" role="alert">{rowErrors[track.id]}</small>}</td>
        <td><details className="row-actions" onClick={event => { if (event.target instanceof HTMLButtonElement) event.currentTarget.removeAttribute('open'); }}><summary aria-label={`Actions for ${track.title}`}>•••</summary><div className="row-action-buttons"><button disabled={track.status !== 'ready'} onClick={() => setEditing(track)}>Timing</button><button onClick={() => void analyse(track)} disabled={busy || track.status !== 'ready' || pending.has(track.id) || ['queued', 'analysing'].includes(track.analysis.state)}
          aria-label={`${track.analysis.state === 'failed' ? 'Retry' : track.analysis.state === 'not_analysed' ? 'Analyse' : 'Reanalyse'} ${track.title}`}>
          {track.analysis.state === 'failed' ? 'Retry' : track.analysis.state === 'not_analysed' ? 'Analyse' : ['queued', 'analysing'].includes(track.analysis.state) ? labels[track.analysis.state] : 'Reanalyse'}
        </button><div className="row-loads"><button disabled={track.status !== 'ready' || !decks.audio.running} aria-label={`Load ${track.title} on deck A`} onClick={() => void loadTrack(0, track.id)}>Load A</button>
          <button disabled={track.status !== 'ready' || !decks.audio.running} aria-label={`Load ${track.title} on deck B`} onClick={() => void loadTrack(1, track.id)}>Load B</button></div></div></details></td>
      </tr>})}</tbody></table></div>
      {!busy && !error && !pollError && library?.tracks.length === 0 && <p className="empty">No files in the music bin. Add MP3 or PCM WAV files, then Refresh.</p>}
      {library && library.tracks.length > 0 && visibleTracks?.length === 0 && <p className="empty">No tracks match your search.</p>}
      <footer role="status">{busy ? 'Reading file metadata…' : library ? `${library.tracks.length} files · ${library.tracks.filter(t => t.status === 'ready').length} readable` : 'No scan available'}
        <span>*Automatic draft estimates; analysis status shows review needs.</span></footer>
    </section><section className="performance-slots" aria-label="Performance slots"><div className="toolbar"><h2>Performance slots</h2><div><button disabled>INSTRUMENTS</button><button disabled>EFFECTS</button></div><button disabled>+ Add slot</button></div><div className="slots-empty"><span>PERFORMANCE SLOTS</span><p>Instruments and effects · coming later</p></div></section></div>
    </> : view === 'audio' ? <Audio audio={decks.audio} /> : view === 'shortcuts' ? <Shortcuts /> : <section className="settings-page" aria-label="Settings"><div className="settings-inner"><div className="settings-heading"><h2>Settings</h2><p>Workspace controls and system status</p></div><div className="settings-grid">
      <section className="settings-card"><h3>Display</h3><div className="settings-row"><div><strong>Shared waveform zoom</strong><p>Visible range around the playhead on both decks.</p></div><select aria-label="Shared waveform zoom" value={beats} onChange={event => setBeats(Number(event.target.value))}>{waveformZoomIntervals.map(value => <option key={value} value={value}>{value / 4} {value === 4 ? 'bar' : 'bars'}</option>)}</select></div></section>
      <section className="settings-card"><h3>Mixer</h3><div className="settings-row"><div><strong>Show crossfader</strong><p>Equal-power blending between decks A and B. Hiding it bypasses the crossfader.</p></div><input type="checkbox" aria-label="Show crossfader" checked={showCrossfader} onChange={event => { setShowCrossfader(event.target.checked); localStorage.setItem('vira.show-crossfader', String(event.target.checked)); }} /></div></section>
      <section className="settings-card"><h3>Loading tracks</h3><div className="settings-row"><div><strong>Keep deck locked</strong><p>Keep a deck locked to master BPM when its next track has a usable timing grid.</p></div><input type="checkbox" aria-label="Keep deck locked when loading a track" checked={preserveLock} onChange={event => { setPreserveLock(event.target.checked); localStorage.setItem('vira.preserve-lock-on-load', String(event.target.checked)); }} /></div><div className="settings-row"><div><strong>Reset gain, EQ and filter</strong><p>Start each new track with default volume and neutral mixer controls.</p></div><input type="checkbox" aria-label="Reset gain, EQ and filter when loading a track" checked={resetMixer} onChange={event => { setResetMixer(event.target.checked); localStorage.setItem('vira.reset-mixer-on-load', String(event.target.checked)); }} /></div></section>
      <section className="settings-card"><h3>Music library</h3><div className="settings-row"><div><strong>Music folder</strong><p className="settings-path">{library?.music_bin ?? 'Waiting for library scan…'}</p></div><button onClick={() => void refresh()} disabled={busy}>{busy ? 'Scanning…' : 'Refresh'}</button></div><div className="settings-row"><span>Collection</span><output>{library ? `${library.tracks.length} tracks · ${library.tracks.filter(track => track.status === 'ready').length} readable` : 'Unavailable'}</output></div>{(error || pollError) && <p className="settings-error" role="alert">{error || pollError}</p>}</section>
      <section className="settings-card"><h3>Audio engine</h3><div className="settings-row"><span>Native output</span><output className={decks.audio.running ? 'settings-live' : undefined}>{decks.audio.running ? 'Running · stereo 48 kHz' : 'Starting / unavailable'}</output></div><div className="settings-row"><span>Starved frames</span><output>{decks.audio.telemetry.callback?.starved_frames ?? 0}</output></div><div className="settings-row"><span>Device errors</span><output>{decks.audio.telemetry.callback?.device_errors ?? 0}</output></div>{(decks.audio.error || decks.pollError) && <p className="settings-error" role="alert">{decks.audio.error || decks.pollError}</p>}</section>
      <section className="settings-card"><h3>Tempo</h3><div className="settings-row"><strong>Master BPM</strong><label><input type="number" aria-label="Set master BPM" min="15" max="600" step="0.01" value={masterEntry} onChange={event => setMasterEntry(event.target.value)} /> BPM</label><button disabled={!Number.isFinite(Number(masterEntry)) || Number(masterEntry) < 15 || Number(masterEntry) > 600} onClick={() => void decks.control(0, 'master_tempo', Number(masterEntry))}>Set</button></div><div className="settings-row"><div><strong>Master tempo drift</strong><p>How fast master BPM moves toward a track’s original BPM.</p></div><label><input type="number" aria-label="Master tempo drift rate" min="0.01" max="100" step="0.01" value={driftRate} onChange={event => { const rate = Number(event.target.value); if (rate >= .01 && rate <= 100) { setDriftRate(rate); localStorage.setItem('vira.master-drift-rate', String(rate)); void decks.control(0, 'drift_rate', rate); } }} /> BPM/sec</label></div><div className="settings-row"><div><strong>Locked deck start</strong><p>Align a queued deck to the next matching master beat or bar.</p></div><select aria-label="Locked deck start" value={syncQuantum} onChange={event => { const quantum = Number(event.target.value) as 1 | 4; setSyncQuantum(quantum); localStorage.setItem('vira.sync-quantum', String(quantum)); void decks.control(0, 'sync_quantum', quantum); }}><option value={1}>Beat</option><option value={4}>Bar</option></select></div><div className="settings-row"><span>Time signature</span><output>4/4</output></div>{decks.errors[0] && <p className="settings-error" role="alert">{decks.errors[0]}</p>}</section>
    </div></div></section>}
    <div className="audio-status" role="status"><span className={decks.audio.running ? 'connection-live' : ''}>●</span> Native output: {decks.audio.running ? 'Running · R3 · stereo 48 kHz' : 'Starting / unavailable'} · starvation: {decks.audio.telemetry.callback?.starved_frames ?? 0} frames · device errors: {decks.audio.telemetry.callback?.device_errors ?? 0}<RenderProbe active={decks.audio.running && decks.audio.decks.some(state => state.playing)} stage="canvas" /></div>
  </main>;
}
