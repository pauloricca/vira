import type { Patch } from '../graph/types';
export declare const fm1SupportFirmware: string;
export interface Fm1SupportWarning {
    feature: string;
    status: 'unsupported' | 'partial' | 'unknown';
    notes: string;
    nodes: string[];
}
/** Frontend inventory and export policy share the same feature statuses. */
export declare function getFm1SupportWarnings(patch: Patch): Fm1SupportWarning[];
/** Fail closed for enabled nodes, including unused nodes and group contents. */
export declare function getFm1SupportErrors(patch: Patch): string[];
/** Node availability for FM1 mode; partial implementations retain compiler restrictions. */
export declare function isFm1NodeImplemented(type: string): boolean;
