import type { Capabilities, EditorAssetAdapter } from './bridge';
export declare const HostedModeContext: import("react").Context<(Capabilities & {
    assets?: EditorAssetAdapter;
}) | null>;
