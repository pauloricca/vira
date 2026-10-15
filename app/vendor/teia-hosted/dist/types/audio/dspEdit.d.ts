import type { DspProgram } from './dspProgram';
export declare function dspProgramStructureKey(program: DspProgram): string;
export declare function dspCustomWavePointsKey(program: DspProgram): string;
export declare function dspSequencerConfigKey(program: DspProgram): string;
/** API 2 adds channel selectors; API 1 programs retain legacy mono Input. */
export declare function requiredEngineApi(program: DspProgram): 1 | 2;
