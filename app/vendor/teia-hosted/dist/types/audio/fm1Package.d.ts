import { type DspProgram } from './dspProgram';
import type { Patch } from '../graph/types';
import { fm1Limits as limits } from './fm1Capabilities';
export { limits as fm1Limits };
export type Fm1Patch = Patch;
export interface Fm1Usage {
    operations: number;
    registers: number;
    values: number;
    states: number;
    bytes: number;
}
export interface Fm1Compiled {
    program: DspProgram;
    ops: number[][];
    parameters: Record<string, number>;
    bytes: Uint8Array;
}
export interface Fm1Analysis {
    usage: Fm1Usage | null;
    errors: string[];
    compiled: Fm1Compiled | null;
}
export declare const fm1MaximumBytes: number;
export declare function q16(n: number): number;
export declare function analyzeFm1Patch(patch: Fm1Patch, live?: boolean): Fm1Analysis;
export declare function compileFm1Patch(patch: Fm1Patch): Fm1Compiled;
