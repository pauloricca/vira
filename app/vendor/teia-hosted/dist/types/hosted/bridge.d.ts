import type { Patch, SampleAsset, ImageAsset } from '../graph/types';
import type { BufferSnapshot, BufferVisualization, LinkMeterReading, LinkScopeReading } from '../audio/useAudioEngine';
import type { Diagnostic } from './document';
import type { EditClassification, PreparedPatch } from './compiler';
export declare const BRIDGE_VERSION = 2;
export interface Context {
    requestId: string;
    sessionId: string;
    revision: number;
    generation: string | null;
}
export interface Capabilities {
    save: boolean;
    /** Explicit opt-in; absent means bridge v1 behavior. */
    bridgeVersion?: 2;
    gestures?: 1;
    bufferCapture?: 1;
    profile?: PreparedPatch['profile'];
    saveAs?: boolean;
    /** Default allows saving an editable document even when it cannot compile. */
    requireExecutableToSave?: boolean;
    transport?: boolean;
    bufferMutation?: boolean;
    specializedControls?: ('custom wave' | 'sequencer')[];
    feedback?: ('meters' | 'scopes' | 'playheads' | 'buffers' | 'parameters')[];
    maxFeedbackHz?: number;
    /** Host determines picker eligibility. Undefined permits all editing. */
    nodeTypes?: string[];
}
export type HostCommand = Context & ({
    type: 'gesture';
    version: 1;
    sequence: number;
    layout: string;
    nodeId: string;
    values: Record<string, number>;
    timestamp: number;
} | {
    type: 'release gestures';
    version: 1;
    sequence: number;
    reason: 'focus loss' | 'close' | 'dispose' | 'graph swap';
} | {
    type: 'capture buffer';
    version: 1;
    nodeId: string;
} | {
    type: 'restore buffer';
    version: 1;
    nodeId: string;
    snapshot: BufferSnapshot;
} | {
    type: 'capture save';
    version: 1;
    document: Patch;
    installedRevision: number | null;
} | {
    type: 'revision';
} | {
    type: 'apply';
    document: Patch;
    prepared?: PreparedPatch;
    change: EditClassification;
} | {
    type: 'save';
    document: Patch;
    saveAs: boolean;
} | {
    type: 'buffer';
    action: 'clear' | 'copy';
    nodeId: string;
    targetNodeId?: string;
} | {
    type: 'parameter';
    parameterId: string;
    value: number;
} | {
    type: 'transport';
    action: 'toggle';
} | {
    type: 'close';
    dirty: boolean;
    document: Patch;
} | {
    type: 'resync';
} | {
    type: 'feedback';
    scopes: {
        id: string;
        length: number;
        points?: number;
        reset?: 'none' | 'zero-crossing';
    }[];
});
export type HostReply = Context & {
    capturedDocument?: Patch;
    bufferSnapshot?: BufferSnapshot;
    status: 'captured' | 'queued' | 'installed' | 'updated' | 'saved' | 'failed' | 'cancelled' | 'closed' | 'connected';
    diagnostics?: Diagnostic[];
};
export type HostEvent = (Context & {
    type: 'installed';
    diagnostics?: Diagnostic[];
}) | (Context & {
    type: 'diagnostics';
    diagnostics: Diagnostic[];
}) | {
    type: 'connection';
    sessionId: string;
    connected: boolean;
} | (Context & {
    type: 'feedback';
    observation?: {
        layout: string;
        dropped: number;
        eventOverflows: number;
        queuedNotes: number;
    };
    meters?: Record<string, LinkMeterReading>;
    scopes?: Record<string, LinkScopeReading>;
    playheads?: Record<string, number[]>;
    buffers?: Record<string, BufferVisualization>;
    parameters?: Record<string, number>;
    peak?: number;
    tempo?: {
        bpm: number;
        beat: number;
        running: boolean;
        renderFrame: number;
    };
});
/** Implementations must announce every newer revision before expensive preparation,
 * atomically recheck revision at install, keep the old graph on failure, retain host
 * parameter overrides by persistent ID, and retire old instances off-render.
 * request() must settle on cancellation/disconnection, with matching context.
 * Events are public normalized data, never raw worklet messages. */
/** Preview data and selection come from the host; waveform decoding must not
 * create an AudioContext in the editor window. Image previews are prepared Blobs. */
export interface EditorAssetAdapter {
    waveform?: (reference: string, signal: AbortSignal) => Promise<{
        duration: number;
        bins: {
            min: number;
            max: number;
        }[];
    } | null>;
    imagePreview?: (reference: string, signal: AbortSignal) => Promise<Blob | null>;
    selectMedia?: (request: Context & {
        kind: 'sample' | 'image';
        nodeId: string;
        current?: SampleAsset | ImageAsset;
    }) => Promise<SampleAsset | ImageAsset | null>;
}
export interface HostBridge {
    assets?: EditorAssetAdapter;
    request(command: HostCommand): Promise<HostReply>;
    subscribe(listener: (event: HostEvent) => void): () => void;
}
