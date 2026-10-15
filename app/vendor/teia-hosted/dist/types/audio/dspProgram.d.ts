import type { CustomWaveSettings, Patch } from '../graph/types';
import { type DspOptimizationOptions, type DspOptimizationReport } from './dspOptimizer';
import { type DspScheduleReport } from './dspSchedule';
export { DSP_OP } from './dspOpcodes';
export interface DspProgram {
    version: 1;
    /** Missing means legacy engine API 1 (mono Input selectors ignored). */
    engineApiVersion?: 1 | 2;
    ops: DspOp[];
    values: number[];
    valueBindings: DspValueBinding[];
    midiControlBindings: DspMidiControlBinding[];
    tempoBindings: DspTempoBinding[];
    stateBindings: DspStateBinding[];
    registerCount: number;
    stateCount: number;
    feedbackLinkIds: string[];
    monitorIds: Record<string, number>;
    signedMeterIds: string[];
    sampleBindings: DspSampleBinding[];
    imageBindings: DspImageBinding[];
    customWaveBindings: DspCustomWaveBinding[];
    sequencerBindings: DspSequencerBinding[];
    repeatBindings: DspRepeatBinding[];
    fftBindings: DspFftBinding[];
    maxVoices: number;
    usesMidiNote: boolean;
    usesMidiClock: boolean;
    errors: string[];
    optimization?: DspOptimizationReport;
    schedule?: DspScheduleReport;
}
export interface DspOp {
    opcode: number;
    out?: number;
    a?: number;
    b?: number;
    c?: number;
    d?: number;
    e?: number;
    state?: number;
    value?: number;
    value2?: number;
    value3?: number;
    value4?: number;
}
export interface DspValueBinding {
    id: string;
    valueIndex: number;
    kind: 'node-param' | 'link-weight' | 'constant' | 'analyser-output';
    nodeId?: string;
    port?: string;
    linkId?: string;
}
export interface DspStateBinding {
    id: string;
    state: number;
    count: number;
    kind: 'oscillator' | 'filter' | 'feedback' | 'selector' | 'effect' | 'sequencer' | 'spread';
    nodeId: string;
}
export interface DspMidiControlBinding {
    nodeId: string;
    kind: 'slider' | 'button';
    channel: number;
    cc: number;
    valueIndex: number;
    modeValueIndex?: number;
    clicksValueIndex?: number;
}
export interface DspTempoBinding {
    nodeId: string;
    bpmValueIndex: number;
    sourceValueIndex: number;
    midiSourceValueIndex: number;
}
export interface DspSampleBinding {
    nodeId: string;
    sample: {
        name: string;
        url: string;
    };
    release: number;
}
export interface DspCustomWaveBinding {
    nodeId: string;
    customWave: CustomWaveSettings;
}
export interface DspSequencerEventBinding {
    active: boolean;
    start: number;
    end: number;
    velocity: number;
    note: number;
}
export interface DspSequencerBinding {
    nodeId: string;
    mode: 'trigger' | 'gate';
    steps: number;
    rows: number;
    events: DspSequencerEventBinding[][];
}
export interface DspRepeatBinding {
    nodeId: string;
    type: 'Spread' | 'Spawn';
    slot: number;
    stateStart: number;
    stateCount: number;
}
export interface DspFftBinding {
    nodeId: string;
    inputRegister: number;
    minFrequencyValueIndex: number;
    maxFrequencyValueIndex: number;
    frequencyValueIndex: number;
    amplitudeValueIndex: number;
}
export interface DspImageBinding {
    nodeId: string;
    image: {
        name: string;
        url: string;
    };
}
export interface DspCompileOptions extends DspOptimizationOptions {
    target?: 'web' | 'fm1';
}
export declare function compilePatchToDspProgram(patch: Patch, optimizationOptions?: DspCompileOptions): DspProgram;
