import { patchToJson } from '../graph/serialize';
import type { Patch } from '../graph/types';
export declare const DOCUMENT_VERSION: 1;
export interface Diagnostic {
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    path?: string;
    nodeId?: string;
    port?: string;
}
export interface DocumentResult {
    /** Original input is retained for hosts that need lossless import review. */
    source: unknown;
    patch?: Patch;
    sourceVersion: number;
    diagnostics: Diagnostic[];
}
/** Unversioned Teia JSON is legacy version 0. Import never stamps a version. */
export declare function readDocument(input: string | unknown): DocumentResult;
/** Opt-in hosted migration. IDs are persisted on ports, never derived again after rename. */
export declare function withParameterIds(source: Patch, scope?: string[]): Patch;
export { patchToJson as writeDocument };
/** Resolve nested Buffer references using the compiler's group node scope. */
export declare function bufferReferences(patch: Patch, prefix?: string): NonNullable<Patch['buffers']>;
/** A duplicate is a new exposed identity; ordinary snapshots/undo keep IDs. */
export declare function cloneParameterIds<T extends {
    id: string;
    type: string | null;
    outputs?: import('../graph/types').PortDefinition[];
    subpatch?: Patch;
}>(source: T, nextId: string): T;
/** Keep host-owned nested durable references when rebuilding editor graph
 * presentations. Root Buffer references are supplied by the editor asset map. */
export declare function retainNestedBufferReferences(source: Patch, authoritative: Patch): Patch;
