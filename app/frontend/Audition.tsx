import { MidiButton, MidiInput } from './MidiMapping';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { duration, type Track } from './App';
import type { AudioState } from './Decks';

export function PlayIcon({ paused = false }: { paused?: boolean }) {
  return <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor" aria-hidden="true">{paused ? <><rect x="5" y="3" width="3" height="14" /><rect x="12" y="3" width="3" height="14" /></> : <path d="M6 3.5 17 10 6 16.5Z" />}</svg>;
}

export function StopIcon() {
  return <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="12" height="12" /></svg>;
}

export function useAudition(audio: AudioState, tracks: Track[] = [], overlap = 8) {
  const [playAll, setPlayAll] = useState(false);
  const playlist = useRef<Track[]>([]);
  const [output, setOutput] = useState<'cue' | 'master'>('cue');
  const [selection, setSelection] = useState<{ track: Track; generation: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const commands = useRef(Promise.resolve());
  const state = selection?.generation === audio.audition?.generation ? audio.audition : undefined;
  async function play(track: Track) {
    const current = ++request.current;
    const start = tracks.findIndex(candidate => candidate.id === track.id);
    playlist.current = start >= 0 ? tracks.slice(start) : [track];
    setSelection({ track, generation: null });
    setError(null);
    try {
      const generation = await invoke<number>('audition_track', { trackId: track.id, output });
      if (current === request.current) setSelection({ track, generation });
    } catch (e) {
      if (current === request.current) { setSelection(null); setError(String(e)); }
    }
  }
  function control(action: 'play_pause' | 'seek' | 'stop', value?: number) {
    const current = request.current;
    const generation = selection?.generation ?? 0;
    if (action === 'stop') ++request.current;
    commands.current = commands.current.catch(() => {}).then(async () => {
      try {
        await invoke('audition_control', { action, generation, value: value ?? null });
        if (action === 'stop' && request.current === current + 1) { setSelection(null); setError(null); }
      } catch (e) { setError(String(e)); }
    });
  }
  function changeOutput(value: 'cue' | 'master') { control('stop'); setOutput(value); }
  const decksPlaying = audio.decks?.some(deck => deck.playing) ?? false;
  useEffect(() => {
    if (decksPlaying && playAll) { setPlayAll(false); control('stop'); }
    else if (decksPlaying && output === 'master') changeOutput('cue');
  }, [decksPlaying, output, playAll]);
  const index = state?.index ?? 0;
  const generation = selection?.generation;
  useEffect(() => {
    if (generation == null) return;
    let cancelled = false;
    const current = request.current;
    void (async () => {
      try {
        await invoke('audition_control', { action: 'sequence', generation, value: playAll && !decksPlaying ? overlap : -1 });
        const next = playlist.current[index + 1];
        if (!cancelled && playAll && !decksPlaying && next) {
          await invoke('queue_audition', { generation, index, trackId: next.id, output, currentTrackId: playlist.current[index]?.id });
        }
      } catch (e) { if (!cancelled && request.current === current) setError(`Play All: ${String(e)}`); }
    })();
    return () => { cancelled = true; };
  }, [generation, index, playAll, overlap, decksPlaying, output]);
  useEffect(() => { if (state?.error) setError(state.error); }, [state?.error]);
  const activeSelection = selection && { ...selection, track: playlist.current[index] ?? selection.track };
  return { selection: activeSelection, error, dismissError: () => setError(null), state, play, control, output, changeOutput, playAll, togglePlayAll: () => setPlayAll(value => !value) };
}

export function AuditionControls({ audition }: { audition: ReturnType<typeof useAudition> }) {
  const { selection, state, control } = audition;
  const [seek, setSeek] = useState<{ generation: number; position: number } | null>(null);
  useEffect(() => {
    if (!seek) return;
    const timer = setTimeout(() => setSeek(null), 500);
    return () => clearTimeout(timer);
  }, [seek]);
  if (!selection) return null;
  const loading = selection.generation === null;
  const position = seek?.generation === selection.generation ? seek!.position : state?.position_seconds ?? 0;
  return <div className="library-audition" role="group" aria-label="Library audition" title={`${audition.output === 'master' ? 'Master output' : 'Cue headphones'} · ${selection.track.title}`} onKeyDown={event => event.stopPropagation()}>
    <MidiButton midiId="audition:play" aria-label={state?.playing ? 'Pause audition' : 'Play audition'} disabled={loading} onClick={() => control('play_pause')}><PlayIcon paused={!!state?.playing} /></MidiButton>
    <MidiButton aria-label="Stop audition" onClick={() => control('stop')}><StopIcon /></MidiButton>
    <MidiInput type="range" aria-label="Audition position" min="0" max={selection.track.duration_seconds ?? 0} step="0.1" value={position} disabled={loading} onChange={event => { const position = Number(event.target.value); setSeek({ generation: selection.generation!, position }); control('seek', position); }} />
    <output>{loading ? 'Loading…' : `${duration(position)} / ${duration(selection.track.duration_seconds)}`}</output>
  </div>;
}
