import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Track } from './App';
import type { AudioState } from './Decks';
import type { Tag } from './Tags';
import { camelotKey, shiftedKey } from './harmonic';

export type AutopilotWeights = { bpm: number; tags: number; harmonic: number; direction: number; randomness: number };
export type AutopilotSelection = 'automatic' | 'list';
export const defaultAutopilotWeights: AutopilotWeights = { bpm: 50, tags: 50, harmonic: 50, direction: 50, randomness: 0 };

export function chooseNextInList(tracks: Track[], reference: Track | undefined, played: Set<string>): Track | undefined {
  const index = tracks.findIndex(track => track.id === reference?.id);
  const ordered = [...tracks.slice(index + 1), ...tracks.slice(0, index + 1)];
  return ordered.find(track => track.status === 'ready' && !played.has(track.id) && track.id !== reference?.id);
}

export function chooseAutopilotTrack(tracks: Track[], reference: Track | undefined, played: Set<string>, tags: Tag[], weights: AutopilotWeights, pitch = 0, random = Math.random, lastDirection = 0): Track | undefined {
  const candidates = tracks.filter(track => track.status === 'ready' && !played.has(track.id) && track.id !== reference?.id);
  if (!reference) return candidates[Math.floor(random() * candidates.length)];
  const bpm = reference.analysis.result?.grid?.bpm;
  const key = camelotKey(shiftedKey(reference.analysis.result?.keys[0]?.key, pitch));
  const referenceTags = tags.filter(tag => tag.tracks.includes(reference.id));
  let best = -Infinity;
  let choices: Track[] = [];
  for (const track of candidates) {
    const candidateBpm = track.analysis.result?.grid?.bpm;
    // A ten percent tempo difference scores zero; missing metadata scores zero.
    const tempo = bpm && candidateBpm ? Math.max(0, 1 - Math.abs(candidateBpm - bpm) / (bpm * .1)) : 0;
    const common = referenceTags.filter(tag => tag.tracks.includes(track.id)).length / Math.max(1, referenceTags.length);
    const candidateKey = camelotKey(track.analysis.result?.keys[0]?.key);
    const distance = key && candidateKey ? Math.min(Math.abs(key.number - candidateKey.number), 12 - Math.abs(key.number - candidateKey.number)) : null;
    const harmonic = key && candidateKey && (distance === 0 || distance === 1 && key.letter === candidateKey.letter) ? 1 : 0;
    const direction = lastDirection && bpm && candidateBpm && Math.sign(candidateBpm - bpm) === lastDirection ? 1 : 0;
    const noise = weights.randomness > 0 ? random() : 0;
    const score = weights.bpm * tempo + weights.tags * common + weights.harmonic * harmonic
      + weights.direction * direction + weights.randomness * noise;
    if (score > best) { best = score; choices = [track]; }
    else if (score === best) choices.push(track);
  }
  return choices[Math.floor(random() * choices.length)];
}

type Options = {
  audio: AudioState; loading: boolean[]; tracks: Track[]; allTracks: Track[]; tags: Tag[];
  next: string[]; setNext: Dispatch<SetStateAction<string[]>>; played: Set<string> | null;
  startSession: () => void; load: (deck: number, id: string) => Promise<void>;
  control: (deck: number, action: string, value?: number) => Promise<void>;
};

