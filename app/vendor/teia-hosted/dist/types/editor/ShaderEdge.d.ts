import { type EdgeProps } from '@xyflow/react';
import type { ShaderFlowEdge } from './flowPatch';
export declare const VirtualRouteEdge: import("react").NamedExoticComponent<EdgeProps<ShaderFlowEdge>>;
export declare const ShaderEdge: import("react").NamedExoticComponent<EdgeProps<ShaderFlowEdge>>;
type EdgeGeometry = Pick<EdgeProps<ShaderFlowEdge>, 'source' | 'target' | 'sourceX' | 'sourceY' | 'targetX' | 'targetY' | 'sourcePosition' | 'targetPosition' | 'data'>;
export declare function getShaderEdgePath(props: EdgeGeometry): [string, number, number];
interface EdgeWeightScrubberProps {
    value: number;
    onChange: (value: number) => void;
}
export declare function EdgeWeightScrubber({ value, onChange }: EdgeWeightScrubberProps): import("react").JSX.Element;
export {};
