export declare function fm1BrowserError(): string | null;
/** One frame at a time, matching fm1-send-patch.py; never blindly retry COMMIT. */
export declare function uploadFm1Patch(bytes: Uint8Array, preset: number, progress: (percent: number, message: string) => void, signal: AbortSignal, live?: boolean): Promise<void>;
export declare function checkFm1Connection(progress: (percent: number, message: string) => void, signal: AbortSignal): Promise<void>;
export interface Fm1ValueUpdate {
    index: number;
    value: number;
}
export declare function updateFm1Values(identity: Uint8Array, preset: number, updates: Fm1ValueUpdate[], signal: AbortSignal): Promise<void>;
