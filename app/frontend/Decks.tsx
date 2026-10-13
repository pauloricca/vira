import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RollingRow } from './RollingRow';
import { DisplayPosition, animate } from './transport';
import { Grid, TimingEditor, markers } from './Timing';

export const TRACK_MIME = 'application/x-vira-track-id';
export type Prepared = { track_id: string; artifact_id: string; title: string; artist: string; filename: string; duration_seconds: number; frames: number; peak_frames: number; peaks: [number, number][]; fine_peak_frames?: number; fine_peaks?: [number, number][] };
export type DeckState = { deck: number; loading: boolean; error: string | null; track: Prepared | null; position_seconds: number; playing: boolean; launch_pending?: boolean; gain: number; generation: number; requested_generation: number; received_at?: number; sampled_at?: number; position_epoch?: number; track_unchanged?: boolean; grid?: Grid | null; target_bpm?: number; speed?: number; synced?: boolean; click_gain?: number; reposition_seconds?: number; timing_error?: string | null };
export type AudioState = { master_bpm?: number; drift_rate?: number; sync_quantum?: number; drift_target?: number | null; output_frame?: number; decks: DeckState[]; running: boolean; error: string | null; telemetry: { callback?: { starved_frames: number; device_errors: number; actual_callback_frames_min: number; actual_callback_frames_max: number }; realtime_policy_verified?: boolean; live_source_pcm_bytes?: number } };
const empty = (deck: number): DeckState => ({ deck, loading: false, error: null, track: null, position_seconds: 0, playing: false, gain: .8, generation: 0, requested_generation: 0 });

export function useDecks() {
  const [audio, setAudio] = useState<AudioState>({ master_bpm: 120, drift_rate: 1, decks: [empty(0), empty(1)], running: false, error: null, telemetry: {} });
  const [errors, setErrors] = useState<(string | null)[]>([null, null]);
  const [loading, setLoading] = useState([false, false]);
  const [pollError, setPollError] = useState<string | null>(null);
  const requests = useRef([0, 0]);
  const currentAudio = useRef(audio);
  currentAudio.current = audio;
  const fineCache = useRef(new Map<string, Prepared>());
  const finePending = useRef(new Set<string>());
  useEffect(() => {
    const active = new Set(audio.decks.map(d => d.track?.artifact_id).filter(Boolean));
    for (const key of fineCache.current.keys()) if (!active.has(key)) fineCache.current.delete(key);
    for (const d of audio.decks) {
      const track = d.track;
      if (!track || fineCache.current.has(track.artifact_id) || finePending.current.has(track.artifact_id)) continue;
      finePending.current.add(track.artifact_id);
      void invoke<Prepared>('timing_waveform', { trackId: track.track_id }).then(value => {
        if (!currentAudio.current.decks.some(deck => deck.track?.artifact_id === value.artifact_id)) return;
        fineCache.current.set(value.artifact_id, value);
        setAudio(previous => ({ ...previous, decks: previous.decks.map(deck => deck.track?.artifact_id === value.artifact_id ? { ...deck, track: { ...deck.track, fine_peaks: value.fine_peaks, fine_peak_frames: value.fine_peak_frames } } : deck) }));
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
          const stableTrack = cached && track && !track.fine_peaks?.length ? { ...track, fine_peaks: cached.fine_peaks, fine_peak_frames: cached.fine_peak_frames } : track;
          return { ...d, track: stableTrack, received_at: received, sampled_at: (sent + received) / 2 };
        }) }); setPollError(null); }
      } catch (e) { if (!cancelled) setPollError(String(e)); }
      if (!cancelled) timer = setTimeout(() => void poll(), 200);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  async function load(deck: number, trackId: string) {
    const request = ++requests.current[deck];
    setErrors(previous => previous.map((v, d) => d === deck ? null : v));
    setLoading(previous => previous.map((v, d) => d === deck ? true : v));
    try { await invoke('load_track', { deck, trackId }); }
    catch (e) { if (request === requests.current[deck]) setErrors(previous => previous.map((v, d) => d === deck ? String(e) : v)); }
    finally { if (request === requests.current[deck]) setLoading(previous => previous.map((v, d) => d === deck ? false : v)); }
  }
  async function control(deck: number, action: string, value?: number) {
    try { await invoke('deck_control', { deck, action, value: value ?? null, generation: currentAudio.current.decks[deck].generation }); setErrors(previous => previous.map((v, d) => d === deck ? null : v)); }
    catch (e) { setErrors(previous => previous.map((v, d) => d === deck ? String(e) : v)); }
  }
  return { audio, load, control, errors, loading, pollError };
}

