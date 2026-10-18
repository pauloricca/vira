import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { waveformColour } from './waveform';
import { useScrub } from './scrub';
import { useTransitionDrag } from './transitionDrag';
import { useCue } from './cue';
import { useTempoDrag } from './tempoDrag';
import { RollingRow } from './RollingRow';
import { TransitionOverview, TransitionDescription, type TransitionPlan } from './TransitionGuides';
import { useWaveformZoom, waveformZoomIntervals } from './zoom';
import { DisplayPosition, animate } from './transport';
import { Grid, TimingRecord, gridForReferenceBeats, markers, shiftBarStart, validGrid } from './Timing';
import { TrackArtwork } from './artwork';
import { beginDeckLoad } from './loadPriority';
import { LevelMeter, useMeterFeed } from './LevelMeter';
import { PeakMeter } from './meter';
import { KeySelector } from './KeySelector';

export const TRACK_MIME = 'application/x-vira-track-id';
export type Prepared = { track_id: string; artifact_id: string; title: string; artist: string; filename: string; duration_seconds: number; start_seconds?: number; frames: number; peak_frames: number; peaks: [number, number][]; fine_peak_frames?: number; fine_peaks?: [number, number][]; features?: [number, number][]; fine_features?: [number, number][] };
type FineWaveform = Pick<Prepared, 'artifact_id' | 'fine_peak_frames' | 'fine_peaks' | 'fine_features'>;
export type DeckState = { deck: number; loading: boolean; error: string | null; track: Prepared | null; position_seconds: number; playing: boolean; cue_seconds?: number; cue_preview?: boolean; headphone_cue?: boolean; launch_pending?: boolean; loop_in_seconds?: number | null; loop_out_seconds?: number | null; loop_length_beats?: number | null; loop_release_pending?: boolean; slip_enabled?: boolean; gain: number; trim_db?: number; eq?: [number, number, number]; filter?: number; generation: number; requested_generation: number; received_at?: number; sampled_at?: number; position_epoch?: number; track_unchanged?: boolean; grid?: Grid | null; reference_beats?: number[]; target_bpm?: number; pitch_semitones?: number; speed?: number; synced?: boolean; click_gain?: number; reposition_seconds?: number; timing_error?: string | null };
export type AudioState = { auto_fast?: boolean; auto_transition?: TransitionPlan | null; auto_mode?: [number, number]; audition?: { index?: number; generation: number; position_seconds: number; playing: boolean }; routing?: { master: string | null; cue: string | null; cue_running: boolean; cue_error: string | null }; crossfader?: number; crossfader_enabled?: boolean; master_bpm?: number | null; drift_rate?: number; sync_quantum?: number; drift_target?: number | null; output_frame?: number; decks: DeckState[]; running: boolean; error: string | null; telemetry: { callback?: { starved_frames: number; device_errors: number; actual_callback_frames_min: number; actual_callback_frames_max: number }; realtime_policy_verified?: boolean; live_source_pcm_bytes?: number; resources?: { process_cpu_seconds?: number } } };
const empty = (deck: number): DeckState => ({ deck, loading: false, error: null, track: null, position_seconds: 0, playing: false, gain: .8, generation: 0, requested_generation: 0 });

