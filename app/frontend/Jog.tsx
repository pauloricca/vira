import { TrackpadJogSettings } from './TrackpadJog';
import { SettingsCard } from './SettingsSearch';
import { useState } from 'react';
import { useMidiTargets } from './MidiMapping';
import type { AudioState } from './Decks';

const defaults = { playing: 2, stopped: 20 };
function sensitivity(mode: keyof typeof defaults) {
  const value = Number(localStorage.getItem(`vira.jog-${mode}-ms`) ?? defaults[mode]);
  return Number.isFinite(value) && value >= .1 && value <= 1000 ? value : defaults[mode];
}
export function useJogTargets(audio: AudioState, control: (deck: number, action: string, value?: number) => Promise<void>) {
  useMidiTargets(audio.decks.map(state => ({
    id: `deck:${state.deck}:jog`, label: `Rolling waveform deck ${state.deck === 0 ? 'A' : 'B'}`,
    kind: 'relative' as const, defaultMode: 'relative-twos' as const,
    disabled: !audio.running || !state.track || state.loading || !!state.grid_edit || !!state.launch_pending || (state.playing && !!state.synced),
    apply: (delta: number) => { void control(state.deck, 'jog', Math.max(-10, Math.min(10, delta * sensitivity(state.playing ? 'playing' : 'stopped') / 1000))); },
  })));
}
export function JogSettings() {
  const [values, setValues] = useState(() => ({playing:sensitivity('playing'), stopped:sensitivity('stopped')}));
  return <><SettingsCard className="settings-card"><h3>Waveform MIDI wheels</h3><p className="settings-hint">In MIDI map mode, select a deck’s rolling waveform and turn its wheel. Choose the wheel encoding in the mapping editor. Playing decks must be unlocked. Movement is smoothed in the audio engine; stopped decks audition the movement.</p>{(['playing','stopped'] as const).map(mode => <div className="settings-row" key={mode}><strong>{mode === 'playing' ? 'Playing movement' : 'Stopped movement'}</strong><label><input type="number" aria-label={`Waveform wheel ${mode} movement`} min="0.1" max="1000" step="0.1" value={values[mode]} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= .1 && value <= 1000) { localStorage.setItem(`vira.jog-${mode}-ms`, String(value)); setValues(old => ({...old,[mode]:value})); } }} /> ms / MIDI step</label></div>)}</SettingsCard><TrackpadJogSettings /></>;
}
