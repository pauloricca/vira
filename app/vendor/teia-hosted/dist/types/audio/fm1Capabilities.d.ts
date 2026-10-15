/** Shared capability contract. DSP implementations stay in their respective backends. */
export declare const fm1Capabilities: {
    schemaVersion: number;
    firmware: string;
    reviewedOn: string;
    reviewedSources: {
        "editor/src/graph/types.ts": string;
        "editor/src/graph/nodeTypes.ts": string;
        "editor/src/graph/subpatch.ts": string;
        "editor/src/graph/spread.ts": string;
        "editor/src/graph/expression.ts": string;
        "editor/src/audio/dspProgram.ts": string;
        "editor/src/audio/dspOpcodes.ts": string;
        "editor/src/audio/fm1Package.ts": string;
        "editor/src/audio/fm1Optimizer.ts": string;
        "editor/src/audio/fm1Upload.ts": string;
        "editor/src/audio/useFm1LiveEdit.ts": string;
        "editor/src/editor/NodeEditor.tsx": string;
        "editor/src/editor/ShaderNode.tsx": string;
        "editor/src/editor/Fm1ModeContext.ts": string;
        "editor/src/audio/fm1Support.ts": string;
        "editor/src/audio/fm1Capabilities.ts": string;
        "editor/src/editor/Fm1SupportPage.tsx": string;
        "editor/src/App.tsx": string;
        "editor/src/styles.css": string;
        "firmware/fm1/runtime.h": string;
        "firmware/fm1/app.c": string;
        "firmware/fm1/upload.h": string;
        "firmware/fm1/export-patch.mjs": string;
        "scripts/fm1-runtime-spike.py": string;
        "scripts/fm1-send-patch.py": string;
        "scripts/fm1-install.py": string;
        "editor/src/diagnostics.ts": string;
        "runtime/src/index.ts": string;
        "editor/src/graph/parse.ts": string;
        "editor/src/graph/serialize.ts": string;
        "editor/src/audio/dspEdit.ts": string;
        "editor/src/audio/patchPackage.ts": string;
        "editor/src/hosted/document.ts": string;
        "editor/src/hosted/compiler.ts": string;
        "editor/src/hosted/native.ts": string;
        "editor/src/hosted/bridge.ts": string;
        "editor/src/hosted/session.ts": string;
        "editor/src/hosted/assets.ts": string;
        "editor/src/hosted/parameters.ts": string;
        "editor/src/hosted/useHostedAudio.ts": string;
        "editor/src/hosted/HostedNodeEditor.tsx": string;
        "editor/src/hosted/HostedModeContext.ts": string;
        "editor/src/hosted/mockBridge.ts": string;
        "editor/src/hosted/package.ts": string;
        "hosted/package.json": string;
        "runtime/package.json": string;
        "rust/teia-kernel/Cargo.toml": string;
        "scripts/build-hosted.mjs": string;
        "scripts/build-hosted-conformance.mjs": string;
        "rust/teia-kernel/src/state_fields.rs": string;
        "rust/teia-kernel/src/runtime_preparation.rs": string;
        "rust/teia-kernel/src/hosted_resources.rs": string;
        "rust/teia-kernel/src/hosted_observation.rs": string;
        "rust/teia-kernel/src/bounded_repeats.rs": string;
        "rust/teia-kernel/src/runtime-capabilities.json": string;
        "editor/src/hosted/engineCapabilities.json": string;
        "scripts/engine-capabilities.mjs": string;
        "rust/teia-kernel/src/lib.rs": string;
        "rust/teia-kernel/src/native_state.rs": string;
        "rust/teia-kernel/src/hosted.rs": string;
        "rust/teia-kernel/src/reverb.rs": string;
        "rust/teia-kernel/src/parallel.rs": string;
        "editor/src/audio/dspOptimizer.ts": string;
        "editor/public/audio/audio-worklet-wasm.js": string;
    };
    features: ({
        id: string;
        category: string;
        status: string;
        since: null;
        verification: string;
        notes: string;
        evidence: string[];
        blockedInputs: string[];
        blockedOutputs: never[];
        drift?: undefined;
    } | {
        id: string;
        category: string;
        status: string;
        since: number;
        verification: string;
        notes: string;
        evidence: string[];
        blockedInputs: string[];
        blockedOutputs: never[];
        drift?: undefined;
    } | {
        id: string;
        category: string;
        status: string;
        since: null;
        verification: string;
        notes: string;
        evidence: string[];
        blockedInputs: never[];
        blockedOutputs: string[];
        drift: {
            webBehavior: string;
            firmwareBehavior: string;
            requiredWork: string;
        };
    } | {
        id: string;
        category: string;
        status: string;
        since: number;
        verification: string;
        notes: string;
        evidence: string[];
        blockedInputs: never[];
        blockedOutputs: string[];
        drift: {
            webBehavior: string;
            firmwareBehavior: string;
            requiredWork: string;
        };
    } | {
        id: string;
        category: string;
        status: string;
        since: number;
        verification: string;
        notes: string;
        evidence: string[];
        blockedInputs: string[];
        blockedOutputs: never[];
        drift: {
            webBehavior: string;
            firmwareBehavior: string;
            requiredWork: string;
        };
    } | {
        id: string;
        category: string;
        status: string;
        since: number;
        verification: string;
        notes: string;
        evidence: string[];
        blockedInputs?: undefined;
        blockedOutputs?: undefined;
        drift?: undefined;
    } | {
        id: string;
        category: string;
        status: string;
        since: null;
        verification: string;
        notes: string;
        evidence: string[];
        blockedInputs?: undefined;
        blockedOutputs?: undefined;
        drift?: undefined;
    } | {
        id: string;
        category: string;
        status: string;
        since: number;
        verification: string;
        notes: string;
        evidence: string[];
        drift: {
            webBehavior: string;
            firmwareBehavior: string;
            requiredWork: string;
        };
        blockedInputs?: undefined;
        blockedOutputs?: undefined;
    })[];
    evidenceLog: ({
        date: string;
        firmware: string;
        scope: string;
        source: string;
        verification?: undefined;
        features?: undefined;
    } | {
        date: string;
        firmware: string;
        verification: string;
        features: string[];
        scope: string;
        source: string;
    })[];
    $schema: string;
    limits: {
        operations: number;
        registers: number;
        values: number;
        states: number;
        packageVersion: number;
        operationBytes: number;
    };
    compiler: {
        opcodes: number[];
        oscillatorModes: number[];
        filterModes: {
            "1": number;
            "2": number;
            "3": number;
            "8": number;
        };
        distortionModes: {
            "1": number;
            "4": number;
            "5": number;
        };
        functions: {
            id: number;
            name: string;
            arity: number;
        }[];
        delay: {
            maxNodes: number;
            maxSeconds: number;
            sampleRate: number;
            storageBits: number;
            storageFractionBits: number;
            smoothingSamples: number;
            instruction: number;
            legacyInstruction: number;
            since: number;
        };
        repeat: {
            maxInstances: number;
            maxContainers: number;
            eventQueue: number;
            since: number;
            blockedOpcodes: number[];
        };
    };
    protocol: {
        packages: ({
            version: number;
            headerBytes: number;
            operationBytes: number;
            operations: number;
            registers: number;
            values: number;
            since?: undefined;
        } | {
            version: number;
            headerBytes: number;
            operationBytes: number;
            operations: number;
            registers: number;
            values: number;
            since: number;
        })[];
        instructions: {
            code: number;
            name: string;
            since: number;
            minimumPackageVersion: number;
        }[];
        liveEdit: {
            since: number;
            probeCommand: number;
            updateCommand: number;
            maxUpdates: number;
        };
    };
};
export declare const fm1Limits: {
    operations: number;
    registers: number;
    values: number;
    states: number;
    packageVersion: number;
    operationBytes: number;
};
export declare const fm1Delay: {
    maxNodes: number;
    maxSeconds: number;
    sampleRate: number;
    storageBits: number;
    storageFractionBits: number;
    smoothingSamples: number;
    instruction: number;
    legacyInstruction: number;
    since: number;
};
export declare const fm1SupportFirmware: string;
export declare const fm1FilterModes: Readonly<Record<number, number>>;
export declare const fm1DistortionModes: Readonly<Record<number, number>>;
export declare function fm1FunctionArity(id: number): number;
/** Capability preflight, not a replacement for the device's operand/state validator. */
export declare function inspectFm1Package(bytes: Uint8Array): {
    version: number;
    requiredFirmware: number;
};
