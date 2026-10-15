import type { CustomWaveMode, CustomWaveSettings, PatchNode } from './types';
export declare const CUSTOM_WAVE_MODES: Array<{
    value: CustomWaveMode;
    label: string;
}>;
export declare const DEFAULT_CUSTOM_WAVE: CustomWaveSettings;
export declare function normalizeCustomWave(customWave: Partial<CustomWaveSettings> | undefined, legacyParams?: PatchNode['params']): CustomWaveSettings;
export declare function customWaveBank(customWave: Partial<CustomWaveSettings> | undefined, params?: PatchNode['params']): CustomWaveSettings[];
export declare function customWaveUsesSustainStart(mode: CustomWaveMode): boolean;
export declare function customWaveUsesSustainEnd(mode: CustomWaveMode): boolean;
/**
 * Returns a copy whose locked endpoints produce the base level in the
 * configured output range. The stored points stay normalized, so changing the
 * base level or range never rewrites the user's curve.
 */
export declare function customWaveWithBaseLevel(customWave: CustomWaveSettings, baseLevel: number, rangeMin: number, rangeMax: number): CustomWaveSettings;
export declare function normalizedCustomWaveValue(value: number, rangeMin: number, rangeMax: number): number;