export function useDecks() {
  const [audio, setAudio] = useState<AudioState>({ master_bpm: null, drift_rate: 1, decks: [empty(0), empty(1)], running: false, error: null, telemetry: {} });
  const [errors, setErrors] = useState<(string | null)[]>([null, null]);
  const [loading, setLoading] = useState([false, false]);
  const [loadingTrackIds, setLoadingTrackIds] = useState<(string | null)[]>([null, null]);
  const [pollError, setPollError] = useState<string | null>(null);
  const requests = useRef([0, 0]);
  // Empty decks at startup must not overwrite the previous session's locks.
  const restoreLocks = useRef([0, 1].map(deck => localStorage.getItem(`vira.deck-${deck}-locked`) === 'true'));
  const currentAudio = useRef(audio);
  currentAudio.current = audio;
  const references = useRef([{ generation: 0, beats: [] as number[], grid: null as Grid | null, loaded: false }, { generation: 0, beats: [] as number[], grid: null as Grid | null, loaded: false }]);
  const transportQueue = useRef([Promise.resolve(), Promise.resolve()]);
  const referenceQueue = useRef([Promise.resolve(), Promise.resolve()]);
  const referenceLoads = useRef([null as { key: string; promise: Promise<void> } | null, null as { key: string; promise: Promise<void> } | null]);
  function loadReferences(state: DeckState): Promise<void> {
    if (!state.track) return Promise.resolve();
    const stored = references.current[state.deck];
    if (stored.generation !== state.generation) { stored.generation = state.generation; stored.beats = []; stored.grid = null; stored.loaded = false; }
    if (stored.loaded) return Promise.resolve();
    const key = `${state.generation}:${state.track.track_id}`;
    const pending = referenceLoads.current[state.deck];
    if (pending?.key === key) return pending.promise;
    const promise = invoke<TimingRecord>('track_timing', { trackId: state.track.track_id, grid: null }).then(record => {
      if (references.current[state.deck] !== stored || stored.generation !== state.generation || stored.loaded) return;
      stored.beats = record?.reference_beats ?? [];
      stored.loaded = true;
      setAudio(previous => ({ ...previous, decks: previous.decks.map(d => d.deck === state.deck && d.generation === state.generation ? { ...d, reference_beats: stored.beats } : d) }));
    }).catch(() => { if (stored.generation === state.generation) stored.loaded = true; });
    referenceLoads.current[state.deck] = { key, promise };
    return promise;
  }
  const fineCache = useRef(new Map<string, FineWaveform>());
  const finePending = useRef(new Set<string>());
  useEffect(() => {
    const active = new Set(audio.decks.map(d => d.track?.artifact_id).filter(Boolean));
    for (const key of fineCache.current.keys()) if (!active.has(key)) fineCache.current.delete(key);
    for (const d of audio.decks) {
      const track = d.track;
      if (track) void loadReferences(d);
      if (!track || fineCache.current.has(track.artifact_id) || finePending.current.has(track.artifact_id)) continue;
      finePending.current.add(track.artifact_id);
      void invoke<FineWaveform>('timing_waveform', { deck: d.deck, generation: d.generation }).then(value => {
        if (!currentAudio.current.decks.some(deck => deck.track?.artifact_id === value.artifact_id)) return;
        fineCache.current.set(value.artifact_id, value);
        setAudio(previous => ({ ...previous, decks: previous.decks.map(deck => deck.track?.artifact_id === value.artifact_id ? { ...deck, track: { ...deck.track, fine_features: value.fine_features, fine_peaks: value.fine_peaks, fine_peak_frames: value.fine_peak_frames } } : deck) }));
      }).catch(e => {
        if (currentAudio.current.decks[d.deck].generation === d.generation) setErrors(previous => previous.map((v, i) => i === d.deck ? `Close-up waveform: ${String(e)}. Reload to retry.` : v));
      })
        .finally(() => finePending.current.delete(track.artifact_id));
    }
  }, [audio.decks.map(d => `${d.track?.artifact_id}:${d.generation}`).join('|')]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const sent = performance.now();
        const value = await invoke<AudioState>('get_audio_state', {knownGenerations: currentAudio.current.decks.map(d=>d.generation)});
        const received = performance.now();
        if (!value || !Array.isArray(value.decks) || value.decks.length !== 2) throw new Error('Invalid native audio state. Restart VIRA.');
        if (!cancelled) { setAudio({ ...value, auto_transition: value.auto_transition ? { ...value.auto_transition, sampled_at: (sent + received) / 2 } : null, decks: value.decks.map(d => {
          const previous = currentAudio.current.decks[d.deck];
          const track = d.track_unchanged && previous.generation === d.generation ? previous.track : d.track;
          const cached = track && fineCache.current.get(track.artifact_id);
          const stableTrack = cached && track && !track.fine_peaks?.length ? { ...track, fine_features: cached.fine_features, fine_peaks: cached.fine_peaks, fine_peak_frames: cached.fine_peak_frames } : track;
          const stored = references.current[d.deck];
          if (stored.generation !== d.generation) { stored.generation = d.generation; stored.beats = []; stored.grid = null; stored.loaded = false; }
          return { ...d, track: stableTrack, reference_beats: stored.beats, received_at: received, sampled_at: (sent + received) / 2 };
        }) }); setPollError(null); }
        if (!cancelled) for (const d of value.decks) {
          if ((!d.track && !(d.track_unchanged && d.generation > 0)) || d.loading) continue;
          if (restoreLocks.current[d.deck]) {
            if (d.synced) { restoreLocks.current[d.deck] = false; continue; }
            if (!d.grid || !value.running) continue;
            restoreLocks.current[d.deck] = false;
            // Use the native sync command so grid/rate validation still applies.
            // Its result reaches telemetry on the next poll.
            try { await invoke('deck_control', { deck: d.deck, action: 'sync', value: 1, generation: d.generation }); }
            catch (e) { setErrors(previous => previous.map((v, deck) => deck === d.deck ? `Restore tempo lock: ${String(e)}` : v)); }
          } else if (typeof d.synced === 'boolean') {
            const key = `vira.deck-${d.deck}-locked`;
            if (localStorage.getItem(key) !== String(d.synced)) localStorage.setItem(key, String(d.synced));
          }
        }
      } catch (e) { if (!cancelled) setPollError(String(e)); }
      if (!cancelled) timer = setTimeout(() => void poll(), 200);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  async function load(deck: number, trackId: string, preserveLock = true, resetMixer = true) {
    const finishLoad = beginDeckLoad();
    const request = ++requests.current[deck];
    setLoadingTrackIds(previous => previous.map((id, d) => d === deck ? trackId : id));
    setErrors(previous => previous.map((v, d) => d === deck ? null : v));
    setLoading(previous => previous.map((v, d) => d === deck ? true : v));
    try { await invoke('load_track', { deck, trackId, preserveLock, resetMixer }); }
    catch (e) { if (request === requests.current[deck]) setErrors(previous => previous.map((v, d) => d === deck ? String(e) : v)); }
    finally { finishLoad(); if (request === requests.current[deck]) setLoading(previous => previous.map((v, d) => d === deck ? false : v)); }
  }
  async function refreshTiming(deck: number, generation: number) {
    const state = currentAudio.current.decks[deck];
    if (!state.track || state.generation !== generation) return;
    try {
      const record = await invoke<TimingRecord>('track_timing', { trackId: state.track.track_id, grid: null });
      if (currentAudio.current.decks[deck].generation !== generation) return;
      const grid = record.grid ?? (record.state !== 'stale' ? record.suggestion : null);
      if (!grid) return;
      await invoke('apply_timing', { deck, generation, grid });
      if (currentAudio.current.decks[deck].generation !== generation) return;
      references.current[deck] = { generation, beats: record.reference_beats ?? [], grid, loaded: true };
      setAudio(previous => ({ ...previous, decks: previous.decks.map(d => d.deck === deck && d.generation === generation ? { ...d, grid, reference_beats: record.reference_beats ?? [], target_bpm: grid.bpm, speed: 1, synced: false } : d) }));
      setErrors(previous => previous.map((v, d) => d === deck ? null : v));
    } catch (e) {
      if (currentAudio.current.decks[deck].generation === generation) setErrors(previous => previous.map((v, d) => d === deck ? `Update analysis: ${String(e)}` : v));
    }
  }
  async function control(deck: number, action: string, value?: number) {
    try {
      if (['reference_beat', 'shift_bar_start', 'detected_bpm', 'original_bpm'].includes(action)) {
        const task = referenceQueue.current[deck].then(async () => {
          const state = currentAudio.current.decks[deck];
          if (!state.track) throw new Error('Load a track first');
          if ((!state.grid && action !== 'detected_bpm') || (value === undefined && action !== 'original_bpm')) throw new Error('Load a track with a timing grid first');
          const followClock = action === 'shift_bar_start' && state.playing;
          if (followClock && currentAudio.current.decks.some(d => d.deck !== deck && d.playing)) throw new Error('Only one deck can be playing to shift its bar start');
          const preserveSpeed = action === 'detected_bpm' || action === 'original_bpm' || action === 'shift_bar_start';
          if (state.playing && !preserveSpeed) throw new Error('Stop the deck before changing its timing');
          await loadReferences(state);
          const stored = references.current[deck];
          if (stored.generation !== state.generation) throw new Error('Source replaced; retry on the current deck');
          const beats = action === 'reference_beat' ? [...stored.beats.slice(-1), value!] : stored.beats;
          const source = stored.grid ?? state.grid ?? { bpm: value!, downbeat_seconds: state.track.start_seconds ?? 0, reviewed: false };
          let bpm = value;
          if (action === 'original_bpm') {
            const record = await invoke<TimingRecord>('track_timing', { trackId: state.track.track_id, grid: null });
            if (!record.suggestion || record.state === 'stale') throw new Error('No current detected BPM is available');
            bpm = record.suggestion.bpm;
          }
          const grid = action === 'reference_beat'
            ? gridForReferenceBeats(source, beats, state.track.duration_seconds)
            : action === 'shift_bar_start'
              ? shiftBarStart(source, value === 1 ? 1 : -1, state.track.duration_seconds)
              : { ...source, bpm: bpm!, reviewed: false };
          if (!validGrid(grid, state.track.duration_seconds)) throw new Error('Enter a track BPM between 30 and 300');
          await invoke<TimingRecord>('track_timing', { trackId: state.track.track_id, grid, referenceBeats: beats });
          await invoke('apply_timing', { deck, generation: state.generation, grid, ...(preserveSpeed ? { preserveSpeed: true } : {}), ...(followClock ? { followClock: true } : {}) });
          stored.beats = beats;
          stored.grid = grid;
          setAudio(previous => {
            const current = previous.decks[deck];
            if (current.generation !== state.generation) return previous;
            const speed = preserveSpeed ? current.speed ?? 1 : 1;
            const synced = preserveSpeed && !!current.synced;
            const target = grid.bpm * speed;
            return { ...previous, master_bpm: (followClock || synced && current.playing && !current.launch_pending) ? target : previous.master_bpm, decks: previous.decks.map(d => d.deck === deck ? { ...d, grid, reference_beats: beats, target_bpm: target, speed, synced } : d) };
          });
        });
        referenceQueue.current[deck] = task.catch(() => {});
        await task;
      } else if (action === 'timing_saved') {
        const stored = references.current[deck]; stored.beats = []; stored.grid = null; stored.loaded = true;
        setAudio(previous => ({ ...previous, decks: previous.decks.map(d => d.deck === deck ? { ...d, reference_beats: [] } : d) }));
      } else {
        const args = { deck, action, value: value ?? null, generation: currentAudio.current.decks[deck].generation };
        if (['cue_press', 'cue_release', 'play_pause', 'play', 'pause', 'stop'].includes(action)) {
          const task = transportQueue.current[deck].then(() => invoke<void>('deck_control', args));
          transportQueue.current[deck] = task.catch(() => {});
          await task;
        } else await invoke('deck_control', args);
        if (action === 'sync') {
          restoreLocks.current[deck] = false;
          localStorage.setItem(`vira.deck-${deck}-locked`, String(value === 1));
        }
      }
      setErrors(previous => previous.map((v, d) => d === deck ? null : v));
    }
    catch (e) { setErrors(previous => previous.map((v, d) => d === deck ? String(e) : v)); }
  }
  function clearReferenceBeats(trackId: string) {
    for (const state of currentAudio.current.decks) {
      if (state.track?.track_id !== trackId) continue;
      const stored = references.current[state.deck];
      stored.beats = [];
      stored.loaded = true;
    }
    setAudio(previous => ({ ...previous, decks: previous.decks.map(state => state.track?.track_id === trackId ? { ...state, reference_beats: [] } : state) }));
  }
  return { audio, load, control, refreshTiming, clearReferenceBeats, errors, loading, loadingTrackIds, pollError };
}

