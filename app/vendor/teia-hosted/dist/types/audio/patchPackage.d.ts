import type { DspProgram } from './dspProgram';
import type { BufferAsset, Patch } from '../graph/types';
export interface PortableAssetAdapters {
    readMedia: (reference: string) => Promise<Uint8Array<ArrayBuffer>>;
    readBuffer: (asset: BufferAsset) => Promise<{
        samples: Float32Array;
        sampleRate: number;
    } | null>;
}
export declare function createPatchPackage(patch: Patch, sourceProgram?: DspProgram, adapters?: PortableAssetAdapters): Promise<Blob>;
