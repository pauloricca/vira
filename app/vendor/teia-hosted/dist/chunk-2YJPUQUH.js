// <define:import.meta.env>
var define_import_meta_env_default = { VITE_TEIA_PATCH_STORAGE: "hosted" };

// editor/src/graph/customWave.ts
var CUSTOM_WAVE_MODES = [
  { value: "loop", label: "Loop" },
  { value: "ping-pong", label: "Ping-pong" },
  { value: "once", label: "Play once on trigger" },
  { value: "sustain", label: "Sustain" },
  { value: "sustain-loop", label: "Sustain loop" },
  { value: "sustain-ping-pong", label: "Sustain ping-pong" }
];
var DEFAULT_CUSTOM_WAVE = {
  mode: "loop",
  sustainStart: 0.5,
  sustainEnd: 0.75,
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 0 }
  ]
};
var CUSTOM_WAVE_MODE_VALUES = new Set(CUSTOM_WAVE_MODES.map((mode) => mode.value));
var LEGACY_CUSTOM_WAVE_MODES = CUSTOM_WAVE_MODES.map((mode) => mode.value);
function normalizeCustomWave(customWave, legacyParams) {
  const legacyMode = legacyParams && Number.isFinite(legacyParams.mode) ? LEGACY_CUSTOM_WAVE_MODES[clamp(Math.round(legacyParams.mode ?? 0), 0, LEGACY_CUSTOM_WAVE_MODES.length - 1)] : void 0;
  const mode = CUSTOM_WAVE_MODE_VALUES.has(customWave?.mode) ? customWave?.mode : legacyMode ?? DEFAULT_CUSTOM_WAVE.mode;
  const sustainStart = Number.isFinite(Number(customWave?.sustainStart)) ? clamp(Number(customWave?.sustainStart), 0, 0.999) : Number.isFinite(legacyParams?.sustainStart) ? clamp(Number(legacyParams?.sustainStart), 0, 0.999) : DEFAULT_CUSTOM_WAVE.sustainStart;
  const sustainEnd = Number.isFinite(Number(customWave?.sustainEnd)) ? clamp(Number(customWave?.sustainEnd), sustainStart + 1e-3, 1) : Number.isFinite(legacyParams?.sustainEnd) ? clamp(Number(legacyParams?.sustainEnd), sustainStart + 1e-3, 1) : Math.max(sustainStart + 1e-3, DEFAULT_CUSTOM_WAVE.sustainEnd);
  const sourcePoints = Array.isArray(customWave?.points) ? customWave.points : DEFAULT_CUSTOM_WAVE.points;
  const pointsByX = /* @__PURE__ */ new Map();
  for (const point of sourcePoints) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    pointsByX.set(clamp(x, 0, 1), clamp(y, -1, 1));
  }
  pointsByX.set(0, 0);
  pointsByX.set(1, 0);
  const normalized = {
    mode,
    sustainStart,
    sustainEnd,
    points: [...pointsByX.entries()].map(([x, y]) => ({ x, y })).sort((a, b) => a.x - b.x)
  };
  const waves = Array.isArray(customWave?.waves) ? customWave.waves.map((wave) => normalizeCustomWave({ ...wave, waves: void 0 }, legacyParams)) : [];
  return waves.length > 0 ? { ...normalized, waves } : normalized;
}
function customWaveBank(customWave, params) {
  const normalized = normalizeCustomWave(customWave, params);
  return [normalizeCustomWave({ ...normalized, waves: void 0 }, params), ...normalized.waves ?? []];
}
function customWaveUsesSustainStart(mode) {
  return mode.startsWith("sustain");
}
function customWaveUsesSustainEnd(mode) {
  return mode === "sustain-loop" || mode === "sustain-ping-pong";
}
function customWaveWithBaseLevel(customWave, baseLevel, rangeMin, rangeMax) {
  const endpointY = normalizedCustomWaveValue(baseLevel, rangeMin, rangeMax);
  const lastIndex = customWave.points.length - 1;
  return {
    ...customWave,
    points: customWave.points.map((point, index) => index === 0 || index === lastIndex ? { ...point, y: endpointY } : point)
  };
}
function normalizedCustomWaveValue(value, rangeMin, rangeMax) {
  const min = Number.isFinite(rangeMin) ? rangeMin : -1;
  const max = Number.isFinite(rangeMax) ? rangeMax : 1;
  const span = max - min;
  if (span === 0) {
    if (min === value) return 0;
    return value < min ? -1 : 1;
  }
  return clamp((value - min) / span * 2 - 1, -1, 1);
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// editor/src/graph/serialize.ts
function normalizePatch(patch) {
  return {
    ...patch.schemaVersion ? { schemaVersion: patch.schemaVersion } : {},
    ...patch.name ? { name: patch.name } : {},
    ...patch.buffers ? { buffers: normalizeBufferAssets(patch.buffers) } : {},
    ...patch.midiInput ? { midiInput: {
      selectedDeviceIds: [...patch.midiInput.selectedDeviceIds].sort(),
      ...patch.midiInput.selectedOutputDeviceIds?.length ? {
        selectedOutputDeviceIds: [...patch.midiInput.selectedOutputDeviceIds].sort()
      } : {},
      ...patch.midiInput.sendClock ? { sendClock: true } : {}
    } } : {},
    ...patch.areas ? { areas: patch.areas.map((area) => ({
      ...area,
      position: { ...area.position },
      size: { ...area.size },
      ...area.nodeIds ? { nodeIds: [...area.nodeIds].sort() } : {},
      ...area.areaIds ? { areaIds: [...area.areaIds].sort() } : {}
    })) } : {},
    nodes: [...patch.nodes].map((node) => ({
      id: node.id,
      type: node.type,
      ...node.customLabel ? { customLabel: node.customLabel } : {},
      ...node.sequencerRowLabels ? { sequencerRowLabels: [...node.sequencerRowLabels] } : {},
      ...node.sequencerRowLabelColumnWidth !== void 0 ? { sequencerRowLabelColumnWidth: node.sequencerRowLabelColumnWidth } : {},
      ...node.subpatchName ? { subpatchName: node.subpatchName } : {},
      ...node.subpatchCloneId ? { subpatchCloneId: node.subpatchCloneId } : {},
      ...node.subpatchUiOverrides ? { subpatchUiOverrides: normalizeSubpatchUiOverrides(node.subpatchUiOverrides) } : {},
      ...node.expression !== void 0 ? { expression: node.expression } : {},
      ...node.sample ? { sample: { ...node.sample } } : {},
      ...node.image ? { image: { ...node.image } } : {},
      ...node.customWave ? { customWave: normalizeCustomWave(node.customWave, node.params) } : {},
      params: sortRecord(node.params),
      ...node.position ? { position: node.position } : {},
      ...node.scale !== void 0 ? { scale: node.scale } : {},
      ...node.scopeSize ? { scopeSize: { ...node.scopeSize } } : {},
      ...node.inputs ? { inputs: node.inputs.map((input) => ({ ...input })) } : {},
      ...node.outputs ? { outputs: node.outputs.map((output) => ({ ...output })) } : {},
      ...node.subpatch ? { subpatch: normalizePatch(node.subpatch) } : {},
      ...node.compactPorts !== void 0 ? { compactPorts: node.compactPorts } : {},
      ...node.enabled === false ? { enabled: false } : {},
      ...node.spreadNodeIds ? { spreadNodeIds: [...node.spreadNodeIds].sort() } : {}
    })).sort((a, b) => a.id.localeCompare(b.id)),
    links: [...patch.links].map((link) => ({
      from: { ...link.from },
      to: { ...link.to },
      ...link.weight !== void 0 ? { weight: link.weight } : {},
      ...link.mode !== void 0 ? { mode: link.mode } : {},
      ...link.enabled === false ? { enabled: false } : {},
      ...link.weightModulations?.length ? { weightModulations: structuredClone(link.weightModulations) } : {}
    })).sort(compareLinks)
  };
}
function normalizeBufferAssets(buffers) {
  return Object.fromEntries(Object.entries(buffers).sort(([left], [right]) => left.localeCompare(right)).map(([nodeId, buffer]) => [nodeId, { ...buffer }]));
}
function patchToJson(patch) {
  return `${JSON.stringify(normalizePatch(patch), null, 2)}
`;
}
function sortRecord(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  );
}
function normalizeSubpatchUiOverrides(overrides) {
  return Object.fromEntries(Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right)).map(([nodeId, override]) => [nodeId, {
    ...override.params ? { params: sortRecord(override.params) } : {},
    ...override.customWave ? { customWave: normalizeCustomWave(override.customWave, override.params) } : {}
  }]));
}
function compareLinks(a, b) {
  return a.to.node.localeCompare(b.to.node) || a.to.port.localeCompare(b.to.port) || a.from.node.localeCompare(b.from.node) || a.from.port.localeCompare(b.from.port);
}

// editor/src/graph/expression.ts
var GLSL_RESERVED_IDENTIFIERS = /* @__PURE__ */ new Set([
  "attribute",
  "bool",
  "break",
  "bvec2",
  "bvec3",
  "bvec4",
  "case",
  "centroid",
  "const",
  "continue",
  "default",
  "discard",
  "do",
  "else",
  "false",
  "flat",
  "float",
  "for",
  "highp",
  "if",
  "in",
  "inout",
  "int",
  "invariant",
  "ivec2",
  "ivec3",
  "ivec4",
  "layout",
  "lowp",
  "mat2",
  "mat2x2",
  "mat2x3",
  "mat2x4",
  "mat3",
  "mat3x2",
  "mat3x3",
  "mat3x4",
  "mat4",
  "mat4x2",
  "mat4x3",
  "mat4x4",
  "mediump",
  "out",
  "precision",
  "return",
  "sampler2D",
  "smooth",
  "struct",
  "switch",
  "true",
  "uniform",
  "uint",
  "uvec2",
  "uvec3",
  "uvec4",
  "varying",
  "vec2",
  "vec3",
  "vec4",
  "void",
  "while",
  "u_camera",
  "u_frame",
  "u_mic_level",
  "u_resolution",
  "u_time",
  "uv"
]);
var IDENTIFIER_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/g;
function extractExpressionInputs(expression) {
  const inputs2 = [];
  const seen = /* @__PURE__ */ new Set();
  const scanExpression = stripComments(expression);
  for (const match of scanExpression.matchAll(IDENTIFIER_PATTERN)) {
    const name = match[0];
    const index = match.index ?? 0;
    if (!isExpressionInputIdentifier(scanExpression, name, index)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    inputs2.push(name);
  }
  return inputs2;
}
function isExpressionInputIdentifier(expression, name, index) {
  if (GLSL_RESERVED_IDENTIFIERS.has(name)) return false;
  if (name.startsWith("gl_")) return false;
  const previous = previousNonWhitespace(expression, index - 1);
  if (previous === ".") return false;
  const next = nextNonWhitespace(expression, index + name.length);
  if (next === "(") return false;
  return true;
}
function previousNonWhitespace(value, start) {
  for (let index = start; index >= 0; index -= 1) {
    const character = value[index];
    if (character && !/\s/.test(character)) return character;
  }
  return null;
}
function nextNonWhitespace(value, start) {
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character && !/\s/.test(character)) return character;
  }
  return null;
}
function stripComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