export function time(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${Math.floor((seconds - whole) * 10)}`;
}

export function Deck({ state, running, loading, loadingTitle, error, load, control, transition, autoAvailable = false, otherPlaying = true, autoMode = 0, autoFast = false, autoFastBars = 4, showVolume = true, syncQuantum = 4, alignLoops = true, snapLoopPoints = true, onInteract, registerPosition, active = false, analysisState, analyse, analysing = false, approveAnalysis, approving = false, approvalError, trackKey, otherKey }: { transition?: TransitionPlan | null; autoAvailable?: boolean; otherPlaying?: boolean; autoMode?: number; autoFast?: boolean; autoFastBars?: number; showVolume?: boolean; syncQuantum?: number; alignLoops?: boolean; snapLoopPoints?: boolean; onInteract?: (deck: number) => void; registerPosition?: (deck: number, getPosition: () => number) => void; active?: boolean; analysisState?: string; analyse?: () => void; analysing?: boolean; approveAnalysis?: () => void; approving?: boolean; approvalError?: string; trackKey?: string | null; otherKey?: string | null; state: DeckState; running: boolean; loading: boolean; loadingTitle?: string; error: string | null; load: (deck: number, id: string) => Promise<void>; control: (deck: number, action: string, value?: number) => Promise<void> }) {
  const name = state.deck === 0 ? 'A' : 'B';
  const autoClick = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (autoClick.current) clearTimeout(autoClick.current); }, [state.generation, running]);
  function clickAuto(mode: 'NOW' | 'END', detail: number) {
    if (autoClick.current) clearTimeout(autoClick.current);
    autoClick.current = null;
    if (detail > 1) return;
    const action = mode === 'NOW' ? 'auto_now' : 'auto_end';
    // Keyboard activation is immediate; wait for a second pointer click before arming.
    if (detail === 0) void control(state.deck, action);
    else autoClick.current = setTimeout(() => { autoClick.current = null; void control(state.deck, action); }, 400);
  }
  function fastAuto(mode: 'NOW' | 'END') {
    if (autoClick.current) clearTimeout(autoClick.current);
    autoClick.current = null;
    void control(state.deck, mode === 'NOW' ? 'auto_now_fast' : 'auto_end_fast', autoFastBars);
  }
  const total = state.track?.duration_seconds ?? 0;
  const start = state.track?.start_seconds ?? 0;
  const duration = Math.max(0, total - start);
  const [trackBpm, setTrackBpm] = useState(state.grid ? String(state.grid.bpm) : '');
  const [gain,setGain]=useState(state.gain);
  const [clickGain,setClickGain]=useState(state.click_gain ?? 0);
  const gainInput=useRef(-Infinity), clickInput=useRef(-Infinity), previousGeneration=useRef(state.generation);
  useEffect(()=>{
    const replaced=previousGeneration.current!==state.generation;
    if(replaced || performance.now()-gainInput.current>500) setGain(state.gain);
    if(replaced || performance.now()-clickInput.current>500) setClickGain(state.click_gain ?? 0);
    previousGeneration.current=state.generation;
  },[state]);
  useEffect(() => setTrackBpm(state.grid ? String(state.grid.bpm) : ''), [state.grid?.bpm, state.generation]);
  useEffect(() => {
    if (!running || !state.track) return;
    void control(state.deck, 'click_panel', 1);
    return () => { void control(state.deck, 'click_panel', 0); };
  }, [state.generation, running, state.track?.track_id]);
  const clock = useRef(new DisplayPosition());
  registerPosition?.(state.deck, () => clock.current.at(performance.now()));
  const playhead = useRef<SVGPathElement>(null);
  const overview = useRef<SVGSVGElement>(null);
  const phraseMarkers = useRef(new Map<number, SVGPathElement>());
  const phraseLength = state.grid && validGrid(state.grid, total) ? 16 * 60 / state.grid.bpm : 0;
  const phraseOffsets = useMemo(() => phraseLength > 0 && duration > 0
    ? Array.from({ length: 2 * Math.ceil(duration / phraseLength) + 1 }, (_, index) => index - Math.ceil(duration / phraseLength)).filter(offset => offset !== 0)
    : [], [phraseLength, duration]);
  const timeLabel = useRef<HTMLOutputElement>(null);
  const lastTime = useRef('');
  const draw = useRef<(now:number)=>void>(()=>{});
  const { gesture: scrub, handlers: scrubHandlers } = useScrub(state, running, control,
    (element, x) => { const bounds = element.getBoundingClientRect(); return start + (x-bounds.left)/Math.max(1,bounds.width)*duration; },
    () => clock.current.at(performance.now()), () => draw.current(performance.now()), false);
  const waveformHandlers = useTransitionDrag(state, running, transition, control,
    (element, x) => { const bounds = element.getBoundingClientRect(); return start + (x - bounds.left) / Math.max(1, bounds.width) * duration; }, duration, scrubHandlers);
  draw.current = now => {
    const cursor=scrub.current?.position ?? clock.current.at(now);
    playhead.current?.setAttribute('d',`M${total ? cursor/total*1024 : 0},0V120`);
    const bounds = overview.current?.getBoundingClientRect();
    const triangleWidth = 8 * duration / Math.max(1, bounds?.width ?? 1) / Math.max(total, 1) * 1024;
    const triangleHeight = 10 * 120 / Math.max(1, bounds?.height ?? 1);
    phraseMarkers.current.forEach((marker, offset) => {
      const target = cursor + offset * phraseLength;
      const x = total ? target / total * 1024 : 0;
      marker.style.display = target >= start && target < total ? '' : 'none';
      marker.setAttribute('d', `M${x},${118 - triangleHeight / 2}L${x - triangleWidth},${118 - triangleHeight}V118Z`);
    });
    const label=`${time(Math.max(0, cursor - start))} / ${time(duration)}`;
    if (label !== lastTime.current) {
      if (timeLabel.current) timeLabel.current.textContent=label;
      overview.current?.setAttribute('aria-valuenow',String(Math.max(0, cursor - start)));
      lastTime.current=label;
    }
  };
  useLayoutEffect(() => {
    const received=state.received_at ?? performance.now();
    clock.current.update({...state,playing:state.playing && !state.launch_pending && running,duration:total,start_seconds:start},received,state.sampled_at ?? received);
    draw.current(performance.now());
  },[state,running,total]);
  useEffect(() => {
    if (state.playing && !state.launch_pending && running) return animate(now=>draw.current(now));
  },[state.playing,state.launch_pending,running,state.generation]);
  const wave = useMemo(() => state.track?.peaks.map((peak, index) => {
    const x = index * state.track!.peak_frames / state.track!.frames * 1024;
    // One display envelope: retain the louder channel in each time bucket.
    const amplitude = Math.min(1, Math.max(...peak)) * 50;
    return <path key={index} d={`M${x.toFixed(2)},${60 - amplitude}V${60 + amplitude}`} stroke={waveformColour(state.deck===0 ? '#89d2ee' : '#efa264', state.track!.features?.[index])} />;
  }) ?? [], [state.track?.artifact_id]);
  const overviewBars = useMemo(() => markers(state.grid, 0, total).filter(m => m.beat === 1 && (m.bar - 1) % 8 === 0).map(m =>
    <path key={m.seconds} d={`M${m.seconds / total * 1024},0V120`} stroke="currentColor" opacity={state.grid?.reviewed ? .6 : .25} />),
    [state.grid?.bpm, state.grid?.downbeat_seconds, state.grid?.reviewed, total]);
  const ready = Boolean(state.track && running);
  const loopIn = state.loop_in_seconds;
  const loopOut = state.loop_out_seconds;
  const cue = useCue(state.deck, state.generation, ready, control);
  const preparing = loading || state.loading;
  const dragTempo = useTempoDrag(state.target_bpm ?? state.grid?.bpm ?? 120, 15, 600, !ready || loading || state.loading || !state.grid || !!state.synced, value => control(state.deck, 'tempo', value), state.generation);
  return <article className={`deck deck-${state.deck}${preparing ? ' is-loading' : ''}`} aria-label={`Deck ${name}`} aria-busy={preparing} onPointerDownCapture={() => onInteract?.(state.deck)} onFocusCapture={() => onInteract?.(state.deck)} onDragOver={event => { if (event.dataTransfer.types.includes(TRACK_MIME)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDrop={event => { const id = event.dataTransfer.getData(TRACK_MIME); if (/^[a-f0-9]{64}$/.test(id)) { event.preventDefault(); void load(state.deck, id); } }}>
    <div className="deck-header"><h2 className={`deck-badge${active ? " active" : ""}`} title={`Deck ${name}${active ? " · active" : ""}`}>{name}</h2>{state.track ? <TrackArtwork trackId={state.track.track_id} className="track-art" fallback="♫" alt={`${state.track.title} cover`} /> : <span className="track-art" aria-hidden="true">♫</span>}<div className="track-meta"><div className="deck-title">{state.track?.title ?? 'No track loaded'}</div><p>{state.track?.artist ?? 'Drop a track to load'}</p></div><div className={`deck-tempo${state.synced ? ' locked' : ''}`}><div className="deck-tempo-value">{state.track && analysisState && ['not_analysed', 'stale', 'failed', 'queued', 'analysing'].includes(analysisState) && <button className="deck-analyse" aria-label={`Analyse deck ${name}`} disabled={loading || state.loading || analysing || ['queued', 'analysing'].includes(analysisState)} onClick={analyse}>{analysing || ['queued', 'analysing'].includes(analysisState) ? 'Analysing…' : 'Analyse'}</button>}<span className="tempo-drag" aria-disabled={!ready || loading || state.loading || !state.grid || !!state.synced} aria-label={`BPM deck ${name}`} onPointerDown={dragTempo} title="Double-click to unlock and restore original tempo" onDoubleClick={() => { if (!ready || !state.grid) return; void (async () => { if (state.synced) await control(state.deck, 'sync', 0); await control(state.deck, 'tempo', state.grid!.bpm); })(); }}>{state.target_bpm ? state.target_bpm.toFixed(1) : '—'}</span><button className={state.synced ? 'tempo-lock active' : 'tempo-lock'} aria-label={`${state.synced ? 'Unlock' : 'Lock'} deck ${name} to master tempo`} aria-pressed={!!state.synced} title={state.synced ? 'Unlock from master BPM' : 'Lock to master BPM'} disabled={!ready || !state.grid} onClick={() => void control(state.deck, 'sync', state.synced ? 0 : 1)}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path className="lock-shackle" d={state.synced ? 'M5.5 9V6.5a4.5 4.5 0 0 1 9 0V9' : 'M5.5 9V6.5a4.5 4.5 0 0 1 8.5-2'} /><rect x="3.5" y="8.5" width="13" height="9" rx="1.5" /><path className="lock-slot" d="M10 11.5v3" /></svg></button></div><small>{state.launch_pending ? syncQuantum === 1 ? 'WAITING FOR BEAT' : 'WAITING FOR BAR 1' : state.synced ? 'LOCKED TO MASTER' : 'BPM'}</small></div><KeySelector deck={state.deck} generation={state.generation} original={trackKey} other={otherKey} semitones={state.pitch_semitones ?? 0} disabled={!ready || loading || state.loading} select={value => control(state.deck, 'pitch', value)} /></div>
    <div className="deck-main"><div className="deck-overview">
    <svg ref={overview} viewBox={`${total ? start / total * 1024 : 0} 0 ${total ? duration / total * 1024 : 1024} 120`} preserveAspectRatio="none" className="waveform" role="slider" tabIndex={-1} aria-label={`Waveform seek deck ${name}`} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.max(0, state.position_seconds - start)} aria-disabled={!ready}
      {...waveformHandlers}
      onKeyDown={event => { if (!ready || event.metaKey || event.ctrlKey || event.altKey) return; const cursor=clock.current.at(performance.now()); let value: number | undefined;
        if (event.key === 'ArrowLeft') value = Math.max(start, cursor - 5);
        if (event.key === 'ArrowRight') value = Math.min(total, cursor + 5);
        if (event.key === 'Home') value = start;
        if (event.key === 'End') value = total;
        if (value !== undefined) { event.preventDefault(); void control(state.deck, 'seek', value); }
      }}>
      {overviewBars}
      {total > 0 && loopIn != null && loopOut != null && <rect className="loop-region" x={loopIn / total * 1024} y="0" width={(loopOut - loopIn) / total * 1024} height="120" />}
      {state.reference_beats?.map((seconds, index) => <path key={`${index}-${seconds}`} className="reference-beat" d={`M${seconds / total * 1024},0V120`} />)}
      <path d="M0,60H1024" stroke="#303943" />{wave}
      {total > 0 && loopIn != null && <path className="loop-marker loop-in" aria-label={`Loop in deck ${name}`} d={`M${loopIn / total * 1024},0V120`}><title>{`Loop in ${time(Math.max(0, loopIn - start))}`}</title></path>}
      {total > 0 && loopOut != null && <path className="loop-marker loop-out" aria-label={`Loop out deck ${name}`} d={`M${loopOut / total * 1024},0V120`}><title>{`Loop out ${time(Math.max(0, loopOut - start))}`}</title></path>}
      {state.track && <path className="cue-marker" aria-label={`Cue point deck ${name}`} d={`M${(state.cue_seconds ?? 0) / total * 1024},0v120`}><title>{`Cue ${time(Math.max(0, (state.cue_seconds ?? start) - start))}`}</title></path>}
      <TransitionOverview plan={transition} deck={state.deck} total={total} start={start} looped={state.loop_out_seconds != null} />
      <path ref={playhead} d={`M${total ? state.position_seconds / total * 1024 : 0},0V120`} stroke="#f2f5f6" strokeWidth="3" />
      {ready && !preparing && phraseOffsets.map(offset => <path key={offset}
        ref={element => { if (element) phraseMarkers.current.set(offset, element); else phraseMarkers.current.delete(offset); }}
        className="phrase-jump" role="button" aria-label={`Jump ${Math.abs(offset) * 4} bars ${offset < 0 ? 'back' : 'forward'} on deck ${name}`}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
        onClick={event => {
          event.stopPropagation();
          const target = clock.current.at(performance.now()) + offset * phraseLength;
          if (target >= start && target < total) void control(state.deck, 'seek', target);
        }}><title>{`Jump ${Math.abs(offset) * 4} bars ${offset < 0 ? 'back' : 'forward'} · preserve phrase position`}</title></path>)}
    </svg>
    <TransitionDescription plan={transition} deck={state.deck} />
    {!state.track && <span className="waveform-empty">Drag a track from the library</span>}
    </div></div>
    <div className="deck-actions"><div className="transport">
      <button className={`cue-button${cue.pressed || state.cue_preview ? ' pressed' : !state.playing && Math.abs(state.position_seconds - (state.cue_seconds ?? 0)) < 1 / 48000 ? ' at-cue' : ''}`} disabled={!ready} aria-label={`Cue deck ${name}`} title={`Paused: set Cue${state.synced ? ` at nearest ${syncQuantum === 1 ? 'beat' : 'bar'}` : ''}. Playing: return to Cue. Hold at Cue to preview; press Play to continue.`} {...cue.handlers}>CUE</button>
      <button className="play-button" aria-label={`${state.playing && !state.cue_preview ? 'Pause' : 'Play'} deck ${name}`} disabled={!ready} onClick={() => void control(state.deck, 'play_pause')}><svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true">{state.playing ? <><rect x="5" y="3" width="3" height="14" /><rect x="12" y="3" width="3" height="14" /></> : <path d="M6 3.5 17 10 6 16.5Z" />}</svg></button>
    </div>
    <div className="deck-loop-bank"><div className="auto-controls" aria-label={`Automatic transitions deck ${name}`}>
      {(['NOW', 'END'] as const).map((mode, index) => <button key={mode} aria-label={`AUTO ${mode} deck ${name}`} aria-pressed={autoMode === index + 1} className={autoMode === index + 1 ? `auto-engaged${autoFast ? ' auto-fast' : ''}` : undefined} disabled={autoMode !== index + 1 && (!ready || !autoAvailable)} title={autoMode === index + 1 ? 'Cancel automatic transition' : mode === 'NOW' ? 'Transition at the next phrase boundary; double-click for fast overlap' : 'Transition at the end of the track; double-click for fast overlap'} onClick={event => clickAuto(mode, event.detail)} onDoubleClick={() => fastAuto(mode)}>AUTO {mode}</button>)}
    </div>
    <div className="loop-controls" aria-label={`Loop controls deck ${name}`}>{['IN', '1/32', '1/16', '1/8', '1/4', '1/2', 'SLIP', 'OUT', '1', '2', '4', '8', '16'].map(label => {
      if (label === 'SLIP') return <button key={label} disabled={!ready} className={state.slip_enabled ? 'active' : undefined} aria-pressed={!!state.slip_enabled} aria-label={`Slip deck ${name}`} title="Keep a background playhead moving through loops; return to it when the loop is released" onClick={() => void control(state.deck, 'slip', state.slip_enabled ? 0 : 1)}>SLIP</button>;
      // Button labels are musical bar lengths; the engine measures grid beats.
      const beats = label === 'IN' || label === 'OUT' ? null : 4 * (label.includes('/') ? Number(label.split('/')[0]) / Number(label.split('/')[1]) : Number(label));
      const active = beats != null ? loopOut != null && state.loop_length_beats === beats : label === 'IN' ? loopIn != null : loopOut != null;
      const lengthName = label === '1/4' ? '1 beat' : label === '1' ? '1 bar' : `${label} bars`;
      return <button key={label} disabled={!ready || (beats != null && !state.grid) || (label === 'OUT' && loopIn == null)} className={active ? 'active' : undefined} aria-pressed={active} aria-label={`Loop ${label} deck ${name}`} title={beats != null ? `${lengthName} loop · press again to release` : label === 'IN' ? `Set loop start ${snapLoopPoints && state.grid ? 'at nearest beat' : 'at playhead'}` : loopOut != null ? 'Release loop' : `Set loop end ${snapLoopPoints && state.grid ? 'at nearest beat' : 'at playhead'}`} onClick={() => void control(state.deck, beats != null ? alignLoops ? 'loop_length_aligned' : 'loop_length' : label === 'IN' ? snapLoopPoints ? 'loop_in_snapped' : 'loop_in' : snapLoopPoints ? 'loop_out_snapped' : 'loop_out', beats ?? undefined)}>{label}</button>;
    })}</div></div>
    <output ref={timeLabel} className="numeric deck-time" aria-label={`Time deck ${name}`}>{time(Math.max(0, state.position_seconds - start))} / {time(duration)}</output></div>
    <section className="deck-settings" aria-label={`Timing & tempo deck ${name}`}><div className="timing-controls">
      {showVolume && <label>Volume <input type="range" min="0" max="1" step="0.01" value={gain} disabled={!ready} aria-label={`Volume deck ${name}`} onChange={event => {gainInput.current=performance.now();setGain(Number(event.target.value));void control(state.deck,'gain',Number(event.target.value));}} /></label>}
      <button disabled={!ready || state.playing || !state.grid} onClick={() => void control(state.deck, 'reference_beat', Math.min(Math.max(0, clock.current.at(performance.now())), Math.max(0, total - 1 / 48000)))}>Set reference beat</button>
      <div className="shift-bar-row"><span>Shift bar start</span><button disabled={!ready || (state.playing && otherPlaying) || !state.grid} aria-label={`Shift bar start back one beat on deck ${name}`} onClick={() => void control(state.deck, 'shift_bar_start', -1)}>Back</button><button disabled={!ready || (state.playing && otherPlaying) || !state.grid} aria-label={`Shift bar start forward one beat on deck ${name}`} onClick={() => void control(state.deck, 'shift_bar_start', 1)}>Forward</button></div>
      <button disabled={!ready || !analysisState || !['analysed', 'needs_review', 'stale'].includes(analysisState) || approving} onClick={approveAnalysis}>Approve analysis</button>
      {analysisState && <span>Analysis: {analysisState === 'approved' ? 'Approved' : analysisState === 'analysed' ? 'Analysed · draft' : analysisState === 'needs_review' ? 'Needs review' : analysisState}</span>}
      {approvalError && <span role="alert" className="row-error">{approvalError}</span>}
      <span>Source {state.grid ? `${state.grid.bpm.toFixed(2)} BPM · ${state.grid.reviewed ? 'reviewed' : 'draft'}` : 'timing unavailable'}</span>
      <label>Track BPM <input type="number" step=".01" min="30" max="300" disabled={!ready} value={trackBpm} onChange={e => setTrackBpm(e.target.value)} /></label>
      <button disabled={!ready || !trackBpm.trim() || !Number.isFinite(Number(trackBpm)) || Number(trackBpm) < 30 || Number(trackBpm) > 300} onClick={() => void control(state.deck, 'detected_bpm', Number(trackBpm))}>Set BPM</button>
      <button disabled={!ready || !state.grid || state.grid.bpm / 2 < 30} onClick={() => void control(state.deck, 'detected_bpm', state.grid!.bpm / 2)}>Half BPM</button>
      <button disabled={!ready || !state.grid || state.grid.bpm * 2 > 300} onClick={() => void control(state.deck, 'detected_bpm', state.grid!.bpm * 2)}>Double BPM</button>
      <button disabled={!ready || !state.grid} onClick={() => void control(state.deck, 'original_bpm')}>Original BPM</button>
      <span>Speed {(state.speed ?? 1).toFixed(3)}× · supported 15–600 BPM · pitch {state.pitch_semitones ? `${state.pitch_semitones > 0 ? '+' : ''}${state.pitch_semitones} st` : 'preserved'}</span>
      <label>Click volume (0 = off) <input type="range" min="0" max="1" step=".01" value={clickGain} disabled={!ready || !state.grid} onChange={e => {clickInput.current=performance.now();setClickGain(Number(e.target.value));void control(state.deck,'click',Number(e.target.value));}} /></label>
    </div></section>
    {state.loop_release_pending && <p role="status">Loop release queued · waiting for locked deck start boundary</p>}
    {!!state.reposition_seconds && <p>Last master alignment: {state.reposition_seconds > 0 ? '+' : ''}{state.reposition_seconds.toFixed(3)} s</p>}
    {state.timing_error && <p role="alert" className="row-error">{state.timing_error}</p>}
    {preparing && <p className="deck-load-status" role="status">Loading {loadingTitle ?? 'track'}</p>}
    {(error || state.error) && <p className="row-error" role="alert">{error || state.error}</p>}
  </article>;
}

export function RollingWaveforms({ audio, beats = 32, control, onZoomChange, timingOpen = [true, true], onInteract, activeDeck = 0 }: { audio: AudioState; beats?: number; timingOpen?: boolean[]; onZoomChange?: (beats: number) => void; onInteract?: (deck: number) => void; activeDeck?: number; control?: (deck: number, action: string, value?: number) => Promise<void> }) {
  const zoomRef = useWaveformZoom(beats, onZoomChange);
  const reference = audio.master_bpm;
  const window = reference && reference > 0 ? beats * 60 / reference : beats / 2;
  return <section ref={zoomRef} className="rolling" aria-label="Rolling waveforms">
    <span className="sr-only">{reference ? 'Beat grid' : 'Time fallback'} · {window.toFixed(2)} seconds output window</span>
    {onZoomChange && <label className="rolling-zoom"><select aria-label="Shared zoom" value={beats} onChange={event => onZoomChange(Number(event.target.value))}>{waveformZoomIntervals.map(value => <option key={value} value={value}>{value / 4} {value === 4 ? 'bar' : 'bars'}</option>)}</select><span aria-hidden="true">▾</span></label>}
    <div className="rolling-rows">{audio.decks.map(state => <RollingRow transition={audio.auto_transition} masterBpm={audio.master_bpm ?? undefined} key={state.deck} state={state} running={audio.running} window={window} control={control} timingOpen={timingOpen[state.deck]} onInteract={onInteract} active={state.deck === activeDeck} />)}</div>
  </section>;
}

const dialNames = { GN: 'Gain', HI: 'High EQ', MD: 'Mid EQ', LO: 'Low EQ', FL: 'Filter' } as const;
type DialLabel = keyof typeof dialNames;

function MixerDial({ label, state, running, control }: { label: DialLabel; state: DeckState; running: boolean; control: (deck: number, action: string, value?: number) => Promise<void> }) {
  const deck = state.deck === 0 ? 'A' : 'B';
  const enabled = Boolean(state.track) && running;
  const reported = label === 'GN' ? ((state.trim_db ?? 0) + 12) / 24 : label === 'FL' ? ((state.filter ?? 0) + 1) / 2 : (state.eq ?? [.5, .5, .5])[label === 'LO' ? 0 : label === 'MD' ? 1 : 2];
  const inputAt = useRef(-Infinity);
  const generation = useRef(state.generation);
  const initial = .5;
  const [value, setValue] = useState(reported);
  useEffect(() => {
    if (generation.current !== state.generation || performance.now() - inputAt.current > 500) setValue(reported);
    generation.current = state.generation;
  }, [reported, state]);
  const drag = useRef<{ pointerId: number; y: number; value: number } | null>(null);
  const turn = (next: number) => {
    if (!enabled) return;
    const v = Math.max(0, Math.min(1, next));
    inputAt.current = performance.now(); setValue(v);
    const action = label === 'GN' ? 'trim' : label === 'FL' ? 'filter' : label === 'LO' ? 'eq_low' : label === 'MD' ? 'eq_mid' : 'eq_high';
    void control(state.deck, action, label === 'GN' ? v * 24 - 12 : label === 'FL' ? v * 2 - 1 : v);
  };
  const db = value <= .5 ? 40 * Math.log10(value * 2) : (value - .5) * 12;
  const description = label === 'GN' ? `${(value * 24 - 12).toFixed(1)} dB` : label === 'FL' ? value === .5 ? 'Off' : `${value < .5 ? 'Low-pass' : 'High-pass'} ${Math.round(Math.abs(value * 2 - 1) * 100)}%` : value === 0 ? '−∞ dB (kill)' : `${db.toFixed(1)} dB`;

  const angle = (value - initial) * 300;
  const radians = (angle - 90) * Math.PI / 180;
  const endX = 20 + 17 * Math.cos(radians);
  const endY = 20 + 17 * Math.sin(radians);
  return <div className="mixer-dial" role="slider" tabIndex={-1} aria-disabled={!enabled} aria-label={`${dialNames[label]} deck ${deck}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-valuetext={description} title={`${dialNames[label]} · ${description} · drag to turn, double-click to reset`}
    onPointerDown={event => { if (!enabled) return; event.preventDefault(); drag.current = { pointerId: event.pointerId, y: event.clientY, value }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
    onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) turn(drag.current.value + (drag.current.y - event.clientY) / 140); }}
    onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
    onDoubleClick={() => turn(initial)}>
    <svg viewBox="0 0 40 40" aria-hidden="true"><circle className="mixer-dial-base" cx="20" cy="20" r="17" />{Math.abs(angle) > .1 && <path className="mixer-dial-arc" d={`M20 3 A17 17 0 0 ${angle > 0 ? 1 : 0} ${endX} ${endY}`} />}<text x="20" y="23" textAnchor="middle">{label}</text></svg>
  </div>;
}

