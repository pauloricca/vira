export declare const AUDIO_ENGINE_CONFIG: {
    readonly rendering: {
        readonly mode: "single" | "multi";
        readonly workers: number;
    };
    readonly graphUpdateCrossfade: {
        readonly enabled: true;
        readonly seconds: 0.02;
    };
};
