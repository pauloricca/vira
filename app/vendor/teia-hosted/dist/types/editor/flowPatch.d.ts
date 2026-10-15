import type { Edge, Node, ReactFlowProps } from '@xyflow/react';
import type { AudioInputState, BufferVisualization, MidiInputState } from '../audio/useAudioEngine';
import type { LinkMode, LinkWeightModulation, NodeType, Patch, PatchArea, PatchLink, PatchNode, PortDefinition } from '../graph/types';
export interface ScopeNodeSize {
    width: number;
    height: number;
}
export declare const DEFAULT_SCOPE_NODE_SIZE: ScopeNodeSize;
export declare const DEFAULT_JOYSTICK_NODE_SIZE: ScopeNodeSize;
export declare const DEFAULT_FFT_NODE_SIZE: ScopeNodeSize;
export declare const DEFAULT_KEYS_NODE_SIZE: ScopeNodeSize;
export declare const DEFAULT_CUSTOM_WAVE_NODE_SIZE: ScopeNodeSize;
export declare const DEFAULT_SEQUENCER_NODE_SIZE: ScopeNodeSize;
export declare const SEQUENCER_MIN_CELL_SIZE = 22;
export declare const DEFAULT_IMAGE_ASPECT_RATIO: number;
export type EditorPatchNode = Omit<PatchNode, 'type'> & {
    type: NodeType | null;
    expression?: string;
    compactPorts?: boolean;
    scopeSize?: ScopeNodeSize;
};
export interface ShaderNodeData extends Record<string, unknown> {
    patchNode: EditorPatchNode;
    /** Canvas-wide view lock: preserves layout while hiding connection affordances. */
    isCanvasLocked?: boolean;
    canvasZoom?: number;
    audioMeter?: {
        input: number;
        output: number;
        envelope: number;
    };
    audioOutputMeter?: {
        left: number;
        right: number;
    };
    audioScope?: {
        samples: number[];
    };
    audioSpectrum?: {
        samples: number[];
    };
    audioSliderValue?: number;
    audioImagePosition?: {
        x: number;
        y: number;
    };
    audioAccumulatorValue?: number;
    audioSelectorIndex?: number;
    audioSequencerStep?: number;
    audioPlayheads?: number[];
    audioCustomWaveFrequency?: number;
    audioBuffer?: BufferVisualization;
    audioSampleParams?: Partial<{
        start: number;
        end: number;
        attack: number;
        release: number;
    }>;
    midiSliderValue?: number;
    midiJoystickPosition?: {
        x?: number;
        y?: number;
    };
    midiButtonPressed?: number;
    audioInput?: AudioInputState;
    midiInput?: MidiInputState;
    dspErrors?: string[];
    onParamChange: (nodeId: string, port: string, value: number) => void;
    onParamsChange: (nodeId: string, values: Record<string, number>) => void;
    onAudioInputDeviceChange?: (deviceId: string) => void;
    onAudioInputRefresh?: () => void;
    onMidiInputRefresh?: () => void;
    onCustomWaveChange?: (nodeId: string, customWave: NonNullable<PatchNode['customWave']>, historyKey?: string) => void;
    onSequencerRowLabelsChange?: (nodeId: string, labels: string[]) => void;
    onExpressionChange?: (nodeId: string, expression: string) => void;
    onExpressionCommit?: (nodeId: string, expression: string) => void;
    onTypeChange: (nodeId: string, type: NodeType) => void;
    onConvertToArea: (nodeId: string) => void;
    onCustomLabelChange?: (nodeId: string, label: string) => void;
    onTitleSelect?: (nodeId: string, additive: boolean) => void;
    onHeaderDoubleClick?: (nodeId: string) => void;
    onSubpatchNameChange?: (nodeId: string, nextName: string) => void;
    onSampleSelect?: (nodeId: string) => void;
    onSampleDrop?: (nodeId: string, files: FileList) => void;
    onBufferClear?: () => void;
    onImageSelect?: (nodeId: string) => void;
    onTypeEditStart: (nodeId: string) => void;
    onTypeEditEnd: () => void;
    onTypeEditCancel: (nodeId: string) => void;
    onIdChange: (nodeId: string, nextId: string) => void;
    onPortDoubleClick: (nodeId: string, side: 'input' | 'output', port: string) => void;
    onPortNameChange: (nodeId: string, side: 'input' | 'output', port: string, nextPort: string) => void;
    onParamRangeChange?: (nodeId: string, port: string, bound: 'min' | 'max', value: number) => void;
    onPortAdd: (nodeId: string, side: 'input' | 'output', name: string) => void;
    onPortMove: (nodeId: string, side: 'input' | 'output', port: string, direction: -1 | 1) => void;
    onCompactToggle: (nodeId: string, compact: boolean) => void;
    onEnabledChange?: (nodeId: string, enabled: boolean) => void;
    onScopeResize: (nodeId: string, size: ScopeNodeSize, anchor: 'left' | 'right', previousSize?: ScopeNodeSize) => void;
    onSelectorInputAdd?: (nodeId: string) => void;
    onSelectorInputClear?: (nodeId: string, port: string) => void;
    onPortSelect?: (nodeId: string, side: 'input' | 'output', port: string) => void;
    selectedPort?: {
        side: 'input' | 'output';
        name: string;
    } | null;
    selectedLinkPorts?: {
        inputs: string[];
        outputs: string[];
    };
    connectedPorts?: {
        inputs: string[];
        outputs: string[];
    };
    /** Input ports with an enabled incoming link in set mode, which replaces the local value. */
    setLinkInputPorts?: string[];
    previewPort?: {
        side: 'input' | 'output';
        name: string;
    } | null;
    isOnlySelected?: boolean;
    /** Highlight this Send/Receive because its virtual route participates in the current selection. */
    routingHighlighted?: boolean;
    isConnecting?: boolean;
    onTemporaryPortRevealChange?: (nodeId: string, revealed: boolean) => void;
    isTypePickerOpen: boolean;
    isEditingSubpatch?: boolean;
    isAreaCollapsedPresentation?: boolean;
    /** This node remains visible in the UI portion of a collapsed area, but has no pins. */
    isAreaUiCollapsedPresentation?: boolean;
    /** Static, externally operable controls projected from a UI/Controls area in a Group subpatch. */
    groupUiPreview?: {
        width: number;
        height: number;
        nodes: Array<{
            id: string;
            position: {
                x: number;
                y: number;
            };
            data: ShaderNodeData;
        }>;
    };
}
export type ShaderFlowNode = Node<ShaderNodeData, 'shaderNode'>;
export interface ShaderEdgeData extends Record<string, unknown> {
    weight: number;
    mode: LinkMode;
    enabled: boolean;
    /** Derived editor-only state: either endpoint node is disabled. */
    isIncidentToDisabledNode?: boolean;
    onWeightChange: (edgeId: string, weight: number) => void;
    onModeChange: (edgeId: string, mode: LinkMode) => void;
    onEnabledChange?: (edgeId: string, enabled: boolean) => void;
    onInsertNode: (edgeId: string) => void;
    /** The edge whose strength input this ordinary editor edge targets. */
    modulatesEdgeId?: string;
    weightModulations?: LinkWeightModulation[];
    isWeightTarget?: boolean;
    onReconnect?: ReactFlowProps<ShaderFlowNode, ShaderFlowEdge>['onReconnect'];
    onReconnectStart?: ReactFlowProps<ShaderFlowNode, ShaderFlowEdge>['onReconnectStart'];
    onReconnectEnd?: ReactFlowProps<ShaderFlowNode, ShaderFlowEdge>['onReconnectEnd'];
    isReconnecting?: boolean;
    showLinkControls?: boolean;
    /** Draw this link with the selected-link treatment because one of its nodes is selected. */
    isConnectedToSelectedNode?: boolean;
    /** De-emphasize this link while another selected node or link is highlighted. */
    isDimmedBySelection?: boolean;
    isFeedback?: boolean;
    isControl?: boolean;
    dspErrors?: string[];
    /** Canvas-only endpoints used when an area presents its contained nodes as collapsed. */
    visualSource?: {
        x: number;
        y: number;
    };
    visualTarget?: {
        x: number;
        y: number;
    };
    isAreaCollapsedPresentation?: boolean;
}
export type ShaderFlowEdge = Edge<ShaderEdgeData, 'shaderEdge' | 'virtualRoute'>;
export interface PersistedEditorState {
    version: 1;
    /** Binary data lives in IndexedDB; this map keeps the content-addressed references. */
    buffers?: Patch['buffers'];
    /** Visual-only canvas groupings. They deliberately do not affect the patch graph. */
    areas?: EditorArea[];
    ui?: {
        patchName?: string;
        viewport?: {
            x: number;
            y: number;
            zoom: number;
        };
        midiInput?: Patch['midiInput'];
        fm1Mode?: boolean;
    };
    nodes: Array<{
        id: string;
        type: NodeType | null;
        customLabel?: string;
        sequencerRowLabels?: string[];
        sequencerRowLabelColumnWidth?: number;
        subpatchName?: string;
        subpatchCloneId?: string;
        subpatchUiOverrides?: PatchNode['subpatchUiOverrides'];
        expression?: string;
        sample?: PatchNode['sample'];
        image?: PatchNode['image'];
        customWave?: PatchNode['customWave'];
        params: Record<string, number>;
        position: {
            x: number;
            y: number;
        };
        inputs?: PortDefinition[];
        outputs?: PortDefinition[];
        subpatch?: Patch;
        compactPorts?: boolean;
        enabled?: boolean;
        spreadNodeIds?: string[];
        scale?: number;
        scopeSize?: ScopeNodeSize;
    }>;
    edges: Array<{
        id: string;
        source: string;
        sourceHandle: string | null;
        target: string;
        targetHandle: string | null;
        weight?: number;
        mode?: LinkMode;
        enabled?: boolean;
        modulatesEdgeId?: string;
        weightModulations?: LinkWeightModulation[];
    }>;
}
export type EditorArea = PatchArea;
type NodeCallbacks = Pick<ShaderNodeData, 'onParamChange' | 'onParamsChange' | 'onCustomWaveChange' | 'onSequencerRowLabelsChange' | 'onTypeChange' | 'onConvertToArea' | 'onTypeEditStart' | 'onTypeEditEnd' | 'onTypeEditCancel' | 'onIdChange' | 'onPortDoubleClick' | 'onPortNameChange' | 'onParamRangeChange' | 'onPortAdd' | 'onPortMove' | 'onCompactToggle' | 'onEnabledChange' | 'onScopeResize' | 'onSelectorInputAdd' | 'onSelectorInputClear'>;
export declare function toFlowNodes(patch: Patch, callbacks: NodeCallbacks, editingTypeNodeId: string | null): ShaderFlowNode[];
export declare function toFlowEdges(patch: Patch, onWeightChange: ShaderEdgeData['onWeightChange'], onModeChange: ShaderEdgeData['onModeChange'], onInsertNode: ShaderEdgeData['onInsertNode']): ShaderFlowEdge[];
export declare function editorStateToFlowNodes(state: PersistedEditorState, callbacks: NodeCallbacks, editingTypeNodeId: string | null): ShaderFlowNode[];
export declare function editorStateToFlowEdges(state: PersistedEditorState, onWeightChange: ShaderEdgeData['onWeightChange'], onModeChange: ShaderEdgeData['onModeChange'], onInsertNode: ShaderEdgeData['onInsertNode']): ShaderFlowEdge[];
export declare function flowToEditorState(nodes: ShaderFlowNode[], edges: ShaderFlowEdge[], ui?: PersistedEditorState['ui']): PersistedEditorState;
export declare function clampScopeNodeSize(size: ScopeNodeSize): ScopeNodeSize;
export declare function clampControlNodeSize(size: ScopeNodeSize): ScopeNodeSize;
export declare function clampKeysNodeSize(size: ScopeNodeSize): ScopeNodeSize;
export declare function clampCustomWaveNodeSize(size: ScopeNodeSize): ScopeNodeSize;
export declare function clampImageNodeSize(size: ScopeNodeSize, aspectRatio: number): ScopeNodeSize;
export declare function clampSequencerNodeSize(size: ScopeNodeSize, steps: number, rows: number, labelColumnWidth?: number): ScopeNodeSize;
export declare function patchFromFlow(nodes: ShaderFlowNode[], edges: ShaderFlowEdge[], areas?: EditorArea[]): Patch;
export declare function edgeFromLink(link: PatchLink, onWeightChange: ShaderEdgeData['onWeightChange'], onModeChange: ShaderEdgeData['onModeChange'], onInsertNode: ShaderEdgeData['onInsertNode']): ShaderFlowEdge;
export declare function linkFromEdge(edge: Edge): PatchLink | null;
export declare function edgeId(link: PatchLink): string;
export declare function dedupeEdges(edges: ShaderFlowEdge[]): ShaderFlowEdge[];
export {};