function ChannelFader({ state, running, control, meter }: { state: DeckState; running: boolean; control: (deck: number, action: string, value?: number) => Promise<void>; meter: PeakMeter }) {
  const name = state.deck === 0 ? 'A' : 'B';
  const [gain, setGain] = useState(state.gain);
  const gainLabel = gain > 0 ? `${(20 * Math.log10(gain)).toFixed(1)} dB` : '−∞ dB';
  const inputAt = useRef(-Infinity);
  const generation = useRef(state.generation);
  useEffect(() => {
    if (generation.current !== state.generation || performance.now() - inputAt.current > 500) setGain(state.gain);
    generation.current = state.generation;
  }, [state]);
  return <div className={`mixer-channel deck-${state.deck}`} aria-label={`Deck ${name} mixer controls`}>
    <div className="mixer-channel-top"><MixerDial label="GN" state={state} running={running} control={control} /><button className={`mixer-headphones${state.headphone_cue ? ' active' : ''}`} disabled={!running} aria-pressed={!!state.headphone_cue} aria-label={`Headphone cue deck ${name}`} title="Send this deck to cue headphones before the channel fader" onClick={() => void control(state.deck, 'headphone_cue', state.headphone_cue ? 0 : 1)}><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2M4 13h3v7H5a2 2 0 0 1-2-2v-3a2 2 0 0 0-1-2Zm16 0h-3v7h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-1-2Z" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></button></div>
    <div className="mixer-channel-body">
      <div className="mixer-eq" aria-label={`EQ and filter deck ${name}`}>{(['HI', 'MD', 'LO', 'FL'] as const).map(label => <div className="mixer-eq-row" key={label}><MixerDial label={label} state={state} running={running} control={control} /></div>)}</div>
      <div className="mixer-fader-group"><div className="metered-fader"><LevelMeter meter={meter} label={`Deck ${name} level`} /><input className="vertical-fader" type="range" min="0" max="1" step=".01" value={gain} disabled={!state.track || !running} aria-label={`Volume deck ${name}`} aria-valuetext={gainLabel} title={`Volume · ${gainLabel}`} onChange={event => { const value = Number(event.target.value); inputAt.current = performance.now(); setGain(value); void control(state.deck, 'gain', value); }} /></div></div>
    </div>
  </div>;
}