// editor/src/graph/musicScales.ts
var QUANTISE_SCALES = [
  { label: "chromatic", semitones: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { label: "major", semitones: [0, 2, 4, 5, 7, 9, 11] },
  { label: "minor", semitones: [0, 2, 3, 5, 7, 8, 10] },
  { label: "harmonic minor", semitones: [0, 2, 3, 5, 7, 8, 11] },
  { label: "melodic minor", semitones: [0, 2, 3, 5, 7, 9, 11] },
  { label: "major pentatonic", semitones: [0, 2, 4, 7, 9] },
  { label: "minor pentatonic", semitones: [0, 3, 5, 7, 10] },
  { label: "blues", semitones: [0, 3, 5, 6, 7, 10] },
  { label: "dorian", semitones: [0, 2, 3, 5, 7, 9, 10] },
  { label: "phrygian", semitones: [0, 1, 3, 5, 7, 8, 10] },
  { label: "lydian", semitones: [0, 2, 4, 6, 7, 9, 11] },
  { label: "mixolydian", semitones: [0, 2, 4, 5, 7, 9, 10] },
  { label: "locrian", semitones: [0, 1, 3, 5, 6, 8, 10] },
  { label: "whole tone", semitones: [0, 2, 4, 6, 8, 10] },
  { label: "diminished (whole-half)", semitones: [0, 2, 3, 5, 6, 8, 9, 11] },
  { label: "diminished (half-whole)", semitones: [0, 1, 3, 4, 6, 7, 9, 10] }
];
var PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function normalisePitchClass(note) {
  const value = Number.isFinite(note) ? Math.round(note) : 0;
  return (value % 12 + 12) % 12;
}
function pitchClassLabel(note) {
  return PITCH_CLASSES[normalisePitchClass(note)];
}
function midiNoteLabel(note) {
  const midiNote = Math.max(0, Math.min(127, Math.round(note)));
  return `${pitchClassLabel(midiNote)}${Math.floor(midiNote / 12) - 1}`;
}

// editor/src/graph/nodeTypes.ts
var SEQUENCER_MIN_STEPS = 1;
var SEQUENCER_MAX_STEPS = 128;
var SEQUENCER_DEFAULT_STEPS = 16;
var SEQUENCER_MIN_ROWS = 1;
var SEQUENCER_MAX_ROWS = 16;
var SEQUENCER_DEFAULT_ROWS = 4;
var SEQUENCER_MIN_BEAT_LENGTH = 1;
var SEQUENCER_DEFAULT_BEAT_LENGTH = 4;
var SEQUENCER_INDEX_OUTPUT = "trigger index";
var ROLL_ROWS = 12;
var ROLL_MAX_ROWS = 128;
var ROLL_DEFAULT_START_NOTE = 60;
var NODE_DEFINITIONS = {
  Expression: {
    type: "Expression",
    inputs: [],
    outputs: [{ name: "value" }]
  },
  Group: {
    type: "Group",
    inputs: [],
    outputs: []
  },
  Spread: {
    type: "Spread",
    inputs: [{ name: "count", defaultValue: 1, min: 0, integer: true }],
    outputs: [{ name: "item index" }]
  },
  Spawn: {
    type: "Spawn",
    inputs: [
      { name: "trigger", defaultValue: 0 },
      { name: "release trigger", defaultValue: 0 },
      { name: "kill trigger", defaultValue: 0, valueEditor: false }
    ],
    outputs: [{ name: "instance gate" }]
  },
  Ins: {
    type: "Ins",
    inputs: [],
    outputs: []
  },
  Params: {
    type: "Params",
    inputs: [],
    outputs: []
  },
  Outs: {
    type: "Outs",
    inputs: [],
    outputs: []
  },
  AudioOut: {
    type: "AudioOut",
    inputs: [
      { name: "both", valueEditor: false },
      { name: "left", valueEditor: false },
      { name: "right", valueEditor: false },
      { name: "level", defaultValue: 0.75 }
    ],
    outputs: []
  },
  SineOsc: oscillator("SineOsc"),
  TriangleOsc: oscillator("TriangleOsc"),
  SawOsc: oscillator("SawOsc"),
  RampOsc: oscillator("RampOsc"),
  SquareOsc: {
    ...oscillator("SquareOsc"),
    inputs: [
      { name: "frequency", defaultValue: 220 },
      { name: "phase", defaultValue: 0 },
      { name: "phaseReset", defaultValue: 0 },
      { name: "pulse width", defaultValue: 0.5, min: 0, max: 1 },
      { name: "rangeMin", defaultValue: -1 },
      { name: "rangeMax", defaultValue: 1 }
    ]
  },
  KinkOsc: {
    ...oscillator("KinkOsc"),
    inputs: [
      { name: "frequency", defaultValue: 220 },
      { name: "phase", defaultValue: 0 },
      { name: "phase reset", defaultValue: 0 },
      { name: "shape", defaultValue: 0, min: -1, max: 1 },
      { name: "squareness", defaultValue: 0, min: -1, max: 1 },
      { name: "range min", defaultValue: -1 },
      { name: "range max", defaultValue: 1 }
    ]
  },
  SampleHoldOsc: {
    type: "SampleHoldOsc",
    inputs: [
      { name: "signal", valueEditor: false },
      { name: "trigger", defaultValue: 0 }
    ],
    outputs: [{ name: "signal" }]
  },
  PerlinNoise: {
    type: "PerlinNoise",
    inputs: [
      { name: "speed", defaultValue: 8 },
      { name: "rangeMin", defaultValue: -1 },
      { name: "rangeMax", defaultValue: 1 }
    ],
    outputs: [{ name: "signal" }]
  },
  Noise: {
    type: "Noise",
    inputs: [
      { name: "rangeMin", defaultValue: -1 },
      { name: "rangeMax", defaultValue: 1 }
    ],
    outputs: [{ name: "signal" }]
  },
  Random: {
    type: "Random",
    inputs: [
      { name: "trigger", defaultValue: 0 },
      { name: "rangeMin", defaultValue: -1 },
      { name: "rangeMax", defaultValue: 1 }
    ],
    outputs: [{ name: "signal" }]
  },
  AudioInput: {
    type: "AudioInput",
    inputs: [
      { name: "gain", defaultValue: 1 },
      { name: "level", defaultValue: 0.7 }
    ],
    outputs: [{ name: "signal" }, { name: "left" }, { name: "right" }]
  },
  CustomWave: {
    type: "CustomWave",
    inputs: [
      { name: "mode", defaultValue: 0, min: 0, max: 5, integer: true, connectable: false, valueEditor: false },
      { name: "frequency", defaultValue: 220 },
      { name: "phase", defaultValue: 0 },
      { name: "trigger", defaultValue: 0 },
      { name: "count", defaultValue: 1, min: 1, max: 8, integer: true, connectable: false },
      { name: "subdivisions", defaultValue: 8, min: 1, max: 64, integer: true, connectable: false },
      { name: "subgroups", defaultValue: 4, min: 1, max: 64, integer: true, connectable: false },
      { name: "baseLevel", defaultValue: 0 },
      { name: "rangeMin", defaultValue: -1 },
      { name: "rangeMax", defaultValue: 1 }
    ],
    outputs: [
      { name: "signal" },
      { name: "end trigger" }
    ]
  },
  SamplePlayer: {
    type: "SamplePlayer",
    inputs: [
      { name: "frequency", defaultValue: 440 },
      { name: "originalFrequency", defaultValue: 440, min: 1e-4 },
      { name: "trigger", defaultValue: 0 },
      { name: "voices", defaultValue: 1, min: 1, max: 16, integer: true },
      { name: "start", defaultValue: 0, min: 0, max: 1 },
      { name: "end", defaultValue: 1, min: 0, max: 1 },
      { name: "attack", defaultValue: 0, min: 0, step: 1e-3 },
      { name: "release", defaultValue: 0, min: 0, step: 1e-3 },
      { name: "stretch", defaultValue: 1, min: 1e-3 },
      { name: "cycleLength", defaultValue: 4096, min: 1 },
      { name: "overlapRatio", defaultValue: 0.09, min: 0, max: 1 },
      { name: "mode", defaultValue: 0, min: 0, max: 2, integer: true, connectable: false, valueEditor: false },
      { name: "level", defaultValue: 0.7 }
    ],
    outputs: [{ name: "signal" }]
  },
  Image: {
    type: "Image",
    inputs: [
      { name: "x", defaultValue: 0, min: -1, max: 1 },
      { name: "y", defaultValue: 0, min: -1, max: 1 }
    ],
    outputs: [
      { name: "brightness" },
      { name: "r" },
      { name: "g" },
      { name: "b" },
      { name: "hue" },
      { name: "saturation" }
    ]
  },
  Buffer: {
    type: "Buffer",
    inputs: [
      { name: "signal", valueEditor: false },
      { name: "playhead", defaultValue: 0 },
      { name: "playhead speed", defaultValue: 1 },
      { name: "record head", defaultValue: 0 },
      { name: "record head speed", defaultValue: 1 },
      { name: "length", defaultValue: 1, min: 0.01, max: 10 },
      { name: "on reset", defaultValue: 0, min: 0, max: 1, integer: true, connectable: false, valueEditor: false }
    ],
    outputs: [{ name: "signal" }, { name: "record head out" }]
  },
  Playhead: {
    type: "Playhead",
    inputs: [
      { name: "start", defaultValue: 0 },
      { name: "speed", defaultValue: 1 },
      { name: "length", defaultValue: 1, min: 1e-3 },
      { name: "reset trigger", defaultValue: 0, valueEditor: false }
    ],
    outputs: [{ name: "playhead" }]
  },
  Time: {
    type: "Time",
    inputs: [],
    outputs: [{ name: "seconds" }]
  },
  Freq2Length: {
    type: "Freq2Length",
    inputs: [{ name: "frequency", defaultValue: 1 }],
    outputs: [{ name: "length" }]
  },
  Length2Freq: {
    type: "Length2Freq",
    inputs: [{ name: "length", defaultValue: 1 }],
    outputs: [{ name: "frequency" }]
  },
  Constant: {
    type: "Constant",
    inputs: [{ name: "value", defaultValue: 1 }],
    outputs: [{ name: "signal" }]
  },
  Pass: {
    type: "Pass",
    inputs: [{ name: "signal", valueEditor: false }],
    outputs: [{ name: "signal" }]
  },
  Send: {
    type: "Send",
    inputs: [
      { name: "signal", valueEditor: false },
      { name: "number", defaultValue: 1, min: 1, max: 10, integer: true, connectable: false }
    ],
    outputs: []
  },
  Receive: {
    type: "Receive",
    inputs: [
      { name: "number", defaultValue: 1, min: 1, max: 10, integer: true, connectable: false }
    ],
    outputs: [{ name: "signal" }]
  },
  Slider: {
    type: "Slider",
    inputs: [
      { name: "signal", valueEditor: false },
      { name: "inverse signal", valueEditor: false },
      { name: "value", defaultValue: 0.5, min: 0, max: 1 },
      { name: "curve", defaultValue: 0, min: -8, max: 8 },
      { name: "min", defaultValue: 0 },
      { name: "max", defaultValue: 1 },
      { name: "direction", defaultValue: 0, min: 0, max: 1, integer: true },
      { name: "midiChannel", defaultValue: 0, min: 0, max: 16, integer: true, connectable: false },
      { name: "midiCc", defaultValue: 1, min: 0, max: 127, integer: true, connectable: false }
    ],
    outputs: [{ name: "signal" }, { name: "inverse" }]
  },
  Joystick: {
    type: "Joystick",
    inputs: [
      { name: "xMin", defaultValue: 0 },
      { name: "xMax", defaultValue: 1 },
      { name: "xMidiChannel", defaultValue: 0, min: 0, max: 16, integer: true, connectable: false },
      { name: "xMidiCc", defaultValue: 1, min: 0, max: 127, integer: true, connectable: false },
      { name: "yMin", defaultValue: 0 },
      { name: "yMax", defaultValue: 1 },
      { name: "yMidiChannel", defaultValue: 0, min: 0, max: 16, integer: true, connectable: false },
      { name: "yMidiCc", defaultValue: 2, min: 0, max: 127, integer: true, connectable: false },
      { name: "elasticity", defaultValue: 0, min: 0, connectable: false }
    ],
    outputs: [
      { name: "x" },
      { name: "x inverse" },
      { name: "y" },
      { name: "y inverse" }
    ]
  },
  Button: {
    type: "Button",
    inputs: [
      { name: "signal", valueEditor: false },
      { name: "inverse signal", valueEditor: false },
      { name: "mode", defaultValue: 0, min: 0, max: 2, integer: true, connectable: false, valueEditor: false },
      { name: "midiChannel", defaultValue: 0, min: 0, max: 16, integer: true, connectable: false },
      { name: "midiCc", defaultValue: 1, min: 0, max: 127, integer: true, connectable: false }
    ],
    outputs: [{ name: "signal" }, { name: "inverse" }]
  },
  Keys: {
    type: "Keys",
    inputs: [
      { name: "size", defaultValue: 12, min: 1, max: 128, integer: true },
      { name: "startNote", defaultValue: 60, min: 0, max: 127, integer: true },
      { name: "mode", defaultValue: 0, min: 0, max: 1, integer: true, connectable: false },
      { name: "glide", defaultValue: 0, min: 0, max: 10, step: 0.01 }
    ],
    outputs: [
      { name: "midi note" },
      { name: "frequency" }
    ]
  },
  Sequencer: {
    type: "Sequencer",
    inputs: [
      { name: "steps", defaultValue: SEQUENCER_DEFAULT_STEPS, min: SEQUENCER_MIN_STEPS, max: SEQUENCER_MAX_STEPS, integer: true, connectable: false },
      { name: "rows", defaultValue: SEQUENCER_DEFAULT_ROWS, min: SEQUENCER_MIN_ROWS, max: SEQUENCER_MAX_ROWS, integer: true, connectable: false },
      { name: "beat length", defaultValue: SEQUENCER_DEFAULT_BEAT_LENGTH, min: SEQUENCER_MIN_BEAT_LENGTH, max: SEQUENCER_MAX_STEPS, integer: true, connectable: false },
      { name: "mode", defaultValue: 0, min: 0, max: 1, integer: true, connectable: false, valueEditor: false },
      { name: "signal", defaultValue: 0, valueEditor: false },
      { name: "reset", defaultValue: 0, valueEditor: false }
    ],
    outputs: sequencerOutputDefinitions(SEQUENCER_DEFAULT_ROWS)
  },
  Roll: {
    type: "Roll",
    inputs: [
      { name: "steps", defaultValue: SEQUENCER_DEFAULT_STEPS, min: SEQUENCER_MIN_STEPS, max: SEQUENCER_MAX_STEPS, integer: true, connectable: false },
      { name: "beat length", defaultValue: SEQUENCER_DEFAULT_BEAT_LENGTH, min: SEQUENCER_MIN_BEAT_LENGTH, max: SEQUENCER_MAX_STEPS, integer: true, connectable: false },
      { name: "step length", defaultValue: 1, min: 0.05, max: SEQUENCER_MAX_STEPS, step: 0.05, connectable: false },
      { name: "scale", defaultValue: 0, min: 0, max: QUANTISE_SCALES.length - 1, integer: true, connectable: false, valueEditor: false },
      { name: "middle note", defaultValue: ROLL_DEFAULT_START_NOTE, min: 0, max: 127, integer: true, connectable: false, valueEditor: false },
      { name: "range down", defaultValue: 5, min: 0, max: 63, integer: true, connectable: false },
      { name: "range up", defaultValue: 6, min: 0, max: 63, integer: true, connectable: false },
      { name: "signal", defaultValue: 0, valueEditor: false },
      { name: "reset", defaultValue: 0, valueEditor: false }
    ],
    outputs: [
      { name: "note" },
      { name: "frequency" },
      { name: "velocity" },
      { name: "gate" },
      { name: "trigger" },
      { name: "note on" },
      { name: "note off" }
    ]
  },
  Tempo: {
    type: "Tempo",
    inputs: [
      { name: "bpm", defaultValue: 120, min: 1 },
      { name: "swing", defaultValue: 0, min: -1, max: 1, step: 1e-3 },
      { name: "source", defaultValue: 0, min: 0, max: 1, integer: true, connectable: false, valueEditor: false },
      { name: "midiSource", defaultValue: 0, min: 0, integer: true, connectable: false, valueEditor: false }
    ],
    outputs: [
      { name: "4 bar" },
      { name: "2 bar" },
      { name: "bar" },
      { name: "whole" },
      { name: "half" },
      { name: "quarter / beat" },
      { name: "upbeat" },
      { name: "eighth" },
      { name: "sixteenth" },
      { name: "thirty-second" },
      { name: "4 bar freq" },
      { name: "2 bar freq" },
      { name: "bar freq" },
      { name: "whole freq" },
      { name: "half freq" },
      { name: "quarter / beat freq" },
      { name: "upbeat freq" },
      { name: "eighth freq" },
      { name: "sixteenth freq" },
      { name: "thirty-second freq" }
    ]
  },
  MidiNote: {
    type: "MidiNote",
    inputs: [{ name: "channel", defaultValue: 0, min: 0, max: 16, integer: true }],
    outputs: [
      { name: "note" },
      { name: "frequency" },
      { name: "velocity" },
      { name: "gate" },
      { name: "trigger" }
    ]
  },
  MidiNoteOn: {
    type: "MidiNoteOn",
    inputs: [{ name: "channel", defaultValue: 0, min: 0, max: 16, integer: true }],
    outputs: [
      { name: "note" },
      { name: "frequency" },
      { name: "velocity" }
    ]
  },
  MidiNoteOff: {
    type: "MidiNoteOff",
    inputs: [{ name: "channel", defaultValue: 0, min: 0, max: 16, integer: true }],
    outputs: [
      { name: "note" },
      { name: "frequency" }
    ]
  },
  MidiNoteOnSend: {
    type: "MidiNoteOnSend",
    inputs: [
      { name: "trigger", defaultValue: 0, min: 0, max: 1, valueEditor: false },
      { name: "note", defaultValue: 60, min: 0, max: 127, integer: true },
      { name: "velocity", defaultValue: 1, min: 0, max: 1 },
      { name: "channel", defaultValue: 1, min: 1, max: 16, integer: true }
    ],
    outputs: []
  },
  MidiNoteOffSend: {
    type: "MidiNoteOffSend",
    inputs: [
      { name: "trigger", defaultValue: 0, min: 0, max: 1, valueEditor: false },
      { name: "note", defaultValue: 60, min: 0, max: 127, integer: true },
      { name: "velocity", defaultValue: 0, min: 0, max: 1 },
      { name: "channel", defaultValue: 1, min: 1, max: 16, integer: true }
    ],
    outputs: []
  },
  MidiCcSend: {
    type: "MidiCcSend",
    inputs: [
      { name: "signal", defaultValue: 0, min: 0, max: 1 },
      { name: "trigger", defaultValue: 0, min: 0, max: 1, valueEditor: false },
      { name: "cc", defaultValue: 1, min: 0, max: 127, integer: true },
      { name: "channel", defaultValue: 1, min: 1, max: 16, integer: true },
      { name: "throttle", defaultValue: 0.1, min: 0 }
    ],
    outputs: []
  },
  MidiCc: {
    type: "MidiCc",
    inputs: [
      { name: "channel", defaultValue: 0, min: 0, max: 16, integer: true },
      { name: "cc", defaultValue: 1, min: 0, max: 127, integer: true }
    ],
    outputs: [{ name: "signal" }]
  },
  Selector: {
    type: "Selector",
    inputs: [
      { name: "select", defaultValue: 0, min: 0, integer: true },
      { name: "slide", defaultValue: 0, min: 0 },
      { name: "1", defaultValue: 0 }
    ],
    outputs: [{ name: "signal" }]
  },
  Accumulator: {
    type: "Accumulator",
    inputs: [
      { name: "mode", defaultValue: 0, min: 0, max: 1, integer: true, connectable: false, valueEditor: false },
      { name: "trigger", defaultValue: 0 },
      { name: "reset", defaultValue: 0, valueEditor: false },
      { name: "increment", defaultValue: 1 },
      { name: "min", defaultValue: 0 },
      { name: "max", defaultValue: 1 }
    ],
    outputs: [{ name: "signal" }]
  },
  Quantise: {
    type: "Quantise",
    inputs: [
      { name: "signal", valueEditor: false },
      { name: "scale", defaultValue: 0, min: 0, max: 15, integer: true, connectable: false, valueEditor: false },
      { name: "root", defaultValue: 0, min: 0, max: 11, integer: true, connectable: false, valueEditor: false }
    ],
    outputs: [{ name: "signal" }]
  },
  Abs: processor("Abs", []),
  Map: processor("Map", [
    { name: "srcMin", defaultValue: 0 },
    { name: "srcMax", defaultValue: 1 },
    { name: "trgtMin", defaultValue: 0 },
    { name: "trgtMax", defaultValue: 1 }
  ]),
  Clamp: processor("Clamp", [
    { name: "min", defaultValue: 0 },
    { name: "max", defaultValue: 1 }
  ]),
  Multiply: processor("Multiply", [
    { name: "factor", defaultValue: 1 }
  ]),
  Pow: processor("Pow", [
    { name: "exponent", defaultValue: 1 }
  ]),
  Pan: {
    type: "Pan",
    inputs: [
      { name: "signal", valueEditor: false },
      { name: "pan", defaultValue: 0, min: -1, max: 1 }
    ],
    outputs: [
      { name: "left" },
      { name: "right" }
    ]
  },
  Delay: processor("Delay", [
    { name: "time", defaultValue: 0.28, min: 0, max: 1.5 },
    { name: "feedback", defaultValue: 0.35, min: 0, max: 2 },
    { name: "mix", defaultValue: 0.25, min: 0, max: 1 }
  ]),
  Chorus: processor("Chorus", [
    { name: "rate", defaultValue: 0.8, min: 0.05, max: 6 },
    { name: "depth", defaultValue: 0.012, min: 1e-3, max: 0.04 },
    { name: "mix", defaultValue: 0.25, min: 0, max: 1 }
  ]),
  Reverb: {
    type: "Reverb",
    inputs: [
      { name: "signal", valueEditor: false },
      { name: "mode", defaultValue: 0, min: 0, max: 2, integer: true, connectable: false, valueEditor: false },
      { name: "size", defaultValue: 0.55, min: 0.1, max: 1 },
      { name: "decay", defaultValue: 0.45, min: 0, max: 0.94 },
      { name: "mix", defaultValue: 0.25, min: 0, max: 1 }
    ],
    outputs: [
      { name: "left" },
      { name: "right" }
    ]
  },
  Compress: processor("Compress", [
    { name: "sidechain", valueEditor: false },
    { name: "threshold", defaultValue: -24, min: -80, max: 0, step: 0.1 },
    { name: "ratio", defaultValue: 4, min: 1, max: 20, step: 0.1 },
    { name: "attack", defaultValue: 0.01, min: 0, max: 1, step: 1e-3 },
    { name: "release", defaultValue: 0.1, min: 0, max: 3, step: 1e-3 },
    { name: "knee", defaultValue: 6, min: 0, max: 40, step: 0.1 },
    { name: "makeup", defaultValue: 0, min: -24, max: 24, step: 0.1 }
  ]),
  Limiter: processor("Limiter", [
    { name: "inputGain", defaultValue: 0, min: -24, max: 24, step: 0.1 },
    { name: "ceiling", defaultValue: -1, min: -24, max: 0, step: 0.1 },
    { name: "release", defaultValue: 0.05, min: 1e-3, max: 3, step: 1e-3 },
    { name: "lookahead", defaultValue: 5e-3, min: 0, max: 0.02, step: 1e-3 }
  ]),
  Envelope: {
    type: "Envelope",
    inputs: [
      { name: "signal", valueEditor: false },
      { name: "trigger", valueEditor: false },
      { name: "gate", valueEditor: false },
      { name: "delay", defaultValue: 0, min: 0 },
      { name: "attack", defaultValue: 0.01, min: 0 },
      { name: "decay", defaultValue: 0.16, min: 0 },
      { name: "sustain", defaultValue: 0.72 },
      { name: "gateLength", defaultValue: 0, min: 0 },
      { name: "release", defaultValue: 0.24, min: 0 }
    ],
    outputs: [
      { name: "signal" },
      { name: "end trigger" }
    ]
  },
  Follower: processor("Follower", [
    { name: "attack", defaultValue: 0.01, min: 0 },
    { name: "release", defaultValue: 0.12, min: 0 }
  ]),
  RemoveDc: processor("RemoveDc", []),
  Fold: processor("Fold", [
    { name: "amount", defaultValue: 1 }
  ]),
  Meter: processor("Meter", [
    { name: "range", defaultValue: 1, min: 1e-3 },
    { name: "mode", defaultValue: 0, min: 0, max: 1, integer: true, connectable: false, valueEditor: false }
  ]),
  Scope: processor("Scope", [
    { name: "range", defaultValue: 1, min: 1e-3 },
    { name: "mode", defaultValue: 1, min: 0, max: 1, integer: true, connectable: false, valueEditor: false },
    { name: "length", defaultValue: 0.08, min: 0.01, max: 30, step: 0.01, connectable: false },
    { name: "reset", defaultValue: 1, min: 0, max: 1, integer: true, connectable: false, valueEditor: false }
  ]),
  FFT: {
    type: "FFT",
    inputs: [
      { name: "signal", valueEditor: false },
      { name: "minFreq", defaultValue: 20, min: 20, max: 2e4, step: 1, connectable: false },
      { name: "maxFreq", defaultValue: 2e4, min: 20, max: 2e4, step: 1, connectable: false }
    ],
    outputs: [
      { name: "frequency" },
      { name: "amplitude" }
    ]
  },
  LowpassFilter: filter("LowpassFilter"),
  HighpassFilter: filter("HighpassFilter"),
  BandpassFilter: filter("BandpassFilter"),
  AllpassFilter: filter("AllpassFilter"),
  Crossover: {
    type: "Crossover",
    inputs: [
      { name: "signal", valueEditor: false },
      { name: "points", defaultValue: 1, min: 1, max: 8, integer: true, connectable: false },
      { name: "slope", defaultValue: 24, min: 12, max: 48, step: 12, integer: true, connectable: false }
    ],
    outputs: []
  },
  Equalizer: processor("Equalizer", [
    { name: "lows", defaultValue: 0, min: -24, max: 24, step: 0.1 },
    { name: "mids", defaultValue: 0, min: -24, max: 24, step: 0.1 },
    { name: "highs", defaultValue: 0, min: -24, max: 24, step: 0.1 }
  ]),
  FormantFilter: processor("FormantFilter", [
    { name: "morph", defaultValue: 0, min: 0, max: 1 },
    { name: "intensity", defaultValue: 8, min: 0 }
  ]),
  CombFilter: processor("CombFilter", [
    { name: "frequency", defaultValue: 440 },
    { name: "feedback", defaultValue: 0.45, min: -0.999, max: 0.999 }
  ]),
  CombNotchFilter: processor("CombNotchFilter", [
    { name: "frequency", defaultValue: 440 },
    { name: "feedback", defaultValue: 0.45, min: -0.999, max: 0.999 }
  ]),
  HardClipDistortion: distortion("HardClipDistortion"),
  SoftClipDistortion: distortion("SoftClipDistortion"),
  FuzzDistortion: distortion("FuzzDistortion"),
  SaturateDistortion: distortion("SaturateDistortion"),
  WavefoldDistortion: distortion("WavefoldDistortion")
};
var NODE_TYPE_LIST = Object.keys(NODE_DEFINITIONS);
var NODE_TYPE_LABELS = {
  Expression: "Expression",
  Group: "Group",
  Spread: "Spread",
  Spawn: "Spawn",
  Ins: "Ins",
  Params: "Params",
  Outs: "Outs",
  AudioOut: "Audio Out",
  SineOsc: "Sine Osc",
  TriangleOsc: "Triangle Osc",
  SawOsc: "Saw Osc",
  RampOsc: "Ramp Osc",
  SquareOsc: "Square Osc",
  KinkOsc: "Kink Osc",
  SampleHoldOsc: "Sample Hold",
  PerlinNoise: "Perlin Noise",
  Noise: "Noise",
  Random: "Random",
  AudioInput: "Audio Input",
  CustomWave: "Custom Wave",
  SamplePlayer: "Sample",
  Image: "Image",
  Buffer: "Buffer",
  Playhead: "Playhead",
  Time: "Time",
  Freq2Length: "freq2length",
  Length2Freq: "length2freq",
  Constant: "Constant",
  Pass: "Pass",
  Send: "Send",
  Receive: "Receive",
  Slider: "Slider",
  Joystick: "Joystick",
  Button: "Button",
  Keys: "Keys",
  Sequencer: "Sequencer",
  Roll: "Roll",
  Tempo: "Tempo",
  MidiNote: "MIDI Note",
  MidiNoteOn: "MIDI Note On",
  MidiNoteOff: "MIDI Note Off",
  MidiNoteOnSend: "MIDI Note On Send",
  MidiNoteOffSend: "MIDI Note Off Send",
  MidiCcSend: "MIDI CC Send",
  MidiCc: "MIDI CC",
  Selector: "Selector",
  Accumulator: "Accumulator",
  Quantise: "Quantise",
  Abs: "Abs",
  Map: "Map",
  Clamp: "Clamp",
  Multiply: "Multiply",
  Pow: "pow",
  Pan: "Pan",
  Delay: "Delay",
  Chorus: "Chorus",
  Reverb: "Reverb",
  Compress: "Compress",
  Limiter: "Limiter",
  Envelope: "Envelope",
  Follower: "Follower",
  RemoveDc: "Remove DC",
  Fold: "Fold",
  Meter: "Meter",
  Scope: "Scope",
  FFT: "FFT",
  LowpassFilter: "Lowpass Filter",
  HighpassFilter: "Highpass Filter",
  BandpassFilter: "Bandpass Filter",
  AllpassFilter: "Allpass Filter",
  Crossover: "Crossover",
  Equalizer: "Equaliser",
  FormantFilter: "Formant Filter",
  CombFilter: "Comb Filter",
  CombNotchFilter: "Comb Notch",
  HardClipDistortion: "Hard Clip",
  SoftClipDistortion: "Soft Clip",
  FuzzDistortion: "Fuzz",
  SaturateDistortion: "Saturate",
  WavefoldDistortion: "Wavefold"
};
function getDefinition(type) {
  return NODE_DEFINITIONS[type];
}
function getNodeDefinition(node) {
  if (node.type === "Expression") {
    return {
      type: node.type,
      inputs: node.inputs ?? [],
      outputs: getDefinition(node.type).outputs
    };
  }
  if (node.type === "Group") {
    return {
      type: node.type,
      inputs: node.inputs ?? [],
      outputs: node.outputs ?? []
    };
  }
  if (node.type === "Ins" || node.type === "Params") {
    return {
      type: node.type,
      inputs: [],
      outputs: node.outputs ?? []
    };
  }
  if (node.type === "Outs") {
    return {
      type: node.type,
      inputs: node.inputs ?? [],
      outputs: []
    };
  }
  if (node.type === "Accumulator") {
    const definition = getDefinition(node.type);
    const inputs2 = [...node.inputs ?? definition.inputs];
    for (const [name, precedingName] of [["increment", "reset"], ["mode", "increment"]]) {
      if (inputs2.some((input2) => input2.name === name)) continue;
      const input = definition.inputs.find((candidate) => candidate.name === name);
      if (!input) continue;
      const precedingIndex = inputs2.findIndex((candidate) => candidate.name === precedingName);
      inputs2.splice(precedingIndex >= 0 ? precedingIndex + 1 : inputs2.length, 0, input);
    }
    const modeIndex = inputs2.findIndex((input) => input.name === "mode");
    if (modeIndex > 0) inputs2.unshift(...inputs2.splice(modeIndex, 1));
    return {
      ...definition,
      inputs: inputs2,
      outputs: node.outputs ?? definition.outputs
    };
  }
  if (node.type === "Slider") {
    const definition = getDefinition(node.type);
    const inputs2 = [...node.inputs ?? definition.inputs];
    if (!inputs2.some((input) => input.name === "curve")) {
      const curve = definition.inputs.find((input) => input.name === "curve");
      const valueIndex2 = inputs2.findIndex((input) => input.name === "value");
      if (curve) inputs2.splice(valueIndex2 >= 0 ? valueIndex2 + 1 : inputs2.length, 0, curve);
    }
    return {
      ...definition,
      inputs: inputs2,
      outputs: node.outputs ?? definition.outputs
    };
  }
  if (node.type === "CustomWave") {
    const definition = getDefinition(node.type);
    const inputs2 = [...node.inputs ?? definition.inputs];
    if (!inputs2.some((input) => input.name === "mode")) {
      const mode = definition.inputs.find((input) => input.name === "mode");
      if (mode) inputs2.unshift(mode);
    }
    if (!inputs2.some((input) => input.name === "baseLevel")) {
      const baseLevel = definition.inputs.find((input) => input.name === "baseLevel");
      const rangeMinIndex = inputs2.findIndex((input) => input.name === "rangeMin");
      if (baseLevel) inputs2.splice(rangeMinIndex >= 0 ? rangeMinIndex : inputs2.length, 0, baseLevel);
    }
    return {
      ...definition,
      inputs: inputs2,
      outputs: node.outputs ?? customWaveOutputDefinitions(node.params.count)
    };
  }
  if (node.type === "Crossover") {
    const points = clampInteger(node.params.points, 1, 8, 1);
    const definition = getDefinition(node.type);
    return {
      ...definition,
      inputs: [
        ...definition.inputs,
        ...Array.from({ length: points }, (_, index) => ({
          name: `frequency ${index + 1}`,
          defaultValue: [1200, 4e3, 8e3, 12e3, 15e3, 17e3, 18500, 19500][index],
          min: 20,
          max: 2e4
        }))
      ],
      outputs: Array.from({ length: points + 1 }, (_, index) => ({ name: `band ${index + 1}` }))
    };
  }
  if (node.type === "Sequencer") {
    return {
      ...getDefinition(node.type),
      inputs: node.inputs ?? getDefinition(node.type).inputs,
      outputs: sequencerOutputDefinitions(sequencerShape(node.params).rows)
    };
  }
  if (node.type === "Reverb") {
    const definition = getDefinition(node.type);
    const mode = definition.inputs.find((input) => input.name === "mode");
    const inputs2 = (node.inputs ?? definition.inputs).filter((input) => input.name !== "mode");
    inputs2.splice(1, 0, mode);
    return { ...definition, inputs: inputs2, outputs: node.outputs ?? definition.outputs };
  }
  if (node.type === "Roll") {
    return getDefinition(node.type);
  }
  return {
    ...getDefinition(node.type),
    inputs: node.inputs ?? getDefinition(node.type).inputs,
    outputs: node.outputs ?? getDefinition(node.type).outputs
  };
}
function customWaveOutputDefinitions(count) {
  const waveCount = Math.max(1, Math.min(8, Math.round(Number.isFinite(count) ? count : 1)));
  return waveCount === 1 ? getDefinition("CustomWave").outputs : [...Array.from({ length: waveCount }, (_, index) => ({ name: `signal ${index + 1}` })), { name: "end trigger" }];
}
function sequencerShape(params) {
  return {
    steps: clampInteger(params.steps, SEQUENCER_MIN_STEPS, SEQUENCER_MAX_STEPS, SEQUENCER_DEFAULT_STEPS),
    rows: clampInteger(params.rows, SEQUENCER_MIN_ROWS, SEQUENCER_MAX_ROWS, SEQUENCER_DEFAULT_ROWS),
    beatLength: clampInteger(params["beat length"] ?? params.beatLength, SEQUENCER_MIN_BEAT_LENGTH, SEQUENCER_MAX_STEPS, SEQUENCER_DEFAULT_BEAT_LENGTH)
  };
}
function rollShape(params) {
  const legacyStartNote = clampInteger(params.startNote, 0, 127, ROLL_DEFAULT_START_NOTE);
  const middleNote = clampInteger(params["middle note"] ?? legacyStartNote, 0, 127, ROLL_DEFAULT_START_NOTE);
  const scale = clampInteger(params.scale, 0, QUANTISE_SCALES.length - 1, 0);
  const scaleSemitones = QUANTISE_SCALES[scale].semitones;
  const legacyRangeUp = params["highest note"] === void 0 ? ROLL_ROWS - 1 : Math.max(0, Math.round(params["highest note"]) - legacyStartNote);
  const rangeDown = clampInteger(params["range down"] ?? (params["lowest note"] === void 0 ? 0 : Math.max(0, legacyStartNote - Math.round(params["lowest note"]))), 0, 63, 5);
  const rangeUp = clampInteger(params["range up"] ?? legacyRangeUp, 0, Math.min(63, ROLL_MAX_ROWS - rangeDown - 1), 6);
  const scaleOffset = (index) => {
    const octave = Math.floor(index / scaleSemitones.length);
    const degree = (index % scaleSemitones.length + scaleSemitones.length) % scaleSemitones.length;
    return octave * 12 + scaleSemitones[degree];
  };
  const rows = Array.from({ length: rangeDown + rangeUp + 1 }, (_, offset) => {
    const index = offset - rangeDown;
    return { index, note: clampInteger(middleNote + scaleOffset(index), 0, 127, middleNote) };
  });
  return {
    steps: clampInteger(params.steps, SEQUENCER_MIN_STEPS, SEQUENCER_MAX_STEPS, SEQUENCER_DEFAULT_STEPS),
    beatLength: clampInteger(params["beat length"] ?? params.beatLength, SEQUENCER_MIN_BEAT_LENGTH, SEQUENCER_MAX_STEPS, SEQUENCER_DEFAULT_BEAT_LENGTH),
    stepLength: Math.max(0.05, Math.min(SEQUENCER_MAX_STEPS, Number.isFinite(params["step length"]) ? params["step length"] : Number.isFinite(params.stepLength) ? params.stepLength : 1)),
    scale,
    middleNote,
    rangeDown,
    rangeUp,
    rows
  };
}
function rollCellParamName(rowIndex, stepIndex) {
  return `roll:${rowIndex}:${stepIndex}`;
}
function rollGateParamName(rowIndex, slot, field) {
  return `roll:gate:${field}:${rowIndex}:${slot}`;
}
function rollGateVelocityParamName(rowIndex, slot) {
  return `roll:velocity:${rowIndex}:${slot}`;
}
function rollGatesForRow(params, rowIndex, steps) {
  const gates = [];
  for (let slot = 0; slot < steps; slot += 1) {
    if ((params[rollGateParamName(rowIndex, slot, "active")] ?? params[rollCellParamName(rowIndex, slot)] ?? 0) < 0.5) continue;
    const start = Math.max(0, Math.min(steps, params[rollGateParamName(rowIndex, slot, "start")] ?? slot));
    const end = Math.max(start, Math.min(steps, params[rollGateParamName(rowIndex, slot, "end")] ?? start + 1));
    const velocity = Math.max(SEQUENCER_MIN_VELOCITY, Math.min(1, params[rollGateVelocityParamName(rowIndex, slot)] ?? 1));
    if (end > start) gates.push({ slot, start, end, velocity });
  }
  return trimOverlappingSequencerGates(gates);
}
function sequencerOutputName(rowIndex) {
  return String(rowIndex + 1);
}
function sequencerOutputIndex(port) {
  if (!/^(0|[1-9][0-9]*)$/.test(port)) return null;
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1 || value > SEQUENCER_MAX_ROWS) return null;
  return value - 1;
}
function sequencerCellParamName(rowIndex, stepIndex) {
  return `cell:${rowIndex}:${stepIndex}`;
}
var SEQUENCER_GATE_MODE_PARAM = "mode";
var SEQUENCER_GATE_INITIALIZED_PARAM = "gate:initialized";
var SEQUENCER_MIN_VELOCITY = 0.1;
function trimOverlappingSequencerGates(gates) {
  const ordered = [...gates].sort((a, b) => a.start - b.start || a.slot - b.slot);
  return ordered.flatMap((gate, index) => {
    const nextStart = ordered[index + 1]?.start ?? Number.POSITIVE_INFINITY;
    const end = Math.min(gate.end, nextStart);
    return end > gate.start ? [{ ...gate, end }] : [];
  });
}
function sequencerUsesGateMode(params) {
  return (params[SEQUENCER_GATE_MODE_PARAM] ?? params.gateMode ?? 0) >= 0.5;
}
function sequencerGateParamName(rowIndex, slot, field) {
  return `gate:${field}:${rowIndex}:${slot}`;
}
function sequencerTriggerPositionParamName(rowIndex, slot) {
  return `trigger:position:${rowIndex}:${slot}`;
}
function sequencerStepVelocityParamName(rowIndex, slot) {
  return `velocity:${rowIndex}:${slot}`;
}
function sequencerStepVelocity(params, rowIndex, slot) {
  const value = params[sequencerStepVelocityParamName(rowIndex, slot)] ?? 1;
  if (!Number.isFinite(value)) return 1;
  return Math.max(SEQUENCER_MIN_VELOCITY, Math.min(1, value));
}
function sequencerTriggersForRow(params, rowIndex, steps) {
  const triggers = [];
  for (let slot = 0; slot < steps; slot += 1) {
    if ((params[sequencerCellParamName(rowIndex, slot)] ?? 0) < 0.5) continue;
    const position = params[sequencerTriggerPositionParamName(rowIndex, slot)] ?? slot;
    if (position < 0 || position >= steps) continue;
    triggers.push({
      slot,
      position,
      velocity: sequencerStepVelocity(params, rowIndex, slot)
    });
  }
  return triggers;
}
function sequencerGatesForRow(params, rowIndex, steps) {
  if ((params[SEQUENCER_GATE_INITIALIZED_PARAM] ?? 0) < 0.5) {
    const legacy = [];
    for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
      if ((params[sequencerCellParamName(rowIndex, stepIndex)] ?? 0) >= 0.5) {
        legacy.push({ slot: stepIndex, start: stepIndex, end: stepIndex + 1, velocity: sequencerStepVelocity(params, rowIndex, stepIndex) });
      }
    }
    return trimOverlappingSequencerGates(legacy);
  }
  const gates = [];
  for (let slot = 0; slot < steps; slot += 1) {
    if ((params[sequencerGateParamName(rowIndex, slot, "active")] ?? 0) < 0.5) continue;
    const start = Math.max(0, Math.min(steps, params[sequencerGateParamName(rowIndex, slot, "start")] ?? slot));
    const end = Math.max(start, Math.min(steps, params[sequencerGateParamName(rowIndex, slot, "end")] ?? start + 1));
    if (end > start) gates.push({ slot, start, end, velocity: sequencerStepVelocity(params, rowIndex, slot) });
  }
  return trimOverlappingSequencerGates(gates);
}
function sequencerOutputDefinitions(rows) {
  return [
    ...Array.from({ length: rows }, (_, rowIndex) => ({ name: sequencerOutputName(rowIndex) })),
    { name: SEQUENCER_INDEX_OUTPUT }
  ];
}
function getNodeTypeLabel(type) {
  return NODE_TYPE_LABELS[type];
}
function defaultParamsFor(type) {
  const params = {};
  for (const input of getDefinition(type).inputs) {
    if (input.defaultValue !== void 0) {
      params[input.name] = input.defaultValue;
    }
  }
  if (type === "Crossover") {
    [1200, 4e3, 8e3, 12e3, 15e3, 17e3, 18500, 19500].forEach((frequency, index) => {
      params[`frequency ${index + 1}`] = frequency;
    });
  }
  return params;
}
function oscillator(type) {
  return {
    type,
    inputs: [
      { name: "frequency", defaultValue: 220 },
      { name: "phase", defaultValue: 0 },
      { name: "phaseReset", defaultValue: 0 },
      { name: "rangeMin", defaultValue: -1 },
      { name: "rangeMax", defaultValue: 1 }
    ],
    outputs: [{ name: "signal" }]
  };
}
function processor(type, params) {
  return {
    type,
    inputs: [
      { name: "signal", valueEditor: false },
      ...params
    ],
    outputs: [{ name: "signal" }]
  };
}
function filter(type) {
  return processor(type, [
    { name: "cutoff", defaultValue: 1200, min: 0 },
    { name: "resonance", defaultValue: 0.7, min: 0 }
  ]);
}
function distortion(type) {
  return processor(type, [
    { name: "drive", defaultValue: 2.5, min: 0 }
  ]);
}
function clampInteger(value, min, max, fallback) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

