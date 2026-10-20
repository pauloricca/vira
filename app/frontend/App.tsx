import { trackSampleRate } from './waveform';
import { SettingsCard, SettingsSearch, SettingsSearchContext } from './SettingsSearch';
import { JogSettings, useJogTargets } from './Jog';
import { useMidiWorkspace, useMidiMarkers, useMidiTargets, MidiProvider, MidiToggle, MidiSettings, MidiEditor, MidiButton, MidiInput, MidiSelect } from './MidiMapping';
import { Instruments } from './Instruments';
import { AuditionControls, PlayIcon, StopIcon, useAudition } from './Audition';
import { useAutopilot, type AutopilotSelection } from './Autopilot';
import { TagsSidebar, TrackTags, useTags, TRACKS_MIME } from './Tags';
import { FolderSettings } from './FolderSettings';
import { CollectionSelector } from './CollectionSelector';
import { TrackActions } from './Dropdown';
import { useTempoDrag } from './tempoDrag';
import { Fragment, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RenderProbe } from './RenderProbe';
import { Deck, Mixer, RollingWaveforms, TRACK_MIME, canLoadDeck, useDecks } from './Decks';
import { TrackArtwork } from './artwork';
import { waitForDeckLoads } from './loadPriority';
import { Audio } from './Audio';
import { CpuUsage } from './CpuUsage';
import { Routing } from './Routing';
import { Patches } from './Patches';
import { Shortcuts } from './Shortcuts';
import { Patterns } from './Patterns';
import { camelotKey, compatibility, keyHarmony, shiftedKey, type CamelotKey } from './harmonic';

