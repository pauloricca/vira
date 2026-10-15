import type { Patch } from '../graph/types';
import { type PortableAssetAdapters } from '../audio/patchPackage';
/** Hosted export always requires explicit asset sources. XP v2 legacy IDs are
 * retained; persistentId is additive parameterIdentityVersion 1 metadata. */
export declare function createHostedPatchPackage(patch: Patch, assets: PortableAssetAdapters): Promise<Blob>;