// editor/src/graph/patchCompatibility.ts
function normalizePatchCompatibility(patch) {
  const legacySelectorIds = new Set(
    patch.nodes.filter(isZeroBasedSelector).map((node) => node.id)
  );
  const accumulatorIds = legacySelectorAccumulatorIds(patch, legacySelectorIds);
  const nodes = patch.nodes.map((node) => {
    const normalized = normalizeCompatibleNode(node, legacySelectorIds.has(node.id));
    return accumulatorIds.has(node.id) ? shiftAccumulatorSelectorRange(normalized) : normalized;
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return {
    ...patch,
    nodes,
    links: patch.links.map((link) => normalizeCompatibleLink(link, nodeById, legacySelectorIds)).filter((link) => link !== null && linkPortsExist(link, nodeById))
  };
}
function normalizeCompatibleNode(node, isLegacySelector) {
  const legacyParams = normalizeLegacyNodeParams(node.type, node.params);
  const legacyInputs = normalizeLegacyInputDefinitions(node.type, node.inputs);
  const { params, inputs: inputs2 } = isLegacySelector ? normalizeZeroBasedSelector(legacyParams, legacyInputs) : { params: legacyParams, inputs: legacyInputs };
  const outputs = normalizeLegacyOutputDefinitions(node.type, node.outputs);
  return {
    ...node,
    params,
    ...inputs2 ? { inputs: inputs2 } : {},
    ...outputs ? { outputs } : {},
    ...node.subpatch ? { subpatch: normalizePatchCompatibility(node.subpatch) } : {}
  };
}
function normalizeCompatibleLink(link, nodeById, legacySelectorIds) {
  let normalizedLink = link;
  if (legacySelectorIds.has(link.to.node) && isSelectorValuePort(link.to.port)) {
    normalizedLink = {
      ...normalizedLink,
      to: {
        ...normalizedLink.to,
        port: String(Number(normalizedLink.to.port) + 1)
      }
    };
  }
  const sourceNode = nodeById.get(normalizedLink.from.node);
  if (sourceNode?.type === "Reverb" && normalizedLink.from.port === "signal") {
    normalizedLink = {
      ...normalizedLink,
      from: {
        ...normalizedLink.from,
        port: "left"
      }
    };
  }
  const targetNode = nodeById.get(normalizedLink.to.node);
  if (targetNode?.type === "Buffer" && normalizedLink.to.port === "recordHead") {
    normalizedLink = {
      ...normalizedLink,
      to: {
        ...normalizedLink.to,
        port: "record head"
      }
    };
  }
  if (targetNode?.type === "CustomWave" && normalizedLink.to.port === "phaseReset") {
    normalizedLink = {
      ...normalizedLink,
      to: {
        ...normalizedLink.to,
        port: "trigger"
      }
    };
  }
  if (targetNode?.type === "Sequencer" && normalizedLink.to.port === "tick") {
    normalizedLink = {
      ...normalizedLink,
      to: {
        ...normalizedLink.to,
        port: "signal"
      }
    };
  }
  if (targetNode?.type !== "SamplePlayer" || normalizedLink.to.port !== "originalPitch") return normalizedLink;
  return {
    ...normalizedLink,
    to: {
      ...normalizedLink.to,
      port: "originalFrequency"
    }
  };
}
function isZeroBasedSelector(node) {
  return node.type === "Selector" && (node.inputs?.some((input) => input.name === "0") === true || Object.prototype.hasOwnProperty.call(node.params, "0"));
}
function normalizeZeroBasedSelector(params, inputs2) {
  const nextParams = Object.fromEntries(
    Object.entries(params).map(([name, value]) => isSelectorValuePort(name) ? [String(Number(name) + 1), value] : [name, value])
  );
  if (Number.isFinite(nextParams.select)) nextParams.select += 1;
  return {
    params: nextParams,
    inputs: inputs2?.map((input) => isSelectorValuePort(input.name) ? { ...input, name: String(Number(input.name) + 1) } : input)
  };
}
function legacySelectorAccumulatorIds(patch, legacySelectorIds) {
  const nodesById = new Map(patch.nodes.map((node) => [node.id, node]));
  const ids = /* @__PURE__ */ new Set();
  for (const link of patch.links) {
    if (!legacySelectorIds.has(link.to.node) || link.to.port !== "select" || link.from.port !== "signal") continue;
    const source = nodesById.get(link.from.node);
    if (source?.type !== "Accumulator") continue;
    const outgoing = patch.links.filter((candidate) => candidate.from.node === source.id && candidate.from.port === "signal");
    const onlySelectsLegacySelectors = outgoing.length > 0 && outgoing.every((candidate) => legacySelectorIds.has(candidate.to.node) && candidate.to.port === "select");
    const hasRangeInput = patch.links.some((candidate) => candidate.to.node === source.id && (candidate.to.port === "min" || candidate.to.port === "max"));
    if (onlySelectsLegacySelectors && !hasRangeInput) ids.add(source.id);
  }
  return ids;
}
function shiftAccumulatorSelectorRange(node) {
  const shift = (value) => typeof value === "number" && Number.isFinite(value) ? value + 1 : value;
  return {
    ...node,
    params: {
      ...node.params,
      ...shift(node.params.min) !== void 0 ? { min: shift(node.params.min) } : {},
      ...shift(node.params.max) !== void 0 ? { max: shift(node.params.max) } : {}
    },
    ...node.inputs ? {
      inputs: node.inputs.map((input) => input.name === "min" || input.name === "max" ? { ...input, ...shift(input.defaultValue) !== void 0 ? { defaultValue: shift(input.defaultValue) } : {} } : input)
    } : {}
  };
}
function isSelectorValuePort(name) {
  return /^(0|[1-9][0-9]*)$/.test(name);
}
function linkPortsExist(link, nodeById) {
  return portExists(nodeById.get(link.from.node), "outputs", link.from.port) && portExists(nodeById.get(link.to.node), "inputs", link.to.port);
}
function portExists(node, side, port) {
  if (!node) return false;
  return getNodeDefinition(node)[side].some((entry) => entry.name === port);
}
function normalizeLegacyNodeParams(type, params) {
  if (type === "Buffer" && params.recordHead !== void 0) {
    const { recordHead, ...nextParams2 } = params;
    return {
      ...nextParams2,
      "record head": params["record head"] ?? recordHead
    };
  }
  if (type === "CustomWave" && params.phaseReset !== void 0) {
    const { phaseReset, ...nextParams2 } = params;
    return {
      ...nextParams2,
      trigger: params.trigger ?? phaseReset
    };
  }
  if (type !== "SamplePlayer" || params.originalFrequency !== void 0 || params.originalPitch === void 0) {
    return params;
  }
  const { originalPitch, ...nextParams } = params;
  return {
    ...nextParams,
    originalFrequency: midiNoteFrequency(originalPitch)
  };
}
function normalizeLegacyInputDefinitions(type, inputs2) {
  if (type === "Slider") {
    if (!inputs2) return inputs2;
    const normalized = [...inputs2];
    if (!normalized.some((input) => input.name === "inverse signal")) {
      const signalIndex = normalized.findIndex((input) => input.name === "signal");
      normalized.splice(signalIndex >= 0 ? signalIndex + 1 : 0, 0, { name: "inverse signal", valueEditor: false });
    }
    if (!normalized.some((input) => input.name === "curve")) {
      const valueIndex2 = normalized.findIndex((input) => input.name === "value");
      normalized.splice(valueIndex2 >= 0 ? valueIndex2 + 1 : normalized.length, 0, { name: "curve", defaultValue: 0, min: -8, max: 8 });
    }
    return normalized;
  }
  if (type === "Button") {
    if (!inputs2 || inputs2.some((input) => input.name === "inverse signal")) return inputs2;
    const normalized = [...inputs2];
    const signalIndex = normalized.findIndex((input) => input.name === "signal");
    normalized.splice(signalIndex >= 0 ? signalIndex + 1 : 0, 0, { name: "inverse signal", valueEditor: false });
    return normalized;
  }
  if (type === "Playhead") {
    if (!inputs2) return inputs2;
    const normalized = [...inputs2];
    if (!normalized.some((input) => input.name === "length")) {
      normalized.push({ name: "length", defaultValue: 1, min: 1e-3 });
    }
    if (!normalized.some((input) => input.name === "reset trigger")) {
      normalized.push({ name: "reset trigger", defaultValue: 0, valueEditor: false });
    }
    return normalized;
  }
  if (type === "Buffer") {
    if (!inputs2) return inputs2;
    const normalized = inputs2.map((input) => input.name === "recordHead" ? { ...input, name: "record head" } : input);
    if (!normalized.some((input) => input.name === "on reset")) {
      normalized.push({ name: "on reset", defaultValue: 0, min: 0, max: 1, integer: true, connectable: false, valueEditor: false });
    }
    return normalized;
  }
  if (type === "CustomWave") {
    return inputs2?.map((input) => input.name === "phaseReset" ? { ...input, name: "trigger" } : input);
  }
  if (type !== "SamplePlayer") return inputs2;
  return inputs2?.map((input) => input.name === "originalPitch" ? { ...input, name: "originalFrequency", defaultValue: input.defaultValue === 60 ? 440 : input.defaultValue } : input);
}
function normalizeLegacyOutputDefinitions(type, outputs) {
  if (type === "Buffer") {
    if (!outputs) return outputs;
    return outputs.some((output) => output.name === "record head out") ? outputs : [...outputs, { name: "record head out" }];
  }
  if (type === "Slider" || type === "Button") {
    if (!outputs) return outputs;
    return outputs.some((output) => output.name === "inverse") ? outputs : [...outputs, { name: "inverse" }];
  }
  if (type === "Joystick") {
    if (!outputs) return outputs;
    const nextOutputs2 = [...outputs];
    for (const name of ["x inverse", "y inverse"]) {
      if (!nextOutputs2.some((output) => output.name === name)) nextOutputs2.push({ name });
    }
    return nextOutputs2;
  }
  if (type !== "Reverb") return outputs;
  const nextOutputs = outputs?.filter((output) => output.name !== "signal");
  return nextOutputs && nextOutputs.length > 0 ? nextOutputs : void 0;
}
function midiNoteFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

// editor/src/graph/parse.ts
var DEFAULT_EXPRESSION = "a";
function clampScopeNodeSize(size) {
  const dimension = (value) => Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
  return { width: dimension(size.width), height: dimension(size.height) };
}
var clampCustomWaveNodeSize = clampScopeNodeSize;
var clampControlNodeSize = clampScopeNodeSize;
function clampImageNodeSize(size, aspect) {
  const width = clampScopeNodeSize(size).width;
  return clampScopeNodeSize({ width, height: width / (Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9) });
}
function parsePatchJson(json) {
  const parsed = JSON.parse(json);
  return parsePatchObject(parsed, "Patch JSON");
}
function parsePatchObject(value, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  if (value.schemaVersion !== void 0 && value.schemaVersion !== 1) throw new Error(`${label} has an unsupported schema version.`);
  if (!Array.isArray(value.nodes)) {
    throw new Error(`${label} must contain a nodes array.`);
  }
  if (!Array.isArray(value.links)) {
    throw new Error(`${label} must contain a links array.`);
  }
  return normalizePatchCompatibility({
    ...value.schemaVersion === 1 ? { schemaVersion: 1 } : {},
    ...typeof value.name === "string" ? { name: value.name } : {},
    ...parseBufferAssets(value.buffers, label),
    ...parseMidiInputPreferences(value.midiInput),
    ...parsePatchAreas(value.areas, label),
    nodes: value.nodes.flatMap((node, index) => {
      const parsedNode = parsePatchNode(node, index);
      return parsedNode ? [parsedNode] : [];
    }),
    links: value.links.map((link, index) => parsePatchLink(link, index))
  });
}
function parseBufferAssets(value, label) {
  if (value === void 0) return {};
  if (!isRecord(value)) throw new Error(`${label} buffers must be an object.`);
  const buffers = {};
  for (const [nodeId, entry] of Object.entries(value)) {
    if (!nodeId || !isRecord(entry) || typeof entry.hash !== "string" || !/^[a-f0-9]{64}$/.test(entry.hash) || typeof entry.sampleRate !== "number" || !Number.isFinite(entry.sampleRate) || entry.sampleRate <= 0 || typeof entry.sampleCount !== "number" || !Number.isSafeInteger(entry.sampleCount) || entry.sampleCount < 2 || entry.sampleCount > 96e4) {
      throw new Error(`${label} has an invalid Buffer reference for "${nodeId}".`);
    }
    buffers[nodeId] = {
      hash: entry.hash,
      sampleRate: entry.sampleRate,
      sampleCount: entry.sampleCount
    };
  }
  return Object.keys(buffers).length > 0 ? { buffers } : {};
}
function parsePatchAreas(value, label) {
  if (value === void 0) return {};
  if (!Array.isArray(value)) throw new Error(`${label} areas must be an array.`);
  const areas = value.map((area, index) => {
    if (!isRecord(area) || typeof area.id !== "string" || typeof area.title !== "string") {
      throw new Error(`${label} area ${index} needs string id and title values.`);
    }
    if (!isRecord(area.position) || !isRecord(area.size) || typeof area.position.x !== "number" || typeof area.position.y !== "number" || typeof area.size.width !== "number" || typeof area.size.height !== "number") {
      throw new Error(`${label} area ${index} needs numeric position and size values.`);
    }
    return {
      id: area.id,
      title: area.title,
      position: { x: area.position.x, y: area.position.y },
      size: { width: area.size.width, height: area.size.height },
      ...area.kind === "spread" ? { kind: "spread" } : {},
      ...typeof area.spreadNodeId === "string" ? { spreadNodeId: area.spreadNodeId } : {},
      ...typeof area.uiHeight === "number" ? { uiHeight: area.uiHeight } : {},
      ...typeof area.collapsed === "boolean" ? { collapsed: area.collapsed } : {},
      ...typeof area.locked === "boolean" ? { locked: area.locked } : {},
      ...Array.isArray(area.nodeIds) && area.nodeIds.every((entry) => typeof entry === "string") ? { nodeIds: area.nodeIds } : {},
      ...Array.isArray(area.areaIds) && area.areaIds.every((entry) => typeof entry === "string") ? { areaIds: area.areaIds } : {}
    };
  });
  return areas.length > 0 ? { areas } : {};
}
function parseMidiInputPreferences(value) {
  if (!isRecord(value)) return {};
  const selectedDeviceIds = normalizeSelectedMidiDeviceIds(value.selectedDeviceIds);
  const selectedOutputDeviceIds = normalizeSelectedMidiDeviceIds(value.selectedOutputDeviceIds);
  const sendClock = value.sendClock === true;
  return selectedDeviceIds.length > 0 || selectedOutputDeviceIds.length > 0 || sendClock ? { midiInput: {
    selectedDeviceIds,
    ...selectedOutputDeviceIds.length > 0 ? { selectedOutputDeviceIds } : {},
    ...sendClock ? { sendClock: true } : {}
  } } : {};
}
function parsePatchNode(value, index) {
  if (!isRecord(value)) {
    throw new Error(`Node ${index} must be an object.`);
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    throw new Error(`Node ${index} needs a string id.`);
  }
  if (!isNodeType(value.type)) {
    return null;
  }
  if (!isNumberRecord(value.params)) {
    throw new Error(`Node "${value.id}" needs numeric params.`);
  }
  if (value.expression !== void 0 && typeof value.expression !== "string") {
    throw new Error(`Node "${value.id}" expression must be a string.`);
  }
  if (value.subpatchName !== void 0 && typeof value.subpatchName !== "string") {
    throw new Error(`Node "${value.id}" subpatchName must be a string.`);
  }
  if (value.customLabel !== void 0 && typeof value.customLabel !== "string") {
    throw new Error(`Node "${value.id}" customLabel must be a string.`);
  }
  if (value.subpatchCloneId !== void 0 && typeof value.subpatchCloneId !== "string") {
    throw new Error(`Node "${value.id}" subpatchCloneId must be a string.`);
  }
  if (value.sequencerRowLabels !== void 0 && (!Array.isArray(value.sequencerRowLabels) || !value.sequencerRowLabels.every((entry) => typeof entry === "string"))) throw new Error(`Node "${value.id}" sequencerRowLabels must be strings.`);
  if (value.sequencerRowLabelColumnWidth !== void 0 && (typeof value.sequencerRowLabelColumnWidth !== "number" || !Number.isFinite(value.sequencerRowLabelColumnWidth) || value.sequencerRowLabelColumnWidth < 0)) throw new Error(`Node "${value.id}" has invalid row-label width.`);
  const subpatchUiOverrides = parseSubpatchUiOverrides(value.subpatchUiOverrides, value.id);
  if (value.sample !== void 0 && !isSampleAsset(value.sample)) {
    throw new Error(`Node "${value.id}" sample must include a string name and url.`);
  }
  if (value.image !== void 0 && !isImageAsset(value.image)) {
    throw new Error(`Node "${value.id}" image must include a string name and url.`);
  }
  if (value.compactPorts !== void 0 && typeof value.compactPorts !== "boolean") {
    throw new Error(`Node "${value.id}" compactPorts must be a boolean.`);
  }
  if (value.enabled !== void 0 && typeof value.enabled !== "boolean") {
    throw new Error(`Node "${value.id}" enabled must be a boolean.`);
  }
  if (value.spreadNodeIds !== void 0 && (!Array.isArray(value.spreadNodeIds) || !value.spreadNodeIds.every((entry) => typeof entry === "string"))) {
    throw new Error(`Node "${value.id}" spreadNodeIds must be an array of strings.`);
  }
  if (value.scale !== void 0 && (typeof value.scale !== "number" || !Number.isFinite(value.scale) || value.scale <= 0)) {
    throw new Error(`Node "${value.id}" scale must be a positive finite number.`);
  }
  const position = value.position === void 0 ? void 0 : parsePosition(value.position, value.id);
  const scopeSize = value.scopeSize === void 0 ? void 0 : parseNodeDisplaySize(value.scopeSize, value.id, value.type);
  const parsedInputs = value.inputs === void 0 ? void 0 : parsePortDefinitions(value.inputs, `Node "${value.id}" inputs`);
  const outputs = value.outputs === void 0 ? void 0 : parsePortDefinitions(value.outputs, `Node "${value.id}" outputs`);
  const subpatch = value.subpatch === void 0 ? void 0 : parsePatchObject(value.subpatch, `Node "${value.id}" subpatch`);
  const expression = value.type === "Expression" ? value.expression ?? DEFAULT_EXPRESSION : value.expression;
  const inputs2 = value.type === "Expression" && expression !== void 0 ? parsedInputs ?? expressionInputDefinitions(expression) : normalizeLegacyInputDefinitions2(value.type, parsedInputs);
  const params = value.type === "Expression" && inputs2 ? syncParamsToInputs(value.params, inputs2) : normalizeLegacyNodeParams2(value.type, value.params);
  const customWave = value.type === "CustomWave" ? normalizeCustomWave(parseCustomWaveLike(value.customWave, value.id), params) : void 0;
  return {
    id: value.id,
    type: value.type,
    ...typeof value.customLabel === "string" && value.customLabel.trim() ? { customLabel: value.customLabel.trim() } : {},
    ...Array.isArray(value.sequencerRowLabels) ? { sequencerRowLabels: [...value.sequencerRowLabels] } : {},
    ...typeof value.sequencerRowLabelColumnWidth === "number" ? { sequencerRowLabelColumnWidth: value.sequencerRowLabelColumnWidth } : {},
    ...value.subpatchName ? { subpatchName: value.subpatchName } : {},
    ...value.subpatchCloneId ? { subpatchCloneId: value.subpatchCloneId } : {},
    ...subpatchUiOverrides ? { subpatchUiOverrides } : {},
    ...expression !== void 0 ? { expression } : {},
    ...isSampleAsset(value.sample) ? { sample: value.sample } : {},
    ...isImageAsset(value.image) ? { image: value.image } : {},
    ...customWave ? { customWave } : {},
    params,
    ...position ? { position } : {},
    ...typeof value.scale === "number" ? { scale: value.scale } : {},
    ...scopeSize ? { scopeSize } : {},
    ...inputs2 ? { inputs: inputs2 } : {},
    ...outputs ? { outputs } : {},
    ...subpatch ? { subpatch } : {},
    ...typeof value.compactPorts === "boolean" ? { compactPorts: value.compactPorts } : {},
    ...value.enabled === false ? { enabled: false } : {},
    ...Array.isArray(value.spreadNodeIds) ? { spreadNodeIds: value.spreadNodeIds } : {}
  };
}
function normalizeLegacyNodeParams2(type, params) {
  if (type !== "SamplePlayer" || params.originalFrequency !== void 0 || params.originalPitch === void 0) {
    return params;
  }
  const { originalPitch, ...nextParams } = params;
  return {
    ...nextParams,
    originalFrequency: midiNoteFrequency2(originalPitch)
  };
}
function normalizeLegacyInputDefinitions2(type, inputs2) {
  if (type === "Playhead") {
    if (!inputs2 || inputs2.some((input) => input.name === "length")) return inputs2;
    return [...inputs2, { name: "length", defaultValue: 1, min: 1e-3 }];
  }
  if (type !== "SamplePlayer") return inputs2;
  return inputs2?.map((input) => input.name === "originalPitch" ? { ...input, name: "originalFrequency", defaultValue: input.defaultValue === 60 ? 440 : input.defaultValue } : input);
}
function midiNoteFrequency2(note) {
  return 440 * 2 ** ((note - 69) / 12);
}
function parseCustomWaveLike(value, nodeId) {
  if (value === void 0) return void 0;
  if (!isRecord(value)) {
    throw new Error(`Node "${nodeId}" customWave must be an object.`);
  }
  if (value.points !== void 0 && !Array.isArray(value.points)) {
    throw new Error(`Node "${nodeId}" customWave.points must be an array.`);
  }
  return value;
}
function isSampleAsset(value) {
  return isRecord(value) && typeof value.name === "string" && typeof value.url === "string";
}
function isImageAsset(value) {
  return isRecord(value) && typeof value.name === "string" && typeof value.url === "string";
}
function parsePosition(value, nodeId) {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") {
    throw new Error(`Node "${nodeId}" position must have numeric x and y.`);
  }
  return { x: value.x, y: value.y };
}
function parseNodeDisplaySize(value, nodeId, type) {
  if (!isRecord(value) || typeof value.width !== "number" || typeof value.height !== "number") {
    throw new Error(`Node "${nodeId}" scopeSize must have numeric width and height.`);
  }
  const size = { width: value.width, height: value.height };
  if (type === "Image") return clampImageNodeSize(size, size.width / Math.max(1, size.height));
  if (type === "CustomWave" || type === "SamplePlayer" || type === "Buffer") return clampCustomWaveNodeSize(size);
  if (type === "Slider" || type === "Joystick" || type === "Button") return clampControlNodeSize(size);
  return clampScopeNodeSize(size);
}
function parsePortDefinitions(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.trim() === "") {
      throw new Error(`${label} entry ${index} needs a string name.`);
    }
    return {
      name: entry.name,
      ...typeof entry.parameterId === "string" && entry.parameterId.length ? { parameterId: entry.parameterId } : {},
      ...typeof entry.step === "number" ? { step: entry.step } : {},
      ...typeof entry.defaultValue === "number" ? { defaultValue: entry.defaultValue } : {},
      ...typeof entry.connectable === "boolean" ? { connectable: entry.connectable } : {},
      ...typeof entry.valueEditor === "boolean" ? { valueEditor: entry.valueEditor } : {},
      ...typeof entry.min === "number" ? { min: entry.min } : {},
      ...typeof entry.max === "number" ? { max: entry.max } : {},
      ...typeof entry.integer === "boolean" ? { integer: entry.integer } : {}
    };
  });
}
function parsePatchLink(value, index) {
  if (!isRecord(value)) {
    throw new Error(`Link ${index} must be an object.`);
  }
  return {
    from: parseEndpoint(value.from, `Link ${index} source`),
    to: parseEndpoint(value.to, `Link ${index} target`),
    ...typeof value.weight === "number" ? { weight: value.weight } : {},
    ...value.mode === "set" || value.mode === "add" || value.mode === "multiply" || value.mode === "bend" ? { mode: value.mode } : {},
    ...typeof value.enabled === "boolean" ? { enabled: value.enabled } : {},
    ...Array.isArray(value.weightModulations) ? {
      weightModulations: value.weightModulations.map((entry, modulationIndex) => parseLinkWeightModulation(entry, `Link ${index} strength modulation ${modulationIndex}`))
    } : {}
  };
}
function parseLinkWeightModulation(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return {
    from: parseEndpoint(value.from, `${label} source`),
    ...typeof value.weight === "number" ? { weight: value.weight } : {},
    ...value.mode === "set" || value.mode === "add" || value.mode === "multiply" || value.mode === "bend" ? { mode: value.mode } : {},
    ...typeof value.enabled === "boolean" ? { enabled: value.enabled } : {},
    ...Array.isArray(value.weightModulations) ? {
      weightModulations: value.weightModulations.map((entry, index) => parseLinkWeightModulation(entry, `${label}.${index}`))
    } : {}
  };
}
function parseEndpoint(value, label) {
  if (!isRecord(value) || typeof value.node !== "string" || typeof value.port !== "string") {
    throw new Error(`${label} must have string node and port.`);
  }
  return { node: value.node, port: value.port };
}
function isNodeType(value) {
  if (typeof value !== "string") return false;
  const definition = getDefinition(value);
  return definition?.type === value;
}
function isNumberRecord(value) {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) => typeof entry === "number" && Number.isFinite(entry));
}
function parseSubpatchUiOverrides(value, groupNodeId) {
  if (value === void 0) return void 0;
  if (!isRecord(value)) {
    throw new Error(`Node "${groupNodeId}" subpatchUiOverrides must be an object.`);
  }
  return Object.fromEntries(Object.entries(value).map(([innerNodeId, rawOverride]) => {
    if (!isRecord(rawOverride)) {
      throw new Error(`Node "${groupNodeId}" UI override for "${innerNodeId}" must be an object.`);
    }
    if (rawOverride.params !== void 0 && !isNumberRecord(rawOverride.params)) {
      throw new Error(`Node "${groupNodeId}" UI override params for "${innerNodeId}" must be numeric.`);
    }
    const params = rawOverride.params;
    const customWave = parseCustomWaveLike(rawOverride.customWave, `${groupNodeId}:${innerNodeId}`);
    return [innerNodeId, {
      ...params ? { params } : {},
      ...customWave ? { customWave: normalizeCustomWave(customWave, params) } : {}
    }];
  }));
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeSelectedMidiDeviceIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.length > 0))];
}
function expressionInputDefinitions(expression) {
  return extractExpressionInputs(expression).map((name) => ({
    name,
    defaultValue: 0
  }));
}
function syncParamsToInputs(params, inputs2) {
  return Object.fromEntries(inputs2.map((input) => [
    input.name,
    params[input.name] ?? input.defaultValue ?? 0
  ]));
}

// editor/src/hosted/document.ts
var DOCUMENT_VERSION = 1;
function readDocument(input) {
  let source = input;
  const diagnostics = [];
  let sourceVersion = 0;
  try {
    if (typeof input === "string") source = JSON.parse(input);
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Patch must be an object.");
    const version = source.schemaVersion;
    sourceVersion = version === void 0 ? 0 : Number(version);
    if (version !== void 0 && version !== DOCUMENT_VERSION) throw new Error(`Unsupported document schema version ${String(version)}.`);
    const patch = parsePatchObject(source, "Patch JSON");
    reportChanges(source, patch, "$", diagnostics);
    validateIds(patch, diagnostics);
    validateNumbers(patch, diagnostics, "$");
    return { source, patch, sourceVersion, diagnostics };
  } catch (error) {
    diagnostics.push({ severity: "error", code: "invalid-document", message: String(error instanceof Error ? error.message : error) });
    return { source, sourceVersion, diagnostics };
  }
}
function reportChanges(before, after, path, diagnostics) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (before && after && typeof before === "object" && typeof after === "object") {
    for (const [key, value] of Object.entries(before)) {
      const next = after[key];
      if (next === void 0) {
        const aliases = { originalPitch: "originalFrequency", recordHead: "record head", phaseReset: "trigger" };
        const canonical = key === "enabled" && value === true || path.endsWith(".params") && aliases[key] !== void 0 && aliases[key] in after || (key === "areas" || key === "buffers" || path.endsWith(".midiInput")) && (Array.isArray(value) && value.length === 0 || value === false || value && typeof value === "object" && Object.keys(value).length === 0) || key === "midiInput" && isEmptyMidiPreference(value) || key === "outputs" && before.type === "Reverb" || key === "customLabel" && typeof value === "string" && value.trim() === "";
        diagnostics.push({ severity: canonical ? "info" : "warning", code: canonical ? "migration" : "discarded-content", path: `${path}.${key}`, message: canonical ? `Compatibility import canonicalized ${path}.${key}.` : `Compatibility import discarded ${path}.${key}. Original input remains available in source.` });
      } else reportChanges(value, next, `${path}.${key}`, diagnostics);
    }
    for (const key of Object.keys(after)) {
      if (!(key in before)) diagnostics.push({ severity: "info", code: "migration", path: `${path}.${key}`, message: `Compatibility import supplied ${path}.${key}.` });
    }
  } else diagnostics.push({ severity: "info", code: "migration", path, message: `Compatibility import normalized ${path}.` });
}
function validateIds(patch, diagnostics) {
  const ids = /* @__PURE__ */ new Set();
  for (const node of patch.nodes) {
    if (ids.has(node.id)) diagnostics.push({ severity: "error", code: "duplicate-node", nodeId: node.id, message: `Duplicate node id ${node.id}.` });
    ids.add(node.id);
    for (const side of [node.inputs, node.outputs]) {
      const names = side?.map((port) => port.name) ?? [];
      if (new Set(names).size !== names.length) diagnostics.push({ severity: "error", code: "duplicate-port", nodeId: node.id, message: `Duplicate port name on ${node.id}.` });
    }
    if (node.subpatch) validateIds(node.subpatch, diagnostics);
  }
}
function withParameterIds(source, scope = []) {
  const patch = structuredClone(source);
  for (const node of patch.nodes) {
    if (node.type === "Params") for (const port of node.outputs ?? []) {
      port.parameterId ??= `teia:${JSON.stringify([...scope, node.id, port.name])}`;
    }
    if (node.subpatch) node.subpatch = withParameterIds(node.subpatch, [...scope, node.id]);
  }
  return patch;
}
function validateNumbers(value, diagnostics, path) {
  if (typeof value === "number" && !Number.isFinite(value)) diagnostics.push({ severity: "error", code: "invalid-number", path, message: `Non-finite number at ${path}.` });
  else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) validateNumbers(entry, diagnostics, `${path}.${key}`);
}
function bufferReferences(patch, prefix = "") {
  const references = {};
  for (const [nodeId, asset] of Object.entries(patch.buffers ?? {})) references[`${prefix}${nodeId}`] = { ...asset };
  for (const node of patch.nodes) if (node.type === "Group" && node.subpatch) Object.assign(references, bufferReferences(node.subpatch, `${prefix}${node.id}__`));
  return references;
}
function isEmptyMidiPreference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, entry]) => key === "sendClock" && entry === false || (key === "selectedDeviceIds" || key === "selectedOutputDeviceIds") && Array.isArray(entry) && entry.length === 0);
}
function cloneParameterIds(source, nextId) {
  const node = structuredClone(source);
  node.id = nextId;
  if (node.type === "Params") node.outputs = node.outputs?.map((port) => ({ ...port, parameterId: `teia:${JSON.stringify([nextId, port.name])}` }));
  if (node.subpatch) {
    const clear = (patch) => {
      for (const inner of patch.nodes) {
        if (inner.type === "Params") for (const port of inner.outputs ?? []) delete port.parameterId;
        if (inner.subpatch) clear(inner.subpatch);
      }
    };
    clear(node.subpatch);
    node.subpatch = withParameterIds(node.subpatch, [nextId]);
  }
  return node;
}
function retainNestedBufferReferences(source, authoritative) {
  const copy = structuredClone(source);
  for (const node of copy.nodes) if (node.subpatch) {
    const saved = authoritative.nodes.find((n) => n.id === node.id)?.subpatch;
    if (!saved) continue;
    node.subpatch = retainNestedBufferReferences(node.subpatch, saved);
    if (saved.buffers) node.subpatch.buffers = structuredClone(saved.buffers);
    else delete node.subpatch.buffers;
  }
  return copy;
}

