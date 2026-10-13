import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { waveformColour } from './waveform';
import { useScrub } from './scrub';
import { useTempoDrag } from './tempoDrag';
import { RollingRow } from './RollingRow';
import { useWaveformZoom } from './zoom';
import { DisplayPosition, animate } from './transport';
import { Grid, TimingEditor, TimingRecord, gridForReferenceBeats, markers, shiftBarStart } from './Timing';
import { TrackArtwork } from './artwork';

export const TRACK_MIME = 'application/x-vira-track-id';
export type Prepared = { track_id: string; artifact_id: string; title: string; artist: string; filename: string; duration_seconds: number; frames: number; peak_frames: number; peaks: [number, number][]; fine_peak_frames?: number; fine_peaks?: [number, number][]; features?: [number, number][]; fine_features?: [number, number][] };
export type DeckState = { deck: number; loading: boolean; error: string | null; track: Prepared | null; position_seconds: number; playing: boolean; launch_pending?: boolean; gain: number; trim_db?: number; eq?: [number, number, number]; filter?: number; generation: number; requested_generation: number; received_at?: number; sampled_at?: number; position_epoch?: number; track_unchanged?: boolean; grid?: Grid | null; reference_beats?: number[]; target_bpm?: number; speed?: number; synced?: boolean; click_gain?: number; reposition_seconds?: number; timing_error?: string | null };
export type AudioState = { master_bpm?: number; drift_rate?: number; sync_quantum?: number; drift_target?: number | null; output_frame?: number; decks: DeckState[]; running: boolean; error: string | null; telemetry: { callback?: { starved_frames: number; device_errors: number; actual_callback_frames_min: number; actual_callback_frames_max: number }; realtime_policy_verified?: boolean; live_source_pcm_bytes?: number } };
const empty = (deck: number): DeckState => ({ deck, loading: false, error: null, track: null, position_seconds: 0, playing: false, gain: .8, generation: 0, requested_generation: 0 });

