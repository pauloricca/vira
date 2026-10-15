import type { DspOp, DspValueBinding } from './dspProgram';
export interface DspOptimizationOptions {
    deduplicateLoads?: boolean;
    foldConstants?: boolean;
    eliminateDeadPureOps?: boolean;
    analyzeSchedule?: boolean;
}
export interface DspOptimizationSnapshot {
    operations: number;
    registers: number;
    values: number;
    states: number;
    byOpcode: Record<string, number>;
    byTrait: Record<DspOperationTrait, number>;
}
export type DspOperationTrait = 'pure' | 'stateful' | 'event' | 'resource' | 'ordering barrier';
export interface DspOptimizationReport {
    beforeLoadDedup: DspOptimizationSnapshot;
    emitted: DspOptimizationSnapshot;
    afterConstantFolding: DspOptimizationSnapshot;
    final: DspOptimizationSnapshot;
    reasons: {
        deduplicatedLoads: number;
        constantArithmetic: number;
        unusedPure: number;
    };
}
interface OptimizableProgram {
    ops: DspOp[];
    values: number[];
    valueBindings: DspValueBinding[];
    registerCount: number;
    stateCount: number;
    monitorIds: Record<string, number>;
    fftBindings: Array<{
        inputRegister: number;
    }>;
    deduplicatedLoads: number;
}
export declare function simplifyDspOperations(program: OptimizableProgram, options?: DspOptimizationOptions): DspOptimizationReport;
export {};
