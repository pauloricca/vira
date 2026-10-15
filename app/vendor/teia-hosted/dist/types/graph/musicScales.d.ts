export interface QuantiseScale {
    label: string;
    semitones: readonly number[];
}
export declare const QUANTISE_SCALES: readonly QuantiseScale[];
export declare const PITCH_CLASSES: readonly ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export declare function normalisePitchClass(note: number): number;
export declare function pitchClassLabel(note: number): string;
export declare function midiNoteLabel(note: number): string;
