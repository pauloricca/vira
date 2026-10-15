import type { NodeDefinition, NodeType, PatchNode } from './types';
export declare const SEQUENCER_MIN_STEPS = 1;
export declare const SEQUENCER_MAX_STEPS = 128;
export declare const SEQUENCER_DEFAULT_STEPS = 16;
export declare const SEQUENCER_MIN_ROWS = 1;
export declare const SEQUENCER_MAX_ROWS = 16;
export declare const SEQUENCER_DEFAULT_ROWS = 4;
export declare const SEQUENCER_MIN_BEAT_LENGTH = 1;
export declare const SEQUENCER_DEFAULT_BEAT_LENGTH = 4;
export declare const SEQUENCER_INDEX_OUTPUT = "trigger index";
export declare const ROLL_ROWS = 12;
export declare const ROLL_MAX_ROWS = 128;
export declare const ROLL_DEFAULT_START_NOTE = 60;
export declare const NODE_DEFINITIONS: Record<NodeType, NodeDefinition>;
export declare const NODE_TYPE_LIST: NodeType[];
export declare function getDefinition(type: NodeType): NodeDefinition;
export declare function getNodeDefinition(node: PatchNode): NodeDefinition;
export declare function sequencerShape(params: Record<string, number>): {
    steps: number;
    rows: number;
    beatLength: number;
};
export declare function rollShape(params: Record<string, number>): {
    steps: number;
    beatLength: number;
    stepLength: number;
    scale: number;
    middleNote: number;
    rangeDown: number;
    rangeUp: number;
    rows: Array<{
        index: number;
        note: number;
    }>;
};
export declare function rollCellParamName(rowIndex: number, stepIndex: number): string;
export interface RollGate {
    slot: number;
    start: number;
    end: number;
    velocity: number;
}
export declare function rollGateParamName(rowIndex: number, slot: number, field: 'active' | 'start' | 'end'): string;
export declare function rollGateVelocityParamName(rowIndex: number, slot: number): string;
export declare function rollGatesForRow(params: Record<string, number>, rowIndex: number, steps: number): RollGate[];
export declare function sequencerOutputName(rowIndex: number): string;
export declare function sequencerOutputIndex(port: string): number | null;
export declare function sequencerCellParamName(rowIndex: number, stepIndex: number): string;
export declare const SEQUENCER_GATE_MODE_PARAM = "mode";
export declare const SEQUENCER_GATE_INITIALIZED_PARAM = "gate:initialized";
export declare const SEQUENCER_MIN_VELOCITY = 0.1;
export interface SequencerGate {
    slot: number;
    start: number;
    end: number;
    velocity: number;
}
export interface SequencerTrigger {
    slot: number;
    position: number;
    velocity: number;
}
/**
 * Gate rows are monophonic. Keep the later gate intact and shorten the end of
 * an earlier gate when stored data (or a pattern-length change) overlaps it.
 */
export declare function trimOverlappingSequencerGates(gates: SequencerGate[]): SequencerGate[];
export declare function sequencerUsesGateMode(params: Record<string, number>): boolean;
export declare function sequencerGateParamName(rowIndex: number, slot: number, field: 'active' | 'start' | 'end'): string;
export declare function sequencerTriggerPositionParamName(rowIndex: number, slot: number): string;
export declare function sequencerStepVelocityParamName(rowIndex: number, slot: number): string;
export declare function sequencerStepVelocity(params: Record<string, number>, rowIndex: number, slot: number): number;
export declare function sequencerTriggersForRow(params: Record<string, number>, rowIndex: number, steps: number): SequencerTrigger[];
export declare function sequencerGatesForRow(params: Record<string, number>, rowIndex: number, steps: number): SequencerGate[];
export declare function sequencerPatternValue(params: Record<string, number>, rowIndex: number, steps: number): [number, number, number, number];
export declare function getNodeTypeLabel(type: NodeType): string;
export declare function defaultParamsFor(type: NodeType): Record<string, number>;
