import { useEffect, useRef, useState, type RefObject } from 'react';
import type { DeckState } from './Decks';
import { SettingsCard } from './SettingsSearch';

const defaults = { playing: .5, stopped: 5 };
function sensitivity(mode: keyof typeof defaults) {
  const value = Number(localStorage.getItem(`vira.trackpad-jog-${mode}-ms`) ?? defaults[mode]);
  return Number.isFinite(value) && value >= .1 && value <= 100 ? value : defaults[mode];
}

export function useTrackpadJog(element: RefObject<HTMLCanvasElement | null>, state: DeckState, running: boolean,
  control?: (deck: number, action: string, value?: number) => Promise<void>, onInteract?: (deck: number) => void) {
  const latest = useRef({state, running, control, onInteract});
  latest.current = {state, running, control, onInteract};
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    let movement = 0, pending = false, disposed = false, pinching = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function available() {
      const {state: deck, running, control} = latest.current;
      return running && control && deck.track && !deck.loading && !deck.grid_saving && !deck.launch_pending && !deck.cue_preview && !(deck.playing && deck.synced) && !node!.closest('.midi-map-mode');
    }
    function schedule() {
      if (!disposed && !pending && movement && timer === undefined) timer = setTimeout(flush, 16);
    }
    function flush() {
      timer = undefined;
      if (disposed || !available() || pinching) { movement = 0; return; }
      const amount = movement;
      movement = 0;
      if (!amount) return;
      pending = true;
      const {state: deck, control} = latest.current;
      void control!(deck.deck, 'jog', amount).then(() => { pending = false; schedule(); }, () => { pending = false; movement = 0; });
    }
    function wheel(event: WheelEvent) {
      // Chromium pinch uses Ctrl+wheel; WebKit sends native gesture events.
      if (event.ctrlKey) { movement = 0; return; }
      if (event.metaKey || event.altKey || pinching || !available()) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, node!.clientWidth || 800) : 1);
      if (!Number.isFinite(pixels) || pixels === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const deck = latest.current.state;
      latest.current.onInteract?.(deck.deck);
      movement = Math.max(-10, Math.min(10, movement + pixels * sensitivity(deck.playing ? 'playing' : 'stopped') / 1000));
      schedule();
    }
    function pinchStart() { pinching = true; movement = 0; }
    function pinchEnd() { pinching = false; }
    node.addEventListener('wheel', wheel, {passive:false});
    node.addEventListener('gesturestart', pinchStart);
    node.addEventListener('gestureend', pinchEnd);
    return () => {
      disposed = true;
      clearTimeout(timer);
      node.removeEventListener('wheel', wheel);
      node.removeEventListener('gesturestart', pinchStart);
      node.removeEventListener('gestureend', pinchEnd);
    };
  }, [element, state.deck, state.generation, state.playing, state.synced, running]);
}

export function TrackpadJogSettings() {
  const [values, setValues] = useState(() => ({playing:sensitivity('playing'), stopped:sensitivity('stopped')}));
  return <SettingsCard className="settings-card"><h3>Waveform trackpad</h3><p className="settings-hint">Scroll or slide two fingers over a deck’s rolling waveform to move through the audio. Horizontal and vertical scrolling use the same smoothing as MIDI wheels. Works in Edit grid mode too, without changing the grid. Playing decks must be unlocked. Pinch still changes waveform zoom.</p>{(['playing','stopped'] as const).map(mode => <div className="settings-row" key={mode}><strong>{mode === 'playing' ? 'Playing movement' : 'Stopped movement'}</strong><label><input type="number" aria-label={`Waveform trackpad ${mode} movement`} min="0.1" max="100" step="0.1" value={values[mode]} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= .1 && value <= 100) { localStorage.setItem(`vira.trackpad-jog-${mode}-ms`, String(value)); setValues(old => ({...old,[mode]:value})); } }} /> ms / scroll pixel</label></div>)}</SettingsCard>;
}