export function useDecks() {
  const [audio, setAudio] = useState<AudioState>({ master_bpm: 120, drift_rate: 1, decks: [empty(0), empty(1)], running: false, error: null, telemetry: {} });
  const [errors, setErrors] = useState<(string | null)[]>([null, null]);
  const [loading, setLoading] = useState([false, false]);
  const [loadingTrackIds, setLoadingTrackIds] = useState<(string | null)[]>([null, null]);
  const [pollError, setPollError] = useState<string | null>(null);
  const requests = useRef([0, 0]);
  const currentAudio = useRef(audio);
  currentAudio.current = audio;
  const references = useRef([{ generation: 0, beats: [] as number[], grid: null as Grid | null, loaded: false }, { generation: 0, beats: [] as number[], grid: null as Grid | null, loaded: false }]);
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
  const fineCache = useRef(new Map<string, Prepared>());
  const finePending = useRef(new Set<string>());
  useEffect(() => {
    const active = new Set(audio.decks.map(d => d.track?.artifact_id).filter(Boolean));
    for (const key of fineCache.current.keys()) if (!active.has(key)) fineCache.current.delete(key);
    for (const d of audio.decks) {
      const track = d.track;
      if (track) void loadReferences(d);
      if (!track || fineCache.current.has(track.artifact_id) || finePending.current.has(track.artifact_id)) continue;
      finePending.current.add(track.artifact_id);
      void invoke<Prepared>('timing_waveform', { trackId: track.track_id }).then(value => {
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
        if (!cancelled) { setAudio({ ...value, decks: value.decks.map(d => {
          const previous = currentAudio.current.decks[d.deck];
          const track = d.track_unchanged && previous.generation === d.generation ? previous.track : d.track;
          const cached = track && fineCache.current.get(track.artifact_id);
          const stableTrack = cached && track && !track.fine_peaks?.length ? { ...track, fine_features: cached.fine_features, fine_peaks: cached.fine_peaks, fine_peak_frames: cached.fine_peak_frames } : track;
          const stored = references.current[d.deck];
          if (stored.generation !== d.generation) { stored.generation = d.generation; stored.beats = []; stored.grid = null; stored.loaded = false; }
          return { ...d, track: stableTrack, reference_beats: stored.beats, received_at: received, sampled_at: (sent + received) / 2 };
        }) }); setPollError(null); }
      } catch (e) { if (!cancelled) setPollError(String(e)); }
      if (!cancelled) timer = setTimeout(() => void poll(), 200);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  async function load(deck: number, trackId: string) {
    const request = ++requests.current[deck];
    setLoadingTrackIds(previous => previous.map((id, d) => d === deck ? trackId : id));
    setErrors(previous => previous.map((v, d) => d === deck ? null : v));
    setLoading(previous => previous.map((v, d) => d === deck ? true : v));
    try { await invoke('load_track', { deck, trackId }); }
    catch (e) { if (request === requests.current[deck]) setErrors(previous => previous.map((v, d) => d === deck ? String(e) : v)); }
    finally { if (request === requests.current[deck]) setLoading(previous => previous.map((v, d) => d === deck ? false : v)); }
  }
  async function control(deck: number, action: string, value?: number) {
    try {
      if (action === 'reference_beat' || action === 'shift_bar_start') {
        const task = referenceQueue.current[deck].then(async () => {
          const state = currentAudio.current.decks[deck];
          if (!state.track || !state.grid || value === undefined) throw new Error('Load a track with a timing grid first');
          await loadReferences(state);
          const stored = references.current[deck];
          if (stored.generation !== state.generation) throw new Error('Source replaced; retry on the current deck');
          const beats = action === 'reference_beat' ? [...stored.beats.slice(-1), value] : stored.beats;
          const grid = action === 'reference_beat'
            ? gridForReferenceBeats(stored.grid ?? state.grid, beats, state.track.duration_seconds)
            : shiftBarStart(stored.grid ?? state.grid, value === 1 ? 1 : -1, state.track.duration_seconds);
          await invoke<TimingRecord>('track_timing', { trackId: state.track.track_id, grid, referenceBeats: beats });
          await invoke('apply_timing', { deck, generation: state.generation, grid });
          stored.beats = beats;
          stored.grid = grid;
          setAudio(previous => ({ ...previous, decks: previous.decks.map(d => d.deck === deck && d.generation === state.generation ? { ...d, grid, reference_beats: beats, target_bpm: grid.bpm, speed: 1, synced: false } : d) }));
        });
        referenceQueue.current[deck] = task.catch(() => {});
        await task;
      } else if (action === 'timing_saved') {
        const stored = references.current[deck]; stored.beats = []; stored.grid = null; stored.loaded = true;
        setAudio(previous => ({ ...previous, decks: previous.decks.map(d => d.deck === deck ? { ...d, reference_beats: [] } : d) }));
      } else await invoke('deck_control', { deck, action, value: value ?? null, generation: currentAudio.current.decks[deck].generation });
      setErrors(previous => previous.map((v, d) => d === deck ? null : v));
    }
    catch (e) { setErrors(previous => previous.map((v, d) => d === deck ? String(e) : v)); }
  }
  return { audio, load, control, errors, loading, loadingTrackIds, pollError };
}

export function time(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${Math.floor((seconds - whole) * 10)}`;
}

export function Deck({ state, running, loading, loadingTitle, error, load, control, showVolume = true, syncQuantum = 4, onTimingOpenChange }: { showVolume?: boolean; syncQuantum?: number; onTimingOpenChange?: (deck: number, open: boolean) => void; state: DeckState; running: boolean; loading: boolean; loadingTitle?: string; error: string | null; load: (deck: number, id: string) => Promise<void>; control: (deck: number, action: string, value?: number) => Promise<void> }) {
  const name = state.deck === 0 ? 'A' : 'B';
  const total = state.track?.duration_seconds ?? 0;
  const [editing, setEditing] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);
  const [target, setTarget] = useState(String(state.target_bpm ?? 0));
  const [gain,setGain]=useState(state.gain);
  const [clickGain,setClickGain]=useState(state.click_gain ?? 0);
  const gainInput=useRef(-Infinity), clickInput=useRef(-Infinity), previousGeneration=useRef(state.generation);
  useEffect(()=>{
    const replaced=previousGeneration.current!==state.generation;
    if(replaced || performance.now()-gainInput.current>500) setGain(state.gain);
    if(replaced || performance.now()-clickInput.current>500) setClickGain(state.click_gain ?? 0);
    previousGeneration.current=state.generation;
  },[state]);
  useEffect(() => setTarget(String(state.target_bpm ?? 0)), [state.target_bpm, state.generation]);
  useEffect(() => setEditing(false), [state.generation]);
  useEffect(() => {
    if (!timingOpen || !running || !state.track) return;
    void control(state.deck, 'click_panel', 1);
    return () => { void control(state.deck, 'click_panel', 0); };
  }, [timingOpen, state.generation, running, state.track?.track_id]);
  const clock = useRef(new DisplayPosition());
  const playhead = useRef<SVGPathElement>(null);
  const overview = useRef<SVGSVGElement>(null);
  const timeLabel = useRef<HTMLOutputElement>(null);
  const lastTime = useRef('');
  const draw = useRef<(now:number)=>void>(()=>{});
  const { gesture: scrub, handlers: scrubHandlers } = useScrub(state, running, control,
    (element, x) => { const bounds = element.getBoundingClientRect(); return (x-bounds.left)/Math.max(1,bounds.width)*total; },
    () => clock.current.at(performance.now()), () => draw.current(performance.now()), false);
  draw.current = now => {
    const cursor=scrub.current?.position ?? clock.current.at(now);
    playhead.current?.setAttribute('d',`M${total ? cursor/total*1024 : 0},0V120`);
    const label=`${time(cursor)} / ${time(total)}`;
    if (label !== lastTime.current) {
      if (timeLabel.current) timeLabel.current.textContent=label;
      overview.current?.setAttribute('aria-valuenow',String(cursor));
      lastTime.current=label;
    }
  };
  useLayoutEffect(() => {
    const received=state.received_at ?? performance.now();
    clock.current.update({...state,playing:state.playing && !state.launch_pending && running,duration:total},received,state.sampled_at ?? received);
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
  const overviewBars = useMemo(() => markers(state.grid, 0, total).filter(m => m.beat === 1).map(m =>
    <path key={m.seconds} d={`M${m.seconds / total * 1024},0V120`} stroke="currentColor" opacity={state.grid?.reviewed ? .6 : .25} />),
    [state.grid?.bpm, state.grid?.downbeat_seconds, state.grid?.reviewed, total]);
  const ready = Boolean(state.track && running);
  const preparing = loading || state.loading;
  const dragTempo = useTempoDrag(state.target_bpm ?? state.grid?.bpm ?? 120, (state.grid?.bpm ?? 120) * .5, (state.grid?.bpm ?? 120) * 2, !ready || loading || state.loading || !state.grid || !!state.synced, value => control(state.deck, 'tempo', value), state.generation);
  return <article className={`deck deck-${state.deck}${preparing ? ' is-loading' : ''}`} aria-label={`Deck ${name}`} aria-busy={preparing} onDragOver={event => { if (event.dataTransfer.types.includes(TRACK_MIME)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDrop={event => { const id = event.dataTransfer.getData(TRACK_MIME); if (/^[a-f0-9]{64}$/.test(id)) { event.preventDefault(); void load(state.deck, id); } }}>
    <div className="deck-header"><h2 className="deck-badge" title={`Deck ${name}`}>{name}</h2>{state.track ? <TrackArtwork trackId={state.track.track_id} className="track-art" fallback="♫" alt={`${state.track.title} cover`} /> : <span className="track-art" aria-hidden="true">♫</span>}<div className="track-meta"><div className="deck-title">{state.track?.title ?? 'No track loaded'}</div><p>{state.track?.artist ?? 'Drop a track to load'}</p></div><div className={`deck-tempo${state.synced ? ' locked' : ''}`}><span className="tempo-drag" aria-disabled={!ready || loading || state.loading || !state.grid || !!state.synced} aria-label={`BPM deck ${name}`} onPointerDown={dragTempo} title="Double-click to unlock and restore original tempo" onDoubleClick={() => { if (!ready || !state.grid) return; void (async () => { if (state.synced) await control(state.deck, 'sync', 0); await control(state.deck, 'tempo', state.grid!.bpm); })(); }}>{state.target_bpm ? state.target_bpm.toFixed(1) : '—'}</span><button className={state.synced ? 'tempo-lock active' : 'tempo-lock'} aria-label={`${state.synced ? 'Unlock' : 'Lock'} deck ${name} to master tempo`} aria-pressed={!!state.synced} title={state.synced ? 'Unlock from master BPM' : 'Lock to master BPM'} disabled={!ready || !state.grid} onClick={() => void control(state.deck, 'sync', state.synced ? 0 : 1)}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path className="lock-shackle" d={state.synced ? 'M5.5 9V6.5a4.5 4.5 0 0 1 9 0V9' : 'M5.5 9V6.5a4.5 4.5 0 0 1 8.5-2'} /><rect x="3.5" y="8.5" width="13" height="9" rx="1.5" /><path className="lock-slot" d="M10 11.5v3" /></svg></button><small>{state.launch_pending ? syncQuantum === 1 ? 'WAITING FOR BEAT' : 'WAITING FOR BAR 1' : state.synced ? 'LOCKED TO MASTER' : 'INDEPENDENT'}</small></div></div>
    <div className="deck-main"><div className="transport">
      <button className="cue-button" disabled title="Cue points are coming later">CUE</button>
      <button className="play-button" aria-label={`${state.playing ? 'Pause' : 'Play'} deck ${name}`} disabled={!ready} onClick={() => void control(state.deck, state.playing ? 'pause' : 'play')}>{state.playing ? 'Ⅱ' : '▶'}</button>
      <button aria-label={`Stop deck ${name}`} disabled={!ready} onClick={() => void control(state.deck, 'stop')}>Stop</button>
    </div><div className="deck-overview">
    <svg ref={overview} viewBox="0 0 1024 120" preserveAspectRatio="none" className="waveform" role="slider" tabIndex={-1} aria-label={`Waveform seek deck ${name}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={state.position_seconds} aria-disabled={!ready}
      {...scrubHandlers}
      onKeyDown={event => { if (!ready) return; const cursor=clock.current.at(performance.now()); let value: number | undefined;
        if (event.key === 'ArrowLeft') value = Math.max(0, cursor - 5);
        if (event.key === 'ArrowRight') value = Math.min(total, cursor + 5);
        if (event.key === 'Home') value = 0;
        if (event.key === 'End') value = total;
        if (value !== undefined) { event.preventDefault(); void control(state.deck, 'seek', value); }
      }}>
      {overviewBars}
      {timingOpen && state.reference_beats?.map((seconds, index) => <path key={`${index}-${seconds}`} className="reference-beat" d={`M${seconds / total * 1024},0V120`} />)}
      <path d="M0,60H1024" stroke="#303943" />{wave}
      <path ref={playhead} d={`M${total ? state.position_seconds / total * 1024 : 0},0V120`} stroke="#f2f5f6" strokeWidth="3" />
    </svg>
    {!state.track && <span className="waveform-empty">Drag a track from the library</span>}
    <div className="overview-footer"><span>FULL TRACK</span>
      <output ref={timeLabel} className="numeric" aria-label={`Time deck ${name}`}>{time(state.position_seconds)} / {time(total)}</output>
    </div></div></div>
    <div className="loop-controls" aria-label={`Future loop controls deck ${name}`}>{['IN', 'OUT', '↶', '›', '2', '4', '8', '16'].map(label => <button disabled key={label} title="Looping is coming later">{label}</button>)}</div>
    <details className="deck-settings" onToggle={event => { const open = event.currentTarget.open; setTimingOpen(open); onTimingOpenChange?.(state.deck, open); if (open) { const deck = event.currentTarget.closest<HTMLElement>('.deck'); requestAnimationFrame(() => { if (deck) deck.scrollTop = deck.scrollHeight; }); } }}><summary>Timing & tempo <span>{state.grid ? `${state.grid.reviewed ? 'Reviewed' : 'Draft'} grid · ${(state.speed ?? 1).toFixed(3)}×` : 'No timing grid'}</span></summary><div className="timing-controls">
      {showVolume && <label>Volume <input type="range" min="0" max="1" step="0.01" value={gain} disabled={!ready} aria-label={`Volume deck ${name}`} onChange={event => {gainInput.current=performance.now();setGain(Number(event.target.value));void control(state.deck,'gain',Number(event.target.value));}} /></label>}
      <button disabled={!ready} onClick={() => setEditing(!editing)}>Edit timing</button>
      <button disabled={!ready || !state.grid} onClick={() => void control(state.deck, 'reference_beat', Math.min(Math.max(0, clock.current.at(performance.now())), Math.max(0, total - 1 / 48000)))}>Set reference beat</button>
      <div className="shift-bar-row"><span>Shift bar start</span><button disabled={!ready || !state.grid} aria-label={`Shift bar start back one beat on deck ${name}`} onClick={() => void control(state.deck, 'shift_bar_start', -1)}>Back</button><button disabled={!ready || !state.grid} aria-label={`Shift bar start forward one beat on deck ${name}`} onClick={() => void control(state.deck, 'shift_bar_start', 1)}>Forward</button></div>
      <span>Source {state.grid ? `${state.grid.bpm.toFixed(2)} BPM · ${state.grid.reviewed ? 'reviewed' : 'draft'}` : 'timing unavailable'}</span>
      <label>Target BPM <input type="number" step=".01" min={(state.grid?.bpm ?? 0) * .5} max={(state.grid?.bpm ?? 0) * 2} disabled={!ready || !state.grid || state.synced} value={target} onChange={e => setTarget(e.target.value)} /></label>
      <button disabled={!ready || !state.grid || state.synced || !Number.isFinite(Number(target))} onClick={() => void control(state.deck, 'tempo', Number(target))}>Set tempo</button>
      <button disabled={!ready || !state.grid || state.synced} onClick={() => void control(state.deck,'tempo',state.grid!.bpm*.5)}>Half speed</button>
      <button disabled={!ready || !state.grid || state.synced} onClick={() => void control(state.deck,'tempo',state.grid!.bpm)}>Original tempo</button>
      <button disabled={!ready || !state.grid || state.synced} onClick={() => void control(state.deck,'tempo',state.grid!.bpm*2)}>Double speed</button>
      <span>Speed {(state.speed ?? 1).toFixed(3)}× · supported 0.5–2.0× · pitch preserved</span>
      <label>Click volume (0 = off) <input type="range" min="0" max="1" step=".01" value={clickGain} disabled={!ready || !state.grid} onChange={e => {clickInput.current=performance.now();setClickGain(Number(e.target.value));void control(state.deck,'click',Number(e.target.value));}} /></label>
    </div></details>
    {!!state.reposition_seconds && <p>Last master alignment: {state.reposition_seconds > 0 ? '+' : ''}{state.reposition_seconds.toFixed(3)} s</p>}
    {state.timing_error && <p role="alert" className="row-error">{state.timing_error}</p>}
    {editing && state.track && <TimingEditor key={state.generation} trackId={state.track.track_id} title={state.track.title} duration={total} prepared={state.track} position={state.position_seconds} getPosition={() => clock.current.at(performance.now())} deck={state.deck} generation={state.generation} seek={seconds => void control(state.deck, 'seek', seconds)} close={() => setEditing(false)} onSaved={() => void control(state.deck, 'timing_saved')} />}
    {preparing && <p className="deck-load-status" role="status">Loading {loadingTitle ?? 'track'}</p>}
    {(error || state.error) && <p className="row-error" role="alert">{error || state.error}</p>}
  </article>;
}

export function RollingWaveforms({ audio, beats = 32, control, onZoomChange, timingOpen = [false, false] }: { audio: AudioState; beats?: number; timingOpen?: boolean[]; onZoomChange?: (beats: number) => void; control?: (deck: number, action: string, value?: number) => Promise<void> }) {
  const zoomRef = useWaveformZoom(beats, onZoomChange);
  const reference = audio.master_bpm;
  const window = reference && reference > 0 ? beats * 60 / reference : beats / 2;
  return <section ref={zoomRef} className="rolling" aria-label="Rolling waveforms">
    <span className="sr-only">{reference ? 'Beat grid' : 'Time fallback'} · {window.toFixed(2)} seconds output window</span>
    <div className="rolling-rows">{audio.decks.map(state => <RollingRow key={state.deck} state={state} running={audio.running} window={window} control={control} timingOpen={timingOpen[state.deck]} />)}</div>
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
  return <div className="mixer-dial" role="slider" tabIndex={enabled ? 0 : -1} aria-disabled={!enabled} aria-label={`${dialNames[label]} deck ${deck}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-valuetext={description} title={`${dialNames[label]} · ${description} · drag to turn, double-click to reset`}
    onPointerDown={event => { if (!enabled) return; event.preventDefault(); drag.current = { pointerId: event.pointerId, y: event.clientY, value }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
    onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) turn(drag.current.value + (drag.current.y - event.clientY) / 140); }}
    onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
    onDoubleClick={() => turn(initial)}
    onKeyDown={event => { const step = event.shiftKey ? .1 : .02; if (event.key === 'ArrowUp' || event.key === 'ArrowRight') { event.preventDefault(); turn(value + step); } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') { event.preventDefault(); turn(value - step); } else if (event.key === 'Home') { event.preventDefault(); turn(0); } else if (event.key === 'End') { event.preventDefault(); turn(1); } else if (event.key === '0') { event.preventDefault(); turn(initial); } }}>
    <svg viewBox="0 0 40 40" aria-hidden="true"><circle className="mixer-dial-base" cx="20" cy="20" r="17" />{Math.abs(angle) > .1 && <path className="mixer-dial-arc" d={`M20 3 A17 17 0 0 ${angle > 0 ? 1 : 0} ${endX} ${endY}`} />}<text x="20" y="23" textAnchor="middle">{label}</text></svg>
  </div>;
}

function ChannelFader({ state, running, control }: { state: DeckState; running: boolean; control: (deck: number, action: string, value?: number) => Promise<void> }) {
  const name = state.deck === 0 ? 'A' : 'B';
  const [gain, setGain] = useState(state.gain);
  const inputAt = useRef(-Infinity);
  const generation = useRef(state.generation);
  useEffect(() => {
    if (generation.current !== state.generation || performance.now() - inputAt.current > 500) setGain(state.gain);
    generation.current = state.generation;
  }, [state]);
  return <div className={`mixer-channel deck-${state.deck}`}>
    <span className="mixer-channel-name">{name}</span>
    <div className="mixer-channel-top"><MixerDial label="GN" state={state} running={running} control={control} /><button className="mixer-headphones" disabled aria-label={`Headphone cue deck ${name} coming later`} title="Headphone cue is coming later"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 13v-2a8 8 0 0 1 16 0v2M4 13h3v7H5a2 2 0 0 1-2-2v-3a2 2 0 0 0-1-2Zm16 0h-3v7h2a2 2 0 0 0 2-2v-3a2 2 0 0 0-1-2Z" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></button></div>
    <div className="mixer-channel-body">
      <div className="mixer-eq" aria-label={`EQ and filter deck ${name}`}>{(['HI', 'MD', 'LO', 'FL'] as const).map(label => <div className="mixer-eq-row" key={label}><MixerDial label={label} state={state} running={running} control={control} /></div>)}</div>
      <div className="mixer-fader-group"><input className="vertical-fader" type="range" min="0" max="1" step=".01" value={gain} disabled={!state.track || !running} aria-label={`Volume deck ${name}`} onChange={event => { const value = Number(event.target.value); inputAt.current = performance.now(); setGain(value); void control(state.deck, 'gain', value); }} /><output>{Math.round(gain * 100)}%</output></div>
      <div className="level-meter" aria-label={`Deck ${name} meter unavailable`} title="Level metering is coming later" />
    </div>
  </div>;
}

export function Mixer({ audio, control }: { audio: AudioState; control: (deck: number, action: string, value?: number) => Promise<void> }) {
  return <section className="mixer" aria-label="Mixer"><div className="mixer-channels"><ChannelFader state={audio.decks[0]} running={audio.running} control={control} /><div className="mixer-master"><span>MASTER</span><div className="stereo-meters" aria-label="Stereo master meters unavailable" title="Level metering is coming later"><div className="level-meter" /><div className="level-meter" /></div><div className="mixer-stereo-labels"><span>L</span><span>R</span></div></div><ChannelFader state={audio.decks[1]} running={audio.running} control={control} /></div><div className="mixer-crossfader"><span>A</span><input className="crossfader" type="range" min="-1" max="1" value="0" disabled aria-label="Crossfader coming later" /><span>B</span></div></section>;
}