// editor/src/hosted/engineCapabilities.json
var engineCapabilities_default = {
  apiVersion: 1,
  executionRevision: 4,
  validation: "shared Rust program validator",
  channels: 2,
  maxBlockFrames: 2048,
  maxEventsPerBlock: 256,
  sampleRate: {
    min: 8e3,
    max: 384e3
  },
  midiInputKinds: [
    "note on",
    "note off",
    "control change",
    "pitch bend"
  ],
  midiOutputKinds: [
    "note on",
    "note off",
    "control change"
  ],
  hostTimeline: true,
  maxMusicalBeat: 1e6,
  timelineContinuityTolerance: 1e-8,
  maxHeldNotes: 2048,
  maxMidiOutputEvents: 4096,
  media: true,
  nativeAnalysis: false,
  maxOperations: 4096,
  maxRegisters: 4096,
  maxValues: 2048,
  maxStates: 4096,
  maxRepeatCapacity: 1024,
  repeatPolicy: "explicit finite hierarchical pools required for native; WASM opts in with prepareDspRealtime; standalone legacy dynamic policy remains the default",
  feedbackKinds: [
    "peak",
    "tempo",
    "parameters",
    "repeat exhaustion",
    "meters",
    "signed meters",
    "scopes",
    "sample playheads",
    "buffer previews",
    "observation drops",
    "queued notes"
  ],
  maxRepeatDepth: 4,
  maxTotalRepeatItems: 1024,
  repeatBudgetScope: "all preallocated items across all nested parent contexts, including inactive capacity; heap payload capacities counted, allocator overhead excluded",
  midiPulsePolicy: "ordered bounded FIFO, one note event every two samples including mono state; intervening blank samples; no simultaneous scalar pulse fidelity",
  maxQueuedNoteEvents: 4096,
  maxQueuedNoteLatencyFrames: 8191,
  midiInputOverflow: "native rejects incoming block atomically; standalone queue rejects newest and increments dspMidiInputOverflows",
  observation: {
    maxRequests: 128,
    maxScopes: 32,
    maxScopePoints: 1024,
    scopeSeconds: {
      min: 0.01,
      max: 30
    },
    maxPlayheadsPerRequest: 128,
    bufferPreview: "point samples, not full-bin extrema",
    generationAndLayout: true
  },
  bufferTransfer: {
    maxChunkSamples: 1024,
    maxSamples: 96e4,
    capture: "freeze writes only; exclusive render-owner chunk copies; explicit finish/cancel; reset and replacement invalidate",
    repeated: "concrete template/item path, maximum depth 4; active items only; tokens follow storage while indices move"
  }
};

// editor/src/audio/dspOpcodes.ts
var DSP_OP = {
  Value: 0,
  Add: 1,
  Mul: 2,
  Osc: 3,
  Filter: 4,
  Output: 5,
  Abs: 6,
  Map: 7,
  FeedbackRead: 8,
  FeedbackWrite: 9,
  Select: 10,
  Input: 11,
  Delay: 12,
  Chorus: 13,
  Reverb: 14,
  Fold: 15,
  Sub: 16,
  Div: 17,
  Neg: 18,
  Envelope: 19,
  Follower: 20,
  HardClip: 21,
  SoftClip: 22,
  Distortion: 23,
  Sample: 24,
  SampleParam: 25,
  Function: 26,
  MidiNote: 27,
  MidiCc: 28,
  Accumulator: 29,
  Button: 30,
  Slew: 31,
  Tempo: 32,
  Playhead: 33,
  Buffer: 34,
  Sequencer: 35,
  Image: 36,
  Time: 37,
  Compress: 38,
  Limiter: 39,
  Quantise: 40,
  BlockLatch: 41,
  SpreadBegin: 42,
  SpreadIndex: 43,
  SpreadCollect: 44,
  SpreadEnd: 45,
  SpawnBegin: 46,
  SpawnEnd: 47,
  EndTrigger: 48,
  Random: 49,
  SpawnInstanceGate: 50,
  DcBlock: 51,
  RollNoteEvent: 52,
  MidiNoteSend: 53,
  MidiCcSend: 54,
  Bend: 55
};

// editor/src/audio/dspEdit.ts
function dspProgramStructureKey(program) {
  return JSON.stringify({
    version: program.version,
    engineApiVersion: program.engineApiVersion ?? 1,
    ops: program.ops,
    valueBindings: program.valueBindings,
    midiControlBindings: program.midiControlBindings,
    tempoBindings: program.tempoBindings,
    stateBindings: program.stateBindings,
    registerCount: program.registerCount,
    stateCount: program.stateCount,
    feedbackLinkIds: program.feedbackLinkIds,
    monitorIds: program.monitorIds,
    sampleBindings: program.sampleBindings,
    imageBindings: program.imageBindings,
    fftBindings: program.fftBindings,
    // Point coordinates have a dedicated in-place worklet update path. Mode
    // and sustain changes still rebuild because they alter oscillator setup.
    customWaveBindings: program.customWaveBindings.map((binding) => ({
      nodeId: binding.nodeId,
      mode: binding.customWave.mode,
      sustainStart: binding.customWave.sustainStart,
      sustainEnd: binding.customWave.sustainEnd
    })),
    sequencerBindings: program.sequencerBindings.map((binding) => binding.nodeId),
    repeatBindings: program.repeatBindings,
    maxVoices: program.maxVoices,
    usesMidiNote: program.usesMidiNote,
    usesMidiClock: program.usesMidiClock,
    errors: program.errors
  });
}
function dspCustomWavePointsKey(program) {
  return JSON.stringify(program.customWaveBindings.map((binding) => ({
    nodeId: binding.nodeId,
    points: binding.customWave.points
  })));
}
function dspSequencerConfigKey(program) {
  return JSON.stringify(program.sequencerBindings);
}
function requiredEngineApi(program) {
  return program.ops.some((op) => op.opcode === DSP_OP.Input && (op.b === 0 || op.b === 1)) ? 2 : 1;
}

// editor/src/graph/subpatch.ts
var GROUP_DEFAULT_NODE_PREFIX = "__group_default";
var GROUP_INPUT_PASS_NODE_PREFIX = "__group_input_pass";
var GROUP_OUTPUT_PASS_NODE_PREFIX = "__group_output_pass";
function expandGroups(patch) {
  const expanded = expandGroupNodes(patch, "");
  return {
    nodes: expanded.nodes,
    links: dedupePatchLinks(expanded.links)
  };
}
function expandGroupNodes(patch, prefix) {
  const nodes = [];
  const links = [];
  for (const node of patch.nodes) {
    if (node.type !== "Group" || !node.subpatch) {
      nodes.push(prefixNode(node, prefix));
      continue;
    }
    const groupPatch = expandGroupNodes(
      applySubpatchUiOverrides(node.subpatch, node.subpatchUiOverrides),
      `${prefix}${node.id}__`
    );
    const insNodes = groupPatch.nodes.filter((candidate) => candidate.type === "Ins");
    const outsNodes = groupPatch.nodes.filter((candidate) => candidate.type === "Outs");
    const boundaryNodeIds = new Set([...insNodes, ...outsNodes].map((candidate) => candidate.id));
    const inputLinks = patch.links.filter((link) => link.to.node === node.id);
    const outputLinks = patch.links.filter((link) => link.from.node === node.id);
    const innerLinksByInput = groupBy(groupPatch.links, (link) => link.from.node, boundaryNodeIds, insNodes);
    const innerLinksByOutput = groupBy(groupPatch.links, (link) => link.to.node, boundaryNodeIds, outsNodes);
    const prefixedGroupId = `${prefix}${node.id}`;
    nodes.push(...groupPatch.nodes.filter((candidate) => !boundaryNodeIds.has(candidate.id)).map((candidate) => inheritGroupRuntime(node, node.enabled === false ? { ...candidate, enabled: false } : candidate)));
    nodes.push(...defaultNodesForUnconnectedGroupInputs(node, prefixedGroupId, inputLinks, innerLinksByInput, insNodes).map((candidate) => inheritGroupRuntime(node, candidate)));
    nodes.push(...passNodesForGroupBoundary(node, prefixedGroupId, innerLinksByInput, insNodes, "input").map((candidate) => inheritGroupRuntime(node, candidate)));
    nodes.push(...passNodesForGroupBoundary(node, prefixedGroupId, innerLinksByOutput, outsNodes, "output").map((candidate) => inheritGroupRuntime(node, candidate)));
    links.push(...groupPatch.links.filter((link) => !boundaryNodeIds.has(link.from.node) && !boundaryNodeIds.has(link.to.node)));
    for (const [port, innerLinks] of innerLinksByInput) {
      const externalLinks = inputLinks.filter((link) => link.to.port === port);
      if (externalLinks.length === 0) {
        const defaultNodeId = defaultNodeIdForGroupInput(prefixedGroupId, port);
        links.push({
          from: { node: defaultNodeId, port: "signal" },
          to: { node: passNodeIdForGroupBoundary(prefixedGroupId, port, "input"), port: "signal" },
          weight: 1,
          mode: "set"
        });
        links.push(...innerLinks.map((innerLink) => ({
          from: { node: passNodeIdForGroupBoundary(prefixedGroupId, port, "input"), port: "signal" },
          to: innerLink.to,
          weight: innerLink.weight,
          mode: innerLink.mode,
          enabled: innerLink.enabled,
          weightModulations: innerLink.weightModulations
        })));
        continue;
      }
      for (const externalLink of externalLinks) {
        links.push({
          from: prefixEndpoint(externalLink.from, prefix),
          to: { node: passNodeIdForGroupBoundary(prefixedGroupId, port, "input"), port: "signal" },
          weight: externalLink.weight,
          mode: externalLink.mode,
          enabled: externalLink.enabled,
          weightModulations: prefixWeightModulations(externalLink, prefix)
        });
      }
      links.push(...innerLinks.map((innerLink) => ({
        from: { node: passNodeIdForGroupBoundary(prefixedGroupId, port, "input"), port: "signal" },
        to: innerLink.to,
        weight: innerLink.weight,
        mode: innerLink.mode,
        enabled: innerLink.enabled,
        weightModulations: innerLink.weightModulations
      })));
    }
    for (const [port, innerLinks] of innerLinksByOutput) {
      const externalLinks = outputLinks.filter((link) => link.from.port === port);
      for (const innerLink of innerLinks) {
        links.push({
          from: innerLink.from,
          to: { node: passNodeIdForGroupBoundary(prefixedGroupId, port, "output"), port: "signal" },
          weight: innerLink.weight,
          mode: innerLink.mode,
          enabled: innerLink.enabled,
          weightModulations: innerLink.weightModulations
        });
      }
      for (const externalLink of externalLinks) {
        links.push({
          from: { node: passNodeIdForGroupBoundary(prefixedGroupId, port, "output"), port: "signal" },
          to: prefixEndpoint(externalLink.to, prefix),
          weight: externalLink.weight,
          mode: externalLink.mode,
          enabled: externalLink.enabled,
          weightModulations: prefixWeightModulations(externalLink, prefix)
        });
      }
    }
  }
  for (const link of patch.links) {
    const source = patch.nodes.find((node) => node.id === link.from.node);
    const target = patch.nodes.find((node) => node.id === link.to.node);
    if (source?.type === "Group" || target?.type === "Group") continue;
    links.push({
      from: prefixEndpoint(link.from, prefix),
      to: prefixEndpoint(link.to, prefix),
      weight: link.weight,
      mode: link.mode,
      enabled: link.enabled,
      weightModulations: prefixWeightModulations(link, prefix)
    });
  }
  return { nodes, links };
}
function inheritGroupRuntime(group, descendant) {
  if (!group.runtimeSpread) return descendant;
  return {
    ...descendant,
    runtimeSpread: {
      ...group.runtimeSpread,
      originalNodeId: descendant.id
    }
  };
}
function passNodesForGroupBoundary(groupNode, prefixedGroupId, innerLinksByPort, boundaryNodes, side) {
  return [...innerLinksByPort.keys()].map((port) => ({
    id: passNodeIdForGroupBoundary(prefixedGroupId, port, side),
    type: "Pass",
    params: {
      signal: side === "input" ? groupNode.params[port] ?? boundaryPortDefaultValue(boundaryNodes, port) : boundaryPortDefaultValue(boundaryNodes, port)
    },
    position: groupNode.position,
    ...groupNode.enabled === false ? { enabled: false } : {}
  }));
}
function boundaryPortDefaultValue(boundaryNodes, port) {
  for (const node of boundaryNodes) {
    const definition = [...node.inputs ?? [], ...node.outputs ?? []].find((candidate) => candidate.name === port);
    if (definition) return node.params[port] ?? definition.defaultValue ?? 0;
  }
  return 0;
}
function defaultNodesForUnconnectedGroupInputs(groupNode, prefixedGroupId, inputLinks, innerLinksByInput, insNodes) {
  const defaultValueByPort = /* @__PURE__ */ new Map();
  for (const node of insNodes) {
    for (const port of node.outputs ?? []) {
      defaultValueByPort.set(port.name, node.params[port.name] ?? port.defaultValue ?? 0);
    }
  }
  return [...innerLinksByInput].filter(([port]) => !inputLinks.some((link) => link.to.port === port)).map(([port]) => ({
    id: defaultNodeIdForGroupInput(prefixedGroupId, port),
    type: "Constant",
    params: { value: groupNode.params[port] ?? defaultValueByPort.get(port) ?? 0 },
    position: groupNode.position,
    ...groupNode.enabled === false ? { enabled: false } : {}
  }));
}
function groupBy(links, boundarySelector, boundaryNodeIds, boundaryNodes) {
  const boundaryPorts = /* @__PURE__ */ new Map();
  for (const node of boundaryNodes) {
    const ports = new Set([...node.inputs ?? [], ...node.outputs ?? []].map((port) => port.name));
    boundaryPorts.set(node.id, ports);
  }
  const grouped = /* @__PURE__ */ new Map();
  for (const link of links) {
    const boundaryNode = boundarySelector(link);
    if (!boundaryNodeIds.has(boundaryNode)) continue;
    const port = link.from.node === boundaryNode ? link.from.port : link.to.port;
    if (!boundaryPorts.get(boundaryNode)?.has(port)) continue;
    grouped.set(port, [...grouped.get(port) ?? [], link]);
  }
  return grouped;
}
function prefixNode(node, prefix) {
  const cloned = cloneNode(node);
  if (node.type === "Send" || node.type === "Receive") {
    cloned.routingScope = prefix;
  }
  if (!prefix) return cloned;
  return {
    ...cloned,
    id: `${prefix}${node.id}`
  };
}
function cloneNode(node) {
  return {
    id: node.id,
    type: node.type,
    ...node.customLabel ? { customLabel: node.customLabel } : {},
    ...node.sequencerRowLabels ? { sequencerRowLabels: [...node.sequencerRowLabels] } : {},
    ...node.sequencerRowLabelColumnWidth !== void 0 ? { sequencerRowLabelColumnWidth: node.sequencerRowLabelColumnWidth } : {},
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
    ...node.enabled === false ? { enabled: false } : {},
    ...node.spreadNodeIds ? { spreadNodeIds: [...node.spreadNodeIds] } : {},
    ...node.runtimeSpread ? { runtimeSpread: { ...node.runtimeSpread } } : {}
  };
}
function applySubpatchUiOverrides(patch, overrides) {
  if (!overrides) return patch;
  return {
    ...patch,
    nodes: patch.nodes.map((node) => {
      const override = overrides[node.id];
      if (!override) return node;
      const params = { ...node.params, ...override.params };
      return {
        ...node,
        params,
        ...override.customWave ? { customWave: normalizeCustomWave(override.customWave, params) } : {}
      };
    })
  };
}
function clonePatch(patch) {
  return {
    ...patch.areas ? { areas: structuredClone(patch.areas) } : {},
    nodes: patch.nodes.map(cloneNode),
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
function prefixEndpoint(endpoint, prefix) {
  return {
    node: `${prefix}${endpoint.node}`,
    port: endpoint.port
  };
}
function prefixWeightModulations(link, prefix) {
  const prefixModulation = (modulation) => ({
    ...modulation,
    from: prefixEndpoint(modulation.from, prefix),
    weightModulations: modulation.weightModulations?.map(prefixModulation)
  });
  return link.weightModulations?.map(prefixModulation);
}
function defaultNodeIdForGroupInput(groupId, port) {
  return `${GROUP_DEFAULT_NODE_PREFIX}_${groupId}_${port}`.replace(/[^A-Za-z0-9_-]/g, "_");
}
function passNodeIdForGroupBoundary(groupId, port, side) {
  const prefix = side === "input" ? GROUP_INPUT_PASS_NODE_PREFIX : GROUP_OUTPUT_PASS_NODE_PREFIX;
  return `${prefix}_${groupId}_${port}`.replace(/[^A-Za-z0-9_-]/g, "_");
}
function dedupePatchLinks(links) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const link of links) {
    const key = `${link.from.node}:${link.from.port}->${link.to.node}:${link.to.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
  }
  return deduped;
}

// editor/src/graph/spread.ts
var DEFAULT_SPREAD_SIZE = { width: 320, height: 220 };
var DEFAULT_SPAWN_SIZE = { width: 480, height: 220 };
var MIN_RUNTIME_CONTAINER_WIDTH = 240;
var MIN_SPAWN_WIDTH = 480;
var SPREAD_HEADER_HEIGHT = 32;
var SPREAD_PORTS_HEIGHT = 44;
var SPAWN_PORTS_HEIGHT = 72;
function expandSpreads(patch) {
  let expanded = patch;
  const errors = [];
  const spreads = patch.nodes.filter(isRuntimeContainer);
  const memberships = /* @__PURE__ */ new Map();
  for (const spread of spreads) {
    for (const node of patch.nodes) {
      if (!nodeIsInsideSpread(spread, node)) continue;
      memberships.set(node.id, [...memberships.get(node.id) ?? [], spread.id]);
    }
  }
  for (const [nodeId, spreadIds] of memberships) {
    if (spreadIds.length > 1) {
      errors.push(`Node "${nodeId}" is inside multiple Spread/Spawn containers (${spreadIds.join(", ")}). Move it into exactly one container.`);
    }
  }
  if (errors.length > 0) return { patch, errors };
  for (const spread of spreads) {
    const result = expandOneSpread(expanded, spread.id);
    expanded = result.patch;
    errors.push(...result.errors);
  }
  return { patch: expanded, errors };
}
function nodeIsInsideSpread(spread, node) {
  if (!isRuntimeContainer(spread) || node.id === spread.id) return false;
  if (spread.spreadNodeIds) return spread.spreadNodeIds.includes(node.id);
  if (!spread.position || !node.position) return false;
  const size = runtimeContainerSize(spread);
  const portsHeight = runtimeContainerPortsHeight(spread);
  return node.position.x >= spread.position.x && node.position.x < spread.position.x + size.width && node.position.y >= spread.position.y + SPREAD_HEADER_HEIGHT + portsHeight && node.position.y < spread.position.y + SPREAD_HEADER_HEIGHT + size.height;
}
function runtimeContainerSize(node) {
  const fallback = node.type === "Spawn" ? DEFAULT_SPAWN_SIZE : DEFAULT_SPREAD_SIZE;
  const size = node.scopeSize ?? fallback;
  return {
    width: Math.max(node.type === "Spawn" ? MIN_SPAWN_WIDTH : MIN_RUNTIME_CONTAINER_WIDTH, size.width),
    height: Math.max(140, size.height)
  };
}
function runtimeContainerPortsHeight(node) {
  return node.type === "Spawn" ? SPAWN_PORTS_HEIGHT : SPREAD_PORTS_HEIGHT;
}
function expandOneSpread(patch, spreadId) {
  const spread = patch.nodes.find((node) => node.id === spreadId && isRuntimeContainer(node));
  if (!spread) return { patch, errors: [] };
  const internalNodes = patch.nodes.filter((node) => nodeIsInsideSpread(spread, node));
  const internalIds = new Set(internalNodes.map((node) => node.id));
  const errors = [];
  for (const node of internalNodes) {
    if (isRuntimeContainer(node)) {
      errors.push(`${spread.type} "${spread.id}" cannot contain ${node.type} "${node.id}".`);
    } else if (node.type === "Group" && node.subpatch) {
      const unsupported = nestedRuntimeContainer(node.subpatch);
      if (unsupported) {
        errors.push(`${spread.type} "${spread.id}" cannot contain Group "${node.id}" with ${unsupported} inside it.`);
      }
    }
  }
  const clonedNodes = [];
  for (const node of internalNodes) {
    if (isRuntimeContainer(node)) continue;
    clonedNodes.push(cloneSpreadNode(node, spread.id, 0));
  }
  if (spread.type === "Spread") {
    clonedNodes.push({
      id: spreadIndexNodeId(spread.id, 0),
      type: "Constant",
      params: { value: 1 },
      runtimeSpread: { spreadId: spread.id, itemIndex: 0, originalNodeId: "__item_index__" }
    });
  } else {
    clonedNodes.push({
      id: spawnInstanceGateNodeId(spread.id, 0),
      type: "Constant",
      params: { value: 1 },
      runtimeSpread: { spreadId: spread.id, itemIndex: 0, originalNodeId: "__instance_gate__" }
    });
  }
  const links = [];
  for (const link of patch.links) {
    const sourceInternal = internalIds.has(link.from.node);
    const targetInternal = internalIds.has(link.to.node);
    const isIndexLink = spread.type === "Spread" && link.from.node === spread.id && link.from.port === "item index";
    const isInstanceGateLink = spread.type === "Spawn" && link.from.node === spread.id && link.from.port === "instance gate";
    const isInternalControlLink = sourceInternal && link.to.node === spread.id && (link.to.port === (spread.type === "Spread" ? "count" : "trigger") || spread.type === "Spawn" && link.to.port === "release trigger");
    const isKillLink = spread.type === "Spawn" && link.to.node === spread.id && link.to.port === "kill trigger";
    if (isIndexLink && !targetInternal) {
      errors.push(`Spread "${spread.id}" item index can only link to nodes inside that Spread.`);
      continue;
    }
    if (isInstanceGateLink && !targetInternal) {
      errors.push(`Spawn "${spread.id}" instance gate can only link to nodes inside that Spawn.`);
      continue;
    }
    if (isInternalControlLink) {
      errors.push(`${spread.type} "${spread.id}" ${link.to.port} cannot be driven by a node inside the same ${spread.type}.`);
      continue;
    }
    if (isKillLink && !sourceInternal) {
      errors.push(`Spawn "${spread.id}" kill trigger can only be driven by a node inside that Spawn.`);
      continue;
    }
    if (isIndexLink) {
      links.push({
        ...cloneLink(link, spread.id, internalIds),
        from: { node: spreadIndexNodeId(spread.id, 0), port: "signal" },
        to: { ...link.to, node: spreadCloneNodeId(spread.id, 0, link.to.node) }
      });
      continue;
    }
    if (isInstanceGateLink) {
      links.push({
        ...cloneLink(link, spread.id, internalIds),
        from: { node: spawnInstanceGateNodeId(spread.id, 0), port: "signal" },
        to: { ...link.to, node: spreadCloneNodeId(spread.id, 0, link.to.node) }
      });
      continue;
    }
    if (!sourceInternal && !targetInternal) {
      links.push(cloneLink(link, spread.id, internalIds));
      continue;
    }
    links.push({
      ...cloneLink(link, spread.id, internalIds),
      from: sourceInternal ? { ...link.from, node: spreadCloneNodeId(spread.id, 0, link.from.node) } : { ...link.from },
      to: targetInternal ? { ...link.to, node: spreadCloneNodeId(spread.id, 0, link.to.node) } : { ...link.to }
    });
  }
  return {
    patch: {
      ...patch,
      nodes: [
        ...patch.nodes.filter((node) => !internalIds.has(node.id)),
        ...clonedNodes
      ],
      links
    },
    errors
  };
}
function nestedRuntimeContainer(patch) {
  for (const node of patch.nodes) {
    if (isRuntimeContainer(node)) return node.type;
    if (node.type === "Group" && node.subpatch) {
      const nested = nestedRuntimeContainer(node.subpatch);
      if (nested) return nested;
    }
  }
  return null;
}
function isRuntimeContainer(node) {
  return node.type === "Spread" || node.type === "Spawn";
}
function cloneSpreadNode(node, spreadId, itemIndex) {
  return {
    ...node,
    id: spreadCloneNodeId(spreadId, itemIndex, node.id),
    params: { ...node.params },
    ...node.inputs ? { inputs: node.inputs.map((port) => ({ ...port })) } : {},
    ...node.outputs ? { outputs: node.outputs.map((port) => ({ ...port })) } : {},
    ...node.subpatchUiOverrides ? { subpatchUiOverrides: structuredClone(node.subpatchUiOverrides) } : {},
    ...node.subpatch ? { subpatch: structuredClone(node.subpatch) } : {},
    runtimeSpread: { spreadId, itemIndex, originalNodeId: node.id }
  };
}
function cloneLink(link, spreadId, internalIds) {
  const cloneModulation = (modulation) => ({
    ...modulation,
    from: {
      ...modulation.from,
      port: modulation.from.node === spreadId && ["item index", "instance gate"].includes(modulation.from.port) ? "signal" : modulation.from.port,
      node: modulation.from.node === spreadId && modulation.from.port === "item index" ? spreadIndexNodeId(spreadId, 0) : modulation.from.node === spreadId && modulation.from.port === "instance gate" ? spawnInstanceGateNodeId(spreadId, 0) : internalIds.has(modulation.from.node) ? spreadCloneNodeId(spreadId, 0, modulation.from.node) : modulation.from.node
    },
    weightModulations: modulation.weightModulations?.map(cloneModulation)
  });
  return {
    from: { ...link.from },
    to: { ...link.to },
    ...link.weight !== void 0 ? { weight: link.weight } : {},
    ...link.mode !== void 0 ? { mode: link.mode } : {},
    ...link.enabled === false ? { enabled: false } : {},
    ...link.weightModulations?.length ? { weightModulations: link.weightModulations.map(cloneModulation) } : {}
  };
}
function spreadCloneNodeId(spreadId, itemIndex, nodeId) {
  return `${spreadId}__item_${itemIndex}__${nodeId}`;
}
function spreadIndexNodeId(spreadId, itemIndex) {
  return `${spreadId}__item_${itemIndex}__index`;
}
function spawnInstanceGateNodeId(spreadId, itemIndex) {
  return `${spreadId}__item_${itemIndex}__instance_gate`;
}

// editor/src/audio/dspOptimizer.ts
var OPCODE_NAMES = new Map(Object.entries(DSP_OP).map(([name, code]) => [code, name]));
var PURE = /* @__PURE__ */ new Set([
  DSP_OP.Value,
  DSP_OP.Add,
  DSP_OP.Mul,
  DSP_OP.Sub,
  DSP_OP.Div,
  DSP_OP.Neg,
  DSP_OP.Abs,
  DSP_OP.Bend,
  DSP_OP.Function,
  DSP_OP.Map,
  DSP_OP.Fold,
  DSP_OP.HardClip,
  DSP_OP.SoftClip,
  DSP_OP.Quantise
]);
var EVENT = /* @__PURE__ */ new Set([DSP_OP.MidiNoteSend, DSP_OP.MidiCcSend, DSP_OP.RollNoteEvent]);
var RESOURCE = /* @__PURE__ */ new Set([DSP_OP.Input, DSP_OP.Sample, DSP_OP.SampleParam, DSP_OP.Buffer, DSP_OP.Image]);
var STATEFUL = /* @__PURE__ */ new Set([
  DSP_OP.Osc,
  DSP_OP.Filter,
  DSP_OP.FeedbackRead,
  DSP_OP.FeedbackWrite,
  DSP_OP.Select,
  DSP_OP.Delay,
  DSP_OP.Chorus,
  DSP_OP.Reverb,
  DSP_OP.Envelope,
  DSP_OP.Follower,
  DSP_OP.Distortion,
  DSP_OP.Accumulator,
  DSP_OP.Button,
  DSP_OP.Slew,
  DSP_OP.Tempo,
  DSP_OP.Playhead,
  DSP_OP.Sequencer,
  DSP_OP.Time,
  DSP_OP.Compress,
  DSP_OP.Limiter,
  DSP_OP.BlockLatch,
  DSP_OP.Random,
  DSP_OP.DcBlock,
  DSP_OP.EndTrigger
]);
var BINARY = /* @__PURE__ */ new Set([DSP_OP.Add, DSP_OP.Mul, DSP_OP.Sub, DSP_OP.Div, DSP_OP.Fold, DSP_OP.HardClip, DSP_OP.SoftClip]);
var UNARY = /* @__PURE__ */ new Set([DSP_OP.Neg, DSP_OP.Abs, DSP_OP.Bend]);
var DSP_REGISTER_COUNT = 4096;
function operationTrait(opcode) {
  if (PURE.has(opcode)) return "pure";
  if (EVENT.has(opcode)) return "event";
  if (RESOURCE.has(opcode)) return "resource";
  if (STATEFUL.has(opcode)) return "stateful";
  return "ordering barrier";
}
function snapshot(program) {
  const byOpcode = {};
  const byTrait = {
    pure: 0,
    stateful: 0,
    event: 0,
    resource: 0,
    "ordering barrier": 0
  };
  for (const op of program.ops) {
    const name = OPCODE_NAMES.get(op.opcode) ?? `unknown ${op.opcode}`;
    byOpcode[name] = (byOpcode[name] ?? 0) + 1;
    byTrait[operationTrait(op.opcode)] += 1;
  }
  return {
    operations: program.ops.length,
    registers: program.registerCount,
    values: program.values.length,
    states: program.stateCount,
    byOpcode,
    byTrait
  };
}
function inputs(op) {
  if (op.opcode === DSP_OP.Reverb) {
    return [op.a ?? -1, op.b ?? -1, op.c ?? -1, op.d ?? -1, (op.value2 ?? 0) - 1];
  }
  if (op.opcode === DSP_OP.Value) return [];
  if (BINARY.has(op.opcode)) return [op.a ?? -1, op.b ?? -1];
  if (UNARY.has(op.opcode)) return [op.a ?? -1];
  if (op.opcode === DSP_OP.Function) return [op.b ?? -1, op.c ?? -1, op.d ?? -1];
  if (op.opcode === DSP_OP.Map) return [op.a ?? -1, op.b ?? -1, op.c ?? -1, op.d ?? -1, op.e ?? -1];
  if (op.opcode === DSP_OP.Quantise) return [op.a ?? -1, op.b ?? -1, op.c ?? -1];
  if (op.opcode === DSP_OP.Envelope) {
    const packed = Math.round(op.value ?? 0);
    return [
      op.a ?? -1,
      op.b ?? -1,
      op.c ?? -1,
      op.d ?? -1,
      op.e ?? -1,
      packed % DSP_REGISTER_COUNT,
      Math.floor(packed / DSP_REGISTER_COUNT),
      Math.round(op.value2 ?? 0) - 1
    ];
  }
  return [op.a, op.b, op.c, op.d, op.e, op.out, op.value, op.value2, op.value3, op.value4].filter((field) => typeof field === "number" && Number.isInteger(field));
}
function sanitizeRegister(value) {
  return Number.isFinite(value) ? Math.min(12e3, Math.max(-12e3, value)) : 0;
}
function simplifyDspOperations(program, options = {}) {
  const emitted = snapshot(program);
  const beforeLoadDedup = {
    ...emitted,
    operations: emitted.operations + program.deduplicatedLoads,
    registers: emitted.registers + program.deduplicatedLoads,
    byOpcode: { ...emitted.byOpcode, Value: (emitted.byOpcode.Value ?? 0) + program.deduplicatedLoads },
    byTrait: { ...emitted.byTrait, pure: emitted.byTrait.pure + program.deduplicatedLoads }
  };
  let constantArithmetic = 0;
  let unusedPure = 0;
  if (options.foldConstants !== false) {
    const constants = /* @__PURE__ */ new Map();
    const indexByValue = /* @__PURE__ */ new Map();
    program.valueBindings.forEach((binding) => {
      if (binding.kind === "constant") indexByValue.set(program.values[binding.valueIndex], binding.valueIndex);
    });
    let repeatDepth = 0;
    for (const op of program.ops) {
      if (op.opcode === DSP_OP.SpreadBegin || op.opcode === DSP_OP.SpawnBegin) {
        repeatDepth += 1;
        constants.clear();
      }
      if (repeatDepth === 0 && op.opcode === DSP_OP.Value && op.out !== void 0 && op.a !== void 0 && program.valueBindings[op.a]?.kind === "constant") {
        constants.set(op.out, sanitizeRegister(program.values[op.a]));
      } else if (repeatDepth === 0 && op.out !== void 0 && op.a !== void 0 && op.b !== void 0 && (op.opcode === DSP_OP.Add || op.opcode === DSP_OP.Mul || op.opcode === DSP_OP.Sub || op.opcode === DSP_OP.Div) && constants.has(op.a) && constants.has(op.b)) {
        const left = constants.get(op.a);
        const right = constants.get(op.b);
        const result = sanitizeRegister(op.opcode === DSP_OP.Add ? left + right : op.opcode === DSP_OP.Mul ? left * right : op.opcode === DSP_OP.Sub ? left - right : Math.abs(right) <= 1e-6 ? 0 : left / right);
        if (!Object.is(result, -0)) {
          let index = indexByValue.get(result);
          if (index === void 0 && program.values.length < 2048) {
            index = program.values.length;
            program.values.push(result);
            program.valueBindings.push({ id: `constant.${result}`, valueIndex: index, kind: "constant" });
            indexByValue.set(result, index);
          }
          if (index !== void 0) {
            op.opcode = DSP_OP.Value;
            op.a = index;
            delete op.b;
            constants.set(op.out, result);
            constantArithmetic += 1;
          }
        }
      }
      if (op.opcode === DSP_OP.SpreadEnd || op.opcode === DSP_OP.SpawnEnd) {
        repeatDepth -= 1;
        constants.clear();
      }
    }
  }
  const afterConstantFolding = snapshot(program);
  if (options.eliminateDeadPureOps !== false) {
    const live = /* @__PURE__ */ new Set([
      ...Object.values(program.monitorIds),
      ...program.fftBindings.map((binding) => binding.inputRegister)
    ]);
    const keep = new Array(program.ops.length).fill(true);
    let repeatDepth = 0;
    for (let index = program.ops.length - 1; index >= 0; index -= 1) {
      const op = program.ops[index];
      if (op.opcode === DSP_OP.SpreadEnd || op.opcode === DSP_OP.SpawnEnd) repeatDepth += 1;
      const pure = operationTrait(op.opcode) === "pure" && repeatDepth === 0;
      if (pure && op.out !== void 0 && !live.has(op.out)) {
        keep[index] = false;
        unusedPure += 1;
      } else {
        if (pure && op.out !== void 0) live.delete(op.out);
        for (const input of inputs(op)) if (input >= 0 && input < program.registerCount) live.add(input);
      }
      if (op.opcode === DSP_OP.SpreadBegin || op.opcode === DSP_OP.SpawnBegin) repeatDepth -= 1;
    }
    program.ops = program.ops.filter((_, index) => keep[index]);
  }
  return {
    beforeLoadDedup,
    emitted,
    afterConstantFolding,
    final: snapshot(program),
    reasons: { deduplicatedLoads: program.deduplicatedLoads, constantArithmetic, unusedPure }
  };
}

// editor/src/audio/dspSchedule.ts
var OPCODE_NAMES2 = new Map(Object.entries(DSP_OP).map(([name, code]) => [code, name]));
var CANDIDATE_NODES = /* @__PURE__ */ new Set([
  "Constant",
  "Params",
  "Pass",
  "Multiply",
  "Abs",
  "Map",
  "Clamp",
  "Pan",
  "SineOsc",
  "TriangleOsc",
  "SawOsc",
  "RampOsc",
  "SquareOsc",
  "LowpassFilter",
  "HighpassFilter",
  "BandpassFilter",
  "AllpassFilter",
  "AudioOut"
]);
var CANDIDATE_OPS = /* @__PURE__ */ new Set([
  DSP_OP.Value,
  DSP_OP.Add,
  DSP_OP.Mul,
  DSP_OP.Sub,
  DSP_OP.Div,
  DSP_OP.Neg,
  DSP_OP.Abs,
  DSP_OP.Map,
  DSP_OP.Osc,
  DSP_OP.Filter,
  DSP_OP.Output
]);
var EVENT_NODES = /* @__PURE__ */ new Set(["MidiNoteOnSend", "MidiNoteOffSend", "MidiCcSend", "Roll", "Sequencer"]);
var RESOURCE_NODES = /* @__PURE__ */ new Set(["Buffer", "SamplePlayer", "Image"]);
function sharesRuntime(receive, send) {
  if ((receive.routingScope ?? "") !== (send.routingScope ?? "")) return false;
  if (!receive.runtimeSpread) return !send.runtimeSpread;
  if (!send.runtimeSpread) return true;
  return receive.runtimeSpread.spreadId === send.runtimeSpread.spreadId && receive.runtimeSpread.itemIndex === send.runtimeSpread.itemIndex;
}
function route(node) {
  const value = Number(node.params.number);
  return Number.isFinite(value) ? Math.max(1, Math.min(10, Math.round(value))) : 1;
}
function analyzeDspSchedule(patch, ops, feedbackLinkIds) {
  const nodes = patch.nodes.filter((node) => node.enabled !== false);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const dependencies = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (from, to, kind) => {
    if (!byId.has(from) || !byId.has(to)) return;
    const key = `${from}\0${to}\0${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    dependencies.push({ from, to, kind });
  };
  for (const link of patch.links) {
    const from = byId.get(link.from.node);
    const to = byId.get(link.to.node);
    if (!from || !to || link.enabled === false) continue;
    const boundary = from.runtimeSpread?.spreadId !== to.runtimeSpread?.spreadId || from.runtimeSpread?.itemIndex !== to.runtimeSpread?.itemIndex;
    add(from.id, to.id, boundary ? "repeat boundary" : "cable");
  }
  for (const receive of nodes.filter((node) => node.type === "Receive")) {
    for (const send of nodes.filter((node) => node.type === "Send")) {
      if (route(receive) === route(send) && sharesRuntime(receive, send)) {
        add(send.id, receive.id, "send receive");
      }
    }
  }
  for (const [types, kind] of [[EVENT_NODES, "event order"], [RESOURCE_NODES, "resource order"]]) {
    const ordered = nodes.filter((node) => types.has(node.type));
    for (let index = 1; index < ordered.length; index += 1) {
      add(ordered[index - 1].id, ordered[index].id, kind);
    }
  }
  const outgoing = new Map(nodes.map((node) => [node.id, /* @__PURE__ */ new Set()]));
  for (const edge of dependencies) outgoing.get(edge.from).add(edge.to);
  let nextIndex = 0;
  const indexByNode = /* @__PURE__ */ new Map();
  const low = /* @__PURE__ */ new Map();
  const stack = [];
  const onStack = /* @__PURE__ */ new Set();
  const components = [];
  const visit = (id) => {
    indexByNode.set(id, nextIndex);
    low.set(id, nextIndex++);
    stack.push(id);
    onStack.add(id);
    for (const next of outgoing.get(id)) {
      if (!indexByNode.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id), indexByNode.get(next)));
      }
    }
    if (low.get(id) === indexByNode.get(id)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      components.push(component.sort());
    }
  };
  for (const node of nodes) if (!indexByNode.has(node.id)) visit(node.id);
  const componentOf = new Map(components.flatMap((members, index) => members.map((id) => [id, index])));
  const incoming = components.map(() => /* @__PURE__ */ new Set());
  const outgoingComponents = components.map(() => /* @__PURE__ */ new Set());
  for (const edge of dependencies) {
    const from = componentOf.get(edge.from);
    const to = componentOf.get(edge.to);
    if (from !== to) {
      incoming[to].add(from);
      outgoingComponents[from].add(to);
    }
  }
  const indegree = incoming.map((set) => set.size);
  const ready = indegree.map((count, index) => count === 0 ? index : -1).filter((index) => index >= 0);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const next of outgoingComponents[id]) if (--indegree[next] === 0) ready.push(next);
  }
  const regions = components.map((members, id) => {
    const cyclic = members.length > 1 || dependencies.some((edge) => edge.from === members[0] && edge.to === members[0]);
    const reasons = [];
    if (cyclic) reasons.push("cross-node feedback or self-loop");
    if (feedbackLinkIds.some((key) => members.some((nodeId) => key.startsWith(`${nodeId}.`)))) {
      reasons.push("lowered feedback history");
    }
    for (const nodeId of members) {
      const node = byId.get(nodeId);
      if (!CANDIDATE_NODES.has(node.type)) reasons.push(`unsupported node: ${node.type}`);
      if (node.runtimeSpread) reasons.push("repeat template or instance boundary");
    }
    if (dependencies.some((edge) => members.includes(edge.from) && (edge.kind === "resource order" || edge.kind === "event order"))) {
      reasons.push("ordering-sensitive resource or event");
    }
    return {
      id,
      nodes: members,
      dependencies: [...incoming[id]].sort((a, b) => a - b),
      cyclic,
      eligibility: reasons.length ? "scalar" : "block candidate",
      reasons: [...new Set(reasons)]
    };
  });
  const operationFallbacks = {};
  for (const op of ops) if (!CANDIDATE_OPS.has(op.opcode)) {
    const name = OPCODE_NAMES2.get(op.opcode) ?? `unknown ${op.opcode}`;
    operationFallbacks[name] = (operationFallbacks[name] ?? 0) + 1;
  }
  return {
    rendering: "scalar",
    expandedNodeCount: nodes.length,
    operationCount: ops.length,
    operationFallbacks,
    dependencies,
    feedbackBoundaries: [...feedbackLinkIds],
    regions,
    order
  };
}

