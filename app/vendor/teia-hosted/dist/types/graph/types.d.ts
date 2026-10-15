export type NodeType = 'Expression' | 'Group' | 'Spread' | 'Spawn' | 'Ins' | 'Params' | 'Outs' | 'AudioOut' | 'SineOsc' | 'TriangleOsc' | 'SawOsc' | 'RampOsc' | 'SquareOsc' | 'KinkOsc' | 'SampleHoldOsc' | 'PerlinNoise' | 'Noise' | 'Random' | 'AudioInput' | 'CustomWave' | 'SamplePlayer' | 'Image' | 'Buffer' | 'Playhead' | 'Time' | 'Freq2Length' | 'Length2Freq' | 'Constant' | 'Pass' | 'Send' | 'Receive' | 'Slider' | 'Joystick' | 'Button' | 'Keys' | 'Sequencer' | 'Roll' | 'Tempo' | 'MidiNote' | 'MidiNoteOn' | 'MidiNoteOff' | 'MidiNoteOnSend' | 'MidiNoteOffSend' | 'MidiCcSend' | 'MidiCc' | 'Selector' | 'Accumulator' | 'Quantise' | 'Abs' | 'Map' | 'Clamp' | 'Multiply' | 'Pow' | 'Pan' | 'Delay' | 'Chorus' | 'Reverb' | 'Compress' | 'Limiter' | 'Envelope' | 'Follower' | 'RemoveDc' | 'Fold' | 'Meter' | 'Scope' | 'FFT' | 'LowpassFilter' | 'HighpassFilter' | 'BandpassFilter' | 'AllpassFilter' | 'Crossover' | 'Equalizer' | 'FormantFilter' | 'CombFilter' | 'CombNotchFilter' | 'HardClipDistortion' | 'SoftClipDistortion' | 'FuzzDistortion' | 'SaturateDistortion' | 'WavefoldDistortion';
export interface Vec2 {
    x: number;
    y: number;
}
export interface NodeDisplaySize {
    width: number;
    height: number;
}
export interface PatchNode {
    id: string;
    type: NodeType;
    /** Optional editor label displayed instead of the type while the node is collapsed. */
    customLabel?: string;
    /** Optional editable labels displayed beside Sequencer rows. */
    sequencerRowLabels?: string[];
    /** Saved width reserved for the Sequencer row-label column. */
    sequencerRowLabelColumnWidth?: number;
    subpatchName?: string;
    subpatchCloneId?: string;
    /** Per-Group-instance values for controls projected from the shared subpatch UI. */
    subpatchUiOverrides?: Record<string, SubpatchUiNodeOverride>;
    expression?: string;
    sample?: SampleAsset;
    image?: ImageAsset;
    customWave?: CustomWaveSettings;
    params: Record<string, number>;
    position?: Vec2;
    /** Visual priority multiplier used by the editor; 1 is the default size. */
    scale?: number;
    scopeSize?: NodeDisplaySize;
    inputs?: PortDefinition[];
    outputs?: PortDefinition[];
    subpatch?: Patch;
    compactPorts?: boolean;
    /** Nodes are enabled unless explicitly disabled. Disabled nodes mute their incident links. */
    enabled?: boolean;
    /** Locked Spread/Spawn membership, mirroring an area's node snapshot. */
    spreadNodeIds?: string[];
    /** Compiler-only metadata attached to nodes cloned from a Spread or Spawn. */
    runtimeSpread?: {
        spreadId: string;
        itemIndex: number;
        originalNodeId: string;
    };
    /** Compiler-only Group boundary for Send/Receive routing. Empty at patch root. */
    routingScope?: string;
}
export interface SubpatchUiNodeOverride {
    params?: Record<string, number>;
    customWave?: CustomWaveSettings;
}
export interface SampleAsset {
    name: string;
    url: string;
    /** Original full-resolution video retained alongside an editor proxy. */
    originalUrl?: string;
}
export interface ImageAsset {
    name: string;
    url: string;
}
export type CustomWaveMode = 'loop' | 'once' | 'ping-pong' | 'sustain' | 'sustain-loop' | 'sustain-ping-pong';
export interface CustomWavePoint {
    x: number;
    y: number;
}
export interface CustomWaveSettings {
    mode: CustomWaveMode;
    sustainStart: number;
    sustainEnd: number;
    points: CustomWavePoint[];
    /** Additional independently editable waves on a multi-output Custom Wave node. */
    waves?: CustomWaveSettings[];
}
export interface Endpoint {
    node: string;
    port: string;
}
export type LinkMode = 'set' | 'add' | 'multiply' | 'bend';
export interface LinkWeightModulation {
    from: Endpoint;
    weight?: number;
    mode?: LinkMode;
    enabled?: boolean;
    weightModulations?: LinkWeightModulation[];
}
export interface PatchLink {
    from: Endpoint;
    to: Endpoint;
    weight?: number;
    mode?: LinkMode;
    /** Links are enabled unless explicitly disabled. */
    enabled?: boolean;
    /** Output connections that modulate this link's strength. */
    weightModulations?: LinkWeightModulation[];
}
export interface Patch {
    /** Absent means legacy schema 0; explicit schema 1 is opt-in. */
    schemaVersion?: 1;
    nodes: PatchNode[];
    links: PatchLink[];
    /** Content-addressed snapshots for Buffer nodes whose `on reset` mode is preserve. */
    buffers?: Record<string, BufferAsset>;
    /** Visual editor areas owned by this patch, including subpatch control panels. */
    areas?: PatchArea[];
    name?: string;
    midiInput?: MidiInputPreferences;
}
export interface BufferAsset {
    /** SHA-256 of the raw little-endian Float32 sample bytes. */
    hash: string;
    sampleRate: number;
    sampleCount: number;
}
export interface PatchArea {
    id: string;
    title: string;
    kind?: 'area' | 'spread';
    spreadNodeId?: string;
    position: Vec2;
    size: NodeDisplaySize;
    uiHeight?: number;
    collapsed?: boolean;
    locked?: boolean;
    nodeIds?: string[];
    areaIds?: string[];
}
export interface MidiInputPreferences {
    selectedDeviceIds: string[];
    /** MIDI outputs used by send nodes, clock/transport, and playback cleanup. */
    selectedOutputDeviceIds?: string[];
    /** When enabled, Tempo drives MIDI Clock and transport on connected MIDI outputs. */
    sendClock?: boolean;
}
export interface PortDefinition {
    /** Persistent exposed parameter identity; independent of editable name/order. */
    parameterId?: string;
    name: string;
    defaultValue?: number;
    connectable?: boolean;
    valueEditor?: boolean;
    min?: number;
    max?: number;
    step?: number;
    integer?: boolean;
}
export interface NodeDefinition {
    type: NodeType;
    inputs: PortDefinition[];
    outputs: PortDefinition[];
}
