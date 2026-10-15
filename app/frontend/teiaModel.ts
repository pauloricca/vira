import { NATIVE_PROFILE, preparePatch, type Patch, type PreparedPatch } from '@pauloricca/teia-hosted';
export type Parameter = PreparedPatch['parameters'][number];
export type TeiaRecord = { name: string; saved_hash: string; saved_document: Patch; document: Patch; installed_document: Patch; prepared: PreparedPatch; overrides: Record<string, number>; bypass: boolean; clock_running?: boolean };
export type TeiaState = { generation: string; runtimeGeneration: string; record: TeiaRecord | null; parameters?: Record<string, number>; editorOpen: boolean; peak: number; renderFailures: number; automaticResets?: number; suspended?: boolean; repeatExhaustions?: number; midi?: { available: boolean; inputs: {id: number; name: string}[]; outputs: {id: number; name: string}[]; input: number; output: number; inputDrops: number; outputDrops: number; lateInputs: number; muted?: boolean; error?: string }; restoreError: string | null; running: boolean };
// UI offerings only; Teia's shared Rust validator remains authoritative for DSP.
// Resource-backed nodes need host acquisition/configuration or repeat budgets.
export const hostNodeTypes = ['Button', 'Keys', 'Meter', 'Scope', 'MidiNoteOn', 'MidiNoteOff', 'Expression', 'Group', 'Ins', 'Outs', 'Params', 'AudioInput', 'AudioOut',
  'MidiNote', 'MidiCc', 'MidiNoteOnSend', 'MidiNoteOffSend', 'MidiCcSend', 'CustomWave', 'Sequencer', 'Roll', 'Spread', 'Spawn', 'SamplePlayer', 'Image', 'Buffer', 'Playhead', 'Slider', 'Joystick', 'Constant', 'Pass', 'Send', 'Receive', 'Multiply', 'Abs', 'Map', 'Clamp', 'Pow', 'Pan', 'Selector', 'Accumulator', 'Quantise',
  'SineOsc', 'TriangleOsc', 'SawOsc', 'RampOsc', 'SquareOsc', 'KinkOsc', 'SampleHoldOsc', 'PerlinNoise', 'Noise', 'Random',
  'Tempo', 'Time', 'Freq2Length', 'Length2Freq', 'Delay', 'Chorus', 'Reverb', 'Compress', 'Limiter', 'Envelope', 'Follower',
  'RemoveDc', 'Fold', 'LowpassFilter', 'HighpassFilter', 'BandpassFilter', 'AllpassFilter', 'Crossover', 'Equalizer',
  'FormantFilter', 'CombFilter', 'CombNotchFilter', 'HardClipDistortion', 'SoftClipDistortion', 'FuzzDistortion', 'SaturateDistortion', 'WavefoldDistortion'];
export function prepare(document: Patch): PreparedPatch {
  const result = preparePatch(document, { profile: NATIVE_PROFILE });
  const errors = result.diagnostics.filter(d => d.severity === 'error');
  if (!('program' in result) || errors.length) throw new Error(errors.map(d => d.message).join('\n') || 'Patch cannot execute');
  return result;
}
export const gainPatch: Patch = {
  name: 'Stereo gain',
  nodes: [
    { id: 'parameters', type: 'Params', params: { gain: 1 }, outputs: [{ name: 'gain', parameterId: 'vira-factory-stereo-gain', min: 0, max: 2, step: 0.01 }], position: { x: 80, y: 80 } },
    { id: 'input', type: 'AudioInput', params: { gain: 1, level: 1 }, position: { x: 80, y: 300 } },
    { id: 'output', type: 'AudioOut', params: { level: 1 }, position: { x: 480, y: 300 } },
  ],
  links: [
    { from: { node: 'parameters', port: 'gain' }, to: { node: 'input', port: 'gain' } },
    { from: { node: 'input', port: 'left' }, to: { node: 'output', port: 'left' } },
    { from: { node: 'input', port: 'right' }, to: { node: 'output', port: 'right' } },
  ],
};
