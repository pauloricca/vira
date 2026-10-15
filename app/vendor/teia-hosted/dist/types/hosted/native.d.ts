import { type PreparedPatch } from './compiler';
export declare const NATIVE_CAPABILITIES: Readonly<{
    profile: "native-scalar-v1";
    apiVersion: number;
    executionRevision: number;
    validation: string;
    channels: number;
    maxBlockFrames: number;
    maxEventsPerBlock: number;
    sampleRate: {
        min: number;
        max: number;
    };
    midiInputKinds: string[];
    midiOutputKinds: string[];
    hostTimeline: boolean;
    maxMusicalBeat: number;
    timelineContinuityTolerance: number;
    maxHeldNotes: number;
    maxMidiOutputEvents: number;
    media: boolean;
    nativeAnalysis: boolean;
    maxOperations: number;
    maxRegisters: number;
    maxValues: number;
    maxStates: number;
    maxRepeatCapacity: number;
    repeatPolicy: string;
    feedbackKinds: string[];
    maxRepeatDepth: number;
    maxTotalRepeatItems: number;
    repeatBudgetScope: string;
    midiPulsePolicy: string;
    maxQueuedNoteEvents: number;
    maxQueuedNoteLatencyFrames: number;
    midiInputOverflow: string;
    observation: {
        maxRequests: number;
        maxScopes: number;
        maxScopePoints: number;
        scopeSeconds: {
            min: number;
            max: number;
        };
        maxPlayheadsPerRequest: number;
        bufferPreview: string;
        generationAndLayout: boolean;
    };
    bufferTransfer: {
        maxChunkSamples: number;
        maxSamples: number;
        capture: string;
        repeated: string;
    };
}>;
/** Authoritative host timeline. Provide offset zero and additional segments at
 * tempo/transport changes; explicit discontinuities accompany seeks and loops. */
export interface TimelineSegment {
    offset: number;
    renderFrame: number;
    beat: number;
    bpm: number;
    running: boolean;
    discontinuity?: 'seek' | 'loop' | 'start' | 'stop';
}
/** Off-render conversion to Operation fields accepted by native PreparedProgram.
 * Rust repeats authoritative validation before constructing any live instance. */
export declare function nativeProgram(prepared: PreparedPatch, generation: number, options?: {
    includeResources?: boolean;
}): {
    resourceBindings?: {
        samples: import("../audio/dspProgram").DspSampleBinding[];
        images: import("../audio/dspProgram").DspImageBinding[];
        customWaves: import("../audio/dspProgram").DspCustomWaveBinding[];
        sequencers: import("../audio/dspProgram").DspSequencerBinding[];
        buffers: import("../audio/dspProgram").DspStateBinding[];
        snapshots: Record<string, import("../graph/types").BufferAsset> | undefined;
        repeats: import("../audio/dspProgram").DspRepeatBinding[];
        fft: import("../audio/dspProgram").DspFftBinding[];
    } | undefined;
    executionRevision?: number | undefined;
    version: number;
    generation: number;
    operations: {
        opcode: number;
        out: number;
        a: number;
        b: number;
        c: number;
        d: number;
        e: number;
        state: number;
        value: number;
        value2: number;
        value3: number;
        value4: number;
    }[];
    values: number[];
};
/** Use one ordered list; equal offsets retain caller ordering before that sample. */
export type NativeEvent = {
    offset: number;
} & ({
    type: 'control';
    valueIndex: number;
    value: number;
    generation: number;
} | {
    type: 'note on';
    channel: number;
    note: number;
    velocity: number;
} | {
    type: 'note off';
    channel: number;
    note: number;
} | {
    type: 'control change';
    channel: number;
    controller: number;
    value: number;
} | {
    type: 'pitch bend';
    channel: number;
    value: number;
    rangeSemitones: number;
});
export interface NativeMidiOutput {
    offset: number;
    type: 'note on' | 'note off' | 'control change';
    channel: number;
    number: number;
    value: number;
}
