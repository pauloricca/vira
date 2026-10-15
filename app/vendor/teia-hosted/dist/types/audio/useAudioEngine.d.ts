import { type DspProgram } from './dspProgram';
type AudioStatus = 'idle' | 'starting' | 'running' | 'error';
type RecordingStatus = 'idle' | 'waiting' | 'recording' | 'saving' | 'saved' | 'error';
export type AudioInputStatus = 'inactive' | 'needs-permission' | 'requesting' | 'connected' | 'denied' | 'unsupported' | 'error';
export type MidiInputStatus = 'inactive' | 'needs-permission' | 'requesting' | 'connected' | 'denied' | 'unsupported' | 'error';
export interface AudioInputDevice {
    deviceId: string;
    label: string;
}
export interface AudioInputState {
    status: AudioInputStatus;
    message: string;
    devices: AudioInputDevice[];
    selectedDeviceId: string;
    canSelectDevice: boolean;
}
export interface MidiInputDevice {
    id: string;
    label: string;
    state: string;
}
export interface MidiControlChange {
    id: number;
    sourceIndex: number;
    channel: number;
    cc: number;
    value: number;
    receivedAt: number;
}
export interface MidiInputState {
    status: MidiInputStatus;
    message: string;
    devices: MidiInputDevice[];
    outputDevices: MidiInputDevice[];
    canRequestAccess: boolean;
    lastControlChange?: MidiControlChange;
}
export interface LinkMeterReading {
    input: number;
    output: number;
    envelope: number;
}
export interface LinkScopeReading {
    mode: string;
    samples: number[];
}
export interface BufferVisualization {
    playhead: number;
    recordHead: number;
    bins: Array<{
        min: number;
        max: number;
    }>;
}
export interface BufferSnapshot {
    samples: Float32Array;
    sampleRate: number;
}
export interface BufferCopy {
    sourceNodeId: string;
    targetNodeId: string;
}
export interface ScopeCaptureRequest {
    id: string;
    length: number;
    points?: number;
    reset?: 'none' | 'zero-crossing';
}
export interface RecordingState {
    status: RecordingStatus;
    message: string;
    fileName: string | null;
    elapsedSeconds: number;
}
export interface AudioEngineState {
    status: AudioStatus;
    message: string;
    cpuLoad: number;
    cpuPeakLoad: number;
    cpuDeadlineMisses: number;
    rendering: {
        mode: string;
        workers: number;
        parallelRepeats: number;
        reason: string;
    };
    peak: number;
    linkMeters: Record<string, LinkMeterReading>;
    linkScopes: Record<string, LinkScopeReading>;
    playheads: Record<string, number[]>;
    buffers: Record<string, BufferVisualization>;
    recording: RecordingState;
    audioInput: AudioInputState;
    midiInput: MidiInputState;
    start: () => Promise<void>;
    stop: () => void;
    startRecording: () => void;
    stopRecording: () => void;
    captureBuffer: (nodeId: string) => Promise<BufferSnapshot | null>;
    clearBuffer: (nodeId: string) => void;
    copyBuffers: (copies: BufferCopy[]) => void;
    restoreBuffers: (snapshots: Record<string, BufferSnapshot>) => void;
    syncGraph: (program: DspProgram) => void;
    setLinkScopes: (requests: ScopeCaptureRequest[]) => void;
    setAudioInputDeviceId: (deviceId: string) => void;
    refreshAudioInputDevices: () => Promise<void>;
    refreshMidiInputDevices: () => Promise<void>;
}
interface UseAudioEngineOptions {
    selectedMidiInputDeviceIds?: string[];
    selectedMidiOutputDeviceIds?: string[];
    midiClockOutputEnabled?: boolean;
    recordingPatchName?: string;
}
export declare function useAudioEngine(options?: UseAudioEngineOptions): AudioEngineState;
export {};
