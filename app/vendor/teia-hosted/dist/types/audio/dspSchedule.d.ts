import type { Patch } from '../graph/types';
import type { DspOp } from './dspProgram';
export type DspDependencyKind = 'cable' | 'send receive' | 'repeat boundary' | 'resource order' | 'event order';
export interface DspScheduleDependency {
    from: string;
    to: string;
    kind: DspDependencyKind;
}
export interface DspScheduleRegion {
    id: number;
    nodes: string[];
    dependencies: number[];
    cyclic: boolean;
    eligibility: 'block candidate' | 'scalar';
    reasons: string[];
}
export interface DspScheduleReport {
    rendering: 'scalar';
    expandedNodeCount: number;
    operationCount: number;
    operationFallbacks: Record<string, number>;
    dependencies: DspScheduleDependency[];
    feedbackBoundaries: string[];
    regions: DspScheduleRegion[];
    order: number[];
}
export declare function analyzeDspSchedule(patch: Patch, ops: DspOp[], feedbackLinkIds: string[]): DspScheduleReport;
