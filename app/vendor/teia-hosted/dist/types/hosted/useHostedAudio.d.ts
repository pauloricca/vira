import type { AudioEngineState } from '../audio/useAudioEngine';
import type { HostedSession } from './session';
/** Presentation adapter only: never mounts useAudioEngine, a clock or devices. */
export declare function useHostedAudio(session: HostedSession): AudioEngineState;