// editor/src/audio/dspProgram.ts
var BUTTON_GATE_FADE_SECONDS = 8e-3;
var MAX_DSP_OPS = 4096;
var MAX_DSP_REGISTERS = 4096;
var MAX_DSP_VALUES = 2048;
var MAX_DSP_STATE = 4096;
var MAX_DSP_EFFECT_BUFFERS = 64;
var MAX_DSP_BUFFERS = 16;
var OSC_WAVES = {
  SineOsc: 0,
  TriangleOsc: 1,
  SawOsc: 2,
  RampOsc: 3,
  SquareOsc: 4,
  SampleHoldOsc: 5,
  KinkOsc: 12
};
var FILTER_TYPES = {
  LowpassFilter: 1,
  HighpassFilter: 2,
  BandpassFilter: 3,
  AllpassFilter: 8
};
var DISTORTION_TYPES = {
  HardClipDistortion: 1,
  SoftClipDistortion: 2,
  FuzzDistortion: 3,
  SaturateDistortion: 4,
  WavefoldDistortion: 5
};
var EXPRESSION_FUNCTIONS = {
  abs: { id: 1, minArgs: 1, maxArgs: 1 },
  sin: { id: 2, minArgs: 1, maxArgs: 1 },
  cos: { id: 3, minArgs: 1, maxArgs: 1 },
  tan: { id: 4, minArgs: 1, maxArgs: 1 },
  tanh: { id: 5, minArgs: 1, maxArgs: 1 },
  min: { id: 6, minArgs: 2, maxArgs: 2 },
  max: { id: 7, minArgs: 2, maxArgs: 2 },
  clamp: { id: 8, minArgs: 3, maxArgs: 3 },
  pow: { id: 9, minArgs: 2, maxArgs: 2 },
  exp: { id: 10, minArgs: 1, maxArgs: 1 },
  log: { id: 11, minArgs: 1, maxArgs: 1 },
  sqrt: { id: 12, minArgs: 1, maxArgs: 1 },
  floor: { id: 13, minArgs: 1, maxArgs: 1 },
  ceil: { id: 14, minArgs: 1, maxArgs: 1 },
  round: { id: 15, minArgs: 1, maxArgs: 1 },
  sign: { id: 16, minArgs: 1, maxArgs: 1 },
  fract: { id: 17, minArgs: 1, maxArgs: 1 },
  mix: { id: 18, minArgs: 3, maxArgs: 3 }
};
var EXPRESSION_LOGIC_FUNCTIONS = {
  less: 19,
  lessEqual: 20,
  greater: 21,
  greaterEqual: 22,
  equal: 23,
  notEqual: 24,
  and: 25,
  or: 26,
  not: 27
};
function compilePatchToDspProgram(patch, optimizationOptions = {}) {
  const spreadExpansion = expandSpreads(patch);
  const expandedPatch = expandGroups(withLinkWeightModulationNodes(spreadExpansion.patch));
  const context = createContext(expandedPatch);
  context.optimizationOptions = optimizationOptions;
  context.errors.push(...spreadExpansion.errors);
  const ordinaryNodes = expandedPatch.nodes.filter((node) => !node.runtimeSpread);
  const audioOutNodes = ordinaryNodes.filter((node) => node.type === "AudioOut");
  const hasRuntimeAudioOut = expandedPatch.nodes.some((node) => node.runtimeSpread && node.type === "AudioOut");
  const monitorNodes = ordinaryNodes.filter((node) => node.type === "Meter" || node.type === "Scope" || node.type === "FFT");
  const sliderMonitorNodes = ordinaryNodes.filter((node) => node.type === "Slider");
  const sequencerMonitorNodes = ordinaryNodes.filter((node) => node.type === "Sequencer" || node.type === "Roll");
  const imagePreviewNodes = ordinaryNodes.filter((node) => node.type === "Image");
  const samplePreviewNodes = ordinaryNodes.filter((node) => node.type === "SamplePlayer");
  const bufferPreviewNodes = ordinaryNodes.filter((node) => node.type === "Buffer");
  validatePatchLinks(context);
  compileSpreadTemplates(context);
  if (audioOutNodes.length === 0 && !hasRuntimeAudioOut && monitorNodes.length === 0 && sequencerMonitorNodes.length === 0 && imagePreviewNodes.length === 0) {
    context.errors.push("Patch needs an Audio Out node.");
  }
  for (const node of audioOutNodes) {
    compileAudioOut(node, context);
  }
  for (const node of ordinaryNodes.filter((candidate) => candidate.enabled !== false && (candidate.type === "MidiNoteOnSend" || candidate.type === "MidiNoteOffSend"))) {
    compileMidiNoteSend(node, context);
  }
  for (const node of ordinaryNodes.filter((candidate) => candidate.enabled !== false && candidate.type === "MidiCcSend")) {
    compileMidiCcSend(node, context);
  }
  for (const node of monitorNodes) {
    if (node.type === "FFT") {
      ensureFftBinding(node, context);
    } else {
      resolveOutput(node, "signal", context);
    }
  }
  for (const node of sliderMonitorNodes) {
    registerSliderMonitor(node, context);
  }
  for (const node of ordinaryNodes.filter((candidate) => candidate.type === "Params")) {
    for (const output of node.outputs ?? []) resolveOutput(node, output.name, context);
  }
  for (const node of sequencerMonitorNodes) {
    registerSequencerMonitor(node, context);
  }
  for (const node of imagePreviewNodes) {
    context.monitorIds[`${node.id}:image-x`] = resolveInput(node, "x", 0.5, context);
    context.monitorIds[`${node.id}:image-y`] = resolveInput(node, "y", 0.5, context);
  }
  for (const node of samplePreviewNodes) {
    resolveOutput(node, "signal", context);
  }
  for (const node of bufferPreviewNodes) {
    resolveOutput(node, "signal", context);
  }
  const optimization = simplifyDspOperations(context, optimizationOptions);
  const schedule = optimizationOptions.analyzeSchedule ? analyzeDspSchedule(expandedPatch, context.ops, context.feedbackLinkIds) : void 0;
  if (context.ops.length > MAX_DSP_OPS) {
    context.errors.push(`DSP program needs ${context.ops.length} operations; the engine limit is ${MAX_DSP_OPS}. Reduce the nodes inside Spreads.`);
  }
  if (context.registerCount > MAX_DSP_REGISTERS) {
    context.errors.push(`DSP program needs ${context.registerCount} registers; the engine limit is ${MAX_DSP_REGISTERS}. Reduce the nodes inside Spreads.`);
  }
  if (context.values.length > MAX_DSP_VALUES) {
    context.errors.push(`DSP program needs ${context.values.length} values; the engine limit is ${MAX_DSP_VALUES}. Reduce the nodes inside Spreads.`);
  }
  if (context.stateCount > MAX_DSP_STATE) {
    context.errors.push(`DSP program needs ${context.stateCount} state slots; the engine limit is ${MAX_DSP_STATE}. Reduce the nodes inside Spreads.`);
  }
  const effectBufferCount = new Set(context.ops.filter(dspOpUsesEffectBuffer).flatMap((op) => typeof op.state === "number" ? [op.state] : [])).size;
  if (effectBufferCount > MAX_DSP_EFFECT_BUFFERS) {
    context.errors.push(`DSP program needs ${effectBufferCount} buffered effects; the engine limit is ${MAX_DSP_EFFECT_BUFFERS}. Reduce Delay, Chorus, Reverb, Comb/Notch, or Limiter nodes.`);
  }
  const bufferCount = new Set(context.ops.filter((op) => op.opcode === DSP_OP.Buffer).flatMap((op) => typeof op.state === "number" ? [op.state] : [])).size;
  if (bufferCount > MAX_DSP_BUFFERS) {
    context.errors.push(`DSP program needs ${bufferCount} Buffer nodes; the engine limit is ${MAX_DSP_BUFFERS}.`);
  }
  if (context.errors.length > 0) {
    return {
      version: 1,
      ops: [],
      values: context.values,
      valueBindings: context.valueBindings,
      midiControlBindings: context.midiControlBindings,
      tempoBindings: context.tempoBindings,
      stateBindings: context.stateBindings,
      registerCount: context.registerCount,
      stateCount: context.stateCount,
      feedbackLinkIds: context.feedbackLinkIds,
      monitorIds: context.monitorIds,
      signedMeterIds: context.signedMeterIds,
      sampleBindings: context.sampleBindings,
      imageBindings: context.imageBindings,
      customWaveBindings: context.customWaveBindings,
      sequencerBindings: context.sequencerBindings,
      repeatBindings: context.repeatBindings,
      fftBindings: context.fftBindings,
      maxVoices: context.maxVoices,
      usesMidiNote: context.usesMidiNote,
      usesMidiClock: context.usesMidiClock,
      errors: [...new Set(context.errors)],
      optimization,
      schedule
    };
  }
  return {
    version: 1,
    engineApiVersion: context.ops.some((op) => op.opcode === DSP_OP.Input && (op.b === 0 || op.b === 1)) ? 2 : 1,
    ops: context.ops,
    values: context.values,
    valueBindings: context.valueBindings,
    midiControlBindings: context.midiControlBindings,
    tempoBindings: context.tempoBindings,
    stateBindings: context.stateBindings,
    registerCount: context.registerCount,
    stateCount: context.stateCount,
    feedbackLinkIds: context.feedbackLinkIds,
    monitorIds: context.monitorIds,
    signedMeterIds: context.signedMeterIds,
    sampleBindings: context.sampleBindings,
    imageBindings: context.imageBindings,
    customWaveBindings: context.customWaveBindings,
    sequencerBindings: context.sequencerBindings,
    repeatBindings: context.repeatBindings,
    fftBindings: context.fftBindings,
    maxVoices: context.maxVoices,
    usesMidiNote: context.usesMidiNote,
    usesMidiClock: context.usesMidiClock,
    errors: [],
    optimization,
    schedule
  };
}
function withLinkWeightModulationNodes(patch) {
  const nodes = patch.nodes.map((node) => node.subpatch ? { ...node, subpatch: withLinkWeightModulationNodes(node.subpatch) } : node);
  const links = [];
  let nextId = 0;
  const lower = (link) => {
    const modulators = link.weightModulations?.filter((entry) => entry.enabled !== false) ?? [];
    if (modulators.length === 0) {
      links.push({ ...link, weightModulations: void 0 });
      return;
    }
    let id = `__link_strength_${nextId++}`;
    while (nodes.some((node) => node.id === id)) id = `${id}_generated`;
    const runtimeSpread = nodes.find((node) => node.id === link.from.node)?.runtimeSpread ?? nodes.find((node) => node.id === link.to.node)?.runtimeSpread;
    nodes.push({
      id,
      type: "Multiply",
      params: { factor: finiteNumber(link.weight, 1) },
      enabled: nodes.find((node) => node.id === link.from.node)?.enabled !== false,
      ...runtimeSpread ? { runtimeSpread: { ...runtimeSpread, originalNodeId: id } } : {}
    });
    links.push({ from: link.from, to: { node: id, port: "signal" }, weight: 1, mode: "set", enabled: link.enabled });
    for (const modulation of modulators) {
      lower({
        from: modulation.from,
        to: { node: id, port: "factor" },
        weight: modulation.weight ?? 1,
        mode: modulation.mode ?? "set",
        enabled: modulation.enabled,
        weightModulations: modulation.weightModulations
      });
    }
    links.push({ from: { node: id, port: "signal" }, to: link.to, weight: 1, mode: link.mode, enabled: link.enabled });
  };
  patch.links.forEach(lower);
  return { ...patch, nodes, links };
}
function createContext(patch) {
  const nodeById = new Map(patch.nodes.map((node) => [node.id, node]));
  const incomingByInput = /* @__PURE__ */ new Map();
  for (const link of patch.links) {
    if (link.enabled === false) continue;
    if (nodeById.get(link.from.node)?.enabled === false || nodeById.get(link.to.node)?.enabled === false) continue;
    const target = nodeById.get(link.to.node);
    const targetPort = target?.type === "Sequencer" && link.to.port === "tick" ? "signal" : link.to.port;
    const key = inputKey(link.to.node, targetPort);
    incomingByInput.set(key, [...incomingByInput.get(key) ?? [], link]);
  }
  return {
    patch,
    nodeById,
    incomingByInput,
    outputCache: /* @__PURE__ */ new Map(),
    bufferRecordHeadOutputByNodeId: /* @__PURE__ */ new Map(),
    buttonGateOutputByNodeId: /* @__PURE__ */ new Map(),
    joystickUnitValueByAxis: /* @__PURE__ */ new Map(),
    sliderUnitValueByNodeId: /* @__PURE__ */ new Map(),
    sendSignalByNodeId: /* @__PURE__ */ new Map(),
    visitingOutputs: /* @__PURE__ */ new Set(),
    feedbackByOutput: /* @__PURE__ */ new Map(),
    sequencerStateByNodeId: /* @__PURE__ */ new Map(),
    sequencerStepRegisterByNodeId: /* @__PURE__ */ new Map(),
    ops: [],
    values: [],
    valueBindings: [],
    midiControlBindings: [],
    tempoBindings: [],
    stateBindings: [],
    constantValueIndexes: /* @__PURE__ */ new Map(),
    constantRegisters: /* @__PURE__ */ new Map(),
    deduplicatedLoads: 0,
    optimizationOptions: {},
    errors: [],
    feedbackLinkIds: [],
    monitorIds: {},
    signedMeterIds: [],
    sampleBindings: [],
    imageBindings: [],
    imageBindingIndexByNodeId: /* @__PURE__ */ new Map(),
    customWaveBindings: [],
    sequencerBindings: [],
    sequencerBindingIndexByNodeId: /* @__PURE__ */ new Map(),
    repeatBindings: [],
    fftBindings: [],
    fftBindingByNodeId: /* @__PURE__ */ new Map(),
    spreadCountRegisterById: /* @__PURE__ */ new Map(),
    spawnActiveCountRegisterById: /* @__PURE__ */ new Map(),
    spreadBoundaryRegisterByLink: /* @__PURE__ */ new Map(),
    usesMidiNote: false,
    usesMidiClock: false,
    maxVoices: 1,
    registerCount: 0,
    stateCount: 0
  };
}
function compileSpreadTemplates(context) {
  const spreads = context.patch.nodes.filter((node) => node.type === "Spread" || node.type === "Spawn");
  for (let spreadSlot = 0; spreadSlot < spreads.length; spreadSlot += 1) {
    const spread = spreads[spreadSlot];
    const templateNodes = context.patch.nodes.filter((node) => node.runtimeSpread?.spreadId === spread.id);
    const templateIds = new Set(templateNodes.map((node) => node.id));
    for (const link of context.patch.links) {
      if (link.enabled === false || context.nodeById.get(link.from.node)?.enabled === false || context.nodeById.get(link.to.node)?.enabled === false || !templateIds.has(link.to.node) || templateIds.has(link.from.node)) continue;
      const source = context.nodeById.get(link.from.node);
      if (source) resolveOutput(source, link.from.port, context);
    }
    const receives = templateNodes.filter((node) => node.type === "Receive");
    for (const send of context.patch.nodes) {
      if (send.type !== "Send" || send.enabled === false || send.runtimeSpread) continue;
      if (receives.some((receive) => routingNumber(receive) === routingNumber(send) && routingNodesShareRuntime(receive, send))) resolveSendSignal(send, context);
    }
    const countRegister = spread.type === "Spread" ? ensureSpreadCountRegister(spread, context) : nextRegister(context);
    const triggerRegister = spread.type === "Spawn" ? resolveInput(spread, "trigger", 0, context, "immediate") : -1;
    const releaseTriggerRegister = spread.type === "Spawn" ? resolveInput(spread, "release trigger", 0, context, "immediate") : -1;
    const stateStart = context.stateCount;
    const begin = {
      opcode: spread.type === "Spawn" ? DSP_OP.SpawnBegin : DSP_OP.SpreadBegin,
      out: spread.type === "Spawn" ? countRegister : -1,
      a: spread.type === "Spawn" ? triggerRegister : countRegister,
      b: -1,
      c: -1,
      d: releaseTriggerRegister,
      state: stateStart,
      value: spreadSlot,
      value2: 0
    };
    context.ops.push(begin);
    context.constantRegisters.clear();
    if (spread.type === "Spawn") {
      context.spawnActiveCountRegisterById.set(spread.id, countRegister);
      context.monitorIds[`${spread.id}:spawn-count`] = countRegister;
    }
    for (const node of templateNodes) {
      if (node.type === "AudioOut") compileAudioOut(node, context);
      else if (node.type === "FFT") ensureFftBinding(node, context);
      else if (node.type === "Meter" || node.type === "Scope") resolveOutput(node, "signal", context);
      else if (node.type === "SamplePlayer") resolveOutput(node, "signal", context);
      else if (node.enabled !== false && (node.type === "MidiNoteOnSend" || node.type === "MidiNoteOffSend")) compileMidiNoteSend(node, context);
      else if (node.enabled !== false && node.type === "MidiCcSend") compileMidiCcSend(node, context);
    }
    for (const link of context.patch.links) {
      if (link.enabled === false || context.nodeById.get(link.from.node)?.enabled === false || context.nodeById.get(link.to.node)?.enabled === false || !templateIds.has(link.from.node) || templateIds.has(link.to.node)) continue;
      if (spread.type === "Spawn" && link.to.node === spread.id && link.to.port === "kill trigger") continue;
      const source = context.nodeById.get(link.from.node);
      if (!source) continue;
      const sourceRegister = resolveOutput(source, link.from.port, context);
      if (sourceRegister === null) continue;
      const weightedRegister = emitBinary(
        DSP_OP.Mul,
        sourceRegister,
        valueRegisterForLinkWeight(link, context),
        context
      );
      const aggregateRegister = nextRegister(context);
      context.ops.push({
        opcode: DSP_OP.SpreadCollect,
        out: aggregateRegister,
        a: weightedRegister,
        b: (link.mode ?? "set") === "multiply" ? 1 : 0
      });
      context.spreadBoundaryRegisterByLink.set(link, aggregateRegister);
    }
    if (spread.type === "Spawn" && hasInput(spread, "kill trigger", context)) {
      begin.c = resolveInput(spread, "kill trigger", 0, context, "immediate", spread.id);
    }
    const endIndex = context.ops.length;
    context.ops.push({
      opcode: spread.type === "Spawn" ? DSP_OP.SpawnEnd : DSP_OP.SpreadEnd,
      value: spreadSlot
    });
    context.constantRegisters.clear();
    begin.b = endIndex;
    begin.value2 = context.stateCount - stateStart;
    context.repeatBindings.push({
      nodeId: spread.id,
      type: spread.type === "Spawn" ? "Spawn" : "Spread",
      slot: spreadSlot,
      stateStart,
      stateCount: context.stateCount - stateStart
    });
  }
}
function ensureSpreadCountRegister(spread, context) {
  const existing = context.spreadCountRegisterById.get(spread.id);
  if (existing !== void 0) return existing;
  const liveCount = resolveInput(spread, "count", 1, context, "immediate");
  const countRegister = nextRegister(context);
  const state = nextState(context, 1);
  context.ops.push({ opcode: DSP_OP.BlockLatch, out: countRegister, a: liveCount, state });
  context.stateBindings.push({
    id: `${spread.id}:count`,
    state,
    count: 1,
    kind: "spread",
    nodeId: spread.id
  });
  context.spreadCountRegisterById.set(spread.id, countRegister);
  return countRegister;
}
function compileAudioOut(node, context) {
  const level = resolveInput(node, "level", 0.75, context);
  const leftRegisters = [];
  const rightRegisters = [];
  let outputLinkCount = 0;
  for (const port of ["both", "left", "right"]) {
    const links = context.incomingByInput.get(inputKey(node.id, port)) ?? [];
    if (links.length === 0) continue;
    outputLinkCount += links.length;
    const input = resolveInput(node, port, 0, context);
    const scaled = emitBinary(DSP_OP.Mul, input, level, context);
    if (port === "both" || port === "left") {
      context.ops.push({ opcode: DSP_OP.Output, a: scaled, b: 0 });
      leftRegisters.push(scaled);
    }
    if (port === "both" || port === "right") {
      context.ops.push({ opcode: DSP_OP.Output, a: scaled, b: 1 });
      rightRegisters.push(scaled);
    }
  }
  if (outputLinkCount === 0) {
    context.errors.push(`Audio Out node "${node.id}" has no connected audio signal.`);
    return;
  }
  context.monitorIds[`${node.id}:left`] = sumRegisters(leftRegisters, context);
  context.monitorIds[`${node.id}:right`] = sumRegisters(rightRegisters, context);
}
function compileMidiNoteSend(node, context) {
  const state = nextState(context, 1);
  context.stateBindings.push({
    id: `${node.id}:trigger`,
    state,
    count: 1,
    kind: "effect",
    nodeId: node.id
  });
  context.ops.push({
    opcode: DSP_OP.MidiNoteSend,
    a: resolveInput(node, "trigger", 0, context),
    b: resolveInput(node, "note", 60, context),
    c: resolveInput(node, "velocity", node.type === "MidiNoteOnSend" ? 1 : 0, context),
    d: resolveInput(node, "channel", 1, context),
    state,
    value: node.type === "MidiNoteOnSend" ? 1 : 0
  });
}
function compileMidiCcSend(node, context) {
  const state = nextState(context, 5);
  context.stateBindings.push({
    id: `${node.id}:midi-cc-send`,
    state,
    count: 5,
    kind: "effect",
    nodeId: node.id
  });
  context.ops.push({
    opcode: DSP_OP.MidiCcSend,
    a: resolveInput(node, "signal", 0, context),
    b: resolveInput(node, "trigger", 0, context),
    c: resolveInput(node, "cc", 1, context),
    d: resolveInput(node, "channel", 1, context),
    e: resolveInput(node, "throttle", 0.1, context),
    state,
    value: hasInput(node, "trigger", context) ? 1 : 0
  });
}
function validatePatchLinks(context) {
  for (const link of context.patch.links) {
    if (link.enabled === false || context.nodeById.get(link.from.node)?.enabled === false || context.nodeById.get(link.to.node)?.enabled === false) continue;
    const source = context.nodeById.get(link.from.node);
    const target = context.nodeById.get(link.to.node);
    if (!source) {
      context.errors.push(`Link source node "${link.from.node}" does not exist.`);
    } else if (!portExists2(getNodeDefinition(source), "outputs", link.from.port)) {
      context.errors.push(`Link "${formatLink(link)}" uses invalid output port "${link.from.port}" on node "${link.from.node}".`);
    }
    if (!target) {
      context.errors.push(`Link target node "${link.to.node}" does not exist.`);
    } else if (!portExists2(getNodeDefinition(target), "inputs", link.to.port) && !isLegacySequencerTickInput(target, link.to.port)) {
      context.errors.push(`Link "${formatLink(link)}" uses invalid input port "${link.to.port}" on node "${link.to.node}".`);
    }
  }
}
function isLegacySequencerTickInput(node, port) {
  return node.type === "Sequencer" && port === "tick";
}
function portExists2(definition, side, port) {
  return definition[side].some((entry) => entry.name === port);
}
function formatLink(link) {
  return `${link.from.node}:${link.from.port} -> ${link.to.node}:${link.to.port}`;
}
function resolveInput(node, port, fallback, context, valueMode = "smoothed", runtimeTargetSpreadId) {
  const links = context.incomingByInput.get(inputKey(node.id, port)) ?? [];
  if (links.length === 0) {
    return valueRegisterForNodeParam(node, port, fallback, context, valueMode);
  }
  const setRegisters = [];
  const setSpreadGroups = /* @__PURE__ */ new Map();
  let ordinarySetCount = 0;
  const addRegisters = [];
  const multiplyRegisters = [];
  const bendRegisters = [];
  for (const link of links) {
    let register = resolveLinkValue(link, context);
    if (register === null) continue;
    switch (link.mode ?? "set") {
      case "add":
        addRegisters.push(register);
        break;
      case "multiply":
        multiplyRegisters.push(register);
        break;
      case "bend":
        bendRegisters.push(register);
        break;
      case "set":
        setRegisters.push(register);
        {
          const source = context.nodeById.get(link.from.node);
          const spread = source?.runtimeSpread;
          const targetSpreadId = node.runtimeSpread?.spreadId ?? runtimeTargetSpreadId;
          if (spread && spread.spreadId !== targetSpreadId) {
            const countRegister = context.spreadCountRegisterById.get(spread.spreadId) ?? context.spawnActiveCountRegisterById.get(spread.spreadId);
            if (countRegister !== void 0) {
              setSpreadGroups.set(
                `${spread.spreadId}:${spread.originalNodeId}:${link.from.port}`,
                countRegister
              );
            }
          } else {
            ordinarySetCount += 1;
          }
        }
        break;
    }
  }
  const setDenominatorRegisters = [
    ...ordinarySetCount > 0 ? [constantRegister(ordinarySetCount, context)] : [],
    ...setSpreadGroups.values()
  ];
  let result = setRegisters.length > 0 ? emitBinary(
    DSP_OP.Div,
    sumRegisters(setRegisters, context),
    sumRegisters(setDenominatorRegisters, context),
    context
  ) : valueRegisterForNodeParam(node, port, fallback, context, valueMode);
  for (const register of addRegisters) {
    result = emitBinary(DSP_OP.Add, result, register, context);
  }
  for (const register of multiplyRegisters) {
    result = emitBinary(DSP_OP.Mul, result, register, context);
  }
  for (const register of bendRegisters) {
    result = emitBinary(DSP_OP.Mul, result, emitUnary(DSP_OP.Bend, register, context), context);
  }
  return result;
}
function hasInput(node, port, context) {
  return (context.incomingByInput.get(inputKey(node.id, port)) ?? []).length > 0;
}
function resolveOptionalZeroInput(node, port, context) {
  if (!hasInput(node, port, context) && finiteNumber(node.params[port], 0) === 0) {
    return -1;
  }
  return resolveInput(node, port, 0, context);
}
function resolveLinkValue(link, context) {
  const spreadBoundaryRegister = context.spreadBoundaryRegisterByLink.get(link);
  if (spreadBoundaryRegister !== void 0) return spreadBoundaryRegister;
  const source = context.nodeById.get(link.from.node);
  if (!source) {
    context.errors.push(`Link source node "${link.from.node}" does not exist.`);
    return null;
  }
  const sourceRegister = resolveOutput(source, link.from.port, context);
  if (sourceRegister === null) return null;
  const weightRegister = valueRegisterForLinkWeight(link, context);
  return emitBinary(DSP_OP.Mul, sourceRegister, weightRegister, context);
}
function resolveOutput(node, port, context) {
  if (!getNodeDefinition(node).outputs.some((output) => output.name === port)) {
    context.errors.push(`Node "${node.id}" does not have supported output "${port}".`);
    return null;
  }
  const key = inputKey(node.id, port);
  const cached = context.outputCache.get(key);
  if (cached !== void 0) return cached;
  if (context.visitingOutputs.has(key)) {
    return feedbackRegisterForOutput(node, port, context);
  }
  context.visitingOutputs.add(key);
  const register = compileNodeOutput(node, port, context);
  context.visitingOutputs.delete(key);
  if (register !== null) {
    context.outputCache.set(key, register);
    emitFeedbackWriteIfNeeded(key, register, context);
    return register;
  }
  return register;
}
function feedbackRegisterForOutput(node, port, context) {
  const key = inputKey(node.id, port);
  const existing = context.feedbackByOutput.get(key);
  if (existing) return existing.readRegister;
  const state = nextState(context, 1);
  const readRegister = nextRegister(context);
  context.ops.push({ opcode: DSP_OP.FeedbackRead, out: readRegister, state });
  context.feedbackByOutput.set(key, { readRegister, state, writeEmitted: false });
  context.feedbackLinkIds.push(key);
  context.stateBindings.push({
    id: `${key}:feedback`,
    state,
    count: 1,
    kind: "feedback",
    nodeId: node.id
  });
  return readRegister;
}
function emitFeedbackWriteIfNeeded(key, register, context) {
  const feedback = context.feedbackByOutput.get(key);
  if (!feedback || feedback.writeEmitted) return;
  context.ops.push({ opcode: DSP_OP.FeedbackWrite, a: register, state: feedback.state });
  feedback.writeEmitted = true;
}
function compileNodeOutput(node, port, context) {
  if (node.type === "Params") {
    return valueRegisterForNodeParam(node, port, 0, context);
  }
  if (node.type === "Spread" || node.type === "Spawn") {
    context.errors.push(`${node.type} "${node.id}" does not expose that output.`);
    return null;
  }
  if (node.type === "Constant") {
    if (node.runtimeSpread?.originalNodeId === "__item_index__") {
      const output = nextRegister(context);
      context.ops.push({ opcode: DSP_OP.SpreadIndex, out: output });
      return output;
    }
    if (node.runtimeSpread?.originalNodeId === "__instance_gate__") {
      const output = nextRegister(context);
      context.ops.push({ opcode: DSP_OP.SpawnInstanceGate, out: output });
      return output;
    }
    return resolveInput(node, "value", 1, context);
  }
  if (node.type === "Pass") {
    return resolveInput(node, "signal", 0, context);
  }
  if (node.type === "Receive") {
    const number = routingNumber(node);
    const sendRegisters = context.patch.nodes.filter((candidate) => candidate.enabled !== false && candidate.type === "Send" && routingNumber(candidate) === number && routingNodesShareRuntime(node, candidate)).map((send) => resolveSendSignal(send, context));
    return sumRegisters(sendRegisters, context);
  }
  if (node.type === "Buffer" && port === "record head out") {
    resolveOutput(node, "signal", context);
    const output = context.bufferRecordHeadOutputByNodeId.get(node.id);
    if (output === void 0) {
      context.errors.push(`Could not compile record head output for node "${node.id}".`);
      return constantRegister(0, context);
    }
    return output;
  }
  if ((node.type === "Envelope" || node.type === "CustomWave") && port === "end trigger") {
    resolveOutput(node, node.type === "CustomWave" && Math.round(node.params.count ?? 1) > 1 ? "signal 1" : "signal", context);
    const bindingId = node.type === "Envelope" ? `${node.id}:envelope` : `${node.id}:oscillator:0`;
    const sourceState = context.stateBindings.find((binding) => binding.id === bindingId)?.state;
    if (sourceState === void 0) {
      context.errors.push(`Could not compile end trigger for node "${node.id}".`);
      return null;
    }
    const output = nextRegister(context);
    const state = nextState(context, node.type === "Envelope" ? 1 : 5);
    context.stateBindings.push({
      id: `${node.id}:end-trigger`,
      state,
      count: node.type === "Envelope" ? 1 : 5,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.EndTrigger,
      out: output,
      a: sourceState,
      b: node.type === "CustomWave" ? context.customWaveBindings.findIndex((binding) => binding.nodeId === `${node.id}:wave:0`) : -1,
      state,
      value: node.type === "CustomWave" ? 1 : 0
    });
    return output;
  }
  if (node.type === "FFT") {
    const binding = ensureFftBinding(node, context);
    if (port === "frequency") return emitValue(binding.frequencyValueIndex, context, "immediate");
    if (port === "amplitude") return emitValue(binding.amplitudeValueIndex, context, "immediate");
    context.errors.push(`FFT node "${node.id}" does not have supported output "${port}".`);
    return null;
  }
  if (node.type === "Slider") {
    const unitValue = resolveSliderUnitValue(node, context);
    context.monitorIds[node.id] = unitValue;
    const mappedUnitValue = applySliderCurve(node, unitValue, context);
    const hasSignal = hasInput(node, "signal", context);
    const hasInverseSignal = hasInput(node, "inverse signal", context);
    if (hasSignal || hasInverseSignal) {
      return compileControlSignalOutput(node, port, mappedUnitValue, hasSignal, hasInverseSignal, context);
    }
    const outputUnitValue = port === "inverse" ? emitBinary(DSP_OP.Sub, constantRegister(1, context), mappedUnitValue, context) : mappedUnitValue;
    const min = resolveInput(node, "min", 0, context);
    const max = resolveInput(node, "max", 1, context);
    return emitBinary(DSP_OP.Add, min, emitBinary(DSP_OP.Mul, outputUnitValue, emitBinary(DSP_OP.Sub, max, min, context), context), context);
  }
  if (node.type === "Joystick") {
    const axis = port.startsWith("x") ? "x" : "y";
    const unitValue = resolveJoystickUnitValue(node, axis, context);
    const outputUnitValue = port.endsWith(" inverse") ? emitBinary(DSP_OP.Sub, constantRegister(1, context), unitValue, context) : unitValue;
    const min = resolveInput(node, `${axis}Min`, 0, context);
    const max = resolveInput(node, `${axis}Max`, 1, context);
    return emitBinary(
      DSP_OP.Add,
      min,
      emitBinary(DSP_OP.Mul, outputUnitValue, emitBinary(DSP_OP.Sub, max, min, context), context),
      context
    );
  }
  if (node.type === "Button") {
    const gateOutput = resolveButtonGateOutput(node, context);
    const hasSignal = hasInput(node, "signal", context);
    const hasInverseSignal = hasInput(node, "inverse signal", context);
    if (hasSignal || hasInverseSignal) {
      return compileControlSignalOutput(node, port, gateOutput, hasSignal, hasInverseSignal, context);
    }
    return port === "inverse" ? emitBinary(DSP_OP.Sub, constantRegister(1, context), gateOutput, context) : gateOutput;
  }
  if (node.type === "Keys") {
    const valueIndex2 = valueIndexForNodeParam(node, port === "frequency" ? "frequency" : "note", 0, context);
    const output = emitValue(valueIndex2, context, "immediate");
    if (port !== "frequency") return output;
    const smoothedOutput = nextRegister(context);
    const state = nextState(context, 4);
    context.stateBindings.push({
      id: `${node.id}:keys-frequency-glide`,
      state,
      count: 4,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Slew,
      out: smoothedOutput,
      a: output,
      b: resolveInput(node, "glide", 0, context),
      state,
      value: 0,
      value2: 1,
      value3: 1
    });
    return smoothedOutput;
  }
  if (node.type === "Expression") {
    return compileExpression(node, context);
  }
  if (node.type === "MidiNote" || node.type === "MidiNoteOn" || node.type === "MidiNoteOff") {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.MidiNote,
      out: output,
      a: midiNoteOutputKind(node.type, port),
      b: resolveInput(node, "channel", 0, context)
    });
    return output;
  }
  if (node.type === "Tempo") {
    return compileTempo(node, port, context);
  }
  if (node.type === "MidiCc") {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.MidiCc,
      out: output,
      a: resolveInput(node, "cc", 1, context),
      b: resolveInput(node, "channel", 0, context)
    });
    return output;
  }
  if (node.type === "Noise") {
    const rangeMin = resolveInput(node, "rangeMin", -1, context);
    const rangeMax = resolveInput(node, "rangeMax", 1, context);
    const output = nextRegister(context);
    const state = nextState(context, 1);
    context.ops.push({
      opcode: DSP_OP.Osc,
      out: output,
      a: 6,
      b: -1,
      state,
      value2: rangeMin,
      value3: rangeMax,
      value4: 1
    });
    return output;
  }
  if (node.type === "Random") {
    const output = nextRegister(context);
    const state = nextState(context, 4);
    context.stateBindings.push({
      id: `${node.id}:random`,
      state,
      count: 4,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Random,
      out: output,
      a: resolveOptionalZeroInput(node, "trigger", context),
      b: resolveInput(node, "rangeMin", -1, context),
      c: resolveInput(node, "rangeMax", 1, context),
      state
    });
    return output;
  }
  const wave = OSC_WAVES[node.type];
  if (wave !== void 0) {
    const frequency = wave === 5 ? -1 : resolveInput(node, "frequency", 220, context);
    const signal = hasInput(node, "signal", context) ? resolveInput(node, "signal", 0, context) : -1;
    const phaseOrTrigger = wave === 5 ? resolveOptionalZeroInput(node, "trigger", context) : resolveOptionalZeroInput(node, "phase", context);
    const phaseReset = wave === 5 ? -1 : resolveOptionalZeroInput(node, wave === 12 ? "phase reset" : "phaseReset", context);
    const rangeMin = wave === 5 ? -1 : resolveInput(node, wave === 12 ? "range min" : "rangeMin", -1, context);
    const rangeMax = wave === 5 ? -1 : resolveInput(node, wave === 12 ? "range max" : "rangeMax", 1, context);
    const pulseWidth = wave === 4 ? resolveInput(node, "pulse width", 0.5, context) : -1;
    const kinkShape = wave === 12 ? resolveInput(node, "shape", 0, context) : -1;
    const kinkSquareness = wave === 12 ? resolveInput(node, "squareness", 0, context) : -1;
    const output = nextRegister(context);
    const stateCount = wave === 5 ? 3 : phaseReset >= 0 ? 4 : 1;
    const state = nextState(context, stateCount);
    context.stateBindings.push({
      id: `${node.id}:oscillator`,
      state,
      count: stateCount,
      kind: "oscillator",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Osc,
      out: output,
      a: wave,
      b: frequency,
      c: wave === 12 ? kinkSquareness : signal,
      d: phaseOrTrigger,
      e: phaseReset,
      state,
      value2: rangeMin,
      value3: rangeMax,
      value4: wave === 5 ? 0 : 1,
      value: wave === 12 ? kinkShape : pulseWidth
    });
    return output;
  }
  if (node.type === "CustomWave") {
    const waveNumber = port === "signal" ? 0 : /^signal (\d+)$/.exec(port)?.[1];
    const waveIndex = waveNumber === void 0 ? 0 : Math.max(0, Number(waveNumber) - 1);
    const waves = customWaveBank(node.customWave, node.params);
    const customWave = waves[waveIndex] ?? waves[0];
    const staticBaseLevel = node.params.baseLevel ?? 0;
    const staticRangeMin = node.params.rangeMin ?? -1;
    const staticRangeMax = node.params.rangeMax ?? 1;
    const customWaveIndex = context.customWaveBindings.length;
    context.customWaveBindings.push({
      nodeId: `${node.id}:wave:${waveIndex}`,
      customWave: customWaveWithBaseLevel(
        customWave,
        staticBaseLevel,
        staticRangeMin,
        staticRangeMax
      )
    });
    const frequency = resolveInput(node, "frequency", 220, context);
    const frequencyMonitorId = `${node.id}:frequency`;
    context.monitorIds[frequencyMonitorId] = frequency;
    context.signedMeterIds.push(frequencyMonitorId);
    const baseLevel = resolveInput(node, "baseLevel", 0, context);
    const rangeMin = resolveInput(node, "rangeMin", -1, context);
    const rangeMax = resolveInput(node, "rangeMax", 1, context);
    const mappedBaseLevel = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Map,
      out: mappedBaseLevel,
      a: baseLevel,
      b: rangeMin,
      c: rangeMax,
      d: constantRegister(-1, context),
      e: constantRegister(1, context)
    });
    const normalizedBaseLevel = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.HardClip,
      out: normalizedBaseLevel,
      a: mappedBaseLevel,
      b: constantRegister(1, context)
    });
    const output = nextRegister(context);
    const state = nextState(context, 6);
    context.stateBindings.push({
      id: `${node.id}:oscillator:${waveIndex}`,
      state,
      count: 6,
      kind: "oscillator",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Osc,
      out: output,
      a: 9,
      b: frequency,
      c: normalizedBaseLevel,
      d: resolveOptionalZeroInput(node, "phase", context),
      e: resolveOptionalZeroInput(node, "trigger", context),
      state,
      value: customWaveIndex,
      value2: rangeMin,
      value3: rangeMax,
      value4: 1
    });
    return output;
  }
  if (node.type === "PerlinNoise") {
    const speed = resolveInput(node, "speed", 8, context);
    const rangeMin = resolveInput(node, "rangeMin", -1, context);
    const rangeMax = resolveInput(node, "rangeMax", 1, context);
    const output = nextRegister(context);
    const state = nextState(context, 3);
    context.stateBindings.push({
      id: `${node.id}:oscillator`,
      state,
      count: 3,
      kind: "oscillator",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Osc,
      out: output,
      a: 7,
      b: speed,
      state,
      value2: rangeMin,
      value3: rangeMax,
      value4: 1
    });
    return output;
  }
  if (node.type === "AudioInput") {
    const output = nextRegister(context);
    const gain = Math.round(node.params.muted ?? 0) === 1 ? 0 : resolveInput(node, "gain", 1, context);
    context.ops.push({
      opcode: DSP_OP.Input,
      out: output,
      a: gain,
      b: port === "left" ? 0 : port === "right" ? 1 : -1
    });
    return emitBinary(DSP_OP.Mul, output, resolveInput(node, "level", 0.7, context), context);
  }
  if (node.type === "SamplePlayer") {
    return compileSamplePlayer(node, context);
  }
  if (node.type === "Image") {
    let imageIndex = context.imageBindingIndexByNodeId.get(node.id);
    if (imageIndex === void 0) {
      imageIndex = context.imageBindings.length;
      context.imageBindingIndexByNodeId.set(node.id, imageIndex);
      context.imageBindings.push({
        nodeId: node.id,
        image: { name: node.image?.name ?? "", url: node.image?.url ?? "" }
      });
    }
    const channel = port === "brightness" ? 0 : port === "r" ? 1 : port === "g" ? 2 : port === "b" ? 3 : port === "hue" ? 4 : port === "saturation" ? 5 : -1;
    if (channel < 0) {
      context.errors.push(`Node "${node.id}" does not have supported output "${port}".`);
      return null;
    }
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Image,
      out: output,
      a: resolveInput(node, "x", 0.5, context),
      b: resolveInput(node, "y", 0.5, context),
      c: channel,
      value: imageIndex
    });
    return output;
  }
  if (node.type === "Playhead") {
    const output = nextRegister(context);
    const state = nextState(context, 2);
    context.stateBindings.push({
      id: `${node.id}:playhead`,
      state,
      count: 2,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Playhead,
      out: output,
      a: resolveInput(node, "start", 0, context),
      b: resolveInput(node, "speed", 1, context),
      c: resolveInput(node, "length", 1, context),
      e: resolveInput(node, "reset trigger", 0, context),
      state
    });
    return output;
  }
  if (node.type === "Time") {
    const output = nextRegister(context);
    const state = nextState(context, 1);
    context.stateBindings.push({
      id: `${node.id}:time`,
      state,
      count: 1,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Time,
      out: output,
      state
    });
    return output;
  }
  if (node.type === "Freq2Length") {
    return emitBinary(
      DSP_OP.Div,
      constantRegister(1, context),
      resolveInput(node, "frequency", 1, context),
      context
    );
  }
  if (node.type === "Length2Freq") {
    return emitBinary(
      DSP_OP.Div,
      constantRegister(1, context),
      resolveInput(node, "length", 1, context),
      context
    );
  }
  if (node.type === "Buffer") {
    const output = nextRegister(context);
    const recordHeadOutput = nextRegister(context);
    const state = nextState(context, 7);
    const externallyDrivenHeads = (hasInput(node, "playhead", context) ? 1 : 0) | (hasInput(node, "record head", context) ? 2 : 0);
    context.bufferRecordHeadOutputByNodeId.set(node.id, recordHeadOutput);
    context.stateBindings.push({
      id: `${node.id}:buffer`,
      state,
      count: 7,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Buffer,
      out: output,
      a: resolveInput(node, "signal", 0, context),
      b: resolveInput(node, "playhead", 0, context),
      c: resolveInput(node, "record head", 0, context),
      d: resolveInput(node, "length", 1, context),
      e: recordHeadOutput,
      state,
      value: Math.round(node.params["on reset"] ?? 0),
      value2: resolveInput(node, "playhead speed", 1, context),
      value3: resolveInput(node, "record head speed", 1, context),
      value4: externallyDrivenHeads
    });
    return output;
  }
  if (node.type === "Multiply") {
    return emitBinary(
      DSP_OP.Mul,
      resolveInput(node, "signal", 0, context),
      resolveInput(node, "factor", 1, context),
      context
    );
  }
  if (node.type === "Pow") {
    return emitFunction(
      EXPRESSION_FUNCTIONS.pow.id,
      [
        resolveInput(node, "signal", 0, context),
        resolveInput(node, "exponent", 1, context)
      ],
      context
    );
  }
  if (node.type === "Fold") {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Fold,
      out: output,
      a: resolveInput(node, "signal", 0, context),
      b: resolveInput(node, "amount", 1, context)
    });
    return output;
  }
  if (node.type === "Pan") {
    return compilePan(node, port, context);
  }
  if (node.type === "Envelope") {
    const envelope = nextRegister(context);
    const state = nextState(context, 8);
    const trigger = hasInput(node, "trigger", context) ? resolveInput(node, "trigger", 0, context) : constantRegister(0, context);
    const gate = hasInput(node, "gate", context) ? resolveInput(node, "gate", 0, context) : constantRegister(0, context);
    const sustain = resolveInput(node, "sustain", 0.72, context);
    const gateLength = resolveInput(node, "gateLength", 0, context);
    const release = resolveInput(node, "release", 0.24, context);
    context.stateBindings.push({
      id: `${node.id}:envelope`,
      state,
      count: 8,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Envelope,
      out: envelope,
      a: trigger,
      b: gate,
      c: resolveInput(node, "delay", 0, context),
      d: resolveInput(node, "attack", 0.01, context),
      e: resolveInput(node, "decay", 0.16, context),
      state,
      value: packRegisterPair(sustain, release),
      value2: gateLength + 1
    });
    const signal = hasInput(node, "signal", context) ? resolveInput(node, "signal", 0, context) : constantRegister(1, context);
    return emitBinary(DSP_OP.Mul, signal, envelope, context);
  }
  if (node.type === "Follower") {
    const output = nextRegister(context);
    const state = nextState(context, 1);
    context.stateBindings.push({
      id: `${node.id}:follower`,
      state,
      count: 1,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Follower,
      out: output,
      a: resolveInput(node, "signal", 0, context),
      b: resolveInput(node, "attack", 0.01, context),
      c: resolveInput(node, "release", 0.12, context),
      state
    });
    return output;
  }
  if (node.type === "RemoveDc") {
    const output = nextRegister(context);
    const state = nextState(context, 2);
    context.stateBindings.push({
      id: `${node.id}:dc-block`,
      state,
      count: 2,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.DcBlock,
      out: output,
      a: resolveInput(node, "signal", 0, context),
      state
    });
    return output;
  }
  const distortionType = DISTORTION_TYPES[node.type];
  if (distortionType !== void 0) {
    const output = nextRegister(context);
    const state = distortionType === 3 ? nextState(context, 1) : -1;
    context.ops.push({
      opcode: DSP_OP.Distortion,
      out: output,
      a: resolveInput(node, "signal", 0, context),
      b: resolveInput(node, "drive", 2.5, context),
      c: -1,
      state,
      value: distortionType
    });
    return output;
  }
  if (node.type === "Delay") {
    return compileEffect(node, DSP_OP.Delay, [
      ["time", 0.28],
      ["feedback", 0.35],
      ["mix", 0.25]
    ], context);
  }
  if (node.type === "Chorus") {
    return compileEffect(node, DSP_OP.Chorus, [
      ["rate", 0.8],
      ["depth", 0.012],
      ["mix", 0.25]
    ], context);
  }
  if (node.type === "Reverb") {
    return compileReverb(node, port, context);
  }
  if (node.type === "Compress") {
    const output = nextRegister(context);
    const state = nextState(context, 1);
    const signal = resolveInput(node, "signal", 0, context);
    const sidechain = hasInput(node, "sidechain", context) ? resolveInput(node, "sidechain", 0, context) : -1;
    const knee = resolveInput(node, "knee", 6, context);
    const makeup = resolveInput(node, "makeup", 0, context);
    context.stateBindings.push({
      id: `${node.id}:compressor`,
      state,
      count: 1,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Compress,
      out: output,
      a: signal,
      b: resolveInput(node, "threshold", -24, context),
      c: resolveInput(node, "ratio", 4, context),
      d: resolveInput(node, "attack", 0.01, context),
      e: resolveInput(node, "release", 0.1, context),
      state,
      value: packRegisterPair(knee, makeup),
      value2: sidechain
    });
    return output;
  }
  if (node.type === "Limiter") {
    const output = nextRegister(context);
    const state = nextState(context, 2);
    context.stateBindings.push({
      id: `${node.id}:limiter`,
      state,
      count: 2,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Limiter,
      out: output,
      a: resolveInput(node, "signal", 0, context),
      b: resolveInput(node, "inputGain", 0, context),
      c: resolveInput(node, "ceiling", -1, context),
      d: resolveInput(node, "release", 0.05, context),
      e: resolveInput(node, "lookahead", 5e-3, context),
      state
    });
    return output;
  }
  if (node.type === "Abs") {
    const output = nextRegister(context);
    context.ops.push({ opcode: DSP_OP.Abs, out: output, a: resolveInput(node, "signal", 0, context) });
    return output;
  }
  if (node.type === "Quantise") {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Quantise,
      out: output,
      a: resolveInput(node, "signal", 0, context),
      b: resolveInput(node, "scale", 0, context, "immediate"),
      c: resolveInput(node, "root", 0, context, "immediate")
    });
    return output;
  }
  if (node.type === "Map") {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Map,
      out: output,
      a: resolveInput(node, "signal", 0, context),
      b: resolveInput(node, "srcMin", 0, context),
      c: resolveInput(node, "srcMax", 1, context),
      d: resolveInput(node, "trgtMin", 0, context),
      e: resolveInput(node, "trgtMax", 1, context)
    });
    return output;
  }
  if (node.type === "Clamp") {
    const output = nextRegister(context);
    context.ops.push({
      opcode: DSP_OP.Function,
      out: output,
      a: EXPRESSION_FUNCTIONS.clamp.id,
      b: resolveInput(node, "signal", 0, context),
      c: resolveInput(node, "min", 0, context),
      d: resolveInput(node, "max", 1, context),
      value: 3
    });
    return output;
  }
  if (node.type === "Selector") {
    return compileSelector(node, context);
  }
  if (node.type === "Accumulator") {
    const output = nextRegister(context);
    const state = nextState(context, 3);
    context.stateBindings.push({
      id: `${node.id}:accumulator`,
      state,
      count: 3,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Accumulator,
      out: output,
      a: resolveInput(node, "trigger", 0, context),
      b: resolveInput(node, "min", 0, context),
      c: resolveInput(node, "max", 1, context),
      d: resolveInput(node, "increment", 1, context),
      e: resolveInput(node, "reset", 0, context),
      state,
      value: Math.round(node.params.mode ?? 0) === 1 ? 1 : 0
    });
    return output;
  }
  if (node.type === "Sequencer") {
    return compileSequencer(node, port, context);
  }
  if (node.type === "Roll") {
    return compileRoll(node, port, context);
  }
  if (node.type === "FormantFilter") {
    const output = nextRegister(context);
    const state = nextState(context, 12);
    context.stateBindings.push({
      id: `${node.id}:filter`,
      state,
      count: 12,
      kind: "filter",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Filter,
      out: output,
      a: 4,
      b: resolveInput(node, "signal", 0, context),
      c: resolveInput(node, "morph", 0, context),
      d: resolveInput(node, "intensity", 8, context),
      state
    });
    return output;
  }
  if (node.type === "Equalizer") {
    const output = nextRegister(context);
    const state = nextState(context, 12);
    context.stateBindings.push({
      id: `${node.id}:equalizer`,
      state,
      count: 12,
      kind: "filter",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Filter,
      out: output,
      a: 7,
      b: resolveInput(node, "signal", 0, context),
      c: resolveInput(node, "lows", 0, context),
      d: resolveInput(node, "mids", 0, context),
      e: resolveInput(node, "highs", 0, context),
      state
    });
    return output;
  }
  if (node.type === "CombFilter" || node.type === "CombNotchFilter") {
    const output = nextRegister(context);
    const state = nextState(context, 1);
    context.stateBindings.push({
      id: `${node.id}:comb`,
      state,
      count: 1,
      kind: "effect",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Filter,
      out: output,
      a: node.type === "CombFilter" ? 5 : 6,
      b: resolveInput(node, "signal", 0, context),
      c: resolveInput(node, "frequency", 440, context),
      d: resolveInput(node, "feedback", 0.45, context),
      state
    });
    return output;
  }
  const filterType = FILTER_TYPES[node.type];
  if (node.type === "Crossover") {
    const slope = Math.max(12, Math.min(48, Math.round(finiteNumber(node.params.slope, 24) / 12) * 12));
    const stages = slope / 12;
    const bandMatch = /^band (\d+)$/.exec(port);
    if (!bandMatch) {
      context.errors.push(`Crossover node "${node.id}" does not have supported output "${port}".`);
      return null;
    }
    const band = Number(bandMatch[1]);
    const points = Math.max(1, Math.min(8, Math.round(finiteNumber(node.params.points, 1))));
    if (band < 1 || band > points + 1) return null;
    let signal = resolveInput(node, "signal", 0, context);
    const applyBoundary = (boundary, lowPass) => {
      const legacyFrequency = boundary === 1 ? finiteNumber(node.params.frequency, 1200) : 1200;
      const frequency = resolveInput(node, `frequency ${boundary}`, legacyFrequency, context);
      for (let stage = 0; stage < stages; stage += 1) {
        const output = nextRegister(context);
        const state = nextState(context, 4);
        context.stateBindings.push({
          id: `${node.id}:crossover:${boundary}:${lowPass ? "low" : "high"}:${stage}`,
          state,
          count: 4,
          kind: "filter",
          nodeId: node.id
        });
        const q = 1 / (2 * Math.sin((2 * stage + 1) * Math.PI / (4 * stages)));
        context.ops.push({
          opcode: DSP_OP.Filter,
          out: output,
          a: lowPass ? 1 : 2,
          b: signal,
          c: frequency,
          d: constantRegister(q, context),
          state
        });
        signal = output;
      }
    };
    if (band > 1) applyBoundary(band - 1, false);
    if (band <= points) applyBoundary(band, true);
    return signal;
  }
  if (filterType !== void 0) {
    const output = nextRegister(context);
    const state = nextState(context, 4);
    context.stateBindings.push({
      id: `${node.id}:filter`,
      state,
      count: 4,
      kind: "filter",
      nodeId: node.id
    });
    context.ops.push({
      opcode: DSP_OP.Filter,
      out: output,
      a: filterType,
      b: resolveInput(node, "signal", 0, context),
      c: resolveInput(node, "cutoff", 1200, context),
      d: resolveInput(node, "resonance", 0.7, context),
      state
    });
    return output;
  }
  if (node.type === "Meter" || node.type === "Scope") {
    const signal = resolveInput(node, "signal", 0, context);
    context.monitorIds[node.id] = signal;
    if (node.type === "Meter" && !context.signedMeterIds.includes(node.id)) {
      context.signedMeterIds.push(node.id);
    }
    return signal;
  }
  context.errors.push(`Node type "${node.type}" is not supported by the first DSP program slice.`);
  return null;
}
function ensureFftBinding(node, context) {
  const existing = context.fftBindingByNodeId.get(node.id);
  if (existing) return existing;
  const inputRegister = resolveInput(node, "signal", 0, context);
  const minFrequencyValueIndex = valueIndexForNodeParam(node, "minFreq", 20, context);
  const maxFrequencyValueIndex = valueIndexForNodeParam(node, "maxFreq", 2e4, context);
  const frequencyValueIndex = valueIndex(0, {
    id: `${node.id}.frequency`,
    kind: "analyser-output",
    nodeId: node.id,
    port: "frequency"
  }, context);
  const amplitudeValueIndex = valueIndex(0, {
    id: `${node.id}.amplitude`,
    kind: "analyser-output",
    nodeId: node.id,
    port: "amplitude"
  }, context);
  const binding = {
    nodeId: node.id,
    inputRegister,
    minFrequencyValueIndex,
    maxFrequencyValueIndex,
    frequencyValueIndex,
    amplitudeValueIndex
  };
  context.monitorIds[node.id] = inputRegister;
  context.fftBindings.push(binding);
  context.fftBindingByNodeId.set(node.id, binding);
  return binding;
}
function resolveSliderUnitValue(node, context) {
  const cached = context.sliderUnitValueByNodeId.get(node.id);
  if (cached !== void 0) return cached;
  let register;
  if (hasInput(node, "value", context)) {
    register = resolveInput(node, "value", 0.5, context);
  } else {
    const valueIndex2 = valueIndexForNodeParam(node, "value", 0.5, context);
    if (context.optimizationOptions.target !== "fm1") {
      addMidiControlBinding(node, "slider", valueIndex2, context);
    }
    register = emitValue(valueIndex2, context);
  }
  context.sliderUnitValueByNodeId.set(node.id, register);
  return register;
}
function registerSliderMonitor(node, context) {
  context.monitorIds[node.id] = resolveSliderUnitValue(node, context);
}
function applySliderCurve(node, unitValue, context) {
  if (!hasInput(node, "curve", context) && finiteNumber(node.params.curve, 0) === 0) {
    return unitValue;
  }
  const clampedUnitValue = emitFunction(
    EXPRESSION_FUNCTIONS.clamp.id,
    [unitValue, constantRegister(0, context), constantRegister(1, context)],
    context
  );
  const curve = emitFunction(
    EXPRESSION_FUNCTIONS.clamp.id,
    [resolveInput(node, "curve", 0, context), constantRegister(-8, context), constantRegister(8, context)],
    context
  );
  const exponent = emitFunction(
    EXPRESSION_FUNCTIONS.pow.id,
    [constantRegister(2, context), emitBinary(DSP_OP.Neg, curve, constantRegister(0, context), context)],
    context
  );
  return emitFunction(EXPRESSION_FUNCTIONS.pow.id, [clampedUnitValue, exponent], context);
}
function compileControlSignalOutput(node, port, value, hasSignal, hasInverseSignal, context) {
  const inverseValue = emitBinary(DSP_OP.Sub, constantRegister(1, context), value, context);
  const mainWeight = port === "inverse" ? inverseValue : value;
  const inverseWeight = port === "inverse" ? value : inverseValue;
  const outputs = [];
  if (hasSignal) {
    outputs.push(emitBinary(DSP_OP.Mul, resolveInput(node, "signal", 0, context), mainWeight, context));
  }
  if (hasInverseSignal) {
    outputs.push(emitBinary(DSP_OP.Mul, resolveInput(node, "inverse signal", 0, context), inverseWeight, context));
  }
  return sumRegisters(outputs, context);
}
function resolveJoystickUnitValue(node, axis, context) {
  const key = `${node.id}:${axis}`;
  const cached = context.joystickUnitValueByAxis.get(key);
  if (cached !== void 0) return cached;
  const unitValueIndex = valueIndexForNodeParam(node, axis, 0.5, context);
  addMidiControlBinding(node, "slider", unitValueIndex, context, {}, {
    channel: `${axis}MidiChannel`,
    cc: `${axis}MidiCc`
  });
  const register = emitValue(unitValueIndex, context);
  context.joystickUnitValueByAxis.set(key, register);
  return register;
}
function resolveButtonGateOutput(node, context) {
  const cached = context.buttonGateOutputByNodeId.get(node.id);
  if (cached !== void 0) return cached;
  if (context.optimizationOptions.target === "fm1") {
    const mode = Math.round(finiteNumber(node.params.mode, 0));
    const gate = mode !== 1 && finiteNumber(node.params.pressed, 0) >= 0.5 ? 1 : 0;
    const output2 = constantRegister(gate, context);
    context.buttonGateOutputByNodeId.set(node.id, output2);
    return output2;
  }
  const output = nextRegister(context);
  const state = nextState(context, 3);
  const pressedValueIndex = valueIndexForNodeParam(node, "pressed", 0, context);
  const modeValueIndex = valueIndexForNodeParam(node, "mode", 0, context);
  const clicksValueIndex = valueIndexForNodeParam(node, "clicks", 0, context);
  addMidiControlBinding(node, "button", pressedValueIndex, context, {
    modeValueIndex,
    clicksValueIndex
  });
  context.stateBindings.push({
    id: `${node.id}:button`,
    state,
    count: 3,
    kind: "effect",
    nodeId: node.id
  });
  context.ops.push({
    opcode: DSP_OP.Button,
    out: output,
    a: pressedValueIndex,
    b: modeValueIndex,
    c: clicksValueIndex,
    state
  });
  if (!hasInput(node, "signal", context) && !hasInput(node, "inverse signal", context)) {
    context.buttonGateOutputByNodeId.set(node.id, output);
    return output;
  }
  const smoothedOutput = nextRegister(context);
  const smoothingState = nextState(context, 2);
  context.stateBindings.push({
    id: `${node.id}:button-gate-slew`,
    state: smoothingState,
    count: 2,
    kind: "effect",
    nodeId: node.id
  });
  context.ops.push({
    opcode: DSP_OP.Slew,
    out: smoothedOutput,
    a: output,
    state: smoothingState,
    value: BUTTON_GATE_FADE_SECONDS,
    value2: 1
  });
  context.buttonGateOutputByNodeId.set(node.id, smoothedOutput);
  return smoothedOutput;
}
function addMidiControlBinding(node, kind, valueIndex2, context, indexes = {}, ports = { channel: "midiChannel", cc: "midiCc" }) {
  const definition = getNodeDefinition(node);
  const channelDefault = definition.inputs.find((input) => input.name === ports.channel)?.defaultValue ?? 0;
  const ccDefault = definition.inputs.find((input) => input.name === ports.cc)?.defaultValue ?? 1;
  const channel = clampInteger2(node.params[ports.channel] ?? channelDefault, 0, 16);
  const cc = clampInteger2(node.params[ports.cc] ?? ccDefault, 0, 127);
  if (channel === 0) return;
  context.midiControlBindings.push({
    nodeId: node.id,
    kind,
    channel,
    cc,
    valueIndex: valueIndex2,
    ...indexes
  });
}
function compileTempo(node, port, context) {
  const outputKind = tempoOutputKind(port);
  if (outputKind < 0) {
    context.errors.push(`Tempo node "${node.id}" does not have supported output "${port}".`);
    return constantRegister(0, context);
  }
  const output = nextRegister(context);
  const sourceValueIndex = valueIndexForNodeParam(node, "source", 0, context);
  const midiSourceValueIndex = valueIndexForNodeParam(node, "midiSource", 0, context);
  if (!context.tempoBindings.some((binding) => binding.nodeId === node.id)) {
    context.tempoBindings.push({
      nodeId: node.id,
      bpmValueIndex: valueIndexForNodeParam(node, "bpm", 120, context),
      sourceValueIndex,
      midiSourceValueIndex
    });
  }
  if (Math.round(node.params.source ?? 0) === 1) {
    context.usesMidiClock = true;
  }
  context.ops.push({
    opcode: DSP_OP.Tempo,
    out: output,
    a: resolveInput(node, "bpm", 120, context),
    b: emitValue(sourceValueIndex, context),
    c: outputKind,
    d: emitValue(midiSourceValueIndex, context),
    e: resolveInput(node, "swing", 0, context),
    state: -1
  });
  return output;
}
var TEMPO_OUTPUT_LABELS = ["4 bar", "2 bar", "bar", "whole", "half", "quarter / beat", "upbeat", "eighth", "sixteenth", "thirty-second"];
function tempoOutputKind(port) {
  const clickIndex = TEMPO_OUTPUT_LABELS.indexOf(port);
  if (clickIndex >= 0) return clickIndex;
  const freqIndex = TEMPO_OUTPUT_LABELS.indexOf(port.replace(/ freq$/, ""));
  return freqIndex >= 0 && port.endsWith(" freq") ? freqIndex + TEMPO_OUTPUT_LABELS.length : -1;
}
function compileSamplePlayer(node, context) {
  const sampleIndex = context.sampleBindings.length;
  context.sampleBindings.push({
    nodeId: node.id,
    sample: {
      name: node.sample?.name ?? "",
      url: node.sample?.url ?? ""
    },
    release: Math.max(0, Number(node.params.release) || 0)
  });
  const state = nextState(context, 1);
  context.stateBindings.push({
    id: `${node.id}:sample`,
    state,
    count: 1,
    kind: "effect",
    nodeId: node.id
  });
  const originalFrequency = resolveSampleOriginalFrequency(node, context);
  const sampleParams = [
    [0, "mode", 0],
    [1, "start", 0],
    [2, "end", 1],
    [3, "attack", 0],
    [4, "release", 0],
    [5, "stretch", 1],
    [6, "cycleLength", 4096],
    [7, "overlapRatio", 0.09],
    [8, null, 440, originalFrequency]
  ];
  for (const [kind, port, fallback, register] of sampleParams) {
    const inputRegister = register ?? resolveInput(node, port ?? "", fallback, context);
    context.ops.push({
      opcode: DSP_OP.SampleParam,
      a: sampleIndex,
      b: kind,
      c: inputRegister
    });
    if ((port === "start" || port === "end" || port === "attack" || port === "release") && hasInput(node, port, context)) {
      const monitorId = `${node.id}:sample-${port}`;
      context.monitorIds[monitorId] = inputRegister;
      context.signedMeterIds.push(monitorId);
    }
  }
  const output = nextRegister(context);
  context.ops.push({
    opcode: DSP_OP.Sample,
    out: output,
    a: sampleIndex,
    b: resolveInput(node, "frequency", 220, context),
    c: resolveInput(node, "trigger", 0, context),
    d: resolveInput(node, "voices", 1, context),
    e: resolveInput(node, "level", 0.7, context),
    state,
    value2: node.sample?.name?.toLowerCase().endsWith(".mp4") || /\.mp4(?:$|[?#])/i.test(node.sample?.url ?? "") ? 1 : 0
  });
  return output;
}
function resolveSampleOriginalFrequency(node, context) {
  if (node.params.originalFrequency !== void 0 || node.inputs?.some((input) => input.name === "originalFrequency")) {
    return resolveInput(node, "originalFrequency", 440, context);
  }
  const originalPitch = node.params.originalPitch;
  if (originalPitch !== void 0) {
    return constantRegister(midiNoteFrequency3(originalPitch), context);
  }
  return constantRegister(440, context);
}
function midiNoteFrequency3(note) {
  return 440 * 2 ** ((note - 69) / 12);
}
function compileSelector(node, context) {
  const definition = getNodeDefinition(node);
  const valueInputs = definition.inputs.filter((input) => /^[1-9][0-9]*$/.test(input.name)).sort((left, right) => Number(left.name) - Number(right.name));
  if (valueInputs.length === 0) return constantRegister(0, context);
  const select = resolveInput(node, "select", 0, context, "immediate");
  const slide = resolveInput(node, "slide", 0, context);
  const output = nextRegister(context);
  const state = nextState(context, 4);
  const maxInputIndex = Math.max(...valueInputs.map((input) => Number(input.name)));
  context.stateBindings.push({
    id: `${node.id}:selector`,
    state,
    count: 4,
    kind: "selector",
    nodeId: node.id
  });
  valueInputs.forEach((input) => {
    context.ops.push({
      opcode: DSP_OP.Select,
      out: output,
      a: select,
      b: slide,
      c: resolveInput(node, input.name, input.defaultValue ?? 0, context),
      d: Number(input.name),
      e: maxInputIndex,
      state
    });
  });
  return output;
}
function compileSequencer(node, port, context) {
  if (port === SEQUENCER_INDEX_OUTPUT) {
    return compileSequencerIndex(node, context);
  }
  const rowIndex = sequencerOutputIndex(port);
  if (rowIndex === null) {
    context.errors.push(`Sequencer node "${node.id}" does not have supported output "${port}".`);
    return constantRegister(0, context);
  }
  return compileSequencerRow(node, rowIndex, context);
}
function compileRoll(node, port, context) {
  if (!["note", "frequency", "velocity", "gate", "trigger", "note on", "note off"].includes(port)) {
    context.errors.push(`Roll node "${node.id}" does not have supported output "${port}".`);
    return constantRegister(0, context);
  }
  const shape = rollShape(node.params);
  if (port === "note on" || port === "note off" || port === "frequency" || port === "velocity" || port === "trigger") {
    const event = port === "note off" ? "off" : "on";
    const value = port === "frequency" ? "frequency" : port === "velocity" ? "velocity" : "note";
    return compileRollNoteEvent(node, event, value, context);
  }
  const rowGates = Array.from({ length: shape.rows.length }, (_, row) => compileSequencerRow(node, row, context));
  const gate = emitFunction(EXPRESSION_FUNCTIONS.clamp.id, [
    rowGates.reduce((sum, rowGate) => emitBinary(DSP_OP.Add, sum, rowGate, context), constantRegister(0, context)),
    constantRegister(0, context),
    constantRegister(1, context)
  ], context);
  if (port === "gate") return gate;
  let note = constantRegister(0, context);
  for (let row = 0; row < shape.rows.length; row += 1) {
    const noteValue = constantRegister(shape.rows[row].note, context);
    note = emitBinary(DSP_OP.Add, emitBinary(DSP_OP.Mul, rowGates[row], noteValue, context), emitBinary(DSP_OP.Mul, emitBinary(DSP_OP.Sub, constantRegister(1, context), rowGates[row], context), note, context), context);
  }
  if (port === "note") return note;
  const exponent = emitBinary(DSP_OP.Div, emitBinary(DSP_OP.Sub, note, constantRegister(69, context), context), constantRegister(12, context), context);
  return emitBinary(DSP_OP.Mul, constantRegister(440, context), emitFunction(EXPRESSION_FUNCTIONS.pow.id, [constantRegister(2, context), exponent], context), context);
}
function compileRollNoteEvent(node, event, value, context) {
  const output = nextRegister(context);
  const stateCount = 5 + ROLL_MAX_ROWS * (event === "off" ? 3 : 2);
  const state = nextState(context, stateCount);
  context.stateBindings.push({
    id: `${node.id}:roll-note-${event}-${value}`,
    state,
    count: stateCount,
    kind: "effect",
    nodeId: node.id
  });
  context.ops.push({
    opcode: DSP_OP.RollNoteEvent,
    out: output,
    a: ensureSequencerStepRegister(node, context).state,
    state,
    value: ensureSequencerBinding(node, context),
    value2: event === "on" ? 0 : 1,
    value3: value === "note" ? 0 : value === "frequency" ? 1 : 2
  });
  return output;
}
function compileSequencerIndex(node, context) {
  const shape = sequencerShape(node.params);
  let index = constantRegister(0, context);
  let noEarlierTrigger = constantRegister(1, context);
  for (let rowIndex = 0; rowIndex < shape.rows; rowIndex += 1) {
    const trigger = compileSequencerRow(node, rowIndex, context);
    const selectedTrigger = emitBinary(DSP_OP.Mul, trigger, noEarlierTrigger, context);
    index = emitBinary(
      DSP_OP.Add,
      index,
      emitBinary(DSP_OP.Mul, selectedTrigger, constantRegister(rowIndex + 1, context), context),
      context
    );
    noEarlierTrigger = emitBinary(
      DSP_OP.Mul,
      noEarlierTrigger,
      emitBinary(DSP_OP.Sub, constantRegister(1, context), trigger, context),
      context
    );
  }
  return index;
}
function compileSequencerRow(node, rowIndex, context) {
  const state = ensureSequencerStepRegister(node, context).state;
  const output = nextRegister(context);
  context.ops.push({
    opcode: DSP_OP.Sequencer,
    out: output,
    a: resolveInput(node, "signal", 0, context),
    b: resolveInput(node, "steps", SEQUENCER_DEFAULT_STEPS, context),
    c: constantRegister(rowIndex, context),
    d: node.type === "Roll" ? constantRegister(rollShape(node.params).rows.length, context) : resolveInput(node, "rows", SEQUENCER_DEFAULT_ROWS, context),
    e: resolveInput(node, "reset", 0, context),
    state,
    value: ensureSequencerBinding(node, context)
  });
  return output;
}
function registerSequencerMonitor(node, context) {
  ensureSequencerStepRegister(node, context);
}
function ensureSequencerStepRegister(node, context) {
  let state = context.sequencerStateByNodeId.get(node.id);
  if (state === void 0) {
    state = nextState(context, 8);
    context.sequencerStateByNodeId.set(node.id, state);
    context.stateBindings.push({
      id: `${node.id}:sequencer`,
      state,
      count: 8,
      kind: "sequencer",
      nodeId: node.id
    });
  }
  let register = context.sequencerStepRegisterByNodeId.get(node.id);
  if (register === void 0) {
    register = nextRegister(context);
    context.sequencerStepRegisterByNodeId.set(node.id, register);
    context.monitorIds[node.id] = register;
    context.ops.push({
      opcode: DSP_OP.Sequencer,
      out: register,
      a: resolveInput(node, "signal", 0, context),
      b: resolveInput(node, "steps", SEQUENCER_DEFAULT_STEPS, context),
      c: constantRegister(-1, context),
      d: node.type === "Roll" ? constantRegister(rollShape(node.params).rows.length, context) : resolveInput(node, "rows", SEQUENCER_DEFAULT_ROWS, context),
      e: resolveInput(node, "reset", 0, context),
      state,
      value: ensureSequencerBinding(node, context)
    });
  }
  return { state, register };
}
function ensureSequencerBinding(node, context) {
  const existing = context.sequencerBindingIndexByNodeId.get(node.id);
  if (existing !== void 0) return existing;
  const roll = node.type === "Roll" ? rollShape(node.params) : null;
  const shape = roll ? { ...roll, rowCount: roll.rows.length } : { ...sequencerShape(node.params), rowCount: sequencerShape(node.params).rows };
  const gateMode = node.type === "Roll" || sequencerUsesGateMode(node.params);
  const events = Array.from({ length: shape.rowCount }, (_, rowIndex) => {
    const activeEvents = node.type === "Roll" ? rollGatesForRow(node.params, roll.rows[rowIndex].index, shape.steps).map((gate) => ({ ...gate })) : gateMode ? sequencerGatesForRow(node.params, rowIndex, shape.steps).map((gate) => ({ slot: gate.slot, start: gate.start, end: gate.end, velocity: gate.velocity })) : sequencerTriggersForRow(node.params, rowIndex, shape.steps).map((trigger) => ({
      slot: trigger.slot,
      start: trigger.position,
      end: trigger.position,
      velocity: trigger.velocity
    }));
    const eventsBySlot = new Map(activeEvents.map((event) => [event.slot, event]));
    return Array.from({ length: shape.steps }, (_2, slot) => {
      const event = eventsBySlot.get(slot);
      return {
        active: Boolean(event),
        start: event?.start ?? slot,
        end: event?.end ?? slot,
        velocity: event?.velocity ?? 1,
        note: roll?.rows[rowIndex].note ?? rowIndex
      };
    });
  });
  const bindingIndex = context.sequencerBindings.length;
  context.sequencerBindings.push({
    nodeId: node.id,
    mode: gateMode ? "gate" : "trigger",
    steps: shape.steps,
    rows: shape.rowCount,
    events
  });
  context.sequencerBindingIndexByNodeId.set(node.id, bindingIndex);
  return bindingIndex;
}
function compilePan(node, port, context) {
  if (port !== "left" && port !== "right") {
    context.errors.push(`Pan node "${node.id}" does not have supported output "${port}".`);
    return constantRegister(0, context);
  }
  const signal = resolveInput(node, "signal", 0, context);
  const pan = emitFunction(
    EXPRESSION_FUNCTIONS.clamp.id,
    [
      resolveInput(node, "pan", 0, context),
      constantRegister(-1, context),
      constantRegister(1, context)
    ],
    context
  );
  const panned = port === "left" ? emitBinary(DSP_OP.Sub, constantRegister(1, context), pan, context) : emitBinary(DSP_OP.Add, constantRegister(1, context), pan, context);
  const gain = emitFunction(
    EXPRESSION_FUNCTIONS.sqrt.id,
    [emitBinary(DSP_OP.Mul, panned, constantRegister(0.5, context), context)],
    context
  );
  return emitBinary(DSP_OP.Mul, signal, gain, context);
}
function midiNoteOutputKind(type, port) {
  if (type === "MidiNoteOn") {
    if (port === "frequency") return 6;
    if (port === "velocity") return 7;
    return 5;
  }
  if (type === "MidiNoteOff") {
    return port === "frequency" ? 9 : 8;
  }
  switch (port) {
    case "note":
      return 0;
    case "frequency":
      return 1;
    case "velocity":
      return 2;
    case "gate":
      return 3;
    case "trigger":
      return 4;
    default:
      return 0;
  }
}
function compileEffect(node, opcode, params, context) {
  const output = nextRegister(context);
  const state = nextState(context, 1);
  context.stateBindings.push({
    id: `${node.id}:effect`,
    state,
    count: 1,
    kind: "effect",
    nodeId: node.id
  });
  context.ops.push({
    opcode,
    out: output,
    a: resolveInput(node, "signal", 0, context),
    b: resolveInput(node, params[0]?.[0] ?? "unused", params[0]?.[1] ?? 0, context),
    c: resolveInput(node, params[1]?.[0] ?? "unused", params[1]?.[1] ?? 0, context),
    d: resolveInput(node, params[2]?.[0] ?? "unused", params[2]?.[1] ?? 0, context),
    state
  });
  return output;
}
function compileReverb(node, port, context) {
  if (port !== "left" && port !== "right") {
    context.errors.push(`Reverb node "${node.id}" does not have supported output "${port}".`);
    return constantRegister(0, context);
  }
  const cached = context.outputCache.get(inputKey(node.id, port));
  if (cached !== void 0) return cached;
  const left = nextRegister(context);
  const right = nextRegister(context);
  const state = nextState(context, 64);
  context.stateBindings.push({ id: `${node.id}:effect`, state, count: 64, kind: "effect", nodeId: node.id });
  context.ops.push({
    opcode: DSP_OP.Reverb,
    out: left,
    e: right,
    a: resolveInput(node, "signal", 0, context),
    b: resolveInput(node, "size", 0.55, context),
    c: resolveInput(node, "decay", 0.45, context),
    d: resolveInput(node, "mix", 0.25, context),
    // Zero retains the legacy single-output bytecode format.
    value2: valueRegisterForNodeParam(node, "mode", 0, context, "immediate") + 1,
    state
  });
  context.outputCache.set(inputKey(node.id, "left"), left);
  context.outputCache.set(inputKey(node.id, "right"), right);
  return port === "left" ? left : right;
}
function compileExpression(node, context) {
  const source = typeof node.expression === "string" && node.expression.trim() ? node.expression : "0";
  const parser = new ExpressionParser(tokenizeExpression(source), node, context);
  return parser.parse();
}
var ExpressionParser = class {
  constructor(tokens, node, context) {
    this.tokens = tokens;
    this.node = node;
    this.context = context;
  }
  tokens;
  node;
  context;
  index = 0;
  parse() {
    const register = this.parseLogicalOr();
    if (!this.isAtEnd()) {
      this.context.errors.push(`Expression node "${this.node.id}" has unsupported syntax near "${this.peekLabel()}".`);
      return constantRegister(0, this.context);
    }
    return register;
  }
  parseLogicalOr() {
    let left = this.parseLogicalAnd();
    while (this.matchOperator("||")) {
      left = this.emitLogicFunction(EXPRESSION_LOGIC_FUNCTIONS.or, left, this.parseLogicalAnd());
    }
    return left;
  }
  parseLogicalAnd() {
    let left = this.parseEquality();
    while (this.matchOperator("&&")) {
      left = this.emitLogicFunction(EXPRESSION_LOGIC_FUNCTIONS.and, left, this.parseEquality());
    }
    return left;
  }
  parseEquality() {
    let left = this.parseComparison();
    while (this.matchOperator("==") || this.matchOperator("!=")) {
      const operator = this.previous().value;
      const right = this.parseComparison();
      left = this.emitLogicFunction(
        operator === "==" ? EXPRESSION_LOGIC_FUNCTIONS.equal : EXPRESSION_LOGIC_FUNCTIONS.notEqual,
        left,
        right
      );
    }
    return left;
  }
  parseComparison() {
    let left = this.parseAdditive();
    while (this.matchOperator("<") || this.matchOperator("<=") || this.matchOperator(">") || this.matchOperator(">=")) {
      const operator = this.previous().value;
      const right = this.parseAdditive();
      const functionId = operator === "<" ? EXPRESSION_LOGIC_FUNCTIONS.less : operator === "<=" ? EXPRESSION_LOGIC_FUNCTIONS.lessEqual : operator === ">" ? EXPRESSION_LOGIC_FUNCTIONS.greater : EXPRESSION_LOGIC_FUNCTIONS.greaterEqual;
      left = this.emitLogicFunction(functionId, left, right);
    }
    return left;
  }
  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.matchOperator("+") || this.matchOperator("-")) {
      const operator = this.previous().value;
      const right = this.parseMultiplicative();
      left = emitBinary(operator === "+" ? DSP_OP.Add : DSP_OP.Sub, left, right, this.context);
    }
    return left;
  }
  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.matchOperator("*") || this.matchOperator("/")) {
      const operator = this.previous().value;
      const right = this.parseUnary();
      left = emitBinary(operator === "*" ? DSP_OP.Mul : DSP_OP.Div, left, right, this.context);
    }
    return left;
  }
  parseUnary() {
    if (this.matchOperator("!")) {
      return this.emitLogicFunction(EXPRESSION_LOGIC_FUNCTIONS.not, this.parseUnary());
    }
    if (this.matchOperator("-")) {
      const output = nextRegister(this.context);
      this.context.ops.push({ opcode: DSP_OP.Neg, out: output, a: this.parseUnary() });
      return output;
    }
    if (this.matchOperator("+")) {
      return this.parseUnary();
    }
    return this.parsePrimary();
  }
  parsePrimary() {
    if (this.match("number")) {
      const token = this.previous();
      return constantRegister(token.type === "number" ? token.value : 0, this.context);
    }
    if (this.match("identifier")) {
      const token = this.previous();
      const name = token.type === "identifier" ? token.value : "";
      if (this.matchOperator("(")) {
        return this.parseFunctionCall(name);
      }
      if (name === "true") return constantRegister(1, this.context);
      if (name === "false") return constantRegister(0, this.context);
      return resolveInput(this.node, name, 0, this.context);
    }
    if (this.matchOperator("(")) {
      const register = this.parseLogicalOr();
      if (!this.matchOperator(")")) {
        this.context.errors.push(`Expression node "${this.node.id}" is missing a closing parenthesis.`);
        return constantRegister(0, this.context);
      }
      return register;
    }
    this.context.errors.push(`Expression node "${this.node.id}" has unsupported syntax near "${this.peekLabel()}".`);
    this.advance();
    return constantRegister(0, this.context);
  }
  parseFunctionCall(name) {
    const args = [];
    if (!this.matchOperator(")")) {
      do {
        args.push(this.parseLogicalOr());
        if (this.matchOperator(")")) break;
        if (!this.matchOperator(",")) {
          this.context.errors.push(`Expression node "${this.node.id}" is missing a comma or closing parenthesis in "${name}(...)"`);
          return constantRegister(0, this.context);
        }
      } while (!this.isAtEnd());
    }
    const definition = EXPRESSION_FUNCTIONS[name.toLowerCase()];
    if (!definition) {
      this.context.errors.push(`Expression node "${this.node.id}" uses unsupported function "${name}".`);
      return constantRegister(0, this.context);
    }
    if (args.length < definition.minArgs || args.length > definition.maxArgs) {
      this.context.errors.push(`Expression function "${name}" expects ${arityLabel(definition.minArgs, definition.maxArgs)}.`);
      return constantRegister(0, this.context);
    }
    const paddedArgs = [...args];
    while (paddedArgs.length < 3) paddedArgs.push(constantRegister(0, this.context));
    const output = nextRegister(this.context);
    this.context.ops.push({
      opcode: DSP_OP.Function,
      out: output,
      a: definition.id,
      b: paddedArgs[0],
      c: paddedArgs[1],
      d: paddedArgs[2],
      value: args.length
    });
    return output;
  }
  emitLogicFunction(functionId, left, right) {
    const output = nextRegister(this.context);
    this.context.ops.push({
      opcode: DSP_OP.Function,
      out: output,
      a: functionId,
      b: left,
      c: right ?? constantRegister(0, this.context),
      d: constantRegister(0, this.context),
      value: right === void 0 ? 1 : 2
    });
    return output;
  }
  match(type) {
    if (this.isAtEnd() || this.peek().type !== type) return false;
    this.advance();
    return true;
  }
  matchOperator(value) {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    if (token.type !== "operator" || token.value !== value) return false;
    this.advance();
    return true;
  }
  advance() {
    if (!this.isAtEnd()) this.index += 1;
    return this.previous();
  }
  previous() {
    return this.tokens[Math.max(0, this.index - 1)] ?? { type: "number", value: 0 };
  }
  peek() {
    return this.tokens[this.index] ?? { type: "number", value: 0 };
  }
  peekLabel() {
    const token = this.tokens[this.index];
    return token ? String(token.value) : "end of expression";
  }
  isAtEnd() {
    return this.index >= this.tokens.length;
  }
};
function tokenizeExpression(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const compoundOperator = source.slice(index, index + 2);
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(compoundOperator)) {
      tokens.push({
        type: "operator",
        value: compoundOperator
      });
      index += 2;
      continue;
    }
    if (/[+\-*/(),<>!]/.test(char)) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      continue;
    }
    const numberMatch = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (numberMatch) {
      tokens.push({ type: "number", value: finiteNumber(Number(numberMatch[0]), 0) });
      index += numberMatch[0].length;
      continue;
    }
    const identifierMatch = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifierMatch) {
      tokens.push({ type: "identifier", value: identifierMatch[0] });
      index += identifierMatch[0].length;
      continue;
    }
    tokens.push({ type: "invalid", value: char });
    index += 1;
  }
  return tokens;
}
function arityLabel(minArgs, maxArgs) {
  if (minArgs === maxArgs) return `${minArgs} argument${minArgs === 1 ? "" : "s"}`;
  return `${minArgs}-${maxArgs} arguments`;
}
function sumRegisters(registers, context) {
  if (registers.length === 0) return constantRegister(0, context);
  if (registers.length === 1) return registers[0];
  let sum = registers[0];
  for (const register of registers.slice(1)) {
    sum = emitBinary(DSP_OP.Add, sum, register, context);
  }
  return sum;
}
function emitBinary(opcode, a, b, context) {
  const out = nextRegister(context);
  context.ops.push({ opcode, out, a, b });
  return out;
}
function emitUnary(opcode, a, context) {
  const out = nextRegister(context);
  context.ops.push({
    opcode,
    out,
    a,
    b: -1,
    c: -1,
    d: -1,
    e: -1,
    state: -1,
    value: 0,
    value2: 0,
    value3: 0,
    value4: 0
  });
  return out;
}
function emitFunction(functionId, args, context) {
  const paddedArgs = [...args];
  while (paddedArgs.length < 3) paddedArgs.push(constantRegister(0, context));
  const output = nextRegister(context);
  context.ops.push({
    opcode: DSP_OP.Function,
    out: output,
    a: functionId,
    b: paddedArgs[0],
    c: paddedArgs[1],
    d: paddedArgs[2],
    value: args.length
  });
  return output;
}
function valueRegisterForNodeParam(node, port, fallback, context, mode = "smoothed") {
  return emitValue(valueIndexForNodeParam(node, port, fallback, context), context, mode);
}
function valueIndexForNodeParam(node, port, fallback, context) {
  const definition = getNodeDefinition(node);
  const input = definition.inputs.find((candidate) => candidate.name === port);
  const value = finiteNumber(node.params[port], input?.defaultValue ?? fallback);
  return valueIndex(value, {
    id: `${node.id}.${port}`,
    kind: "node-param",
    nodeId: node.id,
    port
  }, context);
}
function valueRegisterForLinkWeight(link, context) {
  const id = linkId(link);
  return valueRegister(finiteNumber(link.weight, 1), {
    id: `${id}.weight`,
    kind: "link-weight",
    linkId: id
  }, context);
}
function constantRegister(value, context) {
  const normalized = finiteNumber(value, 0);
  const existingIndex = context.constantValueIndexes.get(normalized);
  if (existingIndex !== void 0) return emitValue(existingIndex, context);
  const valueIndex2 = context.values.length;
  context.constantValueIndexes.set(normalized, valueIndex2);
  context.values.push(normalized);
  context.valueBindings.push({
    id: `constant.${normalized}`,
    valueIndex: valueIndex2,
    kind: "constant"
  });
  return emitValue(valueIndex2, context);
}
function valueRegister(value, binding, context) {
  return emitValue(valueIndex(value, binding, context), context);
}
function valueIndex(value, binding, context) {
  const valueIndex2 = context.values.length;
  context.values.push(value);
  context.valueBindings.push({ ...binding, valueIndex: valueIndex2 });
  return valueIndex2;
}
function emitValue(valueIndex2, context, mode = "smoothed") {
  const isConstant = context.valueBindings[valueIndex2]?.kind === "constant";
  const cacheKey = `${valueIndex2}:${mode}`;
  if (isConstant && context.optimizationOptions.deduplicateLoads !== false) {
    const existing = context.constantRegisters.get(cacheKey);
    if (existing !== void 0) {
      context.deduplicatedLoads += 1;
      return existing;
    }
  }
  const out = nextRegister(context);
  context.ops.push({
    opcode: DSP_OP.Value,
    out,
    a: valueIndex2,
    value: mode === "immediate" ? 1 : 0
  });
  if (isConstant && context.optimizationOptions.deduplicateLoads !== false) context.constantRegisters.set(cacheKey, out);
  return out;
}
function packRegisterPair(left, right) {
  return left + right * MAX_DSP_REGISTERS;
}
function nextRegister(context) {
  const register = context.registerCount;
  context.registerCount += 1;
  return register;
}
function nextState(context, count) {
  const state = context.stateCount;
  context.stateCount += count;
  return state;
}
function dspOpUsesEffectBuffer(op) {
  return op.opcode === DSP_OP.Delay || op.opcode === DSP_OP.Chorus || op.opcode === DSP_OP.Reverb || op.opcode === DSP_OP.Limiter || op.opcode === DSP_OP.Filter && (op.a === 5 || op.a === 6);
}
function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function routingNumber(node) {
  return Math.max(1, Math.min(10, Math.round(finiteNumber(node.params.number, 1))));
}
function routingNodesShareRuntime(receive, send) {
  if ((receive.routingScope ?? "") !== (send.routingScope ?? "")) return false;
  if (!receive.runtimeSpread) return !send.runtimeSpread;
  if (!send.runtimeSpread) return true;
  return receive.runtimeSpread.spreadId === send.runtimeSpread.spreadId && receive.runtimeSpread.itemIndex === send.runtimeSpread.itemIndex;
}
function resolveSendSignal(node, context) {
  const cached = context.sendSignalByNodeId.get(node.id);
  if (cached !== void 0) return cached;
  const signal = resolveInput(node, "signal", 0, context);
  context.sendSignalByNodeId.set(node.id, signal);
  return signal;
}
function clampInteger2(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return min;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}
function inputKey(nodeId, port) {
  return `${nodeId}.${port}`;
}
function linkId(link) {
  return `${link.from.node}:${link.from.port}->${link.to.node}:${link.to.port}`;
}

