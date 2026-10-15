import { type DspProgram } from '../audio/dspProgram';
import type { Patch } from '../graph/types';
import { type Diagnostic } from './document';
export declare const COMPILER_VERSION = 1;
export declare const NATIVE_PROFILE = "native-scalar-v1";
export interface ParameterMetadata {
    id: string;
    name: string;
    nodeId: string;
    defaultValue: number;
    min: number;
    max: number;
    step?: number;
    integer?: boolean;
    binding: {
        valueIndex: number;
        layout: string;
    };
    legacyId: string;
}
export interface PreparedPatch {
    version: 1;
    document: Patch;
    program: DspProgram;
    layout: string;
    parameters: ParameterMetadata[];
    requirements: {
        samples: DspProgram['sampleBindings'];
        images: DspProgram['imageBindings'];
        buffers: Patch['buffers'];
        engineApiVersion: number;
        audioChannels: number;
        hostTimeline: boolean;
        midiKinds: string[];
    };
    resources: {
        operations: number;
        registers: number;
        state: number;
        values: number;
        maxBlockFrames: number;
        eventLimit: number;
        midiOutputLimit: number;
        heldNoteLimit: number;
    };
    diagnostics: Diagnostic[];
    profile: 'web' | typeof NATIVE_PROFILE;
}
/** Pure/off-render compilation. No asset fetches, storage access, devices or mounted editor. */
export declare function preparePatch(input: Patch | string, options?: {
    profile?: PreparedPatch['profile'];
}): PreparedPatch | {
    diagnostics: Diagnostic[];
};
export declare function parameterMetadata(patch: Patch, program: DspProgram, layout: string): ParameterMetadata[];
export type EditClassification = {
    kind: 'editor-only';
} | {
    kind: 'values';
    layout: string;
    updates: {
        valueIndex: number;
        value: number;
    }[];
} | {
    kind: 'specialized';
    layout: string;
    updates: {
        valueIndex: number;
        value: number;
    }[];
    customWaves?: DspProgram['customWaveBindings'];
    sequencers?: DspProgram['sequencerBindings'];
} | {
    kind: 'prepare';
    reason: string;
};
/** Keys are shared with standalone in-place Custom Wave and sequencer updates. */
export declare function classifyEdit(previous: PreparedPatch, next: PreparedPatch): EditClassification;
/** Host-side binding validation for bridge-v2 gestures. Use the INSTALLED
 * preparation, never a newer draft. Schedule each ordered transition on a
 * distinct sample; same-offset Control writes are final-value semantics.
 * Missing bindings are unused outputs and need no runtime write. */
export declare function gestureUpdates(prepared: PreparedPatch, nodeId: string, values: Record<string, number>): {
    layout: string;
    updates: {
        valueIndex: number;
        value: number;
    }[];
};
