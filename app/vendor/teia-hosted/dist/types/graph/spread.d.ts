import type { Patch, PatchNode } from './types';
export declare const DEFAULT_SPREAD_SIZE: {
    readonly width: 320;
    readonly height: 220;
};
export declare const DEFAULT_SPAWN_SIZE: {
    readonly width: 480;
    readonly height: 220;
};
export declare const MIN_RUNTIME_CONTAINER_WIDTH = 240;
export declare const MIN_SPAWN_WIDTH = 480;
export declare const SPREAD_HEADER_HEIGHT = 32;
export declare const SPREAD_PORTS_HEIGHT = 44;
export declare const SPAWN_PORTS_HEIGHT = 72;
export interface SpreadExpansion {
    patch: Patch;
    errors: string[];
}
export declare function expandSpreads(patch: Patch): SpreadExpansion;
export declare function nodeIsInsideSpread(spread: PatchNode, node: PatchNode): boolean;
export declare function runtimeContainerSize(node: {
    type: PatchNode['type'] | null;
    scopeSize?: PatchNode['scopeSize'];
}): {
    width: number;
    height: number;
};
export declare function runtimeContainerPortsHeight(node: {
    type: PatchNode['type'] | null;
}): number;
export declare function spreadCloneNodeId(spreadId: string, itemIndex: number, nodeId: string): string;