// editor/src/hosted/compiler.ts
var COMPILER_VERSION = 1;
var NATIVE_PROFILE = "native-scalar-v1";
function preparePatch(input, options = {}) {
  const read = readDocument(input);
  if (!read.patch || read.diagnostics.some((d) => d.severity === "error")) return { diagnostics: read.diagnostics };
  const document = withParameterIds(read.patch);
  let program;
  try {
    program = compilePatchToDspProgram(document);
  } catch (error) {
    return { diagnostics: [...read.diagnostics, { severity: "error", code: "compile", message: String(error) }] };
  }
  const diagnostics = [...read.diagnostics, ...read.diagnostics.filter((d) => d.code === "discarded-content").map((d) => ({ ...d, severity: "error", code: "lossy-import", message: `Execution blocked pending import review: ${d.message}` })), ...program.errors.map((message) => ({ severity: "error", code: "compile", message }))];
  const layout = dspProgramStructureKey(program);
  const parameters = parameterMetadata(document, program, layout);
  for (const p of parameters) if (![p.defaultValue, p.min, p.max].every(Number.isFinite) || p.min > p.max || p.step !== void 0 && (!Number.isFinite(p.step) || p.step <= 0)) diagnostics.push({ severity: "error", code: "invalid-parameter-range", nodeId: p.nodeId, port: p.name, message: `Invalid bounds or step for parameter ${p.name}.` });
  const ids = parameters.map((p) => p.id);
  if (new Set(ids).size !== ids.length) diagnostics.push({ severity: "error", code: "duplicate-parameter", message: "Exposed parameter IDs must be unique." });
  const profile = options.profile ?? "web";
  if (profile === NATIVE_PROFILE) {
    if (program.fftBindings.length && !engineCapabilities_default.nativeAnalysis) diagnostics.push({ severity: "error", code: "native-analysis-unavailable", message: "FFT analysis currently runs in the browser worklet. Its shared Rust integration is pending; this native program cannot execute FFT outputs yet." });
    if (program.ops.length > 4096 || program.registerCount > 4096 || program.stateCount > 4096 || program.values.length > 2048) diagnostics.push({ severity: "error", code: "resource-limit", message: "Program exceeds native kernel capacity." });
  }
  return {
    version: 1,
    document,
    program,
    layout,
    parameters,
    profile,
    diagnostics,
    requirements: { samples: program.sampleBindings, images: program.imageBindings, buffers: bufferReferences(document), engineApiVersion: requiredEngineApi(program), audioChannels: 2, hostTimeline: profile === NATIVE_PROFILE && program.tempoBindings.length > 0, midiKinds: profile === NATIVE_PROFILE ? ["note on", "note off", "control change", "pitch bend"] : [] },
    resources: { operations: program.ops.length, registers: program.registerCount, state: program.stateCount, values: program.values.length, maxBlockFrames: 2048, eventLimit: 256, midiOutputLimit: 4096, heldNoteLimit: 2048 }
  };
}
function parameterMetadata(patch, program, layout) {
  return expandGroups(patch).nodes.filter((n) => n.type === "Params").flatMap((node) => (node.outputs ?? []).flatMap((port) => {
    const binding = program.valueBindings.find((b) => b.kind === "node-param" && b.nodeId === node.id && b.port === port.name);
    return binding ? [{
      id: port.parameterId ?? `${node.id}.${port.name}`,
      legacyId: `${node.id}.${port.name}`,
      name: port.name,
      nodeId: node.id,
      defaultValue: node.params[port.name] ?? port.defaultValue ?? 0,
      min: port.min ?? 0,
      max: port.max ?? 1,
      ...port.step !== void 0 ? { step: port.step } : {},
      ...port.integer !== void 0 ? { integer: port.integer } : {},
      binding: { valueIndex: binding.valueIndex, layout }
    }] : [];
  }));
}
function classifyEdit(previous, next) {
  if (next.diagnostics.some((d) => d.severity === "error")) return { kind: "prepare", reason: "Compilation failed." };
  if (JSON.stringify(previous.requirements.buffers) !== JSON.stringify(next.requirements.buffers)) return { kind: "prepare", reason: "Buffer snapshots changed." };
  if (previous.layout !== next.layout) return { kind: "prepare", reason: "Executable layout or resources changed." };
  const updates = next.program.values.flatMap((value, valueIndex2) => previous.program.values[valueIndex2] === value ? [] : [{ valueIndex: valueIndex2, value }]);
  const wavesChanged = dspCustomWavePointsKey(previous.program) !== dspCustomWavePointsKey(next.program);
  const sequencersChanged = dspSequencerConfigKey(previous.program) !== dspSequencerConfigKey(next.program);
  if (wavesChanged || sequencersChanged) return { kind: "specialized", layout: previous.layout, updates, ...wavesChanged ? { customWaves: next.program.customWaveBindings } : {}, ...sequencersChanged ? { sequencers: next.program.sequencerBindings } : {} };
  return updates.length ? { kind: "values", layout: previous.layout, updates } : { kind: "editor-only" };
}
function gestureUpdates(prepared, nodeId, values) {
  const node = expandGroups(prepared.document).nodes.find((n) => n.id === nodeId);
  const ports = node?.type === "Button" ? ["pressed", "clicks"] : node?.type === "Keys" ? ["note", "frequency", "gate", "velocity"] : [];
  const entries = Object.entries(values);
  if (!entries.length || entries.length > 4 || entries.some(([port, value]) => !ports.includes(port) || !Number.isFinite(value) || value < 0 || ["pressed", "gate", "velocity"].includes(port) && value > 1 || port === "note" && value > 127 || port === "frequency" && value > 24e3 || port === "clicks" && !Number.isSafeInteger(value))) throw new Error("Invalid transient node/control identity or value.");
  return { layout: prepared.layout, updates: entries.flatMap(([port, value]) => {
    const binding = prepared.program.valueBindings.find((b) => b.kind === "node-param" && b.nodeId === nodeId && b.port === port);
    return binding ? [{ valueIndex: binding.valueIndex, value }] : [];
  }) };
}

