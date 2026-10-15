import type { ParameterMetadata, PreparedPatch } from './compiler';
export declare function normalizeParameterValue(parameter: ParameterMetadata, value: number): number;
/** Optional host utility. Overrides belong to the instance, never the patch document. */
export declare class ParameterOverrides {
    private values;
    set(prepared: PreparedPatch, id: string, value: number): void;
    clear(id: string): void;
    /** Rebind only by persistent ID when a new program is installed. */
    bind(prepared: PreparedPatch): {
        valueIndex: number;
        value: number;
    }[];
    filterDefaults(prepared: PreparedPatch, updates: {
        valueIndex: number;
        value: number;
    }[]): {
        valueIndex: number;
        value: number;
    }[];
}