export function useAutopilot(options: Options) {
  const [enabled, setEnabled] = useState(false);
  const [selection, setSelection] = useState<AutopilotSelection>(() => localStorage.getItem('vira.autopilot-selection') === 'list' ? 'list' : 'automatic');
  const [weights, setWeights] = useState<AutopilotWeights>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('vira.autopilot-weights') ?? '{}');
      return Object.fromEntries(Object.entries(defaultAutopilotWeights).map(([key, value]) => [key,
        typeof saved[key] === 'number' && Number.isFinite(saved[key]) && saved[key] >= 0 && saved[key] <= 100 ? saved[key] : value])) as AutopilotWeights;
    } catch { return defaultAutopilotWeights; }
  });
  const automatic = useRef<string | null>(null);
  const loadAttempt = useRef('');
  const armAttempt = useRef('');
  const pending = useRef(false);
  const previousTrack = useRef<{ id: string; bpm: number | undefined } | null>(null);
  const lastDirection = useRef(0);
  const sessionWasActive = useRef(options.played !== null);
  // Observe completed handoffs even while Autopilot is off. Loading, pending
  // launches and the overlap itself do not establish a new BPM direction.
  useEffect(() => {
    if (sessionWasActive.current && options.played === null) {
      previousTrack.current = null;
      lastDirection.current = 0;
    }
    sessionWasActive.current = options.played !== null;
    if (!options.audio.running) return;
    const playing = options.audio.decks.filter(deck => deck.playing && !deck.loading && !deck.launch_pending && !deck.cue_preview);
    if (playing.length !== 1 || options.loading[playing[0].deck]) return;
    const deck = playing[0];
    const id = deck.track?.track_id;
    if (!id) return;
    const bpm = options.allTracks.find(track => track.id === id)?.analysis.result?.grid?.bpm ?? deck.grid?.bpm;
    const previous = previousTrack.current;
    if (previous && previous.id !== id) lastDirection.current = previous.bpm && bpm ? Math.sign(bpm - previous.bpm) : 0;
    previousTrack.current = { id, bpm };
  });
  function toggle() {
    if (!enabled) {
      options.startSession();
      loadAttempt.current = ''; armAttempt.current = '';
    }
    setEnabled(!enabled);
  }
  function prioritize(id: string) {
    if (!enabled) return;
    const old = automatic.current;
    automatic.current = null;
    options.setNext(previous => [id, ...previous.filter(candidate => candidate !== id && candidate !== old)]);
  }
  async function control(deck: number, action: string, value?: number) {
    if (enabled && (action === 'auto_end' && options.audio.auto_mode?.[deck] === 2
      || action === 'auto_now' && options.audio.auto_mode?.[deck] === 1)) setEnabled(false);
    await options.control(deck, action, value);
  }
  useEffect(() => {
    const { audio, loading, tracks, allTracks, tags, played, next, setNext, load } = options;
    if (!enabled || !audio.running || pending.current) return;
    const playing = audio.decks.filter(deck => deck.playing);
    // Both decks belong to the transition until it has completed.
    if (playing.length > 1) return;
    if (audio.decks.some(deck => deck.loading || loading[deck.deck] || deck.launch_pending || deck.cue_preview)) return;
    const from = playing[0] ?? audio.decks.find(deck => deck.track);
    const excluded = new Set(played ?? []);
    for (const deck of playing) if (deck.track) excluded.add(deck.track.track_id);
    let queued = next.filter(id => !playing.some(deck => deck.track?.track_id === id));
    if (automatic.current && queued.includes(automatic.current) && (!tracks.some(track => track.id === automatic.current) || excluded.has(automatic.current))) {
      const old = automatic.current;
      automatic.current = null;
      queued = queued.filter(id => id !== old);
      setNext(previous => previous.filter(id => id !== old));
    }
    if (!queued.length) {
      const reference = allTracks.find(track => track.id === from?.track?.track_id);
      const chosen = selection === 'list' ? chooseNextInList(tracks, reference, excluded)
        : chooseAutopilotTrack(tracks, reference, excluded, tags, weights, from?.pitch_semitones, Math.random, lastDirection.current);
      if (!chosen) return;
      automatic.current = chosen.id;
      setNext(previous => [...previous.filter(id => !playing.some(deck => deck.track?.track_id === id)), chosen.id]);
      return;
    }
    const id = queued[0];
    // With no playback, seed an empty deck but never start transport.
    const target = !from ? audio.decks[0] : !playing.length && from.track?.track_id === id ? from : audio.decks[1 - from.deck];
    if (target.track?.track_id !== id) {
      const key = `${target.deck}:${target.generation}:${id}`;
      if (loadAttempt.current === key) return;
      loadAttempt.current = key;
      pending.current = true;
      void load(target.deck, id).finally(() => { pending.current = false; });
      return;
    }
    if (!playing.length || !from) return;
    if (audio.auto_mode?.[from.deck]) { armAttempt.current = ''; return; }
    if (!audio.decks.every(deck => deck.track && deck.grid && !deck.loop_out_seconds)) return;
    const key = `${from.deck}:${audio.decks.map(deck => deck.generation).join(':')}:${audio.auto_mode?.[from.deck] ?? 0}`;
    if (armAttempt.current === key) return;
    armAttempt.current = key;
    pending.current = true;
    void options.control(from.deck, 'auto_end').finally(() => { pending.current = false; });
  });
  function changeWeight(key: keyof AutopilotWeights, value: number) {
    const next = { ...weights, [key]: value };
    setWeights(next);
    localStorage.setItem('vira.autopilot-weights', JSON.stringify(next));
  }
  function changeSelection(value: AutopilotSelection) {
    setSelection(value);
    localStorage.setItem('vira.autopilot-selection', value);
    // Reconsider only our own recommendation, preserving the manual queue.
    const old = automatic.current;
    automatic.current = null;
    if (old) options.setNext(previous => previous.filter(id => id !== old));
  }
  return { enabled, toggle, disable: () => setEnabled(false), selection, changeSelection, weights, changeWeight, prioritize, control };
}