export function Mixer({ audio, control, showCrossfader = true, deckA, deckB }: { showCrossfader?: boolean; deckA?: ReactNode; deckB?: ReactNode; audio: AudioState; control: (deck: number, action: string, value?: number) => Promise<void> }) {
  const meters = useMeterFeed(audio.running);
  const [position, setPosition] = useState(audio.crossfader ?? 0);
  const inputAt = useRef(-Infinity);
  useEffect(() => {
    if (performance.now() - inputAt.current > 500) setPosition(audio.crossfader ?? 0);
  }, [audio.crossfader, audio.output_frame]);
  const moveCrossfader = (value: number) => {
    inputAt.current = performance.now();
    setPosition(value);
    void control(0, 'crossfader', value);
  };
  return <section className="decks" aria-label="Decks">
    <div className="deck-unit deck-0">{deckA}<ChannelFader state={audio.decks[0]} running={audio.running} control={control} meter={meters[0]} /></div>
    <section className="mixer" aria-label="Mixer"><div className="mixer-master"><div className="stereo-meters" aria-label="Stereo master meters"><LevelMeter meter={meters[2]} label="Master left level" /><LevelMeter meter={meters[3]} label="Master right level" /></div><div className="mixer-stereo-labels"><span>L</span><span>R</span></div></div>{showCrossfader && <div className="mixer-crossfader"><input className="crossfader" type="range" min="-1" max="1" step=".01" value={position} disabled={!audio.running} aria-label="Crossfader" aria-valuetext={position === 0 ? 'Centre · equal power' : `${Math.round(Math.abs(position) * 100)}% toward deck ${position < 0 ? 'A' : 'B'}`} title="Equal power · double-click to centre" onChange={event => moveCrossfader(Number(event.target.value))} onDoubleClick={() => moveCrossfader(0)} /></div>}</section>
    <div className="deck-unit deck-1"><ChannelFader state={audio.decks[1]} running={audio.running} control={control} meter={meters[1]} />{deckB}</div>
  </section>;
}
