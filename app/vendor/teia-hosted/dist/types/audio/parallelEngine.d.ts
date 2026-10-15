export interface ParallelEngine {
    processorOptions: {
        module: WebAssembly.Module;
        memory: WebAssembly.Memory;
        workers: number;
    };
    dispose: () => void;
}
/** Prepare all helper instances before attaching the audio processor. Only the
 * worklet may call the shared kernel after this function returns. */
export declare function createParallelEngine(count: number, signal: AbortSignal, onFailure: (message: string) => void): Promise<ParallelEngine>;
