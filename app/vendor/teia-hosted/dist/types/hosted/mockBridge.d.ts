import { ParameterOverrides } from './parameters';
import type { HostBridge, HostCommand, HostEvent, HostReply } from './bridge';
/** Host-neutral conformance double. No DSP or independent clock. Explicitly flush
 * preparation/installation and Save to model IPC races and acknowledgements. */
export declare class MockHostBridge implements HostBridge {
    readonly commands: HostCommand[];
    installed: HostCommand | null;
    readonly parameters: ParameterOverrides;
    liveValues: number[];
    private generation;
    private listeners;
    private pending;
    private latest;
    subscribe(listener: (event: HostEvent) => void): () => void;
    request(command: HostCommand): Promise<HostReply>;
    reply(requestId: string, status: HostReply['status'], diagnostics?: HostReply['diagnostics'], payload?: Pick<HostReply, 'capturedDocument' | 'bufferSnapshot'>): void;
    emit(event: HostEvent): void;
    dispose(): void;
}
