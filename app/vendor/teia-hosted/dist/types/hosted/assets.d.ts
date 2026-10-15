import type { PreparedPatch } from './compiler';
export interface AssetRequest {
    kind: 'sample' | 'image' | 'buffer';
    nodeId: string;
    reference: string;
}
export type PreparedAsset = {
    kind: 'sample' | 'buffer';
    sampleRate: number;
    channels: readonly Float32Array[];
} | {
    kind: 'image';
    width: number;
    height: number;
    rgba: Uint8Array;
};
export type AssetResolver = (request: AssetRequest, signal?: AbortSignal) => Promise<PreparedAsset>;
/** Runs only during preparation. Resolver owns decoding, locations and integrity.
 * No implicit fetch, filesystem or browser Buffer storage fallback exists. */
export declare function prepareAssets(prepared: PreparedPatch, resolve: AssetResolver, signal?: AbortSignal): Promise<ReadonlyMap<string, PreparedAsset>>;