// editor/src/audio/bufferStorage.ts
var DATABASE_NAME = "teia.buffers.v1";
var STORE_NAME = "contents";
var DATABASE_VERSION = 1;
var databasePromise = null;
async function storeBufferSnapshot(snapshot2) {
  const data = copyFloat32Bytes(snapshot2.samples);
  const hash = await sha256Hex(data);
  const database = await openBufferDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ hash, data });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save Buffer content."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Buffer save was aborted."));
  });
  return { hash, sampleRate: snapshot2.sampleRate, sampleCount: snapshot2.samples.length };
}
function copyFloat32Bytes(samples) {
  const copy = new Uint8Array(samples.byteLength);
  copy.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
  return copy.buffer;
}
async function loadBufferSnapshot(asset) {
  const database = await openBufferDatabase();
  const stored = await new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(asset.hash);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not read Buffer content."));
  });
  if (!stored?.data || stored.data.byteLength !== asset.sampleCount * Float32Array.BYTES_PER_ELEMENT) return null;
  return { samples: new Float32Array(stored.data), sampleRate: asset.sampleRate };
}
async function storeBufferAssetData(asset, data) {
  if (data.byteLength !== asset.sampleCount * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`Buffer ${asset.hash} has an unexpected size.`);
  }
  if (await sha256Hex(data) !== asset.hash) {
    throw new Error(`Buffer ${asset.hash} failed its integrity check.`);
  }
  const database = await openBufferDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ hash: asset.hash, data });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not cache Buffer content."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Buffer cache was aborted."));
  });
}
async function removeUnreferencedBufferContents(referencedHashes) {
  const keep = new Set(referencedHashes);
  const database = await openBufferDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (typeof cursor.key === "string" && !keep.has(cursor.key)) store.delete(cursor.key);
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not clean Buffer storage."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Buffer cleanup was aborted."));
  });
}
async function sha256Hex(data) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function openBufferDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "hash" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("Could not open Buffer storage."));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("Buffer storage upgrade is blocked by another tab."));
    };
  });
  return databasePromise;
}

