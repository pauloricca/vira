import type { Patch, SampleAsset, ImageAsset } from '../graph/types';
import { type Diagnostic } from './document';
import { type ParameterMetadata } from './compiler';
import type { Capabilities, HostBridge, HostCommand, HostEvent } from './bridge';
export interface SessionState {
    revision: number;
    savedRevision: number;
    installedRevision: number | null;
    generation: string | null;
    dirty: boolean;
    connected: boolean;
    applying: boolean;
    diagnostics: Diagnostic[];
    saveDiagnostics?: Diagnostic[];
    parameters: ParameterMetadata[];
    parameterValues: Record<string, number>;
    feedback?: Extract<HostEvent, {
        type: 'feedback';
    }>;
}
/** One controller per editor session. Source, saved baseline and installed artifact
 * are independent. A failed compile never replaces either source or running graph. */
export declare class HostedSession {
    readonly sessionId: string;
    readonly capabilities: Capabilities;
    readonly bridge: HostBridge;
    private document;
    private saved;
    private sequence;
    private gestureSequence;
    private gestureValues;
    private epoch;
    private disposed;
    private installed?;
    private pending;
    private listeners;
    private unsubscribe;
    private lastFeedback;
    private parameterWrites;
    private state;
    constructor(sessionId: string, initial: Patch, capabilities: Capabilities, bridge: HostBridge, generation?: string | null);
    getSnapshot: () => SessionState;
    getDocument: () => Patch;
    getParameterLabel(id: string): string;
    subscribe: (listener: () => void) => (() => void);
    private publish;
    private context;
    private matching;
    edit(document: Patch, force?: boolean): Promise<void>;
    private acceptInstall;
    private receive;
    save(saveAs?: boolean): Promise<boolean>;
    close(): Promise<boolean>;
    resync(): Promise<boolean>;
    /** An instance override; never changes working document defaults. */
    setParameter(parameterId: string, value: number): Promise<boolean>;
    selectMedia(request: {
        kind: 'sample' | 'image';
        nodeId: string;
        current?: SampleAsset | ImageAsset;
    }): Promise<SampleAsset | ImageAsset | null>;
    captureBuffer(nodeId: string): Promise<import('../audio/useAudioEngine').BufferSnapshot | null>;
    restoreBuffer(nodeId: string, snapshot: import('../audio/useAudioEngine').BufferSnapshot): Promise<boolean>;
    mutateBuffer(action: 'clear' | 'copy', nodeId: string, targetNodeId?: string): Promise<boolean>;
    /** Ordered transient controls bypass document edits and graph supersession.
     * Host validates bindings against layout, schedules in sequence order, and
     * acknowledges updated only after acceptance in its bounded render queue.
     * Queue overflow must cancel/release the generation, never discard a release.
     */
    gesture(nodeId: string, values: Record<string, number>): void;
    releaseGestures(reason: 'focus loss' | 'close' | 'dispose' | 'graph swap'): void;
    reportUnavailable(message: string): void;
    toggleTransport(): Promise<void>;
    requestFeedback(scopes: Extract<HostCommand, {
        type: 'feedback';
    }>['scopes']): void;
    dispose(): void;
}
