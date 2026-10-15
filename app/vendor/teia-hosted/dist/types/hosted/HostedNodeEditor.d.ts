import type { HostedSession } from './session';
/** Create HostedSession from the initial document, capabilities and supplied IPC
 * bridge. Host owns session disposal so React remounts do not destroy drafts. */
export declare function HostedNodeEditor({ session, theme }: {
    session: HostedSession;
    theme?: string;
}): import("react").JSX.Element;
