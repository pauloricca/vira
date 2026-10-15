import type { Patch } from '../graph/types';
export declare function useFm1LiveEdit(patch: Patch, enabled: boolean, preset: number, stop: () => void): {
    message: string;
    busy: boolean;
};
