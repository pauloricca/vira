import type { BufferAsset } from '../graph/types';
export interface StoredBufferSnapshot {
    samples: Float32Array;
    sampleRate: number;
}
export declare function storeBufferSnapshot(snapshot: StoredBufferSnapshot): Promise<BufferAsset>;
export declare function loadBufferSnapshot(asset: BufferAsset): Promise<StoredBufferSnapshot | null>;
export declare function storeBufferAssetData(asset: BufferAsset, data: ArrayBuffer): Promise<void>;
export declare function removeUnreferencedBufferContents(referencedHashes: Iterable<string>): Promise<void>;
