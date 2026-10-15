import { type NodeProps } from '@xyflow/react';
import type { PatchNode } from '../graph/types';
import { type ShaderFlowNode } from './flowPatch';
export declare const ShaderNode: import("react").NamedExoticComponent<NodeProps<ShaderFlowNode>>;
export declare function routingNodeColor(value: number | undefined): string;
export declare function makeNodeId(type: PatchNode['type'] | 'node', existingIds: Set<string>): string;
