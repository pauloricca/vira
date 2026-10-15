type DiagnosticLevel = 'info' | 'warn' | 'error';
export declare function installDiagnostics(): void;
export declare function logDiagnosticEvent(event: string, options?: {
    level?: DiagnosticLevel;
    details?: Record<string, unknown>;
    flush?: boolean;
}): void;
export declare function serializeError(error: unknown): Record<string, unknown>;
export {};