export type Track = {
  id: string; filename: string; title: string; artist: string;
  duration_seconds: number | null; size_bytes: number; modified_ns: string;
  status: 'ready' | 'unsupported' | 'unreadable'; error: string | null;
  source_hash: string | null; analysis: Analysis;
  timing_bpm?: number | null;
  artwork_available?: boolean; collection?: string;
};
type KeyCandidate = { key: string; correlation: number };
type Result = {
  grid: { bpm: number; offset_seconds: number; residual_p95_ms: number; end_minus_start_residual_ms: number; tempo_spread_percent: number; thirds_bpm: number[] } | null;
  beats_seconds: number[]; keys: KeyCandidate[]; window_keys: unknown[]; flags: string[];
  tempo_alternatives?: number[]; tracker_bpm?: number; key_window_agreement?: number;
};
export type Analysis = { state: 'not_analysed' | 'queued' | 'analysing' | 'analysed' | 'needs_review' | 'approved' | 'stale' | 'failed'; result: Result | null; error: string | null };
export type Library = { schema_version: number; revision: number; instance_id: string; music_bin: string; collections?: string[]; tracks: Track[]; scan_pending?: boolean; scan_error?: string | null };
const labels: Record<Analysis['state'], string> = { not_analysed: 'Not analysed', queued: 'Queued', analysing: 'Analysing', analysed: 'Analysed · draft', needs_review: 'Needs review', approved: 'Approved', stale: 'Stale', failed: 'Failed' };
type SortColumn = 'number' | 'cover' | 'title' | 'artist' | 'bpm' | 'key' | 'aComp' | 'bComp' | 'length' | 'played' | 'next' | 'analysis' | 'actions';
type SortDirection = 'ascending' | 'descending';
type Sort = { column: SortColumn; direction: SortDirection };
const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortValue(track: Track, column: SortColumn, originalIndex: number, deckKeys: (CamelotKey | null)[], played: Set<string> | null, nextTracks: string[]): string | number | null {
  switch (column) {
    case 'number': return originalIndex;
    case 'cover': return Number(!!track.artwork_available);
    case 'title': return track.title;
    case 'artist': return track.artist;
    case 'bpm': return track.timing_bpm ?? track.analysis.result?.grid?.bpm ?? null;
    case 'key': return track.analysis.result?.keys[0]?.key ?? null;
    case 'aComp': return compatibility(camelotKey(track.analysis.result?.keys[0]?.key), deckKeys[0]);
    case 'bComp': return compatibility(camelotKey(track.analysis.result?.keys[0]?.key), deckKeys[1]);
    case 'length': return track.duration_seconds;
    case 'played': return Number(played?.has(track.id));
    case 'next': { const index = nextTracks.indexOf(track.id); return index < 0 ? null : index + 1; }
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

function CompatibilityCell({ trackKey, deckKey, deck }: { trackKey: CamelotKey | null; deckKey: CamelotKey | null; deck: 'A' | 'B' }) {
  const score = compatibility(trackKey, deckKey);
  if (score === null) return <td className="compatibility-cell" aria-label={`Deck ${deck} compatibility unavailable`}>—</td>;
  const percentage = Math.round(score * 100);
  return <td className="compatibility-cell" aria-label={`Deck ${deck} compatibility ${percentage}%`} title={`${trackKey!.number}${trackKey!.letter} → ${deckKey!.number}${deckKey!.letter} · ${percentage}% key compatibility`}>
    <span className="compatibility-dot" style={{ backgroundColor: `hsl(${Math.round(score * 120)} 76% 43%)` }} aria-hidden="true" />
  </td>;
}

function isKeySelector(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('.deck-key, .key-menu, .rolling-zoom, .rolling-sources, .collection-dropdown, .tags-sidebar, .track-tags');
}

function isTextInput(target: EventTarget | null) {
  return target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'].includes(target.type)
    || target instanceof HTMLTextAreaElement || target instanceof HTMLElement && target.isContentEditable;
}

function isTempoTap(event: KeyboardEvent) {
  return event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey &&
    (event.key === ' ' || event.code === 'Space');
}

export function App() { return <MidiProvider><Workspace /></MidiProvider>; }
function Workspace() {
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
  const tags = useTags();
  const [tempoEntry, setTempoEntry] = useState<string | null>(null);
  const masterTempoDragged = useRef(false);
  const dragMasterTempo = useTempoDrag(decks.audio.master_bpm ?? 120, 15, 600, false, value => decks.control(0, 'master_tempo', value), undefined, () => { masterTempoDragged.current = true; });
  const [library, setLibrary] = useState<Library | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState<Set<string>>(new Set());
  const [queueingAll, setQueueingAll] = useState(false);
  const [search, setSearch] = useState('');
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [nextTracks, setNextTracks] = useState<string[]>([]);
  const [sessionPlayed, setSessionPlayed] = useState<Set<string> | null>(null);
  const sessionActive = sessionPlayed !== null;
  const playingTrackIds = decks.audio.decks.map(deck =>
    decks.audio.running && deck.playing && !deck.launch_pending && !deck.loading ? deck.track?.track_id ?? null : null);
  const previousPlayingTracks = useRef<(string | null)[]>([]);
  useEffect(() => {
    const started = playingTrackIds.filter((id, index): id is string => id !== null && id !== previousPlayingTracks.current[index]);
    previousPlayingTracks.current = playingTrackIds;
    if (started.length) {
      setSessionPlayed(previous => {
        if (previous === null || started.every(id => previous.has(id))) return previous;
        return new Set([...previous, ...started]);
      });
      setNextTracks(previous => previous.some(id => started.includes(id))
        ? previous.filter(id => !started.includes(id)) : previous);
    }
  }, [decks.audio.decks, decks.audio.running]);
  function endSession() {
    autopilot.disable();
    setSessionPlayed(null);
    setSort(previous => previous?.column === 'played' ? null : previous);
  }
  const [selectedCollections, setSelectedCollections] = useState<string[] | null>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('vira.collections') ?? 'null');
      if (Array.isArray(saved) && saved.every(path => typeof path === 'string')) return saved;
    } catch { /* Fall back to the previous single-folder selection. */ }
    const previous = localStorage.getItem('vira.collection');
    return previous ? [previous] : null;
  });
  const [tagMode, setTagMode] = useState(false);
  const tagging = tagMode && libraryExpanded;
  const [sortMode, setSortMode] = useState(false);
  const [trackOrder, setTrackOrder] = useState<Record<string, string[]>>(() => { try { return JSON.parse(localStorage.getItem('vira.track-order') ?? '{}'); } catch { return {}; } });
  const reorderId = useRef<string | null>(null);
  const [reorderPreview, setReorderPreview] = useState<string[] | null>(null);
  const [sort, setSort] = useState<Sort | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const selectionAnchor = useRef<string | null>(null);
  const selectedTrack = library?.tracks.find(track => track.id === selectedTrackId);
  const selectedIsNext = selectedTrackId !== null && nextTracks.includes(selectedTrackId);
  function togglePlayNext() {
    if (!selectedTrack || selectedTrack.status !== 'ready') return;
    const id = selectedTrack.id;
    if (autopilot.enabled && !nextTracks.includes(id)) { autopilot.prioritize(id); return; }
    setNextTracks(previous => previous.includes(id) ? previous.filter(candidate => candidate !== id) : [...previous, id]);
  }
  const searchInput = useRef<HTMLInputElement>(null);
  const trackRows = useRef(new Map<string, HTMLTableRowElement>());
  const [beats, setBeats] = useState(32);
  const [activeDeck, setActiveDeck] = useState(0);
  const deckPositions = useRef<Array<() => number>>([]);
  const registerDeckPosition = (deck: number, getPosition: () => number) => { deckPositions.current[deck] = getPosition; };
  const [driftRate, setDriftRate] = useState(() => {
    const value = Number(localStorage.getItem('vira.master-drift-rate'));
    return Number.isFinite(value) && value >= .01 && value <= 100 ? value : 1;
  });
  const [jumpCrossfade, setJumpCrossfade] = useState(() => {
    const saved = localStorage.getItem('vira.jump-crossfade');
    return saved !== null && [0, 5, 10, 20, 30, 50, 100].includes(Number(saved)) ? Number(saved) : 30;
  });
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'jump_crossfade', jumpCrossfade); }, [decks.audio.running, jumpCrossfade]);
  const [syncQuantum, setSyncQuantum] = useState<1 | 4>(() => localStorage.getItem('vira.sync-quantum') === '1' ? 1 : 4);
  const [preserveLock, setPreserveLock] = useState(() => localStorage.getItem('vira.preserve-lock-on-load') !== 'false');
  const [resetMixer, setResetMixer] = useState(() => localStorage.getItem('vira.reset-mixer-on-load') !== 'false');
  const [showCrossfader, setShowCrossfader] = useState(() => localStorage.getItem('vira.show-crossfader') !== 'false');
  const [autoBars, setAutoBars] = useState(() => { const value = localStorage.getItem('vira.auto-bars'); return value !== null && ['0', '1', '2', '4', '8', '16', '32'].includes(value) ? Number(value) : 8; });
  const [autoFastBars, setAutoFastBars] = useState(() => { const value = localStorage.getItem('vira.auto-fast-bars'); return value !== null && ['0', '1', '2', '4', '8', '16', '32'].includes(value) ? Number(value) : 4; });
  const [autoStyle, setAutoStyle] = useState(() => { const value = localStorage.getItem('vira.auto-style'); return value === 'smart' || value === 'bass-swap' ? value : 'crossfade'; });
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'auto_style', autoStyle === 'smart' ? 2 : autoStyle === 'bass-swap' ? 1 : 0); }, [decks.audio.running, autoStyle]);
  const [autoTempo, setAutoTempo] = useState(() => localStorage.getItem('vira.auto-tempo') !== 'false');
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'auto_bars', autoBars); }, [decks.audio.running, autoBars]);
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'auto_tempo', autoTempo ? 1 : 0); }, [decks.audio.running, autoTempo]);
  const autoAvailable = (deck: number) => decks.audio.decks[deck].playing && !decks.audio.decks[1 - deck].playing && decks.audio.decks.every(d => !!d.grid && !!d.track && !d.loading && !decks.loading[d.deck] && !d.loop_out_seconds && !d.launch_pending && !d.cue_preview);
  const [alignLoops, setAlignLoops] = useState(() => localStorage.getItem('vira.align-loops') !== 'false');
  const [snapLoopPoints, setSnapLoopPoints] = useState(() => localStorage.getItem('vira.snap-loop-points') !== 'false');
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'crossfader_enabled', showCrossfader ? 1 : 0); }, [decks.audio.running, showCrossfader]);
  const loadTrack = (deck: number, trackId: string) => {
    setActiveDeck(deck);
    if (!decks.audio.decks[deck].playing) autopilot.prioritize(trackId);
    return decks.load(deck, trackId, preserveLock, resetMixer);
  };
  const [masterEntry, setMasterEntry] = useState('');
  useEffect(() => setMasterEntry(decks.audio.master_bpm == null ? '' : String(decks.audio.master_bpm)), [decks.audio.master_bpm]);
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'drift_rate', driftRate); }, [decks.audio.running]);
  useEffect(() => { if (decks.audio.running) void decks.control(0, 'sync_quantum', syncQuantum); }, [decks.audio.running]);
  const mappedPatternValues = useMidiWorkspace('pattern:');
  const mappedMusic = useMidiWorkspace('ui:music:');
  const mappedPatterns = mappedPatternValues || mappedMusic;
  const mappedRouting = useMidiWorkspace('routing:');
  const [routingVisited, setRoutingVisited] = useState(false);
  const [patternsVisited, setPatternsVisited] = useState(false);
  const [settingsQuery, setSettingsQuery] = useState('');
  const [view, setView] = useState<'decks' | 'settings' | 'shortcuts' | 'routing' | 'patterns' | 'instruments'>('decks');
  const spaceHeld = useRef(false);
  const tempoTaps = useRef<{ deck: number; generation: number; times: number[]; anchor?: number; speed: number } | null>(null);
  const [tapFeedback, setTapFeedback] = useState<{ message: string } | null>(null);
  useEffect(() => {
    if (!tapFeedback) return;
    const timer = setTimeout(() => setTapFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [tapFeedback]);
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
  const needsLibraryOpen = useRef(false);
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
      setLibrary(previous => reset || !previous || value.instance_id !== previous.instance_id || value.revision !== previous.revision || value.scan_pending !== previous.scan_pending || value.scan_error !== previous.scan_error ? value : previous);
    }
  }
  async function refresh() {
    const current = ++generation.current;
    scanning.current = true;
    setBusy(true);
    setError(null);
    try { const value = await invoke<Library>('refresh_library'); if (generation.current === current) { apply(value, true); needsLibraryOpen.current = false; setRowErrors({}); setPollError(value.scan_error ?? null); } }
    catch (e) { if (generation.current === current) { needsLibraryOpen.current = String(e).startsWith('Preparation service unavailable or scan timed out.'); setError(String(e)); } }
    finally { if (generation.current === current) { scanning.current = false; setBusy(false); } }
  }
  useEffect(() => {
    let active = true;
    const current = generation.current;
    void invoke<Library>('open_library').then(value => {
      if (active && generation.current === current) { apply(value, true); scanning.current = false; setBusy(false); setPollError(value.scan_error ?? null); }
    }).catch(e => { if (active && generation.current === current) { needsLibraryOpen.current = true; scanning.current = false; setError(String(e)); setBusy(false); } });
    return () => { active = false; };
  }, []);
  const libraryLoading = busy || !!library?.scan_pending;
  const collections = library?.collections ?? (library ? [library.music_bin] : []);
  const availableSelection = (selectedCollections ?? collections.slice(0, 1)).filter(path => collections.includes(path));
  const activeCollections = availableSelection.length || (selectedCollections?.length === 0) ? availableSelection : collections.slice(0, 1);
  const activeCollection = activeCollections[0] ?? '';
  const collectionOrderKey = activeCollections.length === 1 ? activeCollection : JSON.stringify([...activeCollections].sort());
  const collectionTracks = (library?.tracks.filter(track => activeCollections.includes(track.collection ?? library.music_bin)) ?? []).slice().sort((a, b) => {
    const order = reorderPreview ?? trackOrder[collectionOrderKey] ?? [];
    const rank = (id: string) => { const index = order.indexOf(id); return index < 0 ? order.length : index; };
    return rank(a.id) - rank(b.id);
  });
  function moveTrack(id: string, target: string, after = false, preview = false) {
    if (id === target) return;
    const ids = collectionTracks.map(track => track.id).filter(candidate => candidate !== id);
    ids.splice(ids.indexOf(target) + Number(after), 0, id);
    if (preview) { setReorderPreview(ids); return; }
    const next = { ...trackOrder, [collectionOrderKey]: ids };
    setTrackOrder(next);
    localStorage.setItem('vira.track-order', JSON.stringify(next));
  }
  useEffect(() => {
    if (!library) return;
    localStorage.setItem('vira.collections', JSON.stringify(activeCollections));
    if (activeCollection) localStorage.setItem('vira.collection', activeCollection);
  }, [library, JSON.stringify(activeCollections)]);
  function selectCollections(paths: string[]) {
    setSelectedCollections(paths);
    setSelectedTrackId(null);
    setSelectedTrackIds(new Set());
    setReorderPreview(null);
  }
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await waitForDeckLoads();
      if (cancelled) return;
      const current = generation.current;
      if (!scanning.current) {
        try {
          let reopening = needsLibraryOpen.current;
          let value = await invoke<Library>(reopening ? 'open_library' : 'get_library_state');
          if (!cancelled && current === generation.current && !scanning.current && !reopening && value.instance_id !== instance.current) {
            // A restarted service must seed its saved rows and verify the files
            // before its new instance can replace the displayed library.
            needsLibraryOpen.current = true;
            reopening = true;
            value = await invoke<Library>('open_library');
          }
          await waitForDeckLoads();
          if (!cancelled && current === generation.current && !scanning.current) {
            apply(value, reopening);
            if (reopening) { needsLibraryOpen.current = false; setError(null); }
            setPollError(value.scan_error ?? null);
          }
        } catch (e) { if (!cancelled && current === generation.current) setPollError(String(e)); }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1000);
    }
    timer = setTimeout(() => void poll(), 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  const deckAnalysis = useRef<Array<{ key: string; result: string | null }>>([]);
  useEffect(() => {
    for (const deck of decks.audio.decks) {
      const track = library?.tracks.find(track => track.id === deck.track?.track_id);
      if (!track) continue;
      const key = `${deck.generation}:${deck.track?.track_id ?? ''}`;
      const result = track && ['analysed', 'needs_review', 'approved', 'stale'].includes(track.analysis.state) && track.analysis.result
        ? JSON.stringify(track.analysis.result) : null;
      const previous = deckAnalysis.current[deck.deck];
      deckAnalysis.current[deck.deck] = { key, result };
      if (previous?.key === key && result && result !== previous.result) void decks.refreshTiming(deck.deck, deck.generation);
    }
  }, [library, decks.audio.decks]);
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
  function hasUnsavedGrid(trackId: string) {
    return decks.audio.decks.some(deck => deck.track?.track_id === trackId && !!deck.grid_edit);
  }
  async function approve(trackId: string) {
    if (hasUnsavedGrid(trackId)) return;
    const track = library?.tracks.find(candidate => candidate.id === trackId);
    if (!track || !['analysed', 'needs_review', 'stale'].includes(track.analysis.state) || approving.has(trackId)) return;
    const current = generation.current;
    setApproving(previous => new Set(previous).add(trackId));
    setRowErrors(previous => ({ ...previous, [trackId]: '' }));
    try {
      const value = await invoke<Library>('approve_track_analysis', { trackId });
      decks.clearReferenceBeats(trackId);
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
  const soundingKeys = decks.audio.decks.map(deck => shiftedKey(library?.tracks.find(track => track.id === deck.track?.track_id)?.analysis.result?.keys[0]?.key, deck.pitch_semitones ?? 0));
  const deckKeys = soundingKeys.map(key => camelotKey(key));
  const patternDeckKeys = JSON.stringify(soundingKeys.map(keyHarmony));
  useEffect(() => { if (patternsVisited || mappedPatterns) void invoke('patterns_deck_keys', { keys: JSON.parse(patternDeckKeys) }).catch(() => undefined); }, [patternsVisited, mappedPatterns, patternDeckKeys]);
  const tableTracks = collectionTracks.filter(track => tagging || !tags.selected.length || tags.tags.some(tag => tags.selected.includes(tag.name) && tag.tracks.includes(track.id)));
  const orderedTracks = tableTracks
    .map((track, originalIndex) => ({ track, originalIndex }))
    .sort((left, right) => sort && !(sortMode && libraryExpanded)
      ? compareSortValues(sortValue(left.track, sort.column, left.originalIndex, deckKeys, sessionPlayed, nextTracks), sortValue(right.track, sort.column, right.originalIndex, deckKeys, sessionPlayed, nextTracks), sort.direction) || left.originalIndex - right.originalIndex
      : left.originalIndex - right.originalIndex)
    .map(({ track }) => track);
  const autopilot = useAutopilot({
    audio: decks.audio, loading: decks.loading, tracks: orderedTracks, allTracks: library?.tracks ?? [], tags: tags.tags,
    next: nextTracks, setNext: setNextTracks, played: sessionPlayed,
    startSession: () => setSessionPlayed(previous => previous ?? new Set(playingTrackIds.filter((id): id is string => id !== null))),
    load: (deck, id) => decks.load(deck, id, preserveLock, resetMixer), control: decks.control,
  });
  const visibleTracks = orderedTracks.filter(track => `${track.title} ${track.artist} ${track.filename}`.toLowerCase().includes(search.toLowerCase()));
  const audition = useAudition(decks.audio, visibleTracks.filter(track => track.status === 'ready'), autoBars);
  const originalTrackNumbers = new Map(collectionTracks.map((track, index) => [track.id, index + 1]));
  function changeSort(column: SortColumn) {
    if (sortMode && libraryExpanded) return;
    setSort(previous => ({ column, direction: previous?.column === column
      ? previous.direction === 'ascending' ? 'descending' : 'ascending'
      : column === 'aComp' || column === 'bComp' ? 'descending' : 'ascending' }));
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
  const visibleTrackIds = visibleTracks.map(track => track.id).join('|');
  useEffect(() => {
    const ids = visibleTrackIds ? visibleTrackIds.split('|') : [];
    setSelectedTrackIds(previous => {
      const next = new Set(ids.filter(id => previous.has(id)));
      if (!next.size && ids.length) next.add(ids[0]);
      return next;
    });
    setSelectedTrackId(previous => previous && ids.includes(previous) && selectedTrackIds.has(previous) ? previous : ids.find(id => selectedTrackIds.has(id)) ?? ids[0] ?? null);
    if (selectionAnchor.current && !ids.includes(selectionAnchor.current)) selectionAnchor.current = null;
  }, [visibleTrackIds]);
  function selectTrack(id: string, event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) {
    const additive = event.metaKey || event.ctrlKey;
    const anchor = selectionAnchor.current ?? selectedTrackId ?? id;
    if (event.shiftKey) {
      selectionAnchor.current = anchor;
      const start = visibleTracks.findIndex(track => track.id === anchor);
      const end = visibleTracks.findIndex(track => track.id === id);
      const range = visibleTracks.slice(Math.max(0, Math.min(start, end)), Math.max(start, end) + 1).map(track => track.id);
      setSelectedTrackIds(previous => new Set(additive ? [...previous, ...range] : range));
    } else if (additive) {
      const next = new Set(selectedTrackIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelectedTrackIds(next);
      selectionAnchor.current = id;
      setSelectedTrackId(next.has(id) ? id : [...next].at(-1) ?? null);
      return;
    } else {
      setSelectedTrackIds(new Set([id]));
      selectionAnchor.current = id;
    }
    setSelectedTrackId(id);
  }
  useEffect(() => {
    if (view !== 'decks') return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || isKeySelector(event.target) && !isTempoTap(event)) return;
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n') {
        if (isTextInput(event.target)) return;
        event.preventDefault();
        if (!event.repeat) togglePlayNext();
        return;
      }
      if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey &&
          ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        if (isTextInput(event.target)) return;
        event.preventDefault();
        setActiveDeck(event.key === 'ArrowLeft' ? 0 : 1);
        return;
      }
      if (event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'l') {
        if (isTextInput(event.target)) return;
        event.preventDefault();
        if (event.repeat) return;
        const target = decks.audio.decks[activeDeck];
        if (decks.audio.running && target?.track && target.grid && !target.loading && !decks.loading[activeDeck]) {
          void decks.control(activeDeck, 'sync', event.shiftKey ? 0 : 1);
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
          if (target.grid) void approve(target.track!.track_id);
        } else if (target.grid || event.key.toLowerCase() === 'b') {
          if (event.key.toLowerCase() === 'b') {
            if (target.playing) return;
            const duration = target.track!.duration_seconds;
            const position = deckPositions.current[target.deck]?.() ?? target.position_seconds;
            void decks.control(target.deck, 'reference_beat', Math.min(Math.max(0, position), Math.max(0, duration - 1 / trackSampleRate(target.track))));
          } else {
            if (target.playing && decks.audio.decks.some(d => d.deck !== target.deck && d.playing)) return;
            void decks.control(target.deck, 'shift_bar_start', event.key === 'ArrowRight' ? 1 : -1);
          }
        }
        return;
      }
      if (isTempoTap(event)) {
        event.preventDefault();
        spaceHeld.current = false;
        if (event.repeat) return;
        const target = decks.audio.decks[activeDeck];
        if (!decks.audio.running || !target?.track || target.loading || decks.loading[activeDeck]) {
          tempoTaps.current = null;
          setTapFeedback({ message: `Tap ${activeDeck === 0 ? 'A' : 'B'}: ${!decks.audio.running ? 'start audio first' : !target?.track ? 'load a track first' : 'track is loading'}` });
          return;
        }
        const now = performance.now();
        const previous = tempoTaps.current;
        const continuing = previous?.deck === activeDeck && previous.generation === target.generation &&
          now - previous.times.at(-1)! <= 4000;
        const times = continuing ? [...previous.times.slice(-8), now] : [now];
        const anchor = continuing ? previous.anchor : !target.grid
          ? Math.min(Math.max(target.track.start_seconds ?? 0, deckPositions.current[activeDeck]?.() ?? target.position_seconds), target.track.duration_seconds - 1 / trackSampleRate(target.track))
          : undefined;
        const speed = continuing ? previous.speed : target.speed ?? 1;
        tempoTaps.current = { deck: activeDeck, generation: target.generation, times, anchor, speed };
        setTapFeedback({ message: `Tap ${activeDeck === 0 ? 'A' : 'B'}: 1 · keep tapping` });
        if (times.length > 1) {
          const bpm = 60000 * (times.length - 1) / (now - times[0]);
          const valid = Number.isFinite(bpm) && bpm >= 15 && bpm <= 600 && (anchor === undefined || bpm / speed >= 30 && bpm / speed <= 300);
          setTapFeedback({ message: `Tap ${activeDeck === 0 ? 'A' : 'B'}: ${valid ? `${bpm.toFixed(1)} BPM${target.synced ? ' · master' : ''}` : anchor === undefined ? 'tap between 15–600 BPM' : 'track BPM must be 30–300'}` });
          if (valid) {
            if (anchor !== undefined) void decks.control(activeDeck, 'tapped_grid', bpm / speed, { generation: target.generation, downbeatSeconds: anchor });
            else void decks.control(activeDeck, target.synced ? 'master_tempo' : 'tempo', bpm);
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
        if (decks.audio.running && target?.track) void decks.control(deck, 'play_pause');
        return;
      }
      const tracks = visibleTracks ?? [];
      if (event.metaKey && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const track = tracks.find(candidate => candidate.id === selectedTrackId);
        const deck = event.key === 'ArrowLeft' ? 0 : 1;
        const target = decks.audio.decks[deck];
        if (track?.status === 'ready' && decks.audio.running && target && canLoadDeck(target) && !target.loading && !decks.loading[deck]) void loadTrack(deck, track.id);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (!tracks.length) return;
        event.preventDefault();
        const current = tracks.findIndex(track => track.id === selectedTrackId);
        const next = current < 0 ? 0 : Math.max(0, Math.min(tracks.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)));
        const id = tracks[next].id;
        selectTrack(id, event);
        trackRows.current.get(id)?.scrollIntoView?.({ block: 'nearest' });
        return;
      }
      if (event.key.length === 1 && !/\s/u.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey && !isTextInput(event.target)) {
        event.preventDefault();
        searchInput.current?.focus();
        setSearch(previous => previous + event.key);
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key === ' ' || event.code === 'Space') spaceHeld.current = false;
    }
    function clearSpaceHeld() { spaceHeld.current = false; tempoTaps.current = null; }
    // Capture before focused inputs and dropdowns can stop keyboard propagation.
    function onTapCapture(event: KeyboardEvent) { if (isTempoTap(event)) onKeyDown(event); }
    window.addEventListener('keydown', onTapCapture, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearSpaceHeld);
    return () => {
      window.removeEventListener('keydown', onTapCapture, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearSpaceHeld);
    };
  }, [view, visibleTracks, selectedTrackId, decks.audio, decks.loading, preserveLock, resetMixer, activeDeck, library, approving, selectedTrackIds, autopilot.enabled, nextTracks]);
  useJogTargets(decks.audio, decks.control);
  const midi = useMidiMarkers();
  useMidiTargets([
    {id:'master:tempo',label:'Master BPM',kind:'number',min:15,max:600,step:.01,read:() => decks.audio.master_bpm ?? 120,apply:value => { void decks.control(0,'master_tempo',value); }},
    ...(['master', 'cue'] as const).map(output => ({ id: `output:${output}:volume`, label: `${output === 'master' ? 'Master' : 'Cue'} volume`, kind: 'number' as const, min: 0, max: 1, step: .01, read: () => decks.audio[`${output}_volume`] ?? 1, apply: (value: number) => { void decks.control(0, `${output}_volume`, value); } })),
  ]);
  return <main className={view === 'decks' && libraryExpanded ? 'library-expanded' : undefined} onFocusCapture={event => { if (!isTextInput(event.target) && !isKeySelector(event.target)) event.target.blur(); }} onClickCapture={event => { if (event.target instanceof HTMLElement && !isTextInput(event.target) && !isKeySelector(event.target)) event.target.blur(); }}>
    <header className="app-header"><h1><img className="app-wordmark" src="/vira-wordmark.svg" alt="VIRA" /></h1>
      <nav aria-label="Workspace"><MidiButton midiId="workspace:decks" className={view === 'decks' ? 'active' : undefined} aria-current={view === 'decks' ? 'page' : undefined} onClick={() => setView('decks')}>DECKS</MidiButton><MidiButton midiId="workspace:routing" className={view === 'routing' ? 'active' : undefined} aria-current={view === 'routing' ? 'page' : undefined} onClick={() => { setRoutingVisited(true); setView('routing'); }}>ROUTING</MidiButton><MidiButton midiId="workspace:patterns" className={view === 'patterns' ? 'active' : undefined} aria-current={view === 'patterns' ? 'page' : undefined} onClick={() => { setPatternsVisited(true); setView('patterns'); }}>PATTERNS</MidiButton><MidiButton midiId="workspace:instruments" className={view === 'instruments' ? 'active' : undefined} aria-current={view === 'instruments' ? 'page' : undefined} onClick={() => setView('instruments')}>INSTRUMENTS</MidiButton><MidiButton midiId="workspace:settings" className={view === 'settings' ? 'active' : undefined} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => { setView('settings'); }}>SETTINGS</MidiButton><MidiButton midiId="workspace:shortcuts" className={view === 'shortcuts' ? 'active' : undefined} aria-current={view === 'shortcuts' ? 'page' : undefined} onClick={() => { setView('shortcuts'); }}>SHORTCUTS</MidiButton></nav>
      {view === 'decks' && tapFeedback && <span className="tap-tempo-feedback" role="status" aria-label="Tap tempo">{tapFeedback.message}</span>}
      <div className="master-tempo">
        <MidiButton className="master-drift deck-0" aria-label="Drift master tempo to deck A; double-click to set instantly" title="Click to drift · double-click to set instantly" disabled={!decks.audio.decks[0].grid || decks.audio.decks[0].grid.bpm.toFixed(1) === (decks.audio.master_bpm ?? 120).toFixed(1)} onClick={event => driftOrSet(0, event.detail)} onDoubleClick={() => setFromDeck(0)}>A {decks.audio.decks[0].grid?.bpm.toFixed(1) ?? '—'} ←</MidiButton>
        <div className="master-tempo-value">{tempoEntry === null ? <output {...midi("master:tempo")} className="master-bpm-edit" title="Drag to adjust BPM · click to enter target BPM" onPointerDown={event => { masterTempoDragged.current = false; dragMasterTempo(event); }} onClick={() => { if (!masterTempoDragged.current) setTempoEntry(String(decks.audio.master_bpm ?? 120)); masterTempoDragged.current = false; }} aria-label="Master BPM">{decks.audio.master_bpm?.toFixed(1) ?? '—'}</output> : <MidiInput className="master-bpm-input" aria-label="Target master BPM" type="text" inputMode="decimal" value={tempoEntry} ref={element => { if (element && document.activeElement !== element) { element.focus(); element.select(); } }} onChange={event => setTempoEntry(event.target.value)} onBlur={() => setTempoEntry(null)} onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); setTempoEntry(null); }
          if (event.key === 'Enter') {
            event.preventDefault();
            const target = Number(tempoEntry);
            if (tempoEntry.trim() && Number.isFinite(target) && target >= 15 && target <= 600) { setTempoEntry(null); void decks.control(0, 'master_target', target); }
          }
        }} />}<span className="tempo-drag" onPointerDown={dragMasterTempo}>bpm</span>{decks.audio.drift_target != null && <small>DRIFT TO {decks.audio.drift_target === 0 ? 'A' : 'B'}</small>}</div>
        <MidiButton className="master-drift deck-1" aria-label="Drift master tempo to deck B; double-click to set instantly" title="Click to drift · double-click to set instantly" disabled={!decks.audio.decks[1].grid || decks.audio.decks[1].grid.bpm.toFixed(1) === (decks.audio.master_bpm ?? 120).toFixed(1)} onClick={event => driftOrSet(1, event.detail)} onDoubleClick={() => setFromDeck(1)}>→ {decks.audio.decks[1].grid?.bpm.toFixed(1) ?? '—'} B</MidiButton>
      </div>
      <div className="output-volumes" role="group" aria-label="Output volumes">
        {(['master', 'cue'] as const).map(output => <label key={output}>
          <span>{output === 'master' ? 'MASTER' : 'CUE'}</span>
          <MidiInput midiId={`output:${output}:volume`} handleSize="small" type="range" aria-label={`${output === 'master' ? 'Master' : 'Cue'} volume`} min="0" max="1" step="0.01" value={decks.audio[`${output}_volume`] ?? 1} title={`${Math.round((decks.audio[`${output}_volume`] ?? 1) * 100)}%`} onChange={event => void decks.control(0, `${output}_volume`, Number(event.target.value))} />
        </label>)}
      </div>
    </header>
    {(patternsVisited || mappedPatterns) && <Patterns active={view === 'patterns'} />}
    {(routingVisited || mappedRouting) && <Routing active={view === 'routing'} />}
    <div className="midi-page-host" hidden={view !== 'decks'}>
    <RollingWaveforms audio={decks.audio} beats={beats} onZoomChange={setBeats} control={decks.control} onInteract={setActiveDeck} activeDeck={activeDeck} />
    <Mixer audio={decks.audio} control={decks.control} showCrossfader={showCrossfader}
      deckA={<Deck otherPlaying={decks.audio.decks[1].playing} autoFastBars={autoFastBars} autoFast={decks.audio.auto_fast} transition={decks.audio.auto_transition} autoAvailable={autoAvailable(0)} autoMode={decks.audio.auto_mode?.[0]} otherKey={soundingKeys[1]} state={decks.audio.decks[0]} running={decks.audio.running} loading={decks.loading[0]} loadingTitle={library?.tracks.find(track => track.id === decks.loadingTrackIds[0])?.title} error={decks.errors[0]} load={loadTrack} control={autopilot.control} syncQuantum={syncQuantum} alignLoops={alignLoops} snapLoopPoints={snapLoopPoints} showVolume={false} onInteract={setActiveDeck} registerPosition={registerDeckPosition} active={activeDeck === 0} trackKey={library?.tracks.find(track => track.id === decks.audio.decks[0].track?.track_id)?.analysis.result?.keys[0]?.key} analysisState={library?.tracks.find(track => track.id === decks.audio.decks[0].track?.track_id)?.analysis.state} analyse={() => { const track = library?.tracks.find(track => track.id === decks.audio.decks[0].track?.track_id); if (track) void analyse(track); }} analysing={pending.has(decks.audio.decks[0].track?.track_id ?? '')} approveAnalysis={() => { const id = decks.audio.decks[0].track?.track_id; if (id) void approve(id); }} gridEditing={hasUnsavedGrid(decks.audio.decks[0].track?.track_id ?? '')} approving={approving.has(decks.audio.decks[0].track?.track_id ?? '')} approvalError={rowErrors[decks.audio.decks[0].track?.track_id ?? '']} />}
      deckB={<Deck otherPlaying={decks.audio.decks[0].playing} autoFastBars={autoFastBars} autoFast={decks.audio.auto_fast} transition={decks.audio.auto_transition} autoAvailable={autoAvailable(1)} autoMode={decks.audio.auto_mode?.[1]} otherKey={soundingKeys[0]} state={decks.audio.decks[1]} running={decks.audio.running} loading={decks.loading[1]} loadingTitle={library?.tracks.find(track => track.id === decks.loadingTrackIds[1])?.title} error={decks.errors[1]} load={loadTrack} control={autopilot.control} syncQuantum={syncQuantum} alignLoops={alignLoops} snapLoopPoints={snapLoopPoints} showVolume={false} onInteract={setActiveDeck} registerPosition={registerDeckPosition} active={activeDeck === 1} trackKey={library?.tracks.find(track => track.id === decks.audio.decks[1].track?.track_id)?.analysis.result?.keys[0]?.key} analysisState={library?.tracks.find(track => track.id === decks.audio.decks[1].track?.track_id)?.analysis.state} analyse={() => { const track = library?.tracks.find(track => track.id === decks.audio.decks[1].track?.track_id); if (track) void analyse(track); }} analysing={pending.has(decks.audio.decks[1].track?.track_id ?? '')} approveAnalysis={() => { const id = decks.audio.decks[1].track?.track_id; if (id) void approve(id); }} gridEditing={hasUnsavedGrid(decks.audio.decks[1].track?.track_id ?? '')} approving={approving.has(decks.audio.decks[1].track?.track_id ?? '')} approvalError={rowErrors[decks.audio.decks[1].track?.track_id ?? '']} />} />
    {(decks.audio.error || decks.pollError) && <p className="error" role="alert">{decks.audio.error || decks.pollError}</p>}
    <div className="lower-panels"><section className="library" aria-label="Music library" aria-busy={libraryLoading}>
      <div className="toolbar"><div className="library-heading"><h2>Music library</h2><AuditionControls audition={audition} />{libraryLoading && <span className="library-loading-indicator" role="status">{busy ? 'Loading library…' : 'Verifying files…'}</span>}
      </div><div className="library-toolbar-actions"><MidiButton midiId="library:play-next" className="library-next" aria-pressed={selectedIsNext} disabled={selectedTrack?.status !== 'ready'} title={selectedIsNext ? 'Remove selected track from planned order (⌘N)' : 'Add selected track to planned order (⌘N)'} onClick={togglePlayNext}>{selectedIsNext ? 'Cancel Play Next' : 'Play Next'}</MidiButton><MidiButton midiId="library:autopilot" className={`library-autopilot${autopilot.enabled ? ' auto-engaged' : ''}`} aria-pressed={autopilot.enabled} onClick={autopilot.toggle} title="Choose unplayed tracks and prepare automatic transitions">Autopilot</MidiButton>{sessionActive ? <MidiButton midiId="session:toggle" onClick={endSession}>End Session</MidiButton> : <MidiButton midiId="session:toggle" onClick={() => setSessionPlayed(new Set(playingTrackIds.filter((id): id is string => id !== null)))} title="Track songs played on either deck">Start Session</MidiButton>}{libraryExpanded && <MidiButton className="library-sort" aria-pressed={tagging} onClick={() => setTagMode(value => !value)}>Tag tracks</MidiButton>}{libraryExpanded && <MidiButton className="library-sort" aria-pressed={sortMode} onClick={() => { setSortMode(value => !value); setSort({ column: 'number', direction: 'ascending' }); }}>Sort</MidiButton>}{libraryExpanded && !decks.audio.decks.some(deck => deck.playing) && <><MidiButton className="library-sort" aria-pressed={audition.playAll} onClick={audition.togglePlayAll}>Play All</MidiButton></>}{libraryExpanded && !decks.audio.decks.some(deck => deck.playing) && <CollectionSelector collections={['cue', 'master']} value={audition.output} select={value => audition.changeOutput(value as 'cue' | 'master')} label="Audition output" menuLabel="Audition outputs" optionLabel={value => value === 'master' ? 'Play on Master' : 'Play on Cue'} />}<MidiButton onClick={() => void analyseAll()} disabled={busy || !!error || !!pollError || queueingAll || unanalysedTracks.length === 0}>{queueingAll ? 'Queueing…' : 'Analyse all'}</MidiButton><MidiButton midiId="library:refresh" onClick={() => void refresh()} disabled={busy}>{busy ? 'Scanning…' : 'Refresh'}</MidiButton><MidiButton midiId="library:expanded" className="library-expand" aria-label={libraryExpanded ? 'Restore library size' : 'Expand music library'} title={libraryExpanded ? 'Restore library size' : 'Expand music library'} aria-pressed={libraryExpanded} onClick={() => setLibraryExpanded(expanded => !expanded)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={libraryExpanded ? 'M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6'} /></svg>
      </MidiButton></div></div>
      {audition.error && <p className="error" role="alert">{audition.error}</p>}
      <div className="library-filters"><CollectionSelector loading={!library && busy} collections={collections} value={activeCollection} values={activeCollections} select={path => selectCollections([path])} selectMany={selectCollections} /><label className="library-search"><span aria-hidden="true">⌕</span><MidiInput ref={searchInput} type="search" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-label="Search music library" placeholder="Search tracks, artists…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      {(error || pollError) && <div className="error" role="alert"><strong>Library unavailable</strong><p>{error || pollError}</p>
        {library && <p>The table shows the last successful scan; it may be out of date.</p>}</div>}
      <div className="library-content"><TagsSidebar state={tags} tracks={collectionTracks} tagging={tagging} selectedIds={visibleTracks.filter(track => selectedTrackIds.has(track.id)).map(track => track.id)} /><div className="library-track-list"><div className="table-wrap"><table className={`collection-table${sortMode && libraryExpanded ? ' reorder-mode' : ''}`}><colgroup><col className="number-col" /><col className="audition-col" /><col className="cover-col" /><col className="title-col" /><col className="artist-col" /><col className="bpm-col" /><col className="key-col" /><col className="compat-col" /><col className="compat-col" /><col className="length-col" />{nextTracks.length > 0 && <col className="next-col" />}{sessionActive && <col className="played-col" />}<col className="analysis-col" /><col className="action-col" /></colgroup><thead><tr>
        {([['number', '#'], ['cover', 'Cover'], ['title', 'Title'], ['artist', 'Artist'], ['bpm', 'BPM*'], ['key', 'Key*'], ['aComp', 'A comp'], ['bComp', 'B comp'], ['length', 'Length'], ['next', 'Next'], ['played', 'Played'], ['analysis', 'Analysis'], ['actions', 'Actions']] as const).map(([column, label]) => ((!sessionActive && column === 'played') || (nextTracks.length === 0 && column === 'next') ? null :
          <Fragment key={column}><th scope="col" aria-sort={sort?.column === column ? sort.direction : 'none'}><MidiButton className="sort-header" disabled={sortMode && libraryExpanded} onClick={() => changeSort(column)} aria-label={`Sort by ${label.replace('*', '')}`} title={`Sort by ${label.replace('*', '')}`}>{column === 'cover' ? '▣' : column === 'actions' ? '•••' : label}<span className="sort-indicator" aria-hidden="true">{sort?.column === column ? sort.direction === 'ascending' ? '▲' : '▼' : '↕'}</span></MidiButton></th>{column === 'number' && <th scope="col" aria-label="Audition through cue headphones"><span aria-hidden="true">▶</span></th>}</Fragment>))}
      </tr></thead><tbody>{visibleTracks?.map(track => {
        const auditionActive = audition.selection?.track.id === track.id && (audition.selection.generation === null || !audition.state || audition.state.playing);
        const originalNumber = originalTrackNumbers.get(track.id) ?? 1;
        const onDeckA = decks.audio.decks[0].track?.track_id === track.id;
        const onDeckB = decks.audio.decks[1].track?.track_id === track.id;
        const trackKey = camelotKey(track.analysis.result?.keys[0]?.key);
        const trackBpm = track.timing_bpm ?? track.analysis.result?.grid?.bpm;
        return <tr key={track.id} ref={element => { if (element) trackRows.current.set(track.id, element); else trackRows.current.delete(track.id); }} className={[nextTracks.includes(track.id) ? 'next-track' : '', sessionPlayed?.has(track.id) ? 'played-track' : '', selectedTrackIds.has(track.id) ? 'selected-track' : '', reorderPreview && reorderId.current === track.id ? 'track-dragging' : ''].filter(Boolean).join(' ') || undefined} aria-selected={selectedTrackIds.has(track.id)} draggable={sortMode && libraryExpanded || track.status === 'ready'} onDragOver={event => {
          if (!sortMode || !libraryExpanded || !reorderId.current) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          const from = collectionTracks.findIndex(candidate => candidate.id === reorderId.current);
          const to = collectionTracks.findIndex(candidate => candidate.id === track.id);
          const rect = event.currentTarget.getBoundingClientRect();
          const after = event.clientY > rect.top + rect.height / 2;
          if (from < to && after || from > to && !after) moveTrack(reorderId.current, track.id, after, true);
        }} onDrop={event => { if (sortMode && libraryExpanded) { event.preventDefault(); if (reorderPreview) { const next = { ...trackOrder, [collectionOrderKey]: reorderPreview }; setTrackOrder(next); localStorage.setItem('vira.track-order', JSON.stringify(next)); } else if (reorderId.current) moveTrack(reorderId.current, track.id, event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2); reorderId.current = null; setReorderPreview(null); } }} onDragEnd={() => { reorderId.current = null; setReorderPreview(null); }} onClick={event => { if (!(event.target instanceof Element && event.target.closest('.row-actions, .audition-cell'))) selectTrack(track.id, event); }} onDoubleClick={event => { if (!(event.target instanceof Element && event.target.closest('.row-actions, .audition-cell'))) loadOnAvailableDeck(track); }} onDragStart={event => { const ids = selectedTrackIds.has(track.id) ? visibleTracks.filter(candidate => selectedTrackIds.has(candidate.id)).map(candidate => candidate.id) : [track.id]; if (!selectedTrackIds.has(track.id)) selectTrack(track.id, { metaKey: false, ctrlKey: false, shiftKey: false }); event.dataTransfer.setData(TRACKS_MIME, JSON.stringify(ids)); event.dataTransfer.setData(TRACK_MIME, track.id); if (sortMode && libraryExpanded) { reorderId.current = track.id; setReorderPreview(collectionTracks.map(candidate => candidate.id)); event.dataTransfer.setData('text/plain', track.id); event.dataTransfer.effectAllowed = 'copyMove'; return; } event.dataTransfer.effectAllowed = 'copy'; }}>
        <td className="row-number numeric"><span className={`track-index${onDeckA ? ' on-deck-a' : ''}${onDeckB ? ' on-deck-b' : ''}`}>{originalNumber}</span></td><td className="audition-cell"><MidiButton midiId={`track:${track.id}:audition`} className={`audition-play${audition.selection?.track.id === track.id ? ' active' : ''}`} aria-label={auditionActive ? `Stop auditioning ${track.title}` : `Audition ${track.title} through ${audition.output === 'master' ? 'master output' : 'cue headphones'}`} title={auditionActive ? 'Stop audition' : audition.output === 'master' ? 'Audition through master output' : decks.audio.routing?.cue_running ? 'Audition through cue headphones' : 'Select Cue headphones in Settings'} disabled={track.status !== 'ready' || !decks.audio.running} onClick={() => auditionActive ? audition.control('stop') : void audition.play(track)} onDoubleClick={event => event.stopPropagation()}>{auditionActive ? <StopIcon /> : <PlayIcon />}</MidiButton></td><td><TrackArtwork trackId={track.id} available={!!track.artwork_available} className={`collection-cover cover-${(originalNumber - 1) % 6}`} /></td>
        <td><span className="collection-cell-text title" title={track.filename}>{track.title}</span>{tags.tags.some(tag => tag.tracks.includes(track.id)) && <span className="track-tag-summary" title={tags.tags.filter(tag => tag.tracks.includes(track.id)).map(tag => tag.name).join(', ')}>{tags.tags.filter(tag => tag.tracks.includes(track.id)).map(tag => tag.name).join(' · ')}</span>}</td>
        <td><span className="collection-cell-text" title={track.artist}>{track.artist}</span></td>
        <td className="numeric">{trackBpm == null ? '—' : Math.round(trackBpm)}</td><td><span className="collection-cell-text" title={track.analysis.result?.keys[0]?.key ?? ''}>{trackKey ? `${trackKey.number}${trackKey.letter} / ${trackKey.label}` : track.analysis.result?.keys[0]?.key ?? '—'}</span></td>
        <CompatibilityCell trackKey={trackKey} deckKey={deckKeys[0]} deck="A" /><CompatibilityCell trackKey={trackKey} deckKey={deckKeys[1]} deck="B" /><td className="numeric">{duration(track.duration_seconds)}</td>
        {nextTracks.length > 0 && <td className="next-cell numeric">{nextTracks.includes(track.id) ? nextTracks.indexOf(track.id) + 1 : '—'}</td>}
        {sessionActive && <td className="played-cell">{sessionPlayed.has(track.id) ? 'Yes' : 'No'}</td>}
        <td><span className={`status ${track.status} ${track.analysis.state}`}>{track.status === 'ready' ? labels[track.analysis.state] : track.status === 'unsupported' ? 'Unsupported' : 'Unreadable'}</span>
          {(track.error || (track.analysis.state !== 'stale' && track.analysis.error)) && <small className="row-error">{track.error || track.analysis.error}</small>}
          {rowErrors[track.id] && <small className="row-error" role="alert">{rowErrors[track.id]}</small>}</td>
        <td><TrackActions title={track.title}><div className="row-action-buttons"><MidiButton onClick={() => void analyse(track)} disabled={busy || track.status !== 'ready' || pending.has(track.id) || ['queued', 'analysing'].includes(track.analysis.state)}
          midiId={`track:${track.id}:analyse`} aria-label={`${track.analysis.state === 'failed' ? 'Retry' : track.analysis.state === 'not_analysed' ? 'Analyse' : 'Reanalyse'} ${track.title}`}>
          {track.analysis.state === 'failed' ? 'Retry' : track.analysis.state === 'not_analysed' ? 'Analyse' : ['queued', 'analysing'].includes(track.analysis.state) ? labels[track.analysis.state] : 'Reanalyse'}
        </MidiButton>{trackBpm != null && track.analysis.state !== 'approved' && <MidiButton onClick={() => void approve(track.id)} disabled={hasUnsavedGrid(track.id) || busy || track.status !== 'ready' || pending.has(track.id) || approving.has(track.id) || !['analysed', 'needs_review', 'stale'].includes(track.analysis.state)} midiId={`track:${track.id}:approve`} aria-label={`Approve ${track.title}`}>{approving.has(track.id) ? 'Approving…' : 'Approve'}</MidiButton>}<div className="row-loads"><MidiButton disabled={track.status !== 'ready' || !decks.audio.running || !canLoadDeck(decks.audio.decks[0])} midiId={`track:${track.id}:load-a`} aria-label={`Load ${track.title} on deck A`} onClick={() => void loadTrack(0, track.id)}>Load A</MidiButton>
          <MidiButton disabled={track.status !== 'ready' || !decks.audio.running || !canLoadDeck(decks.audio.decks[1])} midiId={`track:${track.id}:load-b`} aria-label={`Load ${track.title} on deck B`} onClick={() => void loadTrack(1, track.id)}>Load B</MidiButton></div><TrackTags state={tags} track={track} /></div></TrackActions></td>
      </tr>})}</tbody></table></div>
      {!libraryLoading && !error && !pollError && library && collectionTracks.length === 0 && <p className="empty">{!activeCollections.length && collections.length ? 'Select a category to see its tracks.' : collections.length ? 'No files in this collection. Add MP3, PCM WAV or Ogg files, then Refresh.' : 'Add a music folder in Settings to load a collection.'}</p>}
      {!libraryLoading && library && collectionTracks.length > 0 && visibleTracks?.length === 0 && <p className="empty">No tracks match your search or selected tags.</p>}
      </div></div>
      <footer role="status">{libraryLoading ? 'Reading file metadata…' : library ? `${collectionTracks.length} files · ${collectionTracks.filter(t => t.status === 'ready').length} readable` : 'No scan available'}
        <span>*BPM uses saved timing corrections when available; otherwise BPM and key are automatic draft estimates.</span></footer>
    </section><Patches /></div>
    </div>{view === 'instruments' && <Instruments />}{view === 'shortcuts' && <Shortcuts />}<section hidden={view !== 'settings'} className="settings-page" aria-label="Settings"><div className="settings-inner"><div className="settings-heading"><div><h2>Settings</h2><p>Workspace controls and system status</p></div><SettingsSearch label="Search settings" value={settingsQuery} onChange={setSettingsQuery} /></div><SettingsSearchContext.Provider value={settingsQuery}><div className="settings-grid">
      <Audio audio={decks.audio} /><MidiSettings /><JogSettings />
      <SettingsCard className="settings-card"><h3>Automatic transitions</h3><div className="settings-row"><div><strong>Autopilot next track</strong><p>List order follows the current library sort after the playing track, wrapping to remaining unplayed tracks. Automatic uses the Autopilot weights below. Both use the selected categories and tags, ignore search, and give manual Play Next choices priority.</p></div><MidiSelect aria-label="Autopilot next track" value={autopilot.selection} onChange={event => autopilot.changeSelection(event.target.value as AutopilotSelection)}><option value="automatic">Automatic (use parameters)</option><option value="list">List order</option></MidiSelect></div><div className="settings-row"><div><strong>Transition mode</strong><p>Crossfade brings the incoming track up over 0–80% of the transition and fades the outgoing track down over 20–100%. Bass swap holds the outgoing level while bringing in the incoming track with bass cut, gradually cuts the outgoing high EQ as the incoming fader rises, swaps bass just before the halfway beat, then fades out the outgoing track. Smart uses a clear bass return on an incoming bar boundary instead of the midpoint, otherwise it follows Bass swap exactly.</p></div><MidiSelect aria-label="Automatic transition mode" value={autoStyle} onChange={event => { setAutoStyle(event.target.value); localStorage.setItem('vira.auto-style', event.target.value); }}><option value="crossfade">Crossfade</option><option value="bass-swap">Bass swap</option><option value="smart">Smart</option></MidiSelect></div><div className="settings-row"><div><strong>Overlap</strong><p>AUTO NOW uses the next matching phrase position on the beat grids. AUTO END uses the last matching phrase with room for this overlap, ignoring partial bars or tails at the file end. The incoming cue is preserved and a shorter overlap is used if needed. Library Play All overlaps the final bars. No overlap hands off at the end.</p></div><MidiSelect aria-label="Automatic transition overlap" value={autoBars} onChange={event => { setAutoBars(Number(event.target.value)); localStorage.setItem('vira.auto-bars', event.target.value); }}>{[0, 1, 2, 4, 8, 16, 32].map(value => <option key={value} value={value}>{value === 0 ? 'No overlap' : `${value} ${value === 1 ? 'bar' : 'bars'}`}</option>)}</MidiSelect></div><div className="settings-row"><div><strong>Fast transition overlap</strong><p>Double-click AUTO NOW or AUTO END to use this overlap. The selected button blinks faster. Single-click the blinking button to cancel.</p></div><MidiSelect aria-label="Fast transition overlap" value={autoFastBars} onChange={event => { setAutoFastBars(Number(event.target.value)); localStorage.setItem('vira.auto-fast-bars', event.target.value); }}>{[0, 1, 2, 4, 8, 16, 32].map(value => <option key={value} value={value}>{value === 0 ? 'No overlap' : `${value} ${value === 1 ? 'bar' : 'bars'}`}</option>)}</MidiSelect></div><div className="settings-row"><div><strong>Master BPM during transition</strong><p>Both decks lock to master BPM when engaged. Tempo changes span the crossfade. Changes here apply to the next transition.</p></div><MidiSelect aria-label="Automatic transition tempo" value={autoTempo ? 'change' : 'keep'} onChange={event => { const enabled = event.target.value === 'change'; setAutoTempo(enabled); localStorage.setItem('vira.auto-tempo', String(enabled)); }}><option value="change">Move to incoming track BPM</option><option value="keep">Keep current master BPM</option></MidiSelect></div></SettingsCard>
      <SettingsCard className="settings-card"><h3>Autopilot</h3><p className="settings-hint">Chooses unplayed tracks from the selected categories and tags, ignoring search. In Automatic mode, the weights below choose the next track; equal scores are chosen at random. List order skips these weights. Start playback to begin automatic transitions; both decks need timing grids.</p>{([['bpm', 'BPM proximity', 'Prefer tempos within 10% of the playing track’s original BPM.'], ['tags', 'Shared tags', 'Prefer tracks sharing more of the playing track’s tags.'], ['harmonic', 'Harmonic compatibility', 'Prefer the same key, neighbours on the circle of fifths, or the relative major/minor.'], ['direction', 'BPM direction', 'Prefer continuing the last transition’s rise or fall in original BPM. No preference before the first transition or after equal BPM.'], ['randomness', 'Randomness', 'Add a fresh random score to each candidate when choosing the next track. Zero disables this factor.']] as const).map(([key, label, description]) => <div className="settings-row" key={key}><div><strong>{label}</strong><p>{description}</p></div><label className="autopilot-weight"><MidiInput type="range" min="0" max="100" step="1" aria-label={`Autopilot ${label.toLowerCase()} weight`} value={autopilot.weights[key]} onChange={event => autopilot.changeWeight(key, Number(event.target.value))} /><output>{autopilot.weights[key]}</output></label></div>)}</SettingsCard>
      <SettingsCard className="settings-card"><h3>Waveform jumps</h3><div className="settings-row"><div><strong>Jump crossfade</strong><p>Blend the outgoing audio into the new position when clicking a moving triangle on the waveform. Keeps the jump aligned to the musical grid.</p></div><MidiSelect aria-label="Jump crossfade duration" value={jumpCrossfade} onChange={event => { const duration = Number(event.target.value); setJumpCrossfade(duration); localStorage.setItem('vira.jump-crossfade', String(duration)); }}>{[0, 5, 10, 20, 30, 50, 100].map(duration => <option key={duration} value={duration}>{duration === 0 ? 'Off' : `${duration} ms`}</option>)}</MidiSelect></div></SettingsCard>
      <SettingsCard className="settings-card"><h3>Loops</h3><div className="settings-row"><div><strong>Align length loops to the beat grid</strong><p>Loop the musical segment containing the playhead. Lengths are in bars: 1/4 is one beat, 1 is one bar. Turn off to start at the playhead.</p></div><MidiInput type="checkbox" aria-label="Align length loops to the beat grid" checked={alignLoops} onChange={event => { setAlignLoops(event.target.checked); localStorage.setItem('vira.align-loops', String(event.target.checked)); }} /></div><div className="settings-row"><div><strong>Snap IN and OUT to nearest beat</strong><p>Place manual loop markers on the nearest beat when the track has a timing grid.</p></div><MidiInput type="checkbox" aria-label="Snap IN and OUT to nearest beat" checked={snapLoopPoints} onChange={event => { setSnapLoopPoints(event.target.checked); localStorage.setItem('vira.snap-loop-points', String(event.target.checked)); }} /></div></SettingsCard>
      <SettingsCard className="settings-card"><h3>Mixer</h3><div className="settings-row"><div><strong>Show crossfader</strong><p>Equal-power blending between decks A and B. Hiding it bypasses the crossfader.</p></div><MidiInput type="checkbox" aria-label="Show crossfader" checked={showCrossfader} onChange={event => { setShowCrossfader(event.target.checked); localStorage.setItem('vira.show-crossfader', String(event.target.checked)); }} /></div></SettingsCard>
      <SettingsCard className="settings-card"><h3>Loading tracks</h3><div className="settings-row"><div><strong>Keep deck locked</strong><p>Keep a deck locked to master BPM when its next track has a usable timing grid.</p></div><MidiInput type="checkbox" aria-label="Keep deck locked when loading a track" checked={preserveLock} onChange={event => { setPreserveLock(event.target.checked); localStorage.setItem('vira.preserve-lock-on-load', String(event.target.checked)); }} /></div><div className="settings-row"><div><strong>Reset EQ and filter</strong><p>Start each new track with neutral EQ and filter. The deck volume stays where you set it. Gain is always restored from the track.</p></div><MidiInput type="checkbox" aria-label="Reset EQ and filter when loading a track" checked={resetMixer} onChange={event => { setResetMixer(event.target.checked); localStorage.setItem('vira.reset-mixer-on-load', String(event.target.checked)); }} /></div></SettingsCard>
      <FolderSettings onMusicChange={async folders => {
        setSelectedCollections(current => { const remaining = (current ?? []).filter(path => folders.includes(path)); return remaining.length ? remaining : folders.slice(0, 1); });
        await refresh();
      }} />
      <SettingsCard className="settings-card"><h3>Audio engine</h3><div className="settings-row"><span>Native output</span><output className={decks.audio.running ? 'settings-live' : undefined}>{decks.audio.running ? `Running · stereo ${(decks.audio.telemetry.sample_rate ?? 48000) / 1000} kHz` : 'Starting / unavailable'}</output></div><div className="settings-row"><span>Starved frames</span><output>{decks.audio.telemetry.callback?.starved_frames ?? 0}</output></div><div className="settings-row"><span>Device errors</span><output>{decks.audio.telemetry.callback?.device_errors ?? 0}</output></div>{(decks.audio.error || decks.pollError) && <p className="settings-error" role="alert">{decks.audio.error || decks.pollError}</p>}</SettingsCard>
      <SettingsCard className="settings-card"><h3>Tempo</h3><div className="settings-row"><strong>Master BPM</strong><label><MidiInput type="number" aria-label="Set master BPM" min="15" max="600" step="0.01" value={masterEntry} onChange={event => setMasterEntry(event.target.value)} /> BPM</label><MidiButton disabled={!Number.isFinite(Number(masterEntry)) || Number(masterEntry) < 15 || Number(masterEntry) > 600} onClick={() => void decks.control(0, 'master_tempo', Number(masterEntry))}>Set</MidiButton></div><div className="settings-row"><div><strong>Master tempo drift</strong><p>How fast master BPM moves toward an entered target or a track’s original BPM.</p></div><label><MidiInput type="number" aria-label="Master tempo drift rate" min="0.01" max="100" step="0.01" value={driftRate} onChange={event => { const rate = Number(event.target.value); if (rate >= .01 && rate <= 100) { setDriftRate(rate); localStorage.setItem('vira.master-drift-rate', String(rate)); void decks.control(0, 'drift_rate', rate); } }} /> BPM/sec</label></div><div className="settings-row"><div><strong>Locked deck start</strong><p>Bar joins immediately during beat 1; later presses wait for the next bar. Beat waits for the next beat. Setting Cue on a locked deck snaps to the nearest selected boundary.</p></div><MidiSelect aria-label="Locked deck start" value={syncQuantum} onChange={event => { const quantum = Number(event.target.value) as 1 | 4; setSyncQuantum(quantum); localStorage.setItem('vira.sync-quantum', String(quantum)); void decks.control(0, 'sync_quantum', quantum); }}><option value={1}>Beat</option><option value={4}>Bar</option></MidiSelect></div><div className="settings-row"><span>Time signature</span><output>4/4</output></div>{decks.errors[0] && <p className="settings-error" role="alert">{decks.errors[0]}</p>}</SettingsCard>
    </div><p className="settings-search-empty" role="status">No settings match your search.</p></SettingsSearchContext.Provider></div></section>
    <MidiEditor /><div className="audio-status" role="status"><span className={decks.audio.running ? 'connection-live' : ''}>●</span> Native output: {decks.audio.running ? `Running · R3 · stereo ${(decks.audio.telemetry.sample_rate ?? 48000) / 1000} kHz` : 'Starting / unavailable'} · starvation: {decks.audio.telemetry.callback?.starved_frames ?? 0} frames · device errors: {decks.audio.telemetry.callback?.device_errors ?? 0}<MidiToggle /><CpuUsage cpuSeconds={decks.audio.running ? decks.audio.telemetry.resources?.process_cpu_seconds : undefined} /><RenderProbe active={decks.audio.running && decks.audio.decks.some(state => state.playing)} stage="canvas" /></div>
  </main>;
}
