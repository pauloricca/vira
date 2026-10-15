import {
  CUSTOM_WAVE_MODES,
  DEFAULT_SPAWN_SIZE,
  DEFAULT_SPREAD_SIZE,
  DSP_OP,
  MIN_RUNTIME_CONTAINER_WIDTH,
  MIN_SPAWN_WIDTH,
  NODE_TYPE_LIST,
  PITCH_CLASSES,
  QUANTISE_SCALES,
  SEQUENCER_GATE_INITIALIZED_PARAM,
  SEQUENCER_GATE_MODE_PARAM,
  SEQUENCER_INDEX_OUTPUT,
  SEQUENCER_MIN_VELOCITY,
  SPAWN_PORTS_HEIGHT,
  SPREAD_HEADER_HEIGHT,
  SPREAD_PORTS_HEIGHT,
  cloneParameterIds,
  compilePatchToDspProgram,
  createPatchPackage,
  customWaveBank,
  customWaveUsesSustainEnd,
  customWaveUsesSustainStart,
  customWaveWithBaseLevel,
  defaultParamsFor,
  define_import_meta_env_default,
  dspCustomWavePointsKey,
  dspProgramStructureKey,
  dspSequencerConfigKey,
  expressionInputDefinitions,
  getDefinition,
  getNodeDefinition,
  getNodeTypeLabel,
  isImageAsset,
  isRecord,
  loadBufferSnapshot,
  midiNoteLabel,
  normalisePitchClass,
  normalizeCustomWave,
  normalizePatchCompatibility,
  normalizeSelectedMidiDeviceIds,
  normalizedCustomWaveValue,
  parsePatchJson,
  patchToJson,
  preparePatch,
  removeUnreferencedBufferContents,
  retainNestedBufferReferences,
  rollCellParamName,
  rollGateParamName,
  rollGateVelocityParamName,
  rollGatesForRow,
  rollShape,
  runtimeContainerPortsHeight,
  runtimeContainerSize,
  sequencerCellParamName,
  sequencerGateParamName,
  sequencerGatesForRow,
  sequencerOutputName,
  sequencerShape,
  sequencerStepVelocityParamName,
  sequencerTriggerPositionParamName,
  sequencerTriggersForRow,
  sequencerUsesGateMode,
  spreadCloneNodeId,
  storeBufferAssetData,
  storeBufferSnapshot,
  syncParamsToInputs,
  trimOverlappingSequencerGates,
  withParameterIds
} from "./chunk-2YJPUQUH.js";

// editor/src/editor/NodeEditor.tsx
import { useSyncExternalStore as useSyncExternalStore3 } from "react";

// editor/src/hosted/HostedParameters.tsx
import { useRef, useState, useSyncExternalStore } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
function HostedParameters({ session }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  if (!session.capabilities.feedback?.includes("parameters") || !state.parameters.length) return null;
  return /* @__PURE__ */ jsx(
    "section",
    {
      className: "hosted-parameters nodrag nopan nowheel",
      "aria-label": "Host parameters",
      onPointerDown: (event) => event.stopPropagation(),
      onKeyDown: (event) => event.stopPropagation(),
      onWheel: (event) => event.stopPropagation(),
      children: state.parameters.map((parameter) => /* @__PURE__ */ jsx(
        ParameterSlider,
        {
          session,
          parameter,
          value: state.parameterValues[parameter.id] ?? parameter.defaultValue,
          disabled: !state.connected || state.generation === null
        },
        parameter.id
      ))
    }
  );
}
function ParameterSlider({ session, parameter, value, disabled }) {
  const [draft, setDraft] = useState(null);
  const [failed, setFailed] = useState(false);
  const sequence = useRef(0);
  const displayed = draft ?? value;
  const change = async (next) => {
    const request = ++sequence.current;
    const generation = session.getSnapshot().generation;
    setDraft(next);
    setFailed(false);
    const accepted = await session.setParameter(parameter.id, next);
    if (request !== sequence.current) return;
    setDraft(null);
    setFailed(!accepted && generation === session.getSnapshot().generation && session.getSnapshot().connected);
  };
  return /* @__PURE__ */ jsxs("label", { className: "hosted-parameter-control", children: [
    /* @__PURE__ */ jsxs("span", { className: "hosted-parameter-heading", children: [
      /* @__PURE__ */ jsx("span", { children: parameter.name }),
      /* @__PURE__ */ jsx("output", { children: Number(displayed.toPrecision(6)) })
    ] }),
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "range",
        min: parameter.min,
        max: parameter.max,
        step: parameter.integer ? 1 : parameter.step && parameter.step > 0 ? parameter.step : "any",
        value: displayed,
        disabled: disabled || parameter.min === parameter.max,
        "aria-label": parameter.name,
        "aria-valuetext": String(displayed),
        onChange: (event) => void change(Number(event.target.value))
      }
    ),
    failed && /* @__PURE__ */ jsx("span", { className: "hosted-parameter-error", role: "status", children: "Host did not accept this value." })
  ] });
}

// editor/src/hosted/useHostedAudio.ts
import { useMemo, useSyncExternalStore as useSyncExternalStore2, useCallback } from "react";
var noop = () => void 0;
var asyncNoop = async () => void 0;
function useHostedAudio(session) {
  const state = useSyncExternalStore2(session.subscribe, session.getSnapshot, session.getSnapshot);
  const setLinkScopes = useCallback((requests) => session.requestFeedback(requests), [session]);
  const clearBuffer = useCallback((nodeId) => {
    void session.mutateBuffer("clear", nodeId);
  }, [session]);
  const copyBuffers = useCallback((copies) => {
    for (const copy of copies) void session.mutateBuffer("copy", copy.sourceNodeId, copy.targetNodeId);
  }, [session]);
  const captureBuffer = useCallback((nodeId) => session.captureBuffer(nodeId), [session]);
  const restoreBuffers = useCallback((snapshots) => {
    for (const [nodeId, snapshot] of Object.entries(snapshots)) void session.restoreBuffer(nodeId, snapshot);
  }, [session]);
  return useMemo(() => ({
    status: state.connected && state.generation !== null ? "running" : "idle",
    message: state.connected ? "Audio is owned by the host." : "Host disconnected.",
    cpuLoad: 0,
    cpuPeakLoad: 0,
    cpuDeadlineMisses: 0,
    rendering: { mode: "hosted", workers: 0, parallelRepeats: 0, reason: "Host instance" },
    peak: state.feedback?.peak ?? 0,
    linkMeters: state.feedback?.meters ?? {},
    linkScopes: state.feedback?.scopes ?? {},
    playheads: state.feedback?.playheads ?? {},
    buffers: state.feedback?.buffers ?? {},
    recording: { status: "idle", message: "Recording is owned by the host.", fileName: null, elapsedSeconds: 0 },
    audioInput: { status: "unsupported", message: "Audio routing and devices are owned by the host.", devices: [], selectedDeviceId: "", canSelectDevice: false },
    midiInput: { status: "unsupported", message: "MIDI routing and devices are owned by the host.", devices: [], outputDevices: [], canRequestAccess: false, lastControlChange: void 0 },
    start: () => session.toggleTransport(),
    stop: () => {
      void session.toggleTransport();
    },
    startRecording: noop,
    stopRecording: noop,
    captureBuffer,
    clearBuffer,
    copyBuffers,
    restoreBuffers,
    syncGraph: noop,
    setLinkScopes,
    setAudioInputDeviceId: noop,
    refreshAudioInputDevices: asyncNoop,
    refreshMidiInputDevices: asyncNoop
  }), [session, state, setLinkScopes, clearBuffer, copyBuffers, captureBuffer, restoreBuffers]);
}

// editor/src/hosted/HostedModeContext.ts
import { createContext } from "react";
var HostedModeContext = createContext(null);

// editor/src/editor/NodeEditor.tsx
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  ConnectionMode,
  ControlButton,
  Controls,
  Position as Position3,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  useNodesInitialized,
  useStoreApi as useStoreApi2
} from "@xyflow/react";
import { useCallback as useCallback3, useEffect as useEffect6, useMemo as useMemo5, useRef as useRef7, useState as useState7 } from "react";

// editor/src/editor/Fm1ModeContext.ts
import { createContext as createContext2 } from "react";
var Fm1ModeContext = createContext2(false);

// editor/src/audio/useFm1LiveEdit.ts
import { useEffect, useRef as useRef2, useState as useState2 } from "react";

// firmware/fm1/support.json
var support_default = {
  schemaVersion: 2,
  firmware: "FM-1_921",
  reviewedOn: "2026-10-15",
  reviewedSources: {
    "editor/src/graph/types.ts": "84df856c4053473ec409753e072d0292d34c5a6cdf5d49c4e8fd60b4423ff61b",
    "editor/src/graph/nodeTypes.ts": "2e7ae45e2ee35df2587980de14b6e4184c52af9ed4890eb185221bf34012431a",
    "editor/src/graph/subpatch.ts": "56fd60b9c664479761eefaa1e4d5264160156974687bc529aba01716ed2fbeb5",
    "editor/src/graph/spread.ts": "58bec3d980343612b1fc6e31059ab2926b50455f7a547129ffd24b071d81a0da",
    "editor/src/graph/expression.ts": "3d9ffced8af6611ed9b59414f2917895aa21fbf2d0f145d59eeab71a9ab34995",
    "editor/src/audio/dspProgram.ts": "724626d8bba01ffb3a83c0296612cf88fb7617b372b80ba14915f1682f7f78b7",
    "editor/src/audio/dspOpcodes.ts": "3e605442a356c87dd1c6aef58ce0d00d762c5ed31da0499b90e962181fed55ee",
    "editor/src/audio/fm1Package.ts": "f63cff9f1feaf41aef939d0c540684ee1cb7dd99601204af693bc007cbe27c9c",
    "editor/src/audio/fm1Optimizer.ts": "c4aefb17286a0f80a2dcc2553b3e4c5bbe8fcb8f302c4e9eec095c1b3a03e9f0",
    "editor/src/audio/fm1Upload.ts": "77e2e199f523b95bb047e9dada2aa4725e03d8b9eb112d66a9d0c412fb0f0b96",
    "editor/src/audio/useFm1LiveEdit.ts": "f713142b090b52bd6f8322e9fda1648dbf2f7a3dde08aa99a4c5c657776fdb7e",
    "editor/src/editor/NodeEditor.tsx": "4270b1560b3ae214c4851290f5482f9b762f83a156519857e204d5c5a3c10cb9",
    "editor/src/editor/ShaderNode.tsx": "71ebe5d2157861e5edfd70b77a4f41db5ef1d0cddc238ba0f9bb8392f2d690b3",
    "editor/src/editor/Fm1ModeContext.ts": "cc1bc130ec1638f62f27ce14997e86f8dae35e3a891d44702cab054b496fc5fd",
    "editor/src/audio/fm1Support.ts": "c7bc3b9979a76822aaf3b72acb914ce2e75e1abf37ff761c965e6e07e7ae363d",
    "editor/src/audio/fm1Capabilities.ts": "7a29929da790792dc3e54b3139cda2a4230e8f971fc5e101dade126a33a556cd",
    "editor/src/editor/Fm1SupportPage.tsx": "4f634b0db59887bc62a1a8a0dbe811e563683ee4cfa534a3a4aa8a1760264f49",
    "editor/src/App.tsx": "a7ab18f0eea1c2c9e395d4c01b34d58621d483f7e9069b4325e82ff3a7da4eee",
    "editor/src/styles.css": "1d6282781f9ea269a5638c0a5a3b1a90f570a94d48c8b70b8500752fbae73aa0",
    "firmware/fm1/runtime.h": "7537b66a1045b93e2d5db70cb42c37d90a123322b687073a4fd1527c3c2480ad",
    "firmware/fm1/app.c": "3d32135afb8c1f704f3cee8266386ca56b78e8b285633fa7ce8b24b4c5075c00",
    "firmware/fm1/upload.h": "fe5d2b0469e85b0ae7af404089885b4f50561a0fd7f7dd3e5b1f80a19433b266",
    "firmware/fm1/export-patch.mjs": "f4080ecd3b6e5c20490cba612cc582a1396527ef5d9cfd4c85fc60e191645e55",
    "scripts/fm1-runtime-spike.py": "c1456307c522e6d52494e1f6d51921bc196482d6b5946b1dadde0405378ae958",
    "scripts/fm1-send-patch.py": "8dff7e8ae136c2fce5ef04c8d0b3d15f745f971cf6d94418d7f393f4b1623cad",
    "scripts/fm1-install.py": "cb0b4d51615e40b164fd767964d845a65f3931c194d698c650b724f9825f228c",
    "editor/src/diagnostics.ts": "eeed709b3d569dc320dccaaf956dc903ea0c192e88d890440a5c9c2cd9ca8480",
    "runtime/src/index.ts": "428283ed669a780a0a1d31c3ae63f85c9c6cbf30952c27023065ec62a74dcb05",
    "editor/src/graph/parse.ts": "769600d7bc6858f0d2c83a4e9cd3b50329df0adbced9331f1da85c70dbe3f2e8",
    "editor/src/graph/serialize.ts": "b79eeb691c8f22ec11bb4cfa750b5720cc8af4674d0e9eabf13aa642d876109a",
    "editor/src/audio/dspEdit.ts": "04dc064fc4b22afa52ab4aaa6a0382b0b9466d8f0a2c507c63e8f7c05ed04076",
    "editor/src/audio/patchPackage.ts": "da3021756b4a8fa10606056bfd8d282248e4ff0a3e63892227284a3931d6decf",
    "editor/src/hosted/document.ts": "2c8dc864316db5c6d789485449d94f7e76492a52dc7ccfa81430b6279ae866fd",
    "editor/src/hosted/compiler.ts": "a6649dc7b3dc1da06139a47576b2189fde1b0ef3ec06ee7fcbeb24f9fb4ac0a1",
    "editor/src/hosted/native.ts": "8e817707257dad677252340d7066c85188265111cf83bf0d4fcb335ad9e235a9",
    "editor/src/hosted/bridge.ts": "9e98890329897f150648d7ebd5f97175140d6ccb4f28c01c3983c509c84ff8a9",
    "editor/src/hosted/session.ts": "91fd529393ae814309b1009bf532e705059e9a7b2a9b5b588f5f07c8a9f68c70",
    "editor/src/hosted/assets.ts": "1a529b112504a7987a8cb48d79e41d636ad021566dd659cd2d0966a0153bb651",
    "editor/src/hosted/parameters.ts": "be6e051739b10ca27612b29ea2285d41d2e68b82f368b950ace9d94d48327f2c",
    "editor/src/hosted/useHostedAudio.ts": "b88ebf818bcf27d66567db79d6fe4d8a1bec2d50ebdae87ef1a235a9656c87a0",
    "editor/src/hosted/HostedNodeEditor.tsx": "f1d0a5cd30c90146f2d37c4b09bfbe54b48e03f5dad8d9e75c194f00f55c8255",
    "editor/src/hosted/HostedModeContext.ts": "037cfd1b3fb901f6e87436723fde6deb36aece15713fb72a8104cf42e5dfb1de",
    "editor/src/hosted/mockBridge.ts": "2ff7454b8aefe963ec2956c6dba068b272ca087b017f9bdcfee82cbe043f7e62",
    "editor/src/hosted/package.ts": "8941f0cf8acbff01a734a403ed63b8a76f1129423bf3281331597b2a77b3496c",
    "hosted/package.json": "b158aac159e3ce2937d6675845b53cbee26a1bc4e2c77ade6c71f5dc607e61af",
    "runtime/package.json": "948d13582e59a070522d2cd4d57898eea40936264c4ce747c54d683c278e39a1",
    "rust/teia-kernel/Cargo.toml": "bf4525d61264227f363fe583fc05d6da82b517487a8fa7418240f5ede6594ad7",
    "scripts/build-hosted.mjs": "5e2a6d6eec2f9f21252a31bbb0871d74015577a45510ce2cddcb6e785a705574",
    "scripts/build-hosted-conformance.mjs": "e10f5785cb07c1a6fe98d2d8654853719bc628c97b85d04c6a1a6c9dfbb21928",
    "rust/teia-kernel/src/state_fields.rs": "e01c2ef270fb46a904c850c68a7cd6bcfc82436fad36cfc97751f4ddc5d037a9",
    "rust/teia-kernel/src/runtime_preparation.rs": "2a066fdf79bc109459897fe7f0d22ccf4bacbf2631ede31b13d29115b02b577c",
    "rust/teia-kernel/src/hosted_resources.rs": "51f57778dc523816f0e711ba4e5829c7d574ab4e853f4d410824cfcaa5d5e77b",
    "rust/teia-kernel/src/hosted_observation.rs": "ad005c16d4303329bcd938938484097324c9aaca038ed86a18e5c19953c75a1e",
    "rust/teia-kernel/src/bounded_repeats.rs": "2f3e45a04f788f95a12a58dd7f1b84207e5e1a5fa9b4c829f5ee4dfb2e4fb998",
    "rust/teia-kernel/src/runtime-capabilities.json": "27f6454d5ffe27aeeb6ff1f8ba96da317bf6456285f52ba357b2bc3095a34733",
    "editor/src/hosted/engineCapabilities.json": "27f6454d5ffe27aeeb6ff1f8ba96da317bf6456285f52ba357b2bc3095a34733",
    "scripts/engine-capabilities.mjs": "1250e52155d1ba3931976ce63706728bf24a81fc39fa05dc4d2923af601a65e3",
    "rust/teia-kernel/src/lib.rs": "46315080c923b0c736bc43e2c526dc81dd480d5c79e5ba257485f2c0c00f86ae",
    "rust/teia-kernel/src/native_state.rs": "8a0824dc795694aed1f03ee73830d158debd70b6e59d44abd137d6d7f8897259",
    "rust/teia-kernel/src/hosted.rs": "5131a2be03b43f3f4fc1b2298d6f335416dda830a93e07da641b63617864c332",
    "rust/teia-kernel/src/reverb.rs": "1063173e05cccbeb7d9f3bc67096e4f04f3b2bdbaba35ebaa0f43d5e1b6d3ae6",
    "rust/teia-kernel/src/parallel.rs": "0a132296c6fd2ac9b96262f3cddb551baf9e13cc9daea6e2c1e233d4e642cf13",
    "editor/src/audio/dspOptimizer.ts": "21e45b7aca38a7a696006dbc99b518c71f65eefdb36d77b3bf2bea2c9ec4d91f",
    "editor/public/audio/audio-worklet-wasm.js": "566b31a68db9d30ad5adc75eebce49f446e3b5e0ab5dc9a7b76a53aa7905e3c0"
  },
  features: [
    {
      id: "Expression",
      category: "node",
      status: "partial",
      since: 904,
      verification: "source reviewed",
      notes: "Basic arithmetic since 904; 907 adds abs/min/max/clamp/floor/ceil/round/sign/fract, comparisons and boolean logic. Q16.16 arithmetic; since 913 the basic add/subtract/multiply/divide graph instructions clamp results to \xB112000 like WASM; round ties away from zero. Transcendentals, pow, sqrt and mix remain unsupported.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Group",
      category: "node",
      status: "partial",
      since: null,
      verification: "source reviewed",
      notes: "Structural routing is flattened by the graph compiler. Every enabled contained node must independently pass FM-1 eligibility; this is not a claim that arbitrary group contents are supported.",
      evidence: [
        "editor/src/graph/subpatch.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Spread",
      category: "node",
      status: "partial",
      since: 921,
      verification: "source reviewed",
      notes: "Since 921, independent bounded DSP instances, boundary sum/product collectors and internal item index or instance gate. Up to eight containers and eight instances each; the compiler lowers capacity to fit 32 shared state records. Spread count is latched per audio block and clamped to capacity; shrinking clears removed item state. Spawn uses rising trigger edges, matching release tags and per-instance rising kill edges; full containers drop new triggers. Delay and Tempo must be outside containers; nested containers remain unsupported. Package reload resets instances. Hardware timing and audio unverified.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/app.c"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Dynamically allocated instance counts, independent effect resources and state migration during live recompilation.",
        firmwareBehavior: "Fixed capacity from the shared state budget; Delay and Tempo are rejected inside templates. Stable pool-slot rendering order, no migration on package reload.",
        requiredWork: "Verify voice lifecycle and real-time deadlines on hardware; additional voices and per-instance delays require a larger resource budget."
      }
    },
    {
      id: "Spawn",
      category: "node",
      status: "partial",
      since: 921,
      verification: "source reviewed",
      notes: "Since 921, independent bounded DSP instances, boundary sum/product collectors and internal item index or instance gate. Up to eight containers and eight instances each; the compiler lowers capacity to fit 32 shared state records. Spread count is latched per audio block and clamped to capacity; shrinking clears removed item state. Spawn uses rising trigger edges, matching release tags and per-instance rising kill edges; full containers drop new triggers. Delay and Tempo must be outside containers; nested containers remain unsupported. Package reload resets instances. Hardware timing and audio unverified.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/app.c"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Dynamically allocated instance counts, independent effect resources and state migration during live recompilation.",
        firmwareBehavior: "Fixed capacity from the shared state budget; Delay and Tempo are rejected inside templates. Stable pool-slot rendering order, no migration on package reload.",
        requiredWork: "Verify voice lifecycle and real-time deadlines on hardware; additional voices and per-instance delays require a larger resource budget."
      }
    },
    {
      id: "Ins",
      category: "node",
      status: "partial",
      since: null,
      verification: "source reviewed",
      notes: "Structural routing is flattened by the graph compiler. Every enabled contained node must independently pass FM-1 eligibility; this is not a claim that arbitrary group contents are supported.",
      evidence: [
        "editor/src/graph/subpatch.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Params",
      category: "node",
      status: "partial",
      since: 916,
      verification: "source reviewed",
      notes: "K1\u2013K4 edit the first four Params outputs. Select browses remaining outputs in saved order, clamping at either end; Algorithm edits the single visible extra parameter. Each value is retained when browsing. Parameters share the 128-value patch budget. Five screen rows show labels, declared-unit values and aligned outlined range bars. Requires firmware 916 and package v5 for more than six outputs; v1\u2013v4 remain readable with the new control layout. Hardware validation pending. 919 removes the ALG prefix, supports longer names, and redraws parameter rows only when their displayed content changes. Names accept spaces, punctuation and Unicode without a length limit in the source patch; the UTF-8 screen preview is cropped to 31 bytes at a character boundary. Latin-1 glyphs render directly; other glyphs appear as ?. Package v6 uses 32-byte label fields; versions 1\u20135 remain readable. 920 puts the cropped name, complete value and aligned 46-pixel bar on one row, retaining change-only redraws. Hardware display verification pending.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Outs",
      category: "node",
      status: "partial",
      since: null,
      verification: "source reviewed",
      notes: "Structural routing is flattened by the graph compiler. Every enabled contained node must independently pass FM-1 eligibility; this is not a claim that arbitrary group contents are supported.",
      evidence: [
        "editor/src/graph/subpatch.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "AudioOut",
      category: "node",
      status: "supported",
      since: null,
      verification: "source reviewed",
      notes: "Stereo output with device output bound and additional 6 dB headroom.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "SineOsc",
      category: "node",
      status: "partial",
      since: null,
      verification: "source reviewed",
      notes: "Audio-rate frequency/phase modulation, live range endpoints and rising-edge reset with an 8 ms crossfade; signal input remains unsupported and no waveform is band-limited.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [
        "signal"
      ],
      blockedOutputs: []
    },
    {
      id: "TriangleOsc",
      category: "node",
      status: "partial",
      since: 904,
      verification: "source reviewed",
      notes: "Audio-rate frequency/phase modulation, live range endpoints and rising-edge reset with an 8 ms crossfade; signal input remains unsupported and no waveform is band-limited.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [
        "signal"
      ],
      blockedOutputs: []
    },
    {
      id: "SawOsc",
      category: "node",
      status: "partial",
      since: 904,
      verification: "source reviewed",
      notes: "Audio-rate frequency/phase modulation, live range endpoints and rising-edge reset with an 8 ms crossfade; signal input remains unsupported and no waveform is band-limited.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [
        "signal"
      ],
      blockedOutputs: []
    },
    {
      id: "RampOsc",
      category: "node",
      status: "partial",
      since: 904,
      verification: "source reviewed",
      notes: "Audio-rate frequency/phase modulation, live range endpoints and rising-edge reset with an 8 ms crossfade; signal input remains unsupported and no waveform is band-limited.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [
        "signal"
      ],
      blockedOutputs: []
    },
    {
      id: "SquareOsc",
      category: "node",
      status: "partial",
      since: 904,
      verification: "source reviewed",
      notes: "Audio-rate frequency/phase modulation, live range endpoints and rising-edge reset with an 8 ms crossfade; live pulse width 0\u20131. Signal input remains unsupported and no waveform is band-limited.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [
        "signal"
      ],
      blockedOutputs: []
    },
    {
      id: "KinkOsc",
      category: "node",
      status: "partial",
      since: 910,
      verification: "source reviewed",
      notes: "Live frequency, phase, reset, shape, squareness and range endpoints. Fixed-point power shaping is approximate and not band-limited.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "SampleHoldOsc",
      category: "node",
      status: "partial",
      since: 910,
      verification: "source reviewed",
      notes: "Holds the signal on load and each rising trigger edge at 0.5; Q16.16 state resets on patch load.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "PerlinNoise",
      category: "node",
      status: "partial",
      since: 911,
      verification: "source reviewed",
      notes: "Monophonic note, frequency, velocity, gate and one-sample trigger lowering for physical keys and USB/TRS channel 1. Channels 2\u201316 produce zero; per-note event nodes remain unsupported.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Noise",
      category: "node",
      status: "supported",
      since: 904,
      verification: "source reviewed",
      notes: "Deterministic per-node xorshift noise with live range endpoints; sequence resets on patch load.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Random",
      category: "node",
      status: "partial",
      since: 907,
      verification: "source reviewed",
      notes: "Per-node deterministic xorshift sample on initialization and rising trigger edges at 0.5; held trigger retains value. Live/equal/inverted range endpoints; missing trigger holds initial value. Sequence resets on patch load, differs from browser.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "AudioInput",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "Web and native scalar hosting expose legacy mono signal plus separate left and right outputs. FM-1 has no supported audio input operation or resource. XP stereo exports require engine API 2; legacy mono exports remain API 1. Runtime 0.3.0 accepts both.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: [
        "signal",
        "left",
        "right"
      ],
      drift: {
        webBehavior: "Audio Input keeps signal as the stereo average and adds separate left/right outputs. The native scalar hosting profile consumes host-owned planar stereo buffers.",
        firmwareBehavior: "FM-1 has no audio-input lowering or audio capture resource. This node remains unsupported.",
        requiredWork: "Implement firmware audio-input resources, channel routing and compiler lowering, then verify timing and channel isolation on hardware."
      }
    },
    {
      id: "CustomWave",
      category: "node",
      status: "partial",
      since: 910,
      verification: "source reviewed",
      notes: "Encodes the curve in package values and renders live frequency, phase, trigger, base level and range. Loop, ping-pong and one-shot progression are implemented; sustain behavior and end events differ from the browser.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: [
        "end trigger"
      ],
      drift: {
        webBehavior: "Supports all sustain modes and provides an end trigger output.",
        firmwareBehavior: "Uses package-embedded points and omits end trigger; sustain modes hold at sustain start rather than matching browser release behavior.",
        requiredWork: "Add custom-wave completion state/output and full sustain-release progression, then remove the blocked output rule."
      }
    },
    {
      id: "SamplePlayer",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Image",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Buffer",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support. Hosted asset requirements and XP packaging/player now resolve preserved snapshots inside subpatchs using the compiled group scope.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Preserved Buffer snapshots are resolved through host adapters or XP assets, including snapshots nested in subpatchs.",
        firmwareBehavior: "FM-1 has no supported Buffer DSP or preserved snapshot resource.",
        requiredWork: "Implement bounded firmware Buffer DSP and persistence resources, compiler lowering and verification before claiming parity."
      }
    },
    {
      id: "Playhead",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Time",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Freq2Length",
      category: "node",
      status: "supported",
      since: 904,
      verification: "source reviewed",
      notes: "Compiles to reciprocal division (1 / input); fixed-point division by zero returns zero.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Length2Freq",
      category: "node",
      status: "supported",
      since: 904,
      verification: "source reviewed",
      notes: "Compiles to reciprocal division (1 / input); fixed-point division by zero returns zero.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Constant",
      category: "node",
      status: "supported",
      since: null,
      verification: "source reviewed",
      notes: "Q16.16 values; representable range applies.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Pass",
      category: "node",
      status: "supported",
      since: null,
      verification: "source reviewed",
      notes: "Pass-through within the supported compiled graph.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Send",
      category: "node",
      status: "supported",
      since: null,
      verification: "source reviewed",
      notes: "Resolved by the shared graph compiler using channel numbers 1\u201310 and patch/Group routing scopes. One matching Send reuses its signal register; multiple enabled Sends are summed with existing add instructions; no matching Send yields zero. Fan-out and chained routes need no dedicated firmware instruction. Normal FM-1 fixed-point arithmetic, graph limits and connected-node restrictions apply. No firmware change; hardware unverified.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/graph/subpatch.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Receive",
      category: "node",
      status: "supported",
      since: null,
      verification: "source reviewed",
      notes: "Resolved by the shared graph compiler using channel numbers 1\u201310 and patch/Group routing scopes. One matching Send reuses its signal register; multiple enabled Sends are summed with existing add instructions; no matching Send yields zero. Fan-out and chained routes need no dedicated firmware instruction. Normal FM-1 fixed-point arithmetic, graph limits and connected-node restrictions apply. No firmware change; hardware unverified.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/graph/subpatch.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Slider",
      category: "node",
      status: "partial",
      since: null,
      verification: "source reviewed",
      notes: "Compiles to existing FM-1 value, arithmetic, clamp and power instructions. Saved value is used unless connected; value, curve, min, max, signal and inverse signal remain live, with complementary outputs. No manual UI or MIDI CC interaction. Curves use approximate Q16.16 power; hardware unverified.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Interactive slider with MIDI CC, live input modulation, range mapping and curved signal crossfades.",
        firmwareBehavior: "Retains saved value and all connected DSP inputs, range mapping and crossfades, using existing fixed-point instructions. UI and MIDI CC bindings are omitted; power curves are approximate.",
        requiredWork: "Add device interaction and MIDI CC bindings if desired; verify dynamic inputs and curve precision on hardware."
      }
    },
    {
      id: "Joystick",
      category: "node",
      status: "unknown",
      since: null,
      verification: "unverified",
      notes: "Not individually audited. May be flattened, compiled to basic operations, or omitted by the compiler; do not claim device support yet.",
      evidence: [
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Button",
      category: "node",
      status: "partial",
      since: null,
      verification: "source reviewed",
      notes: "Compiles saved gate/toggle state to a constant using existing FM-1 instructions; trigger mode stays idle without replaying saved clicks. Signal and inverse signal inputs remain live and route to complementary outputs. No manual UI or MIDI CC interaction; hardware unverified.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Interactive gate, toggle or trigger button with MIDI CC and short signal crossfades on later state changes.",
        firmwareBehavior: "Uses the saved pressed state for gate/toggle modes and zero for trigger mode. Connected signals remain live; no events change the gate, so no transition smoothing is emitted.",
        requiredWork: "Add device events and MIDI CC handling if desired; verify saved-state routing on hardware."
      }
    },
    {
      id: "Keys",
      category: "node",
      status: "unknown",
      since: null,
      verification: "unverified",
      notes: "Not individually audited. May be flattened, compiled to basic operations, or omitted by the compiler; do not claim device support yet.",
      evidence: [
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Sequencer",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Roll",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Tempo",
      category: "node",
      status: "partial",
      since: 910,
      verification: "source reviewed",
      notes: "Internal BPM transport provides division pulses and frequency outputs. MIDI clock source and swing are not implemented.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Can follow a selected MIDI clock source and applies swing to tempo click boundaries.",
        firmwareBehavior: "Always runs an internal Q0.32 BPM clock and ignores MIDI source selection and swing.",
        requiredWork: "Route MIDI clock into the runtime and implement swung boundary scheduling."
      }
    },
    {
      id: "MidiNote",
      category: "node",
      status: "partial",
      since: 911,
      verification: "source reviewed",
      notes: "Optional monophonic source for note, frequency, velocity, gate and a pending note-on trigger consumed by exactly one rendered sample for physical keys and USB/TRS channel 1. Patches without MIDI Note are valid for fixed-frequency or continuously gated drones. The trigger is independent of the held gate. Channels 2\u201316 produce zero; separate MIDI Note On/Off nodes support channels 1\u201316 since 921.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts",
        "firmware/fm1/app.c",
        "firmware/fm1/runtime.h",
        "firmware/fm1/test-nodes.c"
      ],
      blockedInputs: [
        "channel"
      ],
      blockedOutputs: [],
      drift: {
        webBehavior: "Native and standalone note input is serialized through a 4096-event queue, one note per two samples with blank separators. Mono state changes on delivered events; channel filtering and velocity-zero releases apply. Native overflow atomically rejects an input block; standalone rejects the newest queued event. Note-zero scalar note tags remain ambiguous with idle; frequency/velocity outputs can trigger note zero.",
        firmwareBehavior: "FM-1_921 MIDI Note retains its separately implemented channel-1 mono state and pending trigger. Device note-pulse nodes use the separate 256-event queue and release Spawn gates on overflow.",
        requiredWork: "Audit and document native/web versus FM-1_921 mono/pulse scheduling and overflow under equivalent event bursts; implement any required parity changes in firmware before claiming matching semantics. Hardware verification remains separate."
      }
    },
    {
      id: "MidiNoteOn",
      category: "node",
      status: "partial",
      since: 921,
      verification: "source reviewed",
      notes: "Since 921, USB/TRS events on channels 1\u201316, live channel filter (0 means all), physical keys on channel 1, zero-velocity Note On treated as Note Off. One aligned event sample followed by a zero sample; Note On exposes note/frequency/velocity and Note Off note/frequency. Note zero shares the idle tag, matching web behavior. Queue bounded to 256 events; overflow releases Spawn gates and discards queued events. Hardware unverified.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/app.c"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Native and standalone note input is serialized through a 4096-event queue, one note per two samples with blank separators. Mono state changes on delivered events; channel filtering and velocity-zero releases apply. Native overflow atomically rejects an input block; standalone rejects the newest queued event. Note-zero scalar note tags remain ambiguous with idle; frequency/velocity outputs can trigger note zero.",
        firmwareBehavior: "USB/TRS input is ingested at audio-block boundaries, with a 256-event queue; overflow drops events and releases Spawn gates.",
        requiredWork: "Audit and document native/web versus FM-1_921 mono/pulse scheduling and overflow under equivalent event bursts; implement any required parity changes in firmware before claiming matching semantics. Hardware verification remains separate."
      }
    },
    {
      id: "MidiNoteOff",
      category: "node",
      status: "partial",
      since: 921,
      verification: "source reviewed",
      notes: "Since 921, USB/TRS events on channels 1\u201316, live channel filter (0 means all), physical keys on channel 1, zero-velocity Note On treated as Note Off. One aligned event sample followed by a zero sample; Note On exposes note/frequency/velocity and Note Off note/frequency. Note zero shares the idle tag, matching web behavior. Queue bounded to 256 events; overflow releases Spawn gates and discards queued events. Hardware unverified.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/app.c"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Native and standalone note input is serialized through a 4096-event queue, one note per two samples with blank separators. Mono state changes on delivered events; channel filtering and velocity-zero releases apply. Native overflow atomically rejects an input block; standalone rejects the newest queued event. Note-zero scalar note tags remain ambiguous with idle; frequency/velocity outputs can trigger note zero.",
        firmwareBehavior: "USB/TRS input is ingested at audio-block boundaries, with a 256-event queue; overflow drops events and releases Spawn gates.",
        requiredWork: "Audit and document native/web versus FM-1_921 mono/pulse scheduling and overflow under equivalent event bursts; implement any required parity changes in firmware before claiming matching semantics. Hardware verification remains separate."
      }
    },
    {
      id: "MidiNoteOnSend",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "MidiNoteOffSend",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "MidiCcSend",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "MidiCc",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Selector",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Accumulator",
      category: "node",
      status: "supported",
      since: 907,
      verification: "source reviewed",
      notes: "Rising-edge trigger/reset at 0.5; reset wins simultaneous edges; continuous mode increments every sample. Live increment/min/max, reversed bounds accepted; overshoot wraps to opposite endpoint. Q16.16, state resets on patch load.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Quantise",
      category: "node",
      status: "partial",
      since: 910,
      verification: "source reviewed",
      notes: "Quantises signed frequency signals to the selected chromatic, diatonic, pentatonic, modal, whole-tone or diminished scale/root using fixed-point log2 and power approximations.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Abs",
      category: "node",
      status: "supported",
      since: 906,
      verification: "source reviewed",
      notes: "Absolute value of signal; Q16.16 minimum saturates to the maximum positive value.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Map",
      category: "node",
      status: "partial",
      since: 910,
      verification: "source reviewed",
      notes: "Live source and target endpoints with saturating Q16.16 arithmetic. A zero source span uses one unit instead of the browser's tiny epsilon span.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Clamp",
      category: "node",
      status: "supported",
      since: 907,
      verification: "source reviewed",
      notes: "Live signal/min/max with ordered or reversed bounds; Q16.16 clamping.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Multiply",
      category: "node",
      status: "supported",
      since: null,
      verification: "source reviewed",
      notes: "Q16.16 multiplication; since 913 the graph instruction clamps each result to \xB112000 like WASM. Internal DSP multiplication helpers retain the full Q16.16 range.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Pow",
      category: "node",
      status: "partial",
      since: 910,
      verification: "source reviewed",
      notes: "Sign-preserving Q16.16 exponentiation matches the web node's bipolar behavior: sign(signal) \xD7 abs(signal)^exponent. Fixed-point log2 plus interpolated 2^x gives bounded per-sample work and avoids repeated fractional roots; output saturates. Since 914, exponent one returns the input exactly without logarithm/table evaluation; exponent zero retains the existing sign output.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/test-nodes.c"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Uses double-precision sign-preserving power for all finite signal and exponent values.",
        firmwareBehavior: "Uses saturating Q16.16 log2 and interpolated 2^x with sign-preserving output. Exponent one is exact and bypasses the approximation from 914.",
        requiredWork: "Measure target CPU margin and numerical error across representative audio-rate exponent modulation."
      }
    },
    {
      id: "Pan",
      category: "node",
      status: "unknown",
      since: null,
      verification: "unverified",
      notes: "Not individually audited. May be flattened, compiled to basic operations, or omitted by the compiler; do not claim device support yet.",
      evidence: [
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Delay",
      category: "node",
      status: "partial",
      since: 910,
      verification: "source reviewed",
      notes: "Since 917, up to two independent mono delays per patch, each 0\u20131 second at 44.1 kHz. Signed 16-bit storage has 12 fractional bits (range \u22128 to just below +8); dry signals retain Q16.16 precision. Linear fractional reads and a 256-sample one-pole time smoother (about 5.8 ms time constant) support continuous pitch-bending modulation. Initial time is applied immediately; changes toward zero smoothly reach bypass. Feedback 0\u20132 and mix 0\u20131. Opcode 53 requires 917; legacy opcode 44 uses the upgraded delay on 917. Earlier firmware supports only one approximately 46 ms delay.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/test-delay.c"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Floating-point delay storage, up to 1.5 seconds per node within the shared effect-slot budget; fractional reads, immediate time changes and immediate zero-time bypass.",
        firmwareBehavior: "Two mono nodes maximum, each one second with signed 16-bit storage and \xB18 headroom. Time changes use a 256-sample one-pole smoother, including the transition to zero; sub-sample times blend current input with the previous stored sample.",
        requiredWork: "The firmware intentionally trades duration, capacity and precision for bounded memory and adds tape-style smoothing. Align web smoothing and zero-transition semantics if matching playback is required; longer or additional firmware delays need a new memory budget."
      }
    },
    {
      id: "Chorus",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Reverb",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "Web/native Reverb has original (default), Dattorro plate and eight-line feedback delay network modes. FM-1 has no supported Reverb lowering, opcode or effect buffer implementation; all modes remain unsupported. Source reviewed only; new modes have no audio or hardware verification.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts",
        "rust/teia-kernel/src/reverb.rs",
        "rust/teia-kernel/src/lib.rs",
        "rust/teia-kernel/src/parallel.rs"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "A non-connectable mode dropdown selects original (0, default), Dattorro plate (1) or feedback delay network (2). Original keeps the existing identical left/right output; plate and FDN produce decorrelated stereo. Size, decay and mix remain live controls. Mode changes clear the tail; repeat instances own all delay/filter state.",
        firmwareBehavior: "FM-1_921 has no Reverb compiler lowering or DSP implementation for any mode. Enabled Reverb nodes block export.",
        requiredWork: "Implement resource allocation, mode selection, mono-to-stereo DSP and compiler/package lowering for all three modes, then verify stability, modulation, stereo routing and repeat state isolation on host/hardware."
      }
    },
    {
      id: "Compress",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Limiter",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Envelope",
      category: "node",
      status: "partial",
      since: null,
      verification: "source reviewed",
      notes: "Linear ADSR, delay, trigger and timed gate; a trigger-only envelope releases after decay unless gate length is set, while the independent gate input holds sustain. Since 921, end trigger emits a one-sample pulse on release completion. Live durations 0\u201360 seconds, minimum attack 45 samples. The firmware measures a trigger-only gate length after decay; the web engine measures it from the trigger edge. 915 uses an exact quotient/remainder ramp for unchanged durations, refreshing immediately after time modulation or elapsed-position changes; ADSR timing and existing drift are unchanged.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/test-nodes.c",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Provides an end trigger output when the envelope finishes and measures trigger-only gate length from the trigger edge, including delay, attack, and decay.",
        firmwareBehavior: "Renders signal and a one-sample completion pulse; trigger-only gate-length hold still begins after decay reaches sustain.",
        requiredWork: "Align trigger-only gate-length timing with the web engine and verify completion timing on hardware."
      }
    },
    {
      id: "Follower",
      category: "node",
      status: "partial",
      since: 910,
      verification: "source reviewed",
      notes: "Rectifies the signal and applies live linear attack/release smoothing in Q16.16; zero seconds updates immediately.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts",
        "firmware/fm1/runtime.h"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "RemoveDc",
      category: "node",
      status: "partial",
      since: 906,
      verification: "source reviewed",
      notes: "10 Hz one-pole DC blocker at nominal 44.1 kHz; signal input/output bounded to \xB14; Q24 history reset on patch load. Fixed-point response differs slightly from browser.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Fold",
      category: "node",
      status: "partial",
      since: 906,
      verification: "source reviewed",
      notes: "Live signal/amount; gain is 1 + 3 \xD7 max(amount, 0). Triangle folding to \u22121\u20261 without saturating before wrapping; Q16.16 quantisation, no oversampling.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Meter",
      category: "node",
      status: "unknown",
      since: null,
      verification: "unverified",
      notes: "Not individually audited. May be flattened, compiled to basic operations, or omitted by the compiler; do not claim device support yet.",
      evidence: [
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Scope",
      category: "node",
      status: "unknown",
      since: null,
      verification: "unverified",
      notes: "Not individually audited. May be flattened, compiled to basic operations, or omitted by the compiler; do not claim device support yet.",
      evidence: [
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "FFT",
      category: "node",
      status: "unknown",
      since: null,
      verification: "unverified",
      notes: "Not individually audited. May be flattened, compiled to basic operations, or omitted by the compiler; do not claim device support yet.",
      evidence: [
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "LowpassFilter",
      category: "node",
      status: "partial",
      since: 904,
      verification: "source reviewed",
      notes: "Fixed-point 12 dB/octave biquad; cutoff 20\u201319,845 Hz, Q 0.25\u201316; differs from browser response.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "HighpassFilter",
      category: "node",
      status: "partial",
      since: 905,
      verification: "source reviewed",
      notes: "Fixed-point RBJ biquad; live signal/cutoff/resonance; cutoff 20\u201319,845 Hz, Q 0.25\u201316. Band-pass has unity peak; all-pass changes phase. Hardware response unverified.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "BandpassFilter",
      category: "node",
      status: "partial",
      since: 905,
      verification: "source reviewed",
      notes: "Fixed-point RBJ biquad; live signal/cutoff/resonance; cutoff 20\u201319,845 Hz, Q 0.25\u201316. Band-pass has unity peak; all-pass changes phase. Hardware response unverified.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "AllpassFilter",
      category: "node",
      status: "partial",
      since: 905,
      verification: "source reviewed",
      notes: "Fixed-point RBJ biquad; live signal/cutoff/resonance; cutoff 20\u201319,845 Hz, Q 0.25\u201316. Band-pass has unity peak; all-pass changes phase. Hardware response unverified.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Crossover",
      category: "node",
      status: "partial",
      since: 905,
      verification: "source reviewed",
      notes: "Compiler-generated low/high-pass cascades; 1\u20138 frequency boundaries, 12/24/36/48 dB slopes and band outputs. Cutoff 20\u201319,845 Hz; 32 state-entry budget limits combinations. Not a phase-aligned reconstruction crossover; hardware unverified.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "Equalizer",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "FormantFilter",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "CombFilter",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "CombNotchFilter",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "HardClipDistortion",
      category: "node",
      status: "partial",
      since: 906,
      verification: "source reviewed",
      notes: "Live signal/drive; drive clamped to 0.1\u201340, output clipped to \u22121\u20261. Q16.16, no oversampling.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "SoftClipDistortion",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "FuzzDistortion",
      category: "node",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "No supported FM-1 lowering for this node operation or resource; browser support does not imply device support.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "editor/src/audio/dspProgram.ts"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "SaturateDistortion",
      category: "node",
      status: "partial",
      since: 906,
      verification: "source reviewed",
      notes: "Live signal/drive; drive clamped to 0.1\u201340; driven signal bounded to \xB132 then x/(1+abs(x)). Q16.16, no oversampling.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "WavefoldDistortion",
      category: "node",
      status: "partial",
      since: 906,
      verification: "source reviewed",
      notes: "Live signal/drive; drive clamped to 0.1\u201340, triangle folding to \u22121\u20261 without saturating before wrapping. Q16.16, no oversampling.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/README.md"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "oscillator modulation",
      category: "dsp",
      status: "partial",
      since: 904,
      verification: "source reviewed",
      notes: "Audio-rate FM/PM, phase reset with an 8 ms crossfade, and square PWM; aliasing and fixed-point differences apply.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "envelope end trigger",
      category: "dsp",
      status: "supported",
      since: 921,
      verification: "source reviewed",
      notes: "Since 921, opcode 54 reads the envelope completion flag for exactly the sample that release reaches idle; idle envelopes and retriggers do not emit a completion pulse. Works with instance-local envelopes and Spawn kill trigger. Hardware unverified.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/app.c"
      ]
    },
    {
      id: "polyphony",
      category: "performance",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "One voice; highest held note wins; mono changes are legato.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "physical keys",
      category: "hardware",
      status: "supported",
      since: null,
      verification: "source reviewed",
      notes: "F3\u2013G5 at octave zero; startup-held keys ignored until released.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "physical key octave transpose",
      category: "hardware",
      status: "supported",
      since: 910,
      verification: "source reviewed",
      notes: "OCT\u2212 and OCT+ transpose the physical keys through \u22123\u2026+3 octaves; pressing both centres the offset. The button pointing to centre is steadily lit and both are dark at zero. MIDI notes are not transposed. Holding both for five seconds still enters ROM recovery.",
      evidence: [
        "firmware/fm1/app.c",
        "firmware/fm1/README.md"
      ]
    },
    {
      id: "knobs",
      category: "hardware",
      status: "partial",
      since: 916,
      verification: "source reviewed",
      notes: "K1\u2013K4 edit the first four Params outputs. Select browses remaining outputs in saved order, clamping at either end; Algorithm edits the single visible extra parameter. Each value is retained when browsing. Parameters share the 128-value patch budget. Five screen rows show labels, declared-unit values and aligned outlined range bars. Requires firmware 916 and package v5 for more than six outputs; v1\u2013v4 remain readable with the new control layout. Hardware validation pending. 919 removes the ALG prefix, supports longer names, and redraws parameter rows only when their displayed content changes. Names accept spaces, punctuation and Unicode without a length limit in the source patch; the UTF-8 screen preview is cropped to 31 bytes at a character boundary. Latin-1 glyphs render directly; other glyphs appear as ?. Package v6 uses 32-byte label fields; versions 1\u20135 remain readable. 920 puts the cropped name, complete value and aligned 46-pixel bar on one row, retaining change-only redraws. Hardware display verification pending.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "other musical controls",
      category: "hardware",
      status: "partial",
      since: 916,
      verification: "source reviewed",
      notes: "K1\u2013K4 edit the first four Params outputs. Select browses remaining outputs in saved order, clamping at either end; Algorithm edits the single visible extra parameter. Each value is retained when browsing. Parameters share the 128-value patch budget. Five screen rows show labels, declared-unit values and aligned outlined range bars. Requires firmware 916 and package v5 for more than six outputs; v1\u2013v4 remain readable with the new control layout. Hardware validation pending. Musical buttons remain unassigned.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "master output",
      category: "hardware",
      status: "supported",
      since: null,
      verification: "source reviewed",
      notes: "Physical output level is read before audio starts and smoothed.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "midi input",
      category: "midi",
      status: "partial",
      since: null,
      verification: "source reviewed",
      notes: "USB and TRS channel 1 note on/off, zero-velocity note off, CC 120/123; source ownership tracked separately. Physical keys and channel 1 feed the FM-1 MIDI Note lowering as one monophonic source. Since 921, separate MIDI Note On/Off event nodes receive all 16 USB/TRS channels with velocity and queued events; the legacy mono source remains channel 1.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "midi expression",
      category: "midi",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "Sustain, pitch bend, velocity response and channel routing are not implemented.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "patch upload and selection",
      category: "storage",
      status: "supported",
      since: 902,
      verification: "source reviewed",
      notes: "USB MIDI SysEx upload; two RAM slots; PRESETS selects slots; switching fades and resets DSP state. Browser data-timeout recovery uses the existing status offset to confirm acceptance or permit one resend; unexpected offsets stop transfer. No protocol or firmware version change. Recovery hardware verification is pending.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "patch persistence",
      category: "storage",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "Slots clear on power-off; no flash patch library.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "calibration storage",
      category: "storage",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "Calibration persistence is not implemented.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "package compatibility",
      category: "protocol",
      status: "supported",
      since: 911,
      verification: "source reviewed",
      notes: "911 reads package versions 1\u20134; the compiler emits version 4 with an ordered six-control Params descriptor list. Opcode 52 is MIDI Note. Opcodes 29\u201331 require 905, 32\u201337 require 906, 38\u201340 require 907, 41 (bend scaling) requires 908, 42\u201343 (feedback read/write) require 909, and 44\u201351 require 910. Older firmware rejects unfamiliar opcodes before replacing a preset. 916 reads versions 1\u20135; exports use v5 with 128 reserved parameter records and unchanged opcodes. 921 adds instructions 54\u201363 for envelope completion, MIDI events and bounded repeat execution, retaining package layouts.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "resource capacity",
      category: "performance",
      status: "partial",
      since: null,
      verification: "source reviewed",
      notes: "256 operations/registers, 128 values, 32 state entries; capacity is not a measured CPU budget.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "audio timing and quality",
      category: "performance",
      status: "unknown",
      since: null,
      verification: "unverified",
      notes: "Pitch, sustained load and new-node late-buffer performance require measurement; memory fit is insufficient. A user report of increasing late buffers with test-fm-3 motivated the 914 neutral-operation fast paths. Offline host comparisons do not establish target deadline compliance; device render time and late-buffer growth must be checked after installation. 915 lifts constant/Params-only calculations out of the sample loop and caches them until values change; desktop regression/performance checks do not prove hardware deadline compliance.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "status display",
      category: "hardware",
      status: "supported",
      since: 916,
      verification: "source reviewed",
      notes: "K1\u2013K4 edit the first four Params outputs. Select browses remaining outputs in saved order, clamping at either end; Algorithm edits the single visible extra parameter. Each value is retained when browsing. Parameters share the 128-value patch budget. Five screen rows show labels, declared-unit values and aligned outlined range bars. Requires firmware 916 and package v5 for more than six outputs; v1\u2013v4 remain readable with the new control layout. Hardware validation pending. 919 removes the ALG prefix, supports longer names, and redraws parameter rows only when their displayed content changes. Names accept spaces, punctuation and Unicode without a length limit in the source patch; the UTF-8 screen preview is cropped to 31 bytes at a character boundary. Latin-1 glyphs render directly; other glyphs appear as ?. Package v6 uses 32-byte label fields; versions 1\u20135 remain readable. 920 puts the cropped name, complete value and aligned 46-pixel bar on one row, retaining change-only redraws. Hardware display verification pending.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "firmware update",
      category: "maintenance",
      status: "partial",
      since: 904,
      verification: "source reviewed",
      notes: "916 source identity assigned; installation and reboot unverified. Prior 904 installation evidence is historical only; return to stock and interrupted-update recovery unverified. The fm1:install wrapper audits sources, rebuilds changed/missing packages, checks package hashes and invokes the pinned installer with post-reboot identity verification; wrapper execution remains unverified.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md",
        "scripts/fm1-install.py"
      ]
    },
    {
      id: "rom recovery gesture",
      category: "maintenance",
      status: "partial",
      since: null,
      verification: "source reviewed",
      notes: "Both OCT buttons held for five seconds request ROM recovery; hardware result unverified.",
      evidence: [
        "firmware/fm1/README.md",
        "firmware/fm1/UPLOAD.md"
      ]
    },
    {
      id: "editor compatibility warnings",
      category: "workflow",
      status: "supported",
      since: null,
      verification: "source reviewed",
      notes: "FM dialog inventories enabled nodes recursively through enabled groups, using this register to show unsupported, partial and unknown support with node locations. Advisory node warnings can include unused nodes; compiler errors gate upload. Feedback loops compile when all other support and resource rules pass. Target firmware is the register version, not a detected device version. No DSP or firmware behavior changes.",
      evidence: [
        "editor/src/audio/fm1Support.ts",
        "editor/src/editor/Fm1UploadDialog.tsx",
        "README.md"
      ]
    },
    {
      id: "bend links",
      category: "dsp",
      status: "partial",
      since: 908,
      verification: "source reviewed",
      notes: "Since 913, bend instructions clamp the exponent to -32 through 32 and the ratio to 12000 before the following bounded multiplication, matching the compiled WASM operation order. Each bend is applied separately in saved link order. Q16.16 ratios use nearest rounding and an interpolated Q2.30 table; tiny ratios can round to zero. Does not add MIDI pitch-wheel input. Hardware audio and timing unverified. 914 returns the exact unity ratio immediately for a zero exponent.",
      evidence: [
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h",
        "firmware/fm1/export-patch.mjs",
        "firmware/fm1/test-nodes.c",
        "firmware/fm1/test-links.c"
      ],
      drift: {
        webBehavior: "Compiled links apply each bend separately in browser and native hosted scalar profiles: clamp the exponent to -32 through 32, compute double-precision 2^x, clamp the ratio to 12000, then multiply and clamp the result to \xB112000. Opposing bends need not cancel after intermediate clipping. Native admission now includes the existing shared Bend evaluator; functional verification remains outstanding.",
        firmwareBehavior: "913 matches those instruction boundaries and limits using Q16.16 ratios with table interpolation. Ratios below half a Q16.16 step round to zero; multiplication truncates to fixed-point precision.",
        requiredWork: "Wider fractional precision is needed for extreme negative bends and very small products. Measure hardware timing and audible results; no runtime verification is claimed."
      }
    },
    {
      id: "feedback loops",
      category: "dsp",
      status: "partial",
      since: 909,
      verification: "source reviewed",
      notes: "Graph cycles lower to paired feedback read/write instructions sharing one state slot. The state is cleared when a patch loads or switches. Q16.16 history differs from the browser's floating-point history; hardware behavior is unverified.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/runtime.h"
      ],
      drift: {
        webBehavior: "Graph cycles use a stored floating-point value, read before the cycle and written after it on every sample.",
        firmwareBehavior: "Paired package instructions read and write a reset-on-load Q16.16 history value with the same one-sample ordering.",
        requiredWork: "Measure hardware timing and audible stability under representative feedback gains."
      }
    },
    {
      id: "link arithmetic",
      category: "dsp",
      status: "partial",
      since: 913,
      verification: "source reviewed",
      notes: "Shared compiler order: weighted sources, average set links (or local base), add, multiply, then individual bends. Since 913, value loads, divide-by-one copies, add/subtract/multiply/divide and bend ratios use the compiled WASM \xB112000 graph bounds at every instruction. Applies to ordinary links and generated link-strength stages. Existing package versions and opcode numbers are unchanged; older firmware still accepts patches but uses the older bounds. Knob interpolation is unchanged. Host regressions verify the tested arithmetic and 915 scheduling; hardware timing remains unverified. 914 adds exact fast paths for multiplication by zero/unity, neutral bend and division by \xB11/\xB12; no knob interpolation or feedback scheduling changes. 915 prepares control-only link and strength calculations at buffer boundaries while retaining sample-rate modulation and feedback ordering.",
      evidence: [
        "editor/src/audio/dspProgram.ts",
        "editor/src/audio/fm1Package.ts",
        "rust/teia-kernel/src/lib.rs",
        "firmware/fm1/runtime.h",
        "firmware/fm1/test-links.c"
      ],
      drift: {
        webBehavior: "Graph arithmetic uses double precision, clamps value loads and basic arithmetic to \xB112000 and smooths editable values. Same-type links execute in saved order; intermediate clipping can prevent cancellation.",
        firmwareBehavior: "913 uses the same link instruction order and graph bounds, with Q16.16 quantization and existing unsmoothed knob updates. General DSP node algorithms retain their separately registered limitations.",
        requiredWork: "Assess remaining fixed-point error and small-value underflow in host and hardware comparisons. Knob interpolation remains a separate parity gap."
      }
    },
    {
      id: "control scheduling",
      category: "dsp",
      status: "supported",
      since: 915,
      verification: "source reviewed",
      notes: "Single-assignment programs split into dependency-ordered control and audio instruction lists on load. Pure calculations depending only on values are prepared after inputs are copied at each 128-frame half-buffer boundary and reused until values change. Stateful DSP, audio-derived arithmetic, feedback and all MIDI outputs remain per sample. Packages reassigning registers retain original-order execution; legacy level smoothing uses the sample-compatible entry point. Exact envelope quotient/remainder progression avoids repeated fractional division without changing samples. No package-format, opcode, resource-limit or knob-interpolation change. Host tests establish equivalence for their fixtures, not hardware performance. Since 921, repeat programs retain original instruction order and execute per sample; Spread count alone is latched at block start.",
      evidence: [
        "firmware/fm1/runtime.h",
        "firmware/fm1/app.c",
        "firmware/fm1/test-schedule.c",
        "firmware/fm1/test-nodes.c",
        "firmware/fm1/patches/feedback-bend.json",
        "firmware/fm1/README.md"
      ]
    },
    {
      id: "compiled instruction optimization",
      category: "dsp",
      status: "supported",
      since: 915,
      verification: "source reviewed",
      notes: "FM-1 export simplifies the lowered Q16.16 instruction stream: immutable value folding, bounded arithmetic identities, duplicate pure calculations and unused pure operations. Mutable Params values remain live, intermediate clipping is retained, and stateful/feedback execution order is preserved. Constant folding uses integer arithmetic with firmware rounding, not browser floating-point evaluation. Register numbering and asset/control value indices stay stable. This is a compiler change for firmware 915; no new firmware or package protocol. Hardware timing has not been measured.",
      evidence: [
        "editor/src/audio/fm1Optimizer.ts",
        "editor/src/audio/fm1Package.ts",
        "scripts/test-fm1-optimizer.mjs",
        "firmware/fm1/test-optimizer-render.c"
      ]
    },
    {
      id: "live patch editing",
      category: "protocol",
      status: "supported",
      since: 918,
      verification: "source reviewed",
      notes: "Editor FM1 mode replaces PLAY/REC with LIVE EDIT. Serialized updates compile the latest root patch; identical lowered layouts send changed Q16.16 values, while layout changes upload a new patch. Live compilation keeps value bindings mutable. Command 7 probes support; command 6 validates preset, original package CRC and up to 18 indexed values, applies them between audio buffers without resetting DSP state, and acknowledges application. Errors stop sending; invalid graphs wait for correction. RAM only. Source implemented for 918; hardware and timing are not yet verified. The mode menu filters node selection to supported/partial registry entries and colors existing unsupported/unknown nodes red, even when disabled. Browser transport now leaves 10 ms after matched replies and retries timed-out read-only probes once with a fresh token. This mitigates a possible receive-mailbox release race in existing firmware; the reported capabilities timeout has not been reproduced or hardware-verified. Patch-data timeouts now query the existing status offset: continue at the chunk end, resend once at the chunk start, and stop on any other offset or a second data timeout. Begin, activation, selection and value updates are never automatically retried. Recovery is source reviewed; hardware verification remains pending. No DSP, package format or firmware version change. FM1 mode persists in the editor local state; LIVE EDIT remains off on reload. This UI persistence change does not change firmware or DSP behavior.",
      evidence: [
        "editor/src/audio/useFm1LiveEdit.ts",
        "editor/src/audio/fm1Upload.ts",
        "editor/src/audio/fm1Package.ts",
        "firmware/fm1/upload.h",
        "firmware/fm1/app.c",
        "editor/src/editor/ShaderNode.tsx",
        "editor/src/editor/NodeEditor.tsx"
      ],
      blockedInputs: [],
      blockedOutputs: []
    },
    {
      id: "hosted-runtime-editor",
      category: "workflow",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "Bridge v2 adds opt-in ordered transient gestures and Buffer capture-before-persist Save. Native instance APIs provide prepared observation plans, caller-owned bounded feedback, staged frozen-write captures and prepared Buffer swaps including concrete nested repeat item addresses. FFT remains explicitly unavailable natively. Firmware and host integration are not inferred from container regression tests.",
      evidence: [
        "editor/src/hosted/index.ts",
        "editor/src/hosted/session.ts",
        "rust/teia-kernel/src/hosted.rs",
        "docs/hosted.md"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Instance-scoped native observation, bounded staged Buffer capture and replacement, bridge-v2 gesture/capture Save contracts, shared hierarchical bounded repeat pools. Hosted parameter sliders send instance overrides and retain their controls across graph updates; routine revision and tempo overlays are hidden. Hosts own timing, durable references, device access and actual IPC implementations.",
        firmwareBehavior: "Existing FM-1 binary/live-edit protocols use their own single-device lifecycle and compiled parameter slots. They do not implement this hosted bridge or native instance API.",
        requiredWork: "A firmware adapter and explicit capability audit would be needed to expose equivalent hosted lifecycle, revision and parameter identity semantics. Existing FM-1 mode remains separate."
      }
    },
    {
      id: "hosted-midi-transport",
      category: "workflow",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "Native notes now use the shared ordered 4096-event FIFO with one event every two samples and a blank separator; mono state changes on delivery. CC, pitch bend and host timeline remain sample-offset controls. Native input queue overflow rejects the incoming block; standalone queue rejects newest with a counter. Allocation guards and headless regression evidence do not establish device deadlines or firmware parity.",
      evidence: [
        "rust/teia-kernel/src/hosted.rs",
        "rust/teia-kernel/src/lib.rs",
        "editor/src/hosted/native.ts",
        "docs/hosted.md"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Native/WASM note pulses and mono state share ordered one-note-per-two-samples delivery, including equal-offset bursts and velocity-zero releases. Native block overflow is atomic; standalone queue overflow rejects newest. Pitch bend, CC and host timeline keep immediate offset semantics.",
        firmwareBehavior: "FM-1 does not consume this host-event/timeline API. Existing device MIDI and internal/MIDI clock protocols retain their separately tracked restrictions and timing.",
        requiredWork: "Design a bounded firmware adapter and encoded timing/pitch-bend protocol; implement corresponding DSP/control handlers and audit source/hardware evidence before claiming parity."
      }
    },
    {
      id: "shared-runtime-realtime-policy",
      category: "workflow",
      status: "unsupported",
      since: null,
      verification: "source reviewed",
      notes: "prepareDspRealtime preallocates hierarchical Spread/Spawn pools to depth 4, at most 1024 total potential item slots across all parent contexts, with a checked heap payload budget. Each parent item owns child state/resources. Capped Spread counts and dropped excess Spawn triggers increment exhaustion; no allocation or dynamic fallback occurs in the selected bounded path. Legacy standalone dynamic policy remains default. FM-1 has not implemented or verified this preparation policy.",
      evidence: [
        "rust/teia-kernel/src/runtime_preparation.rs",
        "rust/teia-kernel/src/lib.rs",
        "rust/teia-kernel/tests/hosted.rs",
        "rust/teia-kernel/src/bounded_repeats.rs",
        "rust/teia-kernel/src/hosted_observation.rs"
      ],
      blockedInputs: [],
      blockedOutputs: [],
      drift: {
        webBehavior: "Shared native/WASM finite hierarchical repeat execution, including mixed nesting and per-item Buffer captures. Fixed depth/total-slot bounds, caller memory budget, counted exhaustion and allocation-free render traversal.",
        firmwareBehavior: "FM-1 uses its existing contract limits and firmware repeat implementation; it does not expose this host preparation API or the new budget/exhaustion feedback.",
        requiredWork: "Audit mapping to firmware limits before implementing an equivalent adapter. No firmware version or hardware verification is advanced."
      }
    }
  ],
  evidenceLog: [
    {
      date: "2026-10-09",
      firmware: "FM-1_901",
      scope: "Basic playback, three knobs and MIDI (transport unspecified); same-image update. Does not verify later firmware.",
      source: "firmware/fm1/README.md"
    },
    {
      date: "2026-10-09",
      firmware: "FM-1_902",
      scope: "Two patch uploads and selection acknowledged; user confirmed playback/switching and no late buffers. Does not verify 904 DSP additions.",
      source: "firmware/fm1/UPLOAD.md"
    },
    {
      date: "2026-10-10",
      firmware: "FM-1_904",
      scope: "Installation from 903 and reboot identity only. New-node host tests statically compiled, not executed; audio and performance unverified.",
      source: "firmware/fm1/UPLOAD.md"
    },
    {
      date: "2026-10-11",
      firmware: "FM-1_915",
      verification: "host verified",
      features: [
        "control scheduling"
      ],
      scope: "ASan/UBSan host execution compared prepared rendering with original-order execution for test-fm-3 and 22 exported firmware examples, 700 buffers each, with control changes and one-sample MIDI triggers: exact output/register/state equality. A separate binary compiled from the 914 runtime produced bit-identical stereo PCM for the same 23 patches after the envelope optimisation. Cached envelope progression was checked against direct division including duration changes, repeated positions and retriggers. No hardware deadline or audio verification.",
      source: "firmware/fm1/test-schedule.c"
    },
    {
      date: "2026-10-11",
      firmware: "FM-1_915",
      verification: "host verified",
      features: [
        "compiled instruction optimization"
      ],
      scope: "23 regression patches rendered before/after compiler optimization for 700 blocks of 128 frames with knob changes and MIDI events. ASan/UBSan renderer verifies exact stereo PCM, DSP state, feedback and delay contents. Arithmetic guards cover rounding, intermediate clipping, independent mutable controls, stateful ordering and full value pools. Feedback bend reduces from 72 to 30 instructions; no hardware performance claim.",
      source: "scripts/test-fm1-optimizer.mjs"
    },
    {
      date: "2026-10-11",
      firmware: "FM-1_917",
      scope: "Two one-second 16-bit delays, fractional interpolation and time smoothing. Pinned linker/MMIO/ROM-call checks passed; runtime arena is 182652 bytes and pool total 226140 of 368640 bytes. Static checks do not establish audio quality or real-time performance. New delay regression assertions compile but have not been executed.",
      source: "docs/spikes/fm1-results/delay-917.json"
    }
  ],
  $schema: "./support.schema.json",
  limits: {
    operations: 256,
    registers: 256,
    values: 128,
    states: 32,
    packageVersion: 6,
    operationBytes: 24
  },
  compiler: {
    opcodes: [
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      12,
      15,
      16,
      17,
      18,
      19,
      20,
      21,
      23,
      26,
      27,
      29,
      32,
      40,
      41,
      42,
      43,
      44,
      45,
      46,
      47,
      48,
      49,
      50,
      51,
      55
    ],
    oscillatorModes: [
      0,
      1,
      2,
      3,
      4,
      5,
      6,
      9,
      12
    ],
    filterModes: {
      "1": 27,
      "2": 29,
      "3": 30,
      "8": 31
    },
    distortionModes: {
      "1": 34,
      "4": 35,
      "5": 36
    },
    functions: [
      {
        id: 1,
        name: "abs",
        arity: 1
      },
      {
        id: 6,
        name: "min",
        arity: 2
      },
      {
        id: 7,
        name: "max",
        arity: 2
      },
      {
        id: 8,
        name: "clamp",
        arity: 3
      },
      {
        id: 13,
        name: "floor",
        arity: 1
      },
      {
        id: 14,
        name: "ceil",
        arity: 1
      },
      {
        id: 15,
        name: "round",
        arity: 1
      },
      {
        id: 16,
        name: "sign",
        arity: 1
      },
      {
        id: 17,
        name: "fract",
        arity: 1
      },
      {
        id: 19,
        name: "less than",
        arity: 2
      },
      {
        id: 20,
        name: "less than or equal",
        arity: 2
      },
      {
        id: 21,
        name: "greater than",
        arity: 2
      },
      {
        id: 22,
        name: "greater than or equal",
        arity: 2
      },
      {
        id: 23,
        name: "equal",
        arity: 2
      },
      {
        id: 24,
        name: "not equal",
        arity: 2
      },
      {
        id: 25,
        name: "and",
        arity: 2
      },
      {
        id: 26,
        name: "or",
        arity: 2
      },
      {
        id: 27,
        name: "not",
        arity: 1
      }
    ],
    delay: {
      maxNodes: 2,
      maxSeconds: 1,
      sampleRate: 44100,
      storageBits: 16,
      storageFractionBits: 12,
      smoothingSamples: 256,
      instruction: 53,
      legacyInstruction: 44,
      since: 917
    },
    repeat: {
      maxInstances: 8,
      maxContainers: 8,
      eventQueue: 256,
      since: 921,
      blockedOpcodes: [
        12,
        32
      ]
    }
  },
  protocol: {
    packages: [
      {
        version: 1,
        headerBytes: 116,
        operationBytes: 12,
        operations: 64,
        registers: 64,
        values: 64
      },
      {
        version: 2,
        headerBytes: 116,
        operationBytes: 12,
        operations: 256,
        registers: 256,
        values: 128
      },
      {
        version: 3,
        headerBytes: 116,
        operationBytes: 24,
        operations: 256,
        registers: 256,
        values: 128
      },
      {
        version: 4,
        headerBytes: 187,
        operationBytes: 24,
        operations: 256,
        registers: 256,
        values: 128
      },
      {
        version: 5,
        headerBytes: 3237,
        operationBytes: 24,
        operations: 256,
        registers: 256,
        values: 128,
        since: 916
      },
      {
        version: 6,
        headerBytes: 5797,
        operationBytes: 24,
        operations: 256,
        registers: 256,
        values: 128,
        since: 919
      }
    ],
    instructions: [
      {
        code: 0,
        name: "value",
        since: 902,
        minimumPackageVersion: 1
      },
      {
        code: 1,
        name: "copy",
        since: 902,
        minimumPackageVersion: 1
      },
      {
        code: 2,
        name: "multiply",
        since: 902,
        minimumPackageVersion: 1
      },
      {
        code: 3,
        name: "legacy sine",
        since: 902,
        minimumPackageVersion: 1
      },
      {
        code: 5,
        name: "output",
        since: 902,
        minimumPackageVersion: 1
      },
      {
        code: 19,
        name: "legacy envelope",
        since: 902,
        minimumPackageVersion: 1
      },
      {
        code: 20,
        name: "legacy ranged sine",
        since: 903,
        minimumPackageVersion: 2
      },
      {
        code: 21,
        name: "add",
        since: 904,
        minimumPackageVersion: 3
      },
      {
        code: 22,
        name: "subtract",
        since: 904,
        minimumPackageVersion: 3
      },
      {
        code: 23,
        name: "divide",
        since: 904,
        minimumPackageVersion: 3
      },
      {
        code: 24,
        name: "negate",
        since: 904,
        minimumPackageVersion: 3
      },
      {
        code: 25,
        name: "oscillator",
        since: 904,
        minimumPackageVersion: 3
      },
      {
        code: 26,
        name: "envelope",
        since: 904,
        minimumPackageVersion: 3
      },
      {
        code: 27,
        name: "low pass",
        since: 904,
        minimumPackageVersion: 3
      },
      {
        code: 28,
        name: "noise",
        since: 904,
        minimumPackageVersion: 3
      },
      {
        code: 29,
        name: "high pass",
        since: 905,
        minimumPackageVersion: 3
      },
      {
        code: 30,
        name: "band pass",
        since: 905,
        minimumPackageVersion: 3
      },
      {
        code: 31,
        name: "all pass",
        since: 905,
        minimumPackageVersion: 3
      },
      {
        code: 32,
        name: "absolute",
        since: 906,
        minimumPackageVersion: 3
      },
      {
        code: 33,
        name: "fold",
        since: 906,
        minimumPackageVersion: 3
      },
      {
        code: 34,
        name: "fuzz",
        since: 906,
        minimumPackageVersion: 3
      },
      {
        code: 35,
        name: "saturate",
        since: 906,
        minimumPackageVersion: 3
      },
      {
        code: 36,
        name: "wavefold",
        since: 906,
        minimumPackageVersion: 3
      },
      {
        code: 37,
        name: "remove dc",
        since: 906,
        minimumPackageVersion: 3
      },
      {
        code: 38,
        name: "expression function",
        since: 907,
        minimumPackageVersion: 3
      },
      {
        code: 39,
        name: "accumulator",
        since: 907,
        minimumPackageVersion: 3
      },
      {
        code: 40,
        name: "random",
        since: 907,
        minimumPackageVersion: 3
      },
      {
        code: 41,
        name: "bend scaling",
        since: 908,
        minimumPackageVersion: 3
      },
      {
        code: 42,
        name: "feedback read",
        since: 909,
        minimumPackageVersion: 3
      },
      {
        code: 43,
        name: "feedback write",
        since: 909,
        minimumPackageVersion: 3
      },
      {
        code: 44,
        name: "delay",
        since: 910,
        minimumPackageVersion: 3
      },
      {
        code: 45,
        name: "follower",
        since: 910,
        minimumPackageVersion: 3
      },
      {
        code: 46,
        name: "map",
        since: 910,
        minimumPackageVersion: 3
      },
      {
        code: 47,
        name: "power",
        since: 910,
        minimumPackageVersion: 3
      },
      {
        code: 48,
        name: "quantise",
        since: 910,
        minimumPackageVersion: 3
      },
      {
        code: 49,
        name: "tempo",
        since: 910,
        minimumPackageVersion: 3
      },
      {
        code: 50,
        name: "sample hold",
        since: 910,
        minimumPackageVersion: 3
      },
      {
        code: 51,
        name: "custom wave",
        since: 910,
        minimumPackageVersion: 3
      },
      {
        code: 52,
        name: "midi note",
        since: 911,
        minimumPackageVersion: 4
      },
      {
        code: 53,
        name: "smoothed delay",
        since: 917,
        minimumPackageVersion: 3
      },
      {
        code: 54,
        name: "envelope end trigger",
        since: 921,
        minimumPackageVersion: 3
      },
      {
        code: 55,
        name: "midi note event",
        since: 921,
        minimumPackageVersion: 3
      },
      {
        code: 56,
        name: "spread begin",
        since: 921,
        minimumPackageVersion: 3
      },
      {
        code: 57,
        name: "spread index",
        since: 921,
        minimumPackageVersion: 3
      },
      {
        code: 58,
        name: "repeat collect",
        since: 921,
        minimumPackageVersion: 3
      },
      {
        code: 59,
        name: "spread end",
        since: 921,
        minimumPackageVersion: 3
      },
      {
        code: 60,
        name: "spawn begin",
        since: 921,
        minimumPackageVersion: 3
      },
      {
        code: 61,
        name: "spawn end",
        since: 921,
        minimumPackageVersion: 3
      },
      {
        code: 62,
        name: "spawn instance gate",
        since: 921,
        minimumPackageVersion: 3
      },
      {
        code: 63,
        name: "block latch",
        since: 921,
        minimumPackageVersion: 3
      }
    ],
    liveEdit: {
      since: 918,
      probeCommand: 7,
      updateCommand: 6,
      maxUpdates: 18
    }
  }
};

// editor/src/audio/fm1Capabilities.ts
var fm1Capabilities = support_default;
var fm1Limits = support_default.limits;
var fm1Delay = support_default.compiler.delay;
var fm1SupportFirmware = support_default.firmware;
var fm1FilterModes = support_default.compiler.filterModes;
var fm1DistortionModes = support_default.compiler.distortionModes;
function fm1FunctionArity(id) {
  return support_default.compiler.functions.find((fn) => fn.id === id)?.arity ?? 0;
}
function inspectFm1Package(bytes) {
  const invalid = (reason) => {
    throw new Error(`FM-1 package rejected: ${reason}`);
  };
  if (bytes.length < 12 || String.fromCharCode(...bytes.subarray(0, 4)) !== "TGP1") invalid("invalid header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  const format = support_default.protocol.packages.find((p) => p.version === version);
  if (!format) return invalid(`unsupported package version ${version}`);
  if (bytes.length < format.headerBytes) invalid("invalid header");
  const count = view.getUint16(6, true), registers = view.getUint16(8, true), values = view.getUint16(10, true);
  if (!count || count > Math.min(format.operations, fm1Limits.operations) || !registers || registers > Math.min(format.registers, fm1Limits.registers) || values > Math.min(format.values, fm1Limits.values) || bytes.length !== format.headerBytes + count * format.operationBytes + values * 4) invalid("invalid length or resource counts");
  let requiredFirmware = format.since ?? 902;
  let delays = 0;
  for (let i = 0; i < count; i++) {
    const offset = format.headerBytes + i * format.operationBytes;
    const operand = (index) => view.getInt16(offset + index * 2, true);
    const code = operand(0);
    const instruction = support_default.protocol.instructions.find((op) => op.code === code);
    if (!instruction || version < instruction.minimumPackageVersion) return invalid(`unsupported instruction ${code} at operation ${i}`);
    requiredFirmware = Math.max(requiredFirmware, instruction.since);
    if (code === fm1Delay.instruction || code === fm1Delay.legacyInstruction) {
      if (++delays > fm1Delay.maxNodes) invalid(`at most ${fm1Delay.maxNodes} Delay nodes per patch`);
      if (delays > 1) requiredFirmware = Math.max(requiredFirmware, fm1Delay.since);
    }
    if (code === 25 && (!support_default.compiler.oscillatorModes.includes(operand(9)) || operand(9) === 6)) invalid("unsupported oscillator waveform");
    if (code === 38 && !fm1FunctionArity(operand(6))) invalid("unsupported expression function");
  }
  return { version, requiredFirmware };
}

// editor/src/audio/fm1Optimizer.ts
var Q = 65536;
var BOUND = 12e3 * Q;
var pure = /* @__PURE__ */ new Set([0, 1, 2, 21, 22, 23, 24, 32, 33, 34, 35, 36, 38, 41, 46, 47, 48]);
var hasOutput = (op) => op[0] !== 5 && op[0] !== 43;
function inputs(op) {
  switch (op[0]) {
    case 0:
    case 42:
    case 54:
      return [];
    case 1:
    case 3:
    case 5:
    case 24:
    case 32:
    case 37:
    case 41:
    case 43:
      return [2];
    case 2:
    case 21:
    case 22:
    case 23:
    case 28:
    case 33:
    case 34:
    case 35:
    case 36:
    case 47:
    case 50:
      return [2, 3];
    case 19:
    case 20:
    case 27:
    case 29:
    case 30:
    case 31:
    case 45:
    case 48:
      return [2, 3, 4];
    case 25:
      return [2, 3, 4, ...[6, 7, 8].filter((i) => op[i] >= 0), ...op[9] === 12 ? [10] : []];
    case 26:
      return [2, 3, 4, 6, 7, 8, 9, 10];
    case 38:
      return [2, ...fm1FunctionArity(op[6]) >= 2 ? [3] : [], ...fm1FunctionArity(op[6]) === 3 ? [4] : []];
    case 39:
    case 46:
      return [2, 3, 4, 6, 7];
    case 40:
      return [2, 3, ...op[4] >= 0 ? [4] : []];
    case fm1Delay.legacyInstruction:
    case fm1Delay.instruction:
      return [2, 3, 4, 6];
    case 49:
      return [2, 4];
    case 51:
      return [2, 3, 4, 6, 7, 8];
    case 52:
    case 55:
      return [3];
    default:
      throw new Error(`Missing FM-1 optimizer operand description: ${op[0]}`);
  }
}
function optimizeFm1Ops(source, values, mutableValues, maximumValues) {
  const assigned = /* @__PURE__ */ new Set();
  for (const op of source) {
    inputs(op);
    if (hasOutput(op)) {
      if (assigned.has(op[1])) return source;
      assigned.add(op[1]);
    }
  }
  const bound = (n) => Number(n < -BigInt(BOUND) ? -BigInt(BOUND) : n > BigInt(BOUND) ? BigInt(BOUND) : n);
  const known = /* @__PURE__ */ new Map();
  const bounded = /* @__PURE__ */ new Set();
  const aliases = /* @__PURE__ */ new Map();
  const expressions = /* @__PURE__ */ new Map();
  const constants = /* @__PURE__ */ new Map();
  values.forEach((v, i) => {
    if (!mutableValues.has(i)) constants.set(Math.max(-BOUND, Math.min(BOUND, v)), i);
  });
  const result = [];
  for (const original of source) {
    let op = [...original];
    for (const i of inputs(op)) op[i] = aliases.get(op[i]) ?? op[i];
    const out = op[1], code = op[0], a = known.get(op[2]), b = known.get(op[3]);
    let folded;
    if (code === 0 && !mutableValues.has(op[2])) folded = Math.max(-BOUND, Math.min(BOUND, values[op[2]]));
    if (a !== void 0) {
      if (code === 1) folded = bound(BigInt(a));
      if (code === 41 && a === 0) folded = Q;
      if (code === 24) folded = Math.min(2147483647, -a);
      if (code === 32) folded = Math.min(2147483647, Math.abs(a));
      if (b !== void 0) {
        if (code === 2) folded = bound(BigInt(a) * BigInt(b) >> 16n);
        if (code === 21) folded = bound(BigInt(a) + BigInt(b));
        if (code === 22) folded = bound(BigInt(a) - BigInt(b));
        if (code === 23) folded = b === 0 ? 0 : bound((BigInt(a) << 16n) / BigInt(b));
      }
    }
    if (code === 2 && (a === 0 || b === 0)) folded = 0;
    if (folded !== void 0) {
      known.set(out, folded);
      if (Math.abs(folded) <= BOUND) {
        let index = constants.get(folded);
        if (index === void 0 && values.length < maximumValues) {
          index = values.length;
          values.push(folded);
          constants.set(folded, index);
        }
        if (index !== void 0) op = [0, out, index, 0, 0, 0];
      }
    }
    let identity;
    if (code === 1 || (code === 21 || code === 22) && b === 0 || (code === 2 || code === 23) && b === Q) identity = op[2];
    if (code === 21 && a === 0 || code === 2 && a === Q) identity = op[3];
    if (op[0] !== 0 && identity !== void 0 && bounded.has(identity)) {
      aliases.set(out, identity);
      continue;
    }
    if ([0, 1, 2, 21, 22, 23, 41].includes(op[0]) || folded !== void 0 && Math.abs(folded) <= BOUND) bounded.add(out);
    if (pure.has(op[0])) {
      const key = [op[0], ...op.slice(2), ...Array(Math.max(0, 12 - op.length)).fill(0)].join(",");
      const existing = expressions.get(key);
      if (existing !== void 0) {
        aliases.set(out, existing);
        continue;
      }
      expressions.set(key, out);
    }
    result.push(op);
  }
  const needed = /* @__PURE__ */ new Set();
  return [...result].reverse().filter((op) => {
    if (pure.has(op[0]) && !needed.has(op[1])) return false;
    for (const i of inputs(op)) needed.add(op[i]);
    return true;
  }).reverse();
}

// editor/src/audio/fm1Support.ts
var fm1SupportFirmware2 = fm1Capabilities.firmware;
function describeFeature(feature) {
  const drift = feature.drift;
  return feature.notes + (drift ? ` Web: ${drift.webBehavior} Firmware: ${drift.firmwareBehavior} Catch-up: ${drift.requiredWork}` : "");
}
function getFm1SupportWarnings(patch) {
  const features = new Map(fm1Capabilities.features.filter((feature) => feature.category === "node").map((feature) => [feature.id, feature]));
  const warnings = /* @__PURE__ */ new Map();
  const visit = (current, parents) => {
    for (const node of current.nodes) {
      if (node.enabled === false) continue;
      const label = node.customLabel || node.subpatchName || getNodeTypeLabel(node.type);
      const path = [...parents, `${label} (${node.id})`];
      const feature = features.get(node.type);
      if (feature?.status !== "supported") {
        const status = feature?.status;
        let warning = warnings.get(node.type);
        if (!warning) {
          warning = {
            feature: getNodeTypeLabel(node.type),
            status: status === "unsupported" || status === "partial" ? status : "unknown",
            notes: feature ? describeFeature(feature) : "FM-1 support has not been reviewed for this node.",
            nodes: []
          };
          warnings.set(node.type, warning);
        }
        warning.nodes.push(path.join(" \u2192 "));
      }
      if (node.type === "Group" && node.subpatch) visit(node.subpatch, path);
    }
  };
  visit(patch, []);
  const order = { unsupported: 0, partial: 1, unknown: 2 };
  return [...warnings.values()].sort((a, b) => order[a.status] - order[b.status] || a.feature.localeCompare(b.feature));
}
function getFm1SupportErrors(patch) {
  const errors2 = getFm1SupportWarnings(patch).filter((warning) => warning.status === "unsupported" || warning.status === "unknown").map((warning) => `${warning.nodes.join("; ")}: ${warning.status === "unknown" ? "FM-1 support needs review" : "not supported on FM-1"}. ${warning.notes}`);
  const features = new Map(fm1Capabilities.features.filter((feature) => feature.category === "node").map((feature) => [feature.id, feature]));
  let delays = 0;
  const visit = (current, parent) => {
    const enabled = new Map(current.nodes.filter((node) => node.enabled !== false).map((node) => [node.id, node]));
    const checkOutput = (endpoint) => {
      const node = enabled.get(endpoint.node);
      const feature = node && features.get(node.type);
      if (feature && "blockedOutputs" in feature && feature.blockedOutputs?.some((port) => port === endpoint.port)) {
        errors2.push(`${parent}${endpoint.node}: output "${endpoint.port}" is not supported on FM-1. ${feature.notes}`);
      }
    };
    const checkModulations = (links) => {
      for (const link of links) {
        if (link.enabled === false) continue;
        checkOutput(link.from);
        if (link.weightModulations) checkModulations(link.weightModulations);
      }
    };
    for (const link of current.links) {
      if (link.enabled === false || !enabled.has(link.from.node) || !enabled.has(link.to.node)) continue;
      checkOutput(link.from);
      const node = enabled.get(link.to.node);
      const feature = features.get(node.type);
      if (feature && "blockedInputs" in feature && feature.blockedInputs?.some((port) => port === link.to.port)) {
        errors2.push(`${parent}${node.id}: input "${link.to.port}" is not supported on FM-1. ${feature.notes}`);
      }
      if (link.weightModulations) checkModulations(link.weightModulations);
    }
    for (const node of enabled.values()) {
      if (node.type === "Delay" && ++delays > fm1Capabilities.compiler.delay.maxNodes) {
        errors2.push(`FM-1 supports at most ${fm1Capabilities.compiler.delay.maxNodes} Delay nodes per patch, including group contents.`);
      }
      if (node.type === "Group" && node.subpatch) visit(node.subpatch, `${parent}${node.id} \u2192 `);
    }
  };
  visit(patch, "");
  return [...new Set(errors2)];
}
function isFm1NodeImplemented(type) {
  const feature = fm1Capabilities.features.find((feature2) => feature2.category === "node" && feature2.id === type);
  return feature?.status === "supported" || feature?.status === "partial";
}

// editor/src/audio/fm1Package.ts
var fm1HeaderBytes = fm1Capabilities.protocol.packages.find((p) => p.version === fm1Limits.packageVersion).headerBytes;
var fm1MaximumBytes = fm1HeaderBytes + fm1Limits.operations * fm1Limits.operationBytes + fm1Limits.values * 4;
function q16(n) {
  const value = Math.round(n * 65536);
  if (!Number.isFinite(n) || n < -32768 || value < -2147483648 || value > 2147483647) throw new Error("Value outside Q16.16 range");
  return value;
}
function writeOperand(view, at, value) {
  if (!Number.isInteger(value) || value < -32768 || value > 32767) throw new Error("Invalid compiled operand");
  view.setInt16(at, value, true);
}
function analyzeFm1Patch(patch, live = false) {
  let usage = null;
  try {
    const fm1Patch = migrateLegacyKeyboardControls(patch);
    const eligibilityErrors = getFm1SupportErrors(fm1Patch);
    if (eligibilityErrors.length) return { usage, errors: eligibilityErrors, compiled: null };
    const program = compilePatchToDspProgram(fm1Patch, { target: "fm1", deduplicateLoads: false, foldConstants: false, eliminateDeadPureOps: false, analyzeSchedule: false });
    usage = { operations: program.ops.length, registers: program.registerCount, values: program.values.length, states: program.stateCount, bytes: 187 + program.ops.length * fm1Limits.operationBytes + program.values.length * 4 };
    if (program.errors.length) return { usage, errors: program.errors, compiled: null };
    const compiled = lowerFm1Patch(fm1Patch, program, live);
    usage = { operations: compiled.ops.length, registers: program.registerCount, values: program.values.length, states: program.stateCount, bytes: compiled.bytes.length };
    return { usage, errors: [], compiled };
  } catch (error) {
    return { usage, errors: [error instanceof Error ? error.message : String(error)], compiled: null };
  }
}
function migrateLegacyKeyboardControls(patch) {
  if (patch.nodes.some((node) => node.enabled !== false && node.type === "MidiNote")) return patch;
  const roles = ["frequency", "gate"];
  const candidates = patch.nodes.filter((node) => node.type === "Params" && node.enabled !== false && roles.every((name) => node.outputs?.some((output) => output.name === name)));
  if (candidates.length !== 1) return patch;
  const controls = candidates[0];
  const idBase = "fm1-midi-note";
  let id = idBase, suffix = 2;
  const ids = new Set(patch.nodes.map((node) => node.id));
  while (ids.has(id)) id = `${idBase}-${suffix++}`;
  return {
    ...patch,
    nodes: [...patch.nodes, { id, type: "MidiNote", params: {} }],
    links: patch.links.map((link) => link.from.node === controls.id && roles.includes(link.from.port) ? { ...link, from: { ...link.from, node: id } } : link)
  };
}
function lowerFm1Patch(patch, program, live = false) {
  const controls = patch.nodes.filter((node) => node.type === "Params" && node.enabled !== false);
  if (controls.length > 1) throw new Error("FM-1 patches can use one enabled Params node so its output order maps to the device controls.");
  const controlsNode = controls[0];
  const controlsId = controlsNode?.id;
  const controlOutputs = controlsNode?.outputs ?? [];
  if (controlOutputs.length > fm1Limits.values) throw new Error(`FM-1 Params share the ${fm1Limits.values}-value patch budget.`);
  for (const node of patch.nodes.filter((node2) => node2.enabled !== false && node2.type === "MidiNote")) {
    if ((node.params.channel ?? 0) !== 0 && (node.params.channel ?? 0) !== 1) {
      throw new Error(`MIDI Note ${node.id}: FM-1 supports only channel 1 or all channels.`);
    }
  }
  if (controlsNode) for (const output of controlOutputs) {
    if (program.valueBindings.some((b) => b.nodeId === controlsId && b.port === output.name)) continue;
    const valueIndex = program.values.length;
    program.values.push(controlsNode.params[output.name] ?? 0);
    program.valueBindings.push({ id: `${controlsId}.${output.name}`, kind: "node-param", nodeId: controlsId, port: output.name, valueIndex });
  }
  const literalValues = new Set(program.valueBindings.filter((b) => b.kind === "constant").map((b) => b.valueIndex));
  const literalRegisters = /* @__PURE__ */ new Map();
  let ops = [];
  let fm1DelayCount = 0;
  const stateMap = /* @__PURE__ */ new Map();
  const tempoStates = /* @__PURE__ */ new Map();
  let fm1StateCount = 0;
  program.ops.forEach((op, index) => {
    if (op.opcode === 32) tempoStates.set(index, fm1StateCount++);
  });
  const repeatRanges = program.repeatBindings;
  const stateOps = program.ops.filter((o) => o.state !== void 0 && o.state >= 0 && ![42, 45, 46, 47, 48].includes(o.opcode));
  for (const o of stateOps) {
    if (!repeatRanges.some((r) => o.state >= r.stateStart && o.state < r.stateStart + r.stateCount) && !stateMap.has(o.state)) stateMap.set(o.state, fm1StateCount++);
  }
  const repeatStates = repeatRanges.map((r) => [...new Set(stateOps.filter((o) => o.state >= r.stateStart && o.state < r.stateStart + r.stateCount).map((o) => o.state))]);
  const totalRepeatStates = repeatStates.reduce((n, states) => n + states.length, 0);
  const capacity = Math.min(fm1Capabilities.compiler.repeat.maxInstances, totalRepeatStates ? Math.floor((fm1Limits.states - fm1StateCount) / totalRepeatStates) : fm1Capabilities.compiler.repeat.maxInstances);
  if (repeatRanges.length > fm1Capabilities.compiler.repeat.maxContainers || capacity < 1) throw new Error("FM-1 repeat templates exceed the container or state budget.");
  const repeatLayout = repeatStates.map((states) => {
    const start = fm1StateCount;
    states.forEach((state, i) => stateMap.set(state, start + i));
    fm1StateCount += states.length * capacity;
    return { start, count: states.length };
  });
  const repeatBounds = program.ops.flatMap((op, index) => [42, 46].includes(op.opcode) ? [{ start: index, end: op.b }] : []);
  const sourceIndices = /* @__PURE__ */ new Map();
  const repeatJumps = [];
  const appendCustomWaveAsset = (bindingIndex) => {
    const binding = program.customWaveBindings[bindingIndex];
    if (!binding) throw new Error(`${context}: missing Custom Wave data`);
    const mode = ["loop", "ping-pong", "once", "sustain", "sustain-loop", "sustain-ping-pong"].indexOf(binding.customWave.mode);
    if (mode < 0 || binding.customWave.points.length < 2) throw new Error(`${context}: invalid Custom Wave data`);
    const first = program.values.length;
    program.values.push(mode, binding.customWave.sustainStart, binding.customWave.sustainEnd);
    for (const point of binding.customWave.points) program.values.push(point.x, point.y);
    return { first, points: binding.customWave.points.length };
  };
  let context = "";
  for (const [sourceIndex, source] of program.ops.entries()) {
    sourceIndices.set(sourceIndex, ops.length);
    const o = { ...source, state: stateMap.get(source.state) ?? source.state };
    context = program.stateBindings.find((binding) => binding.state === source.state)?.nodeId ?? `operation ${o.opcode}`;
    if (!fm1Capabilities.compiler.opcodes.includes(o.opcode)) {
      throw new Error(`Unsupported opcode ${o.opcode} (${context}) for ${fm1Capabilities.firmware}`);
    }
    const inRepeat = repeatBounds.some((range) => sourceIndex > range.start && sourceIndex < range.end);
    if (inRepeat && fm1Capabilities.compiler.repeat.blockedOpcodes.includes(o.opcode)) throw new Error(`${context}: FM-1 Delay and Tempo must be outside repeat containers.`);
    switch (o.opcode) {
      case 0:
        ops.push([0, o.out, o.a, 0, 0, 0]);
        if (literalValues.has(o.a)) literalRegisters.set(o.out, program.values[o.a]);
        break;
      case 2:
        ops.push([2, o.out, o.a, o.b, 0, 0]);
        break;
      case 1:
      case 16:
      case 17:
      case 18: {
        if (o.opcode === 17 && literalRegisters.get(o.b) === 1) {
          ops.push([1, o.out, o.a, 0, 0, 0]);
          break;
        }
        const code = { 1: 21, 16: 22, 17: 23, 18: 24 }[o.opcode];
        ops.push([code, o.out, o.a, o.opcode === 18 ? 0 : o.b, 0, 0]);
        break;
      }
      case 3:
        if (o.value4 !== 1 && o.a !== 5 || !fm1Capabilities.compiler.oscillatorModes.includes(o.a)) throw new Error(`${context}: unsupported oscillator mode`);
        if (o.a === 6) ops.push([28, o.out, o.value2, o.value3, 0, o.state]);
        else if (o.a === 5) ops.push([50, o.out, o.c, o.d, 0, o.state]);
        else if (o.a === 9) {
          const asset = appendCustomWaveAsset(o.value);
          ops.push([51, o.out, o.b, o.d, o.e, o.state, o.c, o.value2, o.value3, asset.first, asset.points]);
        } else {
          if (o.c !== -1 && o.a !== 12) throw new Error(`${context}: oscillator signal input is not supported`);
          ops.push([
            25,
            o.out,
            o.b,
            o.value2,
            o.value3,
            o.state,
            o.d,
            o.e,
            o.a === 4 || o.a === 12 ? o.value : -1,
            o.a,
            o.a === 12 ? o.c : -1
          ]);
        }
        break;
      case 19:
        ops.push([26, o.out, o.b, o.d, o.e, o.state, o.value % 4096, Math.floor(o.value / 4096), o.a, o.c, o.value2 - 1]);
        break;
      case 4: {
        const code = fm1FilterModes[o.a];
        if (code === void 0) throw new Error(`${context}: unsupported FM-1 filter mode ${o.a}`);
        ops.push([code, o.out, o.b, o.c, o.d, o.state]);
        break;
      }
      case 8:
        ops.push([42, o.out, 0, 0, 0, o.state]);
        break;
      case 9:
        ops.push([43, 0, o.a, 0, 0, o.state]);
        break;
      case 6:
        ops.push([32, o.out, o.a, 0, 0, 0]);
        break;
      case 21:
        ops.push([34, o.out, o.a, o.b, 0, 0]);
        break;
      case 15:
        ops.push([33, o.out, o.a, o.b, 0, 0]);
        break;
      case 23: {
        const code = fm1DistortionModes[o.value];
        if (o.c !== -1 || code === void 0) throw new Error(`${context}: unsupported FM-1 distortion mode`);
        ops.push([code, o.out, o.a, o.b, 0, 0]);
        break;
      }
      case 26: {
        if (o.a === 9 && o.value === 2) {
          ops.push([47, o.out, o.b, o.c, 0, 0]);
          break;
        }
        const arity = fm1FunctionArity(o.a);
        if (!arity || o.value !== arity) throw new Error(`${context}: unsupported FM-1 expression function ${o.a}`);
        ops.push([38, o.out, o.b, arity >= 2 ? o.c : 0, arity === 3 ? o.d : 0, 0, o.a]);
        break;
      }
      case 27:
        if (o.a < 0 || o.a > 9) throw new Error(`${context}: unsupported MIDI output`);
        ops.push([o.a > 4 ? 55 : 52, o.out, o.a, o.b, 0, 0]);
        break;
      case 29:
        ops.push([39, o.out, o.a, o.b, o.c, o.state, o.d, o.e, o.value]);
        break;
      case 7:
        ops.push([46, o.out, o.a, o.b, o.c, 0, o.d, o.e]);
        break;
      case 12:
        if (++fm1DelayCount > fm1Delay.maxNodes) throw new Error(`FM-1 supports at most ${fm1Delay.maxNodes} Delay nodes per patch`);
        ops.push([fm1Delay.instruction, o.out, o.a, o.b, o.c, o.state, o.d]);
        break;
      case 20:
        ops.push([45, o.out, o.a, o.b, o.c, o.state]);
        break;
      case 32:
        ops.push([49, o.out, o.a, o.c, o.e, tempoStates.get(sourceIndex)]);
        break;
      case 41:
        ops.push([63, o.out, o.a, 0, 0, o.state]);
        break;
      case 42:
      case 46: {
        const layout = repeatLayout[o.value];
        const op = [o.opcode === 42 ? 56 : 60, o.opcode === 42 ? 0 : o.out, o.a, 0, o.c, layout.start, o.d, layout.count, capacity, o.value];
        repeatJumps.push({ op, end: o.b });
        ops.push(op);
        break;
      }
      case 43:
        ops.push([57, o.out, 0, 0, 0, 0]);
        break;
      case 44:
        ops.push([58, o.out, o.a, o.b, 0, 0]);
        break;
      case 45:
      case 47:
        ops.push([o.opcode === 45 ? 59 : 61, 0, 0, 0, 0, 0]);
        break;
      case 48:
        if (o.value !== 0 || stateMap.get(o.a) === void 0) throw new Error("FM-1 end trigger currently supports Envelope only.");
        ops.push([54, o.out, stateMap.get(o.a), 0, 0, 0]);
        break;
      case 50:
        ops.push([62, o.out, 0, 0, 0, 0]);
        break;
      case 40:
        ops.push([48, o.out, o.a, o.b, o.c, 0]);
        break;
      case 49:
        ops.push([40, o.out, o.b, o.c, o.a, o.state]);
        break;
      case 55:
        ops.push([41, o.out, o.a, 0, 0, 0]);
        break;
      case 51:
        ops.push([37, o.out, o.a, 0, 0, o.state]);
        break;
      case 5:
        ops.push([5, 0, o.a, o.b, 0, 0]);
        break;
      default:
        throw new Error(`Unsupported opcode ${o.opcode}`);
    }
  }
  for (const jump of repeatJumps) jump.op[3] = sourceIndices.get(jump.end);
  const fixedValues = program.values.map(q16);
  const mutableValues = new Set(program.valueBindings.filter((b) => live || b.nodeId === controlsId && controlsId !== void 0).map((b) => b.valueIndex));
  if (!repeatJumps.length) ops = optimizeFm1Ops(ops, fixedValues, mutableValues, fm1Limits.values);
  for (let i = program.values.length; i < fixedValues.length; i++) program.values.push(fixedValues[i] / 65536);
  for (const [label, used, maximum] of [
    ["operations", ops.length, fm1Limits.operations],
    ["registers", program.registerCount, fm1Limits.registers],
    ["values", program.values.length, fm1Limits.values],
    ["state entries", fm1StateCount, fm1Limits.states]
  ]) if (used > maximum) throw new Error(`Patch uses ${used} ${label}; FM-1 limit is ${maximum}`);
  program.stateCount = fm1StateCount;
  const parameters = {};
  for (const op of ops) while (op.length < 12) op.push(0);
  const bytes = new Uint8Array(fm1HeaderBytes + ops.length * fm1Limits.operationBytes + program.values.length * 4);
  const view = new DataView(bytes.buffer);
  const text = (value, at2) => bytes.set(new TextEncoder().encode(value), at2);
  text("TGP1", 0);
  view.setUint16(4, fm1Limits.packageVersion, true);
  view.setUint16(6, ops.length, true);
  view.setUint16(8, program.registerCount, true);
  view.setUint16(10, program.values.length, true);
  const name = patch.name ?? "untitled";
  if (!/^[ -~]{1,23}$/.test(name)) throw new Error("Patch name must be 1\u201323 printable ASCII characters");
  text(name, 12);
  const usedKnobs = /* @__PURE__ */ new Set();
  bytes[36] = controlOutputs.length;
  controlOutputs.forEach((output, i) => {
    const binding = program.valueBindings.find((b) => b.nodeId === controlsId && b.port === output.name);
    if (!binding || usedKnobs.has(binding.valueIndex)) throw new Error(`Invalid or duplicate Params output "${output.name}".`);
    usedKnobs.add(binding.valueIndex);
    if (!output.name.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(output.name)) throw new Error("FM-1 Params names must be nonempty and contain no control characters.");
    let screenLabel = "";
    for (const character of output.name.normalize("NFC")) {
      if (new TextEncoder().encode(screenLabel + character).length > 31) break;
      screenLabel += character;
    }
    const lo = q16(output.min ?? 0), hi = q16(output.max ?? 1);
    const step = Math.max(1, Math.round((hi - lo) / 100));
    if (lo >= hi || program.values[binding.valueIndex] < (output.min ?? 0) || program.values[binding.valueIndex] > (output.max ?? 1)) throw new Error(`Invalid range or default for Params output "${output.name}".`);
    parameters[output.name] = binding.valueIndex;
    const at2 = 37 + i * 45;
    bytes[at2] = binding.valueIndex;
    text(screenLabel, at2 + 1);
    view.setInt32(at2 + 33, lo, true);
    view.setInt32(at2 + 37, hi, true);
    view.setInt32(at2 + 41, step, true);
  });
  let at = fm1HeaderBytes;
  for (const op of ops) for (const v of op) {
    writeOperand(view, at, v);
    at += 2;
  }
  for (const v of program.values) {
    view.setInt32(at, q16(v), true);
    at += 4;
  }
  inspectFm1Package(bytes);
  return { program, ops, parameters, bytes };
}

// editor/src/audio/fm1Upload.ts
var prefix = [125, 84, 69, 1];
var errors = {
  1: "The device rejected the command or package size.",
  2: "The transfer expired or a chunk arrived out of order. Upload again.",
  3: "The patch checksum did not match. Upload again.",
  4: `The device rejected this graph. The capability registry targets ${fm1SupportFirmware}; update the firmware if the installed build lacks this feature.`,
  5: "The device is switching presets. Wait a moment and upload again."
};
var uploading = false;
var Fm1TimeoutError = class extends Error {
};
function pack7(bytes) {
  const result = [];
  let acc = 0, bits = 0;
  for (const byte of bytes) {
    acc |= byte << bits;
    bits += 8;
    while (bits >= 7) {
      result.push(acc & 127);
      acc >>>= 7;
      bits -= 7;
    }
  }
  if (bits) result.push(acc);
  return result;
}
function crc32(bytes) {
  let crc = 4294967295;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; ++i) crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
  }
  return (crc ^ 4294967295) >>> 0;
}
function fm1BrowserError() {
  if (!window.isSecureContext) return "USB MIDI needs HTTPS or localhost. Open the editor on localhost or HTTPS.";
  if (!navigator.requestMIDIAccess) return "This browser does not support Web MIDI. Open the editor in Chrome or Edge.";
  return null;
}
function uploadFm1Patch(bytes, preset, progress, signal, live = false) {
  return communicateFm1(bytes, preset, progress, signal, void 0, live);
}
function checkFm1Connection(progress, signal) {
  return communicateFm1(null, 1, progress, signal);
}
function updateFm1Values(identity, preset, updates, signal) {
  return communicateFm1(identity, preset, () => {
  }, signal, updates, true);
}
async function communicateFm1(bytes, preset, progress, signal, updates, live = false) {
  if (uploading) throw new Error("An FM-1 upload is already running.");
  const requirements = bytes ? inspectFm1Package(bytes) : null;
  const browserError = fm1BrowserError();
  if (browserError) throw new Error(browserError);
  if (!Number.isInteger(preset) || preset < 1 || preset > 2) throw new Error("Choose preset 1 or 2.");
  uploading = true;
  let commitSent = false;
  const commandNames = ["status check", "start transfer", "patch data", "activate patch", "select preset", "firmware capabilities", "value update", "live edit capabilities"];
  let receivedMessages = 0;
  let receivedSysex = 0;
  let lastReply = "";
  const chromeMajor = Number(navigator.userAgent.match(/Chrome\/(\d+)/)?.[1]);
  const browserHint = /Macintosh|Mac OS X/.test(navigator.userAgent) && chromeMajor === 152 ? " Chrome 152 has a known macOS SysEx bug. Finish updating Chrome and fully relaunch it to run version 153 or newer." : "";
  const timeoutError = (command, requestToken) => new Fm1TimeoutError(
    `FM-1 timed out during ${commandNames[command] ?? `command ${command}`} (token ${requestToken}). Received ${receivedMessages} MIDI messages, including ${receivedSysex} SysEx replies. ` + (lastReply ? `Last SysEx: ${lastReply}. ` : "") + `Input: ${input?.state}/${input?.connection}; output: ${output?.state}/${output?.connection}; SysEx enabled: ${access?.sysexEnabled}. Copy this error when reporting the problem.` + browserHint
  );
  let access, input, output;
  let token = crypto.getRandomValues(new Uint8Array(1))[0] % 127;
  let lastReplyAt = -Infinity;
  let waiting = null;
  const settle = (error, data) => {
    const current = waiting;
    if (!current) return;
    waiting = null;
    window.clearTimeout(current.timer);
    if (error) current.reject(error);
    else current.resolve(data);
  };
  const receive = (event) => {
    if (!event.data) return;
    const frame = event.data;
    receivedMessages++;
    if (frame[0] === 240) {
      receivedSysex++;
      lastReply = Array.from(frame.subarray(0, 24), (byte) => byte.toString(16).padStart(2, "0")).join(" ") + (frame.length > 24 ? ` \u2026 (${frame.length} bytes)` : "");
    }
    if (!waiting) return;
    if (frame.length !== 13 && frame.length !== 14 || frame[0] !== 240 || frame[frame.length - 1] !== 247) return;
    if (!prefix.every((v, i) => frame[i + 1] === v) || frame[5] !== (waiting.command | 64) || frame[6] !== waiting.token) return;
    lastReplyAt = performance.now();
    if (frame[7]) settle(new Error(waiting.command === 5 ? "Update the FM-1 to firmware FM-1_904 or newer before uploading." : errors[frame[7]] ?? `Device error ${frame[7]}.`));
    else settle(void 0, frame);
  };
  const disconnect = () => {
    if (input?.state === "disconnected" || output?.state === "disconnected") settle(new Error("FM-1 disconnected. Reconnect it before uploading again."));
  };
  const abort = () => settle(new Error("Upload cancelled."));
  const requestOnce = async (command, body) => {
    const pause = 10 - (performance.now() - lastReplyAt);
    if (pause > 0) await new Promise((resolve) => window.setTimeout(resolve, pause));
    if (signal.aborted) return Promise.reject(new Error("Upload cancelled."));
    if (!input || !output || input.state !== "connected" || output.state !== "connected") return Promise.reject(new Error("FM-1 is not connected."));
    token = token % 127 + 1;
    return new Promise((resolve, reject) => {
      waiting = { command, token, resolve, reject, timer: window.setTimeout(() => settle(timeoutError(command, token)), 3e3) };
      try {
        output.send([240, ...prefix, command, token, ...pack7(body), 247]);
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
  const request = async (command, body = new Uint8Array()) => {
    try {
      return await requestOnce(command, body);
    } catch (error) {
      if (!(error instanceof Fm1TimeoutError) || signal.aborted || ![0, 5, fm1Capabilities.protocol.liveEdit.probeCommand].includes(command)) throw error;
      return requestOnce(command, body);
    }
  };
  try {
    progress(0, "Allow MIDI SysEx access when your browser asks.");
    access = await navigator.requestMIDIAccess({ sysex: true });
    if (signal.aborted) throw new Error("Upload cancelled.");
    if (!access.sysexEnabled) throw new Error("MIDI SysEx permission is required to upload patches.");
    const matches = (port) => port.state === "connected" && port.name === "Teia FM-1 spike";
    const inputs2 = [...access.inputs.values()].filter(matches);
    const outputs = [...access.outputs.values()].filter(matches);
    if (inputs2.length !== 1 || outputs.length !== 1) throw new Error(inputs2.length > 1 || outputs.length > 1 ? "More than one Teia FM-1 is connected. Connect just the device you want to upload to." : "Teia FM-1 not found. Connect it with a USB data cable and install firmware FM-1_904 or newer.");
    [input] = inputs2;
    [output] = outputs;
    input.addEventListener("midimessage", receive);
    access.addEventListener("statechange", disconnect);
    signal.addEventListener("abort", abort);
    await input.open();
    await output.open();
    if (!updates) await new Promise((resolve) => window.setTimeout(resolve, 300));
    progress(0, "Checking the FM-1 connection\u2026");
    const status = await request(0);
    progress(0, "Checking firmware capabilities\u2026");
    const capability = await request(5);
    if (capability.length !== 14 || capability[12] < (requirements?.version ?? fm1Limits.packageVersion)) throw new Error("This patch needs newer firmware (current exports require FM-1_919 or newer).");
    if (live) {
      try {
        await request(fm1Capabilities.protocol.liveEdit.probeCommand);
      } catch {
        throw new Error(`Live Edit requires FM-1_${fm1Capabilities.protocol.liveEdit.since} or newer. Install the updated firmware.`);
      }
    }
    if (updates && bytes) {
      for (let offset = 0; offset < updates.length; offset += fm1Capabilities.protocol.liveEdit.maxUpdates) {
        const batch = updates.slice(offset, offset + fm1Capabilities.protocol.liveEdit.maxUpdates);
        const body = new Uint8Array(6 + batch.length * 5), view = new DataView(body.buffer);
        body[0] = preset - 1;
        view.setUint32(1, crc32(bytes), true);
        body[5] = batch.length;
        batch.forEach((update, index) => {
          body[6 + index * 5] = update.index;
          view.setInt32(7 + index * 5, update.value, true);
        });
        await request(fm1Capabilities.protocol.liveEdit.updateCommand, body);
      }
      return;
    }
    if (!bytes) {
      const loaded = [1, 2].filter((slot) => status[11] & 1 << slot - 1);
      progress(100, `FM-1 connected. Active preset: ${status[10] + 1}; loaded presets: ${loaded.join(", ") || "none"}. Package version: ${capability[12]}.`);
      return;
    }
    const begin = new Uint8Array(7), beginView = new DataView(begin.buffer);
    begin[0] = preset - 1;
    beginView.setUint16(1, bytes.length, true);
    beginView.setUint32(3, crc32(bytes), true);
    progress(0, `Starting transfer to preset ${preset} (requires FM-1_${requirements.requiredFirmware})\u2026`);
    await request(1, begin);
    for (let offset = 0; offset < bytes.length; offset += 96) {
      const chunk = bytes.subarray(offset, offset + 96), body = new Uint8Array(chunk.length + 2);
      new DataView(body.buffer).setUint16(0, offset, true);
      body.set(chunk, 2);
      let reply2;
      try {
        reply2 = await request(2, body);
      } catch (error) {
        if (!(error instanceof Fm1TimeoutError) || signal.aborted) throw error;
        progress(Math.min(99, Math.round(offset * 100 / bytes.length)), "Checking interrupted transfer\u2026");
        const status2 = await request(0);
        const received = status2[8] | status2[9] << 7;
        if (received === offset + chunk.length) reply2 = status2;
        else if (received === offset) reply2 = await request(2, body);
        else throw new Error("Unexpected transfer offset while recovering. Upload stopped; try again.");
      }
      if ((reply2[8] | reply2[9] << 7) !== offset + chunk.length) throw new Error("Unexpected transfer offset. Upload stopped; try again.");
      progress(Math.min(99, Math.round((offset + chunk.length) * 100 / bytes.length)), `Uploading to preset ${preset}\u2026`);
    }
    progress(99, "Validating and activating the patch\u2026");
    commitSent = true;
    const reply = await request(3);
    if (reply[10] !== preset - 1 || !(reply[11] & 1 << preset - 1)) throw new Error("The device did not confirm the selected preset.");
    commitSent = false;
    progress(100, `Uploaded to preset ${preset} and activated.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(commitSent ? `${message} The patch may already be active; check the device before uploading again.` : message);
  } finally {
    input?.removeEventListener("midimessage", receive);
    access?.removeEventListener("statechange", disconnect);
    signal.removeEventListener("abort", abort);
    settle(new Error("Upload ended."));
    uploading = false;
  }
}

// editor/src/audio/useFm1LiveEdit.ts
function valueChanges(previous, next) {
  if (previous.length !== next.length) return null;
  const view = new DataView(next.buffer, next.byteOffset, next.byteLength);
  const old = new DataView(previous.buffer, previous.byteOffset, previous.byteLength);
  const count = view.getUint16(10, true), start = next.length - count * 4;
  for (let i = 0; i < start; i++) if (previous[i] !== next[i]) return null;
  const changes = [];
  for (let index = 0; index < count; index++) {
    const value = view.getInt32(start + index * 4, true);
    if (value !== old.getInt32(start + index * 4, true)) changes.push({ index, value });
  }
  return changes;
}
function useFm1LiveEdit(patch, enabled, preset, stop) {
  const latest = useRef2(patch);
  latest.current = patch;
  const stopRef = useRef2(stop);
  stopRef.current = stop;
  const [message, setMessage] = useState2("");
  const [busy, setBusy] = useState2(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer;
    let processed = null;
    let previous = null;
    let identity = null;
    const tick = async () => {
      if (controller.signal.aborted) return;
      const current = latest.current;
      if (current !== processed) {
        processed = current;
        const analysis = analyzeFm1Patch(current, true);
        if (!analysis.compiled) {
          setMessage(`Not sent: ${analysis.errors.join(" ")}`);
        } else {
          const next = analysis.compiled.bytes;
          const changes = previous ? valueChanges(previous, next) : null;
          if (changes === null || changes.length > 0) {
            setBusy(true);
            try {
              if (changes && identity) {
                setMessage("Sending values\u2026");
                await updateFm1Values(identity, preset, changes, controller.signal);
              } else {
                await uploadFm1Patch(next, preset, (_, status) => {
                  if (!controller.signal.aborted) setMessage(status);
                }, controller.signal, true);
                identity = next;
              }
              previous = next;
              if (!controller.signal.aborted) setMessage("");
            } catch (error) {
              if (!controller.signal.aborted) {
                setMessage(error instanceof Error ? error.message : String(error));
                stopRef.current();
              }
              return;
            } finally {
              if (controller.signal.aborted) setMessage("");
              setBusy(false);
            }
          } else setMessage("");
        }
      }
      timer = window.setTimeout(() => void tick(), 120);
    };
    void tick();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [enabled, preset]);
  return { message, busy };
}

// editor/src/editor/Fm1UploadDialog.tsx
import { useEffect as useEffect2, useMemo as useMemo2, useRef as useRef3, useState as useState3 } from "react";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function Fm1UploadDialog({ patch, onClose }) {
  const dialog = useRef3(null);
  const presetInput = useRef3(null);
  const controller = useRef3(null);
  const analysis = useMemo2(() => analyzeFm1Patch(patch), [patch]);
  const warnings = useMemo2(() => getFm1SupportWarnings(patch), [patch]);
  const [preset, setPreset] = useState3("1");
  const [busy, setBusy] = useState3(false);
  const [checking, setChecking] = useState3(false);
  const [progress, setProgress] = useState3(0);
  const [message, setMessage] = useState3("");
  const [error, setError] = useState3("");
  const browserError = fm1BrowserError();
  const number = Number(preset);
  const validPreset = preset.trim() !== "" && Number.isInteger(number) && number >= 1 && number <= 2;
  useEffect2(() => {
    dialog.current?.showModal();
    presetInput.current?.focus();
    return () => {
      controller.current?.abort();
    };
  }, []);
  const rows = [
    ["Compiled operations", analysis.usage?.operations, fm1Limits.operations],
    ["Registers", analysis.usage?.registers, fm1Limits.registers],
    ["Parameter / constant values", analysis.usage?.values, fm1Limits.values],
    ["DSP state entries", analysis.usage?.states, fm1Limits.states],
    ["Package size (bytes)", analysis.usage?.bytes, fm1MaximumBytes]
  ];
  const upload = async (checkOnly = false) => {
    if (controller.current || !checkOnly && (!analysis.compiled || !validPreset)) return;
    const active = new AbortController();
    controller.current = active;
    setChecking(checkOnly);
    setBusy(true);
    setError("");
    setMessage("");
    setProgress(0);
    try {
      const report = (percent, status) => {
        if (!active.signal.aborted) {
          setProgress(percent);
          setMessage(status);
        }
      };
      if (checkOnly) await checkFm1Connection(report, active.signal);
      else await uploadFm1Patch(analysis.compiled.bytes, number, report, active.signal);
    } catch (failure) {
      if (!active.signal.aborted) {
        setError(failure instanceof Error ? failure.message : String(failure));
        setMessage("");
      }
    } finally {
      controller.current = null;
      if (!active.signal.aborted) setBusy(false);
    }
  };
  return /* @__PURE__ */ jsxs2(
    "dialog",
    {
      ref: dialog,
      className: "import-modal fm1-modal",
      "aria-labelledby": "fm1-title",
      onCancel: (event) => {
        event.preventDefault();
        if (!busy) onClose();
      },
      onKeyDown: (event) => event.stopPropagation(),
      onClick: (event) => {
        if (!busy && event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
        }
      },
      children: [
        /* @__PURE__ */ jsxs2("header", { className: "import-modal-header", children: [
          /* @__PURE__ */ jsxs2("div", { children: [
            /* @__PURE__ */ jsx2("h2", { id: "fm1-title", children: "Upload to FM-1" }),
            /* @__PURE__ */ jsx2("p", { children: patch.name || "untitled" })
          ] }),
          /* @__PURE__ */ jsx2("button", { type: "button", className: "import-modal-close", onClick: onClose, disabled: busy, "aria-label": "Close FM-1 upload", children: "X" })
        ] }),
        /* @__PURE__ */ jsxs2("div", { className: "fm1-modal-body", children: [
          warnings.length > 0 && /* @__PURE__ */ jsxs2("section", { className: "fm1-warnings", "aria-labelledby": "fm1-warnings-title", children: [
            /* @__PURE__ */ jsx2("h3", { id: "fm1-warnings-title", children: "FM-1 compatibility warnings" }),
            /* @__PURE__ */ jsxs2("p", { className: "fm1-note", children: [
              "Based on ",
              fm1SupportFirmware2,
              " support. All enabled nodes are checked, including unused nodes and group contents. Unsupported or unreviewed nodes block upload; partial support is checked against the available operations and ports. Disable or remove unavailable nodes to continue."
            ] }),
            /* @__PURE__ */ jsx2("ul", { children: warnings.map((warning) => /* @__PURE__ */ jsxs2("li", { children: [
              /* @__PURE__ */ jsxs2("strong", { children: [
                warning.feature,
                " \u2014 ",
                warning.status === "unsupported" ? "Not supported yet" : warning.status === "partial" ? "Partial support" : "Support not verified"
              ] }),
              /* @__PURE__ */ jsx2("p", { children: warning.notes }),
              /* @__PURE__ */ jsxs2("p", { className: "fm1-note", children: [
                "Nodes: ",
                warning.nodes.join("; ")
              ] })
            ] }, warning.feature)) })
          ] }),
          /* @__PURE__ */ jsx2("dl", { className: "fm1-usage", "aria-label": "FM-1 patch limits", children: rows.map(([label, used, maximum]) => /* @__PURE__ */ jsxs2("div", { className: used !== void 0 && used > maximum ? "fm1-over-limit" : "", children: [
            /* @__PURE__ */ jsx2("dt", { children: label }),
            /* @__PURE__ */ jsxs2("dd", { children: [
              used ?? "\u2014",
              " / ",
              maximum
            ] }),
            /* @__PURE__ */ jsx2("progress", { max: maximum, value: used ?? 0, "aria-label": label })
          ] }, label)) }),
          /* @__PURE__ */ jsx2("p", { className: "fm1-note", children: "These are memory limits. Check render time and late buffers on the device for audio performance." }),
          analysis.errors.length > 0 && /* @__PURE__ */ jsxs2("div", { className: "fm1-errors", role: "alert", children: [
            /* @__PURE__ */ jsx2("strong", { children: "Patch cannot be uploaded" }),
            /* @__PURE__ */ jsx2("ul", { children: analysis.errors.map((item, i) => /* @__PURE__ */ jsx2("li", { children: item }, i)) })
          ] }),
          browserError && /* @__PURE__ */ jsx2("p", { className: "fm1-errors", role: "alert", children: browserError }),
          /* @__PURE__ */ jsxs2("label", { className: "fm1-preset", htmlFor: "fm1-preset", children: [
            "Preset number",
            /* @__PURE__ */ jsx2(
              "input",
              {
                ref: presetInput,
                id: "fm1-preset",
                type: "number",
                min: "1",
                max: "2",
                step: "1",
                value: preset,
                disabled: busy,
                "aria-invalid": !validPreset,
                "aria-describedby": "fm1-preset-help",
                onChange: (event) => {
                  setPreset(event.target.value);
                  setError("");
                  setMessage("");
                }
              }
            )
          ] }),
          /* @__PURE__ */ jsx2("p", { id: "fm1-preset-help", className: "fm1-note", children: "Choose 1 or 2. Upload replaces that preset and selects it. Patches are cleared when the FM-1 powers off." }),
          !validPreset && /* @__PURE__ */ jsx2("p", { className: "fm1-errors", children: "Enter preset 1 or 2." }),
          /* @__PURE__ */ jsxs2("p", { className: "fm1-note", children: [
            "Connect the Teia FM-1 by USB. The support rules target ",
            fm1SupportFirmware2,
            ". Older builds may lack required operations even when their package format is compatible. Allow MIDI SysEx access when prompted."
          ] }),
          busy && /* @__PURE__ */ jsx2("progress", { className: "fm1-transfer-progress", value: progress, max: 100, "aria-label": "Patch upload progress" }),
          /* @__PURE__ */ jsx2("div", { "aria-live": "polite", "aria-atomic": "true", children: message && /* @__PURE__ */ jsx2("p", { children: message }) }),
          error && /* @__PURE__ */ jsx2("p", { className: "fm1-errors", role: "alert", children: error })
        ] }),
        /* @__PURE__ */ jsxs2("footer", { className: "import-modal-actions", children: [
          /* @__PURE__ */ jsx2("button", { type: "button", onClick: onClose, disabled: busy, children: "Close" }),
          /* @__PURE__ */ jsx2("button", { type: "button", onClick: () => void upload(true), disabled: busy || Boolean(browserError), children: busy && checking ? "Checking\u2026" : "Check connection" }),
          /* @__PURE__ */ jsx2("button", { type: "button", onClick: () => void upload(), disabled: busy || !analysis.compiled || !validPreset || Boolean(browserError), children: busy && !checking ? `Uploading ${progress}%` : "Upload" })
        ] })
      ]
    }
  );
}

// editor/src/audio/useAudioEngine.ts
import { useCallback as useCallback2, useEffect as useEffect3, useMemo as useMemo3, useRef as useRef4, useState as useState4 } from "react";

// editor/src/audio/config.ts
var AUDIO_ENGINE_CONFIG = {
  // Changing an env file requires restarting Vite (or rebuilding production).
  // The matching settings below can also be edited directly for local work.
  rendering: {
    mode: define_import_meta_env_default.VITE_TEIA_DSP_MODE === "multi" ? "multi" : "single",
    workers: Math.max(1, Math.min(
      4,
      Math.trunc(Number(define_import_meta_env_default.VITE_TEIA_DSP_WORKERS) || 2)
    ))
  },
  graphUpdateCrossfade: {
    enabled: true,
    seconds: 0.02
  }
};

// hosted:assets
var AUDIO_WASM_ASSET_VERSION = "host-owned";
var AUDIO_SIMD_WASM_ASSET_VERSION = "host-owned";
var AUDIO_WORKLET_ASSET_VERSION = "host-owned";
var AUDIO_PARALLEL_WASM_ASSET_VERSION = "host-owned";
var AUDIO_PARALLEL_WORKER_ASSET_VERSION = "host-owned";

// editor/src/audio/parallelEngine.ts
async function createParallelEngine(count, signal, onFailure) {
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
    throw new Error("Multi mode requires cross-origin isolation and shared memory.");
  }
  const workers = [];
  const pending = /* @__PURE__ */ new Set();
  const dispose = () => {
    for (const worker of workers) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    for (const cancel of [...pending]) cancel();
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    const response = await fetch(`/audio/teia-kernel-parallel.wasm?v=${AUDIO_PARALLEL_WASM_ASSET_VERSION}`, { signal });
    if (!response.ok) throw new Error(`Could not load parallel WASM kernel (${response.status}).`);
    const module = await WebAssembly.compile(await response.arrayBuffer());
    const memory = new WebAssembly.Memory({ initial: 512, maximum: 32768, shared: true });
    const instance = await WebAssembly.instantiate(module, {
      env: { memory },
      parallel: { now: () => performance.now(), wake: () => {
      } }
    });
    const tlsSize = instance.exports.__tls_size;
    const tlsAlign = instance.exports.__tls_align;
    if (Number(tlsSize.value) > 65536 || Number(tlsAlign.value) > 65536) {
      throw new Error("Parallel WASM thread-local storage exceeds its reserved space.");
    }
    const tlsPointer = instance.exports.dspParallelTlsPtr;
    instance.exports.__wasm_init_tls(tlsPointer(0));
    const stackTop = instance.exports.dspParallelStackTop;
    const controlPointer = instance.exports.dspParallelControlPtr;
    await Promise.all(Array.from({ length: count }, (_, index) => new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const worker = new Worker(`/audio/dsp-parallel-worker.js?v=${AUDIO_PARALLEL_WORKER_ASSET_VERSION}`);
      workers.push(worker);
      let ready = false;
      const abort = () => fail("Parallel engine startup was cancelled.");
      const timeout = window.setTimeout(() => fail("Parallel audio worker startup timed out."), 1e4);
      const cleanup = () => {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        pending.delete(abort);
      };
      const fail = (message) => {
        cleanup();
        if (ready) onFailure(message);
        else reject(new Error(message));
      };
      pending.add(abort);
      signal.addEventListener("abort", abort, { once: true });
      worker.onerror = (event) => fail(event.message || "Parallel audio worker failed.");
      worker.onmessageerror = () => fail("Parallel audio worker could not receive its shared memory.");
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") {
          ready = true;
          cleanup();
          resolve();
        } else if (data.type === "error") fail(data.message || "Parallel audio worker failed.");
      };
      worker.postMessage({ module, memory, worker: index, stackTop: stackTop(index), controlPointer: controlPointer(index) });
    })));
    signal.throwIfAborted();
    return { processorOptions: { module, memory, workers: count }, dispose };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    signal.removeEventListener("abort", dispose);
  }
}

// editor/src/diagnostics.ts
var DIAGNOSTIC_ENDPOINT = "/api/diagnostics";
var PERFORMANCE_TIMELINE_MAINTENANCE_INTERVAL_MS = 1e3;
var PERFORMANCE_TIMELINE_ENTRY_LIMIT = 1e3;
var SESSION_STORAGE_KEY = "teia-editor.diagnostics-session";
var sessionId;
var lastPerformanceTimelineMaintenanceAt = 0;
function logDiagnosticEvent(event, options = {}) {
  const now = performance.now();
  if (now - lastPerformanceTimelineMaintenanceAt >= PERFORMANCE_TIMELINE_MAINTENANCE_INTERVAL_MS) {
    lastPerformanceTimelineMaintenanceAt = now;
    maintainPerformanceTimeline();
  }
  const payload = {
    sessionId: sessionId ??= getSessionId(),
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    performanceNowMs: Math.round(now),
    level: options.level ?? "info",
    event,
    url: window.location.href,
    visibilityState: document.visibilityState,
    details: sanitizeDetails({
      ...options.details,
      memory: options.details?.memory ?? memorySnapshot()
    })
  };
  const body = JSON.stringify(payload);
  if (options.flush && navigator.sendBeacon) {
    navigator.sendBeacon(DIAGNOSTIC_ENDPOINT, new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch(DIAGNOSTIC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: options.flush
  }).catch(() => void 0);
}
function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  if (typeof error === "object" && error !== null) {
    return sanitizeDetails(error);
  }
  return { value: String(error) };
}
function getSessionId() {
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}
function sanitizeDetails(details) {
  const json = JSON.stringify(details, (_key, value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
    if (typeof value === "bigint") return String(value);
    if (typeof value === "function" || typeof value === "symbol") return void 0;
    return value;
  });
  return JSON.parse(json);
}
function memorySnapshot() {
  const performanceWithMemory = performance;
  const memory = performanceWithMemory.memory;
  if (!memory) return null;
  return {
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
    totalJSHeapSize: memory.totalJSHeapSize,
    usedJSHeapSize: memory.usedJSHeapSize
  };
}
function maintainPerformanceTimeline() {
  const snapshot = performanceTimelineSnapshot(false);
  const shouldClear = snapshot.measures > PERFORMANCE_TIMELINE_ENTRY_LIMIT || snapshot.marks > PERFORMANCE_TIMELINE_ENTRY_LIMIT;
  if (shouldClear) {
    performance.clearMeasures();
    performance.clearMarks();
  }
  return { ...snapshot, cleared: shouldClear };
}
function performanceTimelineSnapshot(cleared) {
  return {
    measures: performance.getEntriesByType("measure").length,
    marks: performance.getEntriesByType("mark").length,
    resources: performance.getEntriesByType("resource").length,
    cleared
  };
}

// editor/src/audio/useAudioEngine.ts
var MIDI_CLOCK_TICKS_PER_BEAT = 24;
var MIDI_CLOCK_TEMPO_MIN = 1;
var MIDI_CLOCK_TEMPO_MAX = 999;
var MIDI_CLOCK_EMA_WEIGHT = 0.18;
var WORKLET_URL = `/audio/audio-worklet-wasm.js?v=${AUDIO_WORKLET_ASSET_VERSION}`;
var WASM_URL = `/audio/teia-kernel.wasm?v=${AUDIO_WASM_ASSET_VERSION}`;
var SIMD_WASM_URL = `/audio/teia-kernel-simd.wasm?v=${AUDIO_SIMD_WASM_ASSET_VERSION}`;
async function loadCompatibleWasmBytes(preferSimd) {
  if (preferSimd) {
    try {
      const response2 = await fetch(SIMD_WASM_URL, { cache: "no-store" });
      if (response2.ok) {
        const bytes = await response2.arrayBuffer();
        if (WebAssembly.validate(bytes)) return bytes;
      }
    } catch {
    }
  }
  const response = await fetch(WASM_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load WASM kernel (${response.status}).`);
  return response.arrayBuffer();
}
var METER_UPDATE_INTERVAL_MS = 80;
var RECORDING_CHUNK_FRAMES = 16384;
var RECORDING_CHANNEL_COUNT = 2;
var SCOPE_DISPLAY_POINTS = 160;
var SCOPE_CAPTURE_POINTS = SCOPE_DISPLAY_POINTS;
var SCOPE_MODE = "continuous";
var AUDIO_OUTPUT_FADE_SECONDS = 0.02;
var AUDIO_OUTPUT_STOP_DELAY_MS = Math.ceil(AUDIO_OUTPUT_FADE_SECONDS * 1e3) + 24;
var AUDIO_SILENCE_PEAK_THRESHOLD = 1e-5;
var AUDIO_UNEXPECTED_SILENCE_MS = 5e3;
var AUDIO_SILENCE_REPORT_INTERVAL_MS = 15e3;
var AUDIO_HEALTH_REPORT_INTERVAL_MS = 5e3;
async function closeAudioContext(contextRef, nodeRef, analyserRef, outputGainRef, inputSourceRef, inputStreamRef, stopTimeoutRef, generation = 0, reason = "unknown") {
  if (stopTimeoutRef && stopTimeoutRef.current !== null) {
    window.clearTimeout(stopTimeoutRef.current);
    stopTimeoutRef.current = null;
  }
  const context = contextRef.current;
  const node = nodeRef.current;
  const analyser = analyserRef.current;
  const outputGain = outputGainRef.current;
  const inputSource = inputSourceRef.current;
  const inputStream = inputStreamRef.current;
  logDiagnosticEvent("audio-context-close-requested", {
    details: {
      generation,
      reason,
      state: context?.state ?? "none"
    }
  });
  node?.port.postMessage({ type: "panic" });
  inputSource?.disconnect();
  inputStream?.getTracks().forEach((track) => track.stop());
  if (node) {
    node.port.onmessage = null;
    node.port.close();
  }
  if (context) {
    context.onstatechange = null;
  }
  node?.disconnect();
  analyser?.disconnect();
  outputGain?.disconnect();
  if (inputSourceRef.current === inputSource) inputSourceRef.current = null;
  if (inputStreamRef.current === inputStream) inputStreamRef.current = null;
  if (nodeRef.current === node) nodeRef.current = null;
  if (analyserRef.current === analyser) analyserRef.current = null;
  if (outputGainRef.current === outputGain) outputGainRef.current = null;
  if (contextRef.current === context) contextRef.current = null;
  try {
    if (context && context.state !== "closed") await context.close();
    logDiagnosticEvent("audio-context-close-completed", {
      details: { generation, reason, state: context?.state ?? "none" }
    });
  } catch (error) {
    logDiagnosticEvent("audio-context-close-error", {
      level: "error",
      details: { generation, reason, error: serializeError(error) }
    });
  }
}
function parkAudioContext(contextRef, nodeRef, outputGainRef, inputSourceRef, inputStreamRef, stopTimeoutRef) {
  stopTimeoutRef.current = null;
  nodeRef.current?.port.postMessage({ type: "setMuted", payload: { muted: true } });
  inputSourceRef.current?.disconnect();
  inputStreamRef.current?.getTracks().forEach((track) => track.stop());
  outputGainRef.current?.gain.cancelScheduledValues(0);
  if (outputGainRef.current) {
    outputGainRef.current.gain.value = 0;
  }
  inputSourceRef.current = null;
  inputStreamRef.current = null;
  const context = contextRef.current;
  if (context && context.state !== "closed") {
    void context.suspend().catch((error) => {
      logDiagnosticEvent("audio-context-suspend-error", {
        level: "error",
        details: { error: serializeError(error) }
      });
    });
  }
}
function fadeAudioOutputIn(context, gain) {
  const now = context.currentTime;
  holdAudioParamAtCurrentValue(gain.gain, now);
  gain.gain.linearRampToValueAtTime(1, now + AUDIO_OUTPUT_FADE_SECONDS);
}
function fadeAudioOutputOut(context, gain) {
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(1, now);
  gain.gain.linearRampToValueAtTime(0, now + AUDIO_OUTPUT_FADE_SECONDS);
}
function holdAudioParamAtCurrentValue(param, time) {
  const holdableParam = param;
  if (typeof holdableParam.cancelAndHoldAtTime === "function") {
    holdableParam.cancelAndHoldAtTime(time);
    return;
  }
  param.cancelScheduledValues(time);
  param.setValueAtTime(param.value, time);
}
function useAudioEngine(options = {}) {
  const selectedMidiInputDeviceIds = options.selectedMidiInputDeviceIds ?? [];
  const selectedMidiOutputDeviceIds = options.selectedMidiOutputDeviceIds ?? [];
  const midiClockOutputEnabled = options.midiClockOutputEnabled === true;
  const recordingPatchNameRef = useRef4(options.recordingPatchName ?? "untitled-patch");
  recordingPatchNameRef.current = options.recordingPatchName ?? "untitled-patch";
  const selectedMidiInputDeviceKey = selectedMidiInputDeviceIds.join("\n");
  const selectedMidiInputDeviceIdSet = useMemo3(() => new Set(selectedMidiInputDeviceIds), [selectedMidiInputDeviceKey]);
  const selectedMidiOutputDeviceKey = selectedMidiOutputDeviceIds.join("\n");
  const selectedMidiOutputDeviceIdSet = useMemo3(() => new Set(selectedMidiOutputDeviceIds), [selectedMidiOutputDeviceKey]);
  const midiInputEnabled = selectedMidiInputDeviceIds.length > 0;
  const [status, setStatus] = useState4("idle");
  const [message, setMessage] = useState4("audio stopped");
  const [cpuLoad, setCpuLoad] = useState4(0);
  const [cpuPeakLoad, setCpuPeakLoad] = useState4(0);
  const [cpuDeadlineMisses, setCpuDeadlineMisses] = useState4(0);
  const [rendering, setRendering] = useState4({ mode: "single", workers: 0, parallelRepeats: 0, reason: "" });
  const [peak, setPeak] = useState4(0);
  const [linkMeters, setLinkMeters] = useState4({});
  const [linkScopes, setLinkScopeReadings] = useState4({});
  const [playheads, setPlayheads] = useState4({});
  const [buffers, setBuffers] = useState4({});
  const [recordingStatus, setRecordingStatus] = useState4("idle");
  const [recordingMessage, setRecordingMessage] = useState4("recording stopped");
  const [recordingFileName, setRecordingFileName] = useState4(null);
  const [recordingElapsedSeconds, setRecordingElapsedSeconds] = useState4(0);
  const [audioInputStatus, setAudioInputStatus] = useState4("inactive");
  const [audioInputMessage, setAudioInputMessage] = useState4("Add an AudioInput node, then start audio.");
  const [audioInputDevices, setAudioInputDevices] = useState4([]);
  const [selectedAudioInputDeviceId, setSelectedAudioInputDeviceId] = useState4("");
  const [midiInputStatus, setMidiInputStatus] = useState4("inactive");
  const [midiInputMessage, setMidiInputMessage] = useState4("Add a MIDI Note, MIDI CC, or MIDI Tempo source, then start audio.");
  const [midiInputDevices, setMidiInputDevices] = useState4([]);
  const [midiOutputDevices, setMidiOutputDevices] = useState4([]);
  const [lastMidiControlChange, setLastMidiControlChange] = useState4(void 0);
  const contextRef = useRef4(null);
  const nodeRef = useRef4(null);
  const parallelEngineRef = useRef4(null);
  const parallelEngineAbortRef = useRef4(null);
  const analyserRef = useRef4(null);
  const outputGainRef = useRef4(null);
  const inputSourceRef = useRef4(null);
  const inputStreamRef = useRef4(null);
  const stopTimeoutRef = useRef4(null);
  const inputRequestIdRef = useRef4(0);
  const inputRequestRef = useRef4(null);
  const currentInputDeviceIdRef = useRef4("");
  const midiAccessRef = useRef4(null);
  const midiRequestRef = useRef4(null);
  const midiAccessRequestedRef = useRef4(false);
  const midiClockOutputEnabledRef = useRef4(midiClockOutputEnabled);
  midiClockOutputEnabledRef.current = midiClockOutputEnabled;
  const midiClockTickMsBySourceRef = useRef4({});
  const midiClockTempoBySourceRef = useRef4({});
  const midiClockOutputTimerRef = useRef4(null);
  const midiClockOutputRunningRef = useRef4(false);
  const midiControlChangeIdRef = useRef4(0);
  const meterFrameRef = useRef4(null);
  const lastAudibleAtRef = useRef4(0);
  const lastSilenceReportAtRef = useRef4(0);
  const lastAudioHealthReportAtRef = useRef4(0);
  const graphRef = useRef4(null);
  const audioEngineRequestRef = useRef4(null);
  const audioEngineCloseRef = useRef4(null);
  const audioEngineGenerationRef = useRef4(0);
  const audioActivationRequestedRef = useRef4(false);
  const backendReadyRef = useRef4(false);
  const lastSentProgramStructureRef = useRef4(null);
  const lastSentValuesRef = useRef4(null);
  const lastSentCustomWavePointsRef = useRef4(null);
  const lastSentSequencerConfigRef = useRef4(null);
  const activeScopeRequestsRef = useRef4([]);
  const sampleDataKeysRef = useRef4({});
  const sampleDataCacheRef = useRef4({});
  const sampleDataRequestRef = useRef4({});
  const imageDataKeysRef = useRef4({});
  const imageDataCacheRef = useRef4({});
  const imageDataRequestRef = useRef4({});
  const imageDataWorkletRef = useRef4(null);
  const recordingRequestedRef = useRef4(false);
  const recordingCaptureRef = useRef4(null);
  const recordingSessionIdRef = useRef4(0);
  const recordingSaveIdRef = useRef4(0);
  const bufferSnapshotRequestIdRef = useRef4(0);
  const bufferSnapshotRequestsRef = useRef4(/* @__PURE__ */ new Map());
  const bufferRestoresRef = useRef4({});
  const pendingBufferClearsRef = useRef4(/* @__PURE__ */ new Set());
  const pendingBufferCopiesRef = useRef4(/* @__PURE__ */ new Map());
  const recordingStartedAtRef = useRef4(0);
  const recordingTimerRef = useRef4(null);
  const stopMeter = useCallback2(() => {
    if (meterFrameRef.current !== null) {
      window.cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    lastAudibleAtRef.current = 0;
    lastSilenceReportAtRef.current = 0;
    lastAudioHealthReportAtRef.current = 0;
    setPeak(0);
    setCpuLoad(0);
  }, []);
  const sendMidiAllNotesOff = useCallback2(() => {
    for (const [index, output] of [...midiAccessRef.current?.outputs.values() ?? []].entries()) {
      if (!selectedMidiOutputDeviceIdSet.has(midiDeviceFromPort(output, index, "output").id)) continue;
      if (output.state === "disconnected") continue;
      try {
        for (let channel = 0; channel < 16; channel += 1) {
          output.send([176 | channel, 123, 0]);
        }
      } catch {
      }
    }
  }, [selectedMidiOutputDeviceIdSet, selectedMidiOutputDeviceKey]);
  const closeAudioEngine = useCallback2((reason) => {
    if (audioEngineCloseRef.current) return audioEngineCloseRef.current;
    backendReadyRef.current = false;
    parallelEngineAbortRef.current?.abort();
    parallelEngineAbortRef.current = null;
    const closingParallelEngine = parallelEngineRef.current;
    parallelEngineRef.current = null;
    lastSentProgramStructureRef.current = null;
    lastSentValuesRef.current = null;
    lastSentCustomWavePointsRef.current = null;
    lastSentSequencerConfigRef.current = null;
    sendMidiAllNotesOff();
    const closePromise = closeAudioContext(
      contextRef,
      nodeRef,
      analyserRef,
      outputGainRef,
      inputSourceRef,
      inputStreamRef,
      stopTimeoutRef,
      audioEngineGenerationRef.current,
      reason
    );
    audioEngineCloseRef.current = closePromise;
    void closePromise.finally(() => {
      closingParallelEngine?.dispose();
      if (audioEngineCloseRef.current === closePromise) {
        audioEngineCloseRef.current = null;
      }
    });
    return closePromise;
  }, [sendMidiAllNotesOff]);
  const startMeter = useCallback2(() => {
    stopMeter();
    const analyser = analyserRef.current;
    if (!analyser) return;
    const samples = new Float32Array(analyser.fftSize);
    let lastMeterUpdateAt = 0;
    const tick = (timestamp) => {
      analyser.getFloatTimeDomainData(samples);
      let nextPeak = 0;
      for (const sample of samples) {
        nextPeak = Math.max(nextPeak, Math.abs(sample));
      }
      if (contextRef.current?.state === "running" && audioActivationRequestedRef.current && backendReadyRef.current) {
        if (timestamp - lastAudioHealthReportAtRef.current >= AUDIO_HEALTH_REPORT_INTERVAL_MS) {
          lastAudioHealthReportAtRef.current = timestamp;
          logDiagnosticEvent("audio-health", {
            details: {
              generation: audioEngineGenerationRef.current,
              contextState: contextRef.current.state,
              contextTime: contextRef.current.currentTime,
              sampleRate: contextRef.current.sampleRate,
              peak: nextPeak,
              graph: dspProgramDiagnosticSnapshot(graphRef.current)
            }
          });
        }
        if (nextPeak > AUDIO_SILENCE_PEAK_THRESHOLD) {
          lastAudibleAtRef.current = timestamp;
        } else if (lastAudibleAtRef.current > 0 && timestamp - lastAudibleAtRef.current >= AUDIO_UNEXPECTED_SILENCE_MS && timestamp - lastSilenceReportAtRef.current >= AUDIO_SILENCE_REPORT_INTERVAL_MS) {
          lastSilenceReportAtRef.current = timestamp;
          logDiagnosticEvent("audio-output-silent-after-signal", {
            details: {
              generation: audioEngineGenerationRef.current,
              contextState: contextRef.current.state,
              mutedByUi: !audioActivationRequestedRef.current,
              lastAudibleAgoMs: Math.round(timestamp - lastAudibleAtRef.current),
              peak: nextPeak,
              graph: dspProgramDiagnosticSnapshot(graphRef.current)
            }
          });
        }
      }
      if (timestamp - lastMeterUpdateAt >= METER_UPDATE_INTERVAL_MS) {
        lastMeterUpdateAt = timestamp;
        setPeak(nextPeak);
      }
      meterFrameRef.current = window.requestAnimationFrame(tick);
    };
    meterFrameRef.current = window.requestAnimationFrame(tick);
  }, [stopMeter]);
  const stopRecordingTimer = useCallback2(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    recordingStartedAtRef.current = 0;
  }, []);
  const appendRecordingChunk = useCallback2((payload) => {
    if (!isRecord2(payload)) return;
    const id = Number(payload.id);
    const capture = recordingCaptureRef.current;
    if (!capture || capture.id !== id) return;
    const chunk = recordingChunkFromPayload(payload, capture.channelCount);
    if (!chunk) return;
    capture.chunks.push(chunk);
    capture.frames += chunk[0]?.length ?? 0;
  }, []);
  const completeRecordingCapture = useCallback2((id) => {
    const capture = recordingCaptureRef.current;
    if (!capture || capture.id !== id) return;
    recordingCaptureRef.current = null;
    const saveId = recordingSaveIdRef.current + 1;
    recordingSaveIdRef.current = saveId;
    const wavBlob = encodeWav(capture.chunks, capture.sampleRate, capture.channelCount);
    logDiagnosticEvent("audio-recording-stopped", {
      details: {
        chunks: capture.chunks.length,
        frames: capture.frames,
        sampleRate: capture.sampleRate,
        channelCount: capture.channelCount,
        bytes: wavBlob.size
      }
    });
    setRecordingElapsedSeconds(Math.floor(capture.frames / Math.max(1, capture.sampleRate)));
    setRecordingStatus("saving");
    setRecordingMessage("saving recording");
    void uploadRecording(wavBlob, capture.patchName, capture.sampleEvents).then((result) => {
      if (recordingSaveIdRef.current !== saveId) return;
      setRecordingStatus("saved");
      setRecordingMessage(`saved ${result.name}`);
      setRecordingFileName(result.name);
    }).catch((error) => {
      if (recordingSaveIdRef.current !== saveId) return;
      setRecordingStatus("error");
      setRecordingMessage(error instanceof Error ? error.message : "recording save failed");
    });
  }, []);
  const beginRecordingCapture = useCallback2((context, node) => {
    if (recordingCaptureRef.current || !audioActivationRequestedRef.current || context.state !== "running") return;
    const id = recordingSessionIdRef.current;
    const chunks = [];
    recordingCaptureRef.current = {
      id,
      patchName: recordingPatchNameRef.current,
      chunks,
      channelCount: RECORDING_CHANNEL_COUNT,
      sampleRate: context.sampleRate,
      frames: 0,
      stopping: false,
      sampleEvents: []
    };
    node.port.postMessage({
      type: "startRecording",
      payload: {
        id,
        channelCount: RECORDING_CHANNEL_COUNT,
        chunkFrames: RECORDING_CHUNK_FRAMES
      }
    });
    logDiagnosticEvent("audio-recording-started", {
      details: {
        id,
        sampleRate: context.sampleRate,
        channelCount: RECORDING_CHANNEL_COUNT
      }
    });
    stopRecordingTimer();
    recordingStartedAtRef.current = performance.now();
    setRecordingElapsedSeconds(0);
    recordingTimerRef.current = window.setInterval(() => {
      setRecordingElapsedSeconds(Math.floor((performance.now() - recordingStartedAtRef.current) / 1e3));
    }, 250);
    setRecordingStatus("recording");
    setRecordingMessage("recording audio");
    setRecordingFileName(null);
  }, [stopRecordingTimer]);
  const finishRecordingCapture = useCallback2(() => {
    recordingRequestedRef.current = false;
    stopRecordingTimer();
    const capture = recordingCaptureRef.current;
    if (!capture) {
      setRecordingStatus("idle");
      setRecordingMessage("recording stopped");
      setRecordingElapsedSeconds(0);
      return;
    }
    if (capture.stopping) return;
    capture.stopping = true;
    setRecordingStatus("saving");
    setRecordingMessage("finalizing recording");
    const node = nodeRef.current;
    if (node && contextRef.current?.state !== "closed") {
      node.port.postMessage({ type: "stopRecording", payload: { id: capture.id } });
      return;
    }
    completeRecordingCapture(capture.id);
  }, [completeRecordingCapture, stopRecordingTimer]);
  const startRecording = useCallback2(() => {
    if (recordingCaptureRef.current) {
      setRecordingStatus("saving");
      setRecordingMessage("finalizing recording");
      return;
    }
    recordingSessionIdRef.current += 1;
    recordingSaveIdRef.current += 1;
    recordingRequestedRef.current = true;
    setRecordingFileName(null);
    setRecordingElapsedSeconds(0);
    const context = contextRef.current;
    const node = nodeRef.current;
    if (audioActivationRequestedRef.current && context?.state === "running" && node) {
      beginRecordingCapture(context, node);
      return;
    }
    setRecordingStatus("waiting");
    setRecordingMessage("waiting for audio to start");
  }, [beginRecordingCapture]);
  const stopRecording = useCallback2(() => {
    finishRecordingCapture();
  }, [finishRecordingCapture]);
  const refreshAudioInputDevices = useCallback2(async () => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) {
      setAudioInputDevices((current) => current.length === 0 ? current : []);
      return;
    }
    try {
      const devices = await mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput").map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Input ${index + 1}`
      }));
      setAudioInputDevices(audioInputs);
      setSelectedAudioInputDeviceId((current) => {
        if (!current) return current;
        return audioInputs.some((device) => device.deviceId === current) ? current : "";
      });
    } catch {
      setAudioInputDevices((current) => current.length === 0 ? current : []);
    }
  }, []);
  const disconnectAudioInput = useCallback2((nextStatus = "inactive", nextMessage = "Audio input is not used by this patch.") => {
    inputRequestIdRef.current += 1;
    inputRequestRef.current = null;
    inputSourceRef.current?.disconnect();
    inputStreamRef.current?.getTracks().forEach((track) => track.stop());
    inputSourceRef.current = null;
    inputStreamRef.current = null;
    currentInputDeviceIdRef.current = "";
    setAudioInputStatus(nextStatus);
    setAudioInputMessage(nextMessage);
  }, []);
  const sendMidiClockMessage = useCallback2((message2, force = false) => {
    if (!force && !midiClockOutputEnabledRef.current) return;
    for (const [index, output] of [...midiAccessRef.current?.outputs.values() ?? []].entries()) {
      if (!selectedMidiOutputDeviceIdSet.has(midiDeviceFromPort(output, index, "output").id)) continue;
      if (output.state === "disconnected") continue;
      try {
        output.send([message2]);
      } catch {
      }
    }
  }, [selectedMidiOutputDeviceIdSet, selectedMidiOutputDeviceKey]);
  const sendMidiOutputEvents = useCallback2((events) => {
    if (!Array.isArray(events)) return;
    for (const event of events) {
      const noteOn = event?.noteOn === true;
      const channel = clampMidiInteger(event?.channel, 1, 16);
      if (event?.isCc === true) {
        const cc = clampMidiInteger(event?.cc, 0, 127);
        const value = clampMidiInteger(Number(event?.value) * 127, 0, 127);
        const status3 = 176 | channel - 1;
        for (const [index, output] of [...midiAccessRef.current?.outputs.values() ?? []].entries()) {
          if (!selectedMidiOutputDeviceIdSet.has(midiDeviceFromPort(output, index, "output").id)) continue;
          if (output.state === "disconnected") continue;
          try {
            output.send([status3, cc, value]);
          } catch {
          }
        }
        continue;
      }
      const note = clampMidiInteger(event?.note, 0, 127);
      const velocity = clampMidiInteger(Number(event?.velocity) * 127, 0, 127);
      const status2 = (noteOn ? 144 : 128) | channel - 1;
      for (const [index, output] of [...midiAccessRef.current?.outputs.values() ?? []].entries()) {
        if (!selectedMidiOutputDeviceIdSet.has(midiDeviceFromPort(output, index, "output").id)) continue;
        if (output.state === "disconnected") continue;
        try {
          output.send([status2, note, velocity]);
        } catch {
        }
      }
    }
  }, [selectedMidiOutputDeviceIdSet, selectedMidiOutputDeviceKey]);
  const stopMidiClockOutput = useCallback2((sendStop = true) => {
    if (midiClockOutputTimerRef.current !== null) {
      window.clearTimeout(midiClockOutputTimerRef.current);
      midiClockOutputTimerRef.current = null;
    }
    const wasRunning = midiClockOutputRunningRef.current;
    midiClockOutputRunningRef.current = false;
    if (sendStop && wasRunning) sendMidiClockMessage(252, true);
  }, [sendMidiClockMessage]);
  const startMidiClockOutput = useCallback2((sendStart = true) => {
    const graph = graphRef.current;
    if (!midiClockOutputEnabledRef.current || !programHasTempo(graph)) return;
    stopMidiClockOutput(false);
    midiClockOutputRunningRef.current = true;
    if (sendStart) sendMidiClockMessage(250);
    const scheduleNextTick = () => {
      if (!midiClockOutputRunningRef.current) return;
      const currentGraph = graphRef.current;
      const clock = midiClockOutputTempo(currentGraph);
      if (!clock || clock.source === "midi") return;
      sendMidiClockMessage(248);
      const delayMs = 6e4 / (clock.bpm * MIDI_CLOCK_TICKS_PER_BEAT);
      midiClockOutputTimerRef.current = window.setTimeout(scheduleNextTick, delayMs);
    };
    scheduleNextTick();
  }, [sendMidiClockMessage, stopMidiClockOutput]);
  const updateMidiInputDevices = useCallback2((midiAccess) => {
    const inputs2 = [...midiAccess.inputs.values()];
    const devices = inputs2.map(midiInputDeviceFromInput);
    setMidiInputDevices((current) => midiInputDevicesEqual(current, devices) ? current : devices);
    const outputs = [...midiAccess.outputs.values()].map((output, index) => midiDeviceFromPort(output, index, "output"));
    setMidiOutputDevices((current) => midiInputDevicesEqual(current, outputs) ? current : outputs);
    return devices;
  }, []);
  const disconnectMidiInput = useCallback2((nextStatus = "inactive", nextMessage = "MIDI input is not used by this patch.") => {
    stopMidiClockOutput();
    const midiAccess = midiAccessRef.current;
    if (midiAccess) {
      midiAccess.onstatechange = null;
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = null;
      }
    }
    midiAccessRef.current = null;
    midiRequestRef.current = null;
    setMidiInputDevices((current) => current.length === 0 ? current : []);
    setMidiOutputDevices((current) => current.length === 0 ? current : []);
    setMidiInputStatus(nextStatus);
    setMidiInputMessage(nextMessage);
  }, [stopMidiClockOutput]);
  const attachMidiInputs = useCallback2((midiAccess, node) => {
    const devices = updateMidiInputDevices(midiAccess);
    const outputCount = [...midiAccess.outputs.values()].length;
    const selectedConnectedCount = devices.filter((device) => selectedMidiInputDeviceIdSet.has(device.id)).length;
    setMidiInputStatus(devices.length + outputCount > 0 ? "connected" : "unsupported");
    setMidiInputMessage(midiInputStatusMessage(devices.length, outputCount, selectedMidiInputDeviceIds.length, selectedConnectedCount));
    const handleMidiClock = (sourceIndex, event) => {
      const graph = graphRef.current;
      if (!node || !programUsesMidiClock(graph)) return;
      const activeSources = activeMidiClockSourceIndexes(graph);
      if (activeSources.size > 0 && !activeSources.has(0) && !activeSources.has(sourceIndex)) return;
      const now = Number.isFinite(event.timeStamp) ? Number(event.timeStamp) : performance.now();
      const previous = midiClockTickMsBySourceRef.current[sourceIndex];
      midiClockTickMsBySourceRef.current[sourceIndex] = now;
      if (!Number.isFinite(previous) || previous <= 0 || now <= previous) return;
      const intervalMs = now - previous;
      const measuredBpm = 6e4 / (intervalMs * MIDI_CLOCK_TICKS_PER_BEAT);
      if (!Number.isFinite(measuredBpm)) return;
      const previousTempo = midiClockTempoBySourceRef.current[sourceIndex] || measuredBpm;
      const bpm = clampNumber(
        previousTempo + (measuredBpm - previousTempo) * MIDI_CLOCK_EMA_WEIGHT,
        MIDI_CLOCK_TEMPO_MIN,
        MIDI_CLOCK_TEMPO_MAX
      );
      midiClockTempoBySourceRef.current[sourceIndex] = bpm;
      node.port.postMessage({ type: "midiClockTempo", payload: { sourceIndex, bpm } });
    };
    const handleMidiMessage = (sourceIndex, event) => {
      const status2 = Number(event.data[0] ?? 0);
      if (status2 === 248) {
        handleMidiClock(sourceIndex, event);
        const clock = midiClockOutputTempo(graphRef.current);
        if (midiClockOutputRunningRef.current && clock?.source === "midi" && (clock.sourceIndex === 0 || clock.sourceIndex === sourceIndex)) {
          sendMidiClockMessage(248);
        }
        return;
      }
      if (status2 === 250 || status2 === 251 || status2 === 252) {
        delete midiClockTickMsBySourceRef.current[sourceIndex];
        delete midiClockTempoBySourceRef.current[sourceIndex];
        return;
      }
      const data1 = Number(event.data[1] ?? 0);
      const data2 = Number(event.data[2] ?? 0);
      const command = status2 & 240;
      const channel = (status2 & 15) + 1;
      if (command === 144 && data2 > 0) {
        node?.port.postMessage({ type: "noteOn", payload: { channel, note: data1, velocity: data2 / 127 } });
        return;
      }
      if (command === 128 || command === 144 && data2 === 0) {
        node?.port.postMessage({ type: "noteOff", payload: { channel, note: data1 } });
        return;
      }
      if (command === 176) {
        const value = data2 / 127;
        setLastMidiControlChange({
          id: midiControlChangeIdRef.current + 1,
          sourceIndex,
          channel,
          cc: data1,
          value,
          receivedAt: Number.isFinite(event.timeStamp) ? Number(event.timeStamp) : performance.now()
        });
        midiControlChangeIdRef.current += 1;
        node?.port.postMessage({ type: "midiCc", payload: { channel, cc: data1, value } });
      }
    };
    for (const [index, input] of [...midiAccess.inputs.values()].entries()) {
      const sourceIndex = index + 1;
      const device = midiInputDeviceFromInput(input, index);
      input.onmidimessage = selectedMidiInputDeviceIdSet.has(device.id) ? (event) => handleMidiMessage(sourceIndex, event) : null;
    }
    midiAccess.onstatechange = () => attachMidiInputs(
      midiAccess,
      graphRef.current && programUsesMidi(graphRef.current) ? nodeRef.current : null
    );
    if (midiClockOutputRunningRef.current) startMidiClockOutput(false);
  }, [selectedMidiInputDeviceIdSet, selectedMidiInputDeviceIds.length, selectedMidiInputDeviceKey, sendMidiClockMessage, startMidiClockOutput, updateMidiInputDevices]);
  const refreshMidiInputDevices = useCallback2(async () => {
    const navigatorWithMidi = navigator;
    if (!navigatorWithMidi.requestMIDIAccess) {
      setMidiInputDevices((current) => current.length === 0 ? current : []);
      setMidiOutputDevices((current) => current.length === 0 ? current : []);
      setMidiInputStatus("unsupported");
      setMidiInputMessage("MIDI input is unavailable in this browser.");
      return;
    }
    midiAccessRequestedRef.current = true;
    if (midiAccessRef.current) {
      attachMidiInputs(
        midiAccessRef.current,
        graphRef.current && programUsesMidi(graphRef.current) ? nodeRef.current : null
      );
      return;
    }
    setMidiInputStatus("requesting");
    setMidiInputMessage("Requesting MIDI permission...");
    try {
      const midiAccess = await navigatorWithMidi.requestMIDIAccess({ sysex: false });
      midiAccessRef.current = midiAccess;
      attachMidiInputs(
        midiAccess,
        graphRef.current && programUsesMidi(graphRef.current) ? nodeRef.current : null
      );
    } catch (error) {
      setMidiInputStatus(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "denied" : "error");
      setMidiInputMessage(error instanceof Error ? error.message : "MIDI permission was denied.");
      setMidiInputDevices((current) => current.length === 0 ? current : []);
      setMidiOutputDevices((current) => current.length === 0 ? current : []);
    }
  }, [attachMidiInputs]);
  const syncAudioInput = useCallback2((graph, context, node) => {
    if (!programUsesAudioInput(graph)) {
      disconnectAudioInput();
      return;
    }
    if (inputSourceRef.current && currentInputDeviceIdRef.current === selectedAudioInputDeviceId) return;
    if (inputSourceRef.current) {
      disconnectAudioInput("requesting", "Switching audio input device...");
    }
    const pendingRequest = inputRequestRef.current;
    if (pendingRequest && pendingRequest.deviceId === selectedAudioInputDeviceId && pendingRequest.context === context && pendingRequest.node === node) {
      return;
    }
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      setAudioInputStatus("unsupported");
      setAudioInputMessage("Audio input is unavailable in this browser.");
      setMessage("audio input unavailable: this browser does not expose getUserMedia");
      return;
    }
    setAudioInputStatus("requesting");
    setAudioInputMessage(selectedAudioInputDeviceId ? `Requesting ${audioInputDeviceLabel(audioInputDevices, selectedAudioInputDeviceId)}...` : "Requesting microphone permission...");
    const requestId = inputRequestIdRef.current + 1;
    inputRequestIdRef.current = requestId;
    inputRequestRef.current = {
      id: requestId,
      deviceId: selectedAudioInputDeviceId,
      context,
      node
    };
    const audioConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      ...selectedAudioInputDeviceId ? { deviceId: { exact: selectedAudioInputDeviceId } } : {}
    };
    void mediaDevices.getUserMedia({
      audio: audioConstraints
    }).then((stream) => {
      if (inputRequestRef.current?.id === requestId) {
        inputRequestRef.current = null;
      }
      const stillCurrent = inputRequestIdRef.current === requestId && contextRef.current === context && nodeRef.current === node && graphRef.current && programUsesAudioInput(graphRef.current);
      if (!stillCurrent) {
        stream.getTracks().forEach((track2) => track2.stop());
        return;
      }
      const source = context.createMediaStreamSource(stream);
      source.connect(node);
      inputStreamRef.current = stream;
      inputSourceRef.current = source;
      const track = stream.getAudioTracks()[0] ?? null;
      track?.addEventListener("ended", () => {
        logDiagnosticEvent("audio-input-track-ended", {
          level: "warn",
          details: {
            label: track.label,
            readyState: track.readyState,
            settings: track.getSettings()
          }
        });
      });
      const connectedDeviceId = track?.getSettings().deviceId ?? selectedAudioInputDeviceId;
      currentInputDeviceIdRef.current = selectedAudioInputDeviceId;
      setAudioInputStatus("connected");
      setAudioInputMessage(`${track?.label || audioInputDeviceLabel(audioInputDevices, connectedDeviceId) || "Audio input"} connected.`);
      void refreshAudioInputDevices();
      setMessage(`WASM audio ${context.state} (${AUDIO_WASM_ASSET_VERSION})`);
    }).catch((error) => {
      logDiagnosticEvent("audio-input-error", {
        level: "warn",
        details: {
          error: serializeError(error)
        }
      });
      if (inputRequestIdRef.current !== requestId) return;
      if (inputRequestRef.current?.id === requestId) {
        inputRequestRef.current = null;
      }
      const errorName = error instanceof DOMException ? error.name : "";
      if (errorName === "NotAllowedError" || errorName === "SecurityError") {
        setAudioInputStatus("denied");
        setAudioInputMessage("Microphone permission was denied. Allow microphone access for this site and try again.");
      } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
        setAudioInputStatus("unsupported");
        setAudioInputMessage("No microphone or audio input device was found.");
      } else if (errorName === "OverconstrainedError") {
        setAudioInputStatus("error");
        setAudioInputMessage("The selected input device is unavailable. Choose another input.");
        setSelectedAudioInputDeviceId("");
      } else {
        setAudioInputStatus("error");
        setAudioInputMessage(error instanceof Error ? error.message : "Audio input failed.");
      }
      void refreshAudioInputDevices();
      setMessage(`audio input unavailable: ${error instanceof Error ? error.message : "permission denied"}`);
    });
  }, [audioInputDevices, disconnectAudioInput, refreshAudioInputDevices, selectedAudioInputDeviceId]);
  const syncGraphSamples = useCallback2((graph, context, node) => {
    const nextKeys = {};
    const bindingsBySampleKey = /* @__PURE__ */ new Map();
    for (const binding of graph.sampleBindings) {
      const sampleUrl = binding.sample.url.trim();
      if (!sampleUrl) continue;
      const sampleName = binding.sample.name;
      const sampleKey = sampleUrl;
      nextKeys[binding.nodeId] = sampleKey;
      const bindings = bindingsBySampleKey.get(sampleKey) ?? [];
      bindings.push(binding);
      bindingsBySampleKey.set(sampleKey, bindings);
    }
    for (const [sampleKey, bindings] of bindingsBySampleKey) {
      const [owner, ...aliases] = bindings;
      if (!owner) continue;
      const sampleUrl = owner.sample.url.trim();
      const sampleName = owner.sample.name;
      const needsUpload = bindings.some((binding) => sampleDataKeysRef.current[binding.nodeId] !== sampleKey);
      if (!needsUpload) continue;
      for (const binding of bindings) sampleDataKeysRef.current[binding.nodeId] = sampleKey;
      void loadAndPostSampleData(
        context,
        node,
        owner.nodeId,
        sampleUrl,
        sampleName,
        sampleKey,
        sampleDataKeysRef,
        sampleDataCacheRef,
        sampleDataRequestRef
      ).then((entry) => {
        if (!entry) return;
        for (const binding of aliases) {
          if (sampleDataKeysRef.current[binding.nodeId] !== sampleKey) continue;
          postSampleReference(node, binding.nodeId, entry);
        }
      }).catch(() => {
        for (const binding of bindings) {
          if (sampleDataKeysRef.current[binding.nodeId] === sampleKey) {
            delete sampleDataKeysRef.current[binding.nodeId];
          }
        }
      });
    }
    for (const nodeId of Object.keys(sampleDataKeysRef.current)) {
      if (nextKeys[nodeId]) continue;
      delete sampleDataKeysRef.current[nodeId];
      node.port.postMessage({ type: "sampleData", payload: { nodeId, data: [], sampleRate: context.sampleRate, name: "", storageKey: "" } });
    }
  }, []);
  const preloadGraphSamples = useCallback2((graph) => {
    const nextKeys = {};
    for (const binding of graph.sampleBindings) {
      const sampleUrl = binding.sample.url.trim();
      if (!sampleUrl) continue;
      const sampleName = binding.sample.name;
      const sampleKey = sampleUrl;
      nextKeys[binding.nodeId] = sampleKey;
      void loadCachedSampleData(
        binding.nodeId,
        sampleUrl,
        sampleName,
        sampleKey,
        sampleDataCacheRef,
        sampleDataRequestRef
      ).catch(() => void 0);
    }
    const activeSampleKeys = new Set(Object.values(nextKeys));
    for (const sampleKey of Object.keys(sampleDataCacheRef.current)) {
      if (activeSampleKeys.has(sampleKey)) continue;
      delete sampleDataCacheRef.current[sampleKey];
    }
    for (const sampleKey of Object.keys(sampleDataRequestRef.current)) {
      if (activeSampleKeys.has(sampleKey)) continue;
      delete sampleDataRequestRef.current[sampleKey];
    }
  }, []);
  const syncGraphImages = useCallback2((graph, node) => {
    if (imageDataWorkletRef.current !== node) {
      imageDataWorkletRef.current = node;
      imageDataKeysRef.current = {};
    }
    const nextKeys = {};
    for (const binding of graph.imageBindings) {
      const imageUrl = binding.image.url.trim();
      if (!imageUrl) continue;
      const key = `${imageUrl}
${binding.image.name}`;
      nextKeys[binding.nodeId] = key;
      if (imageDataKeysRef.current[binding.nodeId] === key) continue;
      imageDataKeysRef.current[binding.nodeId] = key;
      void loadAndPostImageData(binding.nodeId, imageUrl, binding.image.name, key, node, imageDataCacheRef, imageDataRequestRef).catch(() => {
        if (imageDataKeysRef.current[binding.nodeId] === key) delete imageDataKeysRef.current[binding.nodeId];
      });
    }
    for (const nodeId of Object.keys(imageDataKeysRef.current)) {
      if (nextKeys[nodeId]) continue;
      delete imageDataKeysRef.current[nodeId];
      node.port.postMessage({ type: "imageData", payload: { nodeId, data: new Uint8Array(), width: 0, height: 0, name: "" } });
    }
  }, []);
  const preloadGraphImages = useCallback2((graph) => {
    const nextKeys = {};
    for (const binding of graph.imageBindings) {
      const imageUrl = binding.image.url.trim();
      if (!imageUrl) continue;
      const key = `${imageUrl}
${binding.image.name}`;
      nextKeys[binding.nodeId] = key;
      void loadCachedImageData(binding.nodeId, imageUrl, binding.image.name, key, imageDataCacheRef, imageDataRequestRef).catch(() => void 0);
    }
    for (const nodeId of Object.keys(imageDataCacheRef.current)) {
      if (nextKeys[nodeId] !== imageDataCacheRef.current[nodeId]?.key) delete imageDataCacheRef.current[nodeId];
    }
  }, []);
  const syncMidiInput = useCallback2((graph, node) => {
    if (!programUsesMidi(graph) && !midiInputEnabled && !midiClockOutputEnabled && !midiAccessRequestedRef.current) {
      disconnectMidiInput();
      return;
    }
    const navigatorWithMidi = navigator;
    if (!navigatorWithMidi.requestMIDIAccess) {
      setMidiInputStatus("unsupported");
      setMidiInputDevices((current) => current.length === 0 ? current : []);
      setMidiOutputDevices((current) => current.length === 0 ? current : []);
      setMidiInputMessage("MIDI input is unavailable in this browser.");
      setMessage("MIDI input unavailable: this browser does not expose Web MIDI");
      return;
    }
    if (midiAccessRef.current) {
      attachMidiInputs(midiAccessRef.current, node);
      return;
    }
    if (!midiRequestRef.current) {
      setMidiInputStatus("requesting");
      setMidiInputMessage("Requesting MIDI permission...");
      midiRequestRef.current = navigatorWithMidi.requestMIDIAccess({ sysex: false }).then((midiAccess) => midiAccess);
    }
    const midiRequest = midiRequestRef.current;
    void midiRequest.then((midiAccess) => {
      midiAccessRef.current = midiAccess;
      attachMidiInputs(midiAccess, node);
    }).catch((error) => {
      setMidiInputStatus(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "denied" : "error");
      setMidiInputMessage(error instanceof Error ? error.message : "MIDI permission was denied.");
      setMidiInputDevices((current) => current.length === 0 ? current : []);
      setMidiOutputDevices((current) => current.length === 0 ? current : []);
      setMessage(`MIDI input unavailable: ${error instanceof Error ? error.message : "permission denied"}`);
      midiRequestRef.current = null;
    });
  }, [attachMidiInputs, disconnectMidiInput, midiClockOutputEnabled, midiInputEnabled]);
  const activateAudioEngine = useCallback2(async () => {
    const context = contextRef.current;
    const node = nodeRef.current;
    const outputGain = outputGainRef.current;
    const analyser = analyserRef.current;
    if (!context || !node || !outputGain) return;
    if (!audioActivationRequestedRef.current) return;
    logDiagnosticEvent("audio-activation-requested", {
      details: {
        generation: audioEngineGenerationRef.current,
        contextState: context.state,
        graph: dspProgramDiagnosticSnapshot(graphRef.current)
      }
    });
    await resumeAudioContext(context);
    if (!audioActivationRequestedRef.current || contextRef.current !== context) {
      if (context.state !== "closed") await context.suspend();
      return;
    }
    node.port.postMessage({ type: "setMuted", payload: { muted: false } });
    fadeAudioOutputIn(context, outputGain);
    if (graphRef.current) {
      syncGraphSamples(graphRef.current, context, node);
      syncGraphImages(graphRef.current, node);
      syncAudioInput(graphRef.current, context, node);
      syncMidiInput(graphRef.current, node);
    }
    setStatus(context.state === "running" ? "running" : "idle");
    setMessage(`audio context ${context.state}`);
    if (context.state === "running") {
      logDiagnosticEvent("audio-context-running", {
        details: {
          generation: audioEngineGenerationRef.current,
          sampleRate: context.sampleRate,
          baseLatency: context.baseLatency,
          outputLatency: audioContextOutputLatency(context),
          graph: dspProgramDiagnosticSnapshot(graphRef.current)
        }
      });
      startMeter();
      if (recordingRequestedRef.current && node) {
        beginRecordingCapture(context, node);
      }
    }
  }, [beginRecordingCapture, startMeter, syncAudioInput, syncGraphImages, syncGraphSamples, syncMidiInput]);
  const ensureAudioEngine = useCallback2(async (activate) => {
    if (stopTimeoutRef.current !== null) {
      window.clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (activate) {
      audioActivationRequestedRef.current = true;
      setStatus("starting");
      setMessage(backendReadyRef.current ? "starting audio" : "preparing audio");
    }
    if (audioEngineCloseRef.current) {
      await audioEngineCloseRef.current;
    }
    if (nodeRef.current && contextRef.current) {
      if (activate) {
        await activateAudioEngine();
      }
      return;
    }
    if (!audioEngineRequestRef.current) {
      audioEngineRequestRef.current = (async () => {
        try {
          if (!activate) {
            setMessage("preparing audio");
          }
          backendReadyRef.current = false;
          const context = new AudioContext();
          const generation = audioEngineGenerationRef.current + 1;
          audioEngineGenerationRef.current = generation;
          contextRef.current = context;
          await context.suspend();
          logDiagnosticEvent("audio-context-created", {
            details: {
              generation,
              sampleRate: context.sampleRate,
              baseLatency: context.baseLatency,
              outputLatency: audioContextOutputLatency(context),
              state: context.state
            }
          });
          const wasmBytes = await loadCompatibleWasmBytes(AUDIO_ENGINE_CONFIG.rendering.mode !== "multi");
          let parallelFallbackReason = "";
          if (AUDIO_ENGINE_CONFIG.rendering.mode === "multi") {
            const abort = new AbortController();
            parallelEngineAbortRef.current = abort;
            try {
              const parallelEngine = await createParallelEngine(AUDIO_ENGINE_CONFIG.rendering.workers, abort.signal, (error) => {
                if (audioEngineGenerationRef.current !== generation || contextRef.current !== context) return;
                setStatus("error");
                setMessage(error);
                void closeAudioEngine("parallel-worker-error");
              });
              if (abort.signal.aborted) {
                parallelEngine.dispose();
                abort.signal.throwIfAborted();
              }
              parallelEngineRef.current = parallelEngine;
            } catch (error) {
              if (abort.signal.aborted) throw error;
              parallelFallbackReason = error instanceof Error ? error.message : String(error);
              logDiagnosticEvent("audio-parallel-fallback", { level: "warn", details: { reason: parallelFallbackReason } });
            }
          }
          await context.audioWorklet.addModule(WORKLET_URL);
          const analyser = context.createAnalyser();
          analyser.fftSize = 1024;
          const outputGain = context.createGain();
          outputGain.gain.value = 0;
          const createNode = (parallelEngine, fallbackReason) => new AudioWorkletNode(context, "teia-wasm-engine", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: {
              wasmBytes,
              audioConfig: AUDIO_ENGINE_CONFIG,
              parallelEngine,
              parallelFallbackReason: fallbackReason
            }
          });
          let node;
          try {
            node = createNode(parallelEngineRef.current?.processorOptions, parallelFallbackReason);
          } catch (error) {
            if (!parallelEngineRef.current) throw error;
            parallelEngineRef.current.dispose();
            parallelEngineRef.current = null;
            parallelFallbackReason = error instanceof Error ? error.message : String(error);
            node = createNode(void 0, parallelFallbackReason);
          }
          setCpuPeakLoad(0);
          setCpuDeadlineMisses(0);
          postBufferRestores(node, bufferRestoresRef.current);
          const pendingBufferCopies = [...pendingBufferCopiesRef.current.values()];
          pendingBufferCopiesRef.current.clear();
          postBufferCopies(node, pendingBufferCopies);
          postBufferClears(node, [...pendingBufferClearsRef.current]);
          pendingBufferClearsRef.current.clear();
          node.addEventListener("processorerror", () => {
            logDiagnosticEvent("audio-worklet-processor-error", {
              level: "error",
              details: {
                generation,
                contextState: context.state,
                graph: dspProgramDiagnosticSnapshot(graphRef.current)
              }
            });
            void closeAudioEngine("processor-error");
          });
          node.port.onmessage = (event) => {
            if (contextRef.current !== context) return;
            const { type, payload } = event.data || {};
            if (type === "renderingStatus") {
              setRendering({
                mode: payload?.mode === "multi" ? "multi" : "single",
                workers: Number(payload?.workers) || 0,
                parallelRepeats: Number(payload?.parallelRepeats) || 0,
                reason: String(payload?.reason || "")
              });
              if (payload?.mode !== "multi") {
                parallelEngineRef.current?.dispose();
                parallelEngineRef.current = null;
              }
              logDiagnosticEvent("audio-rendering-mode", { details: payload });
              return;
            }
            if (type === "parallelFailure") {
              setStatus("error");
              setMessage(payload?.message || "Parallel audio failed.");
              logDiagnosticEvent("audio-parallel-failure", { level: "error", details: payload });
              void closeAudioEngine("parallel-render-failed");
              return;
            }
            if (type === "midiOutput") {
              sendMidiOutputEvents(payload?.events);
              return;
            }
            if (type === "backendStatus") {
              backendReadyRef.current = Boolean(payload?.ready);
              logDiagnosticEvent("audio-backend-status", {
                level: payload?.ready ? "info" : "error",
                details: {
                  generation,
                  payload,
                  contextState: context.state,
                  graph: dspProgramDiagnosticSnapshot(graphRef.current)
                }
              });
              if (payload?.ready) {
                if (audioActivationRequestedRef.current && context.state === "running") {
                  fadeAudioOutputIn(context, outputGain);
                  setStatus("running");
                  setMessage(`WASM audio ${context.state} (${AUDIO_WASM_ASSET_VERSION})`);
                } else {
                  setStatus((current) => current === "starting" ? current : "idle");
                  setMessage("audio ready");
                }
              } else {
                setStatus("error");
                setMessage(payload?.error || "WASM audio failed");
              }
              return;
            }
            if (type === "wasmMemory") {
              logDiagnosticEvent("audio-wasm-memory-change", {
                details: {
                  generation,
                  payload,
                  contextState: context.state,
                  graph: dspProgramDiagnosticSnapshot(graphRef.current)
                }
              });
              return;
            }
            if (type === "cpuLoad") {
              const load = Number(payload?.load);
              if (Number.isFinite(load)) setCpuLoad(Math.max(0, load));
              setCpuPeakLoad(Math.max(0, Number(payload?.peakLoad) || 0));
              setCpuDeadlineMisses(Math.max(0, Number(payload?.deadlineMisses) || 0));
              return;
            }
            if (type === "wasmScopeMemory") {
              logDiagnosticEvent("audio-wasm-scope-memory", {
                details: {
                  generation,
                  payload,
                  contextState: context.state,
                  graph: dspProgramDiagnosticSnapshot(graphRef.current)
                }
              });
              return;
            }
            if (type === "processorError") {
              logDiagnosticEvent("audio-worklet-runtime-error", {
                level: "error",
                details: {
                  payload,
                  contextState: context.state,
                  graph: dspProgramDiagnosticSnapshot(graphRef.current)
                }
              });
              return;
            }
            if (type === "sampleLoadError") {
              const sampleMessage = typeof payload?.message === "string" ? payload.message : "Sample could not be loaded by the audio engine.";
              setMessage(sampleMessage);
              logDiagnosticEvent("audio-sample-load-error", {
                level: "error",
                details: {
                  generation,
                  payload,
                  contextState: context.state,
                  graph: dspProgramDiagnosticSnapshot(graphRef.current)
                }
              });
              return;
            }
            if (type === "recordingStarted") {
              logDiagnosticEvent("audio-recording-worklet-started", {
                details: {
                  payload,
                  contextState: context.state
                }
              });
              return;
            }
            if (type === "recordingChunk") {
              appendRecordingChunk(payload);
              return;
            }
            if (type === "recordingStopped") {
              const id = Number(payload?.id);
              if (Number.isFinite(id)) {
                const capture = recordingCaptureRef.current;
                if (capture?.id === id) capture.sampleEvents = samplePlaybackEventsFromPayload(payload?.sampleEvents);
                completeRecordingCapture(id);
              }
              return;
            }
            if (type === "bufferSnapshot") {
              const requestId = Number(payload?.requestId);
              const request = bufferSnapshotRequestsRef.current.get(requestId);
              if (!request) return;
              window.clearTimeout(request.timeout);
              bufferSnapshotRequestsRef.current.delete(requestId);
              const samples = float32ArrayFromUnknown(payload?.samples);
              const snapshotSampleRate = Number(payload?.sampleRate);
              request.resolve(samples && samples.length > 0 && Number.isFinite(snapshotSampleRate) ? { samples, sampleRate: snapshotSampleRate } : null);
              return;
            }
            if (type === "visualizationFrame") {
              setLinkMeters(linkMetersFromPayload(payload));
              if (audioActivationRequestedRef.current) {
                setPlayheads(playheadsFromPayload({ values: payload?.playheads }));
                setBuffers(buffersFromPayload(payload));
              }
              setLinkScopeReadings(linkScopesFromPayload(payload));
              return;
            }
            if (type === "linkMeters") {
              setLinkMeters(linkMetersFromPayload(payload));
              return;
            }
            if (type === "playheads") {
              if (audioActivationRequestedRef.current) {
                setPlayheads(playheadsFromPayload(payload));
              }
              return;
            }
            if (type === "linkScope") {
              const id = typeof payload?.id === "string" ? payload.id : null;
              if (!id) return;
              setLinkScopeReadings((current) => ({
                ...current,
                [id]: {
                  mode: typeof payload?.mode === "string" ? payload.mode : "continuous",
                  samples: Array.isArray(payload?.samples) ? payload.samples.map(Number).filter(Number.isFinite) : []
                }
              }));
            }
          };
          context.onstatechange = () => {
            const contextState = context.state;
            logDiagnosticEvent("audio-context-state-change", {
              level: contextState === "interrupted" || contextState === "closed" ? "warn" : "info",
              details: {
                generation,
                state: contextState,
                sampleRate: context.sampleRate,
                baseLatency: context.baseLatency,
                outputLatency: audioContextOutputLatency(context)
              }
            });
            setMessage((current) => current.replace(/(audio|context) (running|suspended|interrupted|closed)/, `$1 ${context.state}`));
            if (recordingRequestedRef.current && context.state === "running") {
              beginRecordingCapture(context, node);
            }
          };
          node.connect(analyser);
          analyser.connect(outputGain);
          outputGain.connect(context.destination);
          node.port.postMessage({ type: "setMuted", payload: { muted: true } });
          nodeRef.current = node;
          analyserRef.current = analyser;
          outputGainRef.current = outputGain;
          if (graphRef.current) {
            sampleDataKeysRef.current = {};
            imageDataKeysRef.current = {};
            lastSentProgramStructureRef.current = dspProgramStructureKey(graphRef.current);
            lastSentValuesRef.current = [...graphRef.current.values];
            lastSentCustomWavePointsRef.current = dspCustomWavePointsKey(graphRef.current);
            lastSentSequencerConfigRef.current = dspSequencerConfigKey(graphRef.current);
            node.port.postMessage({ type: "dspProgram", payload: graphRef.current });
            syncGraphSamples(graphRef.current, context, node);
            syncGraphImages(graphRef.current, node);
          }
          if (activeScopeRequestsRef.current.length > 0) {
            node.port.postMessage({
              type: "setLinkScopes",
              payload: scopePayload(activeScopeRequestsRef.current)
            });
          }
        } catch (error) {
          logDiagnosticEvent("audio-engine-start-error", {
            level: "error",
            details: {
              error: serializeError(error),
              graph: dspProgramDiagnosticSnapshot(graphRef.current)
            }
          });
          if (activate) {
            setStatus("error");
            setMessage(error instanceof Error ? error.message : "audio failed");
          } else {
            setMessage("audio stopped");
          }
          await closeAudioEngine("engine-start-error");
          throw error;
        } finally {
          audioEngineRequestRef.current = null;
        }
      })();
    }
    try {
      await audioEngineRequestRef.current;
    } catch {
      if (!activate) return;
      throw new Error("audio failed");
    }
    if (activate) {
      await activateAudioEngine();
    }
  }, [activateAudioEngine, appendRecordingChunk, beginRecordingCapture, closeAudioEngine, completeRecordingCapture, sendMidiOutputEvents, syncGraphImages, syncGraphSamples]);
  const syncGraph = useCallback2((graph) => {
    graphRef.current = graph;
    if (midiClockOutputRunningRef.current && !programHasTempo(graph)) stopMidiClockOutput();
    else if (midiClockOutputRunningRef.current) startMidiClockOutput(false);
    preloadGraphSamples(graph);
    preloadGraphImages(graph);
    if (!nodeRef.current || !contextRef.current) {
      if (programUsesAudioInput(graph)) {
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices?.getUserMedia) {
          setAudioInputStatus("unsupported");
          setAudioInputMessage("Audio input is unavailable in this browser.");
        } else {
          setAudioInputStatus("needs-permission");
          setAudioInputMessage("Start audio to request microphone access.");
          void refreshAudioInputDevices();
        }
      } else {
        disconnectAudioInput();
      }
      if (programUsesMidi(graph) || midiInputEnabled || midiClockOutputEnabled || midiAccessRequestedRef.current) {
        const navigatorWithMidi = navigator;
        if (!navigatorWithMidi.requestMIDIAccess) {
          setMidiInputStatus("unsupported");
          setMidiInputDevices((current) => current.length === 0 ? current : []);
          setMidiOutputDevices((current) => current.length === 0 ? current : []);
          setMidiInputMessage("MIDI input is unavailable in this browser.");
        } else if (midiAccessRef.current) {
          const devices = updateMidiInputDevices(midiAccessRef.current);
          const selectedConnectedCount = devices.filter((device) => selectedMidiInputDeviceIdSet.has(device.id)).length;
          const outputCount = [...midiAccessRef.current.outputs.values()].length;
          setMidiInputStatus(devices.length + outputCount > 0 ? "connected" : "unsupported");
          setMidiInputMessage(midiInputStatusMessage(devices.length, outputCount, selectedMidiInputDeviceIds.length, selectedConnectedCount));
        } else {
          setMidiInputStatus("needs-permission");
          setMidiInputMessage(midiInputEnabled || midiClockOutputEnabled || midiAccessRequestedRef.current ? "Open MIDI settings to request browser MIDI access." : "Start audio or refresh MIDI to request browser MIDI access.");
        }
      } else {
        disconnectMidiInput();
      }
      return;
    }
    const shouldSyncExternalInputs = audioActivationRequestedRef.current;
    const structureKey = dspProgramStructureKey(graph);
    const customWavePointsKey = dspCustomWavePointsKey(graph);
    const sequencerConfigKey = dspSequencerConfigKey(graph);
    if (lastSentProgramStructureRef.current === structureKey && lastSentCustomWavePointsRef.current !== customWavePointsKey) {
      lastSentCustomWavePointsRef.current = customWavePointsKey;
      nodeRef.current.port.postMessage({
        type: "dspCustomWaves",
        payload: { bindings: graph.customWaveBindings }
      });
    }
    if (lastSentProgramStructureRef.current === structureKey && lastSentSequencerConfigRef.current !== sequencerConfigKey) {
      lastSentSequencerConfigRef.current = sequencerConfigKey;
      nodeRef.current.port.postMessage({
        type: "dspSequencers",
        payload: { bindings: graph.sequencerBindings }
      });
    }
    if (lastSentProgramStructureRef.current === structureKey && arraysEqual(lastSentValuesRef.current, graph.values)) {
      syncGraphSamples(graph, contextRef.current, nodeRef.current);
      syncGraphImages(graph, nodeRef.current);
      if (shouldSyncExternalInputs) {
        syncAudioInput(graph, contextRef.current, nodeRef.current);
        syncMidiInput(graph, nodeRef.current);
      }
      return;
    }
    if (lastSentProgramStructureRef.current === structureKey) {
      lastSentValuesRef.current = [...graph.values];
      nodeRef.current.port.postMessage({ type: "dspValues", payload: { values: graph.values } });
      syncGraphSamples(graph, contextRef.current, nodeRef.current);
      syncGraphImages(graph, nodeRef.current);
      if (shouldSyncExternalInputs) {
        syncAudioInput(graph, contextRef.current, nodeRef.current);
        syncMidiInput(graph, nodeRef.current);
      }
      return;
    }
    lastSentProgramStructureRef.current = structureKey;
    lastSentValuesRef.current = [...graph.values];
    lastSentCustomWavePointsRef.current = customWavePointsKey;
    lastSentSequencerConfigRef.current = sequencerConfigKey;
    nodeRef.current.port.postMessage({ type: "dspProgram", payload: graph });
    syncGraphSamples(graph, contextRef.current, nodeRef.current);
    syncGraphImages(graph, nodeRef.current);
    if (shouldSyncExternalInputs) {
      syncAudioInput(graph, contextRef.current, nodeRef.current);
      syncMidiInput(graph, nodeRef.current);
    }
    nodeRef.current.port.postMessage({
      type: "setLinkScopes",
      payload: activeScopeRequestsRef.current.length > 0 ? scopePayload(activeScopeRequestsRef.current) : {}
    });
  }, [disconnectAudioInput, disconnectMidiInput, ensureAudioEngine, midiClockOutputEnabled, midiInputEnabled, preloadGraphImages, preloadGraphSamples, refreshAudioInputDevices, selectedMidiInputDeviceIdSet, selectedMidiInputDeviceIds.length, selectedMidiInputDeviceKey, stopMidiClockOutput, syncAudioInput, syncGraphImages, syncGraphSamples, syncMidiInput, updateMidiInputDevices]);
  const setLinkScopes = useCallback2((requests) => {
    const nextRequests = normalizeScopeCaptureRequests(requests);
    if (scopeCaptureRequestsEqual(activeScopeRequestsRef.current, nextRequests)) return;
    activeScopeRequestsRef.current = nextRequests;
    nodeRef.current?.port.postMessage({
      type: "setLinkScopes",
      payload: activeScopeRequestsRef.current.length > 0 ? scopePayload(activeScopeRequestsRef.current) : {}
    });
  }, []);
  const captureBuffer = useCallback2((nodeId) => {
    const node = nodeRef.current;
    if (!node || !nodeId) return Promise.resolve(null);
    const requestId = bufferSnapshotRequestIdRef.current + 1;
    bufferSnapshotRequestIdRef.current = requestId;
    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        bufferSnapshotRequestsRef.current.delete(requestId);
        resolve(null);
      }, 2e3);
      bufferSnapshotRequestsRef.current.set(requestId, { resolve, timeout });
      node.port.postMessage({
        type: "captureBuffer",
        payload: { requestId, nodeId }
      });
    });
  }, []);
  const restoreBuffers = useCallback2((snapshots) => {
    bufferRestoresRef.current = snapshots;
    const node = nodeRef.current;
    if (node) postBufferRestores(node, snapshots);
  }, []);
  const clearBuffer = useCallback2((nodeId) => {
    if (!nodeId) return;
    const restored = bufferRestoresRef.current[nodeId];
    if (restored) restored.samples.fill(0);
    setBuffers((current) => {
      const visualization = current[nodeId];
      if (!visualization) return current;
      return {
        ...current,
        [nodeId]: {
          ...visualization,
          bins: visualization.bins.map(() => ({ min: 0, max: 0 }))
        }
      };
    });
    const node = nodeRef.current;
    if (node) {
      postBufferClears(node, [nodeId]);
    } else {
      pendingBufferClearsRef.current.add(nodeId);
    }
  }, []);
  const copyBuffers = useCallback2((copies) => {
    if (copies.length === 0) return;
    const node = nodeRef.current;
    if (node) {
      postBufferCopies(node, copies);
      return;
    }
    for (const copy of copies) pendingBufferCopiesRef.current.set(copy.targetNodeId, copy);
  }, []);
  const start = useCallback2(async () => {
    try {
      logDiagnosticEvent("audio-start-clicked", {
        details: {
          graph: dspProgramDiagnosticSnapshot(graphRef.current)
        }
      });
      await ensureAudioEngine(true);
      if (audioActivationRequestedRef.current) startMidiClockOutput();
    } catch (error) {
      logDiagnosticEvent("audio-start-error", {
        level: "error",
        details: {
          error: serializeError(error),
          graph: dspProgramDiagnosticSnapshot(graphRef.current)
        }
      });
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "audio failed");
    }
  }, [ensureAudioEngine, startMidiClockOutput]);
  const stop = useCallback2(() => {
    logDiagnosticEvent("audio-stop-clicked", {
      details: {
        generation: audioEngineGenerationRef.current,
        contextState: contextRef.current?.state ?? "none",
        graph: dspProgramDiagnosticSnapshot(graphRef.current)
      }
    });
    audioActivationRequestedRef.current = false;
    sendMidiAllNotesOff();
    stopMidiClockOutput();
    finishRecordingCapture();
    setPlayheads({});
    setBuffers((current) => preservedBufferVisualizations(current, graphRef.current));
    const context = contextRef.current;
    const outputGain = outputGainRef.current;
    if (context && outputGain && context.state !== "closed") {
      fadeAudioOutputOut(context, outputGain);
      if (stopTimeoutRef.current !== null) {
        window.clearTimeout(stopTimeoutRef.current);
      }
      stopTimeoutRef.current = window.setTimeout(() => {
        parkAudioContext(contextRef, nodeRef, outputGainRef, inputSourceRef, inputStreamRef, stopTimeoutRef);
        logDiagnosticEvent("audio-context-parked", {
          details: {
            generation: audioEngineGenerationRef.current,
            contextState: contextRef.current?.state ?? "none"
          }
        });
        setLinkMeters({});
        setLinkScopeReadings({});
      }, AUDIO_OUTPUT_STOP_DELAY_MS);
    } else {
      parkAudioContext(contextRef, nodeRef, outputGainRef, inputSourceRef, inputStreamRef, stopTimeoutRef);
      logDiagnosticEvent("audio-context-parked", {
        details: {
          generation: audioEngineGenerationRef.current,
          contextState: contextRef.current?.state ?? "none"
        }
      });
      setLinkMeters({});
      setLinkScopeReadings({});
    }
    if ((midiInputEnabled || midiClockOutputEnabled || midiAccessRequestedRef.current) && midiAccessRef.current) {
      attachMidiInputs(midiAccessRef.current, null);
    } else {
      disconnectMidiInput();
    }
    inputRequestIdRef.current += 1;
    inputRequestRef.current = null;
    currentInputDeviceIdRef.current = "";
    stopMeter();
    setLinkMeters({});
    setLinkScopeReadings({});
    setStatus("idle");
    setMessage("audio stopped");
    setAudioInputStatus(programUsesAudioInput(graphRef.current) ? "needs-permission" : "inactive");
    setAudioInputMessage(programUsesAudioInput(graphRef.current) ? "Start audio to request microphone access." : "Audio input is not used by this patch.");
    setMidiInputStatus(programUsesMidi(graphRef.current) || midiInputEnabled || midiClockOutputEnabled || midiAccessRequestedRef.current ? "needs-permission" : "inactive");
    setMidiInputMessage(programUsesMidi(graphRef.current) || midiInputEnabled || midiClockOutputEnabled || midiAccessRequestedRef.current ? "Open MIDI settings to request browser MIDI access." : "MIDI input is not used by this patch.");
    if (!midiInputEnabled && !midiClockOutputEnabled && !midiAccessRequestedRef.current) {
      setMidiInputDevices((current) => current.length === 0 ? current : []);
    }
  }, [attachMidiInputs, disconnectMidiInput, finishRecordingCapture, midiClockOutputEnabled, midiInputEnabled, sendMidiAllNotesOff, stopMeter, stopMidiClockOutput]);
  useEffect3(() => {
    if (!midiClockOutputEnabled) {
      stopMidiClockOutput();
      return;
    }
    if (audioActivationRequestedRef.current) startMidiClockOutput();
  }, [midiClockOutputEnabled, startMidiClockOutput, stopMidiClockOutput]);
  useEffect3(() => {
    if (!midiAccessRef.current) return;
    attachMidiInputs(
      midiAccessRef.current,
      graphRef.current && programUsesMidi(graphRef.current) ? nodeRef.current : null
    );
  }, [attachMidiInputs]);
  useEffect3(() => () => {
    audioActivationRequestedRef.current = false;
    finishRecordingCapture();
    stopMeter();
    void closeAudioEngine("component-unmount");
    disconnectMidiInput();
  }, [closeAudioEngine, disconnectMidiInput, finishRecordingCapture, stopMeter]);
  useEffect3(() => {
    void refreshAudioInputDevices();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => {
      void refreshAudioInputDevices();
    };
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refreshAudioInputDevices]);
  const audioInput = useMemo3(() => ({
    status: audioInputStatus,
    message: audioInputMessage,
    devices: audioInputDevices,
    selectedDeviceId: selectedAudioInputDeviceId,
    canSelectDevice: Boolean(navigator.mediaDevices?.enumerateDevices)
  }), [audioInputDevices, audioInputMessage, audioInputStatus, selectedAudioInputDeviceId]);
  const midiInput = useMemo3(() => ({
    status: midiInputStatus,
    message: midiInputMessage,
    devices: midiInputDevices,
    outputDevices: midiOutputDevices,
    canRequestAccess: Boolean(navigator.requestMIDIAccess),
    lastControlChange: lastMidiControlChange
  }), [lastMidiControlChange, midiInputDevices, midiInputMessage, midiInputStatus, midiOutputDevices]);
  const recording = useMemo3(() => ({
    status: recordingStatus,
    message: recordingMessage,
    fileName: recordingFileName,
    elapsedSeconds: recordingElapsedSeconds
  }), [recordingElapsedSeconds, recordingFileName, recordingMessage, recordingStatus]);
  return {
    status,
    message,
    cpuLoad,
    cpuPeakLoad,
    cpuDeadlineMisses,
    rendering,
    peak,
    linkMeters,
    linkScopes,
    playheads,
    buffers,
    recording,
    audioInput,
    midiInput,
    start,
    stop,
    startRecording,
    stopRecording,
    captureBuffer,
    clearBuffer,
    copyBuffers,
    restoreBuffers,
    syncGraph,
    setLinkScopes,
    setAudioInputDeviceId: setSelectedAudioInputDeviceId,
    refreshAudioInputDevices,
    refreshMidiInputDevices
  };
}
function postBufferRestores(node, snapshots) {
  node.port.postMessage({
    type: "restoreBuffers",
    payload: {
      buffers: Object.entries(snapshots).map(([nodeId, snapshot]) => ({
        nodeId,
        sampleRate: snapshot.sampleRate,
        samples: snapshot.samples
      }))
    }
  });
}
function postBufferCopies(node, copies) {
  if (copies.length === 0) return;
  node.port.postMessage({
    type: "copyBuffers",
    payload: { copies }
  });
}
function postBufferClears(node, nodeIds) {
  if (nodeIds.length === 0) return;
  node.port.postMessage({
    type: "clearBuffers",
    payload: { nodeIds }
  });
}
function encodeWav(chunks, sampleRate, channelCount) {
  const frameCount = chunks.reduce((total, chunk) => total + (chunk[0]?.length ?? 0), 0);
  const bytesPerSample = 2;
  const dataByteLength = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataByteLength, true);
  let offset = 44;
  for (const chunk of chunks) {
    const frames = chunk[0]?.length ?? 0;
    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const channelSamples = chunk[channel] ?? chunk[0];
        const sample = Math.max(-1, Math.min(1, channelSamples?.[frame] ?? 0));
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += bytesPerSample;
      }
    }
  }
  return new Blob([view], { type: "audio/wav" });
}
function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
function recordingChunkFromPayload(payload, channelCount) {
  const channels = Array.isArray(payload.channels) ? payload.channels : [];
  const firstChannel = float32ArrayFromUnknown(channels[0]);
  if (!firstChannel || firstChannel.length === 0) return null;
  const frameCount = firstChannel.length;
  const output = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    const source = float32ArrayFromUnknown(channels[channel]) ?? firstChannel;
    output.push(source.length === frameCount ? source : source.slice(0, frameCount));
  }
  return output;
}
function float32ArrayFromUnknown(value) {
  if (value instanceof Float32Array) return value;
  if (Array.isArray(value)) {
    return Float32Array.from(value.map((sample) => {
      const numeric = Number(sample);
      return Number.isFinite(numeric) ? numeric : 0;
    }));
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView) && "length" in value) {
    return Float32Array.from(Array.from(value, (sample) => {
      const numeric = Number(sample);
      return Number.isFinite(numeric) ? numeric : 0;
    }));
  }
  return null;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function uploadRecording(blob, patchName, sampleEvents) {
  const response = await fetch("/api/recordings", {
    method: "POST",
    headers: {
      "Content-Type": "audio/wav",
      // HTTP header values are limited to Latin-1. Patch names are user text,
      // so encode them before placing them in a header (for example, "été").
      "X-Teia-Patch-Name-Encoded": encodeURIComponent(patchName)
    },
    body: blob
  });
  if (!response.ok) {
    throw new Error(await response.text() || `Recording save failed (${response.status}).`);
  }
  const payload = await response.json();
  if (!isRecord2(payload) || typeof payload.name !== "string") {
    throw new Error("Recording save returned an invalid response.");
  }
  const videoSampleEvents = sampleEvents.filter(isVideoSamplePlaybackEvent);
  if (videoSampleEvents.length > 0) {
    const metadataResponse = await fetch("/api/recording-metadata", {
      method: "POST",
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "X-Teia-Recording-Name": payload.name
      },
      body: samplePlaybackEventsCsv(videoSampleEvents)
    });
    if (!metadataResponse.ok) {
      throw new Error(await metadataResponse.text() || `Recording metadata save failed (${metadataResponse.status}).`);
    }
  }
  return { name: payload.name };
}
function isVideoSamplePlaybackEvent(event) {
  return event.sampleName.toLowerCase().endsWith(".mp4");
}
function samplePlaybackEventsFromPayload(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord2).map((event) => ({
    nodeId: String(event.nodeId ?? ""),
    sampleName: String(event.sampleName ?? ""),
    startMs: Number(event.startMs) || 0,
    endMs: Number(event.endMs) || 0,
    speed: Number(event.speed) || 0,
    volume: Number(event.volume) || 0,
    attackMs: Number(event.attackMs) || 0,
    releaseMs: Number(event.releaseMs) || 0,
    triggerTimeMs: Number(event.triggerTimeMs) || 0
  }));
}
function samplePlaybackEventsCsv(events) {
  const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const header = ["node_id", "sample_name", "start_ms", "end_ms", "speed", "volume", "attack_ms", "release_ms", "trigger_time_ms"];
  const rows = events.map((event, captureOrder) => ({ event, captureOrder })).sort((left, right) => left.event.triggerTimeMs - right.event.triggerTimeMs || left.captureOrder - right.captureOrder).map(({ event }) => [
    event.nodeId,
    event.sampleName,
    event.startMs,
    event.endMs,
    event.speed,
    event.volume,
    event.attackMs,
    event.releaseMs,
    event.triggerTimeMs
  ].map(escape).join(","));
  return `${header.join(",")}
${rows.join("\n")}${rows.length ? "\n" : ""}`;
}
function scopePayload(requests) {
  return {
    linkIds: requests.map((request) => request.id),
    scopes: requests.map((request) => {
      const displayPoints = request.points ?? SCOPE_DISPLAY_POINTS;
      const mode = request.reset ?? SCOPE_MODE;
      return {
        id: request.id,
        // Preserve the selected `length`: doubling both the capture duration
        // and count keeps sample spacing unchanged, leaving a full display
        // window after any eligible zero crossing.
        seconds: mode === "zero-crossing" ? request.length * 2 : request.length,
        points: mode === "zero-crossing" ? Math.min(1024, displayPoints * 2) : request.points ?? SCOPE_CAPTURE_POINTS,
        displayPoints,
        mode
      };
    }),
    points: SCOPE_CAPTURE_POINTS,
    displayPoints: SCOPE_DISPLAY_POINTS,
    mode: SCOPE_MODE
  };
}
function arraysEqual(left, right) {
  if (!left || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
function normalizeScopeCaptureRequests(requests) {
  const seen = /* @__PURE__ */ new Set();
  return requests.flatMap((request) => {
    if (!request.id || seen.has(request.id)) return [];
    seen.add(request.id);
    const points = request.points === void 0 ? void 0 : Math.round(clampNumber(request.points, 32, 512));
    return [{
      id: request.id,
      length: clampNumber(request.length, 0.01, 30),
      ...points === void 0 ? {} : { points },
      ...request.reset === "zero-crossing" ? { reset: "zero-crossing" } : { reset: "none" }
    }];
  });
}
function scopeCaptureRequestsEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].id !== right[index].id || left[index].length !== right[index].length || left[index].points !== right[index].points || left[index].reset !== right[index].reset) return false;
  }
  return true;
}
function programUsesAudioInput(program) {
  return Boolean(program?.ops.some((op) => op.opcode === DSP_OP.Input));
}
function audioInputDeviceLabel(devices, deviceId) {
  return devices.find((device) => device.deviceId === deviceId)?.label ?? "";
}
function midiInputDeviceFromInput(input, index) {
  return midiDeviceFromPort(input, index, "input");
}
function midiDeviceFromPort(port, index, kind) {
  const name = port.name?.trim();
  const manufacturer = port.manufacturer?.trim();
  return {
    id: port.id || `${manufacturer || "midi"}-${name || index}`,
    label: [manufacturer, name].filter(Boolean).join(" ") || `MIDI ${kind} ${index + 1}`,
    state: port.state || "connected"
  };
}
function midiInputDevicesEqual(left, right) {
  if (left.length !== right.length) return false;
  return left.every((device, index) => device.id === right[index]?.id && device.label === right[index]?.label && device.state === right[index]?.state);
}
function midiInputStatusMessage(inputCount, outputCount, selectedCount, selectedConnectedCount) {
  if (inputCount + outputCount === 0) {
    return "MIDI permission is granted, but no devices were found.";
  }
  if (selectedCount === 0) {
    return `${inputCount} input${inputCount === 1 ? "" : "s"} and ${outputCount} output${outputCount === 1 ? "" : "s"} available.`;
  }
  if (selectedConnectedCount === 0) {
    return "Selected MIDI input is not currently available.";
  }
  return `${selectedConnectedCount} of ${inputCount} MIDI input${inputCount === 1 ? "" : "s"} selected; ${outputCount} output${outputCount === 1 ? "" : "s"} available.`;
}
function programUsesMidi(program) {
  return Boolean(
    program?.ops.some((op) => op.opcode === DSP_OP.MidiNote || op.opcode === DSP_OP.MidiCc || op.opcode === DSP_OP.MidiNoteSend || op.opcode === DSP_OP.MidiCcSend) || (program?.midiControlBindings.length ?? 0) > 0 || programUsesMidiClock(program)
  );
}
function programUsesMidiClock(program) {
  return Boolean(program?.usesMidiClock);
}
function programHasTempo(program) {
  return (program?.tempoBindings.length ?? 0) > 0;
}
function midiClockOutputTempo(program) {
  const binding = program?.tempoBindings[0];
  if (!binding || !program) return null;
  const source = Math.round(program.values[binding.sourceValueIndex] ?? 0);
  const sourceIndex = Math.max(0, Math.round(program.values[binding.midiSourceValueIndex] ?? 0));
  return {
    bpm: clampNumber(program.values[binding.bpmValueIndex] ?? 120, MIDI_CLOCK_TEMPO_MIN, MIDI_CLOCK_TEMPO_MAX),
    source: source === 1 ? "midi" : "internal",
    sourceIndex
  };
}
function activeMidiClockSourceIndexes(program) {
  const indexes = /* @__PURE__ */ new Set();
  if (!program?.usesMidiClock) return indexes;
  for (const binding of program.tempoBindings) {
    const source = Math.round(program.values[binding.sourceValueIndex] ?? 0);
    if (source !== 1) continue;
    indexes.add(Math.max(0, Math.round(program.values[binding.midiSourceValueIndex] ?? 0)));
  }
  return indexes;
}
function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
function clampMidiInteger(value, min, max) {
  const numeric = Number(value);
  return Math.round(clampNumber(numeric, min, max));
}
async function resumeAudioContext(context) {
  if (context.state === "running") return;
  await Promise.race([
    context.resume().then(() => void 0),
    new Promise((resolve) => {
      window.setTimeout(resolve, 350);
    })
  ]);
}
function linkMetersFromPayload(payload) {
  const levels = payload?.levels;
  if (!Array.isArray(levels)) return {};
  const readings = {};
  for (const entry of levels) {
    if (!Array.isArray(entry)) continue;
    const [id, input, output, envelope] = entry;
    if (typeof id !== "string") continue;
    readings[id] = {
      input: finiteNumber(input),
      output: finiteNumber(output),
      envelope: finiteNumber(envelope)
    };
  }
  return readings;
}
function playheadsFromPayload(payload) {
  const values = payload?.values;
  if (!Array.isArray(values)) return {};
  const playheads = {};
  const latestPlayheads = {};
  for (const entry of values) {
    if (!Array.isArray(entry)) continue;
    const [id, value, isLatest] = entry;
    const playhead = Number(value);
    if (typeof id !== "string" || !Number.isFinite(playhead)) continue;
    const safePlayhead = clampNumber(playhead, 0, 1);
    if (isLatest === true) latestPlayheads[id] = safePlayhead;
    else (playheads[id] ??= []).push(safePlayhead);
  }
  for (const [id, playhead] of Object.entries(latestPlayheads)) (playheads[id] ??= []).push(playhead);
  return playheads;
}
function buffersFromPayload(payload) {
  const values = payload?.buffers;
  if (!Array.isArray(values)) return {};
  const buffers = {};
  for (const entry of values) {
    if (!Array.isArray(entry)) continue;
    const [id, rawPlayhead, rawRecordHead, rawBins] = entry;
    if (typeof id !== "string" || !Array.isArray(rawBins)) continue;
    const bins = rawBins.flatMap((bin) => {
      if (!Array.isArray(bin)) return [];
      const min = Number(bin[0]);
      const max = Number(bin[1]);
      return Number.isFinite(min) && Number.isFinite(max) ? [{ min, max }] : [];
    });
    buffers[id] = {
      playhead: clampNumber(Number(rawPlayhead), 0, 1),
      recordHead: clampNumber(Number(rawRecordHead), 0, 1),
      bins
    };
  }
  return buffers;
}
function preservedBufferVisualizations(buffers, program) {
  if (!program) return {};
  const preservedNodeIds = new Set(program.stateBindings.flatMap((binding) => {
    if (!binding.id.endsWith(":buffer")) return [];
    const op = program.ops.find((candidate) => candidate.opcode === DSP_OP.Buffer && candidate.state === binding.state);
    return (op?.value ?? 0) >= 0.5 ? [binding.nodeId] : [];
  }));
  return Object.fromEntries(Object.entries(buffers).filter(([nodeId]) => preservedNodeIds.has(nodeId)));
}
function linkScopesFromPayload(payload) {
  const scopes = payload?.scopes;
  if (!Array.isArray(scopes)) return {};
  const readings = {};
  for (const entry of scopes) {
    if (!entry || typeof entry !== "object") continue;
    const { id, mode, samples } = entry;
    if (typeof id !== "string" || !Array.isArray(samples)) continue;
    readings[id] = {
      mode: typeof mode === "string" ? mode : "continuous",
      samples: samples.map(Number).filter(Number.isFinite)
    };
  }
  return readings;
}
function finiteNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}
async function loadAndPostSampleData(context, node, nodeId, url, name, key, keysRef, cacheRef, requestRef) {
  const entry = await loadCachedSampleData(nodeId, url, name, key, cacheRef, requestRef, context);
  if (!entry || keysRef.current[nodeId] !== key) return null;
  postSampleData(node, nodeId, entry);
  return entry;
}
async function loadAndPostImageData(nodeId, url, name, key, node, cacheRef, requestRef) {
  const entry = await loadCachedImageData(nodeId, url, name, key, cacheRef, requestRef);
  if (!entry) return;
  node.port.postMessage({
    type: "imageData",
    payload: { nodeId, data: entry.data, width: entry.width, height: entry.height, name: entry.name }
  });
}
async function loadCachedImageData(nodeId, url, name, key, cacheRef, requestRef) {
  if (cacheRef.current[nodeId]?.key === key) return cacheRef.current[nodeId];
  const existing = requestRef.current[nodeId];
  if (existing?.key === key) return existing.promise;
  const promise = (async () => {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Could not load image "${name || url}" (${response.status}).`);
    const decoded = await decodeImageRgba(await response.blob());
    const entry = { key, name, ...decoded };
    cacheRef.current[nodeId] = entry;
    return entry;
  })().finally(() => {
    if (requestRef.current[nodeId]?.key === key) delete requestRef.current[nodeId];
  });
  requestRef.current[nodeId] = { key, promise };
  return promise;
}
async function decodeImageRgba(blob) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = typeof OffscreenCanvas === "undefined" ? document.createElement("canvas") : new OffscreenCanvas(width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("This browser cannot read image pixels.");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { data: new Uint8Array(context.getImageData(0, 0, width, height).data), width, height };
}
async function loadCachedSampleData(nodeId, url, name, key, cacheRef, requestRef, context) {
  const cached = cacheRef.current[key];
  if (cached?.key === key) return cached;
  const currentRequest = requestRef.current[key];
  if (currentRequest?.key === key) return currentRequest.promise;
  delete cacheRef.current[key];
  const requestState = {
    key,
    promise: Promise.resolve(null)
  };
  const request = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Could not load sample "${name || url}" (${response.status}).`);
      }
      const buffer = await decodeSampleAudioData(await response.arrayBuffer(), context);
      const entry = {
        key,
        data: audioBufferToMonoData(buffer),
        sampleRate: buffer.sampleRate,
        name,
        storageKey: url
      };
      if (requestRef.current[key] === requestState) {
        cacheRef.current[key] = entry;
        delete requestRef.current[key];
      }
      return entry;
    } catch (error) {
      logDiagnosticEvent("audio-sample-load-error", {
        level: "warn",
        details: {
          nodeId,
          url,
          name,
          error: serializeError(error)
        }
      });
      if (requestRef.current[key] === requestState) {
        delete requestRef.current[key];
      }
      throw error;
    }
  })();
  requestState.promise = request;
  requestRef.current[key] = requestState;
  return request;
}
async function decodeSampleAudioData(arrayBuffer, context) {
  if (context) {
    return context.decodeAudioData(arrayBuffer);
  }
  const windowWithOfflineAudio = window;
  const OfflineAudioContextConstructor = window.OfflineAudioContext || windowWithOfflineAudio.webkitOfflineAudioContext;
  if (!OfflineAudioContextConstructor) {
    throw new Error("This browser cannot preload samples while audio is stopped.");
  }
  const decodeContext = new OfflineAudioContextConstructor(1, 1, 44100);
  return decodeContext.decodeAudioData(arrayBuffer);
}
function postSampleData(node, nodeId, entry) {
  const data = new Float32Array(entry.data);
  node.port.postMessage({
    type: "sampleData",
    payload: {
      nodeId,
      data,
      sampleRate: entry.sampleRate,
      name: entry.name,
      storageKey: entry.key
    }
  }, [data.buffer]);
}
function postSampleReference(node, nodeId, entry) {
  node.port.postMessage({
    type: "sampleData",
    payload: { nodeId, sampleRate: entry.sampleRate, name: entry.name, storageKey: entry.key }
  });
}
function audioBufferToMonoData(buffer) {
  const output = new Float32Array(buffer.length);
  if (buffer.numberOfChannels === 0) return output;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const input = buffer.getChannelData(channel);
    for (let index = 0; index < output.length; index += 1) {
      output[index] += input[index] / buffer.numberOfChannels;
    }
  }
  return output;
}
function audioContextOutputLatency(context) {
  const contextWithOutputLatency = context;
  return typeof contextWithOutputLatency.outputLatency === "number" ? contextWithOutputLatency.outputLatency : null;
}
function dspProgramDiagnosticSnapshot(program) {
  if (!program) return null;
  return {
    ops: program.ops.length,
    values: program.values.length,
    stateBindings: program.stateBindings.length,
    registerCount: program.registerCount,
    stateCount: program.stateCount,
    sampleBindings: program.sampleBindings.length,
    customWaveBindings: program.customWaveBindings.length,
    midiControlBindings: program.midiControlBindings.length,
    tempoBindings: program.tempoBindings.length,
    maxVoices: program.maxVoices,
    usesMidiNote: program.usesMidiNote,
    usesMidiClock: program.usesMidiClock,
    errors: program.errors.slice(0, 8)
  };
}

// editor/src/graph/demoPatch.ts
var demoPatch = {
  name: "single-patch",
  nodes: [
    {
      id: "sine_1",
      type: "SineOsc",
      params: { frequency: 110 },
      position: { x: 80, y: 130 }
    },
    {
      id: "filter_1",
      type: "LowpassFilter",
      params: { cutoff: 900, resonance: 0.8 },
      position: { x: 380, y: 130 }
    },
    {
      id: "audio_out",
      type: "AudioOut",
      params: { level: 0.8 },
      position: { x: 680, y: 130 }
    }
  ],
  links: [
    {
      from: { node: "sine_1", port: "signal" },
      to: { node: "filter_1", port: "signal" },
      weight: 1,
      mode: "set"
    },
    {
      from: { node: "filter_1", port: "signal" },
      to: { node: "audio_out", port: "both" },
      weight: 0.85,
      mode: "set"
    }
  ]
};

// editor/src/editor/EdgeOverlayContext.tsx
import { createContext as createContext3, useContext } from "react";
import { jsx as jsx3 } from "react/jsx-runtime";
var EdgeOverlayContext = createContext3(null);
function EdgeOverlayProvider({ target, children }) {
  return /* @__PURE__ */ jsx3(EdgeOverlayContext.Provider, { value: target, children });
}
function useEdgeOverlayTarget() {
  return useContext(EdgeOverlayContext);
}

// editor/src/editor/canvasZoom.ts
var USER_ZOOM_BASELINE = 0.5;
function canvasHeaderTitleScale(zoom) {
  const normalizedZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : USER_ZOOM_BASELINE;
  const userZoom = normalizedZoom / USER_ZOOM_BASELINE;
  if (userZoom <= 0.3) return 2.2;
  if (userZoom <= 0.5) return 1.75;
  if (userZoom < 0.7) return 1.3;
  return 1;
}
function customWaveEditPointScreenScale(zoomScale) {
  const normalizedScale = Number.isFinite(zoomScale) && zoomScale > 0 ? zoomScale : 1;
  return Math.max(0.45, Math.min(1, normalizedScale / 0.7));
}
function graphDetailZoomScale(zoom) {
  const normalizedZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : USER_ZOOM_BASELINE;
  return normalizedZoom / USER_ZOOM_BASELINE;
}
function graphDetailScreenEmphasis(zoomScale) {
  const normalizedScale = Number.isFinite(zoomScale) && zoomScale > 0 ? zoomScale : 1;
  if (normalizedScale <= 1) return 1;
  return Math.min(1.32, 1 + Math.log2(normalizedScale) * 0.16);
}

// editor/src/editor/dspNodeScope.ts
function scopedDspNodeId(nodeId, groupIds) {
  return groupIds.length === 0 ? nodeId : `${groupIds.join("__")}__${nodeId}`;
}

// editor/src/editor/flowPatch.ts
var DEFAULT_SCOPE_NODE_SIZE = { width: 224, height: 48 };
var DEFAULT_JOYSTICK_NODE_SIZE = { width: 160, height: 120 };
var DEFAULT_FFT_NODE_SIZE = { width: 420, height: 96 };
var DEFAULT_KEYS_NODE_SIZE = { width: 372, height: 120 };
var DEFAULT_CUSTOM_WAVE_NODE_SIZE = { width: 372, height: 128 };
var DEFAULT_SEQUENCER_NODE_SIZE = { width: 416, height: 104 };
var SEQUENCER_MIN_CELL_SIZE = 22;
var DEFAULT_IMAGE_ASPECT_RATIO = 16 / 9;
function toFlowNodes(patch, callbacks, editingTypeNodeId) {
  return patch.nodes.map((patchNode) => ({
    id: patchNode.id,
    type: "shaderNode",
    position: patchNode.position ?? { x: 0, y: 0 },
    data: {
      patchNode,
      ...callbacks,
      isTypePickerOpen: editingTypeNodeId === patchNode.id
    }
  }));
}
function toFlowEdges(patch, onWeightChange, onModeChange, onInsertNode) {
  return expandWeightModulationEdges(
    patch.links.map((link) => edgeFromLink(link, onWeightChange, onModeChange, onInsertNode)),
    onWeightChange,
    onModeChange,
    onInsertNode
  );
}
function editorStateToFlowNodes(state, callbacks, editingTypeNodeId) {
  const normalizedState = normalizePersistedState(state);
  return normalizedState.nodes.map((node) => ({
    id: node.id,
    type: "shaderNode",
    position: node.position,
    data: {
      patchNode: {
        id: node.id,
        type: node.type,
        customLabel: node.customLabel,
        sequencerRowLabels: node.sequencerRowLabels,
        sequencerRowLabelColumnWidth: node.sequencerRowLabelColumnWidth,
        subpatchName: node.subpatchName,
        subpatchCloneId: node.subpatchCloneId,
        subpatchUiOverrides: node.subpatchUiOverrides,
        expression: node.expression,
        sample: node.sample,
        image: node.image,
        customWave: node.customWave ? normalizeCustomWave(node.customWave, node.params) : void 0,
        params: node.params,
        position: node.position,
        scale: node.scale,
        inputs: node.inputs,
        outputs: node.outputs,
        subpatch: node.subpatch,
        compactPorts: node.compactPorts,
        enabled: node.enabled,
        spreadNodeIds: node.spreadNodeIds,
        scopeSize: node.scopeSize
      },
      ...callbacks,
      isTypePickerOpen: editingTypeNodeId === node.id
    }
  }));
}
function editorStateToFlowEdges(state, onWeightChange, onModeChange, onInsertNode) {
  const normalizedState = normalizePersistedState(state);
  return expandWeightModulationEdges(normalizedState.edges.map((edge) => ({
    ...edge,
    type: "shaderEdge",
    data: {
      weight: edge.weight ?? 1,
      mode: edge.mode ?? "set",
      enabled: edge.enabled !== false,
      modulatesEdgeId: edge.modulatesEdgeId,
      weightModulations: edge.weightModulations,
      onWeightChange,
      onModeChange,
      onInsertNode,
      isFeedback: !edge.modulatesEdgeId && edge.source === edge.target
    },
    className: "shader-edge"
  })), onWeightChange, onModeChange, onInsertNode);
}
function flowToEditorState(nodes, edges, ui) {
  return {
    version: 1,
    ...ui ? { ui } : {},
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.data.patchNode.type,
      customLabel: node.data.patchNode.customLabel,
      sequencerRowLabels: node.data.patchNode.sequencerRowLabels,
      sequencerRowLabelColumnWidth: node.data.patchNode.sequencerRowLabelColumnWidth,
      subpatchName: node.data.patchNode.subpatchName,
      subpatchCloneId: node.data.patchNode.subpatchCloneId,
      subpatchUiOverrides: node.data.patchNode.subpatchUiOverrides,
      expression: node.data.patchNode.expression,
      sample: node.data.patchNode.sample,
      image: node.data.patchNode.image,
      customWave: node.data.patchNode.customWave ? normalizeCustomWave(node.data.patchNode.customWave, node.data.patchNode.params) : void 0,
      params: node.data.patchNode.params,
      position: node.position,
      scale: node.data.patchNode.scale,
      inputs: node.data.patchNode.inputs,
      outputs: node.data.patchNode.outputs,
      subpatch: node.data.patchNode.subpatch,
      compactPorts: node.data.patchNode.compactPorts,
      enabled: node.data.patchNode.enabled,
      spreadNodeIds: node.data.patchNode.spreadNodeIds,
      scopeSize: node.data.patchNode.scopeSize
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? null,
      target: edge.target,
      targetHandle: edge.targetHandle ?? null,
      weight: edge.data?.weight ?? 1,
      mode: edge.data?.mode ?? "set",
      ...edge.data?.enabled === false ? { enabled: false } : {},
      ...edge.data?.modulatesEdgeId ? { modulatesEdgeId: edge.data.modulatesEdgeId } : {},
      ...edge.data?.weightModulations?.length ? { weightModulations: edge.data.weightModulations } : {}
    }))
  };
}
function clampScopeNodeSize(size) {
  return normalizeNodeSize(size);
}
function clampControlNodeSize(size) {
  return normalizeNodeSize(size);
}
function clampKeysNodeSize(size) {
  return normalizeNodeSize(size);
}
function clampCustomWaveNodeSize(size) {
  return normalizeNodeSize(size);
}
function clampImageNodeSize(size, aspectRatio) {
  const aspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : DEFAULT_IMAGE_ASPECT_RATIO;
  const width = normalizeNodeDimension(size.width);
  return { width, height: normalizeNodeDimension(width / aspect) };
}
function clampSequencerNodeSize(size, steps, rows, labelColumnWidth = 0) {
  const safeSteps = Number.isFinite(steps) && steps > 0 ? steps : 1;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 1;
  const minimumWidth = Math.max(0, labelColumnWidth) + safeSteps * SEQUENCER_MIN_CELL_SIZE;
  const width = Math.max(minimumWidth, normalizeNodeDimension(size.width));
  const gridWidth = Math.max(1, width - Math.max(0, labelColumnWidth));
  return { width, height: normalizeNodeDimension(gridWidth * safeRows / safeSteps) };
}
function normalizeNodeSize(size) {
  return {
    width: normalizeNodeDimension(size.width),
    height: normalizeNodeDimension(size.height)
  };
}
function normalizeNodeDimension(value) {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}
function patchFromFlow(nodes, edges, areas) {
  const typedNodeIds = /* @__PURE__ */ new Set();
  const passthroughNodeIds = /* @__PURE__ */ new Set();
  const patchNodes = [];
  for (const node of nodes) {
    const patchNode = node.data.patchNode;
    if (patchNode.type === null) {
      passthroughNodeIds.add(patchNode.id);
      continue;
    }
    typedNodeIds.add(patchNode.id);
    patchNodes.push({
      id: patchNode.id,
      type: patchNode.type,
      ...patchNode.customLabel ? { customLabel: patchNode.customLabel } : {},
      ...patchNode.sequencerRowLabels ? { sequencerRowLabels: [...patchNode.sequencerRowLabels] } : {},
      ...patchNode.sequencerRowLabelColumnWidth !== void 0 ? { sequencerRowLabelColumnWidth: patchNode.sequencerRowLabelColumnWidth } : {},
      ...patchNode.subpatchName ? { subpatchName: patchNode.subpatchName } : {},
      ...patchNode.subpatchCloneId ? { subpatchCloneId: patchNode.subpatchCloneId } : {},
      ...patchNode.subpatchUiOverrides ? { subpatchUiOverrides: structuredClone(patchNode.subpatchUiOverrides) } : {},
      ...patchNode.expression !== void 0 ? { expression: patchNode.expression } : {},
      ...patchNode.sample ? { sample: patchNode.sample } : {},
      ...patchNode.image ? { image: patchNode.image } : {},
      ...patchNode.customWave ? { customWave: normalizeCustomWave(patchNode.customWave, patchNode.params) } : {},
      params: patchNode.params,
      position: node.position,
      ...patchNode.scale !== void 0 ? { scale: patchNode.scale } : {},
      ...patchNode.scopeSize ? { scopeSize: patchNode.scopeSize } : {},
      ...patchNode.inputs ? { inputs: patchNode.inputs } : {},
      ...patchNode.outputs ? { outputs: patchNode.outputs } : {},
      ...patchNode.subpatch ? { subpatch: patchNode.subpatch } : {},
      ...patchNode.compactPorts !== void 0 ? { compactPorts: patchNode.compactPorts } : {},
      ...patchNode.enabled === false ? { enabled: false } : {},
      ...patchNode.spreadNodeIds ? { spreadNodeIds: [...patchNode.spreadNodeIds] } : {}
    });
  }
  const modulationsByTarget = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    const targetId = edge.data?.modulatesEdgeId;
    if (targetId) modulationsByTarget.set(targetId, [...modulationsByTarget.get(targetId) ?? [], edge]);
  }
  const modulationFromEdge = (edge, visited) => {
    if (visited.has(edge.id)) return null;
    const source = parseHandle(edge.sourceHandle);
    if (source?.kind !== "out" || !typedNodeIds.has(edge.source)) return null;
    const nextVisited = /* @__PURE__ */ new Set([...visited, edge.id]);
    const nested = (modulationsByTarget.get(edge.id) ?? []).map((candidate) => modulationFromEdge(candidate, nextVisited)).filter((entry) => entry !== null);
    return {
      from: { node: edge.source, port: source.port },
      weight: edge.data?.weight ?? 1,
      mode: edge.data?.mode ?? "set",
      ...edge.data?.enabled === false ? { enabled: false } : {},
      ...nested.length ? { weightModulations: nested } : {}
    };
  };
  const links = edges.flatMap((edge) => {
    const link = linkFromEdge(edge);
    if (!link) return [];
    const nested = (modulationsByTarget.get(edge.id) ?? []).map((candidate) => modulationFromEdge(candidate, /* @__PURE__ */ new Set([edge.id]))).filter((entry) => entry !== null);
    return [{
      ...link,
      ...nested.length ? { weightModulations: [...link.weightModulations ?? [], ...nested] } : {}
    }];
  });
  return {
    nodes: patchNodes,
    links: materializeTypedLinks(links, typedNodeIds, passthroughNodeIds),
    ...areas && areas.length > 0 ? { areas: structuredClone(areas) } : {}
  };
}
function edgeFromLink(link, onWeightChange, onModeChange, onInsertNode) {
  return {
    id: edgeId(link),
    type: "shaderEdge",
    source: link.from.node,
    sourceHandle: `out:${link.from.port}`,
    target: link.to.node,
    targetHandle: `in:${link.to.port}`,
    data: {
      weight: link.weight ?? 1,
      mode: link.mode ?? "set",
      enabled: link.enabled !== false,
      weightModulations: link.weightModulations,
      onWeightChange,
      onModeChange,
      onInsertNode,
      isFeedback: link.from.node === link.to.node
    },
    className: "shader-edge"
  };
}
function expandWeightModulationEdges(edges, onWeightChange, onModeChange, onInsertNode) {
  const expanded = [];
  const append = (edge, modulation, index) => {
    const id = `weight-modulation:${edge.id}:${index}`;
    const child = {
      id,
      type: "shaderEdge",
      source: modulation.from.node,
      sourceHandle: `out:${modulation.from.port}`,
      target: edge.target,
      targetHandle: edge.targetHandle,
      className: "shader-edge",
      reconnectable: false,
      data: {
        weight: modulation.weight ?? 1,
        mode: modulation.mode ?? "set",
        enabled: modulation.enabled !== false,
        modulatesEdgeId: edge.id,
        onWeightChange,
        onModeChange,
        onInsertNode
      }
    };
    expanded.push(child);
    modulation.weightModulations?.forEach((nested, nestedIndex) => append(child, nested, nestedIndex));
  };
  for (const edge of edges) {
    expanded.push(edge.data?.weightModulations?.length ? { ...edge, data: { ...edge.data, weightModulations: void 0 } } : edge);
    edge.data?.weightModulations?.forEach((modulation, index) => append(edge, modulation, index));
  }
  return dedupeEdges(expanded);
}
function linkFromEdge(edge) {
  if (edge.data?.modulatesEdgeId) return null;
  const sourcePort = parseHandle(edge.sourceHandle);
  const targetPort = parseHandle(edge.targetHandle);
  if (!sourcePort || !targetPort) return null;
  if (sourcePort.kind === "out" && targetPort.kind === "in") {
    return {
      from: { node: edge.source, port: sourcePort.port },
      to: { node: edge.target, port: targetPort.port },
      weight: edge.data?.weight,
      mode: edge.data?.mode,
      ...edge.data?.enabled === false ? { enabled: false } : {},
      ...Array.isArray(edge.data?.weightModulations) ? { weightModulations: edge.data.weightModulations } : {}
    };
  }
  if (sourcePort.kind === "in" && targetPort.kind === "out") {
    return {
      from: { node: edge.target, port: targetPort.port },
      to: { node: edge.source, port: sourcePort.port },
      weight: edge.data?.weight,
      mode: edge.data?.mode,
      ...edge.data?.enabled === false ? { enabled: false } : {},
      ...Array.isArray(edge.data?.weightModulations) ? { weightModulations: edge.data.weightModulations } : {}
    };
  }
  return null;
}
function edgeId(link) {
  return `${link.from.node}:${link.from.port}->${link.to.node}:${link.to.port}`;
}
function materializeTypedLinks(links, typedNodeIds, passthroughNodeIds) {
  const outgoing = /* @__PURE__ */ new Map();
  for (const link of links) {
    outgoing.set(link.from.node, [...outgoing.get(link.from.node) ?? [], link]);
  }
  const materialized = [];
  for (const link of links) {
    if (!typedNodeIds.has(link.from.node)) continue;
    if (typedNodeIds.has(link.to.node)) {
      materialized.push(link);
      continue;
    }
    if (!passthroughNodeIds.has(link.to.node)) continue;
    for (const downstream of resolvePassthroughLinks(link.to.node, outgoing, typedNodeIds, passthroughNodeIds, /* @__PURE__ */ new Set())) {
      if (link.from.node === downstream.to.node) continue;
      materialized.push({
        from: link.from,
        to: downstream.to,
        weight: downstream.weight,
        mode: downstream.mode,
        enabled: link.enabled !== false && downstream.enabled !== false,
        weightModulations: downstream.weightModulations
      });
    }
  }
  return dedupePatchLinks(materialized);
}
function resolvePassthroughLinks(nodeId, outgoing, typedNodeIds, passthroughNodeIds, visited) {
  if (visited.has(nodeId)) return [];
  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);
  const resolved = [];
  for (const link of outgoing.get(nodeId) ?? []) {
    if (typedNodeIds.has(link.to.node)) {
      resolved.push(link);
      continue;
    }
    if (passthroughNodeIds.has(link.to.node)) {
      resolved.push(...resolvePassthroughLinks(link.to.node, outgoing, typedNodeIds, passthroughNodeIds, nextVisited).map((downstream) => ({
        ...downstream,
        enabled: link.enabled !== false && downstream.enabled !== false
      })));
    }
  }
  return resolved;
}
function dedupePatchLinks(links) {
  const deduped = [];
  const seen = /* @__PURE__ */ new Set();
  for (const link of links) {
    const key = edgeId(link);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
  }
  return deduped;
}
function parseHandle(handle) {
  if (!handle) return null;
  const [kind, port] = handle.split(":");
  if (kind !== "in" && kind !== "out" || !port) return null;
  return { kind, port };
}
function normalizePersistedState(state) {
  const originalNodesById = new Map(state.nodes.map((node) => [node.id, node]));
  const passthroughNodes = state.nodes.filter((node) => node.type === null);
  const typedNodes = state.nodes.filter(isKnownPersistedTypedNode).map((node) => ({
    id: node.id,
    type: node.type,
    ...node.customLabel ? { customLabel: node.customLabel } : {},
    ...node.sequencerRowLabels ? { sequencerRowLabels: [...node.sequencerRowLabels] } : {},
    ...node.sequencerRowLabelColumnWidth !== void 0 ? { sequencerRowLabelColumnWidth: node.sequencerRowLabelColumnWidth } : {},
    ...node.subpatchName ? { subpatchName: node.subpatchName } : {},
    ...node.subpatchCloneId ? { subpatchCloneId: node.subpatchCloneId } : {},
    ...node.subpatchUiOverrides ? { subpatchUiOverrides: structuredClone(node.subpatchUiOverrides) } : {},
    ...node.expression !== void 0 ? { expression: node.expression } : {},
    ...node.sample ? { sample: node.sample } : {},
    ...node.image ? { image: node.image } : {},
    ...node.customWave ? { customWave: normalizeCustomWave(node.customWave, normalizePersistedNodeParams(node)) } : {},
    params: normalizePersistedNodeParams(node),
    position: node.position,
    ...node.scale !== void 0 ? { scale: node.scale } : {},
    ...node.inputs ? { inputs: normalizePersistedInputDefinitions(node) } : {},
    ...node.outputs ? { outputs: normalizePersistedOutputDefinitions(node) } : {},
    ...node.subpatch ? { subpatch: normalizePatchCompatibility(node.subpatch) } : {},
    ...node.compactPorts !== void 0 ? { compactPorts: node.compactPorts } : {},
    ...node.enabled === false ? { enabled: false } : {},
    ...node.spreadNodeIds ? { spreadNodeIds: [...node.spreadNodeIds] } : {},
    ...node.scopeSize ? { scopeSize: node.scopeSize } : {}
  }));
  const typedPatch = {
    nodes: typedNodes,
    links: state.edges.filter((edge) => !edge.modulatesEdgeId).map(patchLinkFromPersistedEdge).map((link) => normalizePersistedPatchLink(link, originalNodesById)).filter((link) => link !== null && persistedLinkPortsExist(link, originalNodesById))
  };
  const normalizedTypedPatch = normalizePatchCompatibility(typedPatch);
  return {
    ...state,
    ui: normalizePersistedUi(state.ui),
    nodes: [
      ...normalizedTypedPatch.nodes.map((node) => persistedNodeFromPatchNode(node, originalNodesById.get(node.id))),
      ...passthroughNodes
    ],
    edges: [
      ...normalizedTypedPatch.links.map(persistedEdgeFromPatchLink),
      ...state.edges.filter((edge) => edge.modulatesEdgeId && originalNodesById.has(edge.source))
    ]
  };
}
function normalizePersistedUi(ui) {
  if (!ui) return ui;
  const selectedDeviceIds = normalizeSelectedMidiDeviceIds2(ui.midiInput?.selectedDeviceIds);
  const selectedOutputDeviceIds = normalizeSelectedMidiDeviceIds2(ui.midiInput?.selectedOutputDeviceIds);
  const sendClock = ui.midiInput?.sendClock === true;
  const { midiInput: _midiInput, ...nextUi } = ui;
  return {
    ...nextUi,
    ...selectedDeviceIds.length > 0 || selectedOutputDeviceIds.length > 0 || sendClock ? { midiInput: {
      selectedDeviceIds,
      ...selectedOutputDeviceIds.length > 0 ? { selectedOutputDeviceIds } : {},
      ...sendClock ? { sendClock: true } : {}
    } } : {}
  };
}
function normalizeSelectedMidiDeviceIds2(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.length > 0))];
}
function isKnownPersistedTypedNode(node) {
  return isKnownNodeType(node.type);
}
function isKnownNodeType(value) {
  if (typeof value !== "string") return false;
  const definition = getDefinition(value);
  return definition?.type === value;
}
function persistedLinkPortsExist(link, nodesById) {
  return persistedPortExists(nodesById.get(link.from.node), "outputs", link.from.port) && persistedPortExists(nodesById.get(link.to.node), "inputs", link.to.port);
}
function persistedPortExists(node, side, port) {
  if (!node) return false;
  if (node.type === null) return true;
  if (!isKnownNodeType(node.type)) return false;
  return getNodeDefinition({
    id: node.id,
    type: node.type,
    params: normalizePersistedNodeParams(node),
    ...node.inputs ? { inputs: normalizePersistedInputDefinitions(node) } : {},
    ...node.outputs ? { outputs: normalizePersistedOutputDefinitions(node) } : {}
  })[side].some((entry) => entry.name === port);
}
function normalizePersistedNodeParams(node) {
  if (node.type === "CustomWave" && node.params.phaseReset !== void 0) {
    const { phaseReset, ...params2 } = node.params;
    return {
      ...params2,
      trigger: node.params.trigger ?? phaseReset
    };
  }
  if (node.type !== "SamplePlayer" || node.params.originalFrequency !== void 0 || node.params.originalPitch === void 0) {
    return node.params;
  }
  const { originalPitch, ...params } = node.params;
  return {
    ...params,
    originalFrequency: midiNoteFrequency(originalPitch)
  };
}
function normalizePersistedInputDefinitions(node) {
  if (node.type === "CustomWave") {
    return node.inputs?.map((input) => input.name === "phaseReset" ? { ...input, name: "trigger" } : input);
  }
  if (node.type !== "SamplePlayer") return node.inputs;
  return node.inputs?.map((input) => input.name === "originalPitch" ? { ...input, name: "originalFrequency", defaultValue: input.defaultValue === 60 ? 440 : input.defaultValue } : input);
}
function normalizePersistedOutputDefinitions(node) {
  if (node.type === "CustomWave") {
    return void 0;
  }
  if (node.type !== "Reverb") return node.outputs;
  const outputs = node.outputs?.filter((output) => output.name !== "signal");
  return outputs && outputs.length > 0 ? outputs : void 0;
}
function normalizePersistedPatchLink(link, nodesById) {
  if (!link) return null;
  const sourceNode = nodesById.get(link.from.node);
  if (sourceNode?.type === "Reverb" && link.from.port === "signal") {
    return {
      ...link,
      from: {
        ...link.from,
        port: "left"
      }
    };
  }
  const targetNode = nodesById.get(link.to.node);
  if (targetNode?.type === "CustomWave" && link.to.port === "phaseReset") {
    return {
      ...link,
      to: {
        ...link.to,
        port: "trigger"
      }
    };
  }
  if (targetNode?.type === "Sequencer" && link.to.port === "tick") {
    return {
      ...link,
      to: {
        ...link.to,
        port: "signal"
      }
    };
  }
  if (targetNode?.type !== "SamplePlayer" || link.to.port !== "originalPitch") return link;
  return {
    ...link,
    to: {
      ...link.to,
      port: "originalFrequency"
    }
  };
}
function midiNoteFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}
function patchLinkFromPersistedEdge(edge) {
  const sourcePort = parseHandle(edge.sourceHandle);
  const targetPort = parseHandle(edge.targetHandle);
  if (!sourcePort || !targetPort || sourcePort.kind !== "out" || targetPort.kind !== "in") return null;
  return {
    from: { node: edge.source, port: sourcePort.port },
    to: { node: edge.target, port: targetPort.port },
    ...edge.weight !== void 0 ? { weight: edge.weight } : {},
    ...edge.mode !== void 0 ? { mode: edge.mode } : {},
    ...edge.enabled === false ? { enabled: false } : {},
    ...edge.weightModulations ? { weightModulations: edge.weightModulations } : {}
  };
}
function persistedNodeFromPatchNode(node, original) {
  return {
    id: node.id,
    type: node.type,
    customLabel: node.customLabel,
    sequencerRowLabels: node.sequencerRowLabels,
    sequencerRowLabelColumnWidth: node.sequencerRowLabelColumnWidth,
    subpatchName: node.subpatchName,
    subpatchCloneId: node.subpatchCloneId,
    subpatchUiOverrides: node.subpatchUiOverrides,
    expression: node.expression,
    sample: node.sample,
    image: node.image,
    customWave: node.customWave,
    params: node.params,
    position: node.position ?? original?.position ?? { x: 0, y: 0 },
    scale: node.scale ?? original?.scale,
    inputs: node.inputs,
    outputs: node.outputs,
    subpatch: node.subpatch,
    compactPorts: node.compactPorts ?? original?.compactPorts,
    enabled: node.enabled,
    spreadNodeIds: node.spreadNodeIds ?? original?.spreadNodeIds,
    scopeSize: node.scopeSize ?? original?.scopeSize
  };
}
function persistedEdgeFromPatchLink(link) {
  return {
    id: edgeId(link),
    source: link.from.node,
    sourceHandle: `out:${link.from.port}`,
    target: link.to.node,
    targetHandle: `in:${link.to.port}`,
    weight: link.weight ?? 1,
    mode: link.mode ?? "set",
    ...link.enabled === false ? { enabled: false } : {},
    ...link.weightModulations?.length ? { weightModulations: link.weightModulations } : {}
  };
}
function dedupeEdges(edges) {
  const deduped = [];
  const seen = /* @__PURE__ */ new Map();
  const aliases = /* @__PURE__ */ new Map();
  const byId = new Map(edges.map((edge) => [edge.id, edge]));
  const identity = (edge, visited = /* @__PURE__ */ new Set()) => {
    const parent = edge.data?.modulatesEdgeId ? byId.get(edge.data.modulatesEdgeId) : void 0;
    if (!parent || visited.has(edge.id)) return linkFromEdge(edge) ? edgeId(linkFromEdge(edge)) : edge.id;
    return JSON.stringify([edge.source, edge.sourceHandle, identity(parent, /* @__PURE__ */ new Set([...visited, edge.id]))]);
  };
  for (const edge of edges) {
    const link = linkFromEdge(edge);
    const key = identity(edge);
    const existing = seen.get(key);
    if (existing) {
      aliases.set(edge.id, existing.id);
      if (edge.selected) existing.selected = true;
      continue;
    }
    const next = { ...edge, id: link ? edgeId(link) : edge.id };
    aliases.set(edge.id, next.id);
    seen.set(key, next);
    deduped.push(next);
  }
  return deduped.map((edge) => edge.data?.modulatesEdgeId ? { ...edge, data: { ...edge.data, modulatesEdgeId: aliases.get(edge.data.modulatesEdgeId) ?? edge.data.modulatesEdgeId } } : edge);
}

// editor/src/editor/ShaderEdge.tsx
import {
  BaseEdge,
  getBezierPath,
  Position,
  useReactFlow,
  useViewport,
  useStoreApi
} from "@xyflow/react";
import { XYHandle } from "@xyflow/system";
import { memo, useEffect as useEffect4, useRef as useRef5, useState as useState5 } from "react";
import { createPortal } from "react-dom";

// editor/src/editor/numericDisplay.ts
function formatNumericValue(value) {
  if (!Number.isFinite(value)) return "0";
  if (Object.is(value, -0)) return "0";
  return String(value);
}

// editor/src/editor/ShaderEdge.tsx
import { Fragment, jsx as jsx4, jsxs as jsxs3 } from "react/jsx-runtime";
var LINK_CONTROLS_SHOW_DELAY_MS = 260;
var VirtualRouteEdge = memo(function VirtualRouteEdge2(props) {
  const [path] = getBezierPath({
    ...props,
    sourceX: props.data?.visualSource?.x ?? props.sourceX,
    sourceY: props.data?.visualSource?.y ?? props.sourceY,
    targetX: props.data?.visualTarget?.x ?? props.targetX,
    targetY: props.data?.visualTarget?.y ?? props.targetY,
    sourcePosition: Position.Right,
    targetPosition: Position.Left
  });
  return /* @__PURE__ */ jsx4("path", { d: path, className: "virtual-route-edge", style: props.style, fill: "none", pointerEvents: "none" });
});
var FEEDBACK_CURVE_OFFSET = 142;
var SAME_NODE_FEEDBACK_CURVE_OFFSET = 220;
var SHORT_LINK_CONTROLS_DISTANCE = 144;
var SHORT_LINK_CONTROLS_OFFSET = 52;
var ShaderEdge = memo(function ShaderEdge2(props) {
  const store = useStoreApi();
  const [linkControlsVisible, setLinkControlsVisible] = useState5(false);
  const isSameNodeFeedback = props.source === props.target && !props.data?.modulatesEdgeId;
  const isFeedback = props.data?.isFeedback === true || isSameNodeFeedback;
  const isControl = props.data?.isControl === true;
  const visualProps = {
    ...props,
    sourceX: props.data?.visualSource?.x ?? props.sourceX,
    sourceY: props.data?.visualSource?.y ?? props.sourceY,
    targetX: props.data?.visualTarget?.x ?? props.targetX,
    targetY: props.data?.visualTarget?.y ?? props.targetY,
    sourcePosition: props.data?.visualSource ? Position.Right : props.sourcePosition,
    targetPosition: props.data?.visualTarget ? Position.Left : props.targetPosition
  };
  const [edgePath, labelX, labelY] = getShaderEdgePath(visualProps);
  const overlayTarget = useEdgeOverlayTarget();
  const reactFlow = useReactFlow();
  const viewport = useViewport();
  const screenPosition = reactFlow.flowToScreenPosition({ x: labelX, y: labelY });
  const weight = props.data?.weight ?? 1;
  const mode = props.data?.mode ?? "set";
  const enabled = props.data?.enabled !== false && props.data?.isIncidentToDisabledNode !== true;
  const dspErrors = props.data?.dspErrors ?? [];
  const hasDspErrors = dspErrors.length > 0;
  const selected = props.selected ?? false;
  const isConnectedToSelectedNode = props.data?.isConnectedToSelectedNode === true;
  const isDimmedBySelection = props.data?.isDimmedBySelection === true && !props.data?.isWeightTarget;
  const emphasized = selected || isConnectedToSelectedNode || props.data?.isWeightTarget === true;
  const showLinkControls = selected && props.data?.showLinkControls === true;
  const controlsLabelY = shouldRaiseLinkControls(visualProps, isFeedback) ? labelY - SHORT_LINK_CONTROLS_OFFSET : labelY;
  const underlayClassName = [
    "shader-edge-path",
    "shader-edge-path-underlay",
    `shader-edge-path-mode-${mode}`,
    isFeedback ? "shader-edge-path-feedback" : "",
    isControl ? "shader-edge-path-control" : "",
    enabled ? "" : "shader-edge-path-disabled",
    hasDspErrors ? "shader-edge-path-dsp-error" : "",
    isDimmedBySelection ? "shader-edge-path-dimmed" : ""
  ].join(" ");
  const edgeClassName = [
    "shader-edge-path",
    "shader-edge-path-foreground",
    `shader-edge-path-mode-${mode}`,
    isFeedback ? "shader-edge-path-feedback" : "",
    isControl ? "shader-edge-path-control" : "",
    enabled ? "" : "shader-edge-path-disabled",
    hasDspErrors ? "shader-edge-path-dsp-error" : "",
    emphasized ? "shader-edge-path-selected" : "",
    isDimmedBySelection ? "shader-edge-path-dimmed" : ""
  ].filter(Boolean).join(" ");
  const selectedUnderlayStyle = emphasized ? { stroke: "var(--color-edge-underlay)", strokeWidth: 8 } : void 0;
  const selectedForegroundStyle = emphasized ? { strokeWidth: 4 } : void 0;
  useEffect4(() => {
    if (!showLinkControls) {
      setLinkControlsVisible(false);
      return;
    }
    const timeoutId = window.setTimeout(() => setLinkControlsVisible(true), LINK_CONTROLS_SHOW_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [showLinkControls]);
  if (props.data?.isReconnecting) return null;
  return /* @__PURE__ */ jsxs3(Fragment, { children: [
    /* @__PURE__ */ jsx4(
      BaseEdge,
      {
        id: `${props.id}-underlay`,
        path: edgePath,
        className: underlayClassName,
        style: selectedUnderlayStyle,
        interactionWidth: 0,
        "aria-hidden": "true"
      }
    ),
    /* @__PURE__ */ jsx4(
      BaseEdge,
      {
        id: props.id,
        path: edgePath,
        className: edgeClassName,
        style: selectedForegroundStyle,
        interactionWidth: isSameNodeFeedback ? 44 : isFeedback ? 36 : 18
      }
    ),
    selected && props.data?.modulatesEdgeId && !props.data.isAreaCollapsedPresentation ? /* @__PURE__ */ jsx4(
      "circle",
      {
        cx: visualProps.targetX,
        cy: visualProps.targetY,
        r: 6,
        className: "strength-input-handle nodrag nopan",
        "aria-label": "Reconnect link strength input",
        onMouseDown: (event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          const state = store.getState();
          const edge = state.edgeLookup.get(props.id);
          if (!edge) return;
          XYHandle.onPointerDown(event.nativeEvent, {
            autoPanOnConnect: state.autoPanOnConnect,
            autoPanSpeed: state.autoPanSpeed,
            connectionMode: state.connectionMode,
            connectionRadius: state.connectionRadius,
            domNode: state.domNode,
            handleId: edge.sourceHandle ?? null,
            nodeId: edge.source,
            nodeLookup: state.nodeLookup,
            isTarget: false,
            edgeUpdaterType: "source",
            lib: state.lib,
            flowId: state.rfId,
            cancelConnection: state.cancelConnection,
            panBy: state.panBy,
            isValidConnection: (...args) => store.getState().isValidConnection?.(...args) ?? true,
            onConnect: (connection) => edge.data?.onReconnect?.(edge, connection),
            onConnectStart: (nativeEvent, params) => {
              edge.data?.onReconnectStart?.(event, edge, "source");
              store.getState().onConnectStart?.(nativeEvent, params);
            },
            onConnectEnd: (...args) => store.getState().onConnectEnd?.(...args),
            onReconnectEnd: (nativeEvent, connectionState) => edge.data?.onReconnectEnd?.(nativeEvent, edge, "source", connectionState),
            updateConnection: state.updateConnection,
            getTransform: () => store.getState().transform,
            getFromHandle: () => store.getState().connection.fromHandle,
            dragThreshold: state.connectionDragThreshold,
            handleDomNode: event.currentTarget
          });
        }
      }
    ) : null,
    showLinkControls && linkControlsVisible && overlayTarget ? createPortal(
      /* @__PURE__ */ jsx4(
        "div",
        {
          className: "edge-weight-label nodrag nopan",
          style: {
            left: screenPosition.x,
            top: reactFlow.flowToScreenPosition({ x: labelX, y: controlsLabelY }).y,
            transform: `translate(-50%, -50%) scale(${viewport.zoom})`
          },
          children: /* @__PURE__ */ jsx4(
            EdgeLinkControls,
            {
              value: weight,
              mode,
              enabled,
              onChange: (nextWeight) => props.data?.onWeightChange(props.id, nextWeight),
              onModeChange: (nextMode) => props.data?.onModeChange(props.id, nextMode),
              onEnabledChange: (nextEnabled) => props.data?.onEnabledChange?.(props.id, nextEnabled)
            }
          )
        }
      ),
      overlayTarget
    ) : null,
    hasDspErrors && overlayTarget ? createPortal(
      /* @__PURE__ */ jsx4(
        "div",
        {
          className: "edge-error-label",
          style: {
            left: screenPosition.x,
            top: screenPosition.y,
            transform: `translate(-50%, calc(-50% - 18px)) scale(${viewport.zoom})`
          },
          title: dspErrors.join("\n"),
          "aria-label": `${dspErrors.length} DSP error${dspErrors.length === 1 ? "" : "s"}`,
          children: "!"
        }
      ),
      overlayTarget
    ) : null
  ] });
});
function shouldRaiseLinkControls(props, isFeedback) {
  if (isFeedback) return false;
  return Math.hypot(props.targetX - props.sourceX, props.targetY - props.sourceY) < SHORT_LINK_CONTROLS_DISTANCE;
}
function getShaderEdgePath(props) {
  const sameNode = props.source === props.target && !props.data?.modulatesEdgeId;
  if (sameNode || props.data?.isFeedback) {
    return getFeedbackPath(props, sameNode ? SAME_NODE_FEEDBACK_CURVE_OFFSET : FEEDBACK_CURVE_OFFSET);
  }
  const [path, x, y] = getBezierPath(props);
  return [path, x, y];
}
function getFeedbackPath(props, minimumOffset) {
  const sourceX = props.sourceX;
  const sourceY = props.sourceY;
  const targetX = props.targetX;
  const targetY = props.targetY;
  if (props.source === props.target) {
    return getSameNodeFeedbackPath(props, minimumOffset);
  }
  const horizontalDistance = Math.abs(sourceX - targetX);
  const verticalDistance = Math.abs(sourceY - targetY);
  const offset = Math.max(minimumOffset, horizontalDistance * 0.8 + verticalDistance * 0.2);
  const path = [
    `M ${sourceX},${sourceY}`,
    `C ${sourceX + offset},${sourceY}`,
    `${targetX - offset},${targetY}`,
    `${targetX},${targetY}`
  ].join(" ");
  return [
    path,
    (sourceX + targetX) / 2,
    (sourceY + targetY) / 2
  ];
}
function getSameNodeFeedbackPath(props, minimumOffset) {
  const sourceX = props.sourceX;
  const sourceY = props.sourceY;
  const targetX = props.targetX;
  const targetY = props.targetY;
  const horizontalDistance = Math.abs(sourceX - targetX);
  const verticalDistance = Math.abs(sourceY - targetY);
  const offset = Math.max(minimumOffset * 0.36, horizontalDistance * 0.34 + verticalDistance * 0.12);
  const bow = Math.min(32, Math.max(16, verticalDistance * 0.2 + 16));
  const controlY = Math.min(sourceY, targetY) - bow;
  const path = [
    `M ${sourceX},${sourceY}`,
    `C ${sourceX + offset},${controlY}`,
    `${targetX - offset},${controlY}`,
    `${targetX},${targetY}`
  ].join(" ");
  return [
    path,
    (sourceX + targetX) / 2,
    0.125 * sourceY + 0.75 * controlY + 0.125 * targetY
  ];
}
function EdgeLinkControls({ value, mode, enabled, onChange, onModeChange, onEnabledChange }) {
  return /* @__PURE__ */ jsxs3(Fragment, { children: [
    /* @__PURE__ */ jsxs3("div", { className: "edge-link-value-row", children: [
      /* @__PURE__ */ jsx4(EdgeWeightScrubber, { value, onChange }),
      /* @__PURE__ */ jsx4(
        "button",
        {
          className: `edge-link-enabled-toggle nodrag nopan${enabled ? " edge-link-enabled-toggle-active" : ""}`,
          type: "button",
          onClick: (event) => {
            event.stopPropagation();
            onEnabledChange(!enabled);
          },
          onPointerDown: (event) => event.stopPropagation(),
          onMouseDown: (event) => event.stopPropagation(),
          onDoubleClick: (event) => event.stopPropagation(),
          "aria-label": enabled ? "Disable link" : "Enable link",
          "aria-pressed": enabled,
          title: enabled ? "Disable link" : "Enable link"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs3(
      "select",
      {
        className: "edge-link-mode nodrag nopan",
        value: mode,
        onChange: (event) => {
          onModeChange(event.target.value);
          event.currentTarget.blur();
        },
        onPointerDown: (event) => event.stopPropagation(),
        onMouseDown: (event) => event.stopPropagation(),
        onDoubleClick: (event) => event.stopPropagation(),
        "aria-label": "Link mode",
        title: "Link mode",
        children: [
          /* @__PURE__ */ jsx4("option", { value: "set", children: "set" }),
          /* @__PURE__ */ jsx4("option", { value: "add", children: "add" }),
          /* @__PURE__ */ jsx4("option", { value: "multiply", children: "multiply" }),
          /* @__PURE__ */ jsx4("option", { value: "bend", children: "bend" })
        ]
      }
    )
  ] });
}
function EdgeWeightScrubber({ value, onChange }) {
  const [editing, setEditing] = useState5(false);
  const [draft, setDraft] = useState5(formatNumericValue(value));
  const inputRef = useRef5(null);
  const wheelValueRef = useRef5(value);
  const lastWheelTimeRef = useRef5(-Infinity);
  const wheelTargetRef = useRef5(null);
  const latestValueRef = useRef5(value);
  const onChangeRef = useRef5(onChange);
  latestValueRef.current = value;
  onChangeRef.current = onChange;
  const dragRef = useRef5(null);
  useEffect4(() => {
    if (!editing) {
      setDraft(formatNumericValue(value));
    }
  }, [editing, value]);
  useEffect4(() => {
    if (!editing) return;
    setDraft(formatNumericValue(value));
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [editing, value]);
  useEffect4(() => {
    const target = wheelTargetRef.current;
    if (!target || editing) return;
    const handleWheel = (event) => {
      if (!event.shiftKey && !event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.timeStamp - lastWheelTimeRef.current > 160) {
        wheelValueRef.current = latestValueRef.current;
      }
      lastWheelTimeRef.current = event.timeStamp;
      const wheelDelta = verticalWheelDeltaPixels(event);
      if (wheelDelta === 0) return;
      const nextValue = roundValue(wheelValueRef.current + wheelDelta * scrubberStep(event));
      wheelValueRef.current = nextValue;
      onChangeRef.current(nextValue);
    };
    target.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => target.removeEventListener("wheel", handleWheel, { capture: true });
  }, [editing]);
  function startDrag(event) {
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      anchorY: event.clientY,
      anchorValue: value,
      currentValue: value,
      step: scrubberStep(event),
      dragging: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function updateDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = drag.anchorY - event.clientY;
    if (!drag.dragging && Math.abs(distance) < 3) return;
    drag.dragging = true;
    event.preventDefault();
    event.stopPropagation();
    const step = scrubberStep(event);
    if (step !== drag.step) {
      drag.anchorY = event.clientY;
      drag.anchorValue = drag.currentValue;
      drag.step = step;
    }
    const nextValue = roundValue(drag.anchorValue + (drag.anchorY - event.clientY) * drag.step);
    drag.currentValue = nextValue;
    onChange(nextValue);
  }
  function endDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    if (drag.dragging) {
      event.currentTarget.blur();
    } else {
      setEditing(true);
    }
  }
  function commitDraft() {
    const nextValue = Number(draft.trim());
    if (Number.isFinite(nextValue)) {
      onChange(nextValue);
    } else {
      setDraft(formatNumericValue(value));
    }
    setEditing(false);
  }
  function cancelDraft() {
    setDraft(formatNumericValue(value));
    setEditing(false);
  }
  function handleEditKeyDown(event) {
    event.stopPropagation();
    if (event.key === "Enter") {
      commitDraft();
    }
    if (event.key === "Escape") {
      cancelDraft();
    }
  }
  if (editing) {
    return /* @__PURE__ */ jsx4(
      "input",
      {
        ref: inputRef,
        className: "edge-weight-scrubber edge-weight-scrubber-editing nodrag nopan",
        type: "text",
        inputMode: "decimal",
        value: draft,
        onChange: (event) => setDraft(event.target.value),
        onBlur: commitDraft,
        onKeyDown: handleEditKeyDown,
        onPointerDown: (event) => event.stopPropagation(),
        onMouseDown: (event) => event.stopPropagation(),
        onDoubleClick: (event) => event.stopPropagation(),
        spellCheck: false
      }
    );
  }
  return /* @__PURE__ */ jsx4(
    "div",
    {
      ref: wheelTargetRef,
      className: "edge-weight-scrubber nodrag nopan",
      role: "spinbutton",
      tabIndex: -1,
      "aria-valuenow": value,
      onPointerDown: startDrag,
      onPointerMove: updateDrag,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onMouseDown: (event) => event.stopPropagation(),
      onDoubleClick: (event) => event.stopPropagation(),
      onKeyDown: (event) => {
        if (event.key === "Enter") {
          event.stopPropagation();
          setEditing(true);
        }
      },
      children: formatNumericValue(value)
    }
  );
}
function roundValue(value) {
  return Math.round(value * 1e4) / 1e4;
}
function scrubberStep(event) {
  if (event.metaKey && event.shiftKey) return 2;
  if (event.metaKey) return 0.2;
  if (event.shiftKey) return 1e-3;
  return 0.01;
}
function verticalWheelDeltaPixels(event) {
  const delta = event.deltaY;
  if (event.deltaMode === 1) return delta * 16;
  if (event.deltaMode === 2) return delta * window.innerHeight;
  return delta;
}

// editor/src/editor/ShaderNode.tsx
import { Handle, Position as Position2, useConnection, useReactFlow as useReactFlow2, useUpdateNodeInternals } from "@xyflow/react";
import {
  memo as memo2,
  useEffect as useEffect5,
  useContext as useContext2,
  useId,
  useLayoutEffect,
  useMemo as useMemo4,
  useRef as useRef6,
  useState as useState6
} from "react";

// editor/src/audio/sampleWaveformCache.ts
var MAX_CACHED_WAVEFORMS = 48;
var waveformCache = /* @__PURE__ */ new Map();
function getSampleWaveform(url) {
  const existing = waveformCache.get(url);
  if (existing) {
    waveformCache.delete(url);
    waveformCache.set(url, existing);
    return existing;
  }
  const request = analyseSampleWaveform(url).catch(() => null);
  waveformCache.set(url, request);
  void request.then((waveform) => {
    if (waveform === null) {
      if (waveformCache.get(url) === request) waveformCache.delete(url);
      return;
    }
    while (waveformCache.size > MAX_CACHED_WAVEFORMS) {
      const oldestUrl = waveformCache.keys().next().value;
      if (typeof oldestUrl !== "string") break;
      waveformCache.delete(oldestUrl);
    }
  });
  return request;
}
async function analyseSampleWaveform(url) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) return null;
  const OfflineAudioContextConstructor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineAudioContextConstructor) return null;
  const context = new OfflineAudioContextConstructor(1, 1, 44100);
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  return {
    bins: sampleWaveformBins(buffer, 720),
    duration: Math.max(1e-3, buffer.duration)
  };
}
function sampleWaveformBins(buffer, count) {
  const bins = [];
  const framesPerBin = Math.max(1, Math.ceil(buffer.length / count));
  for (let start = 0; start < buffer.length; start += framesPerBin) {
    const end = Math.min(buffer.length, start + framesPerBin);
    let min = 0;
    let max = 0;
    for (let frame = start; frame < end; frame += 1) {
      let value = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        value += buffer.getChannelData(channel)[frame] / buffer.numberOfChannels;
      }
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    bins.push({ min, max });
  }
  return bins;
}

// editor/src/editor/chartGrid.tsx
import { jsx as jsx5, jsxs as jsxs4 } from "react/jsx-runtime";
function ChartGrid({
  width,
  height,
  columns,
  rows,
  className = "",
  showColumnLabels = false,
  showRowLabels = false
}) {
  return /* @__PURE__ */ jsxs4("div", { className: ["audio-chart-grid-layer", className].filter(Boolean).join(" "), "aria-hidden": "true", children: [
    /* @__PURE__ */ jsxs4("svg", { className: "audio-chart-grid", viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", focusable: "false", children: [
      columns.map((tick) => /* @__PURE__ */ jsx5(
        "line",
        {
          className: tick.major ? "audio-chart-grid-line audio-chart-grid-line-major" : "audio-chart-grid-line",
          x1: tick.fraction * width,
          y1: "0",
          x2: tick.fraction * width,
          y2: height
        },
        `column-${tick.fraction}`
      )),
      rows.map((tick) => /* @__PURE__ */ jsx5(
        "line",
        {
          className: [
            "audio-chart-grid-line",
            tick.major === false ? "" : "audio-chart-grid-line-major",
            tick.origin ? "audio-chart-grid-line-origin" : ""
          ].filter(Boolean).join(" "),
          x1: "0",
          y1: tick.fraction * height,
          x2: width,
          y2: tick.fraction * height
        },
        `row-${tick.fraction}`
      ))
    ] }),
    showColumnLabels ? /* @__PURE__ */ jsx5("span", { className: "audio-chart-grid-column-scale", children: columns.map((tick) => tick.label === void 0 ? null : /* @__PURE__ */ jsx5(
      "span",
      {
        className: [
          "audio-chart-grid-column-scale-label",
          tick.fraction === 0 ? "audio-chart-grid-column-scale-label-start" : "",
          tick.fraction === 1 ? "audio-chart-grid-column-scale-label-end" : ""
        ].filter(Boolean).join(" "),
        style: { left: `${tick.fraction * 100}%` },
        children: tick.label
      },
      `column-label-${tick.fraction}`
    )) }) : null,
    showRowLabels ? /* @__PURE__ */ jsx5("span", { className: "audio-chart-grid-row-scale", children: rows.map((tick) => tick.label === void 0 ? null : /* @__PURE__ */ jsx5(
      "span",
      {
        className: [
          "audio-chart-grid-row-scale-label",
          tick.fraction === 0 ? "audio-chart-grid-row-scale-label-top" : "",
          tick.fraction === 1 ? "audio-chart-grid-row-scale-label-bottom" : ""
        ].filter(Boolean).join(" "),
        style: { top: `${tick.fraction * 100}%` },
        children: tick.label
      },
      `label-${tick.fraction}`
    )) }) : null
  ] });
}
function chartScaleTicks(start, end, size, orientation) {
  const divisions = chartLabelDivisions(size, orientation);
  return Array.from({ length: divisions + 1 }, (_, index) => {
    const fraction = index / divisions;
    return {
      fraction,
      label: formatChartValue(start + (end - start) * fraction),
      major: true
    };
  });
}
function chartGridColumns(width) {
  const labelDivisions = chartLabelDivisions(width, "horizontal");
  const divisions = width >= 1120 ? 128 : width >= 840 ? 96 : width >= 560 ? 64 : width >= 400 ? 48 : width >= 280 ? 32 : width >= 200 ? 24 : 12;
  const majorStep = divisions / labelDivisions;
  return Array.from({ length: divisions + 1 }, (_, index) => ({
    fraction: index / divisions,
    major: index % majorStep === 0
  }));
}
function chartGridRows(height) {
  const rows = height >= 336 ? 16 : height >= 224 ? 12 : height >= 112 ? 8 : height >= 84 ? 6 : height >= 64 ? 4 : 2;
  return Array.from({ length: rows }, (_, index) => ({
    fraction: (index + 1) / (rows + 1),
    major: false
  }));
}
function chartLabelDivisions(size, orientation) {
  return orientation === "horizontal" ? size >= 1120 ? 16 : size >= 560 ? 8 : size >= 360 ? 4 : 2 : size >= 352 ? 16 : size >= 176 ? 8 : size >= 104 ? 4 : 2;
}
function formatChartValue(value) {
  if (!Number.isFinite(value)) return "0";
  const absoluteValue = Math.abs(value);
  const formatted = absoluteValue >= 100 ? `${Math.round(value)}` : absoluteValue >= 10 ? value.toFixed(1) : absoluteValue >= 1 ? value.toFixed(2) : value.toFixed(3);
  return formatted.includes(".") ? formatted.replace(/\.?0+$/, "") : formatted;
}

// editor/src/editor/ShaderNode.tsx
import { Fragment as Fragment2, jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
var CUSTOM_WAVE_DRAG_UPDATE_INTERVAL_MS = 50;
var FFT_CAPTURE_SECONDS = 0.012;
var FFT_ANALYSIS_MIN_FREQUENCY = 20;
var FFT_ANALYSIS_MAX_FREQUENCY = 2e4;
var ShaderNode = memo2(function ShaderNode2({ id: flowNodeId, data, selected, dragging }) {
  const node = data.patchNode;
  const fm1Mode = useContext2(Fm1ModeContext);
  const hostedMode = useContext2(HostedModeContext);
  const [hostedImageUrl, setHostedImageUrl] = useState6();
  useEffect5(() => {
    setHostedImageUrl(void 0);
    if (!hostedMode || !node.image?.url || !hostedMode.assets?.imagePreview) return;
    const controller = new AbortController();
    let url;
    void hostedMode.assets.imagePreview(node.image.url, controller.signal).then((blob) => {
      if (!blob || controller.signal.aborted || blob.size > 4 * 1024 * 1024 || !blob.type.startsWith("image/")) return;
      url = URL.createObjectURL(blob);
      setHostedImageUrl(url);
    }).catch(() => void 0);
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [hostedMode?.assets, node.image?.url]);
  const imagePreviewUrl = hostedMode ? hostedImageUrl : node.image?.url;
  const hostedUnsupported = hostedMode?.nodeTypes && node.type !== null && !hostedMode.nodeTypes.includes(node.type);
  const fm1Unsupported = fm1Mode && node.type !== null && !isFm1NodeImplemented(node.type);
  const connectionInProgress = useConnection((connection) => connection.inProgress);
  const isCanvasLocked = data.isCanvasLocked === true;
  const scopeGradientId = `scope-gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const reactFlow = useReactFlow2();
  const graphZoomScale = graphDetailZoomScale(data.canvasZoom ?? Number.NaN);
  const graphScreenEmphasis = graphDetailScreenEmphasis(graphZoomScale);
  const headerTitleScale = canvasHeaderTitleScale(data.canvasZoom ?? Number.NaN);
  const customWavePointScale = customWaveEditPointScreenScale(graphZoomScale);
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeElementRef = useRef6(null);
  const scopeDisplayRef = useRef6(null);
  const [scopeFullscreenError, setScopeFullscreenError] = useState6("");
  const draggedPortRef = useRef6(null);
  const dragStartRef = useRef6(null);
  const scopeResizeRef = useRef6(null);
  const customWaveEditorRef = useRef6(null);
  const fftDisplayRef = useRef6(null);
  const fftBoundaryDragRef = useRef6(null);
  const customWaveDragRef = useRef6(null);
  const customWaveClickRef = useRef6({ index: null, time: 0 });
  const customWaveDragCommitRef = useRef6({ lastCommitTime: Number.NEGATIVE_INFINITY, pending: null, timeout: null });
  const inputPortRowsRef = useRef6({});
  const outputPortRowsRef = useRef6({});
  const expressionInputRef = useRef6(null);
  const skipNextExpressionBlurRef = useRef6(false);
  const [dragSource, setDragSource] = useState6(null);
  const [dragTarget, setDragTarget] = useState6(null);
  const [scopeResizeCorner, setScopeResizeCorner] = useState6(null);
  const [autoDisplayWidth, setAutoDisplayWidth] = useState6(null);
  const [customWaveDragPointIndex, setCustomWaveDragPointIndex] = useState6(null);
  const [expressionDraft, setExpressionDraft] = useState6(node.expression ?? "");
  const [imageAspectRatio, setImageAspectRatio] = useState6(DEFAULT_IMAGE_ASPECT_RATIO);
  const [pointerOver, setPointerOver] = useState6(false);
  const definition = node.type ? getNodeDefinition(node) : null;
  const isExpression = node.type === "Expression";
  const isGroup = node.type === "Group";
  const groupUiPreview = isGroup ? data.groupUiPreview : void 0;
  const isSpread = node.type === "Spread";
  const isSpawn = node.type === "Spawn";
  const isRuntimeContainer = isSpread || isSpawn;
  const isAreaCollapsedPresentation = data.isAreaCollapsedPresentation === true;
  const isAreaUiCollapsedPresentation = data.isAreaUiCollapsedPresentation === true;
  const isSelector = node.type === "Selector";
  const isRoutingNode = node.type === "Send" || node.type === "Receive";
  const canRenameInputs = node.type === "Outs";
  const canRenameOutputs = node.type === "Ins" || node.type === "Params";
  const outputCount = definition?.outputs.length ?? 0;
  const previewInputPort = data.previewPort?.side === "input" ? data.previewPort.name : null;
  const previewOutputPort = data.previewPort?.side === "output" ? data.previewPort.name : null;
  const showMeterDisplay = node.type === "Meter";
  const showScopeDisplay = node.type === "Scope";
  const showFftDisplay = node.type === "FFT";
  const showSliderDisplay = node.type === "Slider";
  const showJoystickDisplay = node.type === "Joystick";
  const showButtonDisplay = node.type === "Button";
  const showKeysDisplay = node.type === "Keys";
  const showAccumulatorDisplay = node.type === "Accumulator";
  const showQuantiseDisplay = node.type === "Quantise";
  const showSequencerDisplay = node.type === "Sequencer";
  const showRollDisplay = node.type === "Roll";
  const showTempoDisplay = node.type === "Tempo";
  const showAudioOutputDisplay = node.type === "AudioOut";
  const showAudioInputDisplay = node.type === "AudioInput";
  const showMidiNoteDisplay = node.type === "MidiNote" || node.type === "MidiNoteOn" || node.type === "MidiNoteOff";
  const showCustomWaveEditor = node.type === "CustomWave";
  const showKinkOscGraphic = node.type === "KinkOsc";
  const showSampleUpload = node.type === "SamplePlayer";
  const showSampleVideo = showSampleUpload && Boolean(node.sample?.url && isVideoSampleUrl(node.sample.url));
  const showBufferDisplay = node.type === "Buffer";
  const showImageDisplay = node.type === "Image";
  const sliderUnitValue = showSliderDisplay ? clamp(data.midiSliderValue ?? data.audioSliderValue ?? node.params.value ?? 0.5, 0, 1) : 0;
  const sliderMappedUnitValue = sliderUnitValue ** 2 ** -clamp(node.params.curve ?? 0, -8, 8);
  const sliderAbsoluteValue = (node.params.min ?? 0) + sliderMappedUnitValue * ((node.params.max ?? 1) - (node.params.min ?? 0));
  const sliderTitleSuffix = showSliderDisplay && pointerOver ? `: ${formatSliderReadoutValue(sliderAbsoluteValue)} (${formatUnitValue(sliderMappedUnitValue)})` : void 0;
  const showTopGraphic = showMeterDisplay || showScopeDisplay || showFftDisplay || showSliderDisplay || showJoystickDisplay || showButtonDisplay || showKeysDisplay || showCustomWaveEditor || showKinkOscGraphic || showSampleUpload || showBufferDisplay || showImageDisplay || showRollDisplay || Boolean(groupUiPreview);
  const imageX = centeredCoordinateToUnit(data.audioImagePosition?.x ?? node.params.x ?? 0);
  const imageY = centeredCoordinateToUnit(data.audioImagePosition?.y ?? node.params.y ?? 0);
  const showResizableDisplay = showMeterDisplay || showScopeDisplay || showFftDisplay || showSliderDisplay || showJoystickDisplay || showButtonDisplay || showKeysDisplay || showCustomWaveEditor || showSampleUpload || showBufferDisplay || showImageDisplay || showSequencerDisplay || showRollDisplay || isRuntimeContainer;
  const usesAutoInitialWidth = node.scopeSize === void 0 && (showMeterDisplay || showScopeDisplay || showFftDisplay || showSliderDisplay || showJoystickDisplay || showButtonDisplay || showKeysDisplay || showCustomWaveEditor || showSampleUpload || showBufferDisplay);
  const customWaveCount = Math.max(1, Math.min(8, Math.round(node.params.count ?? 1)));
  const customWaveBankValues = showCustomWaveEditor ? Array.from({ length: customWaveCount }, (_, index) => customWaveBank(node.customWave, node.params)[index] ?? normalizeCustomWave(void 0)) : [];
  const [selectedCustomWaveIndex, setSelectedCustomWaveIndex] = useState6(0);
  const selectedWaveIndex = Math.min(selectedCustomWaveIndex, customWaveCount - 1);
  const customWave = showCustomWaveEditor ? customWaveBankValues[selectedWaveIndex] ?? customWaveBankValues[0] : null;
  const customWavePlayheads = data.audioPlayheads?.length ? data.audioPlayheads.map((playhead) => clamp(playhead, 0, 1)) : [normalizeUnitInterval(node.params.phase ?? 0)];
  useEffect5(() => {
    setSelectedCustomWaveIndex((current) => Math.min(current, customWaveCount - 1));
  }, [customWaveCount]);
  useEffect5(() => {
    if (!showCustomWaveEditor || !selected || customWaveCount < 2) return;
    const handleCustomWaveSelectKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableElement(event.target) || isEditableElement(document.activeElement)) return;
      const waveIndex = Number(event.key) - 1;
      if (!Number.isInteger(waveIndex) || waveIndex < 0 || waveIndex >= customWaveCount) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedCustomWaveIndex(waveIndex);
    };
    window.addEventListener("keydown", handleCustomWaveSelectKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleCustomWaveSelectKeyDown, { capture: true });
  }, [customWaveCount, selected, showCustomWaveEditor]);
  const sequencer = showSequencerDisplay ? sequencerShape(node.params) : null;
  const roll = showRollDisplay ? rollShape(node.params) : null;
  const amplitudeRange = displayAmplitudeRange(node.params.range);
  const meterMode = monitorDisplayMode(node.params.mode, "unipolar");
  const scopeMode = monitorDisplayMode(node.params.mode, "bipolar");
  const signedMeterLevel = data.audioMeter?.input ?? 0;
  const unipolarMeterLevel = Math.max(0, Math.min(1, (data.audioMeter?.output ?? 0) / amplitudeRange));
  const bipolarMeterLevel = Math.max(-1, Math.min(1, signedMeterLevel / amplitudeRange));
  const meterPeak = useRecentMaxLevel(unipolarMeterLevel, showMeterDisplay && meterMode === "unipolar");
  const bipolarMeterPeaks = useRecentBipolarLevels(bipolarMeterLevel, showMeterDisplay && meterMode === "bipolar");
  const meterLevel = meterMode === "bipolar" ? bipolarMeterLevel : unipolarMeterLevel;
  const outputMeterLeft = Math.max(0, Math.min(1, data.audioOutputMeter?.left ?? 0));
  const outputMeterRight = Math.max(0, Math.min(1, data.audioOutputMeter?.right ?? 0));
  const scopePath = showScopeDisplay ? samplesToScopePath(data.audioScope?.samples ?? [], amplitudeRange, scopeMode) : "";
  const scopeSize = showKeysDisplay ? clampKeysNodeSize(node.scopeSize ?? DEFAULT_KEYS_NODE_SIZE) : showSliderDisplay || showJoystickDisplay || showButtonDisplay ? clampControlNodeSize(node.scopeSize ?? (showJoystickDisplay ? DEFAULT_JOYSTICK_NODE_SIZE : DEFAULT_SCOPE_NODE_SIZE)) : showMeterDisplay || showScopeDisplay || showFftDisplay ? clampScopeNodeSize(node.scopeSize ?? (showFftDisplay ? DEFAULT_FFT_NODE_SIZE : DEFAULT_SCOPE_NODE_SIZE)) : DEFAULT_SCOPE_NODE_SIZE;
  const waveformDisplaySize = showImageDisplay ? clampImageNodeSize(node.scopeSize ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE, imageAspectRatio) : showCustomWaveEditor || showSampleUpload || showBufferDisplay ? clampCustomWaveNodeSize(node.scopeSize ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE) : DEFAULT_CUSTOM_WAVE_NODE_SIZE;
  const sequencerLabelColumnWidth = node.sequencerRowLabelColumnWidth ?? sequencerRowLabelColumnWidth(node.sequencerRowLabels);
  const sequencerDisplaySize = sequencer ? clampSequencerNodeSize(
    node.scopeSize ?? { width: sequencer.steps * 26, height: sequencer.rows * 26 },
    sequencer.steps,
    sequencer.rows,
    sequencerLabelColumnWidth
  ) : DEFAULT_SCOPE_NODE_SIZE;
  const rollDisplaySize = roll ? clampSequencerNodeSize(node.scopeSize ?? { width: roll.steps * 26 + 32, height: roll.rows.length * 22 }, roll.steps, roll.rows.length, 32) : DEFAULT_SCOPE_NODE_SIZE;
  const defaultDisplaySize = isRuntimeContainer ? runtimeContainerSize(node) : showSequencerDisplay ? sequencerDisplaySize : showRollDisplay ? rollDisplaySize : showCustomWaveEditor || showSampleUpload || showBufferDisplay || showImageDisplay ? waveformDisplaySize : scopeSize;
  const displaySize = usesAutoInitialWidth && autoDisplayWidth !== null ? { ...defaultDisplaySize, width: autoDisplayWidth } : defaultDisplaySize;
  const sequencerGridHeight = sequencer ? Math.max(1, (displaySize.width - sequencerLabelColumnWidth) * sequencer.rows / sequencer.steps) : 0;
  const rollGridHeight = roll ? Math.max(1, (displaySize.width - 32) * roll.rows.length / roll.steps) : 0;
  const graphDetailSize = {
    width: displaySize.width * graphZoomScale,
    height: displaySize.height * graphZoomScale
  };
  const fftBarCount = clamp(Math.round(displaySize.width / 9), 24, 96);
  const spectrumBars = useMemo4(
    () => spectrumBarsFromSamples(data.audioSpectrum?.samples ?? [], fftBarCount),
    [data.audioSpectrum?.samples, fftBarCount]
  );
  const fftMinFrequency = clamp(node.params.minFreq ?? FFT_ANALYSIS_MIN_FREQUENCY, FFT_ANALYSIS_MIN_FREQUENCY, FFT_ANALYSIS_MAX_FREQUENCY);
  const fftMaxFrequency = clamp(node.params.maxFreq ?? FFT_ANALYSIS_MAX_FREQUENCY, FFT_ANALYSIS_MIN_FREQUENCY, FFT_ANALYSIS_MAX_FREQUENCY);
  const fftWindowStart = Math.min(fftMinFrequency, fftMaxFrequency);
  const fftWindowEnd = Math.max(fftMinFrequency, fftMaxFrequency);
  const fftWindowStartFraction = frequencyScaleFraction(fftWindowStart);
  const fftWindowEndFraction = frequencyScaleFraction(fftWindowEnd);
  const meterScaleTicks = showMeterDisplay ? amplitudeScaleTicks(amplitudeRange, graphDetailSize.width, meterMode) : [];
  const meterGridTicks = showMeterDisplay ? chartGridColumns(graphDetailSize.width).map((tick) => ({
    ...tick,
    label: meterScaleTicks.find((scaleTick) => Math.abs(scaleTick.fraction - tick.fraction) < 1e-4)?.label
  })) : [];
  const meterGridRows = showMeterDisplay ? chartGridRows(graphDetailSize.height) : [];
  const scopeScaleTicks = showScopeDisplay ? chartScaleTicks(amplitudeRange, scopeMode === "bipolar" ? -amplitudeRange : 0, graphDetailSize.height, "vertical") : [];
  const scopeGridTicks = showScopeDisplay ? chartGridColumns(graphDetailSize.width) : [];
  const fftGridTicks = showFftDisplay ? frequencyGridTicks(graphDetailSize.width) : [];
  const fftGridRows = showFftDisplay ? chartGridRows(graphDetailSize.height) : [];
  const nodeSizeStyle = showResizableDisplay ? {
    ...!usesAutoInitialWidth || showSliderDisplay && autoDisplayWidth !== null ? { "--node-display-width": `${displaySize.width}px` } : {},
    "--node-display-height": `${displaySize.height}px`,
    ...showImageDisplay ? { "--image-aspect-ratio": String(imageAspectRatio) } : {},
    ...sequencer ? {
      "--sequencer-steps": String(sequencer.steps),
      "--sequencer-rows": String(sequencer.rows),
      "--sequencer-label-column-width": `${sequencerLabelColumnWidth}px`,
      "--sequencer-grid-height": `${sequencerGridHeight}px`
    } : {},
    ...roll ? {
      "--roll-steps": String(roll.steps),
      "--roll-grid-height": `${rollGridHeight}px`
    } : {}
  } : void 0;
  const dspErrors = data.dspErrors ?? [];
  const hasDspErrors = dspErrors.length > 0;
  const previewAddsOutput = Boolean(
    previewOutputPort && definition && !definition.outputs.some((output) => output.name === previewOutputPort)
  );
  const connectedInputPorts = useMemo4(() => new Set(data.connectedPorts?.inputs ?? []), [data.connectedPorts?.inputs]);
  const connectedOutputPorts = useMemo4(() => new Set(data.connectedPorts?.outputs ?? []), [data.connectedPorts?.outputs]);
  const setLinkInputPorts = useMemo4(() => new Set(data.setLinkInputPorts ?? []), [data.setLinkInputPorts]);
  const forceCompactPorts = definition ? shouldForceCompactPorts(definition) : false;
  const compactPorts = forceCompactPorts || node.compactPorts === true;
  const revealCompactPorts = data.isOnlySelected === true || data.isConnecting === true && pointerOver;
  const temporarilyRevealCompactPorts = compactPorts && data.isConnecting === true && pointerOver;
  const showAllPorts = !compactPorts || revealCompactPorts;
  useEffect5(() => {
    data.onTemporaryPortRevealChange?.(node.id, temporarilyRevealCompactPorts);
    return () => data.onTemporaryPortRevealChange?.(node.id, false);
  }, [data.onTemporaryPortRevealChange, node.id, temporarilyRevealCompactPorts]);
  const showHeaderInput = Boolean(
    node.type !== "Outs" && definition?.inputs.some((input) => input.name === "signal") && previewInputPort !== "signal"
  );
  const headerInputPort = showHeaderInput ? "signal" : null;
  const canShowHeaderOutput = node.type !== "Ins" && node.type !== "Params" && node.type !== "Sequencer" && !(node.type === "CustomWave" && customWaveCount > 1);
  const signalOutputPort = definition?.outputs.find((output) => output.name === "signal")?.name ?? null;
  const headerOutputPort = canShowHeaderOutput ? signalOutputPort ?? (outputCount === 1 && !previewAddsOutput ? definition?.outputs[0]?.name ?? null : null) : null;
  const showHeaderInputPort = Boolean(headerInputPort);
  const showHeaderOutputPort = Boolean(headerOutputPort);
  const selectedLinkInputs = data.selectedLinkPorts?.inputs ?? [];
  const selectedLinkOutputs = data.selectedLinkPorts?.outputs ?? [];
  const selectorSelectedIndex = isSelector ? Math.floor(Number.isFinite(data.audioSelectorIndex) ? data.audioSelectorIndex ?? 0 : node.params.select ?? 0) : 0;
  const inputLabelWidth = definition ? `${Math.max(0, ...definition.inputs.filter((input) => input.name !== headerInputPort).map((input) => displayPortName(input.name).length))}ch` : "0ch";
  const outputLabelWidth = definition ? `${Math.max(0, ...definition.outputs.map((output) => output.name.length))}ch` : "0ch";
  const inputStyle = { "--input-label-width": inputLabelWidth };
  const nodeStyle = {
    ...nodeSizeStyle ?? {},
    "--input-label-width": inputLabelWidth,
    "--node-scale": String(node.scale ?? 1),
    "--canvas-header-title-scale": String(headerTitleScale),
    "--custom-wave-point-screen-scale": String(customWavePointScale),
    "--graph-screen-scale": String(graphScreenEmphasis / graphZoomScale),
    "--graph-stroke-scale": String(1 / graphZoomScale),
    ...groupUiPreview ? { "--group-ui-width": `${groupUiPreview.width}px` } : {},
    ...isRoutingNode ? { "--routing-color": routingNodeColor(node.params.number) } : {}
  };
  const className = [
    "shader-node",
    showMeterDisplay ? "shader-node-meter" : "",
    showScopeDisplay ? "shader-node-scope" : "",
    showFftDisplay ? "shader-node-fft" : "",
    showSliderDisplay ? "shader-node-slider" : "",
    showJoystickDisplay ? "shader-node-joystick" : "",
    showButtonDisplay ? "shader-node-button" : "",
    showKeysDisplay ? "shader-node-keys" : "",
    showAccumulatorDisplay ? "shader-node-accumulator" : "",
    showQuantiseDisplay ? "shader-node-quantise" : "",
    showSequencerDisplay ? "shader-node-sequencer" : "",
    showRollDisplay ? "shader-node-roll" : "",
    showAudioOutputDisplay ? "shader-node-audio-out" : "",
    showSampleUpload ? "shader-node-sampleplayer" : "",
    showBufferDisplay ? "shader-node-buffer" : "",
    showImageDisplay ? "shader-node-image" : "",
    showAudioInputDisplay ? "shader-node-audio-input" : "",
    showMidiNoteDisplay ? "shader-node-midi-note" : "",
    isRuntimeContainer ? "shader-node-spread" : "",
    showCustomWaveEditor ? "shader-node-custom-wave" : "",
    isExpression ? "shader-node-expression" : "",
    isGroup ? "shader-node-group" : "",
    hasDspErrors ? "shader-node-dsp-error" : "",
    fm1Unsupported ? "shader-node-fm1-unsupported" : "",
    selected ? "shader-node-selected" : "",
    dragging ? "shader-node-dragging" : "",
    compactPorts ? "shader-node-compact" : "",
    isAreaCollapsedPresentation ? "shader-node-area-hidden" : "",
    isAreaUiCollapsedPresentation ? "shader-node-area-ui-collapsed" : "",
    isCanvasLocked ? "shader-node-canvas-locked" : "",
    node.enabled === false ? "shader-node-disabled" : "",
    data.onHeaderDoubleClick ? "shader-node-resettable-header" : "",
    usesAutoInitialWidth ? "shader-node-auto-width" : ""
  ].filter(Boolean).join(" ");
  useLayoutEffect(() => {
    if (!usesAutoInitialWidth) {
      setAutoDisplayWidth(null);
      return;
    }
    const element = nodeElementRef.current;
    if (!element) return;
    const updateWidth = () => {
      const resolvedWidth = showSliderDisplay ? Number.parseFloat(window.getComputedStyle(element).width) : element.clientWidth;
      const width = Math.max(1, Number.isFinite(resolvedWidth) ? resolvedWidth : 1);
      setAutoDisplayWidth((current) => current === width ? current : width);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [showSliderDisplay, usesAutoInitialWidth]);
  useLayoutEffect(() => {
    const animationFrame = requestAnimationFrame(() => updateNodeInternals(node.id));
    return () => cancelAnimationFrame(animationFrame);
  }, [
    compactPorts,
    isAreaCollapsedPresentation,
    isAreaUiCollapsedPresentation,
    connectedInputPorts,
    connectedOutputPorts,
    headerInputPort,
    headerTitleScale,
    inputLabelWidth,
    node.id,
    outputCount,
    outputLabelWidth,
    previewAddsOutput,
    showHeaderInputPort,
    showHeaderOutputPort,
    showAllPorts,
    showSampleVideo,
    displaySize.height,
    displaySize.width,
    node.scale,
    imageAspectRatio,
    customWave?.mode,
    customWave?.points,
    customWave?.sustainEnd,
    customWave?.sustainStart,
    sequencer?.rows,
    sequencer?.steps,
    selected,
    updateNodeInternals
  ]);
  useEffect5(() => {
    if (document.activeElement === expressionInputRef.current) return;
    setExpressionDraft(node.expression ?? "");
  }, [node.expression]);
  function commitExpressionDraft() {
    if (!isExpression) return;
    data.onExpressionCommit?.(node.id, expressionDraft);
  }
  function moveDraggedPortToTarget(side, draggedPort, targetPort, portOrder) {
    if (draggedPort === targetPort) return;
    const fromIndex = portOrder.indexOf(draggedPort);
    const toIndex = portOrder.indexOf(targetPort);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const direction = fromIndex < toIndex ? 1 : -1;
    const steps = Math.abs(toIndex - fromIndex);
    for (let step = 0; step < steps; step += 1) {
      data.onPortMove(node.id, side, draggedPort, direction);
    }
  }
  useEffect5(() => {
    return () => {
      const dragCommit = customWaveDragCommitRef.current;
      if (dragCommit.timeout !== null) clearTimeout(dragCommit.timeout);
      dragCommit.timeout = null;
      dragCommit.pending = null;
    };
  }, []);
  useEffect5(() => {
    function handlePointerMove(event) {
      const draggedPort = draggedPortRef.current;
      if (!draggedPort || draggedPort.pointerId !== event.pointerId || !definition) return;
      const dragStart = dragStartRef.current;
      if (!dragStart) return;
      const moved = Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 3;
      if (!moved) return;
      event.preventDefault();
      const side = draggedPort.side;
      const portOrder = side === "input" ? definition.inputs.map((port) => port.name) : definition.outputs.map((port) => port.name);
      const rows = side === "input" ? inputPortRowsRef.current : outputPortRowsRef.current;
      const targets = portOrder.flatMap((port) => {
        const row = rows[port];
        if (!row) return [];
        const rect = row.getBoundingClientRect();
        return [{
          port,
          centerY: rect.top + rect.height / 2
        }];
      });
      if (targets.length === 0) return;
      const targetPort = targets.reduce((best, current) => {
        const bestDistance = Math.abs(event.clientY - best.centerY);
        const currentDistance = Math.abs(event.clientY - current.centerY);
        return currentDistance < bestDistance ? current : best;
      }).port;
      setDragSource((current) => current ?? { side, port: draggedPort.port });
      setDragTarget({ side, port: targetPort });
      moveDraggedPortToTarget(side, draggedPort.port, targetPort, portOrder);
    }
    function stopDragging(pointerId) {
      if (!draggedPortRef.current || draggedPortRef.current.pointerId !== pointerId) return;
      draggedPortRef.current = null;
      dragStartRef.current = null;
      setDragSource(null);
      setDragTarget(null);
    }
    function handlePointerUp(event) {
      stopDragging(event.pointerId);
    }
    function handlePointerCancel(event) {
      stopDragging(event.pointerId);
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [definition, node.id]);
  useEffect5(() => {
    function handlePointerMove(event) {
      const resize = scopeResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      event.preventDefault();
      const deltaX = (event.clientX - resize.startPointer.x) / resize.coordinateScale;
      const deltaY = (event.clientY - resize.startPointer.y) / resize.coordinateScale;
      const rawWidth = resize.corner === "bottom-left" ? resize.startSize.width - deltaX : resize.startSize.width + deltaX;
      const constrainedWidth = resize.minWidth === void 0 ? rawWidth : Math.max(resize.minWidth, rawWidth);
      const rawNextSize = { width: constrainedWidth, height: resize.startSize.height + deltaY };
      const nextSize = showSequencerDisplay && sequencer ? clampSequencerNodeSize({ width: constrainedWidth, height: constrainedWidth * sequencer.rows / sequencer.steps }, sequencer.steps, sequencer.rows, sequencerLabelColumnWidth) : showRollDisplay && roll ? clampSequencerNodeSize({ width: constrainedWidth, height: constrainedWidth * roll.rows.length / roll.steps }, roll.steps, roll.rows.length, 32) : showImageDisplay ? clampImageNodeSize({ width: rawWidth, height: rawWidth / imageAspectRatio }, imageAspectRatio) : showCustomWaveEditor || showSampleUpload || showBufferDisplay ? clampCustomWaveNodeSize(rawNextSize) : showKeysDisplay ? clampKeysNodeSize(rawNextSize) : showSliderDisplay || showJoystickDisplay || showButtonDisplay ? clampControlNodeSize(rawNextSize) : clampScopeNodeSize(rawNextSize);
      const previousSize = resize.lastSize;
      resize.lastSize = nextSize;
      data.onScopeResize(node.id, nextSize, resize.corner === "bottom-left" ? "left" : "right", previousSize);
    }
    function stopResizing(pointerId) {
      if (!scopeResizeRef.current || scopeResizeRef.current.pointerId !== pointerId) return;
      scopeResizeRef.current = null;
      setScopeResizeCorner(null);
    }
    function handlePointerUp(event) {
      stopResizing(event.pointerId);
    }
    function handlePointerCancel(event) {
      stopResizing(event.pointerId);
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [data, imageAspectRatio, node.id, reactFlow, roll, sequencer, sequencerLabelColumnWidth, showBufferDisplay, showCustomWaveEditor, showSampleUpload, showImageDisplay, showRollDisplay, showSequencerDisplay, showSliderDisplay, showJoystickDisplay, showButtonDisplay, showKeysDisplay]);
  useEffect5(() => {
    setImageAspectRatio(DEFAULT_IMAGE_ASPECT_RATIO);
  }, [node.image?.url]);
  function handleImageLoad(event) {
    const image = event.currentTarget;
    const aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    setImageAspectRatio(aspect);
    const width = node.scopeSize?.width ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE.width;
    data.onScopeResize(node.id, clampImageNodeSize({ width, height: width / aspect }, aspect), "right");
  }
  useEffect5(() => {
    function handlePointerMove(event) {
      const drag = customWaveDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !customWave) return;
      event.preventDefault();
      const point = customWavePointFromPointer(event);
      if (!point) return;
      const lastIndex = customWave.points.length - 1;
      const previous = customWave.points[drag.index - 1]?.x ?? 0;
      const next = customWave.points[drag.index + 1]?.x ?? 1;
      const x = drag.index === 0 ? 0 : drag.index === lastIndex ? 1 : clamp(point.x, previous + 1e-3, next - 1e-3);
      const nextPoints = customWave.points.map((entry, index) => index === drag.index ? { x, y: point.y } : entry);
      scheduleCustomWaveDragCommit({ ...customWave, points: nextPoints }, `custom-wave-point:${node.id}`);
    }
    function stopDragging(pointerId) {
      if (!customWaveDragRef.current || customWaveDragRef.current.pointerId !== pointerId) return;
      flushCustomWaveDragCommit();
      customWaveDragRef.current = null;
      setCustomWaveDragPointIndex(null);
    }
    function handlePointerUp(event) {
      stopDragging(event.pointerId);
    }
    function handlePointerCancel(event) {
      stopDragging(event.pointerId);
    }
    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [customWave, node.id]);
  function handlePortPointerDown(event, side, port) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    data.onPortSelect?.(node.id, side, port);
    draggedPortRef.current = { side, port, pointerId: event.pointerId };
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    setDragSource(null);
    setDragTarget(null);
  }
  function handleScopeResizePointerDown(event, corner) {
    if (isAreaUiCollapsedPresentation || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const sequencerBody = event.currentTarget.closest(".shader-node-sequencer")?.querySelector(".shader-node-body-sequencer");
    const sequencerInputs = sequencerBody?.querySelector(".shader-inputs");
    const sequencerOutputs = sequencerBody?.querySelector(".shader-outputs");
    const hasVisibleSequencerInputs = sequencerInputs?.querySelector(".shader-port") !== null;
    const hasVisibleSequencerOutputs = sequencerOutputs?.querySelector(".shader-port") !== null;
    const coordinateScale = Math.max(1e-4, (reactFlow.getZoom() || 1) * (node.scale ?? 1));
    const sequencerMinWidth = hasVisibleSequencerInputs && hasVisibleSequencerOutputs ? Math.max(240, sequencerLabelColumnWidth + (sequencer?.steps ?? 1) * SEQUENCER_MIN_CELL_SIZE) : void 0;
    const renderedWidth = usesAutoInitialWidth ? showSliderDisplay ? autoDisplayWidth ?? (nodeElementRef.current ? Number.parseFloat(window.getComputedStyle(nodeElementRef.current).width) : void 0) : nodeElementRef.current?.clientWidth : void 0;
    const startSize = renderedWidth && renderedWidth > 0 ? { ...displaySize, width: renderedWidth } : displaySize;
    scopeResizeRef.current = {
      pointerId: event.pointerId,
      corner,
      startPointer: { x: event.clientX, y: event.clientY },
      startSize,
      lastSize: startSize,
      coordinateScale,
      minWidth: sequencerMinWidth ?? (isRuntimeContainer ? isSpawn ? MIN_SPAWN_WIDTH : MIN_RUNTIME_CONTAINER_WIDTH : void 0)
    };
    setScopeResizeCorner(corner);
  }
  function handleScopeResizeClick(event) {
    event.preventDefault();
    event.stopPropagation();
  }
  function handleSampleDragOver(event) {
    if (!showSampleUpload || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }
  function handleSampleDrop(event) {
    if (!showSampleUpload || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    data.onSampleDrop?.(node.id, event.dataTransfer.files);
  }
  function updateFftBoundaryFromPointer(event) {
    const drag = fftBoundaryDragRef.current;
    const bounds = fftDisplayRef.current?.getBoundingClientRect();
    if (!drag || !bounds || bounds.width <= 0) return;
    const fraction = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const frequency = Math.round(
      FFT_ANALYSIS_MIN_FREQUENCY * (FFT_ANALYSIS_MAX_FREQUENCY / FFT_ANALYSIS_MIN_FREQUENCY) ** fraction
    );
    if (drag.boundary === "min") {
      const maxFrequency = clamp(node.params.maxFreq ?? FFT_ANALYSIS_MAX_FREQUENCY, FFT_ANALYSIS_MIN_FREQUENCY, FFT_ANALYSIS_MAX_FREQUENCY);
      data.onParamChange(node.id, "minFreq", Math.min(frequency, maxFrequency));
    } else {
      const minFrequency = clamp(node.params.minFreq ?? FFT_ANALYSIS_MIN_FREQUENCY, FFT_ANALYSIS_MIN_FREQUENCY, FFT_ANALYSIS_MAX_FREQUENCY);
      data.onParamChange(node.id, "maxFreq", Math.max(frequency, minFrequency));
    }
  }
  function handleFftBoundaryPointerDown(event, boundary) {
    event.preventDefault();
    event.stopPropagation();
    fftBoundaryDragRef.current = { boundary, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFftBoundaryFromPointer(event);
  }
  function handleFftBoundaryPointerMove(event) {
    if (fftBoundaryDragRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateFftBoundaryFromPointer(event);
  }
  function finishFftBoundaryDrag(pointerId) {
    if (fftBoundaryDragRef.current?.pointerId === pointerId) fftBoundaryDragRef.current = null;
  }
  function commitCustomWave(nextCustomWave, historyKey) {
    const waves = Array.from({ length: customWaveCount }, (_, index) => index === selectedWaveIndex ? normalizeCustomWave(nextCustomWave) : customWaveBankValues[index] ?? normalizeCustomWave(void 0));
    const [firstWave, ...additionalWaves] = waves;
    data.onCustomWaveChange?.(node.id, { ...firstWave, ...additionalWaves.length ? { waves: additionalWaves } : {} }, historyKey);
  }
  function scheduleCustomWaveDragCommit(nextCustomWave, historyKey) {
    const dragCommit = customWaveDragCommitRef.current;
    const now = performance.now();
    dragCommit.pending = { customWave: nextCustomWave, historyKey };
    const elapsed = now - dragCommit.lastCommitTime;
    if (elapsed >= CUSTOM_WAVE_DRAG_UPDATE_INTERVAL_MS) {
      flushCustomWaveDragCommit(now);
      return;
    }
    if (dragCommit.timeout !== null) return;
    dragCommit.timeout = setTimeout(() => {
      dragCommit.timeout = null;
      flushCustomWaveDragCommit();
    }, CUSTOM_WAVE_DRAG_UPDATE_INTERVAL_MS - elapsed);
  }
  function flushCustomWaveDragCommit(commitTime = performance.now()) {
    const dragCommit = customWaveDragCommitRef.current;
    if (dragCommit.timeout !== null) clearTimeout(dragCommit.timeout);
    dragCommit.timeout = null;
    const pending = dragCommit.pending;
    if (!pending) return;
    dragCommit.pending = null;
    dragCommit.lastCommitTime = commitTime;
    commitCustomWave(pending.customWave, pending.historyKey);
  }
  function customWavePointFromPointer(event) {
    const editor = customWaveEditorRef.current;
    if (!editor) return null;
    const rect = editor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const padding = 12;
    const width = 300;
    const height = 128;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;
    const screenX = clamp((event.clientX - rect.left) / rect.width * width, padding, width - padding);
    const screenY = clamp((event.clientY - rect.top) / rect.height * height, padding, height - padding);
    return {
      x: clamp((screenX - padding) / innerWidth, 0, 1),
      y: clamp((1 - (screenY - padding) / innerHeight) * 2 - 1, -1, 1)
    };
  }
  function removeCustomWavePoint(index) {
    if (!customWave || index <= 0 || index >= customWave.points.length - 1) return false;
    const nextPoints = customWave.points.filter((_, pointIndex) => pointIndex !== index);
    customWaveDragRef.current = null;
    setCustomWaveDragPointIndex(null);
    commitCustomWave({ ...customWave, points: nextPoints }, `custom-wave-point:${node.id}`);
    return true;
  }
  function handleCustomWavePointerDown(event) {
    if (!customWave || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.target instanceof Element ? event.target.closest(".custom-wave-hit-target, .custom-wave-handle") : null;
    const targetIndex = target?.dataset.index ? Number(target.dataset.index) : null;
    const lastIndex = customWave.points.length - 1;
    if (target && Number.isInteger(targetIndex)) {
      const now = performance.now();
      if (targetIndex !== null && targetIndex > 0 && targetIndex < lastIndex && customWaveClickRef.current.index === targetIndex && now - customWaveClickRef.current.time < 360) {
        customWaveClickRef.current = { index: null, time: 0 };
        removeCustomWavePoint(targetIndex);
        return;
      }
      customWaveClickRef.current = { index: targetIndex, time: now };
      if (targetIndex === null || targetIndex <= 0 || targetIndex >= lastIndex) return;
      customWaveDragRef.current = { pointerId: event.pointerId, index: targetIndex };
      setCustomWaveDragPointIndex(targetIndex);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const point = customWavePointFromPointer(event);
    if (!point) return;
    customWaveClickRef.current = { index: null, time: 0 };
    const nextPoints = [...customWave.points, point].sort((a, b) => a.x - b.x);
    const nextIndex = nextPoints.reduce((bestIndex, item, index) => {
      const best = nextPoints[bestIndex];
      const distance = Math.abs(item.x - point.x) + Math.abs(item.y - point.y);
      const bestDistance = Math.abs(best.x - point.x) + Math.abs(best.y - point.y);
      return distance < bestDistance ? index : bestIndex;
    }, 0);
    commitCustomWave({ ...customWave, points: nextPoints }, `custom-wave-point:${node.id}`);
    customWaveDragRef.current = { pointerId: event.pointerId, index: nextIndex };
    setCustomWaveDragPointIndex(nextIndex);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function handleCustomWaveDoubleClick(event) {
    if (!customWave) return;
    const target = event.target instanceof Element ? event.target.closest(".custom-wave-hit-target, .custom-wave-handle") : null;
    if (!target?.dataset.index) return;
    event.preventDefault();
    event.stopPropagation();
    removeCustomWavePoint(Number(target.dataset.index));
  }
  if (isRuntimeContainer) {
    return /* @__PURE__ */ jsxs5(
      "div",
      {
        className: `spread-port-panel${isAreaUiCollapsedPresentation ? " spread-port-panel-collapsed" : ""}`,
        style: {
          "--spread-port-width": `${displaySize.width}px`,
          "--spread-port-height": `${runtimeContainerPortsHeight(node)}px`,
          "--spread-header-height": `${SPREAD_HEADER_HEIGHT}px`,
          "--node-scale": String(node.scale ?? 1)
        },
        children: [
          isSpawn ? /* @__PURE__ */ jsxs5("div", { className: "spawn-port-inputs", children: [
            /* @__PURE__ */ jsxs5("div", { className: "spawn-port-input", children: [
              /* @__PURE__ */ jsx6(
                Handle,
                {
                  id: "in:trigger",
                  type: "target",
                  position: Position2.Left,
                  className: [
                    "shader-handle shader-handle-input spread-count-handle spawn-trigger-handle",
                    selectedLinkInputs.includes("trigger") ? "shader-handle-selected-link" : ""
                  ].filter(Boolean).join(" ")
                }
              ),
              /* @__PURE__ */ jsx6("span", { children: "trigger" })
            ] }),
            /* @__PURE__ */ jsxs5("div", { className: "spawn-port-input", children: [
              /* @__PURE__ */ jsx6(
                Handle,
                {
                  id: "in:release trigger",
                  type: "target",
                  position: Position2.Left,
                  className: [
                    "shader-handle shader-handle-input spread-count-handle spawn-release-trigger-handle",
                    selectedLinkInputs.includes("release trigger") ? "shader-handle-selected-link" : ""
                  ].filter(Boolean).join(" ")
                }
              ),
              /* @__PURE__ */ jsx6("span", { children: "release trigger" })
            ] })
          ] }) : /* @__PURE__ */ jsxs5("div", { className: "spread-port-input", children: [
            /* @__PURE__ */ jsx6(
              Handle,
              {
                id: "in:count",
                type: "target",
                position: Position2.Left,
                className: [
                  "shader-handle shader-handle-input spread-count-handle",
                  selectedLinkInputs.includes("count") ? "shader-handle-selected-link" : ""
                ].filter(Boolean).join(" ")
              }
            ),
            /* @__PURE__ */ jsx6("span", { children: "count" }),
            /* @__PURE__ */ jsx6(
              NumericScrubber,
              {
                value: node.params.count ?? 1,
                min: 0,
                integer: true,
                replacedBySetLink: setLinkInputPorts.has("count"),
                onChange: (value) => data.onParamChange(node.id, "count", value)
              }
            )
          ] }),
          !isAreaUiCollapsedPresentation ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
            isSpawn ? /* @__PURE__ */ jsxs5("div", { className: "spread-port-output spawn-instance-gate-port", children: [
              /* @__PURE__ */ jsx6("span", { children: "instance gate" }),
              /* @__PURE__ */ jsx6(
                Handle,
                {
                  id: "out:instance gate",
                  type: "source",
                  position: Position2.Bottom,
                  className: [
                    "shader-handle shader-handle-output spread-item-index-handle",
                    selectedLinkOutputs.includes("instance gate") ? "shader-handle-selected-link" : ""
                  ].filter(Boolean).join(" ")
                }
              )
            ] }) : null,
            /* @__PURE__ */ jsxs5("div", { className: `spread-port-output${isSpawn ? " spawn-kill-trigger-port" : ""}`, children: [
              /* @__PURE__ */ jsx6(
                Handle,
                {
                  id: isSpawn ? "in:kill trigger" : "out:item index",
                  type: isSpawn ? "target" : "source",
                  position: Position2.Bottom,
                  className: [
                    `shader-handle ${isSpawn ? "shader-handle-input" : "shader-handle-output"} spread-item-index-handle`,
                    (isSpawn ? selectedLinkInputs.includes("kill trigger") : selectedLinkOutputs.includes("item index")) ? "shader-handle-selected-link" : ""
                  ].filter(Boolean).join(" ")
                }
              ),
              /* @__PURE__ */ jsx6("span", { children: isSpawn ? "kill trigger" : "item index" })
            ] })
          ] }) : null
        ]
      }
    );
  }
  if (isRoutingNode && !selected) {
    const isSend = node.type === "Send";
    const number = routingNodeNumber(node.params.number);
    return /* @__PURE__ */ jsxs5(
      "div",
      {
        ref: nodeElementRef,
        className: [
          "routing-node-marker",
          fm1Unsupported ? "shader-node-fm1-unsupported" : "",
          `routing-node-marker-${isSend ? "send" : "receive"}`,
          connectionInProgress ? "routing-node-drop-active" : "",
          data.routingHighlighted === true ? "routing-node-marker-highlighted" : "",
          node.enabled === false ? "routing-node-marker-disabled" : ""
        ].filter(Boolean).join(" "),
        style: nodeStyle,
        title: `${isSend ? "Send" : "Receive"} ${number}`,
        "aria-label": `${isSend ? "Send" : "Receive"} ${number}`,
        children: [
          /* @__PURE__ */ jsx6(Handle, { id: isSend ? "virtual:send" : "virtual:receive", type: isSend ? "source" : "target", position: isSend ? Position2.Right : Position2.Left, isConnectable: false, className: "virtual-route-handle" }),
          /* @__PURE__ */ jsx6("span", { className: "routing-node-number", "aria-hidden": "true", children: number }),
          /* @__PURE__ */ jsx6(
            Handle,
            {
              id: `${isSend ? "in" : "out"}:signal`,
              type: isSend ? "target" : "source",
              position: isSend ? Position2.Left : Position2.Right,
              className: "routing-node-handle"
            }
          )
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs5(
    "div",
    {
      ref: nodeElementRef,
      className,
      style: nodeStyle,
      onPointerEnter: () => setPointerOver(true),
      onPointerLeave: () => setPointerOver(false),
      onDragOver: handleSampleDragOver,
      onDrop: handleSampleDrop,
      children: [
        /* @__PURE__ */ jsxs5(
          "div",
          {
            className: "shader-node-title",
            title: data.onHeaderDoubleClick ? "Double-click to reset this control to the subpatch defaults" : void 0,
            onPointerDown: data.onHeaderDoubleClick ? (event) => event.stopPropagation() : void 0,
            onMouseDown: data.onHeaderDoubleClick ? (event) => event.stopPropagation() : void 0,
            onClick: data.onHeaderDoubleClick ? (event) => event.stopPropagation() : void 0,
            onDoubleClickCapture: data.onHeaderDoubleClick ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              data.onHeaderDoubleClick?.(node.id);
            } : void 0,
            children: [
              isRoutingNode ? /* @__PURE__ */ jsx6(Handle, { id: node.type === "Send" ? "virtual:send" : "virtual:receive", type: node.type === "Send" ? "source" : "target", position: node.type === "Send" ? Position2.Right : Position2.Left, isConnectable: false, className: "virtual-route-handle" }) : null,
              showHeaderInputPort && headerInputPort ? /* @__PURE__ */ jsx6(
                Handle,
                {
                  id: `in:${headerInputPort}`,
                  type: "target",
                  position: Position2.Left,
                  className: [
                    "shader-handle shader-handle-input shader-handle-input-title",
                    selectedLinkInputs.includes(headerInputPort) ? "shader-handle-selected-link" : ""
                  ].filter(Boolean).join(" "),
                  onDoubleClick: (event) => {
                    event.stopPropagation();
                    data.onPortDoubleClick(node.id, "input", headerInputPort);
                  }
                }
              ) : null,
              /* @__PURE__ */ jsx6("div", { className: "node-title-control-shell", children: compactPorts && !revealCompactPorts ? /* @__PURE__ */ jsx6(
                CollapsedNodeLabel,
                {
                  nodeType: node.type,
                  customLabel: node.customLabel,
                  displaySuffix: sliderTitleSuffix,
                  onChange: (label) => data.onCustomLabelChange?.(node.id, label),
                  onSelect: (additive) => data.onTitleSelect?.(node.id, additive)
                }
              ) : /* @__PURE__ */ jsx6(
                NodeTypePicker,
                {
                  nodeType: node.type,
                  displayLabel: isGroup ? node.subpatchName ?? node.id : void 0,
                  closedSuffix: sliderTitleSuffix,
                  isEditingSubpatch: data.isEditingSubpatch === true,
                  open: data.isTypePickerOpen,
                  onOpen: () => data.onTypeEditStart(node.id),
                  onClose: data.onTypeEditEnd,
                  onCancel: () => data.onTypeEditCancel(node.id),
                  onChange: (type) => data.onTypeChange(node.id, type),
                  onConvertToArea: () => data.onConvertToArea(node.id),
                  onCustomLabelCommit: isGroup ? (label) => data.onSubpatchNameChange?.(node.id, label) : void 0
                }
              ) }),
              !forceCompactPorts && !isAreaUiCollapsedPresentation ? /* @__PURE__ */ jsx6(
                "button",
                {
                  className: "node-enabled-toggle nodrag nopan",
                  type: "button",
                  "aria-label": node.enabled === false ? "Enable node" : "Disable node",
                  title: node.enabled === false ? "Enable node" : "Disable node",
                  "aria-pressed": node.enabled !== false,
                  onPointerDown: (event) => event.stopPropagation(),
                  onDoubleClick: (event) => event.stopPropagation(),
                  onClick: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    data.onEnabledChange?.(node.id, node.enabled === false);
                  },
                  children: /* @__PURE__ */ jsx6("span", { className: "node-enabled-icon", "aria-hidden": "true" })
                }
              ) : null,
              !forceCompactPorts && !isAreaUiCollapsedPresentation ? /* @__PURE__ */ jsx6(
                "button",
                {
                  className: "node-compact-toggle nodrag nopan",
                  type: "button",
                  "aria-label": compactPorts ? "Expand ports" : "Compact ports",
                  title: compactPorts ? "Expand ports" : "Compact ports",
                  "aria-pressed": compactPorts,
                  onPointerDown: (event) => event.stopPropagation(),
                  onDoubleClick: (event) => event.stopPropagation(),
                  onClick: (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    data.onCompactToggle(node.id, !compactPorts);
                  },
                  children: /* @__PURE__ */ jsx6(
                    "span",
                    {
                      className: [
                        "node-compact-icon",
                        compactPorts ? "node-compact-icon-compact" : "node-compact-icon-expanded"
                      ].join(" "),
                      "aria-hidden": "true"
                    }
                  )
                }
              ) : null,
              hostedUnsupported ? /* @__PURE__ */ jsx6("span", { className: "node-dsp-error-marker", title: "This node is outside the host's advertised runtime capabilities; the document remains editable.", "aria-label": "Unsupported by host", children: "!" }) : null,
              fm1Unsupported ? /* @__PURE__ */ jsx6("span", { className: "node-dsp-error-marker", title: "This node is not implemented or verified on FM1", "aria-label": "Not supported on FM1", children: "!" }) : null,
              hasDspErrors ? /* @__PURE__ */ jsx6(
                "span",
                {
                  className: "node-dsp-error-marker",
                  title: dspErrors.join("\n"),
                  "aria-label": `${dspErrors.length} DSP error${dspErrors.length === 1 ? "" : "s"}`,
                  children: "!"
                }
              ) : null,
              showHeaderOutputPort && headerOutputPort ? /* @__PURE__ */ jsx6(
                Handle,
                {
                  id: `out:${headerOutputPort}`,
                  type: "source",
                  position: Position2.Right,
                  className: [
                    "shader-handle shader-handle-output shader-handle-output-title",
                    selectedLinkOutputs.includes(headerOutputPort) ? "shader-handle-selected-link" : ""
                  ].filter(Boolean).join(" "),
                  onDoubleClick: (event) => {
                    event.stopPropagation();
                    data.onPortDoubleClick(node.id, "output", headerOutputPort);
                  }
                }
              ) : null
            ]
          }
        ),
        definition ? (() => {
          const inputPorts = [
            ...definition.inputs.filter((input) => input.name !== headerInputPort).map((input) => ({ ...input, preview: false })),
            ...previewInputPort && !definition.inputs.some((input) => input.name === previewInputPort) ? [{ name: previewInputPort, preview: true }] : []
          ];
          const outputPorts = [
            ...definition.outputs.map((output) => ({ ...output, preview: false })),
            ...previewOutputPort && !definition.outputs.some((output) => output.name === previewOutputPort) ? [{ name: previewOutputPort, preview: true }] : []
          ];
          const visibleInputPorts = inputPorts.filter((input) => input.preview || showAllPorts || connectedInputPorts.has(input.name));
          const visibleOutputPorts = outputPorts.filter((output) => output.preview || showAllPorts || connectedOutputPorts.has(output.name));
          const normalOutputPorts = showSequencerDisplay ? visibleOutputPorts.filter((output) => output.name === SEQUENCER_INDEX_OUTPUT) : visibleOutputPorts.filter((output) => output.name !== headerOutputPort);
          const newPortSide = node.type === "Outs" ? "input" : "output";
          const newPortLabel = node.type === "Outs" ? "new output" : node.type === "Params" ? "new param" : "new input";
          const hasNewPortPlaceholder = node.type === "Ins" || node.type === "Params" || node.type === "Outs";
          const showBody = !compactPorts || isExpression || showSampleUpload || showBufferDisplay || showImageDisplay || showAudioInputDisplay || showMidiNoteDisplay || showTempoDisplay || showSequencerDisplay || showRollDisplay || showCustomWaveEditor || showSliderDisplay || showJoystickDisplay || showButtonDisplay || showKeysDisplay || showAccumulatorDisplay || showAudioOutputDisplay || visibleInputPorts.length > 0 || normalOutputPorts.length > 0 || hasNewPortPlaceholder || showMeterDisplay || showScopeDisplay || showFftDisplay || isRuntimeContainer;
          if (!showBody) return null;
          return /* @__PURE__ */ jsxs5("div", { className: [
            "shader-node-body",
            isExpression ? "shader-node-body-expression" : "",
            showAccumulatorDisplay ? "shader-node-body-accumulator" : "",
            showSequencerDisplay ? "shader-node-body-sequencer" : "",
            showRollDisplay ? "shader-node-body-roll" : "",
            showAudioOutputDisplay ? "shader-node-body-audio-out" : "",
            showAudioInputDisplay ? "shader-node-body-audio-input" : "",
            showMidiNoteDisplay ? "shader-node-body-midi-note" : "",
            isRuntimeContainer ? "shader-node-body-spread" : "",
            showTopGraphic ? "shader-node-body-graphic" : "",
            !showSequencerDisplay && normalOutputPorts.length === 0 ? "shader-node-body-no-outputs" : ""
          ].filter(Boolean).join(" "), children: [
            isExpression ? /* @__PURE__ */ jsx6(
              "input",
              {
                ref: expressionInputRef,
                "aria-label": "GLSL expression",
                className: "expression-editor nodrag nopan nowheel",
                spellCheck: false,
                type: "text",
                value: expressionDraft,
                onChange: (event) => setExpressionDraft(event.currentTarget.value),
                onBlur: () => {
                  if (skipNextExpressionBlurRef.current) {
                    skipNextExpressionBlurRef.current = false;
                    return;
                  }
                  commitExpressionDraft();
                },
                onKeyDown: (event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitExpressionDraft();
                    skipNextExpressionBlurRef.current = true;
                    event.currentTarget.blur();
                  }
                },
                onPointerDown: (event) => event.stopPropagation()
              }
            ) : null,
            /* @__PURE__ */ jsxs5("div", { className: showTopGraphic ? "shader-node-content-graphic" : "shader-node-content-graphic-empty", children: [
              groupUiPreview ? /* @__PURE__ */ jsx6(
                "div",
                {
                  className: "group-ui-preview nodrag nopan",
                  style: { width: groupUiPreview.width, height: groupUiPreview.height },
                  onDoubleClick: (event) => event.stopPropagation(),
                  children: groupUiPreview.nodes.map((previewNode) => /* @__PURE__ */ jsx6(
                    "div",
                    {
                      className: "group-ui-preview-node",
                      style: { left: previewNode.position.x, top: previewNode.position.y },
                      children: /* @__PURE__ */ jsx6(ShaderNode2, { ...{ data: previewNode.data, selected: false, dragging: false } })
                    },
                    previewNode.id
                  ))
                }
              ) : null,
              isRuntimeContainer ? /* @__PURE__ */ jsx6("div", { className: "spread-node-fill", "aria-hidden": "true" }) : null,
              showSampleUpload ? /* @__PURE__ */ jsx6(
                SampleWaveformDisplay,
                {
                  sampleUrl: node.sample?.url,
                  playheads: data.audioPlayheads,
                  start: data.audioSampleParams?.start ?? node.params.start ?? 0,
                  end: data.audioSampleParams?.end ?? node.params.end ?? 1,
                  attack: data.audioSampleParams?.attack ?? node.params.attack ?? 0,
                  release: data.audioSampleParams?.release ?? node.params.release ?? 0,
                  detail: Math.max(120, Math.round(displaySize.width)),
                  onStartChange: (value) => data.onParamChange(node.id, "start", value),
                  onEndChange: (value) => data.onParamChange(node.id, "end", value)
                }
              ) : null,
              showBufferDisplay ? /* @__PURE__ */ jsx6(
                BufferWaveformDisplay,
                {
                  bins: data.audioBuffer?.bins ?? [],
                  playhead: data.audioBuffer?.playhead ?? normalizeUnitInterval(node.params.playhead ?? 0),
                  recordHead: data.audioBuffer?.recordHead ?? normalizeUnitInterval(node.params["record head"] ?? 0),
                  detail: Math.max(120, Math.round(displaySize.width)),
                  onClear: data.onBufferClear
                }
              ) : null,
              showSampleUpload ? /* @__PURE__ */ jsx6("div", { className: "sample-upload-row", children: /* @__PURE__ */ jsx6(
                "button",
                {
                  className: "sample-upload-button nodrag nopan",
                  type: "button",
                  title: node.sample?.name ?? "Select sample",
                  onClick: () => data.onSampleSelect?.(node.id),
                  onPointerDown: (event) => event.stopPropagation(),
                  children: node.sample?.name ?? "Select sample"
                }
              ) }) : null,
              showImageDisplay ? /* @__PURE__ */ jsxs5("div", { className: "shader-node-full-width-display image-node-display nodrag nopan", "aria-label": node.image?.url ? "Image coordinate preview" : "Image preview", children: [
                imagePreviewUrl ? /* @__PURE__ */ jsx6("img", { src: imagePreviewUrl, alt: node.image?.name ?? "Host image preview", draggable: false, onLoad: handleImageLoad }) : /* @__PURE__ */ jsx6("span", { children: hostedMode ? "Image preview requires host data" : "Select an image" }),
                imagePreviewUrl ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                  /* @__PURE__ */ jsx6("i", { className: "image-node-crosshair image-node-crosshair-vertical", style: { left: `calc(${imageX} * (100% - 1px))` } }),
                  /* @__PURE__ */ jsx6("i", { className: "image-node-crosshair image-node-crosshair-horizontal", style: { top: `calc(${imageY} * (100% - 1px))` } })
                ] }) : null
              ] }) : null,
              showImageDisplay ? /* @__PURE__ */ jsx6("div", { className: "sample-upload-row", children: /* @__PURE__ */ jsx6("button", { className: "sample-upload-button nodrag nopan", type: "button", title: node.image?.name ?? "Select image", onClick: () => data.onImageSelect?.(node.id), onPointerDown: (event) => event.stopPropagation(), children: node.image?.name ?? "Select image" }) }) : null,
              showAudioInputDisplay ? /* @__PURE__ */ jsx6(
                AudioInputDisplay,
                {
                  state: data.audioInput,
                  muted: Math.round(node.params.muted ?? 0) === 1,
                  onMutedChange: (muted) => data.onParamChange(node.id, "muted", muted ? 1 : 0),
                  onDeviceChange: (deviceId) => data.onAudioInputDeviceChange?.(deviceId),
                  onRefresh: () => data.onAudioInputRefresh?.()
                }
              ) : null,
              showCustomWaveEditor && customWave ? /* @__PURE__ */ jsx6(
                CustomWaveEditor,
                {
                  customWave,
                  waves: customWaveBankValues.slice(0, customWaveCount),
                  selectedWaveIndex,
                  onWaveSelect: setSelectedCustomWaveIndex,
                  subdivisions: node.params.subdivisions ?? 8,
                  subgroups: node.params.subgroups ?? 4,
                  baseLevel: node.params.baseLevel ?? 0,
                  rangeMin: node.params.rangeMin ?? -1,
                  rangeMax: node.params.rangeMax ?? 1,
                  frequency: data.audioCustomWaveFrequency ?? node.params.frequency ?? 220,
                  hasLivePlayheads: Boolean(data.audioPlayheads?.length),
                  playheads: customWavePlayheads,
                  compact: !showAllPorts,
                  displaySize,
                  graphZoomScale,
                  graphScreenEmphasis,
                  activePointIndex: customWaveDragPointIndex,
                  editorRef: customWaveEditorRef,
                  onPointerDown: handleCustomWavePointerDown,
                  onDoubleClick: handleCustomWaveDoubleClick,
                  onSustainStartChange: (sustainStart) => {
                    commitCustomWave({
                      ...customWave,
                      sustainStart: clamp(sustainStart, 0, customWave.sustainEnd - 1e-3)
                    }, `custom-wave-sustain:${node.id}`);
                  },
                  onSustainEndChange: (sustainEnd) => {
                    commitCustomWave({
                      ...customWave,
                      sustainEnd: clamp(sustainEnd, customWave.sustainStart + 1e-3, 1)
                    }, `custom-wave-sustain:${node.id}`);
                  }
                }
              ) : null,
              showKinkOscGraphic ? /* @__PURE__ */ jsx6(
                KinkOscGraphic,
                {
                  shape: node.params.shape ?? 0,
                  squareness: node.params.squareness ?? 0
                }
              ) : null,
              showSliderDisplay ? /* @__PURE__ */ jsx6(
                SliderDisplay,
                {
                  value: node.params.value ?? 0.5,
                  displayValue: data.midiSliderValue ?? data.audioSliderValue,
                  direction: Math.round(node.params.direction ?? 0) === 1 ? "vertical" : "horizontal",
                  onChange: (value) => data.onParamChange(node.id, "value", value)
                }
              ) : null,
              showJoystickDisplay ? /* @__PURE__ */ jsx6(
                JoystickDisplay,
                {
                  x: data.midiJoystickPosition?.x ?? node.params.x ?? 0.5,
                  y: data.midiJoystickPosition?.y ?? node.params.y ?? 0.5,
                  elasticity: node.params.elasticity ?? 0,
                  onChange: (x, y) => data.onParamsChange(node.id, { x, y })
                }
              ) : null,
              showButtonDisplay ? /* @__PURE__ */ jsx6(
                ButtonDisplay,
                {
                  mode: buttonModeFromValue(node.params.mode ?? 0),
                  pressed: data.midiButtonPressed ?? node.params.pressed ?? 0,
                  onPressedChange: (value) => data.onParamChange(node.id, "pressed", value),
                  onClickPulse: () => data.onParamChange(node.id, "clicks", (node.params.clicks ?? 0) + 1)
                }
              ) : null,
              showKeysDisplay ? /* @__PURE__ */ jsx6(
                KeysDisplay,
                {
                  size: node.params.size ?? 12,
                  startNote: node.params.startNote ?? 60,
                  mode: node.params.mode ?? 0,
                  activeNote: node.params.frequency > 0 ? Math.round(node.params.note ?? -1) : null,
                  onNoteChange: (note) => {
                    data.onParamsChange(node.id, { note: note ?? 0, frequency: note === null ? 0 : midiNoteToFrequency(note), ...hostedMode?.bridgeVersion === 2 && hostedMode.gestures ? { gate: note === null ? 0 : 1, velocity: note === null ? 0 : 1 } : {} });
                  }
                }
              ) : null,
              showMeterDisplay ? /* @__PURE__ */ jsxs5("div", { className: "audio-node-meter-display", "aria-hidden": "true", children: [
                /* @__PURE__ */ jsx6(ChartGrid, { width: 160, height: 48, columns: meterGridTicks, rows: meterGridRows, showColumnLabels: true }),
                /* @__PURE__ */ jsx6(
                  "span",
                  {
                    className: "audio-node-meter-fill",
                    style: meterMode === "bipolar" ? {
                      left: `${(0.5 + Math.min(0, meterLevel) * 0.5) * 100}%`,
                      width: `${Math.abs(meterLevel) * 50}%`
                    } : { width: `${meterLevel * 100}%` }
                  }
                ),
                meterMode === "bipolar" ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                  /* @__PURE__ */ jsx6("span", { className: "audio-node-meter-peak", style: { left: `${(0.5 + bipolarMeterPeaks.positive * 0.5) * 100}%` } }),
                  /* @__PURE__ */ jsx6("span", { className: "audio-node-meter-peak", style: { left: `${(0.5 - bipolarMeterPeaks.negative * 0.5) * 100}%` } })
                ] }) : /* @__PURE__ */ jsx6("span", { className: "audio-node-meter-peak", style: { left: `${meterPeak * 100}%` } })
              ] }) : null,
              showScopeDisplay ? /* @__PURE__ */ jsxs5("div", { ref: scopeDisplayRef, "data-fullscreen-scope-id": flowNodeId, className: "audio-node-scope-display", children: [
                /* @__PURE__ */ jsx6(ChartGrid, { width: 160, height: 48, columns: scopeGridTicks, rows: scopeScaleTicks, showRowLabels: true }),
                /* @__PURE__ */ jsxs5("svg", { className: "audio-node-scope-waveform", viewBox: "0 0 160 48", preserveAspectRatio: "none", "aria-label": "Live scope waveform", children: [
                  /* @__PURE__ */ jsx6("defs", { children: /* @__PURE__ */ jsxs5("linearGradient", { id: scopeGradientId, gradientUnits: "userSpaceOnUse", x1: "0", y1: "0", x2: "160", y2: "0", children: [
                    /* @__PURE__ */ jsx6("stop", { offset: "0", stopColor: "var(--color-accent)", stopOpacity: "0.3" }),
                    /* @__PURE__ */ jsx6("stop", { offset: "0.65", stopColor: "var(--color-accent)", stopOpacity: "0.72" }),
                    /* @__PURE__ */ jsx6("stop", { offset: "1", stopColor: "var(--color-accent)", stopOpacity: "1" })
                  ] }) }),
                  /* @__PURE__ */ jsx6("path", { d: scopePath, style: { stroke: `var(--scope-trace-stroke, url(#${scopeGradientId}))` } })
                ] }),
                /* @__PURE__ */ jsx6(
                  "button",
                  {
                    type: "button",
                    className: "audio-node-scope-fullscreen nodrag nopan nowheel",
                    "aria-label": "Show scope full screen",
                    title: "Show scope full screen (Esc to exit)",
                    onPointerDown: (event) => event.stopPropagation(),
                    onDoubleClick: (event) => event.stopPropagation(),
                    onClick: async (event) => {
                      event.stopPropagation();
                      setScopeFullscreenError("");
                      try {
                        if (!scopeDisplayRef.current?.requestFullscreen) throw new Error("Fullscreen unavailable");
                        await scopeDisplayRef.current.requestFullscreen();
                      } catch {
                        setScopeFullscreenError("Full screen is unavailable in this browser window.");
                      }
                    },
                    children: /* @__PURE__ */ jsx6("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", children: /* @__PURE__ */ jsx6("path", { d: "M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4" }) })
                  }
                ),
                scopeFullscreenError ? /* @__PURE__ */ jsx6("span", { className: "audio-node-scope-fullscreen-error", role: "alert", children: scopeFullscreenError }) : null
              ] }) : null,
              showFftDisplay ? /* @__PURE__ */ jsxs5(
                "div",
                {
                  ref: fftDisplayRef,
                  className: "audio-node-spectrum-display nodrag nopan",
                  "aria-label": "Live frequency spectrum",
                  onPointerMove: handleFftBoundaryPointerMove,
                  onPointerUp: (event) => finishFftBoundaryDrag(event.pointerId),
                  onPointerCancel: (event) => finishFftBoundaryDrag(event.pointerId),
                  onLostPointerCapture: (event) => finishFftBoundaryDrag(event.pointerId),
                  onClick: (event) => event.stopPropagation(),
                  children: [
                    /* @__PURE__ */ jsx6(ChartGrid, { width: 320, height: 96, columns: fftGridTicks, rows: fftGridRows, showColumnLabels: true }),
                    /* @__PURE__ */ jsx6("div", { className: "audio-node-spectrum-bars", "aria-hidden": "true", children: spectrumBars.map((bar, index) => /* @__PURE__ */ jsx6(
                      "span",
                      {
                        className: "audio-node-spectrum-bar",
                        style: {
                          height: `${Math.max(1.5, bar.level * 100)}%`,
                          opacity: spectrumWindowOpacity(bar, fftWindowStart, fftWindowEnd)
                        }
                      },
                      index
                    )) }),
                    /* @__PURE__ */ jsx6(
                      "span",
                      {
                        className: "audio-node-spectrum-window-fade audio-node-spectrum-window-fade-low",
                        style: { width: `${fftWindowStartFraction * 100}%` },
                        "aria-hidden": "true"
                      }
                    ),
                    /* @__PURE__ */ jsx6(
                      "span",
                      {
                        className: "audio-node-spectrum-window-fade audio-node-spectrum-window-fade-high",
                        style: { left: `${fftWindowEndFraction * 100}%` },
                        "aria-hidden": "true"
                      }
                    ),
                    /* @__PURE__ */ jsx6(
                      "span",
                      {
                        className: "audio-node-spectrum-boundary audio-node-spectrum-boundary-min",
                        style: { left: `${fftWindowStartFraction * 100}%` },
                        role: "slider",
                        "aria-label": "Minimum analysis frequency",
                        "aria-valuemin": FFT_ANALYSIS_MIN_FREQUENCY,
                        "aria-valuemax": fftWindowEnd,
                        "aria-valuenow": fftWindowStart,
                        title: `Min frequency: ${fftWindowStart} Hz`,
                        onPointerDown: (event) => handleFftBoundaryPointerDown(event, "min")
                      }
                    ),
                    /* @__PURE__ */ jsx6(
                      "span",
                      {
                        className: "audio-node-spectrum-boundary audio-node-spectrum-boundary-max",
                        style: { left: `${fftWindowEndFraction * 100}%` },
                        role: "slider",
                        "aria-label": "Maximum analysis frequency",
                        "aria-valuemin": fftWindowStart,
                        "aria-valuemax": FFT_ANALYSIS_MAX_FREQUENCY,
                        "aria-valuenow": fftWindowEnd,
                        title: `Max frequency: ${fftWindowEnd} Hz`,
                        onPointerDown: (event) => handleFftBoundaryPointerDown(event, "max")
                      }
                    )
                  ]
                }
              ) : null
            ] }),
            showAccumulatorDisplay ? /* @__PURE__ */ jsx6("div", { className: "accumulator-value-label", "aria-label": "Accumulator current value", children: formatAccumulatorValue(data.audioAccumulatorValue ?? node.params.min ?? 0) }) : null,
            showSequencerDisplay && sequencer ? /* @__PURE__ */ jsx6(
              SequencerGrid,
              {
                params: node.params,
                rows: sequencer.rows,
                rowLabels: node.sequencerRowLabels,
                hasSavedLabelColumnWidth: node.sequencerRowLabelColumnWidth !== void 0,
                steps: sequencer.steps,
                beatLength: sequencer.beatLength,
                currentStep: data.audioSequencerStep,
                selectedLinkOutputs,
                setOutputRowRef: (port, element) => {
                  outputPortRowsRef.current[port] = element;
                },
                onParamsChange: (values) => data.onParamsChange(node.id, values),
                onRowLabelsChange: (labels) => data.onSequencerRowLabelsChange?.(node.id, labels)
              }
            ) : null,
            showRollDisplay && roll ? /* @__PURE__ */ jsx6(
              RollGrid,
              {
                params: node.params,
                steps: roll.steps,
                beatLength: roll.beatLength,
                stepLength: roll.stepLength,
                rows: roll.rows,
                startNote: roll.middleNote,
                currentStep: data.audioSequencerStep,
                onParamsChange: (values) => data.onParamsChange(node.id, values)
              }
            ) : null,
            showAudioOutputDisplay ? /* @__PURE__ */ jsxs5("div", { className: "audio-out-node-meter", "aria-label": "Audio output level", children: [
              /* @__PURE__ */ jsx6(AudioOutputMeterRow, { label: "L", level: outputMeterLeft }),
              /* @__PURE__ */ jsx6(AudioOutputMeterRow, { label: "R", level: outputMeterRight })
            ] }) : null,
            /* @__PURE__ */ jsxs5("div", { className: [
              showTopGraphic ? "shader-node-content-ports" : "shader-node-content-ports-empty",
              normalOutputPorts.length === 0 ? "shader-node-content-ports-no-outputs" : ""
            ].filter(Boolean).join(" "), children: [
              /* @__PURE__ */ jsxs5("div", { className: "shader-ports shader-inputs", style: inputStyle, children: [
                visibleInputPorts.map((input) => /* @__PURE__ */ jsxs5(
                  "div",
                  {
                    className: [
                      "shader-port shader-port-input",
                      node.type === "Reverb" && input.name === "mode" ? "shader-port-reverb-mode" : "",
                      input.preview ? "shader-port-preview" : ""
                    ].filter(Boolean).join(" "),
                    ref: (element) => {
                      inputPortRowsRef.current[input.name] = element;
                    },
                    onDoubleClick: (event) => {
                      if (input.preview) return;
                      if (input.connectable === false) return;
                      event.stopPropagation();
                      data.onPortDoubleClick(node.id, "input", input.name);
                    },
                    children: [
                      input.connectable !== false ? /* @__PURE__ */ jsx6(
                        Handle,
                        {
                          id: `in:${input.name}`,
                          type: "target",
                          position: Position2.Left,
                          className: [
                            "shader-handle shader-handle-input",
                            selectedLinkInputs.includes(input.name) ? "shader-handle-selected-link" : ""
                          ].filter(Boolean).join(" "),
                          onDoubleClick: (event) => {
                            if (input.preview) return;
                            event.stopPropagation();
                            data.onPortDoubleClick(node.id, "input", input.name);
                          }
                        }
                      ) : null,
                      isSelector && isSelectorValuePort(input.name) && !input.preview ? /* @__PURE__ */ jsx6(
                        "button",
                        {
                          className: [
                            "selector-index-button nodrag nopan",
                            selectorSelectedIndex === Number(input.name) ? "selector-index-button-active" : ""
                          ].filter(Boolean).join(" "),
                          type: "button",
                          title: `Select input ${input.name}`,
                          onPointerDown: (event) => event.stopPropagation(),
                          onDoubleClick: (event) => event.stopPropagation(),
                          onClick: (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            data.onParamChange(node.id, "select", Number(input.name));
                          },
                          children: input.name
                        }
                      ) : node.type === "Reverb" && input.name === "mode" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": "Reverb mode",
                            value: String(Math.round(node.params.mode ?? input.defaultValue ?? 0)),
                            onChange: (event) => {
                              data.onParamChange(node.id, "mode", Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "original" }),
                              /* @__PURE__ */ jsx6("option", { value: "1", children: "dattorro plate" }),
                              /* @__PURE__ */ jsx6("option", { value: "2", children: "feedback delay network" })
                            ]
                          }
                        )
                      ] }) : showKeysDisplay && input.name === "mode" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": "Keys mode",
                            value: String(Math.round(node.params.mode ?? input.defaultValue ?? 0)),
                            onChange: (event) => {
                              data.onParamChange(node.id, "mode", Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "gate" }),
                              /* @__PURE__ */ jsx6("option", { value: "1", children: "hold" })
                            ]
                          }
                        )
                      ] }) : showCustomWaveEditor && input.name === "mode" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsx6(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": "Custom Wave mode",
                            value: customWave?.mode ?? CUSTOM_WAVE_MODES[0].value,
                            onChange: (event) => {
                              if (customWave) commitCustomWave({ ...customWave, mode: event.currentTarget.value }, `custom-wave-mode:${node.id}`);
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: CUSTOM_WAVE_MODES.map((mode) => /* @__PURE__ */ jsx6("option", { value: mode.value, children: mode.label }, mode.value))
                          }
                        )
                      ] }) : showSliderDisplay && input.name === "direction" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            value: String(Math.round(node.params.direction ?? input.defaultValue ?? 0)),
                            onChange: (event) => {
                              data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "horizontal" }),
                              /* @__PURE__ */ jsx6("option", { value: "1", children: "vertical" })
                            ]
                          }
                        )
                      ] }) : showSequencerDisplay && input.name === "mode" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": "Sequencer mode",
                            value: sequencerUsesGateMode(node.params) ? "1" : "0",
                            onChange: (event) => {
                              const gateMode = Number(event.currentTarget.value) >= 0.5;
                              const values = {
                                [SEQUENCER_GATE_MODE_PARAM]: gateMode ? 1 : 0
                              };
                              if (gateMode) {
                                values[SEQUENCER_GATE_INITIALIZED_PARAM] = 1;
                                for (let rowIndex = 0; rowIndex < (sequencer?.rows ?? 0); rowIndex += 1) {
                                  const triggers = sequencerTriggersForRow(node.params, rowIndex, sequencer?.steps ?? 0);
                                  for (let stepIndex = 0; stepIndex < (sequencer?.steps ?? 0); stepIndex += 1) {
                                    values[sequencerGateParamName(rowIndex, stepIndex, "active")] = 0;
                                  }
                                  const convertedGates = trimOverlappingSequencerGates(triggers.map((trigger, slot) => {
                                    const start = Math.min(sequencer?.steps ?? 0, trigger.position);
                                    return { slot, start, end: Math.min(sequencer?.steps ?? 0, start + 1), velocity: trigger.velocity };
                                  }));
                                  for (const gate of convertedGates) {
                                    const { slot, start, end } = gate;
                                    values[sequencerGateParamName(rowIndex, slot, "active")] = 1;
                                    values[sequencerGateParamName(rowIndex, slot, "start")] = start;
                                    values[sequencerGateParamName(rowIndex, slot, "end")] = end;
                                    values[sequencerStepVelocityParamName(rowIndex, slot)] = gate.velocity;
                                  }
                                }
                              } else {
                                for (let rowIndex = 0; rowIndex < (sequencer?.rows ?? 0); rowIndex += 1) {
                                  const gates = sequencerGatesForRow(node.params, rowIndex, sequencer?.steps ?? 0);
                                  for (let stepIndex = 0; stepIndex < (sequencer?.steps ?? 0); stepIndex += 1) {
                                    values[sequencerCellParamName(rowIndex, stepIndex)] = 0;
                                    values[sequencerGateParamName(rowIndex, stepIndex, "active")] = 0;
                                  }
                                  for (const [slot, gate] of gates.entries()) {
                                    const position = Math.max(0, Math.min((sequencer?.steps ?? 1) - SEQUENCER_TRIGGER_GRAB_FRACTION, gate.start));
                                    values[sequencerCellParamName(rowIndex, slot)] = 1;
                                    values[sequencerTriggerPositionParamName(rowIndex, slot)] = position;
                                  }
                                }
                              }
                              data.onParamsChange(node.id, values);
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "trigger" }),
                              /* @__PURE__ */ jsx6("option", { value: "1", children: "gate" })
                            ]
                          }
                        )
                      ] }) : (showMeterDisplay || showScopeDisplay) && input.name === "mode" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": `${showMeterDisplay ? "Meter" : "Scope"} mode`,
                            value: String(Math.round(node.params.mode ?? input.defaultValue ?? 0)),
                            onChange: (event) => {
                              data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "unipolar" }),
                              /* @__PURE__ */ jsx6("option", { value: "1", children: "bipolar" })
                            ]
                          }
                        )
                      ] }) : showScopeDisplay && input.name === "reset" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": "Scope reset",
                            value: String(Math.round(node.params.reset ?? input.defaultValue ?? 1)),
                            onChange: (event) => {
                              data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "none" }),
                              /* @__PURE__ */ jsx6("option", { value: "1", children: "zero-crossing" })
                            ]
                          }
                        )
                      ] }) : showSampleUpload && input.name === "mode" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            value: String(Math.round(node.params.mode ?? input.defaultValue ?? 0)),
                            onChange: (event) => {
                              data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "one-shot" }),
                              /* @__PURE__ */ jsx6("option", { value: "1", children: "loop" }),
                              /* @__PURE__ */ jsx6("option", { value: "2", children: "ping-pong" })
                            ]
                          }
                        )
                      ] }) : showBufferDisplay && input.name === "on reset" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": "Buffer on reset",
                            value: String(clamp(Math.round(node.params["on reset"] ?? input.defaultValue ?? 0), 0, 1)),
                            onChange: (event) => {
                              data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "clear" }),
                              /* @__PURE__ */ jsx6("option", { value: "1", children: "preserve" })
                            ]
                          }
                        )
                      ] }) : showTempoDisplay && input.name === "source" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": "Tempo source",
                            value: String(clamp(Math.round(node.params.source ?? input.defaultValue ?? 0), 0, 1)),
                            onChange: (event) => {
                              data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "internal" }),
                              /* @__PURE__ */ jsx6("option", { value: "1", children: "midi" })
                            ]
                          }
                        )
                      ] }) : showTempoDisplay && input.name === "midiSource" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": "MIDI clock source",
                            value: String(clamp(Math.round(node.params.midiSource ?? input.defaultValue ?? 0), 0, Math.max(0, data.midiInput?.devices.length ?? 0))),
                            onChange: (event) => {
                              data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "any midi" }),
                              (data.midiInput?.devices ?? []).map((device, index) => /* @__PURE__ */ jsx6("option", { value: index + 1, children: device.label || `MIDI ${index + 1}` }, device.id || `${device.label}-${index}`))
                            ]
                          }
                        )
                      ] }) : showButtonDisplay && input.name === "mode" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            value: String(Math.round(node.params.mode ?? input.defaultValue ?? 0)),
                            onChange: (event) => {
                              data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "toggle" }),
                              /* @__PURE__ */ jsx6("option", { value: "1", children: "trigger" }),
                              /* @__PURE__ */ jsx6("option", { value: "2", children: "temporary" })
                            ]
                          }
                        )
                      ] }) : showAccumulatorDisplay && input.name === "mode" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsxs5(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": "Accumulator mode",
                            value: String(Math.round(node.params.mode ?? input.defaultValue ?? 0)),
                            onChange: (event) => {
                              data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: [
                              /* @__PURE__ */ jsx6("option", { value: "0", children: "trigger" }),
                              /* @__PURE__ */ jsx6("option", { value: "1", children: "continuous" })
                            ]
                          }
                        )
                      ] }) : (showQuantiseDisplay || showRollDisplay) && input.name === "scale" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsx6(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": `${node.type} scale`,
                            value: String(clamp(Math.round(node.params.scale ?? input.defaultValue ?? 0), 0, QUANTISE_SCALES.length - 1)),
                            onChange: (event) => {
                              data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: QUANTISE_SCALES.map((scale, index) => /* @__PURE__ */ jsx6("option", { value: index, children: scale.label }, scale.label))
                          }
                        )
                      ] }) : showQuantiseDisplay && input.name === "root" && !input.preview ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
                        /* @__PURE__ */ jsx6(
                          PortNameLabel,
                          {
                            name: input.name,
                            editable: false,
                            draggable: false,
                            preview: false,
                            selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                            activeDragTarget: false,
                            activeDragSource: false,
                            onChange: () => void 0
                          }
                        ),
                        /* @__PURE__ */ jsx6(
                          "select",
                          {
                            className: "shader-port-select nodrag nopan",
                            "aria-label": `${node.type} root`,
                            value: String(normalisePitchClass(node.params.root ?? input.defaultValue ?? 0)),
                            onChange: (event) => {
                              data.onParamChange(node.id, input.name, Number(event.currentTarget.value));
                              event.currentTarget.blur();
                            },
                            onPointerDown: (event) => event.stopPropagation(),
                            onClick: (event) => event.stopPropagation(),
                            onDoubleClick: (event) => event.stopPropagation(),
                            children: PITCH_CLASSES.map((pitchClass, note) => /* @__PURE__ */ jsx6("option", { value: note, children: pitchClass }, pitchClass))
                          }
                        )
                      ] }) : showRollDisplay && input.name === "middle note" && !input.preview ? /* @__PURE__ */ jsx6(
                        NoteRangeSelect,
                        {
                          label: input.name,
                          value: node.params[input.name] ?? input.defaultValue ?? 60,
                          min: 0,
                          max: 127,
                          onChange: (value) => data.onParamChange(node.id, input.name, value)
                        }
                      ) : /* @__PURE__ */ jsx6(
                        PortNameLabel,
                        {
                          name: input.name,
                          editable: canRenameInputs && !input.preview,
                          draggable: canRenameInputs && !input.preview,
                          preview: input.preview,
                          selected: data.selectedPort?.side === "input" && data.selectedPort.name === input.name,
                          activeDragTarget: dragTarget?.side === "input" && dragTarget.port === input.name,
                          activeDragSource: dragSource?.side === "input" && dragSource.port === input.name,
                          onPointerDown: (event) => {
                            if (input.preview) return;
                            if (!canRenameInputs) return;
                            handlePortPointerDown(event, "input", input.name);
                          },
                          onChange: (nextName) => data.onPortNameChange(node.id, "input", input.name, nextName)
                        }
                      ),
                      !input.preview && node.type !== "Outs" && input.valueEditor !== false && input.defaultValue !== void 0 && !(showKeysDisplay && input.name === "mode") && !(showCustomWaveEditor && input.name === "mode") && !(showSliderDisplay && input.name === "direction") && !(showSequencerDisplay && input.name === "mode") && !(showButtonDisplay && input.name === "mode") && !(showAccumulatorDisplay && input.name === "mode") && !(showQuantiseDisplay && (input.name === "scale" || input.name === "root")) && !(showSampleUpload && input.name === "mode") && !(showTempoDisplay && (input.name === "source" || input.name === "midiSource")) ? /* @__PURE__ */ jsx6(
                        NumericScrubber,
                        {
                          value: node.params[input.name] ?? input.defaultValue ?? 0,
                          min: input.min,
                          max: input.max,
                          integer: input.integer,
                          step: input.step,
                          replacedBySetLink: setLinkInputPorts.has(input.name),
                          onChange: (value) => data.onParamChange(node.id, input.name, value),
                          onClear: isSelector && isSelectorValuePort(input.name) ? () => data.onSelectorInputClear?.(node.id, input.name) : void 0,
                          midiLearnEvent: canLearnMidiCc(node.type, input.name) ? data.midiInput?.lastControlChange : void 0,
                          onEditStart: canLearnMidiCc(node.type, input.name) ? () => {
                            void data.onMidiInputRefresh?.();
                          } : void 0,
                          onMidiLearn: canLearnMidiCc(node.type, input.name) ? (event) => {
                            data.onParamChange(node.id, input.name, event.cc);
                            if (node.type === "Slider" || node.type === "Button") {
                              data.onParamChange(node.id, "midiChannel", event.channel);
                            } else if (node.type === "Joystick") {
                              data.onParamChange(node.id, input.name === "xMidiCc" ? "xMidiChannel" : "yMidiChannel", event.channel);
                            } else if (node.type === "MidiCc") {
                              data.onParamChange(node.id, "channel", event.channel);
                            }
                          } : void 0
                        }
                      ) : null
                    ]
                  },
                  `${input.preview ? "preview" : "port"}:${input.name}`
                )),
                isSelector && showAllPorts ? /* @__PURE__ */ jsx6(
                  "button",
                  {
                    className: "selector-add-input-button nodrag nopan",
                    type: "button",
                    "aria-label": "Add selector input",
                    title: "Add selector input",
                    onPointerDown: (event) => event.stopPropagation(),
                    onDoubleClick: (event) => event.stopPropagation(),
                    onClick: (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      data.onSelectorInputAdd?.(node.id);
                    },
                    children: "+"
                  }
                ) : null,
                node.type === "Outs" ? /* @__PURE__ */ jsx6(NewPortPlaceholder, { label: newPortLabel, onAdd: (name) => data.onPortAdd(node.id, newPortSide, name) }) : null
              ] }),
              normalOutputPorts.length > 0 || hasNewPortPlaceholder && newPortSide === "output" ? /* @__PURE__ */ jsxs5("div", { className: `shader-ports shader-outputs${node.type === "Params" ? " shader-params-outputs" : ""}`, children: [
                node.type === "Params" ? /* @__PURE__ */ jsxs5("div", { className: "shader-params-columns", "aria-hidden": "true", children: [
                  /* @__PURE__ */ jsx6("span", { children: "default" }),
                  /* @__PURE__ */ jsx6("span", { children: "min" }),
                  /* @__PURE__ */ jsx6("span", { children: "max" })
                ] }) : null,
                normalOutputPorts.map((output) => /* @__PURE__ */ jsxs5(
                  "div",
                  {
                    className: [
                      "shader-port shader-port-output",
                      output.preview ? "shader-port-preview" : ""
                    ].filter(Boolean).join(" "),
                    ref: (element) => {
                      outputPortRowsRef.current[output.name] = element;
                    },
                    onDoubleClick: (event) => {
                      if (output.preview) return;
                      event.stopPropagation();
                      data.onPortDoubleClick(node.id, "output", output.name);
                    },
                    children: [
                      /* @__PURE__ */ jsx6(
                        PortNameLabel,
                        {
                          name: output.name,
                          editable: canRenameOutputs && !output.preview,
                          draggable: canRenameOutputs && !output.preview,
                          preview: output.preview,
                          selected: data.selectedPort?.side === "output" && data.selectedPort.name === output.name,
                          activeDragTarget: dragTarget?.side === "output" && dragTarget.port === output.name,
                          activeDragSource: dragSource?.side === "output" && dragSource.port === output.name,
                          onPointerDown: (event) => {
                            if (output.preview) return;
                            if (!canRenameOutputs) return;
                            handlePortPointerDown(event, "output", output.name);
                          },
                          onChange: (nextName) => data.onPortNameChange(node.id, "output", output.name, nextName)
                        }
                      ),
                      !output.preview && (node.type === "Ins" || node.type === "Params") && output.valueEditor !== false ? /* @__PURE__ */ jsxs5("div", { className: node.type === "Params" ? "shader-params-values" : void 0, children: [
                        /* @__PURE__ */ jsx6(
                          NumericScrubber,
                          {
                            value: node.params[output.name] ?? output.defaultValue ?? 0,
                            min: node.type === "Ins" ? output.min : void 0,
                            max: node.type === "Ins" ? output.max : void 0,
                            integer: output.integer,
                            onChange: (value) => data.onParamChange(node.id, output.name, value)
                          }
                        ),
                        node.type === "Params" ? ["min", "max"].map((bound) => /* @__PURE__ */ jsx6(
                          NumericScrubber,
                          {
                            value: output[bound] ?? (bound === "min" ? 0 : 1),
                            onChange: (value) => data.onParamRangeChange?.(node.id, output.name, bound, value)
                          },
                          bound
                        )) : null
                      ] }) : null,
                      /* @__PURE__ */ jsx6(
                        Handle,
                        {
                          id: `out:${output.name}`,
                          type: "source",
                          position: Position2.Right,
                          className: [
                            "shader-handle shader-handle-output",
                            selectedLinkOutputs.includes(output.name) ? "shader-handle-selected-link" : ""
                          ].filter(Boolean).join(" "),
                          onDoubleClick: (event) => {
                            if (output.preview) return;
                            event.stopPropagation();
                            data.onPortDoubleClick(node.id, "output", output.name);
                          }
                        }
                      )
                    ]
                  },
                  `${output.preview ? "preview" : "port"}:${output.name}`
                )),
                hasNewPortPlaceholder && newPortSide === "output" ? /* @__PURE__ */ jsx6(NewPortPlaceholder, { label: newPortLabel, onAdd: (name) => data.onPortAdd(node.id, newPortSide, name) }) : null
              ] }) : null
            ] }),
            showResizableDisplay && !isCanvasLocked && !isAreaUiCollapsedPresentation ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
              /* @__PURE__ */ jsx6(
                "span",
                {
                  className: [
                    "audio-node-scope-resize-handle audio-node-scope-resize-handle-left nodrag nopan",
                    scopeResizeCorner === "bottom-left" ? "audio-node-scope-resize-handle-active" : ""
                  ].filter(Boolean).join(" "),
                  title: showSequencerDisplay ? "Resize sequencer" : showCustomWaveEditor ? "Resize custom wave" : showSampleUpload ? "Resize sample waveform" : showBufferDisplay ? "Resize buffer waveform" : showImageDisplay ? "Resize image" : showKeysDisplay ? "Resize keys" : showSliderDisplay ? "Resize slider" : showJoystickDisplay ? "Resize joystick" : showButtonDisplay ? "Resize button" : showMeterDisplay ? "Resize meter" : showFftDisplay ? "Resize FFT" : "Resize scope",
                  onPointerDown: (event) => handleScopeResizePointerDown(event, "bottom-left"),
                  onClick: handleScopeResizeClick,
                  onDoubleClick: (event) => event.stopPropagation()
                }
              ),
              /* @__PURE__ */ jsx6(
                "span",
                {
                  className: [
                    "audio-node-scope-resize-handle audio-node-scope-resize-handle-right nodrag nopan",
                    scopeResizeCorner === "bottom-right" ? "audio-node-scope-resize-handle-active" : ""
                  ].filter(Boolean).join(" "),
                  title: showSequencerDisplay ? "Resize sequencer" : showCustomWaveEditor ? "Resize custom wave" : showSampleUpload ? "Resize sample waveform" : showBufferDisplay ? "Resize buffer waveform" : showImageDisplay ? "Resize image" : showKeysDisplay ? "Resize keys" : showSliderDisplay ? "Resize slider" : showJoystickDisplay ? "Resize joystick" : showButtonDisplay ? "Resize button" : showMeterDisplay ? "Resize meter" : showFftDisplay ? "Resize FFT" : "Resize scope",
                  onPointerDown: (event) => handleScopeResizePointerDown(event, "bottom-right"),
                  onClick: handleScopeResizeClick,
                  onDoubleClick: (event) => event.stopPropagation()
                }
              )
            ] }) : null
          ] });
        })() : /* @__PURE__ */ jsxs5("div", { className: "shader-node-body shader-node-body-draft", children: [
          /* @__PURE__ */ jsx6("div", { className: "shader-ports shader-inputs", children: /* @__PURE__ */ jsxs5("div", { className: "shader-port shader-port-input", children: [
            /* @__PURE__ */ jsx6(
              Handle,
              {
                id: "in:value",
                type: "target",
                position: Position2.Left,
                className: "shader-handle shader-handle-input"
              }
            ),
            /* @__PURE__ */ jsx6("span", { children: "in" })
          ] }) }),
          /* @__PURE__ */ jsx6("div", { className: "shader-ports shader-outputs", children: /* @__PURE__ */ jsxs5("div", { className: "shader-port shader-port-output", children: [
            /* @__PURE__ */ jsx6("span", { children: "out" }),
            /* @__PURE__ */ jsx6(
              Handle,
              {
                id: "out:value",
                type: "source",
                position: Position2.Right,
                className: "shader-handle shader-handle-output"
              }
            )
          ] }) })
        ] })
      ]
    }
  );
});
function KinkOscGraphic({ shape, squareness }) {
  const safeShape = clamp(Number.isFinite(shape) ? shape : 0, -1, 1);
  const safeSquareness = clamp(Number.isFinite(squareness) ? squareness : 0, -1, 1);
  const magnitude = Math.abs(safeSquareness);
  const split = 0.5 * (1 - safeShape);
  let path;
  if (magnitude >= 1) {
    const startY = safeSquareness > 0 ? 43 : 5;
    const endY = safeSquareness > 0 ? 5 : 43;
    if (split === 0 || split === 1) {
      const level = split === 0 ? endY : startY;
      path = `M1 ${level} L155 ${level}`;
    } else {
      const splitX = (1 + split * 154).toFixed(2);
      path = `M1 ${startY} L${splitX} ${startY} L${splitX} ${endY} L155 ${endY} L155 ${startY}`;
    }
  } else {
    const exponent = 1 + 11 * magnitude / (1 - magnitude);
    const point = (phase, position, rising) => {
      const curvedPosition = safeSquareness >= 0 ? position ** exponent : 1 - (1 - position) ** exponent;
      const curved = rising ? -1 + 2 * curvedPosition : 1 - 2 * curvedPosition;
      const straight = rising ? -1 + 2 * position : 1 - 2 * position;
      const value = straight + (curved - straight) * magnitude;
      const x = (1 + phase * 154).toFixed(2);
      const y = (24 - value * 19).toFixed(2);
      return `L${x} ${y}`;
    };
    const points = ["M1 43"];
    if (split === 0) points.push("L1 5");
    else for (let index = 1; index <= 48; index += 1) {
      const position = index / 48;
      points.push(point(split * position, position, true));
    }
    if (split === 1) points.push("L155 43");
    else for (let index = 1; index <= 48; index += 1) {
      const position = index / 48;
      points.push(point(split + (1 - split) * position, position, false));
    }
    path = points.join(" ");
  }
  return /* @__PURE__ */ jsx6("div", { className: "kink-osc-display", role: "img", "aria-label": `Kink Osc waveform, shape ${safeShape.toFixed(2)}, squareness ${safeSquareness.toFixed(2)}`, children: /* @__PURE__ */ jsxs5("svg", { viewBox: "0 0 156 48", preserveAspectRatio: "none", role: "img", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsx6("path", { className: "kink-osc-display-grid", d: "M0 5H156M0 24H156M0 43H156M39 0V48M78 0V48M117 0V48" }),
    /* @__PURE__ */ jsx6("path", { className: "kink-osc-display-trace", d: path })
  ] }) });
}
function BufferWaveformDisplay({ bins, playhead, recordHead, detail, onClear }) {
  const width = 300;
  const height = 128;
  const horizontalPadding = 8;
  const waveformPath = sampleWaveformPath(
    waveformBinsForDetail(bins, detail),
    horizontalPadding,
    width - horizontalPadding,
    height,
    0
  );
  const headX = (head) => horizontalPadding + clamp(head, 0, 1) * (width - horizontalPadding * 2);
  return /* @__PURE__ */ jsxs5("div", { className: "sample-waveform-display buffer-waveform-display nodrag nopan", children: [
    /* @__PURE__ */ jsx6(
      "svg",
      {
        className: "sample-waveform-canvas",
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: "none",
        "aria-label": "Buffer waveform",
        role: "img",
        children: /* @__PURE__ */ jsxs5("g", { className: "sample-waveform-chart-chrome", children: [
          /* @__PURE__ */ jsx6("line", { className: "custom-wave-grid-line", x1: horizontalPadding, y1: "0", x2: width - horizontalPadding, y2: "0" }),
          /* @__PURE__ */ jsx6("line", { className: "custom-wave-grid-line custom-wave-zero", x1: horizontalPadding, y1: height / 2, x2: width - horizontalPadding, y2: height / 2 }),
          /* @__PURE__ */ jsx6("line", { className: "custom-wave-grid-line", x1: horizontalPadding, y1: height, x2: width - horizontalPadding, y2: height }),
          waveformPath ? /* @__PURE__ */ jsx6("path", { className: "sample-waveform-path", d: waveformPath }) : null,
          /* @__PURE__ */ jsx6("line", { className: "wave-playhead-line", x1: headX(playhead), y1: "0", x2: headX(playhead), y2: height, children: /* @__PURE__ */ jsx6("title", { children: "Playhead" }) }),
          /* @__PURE__ */ jsx6("line", { className: "buffer-record-head-line", x1: headX(recordHead), y1: "0", x2: headX(recordHead), y2: height, children: /* @__PURE__ */ jsx6("title", { children: "Record head" }) })
        ] })
      }
    ),
    /* @__PURE__ */ jsx6(
      "button",
      {
        className: "buffer-clear-button nodrag nopan",
        type: "button",
        onClick: onClear,
        onPointerDown: (event) => event.stopPropagation(),
        children: "CLEAR"
      }
    )
  ] });
}
function SampleWaveformDisplay({
  sampleUrl,
  playheads,
  start,
  end,
  attack,
  release,
  detail,
  onStartChange,
  onEndChange
}) {
  const hostedMode = useContext2(HostedModeContext);
  const [waveform, setWaveform] = useState6(null);
  const canvasRef = useRef6(null);
  const dragRef = useRef6(null);
  const safeStart = clamp(start, 0, 1);
  const safeEnd = clamp(end, 0, 1);
  const width = 300;
  const height = 128;
  const horizontalPadding = 8;
  const verticalPadding = 0;
  const innerWidth = width - horizontalPadding * 2;
  const sampleDuration = Math.max(1e-3, waveform?.duration ?? 1);
  const safeAttack = Math.max(0, attack);
  const safeRelease = Math.max(0, release);
  const playbackDirection = safeEnd >= safeStart ? 1 : -1;
  const startSeconds = safeStart * sampleDuration;
  const endSeconds = safeEnd * sampleDuration;
  const attackEndSeconds = startSeconds + playbackDirection * safeAttack;
  const releaseEndSeconds = endSeconds + playbackDirection * safeRelease;
  const timelineStart = Math.min(0, attackEndSeconds, releaseEndSeconds);
  const timelineEnd = Math.max(sampleDuration, attackEndSeconds, releaseEndSeconds);
  const timelineDuration = Math.max(1e-3, timelineEnd - timelineStart);
  const timelineX = (seconds) => horizontalPadding + (seconds - timelineStart) / timelineDuration * innerWidth;
  const waveformPath = waveform ? sampleWaveformPath(
    waveformBinsForDetail(waveform.bins, detail),
    timelineX(0),
    timelineX(sampleDuration),
    height,
    verticalPadding
  ) : "";
  const activePlayheads = playheads ?? [];
  const startX = timelineX(startSeconds);
  const endX = timelineX(endSeconds);
  const attackEndX = timelineX(attackEndSeconds);
  const releaseEndX = timelineX(releaseEndSeconds);
  const rangeStartX = Math.min(startX, endX);
  const rangeEndX = Math.max(startX, endX);
  const attackPhaseX = Math.min(startX, attackEndX);
  const attackPhaseWidth = Math.abs(attackEndX - startX);
  const releasePhaseX = Math.min(endX, releaseEndX);
  const releasePhaseWidth = Math.abs(releaseEndX - endX);
  function updateBoundaryFromPointer(event) {
    const drag = dragRef.current;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!drag || !bounds || bounds.width <= 0) return;
    const svgX = (event.clientX - bounds.left) / bounds.width * width;
    const value = clamp((timelineStart + (svgX - horizontalPadding) / innerWidth * timelineDuration) / sampleDuration, 0, 1);
    if (drag.boundary === "start") onStartChange(value);
    else onEndChange(value);
  }
  function handleBoundaryPointerDown(event, boundary) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { boundary, pointerId: event.pointerId };
    canvasRef.current?.setPointerCapture(event.pointerId);
    updateBoundaryFromPointer(event);
  }
  function handlePointerMove(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    updateBoundaryFromPointer(event);
  }
  function finishBoundaryDrag(pointerId) {
    if (dragRef.current?.pointerId !== pointerId) return;
    dragRef.current = null;
  }
  useEffect5(() => {
    let cancelled = false;
    setWaveform(null);
    if (!sampleUrl) return () => {
      cancelled = true;
    };
    const controller = new AbortController();
    const request = hostedMode ? hostedMode.assets?.waveform?.(sampleUrl, controller.signal) ?? Promise.resolve(null) : getSampleWaveform(sampleUrl);
    void request.then((nextWaveform) => {
      if (!cancelled && nextWaveform && Number.isFinite(nextWaveform.duration) && nextWaveform.duration > 0 && nextWaveform.bins.length <= 1024 && nextWaveform.bins.every((bin) => Number.isFinite(bin.min) && Number.isFinite(bin.max) && bin.min <= bin.max)) setWaveform(nextWaveform);
    }).catch(() => void 0);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sampleUrl, hostedMode?.assets]);
  return /* @__PURE__ */ jsxs5("div", { className: "sample-waveform-display nodrag nopan", children: [
    hostedMode && !hostedMode.assets?.waveform && /* @__PURE__ */ jsx6("span", { children: "Waveform preview requires host data" }),
    !hostedMode && sampleUrl && isVideoSampleUrl(sampleUrl) ? /* @__PURE__ */ jsx6(
      SampleVideoPreview,
      {
        sampleUrl,
        startPosition: safeStart,
        playbackPosition: activePlayheads.length > 0 ? activePlayheads[activePlayheads.length - 1] : void 0
      }
    ) : null,
    /* @__PURE__ */ jsxs5(
      "svg",
      {
        ref: canvasRef,
        className: "sample-waveform-canvas",
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: "none",
        "aria-label": sampleUrl ? "Sample waveform" : "Sample waveform preview",
        role: "img",
        onPointerMove: handlePointerMove,
        onPointerUp: (event) => {
          event.stopPropagation();
          finishBoundaryDrag(event.pointerId);
        },
        onPointerCancel: (event) => {
          event.stopPropagation();
          finishBoundaryDrag(event.pointerId);
        },
        onLostPointerCapture: (event) => {
          event.stopPropagation();
          finishBoundaryDrag(event.pointerId);
        },
        onClick: (event) => event.stopPropagation(),
        children: [
          /* @__PURE__ */ jsxs5("g", { className: "sample-waveform-chart-chrome", children: [
            /* @__PURE__ */ jsx6("line", { className: "custom-wave-grid-line", x1: horizontalPadding, y1: verticalPadding, x2: width - horizontalPadding, y2: verticalPadding }),
            /* @__PURE__ */ jsx6("line", { className: "custom-wave-grid-line custom-wave-zero", x1: horizontalPadding, y1: height / 2, x2: width - horizontalPadding, y2: height / 2 }),
            /* @__PURE__ */ jsx6("line", { className: "custom-wave-grid-line", x1: horizontalPadding, y1: height - verticalPadding, x2: width - horizontalPadding, y2: height - verticalPadding }),
            waveformPath ? /* @__PURE__ */ jsx6("path", { className: "sample-waveform-path", d: waveformPath }) : null,
            /* @__PURE__ */ jsx6("rect", { className: "sample-waveform-fade", x: horizontalPadding, y: verticalPadding, width: rangeStartX - horizontalPadding, height: height - verticalPadding * 2 }),
            /* @__PURE__ */ jsx6("rect", { className: "sample-waveform-fade", x: rangeEndX, y: verticalPadding, width: width - horizontalPadding - rangeEndX, height: height - verticalPadding * 2 }),
            safeAttack > 0 ? /* @__PURE__ */ jsx6("rect", { className: "sample-waveform-phase is-attack", x: attackPhaseX, y: verticalPadding, width: attackPhaseWidth, height: height - verticalPadding * 2 }) : null,
            safeRelease > 0 ? /* @__PURE__ */ jsx6("rect", { className: "sample-waveform-phase is-release", x: releasePhaseX, y: verticalPadding, width: releasePhaseWidth, height: height - verticalPadding * 2 }) : null,
            activePlayheads.map((playhead, index) => {
              const playheadX = timelineX(clamp(playhead, 0, 1) * sampleDuration);
              return /* @__PURE__ */ jsx6("line", { className: `wave-playhead-line wave-playhead-${index % 4}`, x1: playheadX, y1: verticalPadding, x2: playheadX, y2: height - verticalPadding, children: /* @__PURE__ */ jsxs5("title", { children: [
                "Playback ",
                index + 1
              ] }) }, `${index}:${playhead}`);
            }),
            /* @__PURE__ */ jsx6("line", { className: "sample-waveform-boundary-line is-start", x1: startX, y1: verticalPadding, x2: startX, y2: height - verticalPadding }),
            /* @__PURE__ */ jsx6("line", { className: "sample-waveform-boundary-line is-end", x1: endX, y1: verticalPadding, x2: endX, y2: height - verticalPadding }),
            safeAttack > 0 ? /* @__PURE__ */ jsx6("line", { className: "sample-waveform-phase-line is-attack", x1: startX, y1: verticalPadding, x2: attackEndX, y2: height - verticalPadding, children: /* @__PURE__ */ jsx6("title", { children: "Attack phase" }) }) : null,
            safeRelease > 0 ? /* @__PURE__ */ jsx6("line", { className: "sample-waveform-phase-line is-release", x1: endX, y1: verticalPadding, x2: releaseEndX, y2: height - verticalPadding, children: /* @__PURE__ */ jsx6("title", { children: "Release phase" }) }) : null
          ] }),
          /* @__PURE__ */ jsx6(
            "rect",
            {
              className: "sample-waveform-boundary-hit-target is-start",
              x: startX - 8,
              y: verticalPadding,
              width: 16,
              height: height - verticalPadding * 2,
              "aria-label": "Drag sample start",
              onPointerDown: (event) => handleBoundaryPointerDown(event, "start")
            }
          ),
          /* @__PURE__ */ jsx6(
            "rect",
            {
              className: "sample-waveform-boundary-hit-target is-end",
              x: endX - 8,
              y: verticalPadding,
              width: 16,
              height: height - verticalPadding * 2,
              "aria-label": "Drag sample end",
              onPointerDown: (event) => handleBoundaryPointerDown(event, "end")
            }
          )
        ]
      }
    )
  ] });
}
var MAX_SAMPLE_VIDEO_CACHED_FRAMES = 24;
var SAMPLE_VIDEO_CACHE_WIDTH = 720;
function SampleVideoPreview({ sampleUrl, startPosition, playbackPosition }) {
  const videoRef = useRef6(null);
  const preloaderRef = useRef6(null);
  const cachedFrameRef = useRef6(null);
  const frameCacheRef = useRef6(/* @__PURE__ */ new Map());
  const displayPosition = clamp(playbackPosition ?? startPosition, 0, 1);
  const targetPositionRef = useRef6(displayPosition);
  const preloadPositionRef = useRef6(clamp(startPosition, 0, 1));
  targetPositionRef.current = displayPosition;
  preloadPositionRef.current = clamp(startPosition, 0, 1);
  function seekToPosition(video, position) {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const targetTime = clamp(position, 0, 1) * video.duration;
    if (Math.abs(video.currentTime - targetTime) > 1 / 240) video.currentTime = targetTime;
  }
  function showCachedFrame(position) {
    const frame = frameCacheRef.current.get(sampleVideoFrameCacheKey(position));
    const output = cachedFrameRef.current;
    if (!frame || !output) return false;
    output.width = frame.width;
    output.height = frame.height;
    output.getContext("2d")?.drawImage(frame, 0, 0);
    output.classList.add("is-visible");
    return true;
  }
  function hideCachedFrameIfCurrent(video) {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const targetTime = targetPositionRef.current * video.duration;
    if (Math.abs(video.currentTime - targetTime) <= 1 / 60) {
      cachedFrameRef.current?.classList.remove("is-visible");
    }
  }
  function cachePreloadedFrame(video) {
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    const targetPosition = preloadPositionRef.current;
    const targetTime = targetPosition * video.duration;
    if (Math.abs(video.currentTime - targetTime) > 1 / 60) return;
    const scale = Math.min(1, SAMPLE_VIDEO_CACHE_WIDTH / video.videoWidth);
    const frame = document.createElement("canvas");
    frame.width = Math.max(1, Math.round(video.videoWidth * scale));
    frame.height = Math.max(1, Math.round(video.videoHeight * scale));
    frame.getContext("2d")?.drawImage(video, 0, 0, frame.width, frame.height);
    const cache = frameCacheRef.current;
    const key = sampleVideoFrameCacheKey(targetPosition);
    cache.delete(key);
    cache.set(key, frame);
    while (cache.size > MAX_SAMPLE_VIDEO_CACHED_FRAMES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === void 0) break;
      cache.delete(oldestKey);
    }
    if (Math.abs(targetPositionRef.current - targetPosition) <= 1 / 1e4) showCachedFrame(targetPosition);
  }
  useEffect5(() => {
    const video = videoRef.current;
    if (!showCachedFrame(displayPosition)) cachedFrameRef.current?.classList.remove("is-visible");
    if (video) seekToPosition(video, displayPosition);
  }, [displayPosition, sampleUrl]);
  useEffect5(() => {
    const preloader = preloaderRef.current;
    if (preloader) seekToPosition(preloader, preloadPositionRef.current);
  }, [startPosition, sampleUrl]);
  useEffect5(() => {
    frameCacheRef.current.clear();
    cachedFrameRef.current?.classList.remove("is-visible");
  }, [sampleUrl]);
  return /* @__PURE__ */ jsxs5("div", { className: "sample-video-preview-frame", children: [
    /* @__PURE__ */ jsx6(
      "video",
      {
        ref: videoRef,
        className: "sample-video-preview",
        src: sampleUrl,
        "aria-label": "Sample video preview",
        muted: true,
        playsInline: true,
        preload: "auto",
        disablePictureInPicture: true,
        onLoadedMetadata: (event) => seekToPosition(event.currentTarget, targetPositionRef.current),
        onSeeked: (event) => hideCachedFrameIfCurrent(event.currentTarget)
      }
    ),
    /* @__PURE__ */ jsx6("canvas", { ref: cachedFrameRef, className: "sample-video-cached-frame", "aria-hidden": "true" }),
    /* @__PURE__ */ jsx6(
      "video",
      {
        ref: preloaderRef,
        className: "sample-video-preloader",
        src: sampleUrl,
        muted: true,
        playsInline: true,
        preload: "auto",
        disablePictureInPicture: true,
        "aria-hidden": "true",
        onLoadedMetadata: (event) => seekToPosition(event.currentTarget, preloadPositionRef.current),
        onLoadedData: (event) => cachePreloadedFrame(event.currentTarget),
        onSeeked: (event) => cachePreloadedFrame(event.currentTarget)
      }
    )
  ] });
}
function sampleVideoFrameCacheKey(position) {
  return clamp(position, 0, 1).toFixed(5);
}
function isVideoSampleUrl(url) {
  try {
    return new URL(url, window.location.href).pathname.toLowerCase().endsWith(".mp4");
  } catch {
    return /\.mp4(?:$|[?#])/i.test(url);
  }
}
function sampleWaveformPath(bins, startX, endX, height, verticalPadding) {
  if (bins.length === 0) return "";
  const innerHeight = height - verticalPadding * 2;
  return bins.map((bin, index) => {
    const x = startX + index / Math.max(1, bins.length - 1) * (endX - startX);
    const top = verticalPadding + (1 - (clamp(bin.max, -1, 1) + 1) / 2) * innerHeight;
    const bottom = verticalPadding + (1 - (clamp(bin.min, -1, 1) + 1) / 2) * innerHeight;
    return `M${roundPathNumber(x)} ${roundPathNumber(top)} V${roundPathNumber(bottom)}`;
  }).join(" ");
}
function waveformBinsForDetail(bins, detail) {
  const count = Math.max(1, Math.min(bins.length, Math.round(detail)));
  if (count >= bins.length) return bins;
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * bins.length / count);
    const end = Math.max(start + 1, Math.floor((index + 1) * bins.length / count));
    let min = 0;
    let max = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      const source = bins[sourceIndex];
      min = Math.min(min, source.min);
      max = Math.max(max, source.max);
    }
    return { min, max };
  });
}
function normalizeUnitInterval(value) {
  return (value % 1 + 1) % 1;
}
function isEditableElement(element) {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}
function centeredCoordinateToUnit(value) {
  if (!Number.isFinite(value)) return 0.5;
  return (Math.max(-1, Math.min(1, value)) + 1) * 0.5;
}
var METER_RECENT_MAX_HOLD_MS = 800;
function useRecentMaxLevel(level, enabled) {
  const latestLevelRef = useRef6(level);
  const timeoutRef = useRef6(null);
  const [recentMaxLevel, setRecentMaxLevel] = useState6(level);
  useEffect5(() => {
    latestLevelRef.current = level;
  }, [level]);
  useEffect5(() => {
    if (!enabled) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setRecentMaxLevel(level);
      return;
    }
    setRecentMaxLevel((currentMax) => {
      if (level >= currentMax) {
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        return level;
      }
      if (timeoutRef.current === null) {
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          setRecentMaxLevel(latestLevelRef.current);
        }, METER_RECENT_MAX_HOLD_MS);
      }
      return currentMax;
    });
  }, [enabled, level]);
  useEffect5(() => () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
  }, []);
  return recentMaxLevel;
}
function useRecentBipolarLevels(level, enabled) {
  const latestLevelRef = useRef6(level);
  const timeoutRef = useRef6(null);
  const [recentLevels, setRecentLevels] = useState6({ positive: 0, negative: 0 });
  useEffect5(() => {
    latestLevelRef.current = level;
  }, [level]);
  useEffect5(() => {
    if (!enabled) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setRecentLevels({ positive: 0, negative: 0 });
      return;
    }
    setRecentLevels((current) => {
      const next = {
        positive: Math.max(current.positive, level, 0),
        negative: Math.max(current.negative, -level, 0)
      };
      if (next.positive !== current.positive || next.negative !== current.negative) {
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        return next;
      }
      if (timeoutRef.current === null) {
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          const latest = latestLevelRef.current;
          setRecentLevels({ positive: Math.max(0, latest), negative: Math.max(0, -latest) });
        }, METER_RECENT_MAX_HOLD_MS);
      }
      return current;
    });
  }, [enabled, level]);
  useEffect5(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
  }, []);
  return recentLevels;
}
function AudioOutputMeterRow({ label, level }) {
  const normalized = Math.max(0, Math.min(1, level));
  const recentMax = useRecentMaxLevel(normalized, true);
  return /* @__PURE__ */ jsxs5("div", { className: "audio-out-node-meter-row", "aria-hidden": "true", children: [
    /* @__PURE__ */ jsx6("span", { className: "audio-out-node-meter-label", children: label }),
    /* @__PURE__ */ jsxs5("span", { className: "audio-out-node-meter-track", children: [
      /* @__PURE__ */ jsx6("span", { className: "audio-out-node-meter-fill", style: { width: `${normalized * 100}%` } }),
      /* @__PURE__ */ jsx6("span", { className: "audio-out-node-meter-peak", style: { left: `${recentMax * 100}%` } })
    ] })
  ] });
}
function AudioInputDisplay({ state, muted, onMutedChange, onDeviceChange, onRefresh }) {
  const status = state?.status ?? "inactive";
  const message = state?.message ?? "Start audio to request microphone access.";
  const devices = state?.devices ?? [];
  const selectedDeviceId = state?.selectedDeviceId ?? "";
  const canSelectDevice = state?.canSelectDevice ?? false;
  const unavailable = status === "unsupported" || status === "denied" || status === "error";
  return /* @__PURE__ */ jsxs5("div", { className: "audio-input-node-panel nodrag nopan", children: [
    /* @__PURE__ */ jsxs5("div", { className: "audio-input-node-status-row", children: [
      /* @__PURE__ */ jsx6(
        "span",
        {
          className: [
            "audio-input-node-status-dot",
            `audio-input-node-status-dot-${status}`
          ].join(" "),
          "aria-hidden": "true"
        }
      ),
      /* @__PURE__ */ jsx6("span", { className: "audio-input-node-status-text", title: message, children: audioInputStatusLabel(status) }),
      /* @__PURE__ */ jsx6(
        "button",
        {
          className: [
            "audio-input-node-mute-button",
            muted ? "audio-input-node-mute-button-active" : ""
          ].filter(Boolean).join(" "),
          type: "button",
          "aria-label": muted ? "Unmute audio input" : "Mute audio input",
          "aria-pressed": muted,
          title: muted ? "Unmute input" : "Mute input",
          onPointerDown: (event) => event.stopPropagation(),
          onDoubleClick: (event) => event.stopPropagation(),
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onMutedChange(!muted);
          },
          children: muted ? "muted" : "live"
        }
      )
    ] }),
    /* @__PURE__ */ jsx6("div", { className: [
      "audio-input-node-message",
      unavailable ? "audio-input-node-message-warning" : ""
    ].filter(Boolean).join(" "), children: message }),
    canSelectDevice ? /* @__PURE__ */ jsxs5("div", { className: "audio-input-node-device-row", children: [
      /* @__PURE__ */ jsxs5(
        "select",
        {
          className: "audio-input-node-device-select",
          "aria-label": "Audio input device",
          value: selectedDeviceId,
          disabled: devices.length === 0,
          onChange: (event) => {
            onDeviceChange(event.currentTarget.value);
            event.currentTarget.blur();
          },
          onPointerDown: (event) => event.stopPropagation(),
          onClick: (event) => event.stopPropagation(),
          onDoubleClick: (event) => event.stopPropagation(),
          children: [
            /* @__PURE__ */ jsx6("option", { value: "", children: "Default input" }),
            devices.map((device) => /* @__PURE__ */ jsx6("option", { value: device.deviceId, children: device.label }, device.deviceId || device.label))
          ]
        }
      ),
      /* @__PURE__ */ jsx6(
        "button",
        {
          className: "audio-input-node-refresh-button",
          type: "button",
          "aria-label": "Refresh audio input devices",
          title: "Refresh devices",
          onPointerDown: (event) => event.stopPropagation(),
          onDoubleClick: (event) => event.stopPropagation(),
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onRefresh();
          },
          children: "refresh"
        }
      )
    ] }) : null
  ] });
}
function audioInputStatusLabel(status) {
  switch (status) {
    case "connected":
      return "connected";
    case "requesting":
      return "requesting";
    case "needs-permission":
      return "permission";
    case "denied":
      return "denied";
    case "unsupported":
      return "unavailable";
    case "error":
      return "check input";
    case "inactive":
    default:
      return "idle";
  }
}
var SLIDER_WHEEL_SPEED = 0.5;
function sliderPrecisionDivisor(event) {
  if (event.metaKey || event.ctrlKey) return 5;
  if (event.shiftKey && event.altKey) return 3;
  return 1;
}
function SliderDisplay({ value, displayValue, direction, onChange }) {
  const dragRef = useRef6(null);
  const normalized = clamp(displayValue ?? value, 0, 1);
  const wheelValueRef = useRef6(normalized);
  const lastWheelTimeRef = useRef6(-Infinity);
  const wheelTargetRef = useModifiedWheel((event, target) => {
    if (event.timeStamp - lastWheelTimeRef.current > 160) {
      wheelValueRef.current = normalized;
    }
    lastWheelTimeRef.current = event.timeStamp;
    const travel = direction === "vertical" ? target.clientHeight : target.clientWidth;
    const precisionDivisor = sliderPrecisionDivisor(event);
    const wheelDelta = wheelAxisDeltaPixels(event, direction);
    if (wheelDelta === 0) return;
    const nextValue = clamp(
      wheelValueRef.current + wheelDelta * (direction === "vertical" ? 1 : -1) * SLIDER_WHEEL_SPEED / Math.max(1, travel) / precisionDivisor,
      0,
      1
    );
    wheelValueRef.current = nextValue;
    onChange(nextValue);
  });
  const fillStyle = direction === "vertical" ? { height: `${normalized * 100}%` } : { width: `${normalized * 100}%` };
  function pointerValue(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return direction === "vertical" ? 1 - (event.clientY - bounds.top) / Math.max(1, bounds.height) : (event.clientX - bounds.left) / Math.max(1, bounds.width);
  }
  function updateFromPointer(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const cursorValue = pointerValue(event);
    const precisionDivisor = sliderPrecisionDivisor(event);
    if (precisionDivisor !== drag.precisionDivisor) {
      drag.lastPointerValue = cursorValue;
      drag.cursorBias = drag.value - cursorValue;
      drag.precisionDivisor = precisionDivisor;
      return;
    }
    const nextValue = precisionDivisor > 1 ? drag.value + (cursorValue - drag.lastPointerValue) / precisionDivisor : cursorValue + drag.cursorBias;
    drag.lastPointerValue = cursorValue;
    drag.value = clamp(nextValue, 0, 1);
    onChange(drag.value);
  }
  return /* @__PURE__ */ jsxs5(
    "div",
    {
      className: [
        "audio-node-slider-display nodrag nopan",
        direction === "vertical" ? "audio-node-slider-display-vertical" : "audio-node-slider-display-horizontal"
      ].join(" "),
      onClick: (event) => event.stopPropagation(),
      children: [
        /* @__PURE__ */ jsx6("span", { className: "audio-node-slider-fill", style: fillStyle, "aria-hidden": "true" }),
        /* @__PURE__ */ jsx6(
          "input",
          {
            ref: wheelTargetRef,
            "aria-label": "Slider value",
            type: "range",
            tabIndex: -1,
            min: 0,
            max: 1,
            step: 1e-3,
            value: normalized,
            onChange: (event) => {
              if (dragRef.current) return;
              onChange(Number(event.currentTarget.value));
              event.currentTarget.blur();
            },
            onFocus: (event) => event.currentTarget.blur(),
            onPointerDown: (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!event.isPrimary || event.button !== 0) return;
              const cursorValue = pointerValue(event);
              const precisionDivisor = sliderPrecisionDivisor(event);
              const initialValue = precisionDivisor > 1 ? normalized : clamp(cursorValue, 0, 1);
              dragRef.current = {
                pointerId: event.pointerId,
                lastPointerValue: cursorValue,
                value: initialValue,
                cursorBias: initialValue - cursorValue,
                precisionDivisor
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              if (precisionDivisor === 1) onChange(initialValue);
            },
            onPointerMove: (event) => {
              if (dragRef.current?.pointerId !== event.pointerId) return;
              event.preventDefault();
              event.stopPropagation();
              updateFromPointer(event);
            },
            onPointerUp: (event) => {
              event.stopPropagation();
              if (dragRef.current?.pointerId === event.pointerId) {
                dragRef.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }
              event.currentTarget.blur();
            },
            onPointerCancel: (event) => {
              event.stopPropagation();
              if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
              event.currentTarget.blur();
            },
            onLostPointerCapture: (event) => {
              if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
            },
            onClick: (event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
            },
            onDoubleClick: (event) => event.stopPropagation()
          }
        )
      ]
    }
  );
}
function JoystickDisplay({ x, y, elasticity, onChange }) {
  const dragPointerRef = useRef6(null);
  const returnFrameRef = useRef6(null);
  const returnTimeRef = useRef6(0);
  const elasticityRef = useRef6(elasticity);
  const normalizedX = clamp(x, 0, 1);
  const normalizedY = clamp(y, 0, 1);
  const positionRef = useRef6({ x: normalizedX, y: normalizedY });
  elasticityRef.current = elasticity;
  if (dragPointerRef.current === null && returnFrameRef.current === null) {
    positionRef.current = { x: normalizedX, y: normalizedY };
  }
  useEffect5(() => () => {
    if (returnFrameRef.current !== null) {
      window.cancelAnimationFrame(returnFrameRef.current);
    }
  }, []);
  function stopReturn() {
    if (returnFrameRef.current !== null) {
      window.cancelAnimationFrame(returnFrameRef.current);
      returnFrameRef.current = null;
    }
  }
  function startReturn() {
    stopReturn();
    if (!(elasticityRef.current > 0)) return;
    returnTimeRef.current = performance.now();
    function stepReturn(timestamp) {
      if (dragPointerRef.current !== null || !(elasticityRef.current > 0)) {
        returnFrameRef.current = null;
        return;
      }
      const elapsedSeconds = Math.min(0.05, Math.max(0, (timestamp - returnTimeRef.current) / 1e3));
      returnTimeRef.current = timestamp;
      const current = positionRef.current;
      const deltaX = 0.5 - current.x;
      const deltaY = 0.5 - current.y;
      const distance = Math.hypot(deltaX, deltaY);
      const travel = elasticityRef.current * elapsedSeconds;
      if (distance <= Math.max(1e-4, travel)) {
        positionRef.current = { x: 0.5, y: 0.5 };
        returnFrameRef.current = null;
        onChange(0.5, 0.5);
        return;
      }
      const scale = travel / distance;
      const next = {
        x: current.x + deltaX * scale,
        y: current.y + deltaY * scale
      };
      positionRef.current = next;
      onChange(next.x, next.y);
      returnFrameRef.current = window.requestAnimationFrame(stepReturn);
    }
    returnFrameRef.current = window.requestAnimationFrame(stepReturn);
  }
  function updateFromPointer(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextX = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    const nextY = 1 - (event.clientY - bounds.top) / Math.max(1, bounds.height);
    const next = { x: clamp(nextX, 0, 1), y: clamp(nextY, 0, 1) };
    positionRef.current = next;
    onChange(next.x, next.y);
  }
  return /* @__PURE__ */ jsx6(
    "div",
    {
      className: "audio-node-joystick-display nodrag nopan",
      role: "group",
      "aria-label": "Joystick",
      "aria-valuetext": `X ${normalizedX.toFixed(3)}, Y ${normalizedY.toFixed(3)}`,
      onPointerDown: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!event.isPrimary || event.button !== 0) return;
        stopReturn();
        dragPointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      },
      onPointerMove: (event) => {
        if (dragPointerRef.current !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        updateFromPointer(event);
      },
      onPointerUp: (event) => {
        event.stopPropagation();
        if (dragPointerRef.current === event.pointerId) {
          dragPointerRef.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          startReturn();
        }
      },
      onPointerCancel: (event) => {
        event.stopPropagation();
        if (dragPointerRef.current === event.pointerId) {
          dragPointerRef.current = null;
          startReturn();
        }
      },
      onLostPointerCapture: (event) => {
        if (dragPointerRef.current === event.pointerId) {
          dragPointerRef.current = null;
          startReturn();
        }
      },
      onClick: (event) => event.stopPropagation(),
      onDoubleClick: (event) => event.stopPropagation(),
      children: /* @__PURE__ */ jsx6(
        "span",
        {
          className: "audio-node-joystick-handle",
          style: {
            left: `calc(${normalizedX} * (100% - var(--joystick-handle-size)))`,
            top: `calc(${1 - normalizedY} * (100% - var(--joystick-handle-size)))`
          },
          "aria-hidden": "true"
        }
      )
    }
  );
}
var BUTTON_CLICK_FLASH_MS = 120;
function ButtonDisplay({ mode, pressed, onPressedChange, onClickPulse }) {
  const [pointerActive, setPointerActive] = useState6(false);
  const [clickFlashActive, setClickFlashActive] = useState6(false);
  const clickFlashTimeoutRef = useRef6(null);
  const previousPressedRef = useRef6(false);
  const isPressed = pressed >= 0.5;
  const isLit = mode === "trigger" ? clickFlashActive : mode === "temporary" ? pointerActive || isPressed : isPressed;
  function flashClick() {
    if (clickFlashTimeoutRef.current !== null) {
      window.clearTimeout(clickFlashTimeoutRef.current);
    }
    setClickFlashActive(true);
    clickFlashTimeoutRef.current = window.setTimeout(() => {
      clickFlashTimeoutRef.current = null;
      setClickFlashActive(false);
    }, BUTTON_CLICK_FLASH_MS);
  }
  useEffect5(() => {
    if (mode === "trigger" && isPressed && !previousPressedRef.current) {
      flashClick();
    }
    previousPressedRef.current = isPressed;
  }, [isPressed, mode]);
  useEffect5(() => () => {
    if (clickFlashTimeoutRef.current !== null) {
      window.clearTimeout(clickFlashTimeoutRef.current);
    }
  }, []);
  function releaseTemporary() {
    setPointerActive(false);
    if (mode === "temporary") {
      onPressedChange(0);
    }
  }
  return /* @__PURE__ */ jsx6(
    "button",
    {
      className: [
        "audio-node-button-display nodrag nopan",
        isLit ? "audio-node-button-display-active" : ""
      ].filter(Boolean).join(" "),
      type: "button",
      "aria-label": "Button value",
      "aria-pressed": isLit,
      onPointerDown: (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (mode === "temporary") {
          setPointerActive(true);
          onPressedChange(1);
        } else if (mode === "trigger") {
          flashClick();
          onClickPulse();
        }
      },
      onPointerUp: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        releaseTemporary();
      },
      onPointerCancel: (event) => {
        event.stopPropagation();
        releaseTemporary();
      },
      onLostPointerCapture: releaseTemporary,
      onClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (mode === "toggle") {
          onPressedChange(isPressed ? 0 : 1);
        }
      },
      onDoubleClick: (event) => event.stopPropagation()
    }
  );
}
function KeysDisplay({ size, startNote, mode, activeNote, onNoteChange }) {
  const dragRef = useRef6(null);
  const holdMode = Math.round(mode) === 1;
  const firstNote = clamp(Math.round(startNote), 0, 127);
  const noteCount = clamp(Math.round(size), 1, 128 - firstNote);
  const notes = Array.from({ length: noteCount }, (_, index) => firstNote + index);
  const layouts = pianoKeyLayouts(notes);
  function press(event, note) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { pointerId: event.pointerId, note };
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextNote = holdMode && activeNote === note ? null : note;
    onNoteChange(nextNote);
  }
  function move(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-midi-note]");
    const note = Number(target?.dataset.midiNote);
    if (!Number.isInteger(note) || note === drag.note) return;
    drag.note = note;
    onNoteChange(note);
  }
  function release(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    if (!holdMode) {
      onNoteChange(null);
    }
  }
  return /* @__PURE__ */ jsx6("div", { className: "keys-node-keyboard nodrag nopan", "aria-label": `Piano keys ${firstNote} to ${firstNote + noteCount - 1}`, children: layouts.map(({ note, black, left, width }) => /* @__PURE__ */ jsx6(
    "button",
    {
      className: [
        "keys-node-key nodrag nopan",
        black ? "keys-node-key-black" : "keys-node-key-white",
        activeNote === note ? "keys-node-key-active" : ""
      ].filter(Boolean).join(" "),
      type: "button",
      "aria-label": `MIDI note ${note}`,
      "aria-pressed": activeNote === note,
      "data-midi-note": note,
      style: { left: `${left}%`, width: `${width}%` },
      onPointerDown: (event) => press(event, note),
      onPointerMove: move,
      onPointerUp: release,
      onPointerCancel: release,
      onLostPointerCapture: (event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
          dragRef.current = null;
          if (!holdMode) {
            onNoteChange(null);
          }
        }
      },
      onClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
      },
      onDoubleClick: (event) => event.stopPropagation()
    },
    note
  )) });
}
function pianoKeyLayouts(notes) {
  const raw = notes.map((note) => {
    const pitchClass = note % 12;
    const black = [1, 3, 6, 8, 10].includes(pitchClass);
    const octave = Math.floor(note / 12);
    const whiteInOctave = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][pitchClass];
    const whitePosition = octave * 7 + whiteInOctave;
    return {
      note,
      black,
      left: black ? whitePosition + 0.68 : whitePosition,
      width: black ? 0.64 : 1
    };
  });
  const min = Math.min(...raw.map((key) => key.left));
  const max = Math.max(...raw.map((key) => key.left + key.width));
  const span = Math.max(1e-3, max - min);
  return raw.map((key) => ({
    ...key,
    left: (key.left - min) / span * 100,
    width: key.width / span * 100
  }));
}
function midiNoteToFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}
function sequencerRowLabelColumnWidth(labels) {
  const longestLabel = Math.max(3, ...labels?.map((label) => label.length) ?? [0]);
  return 20 + longestLabel * 8;
}
function RollGrid({ params, steps, beatLength, stepLength, rows, currentStep, onParamsChange }) {
  const storageRow = (displayRow) => rows.length - displayRow - 1;
  return /* @__PURE__ */ jsx6(
    PatternGrid,
    {
      ariaLabel: "Piano roll",
      className: "roll-node-panel pattern-grid-roll",
      rows: rows.length,
      steps,
      beatLength,
      currentStep,
      defaultGateLength: stepLength,
      rowLabel: (displayRow) => midiNoteLabel(rows[storageRow(displayRow)].note),
      gatesForRow: (displayRow) => rollGatesForRow(params, rows[storageRow(displayRow)].index, steps),
      onCreateGate: (displayRow, start, end) => {
        const row = rows[storageRow(displayRow)].index;
        const gates = rollGatesForRow(params, row, steps);
        const slot = Array.from({ length: steps }, (_, index) => index).find((index) => !gates.some((gate) => gate.slot === index));
        if (slot === void 0) return;
        const values = {
          [rollGateParamName(row, slot, "active")]: 1,
          [rollGateParamName(row, slot, "start")]: start,
          [rollGateParamName(row, slot, "end")]: end,
          [rollGateVelocityParamName(row, slot)]: 1,
          [rollCellParamName(row, slot)]: 0
        };
        onParamsChange(values);
      },
      onUpdateGate: (displayRow, slot, update) => {
        const row = rows[storageRow(displayRow)].index;
        const values = {};
        if (update.start !== void 0) values[rollGateParamName(row, slot, "start")] = update.start;
        if (update.end !== void 0) values[rollGateParamName(row, slot, "end")] = update.end;
        if (update.velocity !== void 0) values[rollGateVelocityParamName(row, slot)] = update.velocity;
        onParamsChange(values);
      },
      onDeleteGate: (displayRow, slot) => onParamsChange({ [rollGateParamName(rows[storageRow(displayRow)].index, slot, "active")]: 0 })
    }
  );
}
function PatternGrid({
  ariaLabel,
  className,
  rows,
  steps,
  beatLength,
  currentStep,
  rowLabel,
  renderRowLabel,
  labelPosition = "left",
  onRowRef,
  gatesForRow,
  mode = "gate",
  defaultGateLength = 1,
  allowMove = true,
  allowResize = true,
  allowVelocity = true,
  onCreateGate,
  onCreateGates,
  onUpdateGate,
  onDeleteGate
}) {
  const activeStep = Number.isFinite(currentStep) ? Math.floor(currentStep ?? -1) : -1;
  const dragRef = useRef6(null);
  const createRef = useRef6(null);
  const [createPreview, setCreatePreview] = useState6(null);
  const positionInRow = (event) => {
    const bounds = event.currentTarget.closest(".pattern-grid-cells")?.getBoundingClientRect();
    if (!bounds) return 0;
    return Math.max(0, Math.min(steps, (event.clientX - bounds.left) / Math.max(1, bounds.width) * steps));
  };
  const beginCreate = (event, row, step) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const existing = gatesForRow(row);
    if (existing.some((gate) => step >= gate.start && step < gate.end)) return;
    const nextStart = mode === "gate" ? existing.filter((gate) => gate.start > step).reduce((boundary, gate) => Math.min(boundary, gate.start), steps) : steps;
    const end = mode === "trigger" ? Math.min(steps, step + 1) : Math.min(nextStart, step + defaultGateLength);
    if (end - step < 0.05) return;
    createRef.current = {
      pointerId: event.pointerId,
      row,
      anchorX: event.clientX,
      start: step,
      end,
      lastStep: step,
      positions: /* @__PURE__ */ new Set([step]),
      moved: false
    };
    setCreatePreview({ row, gates: [{ start: step, end }] });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveCreate = (event) => {
    const create = createRef.current;
    if (!create || create.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - create.anchorX) >= 3) create.moved = true;
    if (mode === "trigger") {
      const nextStep = Math.max(0, Math.min(steps - 1, Math.floor(positionInRow(event))));
      const direction = nextStep >= create.lastStep ? 1 : -1;
      for (let step = create.lastStep; step !== nextStep + direction; step += direction) create.positions.add(step);
      create.lastStep = nextStep;
      const occupied = gatesForRow(create.row);
      const gates = [...create.positions].filter((step) => !occupied.some((gate) => Math.abs(gate.start - step) < 1e-6)).sort((left, right) => left - right).map((step) => ({ start: step, end: Math.min(steps, step + 1) }));
      setCreatePreview({ row: create.row, gates });
      return;
    }
    if (!create.moved) return;
    const nextStart = gatesForRow(create.row).filter((gate) => gate.start > create.start).reduce((boundary, gate) => Math.min(boundary, gate.start), steps);
    create.end = Math.max(create.start + 0.05, Math.min(nextStart, positionInRow(event)));
    setCreatePreview({ row: create.row, gates: [{ start: create.start, end: create.end }] });
  };
  const finishCreate = (pointerId) => {
    const create = createRef.current;
    if (!create || create.pointerId !== pointerId) return;
    const occupied = gatesForRow(create.row);
    const gates = mode === "trigger" ? [...create.positions].filter((step) => !occupied.some((gate) => Math.abs(gate.start - step) < 1e-6)).sort((left, right) => left - right).map((step) => ({ start: step, end: Math.min(steps, step + 1) })) : [{ start: create.start, end: create.end }];
    if (onCreateGates) onCreateGates(create.row, gates);
    else for (const gate of gates) onCreateGate(create.row, gate.start, gate.end);
    createRef.current = null;
    setCreatePreview(null);
  };
  const beginDrag = (event, row, gate, action) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { pointerId: event.pointerId, row, gate, x: event.clientX, y: event.clientY, action, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.closest(".pattern-grid-cells")?.getBoundingClientRect();
    const delta = (event.clientX - drag.x) / Math.max(1, bounds?.width ?? steps * 26) * steps;
    const velocityDelta = (event.clientY - drag.y) / Math.max(1, bounds?.height ?? 26);
    drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 3;
    if (!drag.moved) return;
    if (drag.action === "velocity") return onUpdateGate(drag.row, drag.gate.slot, { velocity: Math.max(SEQUENCER_MIN_VELOCITY, Math.min(1, drag.gate.velocity - velocityDelta)) });
    const length = drag.gate.end - drag.gate.start;
    if (mode === "trigger") {
      const start = Math.max(0, Math.min(steps - 1, drag.gate.start + delta));
      return onUpdateGate(drag.row, drag.gate.slot, { start, end: Math.min(steps, start + 1) });
    }
    const otherGates = gatesForRow(drag.row).filter((gate) => gate.slot !== drag.gate.slot);
    const previousEnd = otherGates.filter((gate) => gate.start < drag.gate.start).reduce((boundary, gate) => Math.max(boundary, gate.end), 0);
    const nextStart = otherGates.filter((gate) => gate.start >= drag.gate.end).reduce((boundary, gate) => Math.min(boundary, gate.start), steps);
    if (drag.action === "move") {
      const start = Math.max(previousEnd, Math.min(nextStart - length, drag.gate.start + delta));
      return onUpdateGate(drag.row, drag.gate.slot, { start, end: start + length });
    }
    if (drag.action === "left") return onUpdateGate(drag.row, drag.gate.slot, { start: Math.max(previousEnd, Math.min(drag.gate.end - 0.05, drag.gate.start + delta)) });
    onUpdateGate(drag.row, drag.gate.slot, { end: Math.max(drag.gate.start + 0.05, Math.min(nextStart, drag.gate.end + delta)) });
  };
  const finishDrag = (pointerId) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    if (!drag.moved && drag.action === "move") onDeleteGate(drag.row, drag.gate.slot);
    dragRef.current = null;
  };
  const endDrag = (event) => finishDrag(event.pointerId);
  const cancelDrag = (pointerId) => {
    if (dragRef.current?.pointerId === pointerId) dragRef.current = null;
  };
  useEffect5(() => {
    const finishPointer = (event) => {
      finishCreate(event.pointerId);
      finishDrag(event.pointerId);
    };
    const cancelPointer = (event) => {
      if (createRef.current?.pointerId === event.pointerId) {
        createRef.current = null;
        setCreatePreview(null);
      }
      cancelDrag(event.pointerId);
    };
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", cancelPointer);
    return () => {
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", cancelPointer);
    };
  });
  return /* @__PURE__ */ jsx6("div", { className: `pattern-grid pattern-grid-label-${labelPosition} ${className} nodrag nopan`, style: { "--pattern-grid-steps": steps }, "aria-label": ariaLabel, children: Array.from({ length: rows }, (_, row) => /* @__PURE__ */ jsxs5("div", { className: "pattern-grid-row", ref: (element) => onRowRef?.(row, element), children: [
    labelPosition === "left" ? /* @__PURE__ */ jsx6("div", { className: "pattern-grid-label", children: renderRowLabel?.(row) ?? rowLabel(row) }) : null,
    /* @__PURE__ */ jsxs5("div", { className: "pattern-grid-cells", role: "row", children: [
      Array.from({ length: steps }, (_2, step) => /* @__PURE__ */ jsx6(
        "button",
        {
          className: ["pattern-grid-cell", Math.floor(step / beatLength) % 2 === 1 ? "pattern-grid-cell-beat-highlight" : "", activeStep === step ? "pattern-grid-cell-current" : ""].filter(Boolean).join(" "),
          type: "button",
          "aria-label": `${rowLabel(row)}, step ${step + 1}`,
          "data-pattern-grid-cell": "true",
          "data-row-index": row,
          "data-step-index": step,
          onPointerDown: (event) => beginCreate(event, row, step),
          onPointerMove: moveCreate,
          onPointerUp: (event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            finishCreate(event.pointerId);
          },
          onPointerCancel: (event) => {
            createRef.current = null;
            setCreatePreview(null);
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          },
          onLostPointerCapture: (event) => finishCreate(event.pointerId),
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
          }
        },
        step
      )),
      createPreview?.row === row ? createPreview.gates.map((gate, index) => /* @__PURE__ */ jsx6(
        "div",
        {
          className: "pattern-grid-gate pattern-grid-create-preview",
          style: { left: `${gate.start / steps * 100}%`, width: `${(gate.end - gate.start) / steps * 100}%` }
        },
        `${gate.start}:${index}`
      )) : null,
      gatesForRow(row).map((gate) => /* @__PURE__ */ jsxs5(
        "div",
        {
          className: "pattern-grid-gate",
          style: { top: `${(1 - gate.velocity) * 100}%`, left: `${gate.start / steps * 100}%`, width: `${(gate.end - gate.start) / steps * 100}%` },
          role: "button",
          tabIndex: 0,
          "aria-label": `${rowLabel(row)} ${mode} from ${gate.start.toFixed(2)} to ${gate.end.toFixed(2)}, velocity ${gate.velocity.toFixed(2)}`,
          onPointerDown: (event) => {
            if (allowMove && event.target === event.currentTarget) beginDrag(event, row, gate, "move");
          },
          onPointerMove: moveDrag,
          onPointerUp: endDrag,
          onPointerCancel: (event) => cancelDrag(event.pointerId),
          onLostPointerCapture: (event) => cancelDrag(event.pointerId),
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
          },
          children: [
            allowVelocity ? /* @__PURE__ */ jsx6("span", { className: "pattern-grid-velocity-handle", onPointerDown: (event) => beginDrag(event, row, gate, "velocity"), onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: (event) => cancelDrag(event.pointerId) }) : null,
            allowResize ? /* @__PURE__ */ jsxs5(Fragment2, { children: [
              /* @__PURE__ */ jsx6("span", { className: "pattern-grid-gate-handle pattern-grid-gate-handle-left", onPointerDown: (event) => beginDrag(event, row, gate, "left"), onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: (event) => cancelDrag(event.pointerId) }),
              /* @__PURE__ */ jsx6("span", { className: "pattern-grid-gate-handle pattern-grid-gate-handle-right", onPointerDown: (event) => beginDrag(event, row, gate, "right"), onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: (event) => cancelDrag(event.pointerId) })
            ] }) : null
          ]
        },
        gate.slot
      ))
    ] }),
    labelPosition === "right" ? /* @__PURE__ */ jsx6("div", { className: "pattern-grid-label", children: renderRowLabel?.(row) ?? rowLabel(row) }) : null
  ] }, row)) });
}
var SEQUENCER_TRIGGER_GRAB_FRACTION = 0.35;
function SequencerGrid({
  params,
  rows,
  rowLabels,
  hasSavedLabelColumnWidth,
  steps,
  beatLength,
  currentStep,
  selectedLinkOutputs,
  setOutputRowRef,
  onParamsChange,
  onRowLabelsChange
}) {
  const gateMode = sequencerUsesGateMode(params);
  const [draftRowLabels, setDraftRowLabels] = useState6([]);
  useEffect5(() => {
    setDraftRowLabels(Array.from({ length: rows }, (_, rowIndex) => rowLabels?.[rowIndex] ?? String(rowIndex + 1)));
  }, [rowLabels, rows]);
  useEffect5(() => {
    if (hasSavedLabelColumnWidth) return;
    onRowLabelsChange(Array.from({ length: rows }, (_, rowIndex) => rowLabels?.[rowIndex] ?? String(rowIndex + 1)));
  }, [hasSavedLabelColumnWidth, onRowLabelsChange, rowLabels, rows]);
  const updateRowLabel = (rowIndex, value) => {
    const labels = [...draftRowLabels];
    labels[rowIndex] = value;
    setDraftRowLabels(labels);
    onRowLabelsChange(labels);
  };
  const commitRowLabel = (rowIndex) => {
    const label = draftRowLabels[rowIndex]?.trim() || String(rowIndex + 1);
    onRowLabelsChange(Array.from({ length: rows }, (_, index) => index === rowIndex ? label : draftRowLabels[index]?.trim() || rowLabels?.[index] || String(index + 1)));
  };
  const patternGatesForRow = (rowIndex) => gateMode ? sequencerGatesForRow(params, rowIndex, steps) : sequencerTriggersForRow(params, rowIndex, steps).map((trigger) => ({
    slot: trigger.slot,
    start: trigger.position,
    end: Math.min(steps, trigger.position + 1),
    velocity: trigger.velocity
  }));
  const createGates = (rowIndex, additions) => {
    const existing = patternGatesForRow(rowIndex);
    const usedSlots = new Set(existing.map((gate) => gate.slot));
    const existingStarts = new Set(existing.map((gate) => Math.round(gate.start * 1e6)));
    const values = gateMode ? { [SEQUENCER_GATE_INITIALIZED_PARAM]: 1 } : {};
    for (const addition of additions) {
      if (!gateMode && existingStarts.has(Math.round(addition.start * 1e6))) continue;
      const slot = Array.from({ length: steps }, (_, index) => index).find((index) => !usedSlots.has(index));
      if (slot === void 0) break;
      usedSlots.add(slot);
      if (gateMode) {
        values[sequencerGateParamName(rowIndex, slot, "active")] = 1;
        values[sequencerGateParamName(rowIndex, slot, "start")] = addition.start;
        values[sequencerGateParamName(rowIndex, slot, "end")] = addition.end;
        values[sequencerStepVelocityParamName(rowIndex, slot)] = 1;
      } else {
        values[sequencerCellParamName(rowIndex, slot)] = 1;
        values[sequencerTriggerPositionParamName(rowIndex, slot)] = addition.start;
        values[sequencerStepVelocityParamName(rowIndex, slot)] = 1;
      }
    }
    if (Object.keys(values).length > (gateMode ? 1 : 0)) onParamsChange(values);
  };
  return /* @__PURE__ */ jsx6(
    PatternGrid,
    {
      ariaLabel: "Sequencer pattern",
      className: "pattern-grid-sequencer",
      rows,
      steps,
      beatLength,
      currentStep,
      mode: gateMode ? "gate" : "trigger",
      labelPosition: "right",
      rowLabel: (rowIndex) => draftRowLabels[rowIndex] ?? rowLabels?.[rowIndex] ?? String(rowIndex + 1),
      renderRowLabel: (rowIndex) => {
        const outputName = sequencerOutputName(rowIndex);
        return /* @__PURE__ */ jsxs5("div", { className: "sequencer-output-port", children: [
          /* @__PURE__ */ jsx6(
            "input",
            {
              className: "sequencer-row-label",
              "aria-label": `Label for row ${rowIndex + 1}`,
              value: draftRowLabels[rowIndex] ?? String(rowIndex + 1),
              size: Math.max(3, (draftRowLabels[rowIndex] ?? String(rowIndex + 1)).length),
              onChange: (event) => updateRowLabel(rowIndex, event.target.value),
              onBlur: () => commitRowLabel(rowIndex),
              onPointerDown: (event) => event.stopPropagation(),
              onKeyDown: (event) => {
                event.stopPropagation();
                if (event.key === "Enter") event.currentTarget.blur();
              }
            }
          ),
          /* @__PURE__ */ jsx6(
            Handle,
            {
              id: `out:${outputName}`,
              type: "source",
              position: Position2.Right,
              className: [
                "shader-handle shader-handle-output shader-handle-output-sequencer",
                selectedLinkOutputs.includes(outputName) ? "shader-handle-selected-link" : ""
              ].filter(Boolean).join(" ")
            }
          )
        ] });
      },
      onRowRef: (rowIndex, element) => setOutputRowRef(sequencerOutputName(rowIndex), element),
      gatesForRow: patternGatesForRow,
      defaultGateLength: 1,
      allowMove: true,
      allowResize: gateMode,
      allowVelocity: true,
      onCreateGate: (rowIndex, start, end) => createGates(rowIndex, [{ start, end }]),
      onCreateGates: createGates,
      onUpdateGate: (rowIndex, slot, update) => {
        const values = {};
        if (update.velocity !== void 0) values[sequencerStepVelocityParamName(rowIndex, slot)] = update.velocity;
        if (gateMode) {
          if (update.start !== void 0) values[sequencerGateParamName(rowIndex, slot, "start")] = update.start;
          if (update.end !== void 0) values[sequencerGateParamName(rowIndex, slot, "end")] = update.end;
        } else if (update.start !== void 0) {
          values[sequencerTriggerPositionParamName(rowIndex, slot)] = update.start;
        }
        onParamsChange(values);
      },
      onDeleteGate: (rowIndex, slot) => onParamsChange(gateMode ? { [sequencerGateParamName(rowIndex, slot, "active")]: 0 } : { [sequencerCellParamName(rowIndex, slot)]: 0 })
    }
  );
}
function CustomWaveEditor({
  customWave,
  waves,
  selectedWaveIndex,
  onWaveSelect,
  subdivisions,
  subgroups,
  baseLevel,
  rangeMin,
  rangeMax,
  frequency,
  hasLivePlayheads,
  playheads,
  compact,
  displaySize,
  graphZoomScale,
  graphScreenEmphasis,
  activePointIndex,
  editorRef,
  onPointerDown,
  onDoubleClick,
  onSustainStartChange,
  onSustainEndChange
}) {
  const [hoveredPointIndex, setHoveredPointIndex] = useState6(null);
  const width = 300;
  const height = 128;
  const padding = 12;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const points = customWaveWithBaseLevel(customWave, baseLevel, rangeMin, rangeMax).points;
  const path = customWavePath(points, width, height, padding);
  const graphDetailSize = {
    width: displaySize.width * graphZoomScale,
    height: displaySize.height * graphZoomScale
  };
  const gridColumns = customWaveGridColumns(subdivisions);
  const subgroupBands = customWaveSubgroupBands(subdivisions, subgroups, width, padding);
  const gridRows = customWaveGridRows(rangeMin, rangeMax, graphDetailSize.height);
  const sustainStartX = padding + customWave.sustainStart * innerWidth;
  const sustainEndX = padding + customWave.sustainEnd * innerWidth;
  const showSustainStart = customWaveUsesSustainStart(customWave.mode);
  const showSustainEnd = customWaveUsesSustainEnd(customWave.mode);
  const showLowFrequencyScan = hasLivePlayheads && Number.isFinite(frequency) && Math.abs(frequency) < 20;
  const hitRadius = screenCircleRadius(15 * graphScreenEmphasis, width, height, graphDetailSize);
  const editPointScreenScale = customWaveEditPointScreenScale(graphZoomScale);
  const endpointRadius = screenCircleRadius(5 * graphScreenEmphasis * editPointScreenScale, width, height, graphDetailSize);
  const handleRadius = screenCircleRadius(6 * graphScreenEmphasis * editPointScreenScale, width, height, graphDetailSize);
  const valueLabelIndex = activePointIndex ?? hoveredPointIndex;
  const valueLabelPoint = valueLabelIndex === null ? null : points[valueLabelIndex] ?? null;
  const valueLabelScreen = valueLabelPoint ? customWavePointToScreen(valueLabelPoint, width, height, padding) : null;
  return /* @__PURE__ */ jsxs5("div", { className: "custom-wave-node-editor nodrag nopan", children: [
    /* @__PURE__ */ jsxs5("div", { className: "custom-wave-node-chart", children: [
      waves.length > 1 ? /* @__PURE__ */ jsx6("div", { className: "custom-wave-tabs", "aria-label": "Select wave", children: waves.map((_, index) => /* @__PURE__ */ jsx6("button", { type: "button", className: `custom-wave-tab wave-color-${index % 8} ${index === selectedWaveIndex ? "is-selected" : ""} nodrag nopan`, title: `Edit wave ${index + 1} (${index + 1})`, onPointerDown: (event) => event.stopPropagation(), onClick: (event) => {
        event.stopPropagation();
        onWaveSelect(index);
      }, children: index + 1 }, index)) }) : null,
      subgroupBands.length > 0 ? /* @__PURE__ */ jsx6("svg", { className: "custom-wave-subgroup-bands", viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", "aria-hidden": "true", children: subgroupBands.map((band) => /* @__PURE__ */ jsx6("rect", { x: band.x, y: padding, width: band.width, height: innerHeight }, band.x)) }) : null,
      /* @__PURE__ */ jsx6(
        ChartGrid,
        {
          width: innerWidth,
          height: innerHeight,
          columns: gridColumns,
          rows: gridRows,
          className: "custom-wave-node-grid",
          showRowLabels: true
        }
      ),
      /* @__PURE__ */ jsxs5(
        "svg",
        {
          ref: editorRef,
          className: "custom-wave-node-canvas",
          viewBox: `0 0 ${width} ${height}`,
          preserveAspectRatio: "none",
          "aria-label": "Custom wave editor",
          role: "img",
          onPointerDown,
          onDoubleClick,
          children: [
            /* @__PURE__ */ jsxs5("g", { className: "custom-wave-chart-chrome", children: [
              showSustainStart ? /* @__PURE__ */ jsx6("line", { className: "custom-wave-sustain-line", x1: sustainStartX, y1: padding, x2: sustainStartX, y2: height - padding }) : null,
              showSustainEnd ? /* @__PURE__ */ jsx6("line", { className: "custom-wave-sustain-line is-end", x1: sustainEndX, y1: padding, x2: sustainEndX, y2: height - padding }) : null,
              waves.map((wave, index) => index !== selectedWaveIndex ? /* @__PURE__ */ jsx6("path", { className: `custom-wave-path is-background wave-color-${index % 8}`, d: customWavePath(customWaveWithBaseLevel(wave, baseLevel, rangeMin, rangeMax).points, width, height, padding) }, index) : null),
              /* @__PURE__ */ jsx6("path", { className: `custom-wave-path wave-color-${selectedWaveIndex % 8}`, d: path }),
              showLowFrequencyScan ? playheads.map((playhead, index) => {
                const playheadX = padding + clamp(playhead, 0, 1) * innerWidth;
                return /* @__PURE__ */ jsx6("line", { className: `wave-playhead-line wave-playhead-${index % 4} is-low-frequency`, x1: playheadX, y1: padding, x2: playheadX, y2: height - padding, children: /* @__PURE__ */ jsxs5("title", { children: [
                  "Playback ",
                  index + 1
                ] }) }, `${index}:${playhead}`);
              }) : null
            ] }),
            points.map((point, index) => {
              const screen = customWavePointToScreen(point, width, height, padding);
              const locked = index === 0 || index === points.length - 1;
              return /* @__PURE__ */ jsxs5(
                "g",
                {
                  onPointerEnter: () => setHoveredPointIndex(index),
                  onPointerLeave: () => setHoveredPointIndex((current) => current === index ? null : current),
                  children: [
                    /* @__PURE__ */ jsx6(
                      "ellipse",
                      {
                        className: [
                          "custom-wave-hit-target",
                          locked ? "is-locked" : ""
                        ].filter(Boolean).join(" "),
                        "data-index": index,
                        cx: screen.x,
                        cy: screen.y,
                        rx: hitRadius.rx,
                        ry: hitRadius.ry
                      }
                    ),
                    /* @__PURE__ */ jsx6(
                      "ellipse",
                      {
                        className: [
                          "custom-wave-handle",
                          locked ? "custom-wave-endpoint is-locked" : ""
                        ].filter(Boolean).join(" "),
                        "data-index": index,
                        cx: screen.x,
                        cy: screen.y,
                        rx: locked ? endpointRadius.rx : handleRadius.rx,
                        ry: locked ? endpointRadius.ry : handleRadius.ry
                      }
                    )
                  ]
                },
                `${point.x}:${point.y}:${index}`
              );
            })
          ]
        }
      ),
      valueLabelPoint && valueLabelScreen ? /* @__PURE__ */ jsx6(
        "span",
        {
          className: [
            "custom-wave-node-value-label",
            valueLabelPoint.x > 0.72 ? "is-left" : "",
            valueLabelPoint.y > 0.72 ? "is-below" : ""
          ].filter(Boolean).join(" "),
          style: {
            left: `${valueLabelScreen.x / width * 100}%`,
            top: `${valueLabelScreen.y / height * 100}%`
          },
          "aria-hidden": "true",
          children: formatChartValue(customWaveOutputValue(valueLabelPoint.y, rangeMin, rangeMax))
        }
      ) : null
    ] }),
    !compact && (showSustainStart || showSustainEnd) ? /* @__PURE__ */ jsxs5("div", { className: "custom-wave-node-controls", children: [
      showSustainStart ? /* @__PURE__ */ jsx6(
        CustomWaveRange,
        {
          label: "start",
          value: customWave.sustainStart,
          min: 0,
          max: Math.max(0, customWave.sustainEnd - 1e-3),
          onChange: onSustainStartChange
        }
      ) : null,
      showSustainEnd ? /* @__PURE__ */ jsx6(
        CustomWaveRange,
        {
          label: "end",
          value: customWave.sustainEnd,
          min: Math.min(1, customWave.sustainStart + 1e-3),
          max: 1,
          onChange: onSustainEndChange
        }
      ) : null
    ] }) : null
  ] });
}
function customWaveGridColumns(subdivisions) {
  const count = Math.max(1, Math.min(64, Math.round(Number.isFinite(subdivisions) ? subdivisions : 8)));
  return Array.from({ length: count + 1 }, (_, index) => ({
    fraction: index / count,
    major: index === 0 || index === count
  }));
}
function customWaveSubgroupBands(subdivisions, subgroups, width, padding) {
  const columnCount = Math.max(1, Math.min(64, Math.round(Number.isFinite(subdivisions) ? subdivisions : 8)));
  const groupSize = Math.max(1, Math.min(64, Math.round(Number.isFinite(subgroups) ? subgroups : 4)));
  const innerWidth = width - padding * 2;
  const bands = [];
  for (let column = groupSize; column < columnCount; column += groupSize * 2) {
    const end = Math.min(column + groupSize, columnCount);
    bands.push({ x: padding + column / columnCount * innerWidth, width: (end - column) / columnCount * innerWidth });
  }
  return bands;
}
function customWaveGridRows(rangeMin, rangeMax, height) {
  const min = Number.isFinite(rangeMin) ? rangeMin : -1;
  const max = Number.isFinite(rangeMax) ? rangeMax : 1;
  const ticks = chartScaleTicks(max, min, height, "vertical");
  const zeroY = (1 - normalizedCustomWaveValue(0, min, max)) / 2;
  const containsZero = min <= 0 && max >= 0 || max <= 0 && min >= 0;
  const existingZero = ticks.find((tick) => Math.abs(tick.fraction - zeroY) < 1e-4);
  if (existingZero) {
    existingZero.origin = true;
    if (containsZero) existingZero.label = "0";
    return ticks;
  }
  return [...ticks, { fraction: zeroY, label: containsZero ? "0" : void 0, major: true, origin: true }].sort((left, right) => left.fraction - right.fraction);
}
function CustomWaveRange({ label, value, min, max, onChange }) {
  return /* @__PURE__ */ jsxs5("label", { className: "custom-wave-node-field custom-wave-node-range", children: [
    /* @__PURE__ */ jsx6("span", { children: label }),
    /* @__PURE__ */ jsx6(
      "input",
      {
        type: "range",
        tabIndex: -1,
        min,
        max,
        step: 1e-3,
        value,
        onChange: (event) => {
          onChange(Number(event.currentTarget.value));
          event.currentTarget.blur();
        },
        onFocus: (event) => event.currentTarget.blur(),
        onPointerDown: (event) => event.stopPropagation(),
        onPointerUp: (event) => {
          event.stopPropagation();
          event.currentTarget.blur();
        },
        onPointerCancel: (event) => {
          event.stopPropagation();
          event.currentTarget.blur();
        },
        onDoubleClick: (event) => event.stopPropagation()
      }
    ),
    /* @__PURE__ */ jsx6(
      "input",
      {
        type: "number",
        min,
        max,
        step: 1e-3,
        value: formatUnitValue(value),
        onChange: (event) => onChange(Number(event.currentTarget.value)),
        onPointerDown: (event) => event.stopPropagation(),
        onDoubleClick: (event) => event.stopPropagation()
      }
    )
  ] });
}
function customWavePath(points, width, height, padding) {
  return points.map((point, index) => {
    const screen = customWavePointToScreen(point, width, height, padding);
    return `${index === 0 ? "M" : "L"}${roundPathNumber(screen.x)} ${roundPathNumber(screen.y)}`;
  }).join(" ");
}
function customWavePointToScreen(point, width, height, padding) {
  return {
    x: padding + point.x * (width - padding * 2),
    y: padding + (1 - (point.y + 1) / 2) * (height - padding * 2)
  };
}
function customWaveOutputValue(normalizedValue, rangeMin, rangeMax) {
  const min = Number.isFinite(rangeMin) ? rangeMin : -1;
  const max = Number.isFinite(rangeMax) ? rangeMax : 1;
  return min + (normalizedValue + 1) / 2 * (max - min);
}
function screenCircleRadius(radiusPx, viewBoxWidth, viewBoxHeight, displaySize) {
  const scaleX = displaySize.width / viewBoxWidth;
  const scaleY = displaySize.height / viewBoxHeight;
  return {
    rx: radiusPx / Math.max(1e-3, scaleX),
    ry: radiusPx / Math.max(1e-3, scaleY)
  };
}
function displayAmplitudeRange(value) {
  const range = Math.abs(Number(value ?? 1));
  return Number.isFinite(range) && range > 0 ? range : 1;
}
function monitorDisplayMode(value, fallback) {
  if (value === void 0) return fallback;
  return Math.round(value) === 1 ? "bipolar" : "unipolar";
}
function amplitudeScaleTicks(range, size, mode, orientation = "horizontal") {
  const divisions = amplitudeLabelDivisions(size, orientation, mode);
  return Array.from({ length: divisions + 1 }, (_, index) => {
    const fraction = index / divisions;
    const value = mode === "bipolar" ? orientation === "horizontal" ? -range + fraction * range * 2 : range - fraction * range * 2 : orientation === "horizontal" ? range * fraction : range * (1 - fraction);
    return {
      fraction,
      label: formatAmplitude(value)
    };
  });
}
function amplitudeLabelDivisions(size, orientation, mode) {
  const base = orientation === "horizontal" ? size >= 1120 ? 16 : size >= 560 ? 8 : size >= 360 ? 4 : 2 : size >= 352 ? 16 : size >= 176 ? 8 : size >= 104 ? 4 : 2;
  return mode === "bipolar" ? Math.max(2, base) : base;
}
function shouldForceCompactPorts(definition) {
  const onlySignalInput = definition.inputs.length === 0 || definition.inputs.length === 1 && definition.inputs[0]?.name === "signal";
  return onlySignalInput && definition.outputs.length <= 1;
}
var ROUTING_NODE_COLORS = [
  "#ff4d6d",
  "#ff922b",
  "#ffd43b",
  "#69db7c",
  "#38d9a9",
  "#22b8cf",
  "#4dabf7",
  "#748ffc",
  "#da77f2",
  "#f06595"
];
function routingNodeNumber(value) {
  return Math.max(1, Math.min(10, Math.round(Number.isFinite(value) ? value ?? 1 : 1)));
}
function routingNodeColor(value) {
  return ROUTING_NODE_COLORS[routingNodeNumber(value) - 1];
}
function isSelectorValuePort(name) {
  return /^[1-9][0-9]*$/.test(name);
}
function samplesToScopePath(samples, range, mode) {
  const restingY = mode === "bipolar" ? 24 : 46;
  if (samples.length < 2) return `M0 ${restingY} L160 ${restingY}`;
  return samples.map((sample, index) => {
    const x = index / (samples.length - 1) * 160;
    const normalized = Math.max(-1, Math.min(1, sample / range));
    const y = mode === "bipolar" ? 24 - normalized * 22 : 46 - Math.abs(normalized) * 44;
    return `${index === 0 ? "M" : "L"}${roundPathNumber(x)} ${roundPathNumber(y)}`;
  }).join(" ");
}
function spectrumBarsFromSamples(samples, barCount) {
  const frequencyBounds = Array.from({ length: barCount + 1 }, (_, index) => FFT_ANALYSIS_MIN_FREQUENCY * (FFT_ANALYSIS_MAX_FREQUENCY / FFT_ANALYSIS_MIN_FREQUENCY) ** (index / barCount));
  const empty = () => Array.from({ length: barCount }, (_, index) => ({
    level: 0,
    startFrequency: frequencyBounds[index],
    endFrequency: frequencyBounds[index + 1]
  }));
  if (samples.length < 32) return empty();
  const fftSize = largestPowerOfTwoAtMost(Math.min(samples.length, 512));
  if (fftSize < 32) return empty();
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const offset = samples.length - fftSize;
  for (let index = 0; index < fftSize; index += 1) {
    const window2 = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (fftSize - 1));
    real[index] = (Number.isFinite(samples[offset + index]) ? samples[offset + index] : 0) * window2;
  }
  fftInPlace(real, imaginary);
  const upperBin = fftSize / 2;
  const binFrequency = 1 / FFT_CAPTURE_SECONDS;
  const magnitudes = new Float64Array(upperBin);
  for (let bin = 1; bin < upperBin; bin += 1) {
    magnitudes[bin] = 2 * Math.hypot(real[bin], imaginary[bin]) / fftSize;
  }
  return Array.from({ length: barCount }, (_, barIndex) => {
    const startFrequency = frequencyBounds[barIndex];
    const endFrequency = frequencyBounds[barIndex + 1];
    const start = Math.max(1, Math.floor(startFrequency / binFrequency));
    const end = Math.max(start + 1, Math.ceil(endFrequency / binFrequency));
    let magnitude = 0;
    for (let bin = start; bin < Math.min(end, upperBin); bin += 1) {
      magnitude = Math.max(magnitude, magnitudes[bin] ?? 0);
    }
    const decibels = 20 * Math.log10(Math.max(1e-6, magnitude));
    return {
      level: clamp((decibels + 84) / 84, 0, 1),
      startFrequency,
      endFrequency
    };
  });
}
function spectrumWindowOpacity(bar, windowStart, windowEnd) {
  const overlap = Math.max(0, Math.min(bar.endFrequency, windowEnd) - Math.max(bar.startFrequency, windowStart));
  const overlapFraction = overlap / Math.max(1, bar.endFrequency - bar.startFrequency);
  return 0.14 + overlapFraction * 0.86;
}
function frequencyGridTicks(detailWidth) {
  const frequencies = [20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4];
  const labelled = detailWidth >= 720 ? new Set(frequencies) : detailWidth >= 400 ? /* @__PURE__ */ new Set([20, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4]) : /* @__PURE__ */ new Set([20, 100, 500, 2e3, 1e4, 2e4]);
  return frequencies.map((frequency) => ({
    fraction: frequencyScaleFraction(frequency),
    label: labelled.has(frequency) ? formatFrequency(frequency) : void 0,
    major: labelled.has(frequency)
  }));
}
function frequencyScaleFraction(frequency) {
  const clampedFrequency = clamp(frequency, FFT_ANALYSIS_MIN_FREQUENCY, FFT_ANALYSIS_MAX_FREQUENCY);
  return Math.log(clampedFrequency / FFT_ANALYSIS_MIN_FREQUENCY) / Math.log(FFT_ANALYSIS_MAX_FREQUENCY / FFT_ANALYSIS_MIN_FREQUENCY);
}
function formatFrequency(frequency) {
  if (frequency >= 1e3) return `${frequency / 1e3}k`;
  return `${frequency}`;
}
function largestPowerOfTwoAtMost(value) {
  return 2 ** Math.floor(Math.log2(Math.max(1, value)));
}
function fftInPlace(real, imaginary) {
  const size = real.length;
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index >= reversed) continue;
    [real[index], real[reversed]] = [real[reversed], real[index]];
    [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + length / 2;
        const oddReal = real[oddIndex] * twiddleReal - imaginary[oddIndex] * twiddleImaginary;
        const oddImaginary = real[oddIndex] * twiddleImaginary + imaginary[oddIndex] * twiddleReal;
        real[oddIndex] = real[evenIndex] - oddReal;
        imaginary[oddIndex] = imaginary[evenIndex] - oddImaginary;
        real[evenIndex] += oddReal;
        imaginary[evenIndex] += oddImaginary;
        const nextTwiddleReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }
}
function roundPathNumber(value) {
  return Math.round(value * 100) / 100;
}
function formatAmplitude(value) {
  if (!Number.isFinite(value)) return "1";
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 10) return trimTrailingZeros(value.toFixed(1));
  if (value >= 1) return trimTrailingZeros(value.toFixed(2));
  return trimTrailingZeros(value.toFixed(3));
}
function formatAccumulatorValue(value) {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return `${value}`;
  return trimTrailingZeros(value.toFixed(3));
}
function trimTrailingZeros(value) {
  return value.replace(/\.?0+$/, "");
}
function formatUnitValue(value) {
  return trimTrailingZeros(clamp(value, 0, 1).toFixed(3));
}
function formatSliderReadoutValue(value) {
  if (!Number.isFinite(value)) return "0";
  if (Object.is(value, -0)) return "0";
  return String(Number(value.toPrecision(6)));
}
function buttonModeFromValue(value) {
  const mode = Math.round(value);
  if (mode === 1) return "trigger";
  if (mode === 2) return "temporary";
  return "toggle";
}
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
function CollapsedNodeLabel({ nodeType, customLabel, displaySuffix, onChange, onSelect }) {
  const defaultLabel = nodeType ? getNodeTypeLabel(nodeType) : "type";
  const displayLabel = customLabel || defaultLabel;
  const [editing, setEditing] = useState6(false);
  const [draft, setDraft] = useState6(displayLabel);
  const inputRef = useRef6(null);
  const selectTimeoutRef = useRef6(null);
  useEffect5(() => () => {
    if (selectTimeoutRef.current !== null) window.clearTimeout(selectTimeoutRef.current);
  }, []);
  useEffect5(() => {
    if (!editing) setDraft(displayLabel);
  }, [displayLabel, editing]);
  useEffect5(() => {
    if (!editing) return;
    const animationFrame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [editing]);
  function commit() {
    onChange(draft);
    setEditing(false);
  }
  function cancel() {
    setDraft(displayLabel);
    setEditing(false);
  }
  if (editing) {
    return /* @__PURE__ */ jsx6(
      "input",
      {
        ref: inputRef,
        className: "collapsed-node-label-editor nodrag nopan",
        size: Math.max(1, draft.length),
        value: draft,
        "aria-label": "Collapsed node label",
        onChange: (event) => setDraft(event.currentTarget.value),
        onBlur: commit,
        onKeyDown: (event) => {
          event.stopPropagation();
          if (event.key === "Enter") commit();
          if (event.key === "Escape") cancel();
        },
        onMouseDown: (event) => event.stopPropagation(),
        onPointerDown: (event) => event.stopPropagation(),
        onClick: (event) => event.stopPropagation(),
        onDoubleClick: (event) => event.stopPropagation(),
        spellCheck: false
      }
    );
  }
  return /* @__PURE__ */ jsxs5(
    "button",
    {
      className: [
        "collapsed-node-label",
        displaySuffix ? "node-title-with-live-readout" : ""
      ].filter(Boolean).join(" "),
      type: "button",
      onClick: (event) => {
        event.stopPropagation();
        if (selectTimeoutRef.current !== null) window.clearTimeout(selectTimeoutRef.current);
        const additive = event.metaKey || event.ctrlKey || event.shiftKey;
        selectTimeoutRef.current = window.setTimeout(() => {
          selectTimeoutRef.current = null;
          onSelect(additive);
        }, 600);
      },
      onDoubleClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (selectTimeoutRef.current !== null) {
          window.clearTimeout(selectTimeoutRef.current);
          selectTimeoutRef.current = null;
        }
        setEditing(true);
      },
      children: [
        displayLabel,
        displaySuffix ? /* @__PURE__ */ jsx6("span", { className: "slider-node-title-readout", "aria-hidden": "true", children: displaySuffix }) : null
      ]
    }
  );
}
function NewPortPlaceholder({ label, onAdd }) {
  const [editing, setEditing] = useState6(false);
  const [draft, setDraft] = useState6("");
  const inputRef = useRef6(null);
  useEffect5(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  function finish() {
    if (draft.trim()) onAdd(draft);
    setDraft("");
    setEditing(false);
  }
  return /* @__PURE__ */ jsx6("div", { className: "shader-port shader-port-placeholder nodrag nopan", children: editing ? /* @__PURE__ */ jsx6(
    "input",
    {
      ref: inputRef,
      className: "port-name-editor nodrag nopan",
      "aria-label": label,
      value: draft,
      onChange: (event) => setDraft(event.currentTarget.value),
      onBlur: finish,
      onKeyDown: (event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish();
        if (event.key === "Escape") {
          setDraft("");
          setEditing(false);
        }
      },
      onPointerDown: (event) => event.stopPropagation(),
      onDoubleClick: (event) => event.stopPropagation(),
      spellCheck: false
    }
  ) : /* @__PURE__ */ jsx6(
    "button",
    {
      type: "button",
      className: "port-name-placeholder nodrag nopan",
      onPointerDown: (event) => event.stopPropagation(),
      onClick: (event) => {
        event.stopPropagation();
        setEditing(true);
      },
      onDoubleClick: (event) => event.stopPropagation(),
      children: label
    }
  ) });
}
function PortNameLabel({
  name,
  editable,
  draggable = false,
  selected = false,
  preview = false,
  activeDragTarget = false,
  activeDragSource = false,
  onPointerDown,
  onChange
}) {
  const [editing, setEditing] = useState6(false);
  const [draft, setDraft] = useState6(name);
  const inputRef = useRef6(null);
  useEffect5(() => {
    if (!editing) {
      setDraft(name);
    }
  }, [editing, name]);
  useEffect5(() => {
    if (!editing) return;
    const animationFrame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [editing]);
  function commitDraft() {
    onChange(draft);
    setEditing(false);
  }
  function cancelDraft() {
    setDraft(name);
    setEditing(false);
  }
  if (editing) {
    return /* @__PURE__ */ jsx6(
      "input",
      {
        ref: inputRef,
        className: "port-name-editor nodrag nopan",
        value: draft,
        onChange: (event) => setDraft(event.currentTarget.value),
        onBlur: commitDraft,
        onKeyDown: (event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            commitDraft();
          }
          if (event.key === "Escape") {
            cancelDraft();
          }
        },
        onPointerDown: (event) => event.stopPropagation(),
        onMouseDown: (event) => event.stopPropagation(),
        onDoubleClick: (event) => event.stopPropagation(),
        spellCheck: false
      }
    );
  }
  return /* @__PURE__ */ jsx6(
    "span",
    {
      className: [
        "port-name-label",
        editable ? "port-name-label-editable" : "",
        draggable ? "port-name-label-draggable nodrag nopan" : "",
        selected ? "port-name-label-selected" : "",
        preview ? "port-name-label-preview" : "",
        activeDragTarget ? "port-name-label-drag-target" : "",
        activeDragSource ? "port-name-label-drag-source" : ""
      ].filter(Boolean).join(" "),
      draggable,
      title: preview ? "Drop a connection here to create this port" : editable ? "Drag to reorder. Double-click to rename" : void 0,
      onPointerDown: (event) => {
        onPointerDown?.(event);
      },
      onDoubleClick: (event) => {
        if (!editable) return;
        event.preventDefault();
        event.stopPropagation();
        setEditing(true);
      },
      children: displayPortName(name)
    }
  );
}
function displayPortName(name) {
  if (name === "originalFrequency") return "original frequency";
  if (name === "baseLevel") return "base level";
  if (name === "minFreq") return "min freq";
  if (name === "maxFreq") return "max freq";
  if (name === "rangeMin") return "range min";
  if (name === "rangeMax") return "range max";
  if (name === "beatLength") return "beat length";
  if (name === "gateLength") return "gate length";
  if (name === "midiChannel") return "midi channel";
  if (name === "midiCc") return "midi cc";
  if (name === "xMin") return "x min";
  if (name === "xMax") return "x max";
  if (name === "xMidiChannel") return "x midi channel";
  if (name === "xMidiCc") return "x midi cc";
  if (name === "yMin") return "y min";
  if (name === "yMax") return "y max";
  if (name === "yMidiChannel") return "y midi channel";
  if (name === "yMidiCc") return "y midi cc";
  if (name === "startNote") return "start note";
  return name;
}
function canLearnMidiCc(nodeType, inputName) {
  return nodeType === "MidiCc" && inputName === "cc" || (nodeType === "Slider" || nodeType === "Button") && inputName === "midiCc" || nodeType === "Joystick" && (inputName === "xMidiCc" || inputName === "yMidiCc");
}
function NodeTypePicker({
  nodeType,
  displayLabel,
  closedSuffix,
  isEditingSubpatch,
  open,
  onOpen,
  onClose,
  onCancel,
  onChange,
  onConvertToArea,
  onCustomLabelCommit
}) {
  const fm1Mode = useContext2(Fm1ModeContext);
  const hostedMode = useContext2(HostedModeContext);
  const nodeTypeLabel = nodeType ? getNodeTypeLabel(nodeType) : "type";
  const pickerLabel = displayLabel ?? nodeTypeLabel;
  const [query, setQuery] = useState6(nodeType ? pickerLabel : "");
  const [highlightedIndex, setHighlightedIndex] = useState6(0);
  const [dragIntent, setDragIntent] = useState6(false);
  const inputRef = useRef6(null);
  const menuRef = useRef6(null);
  const optionRefs = useRef6([]);
  const pointerStartRef = useRef6(null);
  const searchQuery = displayLabel && query.trim() === pickerLabel ? nodeTypeLabel : query;
  const options = useMemo4(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return [...NODE_TYPE_LIST, "Area"].filter((option) => {
      if (hostedMode?.nodeTypes && option !== "Area" && !hostedMode.nodeTypes.includes(option)) return false;
      if (fm1Mode && option !== "Area" && !isFm1NodeImplemented(option)) return false;
      if (!isEditingSubpatch && (option === "Ins" || option === "Outs") || isEditingSubpatch && option === "Params") return false;
      const label = option === "Area" ? "Area" : getNodeTypeLabel(option);
      return option.toLowerCase().includes(normalizedQuery) || label.toLowerCase().includes(normalizedQuery);
    }).sort((left, right) => {
      const leftLabel = left === "Area" ? "Area" : getNodeTypeLabel(left);
      const rightLabel = right === "Area" ? "Area" : getNodeTypeLabel(right);
      const leftStartsWithQuery = left.toLowerCase().startsWith(normalizedQuery) || leftLabel.toLowerCase().startsWith(normalizedQuery);
      const rightStartsWithQuery = right.toLowerCase().startsWith(normalizedQuery) || rightLabel.toLowerCase().startsWith(normalizedQuery);
      return Number(rightStartsWithQuery) - Number(leftStartsWithQuery);
    });
  }, [fm1Mode, hostedMode, isEditingSubpatch, searchQuery]);
  useEffect5(() => {
    if (!open) {
      setQuery(nodeType ? pickerLabel : "");
      setHighlightedIndex(0);
    }
  }, [nodeType, open, pickerLabel]);
  useEffect5(() => {
    if (open) {
      setQuery(nodeType ? pickerLabel : "");
      setHighlightedIndex(0);
      const focusAndSelect = () => {
        inputRef.current?.focus({ preventScroll: true });
        inputRef.current?.select();
      };
      const animationFrame = requestAnimationFrame(focusAndSelect);
      const firstTimeout = window.setTimeout(focusAndSelect, 0);
      const secondTimeout = window.setTimeout(focusAndSelect, 50);
      return () => {
        cancelAnimationFrame(animationFrame);
        window.clearTimeout(firstTimeout);
        window.clearTimeout(secondTimeout);
      };
    }
  }, [nodeType, open, pickerLabel]);
  useEffect5(() => {
    if (!open) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, open]);
  function choose(option) {
    if (option === "Area") {
      onConvertToArea();
    } else {
      onChange(option);
    }
    onClose();
  }
  function commitCustomLabel() {
    const label = query.trim();
    if (!onCustomLabelCommit || label.length === 0) return false;
    onCustomLabelCommit(label);
    onClose();
    return true;
  }
  function closeOrCommitCustomLabel() {
    if (options.length === 0 && commitCustomLabel()) return;
    onClose();
  }
  function handleKeyDown(event) {
    event.stopPropagation();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selectedType = options[highlightedIndex] ?? options[0];
      if (selectedType) {
        choose(selectedType);
      } else {
        commitCustomLabel();
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }
  if (!open) {
    return /* @__PURE__ */ jsxs5(
      "button",
      {
        className: [
          "node-type-picker-button",
          dragIntent ? "node-type-picker-button-drag-intent" : "",
          closedSuffix ? "node-title-with-live-readout" : ""
        ].filter(Boolean).join(" "),
        type: "button",
        onPointerDown: (event) => {
          pointerStartRef.current = { x: event.clientX, y: event.clientY };
          setDragIntent(false);
        },
        onPointerMove: (event) => {
          const pointerStart = pointerStartRef.current;
          if (!pointerStart) return;
          const moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4;
          if (!moved) return;
          setDragIntent(true);
          event.currentTarget.blur();
        },
        onPointerUp: () => {
          window.setTimeout(() => setDragIntent(false), 0);
        },
        onPointerCancel: () => {
          pointerStartRef.current = null;
          setDragIntent(false);
        },
        onClick: (event) => {
          const pointerStart = pointerStartRef.current;
          pointerStartRef.current = null;
          const moved = pointerStart ? Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4 : false;
          if (moved) {
            event.currentTarget.blur();
            return;
          }
        },
        onDoubleClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        },
        children: [
          pickerLabel,
          closedSuffix ? /* @__PURE__ */ jsx6("span", { className: "slider-node-title-readout", "aria-hidden": "true", children: closedSuffix }) : null
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs5("span", { className: "node-type-picker-open-shell", children: [
    /* @__PURE__ */ jsx6("span", { className: "node-type-picker-placeholder", "aria-hidden": "true", children: pickerLabel }),
    /* @__PURE__ */ jsxs5("div", { className: "node-type-picker nodrag nopan nowheel", onMouseDown: (event) => event.stopPropagation(), children: [
      /* @__PURE__ */ jsx6(
        "input",
        {
          ref: inputRef,
          className: "node-type-picker-input",
          autoFocus: true,
          value: query,
          onChange: (event) => {
            setQuery(event.target.value);
            setHighlightedIndex(0);
            if (menuRef.current) {
              menuRef.current.scrollTop = 0;
            }
          },
          onBlur: closeOrCommitCustomLabel,
          onFocus: (event) => event.currentTarget.select(),
          onKeyDown: handleKeyDown,
          onPointerDown: (event) => event.stopPropagation(),
          onDoubleClick: (event) => event.stopPropagation(),
          spellCheck: false
        }
      ),
      /* @__PURE__ */ jsxs5(
        "div",
        {
          ref: menuRef,
          className: "node-type-picker-menu nowheel",
          onMouseDown: (event) => {
            event.preventDefault();
            event.stopPropagation();
          },
          onWheel: (event) => event.stopPropagation(),
          children: [
            options.map((option, index) => /* @__PURE__ */ jsx6(
              "button",
              {
                className: index === highlightedIndex ? "active" : "",
                ref: (element) => {
                  optionRefs.current[index] = element;
                },
                type: "button",
                onMouseDown: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  choose(option);
                },
                children: option === "Area" ? "Area" : getNodeTypeLabel(option)
              },
              option
            )),
            options.length === 0 ? /* @__PURE__ */ jsx6("div", { className: "node-type-picker-empty", children: "no match" }) : null
          ]
        }
      )
    ] })
  ] });
}
function NoteRangeSelect({
  label,
  value,
  min,
  max,
  onChange
}) {
  const lower = clamp(Math.round(min), 0, 127);
  const upper = clamp(Math.round(max), lower, 127);
  const selected = clamp(Math.round(value), lower, upper);
  return /* @__PURE__ */ jsxs5(Fragment2, { children: [
    /* @__PURE__ */ jsx6(PortNameLabel, { name: label, editable: false, draggable: false, preview: false, selected: false, activeDragTarget: false, activeDragSource: false, onChange: () => void 0 }),
    /* @__PURE__ */ jsx6(
      "select",
      {
        className: "shader-port-select nodrag nopan",
        "aria-label": `Roll ${label}`,
        value: String(selected),
        onChange: (event) => {
          onChange(Number(event.currentTarget.value));
          event.currentTarget.blur();
        },
        onPointerDown: (event) => event.stopPropagation(),
        onClick: (event) => event.stopPropagation(),
        onDoubleClick: (event) => event.stopPropagation(),
        children: Array.from({ length: upper - lower + 1 }, (_, offset) => lower + offset).map((note) => /* @__PURE__ */ jsx6("option", { value: note, children: midiNoteLabel(note) }, note))
      }
    )
  ] });
}
function NumericScrubber({
  value,
  min,
  max,
  step: baseStep,
  integer = false,
  replacedBySetLink = false,
  onChange,
  onClear,
  midiLearnEvent,
  onEditStart,
  onMidiLearn
}) {
  const dragStep = integer ? (baseStep ?? 0.01) * 3 : baseStep;
  const [editing, setEditing] = useState6(false);
  const [draft, setDraft] = useState6(formatNumericValue(value));
  const inputRef = useRef6(null);
  const lastMidiLearnIdRef = useRef6(null);
  const wheelValueRef = useRef6(value);
  const lastWheelTimeRef = useRef6(-Infinity);
  const wheelTargetRef = useModifiedWheel((event) => {
    if (event.timeStamp - lastWheelTimeRef.current > 160) {
      wheelValueRef.current = value;
    }
    lastWheelTimeRef.current = event.timeStamp;
    const wheelDelta = wheelAxisDeltaPixels(event, "vertical");
    if (wheelDelta === 0) return;
    const nextValue = constrainValue(
      roundValue2(wheelValueRef.current + wheelDelta * scrubberStep2(event, dragStep)),
      min,
      max,
      integer
    );
    wheelValueRef.current = nextValue;
    onChange(nextValue);
  });
  const dragRef = useRef6(null);
  useEffect5(() => {
    if (!editing) {
      setDraft(formatNumericValue(value));
    }
  }, [editing, value]);
  useEffect5(() => {
    if (editing) {
      setDraft(formatNumericValue(value));
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, value]);
  useEffect5(() => {
    if (!editing || !midiLearnEvent || !onMidiLearn) return;
    if (lastMidiLearnIdRef.current === midiLearnEvent.id) return;
    lastMidiLearnIdRef.current = midiLearnEvent.id;
    const nextValue = constrainValue(midiLearnEvent.cc, min, max, integer);
    setDraft(formatNumericValue(nextValue));
    onMidiLearn(midiLearnEvent);
  }, [editing, integer, max, midiLearnEvent, min, onMidiLearn]);
  function beginEditing() {
    lastMidiLearnIdRef.current = midiLearnEvent?.id ?? null;
    onEditStart?.();
    setEditing(true);
  }
  function startDrag(event) {
    event.stopPropagation();
    dragRef.current = {
      pointerId: event.pointerId,
      anchorY: event.clientY,
      anchorValue: value,
      currentValue: value,
      step: scrubberStep2(event, dragStep),
      dragging: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function updateDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = drag.anchorY - event.clientY;
    if (!drag.dragging && Math.abs(distance) < 3) return;
    drag.dragging = true;
    event.preventDefault();
    event.stopPropagation();
    const step = scrubberStep2(event, dragStep);
    if (step !== drag.step) {
      drag.anchorY = event.clientY;
      drag.anchorValue = drag.currentValue;
      drag.step = step;
    }
    const nextValue = constrainValue(
      roundValue2(drag.anchorValue + (drag.anchorY - event.clientY) * drag.step),
      min,
      max,
      integer
    );
    drag.currentValue = nextValue;
    onChange(nextValue);
  }
  function endDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    if (drag.dragging) {
      event.currentTarget.blur();
    } else {
      beginEditing();
    }
  }
  function commitDraft() {
    const trimmedDraft = draft.trim();
    if (trimmedDraft.length === 0 && onClear) {
      onClear();
      setEditing(false);
      return;
    }
    const nextValue = Number(trimmedDraft);
    if (Number.isFinite(nextValue)) {
      onChange(constrainValue(nextValue, min, max, integer));
    } else {
      setDraft(formatNumericValue(value));
    }
    setEditing(false);
  }
  function cancelDraft() {
    setDraft(formatNumericValue(value));
    setEditing(false);
  }
  function handleEditKeyDown(event) {
    event.stopPropagation();
    if (event.key === "Enter") {
      commitDraft();
    }
    if (event.key === "Escape") {
      cancelDraft();
    }
  }
  if (editing) {
    return /* @__PURE__ */ jsx6(
      "input",
      {
        ref: inputRef,
        className: `numeric-scrubber numeric-scrubber-editing${replacedBySetLink ? " numeric-scrubber-replaced" : ""} nodrag nopan`,
        type: "text",
        inputMode: integer ? "numeric" : "decimal",
        value: draft,
        onChange: (event) => setDraft(event.target.value),
        onBlur: commitDraft,
        onKeyDown: handleEditKeyDown,
        onPointerDown: (event) => event.stopPropagation(),
        onMouseDown: (event) => event.stopPropagation(),
        onClick: (event) => event.stopPropagation(),
        onDoubleClick: (event) => event.stopPropagation(),
        spellCheck: false
      }
    );
  }
  return /* @__PURE__ */ jsx6(
    "div",
    {
      ref: wheelTargetRef,
      className: `numeric-scrubber${replacedBySetLink ? " numeric-scrubber-replaced" : ""} nodrag nopan`,
      role: "spinbutton",
      tabIndex: -1,
      "aria-valuenow": value,
      "aria-valuemin": min,
      "aria-valuemax": max,
      onPointerDown: startDrag,
      onPointerMove: updateDrag,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onMouseDown: (event) => event.stopPropagation(),
      onClick: (event) => event.stopPropagation(),
      onDoubleClick: (event) => event.stopPropagation(),
      onKeyDown: (event) => {
        if (event.key === "Enter") {
          event.stopPropagation();
          beginEditing();
        }
      },
      children: formatNumericValue(value)
    }
  );
}
function roundValue2(value) {
  return Math.round(value * 1e4) / 1e4;
}
function scrubberStep2(event, baseStep = 0.01) {
  if (event.metaKey && event.shiftKey) return baseStep * 200;
  if (event.metaKey) return baseStep * 20;
  if (event.shiftKey) return baseStep * 0.1;
  return baseStep;
}
function useModifiedWheel(onWheel) {
  const targetRef = useRef6(null);
  const handlerRef = useRef6(onWheel);
  handlerRef.current = onWheel;
  useEffect5(() => {
    const target = targetRef.current;
    if (!target) return;
    const handleWheel = (event) => {
      if (!event.shiftKey && !event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handlerRef.current(event, target);
    };
    target.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => target.removeEventListener("wheel", handleWheel, { capture: true });
  });
  return targetRef;
}
function wheelAxisDeltaPixels(event, direction) {
  const delta = direction === "vertical" ? event.deltaY : event.deltaX;
  if (event.deltaMode === 1) return delta * 16;
  if (event.deltaMode === 2) return delta * window.innerHeight;
  return delta;
}
function constrainValue(value, min, max, integer = false) {
  const rounded = integer ? Math.round(value) : value;
  return Math.min(Math.max(rounded, min ?? -Infinity), max ?? Infinity);
}
function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer.types).includes("Files");
}
function makeNodeId(type, existingIds) {
  const base = type.toLowerCase();
  let index = 1;
  let id = `${base}_${index}`;
  while (existingIds.has(id)) {
    index += 1;
    id = `${base}_${index}`;
  }
  return id;
}

// editor/src/editor/NodeEditor.tsx
import { Fragment as Fragment3, jsx as jsx7, jsxs as jsxs6 } from "react/jsx-runtime";
var nodeTypes = { shaderNode: ShaderNode };
var edgeTypes = { shaderEdge: ShaderEdge, virtualRoute: VirtualRouteEdge };
var STORAGE_KEY = "teia.editor-state.v1";
var VIEWPORT_STORAGE_KEY = "teia.viewport.v1";
var HISTORY_LIMIT = 100;
var DRAFT_NODE_PREVIEW_ID = "__draft_node_preview__";
var DUPLICATE_NODE_PREVIEW_PREFIX = "__duplicate_node_preview__:";
var DUPLICATE_AREA_PREVIEW_PREFIX = "__duplicate_area_preview__:";
var COMPACT_NODE_Z_INDEX = 0;
var EXPANDED_NODE_Z_INDEX = 1;
var SELECTED_NODE_Z_INDEX = 2;
var SELECTED_EDGE_Z_INDEX = 1e4;
var DEFAULT_FIT_VIEW_PADDING = 0.2;
var MIN_CANVAS_ZOOM = 0.05;
var ZOOM_RESET_TARGET = USER_ZOOM_BASELINE;
var ZOOM_SETTLE_THRESHOLD = USER_ZOOM_BASELINE * 0.1;
var ZOOM_CHANGE_EPSILON = 1e-4;
var GRAPH_DETAIL_ZOOM_SETTLE_MS = 80;
var BUFFER_CHECKPOINT_INTERVAL_MS = 5e3;
var PASTE_OFFSET = { x: 36, y: 36 };
var DRAFT_NODE_WIDTH = 168;
var DRAFT_NODE_HANDLE_X_OFFSET = 13;
var DRAFT_NODE_FIRST_PORT_Y = 52;
var DEFAULT_EXPRESSION = "a";
var FLOW_INFINITE_EXTENT = [[Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY], [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]];
var MAX_EMPTY_SCREEN_RATIO = 0.7;
var DEFAULT_NODE_BOUNDS_SIZE = { width: 240, height: 96 };
var NODE_HEADER_HEIGHT = 32;
var DSP_ERROR_PANEL_LIMIT = 4;
var FIT_VIEW_OPTIONS = { padding: DEFAULT_FIT_VIEW_PADDING };
var CONNECTION_LINE_COLORS = {
  set: "var(--color-link-set)",
  add: "var(--color-link-add)",
  multiply: "var(--color-link-multiply)",
  bend: "var(--color-link-bend)"
};
var DELETE_KEY_CODES = ["Backspace", "Delete"];
var MULTI_SELECTION_KEY_CODES = ["Meta", "Shift"];
var REACT_FLOW_PRO_OPTIONS = { hideAttribution: true };
var subpatchCloneSequence = 0;
var IDLE_SAMPLE_RECORDING = {
  status: "idle",
  blob: null,
  extension: ".wav",
  elapsedSeconds: 0,
  name: "recording"
};
function NodeEditor({ hosted } = {}) {
  return /* @__PURE__ */ jsx7(ReactFlowProvider, { children: hosted ? /* @__PURE__ */ jsx7(HostedEditorInner, { hosted }, hosted.sessionId) : /* @__PURE__ */ jsx7(StandaloneEditorInner, {}) });
}
function StandaloneEditorInner() {
  const [options, setOptions] = useState7({});
  const audio = useAudioEngine(options);
  return /* @__PURE__ */ jsx7(NodeEditorInner, { audio, onAudioOptions: setOptions });
}
function HostedEditorInner({ hosted }) {
  const audio = useHostedAudio(hosted);
  const capabilities = useMemo5(() => ({ ...hosted.capabilities, assets: hosted.bridge.assets }), [hosted]);
  return /* @__PURE__ */ jsx7(HostedModeContext.Provider, { value: capabilities, children: /* @__PURE__ */ jsx7(NodeEditorInner, { audio, hosted }) });
}
function NodeEditorInner({ audio, hosted, onAudioOptions }) {
  const hostedState = useSyncExternalStore3(hosted?.subscribe ?? emptySubscribe, hosted?.getSnapshot ?? emptySnapshot, hosted?.getSnapshot ?? emptySnapshot);
  const flowStore = useStoreApi2();
  const nodesInitialized = useNodesInitialized();
  const initialState = useMemo5(() => {
    if (!hosted) return loadInitialEditorState();
    const document2 = hosted.getDocument();
    const callbacks = nodeCallbacksPlaceholder();
    const state = flowToEditorState(toFlowNodes(document2, callbacks, null), toFlowEdges(document2, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder), { patchName: document2.name ?? "hosted patch", ...document2.midiInput ? { midiInput: document2.midiInput } : {} });
    state.areas = document2.areas;
    state.buffers = document2.buffers;
    return state;
  }, []);
  const storedViewport = useMemo5(() => hosted ? null : loadStoredViewport(), []);
  const initialViewport = useMemo5(
    () => storedViewport ?? initialState?.ui?.viewport ?? { x: 0, y: 0, zoom: USER_ZOOM_BASELINE },
    [initialState, storedViewport]
  );
  const [patchName, setPatchName] = useState7(initialState?.ui?.patchName ?? "single-patch");
  const [settledViewport, setSettledViewport] = useState7(initialViewport);
  const [fullscreenScopeId, setFullscreenScopeId] = useState7(null);
  useEffect6(() => {
    const updateFullscreenScope = () => {
      setFullscreenScopeId(document.fullscreenElement?.getAttribute("data-fullscreen-scope-id") ?? null);
    };
    updateFullscreenScope();
    document.addEventListener("fullscreenchange", updateFullscreenScope);
    return () => document.removeEventListener("fullscreenchange", updateFullscreenScope);
  }, []);
  const viewportRef = useRef7(initialViewport);
  const [canvasLocked, setCanvasLocked] = useState7(false);
  const [settledGraphZoom, setSettledGraphZoom] = useState7(initialViewport.zoom);
  const [editorSize, setEditorSize] = useState7({ width: 0, height: 0 });
  const [editingTypeNodeId, setEditingTypeNodeId] = useState7(null);
  const [reactFlow, setReactFlow] = useState7(null);
  const [edgeOverlayElement, setEdgeOverlayElement] = useState7(null);
  const [nodes, setNodes] = useState7(() => {
    const callbacks = nodeCallbacksPlaceholder();
    return initialState ? editorStateToFlowNodes(initialState, callbacks, null) : toFlowNodes(demoPatch, callbacks, null);
  });
  const [areas, setAreas] = useState7(() => initialState?.areas ?? []);
  const [nodeStackOrder, setNodeStackOrder] = useState7(() => nodes.map((node) => node.id));
  const [edges, setEdges] = useState7(() => {
    return initialState ? editorStateToFlowEdges(initialState, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder) : toFlowEdges(demoPatch, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder);
  });
  const [weightTargetEdgeId, setWeightTargetEdgeId] = useState7(null);
  const [reconnectingEdgeId, setReconnectingEdgeId] = useState7(null);
  const [history, setHistory] = useState7({ past: [], future: [] });
  const zoomInteractionRef = useRef7({ zoomChanged: false, lastZoom: initialViewport.zoom });
  useEffect6(() => {
    const timeout = window.setTimeout(() => {
      setSettledGraphZoom(settledViewport.zoom);
    }, GRAPH_DETAIL_ZOOM_SETTLE_MS);
    return () => window.clearTimeout(timeout);
  }, [settledViewport.zoom]);
  const nodesRef = useRef7(nodes);
  const nodePresentationCacheRef = useRef7([]);
  const renderedNodeCacheRef = useRef7([]);
  const areasRef = useRef7(areas);
  const edgesRef = useRef7(edges);
  const weightTargetEdgeIdRef = useRef7(null);
  const editorShellRef = useRef7(null);
  const historyGroupRef = useRef7(null);
  const draftNodeConnectionRef = useRef7(null);
  const provisionalNodeIdsRef = useRef7(/* @__PURE__ */ new Set());
  const duplicateDragRef = useRef7(null);
  const pendingNodeDragChangesRef = useRef7(/* @__PURE__ */ new Map());
  const nodeDragAnimationFrameRef = useRef7(null);
  const pendingNodeDragSelectionRef = useRef7(null);
  const activeNodeDragSelectionRef = useRef7(null);
  const routingAppendicesRef = useRef7([]);
  const selectionDragStartRef = useRef7(null);
  const canvasDragPointerRef = useRef7(null);
  const canvasDragActiveRef = useRef7(false);
  const canvasDragPointerIdRef = useRef7(null);
  const ignoreSyntheticSelectionPointerDownRef = useRef7(false);
  const ignoreSyntheticSelectionPointerUpRef = useRef7(false);
  const areaDrawRef = useRef7(null);
  const areaDragRef = useRef7(null);
  const areaResizeRef = useRef7(null);
  const areaUiResizeRef = useRef7(null);
  const pendingBoundaryPortRef = useRef7(null);
  const [draftNodeConnection, setDraftNodeConnection] = useState7(null);
  const [temporarilyRevealedNodeId, setTemporarilyRevealedNodeId] = useState7(null);
  const [duplicateDrag, setDuplicateDrag] = useState7(null);
  const [areaDuplicateDrag, setAreaDuplicateDrag] = useState7(null);
  const [editingStack, setEditingStack] = useState7([]);
  const [pendingBoundaryPort, setPendingBoundaryPort] = useState7(null);
  const [selectedBoundaryPort, setSelectedBoundaryPort] = useState7(null);
  const [newPatchConfirmationOpen, setNewPatchConfirmationOpen] = useState7(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState7(false);
  const moreMenuTriggerRef = useRef7(null);
  const fm1BusyRef = useRef7(false);
  const [fm1Mode, setFm1Mode] = useState7(() => !hosted && initialState?.ui?.fm1Mode === true);
  const [fm1Live, setFm1Live] = useState7(false);
  const [fm1Preset, setFm1Preset] = useState7(1);
  const [fm1Patch, setFm1Patch] = useState7(null);
  const [importError, setImportError] = useState7(null);
  const [saveFeedbackActive, setSaveFeedbackActive] = useState7(false);
  const [localPatchLibrary, setLocalPatchLibrary] = useState7(null);
  const [sampleLibrary, setSampleLibrary] = useState7(null);
  const [bufferSamplePrompt, setBufferSamplePrompt] = useState7(null);
  const [sampleRecording, setSampleRecording] = useState7(IDLE_SAMPLE_RECORDING);
  const [imageLibrary, setImageLibrary] = useState7(null);
  const [subpatchImportModal, setSubpatchImportModal] = useState7(null);
  const [localSubpatchImport, setLocalSubpatchImport] = useState7(null);
  const [midiSettingsOpen, setMidiSettingsOpen] = useState7(false);
  const [selectedMidiInputDeviceIds, setSelectedMidiInputDeviceIds] = useState7(() => normalizeSelectedMidiDeviceIds(initialState?.ui?.midiInput?.selectedDeviceIds));
  const [selectedMidiOutputDeviceIds, setSelectedMidiOutputDeviceIds] = useState7(() => normalizeSelectedMidiDeviceIds(initialState?.ui?.midiInput?.selectedOutputDeviceIds));
  const [midiClockOutputEnabled, setMidiClockOutputEnabled] = useState7(() => initialState?.ui?.midiInput?.sendClock === true);
  const [midiControlVisuals, setMidiControlVisuals] = useState7({});
  const midiControlVisualsRef = useRef7({});
  const [bufferAssets, setBufferAssets] = useState7(() => initialState?.buffers ?? {});
  const copiedGraphRef = useRef7(null);
  const pasteCountRef = useRef7(0);
  const fileInputRef = useRef7(null);
  const importFileInputRef = useRef7(null);
  const sampleFileInputRef = useRef7(null);
  const imageFileInputRef = useRef7(null);
  const pendingSampleUploadNodeIdRef = useRef7(null);
  const bufferSamplePromptResolverRef = useRef7(null);
  const sampleRecorderRef = useRef7(null);
  const sampleRecordingStreamRef = useRef7(null);
  const sampleRecordingChunksRef = useRef7([]);
  const sampleRecordingCancelledRef = useRef7(false);
  const sampleRecordingStartedAtRef = useRef7(0);
  const sampleRecordingTimerRef = useRef7(null);
  const sampleRecordingSessionIdRef = useRef7(0);
  const pendingImageUploadNodeIdRef = useRef7(null);
  const saveFeedbackTimeoutRef = useRef7(null);
  const bufferAssetsRef = useRef7(bufferAssets);
  const bufferCheckpointRef = useRef7(null);
  const bufferLoadGenerationRef = useRef7(0);
  const persistedEditorStateJsonRef = useRef7(null);
  const selectedLocalPatchOptionRef = useRef7(null);
  const reconnectingEdgeRef = useRef7(false);
  const reconnectFixedHandleRef = useRef7(null);
  const reconnectCompletedRef = useRef7(false);
  const reconnectCancelledRef = useRef7(false);
  const nodeConnectionCompletedRef = useRef7(false);
  const reconnectDuplicateRef = useRef7(false);
  const reconnectingEdgeSnapshotRef = useRef7(null);
  const rootPatchName = editingStack[0]?.parentPatchName ?? patchName;
  useEffect6(() => {
    onAudioOptions?.({ selectedMidiInputDeviceIds, selectedMidiOutputDeviceIds, midiClockOutputEnabled, recordingPatchName: rootPatchName });
  }, [onAudioOptions, selectedMidiInputDeviceIds, selectedMidiOutputDeviceIds, midiClockOutputEnabled, rootPatchName]);
  useEffect6(() => {
    bufferAssetsRef.current = bufferAssets;
  }, [bufferAssets]);
  const replaceBufferAssets = useCallback3((assets) => {
    bufferAssetsRef.current = assets;
    setBufferAssets(assets);
  }, []);
  const clearBufferRecording = useCallback3((nodeId) => {
    if (hosted) {
      void hosted.mutateBuffer("clear", nodeId).then((applied) => {
        if (!applied) setImportError("The host did not acknowledge clearing the Buffer.");
      });
      return;
    }
    audio.clearBuffer(nodeId);
    bufferLoadGenerationRef.current += 1;
    if (!bufferAssetsRef.current[nodeId]) return;
    const nextAssets = { ...bufferAssetsRef.current };
    delete nextAssets[nodeId];
    replaceBufferAssets(nextAssets);
    void removeUnreferencedBufferContents(Object.values(nextAssets).map((asset) => asset.hash));
  }, [audio.clearBuffer, replaceBufferAssets]);
  const restoreBufferAssets = useCallback3(async (assets) => {
    if (hosted) {
      replaceBufferAssets(assets);
      return;
    }
    const generation = bufferLoadGenerationRef.current + 1;
    bufferLoadGenerationRef.current = generation;
    replaceBufferAssets(assets);
    audio.restoreBuffers({});
    const snapshots = {};
    await Promise.all(Object.entries(assets).map(async ([nodeId, asset]) => {
      let snapshot = await loadBufferSnapshot(asset);
      if (!snapshot) {
        const data = await fetchLocalBufferContent(asset.hash);
        await storeBufferAssetData(asset, data);
        snapshot = { samples: new Float32Array(data), sampleRate: asset.sampleRate };
      }
      snapshots[nodeId] = snapshot;
    }));
    if (bufferLoadGenerationRef.current !== generation) return;
    audio.restoreBuffers(snapshots);
    await removeUnreferencedBufferContents(Object.values(assets).map((asset) => asset.hash));
  }, [audio.restoreBuffers, replaceBufferAssets]);
  useEffect6(() => {
    if (Object.keys(bufferAssetsRef.current).length === 0) return;
    void restoreBufferAssets(bufferAssetsRef.current).catch((error) => {
      setImportError(error instanceof Error ? error.message : String(error));
    });
  }, [restoreBufferAssets]);
  const requestBufferSampleName = useCallback3((nodeId, defaultName) => {
    bufferSamplePromptResolverRef.current?.(null);
    return new Promise((resolve) => {
      bufferSamplePromptResolverRef.current = resolve;
      setBufferSamplePrompt({ nodeId, name: defaultName });
    });
  }, []);
  const answerBufferSamplePrompt = useCallback3((useBufferContent) => {
    const resolver = bufferSamplePromptResolverRef.current;
    bufferSamplePromptResolverRef.current = null;
    const name = useBufferContent ? bufferSamplePrompt?.name.trim() || null : null;
    setBufferSamplePrompt(null);
    resolver?.(name);
  }, [bufferSamplePrompt]);
  useEffect6(() => () => {
    bufferSamplePromptResolverRef.current?.(null);
    bufferSamplePromptResolverRef.current = null;
  }, []);
  const selectedMidiInputDeviceKey = useMemo5(() => selectedMidiInputDeviceIds.join("\n"), [selectedMidiInputDeviceIds]);
  const audioPlaybackActive = audio.status === "running" || audio.status === "starting";
  const cpuLoad = audio.status === "running" ? Math.min(1, audio.cpuLoad) : 0;
  const cpuPercentage = Math.round((audio.status === "running" ? audio.cpuLoad : 0) * 100);
  const cpuDetails = [
    audio.status === "running" ? `Audio CPU: ${cpuPercentage}%` : "Audio CPU: stopped",
    `Render mode: ${audio.rendering.mode}${audio.rendering.workers ? ` (${audio.rendering.workers} helper threads)` : ""}`,
    ...audio.rendering.mode === "multi" ? [`${audio.rendering.parallelRepeats} eligible Spread/Spawn templates (parallel above each template's workload threshold)`] : [],
    `Peak block: ${Math.round(audio.cpuPeakLoad * 100)}%; missed deadlines: ${audio.cpuDeadlineMisses}`,
    ...audio.rendering.reason ? [`Fallback: ${audio.rendering.reason}`] : []
  ].join("\n");
  const audioRecordingActive = audio.recording.status === "waiting" || audio.recording.status === "recording";
  const recordingButtonLabel = audioRecordingActive ? formatRecordingTimestamp(audio.recording.elapsedSeconds) : "REC";
  const localPatchStorageEnabled = useMemo5(() => !hosted && canUseLocalPatchStorage(), []);
  const [reconnectPreviewEdge, setReconnectPreviewEdge] = useState7(null);
  const [areaDraw, setAreaDraw] = useState7(null);
  const [resumedSelectionDraw, setResumedSelectionDraw] = useState7(null);
  const [selectedAreaId, setSelectedAreaId] = useState7(null);
  const [surfacedAreaId, setSurfacedAreaId] = useState7(null);
  const [editingAreaId, setEditingAreaId] = useState7(null);
  const areaTitleInputRef = useRef7(null);
  const areaTitlePointerStartRef = useRef7(null);
  useEffect6(() => {
    if (!editingAreaId) return;
    const animationFrame = requestAnimationFrame(() => {
      areaTitleInputRef.current?.focus();
      areaTitleInputRef.current?.select();
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [editingAreaId]);
  const toggleAudioPlayback = useCallback3(() => {
    if (hosted) {
      void hosted.toggleTransport();
      return;
    }
    if (fm1Mode) {
      setFm1Live((current) => current ? false : !fm1BusyRef.current);
      return;
    }
    if (audioPlaybackActive) {
      audio.stop();
      return;
    }
    void audio.start();
  }, [fm1Mode, audioPlaybackActive, audio.start, audio.stop]);
  const toggleAudioRecording = useCallback3(() => {
    if (hosted) {
      setImportError("Recording is owned by the host.");
      return;
    }
    if (audioRecordingActive) {
      audio.stopRecording();
      return;
    }
    audio.startRecording();
  }, [audio.startRecording, audio.stopRecording, audioRecordingActive]);
  const toggleMidiInputDevice = useCallback3((deviceId, selected) => {
    setSelectedMidiInputDeviceIds((current) => {
      if (selected) {
        return current.includes(deviceId) ? current : [...current, deviceId];
      }
      return current.filter((entry) => entry !== deviceId);
    });
    if (selected) {
      void audio.refreshMidiInputDevices();
    }
  }, [audio.refreshMidiInputDevices]);
  const toggleMidiOutputDevice = useCallback3((deviceId, selected) => {
    setSelectedMidiOutputDeviceIds((current) => selected ? current.includes(deviceId) ? current : [...current, deviceId] : current.filter((entry) => entry !== deviceId));
    if (selected) void audio.refreshMidiInputDevices();
  }, [audio.refreshMidiInputDevices]);
  const toggleMidiClockOutput = useCallback3((enabled) => {
    setMidiClockOutputEnabled(enabled);
    if (enabled) void audio.refreshMidiInputDevices();
  }, [audio.refreshMidiInputDevices]);
  useEffect6(() => {
    if (selectedMidiInputDeviceIds.length === 0 && selectedMidiOutputDeviceIds.length === 0 && !midiClockOutputEnabled) return;
    void audio.refreshMidiInputDevices();
  }, [audio.refreshMidiInputDevices, midiClockOutputEnabled, selectedMidiInputDeviceIds.length, selectedMidiInputDeviceKey, selectedMidiOutputDeviceIds.length]);
  useEffect6(() => {
    const controlChange = audio.midiInput.lastControlChange;
    if (!controlChange) return;
    const previousVisuals = midiControlVisualsRef.current;
    const nextVisuals = midiControlVisualsForChange(previousVisuals, nodesRef.current, edgesRef.current, controlChange);
    midiControlVisualsRef.current = nextVisuals;
    setMidiControlVisuals(nextVisuals);
    setNodes((current) => applyMidiControlChangeToNodes(current, edgesRef.current, controlChange, previousVisuals, nextVisuals));
  }, [audio.midiInput.lastControlChange]);
  useEffect6(() => {
    const handlePlaybackKeyDown = (event) => {
      if (event.key !== " " || event.repeat) return;
      if (hosted && !hosted.capabilities.transport) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target) && !isPlaybackShortcutControlEventTarget(event.target)) return;
      event.preventDefault();
      toggleAudioPlayback();
    };
    window.addEventListener("keydown", handlePlaybackKeyDown);
    return () => window.removeEventListener("keydown", handlePlaybackKeyDown);
  }, [toggleAudioPlayback]);
  useEffect6(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect6(() => {
    midiControlVisualsRef.current = midiControlVisuals;
  }, [midiControlVisuals]);
  useEffect6(() => {
    areasRef.current = areas;
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (node.data.patchNode.type !== "Spread" && node.data.patchNode.type !== "Spawn") return node;
        const area = areas.find((candidate) => candidate.kind === "spread" && candidate.spreadNodeId === node.id);
        const spreadNodeIds = area?.locked ? [...area.nodeIds ?? []] : void 0;
        if (optionalStringArraysEqual(node.data.patchNode.spreadNodeIds, spreadNodeIds)) return node;
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            patchNode: { ...node.data.patchNode, spreadNodeIds }
          }
        };
      });
      return changed ? next : current;
    });
  }, [areas]);
  useEffect6(() => {
    setAreas((current) => reconcileSpreadAreas(current, nodesRef.current));
  }, [nodes]);
  useEffect6(() => {
    edgesRef.current = edges;
  }, [edges]);
  useEffect6(() => {
    const element = editorShellRef.current;
    if (!element) return;
    const updateEditorSize = () => {
      const rect = element.getBoundingClientRect();
      setEditorSize((current) => {
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);
        if (current.width === width && current.height === height) return current;
        return { width, height };
      });
    };
    updateEditorSize();
    const observer = new ResizeObserver(updateEditorSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect6(() => {
    pendingBoundaryPortRef.current = pendingBoundaryPort;
  }, [pendingBoundaryPort]);
  const updateDraftNodeConnection = useCallback3((value) => {
    const next = typeof value === "function" ? value(draftNodeConnectionRef.current) : value;
    draftNodeConnectionRef.current = next;
    setDraftNodeConnection(next);
  }, []);
  const updateDuplicateDrag = useCallback3((value) => {
    const next = typeof value === "function" ? value(duplicateDragRef.current) : value;
    duplicateDragRef.current = next;
    setDuplicateDrag(next);
  }, []);
  const commitHistory = useCallback3((groupKey) => {
    const now = Date.now();
    const lastGroup = historyGroupRef.current;
    if (groupKey && lastGroup?.key === groupKey && now - lastGroup.time < 800) {
      historyGroupRef.current = { key: groupKey, time: now };
      return;
    }
    const snapshot = graphSnapshot(nodesRef.current, edgesRef.current, areasRef.current);
    const snapshotKey = graphSnapshotKey(snapshot);
    setHistory((current) => {
      const lastSnapshot = current.past[current.past.length - 1];
      if (lastSnapshot && graphSnapshotKey(lastSnapshot) === snapshotKey) return current;
      return {
        past: [...current.past, snapshot].slice(-HISTORY_LIMIT),
        future: []
      };
    });
    historyGroupRef.current = groupKey ? { key: groupKey, time: now } : null;
  }, []);
  const [hostedTransient, setHostedTransient] = useState7({});
  const sendHostedGesture = useCallback3((nodeId, type, values) => {
    if (!hosted?.capabilities.gestures || hosted.capabilities.bridgeVersion !== 2) return false;
    const ports = type === "Button" ? ["pressed", "clicks"] : type === "Keys" ? ["note", "frequency", "gate", "velocity"] : [];
    if (!Object.keys(values).length || !Object.keys(values).every((port) => ports.includes(port))) return false;
    hosted.gesture(nodeId, values);
    setHostedTransient((current) => ({ ...current, [nodeId]: { ...current[nodeId], ...values } }));
    return true;
  }, [hosted]);
  useEffect6(() => {
    if (!hosted?.capabilities.gestures) return;
    const release = () => {
      hosted.releaseGestures("focus loss");
      setHostedTransient({});
    };
    const hidden = () => {
      if (document.hidden) release();
    };
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hidden);
      release();
    };
  }, [hosted]);
  useEffect6(() => {
    setHostedTransient({});
  }, [hostedState?.generation, hostedState?.connected]);
  const updateNodeParam = useCallback3((nodeId, port, value) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (sendHostedGesture(scopedDspNodeId(nodeId, editingStack.map((frame) => frame.groupId)), relatedNode?.data.patchNode.type ?? null, { [port]: value })) return;
    commitHistory(`param:${nodeId}:${port}`);
    if (relatedNode?.data.patchNode.type === "Joystick") {
      const clearX = port === "xMidiChannel" || port === "xMidiCc";
      const clearY = port === "yMidiChannel" || port === "yMidiCc";
      if (clearX || clearY) {
        setMidiControlVisuals((current) => {
          const next = clearJoystickMidiVisual(current, nodeId, clearX, clearY);
          midiControlVisualsRef.current = next;
          return next;
        });
      }
    }
    if (relatedNode?.data.patchNode.type === "Slider" && port === "value" || relatedNode?.data.patchNode.type === "Button" && (port === "pressed" || port === "clicks")) {
      const controlType = relatedNode?.data.patchNode.type === "Slider" ? "Slider" : "Button";
      setMidiControlVisuals((current) => {
        const next = clearMidiControlVisual(current, nodeId, controlType);
        midiControlVisualsRef.current = next;
        return next;
      });
    }
    const nextPatchNode = relatedNode?.data.patchNode.type === "Sequencer" ? {
      ...relatedNode.data.patchNode,
      params: { ...relatedNode.data.patchNode.params, [port]: value }
    } : null;
    const nextPatternScopeSize = relatedNode && (port === "steps" || relatedNode.data.patchNode.type === "Sequencer" && port === "rows" || relatedNode.data.patchNode.type === "Roll" && ["scale", "middle note", "range down", "range up"].includes(port)) ? resizedPatternScopeSize(relatedNode.data.patchNode, { ...relatedNode.data.patchNode.params, [port]: value }) : void 0;
    setNodes((current) => current.map(
      (node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            params: { ...node.data.patchNode.params, [port]: value },
            ...nextPatternScopeSize ? { scopeSize: nextPatternScopeSize } : {},
            outputs: node.data.patchNode.type === "Ins" || node.data.patchNode.type === "Params" ? setPortDefaultValue(node.data.patchNode.outputs, port, value) : node.data.patchNode.outputs
          }
        }
      } : node
    ));
    if (nextPatchNode) {
      const nextDefinition = getNodeDefinition(nextPatchNode);
      setEdges((current) => dedupeEdges(current.flatMap((edge) => {
        const link = linkFromEdge(edge);
        if (!link || link.from.node !== nodeId) return [edge];
        return nextDefinition.outputs.some((output) => output.name === link.from.port) ? [edge] : [];
      })));
    }
  }, [commitHistory, sendHostedGesture, editingStack]);
  const updateNodeParams = useCallback3((nodeId, values) => {
    if (Object.keys(values).length === 0) return;
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (sendHostedGesture(scopedDspNodeId(nodeId, editingStack.map((frame) => frame.groupId)), relatedNode?.data.patchNode.type ?? null, values)) return;
    commitHistory(`params:${nodeId}`);
    if (relatedNode?.data.patchNode.type === "Joystick") {
      const clearX = Object.hasOwn(values, "x");
      const clearY = Object.hasOwn(values, "y");
      if (clearX || clearY) {
        setMidiControlVisuals((current) => {
          const next = clearJoystickMidiVisual(current, nodeId, clearX, clearY);
          midiControlVisualsRef.current = next;
          return next;
        });
      }
    }
    setNodes((current) => current.map((node) => node.id === nodeId ? {
      ...node,
      data: {
        ...node.data,
        patchNode: {
          ...node.data.patchNode,
          params: { ...node.data.patchNode.params, ...values }
        }
      }
    } : node));
  }, [commitHistory, sendHostedGesture, editingStack]);
  const updateNodeCustomWave = useCallback3((nodeId, customWave, historyKey) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== "CustomWave") return;
    commitHistory(historyKey ?? `custom-wave:${nodeId}`);
    setNodes((current) => current.map(
      (node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            customWave: normalizeCustomWave(customWave)
          }
        }
      } : node
    ));
  }, [commitHistory]);
  const updateExpression = useCallback3((nodeId, expression) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== "Expression") return;
    const inputs2 = expressionInputDefinitions(expression);
    const nextParams = syncParamsToInputs(relatedNode.data.patchNode.params, inputs2);
    const previousInputs = relatedNode.data.patchNode.inputs ?? [];
    const inputsChanged = !samePortDefinitions(previousInputs, inputs2);
    if (relatedNode.data.patchNode.expression === expression && !inputsChanged) {
      return;
    }
    commitHistory(`expression:${nodeId}`);
    setNodes((current) => current.map(
      (node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            expression,
            inputs: inputs2,
            params: nextParams
          }
        }
      } : node
    ));
    if (inputsChanged) {
      const nextInputNames = new Set(inputs2.map((input) => input.name));
      setEdges((current) => current.filter((edge) => {
        const link = linkFromEdge(edge);
        return !link || link.to.node !== nodeId || nextInputNames.has(link.to.port);
      }));
    }
  }, [commitHistory]);
  const updateGroupSubpatchName = useCallback3((nodeId, requestedName) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== "Group") return;
    const nextName = normalizeSubpatchName(requestedName, relatedNode.data.patchNode.subpatchName ?? nodeId);
    if (nextName === relatedNode.data.patchNode.subpatchName) return;
    const cloneId = relatedNode.data.patchNode.subpatchCloneId;
    commitHistory(`subpatch-name:${nodeId}`);
    setNodes((current) => current.map((node) => {
      const isLinkedGroup = node.id === nodeId || node.data.patchNode.type === "Group" && cloneId !== void 0 && node.data.patchNode.subpatchCloneId === cloneId;
      if (!isLinkedGroup) return node;
      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            subpatchName: nextName
          }
        }
      };
    }));
  }, [commitHistory]);
  const updateNodeSample = useCallback3((nodeId, sample) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== "SamplePlayer") return;
    commitHistory(`sample:${nodeId}`);
    setNodes((current) => current.map(
      (node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            sample
          }
        }
      } : node
    ));
  }, [commitHistory]);
  const updateNodeImage = useCallback3((nodeId, image) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== "Image") return;
    commitHistory(`image:${nodeId}`);
    setNodes((current) => current.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, patchNode: { ...node.data.patchNode, image } } } : node));
  }, [commitHistory]);
  const resetSampleRecording = useCallback3(() => {
    sampleRecordingSessionIdRef.current += 1;
    sampleRecordingCancelledRef.current = true;
    if (sampleRecordingTimerRef.current !== null) {
      window.clearInterval(sampleRecordingTimerRef.current);
      sampleRecordingTimerRef.current = null;
    }
    const recorder = sampleRecorderRef.current;
    sampleRecorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    sampleRecordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    sampleRecordingStreamRef.current = null;
    sampleRecordingChunksRef.current = [];
    sampleRecordingStartedAtRef.current = 0;
    setSampleRecording(IDLE_SAMPLE_RECORDING);
  }, []);
  useEffect6(() => resetSampleRecording, [resetSampleRecording]);
  const startSampleRecording = useCallback3(async () => {
    if (hosted) {
      setImportError("This operation is owned by the host and has no supplied adapter.");
      return;
    }
    if (!sampleLibrary || sampleRecording.status !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setSampleLibrary((current) => current ? { ...current, error: "Microphone recording is not supported by this browser." } : current);
      return;
    }
    sampleRecordingCancelledRef.current = false;
    const recordingSessionId = sampleRecordingSessionIdRef.current + 1;
    sampleRecordingSessionIdRef.current = recordingSessionId;
    setSampleRecording((current) => ({ ...current, status: "requesting", elapsedSeconds: 0 }));
    setSampleLibrary((current) => current ? { ...current, error: null } : current);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (sampleRecordingCancelledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const recordingFormat = preferredSampleRecordingFormat();
      const recorder = recordingFormat.mimeType ? new MediaRecorder(stream, { mimeType: recordingFormat.mimeType }) : new MediaRecorder(stream);
      sampleRecordingStreamRef.current = stream;
      sampleRecorderRef.current = recorder;
      sampleRecordingChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) sampleRecordingChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        resetSampleRecording();
        setSampleLibrary((current) => current ? { ...current, error: "Microphone recording failed." } : current);
      };
      recorder.onstop = async () => {
        if (sampleRecordingTimerRef.current !== null) {
          window.clearInterval(sampleRecordingTimerRef.current);
          sampleRecordingTimerRef.current = null;
        }
        stream.getTracks().forEach((track) => track.stop());
        sampleRecordingStreamRef.current = null;
        sampleRecorderRef.current = null;
        if (sampleRecordingCancelledRef.current) return;
        const chunks = sampleRecordingChunksRef.current;
        sampleRecordingChunksRef.current = [];
        const recordedBlob = new Blob(chunks, { type: recorder.mimeType || recordingFormat.mimeType || "audio/webm" });
        if (recordedBlob.size === 0) {
          setSampleRecording(IDLE_SAMPLE_RECORDING);
          setSampleLibrary((current) => current ? { ...current, error: "The microphone recording was empty." } : current);
          return;
        }
        try {
          const wavBlob = await convertRecordedAudioToWav(recordedBlob);
          if (sampleRecordingCancelledRef.current || sampleRecordingSessionIdRef.current !== recordingSessionId) return;
          setSampleRecording((current) => ({
            ...current,
            status: "naming",
            blob: wavBlob,
            extension: ".wav",
            name: "recording"
          }));
        } catch (error) {
          if (sampleRecordingCancelledRef.current || sampleRecordingSessionIdRef.current !== recordingSessionId) return;
          setSampleRecording(IDLE_SAMPLE_RECORDING);
          const message = error instanceof Error ? error.message : "Could not convert the microphone recording to WAV.";
          setSampleLibrary((current) => current ? { ...current, error: message } : current);
        }
      };
      recorder.start(250);
      sampleRecordingStartedAtRef.current = performance.now();
      sampleRecordingTimerRef.current = window.setInterval(() => {
        setSampleRecording((current) => ({
          ...current,
          elapsedSeconds: Math.floor((performance.now() - sampleRecordingStartedAtRef.current) / 1e3)
        }));
      }, 250);
      setSampleRecording((current) => ({ ...current, status: "recording", extension: ".wav" }));
    } catch (error) {
      resetSampleRecording();
      const message = error instanceof DOMException && error.name === "NotAllowedError" ? "Microphone permission was denied." : error instanceof Error ? error.message : "Could not access the microphone.";
      setSampleLibrary((current) => current ? { ...current, error: message } : current);
    }
  }, [resetSampleRecording, sampleLibrary, sampleRecording.status]);
  const stopSampleRecording = useCallback3(() => {
    const recorder = sampleRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setSampleRecording((current) => ({ ...current, status: "processing" }));
    recorder.stop();
  }, []);
  const openSampleLibrary = useCallback3(async (nodeId) => {
    if (hosted) {
      const select = hosted.bridge.assets?.selectMedia;
      if (!select) {
        setImportError("Media selection requires a supplied host asset adapter.");
        return;
      }
      try {
        const current = nodesRef.current.find((node) => node.id === nodeId)?.data.patchNode.sample;
        const asset = await hosted.selectMedia({ kind: "sample", nodeId, current });
        if (asset) updateNodeSample(nodeId, asset);
      } catch (error) {
        setImportError(String(error));
      }
      return;
    }
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== "SamplePlayer") return;
    resetSampleRecording();
    const currentSample = relatedNode.data.patchNode.sample ?? null;
    setSampleLibrary({
      nodeId,
      samples: currentSample ? [currentSample] : [],
      selectedUrl: currentSample?.url ?? null,
      loading: true,
      error: null
    });
    try {
      const samples = await fetchLocalSampleLibrary();
      const visibleSamples = currentSample && !samples.some((sample) => sample.url === currentSample.url) ? [currentSample, ...samples] : samples;
      setSampleLibrary((current) => current && current.nodeId === nodeId ? {
        ...current,
        samples: visibleSamples,
        selectedUrl: current.selectedUrl ?? visibleSamples[0]?.url ?? null,
        loading: false,
        error: visibleSamples.length === 0 ? "No samples found in samples/." : null
      } : current);
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSampleLibrary((current) => current && current.nodeId === nodeId ? {
        ...current,
        samples: currentSample ? [currentSample] : [],
        loading: false,
        error: message
      } : current);
      setImportError(message);
    }
  }, [resetSampleRecording]);
  const closeSampleLibrary = useCallback3(() => {
    resetSampleRecording();
    setSampleLibrary(null);
  }, [resetSampleRecording]);
  const selectSampleFromLibrary = useCallback3((sample) => {
    if (!sampleLibrary) return;
    updateNodeSample(sampleLibrary.nodeId, sample);
    setSampleLibrary(null);
    setImportError(null);
  }, [sampleLibrary, updateNodeSample]);
  const requestSampleUpload = useCallback3((nodeId) => {
    if (hosted) {
      setImportError("This operation is owned by the host and has no supplied adapter.");
      return;
    }
    pendingSampleUploadNodeIdRef.current = nodeId;
    sampleFileInputRef.current?.click();
  }, []);
  const requestSampleUploadFromLibrary = useCallback3(() => {
    if (hosted) {
      setImportError("This operation is owned by the host and has no supplied adapter.");
      return;
    }
    if (!sampleLibrary) return;
    requestSampleUpload(sampleLibrary.nodeId);
  }, [requestSampleUpload, sampleLibrary]);
  const uploadSampleForNode = useCallback3(async (nodeId, file) => {
    if (hosted) {
      setImportError("Media editing requires a supplied host asset adapter.");
      return;
    }
    if (!file || !nodeId) return false;
    try {
      setSampleLibrary((current) => current && current.nodeId === nodeId ? { ...current, loading: true, error: null } : current);
      const sample = await uploadLocalSample(file);
      updateNodeSample(nodeId, sample);
      setSampleLibrary((current) => current && current.nodeId === nodeId ? null : current);
      setImportError(null);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSampleLibrary((current) => current && current.nodeId === nodeId ? { ...current, loading: false, error: message } : current);
      setImportError(message);
      return false;
    }
  }, [updateNodeSample]);
  const saveSampleRecording = useCallback3(async () => {
    if (!sampleLibrary || sampleRecording.status !== "naming" || !sampleRecording.blob) return;
    const trimmedName = sampleRecording.name.trim();
    if (!trimmedName) {
      setSampleLibrary((current) => current ? { ...current, error: "Enter a name for the recording." } : current);
      return;
    }
    setSampleRecording((current) => ({ ...current, status: "saving" }));
    const fileName = sampleRecordingFileName(trimmedName, sampleRecording.extension);
    const file = new File([sampleRecording.blob], fileName, { type: sampleRecording.blob.type });
    const saved = await uploadSampleForNode(sampleLibrary.nodeId, file);
    if (!saved) setSampleRecording((current) => ({ ...current, status: "naming" }));
  }, [sampleLibrary, sampleRecording, uploadSampleForNode]);
  const uploadDroppedSampleFiles = useCallback3((nodeId, files) => {
    if (hosted) {
      setImportError("Media editing requires a supplied host asset adapter.");
      return;
    }
    const file = files[0];
    if (!file) return;
    void uploadSampleForNode(nodeId, file);
  }, [uploadSampleForNode]);
  const uploadSampleFile = useCallback3(async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const nodeId = pendingSampleUploadNodeIdRef.current;
    pendingSampleUploadNodeIdRef.current = null;
    if (!file || !nodeId) return;
    await uploadSampleForNode(nodeId, file);
  }, [uploadSampleForNode]);
  const handleSampleLibraryDragOver = useCallback3((event) => {
    if (!sampleLibrary || !hasDraggedFiles2(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, [sampleLibrary]);
  const handleSampleLibraryDrop = useCallback3((event) => {
    if (!sampleLibrary || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    uploadDroppedSampleFiles(sampleLibrary.nodeId, event.dataTransfer.files);
  }, [sampleLibrary, uploadDroppedSampleFiles]);
  const openImageLibrary = useCallback3(async (nodeId) => {
    if (hosted) {
      const select = hosted.bridge.assets?.selectMedia;
      if (!select) {
        setImportError("Media selection requires a supplied host asset adapter.");
        return;
      }
      try {
        const current = nodesRef.current.find((node) => node.id === nodeId)?.data.patchNode.image;
        const asset = await hosted.selectMedia({ kind: "image", nodeId, current });
        if (asset) updateNodeImage(nodeId, asset);
      } catch (error) {
        setImportError(String(error));
      }
      return;
    }
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== "Image") return;
    const currentImage = relatedNode.data.patchNode.image ?? null;
    setImageLibrary({ nodeId, images: currentImage ? [currentImage] : [], selectedUrl: currentImage?.url ?? null, loading: true, error: null });
    try {
      const images = await fetchLocalImageLibrary();
      const visibleImages = currentImage && !images.some((image) => image.url === currentImage.url) ? [currentImage, ...images] : images;
      setImageLibrary((current) => current && current.nodeId === nodeId ? {
        ...current,
        images: visibleImages,
        selectedUrl: current.selectedUrl ?? visibleImages[0]?.url ?? null,
        loading: false,
        error: visibleImages.length === 0 ? "No images found in images/." : null
      } : current);
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImageLibrary((current) => current && current.nodeId === nodeId ? { ...current, images: currentImage ? [currentImage] : [], loading: false, error: message } : current);
      setImportError(message);
    }
  }, []);
  const requestImageUpload = useCallback3((nodeId) => {
    if (hosted) {
      setImportError("This operation is owned by the host and has no supplied adapter.");
      return;
    }
    pendingImageUploadNodeIdRef.current = nodeId;
    imageFileInputRef.current?.click();
  }, []);
  const uploadImageForNode = useCallback3(async (nodeId, file) => {
    if (hosted) {
      setImportError("Media editing requires a supplied host asset adapter.");
      return;
    }
    if (!file || !nodeId) return;
    try {
      setImageLibrary((current) => current && current.nodeId === nodeId ? { ...current, loading: true, error: null } : current);
      const formData = new FormData();
      formData.append("image", file);
      const response = await fetch("/api/local-images", { method: "POST", body: formData });
      if (!response.ok) throw new Error(await response.text() || `Image upload failed (${response.status}).`);
      const payload = await response.json();
      if (!isRecord(payload) || typeof payload.name !== "string" || typeof payload.url !== "string") throw new Error("Image upload returned an invalid response.");
      updateNodeImage(nodeId, { name: payload.name, url: payload.url });
      setImageLibrary((current) => current && current.nodeId === nodeId ? null : current);
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImageLibrary((current) => current && current.nodeId === nodeId ? { ...current, loading: false, error: message } : current);
      setImportError(message);
    }
  }, [updateNodeImage]);
  const uploadImageFile = useCallback3(async (event) => {
    if (hosted) {
      setImportError("Media editing requires a supplied host asset adapter.");
      return;
    }
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const nodeId = pendingImageUploadNodeIdRef.current;
    pendingImageUploadNodeIdRef.current = null;
    if (file && nodeId) await uploadImageForNode(nodeId, file);
  }, [uploadImageForNode]);
  const handleImageLibraryDragOver = useCallback3((event) => {
    if (!imageLibrary || !hasDraggedFiles2(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, [imageLibrary]);
  const handleImageLibraryDrop = useCallback3((event) => {
    if (!imageLibrary || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void uploadImageForNode(imageLibrary.nodeId, event.dataTransfer.files[0]);
  }, [imageLibrary, uploadImageForNode]);
  const selectImageFromLibrary = useCallback3((image) => {
    if (!imageLibrary) return;
    updateNodeImage(imageLibrary.nodeId, image);
    setImageLibrary(null);
    setImportError(null);
  }, [imageLibrary, updateNodeImage]);
  const requestImageUploadFromLibrary = useCallback3(() => {
    if (hosted) {
      setImportError("This operation is owned by the host and has no supplied adapter.");
      return;
    }
    if (imageLibrary) requestImageUpload(imageLibrary.nodeId);
  }, [imageLibrary, requestImageUpload]);
  const updateEdgeWeight = useCallback3((edgeIdToUpdate, weight) => {
    commitHistory(`weight:${edgeIdToUpdate}`);
    setEdges((current) => current.map(
      (edge) => edge.id === edgeIdToUpdate ? {
        ...edge,
        data: {
          ...edge.data,
          weight,
          mode: edge.data?.mode ?? "set",
          enabled: edge.data?.enabled !== false,
          onWeightChange: updateEdgeWeightPlaceholder,
          onModeChange: updateEdgeModePlaceholder,
          onInsertNode: insertNodeOnEdgePlaceholder
        }
      } : edge
    ));
  }, [commitHistory]);
  const updateEdgeMode = useCallback3((edgeIdToUpdate, mode) => {
    commitHistory(`mode:${edgeIdToUpdate}`);
    setEdges((current) => current.map(
      (edge) => edge.id === edgeIdToUpdate ? {
        ...edge,
        data: {
          ...edge.data,
          weight: edge.data?.weight ?? 1,
          mode,
          enabled: edge.data?.enabled !== false,
          onWeightChange: updateEdgeWeightPlaceholder,
          onModeChange: updateEdgeModePlaceholder,
          onInsertNode: insertNodeOnEdgePlaceholder
        }
      } : edge
    ));
  }, [commitHistory]);
  const updateEdgeEnabled = useCallback3((edgeIdToUpdate, enabled) => {
    commitHistory();
    setEdges((current) => current.map(
      (edge) => edge.id === edgeIdToUpdate ? {
        ...edge,
        data: {
          ...edge.data,
          weight: edge.data?.weight ?? 1,
          mode: edge.data?.mode ?? "set",
          enabled,
          onWeightChange: updateEdgeWeightPlaceholder,
          onModeChange: updateEdgeModePlaceholder,
          onInsertNode: insertNodeOnEdgePlaceholder
        }
      } : edge
    ));
  }, [commitHistory]);
  const toggleSelectedEdges = useCallback3(() => {
    const selectedEdgeIds = new Set(
      edgesRef.current.filter((edge) => edge.selected === true).map((edge) => edge.id)
    );
    if (selectedEdgeIds.size === 0) return false;
    commitHistory();
    setEdges((current) => current.map((edge) => selectedEdgeIds.has(edge.id) ? {
      ...edge,
      data: {
        ...edge.data,
        weight: edge.data?.weight ?? 1,
        mode: edge.data?.mode ?? "set",
        enabled: edge.data?.enabled === false,
        onWeightChange: updateEdgeWeightPlaceholder,
        onModeChange: updateEdgeModePlaceholder,
        onInsertNode: insertNodeOnEdgePlaceholder
      }
    } : edge));
    return true;
  }, [commitHistory]);
  const setSelectedEdgesMode = useCallback3((mode) => {
    const selectedEdgeIds = new Set(
      edgesRef.current.filter((edge) => edge.selected === true && (edge.data?.mode ?? "set") !== mode).map((edge) => edge.id)
    );
    if (selectedEdgeIds.size === 0) return false;
    commitHistory(`mode:${mode}`);
    setEdges((current) => current.map((edge) => selectedEdgeIds.has(edge.id) ? {
      ...edge,
      data: {
        ...edge.data,
        weight: edge.data?.weight ?? 1,
        mode,
        enabled: edge.data?.enabled !== false,
        onWeightChange: updateEdgeWeightPlaceholder,
        onModeChange: updateEdgeModePlaceholder,
        onInsertNode: insertNodeOnEdgePlaceholder
      }
    } : edge));
    return true;
  }, [commitHistory]);
  const updateNodeId = useCallback3((nodeId, requestedId) => {
    const nextId = uniqueNodeId(requestedId, nodeId, nodesRef.current);
    if (!nextId || nextId === nodeId) return;
    commitHistory();
    setNodes((current) => current.map(
      (node) => node.id === nodeId ? {
        ...node,
        id: nextId,
        data: {
          ...node.data,
          patchNode: { ...node.data.patchNode, id: nextId }
        }
      } : node
    ));
    setEdges((current) => transformEdgeTree(current, (edge) => renameEdgeNode(edge, nodeId, nextId)));
    setEditingTypeNodeId((current) => current === nodeId ? nextId : current);
  }, [commitHistory]);
  const updateNodeType = useCallback3(async (nodeId, type) => {
    let relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode) return;
    let convertedBufferSample;
    if (relatedNode.data.patchNode.type === "Buffer" && type === "SamplePlayer") {
      if (hosted) {
        setImportError("Buffer to Sample conversion requires a host media conversion adapter.");
        return;
      }
      const dspNodeId = runtimeDspNodeIdForFlowNode(
        relatedNode,
        nodesRef.current,
        editingStack.map((frame) => frame.groupId)
      );
      const snapshot = await audio.captureBuffer(dspNodeId);
      relatedNode = nodesRef.current.find((node) => node.id === nodeId);
      if (!relatedNode || relatedNode.data.patchNode.type !== "Buffer") return;
      if (!snapshot && bufferVisualizationContainsAudio(audio.buffers[dspNodeId])) {
        setImportError("The recorded Buffer could not be read, so it was kept unchanged. Try switching it to Sample again.");
        return;
      }
      if (snapshot && bufferContainsAudio(snapshot.samples)) {
        const requestedName = await requestBufferSampleName(
          nodeId,
          relatedNode.data.patchNode.customLabel?.trim() || `${nodeId}-buffer`
        );
        relatedNode = nodesRef.current.find((node) => node.id === nodeId);
        if (!relatedNode || relatedNode.data.patchNode.type !== "Buffer") return;
        if (requestedName === null) {
          convertedBufferSample = void 0;
        } else {
          try {
            const wav = encodeMonoSamplesAsWav(snapshot.samples, snapshot.sampleRate);
            const file = new File([wav], sampleRecordingFileName(requestedName, ".wav"), { type: "audio/wav" });
            convertedBufferSample = await uploadLocalSample(file);
            relatedNode = nodesRef.current.find((node) => node.id === nodeId);
            if (!relatedNode || relatedNode.data.patchNode.type !== "Buffer") return;
            setImportError(null);
          } catch (error) {
            setImportError(error instanceof Error ? error.message : String(error));
            return;
          }
        }
      }
    }
    provisionalNodeIdsRef.current.delete(nodeId);
    const previousDefinition = relatedNode.data.patchNode.type ? getNodeDefinition(relatedNode.data.patchNode) : null;
    const nextId = shouldAutoRenameForTypeChange(nodeId, relatedNode.data.patchNode.type) ? nextTypeNodeId(nodeId, type, nodesRef.current) : nodeId;
    const expression = type === "Expression" ? DEFAULT_EXPRESSION : void 0;
    const expressionInputs = expression ? expressionInputDefinitions(expression) : void 0;
    const nextDefinition = expressionInputs ? { ...getDefinition(type), inputs: expressionInputs } : getDefinition(type);
    const groupPatchNode = type === "Group" ? {
      id: nextId,
      type: "Group",
      params: {},
      position: relatedNode.position,
      inputs: [],
      outputs: []
    } : null;
    const groupSubpatch = groupPatchNode ? emptySubpatchForGroup(groupPatchNode, relatedNode.position) : void 0;
    const nextParams = expressionInputs ? syncParamsToInputs({}, expressionInputs) : defaultParamsFor(type);
    previousDefinition?.inputs.forEach((input) => {
      const nextInput = nextDefinition.inputs.find((candidate) => candidate.name === input.name);
      if (!nextInput) return;
      const previousValue = relatedNode.data.patchNode.params[input.name];
      if (previousValue !== void 0) nextParams[nextInput.name] = previousValue;
    });
    commitHistory();
    setNodes((current) => current.map(
      (node) => node.id === nodeId ? {
        ...node,
        id: nextId,
        data: {
          ...node.data,
          patchNode: {
            id: nextId,
            type,
            ...node.data.patchNode.customLabel ? { customLabel: node.data.patchNode.customLabel } : {},
            ...type === "Group" ? {
              subpatchName: node.data.patchNode.subpatchName ?? nextId,
              subpatchCloneId: node.data.patchNode.subpatchCloneId ?? makeSubpatchCloneId(nextId),
              inputs: [],
              outputs: [],
              subpatch: groupSubpatch
            } : {},
            ...expression !== void 0 ? { expression } : {},
            ...type === "CustomWave" ? {
              customWave: normalizeCustomWave(node.data.patchNode.customWave, node.data.patchNode.params)
            } : {},
            ...type === "SamplePlayer" && convertedBufferSample ? { sample: convertedBufferSample } : {},
            ...type === "Spread" || type === "Spawn" ? {
              scopeSize: { ...type === "Spawn" ? DEFAULT_SPAWN_SIZE : DEFAULT_SPREAD_SIZE }
            } : {},
            params: nextParams,
            position: node.position,
            ...expressionInputs ? { inputs: expressionInputs } : {}
          }
        }
      } : node
    ));
    setEdges((current) => transformEdgeTree(current, (edge) => {
      const renamed = renameEdgeNode(edge, nodeId, nextId);
      return remapEdgeForNodeType(renamed, nextId, previousDefinition, nextDefinition);
    }));
    setAreas((current) => {
      const withoutPreviousSpread = current.filter((area) => area.spreadNodeId !== nodeId);
      if (type !== "Spread" && type !== "Spawn") return withoutPreviousSpread;
      return [...withoutPreviousSpread, spreadAreaForNode({
        ...relatedNode,
        id: nextId,
        data: {
          ...relatedNode.data,
          patchNode: {
            ...relatedNode.data.patchNode,
            id: nextId,
            type,
            scopeSize: { ...type === "Spawn" ? DEFAULT_SPAWN_SIZE : DEFAULT_SPREAD_SIZE }
          }
        }
      })];
    });
    setEditingTypeNodeId((current) => current === nodeId ? nextId : current);
  }, [audio, commitHistory, editingStack, requestBufferSampleName]);
  const convertNodeToArea = useCallback3((nodeId) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode) return;
    const nodeSize = viewportNodeSize(relatedNode);
    const areaId = `area-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    provisionalNodeIdsRef.current.delete(nodeId);
    commitHistory();
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setAreas((current) => [...current, {
      id: areaId,
      title: "Area",
      position: { ...relatedNode.position },
      size: {
        width: Math.max(48, nodeSize.width),
        height: Math.max(48, nodeSize.height)
      }
    }]);
    setEditingTypeNodeId(null);
    setSelectedAreaId(areaId);
    setSurfacedAreaId(areaId);
  }, [commitHistory]);
  const updateNodeCustomLabel = useCallback3((nodeId, requestedLabel) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode) return;
    const customLabel = requestedLabel.trim();
    if ((relatedNode.data.patchNode.customLabel ?? "") === customLabel) return;
    commitHistory(`label:${nodeId}`);
    setNodes((current) => current.map(
      (node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            ...customLabel ? { customLabel } : { customLabel: void 0 }
          }
        }
      } : node
    ));
  }, [commitHistory]);
  const updateSequencerRowLabels = useCallback3((nodeId, labels) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== "Sequencer") return;
    const sequencerRowLabels = [...labels];
    const sequencerRowLabelColumnWidth2 = rowLabelColumnWidth(sequencerRowLabels);
    if (JSON.stringify(relatedNode.data.patchNode.sequencerRowLabels ?? []) === JSON.stringify(sequencerRowLabels) && relatedNode.data.patchNode.sequencerRowLabelColumnWidth === sequencerRowLabelColumnWidth2) return;
    const shape = sequencerShape(relatedNode.data.patchNode.params);
    const currentSize = clampSequencerNodeSize(
      relatedNode.data.patchNode.scopeSize ?? DEFAULT_SEQUENCER_NODE_SIZE,
      shape.steps,
      shape.rows,
      relatedNode.data.patchNode.sequencerRowLabelColumnWidth ?? 0
    );
    const nextSize = clampSequencerNodeSize({
      width: currentSize.width + sequencerRowLabelColumnWidth2 - (relatedNode.data.patchNode.sequencerRowLabelColumnWidth ?? 0),
      height: currentSize.height
    }, shape.steps, shape.rows, sequencerRowLabelColumnWidth2);
    commitHistory(`sequencer-row-labels:${nodeId}`);
    setNodes((current) => current.map(
      (node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            sequencerRowLabels,
            sequencerRowLabelColumnWidth: sequencerRowLabelColumnWidth2,
            scopeSize: nextSize
          }
        }
      } : node
    ));
  }, [commitHistory]);
  const updateBoundaryPortName = useCallback3((nodeId, side, port, requestedPort) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || !canRenameBoundaryPort(relatedNode.data.patchNode, side)) return;
    const ports = side === "input" ? relatedNode.data.patchNode.inputs ?? [] : relatedNode.data.patchNode.outputs ?? [];
    const nextPort = uniqueBoundaryPortName(requestedPort, port, ports.map((entry) => entry.name), relatedNode.data.patchNode.type === "Params");
    if (!nextPort || nextPort === port) return;
    commitHistory(`port-name:${nodeId}:${side}:${port}`);
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;
      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            inputs: side === "input" ? renamePortDefinitions(node.data.patchNode.inputs, port, nextPort) : node.data.patchNode.inputs,
            outputs: side === "output" ? renamePortDefinitions(node.data.patchNode.type === "Params" ? withParameterIds({ nodes: [node.data.patchNode], links: [] }).nodes[0].outputs : node.data.patchNode.outputs, port, nextPort) : node.data.patchNode.outputs,
            params: nextBoundaryPortParams(node.data.patchNode, side, port, nextPort)
          }
        }
      };
    }));
    setEdges((current) => transformEdgeTree(current, (edge) => renameEdgePort(edge, nodeId, side, port, nextPort)));
  }, [commitHistory]);
  const updateParamRange = useCallback3((nodeId, port, bound, value) => {
    if (!Number.isFinite(value)) return;
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (relatedNode?.data.patchNode.type !== "Params" || !relatedNode.data.patchNode.outputs?.some((output) => output.name === port)) return;
    commitHistory(`param-range:${nodeId}:${port}:${bound}`);
    setNodes((current) => current.map((node) => node.id === nodeId ? {
      ...node,
      data: {
        ...node.data,
        patchNode: {
          ...node.data.patchNode,
          outputs: node.data.patchNode.outputs?.map((output) => output.name === port ? { ...output, [bound]: value } : output)
        }
      }
    } : node));
  }, [commitHistory]);
  const addBoundaryPort = useCallback3((nodeId, side, requestedName) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || !canRenameBoundaryPort(relatedNode.data.patchNode, side)) return;
    const ports = side === "input" ? relatedNode.data.patchNode.inputs ?? [] : relatedNode.data.patchNode.outputs ?? [];
    const baseName = requestedName.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (!baseName) return;
    const usedNames = new Set(ports.map((port) => port.name));
    let name = baseName;
    for (let suffix = 2; usedNames.has(name); suffix += 1) name = `${baseName} ${suffix}`;
    commitHistory(`port-add:${nodeId}:${side}`);
    setNodes((current) => current.map((node) => node.id === nodeId ? {
      ...node,
      data: {
        ...node.data,
        patchNode: {
          ...node.data.patchNode,
          ...side === "input" ? { inputs: [...node.data.patchNode.inputs ?? [], { name }] } : { outputs: [...node.data.patchNode.outputs ?? [], node.data.patchNode.type === "Params" ? { name, defaultValue: 0, min: 0, max: 1 } : { name }] },
          ...node.data.patchNode.type === "Ins" || node.data.patchNode.type === "Params" ? { params: { ...node.data.patchNode.params, [name]: 0 } } : {}
        }
      }
    } : node));
  }, [commitHistory]);
  const updateBoundaryPortOrder = useCallback3((nodeId, side, port, direction) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || !canRenameBoundaryPort(relatedNode.data.patchNode, side)) return;
    commitHistory(`port-order:${nodeId}:${side}`);
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;
      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            inputs: side === "input" ? movePortDefinitions(node.data.patchNode.inputs, port, direction) : node.data.patchNode.inputs,
            outputs: side === "output" ? movePortDefinitions(node.data.patchNode.outputs, port, direction) : node.data.patchNode.outputs
          }
        }
      };
    }));
  }, [commitHistory]);
  const updateNodeCompactPorts = useCallback3((nodeId, compact) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.compactPorts === compact) return;
    commitHistory(`compact:${nodeId}`);
    setNodes((current) => current.map(
      (node) => node.id === nodeId ? {
        ...node,
        selected: compact ? false : node.selected,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            compactPorts: compact
          }
        }
      } : node
    ));
  }, [commitHistory]);
  const updateNodeEnabled = useCallback3((nodeId, enabled) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.enabled !== false === enabled) return;
    commitHistory(`node-enabled:${nodeId}`);
    setNodes((current) => current.map(
      (node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            ...enabled ? { enabled: void 0 } : { enabled: false }
          }
        }
      } : node
    ));
  }, [commitHistory]);
  const toggleSelectedNodes = useCallback3(() => {
    const selectedNodeIds = new Set(nodesRef.current.filter((node) => node.selected === true).map((node) => node.id));
    if (selectedNodeIds.size === 0) return false;
    const shouldEnable = [...selectedNodeIds].some((nodeId) => nodesRef.current.find((node) => node.id === nodeId)?.data.patchNode.enabled === false);
    commitHistory("node-enabled");
    setNodes((current) => current.map(
      (node) => selectedNodeIds.has(node.id) ? {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            ...shouldEnable ? { enabled: void 0 } : { enabled: false }
          }
        }
      } : node
    ));
    return true;
  }, [commitHistory]);
  const updateNodeScopeSize = useCallback3((nodeId, size, anchor, renderedPreviousSize) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== "Scope" && relatedNode.data.patchNode.type !== "Meter" && relatedNode.data.patchNode.type !== "FFT" && relatedNode.data.patchNode.type !== "CustomWave" && relatedNode.data.patchNode.type !== "SamplePlayer" && relatedNode.data.patchNode.type !== "Buffer" && relatedNode.data.patchNode.type !== "Image" && relatedNode.data.patchNode.type !== "Slider" && relatedNode.data.patchNode.type !== "Joystick" && relatedNode.data.patchNode.type !== "Button" && relatedNode.data.patchNode.type !== "Keys" && relatedNode.data.patchNode.type !== "Sequencer" && relatedNode.data.patchNode.type !== "Roll" && relatedNode.data.patchNode.type !== "Spread" && relatedNode.data.patchNode.type !== "Spawn") {
      return;
    }
    const nextSize = relatedNode.data.patchNode.type === "Spread" || relatedNode.data.patchNode.type === "Spawn" ? {
      width: Math.max(
        relatedNode.data.patchNode.type === "Spawn" ? MIN_SPAWN_WIDTH : MIN_RUNTIME_CONTAINER_WIDTH,
        Math.round(size.width)
      ),
      height: Math.max(140, Math.round(size.height))
    } : relatedNode.data.patchNode.type === "Sequencer" ? (() => {
      const shape = sequencerShape(relatedNode.data.patchNode.params);
      return clampSequencerNodeSize(size, shape.steps, shape.rows, relatedNode.data.patchNode.sequencerRowLabelColumnWidth ?? 0);
    })() : relatedNode.data.patchNode.type === "Roll" ? (() => {
      const shape = rollShape(relatedNode.data.patchNode.params);
      return clampSequencerNodeSize(size, shape.steps, shape.rows.length, 32);
    })() : relatedNode.data.patchNode.type === "Image" ? clampImageNodeSize(size, size.width / Math.max(1, size.height)) : relatedNode.data.patchNode.type === "CustomWave" || relatedNode.data.patchNode.type === "SamplePlayer" || relatedNode.data.patchNode.type === "Buffer" ? clampCustomWaveNodeSize(size) : relatedNode.data.patchNode.type === "Keys" ? clampKeysNodeSize(size) : relatedNode.data.patchNode.type === "Slider" || relatedNode.data.patchNode.type === "Joystick" || relatedNode.data.patchNode.type === "Button" ? clampControlNodeSize(size) : clampScopeNodeSize(size);
    const previousSize = relatedNode.data.patchNode.scopeSize;
    if (previousSize?.width === nextSize.width && previousSize.height === nextSize.height) {
      return;
    }
    commitHistory(`node-size:${nodeId}`);
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;
      const currentSize = renderedPreviousSize ?? node.data.patchNode.scopeSize ?? (node.data.patchNode.type === "Spread" || node.data.patchNode.type === "Spawn" ? node.data.patchNode.type === "Spawn" ? DEFAULT_SPAWN_SIZE : DEFAULT_SPREAD_SIZE : node.data.patchNode.type === "Sequencer" ? clampSequencerNodeSize(
        DEFAULT_SEQUENCER_NODE_SIZE,
        sequencerShape(node.data.patchNode.params).steps,
        sequencerShape(node.data.patchNode.params).rows,
        node.data.patchNode.sequencerRowLabelColumnWidth ?? 0
      ) : node.data.patchNode.type === "Roll" ? (() => {
        const shape = rollShape(node.data.patchNode.params);
        return clampSequencerNodeSize({ width: shape.steps * 26 + 32, height: shape.rows.length * 22 }, shape.steps, shape.rows.length, 32);
      })() : node.data.patchNode.type === "Keys" ? DEFAULT_KEYS_NODE_SIZE : node.data.patchNode.type === "FFT" ? DEFAULT_FFT_NODE_SIZE : node.data.patchNode.type === "CustomWave" || node.data.patchNode.type === "SamplePlayer" || node.data.patchNode.type === "Buffer" || node.data.patchNode.type === "Image" ? DEFAULT_CUSTOM_WAVE_NODE_SIZE : node.data.patchNode.type === "Joystick" ? DEFAULT_JOYSTICK_NODE_SIZE : DEFAULT_SCOPE_NODE_SIZE);
      const positionDeltaX = anchor === "left" ? currentSize.width - nextSize.width : 0;
      const position = positionDeltaX === 0 ? node.position : { ...node.position, x: node.position.x + positionDeltaX };
      return {
        ...node,
        position,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            position,
            scopeSize: nextSize
          }
        }
      };
    }));
  }, [commitHistory]);
  const addSelectorInput = useCallback3((nodeId) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== "Selector") return;
    const definition = getNodeDefinition(relatedNode.data.patchNode);
    const valueInputs = selectorValueInputs(definition.inputs);
    const nextIndex = Math.max(0, ...valueInputs.map((input) => Number(input.name))) + 1;
    const nextPort = String(nextIndex);
    if (definition.inputs.some((input) => input.name === nextPort)) return;
    commitHistory(`selector-input:${nodeId}`);
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;
      const currentInputs = getNodeDefinition(node.data.patchNode).inputs;
      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            inputs: [...currentInputs, { name: nextPort, defaultValue: 0 }],
            params: {
              ...node.data.patchNode.params,
              [nextPort]: 0
            }
          }
        }
      };
    }));
  }, [commitHistory]);
  const clearSelectorInput = useCallback3((nodeId, port) => {
    const relatedNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!relatedNode || relatedNode.data.patchNode.type !== "Selector") return;
    if (!isSelectorValuePortName(port)) return;
    const definition = getNodeDefinition(relatedNode.data.patchNode);
    const valueInputs = selectorValueInputs(definition.inputs);
    if (!valueInputs.some((input) => input.name === port)) return;
    if (valueInputs.length <= 1) {
      updateNodeParam(nodeId, port, 0);
      return;
    }
    const removedIndex = Number(port);
    const orderedPorts = valueInputs.map((input) => input.name).sort((left, right) => Number(left) - Number(right));
    const portMap = selectorPortMapAfterRemoval(orderedPorts, removedIndex);
    commitHistory(`selector-input-clear:${nodeId}:${port}`);
    setNodes((current) => current.map((node) => {
      if (node.id !== nodeId) return node;
      const currentDefinition = getNodeDefinition(node.data.patchNode);
      const currentValuePorts = selectorValueInputs(currentDefinition.inputs).map((input) => input.name).sort((left, right) => Number(left) - Number(right));
      const currentPortMap = selectorPortMapAfterRemoval(currentValuePorts, removedIndex);
      const nextInputs = currentDefinition.inputs.flatMap((input) => {
        const nextName = currentPortMap.get(input.name);
        if (nextName === void 0) return isSelectorValuePortName(input.name) ? [] : [input];
        return [{ ...input, name: nextName }];
      });
      const nextParams = remapSelectorParamsAfterRemoval(
        node.data.patchNode.params,
        currentValuePorts,
        currentPortMap,
        removedIndex
      );
      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            inputs: nextInputs,
            params: nextParams
          }
        }
      };
    }));
    setEdges((current) => dedupeEdges(current.flatMap((edge) => remapSelectorEdgeAfterRemoval(edge, nodeId, portMap, removedIndex))));
  }, [commitHistory, updateNodeParam]);
  const addDraftNode = useCallback3((position) => {
    const id = makeNodeId("node", new Set(nodesRef.current.map((node) => node.id)));
    provisionalNodeIdsRef.current.add(id);
    commitHistory();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: "shaderNode",
        position,
        selected: true,
        data: {
          patchNode: { id, type: null, params: {}, position },
          ...nodeCallbacksPlaceholder(),
          isTypePickerOpen: true
        }
      }
    ]);
    setEditingTypeNodeId(id);
  }, [commitHistory]);
  const cancelProvisionalNode = useCallback3((nodeId) => {
    if (!provisionalNodeIdsRef.current.delete(nodeId)) {
      setEditingTypeNodeId(null);
      return;
    }
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => {
      const link = linkFromEdge(edge);
      return !link || link.from.node !== nodeId && link.to.node !== nodeId;
    }));
    setEditingTypeNodeId((current) => current === nodeId ? null : current);
    setHistory((current) => ({
      ...current,
      past: current.past.slice(0, -1)
    }));
  }, []);
  const insertNodeOnEdges = useCallback3((relatedEdges) => {
    if (relatedEdges.length === 0) return;
    const firstLink = edgeEndpoints(relatedEdges[0]);
    if (!firstLink) return;
    const sourceNode = nodesRef.current.find((node) => node.id === firstLink.from.node);
    const targetNode = nodesRef.current.find((node) => node.id === firstLink.to.node);
    const position = midpointPosition(sourceNode?.position, targetNode?.position);
    const id = makeNodeId("node", new Set(nodesRef.current.map((node) => node.id)));
    const relatedEdgeIds = new Set(relatedEdges.map((edge) => edge.id));
    commitHistory();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: "shaderNode",
        position,
        selected: true,
        data: {
          patchNode: { id, type: null, params: {}, position },
          ...nodeCallbacksPlaceholder(),
          isTypePickerOpen: true
        }
      }
    ]);
    setEdges((current) => {
      const incoming = [];
      const downstream = transformEdgeTree(current, (edge) => {
        if (!relatedEdgeIds.has(edge.id)) return { ...edge, selected: false };
        const link = edgeEndpoints(edge);
        if (!link) return edge;
        incoming.push(edgeFromLink({
          from: link.from,
          to: { node: id, port: "value" },
          weight: 1,
          mode: "set",
          enabled: link.enabled
        }, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder));
        if (edge.data?.modulatesEdgeId) {
          return { ...edge, source: id, sourceHandle: "out:value", selected: false };
        }
        return edgeFromLink(
          { ...link, from: { node: id, port: "value" } },
          updateEdgeWeight,
          updateEdgeMode,
          insertNodeOnEdgePlaceholder
        );
      });
      return dedupeEdges([...incoming, ...downstream]);
    });
    setEditingTypeNodeId(id);
  }, [commitHistory, updateEdgeMode, updateEdgeWeight]);
  const insertNodeOnEdge = useCallback3((edgeIdToInsert) => {
    const edge = edgesRef.current.find((candidate) => candidate.id === edgeIdToInsert);
    if (!edge) return;
    insertNodeOnEdges([edge]);
  }, [insertNodeOnEdges]);
  const insertNodeOnPort = useCallback3((nodeId, side, port) => {
    const relatedEdges = edgesRef.current.filter((edge) => {
      const link = linkFromEdge(edge);
      if (!link) return false;
      return side === "output" ? link.from.node === nodeId && link.from.port === port : link.to.node === nodeId && link.to.port === port;
    });
    insertNodeOnEdges(relatedEdges);
  }, [insertNodeOnEdges]);
  const deleteSelectedNodesWithBridge = useCallback3(() => {
    const selectedNodeIds = new Set(
      nodesRef.current.filter((node) => node.selected).map((node) => node.id)
    );
    if (selectedNodeIds.size === 0) return false;
    const bridgeEdges = buildBridgeEdges(nodesRef.current, edgesRef.current, selectedNodeIds, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder);
    const remainingEdges = transformEdgeTree(edgesRef.current, (edge) => selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target) ? null : edge);
    commitHistory();
    setNodes((current) => current.filter((node) => !selectedNodeIds.has(node.id)));
    setEdges(dedupeEdges([...remainingEdges, ...bridgeEdges]));
    setEditingTypeNodeId((current) => current && selectedNodeIds.has(current) ? null : current);
    return true;
  }, [commitHistory, updateEdgeMode, updateEdgeWeight]);
  const deleteSelectedBoundaryPort = useCallback3(() => {
    const selected = selectedBoundaryPort;
    if (!selected) return false;
    const relatedNode = nodesRef.current.find((node) => node.id === selected.nodeId);
    if (!relatedNode || !canRenameBoundaryPort(relatedNode.data.patchNode, selected.side)) return false;
    commitHistory();
    setNodes((current) => current.map((node) => {
      if (node.id !== selected.nodeId) return node;
      const nextInputs = selected.side === "input" ? (node.data.patchNode.inputs ?? []).filter((port) => port.name !== selected.port) : node.data.patchNode.inputs;
      const nextOutputs = selected.side === "output" ? (node.data.patchNode.outputs ?? []).filter((port) => port.name !== selected.port) : node.data.patchNode.outputs;
      const nextParams = boundaryPortHasDefaultValue(node.data.patchNode, selected.side) || selected.side === "input" ? Object.fromEntries(Object.entries(node.data.patchNode.params).filter(([key]) => key !== selected.port)) : node.data.patchNode.params;
      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            params: nextParams,
            ...nextInputs ? { inputs: nextInputs } : {},
            ...nextOutputs ? { outputs: nextOutputs } : {}
          }
        }
      };
    }));
    setEdges((current) => dedupeEdges(current.filter((edge) => {
      const link = linkFromEdge(edge);
      if (!link) return true;
      if (selected.side === "input") {
        return !(link.to.node === selected.nodeId && link.to.port === selected.port);
      }
      return !(link.from.node === selected.nodeId && link.from.port === selected.port);
    })));
    const frame = editingStack[editingStack.length - 1];
    if (frame) {
      setEditingStack((current) => current.map((entry, index) => {
        if (index !== current.length - 1) return entry;
        const parentEdges = dedupeEdges(entry.parentEdges.filter((edge) => {
          const link = linkFromEdge(edge);
          if (!link) return true;
          if (relatedNode.data.patchNode.type === "Ins" && selected.side === "output") {
            return !(link.to.node === entry.groupId && link.to.port === selected.port);
          }
          if (relatedNode.data.patchNode.type === "Outs" && selected.side === "input") {
            return !(link.from.node === entry.groupId && link.from.port === selected.port);
          }
          return true;
        }));
        const parentNodes = entry.parentNodes.map((node) => {
          if (node.id !== entry.groupId) return node;
          if (relatedNode.data.patchNode.type === "Ins" && selected.side === "output") {
            return {
              ...node,
              data: {
                ...node.data,
                patchNode: {
                  ...node.data.patchNode,
                  params: Object.fromEntries(Object.entries(node.data.patchNode.params).filter(([key]) => key !== selected.port)),
                  inputs: (node.data.patchNode.inputs ?? []).filter((port) => port.name !== selected.port)
                }
              }
            };
          }
          if (relatedNode.data.patchNode.type === "Outs" && selected.side === "input") {
            return {
              ...node,
              data: {
                ...node.data,
                patchNode: {
                  ...node.data.patchNode,
                  params: Object.fromEntries(Object.entries(node.data.patchNode.params).filter(([key]) => key !== selected.port)),
                  outputs: (node.data.patchNode.outputs ?? []).filter((port) => port.name !== selected.port)
                }
              }
            };
          }
          return node;
        });
        return {
          ...entry,
          parentEdges,
          parentNodes
        };
      }));
    }
    setPendingBoundaryPort((current) => current && current.nodeId === selected.nodeId && current.side === selected.side && current.port === selected.port ? null : current);
    setSelectedBoundaryPort(null);
    return true;
  }, [commitHistory, editingStack, selectedBoundaryPort]);
  const copySelectedNodes = useCallback3(() => {
    const selectedGraph = selectedGraphFromNodes(nodesRef.current, edgesRef.current);
    if (!selectedGraph) return false;
    copiedGraphRef.current = selectedGraph;
    pasteCountRef.current = 1;
    void writeCopiedGraphToClipboard(selectedGraph);
    return true;
  }, []);
  const groupSelectedNodes = useCallback3(() => {
    const groupedGraph = groupSelectedGraph(nodesRef.current, edgesRef.current, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder);
    if (!groupedGraph) return false;
    commitHistory();
    setNodes(groupedGraph.nodes);
    setEdges(groupedGraph.edges);
    setEditingTypeNodeId(null);
    return true;
  }, [commitHistory, updateEdgeMode, updateEdgeWeight]);
  const scaleSelectedNodes = useCallback3((factor) => {
    const selectedNodes = nodesRef.current.filter((node) => node.selected);
    if (selectedNodes.length === 0) return false;
    const bounds = selectedNodes.map((node) => {
      const width = node.measured?.width ?? node.width ?? DEFAULT_NODE_BOUNDS_SIZE.width;
      const height = node.measured?.height ?? node.height ?? DEFAULT_NODE_BOUNDS_SIZE.height;
      return { node, width, height };
    });
    const minX = Math.min(...bounds.map(({ node }) => node.position.x));
    const minY = Math.min(...bounds.map(({ node }) => node.position.y));
    const maxX = Math.max(...bounds.map(({ node, width }) => node.position.x + width));
    const maxY = Math.max(...bounds.map(({ node, height }) => node.position.y + height));
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const selectedById = new Map(bounds.map((entry) => [entry.node.id, entry]));
    commitHistory();
    setNodes((current) => current.map((node) => {
      const entry = selectedById.get(node.id);
      if (!entry) return node;
      const nextWidth = entry.width * factor;
      const nextHeight = entry.height * factor;
      const currentCenter = {
        x: node.position.x + entry.width / 2,
        y: node.position.y + entry.height / 2
      };
      const nextCenter = {
        x: center.x + (currentCenter.x - center.x) * factor,
        y: center.y + (currentCenter.y - center.y) * factor
      };
      const position = { x: nextCenter.x - nextWidth / 2, y: nextCenter.y - nextHeight / 2 };
      return {
        ...node,
        position,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            position,
            scale: (node.data.patchNode.scale ?? 1) * factor
          }
        }
      };
    }));
    return true;
  }, [commitHistory]);
  const pasteCopiedNodes = useCallback3(async () => {
    const clipboardGraph = await readCopiedGraphFromClipboard();
    const copiedGraph = clipboardGraph ?? copiedGraphRef.current;
    if (!copiedGraph) return false;
    if (clipboardGraph) {
      copiedGraphRef.current = clipboardGraph;
      if (pasteCountRef.current === 0) pasteCountRef.current = 1;
    }
    const pasteOffset = {
      x: PASTE_OFFSET.x * pasteCountRef.current,
      y: PASTE_OFFSET.y * pasteCountRef.current
    };
    const duplicatedGraph = duplicateCopiedGraph(
      copiedGraph,
      nodesRef.current,
      pasteOffset,
      updateEdgeWeight,
      updateEdgeMode,
      insertNodeOnEdgePlaceholder
    );
    if (duplicatedGraph.nodes.length === 0) return false;
    const bufferCopies = duplicatedBufferCopies(
      copiedGraph.nodes,
      duplicatedGraph.nodes,
      nodesRef.current,
      [...nodesRef.current, ...duplicatedGraph.nodes],
      editingStack.map((frame) => frame.groupId)
    );
    pasteCountRef.current += 1;
    commitHistory();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      ...duplicatedGraph.nodes.map((node) => ({ ...node, selected: true }))
    ]);
    setEdges((current) => dedupeEdges([
      ...current.map((edge) => ({ ...edge, selected: false })),
      ...duplicatedGraph.edges
    ]));
    copyBufferAssets(bufferCopies, bufferAssetsRef.current, replaceBufferAssets);
    audio.copyBuffers(bufferCopies);
    setEditingTypeNodeId(null);
    return true;
  }, [audio.copyBuffers, commitHistory, editingStack, replaceBufferAssets, updateEdgeMode, updateEdgeWeight]);
  const createDraftNodeFromConnection = useCallback3((draftConnection = draftNodeConnectionRef.current) => {
    if (!draftConnection || !draftConnection.modifierActive || !reactFlow) return;
    const id = makeNodeId("node", new Set(nodesRef.current.map((node) => node.id)));
    const position = draftNodePosition(draftConnection, reactFlow);
    const link = linkForDraftNodeConnection(draftConnection, id);
    if (!link) return;
    provisionalNodeIdsRef.current.add(id);
    commitHistory();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: "shaderNode",
        position,
        selected: true,
        data: {
          patchNode: { id, type: null, params: {}, position },
          ...nodeCallbacksPlaceholder(),
          isTypePickerOpen: true
        }
      }
    ]);
    setEdges((current) => dedupeEdges([
      ...current.map((edge) => ({ ...edge, selected: false })),
      edgeFromLink(link, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder)
    ]));
    setEditingTypeNodeId(id);
  }, [commitHistory, reactFlow, updateEdgeMode, updateEdgeWeight]);
  const materializePendingBoundaryPort = useCallback3((pending) => {
    const relatedNode = nodesRef.current.find((node) => node.id === pending.nodeId);
    if (!relatedNode || !canRenameBoundaryPort(relatedNode.data.patchNode, pending.side)) return;
    setNodes((current) => current.map((node) => {
      if (node.id !== pending.nodeId) return node;
      const nextPort = boundaryPortHasDefaultValue(relatedNode.data.patchNode, pending.side) ? { name: pending.port, defaultValue: 0, ...relatedNode.data.patchNode.type === "Params" ? { min: 0, max: 1 } : {} } : { name: pending.port };
      const ports = pending.side === "input" ? node.data.patchNode.inputs ?? [] : node.data.patchNode.outputs ?? [];
      if (ports.some((port) => port.name === pending.port)) return node;
      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            inputs: pending.side === "input" ? [...ports, nextPort] : node.data.patchNode.inputs,
            outputs: pending.side === "output" ? [...ports, nextPort] : node.data.patchNode.outputs,
            params: boundaryPortHasDefaultValue(node.data.patchNode, pending.side) ? { ...node.data.patchNode.params, [pending.port]: 0 } : node.data.patchNode.params
          }
        }
      };
    }));
  }, []);
  const enterGroupNode = useCallback3((node) => {
    const patchNode = node.data.patchNode;
    if (patchNode.type !== "Group") return false;
    const subpatch = patchNode.subpatch ?? emptySubpatchForGroup(patchNode, node.position);
    setEditingStack((current) => [
      ...current,
      {
        groupId: node.id,
        parentNodes: nodesRef.current.map(cloneFlowNodeSnapshot),
        parentEdges: edgesRef.current.map(cloneFlowEdgeSnapshot),
        parentAreas: structuredClone(areasRef.current),
        parentPatchName: patchName,
        parentHistory: history
      }
    ]);
    const callbacks = nodeCallbacksPlaceholder();
    setNodes(toFlowNodes(subpatch, callbacks, null));
    setEdges(toFlowEdges(subpatch, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder));
    setAreas(structuredClone(subpatch.areas ?? []));
    setSelectedAreaId(null);
    setSurfacedAreaId(null);
    setPatchName(patchNode.subpatchName ?? node.id);
    setEditingTypeNodeId(null);
    setPendingBoundaryPort(null);
    copiedGraphRef.current = null;
    pasteCountRef.current = 0;
    historyGroupRef.current = null;
    setHistory({ past: [], future: [] });
    return true;
  }, [history, patchName, updateEdgeMode, updateEdgeWeight]);
  const exitSubpatch = useCallback3(() => {
    const frame = editingStack[editingStack.length - 1];
    if (!frame) return false;
    const subpatch = patchFromFlow(nodesRef.current, edgesRef.current, areasRef.current);
    const parentGraph = applySubpatchToParent(frame, subpatch, patchName);
    const previousParentSnapshot = graphSnapshot(frame.parentNodes, frame.parentEdges, frame.parentAreas);
    setEditingStack((current) => current.slice(0, -1));
    setNodes(parentGraph.nodes);
    setEdges(parentGraph.edges);
    setAreas(structuredClone(frame.parentAreas));
    setSelectedAreaId(null);
    setSurfacedAreaId(null);
    setPatchName(frame.parentPatchName);
    setEditingTypeNodeId(null);
    setPendingBoundaryPort(null);
    copiedGraphRef.current = null;
    pasteCountRef.current = 0;
    historyGroupRef.current = null;
    setHistory({
      past: [...frame.parentHistory.past, previousParentSnapshot].slice(-HISTORY_LIMIT),
      future: []
    });
    return true;
  }, [editingStack, patchName]);
  const updateGroupUiNodeOverride = useCallback3((groupId, innerNodeId, historyKey, update) => {
    const group = nodesRef.current.find((node) => node.id === groupId)?.data.patchNode;
    if (group?.type !== "Group" || !group.subpatch) return;
    commitHistory(`group-ui:${groupId}:${historyKey}`);
    setNodes((current) => current.map((node) => {
      const patchNode = node.data.patchNode;
      if (node.id !== groupId || patchNode.type !== "Group" || !patchNode.subpatch) return node;
      const currentOverrides = patchNode.subpatchUiOverrides ?? {};
      return {
        ...node,
        data: {
          ...node.data,
          patchNode: {
            ...patchNode,
            subpatchUiOverrides: {
              ...currentOverrides,
              [innerNodeId]: update(currentOverrides[innerNodeId] ?? {})
            }
          }
        }
      };
    }));
  }, [commitHistory]);
  const resetGroupUiNodeOverride = useCallback3((groupId, innerNodeId) => {
    const group = nodesRef.current.find((node) => node.id === groupId)?.data.patchNode;
    if (group?.type !== "Group" || !group.subpatchUiOverrides?.[innerNodeId]) return;
    commitHistory();
    setNodes((current) => current.map((node) => {
      const patchNode = node.data.patchNode;
      if (node.id !== groupId || patchNode.type !== "Group" || !patchNode.subpatchUiOverrides?.[innerNodeId]) return node;
      const { [innerNodeId]: _removed, ...remainingOverrides } = patchNode.subpatchUiOverrides;
      const { subpatchUiOverrides: _previousOverrides, ...sharedPatchNode } = patchNode;
      return {
        ...node,
        data: {
          ...node.data,
          patchNode: Object.keys(remainingOverrides).length > 0 ? { ...sharedPatchNode, subpatchUiOverrides: remainingOverrides } : sharedPatchNode
        }
      };
    }));
  }, [commitHistory]);
  const selectedLinkPortsByNode = useMemo5(() => {
    const portsByNode = /* @__PURE__ */ new Map();
    const ensureEntry = (nodeId) => {
      const existing = portsByNode.get(nodeId);
      if (existing) return existing;
      const entry = { inputs: /* @__PURE__ */ new Set(), outputs: /* @__PURE__ */ new Set() };
      portsByNode.set(nodeId, entry);
      return entry;
    };
    for (const edge of edges) {
      if (edge.selected !== true) continue;
      const link = linkFromEdge(edge);
      if (!link) continue;
      ensureEntry(link.from.node).outputs.add(link.from.port);
      ensureEntry(link.to.node).inputs.add(link.to.port);
    }
    return new Map([...portsByNode].map(([nodeId, ports]) => [
      nodeId,
      {
        inputs: [...ports.inputs],
        outputs: [...ports.outputs]
      }
    ]));
  }, [edges]);
  const connectedPortsByNode = useMemo5(() => {
    const portsByNode = /* @__PURE__ */ new Map();
    const ensureEntry = (nodeId) => {
      const existing = portsByNode.get(nodeId);
      if (existing) return existing;
      const entry = { inputs: /* @__PURE__ */ new Set(), outputs: /* @__PURE__ */ new Set() };
      portsByNode.set(nodeId, entry);
      return entry;
    };
    for (const edge of edges) {
      const link = linkFromEdge(edge);
      if (!link) continue;
      ensureEntry(link.from.node).outputs.add(link.from.port);
      ensureEntry(link.to.node).inputs.add(link.to.port);
    }
    return new Map([...portsByNode].map(([nodeId, ports]) => [
      nodeId,
      {
        inputs: [...ports.inputs],
        outputs: [...ports.outputs]
      }
    ]));
  }, [edges]);
  const setLinkInputPortsByNode = useMemo5(() => {
    const portsByNode = /* @__PURE__ */ new Map();
    const disabledNodeIds = new Set(
      nodes.filter((node) => node.data.patchNode.enabled === false).map((node) => node.id)
    );
    for (const edge of edges) {
      if (edge.data?.enabled === false || (edge.data?.mode ?? "set") !== "set") continue;
      const link = linkFromEdge(edge);
      if (!link) continue;
      if (disabledNodeIds.has(link.from.node) || disabledNodeIds.has(link.to.node)) continue;
      const ports = portsByNode.get(link.to.node) ?? /* @__PURE__ */ new Set();
      ports.add(link.to.port);
      portsByNode.set(link.to.node, ports);
    }
    return new Map([...portsByNode].map(([nodeId, ports]) => [nodeId, [...ports]]));
  }, [edges, nodes]);
  const selectedNodeCount = nodes.filter((node) => node.selected).length;
  const routingSelection = useMemo5(
    () => routingSelectionHighlights(nodes, edges),
    [edges, nodes]
  );
  const selectNodeFromTitle = useCallback3((nodeId, additive) => {
    setSelectedAreaId(null);
    setNodes((current) => current.map((node) => {
      if (node.id === nodeId) return { ...node, selected: additive ? !node.selected : true };
      return additive || !node.selected ? node : { ...node, selected: false };
    }));
    setEdges((current) => updateSelection(current, /* @__PURE__ */ new Set()));
  }, []);
  const finishTypeEdit = useCallback3(() => {
    setEditingTypeNodeId(null);
  }, []);
  const selectBoundaryPort = useCallback3((nodeId, side, port) => {
    setSelectedBoundaryPort({ nodeId, side, port });
  }, []);
  const selectedAreaNodeIds = useMemo5(() => selectedAreaId ? nodeIdsContainedByAreaHierarchy(areas, nodes, selectedAreaId) : /* @__PURE__ */ new Set(), [areas, nodes, selectedAreaId]);
  const nodeStackRanks = useMemo5(() => {
    const nodeIds = new Set(nodes.map((node) => node.id));
    const orderedNodeIds = nodeStackOrder.filter((nodeId) => nodeIds.has(nodeId));
    const rankedNodeIds = new Set(orderedNodeIds);
    for (const node of nodes) {
      if (rankedNodeIds.has(node.id)) continue;
      orderedNodeIds.push(node.id);
      rankedNodeIds.add(node.id);
    }
    return new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index]));
  }, [nodes, nodeStackOrder]);
  const surfacedAreaIds = useMemo5(() => surfacedAreaId ? connectedAreaIds(areas, surfacedAreaId) : /* @__PURE__ */ new Set(), [areas, surfacedAreaId]);
  const surfacedAreaNodeIds = useMemo5(() => surfacedAreaId ? nodeIdsContainedByAreaHierarchy(areas, nodes, surfacedAreaId) : /* @__PURE__ */ new Set(), [areas, nodes, surfacedAreaId]);
  const surfacedAreaRanks = useMemo5(() => new Map(
    areas.filter((area) => surfacedAreaIds.has(area.id)).map((area, index) => [area.id, index])
  ), [areas, surfacedAreaIds]);
  const baseNodeLayerSize = Math.max(1, nodes.length);
  const surfacedAreaLayerBase = (SELECTED_NODE_Z_INDEX + 1) * baseNodeLayerSize + 1;
  const surfacedNodeLayerBase = surfacedAreaLayerBase + surfacedAreaIds.size;
  const temporaryNodeLayer = surfacedNodeLayerBase + (SELECTED_NODE_Z_INDEX + 1) * baseNodeLayerSize;
  const updateTemporaryPortReveal = useCallback3((nodeId, revealed) => {
    setTemporarilyRevealedNodeId((current) => revealed ? nodeId : current === nodeId ? null : current);
  }, []);
  const nodesWithCallbacks = useMemo5(() => {
    const nextNodes = nodes.map((node) => {
      const compactPorts = node.data.patchNode.compactPorts === true;
      const baseZIndex = node.data.patchNode.type === "Spread" || node.data.patchNode.type === "Spawn" ? 0 : 1 + nodeZIndex(
        node.selected === true || selectedAreaNodeIds.has(node.id),
        compactPorts,
        nodeStackRanks.get(node.id) ?? 0,
        nodes.length
      );
      return {
        ...node,
        ...node.data.patchNode.type === "Spread" || node.data.patchNode.type === "Spawn" ? { draggable: false, selectable: false } : {},
        zIndex: temporarilyRevealedNodeId === node.id ? temporaryNodeLayer : surfacedAreaNodeIds.has(node.id) ? surfacedNodeLayerBase + baseZIndex : baseZIndex,
        data: {
          ...node.data,
          onParamChange: updateNodeParam,
          onParamsChange: updateNodeParams,
          onCustomWaveChange: updateNodeCustomWave,
          onAudioInputDeviceChange: audio.setAudioInputDeviceId,
          onAudioInputRefresh: audio.refreshAudioInputDevices,
          onMidiInputRefresh: audio.refreshMidiInputDevices,
          onTypeChange: updateNodeType,
          onConvertToArea: convertNodeToArea,
          onCustomLabelChange: updateNodeCustomLabel,
          onSequencerRowLabelsChange: updateSequencerRowLabels,
          onTitleSelect: canvasLocked ? void 0 : selectNodeFromTitle,
          onExpressionCommit: updateExpression,
          onTypeEditStart: setEditingTypeNodeId,
          onTypeEditEnd: finishTypeEdit,
          onTypeEditCancel: cancelProvisionalNode,
          onIdChange: updateNodeId,
          onSubpatchNameChange: updateGroupSubpatchName,
          onSampleSelect: openSampleLibrary,
          onSampleDrop: uploadDroppedSampleFiles,
          onImageSelect: openImageLibrary,
          onPortDoubleClick: insertNodeOnPort,
          onPortSelect: selectBoundaryPort,
          onPortNameChange: updateBoundaryPortName,
          onParamRangeChange: updateParamRange,
          onPortAdd: addBoundaryPort,
          onPortMove: updateBoundaryPortOrder,
          onCompactToggle: updateNodeCompactPorts,
          onEnabledChange: updateNodeEnabled,
          onScopeResize: updateNodeScopeSize,
          onSelectorInputAdd: addSelectorInput,
          onSelectorInputClear: clearSelectorInput,
          selectedLinkPorts: selectedLinkPortsByNode.get(node.id),
          ...node.data.patchNode.type === "AudioInput" ? { audioInput: audio.audioInput } : {},
          ...node.data.patchNode.type === "MidiNote" || node.data.patchNode.type === "MidiNoteOn" || node.data.patchNode.type === "MidiNoteOff" || node.data.patchNode.type === "MidiCc" || node.data.patchNode.type === "Slider" || node.data.patchNode.type === "Joystick" || node.data.patchNode.type === "Button" || node.data.patchNode.type === "Tempo" ? { midiInput: audio.midiInput } : {},
          connectedPorts: connectedPortsByNode.get(node.id),
          setLinkInputPorts: setLinkInputPortsByNode.get(node.id),
          isCanvasLocked: canvasLocked,
          canvasZoom: settledGraphZoom,
          previewPort: pendingBoundaryPort && pendingBoundaryPort.nodeId === node.id ? { side: pendingBoundaryPort.side, name: pendingBoundaryPort.port } : null,
          selectedPort: selectedBoundaryPort && selectedBoundaryPort.nodeId === node.id ? { side: selectedBoundaryPort.side, name: selectedBoundaryPort.port } : null,
          isOnlySelected: node.selected === true && selectedNodeCount === 1,
          routingHighlighted: node.selected !== true && routingSelection.nodeIds.has(node.id),
          isConnecting: draftNodeConnection !== null || reconnectingEdgeId !== null,
          onTemporaryPortRevealChange: updateTemporaryPortReveal,
          isTypePickerOpen: editingTypeNodeId === node.id,
          isEditingSubpatch: editingStack.length > 0
        }
      };
    });
    const reconciledNodes = reuseUnchangedNodePresentations(nodePresentationCacheRef.current, nextNodes);
    nodePresentationCacheRef.current = reconciledNodes;
    return reconciledNodes;
  }, [
    canvasLocked,
    connectedPortsByNode,
    setLinkInputPortsByNode,
    draftNodeConnection,
    reconnectingEdgeId,
    editingStack.length,
    editingTypeNodeId,
    finishTypeEdit,
    insertNodeOnPort,
    nodes,
    pendingBoundaryPort,
    openSampleLibrary,
    uploadDroppedSampleFiles,
    openImageLibrary,
    nodeStackRanks,
    selectedAreaNodeIds,
    surfacedAreaNodeIds,
    surfacedNodeLayerBase,
    temporaryNodeLayer,
    temporarilyRevealedNodeId,
    updateTemporaryPortReveal,
    selectedBoundaryPort,
    selectedLinkPortsByNode,
    routingSelection,
    selectBoundaryPort,
    selectNodeFromTitle,
    settledGraphZoom,
    updateBoundaryPortName,
    addBoundaryPort,
    updateBoundaryPortOrder,
    updateExpression,
    updateGroupSubpatchName,
    addSelectorInput,
    clearSelectorInput,
    cancelProvisionalNode,
    convertNodeToArea,
    audio.audioInput,
    audio.midiInput,
    audio.refreshAudioInputDevices,
    audio.refreshMidiInputDevices,
    audio.setAudioInputDeviceId,
    updateNodeCompactPorts,
    updateNodeEnabled,
    updateNodeCustomWave,
    updateNodeScopeSize,
    updateNodeId,
    updateNodeParam,
    updateNodeParams,
    updateParamRange,
    updateNodeCustomLabel,
    updateSequencerRowLabels,
    updateNodeType,
    selectedNodeCount
  ]);
  const onReconnectStart = useCallback3((event, edge, handleType) => {
    if (canvasLocked) return;
    const duplicateActive = isReconnectDuplicateModifierPressed(event);
    reconnectingEdgeRef.current = true;
    setReconnectingEdgeId(edge.id);
    reconnectFixedHandleRef.current = handleType;
    reconnectCompletedRef.current = false;
    reconnectCancelledRef.current = false;
    reconnectDuplicateRef.current = duplicateActive;
    reconnectingEdgeSnapshotRef.current = cloneFlowEdgeSnapshot(edge);
    setReconnectPreviewEdge(duplicateActive ? reconnectPreviewEdgeFromEdge(edge) : null);
    let nextPending = null;
    if (editingStack.length > 0 || nodesRef.current.some((node) => node.data.patchNode.type === "Params")) {
      if (handleType === "target") {
        const insNode = nodesRef.current.find((node) => node.data.patchNode.type === (editingStack.length > 0 ? "Ins" : "Params"));
        if (insNode && edge.target !== insNode.id) {
          const usedNames = new Set((insNode.data.patchNode.outputs ?? []).map((port) => port.name));
          nextPending = {
            nodeId: insNode.id,
            side: "output",
            port: uniquePortName(editingStack.length > 0 ? "new input" : "new parameter", usedNames)
          };
        }
      } else {
        const outsNode = nodesRef.current.find((node) => node.data.patchNode.type === "Outs");
        if (outsNode && edge.source !== outsNode.id) {
          const usedNames = new Set((outsNode.data.patchNode.inputs ?? []).map((port) => port.name));
          nextPending = {
            nodeId: outsNode.id,
            side: "input",
            port: uniquePortName("new output", usedNames)
          };
        }
      }
    }
    pendingBoundaryPortRef.current = nextPending;
    setPendingBoundaryPort(nextPending);
    updateDraftNodeConnection(null);
  }, [canvasLocked, editingStack.length, updateDraftNodeConnection]);
  const onReconnectEnd = useCallback3((event, edge, fixedHandle, connectionState) => {
    const pointer = clientPointFromEvent(event);
    if (!canvasLocked && !reconnectCancelledRef.current && fixedHandle === "source" && !reconnectCompletedRef.current && !connectionState.toHandle && pointer) {
      const targetId = linkAtScreenPoint(pointer, edgesRef.current.filter(
        (candidate) => strengthTargetIsAllowed(edge.id, candidate.id, edgesRef.current)
      ));
      const target = edgesRef.current.find((candidate) => candidate.id === targetId);
      if (target) {
        const duplicate = reconnectDuplicateRef.current;
        const replacement = {
          ...edge,
          id: duplicate ? `weight-modulation:${crypto.randomUUID()}` : edge.id,
          target: target.target,
          targetHandle: target.targetHandle,
          selected: true,
          data: { ...edge.data, modulatesEdgeId: target.id, isFeedback: false }
        };
        commitHistory();
        setNodes((current) => current.map((node) => ({ ...node, selected: false })));
        setEdges((current) => duplicate ? dedupeEdges([...current.map((candidate) => ({ ...candidate, selected: false })), replacement]) : transformEdgeTree(current, (candidate) => candidate.id === edge.id ? replacement : { ...candidate, selected: false }));
      }
    }
    reconnectingEdgeRef.current = false;
    reconnectCancelledRef.current = false;
    setReconnectingEdgeId(null);
    reconnectFixedHandleRef.current = null;
    reconnectCompletedRef.current = false;
    reconnectDuplicateRef.current = false;
    reconnectingEdgeSnapshotRef.current = null;
    pendingBoundaryPortRef.current = null;
    setPendingBoundaryPort(null);
    setReconnectPreviewEdge(null);
    weightTargetEdgeIdRef.current = null;
    setWeightTargetEdgeId(null);
    updateDraftNodeConnection(null);
  }, [canvasLocked, commitHistory, updateDraftNodeConnection]);
  useEffect6(() => {
    const updateReconnectDuplicateModifier = (event) => {
      if (!reconnectingEdgeRef.current) return;
      if (event.key === "Escape") {
        reconnectCancelledRef.current = true;
        flowStore.getState().cancelConnection();
        setReconnectingEdgeId(null);
        setReconnectPreviewEdge(null);
        weightTargetEdgeIdRef.current = null;
        setWeightTargetEdgeId(null);
        return;
      }
      if (reconnectCancelledRef.current) return;
      const duplicateActive = isReconnectDuplicateModifierPressed(event);
      reconnectDuplicateRef.current = duplicateActive;
      setReconnectPreviewEdge(
        duplicateActive && reconnectingEdgeSnapshotRef.current ? reconnectPreviewEdgeFromEdge(reconnectingEdgeSnapshotRef.current) : null
      );
    };
    window.addEventListener("keydown", updateReconnectDuplicateModifier);
    window.addEventListener("keyup", updateReconnectDuplicateModifier);
    return () => {
      window.removeEventListener("keydown", updateReconnectDuplicateModifier);
      window.removeEventListener("keyup", updateReconnectDuplicateModifier);
    };
  }, [flowStore]);
  const onReconnect = useCallback3((oldEdge, connection) => {
    if (canvasLocked || reconnectCancelledRef.current) return;
    reconnectCompletedRef.current = true;
    if (oldEdge.data?.modulatesEdgeId && reconnectFixedHandleRef.current === "target") {
      const sourceHandle = connection.sourceHandle ? parseHandleId(connection.sourceHandle) : null;
      if (!connection.source || sourceHandle?.kind !== "out") return;
      if (oldEdge.source === connection.source && oldEdge.sourceHandle === connection.sourceHandle) return;
      commitHistory();
      const pending2 = pendingBoundaryPortRef.current;
      if (pending2?.side === "output" && connection.source === pending2.nodeId && connection.sourceHandle === `out:${pending2.port}`) {
        materializePendingBoundaryPort(pending2);
      }
      setNodes((current) => current.map((node) => ({ ...node, selected: false })));
      const shouldDuplicate2 = reconnectDuplicateRef.current;
      const replacement = {
        ...oldEdge,
        id: shouldDuplicate2 ? `weight-modulation:${crypto.randomUUID()}` : oldEdge.id,
        source: connection.source,
        sourceHandle: connection.sourceHandle,
        selected: true
      };
      setEdges((current) => dedupeEdges(shouldDuplicate2 ? [...current.map((edge) => ({ ...edge, selected: false })), replacement] : current.map((edge) => edge.id === oldEdge.id ? replacement : { ...edge, selected: false })));
      return;
    }
    const candidate = {
      ...oldEdge,
      data: oldEdge.data ? { ...oldEdge.data, modulatesEdgeId: void 0 } : void 0,
      source: connection.source ?? "",
      sourceHandle: connection.sourceHandle,
      target: connection.target ?? "",
      targetHandle: connection.targetHandle
    };
    const link = linkFromEdge(candidate);
    if (!link) return;
    if (!runtimeContainerLinkIsAllowed(link, nodesRef.current)) return;
    const oldLink = linkFromEdge(oldEdge);
    const weight = oldEdge.data?.weight ?? oldLink?.weight ?? 1;
    const mode = oldEdge.data?.mode ?? oldLink?.mode ?? "set";
    const enabled = oldEdge.data?.enabled ?? oldLink?.enabled ?? true;
    const nextEdge = {
      ...edgeFromLink({ from: link.from, to: link.to, weight, mode, enabled }, updateEdgeWeight, updateEdgeMode, insertNodeOnEdge),
      selected: true,
      reconnectable: true
    };
    const nextLink = linkFromEdge(nextEdge);
    if (!nextLink) return;
    const nextEdgeId = edgeId(nextLink);
    if (oldEdge.id === nextEdgeId && oldLink && samePatchLink(oldLink, nextLink)) return;
    const shouldDuplicate = reconnectDuplicateRef.current;
    commitHistory();
    const pending = pendingBoundaryPortRef.current;
    if (pending) {
      const isPendingSource = pending.side === "output" && connection.source === pending.nodeId && connection.sourceHandle === `out:${pending.port}`;
      const isPendingTarget = pending.side === "input" && connection.target === pending.nodeId && connection.targetHandle === `in:${pending.port}`;
      if (isPendingSource || isPendingTarget) {
        materializePendingBoundaryPort(pending);
      }
    }
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    setEdges((current) => {
      const duplicate = current.find((edge) => {
        if (edge.id === oldEdge.id) return false;
        const existing = linkFromEdge(edge);
        return existing ? samePatchLink(existing, nextLink) : false;
      });
      if (duplicate) {
        if (shouldDuplicate) return current.map((edge) => ({ ...edge, selected: edge.id === duplicate.id }));
        return transformEdgeTree(current, (edge) => edge.id === oldEdge.id ? { ...duplicate, selected: true } : { ...edge, selected: edge.id === duplicate.id });
      }
      if (shouldDuplicate) {
        return dedupeEdges([
          ...current.map((edge) => ({ ...edge, selected: false })),
          nextEdge
        ]);
      }
      return transformEdgeTree(current, (edge) => edge.id === oldEdge.id ? nextEdge : { ...edge, selected: false });
    });
  }, [canvasLocked, commitHistory, insertNodeOnEdge, materializePendingBoundaryPort, updateEdgeMode, updateEdgeWeight]);
  const edgesWithCallbacks = useMemo5(() => {
    const selectedEdgeCount = edges.filter((edge) => edge.selected).length;
    const selectedNodeIds = new Set(
      nodes.filter((node) => node.selected).map((node) => node.id)
    );
    const disabledNodeIds = new Set(
      nodes.filter((node) => node.data.patchNode.enabled === false).map((node) => node.id)
    );
    const hasHighlightedLinks = selectedEdgeCount > 0 || selectedNodeIds.size > 0;
    return edges.map((edge) => {
      const link = linkFromEdge(edge);
      const sourceNode = link ? nodes.find((node) => node.id === link.from.node) : void 0;
      const targetNode = link ? nodes.find((node) => node.id === link.to.node) : void 0;
      const hasInternalRuntimeEndpoint = Boolean(link && (sourceNode?.data.patchNode.type === "Spread" && link.from.port === "item index" || sourceNode?.data.patchNode.type === "Spawn" && link.from.port === "instance gate" || targetNode?.data.patchNode.type === "Spawn" && link.to.port === "kill trigger"));
      const isConnectedToSelectedNode = isEdgeConnectedToSelectedNode(edge, selectedNodeIds) || routingSelection.edgeIds.has(edge.id);
      const isHighlighted = edge.selected === true || isConnectedToSelectedNode;
      return {
        ...edge,
        // Keep endpoint reconnection available even before an edge is selected.
        // Otherwise a pointer down where an edge meets a Spawn/Spread's internal
        // handle is captured by that handle and begins a second link instead of
        // moving the endpoint the user grabbed.
        reconnectable: edge.data?.modulatesEdgeId ? "source" : true,
        // Incident-node emphasis stays in the normal edge layer so the selected
        // node and its controls remain unobscured. Internal runtime endpoints
        // are the sole exception because their visible pins are inside a node.
        zIndex: edge.selected || hasInternalRuntimeEndpoint ? SELECTED_EDGE_Z_INDEX : void 0,
        className: [edge.className, hasInternalRuntimeEndpoint ? "shader-edge-internal-runtime-endpoint" : ""].filter(Boolean).join(" "),
        data: {
          ...edge.data,
          weight: edge.data?.weight ?? 1,
          mode: edge.data?.mode ?? "set",
          enabled: edge.data?.enabled !== false,
          isIncidentToDisabledNode: disabledNodeIds.has(edge.source) || disabledNodeIds.has(edge.target),
          onWeightChange: updateEdgeWeight,
          onModeChange: updateEdgeMode,
          onEnabledChange: updateEdgeEnabled,
          onInsertNode: insertNodeOnEdge,
          onReconnect,
          onReconnectStart,
          onReconnectEnd,
          isReconnecting: edge.id === reconnectingEdgeId,
          showLinkControls: edge.selected === true && selectedEdgeCount === 1,
          isConnectedToSelectedNode,
          isDimmedBySelection: hasHighlightedLinks && !isHighlighted
        }
      };
    });
  }, [edges, insertNodeOnEdge, nodes, routingSelection, onReconnect, onReconnectStart, onReconnectEnd, reconnectingEdgeId, updateEdgeEnabled, updateEdgeMode, updateEdgeWeight]);
  const materializedGraph = useMemo5(
    () => materializeRootGraph(nodesWithCallbacks, edgesWithCallbacks, areas, editingStack, patchName),
    [areas, edgesWithCallbacks, editingStack, nodesWithCallbacks, patchName]
  );
  const isEditingSubpatch = editingStack.length > 0;
  const canGroupSelection = useMemo5(() => nodes.some((node) => node.selected) && nodes.filter((node) => node.selected).every((node) => node.data.patchNode.type !== null), [nodes]);
  const canScaleSelection = selectedNodeCount > 0;
  const patch = useMemo5(() => ({
    ...patchFromFlow(materializedGraph.nodes, materializedGraph.edges, editingStack.length === 0 ? areas : editingStack[0]?.parentAreas),
    name: rootPatchName,
    ...hosted?.getDocument().schemaVersion ? { schemaVersion: 1 } : {},
    ...selectedMidiInputDeviceIds.length > 0 || selectedMidiOutputDeviceIds.length > 0 || midiClockOutputEnabled ? { midiInput: {
      selectedDeviceIds: selectedMidiInputDeviceIds,
      ...selectedMidiOutputDeviceIds.length > 0 ? { selectedOutputDeviceIds: selectedMidiOutputDeviceIds } : {},
      ...midiClockOutputEnabled ? { sendClock: true } : {}
    } } : {}
  }), [areas, editingStack, materializedGraph, midiClockOutputEnabled, rootPatchName, selectedMidiInputDeviceIds, selectedMidiOutputDeviceIds]);
  const hostedInitialViewRef = useRef7(false);
  useEffect6(() => {
    if (hosted && !hostedInitialViewRef.current) {
      hostedInitialViewRef.current = true;
      return;
    }
    if (hosted) void hosted.edit(retainNestedBufferReferences({ ...patch, ...Object.keys(bufferAssets).length ? { buffers: bufferAssets } : {} }, hosted.getDocument()));
  }, [hosted, patch, bufferAssets]);
  const fm1LiveState = useFm1LiveEdit(patch, fm1Mode && fm1Live, fm1Preset, () => setFm1Live(false));
  fm1BusyRef.current = fm1LiveState.busy;
  const trimmedRootPatchName = rootPatchName.trim();
  const selectedLocalPatch = localPatchLibrary?.patches.find((entry) => entry.name === localPatchLibrary.selectedPatchName) ?? null;
  const selectedSample = sampleLibrary?.samples.find((sample) => sample.url === sampleLibrary.selectedUrl) ?? null;
  const selectedImage = imageLibrary?.images.find((image) => image.url === imageLibrary.selectedUrl) ?? null;
  const selectedSubpatchCandidate = subpatchImportModal?.candidates.find((candidate) => candidate.key === subpatchImportModal.selectedKey) ?? null;
  const selectedLocalSubpatch = localSubpatchImport?.subpatches.find((entry) => entry.name === localSubpatchImport.selectedSubpatchName) ?? null;
  const dspPatch = useMemo5(() => stripPatchForDsp(patch), [patch]);
  const liveDspPatch = useMemo5(() => patchWithMidiControlVisuals(dspPatch, midiControlVisuals), [dspPatch, midiControlVisuals]);
  const dspPatchKey = useMemo5(() => patchToDspKey(liveDspPatch), [liveDspPatch]);
  const audioGraph = useMemo5(() => {
    const prepared = preparePatch(liveDspPatch);
    const program = "program" in prepared ? prepared.program : compilePatchToDspProgram({ nodes: [], links: [] });
    return { ...program, errors: [.../* @__PURE__ */ new Set([...program.errors, ...prepared.diagnostics.filter((d) => d.severity === "error").map((d) => d.message)])] };
  }, [dspPatchKey]);
  const preservedBufferNodeIds = useMemo5(() => preservedBufferIds(audioGraph), [audioGraph]);
  const referencedBufferAssets = useMemo5(() => filterBufferAssets(bufferAssets, preservedBufferNodeIds), [bufferAssets, preservedBufferNodeIds]);
  const persistedEditorStateJson = useMemo5(() => {
    const state = flowToEditorState(materializedGraph.nodes, materializedGraph.edges, {
      patchName: rootPatchName,
      viewport: viewportRef.current,
      fm1Mode,
      ...selectedMidiInputDeviceIds.length > 0 || selectedMidiOutputDeviceIds.length > 0 || midiClockOutputEnabled ? { midiInput: {
        selectedDeviceIds: selectedMidiInputDeviceIds,
        ...selectedMidiOutputDeviceIds.length > 0 ? { selectedOutputDeviceIds: selectedMidiOutputDeviceIds } : {},
        ...midiClockOutputEnabled ? { sendClock: true } : {}
      } } : {}
    });
    state.areas = areas;
    state.buffers = referencedBufferAssets;
    return JSON.stringify(state);
  }, [areas, fm1Mode, materializedGraph, midiClockOutputEnabled, referencedBufferAssets, rootPatchName, selectedMidiInputDeviceIds, selectedMidiOutputDeviceIds]);
  persistedEditorStateJsonRef.current = persistedEditorStateJson;
  const dspDiagnostics = useMemo5(
    () => classifyDspErrors(audioGraph.errors, dspPatch),
    [audioGraph, dspPatchKey]
  );
  const monitorLinkIdByNode = useMemo5(() => {
    const linkIdsByNode = /* @__PURE__ */ new Map();
    for (const nodeId of Object.keys(audioGraph.monitorIds)) {
      linkIdsByNode.set(nodeId, nodeId);
    }
    return linkIdsByNode;
  }, [audioGraph]);
  const activeDspGroupIds = useMemo5(() => editingStack.map((frame) => frame.groupId), [editingStack]);
  const nodesWithGroupUi = useMemo5(() => nodesWithCallbacks.map((node) => {
    const groupNode = node.data.patchNode;
    if (groupNode.type !== "Group" || !groupNode.subpatch) return node;
    const layout = groupUiPreviewLayout(groupNode.subpatch);
    if (!layout) return node;
    const previewNodes = layout.nodes.map((innerNode) => {
      const previewId = `__group_ui__${node.id}__${innerNode.id}`;
      const override = groupNode.subpatchUiOverrides?.[innerNode.id];
      const effectiveParams = { ...innerNode.params, ...override?.params };
      const effectiveInnerNode = {
        ...innerNode,
        params: effectiveParams,
        ...override?.customWave ? { customWave: normalizeCustomWave(override.customWave, effectiveParams) } : {}
      };
      const dspNodeId = scopedDspNodeId(innerNode.id, [...activeDspGroupIds, node.id]);
      const monitorLinkId = monitorLinkIdByNode.get(dspNodeId);
      const midiControlVisual = midiControlVisuals[previewId];
      const data = {
        ...nodeCallbacksPlaceholder(),
        patchNode: { ...effectiveInnerNode, id: previewId, position: void 0, params: { ...effectiveParams, ...hostedTransient[dspNodeId] } },
        isCanvasLocked: canvasLocked,
        canvasZoom: settledGraphZoom,
        isAreaUiCollapsedPresentation: true,
        isTypePickerOpen: false,
        ...innerNode.type === "MidiNote" || innerNode.type === "MidiNoteOn" || innerNode.type === "MidiNoteOff" || innerNode.type === "MidiCc" || innerNode.type === "Slider" || innerNode.type === "Joystick" || innerNode.type === "Button" || innerNode.type === "Tempo" ? {
          midiInput: audio.midiInput,
          onMidiInputRefresh: audio.refreshMidiInputDevices
        } : {},
        onParamChange: (_previewNodeId, port, value) => sendHostedGesture(dspNodeId, innerNode.type, { [port]: value }) || updateGroupUiNodeOverride(
          node.id,
          innerNode.id,
          `param:${innerNode.id}:${port}`,
          (current) => ({ ...current, params: { ...current.params, [port]: value } })
        ),
        onParamsChange: (_previewNodeId, values) => sendHostedGesture(dspNodeId, innerNode.type, values) || updateGroupUiNodeOverride(
          node.id,
          innerNode.id,
          `params:${innerNode.id}`,
          (current) => ({ ...current, params: { ...current.params, ...values } })
        ),
        onCustomWaveChange: (_previewNodeId, customWave, historyKey) => updateGroupUiNodeOverride(
          node.id,
          innerNode.id,
          historyKey ?? `custom-wave:${innerNode.id}`,
          (current) => ({ ...current, customWave: normalizeCustomWave(customWave, { ...innerNode.params, ...current.params }) })
        ),
        onHeaderDoubleClick: () => resetGroupUiNodeOverride(node.id, innerNode.id),
        ...monitorLinkId && innerNode.type === "Meter" ? { audioMeter: audio.linkMeters[monitorLinkId] } : {},
        ...monitorLinkId && innerNode.type === "Scope" ? { audioScope: audio.linkScopes[dspNodeId] } : {},
        ...monitorLinkId && innerNode.type === "FFT" ? { audioSpectrum: audio.linkScopes[dspNodeId] } : {},
        // Meter messages can arrive just after playback stops. Do not let that
        // stale runtime reading mask the saved control value while offline.
        ...audio.status === "running" && monitorLinkId && innerNode.type === "Slider" ? { audioSliderValue: audio.linkMeters[monitorLinkId]?.output } : {},
        ...midiControlVisual?.sliderValue !== void 0 ? { midiSliderValue: midiControlVisual.sliderValue } : {},
        ...midiControlVisual?.joystickX !== void 0 || midiControlVisual?.joystickY !== void 0 ? {
          midiJoystickPosition: {
            ...midiControlVisual.joystickX !== void 0 ? { x: midiControlVisual.joystickX } : {},
            ...midiControlVisual.joystickY !== void 0 ? { y: midiControlVisual.joystickY } : {}
          }
        } : {},
        ...midiControlVisual?.buttonPressed !== void 0 ? { midiButtonPressed: midiControlVisual.buttonPressed } : {},
        ...monitorLinkId && (innerNode.type === "Sequencer" || innerNode.type === "Roll") ? { audioSequencerStep: audio.linkMeters[monitorLinkId]?.output } : {},
        ...innerNode.type === "CustomWave" || innerNode.type === "SamplePlayer" ? { audioPlayheads: audio.playheads[dspNodeId] } : {},
        ...innerNode.type === "CustomWave" ? { audioCustomWaveFrequency: audio.linkMeters[`${dspNodeId}:frequency`]?.input } : {},
        ...innerNode.type === "Buffer" ? { audioBuffer: audio.buffers[dspNodeId] } : {},
        ...innerNode.type === "Buffer" && (!hosted || hosted.capabilities.bufferMutation) ? { onBufferClear: () => clearBufferRecording(dspNodeId) } : {},
        ...innerNode.type === "SamplePlayer" ? { audioSampleParams: samplePlayerVisualizationParams(dspNodeId, audio.linkMeters) } : {}
      };
      return {
        id: previewId,
        position: {
          x: (innerNode.position?.x ?? 0) - layout.position.x,
          y: (innerNode.position?.y ?? 0) - layout.position.y
        },
        data
      };
    });
    return {
      ...node,
      data: { ...node.data, groupUiPreview: { width: layout.size.width, height: layout.size.height, nodes: previewNodes } }
    };
  }), [
    hostedTransient,
    sendHostedGesture,
    activeDspGroupIds,
    audio.buffers,
    audio.midiInput,
    audio.refreshMidiInputDevices,
    clearBufferRecording,
    audio.linkMeters,
    audio.linkScopes,
    audio.playheads,
    audio.status,
    canvasLocked,
    midiControlVisuals,
    monitorLinkIdByNode,
    nodesWithCallbacks,
    settledGraphZoom,
    resetGroupUiNodeOverride,
    updateGroupUiNodeOverride
  ]);
  const renderedNodes = useMemo5(() => {
    const nextNodes = nodesWithGroupUi.map((sourceNode) => {
      const dspNodeId = runtimeDspNodeIdForFlowNode(sourceNode, nodesWithGroupUi, activeDspGroupIds);
      const node = hostedTransient[dspNodeId] ? { ...sourceNode, data: { ...sourceNode.data, patchNode: { ...sourceNode.data.patchNode, params: { ...sourceNode.data.patchNode.params, ...hostedTransient[dspNodeId] } } } } : sourceNode;
      const monitorLinkId = monitorLinkIdByNode.get(dspNodeId);
      const audioOutputLeft = audio.linkMeters[`${dspNodeId}:left`]?.output ?? 0;
      const audioOutputRight = audio.linkMeters[`${dspNodeId}:right`]?.output ?? 0;
      const dspErrors = dspDiagnostics.nodeErrors.get(dspNodeId) ?? [];
      const hasAudioMonitor = Boolean(monitorLinkId);
      const hasAudioOutputMeter = node.data.patchNode.type === "AudioOut";
      const midiControlVisual = midiControlVisuals[node.id];
      const audioSelectorIndex = node.data.patchNode.type === "Selector" ? audio.linkMeters[`${dspNodeId}:selector`]?.output : void 0;
      const audioAccumulatorValue = node.data.patchNode.type === "Accumulator" ? audio.linkMeters[`${dspNodeId}:accumulator`]?.output : void 0;
      const audioImageX = node.data.patchNode.type === "Image" ? audio.linkMeters[`${dspNodeId}:image-x`]?.output : void 0;
      const audioImageY = node.data.patchNode.type === "Image" ? audio.linkMeters[`${dspNodeId}:image-y`]?.output : void 0;
      const audioImagePosition = typeof audioImageX === "number" && typeof audioImageY === "number" ? { x: audioImageX, y: audioImageY } : void 0;
      const showsPlaybackVisual = node.data.patchNode.type === "CustomWave" || node.data.patchNode.type === "SamplePlayer";
      const audioPlayheads = showsPlaybackVisual ? audio.playheads[dspNodeId] : void 0;
      const showsBufferVisual = node.data.patchNode.type === "Buffer";
      const audioBuffer = showsBufferVisual ? audio.buffers[dspNodeId] : void 0;
      const audioSampleParams = node.data.patchNode.type === "SamplePlayer" ? samplePlayerVisualizationParams(dspNodeId, audio.linkMeters) : void 0;
      if (!hasAudioMonitor && !hasAudioOutputMeter && audioSelectorIndex === void 0 && audioAccumulatorValue === void 0 && !audioImagePosition && !midiControlVisual && dspErrors.length === 0 && !showsPlaybackVisual && !showsBufferVisual) return node;
      return {
        ...node,
        data: {
          ...node.data,
          ...dspErrors.length > 0 ? { dspErrors } : {},
          ...hasAudioOutputMeter ? { audioOutputMeter: { left: audioOutputLeft, right: audioOutputRight } } : {},
          ...monitorLinkId && node.data.patchNode.type === "Meter" ? { audioMeter: audio.linkMeters[monitorLinkId] } : {},
          ...monitorLinkId && node.data.patchNode.type === "Scope" ? { audioScope: audio.linkScopes[dspNodeId] } : {},
          ...monitorLinkId && node.data.patchNode.type === "FFT" ? { audioSpectrum: audio.linkScopes[dspNodeId] } : {},
          ...audio.status === "running" && monitorLinkId && node.data.patchNode.type === "Slider" ? { audioSliderValue: audio.linkMeters[monitorLinkId]?.output } : {},
          ...audioSelectorIndex !== void 0 ? { audioSelectorIndex } : {},
          ...audioAccumulatorValue !== void 0 ? { audioAccumulatorValue } : {},
          ...audioImagePosition ? { audioImagePosition } : {},
          ...monitorLinkId && (node.data.patchNode.type === "Sequencer" || node.data.patchNode.type === "Roll") ? { audioSequencerStep: audio.linkMeters[monitorLinkId]?.output } : {},
          ...audioPlayheads !== void 0 ? { audioPlayheads } : {},
          ...node.data.patchNode.type === "CustomWave" ? { audioCustomWaveFrequency: audio.linkMeters[`${dspNodeId}:frequency`]?.input } : {},
          ...audioBuffer !== void 0 ? { audioBuffer } : {},
          ...showsBufferVisual && (!hosted || hosted.capabilities.bufferMutation) ? { onBufferClear: () => clearBufferRecording(dspNodeId) } : {},
          ...audioSampleParams ? { audioSampleParams } : {},
          ...midiControlVisual?.sliderValue !== void 0 ? { midiSliderValue: midiControlVisual.sliderValue } : {},
          ...midiControlVisual?.joystickX !== void 0 || midiControlVisual?.joystickY !== void 0 ? {
            midiJoystickPosition: {
              ...midiControlVisual.joystickX !== void 0 ? { x: midiControlVisual.joystickX } : {},
              ...midiControlVisual.joystickY !== void 0 ? { y: midiControlVisual.joystickY } : {}
            }
          } : {},
          ...midiControlVisual?.buttonPressed !== void 0 ? { midiButtonPressed: midiControlVisual.buttonPressed } : {}
        }
      };
    });
    const reconciledNodes = reuseUnchangedNodePresentations(renderedNodeCacheRef.current, nextNodes);
    renderedNodeCacheRef.current = reconciledNodes;
    return reconciledNodes;
  }, [hostedTransient, activeDspGroupIds, audio.buffers, audio.linkMeters, audio.linkScopes, audio.playheads, audio.status, clearBufferRecording, dspDiagnostics, midiControlVisuals, monitorLinkIdByNode, nodesWithGroupUi]);
  const renderedEdges = useMemo5(() => {
    const edgeById = new Map(edgesWithCallbacks.map((edge) => [edge.id, edge]));
    const midpoint = (edge, visited = /* @__PURE__ */ new Set()) => {
      if (visited.has(edge.id)) return null;
      const sourceNode = reactFlow?.getInternalNode(edge.source);
      const sourceHandle = sourceNode?.internals.handleBounds?.source?.find((handle) => handle.id === edge.sourceHandle);
      const parent = edge.data?.modulatesEdgeId ? edgeById.get(edge.data.modulatesEdgeId) : void 0;
      const parentPoint = parent ? midpoint(parent, /* @__PURE__ */ new Set([...visited, edge.id])) : null;
      const targetNode = reactFlow?.getInternalNode(edge.target);
      const targetHandle = targetNode?.internals.handleBounds?.target?.find((handle) => handle.id === edge.targetHandle);
      if (sourceNode && sourceHandle && (parentPoint || targetNode && targetHandle)) {
        const [, x, y] = getShaderEdgePath({
          source: edge.source,
          target: edge.target,
          data: edge.data,
          sourceX: sourceNode.internals.positionAbsolute.x + sourceHandle.x + sourceHandle.width / 2,
          sourceY: sourceNode.internals.positionAbsolute.y + sourceHandle.y + sourceHandle.height / 2,
          sourcePosition: sourceHandle.position,
          targetX: parentPoint?.x ?? targetNode.internals.positionAbsolute.x + targetHandle.x + targetHandle.width / 2,
          targetY: parentPoint?.y ?? targetNode.internals.positionAbsolute.y + targetHandle.y + targetHandle.height / 2,
          targetPosition: parentPoint ? Position3.Left : targetHandle.position
        });
        return { x, y };
      }
      const source = nodes.find((node) => node.id === edge.source);
      const target = nodes.find((node) => node.id === edge.target);
      return source && target ? { x: (source.position.x + target.position.x) / 2, y: (source.position.y + target.position.y) / 2 } : null;
    };
    return [...edgesWithCallbacks.map((edge) => {
      const dspErrors = dspDiagnostics.edgeErrors.get(edge.id) ?? [];
      const targetPoint = edge.data?.modulatesEdgeId ? midpoint(edgeById.get(edge.data.modulatesEdgeId) ?? edge) : null;
      if (dspErrors.length === 0 && edge.id !== weightTargetEdgeId && !targetPoint) return edge;
      return {
        ...edge,
        data: {
          ...edge.data,
          ...dspErrors.length > 0 ? { dspErrors } : {},
          isWeightTarget: edge.id === weightTargetEdgeId,
          ...targetPoint ? { visualTarget: targetPoint } : {}
        }
      };
    }), ...routingSelection.pairs.map(([source, target]) => ({
      id: `virtual-route:${JSON.stringify([source, target])}`,
      type: "virtualRoute",
      source,
      target,
      sourceHandle: "virtual:send",
      targetHandle: "virtual:receive",
      selectable: false,
      deletable: false,
      reconnectable: false,
      focusable: false,
      style: {
        pointerEvents: "none",
        color: routingNodeColor(nodes.find((node) => node.id === source)?.data.patchNode.params.number)
      }
    }))];
  }, [dspDiagnostics, edgesWithCallbacks, reactFlow, routingSelection, nodes, nodesInitialized, weightTargetEdgeId]);
  const collapsedAreaByNode = useMemo5(() => {
    const collapsedAreas = areas.filter((area) => area.collapsed);
    return new Map(renderedNodes.flatMap((node) => {
      const area = innermostAreaContainingNode(collapsedAreas, node);
      return area ? [[node.id, area]] : [];
    }));
  }, [areas, renderedNodes]);
  const collapsedUiAreaByNode = useMemo5(() => new Map(renderedNodes.flatMap((node) => {
    const area = collapsedAreaByNode.get(node.id);
    return area && (nodeIsInAreaUiSection(area, node) || area.kind === "spread" && area.spreadNodeId === node.id) ? [[node.id, area]] : [];
  })), [collapsedAreaByNode, renderedNodes]);
  const collapsedRenderedNodes = useMemo5(() => renderedNodes.map((node) => collapsedAreaByNode.has(node.id) && !collapsedUiAreaByNode.has(node.id) ? {
    ...node,
    selected: false,
    draggable: false,
    selectable: false,
    connectable: false,
    data: { ...node.data, isAreaCollapsedPresentation: true }
  } : collapsedUiAreaByNode.has(node.id) ? {
    ...node,
    selected: false,
    draggable: false,
    selectable: false,
    connectable: node.data.patchNode.type === "Spread" || node.data.patchNode.type === "Spawn",
    // React Flow disables pointer events when a node is neither selectable nor
    // draggable. This presentation is intentionally canvas-locked, but its
    // surfaced controls must remain operable.
    style: { ...node.style, pointerEvents: "all" },
    data: { ...node.data, isAreaUiCollapsedPresentation: true }
  } : node), [collapsedAreaByNode, collapsedUiAreaByNode, renderedNodes]);
  const collapsedRenderedEdges = useMemo5(() => renderedEdges.flatMap((edge) => {
    const containedSourceArea = collapsedAreaByNode.get(edge.source);
    const containedTargetArea = collapsedAreaByNode.get(edge.target);
    if (containedSourceArea?.kind === "spread" && containedSourceArea.spreadNodeId === edge.source && containedSourceArea.id === containedTargetArea?.id) {
      return [];
    }
    if (containedTargetArea?.kind === "spread" && containedTargetArea.spreadNodeId === edge.target && containedTargetArea.id === containedSourceArea?.id) {
      return [];
    }
    const sourceArea = containedSourceArea?.kind === "spread" && containedSourceArea.spreadNodeId === edge.source ? void 0 : containedSourceArea;
    const targetArea = containedTargetArea?.kind === "spread" && containedTargetArea.spreadNodeId === edge.target ? void 0 : containedTargetArea;
    if (sourceArea && sourceArea.id === targetArea?.id) return [];
    if (!sourceArea && !targetArea) return [edge];
    return [{
      ...edge,
      reconnectable: false,
      data: {
        ...edge.data,
        isAreaCollapsedPresentation: true,
        weight: edge.data?.weight ?? 1,
        mode: edge.data?.mode ?? "set",
        enabled: edge.data?.enabled !== false,
        onWeightChange: edge.data?.onWeightChange ?? updateEdgeWeightPlaceholder,
        onModeChange: edge.data?.onModeChange ?? updateEdgeModePlaceholder,
        onInsertNode: edge.data?.onInsertNode ?? insertNodeOnEdgePlaceholder,
        showLinkControls: false,
        ...sourceArea ? { visualSource: collapsedAreaOutputPin(sourceArea) } : {},
        ...targetArea ? { visualTarget: collapsedAreaInputPin(targetArea) } : {}
      }
    }];
  }), [collapsedAreaByNode, renderedEdges]);
  const duplicateDragPreview = useMemo5(() => {
    if (!duplicateDrag?.duplicating) return null;
    const idMap = new Map([...duplicateDrag.nodeIds].map((nodeId) => [nodeId, duplicatePreviewNodeId(nodeId)]));
    const previewNodes = renderedNodes.filter((node) => duplicateDrag.nodeIds.has(node.id)).map((node) => {
      const id = idMap.get(node.id) ?? duplicatePreviewNodeId(node.id);
      const position = duplicateDrag.currentPositions[node.id] ?? node.position;
      return {
        ...node,
        id,
        position,
        draggable: false,
        selectable: false,
        connectable: false,
        deletable: false,
        className: ["shader-node-preview", node.className ?? ""].filter(Boolean).join(" "),
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            id: node.data.patchNode.id,
            params: { ...node.data.patchNode.params },
            position
          },
          ...nodeCallbacksPlaceholder(),
          isTypePickerOpen: false
        }
      };
    });
    const previewEdges = renderedEdges.flatMap((edge) => {
      const link = linkFromEdge(edge);
      if (!link) return [];
      const fromSelected = duplicateDrag.nodeIds.has(link.from.node);
      const toSelected = duplicateDrag.nodeIds.has(link.to.node);
      if (!fromSelected && !toSelected) return [];
      if (fromSelected !== toSelected && !duplicateDrag.linkExternal) return [];
      const fromNode = idMap.get(link.from.node) ?? link.from.node;
      const toNode = idMap.get(link.to.node) ?? link.to.node;
      if (fromNode === link.from.node && toNode === link.to.node) return [];
      return [{
        ...edgeFromLink({
          from: { ...link.from, node: fromNode },
          to: { ...link.to, node: toNode },
          weight: link.weight,
          mode: link.mode,
          enabled: link.enabled,
          weightModulations: link.weightModulations
        }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
        selectable: false,
        deletable: false,
        className: "shader-edge shader-edge-preview"
      }];
    });
    return { nodes: previewNodes, edges: previewEdges };
  }, [duplicateDrag, renderedEdges, renderedNodes]);
  const areaDuplicatePreview = useMemo5(() => {
    if (!areaDuplicateDrag?.duplicating) return null;
    const sourceAreaIds = new Set(Object.keys(areaDuplicateDrag.areaPositions));
    const sourceNodeIds = new Set(Object.keys(areaDuplicateDrag.nodePositions));
    const nodeIdMap = new Map([...sourceNodeIds].map((nodeId) => [nodeId, duplicatePreviewNodeId(nodeId)]));
    const nodes2 = collapsedRenderedNodes.filter((node) => sourceNodeIds.has(node.id)).map((node) => {
      const id = nodeIdMap.get(node.id) ?? duplicatePreviewNodeId(node.id);
      const position = areaDuplicateDrag.currentNodePositions[node.id] ?? node.position;
      return {
        ...node,
        id,
        position,
        draggable: false,
        selectable: false,
        connectable: false,
        deletable: false,
        className: ["shader-node-preview", node.className ?? ""].filter(Boolean).join(" "),
        data: {
          ...node.data,
          patchNode: { ...node.data.patchNode, position },
          ...nodeCallbacksPlaceholder(),
          isTypePickerOpen: false
        }
      };
    });
    const edges2 = renderedEdges.flatMap((edge) => {
      const link = linkFromEdge(edge);
      if (!link) return [];
      const fromSelected = sourceNodeIds.has(link.from.node);
      const toSelected = sourceNodeIds.has(link.to.node);
      if (!fromSelected && !toSelected) return [];
      if (fromSelected !== toSelected && !areaDuplicateDrag.linkExternal) return [];
      const fromNode = nodeIdMap.get(link.from.node) ?? link.from.node;
      const toNode = nodeIdMap.get(link.to.node) ?? link.to.node;
      if (fromNode === link.from.node && toNode === link.to.node) return [];
      return [{
        ...edgeFromLink({
          from: { ...link.from, node: fromNode },
          to: { ...link.to, node: toNode },
          weight: link.weight,
          mode: link.mode,
          enabled: link.enabled,
          weightModulations: link.weightModulations
        }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
        selectable: false,
        deletable: false,
        className: "shader-edge shader-edge-preview"
      }];
    });
    const previewAreas = areas.filter((area) => sourceAreaIds.has(area.id)).map((area) => ({
      ...area,
      id: `${DUPLICATE_AREA_PREVIEW_PREFIX}${area.id}`,
      position: areaDuplicateDrag.currentAreaPositions[area.id] ?? area.position,
      ...area.spreadNodeId ? { spreadNodeId: nodeIdMap.get(area.spreadNodeId) ?? area.spreadNodeId } : {}
    }));
    return { areas: previewAreas, nodes: nodes2, edges: edges2 };
  }, [areaDuplicateDrag, areas, collapsedRenderedNodes, renderedEdges]);
  const draftNodePreview = useMemo5(() => {
    if (!draftNodeConnection?.modifierActive || !reactFlow) return null;
    const position = draftNodePosition(draftNodeConnection, reactFlow);
    const link = linkForDraftNodeConnection(draftNodeConnection, DRAFT_NODE_PREVIEW_ID);
    if (!link) return null;
    const node = {
      id: DRAFT_NODE_PREVIEW_ID,
      type: "shaderNode",
      position,
      draggable: false,
      selectable: false,
      connectable: false,
      deletable: false,
      className: "shader-node-preview",
      data: {
        patchNode: {
          id: "new",
          type: null,
          params: {},
          position
        },
        ...nodeCallbacksPlaceholder(),
        isTypePickerOpen: false
      }
    };
    return {
      node,
      edge: {
        ...edgeFromLink(link, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
        id: `preview:${edgeId(link)}`,
        selectable: false,
        deletable: false,
        className: "shader-edge shader-edge-preview"
      }
    };
  }, [draftNodeConnection, reactFlow]);
  const displayNodes = useMemo5(() => [
    ...collapsedRenderedNodes,
    ...duplicateDragPreview?.nodes ?? [],
    ...areaDuplicatePreview?.nodes ?? [],
    ...draftNodePreview ? [draftNodePreview.node] : []
  ], [areaDuplicatePreview, collapsedRenderedNodes, draftNodePreview, duplicateDragPreview]);
  const displayEdges = useMemo5(() => canvasLocked ? [] : [
    ...collapsedRenderedEdges,
    ...duplicateDragPreview?.edges ?? [],
    ...areaDuplicatePreview?.edges ?? [],
    ...reconnectPreviewEdge ? [reconnectPreviewEdge] : [],
    ...draftNodePreview ? [draftNodePreview.edge] : []
  ], [areaDuplicatePreview, canvasLocked, collapsedRenderedEdges, draftNodePreview, duplicateDragPreview, reconnectPreviewEdge]);
  const panTranslateExtent = useMemo5(
    () => translateExtentForVisibleContent(renderedNodes, settledViewport, editorSize),
    [editorSize, renderedNodes, settledViewport.zoom]
  );
  useEffect6(() => {
    if (!hosted) audio.syncGraph(audioGraph);
  }, [audio.syncGraph, audioGraph]);
  const checkpointPreservedBuffers = useCallback3(() => {
    if (hosted) return Promise.resolve(bufferAssetsRef.current);
    if (bufferCheckpointRef.current) return bufferCheckpointRef.current;
    const loadGeneration = bufferLoadGenerationRef.current;
    const checkpoint = (async () => {
      const nextAssets = filterBufferAssets(bufferAssetsRef.current, preservedBufferIds(audioGraph));
      await Promise.all([...preservedBufferIds(audioGraph)].map(async (nodeId) => {
        const snapshot = await audio.captureBuffer(nodeId);
        if (snapshot) nextAssets[nodeId] = await storeBufferSnapshot(snapshot);
      }));
      if (bufferLoadGenerationRef.current !== loadGeneration) return bufferAssetsRef.current;
      replaceBufferAssets(nextAssets);
      await removeUnreferencedBufferContents(Object.values(nextAssets).map((asset) => asset.hash));
      return nextAssets;
    })().finally(() => {
      bufferCheckpointRef.current = null;
    });
    bufferCheckpointRef.current = checkpoint;
    return checkpoint;
  }, [audio.captureBuffer, audioGraph, replaceBufferAssets]);
  useEffect6(() => {
    if (hosted || audio.status !== "running" || preservedBufferNodeIds.size === 0) return;
    const interval = window.setInterval(() => {
      void checkpointPreservedBuffers().catch(() => void 0);
    }, BUFFER_CHECKPOINT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [audio.status, checkpointPreservedBuffers, preservedBufferNodeIds]);
  const previousAudioStatusRef = useRef7(audio.status);
  useEffect6(() => {
    const previousStatus = previousAudioStatusRef.current;
    previousAudioStatusRef.current = audio.status;
    if (!hosted && previousStatus === "running" && audio.status !== "running" && preservedBufferNodeIds.size > 0) {
      void checkpointPreservedBuffers().catch(() => void 0);
    }
  }, [audio.status, checkpointPreservedBuffers, preservedBufferNodeIds]);
  useEffect6(() => {
    if (hosted) return;
    const checkpointWhenHidden = () => {
      if (document.visibilityState === "hidden" && preservedBufferNodeIds.size > 0) {
        void checkpointPreservedBuffers().catch(() => void 0);
      }
    };
    document.addEventListener("visibilitychange", checkpointWhenHidden);
    return () => document.removeEventListener("visibilitychange", checkpointWhenHidden);
  }, [checkpointPreservedBuffers, preservedBufferNodeIds]);
  useEffect6(() => {
    if (!reactFlow || !isFiniteCoordinateExtent(panTranslateExtent)) return;
    const clampedViewport = clampViewportToTranslateExtent(settledViewport, panTranslateExtent, editorSize);
    if (clampedViewport.x === settledViewport.x && clampedViewport.y === settledViewport.y && clampedViewport.zoom === settledViewport.zoom) {
      return;
    }
    viewportRef.current = clampedViewport;
    setSettledViewport(clampedViewport);
    if (!hosted) storeViewport(clampedViewport);
    void reactFlow.setViewport(clampedViewport);
  }, [editorSize, panTranslateExtent, reactFlow, settledViewport]);
  useEffect6(() => {
    const scopeRequests = nodesWithCallbacks.flatMap((node) => {
      const type = node.data.patchNode.type;
      if (type !== "Scope" && type !== "FFT") return [];
      const hasConnectedOutput = edges.some((edge) => edge.source === node.id && edge.data?.enabled !== false);
      if (node.id !== fullscreenScopeId && !isNodeVisibleInViewport(node, settledViewport, editorSize) && (type === "Scope" || !hasConnectedOutput)) return [];
      const dspNodeId = runtimeDspNodeIdForFlowNode(node, nodesWithCallbacks, activeDspGroupIds);
      const linkId = monitorLinkIdByNode.get(dspNodeId);
      if (!linkId) return [];
      return type === "FFT" ? [{ id: dspNodeId, length: 0.012, points: 512 }] : [{
        id: dspNodeId,
        length: node.data.patchNode.params.length ?? 0.08,
        ...node.id === fullscreenScopeId ? { points: 512 } : {},
        reset: Math.round(node.data.patchNode.params.reset ?? 1) === 1 ? "zero-crossing" : "none"
      }];
    });
    audio.setLinkScopes(scopeRequests);
  }, [activeDspGroupIds, audio.setLinkScopes, editorSize, edges, fullscreenScopeId, monitorLinkIdByNode, nodesWithCallbacks, settledViewport]);
  useEffect6(() => {
    if (!hosted) window.localStorage.setItem(STORAGE_KEY, persistedEditorStateJson);
  }, [persistedEditorStateJson]);
  useEffect6(() => {
    if (hosted) return;
    const persistLatestEditorState = () => {
      const json = persistedEditorStateJsonRef.current;
      if (json !== null) window.localStorage.setItem(STORAGE_KEY, json);
      storeViewport(viewportRef.current);
    };
    window.addEventListener("pagehide", persistLatestEditorState);
    return () => window.removeEventListener("pagehide", persistLatestEditorState);
  }, []);
  const applyNodeChangesNow = useCallback3((changes) => {
    if (changes.length === 0) return;
    if (canvasLocked) return;
    const movedIds = new Set(changes.filter((change) => change.type === "position").map((change) => change.id));
    const appendixChanges = [];
    for (const appendix of routingAppendicesRef.current) {
      if (movedIds.has(appendix.id)) continue;
      const ownerChange = changes.find((change) => change.type === "position" && change.id === appendix.ownerId);
      if (ownerChange?.type !== "position" || !ownerChange.position) continue;
      appendixChanges.push({
        id: appendix.id,
        type: "position",
        position: {
          x: ownerChange.position.x + appendix.offset.x,
          y: ownerChange.position.y + appendix.offset.y
        },
        dragging: ownerChange.dragging
      });
    }
    changes = [...changes, ...appendixChanges];
    const duplicateState = duplicateDragRef.current;
    if (duplicateState?.duplicating) {
      updateDuplicateDrag(syncDuplicateDragPositionsFromChanges(duplicateState, changes));
      setNodes((current) => applyNodeChanges(
        anchorDuplicatedNodePositionChanges(changes, duplicateState.originalPositions),
        current
      ));
      return;
    }
    if (changes.some((change) => change.type === "position" && change.dragging === false)) {
      commitHistory("node-position");
    }
    const removedNodeIds = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id));
    if (removedNodeIds.size > 0) {
      commitHistory();
      setEdges((current) => current.map((edge) => {
        const modulations = edge.data?.weightModulations;
        if (!modulations?.some((modulation) => removedNodeIds.has(modulation.from.node))) return edge;
        return {
          ...edge,
          data: {
            ...edge.data,
            weightModulations: modulations.filter((modulation) => !removedNodeIds.has(modulation.from.node))
          }
        };
      }));
    }
    setNodes((current) => restoreNodeSelectionAfterDeselectedDrag(
      applyNodeChanges(changes, current),
      activeNodeDragSelectionRef.current
    ));
  }, [canvasLocked, commitHistory, updateDuplicateDrag]);
  const flushQueuedNodeDragChanges = useCallback3(() => {
    if (nodeDragAnimationFrameRef.current !== null) {
      cancelAnimationFrame(nodeDragAnimationFrameRef.current);
      nodeDragAnimationFrameRef.current = null;
    }
    const changes = [...pendingNodeDragChangesRef.current.values()];
    pendingNodeDragChangesRef.current.clear();
    applyNodeChangesNow(changes);
  }, [applyNodeChangesNow]);
  useEffect6(() => () => {
    if (nodeDragAnimationFrameRef.current !== null) {
      cancelAnimationFrame(nodeDragAnimationFrameRef.current);
    }
  }, []);
  const onNodesChange = useCallback3((changes) => {
    const dragPositionChanges = changes.filter((change) => change.type === "position" && change.dragging === true);
    const immediateChanges = changes.filter((change) => change.type !== "position" || change.dragging !== true);
    if (dragPositionChanges.length > 0) {
      for (const change of dragPositionChanges) {
        if (change.type === "position") pendingNodeDragChangesRef.current.set(change.id, change);
      }
      if (nodeDragAnimationFrameRef.current === null) {
        nodeDragAnimationFrameRef.current = requestAnimationFrame(() => {
          nodeDragAnimationFrameRef.current = null;
          flushQueuedNodeDragChanges();
        });
      }
    }
    if (immediateChanges.length > 0) {
      flushQueuedNodeDragChanges();
      applyNodeChangesNow(immediateChanges);
    }
  }, [applyNodeChangesNow, flushQueuedNodeDragChanges]);
  const onEdgesChange = useCallback3((changes) => {
    if (canvasLocked) return;
    const removedIds = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id));
    if (removedIds.size > 0) {
      commitHistory();
    }
    setEdges((current) => {
      const next = applyEdgeChanges(changes, current);
      if (removedIds.size === 0) return next;
      let size = -1;
      while (size !== removedIds.size) {
        size = removedIds.size;
        for (const edge of next) {
          if (edge.data?.modulatesEdgeId && removedIds.has(edge.data.modulatesEdgeId)) removedIds.add(edge.id);
        }
      }
      return next.filter((edge) => !removedIds.has(edge.id));
    });
  }, [canvasLocked, commitHistory]);
  const onNodeDragStart = useCallback3((event, node, dragNodes) => {
    const selectionSnapshot = pendingNodeDragSelectionRef.current;
    const duplicating = isDuplicateModifierPressed(event);
    activeNodeDragSelectionRef.current = !duplicating && selectionSnapshot?.nodeId === node.id && selectionSnapshot.preserveSelection ? selectionSnapshot : null;
    const relatedNodes = dragNodes.length > 0 ? dragNodes : [node];
    const draggedIds = new Set(relatedNodes.map((entry) => entry.id));
    routingAppendicesRef.current = nodesRef.current.flatMap((candidate) => {
      if (duplicating || draggedIds.has(candidate.id)) return [];
      if (candidate.data.patchNode.type !== "Send" && candidate.data.patchNode.type !== "Receive") return [];
      const neighbors = new Set(edgesRef.current.flatMap((edge) => {
        if (edge.type === "virtualRoute") return [];
        if (edge.source === candidate.id) return [edge.target];
        if (edge.target === candidate.id) return [edge.source];
        return [];
      }));
      if (neighbors.size !== 1) return [];
      const ownerId = [...neighbors][0];
      const owner = relatedNodes.find((entry) => entry.id === ownerId);
      if (!owner) return [];
      return [{
        id: candidate.id,
        ownerId,
        offset: { x: candidate.position.x - owner.position.x, y: candidate.position.y - owner.position.y }
      }];
    });
    const positions = Object.fromEntries(relatedNodes.map((entry) => [
      entry.id,
      { ...entry.position }
    ]));
    updateDuplicateDrag({
      nodeIds: new Set(relatedNodes.map((entry) => entry.id)),
      originalPositions: positions,
      currentPositions: positions,
      duplicating,
      linkExternal: isCommandModifierPressed(event)
    });
    if (!activeNodeDragSelectionRef.current) return;
    setNodes((current) => restoreNodeSelectionAfterDeselectedDrag(current, activeNodeDragSelectionRef.current));
    setEdges((current) => restoreEdgeSelectionAfterDeselectedDrag(current, activeNodeDragSelectionRef.current));
  }, [updateDuplicateDrag]);
  const onNodeDrag = useCallback3((_event, _node, dragNodes) => {
    updateDuplicateDrag((current) => syncDuplicateDragPositions(current, dragNodes));
  }, [updateDuplicateDrag]);
  const onNodeDragStop = useCallback3((_event, _node, dragNodes) => {
    flushQueuedNodeDragChanges();
    const dragState = duplicateDragRef.current;
    routingAppendicesRef.current = [];
    activeNodeDragSelectionRef.current = null;
    pendingNodeDragSelectionRef.current = null;
    updateDuplicateDrag(null);
    if (!dragState?.duplicating) return;
    const restoredNodes = restoreGraphNodePositions(nodesRef.current, dragState.originalPositions);
    nodesRef.current = restoredNodes;
    const duplicatedGraph = duplicateDraggedGraph(
      restoredNodes,
      edgesRef.current,
      dragState,
      dragState.currentPositions,
      updateEdgeWeight,
      updateEdgeMode,
      insertNodeOnEdgePlaceholder
    );
    if (duplicatedGraph.nodes.length === 0) return;
    const sourceNodes = restoredNodes.filter((node) => dragState.nodeIds.has(node.id));
    const bufferCopies = duplicatedBufferCopies(
      sourceNodes,
      duplicatedGraph.nodes,
      restoredNodes,
      [...restoredNodes, ...duplicatedGraph.nodes],
      activeDspGroupIds
    );
    commitHistory();
    setNodes((current) => [
      ...restoreGraphNodePositions(current, dragState.originalPositions).map((node) => ({ ...node, selected: false })),
      ...duplicatedGraph.nodes
    ]);
    setEdges((current) => dedupeEdges([
      ...current.map((edge) => ({ ...edge, selected: false })),
      ...duplicatedGraph.edges
    ]));
    copyBufferAssets(bufferCopies, bufferAssetsRef.current, replaceBufferAssets);
    audio.copyBuffers(bufferCopies);
    setEditingTypeNodeId(null);
  }, [activeDspGroupIds, audio.copyBuffers, commitHistory, flushQueuedNodeDragChanges, replaceBufferAssets, updateDuplicateDrag, updateEdgeMode, updateEdgeWeight]);
  useEffect6(() => {
    const updateModifier = (event) => {
      const dragState = duplicateDragRef.current;
      if (dragState && event.key === "Alt") {
        if (event.altKey && !dragState.duplicating) {
          setNodes((current) => restoreGraphNodePositions(current, dragState.originalPositions));
          updateDuplicateDrag({ ...dragState, duplicating: true });
          return;
        }
        if (!event.altKey && dragState.duplicating) {
          commitHistory("node-position");
          setNodes((current) => applyGraphNodePositions(current, dragState.currentPositions));
          updateDuplicateDrag({ ...dragState, duplicating: false });
          return;
        }
      }
      if (dragState && (event.key === "Meta" || event.key === "Control" || event.key === "Shift")) {
        updateDuplicateDrag({ ...dragState, linkExternal: isCommandModifierPressed(event) });
      }
      const areaDrag = areaDragRef.current;
      if (!areaDrag) return;
      if (event.key === "Alt") {
        if (event.altKey && !areaDrag.duplicating) {
          setAreas((current) => current.map((area) => {
            const position = areaDrag.areaPositions[area.id];
            return position ? { ...area, position: { ...position } } : area;
          }));
          setNodes((current) => applyGraphNodePositions(current, areaDrag.nodePositions));
          areaDrag.duplicating = true;
          setAreaDuplicateDrag({ ...areaDrag });
          return;
        }
        if (!event.altKey && areaDrag.duplicating) {
          if (!areaDrag.historyCommitted) {
            commitHistory();
            areaDrag.historyCommitted = true;
          }
          setAreas((current) => current.map((area) => {
            const position = areaDrag.currentAreaPositions[area.id];
            return position ? { ...area, position: { ...position } } : area;
          }));
          setNodes((current) => applyGraphNodePositions(current, areaDrag.currentNodePositions));
          areaDrag.duplicating = false;
          setAreaDuplicateDrag(null);
          return;
        }
      }
      if (event.key === "Meta" || event.key === "Control" || event.key === "Shift") {
        areaDrag.linkExternal = isCommandModifierPressed(event);
        if (areaDrag.duplicating) setAreaDuplicateDrag({ ...areaDrag });
      }
    };
    window.addEventListener("keydown", updateModifier);
    window.addEventListener("keyup", updateModifier);
    return () => {
      window.removeEventListener("keydown", updateModifier);
      window.removeEventListener("keyup", updateModifier);
    };
  }, [commitHistory, updateDuplicateDrag]);
  const onConnect = useCallback3((connection) => {
    if (canvasLocked) return;
    if (connection.source === DRAFT_NODE_PREVIEW_ID || connection.target === DRAFT_NODE_PREVIEW_ID) {
      setPendingBoundaryPort(null);
      return;
    }
    const pending = pendingBoundaryPortRef.current;
    if (pending) {
      const isPendingSource = pending.side === "output" && connection.source === pending.nodeId && connection.sourceHandle === `out:${pending.port}`;
      const isPendingTarget = pending.side === "input" && connection.target === pending.nodeId && connection.targetHandle === `in:${pending.port}`;
      if (isPendingSource || isPendingTarget) {
        materializePendingBoundaryPort(pending);
      }
    }
    const link = linkFromConnection(connection, draftNodeConnectionRef.current?.mode);
    if (!link) {
      setPendingBoundaryPort(null);
      return;
    }
    const internalRuntimeSource = nodesRef.current.find((node) => node.id === link.from.node && (node.data.patchNode.type === "Spread" && link.from.port === "item index" || node.data.patchNode.type === "Spawn" && link.from.port === "instance gate"));
    const targetNode = nodesRef.current.find((node) => node.id === link.to.node);
    if (internalRuntimeSource && (!targetNode || !flowNodeIsInsideSpread(internalRuntimeSource, targetNode))) {
      setPendingBoundaryPort(null);
      return;
    }
    const spawnTarget = nodesRef.current.find((node) => node.id === link.to.node && node.data.patchNode.type === "Spawn" && link.to.port === "kill trigger");
    const sourceNode = nodesRef.current.find((node) => node.id === link.from.node);
    if (spawnTarget && (!sourceNode || !flowNodeIsInsideSpread(spawnTarget, sourceNode))) {
      setPendingBoundaryPort(null);
      return;
    }
    const runtimeControlTarget = nodesRef.current.find((node) => node.id === link.to.node && (node.data.patchNode.type === "Spread" && link.to.port === "count" || node.data.patchNode.type === "Spawn" && (link.to.port === "trigger" || link.to.port === "release trigger")));
    if (runtimeControlTarget && sourceNode && flowNodeIsInsideSpread(runtimeControlTarget, sourceNode)) {
      setPendingBoundaryPort(null);
      return;
    }
    commitHistory();
    const edge = edgeFromLink(link, updateEdgeWeight, updateEdgeMode, insertNodeOnEdge);
    nodeConnectionCompletedRef.current = true;
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    setEdges((current) => dedupeEdges([
      ...current.map((candidate) => ({ ...candidate, selected: false })),
      { ...edge, selected: true }
    ]));
    setPendingBoundaryPort(null);
  }, [canvasLocked, commitHistory, insertNodeOnEdge, materializePendingBoundaryPort, updateEdgeMode, updateEdgeWeight]);
  const onConnectStart = useCallback3((event, params) => {
    if (canvasLocked) return;
    nodeConnectionCompletedRef.current = false;
    weightTargetEdgeIdRef.current = null;
    setWeightTargetEdgeId(null);
    if (reconnectingEdgeRef.current) {
      updateDraftNodeConnection(null);
      return;
    }
    const pointer = clientPointFromEvent(event);
    if (!pointer || !params.nodeId || !params.handleId || !params.handleType) {
      updateDraftNodeConnection(null);
      setPendingBoundaryPort(null);
      return;
    }
    if (editingStack.length > 0 || nodesRef.current.some((node) => node.data.patchNode.type === "Params")) {
      const insNode = nodesRef.current.find((node) => node.data.patchNode.type === (editingStack.length > 0 ? "Ins" : "Params"));
      const outsNode = editingStack.length > 0 ? nodesRef.current.find((node) => node.data.patchNode.type === "Outs") : void 0;
      let nextPending = null;
      if (params.handleType === "target" && insNode && params.nodeId !== insNode.id) {
        const usedNames = new Set((insNode.data.patchNode.outputs ?? []).map((port) => port.name));
        nextPending = {
          nodeId: insNode.id,
          side: "output",
          port: uniquePortName(editingStack.length > 0 ? "new input" : "new parameter", usedNames)
        };
      }
      if (params.handleType === "source" && outsNode && params.nodeId !== outsNode.id) {
        const usedNames = new Set((outsNode.data.patchNode.inputs ?? []).map((port) => port.name));
        nextPending = {
          nodeId: outsNode.id,
          side: "input",
          port: uniquePortName("new output", usedNames)
        };
      }
      setPendingBoundaryPort(nextPending);
    } else {
      setPendingBoundaryPort(null);
    }
    updateDraftNodeConnection({
      originNodeId: params.nodeId,
      originHandleId: params.handleId,
      originHandleType: params.handleType,
      pointer,
      modifierActive: isCommandModifierPressed(event),
      mode: "set"
    });
  }, [canvasLocked, editingStack.length, updateDraftNodeConnection]);
  const onConnectEnd = useCallback3((event, connectionState) => {
    if (reconnectingEdgeRef.current) {
      updateDraftNodeConnection(null);
      setPendingBoundaryPort(null);
      return;
    }
    if (nodeConnectionCompletedRef.current || connectionState.toHandle && connectionState.toHandle.nodeId !== DRAFT_NODE_PREVIEW_ID) {
      nodeConnectionCompletedRef.current = false;
      updateDraftNodeConnection(null);
      setPendingBoundaryPort(null);
      weightTargetEdgeIdRef.current = null;
      setWeightTargetEdgeId(null);
      return;
    }
    let draftConnection = draftNodeConnectionRef.current;
    const pointer = clientPointFromEvent(event);
    if (pointer && draftConnection) {
      draftConnection = {
        ...draftConnection,
        pointer,
        modifierActive: draftConnection.modifierActive || isCommandModifierPressed(event)
      };
    }
    const targetEdgeId = pointer ? linkAtScreenPoint(pointer, edgesRef.current) : weightTargetEdgeIdRef.current;
    if (targetEdgeId && draftConnection && draftConnection.originHandleType === "source") {
      const sourcePort = parseHandleId(draftConnection.originHandleId);
      const targetEdge = edgesRef.current.find((candidate) => candidate.id === targetEdgeId);
      if (sourcePort?.kind === "out" && targetEdge) {
        commitHistory();
        const modulationEdge = {
          id: `weight-modulation:${crypto.randomUUID()}`,
          type: "shaderEdge",
          source: draftConnection.originNodeId,
          sourceHandle: draftConnection.originHandleId,
          target: targetEdge.target,
          targetHandle: targetEdge.targetHandle,
          selected: true,
          reconnectable: false,
          className: "shader-edge",
          data: {
            weight: 1,
            mode: draftConnection.mode,
            enabled: true,
            modulatesEdgeId: targetEdgeId,
            onWeightChange: updateEdgeWeight,
            onModeChange: updateEdgeMode,
            onInsertNode: insertNodeOnEdge
          }
        };
        setEdges((current) => dedupeEdges([...current.map((edge) => ({ ...edge, selected: false })), modulationEdge]));
        setNodes((current) => current.map((node) => ({ ...node, selected: false })));
      }
      updateDraftNodeConnection(null);
      setPendingBoundaryPort(null);
      weightTargetEdgeIdRef.current = null;
      setWeightTargetEdgeId(null);
      return;
    }
    updateDraftNodeConnection(null);
    if (!connectionState.toHandle || connectionState.toHandle.nodeId === DRAFT_NODE_PREVIEW_ID) {
      createDraftNodeFromConnection(draftConnection);
    }
    setPendingBoundaryPort(null);
    weightTargetEdgeIdRef.current = null;
    setWeightTargetEdgeId(null);
  }, [commitHistory, createDraftNodeFromConnection, insertNodeOnEdge, updateDraftNodeConnection, updateEdgeMode, updateEdgeWeight]);
  useEffect6(() => {
    const updatePointer = (event) => {
      if (reconnectingEdgeRef.current) {
        const edge = reconnectingEdgeSnapshotRef.current;
        const targetId2 = edge && !reconnectCancelledRef.current && reconnectFixedHandleRef.current === "source" ? linkAtScreenPoint({ x: event.clientX, y: event.clientY }, edgesRef.current.filter(
          (candidate) => strengthTargetIsAllowed(edge.id, candidate.id, edgesRef.current)
        )) : null;
        weightTargetEdgeIdRef.current = targetId2;
        setWeightTargetEdgeId(targetId2);
        return;
      }
      const draft = draftNodeConnectionRef.current;
      if (!draft) return;
      const targetId = linkAtScreenPoint({ x: event.clientX, y: event.clientY }, edgesRef.current);
      if (draft.originHandleType === "source" && targetId !== weightTargetEdgeIdRef.current) {
        weightTargetEdgeIdRef.current = targetId;
        setWeightTargetEdgeId(targetId);
      }
      updateDraftNodeConnection({
        ...draft,
        pointer: { x: event.clientX, y: event.clientY },
        modifierActive: isCommandModifierPressed(event)
      });
    };
    const updateModifier = (event) => {
      const draft = draftNodeConnectionRef.current;
      if (!draft) return;
      updateDraftNodeConnection({
        ...draft,
        modifierActive: isCommandModifierPressed(event)
      });
    };
    window.addEventListener("pointermove", updatePointer);
    window.addEventListener("keydown", updateModifier);
    window.addEventListener("keyup", updateModifier);
    return () => {
      window.removeEventListener("pointermove", updatePointer);
      window.removeEventListener("keydown", updateModifier);
      window.removeEventListener("keyup", updateModifier);
    };
  }, [edgesRef, updateDraftNodeConnection]);
  const addNodeAt = useCallback3((event) => {
    if (canvasLocked) return;
    if (!reactFlow) return;
    addDraftNode(reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [addDraftNode, canvasLocked, reactFlow]);
  const toggleCanvasLock = useCallback3(() => {
    setCanvasLocked((locked) => !locked);
    setNodes((current) => current.map((node) => ({ ...node, selected: false })));
    setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
    setSelectedAreaId(null);
    setEditingAreaId(null);
    setEditingTypeNodeId(null);
    setPendingBoundaryPort(null);
    updateDraftNodeConnection(null);
  }, [updateDraftNodeConnection]);
  const showSaveFeedback = useCallback3(() => {
    setSaveFeedbackActive(true);
    if (saveFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(saveFeedbackTimeoutRef.current);
    }
    saveFeedbackTimeoutRef.current = window.setTimeout(() => {
      setSaveFeedbackActive(false);
      saveFeedbackTimeoutRef.current = null;
    }, 900);
  }, []);
  const loadPatchJson = useCallback3((json) => {
    let loadedPatch;
    try {
      loadedPatch = parsePatchJson(json);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
      return;
    }
    commitHistory();
    const callbacks = nodeCallbacksPlaceholder();
    setEditingStack([]);
    setPendingBoundaryPort(null);
    setNodes(toFlowNodes(loadedPatch, callbacks, null));
    setEdges(toFlowEdges(loadedPatch, updateEdgeWeight, updateEdgeMode, insertNodeOnEdgePlaceholder));
    setAreas(structuredClone(loadedPatch.areas ?? []));
    setSelectedAreaId(null);
    setSurfacedAreaId(null);
    setEditingAreaId(null);
    setPatchName(loadedPatch.name ?? "single-patch");
    setSelectedMidiInputDeviceIds(normalizeSelectedMidiDeviceIds(loadedPatch.midiInput?.selectedDeviceIds));
    setSelectedMidiOutputDeviceIds(normalizeSelectedMidiDeviceIds(loadedPatch.midiInput?.selectedOutputDeviceIds));
    setMidiClockOutputEnabled(loadedPatch.midiInput?.sendClock === true);
    setMidiControlVisuals({});
    setEditingTypeNodeId(null);
    setImportError(null);
    void restoreBufferAssets(loadedPatch.buffers ?? {}).catch((error) => {
      setImportError(error instanceof Error ? error.message : String(error));
    });
  }, [commitHistory, restoreBufferAssets, updateEdgeMode, updateEdgeWeight]);
  const openLocalPatchLibrary = useCallback3(async () => {
    setLocalPatchLibrary({
      patches: [],
      selectedPatchName: null,
      selectedVersionId: null,
      loading: true,
      error: null
    });
    try {
      const patches = await fetchLocalPatchLibrary();
      const selectedPatch = selectInitialLocalPatch(patches, rootPatchName);
      setLocalPatchLibrary({
        patches,
        selectedPatchName: selectedPatch?.name ?? null,
        selectedVersionId: selectedPatch?.versions[0]?.id ?? null,
        loading: false,
        error: patches.length === 0 ? "No saved patches found in patches/." : null
      });
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalPatchLibrary({
        patches: [],
        selectedPatchName: null,
        selectedVersionId: null,
        loading: false,
        error: message
      });
      setImportError(message);
    }
  }, [rootPatchName]);
  const closeLocalPatchLibrary = useCallback3(() => {
    setLocalPatchLibrary(null);
  }, []);
  const selectLocalPatch = useCallback3((patchEntry) => {
    setLocalPatchLibrary((current) => current ? {
      ...current,
      selectedPatchName: patchEntry.name,
      selectedVersionId: patchEntry.versions[0]?.id ?? null
    } : current);
  }, []);
  const selectLocalPatchVersion = useCallback3((version) => {
    setLocalPatchLibrary((current) => current ? {
      ...current,
      selectedVersionId: version.id
    } : current);
  }, []);
  const loadSelectedLocalPatch = useCallback3(async () => {
    const selectedPatchName = localPatchLibrary?.selectedPatchName;
    const selectedVersionId = localPatchLibrary?.selectedVersionId;
    if (!selectedPatchName || !selectedVersionId) return;
    try {
      loadPatchJson(await fetchLocalPatchVersion(selectedPatchName, selectedVersionId));
      setLocalPatchLibrary(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalPatchLibrary((current) => current ? { ...current, error: message } : current);
      setImportError(message);
    }
  }, [loadPatchJson, localPatchLibrary]);
  const openLocalSubpatchImport = useCallback3(async () => {
    setSubpatchImportModal(null);
    setLocalSubpatchImport({
      subpatches: [],
      selectedSubpatchName: null,
      selectedSourceKey: null,
      loading: true,
      error: null
    });
    try {
      const patches = await fetchLocalPatchLibrary();
      const subpatches = await buildLocalSubpatchImportEntries(patches);
      const selectedSubpatch = subpatches[0] ?? null;
      setLocalSubpatchImport({
        subpatches,
        selectedSubpatchName: selectedSubpatch?.name ?? null,
        selectedSourceKey: selectedSubpatch?.sources[0]?.key ?? null,
        loading: false,
        error: subpatches.length === 0 ? "No saved subpatches found in patches/." : null
      });
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalSubpatchImport({
        subpatches: [],
        selectedSubpatchName: null,
        selectedSourceKey: null,
        loading: false,
        error: message
      });
      setImportError(message);
    }
  }, []);
  const closeLocalSubpatchImport = useCallback3(() => {
    setLocalSubpatchImport(null);
  }, []);
  const selectLocalSubpatch = useCallback3((entry) => {
    setLocalSubpatchImport((current) => current ? {
      ...current,
      selectedSubpatchName: entry.name,
      selectedSourceKey: entry.sources[0]?.key ?? null
    } : current);
  }, []);
  const selectLocalSubpatchSource = useCallback3((source) => {
    setLocalSubpatchImport((current) => current ? {
      ...current,
      selectedSourceKey: source.key
    } : current);
  }, []);
  const savePatchJson = useCallback3(async (saveAs = false) => {
    if (hosted) {
      if (!hosted.capabilities.save || saveAs && !hosted.capabilities.saveAs) {
        setImportError("The host does not allow this Save operation.");
        return;
      }
      void hosted.edit(retainNestedBufferReferences({ ...patch, ...Object.keys(bufferAssetsRef.current).length ? { buffers: bufferAssetsRef.current } : {} }, hosted.getDocument()));
      if (await hosted.save(saveAs)) {
        if (hosted.getSnapshot().savedRevision === hosted.getSnapshot().revision) replaceBufferAssets(hosted.getDocument().buffers ?? {});
        setImportError(null);
        showSaveFeedback();
      } else setImportError(hosted.getSnapshot().saveDiagnostics?.map((d) => d.message).join("\n") || "The host did not acknowledge Save. The working document is retained.");
      return;
    }
    let savedBufferAssets;
    try {
      savedBufferAssets = await checkpointPreservedBuffers();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
      return;
    }
    const savedPatchJson = patchToJson({
      ...patch,
      ...Object.keys(savedBufferAssets).length > 0 ? { buffers: savedBufferAssets } : {}
    });
    if (localPatchStorageEnabled) {
      if (trimmedRootPatchName.length === 0) {
        setImportError("Enter a patch name before saving locally.");
        return;
      }
      try {
        await uploadLocalBufferContents(savedBufferAssets);
        await saveLocalPatchVersion(trimmedRootPatchName, savedPatchJson);
        setImportError(null);
        showSaveFeedback();
      } catch (error) {
        setImportError(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    const blob = new Blob([savedPatchJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sanitizePatchFilename(rootPatchName)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showSaveFeedback();
  }, [checkpointPreservedBuffers, localPatchStorageEnabled, patch, rootPatchName, showSaveFeedback, trimmedRootPatchName]);
  useEffect6(() => {
    if (!hosted) return;
    const saveKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!event.repeat) void savePatchJson(event.shiftKey);
      }
    };
    window.addEventListener("keydown", saveKey);
    return () => window.removeEventListener("keydown", saveKey);
  }, [hosted, savePatchJson]);
  const exportPatchPackage = useCallback3(async () => {
    if (hosted) {
      setImportError("This operation is owned by the host and has no supplied adapter.");
      return;
    }
    try {
      const savedBufferAssets = await checkpointPreservedBuffers();
      const exportPatch = {
        ...patch,
        ...Object.keys(savedBufferAssets).length > 0 ? { buffers: savedBufferAssets } : {}
      };
      const compiledPatch = {
        ...exportPatch,
        nodes: exportPatch.nodes.map((node) => node.type === "Params" ? { ...node, enabled: true } : node)
      };
      const blob = await createPatchPackage(compiledPatch);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${sanitizePatchFilename(rootPatchName)}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 6e4);
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }, [checkpointPreservedBuffers, patch, rootPatchName]);
  const requestPatchLoad = useCallback3(() => {
    if (hosted) {
      setImportError("This operation is owned by the host and has no supplied adapter.");
      return;
    }
    if (localPatchStorageEnabled) {
      void openLocalPatchLibrary();
      return;
    }
    fileInputRef.current?.click();
  }, [localPatchStorageEnabled, openLocalPatchLibrary]);
  const loadPatchFile = useCallback3(async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      loadPatchJson(await file.text());
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }, [loadPatchJson]);
  const importSubpatchCandidate = useCallback3((candidate) => {
    const existingIds = new Set(nodesRef.current.map((node) => node.id));
    const id = makeNodeId("Group", existingIds);
    const position = flowPositionForNewImport(reactFlow, nodesRef.current);
    const inputDefinitions = boundaryPortDefinitions(candidate.subpatch, "Ins", "outputs");
    const outputDefinitions = boundaryPortDefinitions(candidate.subpatch, "Outs", "inputs").map((port) => ({
      name: port.name,
      ...port.connectable === void 0 ? {} : { connectable: port.connectable },
      ...port.min === void 0 ? {} : { min: port.min },
      ...port.max === void 0 ? {} : { max: port.max },
      ...port.integer === void 0 ? {} : { integer: port.integer }
    }));
    commitHistory();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id,
        type: "shaderNode",
        position,
        selected: true,
        data: {
          patchNode: {
            id,
            type: "Group",
            subpatchName: candidate.name,
            subpatchCloneId: makeSubpatchCloneId(id),
            params: Object.fromEntries(inputDefinitions.map((port) => [port.name, port.defaultValue ?? 0])),
            position,
            inputs: inputDefinitions,
            outputs: outputDefinitions,
            subpatch: clonePatch(candidate.subpatch)
          },
          ...nodeCallbacksPlaceholder(),
          isTypePickerOpen: false
        }
      }
    ]);
    setSubpatchImportModal(null);
    setLocalSubpatchImport(null);
    setImportError(null);
  }, [commitHistory, reactFlow]);
  const importSelectedLocalSubpatch = useCallback3(() => {
    const selectedSourceKey = localSubpatchImport?.selectedSourceKey;
    const source = localSubpatchImport?.subpatches.flatMap((entry) => entry.sources).find((entry) => entry.key === selectedSourceKey);
    if (!source) return;
    importSubpatchCandidate(source.candidate);
  }, [importSubpatchCandidate, localSubpatchImport]);
  const requestSubpatchImport = useCallback3(() => {
    if (hosted) {
      setImportError("This operation is owned by the host and has no supplied adapter.");
      return;
    }
    if (!localPatchStorageEnabled) {
      importFileInputRef.current?.click();
      return;
    }
    void openLocalSubpatchImport();
  }, [localPatchStorageEnabled, openLocalSubpatchImport]);
  const loadSubpatchImportFile = useCallback3(async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const importedPatch = parsePatchJson(await file.text());
      const candidates = collectSubpatchImportCandidates(importedPatch);
      setLocalSubpatchImport(null);
      setSubpatchImportModal({
        fileName: file.name,
        candidates,
        selectedKey: candidates[0]?.key ?? null,
        error: candidates.length === 0 ? "No subpatches found in this patch." : null
      });
      setImportError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalSubpatchImport(null);
      setSubpatchImportModal({
        fileName: file.name,
        candidates: [],
        selectedKey: null,
        error: message
      });
      setImportError(message);
    }
  }, []);
  const undo = useCallback3(() => {
    setHistory((current) => {
      const previous = current.past[current.past.length - 1];
      if (!previous) return current;
      const now = graphSnapshot(nodesRef.current, edgesRef.current, areasRef.current);
      restoreGraphSnapshot(previous, setNodes, setEdges, setAreas);
      setSelectedAreaId(null);
      setSurfacedAreaId(null);
      setEditingAreaId(null);
      return {
        past: current.past.slice(0, -1),
        future: [now, ...current.future].slice(0, HISTORY_LIMIT)
      };
    });
  }, []);
  const redo = useCallback3(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (!next) return current;
      const now = graphSnapshot(nodesRef.current, edgesRef.current, areasRef.current);
      restoreGraphSnapshot(next, setNodes, setEdges, setAreas);
      setSelectedAreaId(null);
      setSurfacedAreaId(null);
      setEditingAreaId(null);
      return {
        past: [...current.past, now].slice(-HISTORY_LIMIT),
        future: current.future.slice(1)
      };
    });
  }, []);
  const newPatch = useCallback3(() => {
    if (hosted) {
      setImportError("This operation is owned by the host and has no supplied adapter.");
      return;
    }
    setNewPatchConfirmationOpen(true);
  }, []);
  const confirmNewPatch = useCallback3(() => {
    setEditingStack([]);
    setPendingBoundaryPort(null);
    setSelectedBoundaryPort(null);
    setPatchName(localPatchStorageEnabled ? "" : "untitled-patch");
    setSelectedMidiInputDeviceIds([]);
    setMidiClockOutputEnabled(false);
    setMidiControlVisuals({});
    setNodes([]);
    setEdges([]);
    setAreas([]);
    setSelectedAreaId(null);
    setSurfacedAreaId(null);
    setEditingAreaId(null);
    setEditingTypeNodeId(null);
    setHistory({ past: [], future: [] });
    setNewPatchConfirmationOpen(false);
    void restoreBufferAssets({}).catch(() => void 0);
  }, [localPatchStorageEnabled, restoreBufferAssets]);
  useEffect6(() => {
    if (!newPatchConfirmationOpen) return;
    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setNewPatchConfirmationOpen(false);
    };
    window.addEventListener("keydown", handleEscape, { capture: true });
    return () => window.removeEventListener("keydown", handleEscape, { capture: true });
  }, [newPatchConfirmationOpen]);
  useEffect6(() => {
    const handleHistoryKeyDown = (event) => {
      if (isEditableEventTarget(event.target)) return;
      const hasModifier = event.metaKey || event.ctrlKey;
      if (!hasModifier) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (key === "z" && event.shiftKey || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handleHistoryKeyDown);
    return () => window.removeEventListener("keydown", handleHistoryKeyDown);
  }, [redo, undo]);
  useEffect6(() => {
    if (!selectedBoundaryPort) return;
    const node = nodes.find((entry) => entry.id === selectedBoundaryPort.nodeId);
    if (!node) {
      setSelectedBoundaryPort(null);
      return;
    }
    const ports = selectedBoundaryPort.side === "input" ? node.data.patchNode.inputs ?? [] : node.data.patchNode.outputs ?? [];
    if (!ports.some((port) => port.name === selectedBoundaryPort.port)) {
      setSelectedBoundaryPort(null);
    }
  }, [nodes, selectedBoundaryPort]);
  useEffect6(() => {
    if (!selectedBoundaryPort) return;
    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(".port-name-label")) return;
      setSelectedBoundaryPort(null);
    };
    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, [selectedBoundaryPort]);
  useEffect6(() => {
    const handleSelectedEdgeModeKeyDown = (event) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableEventTarget(event.target)) return;
      const modeByKey = {
        a: "add",
        s: "set",
        m: "multiply",
        b: "bend"
      };
      const mode = modeByKey[event.key.toLowerCase()];
      if (!mode) return;
      if (draftNodeConnectionRef.current) {
        updateDraftNodeConnection((current) => current ? { ...current, mode } : null);
      } else if (!setSelectedEdgesMode(mode)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handleSelectedEdgeModeKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleSelectedEdgeModeKeyDown, { capture: true });
  }, [setSelectedEdgesMode, updateDraftNodeConnection]);
  useEffect6(() => {
    const handleToggleSelectedEdgesKeyDown = (event) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableEventTarget(event.target) || event.key.toLowerCase() !== "x") return;
      if (!toggleSelectedNodes() && !toggleSelectedEdges()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handleToggleSelectedEdgesKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleToggleSelectedEdgesKeyDown, { capture: true });
  }, [toggleSelectedEdges, toggleSelectedNodes]);
  useEffect6(() => {
    const handleBoundaryPortDeleteKeyDown = (event) => {
      if (isEditableEventTarget(event.target)) return;
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (!deleteSelectedBoundaryPort()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handleBoundaryPortDeleteKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleBoundaryPortDeleteKeyDown, { capture: true });
  }, [deleteSelectedBoundaryPort]);
  useEffect6(() => {
    const handleBridgeDeleteKeyDown = (event) => {
      if (isEditableEventTarget(event.target)) return;
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (!deleteSelectedNodesWithBridge()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", handleBridgeDeleteKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleBridgeDeleteKeyDown, { capture: true });
  }, [deleteSelectedNodesWithBridge]);
  useEffect6(() => {
    const handleClipboardKeyDown = (event) => {
      if (isEditableEventTarget(event.target)) return;
      const hasModifier = event.metaKey || event.ctrlKey;
      if (!hasModifier || event.shiftKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "c" && copySelectedNodes()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (key === "v") {
        event.preventDefault();
        event.stopPropagation();
        void pasteCopiedNodes();
      }
    };
    window.addEventListener("keydown", handleClipboardKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleClipboardKeyDown, { capture: true });
  }, [copySelectedNodes, pasteCopiedNodes]);
  useEffect6(() => {
    const handleSelectorIndexKeyDown = (event) => {
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableEventTarget(event.target)) return;
      const index = selectorIndexFromKeyboardEvent(event);
      if (index === null) return;
      const selectedSelectors = nodesRef.current.filter((node) => node.selected === true && node.data.patchNode.type === "Selector");
      if (selectedSelectors.length !== 1) return;
      const selector = selectedSelectors[0];
      const definition = getNodeDefinition(selector.data.patchNode);
      const port = String(index);
      if (!definition.inputs.some((input) => input.name === port)) return;
      event.preventDefault();
      event.stopPropagation();
      updateNodeParam(selector.id, "select", index);
    };
    window.addEventListener("keydown", handleSelectorIndexKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleSelectorIndexKeyDown, { capture: true });
  }, [updateNodeParam]);
  useEffect6(() => () => {
    if (saveFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(saveFeedbackTimeoutRef.current);
    }
  }, []);
  const promoteNodeFromTarget = useCallback3((eventTarget) => {
    const target = eventTarget instanceof Element ? eventTarget : null;
    const nodeElement = target?.closest(".react-flow__node[data-id]");
    const nodeId = nodeElement?.dataset.id;
    if (!nodeId) return;
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId);
    const containingArea = node ? innermostAreaContainingNode(areasRef.current, node) : void 0;
    setSurfacedAreaId(containingArea?.id ?? null);
    setNodeStackOrder((current) => {
      if (containingArea) {
        const containedNodeIds = nodeIdsContainedByAreaHierarchy(
          areasRef.current,
          nodesRef.current,
          containingArea.id
        );
        const promotedAreaOrder = promoteNodeIdsInStackOrder(
          current,
          nodesRef.current.map((candidate) => candidate.id),
          containedNodeIds
        );
        return promoteNodeIdsInStackOrder(
          promotedAreaOrder,
          nodesRef.current.map((candidate) => candidate.id),
          /* @__PURE__ */ new Set([nodeId])
        );
      }
      const currentNodeIds = new Set(nodesRef.current.map((node2) => node2.id));
      const activeOrder = current.filter((entry) => entry !== nodeId && currentNodeIds.has(entry));
      if (activeOrder.length === current.length - 1 && current.at(-1) === nodeId) return current;
      return [...activeOrder, nodeId];
    });
  }, []);
  const promoteAreaFromTarget = useCallback3((eventTarget) => {
    const target = eventTarget instanceof Element ? eventTarget : null;
    const areaId = target?.closest(".canvas-area[data-area-id]")?.dataset.areaId;
    if (!areaId) return;
    const containedNodeIds = nodeIdsContainedByAreaHierarchy(
      areasRef.current,
      nodesRef.current,
      areaId
    );
    setSelectedAreaId(areaId);
    setSurfacedAreaId(areaId);
    setNodeStackOrder((current) => promoteNodeIdsInStackOrder(
      current,
      nodesRef.current.map((node) => node.id),
      containedNodeIds
    ));
  }, []);
  const handleEditorFocusCapture = useCallback3((event) => {
    if (canvasLocked) return;
    if (isSurfacedControlTarget(event.target)) return;
    promoteNodeFromTarget(event.target);
    promoteAreaFromTarget(event.target);
  }, [canvasLocked, promoteAreaFromTarget, promoteNodeFromTarget]);
  const handleEditorPointerDownCapture = useCallback3((event) => {
    if (canvasLocked) return;
    if (!event.nativeEvent.isTrusted && ignoreSyntheticSelectionPointerDownRef.current) {
      ignoreSyntheticSelectionPointerDownRef.current = false;
      return;
    }
    if (isSurfacedControlTarget(event.target)) {
      pendingNodeDragSelectionRef.current = null;
      selectionDragStartRef.current = null;
      canvasDragActiveRef.current = false;
      canvasDragPointerRef.current = null;
      canvasDragPointerIdRef.current = null;
      setResumedSelectionDraw(null);
      return;
    }
    promoteNodeFromTarget(event.target);
    promoteAreaFromTarget(event.target);
    const target = event.target instanceof Element ? event.target : null;
    const nodeElement = target?.closest(".react-flow__node[data-id]");
    const nodeId = nodeElement?.dataset.id;
    if (!nodeId && !target?.closest(".canvas-area")) setSurfacedAreaId(null);
    if (event.button !== 0) {
      pendingNodeDragSelectionRef.current = null;
      selectionDragStartRef.current = null;
      setResumedSelectionDraw(null);
      return;
    }
    setResumedSelectionDraw(null);
    if (!target?.closest(".canvas-area")) setSelectedAreaId(null);
    const isCanvasPointerDown = target?.classList.contains("react-flow__pane") === true;
    canvasDragActiveRef.current = isCanvasPointerDown;
    canvasDragPointerRef.current = isCanvasPointerDown ? { x: event.clientX, y: event.clientY } : null;
    canvasDragPointerIdRef.current = isCanvasPointerDown ? event.pointerId : null;
    if ((event.metaKey || event.ctrlKey) && isCanvasPointerDown) {
      event.preventDefault();
      event.stopPropagation();
      const draw = { start: { x: event.clientX, y: event.clientY }, current: { x: event.clientX, y: event.clientY } };
      areaDrawRef.current = draw;
      setAreaDraw(draw);
      setResumedSelectionDraw(null);
      selectionDragStartRef.current = null;
      return;
    }
    if (isCanvasPointerDown) {
      selectionDragStartRef.current = { x: event.clientX, y: event.clientY };
    } else {
      selectionDragStartRef.current = null;
    }
    if (!nodeId) {
      pendingNodeDragSelectionRef.current = null;
      return;
    }
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    if (!node) {
      pendingNodeDragSelectionRef.current = null;
      return;
    }
    pendingNodeDragSelectionRef.current = {
      nodeId,
      preserveSelection: node.selected !== true,
      nodeSelection: selectionById(nodesRef.current),
      edgeSelection: selectionById(edgesRef.current)
    };
  }, [promoteAreaFromTarget, promoteNodeFromTarget]);
  const screenToFlow = useCallback3((point) => {
    const rect = editorShellRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const viewport = viewportRef.current;
    return { x: (point.x - rect.left - viewport.x) / viewport.zoom, y: (point.y - rect.top - viewport.y) / viewport.zoom };
  }, []);
  const endNativeSelection = useCallback3(() => {
    const pane = editorShellRef.current?.querySelector(".react-flow__pane");
    const point = canvasDragPointerRef.current;
    const pointerId = canvasDragPointerIdRef.current;
    if (!pane || !point || pointerId === null) return;
    ignoreSyntheticSelectionPointerUpRef.current = true;
    pane.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: point.x,
      clientY: point.y,
      pointerId,
      isPrimary: true
    }));
  }, [canvasLocked, promoteAreaFromTarget, promoteNodeFromTarget]);
  const startNativeSelection = useCallback3((start) => {
    const pane = editorShellRef.current?.querySelector(".react-flow__pane");
    const pointerId = canvasDragPointerIdRef.current;
    if (!pane || pointerId === null) return;
    ignoreSyntheticSelectionPointerDownRef.current = true;
    pane.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: start.x,
      clientY: start.y,
      pointerId,
      isPrimary: true
    }));
  }, []);
  const updateAreaDraw = useCallback3((event) => {
    if (canvasLocked) return false;
    const current = areaDrawRef.current;
    if (!current) return false;
    if (!event.metaKey && !event.ctrlKey) {
      areaDrawRef.current = null;
      selectionDragStartRef.current = current.start;
      setAreaDraw(null);
      setResumedSelectionDraw({
        start: current.start,
        current: { x: event.clientX, y: event.clientY }
      });
      startNativeSelection(current.start);
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const next = { ...current, current: { x: event.clientX, y: event.clientY } };
    areaDrawRef.current = next;
    setAreaDraw(next);
    return true;
  }, [canvasLocked, startNativeSelection]);
  const finishAreaDraw = useCallback3((event) => {
    if (canvasLocked) return false;
    const draw = areaDrawRef.current;
    if (!draw) return false;
    event.preventDefault();
    event.stopPropagation();
    const end = { x: event.clientX, y: event.clientY };
    const start = screenToFlow(draw.start);
    const finish = screenToFlow(end);
    const width = Math.abs(finish.x - start.x);
    const height = Math.abs(finish.y - start.y);
    if (width >= 24 && height >= 24) {
      commitHistory();
      const id = `area-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const newArea = {
        id,
        title: "Area",
        position: { x: Math.min(start.x, finish.x), y: Math.min(start.y, finish.y) },
        size: { width, height }
      };
      const nextAreas = [...areasRef.current, newArea];
      const containedNodeIds = nodeIdsContainedByAreaHierarchy(nextAreas, nodesRef.current, id);
      setAreas((current) => [...current, newArea]);
      setSelectedAreaId(id);
      setSurfacedAreaId(id);
      setNodeStackOrder((current) => promoteNodeIdsInStackOrder(
        current,
        nodesRef.current.map((node) => node.id),
        containedNodeIds
      ));
    }
    areaDrawRef.current = null;
    setAreaDraw(null);
    return true;
  }, [canvasLocked, commitHistory, screenToFlow]);
  const startAreaDrag = useCallback3((event, area, preserveClick = false) => {
    if (event.button !== 0) return;
    if (!preserveClick) event.preventDefault();
    event.stopPropagation();
    setSelectedAreaId(area.id);
    const movedAreaIds = connectedAreaIds(areas, area.id);
    const movedAreas = areas.filter((candidate) => movedAreaIds.has(candidate.id));
    const areaPositions = Object.fromEntries(movedAreas.map((candidate) => [candidate.id, { ...candidate.position }]));
    const nodePositions = Object.fromEntries(nodesRef.current.filter((node) => movedAreas.some((candidate) => areaContainsNode(candidate, node) || candidate.spreadNodeId === node.id)).map((node) => [node.id, { ...node.position }]));
    const dragState = {
      areaId: area.id,
      start: { x: event.clientX, y: event.clientY },
      captureTarget: event.currentTarget,
      areaPositions,
      nodePositions,
      currentAreaPositions: structuredClone(areaPositions),
      currentNodePositions: structuredClone(nodePositions),
      duplicating: event.altKey,
      linkExternal: isCommandModifierPressed(event),
      historyCommitted: false
    };
    areaDragRef.current = dragState;
    setAreaDuplicateDrag(dragState.duplicating ? { ...dragState } : null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [areas]);
  const dragArea = useCallback3((event) => {
    const drag = areaDragRef.current;
    if (!drag) return;
    event.preventDefault();
    const zoom = viewportRef.current.zoom;
    const delta = { x: (event.clientX - drag.start.x) / zoom, y: (event.clientY - drag.start.y) / zoom };
    drag.currentAreaPositions = Object.fromEntries(Object.entries(drag.areaPositions).map(([id, position]) => [id, {
      x: position.x + delta.x,
      y: position.y + delta.y
    }]));
    drag.currentNodePositions = Object.fromEntries(Object.entries(drag.nodePositions).map(([id, position]) => [id, {
      x: position.x + delta.x,
      y: position.y + delta.y
    }]));
    drag.linkExternal = isCommandModifierPressed(event);
    if (drag.duplicating) {
      setAreaDuplicateDrag({ ...drag });
      return;
    }
    if (!drag.historyCommitted && (delta.x !== 0 || delta.y !== 0)) {
      commitHistory();
      drag.historyCommitted = true;
    }
    setAreas((current) => current.map((area) => {
      const position = drag.currentAreaPositions[area.id];
      return position ? { ...area, position } : area;
    }));
    setNodes((current) => current.map((node) => {
      const position = drag.currentNodePositions[node.id];
      return position ? { ...node, position } : node;
    }));
  }, [commitHistory]);
  const stopAreaDrag = useCallback3((event) => {
    const drag = areaDragRef.current;
    if (!drag) return;
    if (drag.captureTarget.hasPointerCapture(event.pointerId)) {
      drag.captureTarget.releasePointerCapture(event.pointerId);
    }
    areaDragRef.current = null;
    setAreaDuplicateDrag(null);
    if (!drag.duplicating) return;
    const duplicated = duplicateAreaHierarchy(
      areasRef.current,
      nodesRef.current,
      edgesRef.current,
      drag,
      updateEdgeWeight,
      updateEdgeMode,
      insertNodeOnEdgePlaceholder
    );
    if (duplicated.nodes.length === 0 && duplicated.areas.length === 0) return;
    const sourceNodes = nodesRef.current.filter((node) => Object.hasOwn(drag.nodePositions, node.id));
    const bufferCopies = duplicatedBufferCopies(
      sourceNodes,
      duplicated.nodes,
      nodesRef.current,
      [...nodesRef.current, ...duplicated.nodes],
      activeDspGroupIds
    );
    commitHistory();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      ...duplicated.nodes.map((node) => ({ ...node, selected: false }))
    ]);
    setEdges((current) => dedupeEdges([
      ...current.map((edge) => ({ ...edge, selected: false })),
      ...duplicated.edges
    ]));
    setAreas((current) => [...current, ...duplicated.areas]);
    setSelectedAreaId(duplicated.rootAreaId);
    setSurfacedAreaId(duplicated.rootAreaId);
    setNodeStackOrder((current) => [...current, ...duplicated.nodes.map((node) => node.id)]);
    copyBufferAssets(bufferCopies, bufferAssetsRef.current, replaceBufferAssets);
    audio.copyBuffers(bufferCopies);
  }, [activeDspGroupIds, audio.copyBuffers, commitHistory, replaceBufferAssets, updateEdgeMode, updateEdgeWeight]);
  const startAreaResize = useCallback3((event, area, corner) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedAreaId(area.id);
    areaResizeRef.current = {
      areaId: area.id,
      start: { x: event.clientX, y: event.clientY },
      corner,
      originalPosition: area.position,
      originalSize: area.size,
      historyCommitted: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const resizeArea = useCallback3((event) => {
    const resize = areaResizeRef.current;
    if (!resize) return;
    event.preventDefault();
    const zoom = viewportRef.current.zoom;
    const delta = { x: (event.clientX - resize.start.x) / zoom, y: (event.clientY - resize.start.y) / zoom };
    if (!resize.historyCommitted && (delta.x !== 0 || delta.y !== 0)) {
      commitHistory();
      resize.historyCommitted = true;
    }
    const resizedArea = areasRef.current.find((area) => area.id === resize.areaId);
    const containedBounds = resizedArea?.locked ? lockedAreaNodeBounds(resizedArea, nodesRef.current) : null;
    const runtimeContainerNode = resizedArea?.spreadNodeId ? nodesRef.current.find((node) => node.id === resizedArea.spreadNodeId) : void 0;
    const minimumWidth = Math.max(
      runtimeContainerNode?.data.patchNode.type === "Spawn" ? MIN_SPAWN_WIDTH : resizedArea?.kind === "spread" ? MIN_RUNTIME_CONTAINER_WIDTH : 48,
      containedBounds?.width ?? 0
    );
    const minimumHeight = Math.max(
      resizedArea?.kind === "spread" ? NODE_HEADER_HEIGHT + (runtimeContainerNode?.data.patchNode.type === "Spawn" ? SPAWN_PORTS_HEIGHT : SPREAD_PORTS_HEIGHT) + 48 : 48,
      containedBounds?.height ?? 0
    );
    const originalRight = resize.originalPosition.x + resize.originalSize.width;
    const originalBottom = resize.originalPosition.y + resize.originalSize.height;
    const resizingLeft = resize.corner.includes("left");
    const resizingTop = resize.corner.includes("top");
    const left = resizingLeft ? Math.min(
      resize.originalPosition.x + delta.x,
      originalRight - minimumWidth,
      containedBounds?.x ?? Number.POSITIVE_INFINITY
    ) : resize.originalPosition.x;
    const right = resizingLeft ? originalRight : Math.max(
      originalRight + delta.x,
      resize.originalPosition.x + minimumWidth,
      containedBounds ? containedBounds.x + containedBounds.width : Number.NEGATIVE_INFINITY
    );
    const top = resizingTop ? Math.min(
      resize.originalPosition.y + delta.y,
      originalBottom - minimumHeight,
      containedBounds?.y ?? Number.POSITIVE_INFINITY
    ) : resize.originalPosition.y;
    const bottom = resizingTop ? originalBottom : Math.max(
      originalBottom + delta.y,
      resize.originalPosition.y + minimumHeight,
      containedBounds ? containedBounds.y + containedBounds.height : Number.NEGATIVE_INFINITY
    );
    const width = right - left;
    const height = bottom - top;
    const position = {
      x: left,
      y: top
    };
    setAreas((current) => current.map((area) => area.id === resize.areaId ? {
      ...area,
      position,
      size: { width, height },
      ...area.uiHeight === void 0 ? {} : { uiHeight: Math.min(area.uiHeight, Math.max(0, height - NODE_HEADER_HEIGHT)) }
    } : area));
    if (resizedArea?.spreadNodeId) {
      setNodes((current) => current.map((node) => node.id === resizedArea.spreadNodeId ? {
        ...node,
        position,
        data: {
          ...node.data,
          patchNode: {
            ...node.data.patchNode,
            position,
            scopeSize: {
              width,
              height: Math.max(
                node.data.patchNode.type === "Spawn" ? SPAWN_PORTS_HEIGHT : SPREAD_PORTS_HEIGHT,
                height - NODE_HEADER_HEIGHT
              )
            }
          }
        }
      } : node));
    }
  }, [commitHistory]);
  const stopAreaResize = useCallback3((event) => {
    if (!areaResizeRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    areaResizeRef.current = null;
  }, []);
  const startAreaUiResize = useCallback3((event, area) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedAreaId(area.id);
    areaUiResizeRef.current = {
      areaId: area.id,
      start: { x: event.clientX, y: event.clientY },
      originalUiHeight: area.uiHeight ?? 0,
      historyCommitted: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);
  const resizeAreaUi = useCallback3((event) => {
    const resize = areaUiResizeRef.current;
    if (!resize) return;
    event.preventDefault();
    const delta = (event.clientY - resize.start.y) / viewportRef.current.zoom;
    const nextUiHeight = Math.max(0, resize.originalUiHeight + delta);
    if (!resize.historyCommitted && nextUiHeight !== resize.originalUiHeight) {
      commitHistory();
      resize.historyCommitted = true;
    }
    setAreas((current) => current.map((area) => area.id === resize.areaId ? {
      ...area,
      uiHeight: Math.min(Math.max(0, area.size.height - NODE_HEADER_HEIGHT), nextUiHeight)
    } : area));
  }, [commitHistory]);
  const stopAreaUiResize = useCallback3((event) => {
    if (!areaUiResizeRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    areaUiResizeRef.current = null;
  }, []);
  const renameArea = useCallback3((areaId, title) => {
    commitHistory(`area-title:${areaId}`);
    setAreas((current) => current.map((area) => area.id === areaId ? { ...area, title } : area));
  }, [commitHistory]);
  const finishAreaRename = useCallback3((areaId) => {
    setAreas((current) => current.map((area) => area.id === areaId && !area.title ? {
      ...area,
      title: area.kind === "spread" ? nodesRef.current.find((node) => node.id === area.spreadNodeId)?.data.patchNode.type === "Spawn" ? "Spawn" : "Spread" : "Area"
    } : area));
    setEditingAreaId(null);
  }, []);
  const toggleAreaCollapsed = useCallback3((areaId) => {
    const area = areasRef.current.find((candidate) => candidate.id === areaId);
    if (!area) return;
    commitHistory(`area-collapse:${areaId}`);
    setEditingAreaId(null);
    setEditingTypeNodeId(null);
    if (area.collapsed) {
      const containedNodeIds = nodeIdsContainedByAreaHierarchy(
        areasRef.current,
        nodesRef.current,
        areaId
      );
      setSurfacedAreaId(areaId);
      setSelectedAreaId(areaId);
      setNodeStackOrder((current) => promoteNodeIdsInStackOrder(
        current,
        nodesRef.current.map((node) => node.id),
        containedNodeIds
      ));
    }
    setAreas((current) => current.map((area2) => {
      if (area2.id !== areaId) return area2;
      if (area2.collapsed || area2.locked) return { ...area2, collapsed: !area2.collapsed };
      return {
        ...area2,
        collapsed: true,
        locked: true,
        nodeIds: nodesRef.current.filter((node) => areaContainsPoint(area2, node.position)).map((node) => node.id),
        areaIds: areaIdsWithinBounds(current, area2)
      };
    }));
  }, [commitHistory]);
  const toggleAreaLocked = useCallback3((areaId) => {
    const area = areasRef.current.find((candidate) => candidate.id === areaId);
    if (!area) return;
    commitHistory(`area-lock:${areaId}`);
    setAreas((current) => current.map((candidate) => {
      if (candidate.id !== areaId) return candidate;
      if (candidate.locked) return {
        ...candidate,
        locked: false,
        nodeIds: void 0,
        areaIds: void 0
      };
      return {
        ...candidate,
        locked: true,
        nodeIds: nodesRef.current.filter((node) => areaContainsPoint(candidate, node.position)).map((node) => node.id),
        areaIds: areaIdsWithinBounds(current, candidate)
      };
    }));
  }, [commitHistory]);
  const areaDrawBounds = useMemo5(() => {
    if (!areaDraw) return null;
    const start = screenToFlow(areaDraw.start);
    const end = screenToFlow(areaDraw.current);
    return {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y)
    };
  }, [areaDraw, screenToFlow]);
  const clearPendingNodeDragSelection = useCallback3(() => {
    if (!activeNodeDragSelectionRef.current) {
      pendingNodeDragSelectionRef.current = null;
    }
  }, []);
  const syncRectangleSelection = useCallback3((end) => {
    const start = selectionDragStartRef.current;
    const editorShell = editorShellRef.current;
    if (!start || !editorShell) return;
    const selectedNodeIds = selectedNodeIdsInScreenRect(
      editorShell,
      start,
      end,
      new Set(nodesRef.current.map((node) => node.id))
    );
    setNodes((current) => updateSelection(current, selectedNodeIds));
    setEdges((current) => updateSelection(current, /* @__PURE__ */ new Set()));
  }, []);
  const handleRectangleSelectionMove = useCallback3((event) => {
    if (event.buttons !== 1 || !selectionDragStartRef.current) return;
    if (event.metaKey || event.ctrlKey) {
      const draw = { start: selectionDragStartRef.current, current: { x: event.clientX, y: event.clientY } };
      event.preventDefault();
      event.stopPropagation();
      areaDrawRef.current = draw;
      selectionDragStartRef.current = null;
      setAreaDraw(draw);
      setResumedSelectionDraw(null);
      endNativeSelection();
      setNodes((current) => updateSelection(current, /* @__PURE__ */ new Set()));
      setEdges((current) => updateSelection(current, /* @__PURE__ */ new Set()));
      return;
    }
    setResumedSelectionDraw((current) => current ? { ...current, current: { x: event.clientX, y: event.clientY } } : null);
    syncRectangleSelection({ x: event.clientX, y: event.clientY });
  }, [endNativeSelection, syncRectangleSelection]);
  const validateRectangleSelection = useCallback3((event) => {
    syncRectangleSelection({ x: event.clientX, y: event.clientY });
    selectionDragStartRef.current = null;
    setResumedSelectionDraw(null);
  }, [syncRectangleSelection]);
  useEffect6(() => {
    const updateModeForModifier = (modifierActive) => {
      if (!canvasDragActiveRef.current || !canvasDragPointerRef.current) return;
      if (modifierActive && !areaDrawRef.current && selectionDragStartRef.current) {
        const draw = { start: selectionDragStartRef.current, current: canvasDragPointerRef.current };
        areaDrawRef.current = draw;
        selectionDragStartRef.current = null;
        setAreaDraw(draw);
        setResumedSelectionDraw(null);
        endNativeSelection();
        setNodes((current) => updateSelection(current, /* @__PURE__ */ new Set()));
        setEdges((current) => updateSelection(current, /* @__PURE__ */ new Set()));
        return;
      }
      if (!modifierActive && areaDrawRef.current) {
        const draw = areaDrawRef.current;
        areaDrawRef.current = null;
        selectionDragStartRef.current = draw.start;
        setAreaDraw(null);
        setResumedSelectionDraw({ start: draw.start, current: canvasDragPointerRef.current });
        startNativeSelection(draw.start);
        syncRectangleSelection(canvasDragPointerRef.current);
      }
    };
    const handleModifierKeyDown = (event) => {
      if (event.key === "Meta" || event.key === "Control") updateModeForModifier(true);
    };
    const handleModifierKeyUp = (event) => {
      if (event.key === "Meta" || event.key === "Control") updateModeForModifier(false);
    };
    window.addEventListener("keydown", handleModifierKeyDown, { capture: true });
    window.addEventListener("keyup", handleModifierKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleModifierKeyDown, { capture: true });
      window.removeEventListener("keyup", handleModifierKeyUp, { capture: true });
    };
  }, [endNativeSelection, startNativeSelection, syncRectangleSelection]);
  const resumedSelectionBounds = useMemo5(() => {
    if (!resumedSelectionDraw || !editorShellRef.current) return null;
    const shellBounds = editorShellRef.current.getBoundingClientRect();
    return {
      left: Math.min(resumedSelectionDraw.start.x, resumedSelectionDraw.current.x) - shellBounds.left,
      top: Math.min(resumedSelectionDraw.start.y, resumedSelectionDraw.current.y) - shellBounds.top,
      width: Math.abs(resumedSelectionDraw.current.x - resumedSelectionDraw.start.x),
      height: Math.abs(resumedSelectionDraw.current.y - resumedSelectionDraw.start.y)
    };
  }, [resumedSelectionDraw]);
  const handleMove = useCallback3((event, nextViewport) => {
    if (event !== null && Math.abs(nextViewport.zoom - zoomInteractionRef.current.lastZoom) > ZOOM_CHANGE_EPSILON) {
      zoomInteractionRef.current.zoomChanged = true;
    }
    zoomInteractionRef.current.lastZoom = nextViewport.zoom;
    viewportRef.current = nextViewport;
  }, []);
  const handleMoveEnd = useCallback3((event, nextViewport) => {
    const zoomChanged = zoomInteractionRef.current.zoomChanged || event !== null && Math.abs(nextViewport.zoom - zoomInteractionRef.current.lastZoom) > ZOOM_CHANGE_EPSILON;
    zoomInteractionRef.current = { zoomChanged: false, lastZoom: nextViewport.zoom };
    viewportRef.current = nextViewport;
    setSettledViewport(nextViewport);
    if (!hosted) storeViewport(nextViewport);
    if (event !== null && zoomChanged && shouldSettleZoomToBaseline(nextViewport.zoom)) {
      void reactFlow?.zoomTo(ZOOM_RESET_TARGET, { duration: 120 });
    }
  }, [reactFlow]);
  const resetZoom = useCallback3(() => {
    void reactFlow?.zoomTo(ZOOM_RESET_TARGET);
  }, [reactFlow]);
  useEffect6(() => {
    const handleResetZoomKeyDown = (event) => {
      if (event.repeat || event.altKey || event.shiftKey) return;
      if (isEditableEventTarget(event.target)) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key !== "0" && event.code !== "Digit0" && event.code !== "Numpad0") return;
      event.preventDefault();
      event.stopPropagation();
      resetZoom();
    };
    window.addEventListener("keydown", handleResetZoomKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleResetZoomKeyDown, { capture: true });
  }, [resetZoom]);
  useEffect6(() => {
    const deleteSelectedArea = (event) => {
      if (canvasLocked) return;
      if (event.key !== "Backspace" && event.key !== "Delete" || isEditableEventTarget(event.target)) return;
      if (!selectedAreaId) return;
      event.preventDefault();
      event.stopPropagation();
      commitHistory();
      const selectedArea = areasRef.current.find((area) => area.id === selectedAreaId);
      if (selectedArea?.spreadNodeId) {
        setNodes((current) => current.filter((node) => node.id !== selectedArea.spreadNodeId));
        setEdges((current) => current.filter((edge) => edge.source !== selectedArea.spreadNodeId && edge.target !== selectedArea.spreadNodeId));
      }
      setAreas((current) => current.filter((area) => area.id !== selectedAreaId));
      setSelectedAreaId(null);
      setSurfacedAreaId((current) => current === selectedAreaId ? null : current);
    };
    window.addEventListener("keydown", deleteSelectedArea, { capture: true });
    return () => window.removeEventListener("keydown", deleteSelectedArea, { capture: true });
  }, [canvasLocked, commitHistory, selectedAreaId]);
  const handleFlowNodeDoubleClick = useCallback3((event, node) => {
    if (!enterGroupNode(node)) return;
    event.preventDefault();
    event.stopPropagation();
  }, [enterGroupNode]);
  const handleFlowEdgeDoubleClick = useCallback3((event, edge) => {
    event.preventDefault();
    event.stopPropagation();
    if (edge.data?.isAreaCollapsedPresentation) return;
    insertNodeOnEdge(edge.id);
  }, [insertNodeOnEdge]);
  const connectionLineStyle = useMemo5(() => ({
    "--connection-line-color": draftNodePreview ? "transparent" : CONNECTION_LINE_COLORS[draftNodeConnection?.mode ?? "set"]
  }), [draftNodeConnection?.mode, draftNodePreview]);
  return /* @__PURE__ */ jsx7("div", { className: "app-shell app-shell-panel-closed", children: /* @__PURE__ */ jsx7(EdgeOverlayProvider, { target: edgeOverlayElement, children: /* @__PURE__ */ jsxs6(
    "main",
    {
      ref: editorShellRef,
      className: `editor-shell${areaDraw ? " editor-shell-area-drawing" : ""}${resumedSelectionDraw ? " editor-shell-resumed-selection" : ""}`,
      onFocusCapture: handleEditorFocusCapture,
      onPointerDownCapture: handleEditorPointerDownCapture,
      onPointerMove: (event) => {
        if (canvasLocked) return;
        if (canvasDragActiveRef.current && event.buttons === 1) {
          canvasDragPointerRef.current = { x: event.clientX, y: event.clientY };
        }
        if (!updateAreaDraw(event)) handleRectangleSelectionMove(event);
      },
      onPointerUpCapture: (event) => {
        if (canvasLocked) return;
        if (!event.nativeEvent.isTrusted && ignoreSyntheticSelectionPointerUpRef.current) {
          ignoreSyntheticSelectionPointerUpRef.current = false;
          return;
        }
        if (!finishAreaDraw(event)) clearPendingNodeDragSelection();
        canvasDragActiveRef.current = false;
        canvasDragPointerRef.current = null;
        canvasDragPointerIdRef.current = null;
        setResumedSelectionDraw(null);
      },
      onPointerCancelCapture: () => {
        clearPendingNodeDragSelection();
        canvasDragActiveRef.current = false;
        canvasDragPointerRef.current = null;
        canvasDragPointerIdRef.current = null;
        setResumedSelectionDraw(null);
      },
      onDoubleClick: (event) => {
        const target = event.target;
        if (!target.classList.contains("react-flow__pane")) return;
        event.preventDefault();
        event.stopPropagation();
        addNodeAt(event);
      },
      children: [
        /* @__PURE__ */ jsx7(Fm1ModeContext.Provider, { value: fm1Mode, children: /* @__PURE__ */ jsxs6(
          ReactFlow,
          {
            nodes: displayNodes,
            edges: displayEdges,
            nodeTypes,
            edgeTypes,
            onInit: setReactFlow,
            onNodesChange,
            onEdgesChange,
            onNodeDragStart,
            onNodeDrag,
            onNodeDragStop,
            onSelectionEnd: validateRectangleSelection,
            onNodeDoubleClick: handleFlowNodeDoubleClick,
            onConnect,
            onConnectStart,
            onConnectEnd,
            onReconnect,
            onReconnectStart,
            onReconnectEnd,
            reconnectRadius: 12,
            nodesDraggable: !canvasLocked,
            nodesConnectable: !canvasLocked,
            elementsSelectable: true,
            connectionLineStyle,
            onEdgeDoubleClick: handleFlowEdgeDoubleClick,
            onMove: handleMove,
            onMoveEnd: handleMoveEnd,
            connectionMode: ConnectionMode.Loose,
            panOnScroll: true,
            panOnDrag: false,
            zoomOnScroll: false,
            zoomOnPinch: true,
            zoomOnDoubleClick: false,
            selectionOnDrag: !canvasLocked && !areaDraw,
            selectionMode: SelectionMode.Partial,
            selectionKeyCode: null,
            panActivationKeyCode: null,
            defaultViewport: initialViewport,
            minZoom: MIN_CANVAS_ZOOM,
            fitView: !initialState?.ui?.viewport && !storedViewport,
            fitViewOptions: FIT_VIEW_OPTIONS,
            translateExtent: panTranslateExtent,
            nodeExtent: FLOW_INFINITE_EXTENT,
            onlyRenderVisibleElements: true,
            deleteKeyCode: canvasLocked ? null : DELETE_KEY_CODES,
            multiSelectionKeyCode: MULTI_SELECTION_KEY_CODES,
            snapToGrid: false,
            proOptions: REACT_FLOW_PRO_OPTIONS,
            children: [
              /* @__PURE__ */ jsx7(ViewportPortal, { children: /* @__PURE__ */ jsxs6(
                "div",
                {
                  className: "area-layer",
                  style: {
                    "--canvas-header-title-scale": String(canvasHeaderTitleScale(settledGraphZoom))
                  },
                  children: [
                    areaDrawBounds && /* @__PURE__ */ jsx7(
                      "div",
                      {
                        className: "canvas-area canvas-area-drawing",
                        style: { left: areaDrawBounds.x, top: areaDrawBounds.y, width: areaDrawBounds.width, height: areaDrawBounds.height }
                      }
                    ),
                    areaDuplicatePreview?.areas.map((area) => /* @__PURE__ */ jsx7(
                      "div",
                      {
                        className: `canvas-area canvas-area-preview${area.kind === "spread" ? " canvas-area-spread" : ""}${area.collapsed ? " canvas-area-collapsed" : ""}`,
                        style: { left: area.position.x, top: area.position.y, width: area.size.width, height: area.collapsed ? NODE_HEADER_HEIGHT + (area.uiHeight ?? 0) : area.size.height },
                        "aria-hidden": "true",
                        children: /* @__PURE__ */ jsx7("div", { className: "canvas-area-header", children: /* @__PURE__ */ jsx7("span", { className: "canvas-area-title", children: area.title }) })
                      },
                      area.id
                    )),
                    areas.map((area) => /* @__PURE__ */ jsxs6(
                      "div",
                      {
                        "data-area-id": area.id,
                        className: `canvas-area${area.kind === "spread" ? " canvas-area-spread" : ""}${area.collapsed ? " canvas-area-collapsed" : ""}${selectedAreaId === area.id ? " canvas-area-selected" : ""}`,
                        style: {
                          left: area.position.x,
                          top: area.position.y,
                          width: area.size.width,
                          height: area.collapsed ? NODE_HEADER_HEIGHT + (area.uiHeight ?? 0) : area.size.height,
                          zIndex: surfacedAreaRanks.has(area.id) ? surfacedAreaLayerBase + (surfacedAreaRanks.get(area.id) ?? 0) : -1
                        },
                        children: [
                          /* @__PURE__ */ jsxs6(
                            "div",
                            {
                              className: "canvas-area-header nodrag nopan",
                              onPointerDown: (event) => {
                                if (!canvasLocked) startAreaDrag(event, area);
                              },
                              onPointerMove: canvasLocked ? void 0 : dragArea,
                              onPointerUp: canvasLocked ? void 0 : stopAreaDrag,
                              onPointerCancel: canvasLocked ? void 0 : stopAreaDrag,
                              onDoubleClick: (event) => {
                                if (canvasLocked) return;
                                event.preventDefault();
                                event.stopPropagation();
                                toggleAreaCollapsed(area.id);
                              },
                              children: [
                                editingAreaId === area.id ? /* @__PURE__ */ jsx7(
                                  "input",
                                  {
                                    ref: areaTitleInputRef,
                                    className: "canvas-area-title-input",
                                    value: area.title,
                                    "aria-label": area.kind === "spread" ? nodesRef.current.find((node) => node.id === area.spreadNodeId)?.data.patchNode.type === "Spawn" ? "Spawn name" : "Spread name" : "Area name",
                                    onPointerDown: (event) => event.stopPropagation(),
                                    onDoubleClick: (event) => {
                                      event.stopPropagation();
                                      event.currentTarget.select();
                                    },
                                    onBlur: () => finishAreaRename(area.id),
                                    onKeyDown: (event) => {
                                      if (event.key === "Enter" || event.key === "Escape") {
                                        event.preventDefault();
                                        event.currentTarget.blur();
                                      }
                                    },
                                    onChange: (event) => renameArea(area.id, event.target.value)
                                  }
                                ) : /* @__PURE__ */ jsxs6(
                                  "button",
                                  {
                                    className: "canvas-area-title nodrag nopan",
                                    type: "button",
                                    onPointerDown: (event) => {
                                      if (canvasLocked) return;
                                      areaTitlePointerStartRef.current = { x: event.clientX, y: event.clientY };
                                      startAreaDrag(event, area, true);
                                    },
                                    onPointerCancel: () => {
                                      areaTitlePointerStartRef.current = null;
                                    },
                                    onDoubleClick: (event) => event.stopPropagation(),
                                    onClick: (event) => {
                                      if (canvasLocked) return;
                                      const pointerStart = areaTitlePointerStartRef.current;
                                      areaTitlePointerStartRef.current = null;
                                      const moved = pointerStart ? Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4 : false;
                                      if (moved) {
                                        event.preventDefault();
                                        return;
                                      }
                                      event.stopPropagation();
                                      setSelectedAreaId(area.id);
                                      setEditingAreaId(area.id);
                                    },
                                    children: [
                                      area.title,
                                      area.kind === "spread" && nodesRef.current.find((node) => node.id === area.spreadNodeId)?.data.patchNode.type === "Spawn" ? ` (${Math.max(0, Math.floor(
                                        audio.linkMeters[`${scopedDspNodeId(area.spreadNodeId ?? "", activeDspGroupIds)}:spawn-count`]?.output ?? 0
                                      ))})` : ""
                                    ]
                                  }
                                ),
                                !canvasLocked && !area.collapsed ? /* @__PURE__ */ jsx7(
                                  "button",
                                  {
                                    className: `area-lock-toggle nodrag nopan${area.locked ? " area-lock-toggle-locked" : ""}`,
                                    type: "button",
                                    "aria-label": area.locked ? "Unlock area membership" : "Lock area membership",
                                    title: area.locked ? "Unlock area membership" : "Lock area membership",
                                    "aria-pressed": area.locked === true,
                                    onPointerDown: (event) => event.stopPropagation(),
                                    onDoubleClick: (event) => event.stopPropagation(),
                                    onClick: (event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      toggleAreaLocked(area.id);
                                    },
                                    children: /* @__PURE__ */ jsx7("span", { className: "area-lock-icon", "aria-hidden": "true" })
                                  }
                                ) : null,
                                !canvasLocked ? /* @__PURE__ */ jsx7(
                                  "button",
                                  {
                                    className: "area-compact-toggle nodrag nopan",
                                    type: "button",
                                    "aria-label": area.collapsed ? "Expand area" : "Collapse area",
                                    title: area.collapsed ? "Expand area" : "Collapse area",
                                    "aria-pressed": area.collapsed === true,
                                    onPointerDown: (event) => event.stopPropagation(),
                                    onDoubleClick: (event) => event.stopPropagation(),
                                    onClick: (event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      toggleAreaCollapsed(area.id);
                                    },
                                    children: /* @__PURE__ */ jsx7(
                                      "span",
                                      {
                                        className: `node-compact-icon ${area.collapsed ? "node-compact-icon-compact" : "node-compact-icon-expanded"}`,
                                        "aria-hidden": "true"
                                      }
                                    )
                                  }
                                ) : null
                              ]
                            }
                          ),
                          !canvasLocked && !area.collapsed && area.kind !== "spread" && /* @__PURE__ */ jsx7(
                            "div",
                            {
                              className: "canvas-area-ui-resize-handle nodrag nopan",
                              "aria-label": "Resize area UI section",
                              title: "Drag to create or resize the user-facing section",
                              style: { top: area.uiHeight && area.uiHeight > 0 ? NODE_HEADER_HEIGHT + area.uiHeight - 4 : 28 },
                              onPointerDown: (event) => startAreaUiResize(event, area),
                              onPointerMove: resizeAreaUi,
                              onPointerUp: stopAreaUiResize,
                              onPointerCancel: stopAreaUiResize
                            }
                          ),
                          area.uiHeight !== void 0 && area.uiHeight > 0 && /* @__PURE__ */ jsx7("div", { className: "canvas-area-ui-divider", style: { top: NODE_HEADER_HEIGHT + area.uiHeight } }),
                          !canvasLocked && !area.collapsed && ["top-left", "top-right", "bottom-left", "bottom-right"].map((corner) => /* @__PURE__ */ jsx7(
                            "div",
                            {
                              className: `canvas-area-resize-handle canvas-area-resize-${corner} nodrag nopan`,
                              "aria-label": `Resize area from ${corner}`,
                              onPointerDown: (event) => startAreaResize(event, area, corner),
                              onPointerMove: resizeArea,
                              onPointerUp: stopAreaResize,
                              onPointerCancel: stopAreaResize
                            },
                            corner
                          ))
                        ]
                      },
                      area.id
                    ))
                  ]
                }
              ) }),
              /* @__PURE__ */ jsx7(Background, { color: "var(--color-foreground-08)", gap: 28, size: 1 }),
              /* @__PURE__ */ jsxs6(Controls, { showInteractive: false, children: [
                /* @__PURE__ */ jsx7(
                  ControlButton,
                  {
                    className: "react-flow__controls-zoom-percentage",
                    type: "button",
                    onClick: resetZoom,
                    "aria-label": `Reset zoom to 100% (currently ${formatZoomPercentage(settledViewport.zoom)})`,
                    title: `Reset zoom to 100% (currently ${formatZoomPercentage(settledViewport.zoom)})`,
                    children: formatZoomPercentage(settledViewport.zoom)
                  }
                ),
                /* @__PURE__ */ jsxs6(
                  "div",
                  {
                    hidden: Boolean(hosted),
                    className: `react-flow__controls-cpu-meter${audio.status === "running" ? " is-running" : ""}`,
                    style: { "--cpu-load": cpuLoad, display: hosted ? "none" : void 0 },
                    role: "meter",
                    "aria-label": audio.status === "running" ? `CPU usage ${cpuPercentage}%` : "CPU usage, audio stopped",
                    "aria-valuemin": 0,
                    "aria-valuemax": 100,
                    "aria-valuenow": audio.status === "running" ? Math.min(100, cpuPercentage) : 0,
                    title: cpuDetails,
                    children: [
                      /* @__PURE__ */ jsx7("span", { className: "cpu-meter-label", children: "CPU" }),
                      /* @__PURE__ */ jsxs6("span", { className: "cpu-meter-percentage", "aria-hidden": "true", children: [
                        cpuPercentage,
                        "%"
                      ] })
                    ]
                  }
                )
              ] })
            ]
          }
        ) }),
        resumedSelectionBounds ? /* @__PURE__ */ jsx7(
          "div",
          {
            className: "editor-selection-marquee",
            style: resumedSelectionBounds,
            "aria-hidden": "true"
          }
        ) : null,
        /* @__PURE__ */ jsx7("div", { ref: setEdgeOverlayElement, className: "edge-overlay-layer" }),
        /* @__PURE__ */ jsxs6("div", { className: "viewport-buttons", children: [
          fm1Mode && fm1LiveState.message && /* @__PURE__ */ jsx7("span", { className: "fm1-live-status", role: "status", children: fm1LiveState.message }),
          /* @__PURE__ */ jsx7(
            "input",
            {
              className: "patch-name-input",
              value: patchName,
              onChange: (event) => setPatchName(event.target.value),
              "aria-label": isEditingSubpatch ? "Subpatch name" : "Patch name",
              title: isEditingSubpatch ? "Subpatch name" : "Patch name",
              placeholder: isEditingSubpatch ? "subpatch name" : "patch name",
              spellCheck: false
            }
          ),
          isEditingSubpatch ? /* @__PURE__ */ jsx7("button", { className: "viewport-button viewport-button-history", type: "button", onClick: exitSubpatch, "aria-label": "Exit subpatch", title: "Exit subpatch", children: "EXIT" }) : null,
          hosted ? /* @__PURE__ */ jsxs6(Fragment3, { children: [
            /* @__PURE__ */ jsxs6("span", { title: "Audio and document paths are owned by the host", children: [
              "HOSTED \xB7 ",
              hostedState?.dirty ? "unsaved" : "saved"
            ] }),
            hosted.capabilities.transport && /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", onClick: toggleAudioPlayback, children: "TRANSPORT" })
          ] }) : fm1Mode ? /* @__PURE__ */ jsxs6(Fragment3, { children: [
            /* @__PURE__ */ jsx7(
              "button",
              {
                className: "viewport-button",
                type: "button",
                role: "switch",
                "aria-checked": fm1Live,
                disabled: !fm1Live && fm1LiveState.busy,
                onClick: () => setFm1Live((value) => !value),
                title: fm1LiveState.message,
                children: "LIVE EDIT"
              }
            ),
            /* @__PURE__ */ jsx7(
              "button",
              {
                className: "viewport-button",
                type: "button",
                disabled: fm1Live || fm1LiveState.busy,
                onClick: () => setFm1Patch(patch),
                "aria-label": "Send patch to FM-1",
                title: "FM-1 limits and upload",
                children: "SEND TO FM1"
              }
            ),
            /* @__PURE__ */ jsxs6(
              "select",
              {
                className: "viewport-button",
                "aria-label": "FM1 live preset",
                value: fm1Preset,
                disabled: fm1Live || fm1LiveState.busy,
                onChange: (event) => setFm1Preset(Number(event.target.value)),
                children: [
                  /* @__PURE__ */ jsx7("option", { value: 1, children: "PRESET 1" }),
                  /* @__PURE__ */ jsx7("option", { value: 2, children: "PRESET 2" })
                ]
              }
            )
          ] }) : /* @__PURE__ */ jsxs6(Fragment3, { children: [
            /* @__PURE__ */ jsx7(
              "button",
              {
                className: "viewport-button",
                type: "button",
                role: "switch",
                "aria-checked": audioPlaybackActive,
                "aria-label": audioPlaybackActive ? "Stop audio" : "Play audio",
                title: audioPlaybackActive ? "Stop audio" : "Play audio",
                onClick: toggleAudioPlayback,
                children: "PLAY"
              }
            ),
            /* @__PURE__ */ jsx7(
              "button",
              {
                className: "viewport-button viewport-button-record",
                type: "button",
                role: "switch",
                "aria-checked": audioRecordingActive,
                "aria-label": audioRecordingActive ? "Stop recording" : "Record audio",
                title: audio.recording.message,
                onClick: toggleAudioRecording,
                children: recordingButtonLabel
              }
            )
          ] }),
          !hosted && /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", onClick: newPatch, "aria-label": "New patch", title: "New patch", children: "NEW" }),
          /* @__PURE__ */ jsx7(
            "button",
            {
              className: ["viewport-button", saveFeedbackActive ? "viewport-button-save-confirmed" : ""].filter(Boolean).join(" "),
              type: "button",
              onClick: () => void savePatchJson(),
              disabled: hosted ? !hosted.capabilities.save || !hostedState?.connected : localPatchStorageEnabled && trimmedRootPatchName.length === 0,
              "aria-label": "Save patch",
              title: hosted ? !hosted.capabilities.save ? "The host does not allow saving" : !hostedState?.connected ? "Host disconnected" : "Save through the host" : localPatchStorageEnabled && trimmedRootPatchName.length === 0 ? "Enter a patch name before saving locally" : "Save patch",
              children: "SAVE"
            }
          ),
          !hosted && /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", onClick: requestPatchLoad, "aria-label": "Load patch", title: "Load patch", children: "LOAD" }),
          hosted?.capabilities.saveAs && /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", onClick: () => void savePatchJson(true), children: "SAVE AS" }),
          /* @__PURE__ */ jsx7("button", { className: "viewport-button viewport-button-history", type: "button", onClick: undo, disabled: history.past.length === 0, "aria-label": "Undo", title: "Undo", children: "UNDO" }),
          /* @__PURE__ */ jsx7("button", { className: "viewport-button viewport-button-history", type: "button", onClick: redo, disabled: history.future.length === 0, "aria-label": "Redo", title: "Redo", children: "REDO" }),
          /* @__PURE__ */ jsxs6(
            "div",
            {
              className: "viewport-more",
              "data-open": moreMenuOpen,
              onMouseEnter: () => setMoreMenuOpen(true),
              onMouseLeave: () => setMoreMenuOpen(false),
              onBlur: (event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setMoreMenuOpen(false);
              },
              onKeyDown: (event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  moreMenuTriggerRef.current?.focus();
                  setMoreMenuOpen(false);
                }
              },
              children: [
                /* @__PURE__ */ jsx7(
                  "button",
                  {
                    ref: moreMenuTriggerRef,
                    className: "viewport-button viewport-more-trigger",
                    type: "button",
                    "aria-haspopup": "menu",
                    "aria-expanded": moreMenuOpen,
                    "aria-label": "More actions",
                    title: "More actions",
                    onFocus: () => setMoreMenuOpen(true),
                    onClick: () => setMoreMenuOpen(true),
                    children: "MORE \u02C6"
                  }
                ),
                /* @__PURE__ */ jsxs6(
                  "div",
                  {
                    className: "viewport-more-menu",
                    role: "menu",
                    "aria-label": "More actions",
                    onClick: (event) => {
                      if (!(event.target instanceof Element) || !event.target.closest("button")) return;
                      if (event.currentTarget.contains(document.activeElement)) moreMenuTriggerRef.current?.focus();
                      setMoreMenuOpen(false);
                    },
                    children: [
                      !hosted && /* @__PURE__ */ jsxs6(Fragment3, { children: [
                        /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", onClick: () => setMidiSettingsOpen(true), "aria-label": "MIDI settings", title: "MIDI settings", role: "menuitem", children: "MIDI SETTINGS" }),
                        /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", onClick: () => void exportPatchPackage(), "aria-label": "Export patch package", title: "Export patch package", role: "menuitem", children: "EXPORT PATCH" }),
                        /* @__PURE__ */ jsx7(
                          "button",
                          {
                            className: "viewport-button",
                            type: "button",
                            role: "menuitemcheckbox",
                            "aria-checked": fm1Mode,
                            disabled: fm1LiveState.busy,
                            onClick: () => {
                              audio.stopRecording();
                              audio.stop();
                              setFm1Live(false);
                              setFm1Mode((value) => !value);
                            },
                            children: "FM1 MODE"
                          }
                        ),
                        !fm1Mode && /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", disabled: fm1Live || fm1LiveState.busy, onClick: () => setFm1Patch(patch), "aria-label": "Send patch to FM-1", title: "FM-1 limits and upload", role: "menuitem", children: "SEND TO FM1" })
                      ] }),
                      /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", onClick: () => scaleSelectedNodes(2), disabled: !canScaleSelection, "aria-label": "Increase selected node scale", title: "Increase selected node scale", role: "menuitem", children: "SCALE UP SELECTION" }),
                      /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", onClick: () => scaleSelectedNodes(0.5), disabled: !canScaleSelection, "aria-label": "Decrease selected node scale", title: "Decrease selected node scale", role: "menuitem", children: "SCALE DOWN SELECTION" }),
                      /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", onClick: groupSelectedNodes, disabled: !canGroupSelection || isEditingSubpatch, "aria-label": "Group to subpatch", title: "Group to subpatch", role: "menuitem", children: "GROUP TO SUBPATCH" }),
                      /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", onClick: () => void requestSubpatchImport(), "aria-label": "Import subpatch", title: "Import subpatch", role: "menuitem", children: "IMPORT SUBPATCH" }),
                      /* @__PURE__ */ jsx7("button", { className: "viewport-button", type: "button", role: "menuitemcheckbox", "aria-checked": canvasLocked, "aria-label": canvasLocked ? "Unlock UI" : "Lock UI", title: canvasLocked ? "Unlock UI" : "Lock UI", onClick: toggleCanvasLock, children: "LOCK UI" })
                    ]
                  }
                )
              ]
            }
          )
        ] }),
        /* @__PURE__ */ jsx7("input", { ref: fileInputRef, className: "file-input", type: "file", accept: "application/json,.json", onChange: loadPatchFile }),
        /* @__PURE__ */ jsx7("input", { ref: importFileInputRef, className: "file-input", type: "file", accept: "application/json,.json", onChange: loadSubpatchImportFile }),
        /* @__PURE__ */ jsx7("input", { ref: sampleFileInputRef, className: "file-input", type: "file", accept: "audio/*,video/mp4,.wav,.mp3,.aiff,.aif,.flac,.ogg,.m4a,.mp4", onChange: uploadSampleFile }),
        /* @__PURE__ */ jsx7("input", { ref: imageFileInputRef, className: "file-input", type: "file", accept: "image/avif,image/gif,image/jpeg,image/png,image/webp,.avif,.gif,.jpg,.jpeg,.png,.webp", onChange: uploadImageFile }),
        fm1Patch && /* @__PURE__ */ jsx7(Fm1UploadDialog, { patch: fm1Patch, onClose: () => setFm1Patch(null) }),
        hostedState && (!hostedState.connected || hostedState.diagnostics.some((d) => d.severity !== "info")) && /* @__PURE__ */ jsx7("p", { className: "import-error-floating", "aria-live": "polite", children: [...!hostedState.connected ? ["Host disconnected; working document retained."] : [], ...hostedState.diagnostics.filter((d) => d.severity !== "info").map((d) => d.message)].join(" \xB7 ") }),
        hosted && /* @__PURE__ */ jsx7(HostedParameters, { session: hosted }),
        importError ? /* @__PURE__ */ jsx7("p", { className: "import-error-floating", children: importError }) : null,
        audioGraph.errors.length > 0 ? /* @__PURE__ */ jsxs6("section", { className: "dsp-error-panel", "aria-live": "polite", "aria-label": "DSP compile errors", children: [
          /* @__PURE__ */ jsxs6("div", { className: "dsp-error-panel-heading", children: [
            /* @__PURE__ */ jsx7("span", { children: "DSP errors" }),
            /* @__PURE__ */ jsx7("span", { children: audioGraph.errors.length })
          ] }),
          /* @__PURE__ */ jsx7("ul", { className: "dsp-error-list", children: audioGraph.errors.slice(0, DSP_ERROR_PANEL_LIMIT).map((error) => /* @__PURE__ */ jsx7("li", { children: error }, error)) }),
          audioGraph.errors.length > DSP_ERROR_PANEL_LIMIT ? /* @__PURE__ */ jsxs6("p", { className: "dsp-error-more", children: [
            "+",
            audioGraph.errors.length - DSP_ERROR_PANEL_LIMIT,
            " more"
          ] }) : null
        ] }) : null,
        newPatchConfirmationOpen ? /* @__PURE__ */ jsx7(
          "div",
          {
            className: "import-modal-backdrop",
            role: "presentation",
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) setNewPatchConfirmationOpen(false);
            },
            children: /* @__PURE__ */ jsxs6("section", { className: "import-modal confirm-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "new-patch-modal-title", "aria-describedby": "new-patch-modal-message", children: [
              /* @__PURE__ */ jsxs6("header", { className: "import-modal-header", children: [
                /* @__PURE__ */ jsx7("h2", { id: "new-patch-modal-title", children: "New patch" }),
                /* @__PURE__ */ jsx7("button", { className: "import-modal-close", type: "button", onClick: () => setNewPatchConfirmationOpen(false), "aria-label": "Close new patch confirmation", title: "Close", children: "X" })
              ] }),
              /* @__PURE__ */ jsx7("p", { className: "import-modal-message", id: "new-patch-modal-message", children: "Start a new empty patch? Unsaved changes will be lost." }),
              /* @__PURE__ */ jsxs6("footer", { className: "import-modal-actions", children: [
                /* @__PURE__ */ jsx7("button", { type: "button", onClick: () => setNewPatchConfirmationOpen(false), children: "Cancel" }),
                /* @__PURE__ */ jsx7("button", { type: "button", onClick: confirmNewPatch, children: "New patch" })
              ] })
            ] })
          }
        ) : null,
        midiSettingsOpen ? /* @__PURE__ */ jsx7(
          MidiSettingsModal,
          {
            state: audio.midiInput,
            selectedDeviceIds: selectedMidiInputDeviceIds,
            selectedOutputDeviceIds: selectedMidiOutputDeviceIds,
            midiClockOutputEnabled,
            onToggleDevice: toggleMidiInputDevice,
            onToggleOutputDevice: toggleMidiOutputDevice,
            onMidiClockOutputChange: toggleMidiClockOutput,
            onRefresh: () => void audio.refreshMidiInputDevices(),
            onClose: () => setMidiSettingsOpen(false)
          }
        ) : null,
        bufferSamplePrompt ? /* @__PURE__ */ jsx7(
          "div",
          {
            className: "import-modal-backdrop",
            role: "presentation",
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) answerBufferSamplePrompt(false);
            },
            children: /* @__PURE__ */ jsxs6(
              "section",
              {
                className: "import-modal confirm-modal",
                role: "dialog",
                "aria-modal": "true",
                "aria-labelledby": "buffer-sample-modal-title",
                onKeyDown: (event) => {
                  if (event.key === "Escape") answerBufferSamplePrompt(false);
                },
                children: [
                  /* @__PURE__ */ jsx7("header", { className: "import-modal-header", children: /* @__PURE__ */ jsx7("h2", { id: "buffer-sample-modal-title", children: "Use buffer content as sample?" }) }),
                  /* @__PURE__ */ jsx7("p", { className: "import-modal-message", children: "The Buffer contains recorded audio. Save it as a permanent sample before converting the node?" }),
                  /* @__PURE__ */ jsxs6(
                    "form",
                    {
                      className: "sample-recording-name-form",
                      onSubmit: (event) => {
                        event.preventDefault();
                        answerBufferSamplePrompt(true);
                      },
                      children: [
                        /* @__PURE__ */ jsx7("label", { htmlFor: "buffer-sample-name", children: "Sample name" }),
                        /* @__PURE__ */ jsxs6("div", { className: "sample-recording-name-row", children: [
                          /* @__PURE__ */ jsx7(
                            "input",
                            {
                              id: "buffer-sample-name",
                              type: "text",
                              value: bufferSamplePrompt.name,
                              onChange: (event) => setBufferSamplePrompt((current) => current ? { ...current, name: event.target.value } : current),
                              autoFocus: true
                            }
                          ),
                          /* @__PURE__ */ jsx7("span", { children: ".wav" })
                        ] }),
                        /* @__PURE__ */ jsxs6("footer", { className: "import-modal-actions", children: [
                          /* @__PURE__ */ jsx7("button", { type: "button", onClick: () => answerBufferSamplePrompt(false), children: "No" }),
                          /* @__PURE__ */ jsx7("button", { type: "submit", disabled: !bufferSamplePrompt.name.trim(), children: "Yes" })
                        ] })
                      ]
                    }
                  )
                ]
              }
            )
          }
        ) : null,
        sampleLibrary ? /* @__PURE__ */ jsx7(
          "div",
          {
            className: "import-modal-backdrop",
            role: "presentation",
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) closeSampleLibrary();
            },
            children: /* @__PURE__ */ jsxs6(
              "section",
              {
                className: "import-modal sample-modal",
                role: "dialog",
                "aria-modal": "true",
                "aria-labelledby": "sample-modal-title",
                onDragOver: handleSampleLibraryDragOver,
                onDrop: handleSampleLibraryDrop,
                children: [
                  /* @__PURE__ */ jsxs6("header", { className: "import-modal-header", children: [
                    /* @__PURE__ */ jsxs6("div", { children: [
                      /* @__PURE__ */ jsx7("h2", { id: "sample-modal-title", children: "Select sample" }),
                      /* @__PURE__ */ jsx7("p", { children: "samples/" })
                    ] }),
                    /* @__PURE__ */ jsx7("button", { className: "import-modal-close", type: "button", onClick: closeSampleLibrary, "aria-label": "Close sample picker", title: "Close", children: "X" })
                  ] }),
                  sampleLibrary.loading || sampleLibrary.error ? /* @__PURE__ */ jsx7("p", { className: ["import-modal-message", sampleLibrary.error ? "error" : ""].filter(Boolean).join(" "), children: sampleLibrary.error ?? "Reading samples..." }) : null,
                  sampleRecording.status === "naming" || sampleRecording.status === "saving" ? /* @__PURE__ */ jsxs6(
                    "form",
                    {
                      className: "sample-recording-name-form",
                      onSubmit: (event) => {
                        event.preventDefault();
                        void saveSampleRecording();
                      },
                      children: [
                        /* @__PURE__ */ jsx7("label", { htmlFor: "sample-recording-name", children: "Name this recording" }),
                        /* @__PURE__ */ jsxs6("div", { className: "sample-recording-name-row", children: [
                          /* @__PURE__ */ jsx7(
                            "input",
                            {
                              id: "sample-recording-name",
                              type: "text",
                              value: sampleRecording.name,
                              onChange: (event) => setSampleRecording((current) => ({ ...current, name: event.target.value })),
                              autoFocus: true,
                              disabled: sampleRecording.status === "saving"
                            }
                          ),
                          /* @__PURE__ */ jsx7("span", { children: sampleRecording.extension })
                        ] }),
                        /* @__PURE__ */ jsxs6("footer", { className: "import-modal-actions", children: [
                          /* @__PURE__ */ jsx7("button", { type: "button", onClick: resetSampleRecording, disabled: sampleRecording.status === "saving", children: "Discard" }),
                          /* @__PURE__ */ jsx7("button", { type: "submit", disabled: sampleRecording.status === "saving" || !sampleRecording.name.trim(), children: sampleRecording.status === "saving" ? "Saving..." : "Save and select" })
                        ] })
                      ]
                    }
                  ) : /* @__PURE__ */ jsxs6(Fragment3, { children: [
                    sampleRecording.status !== "idle" ? /* @__PURE__ */ jsx7("p", { className: "sample-recording-status", "aria-live": "polite", children: sampleRecording.status === "requesting" ? "Waiting for microphone permission..." : sampleRecording.status === "processing" ? "Finishing recording..." : `Recording ${formatRecordingTimestamp(sampleRecording.elapsedSeconds)}` }) : null,
                    sampleLibrary.samples.length > 0 ? /* @__PURE__ */ jsx7("div", { className: "sample-list", role: "listbox", "aria-label": "Samples", children: sampleLibrary.samples.map((sample) => /* @__PURE__ */ jsx7(
                      "button",
                      {
                        className: [
                          "sample-option",
                          sample.url === sampleLibrary.selectedUrl ? "sample-option-selected" : ""
                        ].filter(Boolean).join(" "),
                        type: "button",
                        role: "option",
                        "aria-selected": sample.url === sampleLibrary.selectedUrl,
                        onClick: () => setSampleLibrary((current) => current ? { ...current, selectedUrl: sample.url } : current),
                        onDoubleClick: () => selectSampleFromLibrary(sample),
                        children: /* @__PURE__ */ jsx7("span", { children: sample.name })
                      },
                      sample.url
                    )) }) : null,
                    /* @__PURE__ */ jsxs6("footer", { className: "import-modal-actions", children: [
                      /* @__PURE__ */ jsx7("button", { type: "button", onClick: closeSampleLibrary, children: "Cancel" }),
                      /* @__PURE__ */ jsx7(
                        "button",
                        {
                          className: "viewport-button-record",
                          type: "button",
                          "aria-checked": sampleRecording.status !== "idle",
                          onClick: sampleRecording.status === "recording" ? stopSampleRecording : () => void startSampleRecording(),
                          disabled: sampleRecording.status === "requesting" || sampleRecording.status === "processing",
                          children: sampleRecording.status === "recording" ? "Stop" : "Record"
                        }
                      ),
                      /* @__PURE__ */ jsx7("button", { type: "button", onClick: requestSampleUploadFromLibrary, disabled: sampleRecording.status !== "idle", children: "Upload new" }),
                      /* @__PURE__ */ jsx7("button", { type: "button", onClick: () => selectedSample && selectSampleFromLibrary(selectedSample), disabled: !selectedSample || sampleRecording.status !== "idle", children: "Select" })
                    ] })
                  ] })
                ]
              }
            )
          }
        ) : null,
        imageLibrary ? /* @__PURE__ */ jsx7("div", { className: "import-modal-backdrop", role: "presentation", onMouseDown: (event) => {
          if (event.target === event.currentTarget) setImageLibrary(null);
        }, children: /* @__PURE__ */ jsxs6("section", { className: "import-modal image-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "image-modal-title", onDragOver: handleImageLibraryDragOver, onDrop: handleImageLibraryDrop, children: [
          /* @__PURE__ */ jsxs6("header", { className: "import-modal-header", children: [
            /* @__PURE__ */ jsxs6("div", { children: [
              /* @__PURE__ */ jsx7("h2", { id: "image-modal-title", children: "Select image" }),
              /* @__PURE__ */ jsx7("p", { children: "images/" })
            ] }),
            /* @__PURE__ */ jsx7("button", { className: "import-modal-close", type: "button", onClick: () => setImageLibrary(null), "aria-label": "Close image picker", title: "Close", children: "X" })
          ] }),
          imageLibrary.loading || imageLibrary.error ? /* @__PURE__ */ jsx7("p", { className: ["import-modal-message", imageLibrary.error ? "error" : ""].filter(Boolean).join(" "), children: imageLibrary.error ?? "Reading images..." }) : null,
          /* @__PURE__ */ jsxs6("div", { className: "image-library-browser", children: [
            imageLibrary.images.length > 0 ? /* @__PURE__ */ jsx7("div", { className: "image-list", role: "listbox", "aria-label": "Images", children: imageLibrary.images.map((image) => /* @__PURE__ */ jsxs6("button", { className: ["image-option", image.url === imageLibrary.selectedUrl ? "image-option-selected" : ""].filter(Boolean).join(" "), type: "button", role: "option", "aria-selected": image.url === imageLibrary.selectedUrl, onClick: () => setImageLibrary((current) => current ? { ...current, selectedUrl: image.url } : current), onDoubleClick: () => selectImageFromLibrary(image), children: [
              /* @__PURE__ */ jsx7("img", { src: image.url, alt: "" }),
              /* @__PURE__ */ jsx7("span", { children: image.name })
            ] }, image.url)) }) : null,
            /* @__PURE__ */ jsx7("div", { className: "image-modal-preview", "aria-label": "Selected image preview", children: selectedImage ? /* @__PURE__ */ jsx7("img", { src: selectedImage.url, alt: selectedImage.name }) : /* @__PURE__ */ jsx7("span", { children: "No image selected" }) })
          ] }),
          /* @__PURE__ */ jsxs6("footer", { className: "import-modal-actions", children: [
            /* @__PURE__ */ jsx7("button", { type: "button", onClick: () => setImageLibrary(null), children: "Cancel" }),
            /* @__PURE__ */ jsx7("button", { type: "button", onClick: requestImageUploadFromLibrary, children: "Upload new" }),
            /* @__PURE__ */ jsx7("button", { type: "button", onClick: () => selectedImage && selectImageFromLibrary(selectedImage), disabled: !selectedImage, children: "Select" })
          ] })
        ] }) }) : null,
        localPatchLibrary ? /* @__PURE__ */ jsx7(
          "div",
          {
            className: "import-modal-backdrop",
            role: "presentation",
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) closeLocalPatchLibrary();
            },
            children: /* @__PURE__ */ jsxs6("section", { className: "import-modal local-patch-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "local-patch-modal-title", children: [
              /* @__PURE__ */ jsxs6("header", { className: "import-modal-header", children: [
                /* @__PURE__ */ jsxs6("div", { children: [
                  /* @__PURE__ */ jsx7("h2", { id: "local-patch-modal-title", children: "Load patch" }),
                  /* @__PURE__ */ jsx7("p", { children: "patches/" })
                ] }),
                /* @__PURE__ */ jsx7("button", { className: "import-modal-close", type: "button", onClick: closeLocalPatchLibrary, "aria-label": "Close patch loader", title: "Close", children: "X" })
              ] }),
              localPatchLibrary.loading || localPatchLibrary.error ? /* @__PURE__ */ jsx7("p", { className: ["import-modal-message", localPatchLibrary.error ? "error" : ""].filter(Boolean).join(" "), children: localPatchLibrary.error ?? "Reading saved patches..." }) : /* @__PURE__ */ jsxs6("div", { className: "local-patch-browser", children: [
                /* @__PURE__ */ jsxs6("section", { className: "local-patch-column", "aria-label": "Patches", children: [
                  /* @__PURE__ */ jsx7("h3", { children: "PATCH" }),
                  /* @__PURE__ */ jsx7("div", { className: "local-patch-list", role: "listbox", "aria-label": "Patches", children: localPatchLibrary.patches.map((patchEntry) => /* @__PURE__ */ jsxs6(
                    "button",
                    {
                      className: [
                        "local-patch-option",
                        patchEntry.name === localPatchLibrary.selectedPatchName ? "local-patch-option-selected" : ""
                      ].filter(Boolean).join(" "),
                      ref: patchEntry.name === localPatchLibrary.selectedPatchName ? selectedLocalPatchOptionRef : null,
                      type: "button",
                      role: "option",
                      "aria-selected": patchEntry.name === localPatchLibrary.selectedPatchName,
                      onClick: () => selectLocalPatch(patchEntry),
                      children: [
                        /* @__PURE__ */ jsx7("span", { children: patchEntry.name }),
                        /* @__PURE__ */ jsx7("span", { children: patchEntry.versionCount })
                      ]
                    },
                    patchEntry.name
                  )) })
                ] }),
                /* @__PURE__ */ jsxs6("section", { className: "local-patch-column", "aria-label": "Saved versions", children: [
                  /* @__PURE__ */ jsx7("h3", { children: "SAVED AT" }),
                  /* @__PURE__ */ jsx7("div", { className: "local-patch-list", role: "listbox", "aria-label": "Saved versions", children: selectedLocalPatch?.versions.map((version) => /* @__PURE__ */ jsx7(
                    "button",
                    {
                      className: [
                        "local-patch-option",
                        version.id === localPatchLibrary.selectedVersionId ? "local-patch-option-selected" : ""
                      ].filter(Boolean).join(" "),
                      type: "button",
                      role: "option",
                      "aria-selected": version.id === localPatchLibrary.selectedVersionId,
                      onClick: () => selectLocalPatchVersion(version),
                      onDoubleClick: () => void loadSelectedLocalPatch(),
                      children: /* @__PURE__ */ jsx7("span", { children: formatSavedPatchTimestamp(version.savedAt) })
                    },
                    version.id
                  )) })
                ] })
              ] }),
              /* @__PURE__ */ jsxs6("footer", { className: "import-modal-actions", children: [
                /* @__PURE__ */ jsx7("button", { type: "button", onClick: closeLocalPatchLibrary, children: "Cancel" }),
                /* @__PURE__ */ jsx7("button", { type: "button", onClick: () => void loadSelectedLocalPatch(), disabled: !localPatchLibrary.selectedPatchName || !localPatchLibrary.selectedVersionId, children: "Load" })
              ] })
            ] })
          }
        ) : null,
        localSubpatchImport ? /* @__PURE__ */ jsx7(
          "div",
          {
            className: "import-modal-backdrop",
            role: "presentation",
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) closeLocalSubpatchImport();
            },
            children: /* @__PURE__ */ jsxs6("section", { className: "import-modal local-patch-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "local-subpatch-import-title", children: [
              /* @__PURE__ */ jsxs6("header", { className: "import-modal-header", children: [
                /* @__PURE__ */ jsxs6("div", { children: [
                  /* @__PURE__ */ jsx7("h2", { id: "local-subpatch-import-title", children: "Import subpatch" }),
                  /* @__PURE__ */ jsx7("p", { children: "patches/" })
                ] }),
                /* @__PURE__ */ jsx7("button", { className: "import-modal-close", type: "button", onClick: closeLocalSubpatchImport, "aria-label": "Close subpatch import", title: "Close", children: "X" })
              ] }),
              localSubpatchImport.loading || localSubpatchImport.error ? /* @__PURE__ */ jsx7("p", { className: ["import-modal-message", localSubpatchImport.error ? "error" : ""].filter(Boolean).join(" "), children: localSubpatchImport.error ?? "Reading saved subpatches..." }) : /* @__PURE__ */ jsxs6("div", { className: "local-patch-browser", children: [
                /* @__PURE__ */ jsxs6("section", { className: "local-patch-column", "aria-label": "Subpatches", children: [
                  /* @__PURE__ */ jsx7("h3", { children: "SUBPATCH" }),
                  /* @__PURE__ */ jsx7("div", { className: "local-patch-list", role: "listbox", "aria-label": "Subpatches", children: localSubpatchImport.subpatches.map((entry) => /* @__PURE__ */ jsxs6(
                    "button",
                    {
                      className: [
                        "local-patch-option",
                        entry.name === localSubpatchImport.selectedSubpatchName ? "local-patch-option-selected" : ""
                      ].filter(Boolean).join(" "),
                      type: "button",
                      role: "option",
                      "aria-selected": entry.name === localSubpatchImport.selectedSubpatchName,
                      onClick: () => selectLocalSubpatch(entry),
                      children: [
                        /* @__PURE__ */ jsx7("span", { children: entry.name }),
                        /* @__PURE__ */ jsx7("span", { children: entry.sources.length })
                      ]
                    },
                    entry.name
                  )) })
                ] }),
                /* @__PURE__ */ jsxs6("section", { className: "local-patch-column", "aria-label": "Subpatch versions", children: [
                  /* @__PURE__ */ jsx7("h3", { children: "SAVED AT" }),
                  /* @__PURE__ */ jsx7("div", { className: "local-patch-list", role: "listbox", "aria-label": "Subpatch versions", children: selectedLocalSubpatch?.sources.map((source) => /* @__PURE__ */ jsxs6(
                    "button",
                    {
                      className: [
                        "local-patch-option",
                        source.key === localSubpatchImport.selectedSourceKey ? "local-patch-option-selected" : ""
                      ].filter(Boolean).join(" "),
                      type: "button",
                      role: "option",
                      "aria-selected": source.key === localSubpatchImport.selectedSourceKey,
                      onClick: () => selectLocalSubpatchSource(source),
                      onDoubleClick: importSelectedLocalSubpatch,
                      children: [
                        /* @__PURE__ */ jsx7("span", { children: formatSavedPatchTimestamp(source.savedAt) }),
                        /* @__PURE__ */ jsx7("span", { children: source.patchName })
                      ]
                    },
                    source.key
                  )) })
                ] })
              ] }),
              /* @__PURE__ */ jsxs6("footer", { className: "import-modal-actions", children: [
                /* @__PURE__ */ jsx7("button", { type: "button", onClick: closeLocalSubpatchImport, children: "Cancel" }),
                /* @__PURE__ */ jsx7("button", { type: "button", onClick: importSelectedLocalSubpatch, disabled: !localSubpatchImport.selectedSourceKey || localSubpatchImport.subpatches.length === 0, children: "Import" })
              ] })
            ] })
          }
        ) : null,
        subpatchImportModal ? /* @__PURE__ */ jsx7(
          "div",
          {
            className: "import-modal-backdrop",
            role: "presentation",
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) setSubpatchImportModal(null);
            },
            children: /* @__PURE__ */ jsxs6("section", { className: "import-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "import-modal-title", children: [
              /* @__PURE__ */ jsxs6("header", { className: "import-modal-header", children: [
                /* @__PURE__ */ jsxs6("div", { children: [
                  /* @__PURE__ */ jsx7("h2", { id: "import-modal-title", children: "Import subpatch" }),
                  /* @__PURE__ */ jsx7("p", { children: subpatchImportModal.fileName })
                ] }),
                /* @__PURE__ */ jsx7("button", { className: "import-modal-close", type: "button", onClick: () => setSubpatchImportModal(null), "aria-label": "Close subpatch import", title: "Close", children: "X" })
              ] }),
              subpatchImportModal.error ? /* @__PURE__ */ jsx7("p", { className: "import-modal-message error", children: subpatchImportModal.error }) : /* @__PURE__ */ jsx7("div", { className: "import-subpatch-list", role: "listbox", "aria-label": "Subpatches", children: subpatchImportModal.candidates.map((candidate) => /* @__PURE__ */ jsxs6(
                "button",
                {
                  className: [
                    "import-subpatch-option",
                    candidate.key === subpatchImportModal.selectedKey ? "import-subpatch-option-selected" : ""
                  ].filter(Boolean).join(" "),
                  type: "button",
                  role: "option",
                  "aria-selected": candidate.key === subpatchImportModal.selectedKey,
                  onClick: () => setSubpatchImportModal((current) => current ? { ...current, selectedKey: candidate.key } : current),
                  onDoubleClick: () => importSubpatchCandidate(candidate),
                  children: [
                    /* @__PURE__ */ jsx7("span", { className: "import-subpatch-name", children: candidate.name }),
                    /* @__PURE__ */ jsx7("span", { className: "import-subpatch-path", children: candidate.path }),
                    /* @__PURE__ */ jsxs6("span", { className: "import-subpatch-meta", children: [
                      candidate.inputCount,
                      " in / ",
                      candidate.outputCount,
                      " out / ",
                      candidate.nodeCount,
                      " nodes"
                    ] })
                  ]
                },
                candidate.key
              )) }),
              /* @__PURE__ */ jsxs6("footer", { className: "import-modal-actions", children: [
                /* @__PURE__ */ jsx7("button", { type: "button", onClick: () => setSubpatchImportModal(null), children: "Cancel" }),
                /* @__PURE__ */ jsx7("button", { type: "button", onClick: () => selectedSubpatchCandidate && importSubpatchCandidate(selectedSubpatchCandidate), disabled: !selectedSubpatchCandidate, children: "Import" })
              ] })
            ] })
          }
        ) : null
      ]
    }
  ) }) });
}
function canUseLocalPatchStorage() {
  const viteEnv = define_import_meta_env_default;
  const storageMode = viteEnv?.VITE_TEIA_PATCH_STORAGE;
  if (storageMode === "browser") return false;
  if (storageMode === "local") return true;
  return viteEnv?.DEV === true;
}
async function fetchLocalPatchLibrary() {
  const response = await fetch("/api/local-patches", {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(await localPatchStorageError(response));
  }
  const payload = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.patches)) {
    throw new Error("Local patch library response was not valid.");
  }
  return payload.patches.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || !Array.isArray(entry.versions)) return [];
    const versions = entry.versions.flatMap((version) => isRecord(version) && typeof version.id === "string" && typeof version.savedAt === "string" ? [{ id: version.id, savedAt: version.savedAt }] : []);
    return [{
      name: entry.name,
      versionCount: typeof entry.versionCount === "number" ? entry.versionCount : versions.length,
      versions
    }];
  });
}
async function fetchLocalSampleLibrary() {
  const response = await fetch("/api/local-samples", {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(await localPatchStorageError(response));
  }
  const payload = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.samples)) {
    throw new Error("Local sample library response was not valid.");
  }
  return payload.samples.flatMap((entry) => isRecord(entry) && typeof entry.name === "string" && typeof entry.url === "string" ? [{
    name: entry.name,
    url: entry.url,
    ...typeof entry.originalUrl === "string" ? { originalUrl: entry.originalUrl } : {}
  }] : []);
}
async function fetchLocalImageLibrary() {
  const response = await fetch("/api/local-images", { method: "GET", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(await localPatchStorageError(response));
  const payload = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.images)) throw new Error("Local image library response was not valid.");
  return payload.images.flatMap((entry) => isImageAsset(entry) ? [{ name: entry.name, url: entry.url }] : []);
}
function selectInitialLocalPatch(patches, currentPatchName) {
  const trimmedName = currentPatchName.trim();
  if (!trimmedName) return patches[0] ?? null;
  const storageName = sanitizeLocalPatchStorageSegment(trimmedName);
  const normalizedName = trimmedName.toLowerCase();
  const normalizedStorageName = storageName.toLowerCase();
  return patches.find((entry) => entry.name === trimmedName || entry.name === storageName || entry.name.toLowerCase() === normalizedName || entry.name.toLowerCase() === normalizedStorageName) ?? patches[0] ?? null;
}
async function saveLocalPatchVersion(patchName, patchJson) {
  const response = await fetch("/api/local-patches", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: patchName, patchJson })
  });
  if (!response.ok) {
    throw new Error(await localPatchStorageError(response));
  }
}
async function uploadLocalBufferContents(assets) {
  const uniqueAssets = [...new Map(Object.values(assets).map((asset) => [asset.hash, asset])).values()];
  if (uniqueAssets.length === 0) return;
  const missingResponse = await fetch("/api/local-buffers/missing", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ hashes: uniqueAssets.map((asset) => asset.hash) })
  });
  if (!missingResponse.ok) throw new Error(await localPatchStorageError(missingResponse));
  const missingPayload = await missingResponse.json();
  if (!isRecord(missingPayload) || !Array.isArray(missingPayload.missing)) {
    throw new Error("Local Buffer storage response was not valid.");
  }
  const missing = new Set(missingPayload.missing.filter((hash) => typeof hash === "string"));
  await Promise.all(uniqueAssets.filter((asset) => missing.has(asset.hash)).map(async (asset) => {
    const snapshot = await loadBufferSnapshot(asset);
    if (!snapshot) throw new Error(`Buffer ${asset.hash} is missing from browser storage.`);
    const bytes = new Uint8Array(snapshot.samples.byteLength);
    bytes.set(new Uint8Array(snapshot.samples.buffer, snapshot.samples.byteOffset, snapshot.samples.byteLength));
    const data = bytes.buffer;
    const response = await fetch(`/api/local-buffers/${asset.hash}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: data
    });
    if (!response.ok) throw new Error(await localPatchStorageError(response));
  }));
}
async function fetchLocalBufferContent(hash) {
  const response = await fetch(`/api/local-buffers/${hash}`, {
    method: "GET",
    headers: { Accept: "application/octet-stream" }
  });
  if (!response.ok) throw new Error(await localPatchStorageError(response));
  return response.arrayBuffer();
}
async function fetchLocalPatchVersion(patchName, versionId) {
  const params = new URLSearchParams({ patch: patchName, version: versionId });
  const response = await fetch(`/api/local-patches/version?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(await localPatchStorageError(response));
  }
  return response.text();
}
async function localPatchStorageError(response) {
  const message = await response.text();
  return message || `Local patch storage failed with HTTP ${response.status}.`;
}
function hasDraggedFiles2(event) {
  return Array.from(event.dataTransfer.types).includes("Files");
}
function sanitizeLocalPatchStorageSegment(name) {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/-+/g, "-").replace(/^\.+/, "").replace(/\.+$/, "");
  return cleaned || "untitled-patch";
}
function sanitizePatchFilename(name) {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^\.+/, "").replace(/\.+$/, "");
  return cleaned || "untitled-patch";
}
function formatSavedPatchTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());
  const second = padDatePart(date.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
function formatRecordingTimestamp(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${padDatePart(minutes)}:${padDatePart(seconds)}`;
}
function preferredSampleRecordingFormat() {
  const formats = [
    { mimeType: "audio/webm;codecs=opus", extension: ".webm" },
    { mimeType: "audio/ogg;codecs=opus", extension: ".ogg" },
    { mimeType: "audio/mp4", extension: ".m4a" },
    { mimeType: "audio/webm", extension: ".webm" },
    { mimeType: "audio/ogg", extension: ".ogg" }
  ];
  return formats.find((format) => MediaRecorder.isTypeSupported(format.mimeType)) ?? { mimeType: "", extension: ".webm" };
}
function sampleRecordingFileName(name, extension) {
  const stem = name.replace(/\.(?:aac|aif|aiff|flac|m4a|mp3|oga|ogg|wav|wave|webm)$/i, "").trim() || "recording";
  return `${stem}${extension}`;
}
async function uploadLocalSample(file) {
  const response = await fetch(`/api/local-samples?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream"
    },
    body: file
  });
  if (!response.ok) {
    throw new Error(await response.text() || `Sample upload failed (${response.status}).`);
  }
  const payload = await response.json();
  if (!isRecord(payload) || typeof payload.name !== "string" || typeof payload.url !== "string") {
    throw new Error("Sample upload returned an invalid response.");
  }
  return {
    name: payload.name,
    url: payload.url,
    ...typeof payload.originalUrl === "string" ? { originalUrl: payload.originalUrl } : {}
  };
}
function bufferContainsAudio(samples) {
  return samples.some((sample) => Number.isFinite(sample) && sample !== 0);
}
function preservedBufferIds(program) {
  const repeatedStateRanges = program.repeatBindings.map((binding) => ({
    start: binding.stateStart,
    end: binding.stateStart + binding.stateCount
  }));
  const preservedStates = new Set(program.ops.flatMap((op) => op.opcode === DSP_OP.Buffer && (op.value ?? 0) >= 0.5 && op.state !== void 0 && !repeatedStateRanges.some((range) => op.state >= range.start && op.state < range.end) ? [op.state] : []));
  return new Set(program.stateBindings.flatMap((binding) => binding.id.endsWith(":buffer") && preservedStates.has(binding.state) ? [binding.nodeId] : []));
}
function filterBufferAssets(assets, nodeIds) {
  return Object.fromEntries(Object.entries(assets).filter(([nodeId]) => nodeIds.has(nodeId)));
}
function bufferVisualizationContainsAudio(buffer) {
  return buffer?.bins.some((bin) => bin.min !== 0 || bin.max !== 0) === true;
}
function encodeMonoSamplesAsWav(samples, sampleRate) {
  const safeSampleRate = Math.max(1, Math.round(sampleRate));
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);
  writeWavText(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeWavText(view, 8, "WAVE");
  writeWavText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, safeSampleRate, true);
  view.setUint32(28, safeSampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeWavText(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (const value of samples) {
    const sample = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
    offset += bytesPerSample;
  }
  return new Blob([view], { type: "audio/wav" });
}
async function convertRecordedAudioToWav(recording) {
  const context = new AudioContext();
  try {
    const audioBuffer = await context.decodeAudioData(await recording.arrayBuffer());
    return encodeAudioBufferAsWav(audioBuffer);
  } catch (error) {
    throw new Error("Could not convert the microphone recording to WAV.", { cause: error });
  } finally {
    await context.close();
  }
}
function encodeAudioBufferAsWav(audioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = audioBuffer.length * blockAlign;
  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);
  writeWavText(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeWavText(view, 8, "WAVE");
  writeWavText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeWavText(view, 36, "data");
  view.setUint32(40, dataSize, true);
  const channels = Array.from({ length: channelCount }, (_, channel) => audioBuffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < audioBuffer.length; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
      offset += bytesPerSample;
    }
  }
  return new Blob([wav], { type: "audio/wav" });
}
function writeWavText(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
function MidiSettingsModal({
  state,
  selectedDeviceIds,
  selectedOutputDeviceIds,
  midiClockOutputEnabled,
  onToggleDevice,
  onToggleOutputDevice,
  onMidiClockOutputChange,
  onRefresh,
  onClose
}) {
  const selectedDeviceIdSet = new Set(selectedDeviceIds);
  const knownDeviceIds = new Set(state.devices.map((device) => device.id));
  const missingSelectedDeviceIds = selectedDeviceIds.filter((deviceId) => !knownDeviceIds.has(deviceId));
  const selectedOutputDeviceIdSet = new Set(selectedOutputDeviceIds);
  const knownOutputDeviceIds = new Set(state.outputDevices.map((device) => device.id));
  const missingSelectedOutputDeviceIds = selectedOutputDeviceIds.filter((deviceId) => !knownOutputDeviceIds.has(deviceId));
  const unavailable = state.status === "unsupported" || state.status === "denied" || state.status === "error";
  const refreshLabel = state.status === "inactive" || state.status === "needs-permission" ? "Enable" : "Refresh";
  return /* @__PURE__ */ jsx7(
    "div",
    {
      className: "import-modal-backdrop",
      role: "presentation",
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) onClose();
      },
      children: /* @__PURE__ */ jsxs6(
        "section",
        {
          className: "import-modal midi-settings-modal",
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "midi-settings-modal-title",
          children: [
            /* @__PURE__ */ jsxs6("header", { className: "import-modal-header", children: [
              /* @__PURE__ */ jsxs6("div", { children: [
                /* @__PURE__ */ jsx7("h2", { id: "midi-settings-modal-title", children: "MIDI" }),
                /* @__PURE__ */ jsx7("p", { children: midiInputModalStatusLabel(state.status) })
              ] }),
              /* @__PURE__ */ jsx7("button", { className: "import-modal-close", type: "button", onClick: onClose, "aria-label": "Close MIDI settings", title: "Close", children: "X" })
            ] }),
            /* @__PURE__ */ jsx7("p", { className: ["import-modal-message", unavailable ? "error" : ""].filter(Boolean).join(" "), children: state.message }),
            /* @__PURE__ */ jsx7("h3", { className: "midi-settings-section-title", children: "Inputs" }),
            /* @__PURE__ */ jsxs6("div", { className: "midi-settings-device-list", children: [
              state.devices.map((device) => /* @__PURE__ */ jsxs6("label", { className: "midi-settings-device", children: [
                /* @__PURE__ */ jsx7(
                  "input",
                  {
                    type: "checkbox",
                    checked: selectedDeviceIdSet.has(device.id),
                    onChange: (event) => onToggleDevice(device.id, event.currentTarget.checked)
                  }
                ),
                /* @__PURE__ */ jsx7("span", { children: device.label }),
                /* @__PURE__ */ jsx7("small", { children: device.state })
              ] }, device.id)),
              missingSelectedDeviceIds.map((deviceId) => /* @__PURE__ */ jsxs6("label", { className: "midi-settings-device midi-settings-device-missing", children: [
                /* @__PURE__ */ jsx7(
                  "input",
                  {
                    type: "checkbox",
                    checked: true,
                    onChange: (event) => onToggleDevice(deviceId, event.currentTarget.checked)
                  }
                ),
                /* @__PURE__ */ jsx7("span", { children: deviceId }),
                /* @__PURE__ */ jsx7("small", { children: "missing" })
              ] }, deviceId))
            ] }),
            /* @__PURE__ */ jsx7("h3", { className: "midi-settings-section-title", children: "Outputs" }),
            /* @__PURE__ */ jsxs6("div", { className: "midi-settings-device-list", children: [
              state.outputDevices.map((device) => /* @__PURE__ */ jsxs6("label", { className: "midi-settings-device", children: [
                /* @__PURE__ */ jsx7(
                  "input",
                  {
                    type: "checkbox",
                    checked: selectedOutputDeviceIdSet.has(device.id),
                    onChange: (event) => onToggleOutputDevice(device.id, event.currentTarget.checked)
                  }
                ),
                /* @__PURE__ */ jsx7("span", { children: device.label }),
                /* @__PURE__ */ jsx7("small", { children: device.state })
              ] }, device.id)),
              missingSelectedOutputDeviceIds.map((deviceId) => /* @__PURE__ */ jsxs6("label", { className: "midi-settings-device midi-settings-device-missing", children: [
                /* @__PURE__ */ jsx7("input", { type: "checkbox", checked: true, onChange: (event) => onToggleOutputDevice(deviceId, event.currentTarget.checked) }),
                /* @__PURE__ */ jsx7("span", { children: deviceId }),
                /* @__PURE__ */ jsx7("small", { children: "missing" })
              ] }, deviceId))
            ] }),
            /* @__PURE__ */ jsxs6("label", { className: "midi-settings-device midi-settings-clock-output", children: [
              /* @__PURE__ */ jsx7(
                "input",
                {
                  type: "checkbox",
                  checked: midiClockOutputEnabled,
                  onChange: (event) => onMidiClockOutputChange(event.currentTarget.checked),
                  disabled: unavailable
                }
              ),
              /* @__PURE__ */ jsx7("span", { children: "Send MIDI clock and transport" })
            ] }),
            /* @__PURE__ */ jsxs6("footer", { className: "import-modal-actions", children: [
              /* @__PURE__ */ jsx7("button", { type: "button", onClick: onClose, children: "Close" }),
              state.canRequestAccess ? /* @__PURE__ */ jsx7("button", { type: "button", onClick: onRefresh, children: refreshLabel }) : null
            ] })
          ]
        }
      )
    }
  );
}
function midiInputModalStatusLabel(status) {
  switch (status) {
    case "connected":
      return "connected";
    case "requesting":
      return "requesting";
    case "needs-permission":
      return "permission";
    case "denied":
      return "denied";
    case "unsupported":
      return "unavailable";
    case "error":
      return "check input";
    case "inactive":
    default:
      return "idle";
  }
}
function padDatePart(value) {
  return String(value).padStart(2, "0");
}
function patchToDspKey(patch) {
  return JSON.stringify(patch);
}
function stripPatchForDsp(patch) {
  const includesPositionBasedRuntimeContainer = patch.nodes.some((node) => (node.type === "Spread" || node.type === "Spawn") && !node.spreadNodeIds);
  return {
    nodes: patch.nodes.map((node) => stripPatchNodeForDsp(node, includesPositionBasedRuntimeContainer)),
    links: patch.links.map((link) => ({
      from: { ...link.from },
      to: { ...link.to },
      weight: link.weight,
      mode: link.mode,
      ...link.enabled === false ? { enabled: false } : {},
      ...link.weightModulations?.length ? { weightModulations: link.weightModulations } : {}
    }))
  };
}
function classifyDspErrors(errors2, patch) {
  const diagnostics = {
    nodeErrors: /* @__PURE__ */ new Map(),
    edgeErrors: /* @__PURE__ */ new Map(),
    globalErrors: []
  };
  const nodeById = new Set(patch.nodes.map((node) => node.id));
  const nodeIdsByType = /* @__PURE__ */ new Map();
  for (const node of patch.nodes) {
    nodeIdsByType.set(node.type, [...nodeIdsByType.get(node.type) ?? [], node.id]);
  }
  for (const error of errors2) {
    let localized = false;
    const explicitNodeId = extractDspErrorNodeId(error);
    if (explicitNodeId && nodeById.has(explicitNodeId)) {
      addDiagnostic(diagnostics.nodeErrors, explicitNodeId, error);
      localized = true;
    }
    const unsupportedType = error.match(/^Node type "([^"]+)"/)?.[1];
    if (unsupportedType) {
      for (const nodeId of nodeIdsByType.get(unsupportedType) ?? []) {
        addDiagnostic(diagnostics.nodeErrors, nodeId, error);
        localized = true;
      }
    }
    for (const edgeKey of edgeKeysForDspError(error, patch)) {
      addDiagnostic(diagnostics.edgeErrors, edgeKey, error);
      localized = true;
    }
    if (!localized) diagnostics.globalErrors.push(error);
  }
  return diagnostics;
}
function extractDspErrorNodeId(error) {
  return error.match(/^(?:Expression node|Audio Out node|Node) "([^"]+)"/)?.[1] ?? error.match(/^Link (?:source|target) node "([^"]+)"/)?.[1] ?? error.match(/ on node "([^"]+)"/)?.[1] ?? null;
}
function edgeKeysForDspError(error, patch) {
  const formattedLink = error.match(/^Link "([^"]+)"/)?.[1];
  if (formattedLink) {
    const key = edgeKeyFromFormattedLink(formattedLink);
    return key ? [key] : [];
  }
  const sourceNode = error.match(/^Link source node "([^"]+)"/)?.[1];
  if (sourceNode) {
    return patch.links.filter((link) => link.from.node === sourceNode).map(edgeId);
  }
  const targetNode = error.match(/^Link target node "([^"]+)"/)?.[1];
  if (targetNode) {
    return patch.links.filter((link) => link.to.node === targetNode).map(edgeId);
  }
  const unsupportedOutput = error.match(/^Node "([^"]+)" does not have supported output "([^"]+)"/);
  if (unsupportedOutput) {
    const [, nodeId, port] = unsupportedOutput;
    return patch.links.filter((link) => link.from.node === nodeId && link.from.port === port).map(edgeId);
  }
  return [];
}
function edgeKeyFromFormattedLink(value) {
  const match = value.match(/^(.+):([^:]+) -> (.+):([^:]+)$/);
  if (!match) return null;
  const [, fromNode, fromPort, toNode, toPort] = match;
  return edgeId({
    from: { node: fromNode, port: fromPort },
    to: { node: toNode, port: toPort }
  });
}
function addDiagnostic(map, key, error) {
  map.set(key, [...map.get(key) ?? [], error]);
}
function reuseUnchangedNodePresentations(previousNodes, nextNodes) {
  const previousById = new Map(previousNodes.map((node) => [node.id, node]));
  return nextNodes.map((nextNode) => {
    const previousNode = previousById.get(nextNode.id);
    return previousNode && shallowEqualFlowNodePresentation(previousNode, nextNode) ? previousNode : nextNode;
  });
}
function shallowEqualFlowNodePresentation(left, right) {
  const leftRecord = left;
  const rightRecord = right;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!(key in rightRecord)) return false;
    if (key === "data") {
      if (!shallowEqualRecord(
        leftRecord.data,
        rightRecord.data
      )) return false;
    } else if (leftRecord[key] !== rightRecord[key]) {
      return false;
    }
  }
  return true;
}
function shallowEqualRecord(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => key in right && shallowEqualPresentationValue(left[key], right[key]));
}
function shallowEqualPresentationValue(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => key in right && left[key] === right[key]);
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}
function stripPatchNodeForDsp(node, includeLayout) {
  return {
    id: node.id,
    type: node.type,
    ...node.subpatchName ? { subpatchName: node.subpatchName } : {},
    ...node.subpatchCloneId ? { subpatchCloneId: node.subpatchCloneId } : {},
    ...node.subpatchUiOverrides ? { subpatchUiOverrides: structuredClone(node.subpatchUiOverrides) } : {},
    ...node.expression !== void 0 ? { expression: node.expression } : {},
    ...node.sample ? { sample: { ...node.sample } } : {},
    ...node.image ? { image: { ...node.image } } : {},
    ...node.customWave ? { customWave: normalizeCustomWave(node.customWave, node.params) } : {},
    params: { ...node.params },
    // Canvas coordinates normally are editor-only. Unlocked runtime containers
    // are the exception: their membership is calculated from these bounds.
    ...includeLayout && node.position ? { position: { ...node.position } } : {},
    ...includeLayout && (node.type === "Spread" || node.type === "Spawn") && node.scopeSize ? { scopeSize: { ...node.scopeSize } } : {},
    ...node.spreadNodeIds ? { spreadNodeIds: [...node.spreadNodeIds] } : {},
    ...node.inputs ? { inputs: node.inputs.map((port) => ({ ...port })) } : {},
    ...node.outputs ? { outputs: node.outputs.map((port) => ({ ...port })) } : {},
    ...node.subpatch ? { subpatch: stripPatchForDsp(node.subpatch) } : {},
    ...node.enabled === false ? { enabled: false } : {}
  };
}
function collectSubpatchImportCandidates(patch) {
  const candidates = [];
  function visit(currentPatch, pathParts) {
    currentPatch.nodes.forEach((node, index) => {
      if (node.type !== "Group" || !node.subpatch) return;
      const name = node.subpatchName ?? node.id;
      const path = [...pathParts, name];
      const inputCount = boundaryPortDefinitions(node.subpatch, "Ins", "outputs").length;
      const outputCount = boundaryPortDefinitions(node.subpatch, "Outs", "inputs").length;
      candidates.push({
        key: `${path.join("/")}:${node.id}:${index}`,
        name,
        path: path.join(" / "),
        subpatch: node.subpatch,
        inputCount,
        outputCount,
        nodeCount: node.subpatch.nodes.length
      });
      visit(node.subpatch, path);
    });
  }
  visit(patch, []);
  return candidates;
}
async function buildLocalSubpatchImportEntries(patches) {
  const sourcesBySubpatchName = /* @__PURE__ */ new Map();
  const versionTasks = patches.flatMap((patchEntry) => patchEntry.versions.map(async (version) => {
    const patch = parsePatchJson(await fetchLocalPatchVersion(patchEntry.name, version.id));
    collectSubpatchImportCandidates(patch).forEach((candidate) => {
      const key = `${patchEntry.name}/${version.id}/${candidate.key}`;
      const source = {
        key,
        patchName: patchEntry.name,
        versionId: version.id,
        savedAt: version.savedAt,
        candidate: {
          ...candidate,
          key,
          path: `${patchEntry.name} / ${formatSavedPatchTimestamp(version.savedAt)} / ${candidate.path}`
        }
      };
      const sources = sourcesBySubpatchName.get(candidate.name);
      if (sources) {
        sources.push(source);
      } else {
        sourcesBySubpatchName.set(candidate.name, [source]);
      }
    });
  }));
  await Promise.all(versionTasks);
  return Array.from(sourcesBySubpatchName.entries()).map(([name, sources]) => ({
    name,
    sources: sources.sort(compareLocalSubpatchSources)
  })).sort((a, b) => a.name.localeCompare(b.name));
}
function compareLocalSubpatchSources(a, b) {
  const savedAtDelta = Date.parse(b.savedAt) - Date.parse(a.savedAt);
  if (Number.isFinite(savedAtDelta) && savedAtDelta !== 0) return savedAtDelta;
  const patchNameDelta = a.patchName.localeCompare(b.patchName);
  if (patchNameDelta !== 0) return patchNameDelta;
  return b.versionId.localeCompare(a.versionId);
}
function flowPositionForNewImport(reactFlow, nodes) {
  if (reactFlow) {
    return reactFlow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    });
  }
  if (nodes.length === 0) return { x: 0, y: 0 };
  const bounds = nodeBounds(nodes);
  return { x: bounds.x + bounds.width + 180, y: bounds.y };
}
function loadInitialEditorState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return parsed;
  } catch {
    return null;
  }
}
function loadStoredViewport() {
  try {
    const raw = window.localStorage.getItem(VIEWPORT_STORAGE_KEY);
    if (!raw) return null;
    const viewport = JSON.parse(raw);
    if (!Number.isFinite(Number(viewport.x)) || !Number.isFinite(Number(viewport.y)) || !Number.isFinite(Number(viewport.zoom))) return null;
    return {
      x: Number(viewport.x),
      y: Number(viewport.y),
      zoom: Math.max(MIN_CANVAS_ZOOM, Number(viewport.zoom))
    };
  } catch {
    return null;
  }
}
function storeViewport(viewport) {
  try {
    window.localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(viewport));
  } catch {
  }
}
function patchWithMidiControlVisuals(patch, visuals) {
  if (Object.keys(visuals).length === 0) return patch;
  let changed = false;
  const nodes = patch.nodes.map((node) => {
    const visual = visuals[node.id];
    if (!visual) return node;
    if (node.type === "Slider" && visual.sliderValue !== void 0) {
      changed = true;
      return {
        ...node,
        params: {
          ...node.params,
          value: clampNumber2(visual.sliderValue, 0, 1)
        }
      };
    }
    if (node.type === "Joystick" && (visual.joystickX !== void 0 || visual.joystickY !== void 0)) {
      changed = true;
      return {
        ...node,
        params: {
          ...node.params,
          ...visual.joystickX !== void 0 ? { x: clampNumber2(visual.joystickX, 0, 1) } : {},
          ...visual.joystickY !== void 0 ? { y: clampNumber2(visual.joystickY, 0, 1) } : {}
        }
      };
    }
    if (node.type === "Button" && visual.buttonPressed !== void 0) {
      const mode = clampInteger(node.params.mode ?? 0, 0, 2);
      if (mode === 1) return node;
      changed = true;
      return {
        ...node,
        params: {
          ...node.params,
          pressed: visual.buttonPressed >= 0.5 ? 1 : 0
        }
      };
    }
    return node;
  });
  return changed ? { ...patch, nodes } : patch;
}
function midiControlVisualsForChange(current, nodes, edges, controlChange) {
  let next = current;
  for (const node of nodes) {
    const patchNode = node.data.patchNode;
    if (patchNode.type !== "Slider" && patchNode.type !== "Joystick" && patchNode.type !== "Button") continue;
    if (patchNode.type === "Joystick") {
      const previous2 = next[patchNode.id] ?? {};
      const xMatches = clampInteger(patchNode.params.xMidiChannel ?? 0, 0, 16) === controlChange.channel && clampInteger(patchNode.params.xMidiCc ?? 1, 0, 127) === controlChange.cc;
      const yMatches = clampInteger(patchNode.params.yMidiChannel ?? 0, 0, 16) === controlChange.channel && clampInteger(patchNode.params.yMidiCc ?? 2, 0, 127) === controlChange.cc;
      if (!xMatches && !yMatches) continue;
      next = setMidiControlVisual(next, patchNode.id, {
        ...previous2,
        ...xMatches ? { joystickX: clampNumber2(controlChange.value, 0, 1) } : {},
        ...yMatches ? { joystickY: clampNumber2(controlChange.value, 0, 1) } : {}
      });
      continue;
    }
    const channel = clampInteger(patchNode.params.midiChannel ?? 0, 0, 16);
    const cc = clampInteger(patchNode.params.midiCc ?? 1, 0, 127);
    if (channel === 0 || channel !== controlChange.channel || cc !== controlChange.cc) continue;
    if (patchNode.type === "Slider") {
      if (nodeInputIsConnected(edges, patchNode.id, "value")) continue;
      next = setMidiControlVisual(next, patchNode.id, {
        ...next[patchNode.id] ?? {},
        sliderValue: clampNumber2(controlChange.value, 0, 1),
        lastRawValue: controlChange.value
      });
      continue;
    }
    const previous = next[patchNode.id] ?? {};
    const rawPressed = controlChange.value >= 0.5;
    const rawWasPressed = (previous.lastRawValue ?? 0) >= 0.5;
    const mode = clampInteger(patchNode.params.mode ?? 0, 0, 2);
    const currentPressed = previous.buttonPressed ?? patchNode.params.pressed ?? 0;
    let buttonPressed = currentPressed;
    if (mode === 0) {
      buttonPressed = rawPressed && !rawWasPressed ? currentPressed >= 0.5 ? 0 : 1 : currentPressed;
    } else {
      buttonPressed = rawPressed ? 1 : 0;
    }
    next = setMidiControlVisual(next, patchNode.id, {
      ...previous,
      buttonPressed,
      lastRawValue: controlChange.value
    });
  }
  for (const node of nodes) {
    const group = node.data.patchNode;
    if (group.type !== "Group" || !group.subpatch) continue;
    const layout = groupUiPreviewLayout(group.subpatch);
    if (!layout) continue;
    for (const innerNode of layout.nodes) {
      if (innerNode.type !== "Slider" && innerNode.type !== "Joystick" && innerNode.type !== "Button") continue;
      const previewId = `__group_ui__${node.id}__${innerNode.id}`;
      const params = { ...innerNode.params, ...group.subpatchUiOverrides?.[innerNode.id]?.params };
      const previous = next[previewId] ?? {};
      if (innerNode.type === "Joystick") {
        const xMatches = clampInteger(params.xMidiChannel ?? 0, 0, 16) === controlChange.channel && clampInteger(params.xMidiCc ?? 1, 0, 127) === controlChange.cc;
        const yMatches = clampInteger(params.yMidiChannel ?? 0, 0, 16) === controlChange.channel && clampInteger(params.yMidiCc ?? 2, 0, 127) === controlChange.cc;
        if (!xMatches && !yMatches) continue;
        next = setMidiControlVisual(next, previewId, {
          ...previous,
          ...xMatches ? { joystickX: clampNumber2(controlChange.value, 0, 1) } : {},
          ...yMatches ? { joystickY: clampNumber2(controlChange.value, 0, 1) } : {}
        });
        continue;
      }
      const channel = clampInteger(params.midiChannel ?? 0, 0, 16);
      const cc = clampInteger(params.midiCc ?? 1, 0, 127);
      if (channel === 0 || channel !== controlChange.channel || cc !== controlChange.cc) continue;
      if (innerNode.type === "Slider") {
        if (patchInputIsConnected(group.subpatch.links, innerNode.id, "value")) continue;
        next = setMidiControlVisual(next, previewId, {
          ...previous,
          sliderValue: clampNumber2(controlChange.value, 0, 1),
          lastRawValue: controlChange.value
        });
        continue;
      }
      const rawPressed = controlChange.value >= 0.5;
      const rawWasPressed = (previous.lastRawValue ?? 0) >= 0.5;
      const mode = clampInteger(params.mode ?? 0, 0, 2);
      const currentPressed = previous.buttonPressed ?? params.pressed ?? 0;
      const buttonPressed = mode === 0 ? rawPressed && !rawWasPressed ? currentPressed >= 0.5 ? 0 : 1 : currentPressed : rawPressed ? 1 : 0;
      next = setMidiControlVisual(next, previewId, {
        ...previous,
        buttonPressed,
        lastRawValue: controlChange.value
      });
    }
  }
  return next;
}
function applyMidiControlChangeToNodes(nodes, edges, controlChange, previousVisuals, nextVisuals) {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    const patchNode = node.data.patchNode;
    if (patchNode.type !== "Slider" && patchNode.type !== "Joystick" && patchNode.type !== "Button") return node;
    const visual = nextVisuals[patchNode.id];
    if (!visual) return node;
    let params = null;
    if (patchNode.type === "Slider") {
      const matches = clampInteger(patchNode.params.midiChannel ?? 0, 0, 16) === controlChange.channel && clampInteger(patchNode.params.midiCc ?? 1, 0, 127) === controlChange.cc;
      if (matches && !nodeInputIsConnected(edges, patchNode.id, "value") && visual.sliderValue !== void 0) {
        params = { ...patchNode.params, value: clampNumber2(visual.sliderValue, 0, 1) };
      }
    } else if (patchNode.type === "Joystick") {
      const xMatches = clampInteger(patchNode.params.xMidiChannel ?? 0, 0, 16) === controlChange.channel && clampInteger(patchNode.params.xMidiCc ?? 1, 0, 127) === controlChange.cc;
      const yMatches = clampInteger(patchNode.params.yMidiChannel ?? 0, 0, 16) === controlChange.channel && clampInteger(patchNode.params.yMidiCc ?? 2, 0, 127) === controlChange.cc;
      if (xMatches || yMatches) {
        params = {
          ...patchNode.params,
          ...xMatches && visual.joystickX !== void 0 ? { x: clampNumber2(visual.joystickX, 0, 1) } : {},
          ...yMatches && visual.joystickY !== void 0 ? { y: clampNumber2(visual.joystickY, 0, 1) } : {}
        };
      }
    } else {
      const matches = clampInteger(patchNode.params.midiChannel ?? 0, 0, 16) === controlChange.channel && clampInteger(patchNode.params.midiCc ?? 1, 0, 127) === controlChange.cc;
      if (matches) {
        const mode = clampInteger(patchNode.params.mode ?? 0, 0, 2);
        if (mode === 1) {
          const previousRaw = previousVisuals[patchNode.id]?.lastRawValue ?? 0;
          if (controlChange.value >= 0.5 && previousRaw < 0.5) {
            params = { ...patchNode.params, clicks: (patchNode.params.clicks ?? 0) + 1 };
          }
        } else if (visual.buttonPressed !== void 0) {
          params = { ...patchNode.params, pressed: visual.buttonPressed >= 0.5 ? 1 : 0 };
        }
      }
    }
    if (!params) return node;
    changed = true;
    return {
      ...node,
      data: {
        ...node.data,
        patchNode: { ...patchNode, params }
      }
    };
  });
  return changed ? nextNodes : nodes;
}
function setMidiControlVisual(current, nodeId, visual) {
  const previous = current[nodeId];
  if (previous?.sliderValue === visual.sliderValue && previous?.joystickX === visual.joystickX && previous?.joystickY === visual.joystickY && previous?.buttonPressed === visual.buttonPressed && previous?.lastRawValue === visual.lastRawValue) {
    return current;
  }
  return { ...current, [nodeId]: visual };
}
function clearJoystickMidiVisual(current, nodeId, clearX, clearY) {
  const visual = current[nodeId];
  if (!visual) return current;
  const nextVisual = { ...visual };
  if (clearX) delete nextVisual.joystickX;
  if (clearY) delete nextVisual.joystickY;
  return { ...current, [nodeId]: nextVisual };
}
function clearMidiControlVisual(current, nodeId, type) {
  const visual = current[nodeId];
  if (!visual) return current;
  const nextVisual = { ...visual };
  if (type === "Slider") delete nextVisual.sliderValue;
  else delete nextVisual.buttonPressed;
  return { ...current, [nodeId]: nextVisual };
}
function isEdgeConnectedToSelectedNode(edge, selectedNodeIds) {
  return selectedNodeIds.has(edge.source) || !edge.data?.modulatesEdgeId && selectedNodeIds.has(edge.target);
}
function routingSelectionHighlights(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node.data.patchNode]));
  const nodeIds = /* @__PURE__ */ new Set();
  const edgeIds = /* @__PURE__ */ new Set();
  const forwardNumbers = /* @__PURE__ */ new Set();
  const backwardNumbers = /* @__PURE__ */ new Set();
  const forwardEdges = /* @__PURE__ */ new Set();
  const backwardEdges = /* @__PURE__ */ new Set();
  for (const node of nodes) {
    if (node.selected !== true) continue;
    const patchNode = node.data.patchNode;
    if (patchNode.type === "Send") forwardNumbers.add(routingNodeNumber2(patchNode.params.number));
    if (patchNode.type === "Receive") backwardNumbers.add(routingNodeNumber2(patchNode.params.number));
    for (const edge of edges) {
      const link = edgeEndpoints(edge);
      if (!link) continue;
      if (link.from.node === node.id) forwardEdges.add(edge.id);
      if (!edge.data?.modulatesEdgeId && link.to.node === node.id) backwardEdges.add(edge.id);
    }
  }
  for (const edge of edges) {
    if (edge.selected === true) {
      forwardEdges.add(edge.id);
      backwardEdges.add(edge.id);
    }
  }
  let changed = true;
  while (changed) {
    const previousNodeCount = nodeIds.size;
    const previousEdgeCount = forwardEdges.size + backwardEdges.size;
    const previousForwardCount = forwardNumbers.size;
    const previousBackwardCount = backwardNumbers.size;
    for (const edge of edges) {
      if (edge.data?.modulatesEdgeId && backwardEdges.has(edge.data.modulatesEdgeId)) {
        backwardEdges.add(edge.id);
      }
      if (edge.data?.modulatesEdgeId && forwardEdges.has(edge.id)) {
        forwardEdges.add(edge.data.modulatesEdgeId);
      }
      if (!forwardEdges.has(edge.id) && !backwardEdges.has(edge.id)) continue;
      edgeIds.add(edge.id);
      const link = edgeEndpoints(edge);
      if (!link) continue;
      const source = nodeById.get(link.from.node);
      const target = nodeById.get(link.to.node);
      if (backwardEdges.has(edge.id) && source?.type === "Receive" && link.from.port === "signal") {
        nodeIds.add(source.id);
        backwardNumbers.add(routingNodeNumber2(source.params.number));
      }
      if (!edge.data?.modulatesEdgeId && forwardEdges.has(edge.id) && target?.type === "Send" && link.to.port === "signal") {
        nodeIds.add(target.id);
        forwardNumbers.add(routingNodeNumber2(target.params.number));
      }
    }
    for (const node of nodes) {
      const patchNode = node.data.patchNode;
      if (patchNode.type !== "Send" && patchNode.type !== "Receive") continue;
      const number = routingNodeNumber2(patchNode.params.number);
      for (const edge of edges) {
        const link = edgeEndpoints(edge);
        if (!link) continue;
        if (!edge.data?.modulatesEdgeId && patchNode.type === "Send" && backwardNumbers.has(number) && link.to.node === node.id && link.to.port === "signal") {
          nodeIds.add(node.id);
          backwardEdges.add(edge.id);
        }
        if (patchNode.type === "Receive" && forwardNumbers.has(number) && link.from.node === node.id && link.from.port === "signal") {
          nodeIds.add(node.id);
          forwardEdges.add(edge.id);
        }
      }
    }
    changed = nodeIds.size !== previousNodeCount || forwardEdges.size + backwardEdges.size !== previousEdgeCount || forwardNumbers.size !== previousForwardCount || backwardNumbers.size !== previousBackwardCount;
  }
  const forwardSends = new Set(nodes.filter((node) => node.selected && node.data.patchNode.type === "Send").map((node) => node.id));
  const backwardReceives = new Set(nodes.filter((node) => node.selected && node.data.patchNode.type === "Receive").map((node) => node.id));
  for (const edge of edges) {
    const link = edgeEndpoints(edge);
    if (!link) continue;
    if (!edge.data?.modulatesEdgeId && forwardEdges.has(edge.id) && link.to.port === "signal" && nodeById.get(link.to.node)?.type === "Send") forwardSends.add(link.to.node);
    if (backwardEdges.has(edge.id) && link.from.port === "signal" && nodeById.get(link.from.node)?.type === "Receive") backwardReceives.add(link.from.node);
  }
  const pairs = [];
  for (const send of nodes.filter((node) => node.data.patchNode.type === "Send")) {
    for (const receive of nodes.filter((node) => node.data.patchNode.type === "Receive")) {
      if (!forwardSends.has(send.id) && !backwardReceives.has(receive.id)) continue;
      if (routingNodeNumber2(send.data.patchNode.params.number) !== routingNodeNumber2(receive.data.patchNode.params.number)) continue;
      pairs.push([send.id, receive.id]);
    }
  }
  return { nodeIds, edgeIds, pairs };
}
function routingNodeNumber2(value) {
  return clampInteger(value ?? 1, 1, 10);
}
function nodeInputIsConnected(edges, nodeId, port) {
  return edges.some((edge) => {
    const link = linkFromEdge(edge);
    return link?.to.node === nodeId && link.to.port === port;
  });
}
function patchInputIsConnected(links, nodeId, port) {
  return links.some((link) => link.to.node === nodeId && link.to.port === port);
}
function clampInteger(value, min, max) {
  return Math.round(clampNumber2(Number.isFinite(value) ? value : min, min, max));
}
function graphSnapshot(nodes, edges, areas = []) {
  const state = flowToEditorState(nodes, edges);
  return {
    nodes: state.nodes,
    edges: state.edges,
    areas: structuredClone(areas)
  };
}
function graphSnapshotKey(snapshot) {
  return JSON.stringify(snapshot);
}
function samePortDefinitions(left, right) {
  if (left.length !== right.length) return false;
  return left.every((port, index) => port.name === right[index]?.name && port.defaultValue === right[index]?.defaultValue && port.connectable === right[index]?.connectable && port.valueEditor === right[index]?.valueEditor && port.min === right[index]?.min && port.max === right[index]?.max && port.integer === right[index]?.integer);
}
function restoreGraphSnapshot(snapshot, setNodes, setEdges, setAreas) {
  const state = { version: 1, nodes: snapshot.nodes, edges: snapshot.edges, areas: snapshot.areas };
  const callbacks = nodeCallbacksPlaceholder();
  setNodes(editorStateToFlowNodes(state, callbacks, null));
  setEdges(editorStateToFlowEdges(state, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder));
  setAreas(snapshot.areas ? structuredClone(snapshot.areas) : []);
}
function linkFromConnection(connection, mode = "set") {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return null;
  const edge = {
    id: "",
    source: connection.source,
    sourceHandle: connection.sourceHandle,
    target: connection.target,
    targetHandle: connection.targetHandle,
    data: { mode }
  };
  return linkFromEdge(edge);
}
function linkForDraftNodeConnection(connection, nodeId) {
  const originPort = parseHandleId(connection.originHandleId);
  if (!originPort) return null;
  if (connection.originHandleType === "source") {
    return {
      from: { node: connection.originNodeId, port: originPort.port },
      to: { node: nodeId, port: "value" },
      weight: 1,
      mode: connection.mode
    };
  }
  return {
    from: { node: nodeId, port: "value" },
    to: { node: connection.originNodeId, port: originPort.port },
    weight: 1,
    mode: connection.mode
  };
}
function parseHandleId(handleId) {
  const [kind, port] = handleId.split(":");
  if (kind !== "in" && kind !== "out" || !port) return null;
  return { kind, port };
}
function clientPointFromEvent(event) {
  if ("touches" in event) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return { x: event.clientX, y: event.clientY };
}
function nodeHandleAtScreenPoint(point) {
  for (const handle of document.querySelectorAll(".react-flow__handle")) {
    const bounds = handle.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    if (point.x < bounds.left - 8 || point.x > bounds.right + 8 || point.y < bounds.top - 8 || point.y > bounds.bottom + 8) continue;
    const nodeId = handle.getAttribute("data-nodeid");
    const handleId = handle.getAttribute("data-handleid");
    if (nodeId && handleId) return { nodeId, handleId };
  }
  return null;
}
function strengthTargetIsAllowed(edgeId2, targetId, edges) {
  const visited = /* @__PURE__ */ new Set([edgeId2]);
  let target = edges.find((edge) => edge.id === targetId);
  while (target) {
    if (visited.has(target.id)) return false;
    visited.add(target.id);
    target = target.data?.modulatesEdgeId ? edges.find((edge) => edge.id === target.data?.modulatesEdgeId) : void 0;
  }
  return true;
}
function linkAtScreenPoint(point, edges) {
  if (nodeHandleAtScreenPoint(point)) return null;
  const edgeIds = new Set(edges.map((edge) => edge.id));
  for (const element of document.elementsFromPoint(point.x, point.y)) {
    const edgeElement = element.closest(".react-flow__edge[data-id]");
    const id = edgeElement?.getAttribute("data-id");
    if (id && edgeIds.has(id)) return id;
  }
  let nearestId = null;
  let nearestDistanceSquared = 14 * 14;
  for (const path of document.querySelectorAll(".react-flow__edge[data-id] path.shader-edge-path-foreground")) {
    const id = path.closest(".react-flow__edge[data-id]")?.getAttribute("data-id");
    if (!id || !edgeIds.has(id)) continue;
    const bounds = path.getBoundingClientRect();
    if (point.x < bounds.left - 14 || point.x > bounds.right + 14 || point.y < bounds.top - 14 || point.y > bounds.bottom + 14) continue;
    const transform = path.getScreenCTM();
    if (!transform) continue;
    const length = path.getTotalLength();
    const screenScale = Math.hypot(transform.a, transform.b);
    const steps = Math.min(512, Math.max(12, Math.ceil(length * screenScale / 10)));
    for (let step = 0; step <= steps; step += 1) {
      const sample = path.getPointAtLength(length * step / steps).matrixTransform(transform);
      const distanceSquared = (sample.x - point.x) ** 2 + (sample.y - point.y) ** 2;
      if (distanceSquared < nearestDistanceSquared) {
        nearestDistanceSquared = distanceSquared;
        nearestId = id;
      }
    }
  }
  return nearestId;
}
function isCommandModifierPressed(event) {
  return event.metaKey || event.ctrlKey || event.shiftKey;
}
function isReconnectDuplicateModifierPressed(event) {
  return event.metaKey || event.ctrlKey || event.altKey;
}
function isDuplicateModifierPressed(event) {
  return event instanceof MouseEvent ? event.altKey : false;
}
function samePatchLink(a, b) {
  return a.from.node === b.from.node && a.from.port === b.from.port && a.to.node === b.to.node && a.to.port === b.to.port;
}
function materializeRootGraph(activeNodes, activeEdges, activeAreas, editingStack, activePatchName) {
  if (editingStack.length === 0) {
    return { nodes: activeNodes, edges: activeEdges };
  }
  let subpatch = patchFromFlow(activeNodes, activeEdges, activeAreas);
  let requestedGroupName = activePatchName;
  let materialized = null;
  for (let index = editingStack.length - 1; index >= 0; index -= 1) {
    const frame = editingStack[index];
    materialized = applySubpatchToParent(frame, subpatch, requestedGroupName);
    subpatch = patchFromFlow(materialized.nodes, materialized.edges, frame.parentAreas);
    requestedGroupName = frame.parentPatchName;
  }
  return materialized ?? { nodes: activeNodes, edges: activeEdges };
}
function applySubpatchToParent(frame, subpatch, requestedGroupName) {
  const inputDefinitions = boundaryPortDefinitions(subpatch, "Ins", "outputs");
  const outputDefinitions = boundaryPortDefinitions(subpatch, "Outs", "inputs").map((port) => ({
    name: port.name,
    ...port.connectable === void 0 ? {} : { connectable: port.connectable },
    ...port.min === void 0 ? {} : { min: port.min },
    ...port.max === void 0 ? {} : { max: port.max },
    ...port.integer === void 0 ? {} : { integer: port.integer }
  }));
  const groupNode = frame.parentNodes.find((node) => node.id === frame.groupId);
  if (!groupNode) {
    return { nodes: frame.parentNodes, edges: frame.parentEdges };
  }
  const cloneId = groupNode.data.patchNode.subpatchCloneId;
  const linkedGroupIds = new Set(
    frame.parentNodes.filter((node) => node.data.patchNode.type === "Group" && cloneId !== void 0 && node.data.patchNode.subpatchCloneId === cloneId).map((node) => node.id)
  );
  linkedGroupIds.add(frame.groupId);
  const nextSubpatchName = normalizeSubpatchName(requestedGroupName, groupNode.data.patchNode.subpatchName ?? frame.groupId);
  const inputNames = new Set(inputDefinitions.map((port) => port.name));
  const outputNames = new Set(outputDefinitions.map((port) => port.name));
  const nodes = frame.parentNodes.map((node) => {
    if (!linkedGroupIds.has(node.id)) return { ...node, selected: false };
    const previousPatchNode = node.data.patchNode;
    const previousParams = previousPatchNode.params;
    const previousInputs = new Map((previousPatchNode.inputs ?? []).map((port) => [port.name, port]));
    const params = Object.fromEntries(inputDefinitions.map((port) => [
      port.name,
      nextGroupInputParam(previousParams, previousInputs.get(port.name), port)
    ]));
    const subpatchUiOverrides = pruneSubpatchUiOverrides(previousPatchNode.subpatchUiOverrides, subpatch);
    const { subpatchUiOverrides: _previousOverrides, ...sharedPatchNode } = previousPatchNode;
    return {
      ...node,
      selected: node.id === frame.groupId,
      data: {
        ...node.data,
        patchNode: {
          ...sharedPatchNode,
          id: node.id,
          type: "Group",
          subpatchName: nextSubpatchName,
          subpatchCloneId: node.data.patchNode.subpatchCloneId ?? cloneId ?? makeSubpatchCloneId(node.id),
          params,
          inputs: inputDefinitions,
          outputs: outputDefinitions,
          subpatch: clonePatch(subpatch),
          ...subpatchUiOverrides ? { subpatchUiOverrides } : {}
        }
      }
    };
  });
  const edges = dedupeEdges(frame.parentEdges.flatMap((edge) => {
    const link = linkFromEdge(edge);
    if (!link) return [];
    if (linkedGroupIds.has(link.to.node) && !inputNames.has(link.to.port)) return [];
    if (linkedGroupIds.has(link.from.node) && !outputNames.has(link.from.port)) return [];
    return [{ ...edge, selected: false }];
  }));
  return { nodes, edges };
}
function pruneSubpatchUiOverrides(overrides, subpatch) {
  if (!overrides) return void 0;
  const nodeIds = new Set(subpatch.nodes.map((node) => node.id));
  const retained = Object.fromEntries(Object.entries(overrides).filter(([nodeId]) => nodeIds.has(nodeId)));
  return Object.keys(retained).length > 0 ? retained : void 0;
}
function emptySubpatchForGroup(groupNode, position) {
  return {
    nodes: [
      {
        id: "ins_1",
        type: "Ins",
        params: Object.fromEntries((groupNode.inputs ?? []).map((port) => [
          port.name,
          groupNode.params[port.name] ?? port.defaultValue ?? 0
        ])),
        outputs: groupNode.inputs?.map((port) => ({
          ...port,
          defaultValue: groupNode.params[port.name] ?? port.defaultValue ?? 0
        })) ?? [],
        position: { x: position.x - 220, y: position.y }
      },
      {
        id: "outs_1",
        type: "Outs",
        params: {},
        inputs: groupNode.outputs?.map((port) => ({ ...port, defaultValue: void 0 })) ?? [],
        position: { x: position.x + 220, y: position.y }
      }
    ],
    links: []
  };
}
function boundaryPortDefinitions(patch, boundaryType, side) {
  const usedNames = /* @__PURE__ */ new Set();
  const definitions = [];
  for (const node of patch.nodes) {
    if (node.type !== boundaryType) continue;
    for (const port of node[side] ?? []) {
      if (usedNames.has(port.name)) continue;
      usedNames.add(port.name);
      definitions.push({
        ...port,
        ...boundaryType === "Ins" && side === "outputs" ? { defaultValue: node.params[port.name] ?? port.defaultValue ?? 0 } : {}
      });
    }
  }
  return definitions;
}
function nextGroupInputParam(previousParams, previousInput, nextInput) {
  const nextDefault = nextInput.defaultValue ?? 0;
  const previousValue = previousParams[nextInput.name];
  if (previousValue === void 0) return nextDefault;
  if (previousValue === (previousInput?.defaultValue ?? 0)) return nextDefault;
  return previousValue;
}
function groupSelectedGraph(nodes, edges, onWeightChange, onModeChange, onInsertNode) {
  const selectedNodes = nodes.filter((node) => node.selected);
  if (!selectedNodes.length || selectedNodes.some((node) => node.data.patchNode.type === null)) return null;
  const selected = new Set(selectedNodes.map((node) => node.id));
  const groupId = makeNodeId("Group", new Set(nodes.map((node) => node.id)));
  const bounds = nodeBounds(selectedNodes);
  const position = { x: bounds.x, y: bounds.y };
  const boundaryIds = new Set(selected);
  const insId = makeNodeId("Ins", boundaryIds);
  boundaryIds.add(insId);
  const outsId = makeNodeId("Outs", boundaryIds);
  const inputs2 = [];
  const outputs = [];
  const inputBySource = /* @__PURE__ */ new Map();
  const outputBySource = /* @__PURE__ */ new Map();
  const inside = [];
  const outside = [];
  const replacements = /* @__PURE__ */ new Map();
  const makeEdge = (link) => edgeFromLink(link, onWeightChange, onModeChange, onInsertNode);
  const portName = (base, ports) => {
    const readable = base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
    let name = readable || "signal";
    let suffix = 2;
    while (ports.some((port) => port.name === name)) name = `${readable} ${suffix++}`;
    return name;
  };
  for (const edge of edges) {
    const link = edgeEndpoints(edge);
    if (!link) continue;
    const sourceInside = selected.has(edge.source);
    const targetInside = selected.has(edge.target);
    let from = link.from;
    if (sourceInside !== targetInside) {
      const key = endpointKey(link.from);
      if (targetInside) {
        let port = inputBySource.get(key);
        if (!port) {
          port = portName(edge.data?.modulatesEdgeId ? "strength" : link.to.port, inputs2);
          inputs2.push({ name: port, defaultValue: 0 });
          inputBySource.set(key, port);
          outside.push(makeEdge({ from: link.from, to: { node: groupId, port }, weight: 1, mode: "set" }));
        }
        from = { node: insId, port };
      } else {
        let port = outputBySource.get(key);
        if (!port) {
          port = portName(link.from.port, outputs);
          outputs.push({ name: port });
          outputBySource.set(key, port);
          inside.push(makeEdge({ from: link.from, to: { node: outsId, port }, weight: 1, mode: "set" }));
        }
        from = { node: groupId, port };
      }
    }
    const replacement = edge.data?.modulatesEdgeId ? { ...edge, source: from.node, sourceHandle: `out:${from.port}`, selected: false } : { ...makeEdge({ ...link, from }), selected: false };
    replacements.set(edge.id, replacement);
    (targetInside ? inside : outside).push(replacement);
  }
  const retarget = (edge) => {
    if (!edge.data?.modulatesEdgeId) return edge;
    const parent = replacements.get(edge.data.modulatesEdgeId);
    if (!parent) return edge;
    return {
      ...edge,
      target: parent.target,
      targetHandle: parent.targetHandle,
      data: { ...edge.data, modulatesEdgeId: parent.id }
    };
  };
  const boundaryNode = (patchNode) => ({
    id: patchNode.id,
    type: "shaderNode",
    position: patchNode.position,
    data: { patchNode, ...nodeCallbacksPlaceholder(), isTypePickerOpen: false }
  });
  const subpatchNodes = [
    boundaryNode({
      id: insId,
      type: "Ins",
      params: Object.fromEntries(inputs2.map((port) => [port.name, 0])),
      outputs: inputs2,
      position: { x: bounds.x - 220, y: bounds.y }
    }),
    ...selectedNodes,
    boundaryNode({
      id: outsId,
      type: "Outs",
      params: {},
      inputs: outputs,
      position: { x: bounds.x + bounds.width + 220, y: bounds.y }
    })
  ];
  const groupNode = boundaryNode({
    id: groupId,
    type: "Group",
    subpatchName: groupId,
    subpatchCloneId: makeSubpatchCloneId(groupId),
    position,
    params: Object.fromEntries(inputs2.map((port) => [port.name, 0])),
    inputs: inputs2,
    outputs,
    subpatch: patchFromFlow(subpatchNodes, inside.map(retarget))
  });
  return {
    nodes: [
      ...nodes.filter((node) => !selected.has(node.id)).map((node) => ({ ...node, selected: false })),
      { ...groupNode, selected: true }
    ],
    edges: dedupeEdges(outside.map(retarget))
  };
}
function edgeEndpoints(edge) {
  return linkFromEdge(edge.data?.modulatesEdgeId ? { ...edge, data: { ...edge.data, modulatesEdgeId: void 0 } } : edge);
}
function clonePatch(patch) {
  return {
    ...patch.areas ? { areas: structuredClone(patch.areas) } : {},
    nodes: patch.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      ...node.customLabel ? { customLabel: node.customLabel } : {},
      ...node.subpatchName ? { subpatchName: node.subpatchName } : {},
      ...node.subpatchCloneId ? { subpatchCloneId: node.subpatchCloneId } : {},
      ...node.subpatchUiOverrides ? { subpatchUiOverrides: structuredClone(node.subpatchUiOverrides) } : {},
      ...node.expression !== void 0 ? { expression: node.expression } : {},
      ...node.sample ? { sample: { ...node.sample } } : {},
      ...node.image ? { image: { ...node.image } } : {},
      ...node.customWave ? { customWave: normalizeCustomWave(node.customWave, node.params) } : {},
      params: { ...node.params },
      ...node.position ? { position: { ...node.position } } : {},
      ...node.scale !== void 0 ? { scale: node.scale } : {},
      ...node.scopeSize ? { scopeSize: { ...node.scopeSize } } : {},
      ...node.inputs ? { inputs: node.inputs.map((port) => ({ ...port })) } : {},
      ...node.outputs ? { outputs: node.outputs.map((port) => ({ ...port })) } : {},
      ...node.subpatch ? { subpatch: clonePatch(node.subpatch) } : {},
      ...node.compactPorts !== void 0 ? { compactPorts: node.compactPorts } : {},
      ...node.enabled === false ? { enabled: false } : {}
    })),
    links: patch.links.map((link) => ({
      from: { ...link.from },
      to: { ...link.to },
      weight: link.weight,
      mode: link.mode,
      enabled: link.enabled,
      weightModulations: link.weightModulations ? structuredClone(link.weightModulations) : void 0
    }))
  };
}
function translateExtentForVisibleContent(nodes, viewport, editorSize) {
  if (editorSize.width <= 0 || editorSize.height <= 0) {
    return FLOW_INFINITE_EXTENT;
  }
  const bounds = viewportContentBounds(nodes);
  const zoom = normalizedViewportZoom(viewport.zoom);
  const emptyWidth = editorSize.width / zoom * MAX_EMPTY_SCREEN_RATIO;
  const emptyHeight = editorSize.height / zoom * MAX_EMPTY_SCREEN_RATIO;
  return [
    [bounds.x - emptyWidth, bounds.y - emptyHeight],
    [bounds.x + bounds.width + emptyWidth, bounds.y + bounds.height + emptyHeight]
  ];
}
function clampViewportToTranslateExtent(viewport, translateExtent, editorSize) {
  if (editorSize.width <= 0 || editorSize.height <= 0) return viewport;
  const zoom = normalizedViewportZoom(viewport.zoom);
  const visibleWidth = editorSize.width / zoom;
  const visibleHeight = editorSize.height / zoom;
  const left = -viewport.x / zoom;
  const top = -viewport.y / zoom;
  const minLeft = translateExtent[0][0];
  const minTop = translateExtent[0][1];
  const maxLeft = translateExtent[1][0] - visibleWidth;
  const maxTop = translateExtent[1][1] - visibleHeight;
  const clampedLeft = clampNumber2(left, Math.min(minLeft, maxLeft), Math.max(minLeft, maxLeft));
  const clampedTop = clampNumber2(top, Math.min(minTop, maxTop), Math.max(minTop, maxTop));
  return {
    x: -clampedLeft * zoom,
    y: -clampedTop * zoom,
    zoom
  };
}
function viewportContentBounds(nodes) {
  const visibleNodes = nodes.filter((node) => node.hidden !== true);
  if (visibleNodes.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of visibleNodes) {
    const size = viewportNodeSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}
function resizedPatternScopeSize(patchNode, nextParams) {
  if (patchNode.type === "Sequencer") {
    const previous = sequencerShape(patchNode.params);
    const next = sequencerShape(nextParams);
    const labelWidth = patchNode.sequencerRowLabelColumnWidth ?? 0;
    const current = clampSequencerNodeSize(patchNode.scopeSize ?? DEFAULT_SEQUENCER_NODE_SIZE, previous.steps, previous.rows, labelWidth);
    const cellWidth = Math.max(SEQUENCER_MIN_CELL_SIZE, (current.width - labelWidth) / previous.steps);
    return clampSequencerNodeSize({ width: labelWidth + next.steps * cellWidth, height: 0 }, next.steps, next.rows, labelWidth);
  }
  if (patchNode.type === "Roll") {
    const previous = rollShape(patchNode.params);
    const next = rollShape(nextParams);
    const current = clampSequencerNodeSize(
      patchNode.scopeSize ?? { width: previous.steps * 26 + 32, height: previous.rows.length * 22 },
      previous.steps,
      previous.rows.length,
      32
    );
    const cellWidth = Math.max(SEQUENCER_MIN_CELL_SIZE, (current.width - 32) / previous.steps);
    return clampSequencerNodeSize({ width: 32 + next.steps * cellWidth, height: 0 }, next.steps, next.rows.length, 32);
  }
  return void 0;
}
function viewportNodeSize(node) {
  const measuredWidth = finitePositiveNumber(node.measured?.width ?? node.width ?? node.initialWidth);
  const measuredHeight = finitePositiveNumber(node.measured?.height ?? node.height ?? node.initialHeight);
  if (measuredWidth !== null && measuredHeight !== null) {
    return { width: measuredWidth, height: measuredHeight };
  }
  const patchNode = node.data.patchNode;
  if (patchNode.type === "Slider" || patchNode.type === "Joystick" || patchNode.type === "Button") {
    const size = clampControlNodeSize(
      patchNode.scopeSize ?? (patchNode.type === "Joystick" ? DEFAULT_JOYSTICK_NODE_SIZE : DEFAULT_SCOPE_NODE_SIZE)
    );
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }
  if (patchNode.type === "Spread" || patchNode.type === "Spawn") {
    const size = runtimeContainerSize(patchNode);
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }
  if (patchNode.type === "Scope" || patchNode.type === "Meter" || patchNode.type === "FFT") {
    const size = clampScopeNodeSize(
      patchNode.scopeSize ?? (patchNode.type === "FFT" ? DEFAULT_FFT_NODE_SIZE : DEFAULT_SCOPE_NODE_SIZE)
    );
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }
  if (patchNode.type === "Image") {
    const size = clampImageNodeSize(patchNode.scopeSize ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE, (patchNode.scopeSize?.width ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE.width) / Math.max(1, patchNode.scopeSize?.height ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE.height));
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }
  if (patchNode.type === "CustomWave" || patchNode.type === "SamplePlayer" || patchNode.type === "Buffer") {
    const size = clampCustomWaveNodeSize(patchNode.scopeSize ?? DEFAULT_CUSTOM_WAVE_NODE_SIZE);
    return { width: size.width, height: size.height + NODE_HEADER_HEIGHT };
  }
  if (patchNode.type === "Sequencer") {
    const shape = sequencerShape(patchNode.params);
    const size = clampSequencerNodeSize(
      patchNode.scopeSize ?? DEFAULT_SEQUENCER_NODE_SIZE,
      shape.steps,
      shape.rows,
      patchNode.sequencerRowLabelColumnWidth ?? 0
    );
    return {
      width: size.width,
      height: NODE_HEADER_HEIGHT + size.height + 92
    };
  }
  if (patchNode.type === "Roll") {
    const shape = rollShape(patchNode.params);
    const size = clampSequencerNodeSize(patchNode.scopeSize ?? { width: shape.steps * 26 + 32, height: shape.rows.length * 22 }, shape.steps, shape.rows.length, 32);
    return { width: size.width, height: NODE_HEADER_HEIGHT + size.height + 92 };
  }
  if (patchNode.type === "Expression") {
    return { width: 240, height: DEFAULT_NODE_BOUNDS_SIZE.height };
  }
  if (patchNode.type === null) {
    return { width: DRAFT_NODE_WIDTH, height: DEFAULT_NODE_BOUNDS_SIZE.height };
  }
  return DEFAULT_NODE_BOUNDS_SIZE;
}
function isNodeVisibleInViewport(node, viewport, editorSize) {
  if (editorSize.width <= 0 || editorSize.height <= 0) return true;
  const zoom = normalizedViewportZoom(viewport.zoom);
  const margin = 120 / zoom;
  const left = -viewport.x / zoom - margin;
  const top = -viewport.y / zoom - margin;
  const right = left + editorSize.width / zoom + margin * 2;
  const bottom = top + editorSize.height / zoom + margin * 2;
  const size = viewportNodeSize(node);
  return node.position.x + size.width >= left && node.position.x <= right && node.position.y + size.height >= top && node.position.y <= bottom;
}
function lockedAreaNodeBounds(area, nodes) {
  const containedNodeIds = new Set(area.nodeIds ?? []);
  const containedNodes = nodes.filter((node) => node.id !== area.spreadNodeId && containedNodeIds.has(node.id));
  if (containedNodes.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of containedNodes) {
    const size = viewportNodeSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}
function flowNodeIsInsideSpread(spread, node) {
  if (spread.data.patchNode.type !== "Spread" && spread.data.patchNode.type !== "Spawn" || node.id === spread.id) return false;
  if (spread.data.patchNode.spreadNodeIds) {
    return spread.data.patchNode.spreadNodeIds.includes(node.id);
  }
  const size = runtimeContainerSize(spread.data.patchNode);
  const portsHeight = runtimeContainerPortsHeight(spread.data.patchNode);
  return node.position.x >= spread.position.x && node.position.x < spread.position.x + size.width && node.position.y >= spread.position.y + NODE_HEADER_HEIGHT + portsHeight && node.position.y < spread.position.y + NODE_HEADER_HEIGHT + size.height;
}
function runtimeDspNodeIdForFlowNode(node, nodes, groupIds) {
  const container = nodes.find((candidate) => flowNodeIsInsideSpread(candidate, node));
  const nodeId = container ? spreadCloneNodeId(container.id, 0, node.id) : node.id;
  return scopedDspNodeId(nodeId, groupIds);
}
function runtimeContainerLinkIsAllowed(link, nodes) {
  const sourceNode = nodes.find((node) => node.id === link.from.node);
  const targetNode = nodes.find((node) => node.id === link.to.node);
  if ((sourceNode?.data.patchNode.type === "Spread" && link.from.port === "item index" || sourceNode?.data.patchNode.type === "Spawn" && link.from.port === "instance gate") && (!targetNode || !flowNodeIsInsideSpread(sourceNode, targetNode))) {
    return false;
  }
  if (targetNode?.data.patchNode.type === "Spawn" && link.to.port === "kill trigger" && (!sourceNode || !flowNodeIsInsideSpread(targetNode, sourceNode))) {
    return false;
  }
  if (targetNode && sourceNode && (targetNode.data.patchNode.type === "Spread" && link.to.port === "count" || targetNode.data.patchNode.type === "Spawn" && (link.to.port === "trigger" || link.to.port === "release trigger")) && flowNodeIsInsideSpread(targetNode, sourceNode)) {
    return false;
  }
  return true;
}
function normalizedViewportZoom(zoom) {
  return finitePositiveNumber(zoom) ?? USER_ZOOM_BASELINE;
}
function shouldSettleZoomToBaseline(zoom) {
  const normalizedZoom = normalizedViewportZoom(zoom);
  const distance = Math.abs(normalizedZoom - ZOOM_RESET_TARGET);
  return distance > ZOOM_CHANGE_EPSILON && distance <= ZOOM_SETTLE_THRESHOLD;
}
function formatZoomPercentage(zoom) {
  return `${Math.round(zoom / USER_ZOOM_BASELINE * 100)}%`;
}
function finitePositiveNumber(value) {
  return value !== void 0 && Number.isFinite(value) && value > 0 ? value : null;
}
function isFiniteCoordinateExtent(extent) {
  return extent.every((point) => point.every(Number.isFinite));
}
function clampNumber2(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function nodeBounds(nodes) {
  const xs = nodes.map((node) => node.position.x);
  const ys = nodes.map((node) => node.position.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}
function connectedAreaIds(areas, rootId) {
  const root = areas.find((area) => area.id === rootId);
  if (!root) return /* @__PURE__ */ new Set();
  const connected = /* @__PURE__ */ new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of areas) {
      if (connected.has(candidate.id)) continue;
      if (!areas.some((area) => connected.has(area.id) && areaContainsArea(area, candidate))) continue;
      connected.add(candidate.id);
      changed = true;
    }
  }
  return connected;
}
function nodeIdsContainedByAreaHierarchy(areas, nodes, rootId) {
  const containedAreaIds = connectedAreaIds(areas, rootId);
  const containedAreas = areas.filter((area) => containedAreaIds.has(area.id));
  return new Set(nodes.flatMap((node) => containedAreas.some((area) => areaContainsNode(area, node) || area.spreadNodeId === node.id) ? [node.id] : []));
}
function promoteNodeIdsInStackOrder(stackOrder, activeNodeIds, promotedNodeIds) {
  const activeNodeIdSet = new Set(activeNodeIds);
  const orderedActiveIds = stackOrder.filter((nodeId) => activeNodeIdSet.has(nodeId));
  const orderedActiveIdSet = new Set(orderedActiveIds);
  const completeOrder = [
    ...orderedActiveIds,
    ...activeNodeIds.filter((nodeId) => !orderedActiveIdSet.has(nodeId))
  ];
  const nextOrder = [
    ...completeOrder.filter((nodeId) => !promotedNodeIds.has(nodeId)),
    ...completeOrder.filter((nodeId) => promotedNodeIds.has(nodeId))
  ];
  return nextOrder.length === stackOrder.length && nextOrder.every((nodeId, index) => nodeId === stackOrder[index]) ? stackOrder : nextOrder;
}
function spreadAreaForNode(node) {
  const size = runtimeContainerSize(node.data.patchNode);
  const portsHeight = runtimeContainerPortsHeight(node.data.patchNode);
  const title = node.data.patchNode.type === "Spawn" ? "Spawn" : "Spread";
  return {
    id: `spread-area:${node.id}`,
    kind: "spread",
    spreadNodeId: node.id,
    title,
    position: { ...node.position },
    size: {
      width: size.width,
      height: Math.max(NODE_HEADER_HEIGHT + portsHeight + 48, NODE_HEADER_HEIGHT + size.height)
    },
    uiHeight: portsHeight,
    ...node.data.patchNode.spreadNodeIds ? {
      locked: true,
      nodeIds: [...node.data.patchNode.spreadNodeIds]
    } : {}
  };
}
function reconcileSpreadAreas(areas, nodes) {
  const spreadNodes = nodes.filter((node) => node.data.patchNode.type === "Spread" || node.data.patchNode.type === "Spawn");
  const spreadNodeIds = new Set(spreadNodes.map((node) => node.id));
  let resizedExistingSpawn = false;
  const retained = areas.flatMap((area) => {
    if (area.kind !== "spread") return [area];
    if (area.spreadNodeId === void 0 || !spreadNodeIds.has(area.spreadNodeId)) return [];
    const spawnNode = spreadNodes.find((node) => node.id === area.spreadNodeId && node.data.patchNode.type === "Spawn");
    if (!spawnNode || area.size.width >= MIN_SPAWN_WIDTH && (area.uiHeight ?? 0) >= SPAWN_PORTS_HEIGHT) return [area];
    resizedExistingSpawn = true;
    return [{
      ...area,
      size: { ...area.size, width: Math.max(area.size.width, MIN_SPAWN_WIDTH) },
      uiHeight: Math.max(area.uiHeight ?? 0, SPAWN_PORTS_HEIGHT)
    }];
  });
  const existingSpreadNodeIds = new Set(retained.flatMap((area) => area.kind === "spread" && area.spreadNodeId ? [area.spreadNodeId] : []));
  const added = spreadNodes.filter((node) => !existingSpreadNodeIds.has(node.id)).map(spreadAreaForNode);
  return retained.length === areas.length && added.length === 0 && !resizedExistingSpawn ? areas : [...retained, ...added];
}
function optionalStringArraysEqual(left, right) {
  if (left === void 0 || right === void 0) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function areaContainsPoint(area, point) {
  return point.x >= area.position.x && point.x < area.position.x + area.size.width && point.y >= area.position.y && point.y < area.position.y + area.size.height;
}
function areaContainsArea(area, candidate) {
  if (area.id === candidate.id) return false;
  return area.locked ? area.areaIds?.includes(candidate.id) === true : areaContainsPoint(area, candidate.position);
}
function areaIdsWithinBounds(areas, area) {
  return areas.filter((candidate) => candidate.id !== area.id && areaContainsPoint(area, candidate.position)).map((candidate) => candidate.id);
}
function isSurfacedControlTarget(eventTarget) {
  const target = eventTarget instanceof Element ? eventTarget : null;
  return target !== null && target.closest(".shader-node-area-ui-collapsed, .group-ui-preview") !== null;
}
function innermostAreaContainingNode(areas, node) {
  return areas.filter((area) => area.spreadNodeId === node.id || areaContainsNode(area, node)).sort((left, right) => left.size.width * left.size.height - right.size.width * right.size.height)[0];
}
function areaContainsNode(area, node) {
  return area.locked ? area.nodeIds?.includes(node.id) === true : areaContainsPoint(area, node.position);
}
function nodeIsInAreaUiSection(area, node) {
  return area.uiHeight !== void 0 && node.position.x >= area.position.x && node.position.x < area.position.x + area.size.width && node.position.y >= area.position.y + NODE_HEADER_HEIGHT && node.position.y < area.position.y + NODE_HEADER_HEIGHT + area.uiHeight;
}
function groupUiPreviewLayout(patch) {
  const controlAreas = (patch.areas ?? []).filter((area) => {
    const title = area.title.trim().toLocaleLowerCase();
    return area.kind !== "spread" && (title === "ui" || title === "controls");
  });
  if (controlAreas.length === 0) return null;
  const left = Math.min(...controlAreas.map((area) => area.position.x));
  const contentTop = Math.min(...controlAreas.map((area) => area.position.y + NODE_HEADER_HEIGHT));
  const right = Math.max(...controlAreas.map((area) => area.position.x + area.size.width));
  const bottom = Math.max(...controlAreas.map((area) => area.position.y + area.size.height));
  const nodeIds = /* @__PURE__ */ new Set();
  for (const area of controlAreas) {
    if (area.locked) {
      for (const nodeId of area.nodeIds ?? []) nodeIds.add(nodeId);
      continue;
    }
    for (const node of patch.nodes) {
      const position = node.position ?? { x: 0, y: 0 };
      if (position.x >= area.position.x && position.x < area.position.x + area.size.width && position.y >= area.position.y && position.y < area.position.y + area.size.height) nodeIds.add(node.id);
    }
  }
  const nodes = patch.nodes.filter((node) => nodeIds.has(node.id));
  const top = Math.min(
    contentTop,
    ...nodes.map((node) => node.position?.y ?? contentTop)
  );
  return {
    position: { x: left, y: top },
    size: { width: right - left, height: bottom - top },
    nodes
  };
}
function collapsedAreaInputPin(area) {
  return { x: area.position.x, y: area.position.y + NODE_HEADER_HEIGHT / 2 };
}
function collapsedAreaOutputPin(area) {
  return { x: area.position.x + area.size.width, y: area.position.y + NODE_HEADER_HEIGHT / 2 };
}
function endpointKey(endpoint) {
  return `${endpoint.node}.${endpoint.port}`;
}
function canRenameBoundaryPort(node, side) {
  return (node.type === "Ins" || node.type === "Params") && side === "output" || node.type === "Outs" && side === "input";
}
function renamePortDefinitions(ports, previousPort, nextPort) {
  return ports?.map((port) => port.name === previousPort ? { ...port, name: nextPort } : port);
}
function setPortDefaultValue(ports, portName, value) {
  return ports?.map((port) => port.name === portName ? { ...port, defaultValue: value } : port);
}
function movePortDefinitions(ports, portName, direction) {
  if (!ports) return ports;
  const fromIndex = ports.findIndex((port) => port.name === portName);
  const toIndex = fromIndex + direction;
  if (fromIndex < 0 || toIndex < 0 || toIndex >= ports.length) return ports;
  const nextPorts = ports.map((port) => ({ ...port }));
  [nextPorts[fromIndex], nextPorts[toIndex]] = [nextPorts[toIndex], nextPorts[fromIndex]];
  return nextPorts;
}
function renameParamKey(params, previousKey, nextKey) {
  if (previousKey === nextKey || params[previousKey] === void 0) return params;
  const nextParams = { ...params, [nextKey]: params[previousKey] };
  delete nextParams[previousKey];
  return nextParams;
}
function removeParamKey(params, key) {
  if (params[key] === void 0) return params;
  const nextParams = { ...params };
  delete nextParams[key];
  return nextParams;
}
function boundaryPortHasDefaultValue(node, side) {
  return (node.type === "Ins" || node.type === "Params") && side === "output";
}
function nextBoundaryPortParams(node, side, previousPort, nextPort) {
  if (boundaryPortHasDefaultValue(node, side)) {
    return renameParamKey(node.params, previousPort, nextPort);
  }
  if (node.type === "Outs" && side === "input") {
    return removeParamKey(node.params, previousPort);
  }
  return node.params;
}
function renameEdgePort(edge, nodeId, side, previousPort, nextPort) {
  if (edge.data?.modulatesEdgeId) {
    if (side === "output" && edge.source === nodeId && edge.sourceHandle === `out:${previousPort}`) {
      return { ...edge, sourceHandle: `out:${nextPort}` };
    }
    if (side === "input" && edge.target === nodeId && edge.targetHandle === `in:${previousPort}`) {
      return { ...edge, targetHandle: `in:${nextPort}` };
    }
    return edge;
  }
  const link = linkFromEdge(edge);
  if (!link) return edge;
  const weightModulations = side === "output" ? link.weightModulations?.map((modulation) => modulation.from.node === nodeId && modulation.from.port === previousPort ? { ...modulation, from: { node: nodeId, port: nextPort } } : modulation) : link.weightModulations;
  if (side === "input" && link.to.node === nodeId && link.to.port === previousPort) {
    return {
      ...edgeFromLink({ from: link.from, to: { node: nodeId, port: nextPort }, weight: link.weight, mode: link.mode, enabled: link.enabled, weightModulations }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
      selected: edge.selected
    };
  }
  if (side === "output" && link.from.node === nodeId && link.from.port === previousPort) {
    return {
      ...edgeFromLink({ from: { node: nodeId, port: nextPort }, to: link.to, weight: link.weight, mode: link.mode, enabled: link.enabled, weightModulations }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
      selected: edge.selected
    };
  }
  if (weightModulations !== link.weightModulations && weightModulations?.some((modulation, index) => modulation !== link.weightModulations?.[index])) {
    return {
      ...edgeFromLink({ ...link, weightModulations }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder),
      selected: edge.selected
    };
  }
  return edge;
}
function normalizePortName(value) {
  return value.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^[-_]+|[-_]+$/g, "");
}
function uniqueBoundaryPortName(requestedPort, currentPort, ports, preserveText = false) {
  const normalized = preserveText ? requestedPort.trim().replace(/[\u0000-\u001f\u007f-\u009f]/gu, "") : normalizePortName(requestedPort);
  if (!normalized) return null;
  if (normalized === currentPort) return currentPort;
  const usedNames = new Set(ports);
  usedNames.delete(currentPort);
  return uniquePortName(normalized, usedNames);
}
function uniquePortName(baseName, usedNames) {
  if (!usedNames.has(baseName)) return baseName;
  let index = 2;
  let candidate = `${baseName}_${index}`;
  while (usedNames.has(candidate)) {
    index += 1;
    candidate = `${baseName}_${index}`;
  }
  return candidate;
}
function isSelectorValuePortName(name) {
  return /^[1-9][0-9]*$/.test(name);
}
function selectorValueInputs(inputs2) {
  return inputs2.filter((input) => isSelectorValuePortName(input.name));
}
function selectorPortMapAfterRemoval(orderedPorts, removedIndex) {
  const portMap = /* @__PURE__ */ new Map();
  orderedPorts.filter((port) => Number(port) !== removedIndex).forEach((port, nextIndex) => {
    portMap.set(port, String(nextIndex + 1));
  });
  return portMap;
}
function remapSelectorParamsAfterRemoval(params, valuePorts, portMap, removedIndex) {
  const nextParams = { ...params };
  for (const port of valuePorts) {
    delete nextParams[port];
  }
  for (const [previousPort, nextPort] of portMap.entries()) {
    nextParams[nextPort] = params[previousPort] ?? 0;
  }
  const nextInputCount = portMap.size;
  const rawSelect = Number(params.select ?? 0);
  const currentSelect = Number.isFinite(rawSelect) ? rawSelect : 0;
  const shiftedSelect = currentSelect > removedIndex ? currentSelect - 1 : currentSelect;
  nextParams.select = Math.min(Math.max(shiftedSelect, 0), nextInputCount);
  return nextParams;
}
function remapSelectorEdgeAfterRemoval(edge, nodeId, portMap, removedIndex) {
  const link = linkFromEdge(edge);
  if (!link || link.to.node !== nodeId || !isSelectorValuePortName(link.to.port)) return [edge];
  if (Number(link.to.port) === removedIndex) return [];
  const nextPort = portMap.get(link.to.port);
  if (nextPort === void 0 || nextPort === link.to.port) return [edge];
  return [{
    ...edgeFromLink(
      { from: link.from, to: { node: nodeId, port: nextPort }, weight: link.weight, mode: link.mode, enabled: link.enabled, weightModulations: link.weightModulations },
      updateEdgeWeightPlaceholder,
      updateEdgeModePlaceholder,
      insertNodeOnEdgePlaceholder
    ),
    selected: edge.selected
  }];
}
function selectorIndexFromKeyboardEvent(event) {
  if (!/^[1-9]$/.test(event.key)) return null;
  return Number(event.key);
}
function normalizeSubpatchName(requestedName, fallback) {
  const trimmed = requestedName.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}
function makeSubpatchCloneId(seed) {
  subpatchCloneSequence += 1;
  const normalizedSeed = seed.replace(/[^A-Za-z0-9_-]/g, "_") || "group";
  return `subpatch_clone_${normalizedSeed}_${subpatchCloneSequence}`;
}
function cloneFlowNodeSnapshot(node) {
  const position = { ...node.position };
  return {
    ...node,
    position,
    data: {
      ...node.data,
      patchNode: {
        ...node.data.patchNode,
        params: { ...node.data.patchNode.params },
        position,
        ...node.data.patchNode.inputs ? { inputs: node.data.patchNode.inputs.map((port) => ({ ...port })) } : {},
        ...node.data.patchNode.outputs ? { outputs: node.data.patchNode.outputs.map((port) => ({ ...port })) } : {},
        ...node.data.patchNode.subpatchUiOverrides ? { subpatchUiOverrides: structuredClone(node.data.patchNode.subpatchUiOverrides) } : {},
        ...node.data.patchNode.subpatch ? { subpatch: clonePatch(node.data.patchNode.subpatch) } : {}
      }
    }
  };
}
function cloneFlowEdgeSnapshot(edge) {
  return {
    ...edge,
    data: {
      ...edge.data,
      weight: edge.data?.weight ?? 1,
      mode: edge.data?.mode ?? "set",
      enabled: edge.data?.enabled !== false,
      onWeightChange: updateEdgeWeightPlaceholder,
      onModeChange: updateEdgeModePlaceholder,
      onInsertNode: insertNodeOnEdgePlaceholder
    }
  };
}
function reconnectPreviewEdgeFromEdge(edge) {
  const snapshot = cloneFlowEdgeSnapshot(edge);
  return {
    ...snapshot,
    id: `reconnect-preview:${snapshot.id}`,
    selected: false,
    selectable: false,
    deletable: false,
    reconnectable: false,
    zIndex: SELECTED_EDGE_Z_INDEX - 1,
    data: {
      ...snapshot.data,
      weight: snapshot.data?.weight ?? 1,
      mode: snapshot.data?.mode ?? "set",
      enabled: snapshot.data?.enabled !== false,
      onWeightChange: snapshot.data?.onWeightChange ?? updateEdgeWeightPlaceholder,
      onModeChange: snapshot.data?.onModeChange ?? updateEdgeModePlaceholder,
      onInsertNode: snapshot.data?.onInsertNode ?? insertNodeOnEdgePlaceholder,
      showLinkControls: false
    }
  };
}
function syncDuplicateDragPositions(state, dragNodes) {
  if (!state || dragNodes.length === 0) return state;
  const sourceIds = state.nodeIds;
  let changed = false;
  const currentPositions = { ...state.currentPositions };
  for (const node of dragNodes) {
    if (!sourceIds.has(node.id)) continue;
    const previous = currentPositions[node.id];
    if (previous && previous.x === node.position.x && previous.y === node.position.y) continue;
    currentPositions[node.id] = { ...node.position };
    changed = true;
  }
  return changed ? { ...state, currentPositions } : state;
}
function syncDuplicateDragPositionsFromChanges(state, changes) {
  let changed = false;
  const currentPositions = { ...state.currentPositions };
  for (const change of changes) {
    if (change.type !== "position" || !change.position || !state.nodeIds.has(change.id)) continue;
    const previous = currentPositions[change.id];
    if (previous && previous.x === change.position.x && previous.y === change.position.y) continue;
    currentPositions[change.id] = { ...change.position };
    changed = true;
  }
  return changed ? { ...state, currentPositions } : state;
}
function anchorDuplicatedNodePositionChanges(changes, originalPositions) {
  return changes.map((change) => {
    if (change.type !== "position") return change;
    const position = originalPositions[change.id];
    if (!position) return change;
    return {
      ...change,
      position: { ...position },
      positionAbsolute: { ...position }
    };
  });
}
function restoreGraphNodePositions(nodes, positions) {
  return applyGraphNodePositions(nodes, positions);
}
function applyGraphNodePositions(nodes, positions) {
  return nodes.map((node) => {
    const position = positions[node.id];
    if (!position) return node;
    return {
      ...node,
      position: { ...position },
      data: {
        ...node.data,
        patchNode: {
          ...node.data.patchNode,
          position: { ...position }
        }
      }
    };
  });
}
function duplicatePreviewNodeId(nodeId) {
  return `${DUPLICATE_NODE_PREVIEW_PREFIX}${nodeId}`;
}
function draftNodePosition(connection, reactFlow) {
  const pointer = reactFlow.screenToFlowPosition(connection.pointer);
  const x = connection.originHandleType === "source" ? pointer.x + DRAFT_NODE_HANDLE_X_OFFSET : pointer.x - DRAFT_NODE_WIDTH - DRAFT_NODE_HANDLE_X_OFFSET;
  return {
    x,
    y: pointer.y - DRAFT_NODE_FIRST_PORT_Y
  };
}
function duplicateAreaHierarchy(areas, nodes, edges, dragState, onWeightChange, onModeChange, onInsertNode) {
  const sourceAreaIds = new Set(Object.keys(dragState.areaPositions));
  const sourceNodeIds = new Set(Object.keys(dragState.nodePositions));
  const existingNodeIds = new Set(nodes.map((node) => node.id));
  const existingAreaIds = new Set(areas.map((area) => area.id));
  const nodeIdMap = /* @__PURE__ */ new Map();
  const areaIdMap = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    if (!sourceNodeIds.has(node.id)) continue;
    const nextId = makeNodeId(node.data.patchNode.type ?? "node", existingNodeIds);
    existingNodeIds.add(nextId);
    nodeIdMap.set(node.id, nextId);
  }
  for (const area of areas) {
    if (!sourceAreaIds.has(area.id)) continue;
    let nextId = `area-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    while (existingAreaIds.has(nextId)) {
      nextId = `area-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }
    existingAreaIds.add(nextId);
    areaIdMap.set(area.id, nextId);
  }
  const duplicatedNodes = nodes.flatMap((node) => {
    const nextId = nodeIdMap.get(node.id);
    if (!nextId) return [];
    const position = dragState.currentNodePositions[node.id] ?? node.position;
    const patchNode = cloneParameterIds(node.data.patchNode, nextId);
    return [{
      ...node,
      id: nextId,
      position,
      selected: false,
      data: {
        ...node.data,
        patchNode: {
          ...patchNode,
          id: nextId,
          position,
          ...patchNode.spreadNodeIds ? {
            spreadNodeIds: patchNode.spreadNodeIds.flatMap((nodeId) => {
              const mapped = nodeIdMap.get(nodeId);
              return mapped ? [mapped] : [];
            })
          } : {}
        },
        isTypePickerOpen: false
      }
    }];
  });
  const duplicatedAreas = areas.flatMap((area) => {
    const nextId = areaIdMap.get(area.id);
    if (!nextId) return [];
    const spreadNodeId = area.spreadNodeId ? nodeIdMap.get(area.spreadNodeId) : void 0;
    return [{
      ...structuredClone(area),
      id: nextId,
      position: dragState.currentAreaPositions[area.id] ?? area.position,
      ...spreadNodeId ? { spreadNodeId } : {},
      ...area.nodeIds ? {
        nodeIds: area.nodeIds.flatMap((nodeId) => {
          const mapped = nodeIdMap.get(nodeId);
          return mapped ? [mapped] : [];
        })
      } : {},
      ...area.areaIds ? {
        areaIds: area.areaIds.flatMap((areaId) => {
          const mapped = areaIdMap.get(areaId);
          return mapped ? [mapped] : [];
        })
      } : {}
    }];
  });
  const duplicatedEdges = duplicateEdgesForNodes(edges, nodeIdMap, dragState.linkExternal, onWeightChange, onModeChange, onInsertNode);
  return {
    rootAreaId: areaIdMap.get(dragState.areaId) ?? dragState.areaId,
    areas: duplicatedAreas,
    nodes: duplicatedNodes,
    edges: duplicatedEdges
  };
}
function duplicateDraggedGraph(nodes, edges, dragState, draggedPositions, onWeightChange, onModeChange, onInsertNode) {
  const existingIds = new Set(nodes.map((node) => node.id));
  const idMap = /* @__PURE__ */ new Map();
  const selectedNodes = nodes.filter((node) => dragState.nodeIds.has(node.id));
  const duplicatedNodes = selectedNodes.map((node) => {
    const nextId = makeNodeId(node.data.patchNode.type ?? "node", existingIds);
    existingIds.add(nextId);
    idMap.set(node.id, nextId);
    const position = draggedPositions[node.id] ?? node.position;
    return {
      ...node,
      id: nextId,
      selected: true,
      position,
      data: {
        ...node.data,
        patchNode: {
          ...cloneParameterIds(node.data.patchNode, nextId),
          id: nextId,
          params: { ...node.data.patchNode.params },
          position
        },
        isTypePickerOpen: false
      }
    };
  });
  const duplicatedEdges = duplicateEdgesForNodes(edges, idMap, dragState.linkExternal, onWeightChange, onModeChange, onInsertNode);
  return {
    nodes: duplicatedNodes,
    edges: duplicatedEdges
  };
}
function buildBridgeEdges(nodes, edges, selectedNodeIds, onWeightChange, onModeChange, onInsertNode) {
  return nodes.flatMap((node) => {
    if (!selectedNodeIds.has(node.id)) return [];
    const incoming = edges.map(linkFromEdge).filter((link) => {
      if (!link) return false;
      return link.to.node === node.id && !selectedNodeIds.has(link.from.node);
    });
    const outgoing = edges.map(linkFromEdge).filter((link) => {
      if (!link) return false;
      return link.from.node === node.id && !selectedNodeIds.has(link.to.node);
    });
    return incoming.flatMap((input) => outgoing.map((output) => edgeFromLink({
      from: input.from,
      to: output.to,
      weight: output.weight,
      mode: output.mode,
      enabled: input.enabled !== false && output.enabled !== false
    }, onWeightChange, onModeChange, onInsertNode)));
  });
}
function selectedGraphFromNodes(nodes, edges) {
  const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
  if (selectedNodeIds.size === 0) return null;
  const includedEdgeIds = new Set(edges.flatMap((edge) => {
    const link = linkFromEdge(edge);
    return link && selectedNodeIds.has(link.from.node) && selectedNodeIds.has(link.to.node) ? [edge.id] : [];
  }));
  let previousSize = -1;
  while (previousSize !== includedEdgeIds.size) {
    previousSize = includedEdgeIds.size;
    for (const edge of edges) {
      if (edge.data?.modulatesEdgeId && selectedNodeIds.has(edge.source) && includedEdgeIds.has(edge.data.modulatesEdgeId)) {
        includedEdgeIds.add(edge.id);
      }
    }
  }
  return {
    nodes: nodes.filter((node) => selectedNodeIds.has(node.id)).map(cloneFlowNodeForClipboard),
    edges: edges.filter((edge) => includedEdgeIds.has(edge.id)).map(cloneFlowEdgeForClipboard)
  };
}
function duplicateCopiedGraph(graph, existingNodes, offset, onWeightChange, onModeChange, onInsertNode) {
  const existingIds = new Set(existingNodes.map((node) => node.id));
  const idMap = /* @__PURE__ */ new Map();
  const nodes = graph.nodes.map((node) => {
    const nextId = makeNodeId(node.data.patchNode.type ?? "node", existingIds);
    existingIds.add(nextId);
    idMap.set(node.id, nextId);
    const position = {
      x: node.position.x + offset.x,
      y: node.position.y + offset.y
    };
    return {
      ...node,
      id: nextId,
      position,
      selected: true,
      data: {
        ...node.data,
        patchNode: {
          ...cloneParameterIds(node.data.patchNode, nextId),
          id: nextId,
          params: { ...node.data.patchNode.params },
          position
        },
        isTypePickerOpen: false
      }
    };
  });
  const edges = duplicateEdgesForNodes(graph.edges, idMap, false, onWeightChange, onModeChange, onInsertNode);
  return { nodes, edges };
}
function duplicateEdgesForNodes(edges, nodeIds, linkExternal, onWeightChange, onModeChange, onInsertNode) {
  const copies = /* @__PURE__ */ new Map();
  const byId = new Map(edges.map((edge) => [edge.id, edge]));
  const copy = (edge, visited = /* @__PURE__ */ new Set()) => {
    if (copies.has(edge.id)) return copies.get(edge.id) ?? null;
    if (visited.has(edge.id)) return null;
    const source = nodeIds.get(edge.source);
    let result = null;
    if (edge.data?.modulatesEdgeId) {
      const parent = byId.get(edge.data.modulatesEdgeId);
      const parentCopy = parent ? copy(parent, /* @__PURE__ */ new Set([...visited, edge.id])) : null;
      const target = parentCopy ?? (linkExternal ? parent : void 0);
      if (target && (source || linkExternal && parentCopy)) {
        result = {
          ...edge,
          id: `weight-modulation:${crypto.randomUUID()}`,
          source: source ?? edge.source,
          target: target.target,
          targetHandle: target.targetHandle,
          selected: false,
          data: { ...edge.data, modulatesEdgeId: target.id, onWeightChange, onModeChange, onInsertNode }
        };
      }
    } else {
      const link = linkFromEdge(edge);
      const target = nodeIds.get(edge.target);
      if (link && (source || target) && (linkExternal || source && target)) {
        result = edgeFromLink({
          ...link,
          from: { ...link.from, node: source ?? link.from.node },
          to: { ...link.to, node: target ?? link.to.node }
        }, onWeightChange, onModeChange, onInsertNode);
      }
    }
    copies.set(edge.id, result);
    return result;
  };
  return edges.flatMap((edge) => {
    const result = copy(edge);
    return result ? [result] : [];
  });
}
function duplicatedBufferCopies(sourceNodes, targetNodes, sourceGraphNodes, targetGraphNodes, groupIds) {
  return sourceNodes.flatMap((sourceNode, index) => {
    const targetNode = targetNodes[index];
    if (sourceNode.data.patchNode.type !== "Buffer" || targetNode?.data.patchNode.type !== "Buffer") return [];
    return [{
      sourceNodeId: runtimeDspNodeIdForFlowNode(sourceNode, sourceGraphNodes, groupIds),
      targetNodeId: runtimeDspNodeIdForFlowNode(targetNode, targetGraphNodes, groupIds)
    }];
  });
}
function copyBufferAssets(copies, currentAssets, replaceAssets) {
  const copiedAssets = copies.flatMap(({ sourceNodeId, targetNodeId }) => {
    const asset = currentAssets[sourceNodeId];
    return asset ? [[targetNodeId, asset]] : [];
  });
  if (copiedAssets.length === 0) return;
  replaceAssets({ ...currentAssets, ...Object.fromEntries(copiedAssets) });
}
function cloneFlowNodeForClipboard(node) {
  return {
    ...node,
    selected: false,
    data: {
      ...node.data,
      patchNode: {
        ...node.data.patchNode,
        params: { ...node.data.patchNode.params },
        position: { ...node.position }
      },
      isTypePickerOpen: false
    }
  };
}
function cloneFlowEdgeForClipboard(edge) {
  return {
    ...edge,
    selected: false,
    data: {
      weight: edge.data?.weight ?? 1,
      mode: edge.data?.mode ?? "set",
      enabled: edge.data?.enabled !== false,
      modulatesEdgeId: edge.data?.modulatesEdgeId,
      onWeightChange: updateEdgeWeightPlaceholder,
      onModeChange: updateEdgeModePlaceholder,
      onInsertNode: insertNodeOnEdgePlaceholder
    }
  };
}
async function writeCopiedGraphToClipboard(graph) {
  const payload = JSON.stringify({
    app: "teia",
    kind: "copied-graph",
    version: 1,
    graph: flowToEditorState(graph.nodes, graph.edges)
  });
  try {
    await navigator.clipboard?.writeText(payload);
  } catch {
  }
}
async function readCopiedGraphFromClipboard() {
  try {
    const raw = await navigator.clipboard?.readText();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.app !== "teia" || parsed.kind !== "copied-graph" || parsed.version !== 1 || !parsed.graph) {
      return null;
    }
    const callbacks = nodeCallbacksPlaceholder();
    return {
      nodes: editorStateToFlowNodes(parsed.graph, callbacks, null),
      edges: editorStateToFlowEdges(parsed.graph, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder)
    };
  } catch {
    return null;
  }
}
function isEditableEventTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("dialog[open]")) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
function isPlaybackShortcutControlEventTarget(target) {
  if (target instanceof HTMLElement && target.closest("dialog[open]")) return false;
  if (target instanceof HTMLInputElement) {
    return target.type === "range";
  }
  return target instanceof HTMLSelectElement;
}
function selectionById(items) {
  return Object.fromEntries(items.map((item) => [item.id, item.selected === true]));
}
function selectedNodeIdsInScreenRect(editorShell, start, end, nodeIds) {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  const selectedNodeIds = /* @__PURE__ */ new Set();
  for (const element of editorShell.querySelectorAll(".react-flow__node[data-id]")) {
    const nodeId = element.dataset.id;
    if (!nodeId || !nodeIds.has(nodeId)) continue;
    const bounds = element.getBoundingClientRect();
    const overlapsSelection = bounds.left < right && bounds.right > left && bounds.top < bottom && bounds.bottom > top;
    if (overlapsSelection) selectedNodeIds.add(nodeId);
  }
  return selectedNodeIds;
}
function updateSelection(items, selectedIds) {
  let changed = false;
  const nextItems = items.map((item) => {
    const selected = selectedIds.has(item.id);
    if (item.selected === selected) return item;
    changed = true;
    return { ...item, selected };
  });
  return changed ? nextItems : items;
}
function nodeZIndex(selected, compactPorts, stackRank = 0, nodeCount = 1) {
  const classificationZIndex = selected ? SELECTED_NODE_Z_INDEX : compactPorts ? COMPACT_NODE_Z_INDEX : EXPANDED_NODE_Z_INDEX;
  const classificationSize = Math.max(1, nodeCount);
  return classificationZIndex * classificationSize + Math.max(0, stackRank);
}
function restoreNodeSelectionAfterDeselectedDrag(nodes, snapshot) {
  return restoreSelectionAfterDeselectedDrag(nodes, snapshot, snapshot?.nodeSelection);
}
function restoreEdgeSelectionAfterDeselectedDrag(edges, snapshot) {
  return restoreSelectionAfterDeselectedDrag(edges, snapshot, snapshot?.edgeSelection);
}
function restoreSelectionAfterDeselectedDrag(items, snapshot, selectedById) {
  if (!snapshot?.preserveSelection || !selectedById) return items;
  let changed = false;
  const restoredItems = items.map((item) => {
    if (!Object.prototype.hasOwnProperty.call(selectedById, item.id)) return item;
    const selected = selectedById[item.id] === true;
    if (item.selected === true === selected) return item;
    changed = true;
    return { ...item, selected };
  });
  return changed ? restoredItems : items;
}
function transformEdgeTree(edges, transform) {
  const replacements = /* @__PURE__ */ new Map();
  for (const edge of edges) {
    const replacement = transform(edge);
    if (replacement) replacements.set(edge.id, replacement);
  }
  const resolved = /* @__PURE__ */ new Map();
  const resolve = (edge, visited = /* @__PURE__ */ new Set()) => {
    if (resolved.has(edge.id)) return resolved.get(edge.id) ?? null;
    if (visited.has(edge.id)) return null;
    const replacement = replacements.get(edge.id);
    if (!replacement) return null;
    const parentId = replacement.data?.modulatesEdgeId;
    if (!parentId) {
      resolved.set(edge.id, replacement);
      return replacement;
    }
    const parent = edges.find((candidate) => candidate.id === parentId);
    const nextParent = parent ? resolve(parent, /* @__PURE__ */ new Set([...visited, edge.id])) : null;
    if (!nextParent) return null;
    const next = {
      ...replacement,
      target: nextParent.target,
      targetHandle: nextParent.targetHandle,
      data: { ...replacement.data, modulatesEdgeId: nextParent.id }
    };
    resolved.set(edge.id, next);
    return next;
  };
  return dedupeEdges(edges.flatMap((edge) => {
    const next = resolve(edge);
    return next ? [next] : [];
  }));
}
function samplePlayerVisualizationParams(nodeId, linkMeters) {
  const params = {};
  for (const port of ["start", "end", "attack", "release"]) {
    const reading = linkMeters[`${nodeId}:sample-${port}`];
    if (reading) params[port] = reading.input;
  }
  return Object.keys(params).length > 0 ? params : void 0;
}
function renameEdgeNode(edge, fromNodeId, toNodeId) {
  if (edge.data?.modulatesEdgeId) {
    return {
      ...edge,
      source: edge.source === fromNodeId ? toNodeId : edge.source,
      target: edge.target === fromNodeId ? toNodeId : edge.target
    };
  }
  const link = linkFromEdge(edge);
  if (!link) return edge;
  const renamedLink = {
    from: { ...link.from, node: link.from.node === fromNodeId ? toNodeId : link.from.node },
    to: { ...link.to, node: link.to.node === fromNodeId ? toNodeId : link.to.node },
    weight: link.weight,
    mode: link.mode,
    enabled: link.enabled,
    weightModulations: link.weightModulations?.map((modulation) => modulation.from.node === fromNodeId ? { ...modulation, from: { ...modulation.from, node: toNodeId } } : modulation)
  };
  return edgeFromLink(renamedLink, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder);
}
function remapEdgeForNodeType(edge, nodeId, previousDefinition, nextDefinition) {
  if (edge.data?.modulatesEdgeId) {
    if (edge.source !== nodeId) return edge;
    const sourcePort = edge.sourceHandle?.startsWith("out:") ? edge.sourceHandle.slice(4) : "";
    const previousIndex = previousDefinition?.outputs.findIndex((port) => port.name === sourcePort) ?? 0;
    const nextPort = nextDefinition.outputs[Math.max(0, previousIndex)]?.name;
    return nextPort ? { ...edge, sourceHandle: `out:${nextPort}` } : null;
  }
  const link = linkFromEdge(edge);
  if (!link) return null;
  if (link.from.node === nodeId) {
    const previousIndex = previousDefinition?.outputs.findIndex((port) => port.name === link.from.port) ?? 0;
    const nextPort = nextDefinition.outputs[Math.max(0, previousIndex)]?.name;
    if (!nextPort) return null;
    return edgeFromLink({ ...link, from: { node: nodeId, port: nextPort } }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder);
  }
  if (link.to.node === nodeId) {
    const previousIndex = previousDefinition?.inputs.findIndex((port) => port.name === link.to.port) ?? 0;
    const nextPort = nextDefinition.inputs[Math.max(0, previousIndex)]?.name;
    if (!nextPort) return null;
    return edgeFromLink({ ...link, to: { node: nodeId, port: nextPort } }, updateEdgeWeightPlaceholder, updateEdgeModePlaceholder, insertNodeOnEdgePlaceholder);
  }
  return edge;
}
function uniqueNodeId(requestedId, currentId, nodes) {
  const sanitized = requestedId.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  const fallback = currentId || "node";
  const base = sanitized || fallback;
  const existingIds = new Set(nodes.map((node) => node.id).filter((id) => id !== currentId));
  if (!existingIds.has(base)) return base;
  let index = 2;
  let candidate = `${base}_${index}`;
  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${base}_${index}`;
  }
  return candidate;
}
function rowLabelColumnWidth(labels) {
  const longestLabel = Math.max(3, ...labels.map((label) => label.length));
  return 20 + longestLabel * 8;
}
function shouldAutoRenameForTypeChange(nodeId, previousType) {
  return previousType === null || /^node_\d+$/.test(nodeId);
}
function nextTypeNodeId(nodeId, type, nodes) {
  return uniqueNodeId(makeNodeId(type, new Set(nodes.map((node) => node.id))), nodeId, nodes);
}
function midpointPosition(source, target) {
  if (source && target) {
    return {
      x: (source.x + target.x) / 2,
      y: (source.y + target.y) / 2
    };
  }
  return { x: 0, y: 0 };
}
function nodeCallbacksPlaceholder() {
  return {
    onParamChange: updateParamPlaceholder,
    onParamsChange: updateParamsPlaceholder,
    onTypeChange: updateTypePlaceholder,
    onConvertToArea: updateConvertToAreaPlaceholder,
    onTypeEditStart: updateTypeEditStartPlaceholder,
    onTypeEditEnd: updateTypeEditEndPlaceholder,
    onTypeEditCancel: updateTypeEditCancelPlaceholder,
    onIdChange: updateIdPlaceholder,
    onPortDoubleClick: noopPortDoubleClick,
    onPortNameChange: noopPortNameChange,
    onPortAdd: noopPortNameChange,
    onPortMove: noopPortMove,
    onCompactToggle: noopCompactToggle,
    onScopeResize: noopScopeResize
  };
}
function updateParamPlaceholder() {
}
function updateParamsPlaceholder() {
}
function updateTypePlaceholder() {
}
function updateConvertToAreaPlaceholder() {
}
function updateTypeEditStartPlaceholder() {
}
function updateTypeEditEndPlaceholder() {
}
function updateTypeEditCancelPlaceholder() {
}
function updateIdPlaceholder() {
}
function updateEdgeWeightPlaceholder() {
}
function updateEdgeModePlaceholder() {
}
function insertNodeOnEdgePlaceholder() {
}
function noopPortDoubleClick() {
}
function noopPortNameChange() {
}
function noopPortMove() {
}
function noopCompactToggle() {
}
function noopScopeResize() {
}
var emptySubscribe = () => () => void 0;
var emptySnapshot = () => null;

// editor/src/hosted/HostedNodeEditor.tsx
import { jsx as jsx8 } from "react/jsx-runtime";
function HostedNodeEditor({ session, theme }) {
  if (!session?.bridge || !session.capabilities) throw new Error("HostedNodeEditor requires a supplied hosted session and bridge.");
  return theme ? /* @__PURE__ */ jsx8("div", { className: "teia-themed-editor", "data-theme": theme, children: /* @__PURE__ */ jsx8(NodeEditor, { hosted: session }) }) : /* @__PURE__ */ jsx8(NodeEditor, { hosted: session });
}
export {
  HostedNodeEditor
};