export function time(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${Math.floor((seconds - whole) * 10)}`;
}

export function Deck({ state, running, loading, error, load, control, showVolume = true, syncQuantum = 4 }: { showVolume?: boolean; syncQuantum?: number; state: DeckState; running: boolean; loading: boolean; error: string | null; load: (deck: number, id: string) => Promise<void>; control: (deck: number, action: string, value?: number) => Promise<void> }) {
  const name = state.deck === 0 ? 'A' : 'B';
  const total = state.track?.duration_seconds ?? 0;
  const [editing, setEditing] = useState(false);
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
  const clock = useRef(new DisplayPosition());
  const playhead = useRef<SVGPathElement>(null);
  const overview = useRef<SVGSVGElement>(null);
  const timeLabel = useRef<HTMLOutputElement>(null);
  const lastTime = useRef('');
  const draw = useRef<(now:number)=>void>(()=>{});
  draw.current = now => {
    const cursor=clock.current.at(now);
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
    return `M${x.toFixed(2)},${60 - amplitude}V${60 + amplitude}`;
  }).join(' ') ?? '', [state.track?.artifact_id]);
  const overviewBars = useMemo(() => markers(state.grid, 0, total).filter(m => m.beat === 1).map(m =>
    <path key={m.seconds} d={`M${m.seconds / total * 1024},0V120`} stroke="currentColor" opacity={state.grid?.reviewed ? .6 : .25} />),
    [state.grid?.bpm, state.grid?.downbeat_seconds, state.grid?.reviewed, total]);
  const ready = Boolean(state.track && running);
  return <article className={`deck deck-${state.deck}`} aria-label={`Deck ${name}`} onDragOver={event => { if (event.dataTransfer.types.includes(TRACK_MIME)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
    onDrop={event => { const id = event.dataTransfer.getData(TRACK_MIME); if (/^[a-f0-9]{64}$/.test(id)) { event.preventDefault(); void load(state.deck, id); } }}>
    <div className="deck-header"><h2 className="deck-badge" title={`Deck ${name}`}>{name}</h2><div className="track-art" aria-hidden="true">♫</div><div className="track-meta"><div className="deck-title">{state.track?.title ?? 'No track loaded'}</div><p>{state.track?.artist ?? 'Drop a track to load'}</p></div><div className={`deck-tempo${state.synced ? ' locked' : ''}`}><span title="Double-click to unlock and restore original tempo" onDoubleClick={() => { if (!ready || !state.grid) return; void (async () => { if (state.synced) await control(state.deck, 'sync', 0); await control(state.deck, 'tempo', state.grid!.bpm); })(); }}>{state.target_bpm ? state.target_bpm.toFixed(1) : '—'}</span><button className={state.synced ? 'tempo-lock active' : 'tempo-lock'} aria-label={`${state.synced ? 'Unlock' : 'Lock'} deck ${name} to master tempo`} aria-pressed={!!state.synced} title={state.synced ? 'Unlock from master BPM' : 'Lock to master BPM'} disabled={!ready || !state.grid} onClick={() => void control(state.deck, 'sync', state.synced ? 0 : 1)}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path className="lock-shackle" d={state.synced ? 'M5.5 9V6.5a4.5 4.5 0 0 1 9 0V9' : 'M5.5 9V6.5a4.5 4.5 0 0 1 8.5-2'} /><rect x="3.5" y="8.5" width="13" height="9" rx="1.5" /><path className="lock-slot" d="M10 11.5v3" /></svg></button><small>{state.launch_pending ? syncQuantum === 1 ? 'WAITING FOR BEAT' : 'WAITING FOR BAR 1' : state.synced ? 'LOCKED TO MASTER' : 'INDEPENDENT'}</small></div></div>
    <div className="deck-main"><div className="transport">
      <button className="cue-button" disabled title="Cue points are coming later">CUE</button>
      <button className="play-button" aria-label={`${state.playing ? 'Pause' : 'Play'} deck ${name}`} disabled={!ready} onClick={() => void control(state.deck, state.playing ? 'pause' : 'play')}>{state.playing ? 'Ⅱ' : '▶'}</button>
      <button aria-label={`Stop deck ${name}`} disabled={!ready} onClick={() => void control(state.deck, 'stop')}>Stop</button>
    </div><div className="deck-overview">
    <svg ref={overview} viewBox="0 0 1024 120" preserveAspectRatio="none" className="waveform" role="slider" tabIndex={-1} aria-label={`Waveform seek deck ${name}`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={state.position_seconds} aria-disabled={!ready}
      onClick={event => { if (ready) { const bounds = event.currentTarget.getBoundingClientRect(); void control(state.deck, 'seek', Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * total); } }}
      onKeyDown={event => { if (!ready) return; const cursor=clock.current.at(performance.now()); let value: number | undefined;
        if (event.key === 'ArrowLeft') value = Math.max(0, cursor - 5);
        if (event.key === 'ArrowRight') value = Math.min(total, cursor + 5);
        if (event.key === 'Home') value = 0;
        if (event.key === 'End') value = total;
        if (value !== undefined) { event.preventDefault(); void control(state.deck, 'seek', value); }
      }}>
      {overviewBars}
      <path d="M0,60H1024" stroke="#303943" /><path d={wave} stroke="currentColor" />
      <path ref={playhead} d={`M${total ? state.position_seconds / total * 1024 : 0},0V120`} stroke="#f2f5f6" strokeWidth="3" />
    </svg>
    {!state.track && <span className="waveform-empty">Drag a track from the library</span>}
    <div className="overview-footer"><span>FULL TRACK</span>
      <output ref={timeLabel} className="numeric" aria-label={`Time deck ${name}`}>{time(state.position_seconds)} / {time(total)}</output>
    </div></div></div>
    <div className="loop-controls" aria-label={`Future loop controls deck ${name}`}>{['IN', 'OUT', '↶', '›', '2', '4', '8', '16'].map(label => <button disabled key={label} title="Looping is coming later">{label}</button>)}</div>
    <details className="deck-settings"><summary>Timing & tempo <span>{state.grid ? `${state.grid.reviewed ? 'Reviewed' : 'Draft'} grid · ${(state.speed ?? 1).toFixed(3)}×` : 'No timing grid'}</span></summary><div className="timing-controls">
      {showVolume && <label>Volume <input type="range" min="0" max="1" step="0.01" value={gain} disabled={!ready} aria-label={`Volume deck ${name}`} onChange={event => {gainInput.current=performance.now();setGain(Number(event.target.value));void control(state.deck,'gain',Number(event.target.value));}} /></label>}
      <button disabled={!ready} onClick={() => setEditing(!editing)}>Edit timing</button>
      <button disabled={!ready} onClick={() => void control(state.deck, 'clear')}>Clear deck {name}</button>
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
    {editing && state.track && <TimingEditor key={state.generation} trackId={state.track.track_id} title={state.track.title} duration={total} prepared={state.track} position={state.position_seconds} getPosition={() => clock.current.at(performance.now())} deck={state.deck} generation={state.generation} seek={seconds => void control(state.deck, 'seek', seconds)} close={() => setEditing(false)} />}
    {(loading || state.loading) && <p role="status">Preparing track… {state.track ? 'The current track remains usable.' : 'This may take a moment.'}</p>}
    {(error || state.error) && <p className="row-error" role="alert">{error || state.error}</p>}
  </article>;
}

export function RollingWaveforms({ audio, beats = 32 }: { audio: AudioState; beats?: number }) {
  const reference = audio.master_bpm;
  const window = reference && reference > 0 ? beats * 60 / reference : beats / 2;
  return <section className="rolling" aria-label="Rolling waveforms">
    <span className="sr-only">{reference ? 'Beat grid' : 'Time fallback'} · {window.toFixed(2)} seconds output window</span>
    <div className="rolling-rows">{audio.decks.map(state => <RollingRow key={state.deck} state={state} running={audio.running} window={window} />)}<div className="rolling-playhead" /></div>
  </section>;
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
  return <div className={`mixer-channel deck-${state.deck}`}><span>{name}</span><div className="fader-meter"><input className="vertical-fader" type="range" min="0" max="1" step=".01" value={gain} disabled={!state.track || !running} aria-label={`Volume deck ${name}`} onChange={event => { const value = Number(event.target.value); inputAt.current = performance.now(); setGain(value); void control(state.deck, 'gain', value); }} /><div className="level-meter" aria-label={`Deck ${name} meter unavailable`} title="Level metering is coming later" /></div><output>{Math.round(gain * 100)}%</output></div>;
}

export function Mixer({ audio, control }: { audio: AudioState; control: (deck: number, action: string, value?: number) => Promise<void> }) {
  return <section className="mixer" aria-label="Mixer"><div className="mixer-channels"><ChannelFader state={audio.decks[0]} running={audio.running} control={control} /><div className="mixer-channel master-channel"><span>MASTER</span><div className="fader-meter"><input className="vertical-fader" type="range" disabled value=".8" min="0" max="1" step=".01" aria-label="Master volume coming later" /><div className="stereo-meters" aria-label="Stereo master meters unavailable" title="Level metering is coming later"><div className="level-meter" /><div className="level-meter" /></div></div><output>STEREO</output></div><ChannelFader state={audio.decks[1]} running={audio.running} control={control} /></div><input className="crossfader" type="range" min="-1" max="1" value="0" disabled aria-label="Crossfader coming later" /><small className="meter-note">Meters · coming later</small></section>;
}
