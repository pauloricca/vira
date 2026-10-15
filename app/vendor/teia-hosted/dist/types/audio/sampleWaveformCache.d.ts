export interface SampleWaveformBin {
    min: number;
    max: number;
}
export interface SampleWaveform {
    bins: SampleWaveformBin[];
    duration: number;
}
/**
 * Fetches and analyses each sample URL at most once at a time. Completed
 * analyses are retained so newly mounted Sample nodes can render immediately.
 */
export declare function getSampleWaveform(url: string): Promise<SampleWaveform | null>;