// editor/src/audio/patchPackage.ts
var encoder = new TextEncoder();
var MAX_ZIP_SIZE = 4294967295;
async function createPatchPackage(patch, sourceProgram, adapters) {
  if (!sourceProgram) {
    const prepared = preparePatch(patch);
    if (!("program" in prepared) || prepared.diagnostics.some((d) => d.severity === "error")) throw new Error(prepared.diagnostics.map((d) => d.message).join("; "));
    sourceProgram = prepared.program;
  }
  if (sourceProgram.errors.length) throw new Error(`Cannot export a patch with DSP errors: ${sourceProgram.errors.join("; ")}`);
  const portablePatch = structuredClone(patch);
  const program = structuredClone(sourceProgram);
  program.engineApiVersion = requiredEngineApi(program);
  const files = [];
  const assets = [];
  const mediaPaths = /* @__PURE__ */ new Map();
  const addAsset = async (path, bytes, source) => {
    files.push({ path, bytes });
    assets.push({ path, sha256: await sha256(bytes), bytes: bytes.byteLength, source });
  };
  const packageMedia = async (url, kind) => {
    if (!url.trim()) return url;
    const existing = mediaPaths.get(url);
    if (existing) return existing;
    const bytes = adapters ? await adapters.readMedia(url) : await (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not export asset ${url} (${response.status}).`);
      return new Uint8Array(await response.arrayBuffer());
    })();
    const hash = await sha256(bytes);
    const extension = safeExtension(new URL(url, "https://teia.invalid/").pathname);
    const path = `assets/${kind}/${hash}${extension}`;
    if (!files.some((file) => file.path === path)) await addAsset(path, bytes, url);
    mediaPaths.set(url, path);
    return path;
  };
  const visit = async (nodes) => {
    for (const node of nodes) {
      if (node.sample) {
        node.sample.url = await packageMedia(node.sample.url, "samples");
        if (node.sample.originalUrl) node.sample.originalUrl = await packageMedia(node.sample.originalUrl, "samples");
      }
      if (node.image) node.image.url = await packageMedia(node.image.url, "images");
      if (node.subpatch) await visit(node.subpatch.nodes);
    }
  };
  await visit(portablePatch.nodes);
  for (const binding of program.sampleBindings) binding.sample.url = mediaPaths.get(binding.sample.url) ?? binding.sample.url;
  for (const binding of program.imageBindings) binding.image.url = mediaPaths.get(binding.image.url) ?? binding.image.url;
  for (const asset of Object.values(bufferReferences(portablePatch))) {
    const path = `assets/buffers/${asset.hash}.f32`;
    if (files.some((file) => file.path === path)) continue;
    const snapshot2 = await (adapters ? adapters.readBuffer(asset) : loadBufferSnapshot(asset));
    if (!snapshot2) throw new Error(`Preserved Buffer ${asset.hash} is missing from the supplied asset source.`);
    const bytes = new Uint8Array(snapshot2.samples.byteLength);
    bytes.set(new Uint8Array(snapshot2.samples.buffer, snapshot2.samples.byteOffset, snapshot2.samples.byteLength));
    if (await sha256(bytes) !== asset.hash) throw new Error(`Preserved Buffer ${asset.hash} failed its integrity check.`);
    await addAsset(path, bytes, asset.hash);
  }
  const parameters = portablePatch.nodes.filter((node) => node.type === "Params").flatMap((node) => (node.outputs ?? []).map((port) => {
    const binding = program.valueBindings.find((value) => value.kind === "node-param" && value.nodeId === node.id && value.port === port.name);
    if (!binding) throw new Error(`Parameter ${node.id}.${port.name} has no compiled value binding.`);
    return {
      id: `${node.id}.${port.name}`,
      ...port.parameterId ? { persistentId: port.parameterId } : {},
      name: port.name,
      nodeId: node.id,
      valueIndex: binding.valueIndex,
      defaultValue: node.params[port.name] ?? port.defaultValue ?? 0,
      min: port.min ?? 0,
      max: port.max ?? 1,
      ...port.step !== void 0 ? { step: port.step } : {},
      ...port.integer !== void 0 ? { integer: port.integer } : {}
    };
  }));
  const manifest = {
    format: "teia-patch",
    version: 2,
    programVersion: program.version,
    engineApiVersion: requiredEngineApi(program),
    parameterIdentityVersion: 1,
    // additive metadata; v2 id lookup stays legacy-compatible
    runtimePackage: "@pauloricca/teia-runtime",
    paths: { patch: "patch.json", program: "program.json" },
    parameters,
    assets
  };
  files.unshift(
    { path: "manifest.json", bytes: encoder.encode(JSON.stringify(manifest, null, 2) + "\n") },
    { path: "patch.json", bytes: encoder.encode(patchToJson(portablePatch)) },
    { path: "program.json", bytes: encoder.encode(JSON.stringify(program) + "\n") }
  );
  return zipStore(files);
}
function safeExtension(pathname) {
  const extension = pathname.match(/\.[a-z0-9]{1,8}$/i)?.[0].toLowerCase();
  return extension ?? "";
}
async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function zipStore(files) {
  const chunks = [];
  const directory = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const length = file.bytes.byteLength;
    if (length > MAX_ZIP_SIZE || offset + length + name.length + 30 > MAX_ZIP_SIZE) {
      throw new Error("Package exceeds the ZIP size limit (4 GiB).");
    }
    const checksum = crc32(file.bytes);
    const header = new Uint8Array(30 + name.length);
    const view2 = new DataView(header.buffer);
    view2.setUint32(0, 67324752, true);
    view2.setUint16(4, 20, true);
    view2.setUint16(6, 2048, true);
    view2.setUint32(14, checksum, true);
    view2.setUint32(18, length, true);
    view2.setUint32(22, length, true);
    view2.setUint16(26, name.length, true);
    header.set(name, 30);
    chunks.push(header, file.bytes);
    const entry = new Uint8Array(46 + name.length);
    const central = new DataView(entry.buffer);
    central.setUint32(0, 33639248, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 2048, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, length, true);
    central.setUint32(24, length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    entry.set(name, 46);
    directory.push(entry);
    offset += header.length + length;
  }
  const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
  if (files.length > 65535 || offset + directorySize > MAX_ZIP_SIZE) throw new Error("Package exceeds the ZIP size limit.");
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 101010256, true);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end], { type: "application/zip" });
}
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) crc = crc >>> 8 ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ -1) >>> 0;
}
var CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 3988292384 : 0);
  return value >>> 0;
});

export {
  define_import_meta_env_default,
  CUSTOM_WAVE_MODES,
  normalizeCustomWave,
  customWaveBank,
  customWaveUsesSustainStart,
  customWaveUsesSustainEnd,
  customWaveWithBaseLevel,
  normalizedCustomWaveValue,
  QUANTISE_SCALES,
  PITCH_CLASSES,
  normalisePitchClass,
  midiNoteLabel,
  SEQUENCER_INDEX_OUTPUT,
  NODE_TYPE_LIST,
  getDefinition,
  getNodeDefinition,
  sequencerShape,
  rollShape,
  rollCellParamName,
  rollGateParamName,
  rollGateVelocityParamName,
  rollGatesForRow,
  sequencerOutputName,
  sequencerCellParamName,
  SEQUENCER_GATE_MODE_PARAM,
  SEQUENCER_GATE_INITIALIZED_PARAM,
  SEQUENCER_MIN_VELOCITY,
  trimOverlappingSequencerGates,
  sequencerUsesGateMode,
  sequencerGateParamName,
  sequencerTriggerPositionParamName,
  sequencerStepVelocityParamName,
  sequencerTriggersForRow,
  sequencerGatesForRow,
  getNodeTypeLabel,
  defaultParamsFor,
  normalizePatchCompatibility,
  parsePatchJson,
  isImageAsset,
  isRecord,
  normalizeSelectedMidiDeviceIds,
  expressionInputDefinitions,
  syncParamsToInputs,
  patchToJson,
  DOCUMENT_VERSION,
  readDocument,
  withParameterIds,
  bufferReferences,
  cloneParameterIds,
  retainNestedBufferReferences,
  engineCapabilities_default,
  DSP_OP,
  dspProgramStructureKey,
  dspCustomWavePointsKey,
  dspSequencerConfigKey,
  DEFAULT_SPREAD_SIZE,
  DEFAULT_SPAWN_SIZE,
  MIN_RUNTIME_CONTAINER_WIDTH,
  MIN_SPAWN_WIDTH,
  SPREAD_HEADER_HEIGHT,
  SPREAD_PORTS_HEIGHT,
  SPAWN_PORTS_HEIGHT,
  runtimeContainerSize,
  runtimeContainerPortsHeight,
  spreadCloneNodeId,
  compilePatchToDspProgram,
  COMPILER_VERSION,
  NATIVE_PROFILE,
  preparePatch,
  parameterMetadata,
  classifyEdit,
  gestureUpdates,
  storeBufferSnapshot,
  loadBufferSnapshot,
  storeBufferAssetData,
  removeUnreferencedBufferContents,
  createPatchPackage
};
