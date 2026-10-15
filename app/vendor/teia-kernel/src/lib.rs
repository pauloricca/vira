#![cfg_attr(
    all(feature = "parallel", target_arch = "wasm32"),
    feature(thread_local)
)]

use std::collections::VecDeque;
mod reverb;
const ENGINE_CAPABILITIES_JSON: &str = include_str!("runtime-capabilities.json");
#[no_mangle]
pub extern "C" fn engineCapabilitiesPtr() -> *const u8 {
    ENGINE_CAPABILITIES_JSON.as_ptr()
}
#[no_mangle]
pub extern "C" fn engineCapabilitiesLength() -> u32 {
    ENGINE_CAPABILITIES_JSON.len() as u32
}
include!("state_fields.rs");

// Browser exports retain their existing default globals. Native callers select
// an owned instance through a thread-local pointer; no mutex or shared DSP state.
#[cfg(target_arch = "wasm32")]
macro_rules! kernel_global {
    ($name:ident) => {
        $name
    };
}
#[cfg(not(target_arch = "wasm32"))]
macro_rules! kernel_global {
    ($name:ident) => {
        (*$crate::native_state::current()).$name
    };
}
#[cfg(target_arch = "wasm32")]
macro_rules! kernel_address {
    (mut $name:ident) => {
        core::ptr::addr_of_mut!($name)
    };
    ($name:ident) => {
        core::ptr::addr_of!($name)
    };
}
#[cfg(not(target_arch = "wasm32"))]
macro_rules! kernel_address {
    (mut $name:ident) => {
        unsafe { core::ptr::addr_of_mut!(kernel_global!($name)) }
    };
    ($name:ident) => {
        unsafe { core::ptr::addr_of!(kernel_global!($name)) }
    };
}
#[cfg(all(not(target_arch = "wasm32"), not(feature = "parallel")))]
pub mod hosted;
#[cfg(not(target_arch = "wasm32"))]
mod native_state;

#[cfg(feature = "parallel")]
mod parallel;

const MAX_WASM_FRAMES: usize = 2048;
const MAX_NODES: usize = 512;
const MAX_LINKS: usize = 1024;
const MAX_VOICE_SLOTS: usize = 17;
const DRONE_VOICE_SLOT: usize = MAX_VOICE_SLOTS - 1;
const MAX_DSP_SAMPLE_PLAYER_VOICES: usize = 16;
const DSP_SAMPLE_VOICE_SLOT_START: usize = MAX_VOICE_SLOTS;
const MAX_SAMPLE_VOICE_SLOTS: usize = MAX_VOICE_SLOTS + MAX_DSP_SAMPLE_PLAYER_VOICES;
const MAX_DELAY_SLOTS: usize = 96;
const MAX_COMB_SLOTS: usize = 96;
const MAX_DELAY_SAMPLES: usize = 8192;
const MAX_FORMANT_BANDS: usize = 3;
const MAX_CUSTOM_WAVE_POINTS: usize = 64;
const MAX_SAMPLE_SLOTS: usize = 16;
// Samples are decoded to mono f32 data before entering the kernel. 128 MiB per
// sample is long enough for normal full-song playback while keeping a corrupt
// or unexpectedly large decode from exhausting the AudioWorklet's WASM heap.
const MAX_SAMPLE_FRAMES: usize = 32 * 1024 * 1024;
const MAX_TOTAL_SAMPLE_FRAMES: usize = 128 * 1024 * 1024;
const MAX_DSP_OPS: usize = 4096;
const MAX_DSP_REGS: usize = 4096;
const MAX_DSP_VALUES: usize = 2048;
const MAX_DSP_STATE: usize = 4096;
const DSP_DERIVED_CACHE_VALUES_PER_STATE: usize = 4;
const DSP_DERIVED_CACHE_ATTACK: usize = 0;
const DSP_DERIVED_CACHE_RELEASE: usize = 1;
const DSP_DERIVED_CACHE_INPUT_GAIN: usize = 2;
const DSP_DERIVED_CACHE_CEILING: usize = 3;
const DSP_BIQUAD_CACHE_KIND_FORMANT_BASE: i32 = 100;
const DSP_BIQUAD_CACHE_KIND_EQUALIZER_BASE: i32 = 200;
const MAX_DSP_SPREADS: usize = 128;
const MAX_DSP_SCOPES: usize = 32;
const MAX_DSP_METERS: usize = 128;
const MAX_DSP_EFFECT_SLOTS: usize = 64;
const MAX_DSP_DELAY_SAMPLES: usize = 65_536;
const MAX_DSP_BUFFER_SLOTS: usize = 16;
const MAX_DSP_BUFFER_SAMPLES: usize = 960_000;
const MAX_DSP_SAMPLE_NODES: usize = 128;
const MAX_IMAGE_SLOTS: usize = 4;
const MAX_IMAGE_DIMENSION: usize = 1024;
const MAX_IMAGE_BYTES: usize = MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION * 4;
// Two 512-point windows leave room to align the displayed trace to a zero crossing.
const LINK_SCOPE_POINTS: usize = 1024;
const LINK_SCOPE_SECONDS_MAX: f64 = 30.0;
const FORMANT_INTENSITY_MAX: f64 = 36.0;
const DEFAULT_TEMPO: f64 = 120.0;
const CUSTOM_ONESHOT_EDGE_FADE_SECONDS: f64 = 0.002;
const SAMPLE_EDGE_FADE_SECONDS: f64 = 0.002;
const VOICE_START_FADE_SECONDS: f64 = 0.006;
const VOICE_STEAL_FADE_SECONDS: f64 = 0.03;
const PHASE_RESET_FADE_SECONDS: f64 = 0.008;
const DSP_VALUE_SMOOTH_SECONDS: f64 = 0.012;
const DSP_VALUE_SETTLE_EPSILON: f64 = 0.0000001;
const DSP_VALUE_MODE_IMMEDIATE: f64 = 1.0;
const CUSTOM_MODE_LOOP: i32 = 0;
const CUSTOM_MODE_ONCE: i32 = 1;
const CUSTOM_MODE_PING_PONG: i32 = 2;
const CUSTOM_MODE_SUSTAIN: i32 = 3;
const CUSTOM_MODE_SUSTAIN_LOOP: i32 = 4;
const CUSTOM_MODE_SUSTAIN_PING_PONG: i32 = 5;
const SAMPLE_MODE_ONE_SHOT: i32 = 0;
const SAMPLE_MODE_LOOP: i32 = 1;
const SAMPLE_MODE_PING_PONG: i32 = 2;
const AUDIO_TARGET: i32 = -1;
const LINK_TARGET_BASE: i32 = -2;
const TWO_PI: f64 = core::f64::consts::PI * 2.0;
const ENVELOPE_TRIGGER_THRESHOLD: f64 = 0.5;
const ENVELOPE_TRIGGER_REARM: f64 = 0.45;
const TARGET_FREQUENCY: i32 = 1;
const TARGET_RING: i32 = 2;
const TARGET_FOLD: i32 = 3;
const TARGET_MIX: i32 = 4;
const TARGET_WAVE: i32 = 5;
const TARGET_PHASE_RESET_TRIGGER: i32 = 6;
const TARGET_AMPLITUDE: i32 = 10;
const TARGET_PAN: i32 = 11;
const TARGET_NOISE: i32 = 12;
const TARGET_DELAY: i32 = 13;
const TARGET_ENVELOPE_TRIGGER: i32 = 14;
const TARGET_ENVELOPE_DELAY: i32 = 15;
const TARGET_ENVELOPE_ATTACK: i32 = 16;
const TARGET_ENVELOPE_DECAY: i32 = 17;
const TARGET_ENVELOPE_SUSTAIN: i32 = 18;
const TARGET_ENVELOPE_RELEASE: i32 = 19;
const TARGET_FILTER_CUTOFF: i32 = 20;
const TARGET_FILTER_RESONANCE: i32 = 21;
const TARGET_DISTORTION_GAIN: i32 = 22;
const TARGET_SAMPLE_TRIGGER: i32 = 23;
const TARGET_SAMPLE_START: i32 = 24;
const TARGET_SAMPLE_END: i32 = 25;
const TARGET_SAMPLE_STRETCH: i32 = 26;
const TARGET_MAP_SRC_MIN: i32 = 27;
const TARGET_MAP_SRC_MAX: i32 = 28;
const TARGET_MAP_TARGET_MIN: i32 = 29;
const TARGET_MAP_TARGET_MAX: i32 = 30;
const PARAM_MODE_SET: i32 = 0;
const PARAM_MODE_ADD: i32 = 1;
const PARAM_MODE_MULTIPLY: i32 = 2;
const PARAM_MODE_BEND: i32 = 3;
const LINK_AMOUNT_LIMIT: f64 = 12_000.0;
const DSP_OP_VALUE: i32 = 0;
const DSP_OP_ADD: i32 = 1;
const DSP_OP_MUL: i32 = 2;
const DSP_OP_OSC: i32 = 3;
const DSP_OP_FILTER: i32 = 4;
const DSP_OP_OUTPUT: i32 = 5;
const DSP_OP_ABS: i32 = 6;
const DSP_OP_MAP: i32 = 7;
const DSP_OP_FEEDBACK_READ: i32 = 8;
const DSP_OP_FEEDBACK_WRITE: i32 = 9;
const DSP_OP_SELECT: i32 = 10;
const DSP_OP_INPUT: i32 = 11;
const DSP_OP_DELAY: i32 = 12;
const DSP_OP_CHORUS: i32 = 13;
const DSP_OP_REVERB: i32 = 14;
const DSP_OP_FOLD: i32 = 15;
const DSP_OP_SUB: i32 = 16;
const DSP_OP_DIV: i32 = 17;
const DSP_OP_NEG: i32 = 18;
const DSP_OP_ENVELOPE: i32 = 19;
const DSP_OP_FOLLOWER: i32 = 20;
const DSP_OP_HARD_CLIP: i32 = 21;
const DSP_OP_SOFT_CLIP: i32 = 22;
const DSP_OP_DISTORTION: i32 = 23;
const DSP_OP_SAMPLE: i32 = 24;
const DSP_OP_SAMPLE_PARAM: i32 = 25;
const DSP_OP_FUNCTION: i32 = 26;
const DSP_OP_MIDI_NOTE: i32 = 27;
const DSP_OP_MIDI_CC: i32 = 28;
const DSP_OP_ACCUMULATOR: i32 = 29;
const DSP_OP_BUTTON: i32 = 30;
const DSP_OP_SLEW: i32 = 31;
const DSP_OP_TEMPO: i32 = 32;
const DSP_OP_PLAYHEAD: i32 = 33;
const DSP_OP_BUFFER: i32 = 34;
const DSP_OP_SEQUENCER: i32 = 35;
const DSP_OP_IMAGE: i32 = 36;
const DSP_OP_TIME: i32 = 37;
const DSP_OP_COMPRESS: i32 = 38;
const DSP_OP_LIMITER: i32 = 39;
const DSP_OP_QUANTISE: i32 = 40;
const DSP_OP_BLOCK_LATCH: i32 = 41;
const DSP_OP_SPREAD_BEGIN: i32 = 42;
const DSP_OP_SPREAD_INDEX: i32 = 43;
const DSP_OP_SPREAD_COLLECT: i32 = 44;
const DSP_OP_SPREAD_END: i32 = 45;
const DSP_OP_SPAWN_BEGIN: i32 = 46;
const DSP_OP_SPAWN_END: i32 = 47;
const DSP_OP_END_TRIGGER: i32 = 48;
const DSP_OP_RANDOM: i32 = 49;
const DSP_OP_SPAWN_INSTANCE_GATE: i32 = 50;
const DSP_OP_DC_BLOCK: i32 = 51;
const DSP_OP_ROLL_NOTE_EVENT: i32 = 52;
const DSP_OP_MIDI_NOTE_SEND: i32 = 53;
const DSP_OP_MIDI_CC_SEND: i32 = 54;
const DSP_OP_BEND: i32 = 55;
// Internal upload-time specialization; exported programs still use the original opcodes.
const DSP_OP_CACHED_CONTROL: i32 = 56;
// Scratch is bounded independently of the callback frame count. Larger calls
// are rendered as successive chunks, including a partial final chunk.
const DSP_BLOCK_FRAMES: usize = 256;
const MAX_DSP_BLOCK_SLOTS: usize = 128;
const MAX_DSP_BLOCK_VALUE_STREAMS: usize = 128;
const MIN_ENVELOPE_ATTACK_SECONDS: f64 = 0.001;
const MAX_DSP_TEMPO_SOURCES: usize = 129;
const TEMPO_OUTPUT_COUNT: i32 = 10;
const DSP_TEMPO_INTERNAL_SOURCE: usize = 0;
const DSP_RENDER_FRAME_UNSET: u32 = u32::MAX;
const SEQUENCER_MIN_STEPS: i32 = 1;
const SEQUENCER_MAX_STEPS: i32 = 128;
const SEQUENCER_MIN_ROWS: i32 = 1;
const SEQUENCER_MAX_ROWS: i32 = 128;
const MAX_SAMPLE_TRIGGER_EVENTS: usize = 512;
const SAMPLE_TRIGGER_EVENT_FIELDS: usize = 8;

#[derive(Copy, Clone)]
struct Node {
    wave: i32,
    frequency_mode: i32,
    ratio: f64,
    frequency: f64,
    sync_beats: f64,
    quantise_enabled: i32,
    quantise_root: i32,
    quantise_scale: i32,
    quantise_glide: f64,
    speed: f64,
    audio_input_gain: f64,
    custom_mode: i32,
    custom_sustain_start: f64,
    custom_sustain_end: f64,
    sample_mode: i32,
    sample_start: f64,
    sample_end: f64,
    sample_attack: f64,
    sample_release: f64,
    sample_stretch: f64,
    sample_cycle_length: f64,
    sample_overlap_ratio: f64,
    sample_original_frequency: f64,
}

#[derive(Copy, Clone)]
struct Link {
    from: i32,
    to: i32,
    amount: f64,
    delay: f64,
    noise: f64,
    pan: f64,
    target: i32,
    parameter_mode: i32,
    velocity_sensitivity: f64,
    drone: i32,
    signal_mode: i32,
    follower_attack: f64,
    follower_release: f64,
    map_src_min: f64,
    map_src_max: f64,
    map_target_min: f64,
    map_target_max: f64,
    filter_type: i32,
    filter_cutoff: f64,
    filter_resonance: f64,
    distortion_type: i32,
    distortion_gain: f64,
    env_delay: f64,
    env_attack: f64,
    env_decay: f64,
    env_sustain: f64,
    env_release: f64,
}

#[derive(Copy, Clone)]
struct DspOp {
    opcode: i32,
    out: i32,
    a: i32,
    b: i32,
    c: i32,
    d: i32,
    e: i32,
    state: i32,
    value: f64,
    value2: f64,
    value3: f64,
    value4: f64,
}

struct DspBlockPlan {
    slots: Vec<usize>,
    value_stream_for_op: Vec<usize>,
    value_stream_sources: Vec<(i32, bool)>,
    buffers: Vec<f64>,
    value_streams: Vec<f64>,
    left: [f64; DSP_BLOCK_FRAMES],
    right: [f64; DSP_BLOCK_FRAMES],
    slot_count: usize,
    value_stream_count: usize,
    stages: Vec<DspBlockStage>,
    mixed: bool,
}

struct DspBlockStage {
    ops: Vec<usize>,
    cyclic: bool,
}

// Prepared while operations are uploaded. Only ordinary, pure control chains
// use this cache; repeat templates have instance-local registers and state.
#[derive(Copy, Clone)]
struct DspControlCache {
    opcode: i32,
    inputs: [i32; 5],
    previous: [f64; 5],
    output: f64,
    count: u8,
    initialized: bool,
}

const EMPTY_DSP_CONTROL_CACHE: DspControlCache = DspControlCache {
    opcode: -1,
    inputs: [-1; 5],
    previous: [0.0; 5],
    output: 0.0,
    count: 0,
    initialized: false,
};

type BiquadCoefficients = (f64, f64, f64, f64, f64);

#[derive(Copy, Clone)]
struct DspBiquadCoefficientCache {
    initialized: bool,
    kind: i32,
    parameter_a: f64,
    parameter_b: f64,
    sample_rate: f64,
    coefficients: BiquadCoefficients,
    gain: f64,
}

#[derive(Copy, Clone)]
struct DspDerivedValueCache {
    initialized: bool,
    parameter_a: f64,
    parameter_b: f64,
    value: f64,
}

struct DspSpreadRuntime {
    states_by_context: Vec<Vec<f64>>,
    resources_by_context: Vec<Vec<DspRepeatResourceState>>,
    resource_layout: Option<DspRepeatResourceLayout>,
    spare_resources_by_context: Vec<Vec<DspRepeatResourceState>>,
}

impl DspSpreadRuntime {
    fn new() -> Self {
        Self {
            states_by_context: (0..=MAX_VOICE_SLOTS).map(|_| Vec::new()).collect(),
            resources_by_context: (0..=MAX_VOICE_SLOTS).map(|_| Vec::new()).collect(),
            spare_resources_by_context: (0..=MAX_VOICE_SLOTS).map(|_| Vec::new()).collect(),
            resource_layout: None,
        }
    }
}

struct DspSpawnInstance {
    states: Vec<f64>,
    resources: DspRepeatResourceState,
    tag: f64,
    gate: bool,
    kill_triggered: bool,
}

struct DspSpawnRuntime {
    instances_by_context: Vec<Vec<DspSpawnInstance>>,
    previous_trigger_by_context: Vec<bool>,
    previous_release_trigger_by_context: Vec<bool>,
    resource_layout: Option<DspRepeatResourceLayout>,
    free_instances_by_context: Vec<Vec<DspSpawnInstance>>,
}

#[derive(Copy, Clone)]
struct DspMidiHeldNote {
    channel: usize,
    note: f64,
    velocity: f64,
}

#[derive(Copy, Clone)]
struct DspMidiNoteEvent {
    is_cc: bool,
    note_on: bool,
    channel: usize,
    note: f64,
    velocity: f64,
}

const EMPTY_DSP_MIDI_NOTE_EVENT: DspMidiNoteEvent = DspMidiNoteEvent {
    is_cc: false,
    note_on: false,
    channel: 1,
    note: 0.0,
    velocity: 0.0,
};

#[derive(Copy, Clone)]
struct DspSequencerEvent {
    active: bool,
    start: f64,
    end: f64,
    velocity: f64,
    note: f64,
}

const EMPTY_DSP_SEQUENCER_EVENT: DspSequencerEvent = DspSequencerEvent {
    active: false,
    start: 0.0,
    end: 0.0,
    velocity: 1.0,
    note: 0.0,
};

struct DspSequencerConfig {
    gate_mode: bool,
    steps: usize,
    rows: usize,
    events: Vec<DspSequencerEvent>,
}

struct DspRepeatMigrationPlan {
    state_ranges: Vec<(usize, usize, usize)>,
    sample_slots: Vec<(usize, usize)>,
    effect_slots: Vec<(usize, usize)>,
    buffer_slots: Vec<(usize, usize)>,
}

impl DspRepeatMigrationPlan {
    fn new() -> Self {
        Self {
            state_ranges: Vec::new(),
            sample_slots: Vec::new(),
            effect_slots: Vec::new(),
            buffer_slots: Vec::new(),
        }
    }
}

impl DspSpawnRuntime {
    fn new() -> Self {
        Self {
            instances_by_context: (0..=MAX_VOICE_SLOTS).map(|_| Vec::new()).collect(),
            free_instances_by_context: (0..=MAX_VOICE_SLOTS).map(|_| Vec::new()).collect(),
            previous_trigger_by_context: vec![false; MAX_VOICE_SLOTS + 1],
            previous_release_trigger_by_context: vec![false; MAX_VOICE_SLOTS + 1],
            resource_layout: None,
        }
    }
}

#[derive(Copy, Clone)]
struct DspSampleVoiceSettings {
    node: Node,
    frequency: f64,
    level: f64,
}

#[derive(Clone)]
struct DspSamplePlaybackState {
    sample_index: usize,
    effective_node: Node,
    active_voice_limit: usize,
    voice_settings: [DspSampleVoiceSettings; MAX_DSP_SAMPLE_PLAYER_VOICES],
    playing: [bool; MAX_DSP_SAMPLE_PLAYER_VOICES],
    positions: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
    directions: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
    frequency_directions: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
    has_advanced: [bool; MAX_DSP_SAMPLE_PLAYER_VOICES],
    playback_ages: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
    release_ages: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
    start_values: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
    last_outputs: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
    retrigger_outputs: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
    retrigger_fade_ages: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
    retrigger_fade_durations: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
    stretch_phases: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
    stretch_anchors: [f64; MAX_DSP_SAMPLE_PLAYER_VOICES],
}

impl DspSamplePlaybackState {
    fn new(sample_index: usize) -> Self {
        let effective_node = dsp_sample_node_index(sample_index as i32)
            .map(|node_index| unsafe { kernel_global!(NODES)[node_index] })
            .unwrap_or(EMPTY_NODE);
        Self {
            sample_index,
            effective_node,
            active_voice_limit: 0,
            voice_settings: [EMPTY_DSP_SAMPLE_VOICE_SETTINGS; MAX_DSP_SAMPLE_PLAYER_VOICES],
            playing: [false; MAX_DSP_SAMPLE_PLAYER_VOICES],
            positions: [0.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
            directions: [1.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
            frequency_directions: [1.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
            has_advanced: [false; MAX_DSP_SAMPLE_PLAYER_VOICES],
            playback_ages: [0.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
            release_ages: [-1.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
            start_values: [0.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
            last_outputs: [0.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
            retrigger_outputs: [0.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
            retrigger_fade_ages: [-1.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
            retrigger_fade_durations: [0.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
            stretch_phases: [0.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
            stretch_anchors: [0.0; MAX_DSP_SAMPLE_PLAYER_VOICES],
        }
    }
}

fn remap_dsp_sample_playback_state(
    state: &DspSamplePlaybackState,
    sample_index: usize,
) -> DspSamplePlaybackState {
    let mut remapped = state.clone();
    remapped.sample_index = sample_index;
    remapped
}

struct DspRepeatResourceLayout {
    state_start: usize,
    state_count: usize,
    sample_indices: Vec<usize>,
    effect_slots: Vec<usize>,
    buffer_slots: Vec<usize>,
}

struct DspRepeatEffectBufferState {
    slot: usize,
    buffer: Option<Box<[f32]>>,
    index: usize,
}

struct DspRepeatBufferState {
    slot: usize,
    frozen: bool,
    capture: u64,
    buffer: Option<Box<[f32]>>,
}

struct DspRepeatResourceState {
    random_state: u32,
    samples: Vec<DspSamplePlaybackState>,
    effect_buffers: Vec<DspRepeatEffectBufferState>,
    buffers: Vec<DspRepeatBufferState>,
}

impl DspRepeatResourceState {
    fn new(layout: &DspRepeatResourceLayout) -> Self {
        Self {
            random_state: next_dsp_random_seed(),
            samples: layout
                .sample_indices
                .iter()
                .map(|sample_index| DspSamplePlaybackState::new(*sample_index))
                .collect(),
            effect_buffers: layout
                .effect_slots
                .iter()
                .map(|slot| DspRepeatEffectBufferState {
                    slot: *slot,
                    buffer: try_zeroed_f32_buffer(MAX_DSP_DELAY_SAMPLES),
                    index: 0,
                })
                .collect(),
            buffers: layout
                .buffer_slots
                .iter()
                .map(|slot| DspRepeatBufferState {
                    slot: *slot, frozen: false, capture: 0,
                    buffer: try_zeroed_f32_buffer(MAX_DSP_BUFFER_SAMPLES),
                })
                .collect(),
        }
    }

    fn sample_mut(&mut self, sample_index: usize) -> Option<&mut DspSamplePlaybackState> {
        self.samples
            .iter_mut()
            .find(|state| state.sample_index == sample_index)
    }

    fn reset_for_transport(&mut self, preserved_buffer_slots: &[bool; MAX_DSP_BUFFER_SLOTS]) {
        for sample in &mut self.samples {
            *sample = DspSamplePlaybackState::new(sample.sample_index);
        }
        for effect in &mut self.effect_buffers {
            effect.index = 0;
            if let Some(buffer) = effect.buffer.as_mut() {
                buffer.fill(0.0);
            }
        }
        for buffer_state in &mut self.buffers {
            buffer_state.frozen = false; buffer_state.capture = 0;
            if preserved_buffer_slots
                .get(buffer_state.slot)
                .copied()
                .unwrap_or(false)
            {
                continue;
            }
            if let Some(buffer) = buffer_state.buffer.as_mut() {
                buffer.fill(0.0);
            }
        }
    }

    unsafe fn load_into_workspace(&mut self) {
        for effect in &mut self.effect_buffers {
            core::mem::swap(
                &mut kernel_global!(DSP_EFFECT_BUFFERS)[effect.slot],
                &mut effect.buffer,
            );
            core::mem::swap(
                &mut kernel_global!(DSP_EFFECT_INDICES)[effect.slot],
                &mut effect.index,
            );
        }
        for buffer in &mut self.buffers {
            core::mem::swap(&mut kernel_global!(DSP_BUFFER_FROZEN)[buffer.slot], &mut buffer.frozen);
            core::mem::swap(
                &mut kernel_global!(DSP_BUFFER_BUFFERS)[buffer.slot],
                &mut buffer.buffer,
            );
        }
    }

    unsafe fn save_from_workspace(&mut self) {
        for effect in &mut self.effect_buffers {
            core::mem::swap(
                &mut kernel_global!(DSP_EFFECT_BUFFERS)[effect.slot],
                &mut effect.buffer,
            );
            core::mem::swap(
                &mut kernel_global!(DSP_EFFECT_INDICES)[effect.slot],
                &mut effect.index,
            );
        }
        for buffer in &mut self.buffers {
            core::mem::swap(&mut kernel_global!(DSP_BUFFER_FROZEN)[buffer.slot], &mut buffer.frozen);
            core::mem::swap(
                &mut kernel_global!(DSP_BUFFER_BUFFERS)[buffer.slot],
                &mut buffer.buffer,
            );
        }
    }

    fn is_prepared(&self) -> bool {
        self.effect_buffers.iter().all(|b| b.buffer.is_some())
            && self.buffers.iter().all(|b| b.buffer.is_some())
    }

    fn allocated_buffer_bytes(&self) -> usize {
        let effect_bytes = self
            .effect_buffers
            .iter()
            .map(|resource| {
                resource
                    .buffer
                    .as_ref()
                    .map_or(0, |buffer| buffer.len() * core::mem::size_of::<f32>())
            })
            .sum::<usize>();
        let buffer_bytes = self
            .buffers
            .iter()
            .map(|resource| {
                resource
                    .buffer
                    .as_ref()
                    .map_or(0, |buffer| buffer.len() * core::mem::size_of::<f32>())
            })
            .sum::<usize>();
        effect_bytes.saturating_add(buffer_bytes)
    }
}

fn migrate_dsp_repeat_resources(
    mut old: DspRepeatResourceState,
    new_layout: &DspRepeatResourceLayout,
    plan: &DspRepeatMigrationPlan,
) -> DspRepeatResourceState {
    let mut migrated = DspRepeatResourceState::new(new_layout);
    migrated.random_state = old.random_state;
    for (old_slot, new_slot) in &plan.sample_slots {
        let Some(source) = old
            .samples
            .iter()
            .find(|state| state.sample_index == *old_slot)
        else {
            continue;
        };
        let Some(target) = migrated
            .samples
            .iter_mut()
            .find(|state| state.sample_index == *new_slot)
        else {
            continue;
        };
        *target = remap_dsp_sample_playback_state(source, *new_slot);
    }
    for (old_slot, new_slot) in &plan.effect_slots {
        let Some(source) = old
            .effect_buffers
            .iter_mut()
            .find(|state| state.slot == *old_slot)
        else {
            continue;
        };
        let Some(target) = migrated
            .effect_buffers
            .iter_mut()
            .find(|state| state.slot == *new_slot)
        else {
            continue;
        };
        target.buffer = source.buffer.take();
        target.index = source.index;
    }
    for (old_slot, new_slot) in &plan.buffer_slots {
        let Some(source) = old.buffers.iter_mut().find(|state| state.slot == *old_slot) else {
            continue;
        };
        let Some(target) = migrated
            .buffers
            .iter_mut()
            .find(|state| state.slot == *new_slot)
        else {
            continue;
        };
        target.buffer = source.buffer.take();
    }
    migrated
}

fn migrate_dsp_repeat_state(
    old: &[f64],
    old_count: usize,
    new_count: usize,
    plan: &DspRepeatMigrationPlan,
) -> Vec<f64> {
    let mut migrated = vec![0.0; new_count];
    for (old_offset, new_offset, count) in &plan.state_ranges {
        if old_offset.saturating_add(*count) > old_count
            || old_offset.saturating_add(*count) > old.len()
            || new_offset.saturating_add(*count) > new_count
        {
            continue;
        }
        migrated[*new_offset..*new_offset + *count]
            .copy_from_slice(&old[*old_offset..*old_offset + *count]);
    }
    migrated
}

const EMPTY_NODE: Node = Node {
    wave: 0,
    frequency_mode: 0,
    ratio: 1.0,
    frequency: 440.0,
    sync_beats: 1.0,
    quantise_enabled: 0,
    quantise_root: 0,
    quantise_scale: 0,
    quantise_glide: 0.0,
    speed: 8.0,
    audio_input_gain: 1.0,
    custom_mode: CUSTOM_MODE_LOOP,
    custom_sustain_start: 0.5,
    custom_sustain_end: 0.75,
    sample_mode: SAMPLE_MODE_ONE_SHOT,
    sample_start: 0.0,
    sample_end: 1.0,
    sample_attack: 0.0,
    sample_release: 0.0,
    sample_stretch: 1.0,
    sample_cycle_length: 4096.0,
    sample_overlap_ratio: 0.09,
    sample_original_frequency: 440.0,
};

const EMPTY_DSP_SAMPLE_VOICE_SETTINGS: DspSampleVoiceSettings = DspSampleVoiceSettings {
    node: EMPTY_NODE,
    frequency: 220.0,
    level: 0.7,
};

const EMPTY_LINK: Link = Link {
    from: -1,
    to: AUDIO_TARGET,
    amount: 0.0,
    delay: 0.0,
    noise: 0.0,
    pan: 0.0,
    target: 0,
    parameter_mode: PARAM_MODE_SET,
    velocity_sensitivity: 0.0,
    drone: 0,
    signal_mode: 0,
    follower_attack: 0.01,
    follower_release: 0.12,
    map_src_min: 0.0,
    map_src_max: 1.0,
    map_target_min: 0.0,
    map_target_max: 1.0,
    filter_type: 0,
    filter_cutoff: 5000.0,
    filter_resonance: 0.7,
    distortion_type: 0,
    distortion_gain: 1.5,
    env_delay: 0.0,
    env_attack: 0.01,
    env_decay: 0.16,
    env_sustain: 0.72,
    env_release: 0.24,
};

const EMPTY_DSP_OP: DspOp = DspOp {
    opcode: -1,
    out: -1,
    a: -1,
    b: -1,
    c: -1,
    d: -1,
    e: -1,
    state: -1,
    value: 0.0,
    value2: 0.0,
    value3: 0.0,
    value4: 0.0,
};

const EMPTY_DSP_BIQUAD_COEFFICIENT_CACHE: DspBiquadCoefficientCache = DspBiquadCoefficientCache {
    initialized: false,
    kind: 0,
    parameter_a: 0.0,
    parameter_b: 0.0,
    sample_rate: 0.0,
    coefficients: (0.0, 0.0, 0.0, 0.0, 0.0),
    gain: 0.0,
};

const EMPTY_DSP_DERIVED_VALUE_CACHE: DspDerivedValueCache = DspDerivedValueCache {
    initialized: false,
    parameter_a: 0.0,
    parameter_b: 0.0,
    value: 0.0,
};

#[derive(Copy, Clone)]
struct FilterState {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

#[derive(Copy, Clone)]
struct FormantBand {
    frequency: f64,
    q: f64,
    gain_db: f64,
}

const EMPTY_FILTER_STATE: FilterState = FilterState {
    x1: 0.0,
    x2: 0.0,
    y1: 0.0,
    y2: 0.0,
};

const FORMANT_VOWELS: [[FormantBand; MAX_FORMANT_BANDS]; 5] = [
    [
        FormantBand {
            frequency: 800.0,
            q: 7.5,
            gain_db: 0.0,
        },
        FormantBand {
            frequency: 1150.0,
            q: 9.0,
            gain_db: -5.0,
        },
        FormantBand {
            frequency: 2900.0,
            q: 12.0,
            gain_db: -13.0,
        },
    ],
    [
        FormantBand {
            frequency: 420.0,
            q: 7.5,
            gain_db: 0.0,
        },
        FormantBand {
            frequency: 1750.0,
            q: 12.0,
            gain_db: -4.0,
        },
        FormantBand {
            frequency: 2600.0,
            q: 13.0,
            gain_db: -12.0,
        },
    ],
    [
        FormantBand {
            frequency: 300.0,
            q: 8.5,
            gain_db: 0.0,
        },
        FormantBand {
            frequency: 2200.0,
            q: 14.0,
            gain_db: -3.0,
        },
        FormantBand {
            frequency: 3000.0,
            q: 15.0,
            gain_db: -10.0,
        },
    ],
    [
        FormantBand {
            frequency: 500.0,
            q: 8.0,
            gain_db: 0.0,
        },
        FormantBand {
            frequency: 900.0,
            q: 9.0,
            gain_db: -5.0,
        },
        FormantBand {
            frequency: 2500.0,
            q: 12.0,
            gain_db: -14.0,
        },
    ],
    [
        FormantBand {
            frequency: 350.0,
            q: 8.0,
            gain_db: 0.0,
        },
        FormantBand {
            frequency: 700.0,
            q: 9.0,
            gain_db: -7.0,
        },
        FormantBand {
            frequency: 2400.0,
            q: 12.0,
            gain_db: -16.0,
        },
    ],
];

macro_rules! wasm_state {
    ($($name:ident: $ty:ty = $initial:expr;)*) => { $(
        #[cfg(target_arch = "wasm32")]
        #[allow(dead_code)] // Some adapter state is only used by native entrypoints.
        static mut $name: $ty = $initial;
    )* };
}
engine_fields!(wasm_state);
mod bounded_repeats;
include!("runtime_preparation.rs");

#[no_mangle]
pub extern "C" fn leftPtr() -> *const f32 {
    kernel_address!(LEFT).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn rightPtr() -> *const f32 {
    kernel_address!(RIGHT).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn setDspStereoInputEnabled(enabled: u32) {
    unsafe {
        kernel_global!(DSP_STEREO_INPUT_ENABLED) = enabled != 0;
    }
}

#[no_mangle]
pub extern "C" fn inputLeftPtr() -> *mut f32 {
    kernel_address!(mut INPUT_LEFT).cast::<f32>()
}
#[no_mangle]
pub extern "C" fn inputRightPtr() -> *mut f32 {
    kernel_address!(mut INPUT_RIGHT).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn inputPtr() -> *mut f32 {
    kernel_address!(mut INPUT).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn linkMeterInputPtr() -> *const f64 {
    kernel_address!(LINK_METER_INPUT_SUMS).cast::<f64>()
}

#[no_mangle]
pub extern "C" fn linkMeterOutputPtr() -> *const f64 {
    kernel_address!(LINK_METER_OUTPUT_SUMS).cast::<f64>()
}

#[no_mangle]
pub extern "C" fn linkMeterEnvelopePtr() -> *const f64 {
    kernel_address!(LINK_METER_ENVELOPE_SUMS).cast::<f64>()
}

#[no_mangle]
pub extern "C" fn linkMeterCountPtr() -> *const u32 {
    kernel_address!(LINK_METER_COUNTS).cast::<u32>()
}

#[no_mangle]
pub extern "C" fn linkScopePtr() -> *const f32 {
    kernel_address!(LINK_SCOPE_SAMPLES).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn linkScopeCount() -> u32 {
    unsafe { kernel_global!(LINK_SCOPE_COUNT) }
}

#[no_mangle]
pub extern "C" fn linkScopeWriteIndex() -> u32 {
    unsafe { kernel_global!(LINK_SCOPE_WRITE_INDEX) }
}

#[no_mangle]
pub extern "C" fn maxSampleFrames() -> u32 {
    MAX_SAMPLE_FRAMES as u32
}

fn zeroed_f32_buffer(length: usize) -> Box<[f32]> {
    vec![0.0; length].into_boxed_slice()
}

fn try_zeroed_f32_buffer(length: usize) -> Option<Box<[f32]>> {
    let mut buffer = Vec::new();
    buffer.try_reserve_exact(length).ok()?;
    buffer.resize(length, 0.0);
    Some(buffer.into_boxed_slice())
}

#[no_mangle]
pub extern "C" fn lazyBufferBytes() -> f64 {
    unsafe {
        let mut bytes = 0usize;
        for index in 0..MAX_SAMPLE_SLOTS {
            bytes = bytes.saturating_add(
                kernel_global!(SAMPLE_DATA)[index]
                    .as_ref()
                    .map_or(0, |buffer| buffer.len())
                    * core::mem::size_of::<f32>(),
            );
        }
        for index in 0..MAX_IMAGE_SLOTS {
            bytes = bytes.saturating_add(
                kernel_global!(IMAGE_DATA)[index]
                    .as_ref()
                    .map_or(0, |buffer| buffer.len()),
            );
        }
        for index in 0..MAX_DSP_EFFECT_SLOTS {
            bytes = bytes.saturating_add(
                kernel_global!(DSP_EFFECT_BUFFERS)[index]
                    .as_ref()
                    .map_or(0, |buffer| buffer.len())
                    * core::mem::size_of::<f32>(),
            );
        }
        for index in 0..MAX_DSP_BUFFER_SLOTS {
            bytes = bytes.saturating_add(
                kernel_global!(DSP_BUFFER_BUFFERS)[index]
                    .as_ref()
                    .map_or(0, |buffer| buffer.len())
                    * core::mem::size_of::<f32>(),
            );
        }
        for slot in 0..MAX_DSP_SPREADS {
            if let Some(runtime) = kernel_global!(DSP_SPREAD_RUNTIMES)[slot].as_ref() {
                for context_resources in runtime
                    .resources_by_context
                    .iter()
                    .chain(&runtime.spare_resources_by_context)
                {
                    for resources in context_resources {
                        bytes = bytes.saturating_add(resources.allocated_buffer_bytes());
                    }
                }
            }
            if let Some(runtime) = kernel_global!(DSP_SPAWN_RUNTIMES)[slot].as_ref() {
                for context_instances in runtime
                    .instances_by_context
                    .iter()
                    .chain(&runtime.free_instances_by_context)
                {
                    for instance in context_instances {
                        bytes = bytes.saturating_add(instance.resources.allocated_buffer_bytes());
                    }
                }
            }
        }
        for index in 0..(MAX_VOICE_SLOTS * MAX_DELAY_SLOTS) {
            bytes = bytes.saturating_add(
                kernel_global!(LINK_DELAY_BUFFERS)[index]
                    .as_ref()
                    .map_or(0, |buffer| buffer.len())
                    * core::mem::size_of::<f32>(),
            );
        }
        for index in 0..(MAX_VOICE_SLOTS * MAX_COMB_SLOTS) {
            bytes = bytes.saturating_add(
                kernel_global!(LINK_COMB_BUFFERS)[index]
                    .as_ref()
                    .map_or(0, |buffer| buffer.len())
                    * core::mem::size_of::<f32>(),
            );
        }
        bytes as f64
    }
}

fn ensure_dsp_effect_buffer(slot: usize) {
    unsafe {
        if slot < MAX_DSP_EFFECT_SLOTS && kernel_global!(DSP_EFFECT_BUFFERS)[slot].is_none() {
            kernel_global!(DSP_EFFECT_BUFFERS)[slot] =
                Some(zeroed_f32_buffer(MAX_DSP_DELAY_SAMPLES));
        }
    }
}

fn prepare_dsp_effect_slot(state: i32) -> Option<usize> {
    unsafe {
        if state < 0 || state as usize >= MAX_DSP_STATE {
            return None;
        }
        let state_index = state as usize;
        let existing = kernel_global!(DSP_EFFECT_STATE_SLOTS)[state_index];
        if existing >= 0 && (existing as usize) < MAX_DSP_EFFECT_SLOTS {
            return Some(existing as usize);
        }
        for slot in 0..MAX_DSP_EFFECT_SLOTS {
            if kernel_global!(DSP_EFFECT_SLOT_STATES)[slot] < 0 {
                kernel_global!(DSP_EFFECT_SLOT_STATES)[slot] = state;
                kernel_global!(DSP_EFFECT_STATE_SLOTS)[state_index] = slot as i32;
                ensure_dsp_effect_buffer(slot);
                return Some(slot);
            }
        }
        None
    }
}

fn prepare_dsp_buffer_slot(state: i32) -> Option<usize> {
    unsafe {
        if state < 0 || state as usize >= MAX_DSP_STATE {
            return None;
        }
        let state_index = state as usize;
        let existing = kernel_global!(DSP_BUFFER_STATE_SLOTS)[state_index];
        if existing >= 0 && (existing as usize) < MAX_DSP_BUFFER_SLOTS {
            return Some(existing as usize);
        }
        for slot in 0..MAX_DSP_BUFFER_SLOTS {
            if kernel_global!(DSP_BUFFER_SLOT_STATES)[slot] < 0 {
                kernel_global!(DSP_BUFFER_SLOT_STATES)[slot] = state;
                kernel_global!(DSP_BUFFER_STATE_SLOTS)[state_index] = slot as i32;
                if kernel_global!(DSP_BUFFER_BUFFERS)[slot].is_none() {
                    kernel_global!(DSP_BUFFER_BUFFERS)[slot] =
                        Some(zeroed_f32_buffer(MAX_DSP_BUFFER_SAMPLES));
                }
                return Some(slot);
            }
        }
        None
    }
}

#[no_mangle]
pub extern "C" fn dspEffectBufferPtr(slot: u32) -> *mut f32 {
    let slot = slot as usize;
    if slot >= MAX_DSP_EFFECT_SLOTS {
        return core::ptr::null_mut();
    }
    ensure_dsp_effect_buffer(slot);
    unsafe {
        kernel_global!(DSP_EFFECT_BUFFERS)[slot]
            .as_mut()
            .map_or(core::ptr::null_mut(), |buffer| buffer.as_mut_ptr())
    }
}

#[no_mangle]
pub extern "C" fn dspEffectBufferLength() -> u32 {
    MAX_DSP_DELAY_SAMPLES as u32
}

#[no_mangle]
pub extern "C" fn dspEffectSlotForState(state: u32) -> i32 {
    let state = state as usize;
    if state >= MAX_DSP_STATE {
        return -1;
    }
    unsafe { kernel_global!(DSP_EFFECT_STATE_SLOTS)[state] }
}

#[no_mangle]
pub extern "C" fn dspBufferSlotForState(state: u32) -> i32 {
    let state = state as usize;
    if state >= MAX_DSP_STATE {
        return -1;
    }
    unsafe { kernel_global!(DSP_BUFFER_STATE_SLOTS)[state] }
}

#[no_mangle]
pub extern "C" fn getDspEffectIndex(slot: u32) -> u32 {
    let slot = slot as usize;
    if slot >= MAX_DSP_EFFECT_SLOTS {
        return 0;
    }
    unsafe { kernel_global!(DSP_EFFECT_INDICES)[slot] as u32 }
}

#[no_mangle]
pub extern "C" fn setDspEffectIndex(slot: u32, index: u32) {
    let slot = slot as usize;
    if slot >= MAX_DSP_EFFECT_SLOTS {
        return;
    }
    unsafe {
        kernel_global!(DSP_EFFECT_INDICES)[slot] = (index as usize) % MAX_DSP_DELAY_SAMPLES;
    }
}

#[no_mangle]
pub extern "C" fn dspBufferPtr(state: u32) -> *mut f32 {
    let Some(slot) = prepare_dsp_buffer_slot(state as i32) else {
        return core::ptr::null_mut();
    };
    unsafe {
        kernel_global!(DSP_BUFFER_BUFFERS)[slot]
            .as_mut()
            .map_or(core::ptr::null_mut(), |buffer| buffer.as_mut_ptr())
    }
}

/// Off-render restoration after copying source samples into dspBufferPtr(state).
/// Endpoint-aligned linear interpolation matches the standalone snapshot loader.
/// In-place traversal avoids another full-size temporary allocation.
#[no_mangle]
pub extern "C" fn restoreDspBufferSnapshot(
    state: u32,
    source_length: u32,
    source_rate: f64,
    target_rate: f64,
) -> i32 {
    let length = source_length as usize;
    if !valid_dsp_state_range(state as i32, 7)
        || length < 2
        || length > MAX_DSP_BUFFER_SAMPLES
        || !source_rate.is_finite()
        || source_rate <= 0.0
        || !target_rate.is_finite()
        || target_rate <= 0.0
    {
        return -1;
    }
    let ptr = dspBufferPtr(state);
    if ptr.is_null() {
        return -1;
    }
    unsafe {
        if (0..length).any(|index| !(*ptr.add(index)).is_finite()) {
            return -1;
        }
        let count = (length as f64 * target_rate / source_rate)
            .round()
            .clamp(2.0, MAX_DSP_BUFFER_SAMPLES as f64) as usize;
        let write = |index: usize| {
            let position = index as f64 * (length - 1) as f64 / (count - 1) as f64;
            let left = position.floor() as usize;
            let right = (left + 1).min(length - 1);
            let mix = position - left as f64;
            let value = *ptr.add(left) as f64 * (1.0 - mix) + *ptr.add(right) as f64 * mix;
            *ptr.add(index) = value as f32;
        };
        if count > length {
            for index in (0..count).rev() {
                write(index);
            }
        } else if count != length || source_rate != target_rate {
            for index in 0..count {
                write(index);
            }
        }
        std::slice::from_raw_parts_mut(ptr.add(count), MAX_DSP_BUFFER_SAMPLES - count).fill(0.0);
        setDspState(state + 3, count as f64 / target_rate);
        count as i32
    }
}

#[no_mangle]
pub extern "C" fn dspBufferLength() -> u32 {
    MAX_DSP_BUFFER_SAMPLES as u32
}

#[no_mangle]
pub extern "C" fn sampleDataPtr(slot: u32) -> *mut f32 {
    let slot = slot as usize;
    if slot >= MAX_SAMPLE_SLOTS {
        return core::ptr::null_mut();
    }
    unsafe {
        kernel_global!(SAMPLE_DATA)[slot]
            .as_mut()
            .map_or(core::ptr::null_mut(), |data| data.as_mut_ptr())
    }
}

#[no_mangle]
pub extern "C" fn setSampleData(node_index: i32, sample_rate: f64, length: u32) -> i32 {
    unsafe {
        if node_index < 0 || node_index as usize >= kernel_global!(NODE_COUNT) {
            return -1;
        }
        let requested_length = length as usize;
        if requested_length > MAX_SAMPLE_FRAMES {
            return -2;
        }
        let node_index = node_index as usize;
        let existing = kernel_global!(SAMPLE_SLOT_FOR_NODE)[node_index];
        let slot = if existing >= 0 {
            existing as usize
        } else {
            let mut free_slot = None;
            'outer: for slot_index in 0..MAX_SAMPLE_SLOTS {
                for node_slot in 0..MAX_NODES {
                    if kernel_global!(SAMPLE_SLOT_FOR_NODE)[node_slot] == slot_index as i32 {
                        continue 'outer;
                    }
                }
                free_slot = Some(slot_index);
                break;
            }
            match free_slot {
                Some(slot_index) => {
                    kernel_global!(SAMPLE_SLOT_FOR_NODE)[node_index] = slot_index as i32;
                    slot_index
                }
                None => return -1,
            }
        };
        let mut total_without_existing = 0usize;
        for sample_slot in 0..MAX_SAMPLE_SLOTS {
            if sample_slot != slot {
                total_without_existing = total_without_existing.saturating_add(
                    kernel_global!(SAMPLE_DATA)[sample_slot]
                        .as_ref()
                        .map_or(0, |buffer| buffer.len()),
                );
            }
        }
        if total_without_existing.saturating_add(requested_length) > MAX_TOTAL_SAMPLE_FRAMES {
            return -3;
        }
        let length = requested_length;
        if kernel_global!(SAMPLE_DATA)[slot]
            .as_ref()
            .map_or(0, |data| data.len())
            != length
        {
            let Some(buffer) = try_zeroed_f32_buffer(length) else {
                return -4;
            };
            kernel_global!(SAMPLE_DATA)[slot] = Some(buffer);
        }
        kernel_global!(SAMPLE_LENGTHS)[slot] = length;
        kernel_global!(SAMPLE_RATES)[slot] = if sample_rate.is_finite() && sample_rate > 0.0 {
            sample_rate
        } else {
            44_100.0
        };
        slot as i32
    }
}

// Point another sample player at an already-uploaded sample slot.  Sample data
// is immutable after upload, so players can safely share its decoded buffer
// while retaining independent playback state.
#[no_mangle]
pub extern "C" fn bindSampleData(node_index: i32, slot: i32) -> i32 {
    unsafe {
        if node_index < 0 || node_index as usize >= kernel_global!(NODE_COUNT) || slot < 0 {
            return -1;
        }
        let slot = slot as usize;
        if slot >= MAX_SAMPLE_SLOTS
            || kernel_global!(SAMPLE_LENGTHS)[slot] == 0
            || kernel_global!(SAMPLE_DATA)[slot].is_none()
        {
            return -1;
        }
        kernel_global!(SAMPLE_SLOT_FOR_NODE)[node_index as usize] = slot as i32;
        slot as i32
    }
}

#[no_mangle]
pub extern "C" fn maxImageBytes() -> u32 {
    MAX_IMAGE_BYTES as u32
}

#[no_mangle]
pub extern "C" fn imageDataPtr(slot: u32) -> *mut u8 {
    let slot = slot as usize;
    if slot >= MAX_IMAGE_SLOTS {
        return core::ptr::null_mut();
    }
    unsafe {
        kernel_global!(IMAGE_DATA)[slot]
            .as_mut()
            .map_or(core::ptr::null_mut(), |data| data.as_mut_ptr())
    }
}

#[no_mangle]
pub extern "C" fn setImageData(slot: i32, width: u32, height: u32, length: u32) -> i32 {
    if slot < 0 || slot as usize >= MAX_IMAGE_SLOTS {
        return -1;
    }
    let width = (width as usize).min(MAX_IMAGE_DIMENSION);
    let height = (height as usize).min(MAX_IMAGE_DIMENSION);
    if width == 0
        || height == 0
        || (length as usize) < width.saturating_mul(height).saturating_mul(4)
    {
        return -1;
    }
    unsafe {
        let slot = slot as usize;
        let length = width.saturating_mul(height).saturating_mul(4);
        if kernel_global!(IMAGE_DATA)[slot]
            .as_ref()
            .map_or(0, |data| data.len())
            != length
        {
            kernel_global!(IMAGE_DATA)[slot] = Some(vec![0; length].into_boxed_slice());
        }
        kernel_global!(IMAGE_WIDTHS)[slot] = width;
        kernel_global!(IMAGE_HEIGHTS)[slot] = height;
    }
    slot
}

#[no_mangle]
pub extern "C" fn clear(frames: u32) {
    let frames = (frames as usize).min(MAX_WASM_FRAMES);
    let left = kernel_address!(mut LEFT).cast::<f32>();
    let right = kernel_address!(mut RIGHT).cast::<f32>();

    for index in 0..frames {
        unsafe {
            *left.add(index) = 0.0;
            *right.add(index) = 0.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn beginDspRenderQuantum() {
    unsafe {
        kernel_global!(SAMPLE_TRIGGER_EVENT_COUNT) = 0;
        for index in 0..kernel_global!(NODE_COUNT) {
            kernel_global!(CUSTOM_WAVE_MORPH_REMAINING_AT_QUANTUM_START)[index] =
                kernel_global!(CUSTOM_WAVE_MORPH_REMAINING_AT_QUANTUM_START)[index]
                    .saturating_sub(kernel_global!(CUSTOM_WAVE_MORPH_CONSUMED_FRAMES)[index]);
            kernel_global!(CUSTOM_WAVE_MORPH_CONSUMED_FRAMES)[index] = 0;
        }
        kernel_global!(DSP_RENDER_QUANTUM_ID) =
            kernel_global!(DSP_RENDER_QUANTUM_ID).wrapping_add(1);
        if kernel_global!(DSP_RENDER_QUANTUM_ID) == 0 {
            kernel_global!(DSP_RENDER_QUANTUM_ID) = 1;
            for index in 0..MAX_DSP_TEMPO_SOURCES {
                kernel_global!(DSP_TEMPO_LAST_QUANTUM_BY_SOURCE)[index] = 0;
                kernel_global!(DSP_TEMPO_LAST_FRAME_BY_SOURCE)[index] = DSP_RENDER_FRAME_UNSET;
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn sampleTriggerEventCount() -> u32 {
    unsafe { kernel_global!(SAMPLE_TRIGGER_EVENT_COUNT) as u32 }
}

#[no_mangle]
pub extern "C" fn sampleTriggerEventValue(event: u32, field: u32) -> f64 {
    let event = event as usize;
    let field = field as usize;
    unsafe {
        if event < kernel_global!(SAMPLE_TRIGGER_EVENT_COUNT) && field < SAMPLE_TRIGGER_EVENT_FIELDS
        {
            kernel_global!(SAMPLE_TRIGGER_EVENTS)[event][field]
        } else {
            0.0
        }
    }
}

#[no_mangle]
pub extern "C" fn clearGraph() {
    unsafe {
        kernel_global!(NODE_COUNT) = 0;
        kernel_global!(LINK_COUNT) = 0;
        kernel_global!(LINK_SCOPE_LINK_INDEX) = -1;
        reset_link_scope();
        kernel_global!(LINK_DELAY_SLOT_COUNT) = 0;
        kernel_global!(LINK_COMB_SLOT_COUNT) = 0;
        for index in 0..MAX_LINKS {
            kernel_global!(LINK_DELAY_SLOTS)[index] = -1;
            kernel_global!(LINK_COMB_SLOTS)[index] = -1;
            kernel_global!(LINK_FIRST_MODULATOR)[index] = -1;
            kernel_global!(LINK_NEXT_MODULATOR)[index] = -1;
            kernel_global!(LINK_HAS_ENVELOPE_TRIGGER)[index] = false;
        }
        for index in 0..MAX_NODES {
            kernel_global!(CUSTOM_WAVE_COUNTS)[index] = 0;
            kernel_global!(CUSTOM_WAVE_PREVIOUS_COUNTS)[index] = 0;
            kernel_global!(CUSTOM_WAVE_MORPH_TOTAL_FRAMES)[index] = 0;
            kernel_global!(CUSTOM_WAVE_MORPH_REMAINING_AT_QUANTUM_START)[index] = 0;
            kernel_global!(CUSTOM_WAVE_MORPH_CONSUMED_FRAMES)[index] = 0;
            kernel_global!(SAMPLE_SLOT_FOR_NODE)[index] = -1;
            kernel_global!(SAMPLE_STRETCH_MODS)[index] = 0.0;
            kernel_global!(FREQUENCY_MODS)[index] = 0.0;
            kernel_global!(FREQUENCY_MOD_ACTIVE)[index] = false;
        }
    }
}

fn clear_dsp_buffers() {
    unsafe {
        for slot in 0..MAX_DSP_BUFFER_SLOTS {
            if let Some(buffer) = kernel_global!(DSP_BUFFER_BUFFERS)[slot].as_mut() {
                buffer.fill(0.0);
            }
        }
    }
}

fn buffer_slots_preserved_on_reset() -> [bool; MAX_DSP_BUFFER_SLOTS] {
    let mut preserved = [false; MAX_DSP_BUFFER_SLOTS];
    unsafe {
        for index in 0..kernel_global!(DSP_OP_COUNT) {
            let op = kernel_global!(DSP_OPS)[index];
            if op.opcode != DSP_OP_BUFFER || op.value < 0.5 || op.state < 0 {
                continue;
            }
            let state = op.state as usize;
            if state >= MAX_DSP_STATE {
                continue;
            }
            let slot = kernel_global!(DSP_BUFFER_STATE_SLOTS)[state];
            if slot >= 0 && (slot as usize) < MAX_DSP_BUFFER_SLOTS {
                preserved[slot as usize] = true;
            }
        }
    }
    preserved
}

fn clear_dsp_buffers_except(preserved: &[bool; MAX_DSP_BUFFER_SLOTS]) {
    unsafe {
        for slot in 0..MAX_DSP_BUFFER_SLOTS {
            if preserved[slot] {
                continue;
            }
            if let Some(buffer) = kernel_global!(DSP_BUFFER_BUFFERS)[slot].as_mut() {
                buffer.fill(0.0);
            }
        }
    }
}

fn clear_dsp_resource_slots() {
    unsafe {
        for state in 0..MAX_DSP_STATE {
            kernel_global!(DSP_EFFECT_STATE_SLOTS)[state] = -1;
            kernel_global!(DSP_BUFFER_STATE_SLOTS)[state] = -1;
        }
        for slot in 0..MAX_DSP_EFFECT_SLOTS {
            kernel_global!(DSP_EFFECT_SLOT_STATES)[slot] = -1;
        }
        for slot in 0..MAX_DSP_BUFFER_SLOTS {
            kernel_global!(DSP_BUFFER_SLOT_STATES)[slot] = -1;
        }
    }
    clear_dsp_buffers();
}

#[no_mangle]
pub extern "C" fn beginDspSequencerUpdate(binding: u32, gate_mode: u32, steps: u32, rows: u32) {
    let binding = binding as usize;
    if binding >= MAX_DSP_SPREADS {
        return;
    }
    let steps = (steps as usize).clamp(SEQUENCER_MIN_STEPS as usize, SEQUENCER_MAX_STEPS as usize);
    let rows = (rows as usize).clamp(SEQUENCER_MIN_ROWS as usize, SEQUENCER_MAX_ROWS as usize);
    unsafe {
        if let Some(config) = kernel_global!(DSP_SEQUENCER_CONFIGS)[binding].as_mut() {
            if config.steps == steps && config.rows == rows {
                config.gate_mode = gate_mode != 0;
                config.events.fill(EMPTY_DSP_SEQUENCER_EVENT);
                return;
            }
        }
        kernel_global!(DSP_SEQUENCER_CONFIGS)[binding] = Some(DspSequencerConfig {
            gate_mode: gate_mode != 0,
            steps,
            rows,
            events: vec![EMPTY_DSP_SEQUENCER_EVENT; steps.saturating_mul(rows)],
        });
    }
}

#[no_mangle]
pub extern "C" fn setDspSequencerEvent(
    binding: u32,
    row: u32,
    slot: u32,
    active: u32,
    start: f64,
    end: f64,
    velocity: f64,
    note: f64,
) {
    let binding = binding as usize;
    if binding >= MAX_DSP_SPREADS {
        return;
    }
    unsafe {
        let Some(config) = kernel_global!(DSP_SEQUENCER_CONFIGS)[binding].as_mut() else {
            return;
        };
        let row = row as usize;
        let slot = slot as usize;
        if row >= config.rows || slot >= config.steps {
            return;
        }
        config.events[row * config.steps + slot] = DspSequencerEvent {
            active: active != 0,
            start: if start.is_finite() {
                start
            } else {
                slot as f64
            },
            end: if end.is_finite() { end } else { slot as f64 },
            velocity: if velocity.is_finite() {
                velocity.clamp(0.0, 1.0)
            } else {
                1.0
            },
            note: if note.is_finite() {
                note.round()
            } else {
                row as f64
            },
        };
    }
}

unsafe fn capture_dsp_sample_program_states() -> Vec<DspSamplePlaybackState> {
    let mut states = Vec::new();
    for sample_index in 0..MAX_DSP_SAMPLE_NODES {
        let node_index = kernel_global!(DSP_SAMPLE_NODE_INDICES)[sample_index];
        if node_index < 0 || node_index as usize >= MAX_NODES {
            continue;
        }
        let node_index = node_index as usize;
        let mut state = DspSamplePlaybackState::new(sample_index);
        state.active_voice_limit = kernel_global!(DSP_SAMPLE_ACTIVE_VOICE_LIMITS)[sample_index];
        state.voice_settings = kernel_global!(DSP_SAMPLE_VOICE_SETTINGS)[sample_index];
        for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
            let voice_slot = DSP_SAMPLE_VOICE_SLOT_START + voice;
            state.playing[voice] = kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index];
            state.positions[voice] = kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index];
            state.directions[voice] = kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index];
            state.frequency_directions[voice] =
                kernel_global!(SAMPLE_FREQUENCY_DIRECTIONS)[voice_slot][node_index];
            state.has_advanced[voice] = kernel_global!(SAMPLE_HAS_ADVANCED)[voice_slot][node_index];
            state.playback_ages[voice] =
                kernel_global!(SAMPLE_PLAYBACK_AGES)[voice_slot][node_index];
            state.release_ages[voice] = kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index];
            state.start_values[voice] = kernel_global!(SAMPLE_START_VALUES)[voice_slot][node_index];
            state.last_outputs[voice] = kernel_global!(SAMPLE_LAST_OUTPUTS)[voice_slot][node_index];
            state.retrigger_outputs[voice] =
                kernel_global!(SAMPLE_RETRIGGER_OUTPUTS)[voice_slot][node_index];
            state.retrigger_fade_ages[voice] =
                kernel_global!(SAMPLE_RETRIGGER_FADE_AGES)[voice_slot][node_index];
            state.retrigger_fade_durations[voice] =
                kernel_global!(SAMPLE_RETRIGGER_FADE_DURATIONS)[voice_slot][node_index];
            state.stretch_phases[voice] =
                kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index];
            state.stretch_anchors[voice] =
                kernel_global!(SAMPLE_STRETCH_ANCHORS)[voice_slot][node_index];
        }
        states.push(state);
    }
    states
}

unsafe fn restore_dsp_sample_program_state(
    source: &DspSamplePlaybackState,
    sample_index: usize,
) -> bool {
    if sample_index >= MAX_DSP_SAMPLE_NODES {
        return false;
    }
    let node_index = kernel_global!(DSP_SAMPLE_NODE_INDICES)[sample_index];
    if node_index < 0 || node_index as usize >= MAX_NODES {
        return false;
    }
    let node_index = node_index as usize;
    let state = remap_dsp_sample_playback_state(source, sample_index);
    kernel_global!(DSP_SAMPLE_ACTIVE_VOICE_LIMITS)[sample_index] =
        state.active_voice_limit.min(MAX_DSP_SAMPLE_PLAYER_VOICES);
    kernel_global!(DSP_SAMPLE_VOICE_SETTINGS)[sample_index] = state.voice_settings;
    for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
        let voice_slot = DSP_SAMPLE_VOICE_SLOT_START + voice;
        kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] = state.playing[voice];
        kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] = state.positions[voice];
        kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index] = state.directions[voice];
        kernel_global!(SAMPLE_FREQUENCY_DIRECTIONS)[voice_slot][node_index] =
            state.frequency_directions[voice];
        kernel_global!(SAMPLE_HAS_ADVANCED)[voice_slot][node_index] = state.has_advanced[voice];
        kernel_global!(SAMPLE_PLAYBACK_AGES)[voice_slot][node_index] = state.playback_ages[voice];
        kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index] = state.release_ages[voice];
        kernel_global!(SAMPLE_START_VALUES)[voice_slot][node_index] = state.start_values[voice];
        kernel_global!(SAMPLE_LAST_OUTPUTS)[voice_slot][node_index] = state.last_outputs[voice];
        kernel_global!(SAMPLE_RETRIGGER_OUTPUTS)[voice_slot][node_index] =
            state.retrigger_outputs[voice];
        kernel_global!(SAMPLE_RETRIGGER_FADE_AGES)[voice_slot][node_index] =
            state.retrigger_fade_ages[voice];
        kernel_global!(SAMPLE_RETRIGGER_FADE_DURATIONS)[voice_slot][node_index] =
            state.retrigger_fade_durations[voice];
        kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index] = state.stretch_phases[voice];
        kernel_global!(SAMPLE_STRETCH_ANCHORS)[voice_slot][node_index] =
            state.stretch_anchors[voice];
    }
    true
}

#[no_mangle]
pub extern "C" fn beginDspProgramUpdate() {
    unsafe {
        kernel_global!(DSP_PENDING_SAMPLE_STATES) = Some(capture_dsp_sample_program_states());
        kernel_global!(DSP_REPEAT_MIGRATION_PLAN) = None;
        for slot in 0..MAX_DSP_SPREADS {
            kernel_global!(DSP_PENDING_SPREAD_RUNTIMES)[slot] =
                kernel_global!(DSP_SPREAD_RUNTIMES)[slot].take();
            kernel_global!(DSP_PENDING_SPAWN_RUNTIMES)[slot] =
                kernel_global!(DSP_SPAWN_RUNTIMES)[slot].take();
        }
    }
}

#[no_mangle]
pub extern "C" fn migrateDspSampleState(old_slot: u32, new_slot: u32) -> i32 {
    let old_slot = old_slot as usize;
    let new_slot = new_slot as usize;
    if old_slot >= MAX_DSP_SAMPLE_NODES || new_slot >= MAX_DSP_SAMPLE_NODES {
        return -1;
    }
    unsafe {
        let Some(states) =
            (*core::ptr::addr_of!(kernel_global!(DSP_PENDING_SAMPLE_STATES))).as_ref()
        else {
            return -1;
        };
        let Some(source) = states.iter().find(|state| state.sample_index == old_slot) else {
            return -1;
        };
        if restore_dsp_sample_program_state(source, new_slot) {
            new_slot as i32
        } else {
            -1
        }
    }
}

#[no_mangle]
pub extern "C" fn beginDspRepeatRuntimeMigration() {
    unsafe {
        kernel_global!(DSP_REPEAT_MIGRATION_PLAN) = Some(DspRepeatMigrationPlan::new());
    }
}

#[no_mangle]
pub extern "C" fn addDspRepeatStateMigration(old_offset: u32, new_offset: u32, count: u32) {
    if count == 0 {
        return;
    }
    unsafe {
        if let Some(plan) =
            (*core::ptr::addr_of_mut!(kernel_global!(DSP_REPEAT_MIGRATION_PLAN))).as_mut()
        {
            plan.state_ranges
                .push((old_offset as usize, new_offset as usize, count as usize));
        }
    }
}

#[no_mangle]
pub extern "C" fn addDspRepeatSampleMigration(old_slot: u32, new_slot: u32) {
    unsafe {
        if let Some(plan) =
            (*core::ptr::addr_of_mut!(kernel_global!(DSP_REPEAT_MIGRATION_PLAN))).as_mut()
        {
            plan.sample_slots
                .push((old_slot as usize, new_slot as usize));
        }
    }
}

#[no_mangle]
pub extern "C" fn addDspRepeatEffectMigration(old_slot: u32, new_slot: u32) {
    unsafe {
        if let Some(plan) =
            (*core::ptr::addr_of_mut!(kernel_global!(DSP_REPEAT_MIGRATION_PLAN))).as_mut()
        {
            plan.effect_slots
                .push((old_slot as usize, new_slot as usize));
        }
    }
}

#[no_mangle]
pub extern "C" fn addDspRepeatBufferMigration(old_slot: u32, new_slot: u32) {
    unsafe {
        if let Some(plan) =
            (*core::ptr::addr_of_mut!(kernel_global!(DSP_REPEAT_MIGRATION_PLAN))).as_mut()
        {
            plan.buffer_slots
                .push((old_slot as usize, new_slot as usize));
        }
    }
}

#[no_mangle]
pub extern "C" fn finishDspRepeatRuntimeMigration(
    kind: u32,
    old_slot: u32,
    new_slot: u32,
    new_begin_op: u32,
) {
    let old_slot = old_slot as usize;
    let new_slot = new_slot as usize;
    let new_begin_op = new_begin_op as usize;
    if old_slot >= MAX_DSP_SPREADS || new_slot >= MAX_DSP_SPREADS || new_begin_op >= MAX_DSP_OPS {
        return;
    }
    unsafe {
        let Some(plan) =
            (*core::ptr::addr_of_mut!(kernel_global!(DSP_REPEAT_MIGRATION_PLAN))).take()
        else {
            return;
        };
        let end_index = kernel_global!(DSP_OPS)[new_begin_op]
            .b
            .max(new_begin_op as i32 + 1) as usize;
        if end_index >= kernel_global!(DSP_OP_COUNT) {
            return;
        }
        let new_layout = dsp_template_resource_layout(new_begin_op, end_index);
        if kind != 0 {
            let Some(old_runtime) = kernel_global!(DSP_PENDING_SPAWN_RUNTIMES)[old_slot].take()
            else {
                return;
            };
            let Some(old_layout) = old_runtime.resource_layout.as_ref() else {
                return;
            };
            let mut migrated = DspSpawnRuntime::new();
            migrated.previous_trigger_by_context = old_runtime.previous_trigger_by_context;
            migrated.previous_release_trigger_by_context =
                old_runtime.previous_release_trigger_by_context;
            for (context, instances) in old_runtime.instances_by_context.into_iter().enumerate() {
                migrated.instances_by_context[context] = instances
                    .into_iter()
                    .map(|instance| DspSpawnInstance {
                        states: migrate_dsp_repeat_state(
                            &instance.states,
                            old_layout.state_count,
                            new_layout.state_count,
                            &plan,
                        ),
                        resources: migrate_dsp_repeat_resources(
                            instance.resources,
                            &new_layout,
                            &plan,
                        ),
                        tag: instance.tag,
                        gate: instance.gate,
                        kill_triggered: instance.kill_triggered,
                    })
                    .collect();
            }
            migrated.resource_layout = Some(new_layout);
            kernel_global!(DSP_SPAWN_RUNTIMES)[new_slot] = Some(migrated);
            return;
        }

        let Some(old_runtime) = kernel_global!(DSP_PENDING_SPREAD_RUNTIMES)[old_slot].take() else {
            return;
        };
        let Some(old_layout) = old_runtime.resource_layout.as_ref() else {
            return;
        };
        let mut migrated = DspSpreadRuntime::new();
        for context in 0..old_runtime.states_by_context.len() {
            let old_states = &old_runtime.states_by_context[context];
            if old_layout.state_count > 0 {
                for item_state in old_states.chunks_exact(old_layout.state_count) {
                    migrated.states_by_context[context].extend(migrate_dsp_repeat_state(
                        item_state,
                        old_layout.state_count,
                        new_layout.state_count,
                        &plan,
                    ));
                }
            }
        }
        for (context, resources) in old_runtime.resources_by_context.into_iter().enumerate() {
            migrated.resources_by_context[context] = resources
                .into_iter()
                .map(|resource| migrate_dsp_repeat_resources(resource, &new_layout, &plan))
                .collect();
        }
        migrated.resource_layout = Some(new_layout);
        kernel_global!(DSP_SPREAD_RUNTIMES)[new_slot] = Some(migrated);
    }
}

#[no_mangle]
pub extern "C" fn finishDspProgramUpdate() {
    unsafe {
        kernel_global!(DSP_PENDING_SAMPLE_STATES) = None;
        kernel_global!(DSP_REPEAT_MIGRATION_PLAN) = None;
        for slot in 0..MAX_DSP_SPREADS {
            kernel_global!(DSP_PENDING_SPREAD_RUNTIMES)[slot] = None;
            kernel_global!(DSP_PENDING_SPAWN_RUNTIMES)[slot] = None;
        }
    }
}

#[no_mangle]
pub extern "C" fn clearDspProgram() {
    #[cfg(feature = "parallel")]
    parallel::clear_plan();
    unsafe {
        kernel_global!(DSP_BOUNDED_PROGRAM) = None;
        kernel_global!(DSP_REPEAT_CAPACITY) = 0;

        kernel_global!(DSP_BLOCK_PLAN) = None;
        kernel_global!(DSP_OP_COUNT) = 0;
        kernel_global!(DSP_CONTROL_REPEAT_DEPTH) = 0;
        for index in 0..MAX_DSP_REGS {
            kernel_global!(DSP_CONTROL_REGISTERS)[index] = false;
        }
        for slot in 0..MAX_DSP_SPREADS {
            kernel_global!(DSP_SPREAD_RUNTIMES)[slot] = None;
            kernel_global!(DSP_SPAWN_RUNTIMES)[slot] = None;
            kernel_global!(DSP_SEQUENCER_CONFIGS)[slot] = None;
        }
        kernel_global!(DSP_VALUE_SMOOTHING_COUNT) = 0;
        for index in 0..MAX_DSP_REGS {
            kernel_global!(DSP_REGS)[index] = 0.0;
        }
        for index in 0..MAX_DSP_STATE {
            *dsp_state_ptr(index) = 0.0;
        }
        for slot in 0..MAX_VOICE_SLOTS {
            for index in 0..MAX_DSP_STATE {
                kernel_global!(DSP_VOICE_STATES)[slot][index] = 0.0;
            }
        }
        for index in 0..MAX_DSP_VALUES {
            kernel_global!(DSP_VALUE_INITIALIZED)[index] = false;
            kernel_global!(DSP_VALUE_SMOOTHING_POSITIONS)[index] = usize::MAX;
        }
        for slot in 0..MAX_DSP_EFFECT_SLOTS {
            kernel_global!(DSP_EFFECT_INDICES)[slot] = 0;
            if let Some(buffer) = kernel_global!(DSP_EFFECT_BUFFERS)[slot].as_mut() {
                buffer.fill(0.0);
            }
        }
        clear_dsp_resource_slots();
        for index in 0..MAX_DSP_SAMPLE_NODES {
            kernel_global!(DSP_SAMPLE_NODE_INDICES)[index] = -1;
            kernel_global!(DSP_SAMPLE_ACTIVE_VOICE_LIMITS)[index] = 0;
        }
    }
}

#[no_mangle]
pub extern "C" fn resetDspVoiceState(slot: u32) {
    unsafe {
        let slot = slot as usize;
        if slot >= MAX_VOICE_SLOTS {
            return;
        }
        for index in 0..MAX_DSP_STATE {
            kernel_global!(DSP_VOICE_STATES)[slot][index] = 0.0;
        }
        for spread_slot in 0..MAX_DSP_SPREADS {
            if let Some(runtime) = kernel_global!(DSP_SPREAD_RUNTIMES)[spread_slot].as_mut() {
                runtime.states_by_context[slot + 1].clear();
                runtime.resources_by_context[slot + 1].clear();
            }
            if let Some(runtime) = kernel_global!(DSP_SPAWN_RUNTIMES)[spread_slot].as_mut() {
                runtime.instances_by_context[slot + 1].clear();
                runtime.previous_trigger_by_context[slot + 1] = false;
                runtime.previous_release_trigger_by_context[slot + 1] = false;
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn resetDspRuntimeState() {
    let preserved_buffer_slots = buffer_slots_preserved_on_reset();
    unsafe {
        if let Some(sequence) = (&mut *core::ptr::addr_of_mut!(kernel_global!(DSP_BOUNDED_PROGRAM))).as_mut() { sequence.reset(&preserved_buffer_slots); }
        for index in 0..kernel_global!(DSP_OP_COUNT) {
            kernel_global!(DSP_CONTROL_CACHES)[index].initialized = false;
        }
        for index in 0..MAX_DSP_REGS {
            kernel_global!(DSP_REGS)[index] = 0.0;
        }
        for index in 0..MAX_DSP_STATE {
            *dsp_state_ptr(index) = 0.0;
        }
        for slot in 0..MAX_VOICE_SLOTS {
            for index in 0..MAX_DSP_STATE {
                kernel_global!(DSP_VOICE_STATES)[slot][index] = 0.0;
            }
        }
        for spread_slot in 0..MAX_DSP_SPREADS {
            if let Some(runtime) = kernel_global!(DSP_SPREAD_RUNTIMES)[spread_slot].as_mut() {
                for context in 0..runtime.states_by_context.len() {
                    runtime.states_by_context[context].fill(0.0);
                    for resources in runtime.resources_by_context[context].iter_mut() {
                        resources.reset_for_transport(&preserved_buffer_slots);
                    }
                }
            }
            if let Some(runtime) = kernel_global!(DSP_SPAWN_RUNTIMES)[spread_slot].as_mut() {
                for context in 0..runtime.instances_by_context.len() {
                    if kernel_global!(DSP_REPEAT_CAPACITY) > 0 {
                        runtime.free_instances_by_context[context]
                            .extend(runtime.instances_by_context[context].drain(..));
                    } else {
                        runtime.instances_by_context[context].clear();
                    }
                    runtime.previous_trigger_by_context[context] = false;
                    runtime.previous_release_trigger_by_context[context] = false;
                }
            }
        }
        for slot in 0..MAX_DSP_EFFECT_SLOTS {
            kernel_global!(DSP_EFFECT_INDICES)[slot] = 0;
            if let Some(buffer) = kernel_global!(DSP_EFFECT_BUFFERS)[slot].as_mut() {
                buffer.fill(0.0);
            }
        }
        clear_dsp_buffers_except(&preserved_buffer_slots);
        reset_dsp_midi_notes();
        reset_dsp_tempo_clocks();
    }
}

#[no_mangle]
pub extern "C" fn seedDspRandom(seed: u32) {
    unsafe {
        kernel_global!(DSP_RANDOM_SEED_STREAM) = if seed == 0 { 0x6d2b_79f5 } else { seed };
    }
}

fn reset_dsp_tempo_clocks() {
    unsafe {
        for index in 0..MAX_DSP_TEMPO_SOURCES {
            kernel_global!(DSP_TEMPO_BEATS_BY_SOURCE)[index] = 0.0;
            kernel_global!(DSP_TEMPO_PREVIOUS_BEATS_BY_SOURCE)[index] = 0.0;
            kernel_global!(DSP_TEMPO_STARTED_BY_SOURCE)[index] = false;
            kernel_global!(DSP_TEMPO_STARTED_ON_FRAME_BY_SOURCE)[index] = false;
            kernel_global!(DSP_TEMPO_LAST_QUANTUM_BY_SOURCE)[index] = 0;
            kernel_global!(DSP_TEMPO_LAST_FRAME_BY_SOURCE)[index] = DSP_RENDER_FRAME_UNSET;
        }
        kernel_global!(DSP_RENDER_QUANTUM_ID) = 1;
    }
}

fn midi_note_frequency(note: f64) -> f64 {
    440.0 * 2.0_f64.powf((note - 69.0) / 12.0)
}

#[allow(static_mut_refs)]
unsafe fn reset_dsp_midi_notes() {
    kernel_global!(DSP_MIDI_HELD_NOTES)
        .get_or_insert_with(Vec::new)
        .clear();
    kernel_global!(DSP_MIDI_NOTE_EVENTS)
        .get_or_insert_with(VecDeque::new)
        .clear();
    kernel_global!(DSP_MIDI_OUTPUT_EVENTS)
        .get_or_insert_with(VecDeque::new)
        .clear();
    kernel_global!(DSP_MIDI_CURRENT_OUTPUT_EVENT) = EMPTY_DSP_MIDI_NOTE_EVENT;
    kernel_global!(DSP_MIDI_NOTE_EVENT_BLANK_PENDING) = false;
    kernel_global!(DSP_MIDI_CURRENT_EVENT_ACTIVE) = false;
    kernel_global!(DSP_MIDI_CURRENT_EVENT) = EMPTY_DSP_MIDI_NOTE_EVENT;
    kernel_global!(DSP_MIDI_MONO_NOTES) = [0.0; 17];
    kernel_global!(DSP_MIDI_MONO_FREQUENCIES) = [0.0; 17];
    kernel_global!(DSP_MIDI_MONO_VELOCITIES) = [0.0; 17];
    kernel_global!(DSP_MIDI_MONO_GATES) = [0.0; 17];
    kernel_global!(DSP_MIDI_MONO_TRIGGERS) = [0.0; 17];
}

#[allow(static_mut_refs)]
unsafe fn refresh_dsp_midi_mono_values(note_on_event: Option<DspMidiNoteEvent>) {
    if let Some(event) = note_on_event {
        kernel_global!(DSP_MIDI_MONO_TRIGGERS)[0] = 1.0;
        kernel_global!(DSP_MIDI_MONO_TRIGGERS)[event.channel] = 1.0;
    }

    for channel in 0..=16 {
        let active = kernel_global!(DSP_MIDI_HELD_NOTES)
            .as_ref()
            .and_then(|held| {
                held.iter()
                    .rev()
                    .find(|entry| channel == 0 || entry.channel == channel)
                    .copied()
            });
        if let Some(active) = active {
            kernel_global!(DSP_MIDI_MONO_NOTES)[channel] = active.note;
            kernel_global!(DSP_MIDI_MONO_FREQUENCIES)[channel] = midi_note_frequency(active.note);
            kernel_global!(DSP_MIDI_MONO_FREQUENCIES)[channel] *=
                2.0_f64.powf(kernel_global!(HOST_PITCH_BEND)[active.channel] / 12.0);
            kernel_global!(DSP_MIDI_MONO_VELOCITIES)[channel] = active.velocity;
            kernel_global!(DSP_MIDI_MONO_GATES)[channel] = 1.0;
        } else {
            kernel_global!(DSP_MIDI_MONO_NOTES)[channel] = 0.0;
            kernel_global!(DSP_MIDI_MONO_FREQUENCIES)[channel] = 0.0;
            kernel_global!(DSP_MIDI_MONO_VELOCITIES)[channel] = 0.0;
            kernel_global!(DSP_MIDI_MONO_GATES)[channel] = 0.0;
        }
    }
}

#[allow(static_mut_refs)]
unsafe fn advance_dsp_midi_note_event() {
    kernel_global!(DSP_MIDI_CURRENT_EVENT_ACTIVE) = false;
    kernel_global!(DSP_MIDI_CURRENT_EVENT) = EMPTY_DSP_MIDI_NOTE_EVENT;
    kernel_global!(DSP_MIDI_MONO_TRIGGERS) = [0.0; 17];

    if kernel_global!(DSP_MIDI_NOTE_EVENT_BLANK_PENDING) {
        kernel_global!(DSP_MIDI_NOTE_EVENT_BLANK_PENDING) = false;
        return;
    }

    let event = kernel_global!(DSP_MIDI_NOTE_EVENTS)
        .as_mut()
        .and_then(VecDeque::pop_front);
    let Some(event) = event else {
        return;
    };

    apply_dsp_midi_note_event(event);
    kernel_global!(DSP_MIDI_NOTE_EVENT_BLANK_PENDING) = true;
}

// Shared ordered note-state orchestration. Both adapters dequeue at most one
// note every two samples, with a blank sample between events for edge consumers.
#[allow(static_mut_refs)]
unsafe fn apply_dsp_midi_note_event(event: DspMidiNoteEvent) {
    let held = kernel_global!(DSP_MIDI_HELD_NOTES).get_or_insert_with(Vec::new);
    held.retain(|entry| {
        entry.channel != event.channel || (entry.note - event.note).abs() > 0.000001
    });
    if event.note_on {
        held.push(DspMidiHeldNote {
            channel: event.channel,
            note: event.note,
            velocity: event.velocity,
        });
    }

    kernel_global!(DSP_MIDI_CURRENT_EVENT_ACTIVE) = true;
    kernel_global!(DSP_MIDI_CURRENT_EVENT) = event;
    refresh_dsp_midi_mono_values(event.note_on.then_some(event));
}

#[no_mangle]
pub extern "C" fn dspMidiInputOverflows() -> f64 { unsafe { kernel_global!(DSP_MIDI_INPUT_OVERFLOWS) as f64 } }

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn queueDspMidiNoteEvent(note_on: u32, channel: u32, note: f64, velocity: f64) {
    unsafe {
        let events = kernel_global!(DSP_MIDI_NOTE_EVENTS).get_or_insert_with(VecDeque::new);
        if events.len() >= 4096 {
            kernel_global!(DSP_MIDI_INPUT_OVERFLOWS) += 1;
            return; // Reject newest; accepted events retain their order.
        }
        events.push_back(DspMidiNoteEvent {
            is_cc: false,
            note_on: note_on != 0 && velocity > 0.0,
            channel: (channel as usize).clamp(1, 16),
            note: if note.is_finite() {
                note.clamp(0.0, 127.0)
            } else {
                0.0
            },
            velocity: if velocity.is_finite() {
                velocity.clamp(0.0, 1.0)
            } else {
                0.0
            },
        });
    }
}

#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn takeDspMidiOutputEvent() -> i32 {
    unsafe {
        let Some(event) = kernel_global!(DSP_MIDI_OUTPUT_EVENTS)
            .as_mut()
            .and_then(VecDeque::pop_front)
        else {
            return 0;
        };
        kernel_global!(DSP_MIDI_CURRENT_OUTPUT_EVENT) = event;
        1
    }
}

#[no_mangle]
pub extern "C" fn dspMidiOutputEventNoteOn() -> i32 {
    unsafe { i32::from(kernel_global!(DSP_MIDI_CURRENT_OUTPUT_EVENT).note_on) }
}

#[no_mangle]
pub extern "C" fn dspMidiOutputEventIsCc() -> i32 {
    unsafe { i32::from(kernel_global!(DSP_MIDI_CURRENT_OUTPUT_EVENT).is_cc) }
}

#[no_mangle]
pub extern "C" fn dspMidiOutputEventChannel() -> u32 {
    unsafe { kernel_global!(DSP_MIDI_CURRENT_OUTPUT_EVENT).channel as u32 }
}

#[no_mangle]
pub extern "C" fn dspMidiOutputEventNote() -> f64 {
    unsafe { kernel_global!(DSP_MIDI_CURRENT_OUTPUT_EVENT).note }
}

#[no_mangle]
pub extern "C" fn dspMidiOutputEventVelocity() -> f64 {
    unsafe { kernel_global!(DSP_MIDI_CURRENT_OUTPUT_EVENT).velocity }
}

#[no_mangle]
pub extern "C" fn dspMidiOutputEventCc() -> f64 {
    unsafe { kernel_global!(DSP_MIDI_CURRENT_OUTPUT_EVENT).note }
}

#[no_mangle]
pub extern "C" fn dspMidiOutputEventValue() -> f64 {
    unsafe { kernel_global!(DSP_MIDI_CURRENT_OUTPUT_EVENT).velocity }
}

#[no_mangle]
pub extern "C" fn setDspMidiCc(channel: u32, cc: u32, value: f64) {
    unsafe {
        let channel = (channel as usize).min(16);
        let cc = cc as usize;
        if cc < 128 {
            let value = if value.is_finite() {
                value.clamp(0.0, 1.0)
            } else {
                0.0
            };
            kernel_global!(DSP_MIDI_CC_VALUES)[0][cc] = value;
            kernel_global!(DSP_MIDI_CC_VALUES)[channel][cc] = value;
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspTempo(bpm: f64) {
    unsafe {
        kernel_global!(DSP_TEMPO_BPM) = if bpm.is_finite() {
            bpm.clamp(1.0, 999.0)
        } else {
            120.0
        };
        kernel_global!(DSP_TEMPO_BPM_BY_SOURCE)[0] = kernel_global!(DSP_TEMPO_BPM);
    }
}

#[no_mangle]
pub extern "C" fn setDspTempoSource(source_index: u32, bpm: f64) {
    unsafe {
        let source_index = (source_index as usize).min(MAX_DSP_TEMPO_SOURCES - 1);
        let bpm = if bpm.is_finite() {
            bpm.clamp(1.0, 999.0)
        } else {
            120.0
        };
        kernel_global!(DSP_TEMPO_BPM_BY_SOURCE)[source_index] = bpm;
        if source_index == 0 {
            kernel_global!(DSP_TEMPO_BPM) = bpm;
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspSampleNode(slot: u32, node_index: i32) -> i32 {
    unsafe {
        let slot = slot as usize;
        if slot >= MAX_DSP_SAMPLE_NODES || node_index < 0 || node_index as usize >= MAX_NODES {
            return -1;
        }
        kernel_global!(DSP_SAMPLE_NODE_INDICES)[slot] = node_index;
        slot as i32
    }
}

#[no_mangle]
pub extern "C" fn dspSamplePlayhead(slot: u32) -> f64 {
    for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
        let playhead = dsp_sample_playhead_for_voice(slot as usize, voice);
        if playhead >= 0.0 {
            return playhead;
        }
    }
    -1.0
}

#[no_mangle]
pub extern "C" fn dspSamplePlayheadVoice(slot: u32, voice: u32) -> f64 {
    dsp_sample_playhead_for_voice(slot as usize, voice as usize)
}

fn dsp_sample_playhead_for_voice(slot: usize, voice: usize) -> f64 {
    unsafe {
        if slot >= MAX_DSP_SAMPLE_NODES || voice >= MAX_DSP_SAMPLE_PLAYER_VOICES {
            return -1.0;
        }
        let node_index = kernel_global!(DSP_SAMPLE_NODE_INDICES)[slot];
        if node_index < 0 || node_index as usize >= MAX_NODES {
            return -1.0;
        }
        let node_index = node_index as usize;
        let voice_slot = DSP_SAMPLE_VOICE_SLOT_START + voice;
        if !kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] {
            return -1.0;
        }
        let Some(sample_slot) = sample_slot_for_node(node_index) else {
            return -1.0;
        };
        let length = kernel_global!(SAMPLE_LENGTHS)[sample_slot];
        if length <= 1 {
            return -1.0;
        }
        (kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] / (length - 1) as f64)
            .clamp(0.0, 1.0)
    }
}

fn dsp_sample_playhead_from_state(
    slot: usize,
    state: &DspSamplePlaybackState,
    voice: usize,
) -> f64 {
    unsafe {
        if slot >= MAX_DSP_SAMPLE_NODES
            || state.sample_index != slot
            || voice >= MAX_DSP_SAMPLE_PLAYER_VOICES
            || !state.playing[voice]
        {
            return -1.0;
        }
        let node_index = kernel_global!(DSP_SAMPLE_NODE_INDICES)[slot];
        if node_index < 0 || node_index as usize >= MAX_NODES {
            return -1.0;
        }
        let Some(sample_slot) = sample_slot_for_node(node_index as usize) else {
            return -1.0;
        };
        let length = kernel_global!(SAMPLE_LENGTHS)[sample_slot];
        if length <= 1 {
            return -1.0;
        }
        (state.positions[voice] / (length - 1) as f64).clamp(0.0, 1.0)
    }
}

unsafe fn dsp_sample_slot_is_repeated(slot: usize) -> bool {
    if (&*core::ptr::addr_of!(kernel_global!(DSP_BOUNDED_PROGRAM))).as_ref().is_some_and(|p| p.has_sample(slot)) { return true; }
    for runtime_slot in 0..MAX_DSP_SPREADS {
        if kernel_global!(DSP_SPREAD_RUNTIMES)[runtime_slot]
            .as_ref()
            .and_then(|runtime| runtime.resource_layout.as_ref())
            .is_some_and(|layout| layout.sample_indices.contains(&slot))
        {
            return true;
        }
        if kernel_global!(DSP_SPAWN_RUNTIMES)[runtime_slot]
            .as_ref()
            .and_then(|runtime| runtime.resource_layout.as_ref())
            .is_some_and(|layout| layout.sample_indices.contains(&slot))
        {
            return true;
        }
    }
    false
}

#[no_mangle]
pub extern "C" fn dspSamplePlayheadCount(slot: u32) -> u32 {
    unsafe { if let Some(p) = (&*core::ptr::addr_of!(kernel_global!(DSP_BOUNDED_PROGRAM))).as_ref().filter(|p| p.has_sample(slot as usize)) {
        let mut count = 0; p.visit_samples(slot as usize,&mut |_,_| count+=1); return count;
    } }
    let slot = slot as usize;
    let mut count = 0usize;
    unsafe {
        // Repeated nodes leave the last instance in the shared workspace after
        // rendering. Only count that workspace for ordinary, non-repeated nodes
        // so the final instance is not reported twice.
        if !dsp_sample_slot_is_repeated(slot) {
            for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
                if dsp_sample_playhead_for_voice(slot, voice) >= 0.0 {
                    count += 1;
                }
            }
        }
        for runtime_slot in 0..MAX_DSP_SPREADS {
            let Some(runtime) = kernel_global!(DSP_SPREAD_RUNTIMES)[runtime_slot].as_ref() else {
                continue;
            };
            for resources in runtime.resources_by_context.iter().flatten() {
                for state in &resources.samples {
                    for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
                        if dsp_sample_playhead_from_state(slot, state, voice) >= 0.0 {
                            count += 1;
                        }
                    }
                }
            }
        }
        for runtime_slot in 0..MAX_DSP_SPREADS {
            let Some(runtime) = kernel_global!(DSP_SPAWN_RUNTIMES)[runtime_slot].as_ref() else {
                continue;
            };
            for instance in runtime.instances_by_context.iter().flatten() {
                for state in &instance.resources.samples {
                    for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
                        if dsp_sample_playhead_from_state(slot, state, voice) >= 0.0 {
                            count += 1;
                        }
                    }
                }
            }
        }
    }
    count.min(u32::MAX as usize) as u32
}

#[no_mangle]
pub extern "C" fn dspSamplePlayheadValue(slot: u32, target: u32) -> f64 {
    unsafe { if let Some(p) = (&*core::ptr::addr_of!(kernel_global!(DSP_BOUNDED_PROGRAM))).as_ref().filter(|p| p.has_sample(slot as usize)) {
        let mut index = 0; let mut value = -1.0;
        p.visit_samples(slot as usize,&mut |v,_| { if index == target { value=v; } index+=1; }); return value;
    } }
    let slot = slot as usize;
    let target = target as usize;
    let mut index = 0usize;
    unsafe {
        if !dsp_sample_slot_is_repeated(slot) {
            for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
                let playhead = dsp_sample_playhead_for_voice(slot, voice);
                if playhead < 0.0 {
                    continue;
                }
                if index == target {
                    return playhead;
                }
                index += 1;
            }
        }
        for runtime_slot in 0..MAX_DSP_SPREADS {
            let Some(runtime) = kernel_global!(DSP_SPREAD_RUNTIMES)[runtime_slot].as_ref() else {
                continue;
            };
            for resources in runtime.resources_by_context.iter().flatten() {
                for state in &resources.samples {
                    for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
                        let playhead = dsp_sample_playhead_from_state(slot, state, voice);
                        if playhead < 0.0 {
                            continue;
                        }
                        if index == target {
                            return playhead;
                        }
                        index += 1;
                    }
                }
            }
        }
        for runtime_slot in 0..MAX_DSP_SPREADS {
            let Some(runtime) = kernel_global!(DSP_SPAWN_RUNTIMES)[runtime_slot].as_ref() else {
                continue;
            };
            for instance in runtime.instances_by_context.iter().flatten() {
                for state in &instance.resources.samples {
                    for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
                        let playhead = dsp_sample_playhead_from_state(slot, state, voice);
                        if playhead < 0.0 {
                            continue;
                        }
                        if index == target {
                            return playhead;
                        }
                        index += 1;
                    }
                }
            }
        }
    }
    -1.0
}

#[no_mangle]
pub extern "C" fn dspSampleLatestPlayhead(slot: u32) -> f64 {
    unsafe { if let Some(p) = (&*core::ptr::addr_of!(kernel_global!(DSP_BOUNDED_PROGRAM))).as_ref().filter(|p| p.has_sample(slot as usize)) {
        let mut age = f64::INFINITY; let mut value = -1.0;
        p.visit_samples(slot as usize,&mut |v,a| { if a <= age { value=v; age=a; } }); return value;
    } }
    let slot = slot as usize;
    let mut latest_playhead = -1.0;
    let mut youngest_age = f64::INFINITY;
    unsafe {
        if !dsp_sample_slot_is_repeated(slot) && slot < MAX_DSP_SAMPLE_NODES {
            let node_index = kernel_global!(DSP_SAMPLE_NODE_INDICES)[slot];
            if node_index >= 0 && (node_index as usize) < MAX_NODES {
                for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
                    let playhead = dsp_sample_playhead_for_voice(slot, voice);
                    if playhead < 0.0 {
                        continue;
                    }
                    let voice_slot = DSP_SAMPLE_VOICE_SLOT_START + voice;
                    let age = kernel_global!(SAMPLE_PLAYBACK_AGES)[voice_slot][node_index as usize];
                    if age <= youngest_age {
                        youngest_age = age;
                        latest_playhead = playhead;
                    }
                }
            }
        }
        for runtime_slot in 0..MAX_DSP_SPREADS {
            let Some(runtime) = kernel_global!(DSP_SPREAD_RUNTIMES)[runtime_slot].as_ref() else {
                continue;
            };
            for resources in runtime.resources_by_context.iter().flatten() {
                for state in &resources.samples {
                    for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
                        let playhead = dsp_sample_playhead_from_state(slot, state, voice);
                        if playhead >= 0.0 && state.playback_ages[voice] <= youngest_age {
                            youngest_age = state.playback_ages[voice];
                            latest_playhead = playhead;
                        }
                    }
                }
            }
        }
        for runtime_slot in 0..MAX_DSP_SPREADS {
            let Some(runtime) = kernel_global!(DSP_SPAWN_RUNTIMES)[runtime_slot].as_ref() else {
                continue;
            };
            for instance in runtime.instances_by_context.iter().flatten() {
                for state in &instance.resources.samples {
                    for voice in 0..MAX_DSP_SAMPLE_PLAYER_VOICES {
                        let playhead = dsp_sample_playhead_from_state(slot, state, voice);
                        if playhead >= 0.0 && state.playback_ages[voice] <= youngest_age {
                            youngest_age = state.playback_ages[voice];
                            latest_playhead = playhead;
                        }
                    }
                }
            }
        }
    }
    latest_playhead
}

#[no_mangle]
pub extern "C" fn dspRepeatedStateValueCount(state: u32) -> u32 {
    let state = state as usize;
    let mut count = 0usize;
    unsafe {
        for runtime_slot in 0..MAX_DSP_SPREADS {
            let Some(runtime) = kernel_global!(DSP_SPREAD_RUNTIMES)[runtime_slot].as_ref() else {
                continue;
            };
            let Some(layout) = runtime.resource_layout.as_ref() else {
                continue;
            };
            if state < layout.state_start || state >= layout.state_start + layout.state_count {
                continue;
            }
            for states in &runtime.states_by_context {
                count = count.saturating_add(states.len() / layout.state_count.max(1));
            }
        }
        for runtime_slot in 0..MAX_DSP_SPREADS {
            let Some(runtime) = kernel_global!(DSP_SPAWN_RUNTIMES)[runtime_slot].as_ref() else {
                continue;
            };
            let Some(layout) = runtime.resource_layout.as_ref() else {
                continue;
            };
            if state < layout.state_start || state >= layout.state_start + layout.state_count {
                continue;
            }
            for instances in &runtime.instances_by_context {
                count = count.saturating_add(instances.len());
            }
        }
    }
    count.min(u32::MAX as usize) as u32
}

#[no_mangle]
pub extern "C" fn dspRepeatedStateValue(state: u32, target: u32) -> f64 {
    let state = state as usize;
    let target = target as usize;
    let mut index = 0usize;
    unsafe {
        for runtime_slot in 0..MAX_DSP_SPREADS {
            let Some(runtime) = kernel_global!(DSP_SPREAD_RUNTIMES)[runtime_slot].as_ref() else {
                continue;
            };
            let Some(layout) = runtime.resource_layout.as_ref() else {
                continue;
            };
            if state < layout.state_start || state >= layout.state_start + layout.state_count {
                continue;
            }
            let offset = state - layout.state_start;
            for states in &runtime.states_by_context {
                for item_state in states.chunks_exact(layout.state_count.max(1)) {
                    if index == target {
                        return item_state[offset];
                    }
                    index += 1;
                }
            }
        }
        for runtime_slot in 0..MAX_DSP_SPREADS {
            let Some(runtime) = kernel_global!(DSP_SPAWN_RUNTIMES)[runtime_slot].as_ref() else {
                continue;
            };
            let Some(layout) = runtime.resource_layout.as_ref() else {
                continue;
            };
            if state < layout.state_start || state >= layout.state_start + layout.state_count {
                continue;
            }
            let offset = state - layout.state_start;
            for instances in &runtime.instances_by_context {
                for instance in instances {
                    if index == target {
                        return instance.states[offset];
                    }
                    index += 1;
                }
            }
        }
    }
    0.0
}

#[no_mangle]
pub extern "C" fn getDspState(index: u32) -> f64 {
    unsafe {
        let index = index as usize;
        if index < MAX_DSP_STATE {
            *dsp_state_ptr(index)
        } else {
            0.0
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspState(index: u32, value: f64) {
    unsafe {
        let index = index as usize;
        if index < MAX_DSP_STATE {
            *dsp_state_ptr(index) = sanitize_control_value(value);
        }
    }
}

fn reset_dsp_scope(slot: usize) {
    unsafe {
        kernel_global!(DSP_SCOPE_DECIMATE_COUNTERS)[slot] = 0;
        kernel_global!(DSP_SCOPE_COUNTS)[slot] = 0;
        kernel_global!(DSP_SCOPE_WRITE_INDICES)[slot] = 0;
        for index in 0..LINK_SCOPE_POINTS {
            kernel_global!(DSP_SCOPE_SAMPLES)[slot][index] = 0.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn clearDspScopes() {
    unsafe {
        kernel_global!(DSP_BLOCK_PLAN) = None;
        kernel_global!(DSP_SCOPE_SLOT_COUNT) = 0;
        for slot in 0..MAX_DSP_SCOPES {
            kernel_global!(DSP_SCOPE_REGS)[slot] = -1;
            kernel_global!(DSP_SCOPE_POINTS_ACTIVE)[slot] = 256;
            kernel_global!(DSP_SCOPE_DECIMATE)[slot] = 1;
            reset_dsp_scope(slot);
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspScope(
    slot: u32,
    register: i32,
    seconds: f64,
    points: u32,
    sample_rate: f64,
) -> i32 {
    unsafe {
        kernel_global!(DSP_BLOCK_PLAN) = None;
        let slot = slot as usize;
        if slot >= MAX_DSP_SCOPES || register < 0 || register as usize >= MAX_DSP_REGS {
            return -1;
        }
        let safe_seconds = if seconds.is_finite() {
            seconds.clamp(0.01, LINK_SCOPE_SECONDS_MAX)
        } else {
            0.08
        };
        let safe_rate = if sample_rate.is_finite() && sample_rate > 0.0 {
            sample_rate
        } else {
            44_100.0
        };
        let active_points = (points as usize).clamp(32, LINK_SCOPE_POINTS);

        kernel_global!(DSP_SCOPE_REGS)[slot] = register;
        kernel_global!(DSP_SCOPE_SLOT_COUNT) = kernel_global!(DSP_SCOPE_SLOT_COUNT).max(slot + 1);
        kernel_global!(DSP_SCOPE_POINTS_ACTIVE)[slot] = active_points;
        kernel_global!(DSP_SCOPE_DECIMATE)[slot] = ((safe_seconds * safe_rate)
            / active_points as f64)
            .round()
            .max(1.0) as u32;
        reset_dsp_scope(slot);
        slot as i32
    }
}

#[no_mangle]
pub extern "C" fn dspScopePtr(slot: u32) -> *const f32 {
    let slot = slot as usize;
    if slot >= MAX_DSP_SCOPES {
        return core::ptr::null();
    }
    unsafe { core::ptr::addr_of!(kernel_global!(DSP_SCOPE_SAMPLES)[slot][0]) }
}

#[no_mangle]
pub extern "C" fn dspScopeCount(slot: u32) -> u32 {
    let slot = slot as usize;
    if slot >= MAX_DSP_SCOPES {
        return 0;
    }
    unsafe { kernel_global!(DSP_SCOPE_COUNTS)[slot] }
}

#[no_mangle]
pub extern "C" fn dspScopeWriteIndex(slot: u32) -> u32 {
    let slot = slot as usize;
    if slot >= MAX_DSP_SCOPES {
        return 0;
    }
    unsafe { kernel_global!(DSP_SCOPE_WRITE_INDICES)[slot] }
}

#[no_mangle]
pub extern "C" fn restoreDspScopeHistory(slot: u32, count: u32, write_index: u32) {
    unsafe {
        let slot = slot as usize;
        if slot >= MAX_DSP_SCOPES {
            return;
        }
        let points = kernel_global!(DSP_SCOPE_POINTS_ACTIVE)[slot].clamp(1, LINK_SCOPE_POINTS);
        kernel_global!(DSP_SCOPE_COUNTS)[slot] = (count as usize).min(points) as u32;
        kernel_global!(DSP_SCOPE_WRITE_INDICES)[slot] = (write_index as usize % points) as u32;
    }
}

#[no_mangle]
pub extern "C" fn clearDspMeters() {
    unsafe {
        kernel_global!(DSP_BLOCK_PLAN) = None;
        kernel_global!(DSP_METER_SLOT_COUNT) = 0;
        for slot in 0..MAX_DSP_METERS {
            kernel_global!(DSP_METER_REGS)[slot] = -1;
            kernel_global!(DSP_METER_SUMS)[slot] = 0.0;
            kernel_global!(DSP_METER_SIGNED_SUMS)[slot] = 0.0;
            kernel_global!(DSP_METER_COUNTS)[slot] = 0;
        }
    }
}

#[no_mangle]
pub extern "C" fn resetDspMeterLevels() {
    unsafe {
        for slot in 0..MAX_DSP_METERS {
            kernel_global!(DSP_METER_SUMS)[slot] = 0.0;
            kernel_global!(DSP_METER_SIGNED_SUMS)[slot] = 0.0;
            kernel_global!(DSP_METER_COUNTS)[slot] = 0;
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspMeter(slot: u32, register: i32) -> i32 {
    unsafe {
        kernel_global!(DSP_BLOCK_PLAN) = None;
        let slot = slot as usize;
        if slot >= MAX_DSP_METERS || register < 0 || register as usize >= MAX_DSP_REGS {
            return -1;
        }
        kernel_global!(DSP_METER_REGS)[slot] = register;
        kernel_global!(DSP_METER_SLOT_COUNT) = kernel_global!(DSP_METER_SLOT_COUNT).max(slot + 1);
        kernel_global!(DSP_METER_SUMS)[slot] = 0.0;
        kernel_global!(DSP_METER_SIGNED_SUMS)[slot] = 0.0;
        kernel_global!(DSP_METER_COUNTS)[slot] = 0;
        slot as i32
    }
}

#[no_mangle]
pub extern "C" fn dspMeterLevel(slot: u32) -> f64 {
    let slot = slot as usize;
    if slot >= MAX_DSP_METERS {
        return 0.0;
    }
    unsafe {
        if kernel_global!(DSP_METER_COUNTS)[slot] == 0 {
            0.0
        } else {
            kernel_global!(DSP_METER_SUMS)[slot] / kernel_global!(DSP_METER_COUNTS)[slot] as f64
        }
    }
}

#[no_mangle]
pub extern "C" fn dspMeterSignedLevel(slot: u32) -> f64 {
    let slot = slot as usize;
    if slot >= MAX_DSP_METERS {
        return 0.0;
    }
    unsafe {
        if kernel_global!(DSP_METER_COUNTS)[slot] == 0 {
            0.0
        } else {
            kernel_global!(DSP_METER_SIGNED_SUMS)[slot]
                / kernel_global!(DSP_METER_COUNTS)[slot] as f64
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspValue(index: u32, value: f64) {
    unsafe {
        let index = index as usize;
        if index < MAX_DSP_VALUES {
            let value = if value.is_finite() { value } else { 0.0 };
            kernel_global!(DSP_VALUE_TARGETS)[index] = value;
            if !kernel_global!(DSP_VALUE_INITIALIZED)[index] {
                kernel_global!(DSP_VALUES)[index] = value;
                kernel_global!(DSP_VALUE_INITIALIZED)[index] = true;
            } else if kernel_global!(DSP_VALUES)[index] != value {
                insert_smoothing_value(index);
            } else {
                remove_smoothing_value(index);
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn setDspValueImmediate(index: u32, value: f64) {
    unsafe {
        let index = index as usize;
        if index < MAX_DSP_VALUES {
            let value = if value.is_finite() { value } else { 0.0 };
            kernel_global!(DSP_VALUE_TARGETS)[index] = value;
            kernel_global!(DSP_VALUES)[index] = value;
            kernel_global!(DSP_VALUE_INITIALIZED)[index] = true;
            remove_smoothing_value(index);
        }
    }
}

fn valid_dsp_register(index: i32) -> bool {
    index >= 0 && (index as usize) < MAX_DSP_REGS
}

fn valid_dsp_value(index: i32) -> bool {
    index >= 0 && (index as usize) < MAX_DSP_VALUES
}

fn valid_optional_dsp_register(index: i32) -> bool {
    index == -1 || valid_dsp_register(index)
}

fn valid_dsp_register_value(value: f64) -> bool {
    if !value.is_finite() {
        return false;
    }
    let index = value as i32;
    value == index as f64 && valid_dsp_register(index)
}

fn valid_dsp_state_range(state: i32, count: usize) -> bool {
    state >= 0 && (state as usize).saturating_add(count) <= MAX_DSP_STATE
}

/// Off-render validation shared by owned preparation and the WASM adapter.
fn validate_engine_program(ops: &[DspOp], value_count: usize) -> Result<(), usize> {
    let mut defined = [false; MAX_DSP_REGS];
    for (index, op) in ops.iter().enumerate() {
        if !valid_engine_op(*op) || (op.opcode == DSP_OP_VALUE && op.a as usize >= value_count) {
            return Err(index);
        }
        let (inputs, count) = control_inputs(*op);
        if inputs[..count]
            .iter()
            .any(|r| *r >= 0 && !defined[*r as usize])
        {
            return Err(index);
        }
        if op.out >= 0 {
            defined[op.out as usize] = true;
        }
        if matches!(op.opcode, DSP_OP_SPREAD_BEGIN | DSP_OP_SPAWN_BEGIN) {
            if op.b <= index as i32
                || op.b as usize >= ops.len()
                || ops[op.b as usize].opcode
                    != if op.opcode == DSP_OP_SPREAD_BEGIN {
                        DSP_OP_SPREAD_END
                    } else {
                        DSP_OP_SPAWN_END
                    }
                || op.value.fract() != 0.0
                || op.value < 0.0
                || op.value >= MAX_DSP_SPREADS as f64
                || op.value2.fract() != 0.0
                || op.value2 < 0.0
                || !valid_dsp_state_range(op.state, op.value2 as usize)
            {
                return Err(index);
            }
        }
    }
    Ok(())
}

/// Validate installed public instructions after removing internal cache wrappers.
/// Return -1 on success, otherwise the first invalid instruction index.
#[no_mangle]
pub extern "C" fn validateDspProgram() -> i32 {
    unsafe {
        let ops: Vec<DspOp> = (&*core::ptr::addr_of!(kernel_global!(DSP_OPS)))[..kernel_global!(DSP_OP_COUNT)]
            .iter()
            .enumerate()
            .map(|(index, source)| {
                let mut op = *source;
                if op.opcode == DSP_OP_CACHED_CONTROL {
                    op.opcode = kernel_global!(DSP_CONTROL_CACHES)[index].opcode;
                    op.state = -1;
                }
                op
            })
            .collect();
        let initialized = core::ptr::addr_of!(kernel_global!(DSP_VALUE_INITIALIZED)).cast::<bool>();
        let value_count = (0..MAX_DSP_VALUES)
            .rev()
            .find(|index| *initialized.add(*index))
            .map_or(0, |i| i + 1);
        validate_engine_program(&ops, value_count)
            .err()
            .map_or(-1, |i| i as i32)
    }
}

// Public program instructions are contiguous; CachedControl is an internal
// installation optimization and must never be accepted as input bytecode.
fn valid_engine_op(op: DspOp) -> bool {
    if !(DSP_OP_VALUE..=DSP_OP_BEND).contains(&op.opcode)
        || ![op.out, op.a, op.b, op.c, op.d, op.e]
            .iter()
            .all(|v| *v >= -1 && *v < MAX_DSP_REGS as i32)
        || ![op.value, op.value2, op.value3, op.value4]
            .iter()
            .all(|v| v.is_finite())
    {
        return false;
    }
    let state_count = match op.opcode {
        DSP_OP_FILTER => match op.a {
            4 | 7 => 12,
            5 | 6 => 1,
            _ => 4,
        },
        DSP_OP_SELECT => 4,
        DSP_OP_REVERB if op.value2 >= 1.0 => reverb::STATE_COUNT,
        DSP_OP_FEEDBACK_READ
        | DSP_OP_FEEDBACK_WRITE
        | DSP_OP_DELAY
        | DSP_OP_CHORUS
        | DSP_OP_REVERB
        | DSP_OP_FOLLOWER
        | DSP_OP_SAMPLE
        | DSP_OP_TIME
        | DSP_OP_COMPRESS
        | DSP_OP_BLOCK_LATCH
        | DSP_OP_MIDI_NOTE_SEND => 1,
        DSP_OP_ENVELOPE | DSP_OP_SEQUENCER => 8,
        DSP_OP_ACCUMULATOR | DSP_OP_BUTTON => 3,
        DSP_OP_SLEW | DSP_OP_PLAYHEAD | DSP_OP_LIMITER | DSP_OP_DC_BLOCK => 2,
        DSP_OP_BUFFER => 7,
        DSP_OP_MIDI_CC_SEND => 5,
        DSP_OP_DISTORTION if op.value == 3.0 => 1,
        DSP_OP_ROLL_NOTE_EVENT => {
            5 + SEQUENCER_MAX_ROWS as usize * if op.value2 >= 0.5 { 3 } else { 2 }
        }
        _ => 0,
    };
    if state_count > 0 && !valid_dsp_state_range(op.state, state_count) {
        return false;
    }
    let no_output = matches!(
        op.opcode,
        DSP_OP_OUTPUT
            | DSP_OP_FEEDBACK_WRITE
            | DSP_OP_SAMPLE_PARAM
            | DSP_OP_MIDI_NOTE_SEND
            | DSP_OP_MIDI_CC_SEND
            | DSP_OP_SPREAD_BEGIN
            | DSP_OP_SPREAD_END
            | DSP_OP_SPAWN_END
    );
    if !no_output && !valid_dsp_register(op.out) {
        return false;
    }
    if (op.opcode == DSP_OP_OUTPUT && !(0..=1).contains(&op.b))
        || (op.opcode == DSP_OP_INPUT && !(-1..=1).contains(&op.b))
    {
        return false;
    }
    valid_hot_dsp_op(
        op.opcode, op.out, op.a, op.b, op.c, op.d, op.e, op.state, op.value, op.value2, op.value3,
        op.value4,
    )
}

fn valid_hot_dsp_op(
    opcode: i32,
    out: i32,
    a: i32,
    b: i32,
    c: i32,
    d: i32,
    e: i32,
    state: i32,
    value: f64,
    value2: f64,
    value3: f64,
    value4: f64,
) -> bool {
    match opcode {
        DSP_OP_REVERB => {
            valid_dsp_register(out)
                && valid_dsp_register(a)
                && valid_dsp_register(b)
                && valid_dsp_register(c)
                && valid_dsp_register(d)
                && if value2 == 0.0 {
                    valid_dsp_state_range(state, 1)
                } else {
                    valid_dsp_register(e)
                        && valid_dsp_register_value(value2 - 1.0)
                        && valid_dsp_state_range(state, reverb::STATE_COUNT)
                }
        }
        DSP_OP_VALUE => valid_dsp_register(out) && valid_dsp_value(a),
        DSP_OP_ADD | DSP_OP_MUL | DSP_OP_SUB | DSP_OP_DIV => {
            valid_dsp_register(out) && valid_dsp_register(a) && valid_dsp_register(b)
        }
        DSP_OP_NEG | DSP_OP_ABS | DSP_OP_BEND => valid_dsp_register(out) && valid_dsp_register(a),
        DSP_OP_OSC => {
            let frequency_is_valid = if a == 5 || a == 6 {
                valid_optional_dsp_register(b)
            } else {
                valid_dsp_register(b)
            };
            let state_count = match a {
                6 => 0,
                5 | 7 => 3,
                9 => 6,
                _ if e >= 0 => 4,
                _ => 1,
            };
            let state_is_valid = state_count == 0 || valid_dsp_state_range(state, state_count);
            let range_is_valid = value4 < 0.5
                || (valid_dsp_register_value(value2) && valid_dsp_register_value(value3));
            let oscillator_inputs_are_valid = if a == 9 || a == 12 {
                valid_dsp_register(c)
                    && valid_optional_dsp_register(d)
                    && valid_optional_dsp_register(e)
            } else {
                valid_optional_dsp_register(c)
                    && valid_optional_dsp_register(d)
                    && valid_optional_dsp_register(e)
            };

            valid_dsp_register(out)
                && frequency_is_valid
                && oscillator_inputs_are_valid
                && (a != 4 || valid_dsp_register_value(value))
                && (a != 12 || valid_dsp_register_value(value))
                && state_is_valid
                && range_is_valid
        }
        DSP_OP_END_TRIGGER => {
            let is_custom_wave = value >= 0.5;
            let source_state_count = if is_custom_wave { 6 } else { 7 };
            valid_dsp_register(out)
                && valid_dsp_state_range(a, source_state_count)
                && valid_dsp_state_range(state, if is_custom_wave { 5 } else { 1 })
                && (!is_custom_wave || (b >= 0 && (b as usize) < MAX_NODES))
        }
        DSP_OP_RANDOM => {
            valid_dsp_register(out)
                && valid_optional_dsp_register(a)
                && valid_dsp_register(b)
                && valid_dsp_register(c)
                && valid_dsp_state_range(state, 4)
        }
        _ => true,
    }
}

fn control_inputs(op: DspOp) -> ([i32; 5], usize) {
    match op.opcode {
        DSP_OP_ADD | DSP_OP_MUL | DSP_OP_SUB | DSP_OP_DIV => ([op.a, op.b, -1, -1, -1], 2),
        DSP_OP_NEG | DSP_OP_ABS | DSP_OP_BEND => ([op.a, -1, -1, -1, -1], 1),
        DSP_OP_FUNCTION => ([op.b, op.c, op.d, -1, -1], 3),
        DSP_OP_MAP => ([op.a, op.b, op.c, op.d, op.e], 5),
        DSP_OP_QUANTISE => ([op.a, op.b, op.c, -1, -1], 3),
        _ => ([-1; 5], 0),
    }
}

unsafe fn prepare_control_cache(index: usize, op: DspOp) {
    let (inputs, count) = control_inputs(op);
    let eligible = kernel_global!(DSP_CONTROL_REPEAT_DEPTH) == 0
        && count > 0
        && valid_dsp_register(op.out)
        && inputs[..count].iter().all(|&input| {
            valid_dsp_register(input) && kernel_global!(DSP_CONTROL_REGISTERS)[input as usize]
        });
    // Dependency provenance flows through cheap arithmetic, but checking a
    // cache for add/multiply/clamp costs more than evaluating it. The cache is
    // used only where it avoids the expensive maths in a stable chain.
    let worth_caching = matches!(
        op.opcode,
        DSP_OP_DIV | DSP_OP_BEND | DSP_OP_MAP | DSP_OP_QUANTISE
    ) || (op.opcode == DSP_OP_FUNCTION
        && matches!(op.a, 2 | 3 | 4 | 5 | 9 | 10 | 11 | 12));
    kernel_global!(DSP_CONTROL_CACHES)[index] = DspControlCache {
        opcode: op.opcode,
        inputs,
        count: if eligible && worth_caching {
            count as u8
        } else {
            0
        },
        ..EMPTY_DSP_CONTROL_CACHE
    };
    if valid_dsp_register(op.out) {
        kernel_global!(DSP_CONTROL_REGISTERS)[op.out as usize] =
            kernel_global!(DSP_CONTROL_REPEAT_DEPTH) == 0
                && (op.opcode == DSP_OP_VALUE || eligible);
    }
    if op.opcode == DSP_OP_SPREAD_BEGIN || op.opcode == DSP_OP_SPAWN_BEGIN {
        kernel_global!(DSP_CONTROL_REPEAT_DEPTH) += 1;
    } else if op.opcode == DSP_OP_SPREAD_END || op.opcode == DSP_OP_SPAWN_END {
        kernel_global!(DSP_CONTROL_REPEAT_DEPTH) =
            kernel_global!(DSP_CONTROL_REPEAT_DEPTH).saturating_sub(1);
    }
}

#[no_mangle]
pub extern "C" fn addDspOp(
    opcode: i32,
    out: i32,
    a: i32,
    b: i32,
    c: i32,
    d: i32,
    e: i32,
    state: i32,
    value: f64,
    value2: f64,
    value3: f64,
    value4: f64,
) -> i32 {
    unsafe {
        kernel_global!(DSP_BLOCK_PLAN) = None;
        if kernel_global!(DSP_OP_COUNT) >= MAX_DSP_OPS {
            return -1;
        }
        if !valid_engine_op(DspOp {
            opcode,
            out,
            a,
            b,
            c,
            d,
            e,
            state,
            value,
            value2,
            value3,
            value4,
        }) {
            return -1;
        }
        if dsp_op_uses_effect_buffer(opcode, a) {
            if prepare_dsp_effect_slot(state).is_none() {
                return -1;
            }
        }
        if opcode == DSP_OP_BUFFER && prepare_dsp_buffer_slot(state).is_none() {
            return -1;
        }
        let index = kernel_global!(DSP_OP_COUNT);
        kernel_global!(DSP_OPS)[index] = DspOp {
            opcode,
            out,
            a,
            b,
            c,
            d,
            e,
            state,
            value,
            value2,
            value3,
            value4,
        };
        prepare_control_cache(index, kernel_global!(DSP_OPS)[index]);
        if kernel_global!(DSP_CONTROL_CACHES)[index].count > 0 {
            kernel_global!(DSP_OPS)[index].opcode = DSP_OP_CACHED_CONTROL;
            kernel_global!(DSP_OPS)[index].state = index as i32;
        }
        kernel_global!(DSP_OP_COUNT) += 1;
        index as i32
    }
}

#[no_mangle]
pub extern "C" fn clearLinkMeters() {
    unsafe {
        for index in 0..MAX_LINKS {
            kernel_global!(LINK_METER_INPUT_SUMS)[index] = 0.0;
            kernel_global!(LINK_METER_OUTPUT_SUMS)[index] = 0.0;
            kernel_global!(LINK_METER_ENVELOPE_SUMS)[index] = 0.0;
            kernel_global!(LINK_METER_COUNTS)[index] = 0;
        }
    }
}

fn reset_link_scope() {
    unsafe {
        for index in 0..LINK_SCOPE_POINTS {
            kernel_global!(LINK_SCOPE_SAMPLES)[index] = 0.0;
        }
        kernel_global!(LINK_SCOPE_DECIMATE_COUNTER) = 0;
        kernel_global!(LINK_SCOPE_COUNT) = 0;
        kernel_global!(LINK_SCOPE_WRITE_INDEX) = 0;
        kernel_global!(LINK_SCOPE_LAST_ENVELOPE) = 0.0;
        kernel_global!(LINK_SCOPE_CAPTURE_ACTIVE) = false;
    }
}

#[no_mangle]
pub extern "C" fn setLinkScope(
    link_index: i32,
    mode: i32,
    seconds: f64,
    points: u32,
    sample_rate: f64,
) {
    unsafe {
        if link_index < 0 || link_index as usize >= kernel_global!(LINK_COUNT) {
            kernel_global!(LINK_SCOPE_LINK_INDEX) = -1;
            reset_link_scope();
            return;
        }
        kernel_global!(LINK_SCOPE_LINK_INDEX) = link_index;
        kernel_global!(LINK_SCOPE_MODE) = if mode == 1 || mode == 2 { mode } else { 0 };
        kernel_global!(LINK_SCOPE_POINTS_ACTIVE) = (points as usize).clamp(32, LINK_SCOPE_POINTS);
        let safe_seconds = if seconds.is_finite() {
            seconds.clamp(0.01, LINK_SCOPE_SECONDS_MAX)
        } else {
            0.08
        };
        let safe_rate = if sample_rate.is_finite() && sample_rate > 0.0 {
            sample_rate
        } else {
            44_100.0
        };
        kernel_global!(LINK_SCOPE_DECIMATE) = ((safe_seconds * safe_rate)
            / kernel_global!(LINK_SCOPE_POINTS_ACTIVE) as f64)
            .round()
            .max(1.0) as u32;
        reset_link_scope();
    }
}

/// Shared resource-node defaults for compiled CustomWave/Sample bindings.
/// Called by adapters during preparation; device/file acquisition stays outside.
#[no_mangle]
pub extern "C" fn addDspResourceNode(
    wave: i32,
    mode: i32,
    sustain_start: f64,
    sustain_end: f64,
    release: f64,
) -> i32 {
    if wave != 9 && wave != 10 {
        return -1;
    }
    addNode(
        wave,
        1,
        1.0,
        220.0,
        1.0,
        0,
        0,
        0,
        0.0,
        1.0,
        1.0,
        mode,
        sustain_start,
        sustain_end,
        0,
        0.0,
        1.0,
        1.0,
        4096.0,
        0.09,
        440.0,
        0.0,
        release,
    )
}

#[no_mangle]
pub extern "C" fn addNode(
    wave: i32,
    frequency_mode: i32,
    ratio: f64,
    frequency: f64,
    sync_beats: f64,
    quantise_enabled: i32,
    quantise_root: i32,
    quantise_scale: i32,
    quantise_glide: f64,
    speed: f64,
    audio_input_gain: f64,
    custom_mode: i32,
    custom_sustain_start: f64,
    custom_sustain_end: f64,
    sample_mode: i32,
    sample_start: f64,
    sample_end: f64,
    sample_stretch: f64,
    sample_cycle_length: f64,
    sample_overlap_ratio: f64,
    sample_original_frequency: f64,
    sample_attack: f64,
    sample_release: f64,
) -> i32 {
    unsafe {
        if kernel_global!(NODE_COUNT) >= MAX_NODES {
            return -1;
        }
        let index = kernel_global!(NODE_COUNT);
        kernel_global!(NODES)[index] = Node {
            wave,
            frequency_mode: frequency_mode.clamp(0, 2),
            ratio: ratio.clamp(0.0, 16.0),
            frequency: if wave == 11 {
                frequency.clamp(-1.0, 1.0)
            } else {
                frequency.clamp(0.0, 12_000.0)
            },
            sync_beats: sync_beats.clamp(1.0 / 64.0, 64.0),
            quantise_enabled: if quantise_enabled != 0 { 1 } else { 0 },
            quantise_root: quantise_root.clamp(-1, 11),
            quantise_scale: quantise_scale.clamp(0, 8),
            quantise_glide: quantise_glide.clamp(0.0, 4.0),
            speed: speed.clamp(0.01, 60.0),
            audio_input_gain: audio_input_gain.clamp(0.0, 4.0),
            custom_mode: custom_mode.clamp(CUSTOM_MODE_LOOP, CUSTOM_MODE_SUSTAIN_PING_PONG),
            custom_sustain_start: custom_sustain_start.clamp(0.0, 0.999),
            custom_sustain_end: custom_sustain_end
                .clamp((custom_sustain_start + 0.001).clamp(0.001, 1.0), 1.0),
            sample_mode: sample_mode.clamp(SAMPLE_MODE_ONE_SHOT, SAMPLE_MODE_PING_PONG),
            sample_start: sample_start.clamp(0.0, 1.0),
            sample_end: sample_end.clamp(0.0, 1.0),
            sample_attack: sample_attack.max(0.0),
            sample_release: sample_release.max(0.0),
            sample_stretch: sample_stretch.max(0.001),
            sample_cycle_length: sample_cycle_length.round().max(1.0),
            sample_overlap_ratio: sample_overlap_ratio.clamp(0.0, 1.0),
            sample_original_frequency: sample_original_frequency.max(0.0001),
        };
        kernel_global!(CUSTOM_WAVE_COUNTS)[index] = 0;
        kernel_global!(SAMPLE_SLOT_FOR_NODE)[index] = -1;
        kernel_global!(NODE_COUNT) += 1;
        index as i32
    }
}

#[no_mangle]
pub extern "C" fn addCustomWavePoint(node_index: i32, x: f64, y: f64) -> i32 {
    unsafe {
        if node_index < 0 || node_index as usize >= kernel_global!(NODE_COUNT) {
            return -1;
        }
        let node_index = node_index as usize;
        let count = kernel_global!(CUSTOM_WAVE_COUNTS)[node_index];
        if count >= MAX_CUSTOM_WAVE_POINTS {
            return -1;
        }
        kernel_global!(CUSTOM_WAVE_XS)[node_index][count] = x.clamp(0.0, 1.0);
        kernel_global!(CUSTOM_WAVE_YS)[node_index][count] = y.clamp(-1.0, 1.0);
        kernel_global!(CUSTOM_WAVE_COUNTS)[node_index] = count + 1;
        count as i32
    }
}

#[no_mangle]
pub extern "C" fn beginCustomWaveUpdate(node_index: i32) -> i32 {
    unsafe {
        if node_index < 0 || node_index as usize >= kernel_global!(NODE_COUNT) {
            return -1;
        }
        let node_index = node_index as usize;
        let count = kernel_global!(CUSTOM_WAVE_COUNTS)[node_index];
        kernel_global!(CUSTOM_WAVE_PREVIOUS_COUNTS)[node_index] = count;
        for point_index in 0..count {
            kernel_global!(CUSTOM_WAVE_PREVIOUS_XS)[node_index][point_index] =
                kernel_global!(CUSTOM_WAVE_XS)[node_index][point_index];
            kernel_global!(CUSTOM_WAVE_PREVIOUS_YS)[node_index][point_index] =
                kernel_global!(CUSTOM_WAVE_YS)[node_index][point_index];
        }
        kernel_global!(CUSTOM_WAVE_COUNTS)[node_index] = 0;
        kernel_global!(CUSTOM_WAVE_MORPH_TOTAL_FRAMES)[node_index] = 0;
        kernel_global!(CUSTOM_WAVE_MORPH_REMAINING_AT_QUANTUM_START)[node_index] = 0;
        kernel_global!(CUSTOM_WAVE_MORPH_CONSUMED_FRAMES)[node_index] = 0;
        0
    }
}

#[no_mangle]
pub extern "C" fn finishCustomWaveUpdate(node_index: i32, morph_frames: u32) -> i32 {
    unsafe {
        if node_index < 0 || node_index as usize >= kernel_global!(NODE_COUNT) {
            return -1;
        }
        let node_index = node_index as usize;
        if kernel_global!(CUSTOM_WAVE_COUNTS)[node_index] < 2
            || kernel_global!(CUSTOM_WAVE_PREVIOUS_COUNTS)[node_index] < 2
        {
            kernel_global!(CUSTOM_WAVE_PREVIOUS_COUNTS)[node_index] = 0;
            return -1;
        }
        let frames = morph_frames.max(1);
        kernel_global!(CUSTOM_WAVE_MORPH_TOTAL_FRAMES)[node_index] = frames;
        kernel_global!(CUSTOM_WAVE_MORPH_REMAINING_AT_QUANTUM_START)[node_index] = frames;
        kernel_global!(CUSTOM_WAVE_MORPH_CONSUMED_FRAMES)[node_index] = 0;
        0
    }
}

#[no_mangle]
pub extern "C" fn setNodeFrequencyMode(index: u32, frequency_mode: i32) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].frequency_mode = frequency_mode.clamp(0, 2);
        }
    }
}

#[no_mangle]
pub extern "C" fn setTempo(tempo: f64) {
    unsafe {
        kernel_global!(TEMPO) = tempo.clamp(20.0, 300.0);
    }
}

#[no_mangle]
pub extern "C" fn setNodeSyncBeats(index: u32, sync_beats: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].sync_beats = sync_beats.clamp(1.0 / 64.0, 64.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeRatio(index: u32, ratio: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].ratio = ratio.clamp(0.0, 16.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeFrequency(index: u32, frequency: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].frequency =
                if kernel_global!(NODES)[index as usize].wave == 11 {
                    frequency.clamp(-1.0, 1.0)
                } else {
                    frequency.clamp(0.0, 12_000.0)
                };
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeQuantiseEnabled(index: u32, enabled: i32) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].quantise_enabled =
                if enabled != 0 { 1 } else { 0 };
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeQuantiseRoot(index: u32, root: i32) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].quantise_root = root.clamp(-1, 11);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeQuantiseScale(index: u32, scale: i32) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].quantise_scale = scale.clamp(0, 8);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeQuantiseGlide(index: u32, glide: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].quantise_glide = glide.clamp(0.0, 4.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSpeed(index: u32, speed: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].speed = speed.clamp(0.01, 60.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeAudioInputGain(index: u32, gain: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].audio_input_gain = gain.clamp(0.0, 4.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleMode(index: u32, mode: i32) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].sample_mode =
                mode.clamp(SAMPLE_MODE_ONE_SHOT, SAMPLE_MODE_PING_PONG);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleStart(index: u32, start: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].sample_start = start.clamp(0.0, 1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleEnd(index: u32, end: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].sample_end = end.clamp(0.0, 1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleStretch(index: u32, stretch: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].sample_stretch = stretch.max(0.001);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleCycleLength(index: u32, cycle_length: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].sample_cycle_length =
                cycle_length.round().max(1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleOverlapRatio(index: u32, overlap_ratio: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].sample_overlap_ratio =
                overlap_ratio.clamp(0.0, 1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setNodeSampleOriginalFrequency(index: u32, frequency: f64) {
    unsafe {
        if (index as usize) < kernel_global!(NODE_COUNT) {
            kernel_global!(NODES)[index as usize].sample_original_frequency = frequency.max(0.0001);
        }
    }
}

fn clamp_link_amount(amount: f64) -> f64 {
    amount.clamp(-LINK_AMOUNT_LIMIT, LINK_AMOUNT_LIMIT)
}

#[no_mangle]
pub extern "C" fn addLink(
    from: i32,
    to: i32,
    amount: f64,
    delay: f64,
    noise: f64,
    pan: f64,
    target: i32,
    parameter_mode: i32,
    velocity_sensitivity: f64,
    drone: i32,
    signal_mode: i32,
    follower_attack: f64,
    follower_release: f64,
    filter_type: i32,
    filter_cutoff: f64,
    filter_resonance: f64,
    distortion_type: i32,
    distortion_gain: f64,
    env_delay: f64,
    env_attack: f64,
    env_decay: f64,
    env_sustain: f64,
    env_release: f64,
    map_src_min: f64,
    map_src_max: f64,
    map_target_min: f64,
    map_target_max: f64,
) -> i32 {
    unsafe {
        if kernel_global!(LINK_COUNT) >= MAX_LINKS
            || from < 0
            || from as usize >= kernel_global!(NODE_COUNT)
        {
            return -1;
        }
        if to >= 0 && to as usize >= kernel_global!(NODE_COUNT) {
            return -1;
        }
        if to < AUDIO_TARGET {
            let target_index = link_target_index(to);
            if target_index.is_none() || target_index.unwrap() >= MAX_LINKS {
                return -1;
            }
        } else if to != AUDIO_TARGET && to < 0 {
            return -1;
        }
        let index = kernel_global!(LINK_COUNT);
        kernel_global!(LINKS)[index] = Link {
            from,
            to,
            amount: clamp_link_amount(amount),
            delay: delay.clamp(0.0, 3.0),
            noise: noise.clamp(0.0, 1.0),
            pan: pan.clamp(-1.0, 1.0),
            target,
            parameter_mode: parameter_mode.clamp(PARAM_MODE_SET, PARAM_MODE_BEND),
            velocity_sensitivity: velocity_sensitivity.clamp(-8.0, 8.0),
            drone,
            signal_mode,
            follower_attack: follower_attack.clamp(0.001, 2.0),
            follower_release: follower_release.clamp(0.001, 4.0),
            filter_type,
            filter_cutoff: if filter_type == 4 {
                filter_cutoff.clamp(0.0, 1.0)
            } else if filter_type == 5 || filter_type == 6 {
                filter_cutoff.clamp(20.0, 5_000.0)
            } else {
                filter_cutoff.clamp(20.0, 12_000.0)
            },
            filter_resonance: filter_resonance.clamp(
                if filter_type == 5 || filter_type == 6 {
                    -0.98
                } else {
                    0.1
                },
                if filter_type == 4 {
                    FORMANT_INTENSITY_MAX
                } else if filter_type == 5 || filter_type == 6 {
                    0.98
                } else {
                    12.0
                },
            ),
            distortion_type: distortion_type.clamp(0, 5),
            distortion_gain: distortion_gain.clamp(0.1, 40.0),
            env_delay: env_delay.clamp(0.0, 4.0),
            env_attack: env_attack.clamp(0.001, 4.0),
            env_decay: env_decay.clamp(0.001, 4.0),
            env_sustain: env_sustain.clamp(0.0, 1.0),
            env_release: env_release.clamp(0.001, 6.0),
            map_src_min,
            map_src_max,
            map_target_min,
            map_target_max,
        };
        if delay > 0.0 {
            prepare_delay_slot_for_link(index);
        }
        if filter_type == 5 || filter_type == 6 {
            prepare_comb_slot_for_link(index);
        }
        if let Some(target_index) = link_target_index(to) {
            if target_index < MAX_LINKS {
                kernel_global!(LINK_NEXT_MODULATOR)[index] =
                    kernel_global!(LINK_FIRST_MODULATOR)[target_index];
                kernel_global!(LINK_FIRST_MODULATOR)[target_index] = index as i32;
                if target == TARGET_ENVELOPE_TRIGGER {
                    kernel_global!(LINK_HAS_ENVELOPE_TRIGGER)[target_index] = true;
                }
            }
        }
        kernel_global!(LINK_COUNT) += 1;
        index as i32
    }
}

#[no_mangle]
pub extern "C" fn setLinkNoise(index: u32, noise: f64) {
    unsafe {
        if (index as usize) < kernel_global!(LINK_COUNT) {
            kernel_global!(LINKS)[index as usize].noise = noise.clamp(0.0, 1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkVelocitySensitivity(index: u32, velocity_sensitivity: f64) {
    unsafe {
        if (index as usize) < kernel_global!(LINK_COUNT) {
            kernel_global!(LINKS)[index as usize].velocity_sensitivity =
                velocity_sensitivity.clamp(-8.0, 8.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkFilterCutoff(index: u32, cutoff: f64) {
    unsafe {
        if (index as usize) < kernel_global!(LINK_COUNT) {
            kernel_global!(LINKS)[index as usize].filter_cutoff =
                if kernel_global!(LINKS)[index as usize].filter_type == 4 {
                    cutoff.clamp(0.0, 1.0)
                } else if kernel_global!(LINKS)[index as usize].filter_type == 5
                    || kernel_global!(LINKS)[index as usize].filter_type == 6
                {
                    cutoff.clamp(20.0, 5_000.0)
                } else {
                    cutoff.clamp(20.0, 12_000.0)
                };
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkFilterResonance(index: u32, resonance: f64) {
    unsafe {
        if (index as usize) < kernel_global!(LINK_COUNT) {
            kernel_global!(LINKS)[index as usize].filter_resonance = resonance.clamp(
                if kernel_global!(LINKS)[index as usize].filter_type == 5
                    || kernel_global!(LINKS)[index as usize].filter_type == 6
                {
                    -0.98
                } else {
                    0.1
                },
                if kernel_global!(LINKS)[index as usize].filter_type == 4 {
                    FORMANT_INTENSITY_MAX
                } else if kernel_global!(LINKS)[index as usize].filter_type == 5
                    || kernel_global!(LINKS)[index as usize].filter_type == 6
                {
                    0.98
                } else {
                    12.0
                },
            );
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkDistortionGain(index: u32, gain: f64) {
    unsafe {
        if (index as usize) < kernel_global!(LINK_COUNT) {
            kernel_global!(LINKS)[index as usize].distortion_gain = gain.clamp(0.1, 40.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkAmount(index: u32, amount: f64) {
    unsafe {
        if (index as usize) < kernel_global!(LINK_COUNT) {
            kernel_global!(LINKS)[index as usize].amount = clamp_link_amount(amount);
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkDelay(index: u32, delay: f64) {
    unsafe {
        if (index as usize) < kernel_global!(LINK_COUNT) {
            kernel_global!(LINKS)[index as usize].delay = delay.clamp(0.0, 3.0);
            if delay > 0.0 {
                prepare_delay_slot_for_link(index as usize);
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn setLinkPan(index: u32, pan: f64) {
    unsafe {
        if (index as usize) < kernel_global!(LINK_COUNT) {
            kernel_global!(LINKS)[index as usize].pan = pan.clamp(-1.0, 1.0);
        }
    }
}

#[no_mangle]
pub extern "C" fn resetPhases() {
    reset_dsp_tempo_clocks();

    let phases = kernel_address!(mut PHASES).cast::<f64>();
    let quantised_frequencies = kernel_address!(mut QUANTISED_FREQUENCIES).cast::<f64>();
    let quantised_targets = kernel_address!(mut QUANTISED_TARGETS).cast::<f64>();
    let quantised_steps = kernel_address!(mut QUANTISED_STEPS).cast::<f64>();
    let quantised_remaining = kernel_address!(mut QUANTISED_REMAINING).cast::<u32>();
    let feedback = kernel_address!(mut FEEDBACK).cast::<f64>();
    let sample_holds = kernel_address!(mut SAMPLE_HOLDS).cast::<f64>();
    let sample_hold_set = kernel_address!(mut SAMPLE_HOLD_SET).cast::<bool>();
    let perlin_current = kernel_address!(mut PERLIN_CURRENT).cast::<f64>();
    let perlin_next = kernel_address!(mut PERLIN_NEXT).cast::<f64>();
    let perlin_set = kernel_address!(mut PERLIN_SET).cast::<bool>();
    let custom_wave_done = kernel_address!(mut CUSTOM_WAVE_DONE).cast::<bool>();
    let custom_wave_directions = kernel_address!(mut CUSTOM_WAVE_DIRECTIONS).cast::<f64>();
    let custom_wave_triggered = kernel_address!(mut CUSTOM_WAVE_TRIGGERED).cast::<bool>();
    let sample_playing = kernel_address!(mut SAMPLE_PLAYING).cast::<bool>();
    let sample_positions = kernel_address!(mut SAMPLE_POSITIONS).cast::<f64>();
    let sample_directions = kernel_address!(mut SAMPLE_DIRECTIONS).cast::<f64>();
    let sample_frequency_directions =
        kernel_address!(mut SAMPLE_FREQUENCY_DIRECTIONS).cast::<f64>();
    let sample_has_advanced = kernel_address!(mut SAMPLE_HAS_ADVANCED).cast::<bool>();
    let sample_start_values = kernel_address!(mut SAMPLE_START_VALUES).cast::<f64>();
    let sample_last_outputs = kernel_address!(mut SAMPLE_LAST_OUTPUTS).cast::<f64>();
    let sample_retrigger_outputs = kernel_address!(mut SAMPLE_RETRIGGER_OUTPUTS).cast::<f64>();
    let sample_retrigger_fade_ages = kernel_address!(mut SAMPLE_RETRIGGER_FADE_AGES).cast::<f64>();
    let sample_retrigger_fade_durations =
        kernel_address!(mut SAMPLE_RETRIGGER_FADE_DURATIONS).cast::<f64>();
    let sample_playback_ages = kernel_address!(mut SAMPLE_PLAYBACK_AGES).cast::<f64>();
    let sample_release_ages = kernel_address!(mut SAMPLE_RELEASE_AGES).cast::<f64>();
    let delay_indices = kernel_address!(mut LINK_DELAY_INDICES).cast::<usize>();
    let delay_ready = kernel_address!(mut LINK_DELAY_READY).cast::<bool>();
    let comb_indices = kernel_address!(mut LINK_COMB_INDICES).cast::<usize>();
    let comb_ready = kernel_address!(mut LINK_COMB_READY).cast::<bool>();
    let trigger_armed = kernel_address!(mut LINK_TRIGGER_ARMED).cast::<bool>();
    let trigger_start_age = kernel_address!(mut LINK_TRIGGER_START_AGE).cast::<f64>();
    let trigger_release_age = kernel_address!(mut LINK_TRIGGER_RELEASE_AGE).cast::<f64>();
    let followers = kernel_address!(mut LINK_FOLLOWERS).cast::<f64>();
    let filters = kernel_address!(mut LINK_FILTERS).cast::<FilterState>();
    let formant_filters = kernel_address!(mut LINK_FORMANT_FILTERS).cast::<FilterState>();
    let link_stack = kernel_address!(mut LINK_PARAM_STACK).cast::<bool>();
    let total = MAX_VOICE_SLOTS * MAX_NODES;
    for index in 0..total {
        unsafe {
            *phases.add(index) = 0.0;
            *quantised_frequencies.add(index) = 0.0;
            *quantised_targets.add(index) = 0.0;
            *quantised_steps.add(index) = 0.0;
            *quantised_remaining.add(index) = 0;
            *feedback.add(index) = 0.0;
            *sample_holds.add(index) = 0.0;
            *sample_hold_set.add(index) = false;
            *perlin_current.add(index) = 0.0;
            *perlin_next.add(index) = 0.0;
            *perlin_set.add(index) = false;
            *custom_wave_done.add(index) = false;
            *custom_wave_directions.add(index) = 1.0;
            *custom_wave_triggered.add(index) = false;
            *sample_playing.add(index) = false;
            *sample_positions.add(index) = 0.0;
            *sample_directions.add(index) = 1.0;
            *sample_frequency_directions.add(index) = 1.0;
            *sample_has_advanced.add(index) = false;
            *sample_start_values.add(index) = 0.0;
            *sample_last_outputs.add(index) = 0.0;
            *sample_retrigger_outputs.add(index) = 0.0;
            *sample_retrigger_fade_ages.add(index) = -1.0;
            *sample_retrigger_fade_durations.add(index) = 0.0;
            *sample_playback_ages.add(index) = 0.0;
            *sample_release_ages.add(index) = -1.0;
            *core::ptr::addr_of_mut!(kernel_global!(SAMPLE_STRETCH_PHASES))
                .cast::<f64>()
                .add(index) = 0.0;
            *core::ptr::addr_of_mut!(kernel_global!(SAMPLE_STRETCH_ANCHORS))
                .cast::<f64>()
                .add(index) = 0.0;
        }
    }
    // Sample Player voices have their own playback slots in addition to the
    // normal MIDI and drone slots. Reset the complete sample state pool.
    for index in 0..(MAX_SAMPLE_VOICE_SLOTS * MAX_NODES) {
        unsafe {
            *sample_playing.add(index) = false;
            *sample_positions.add(index) = 0.0;
            *sample_directions.add(index) = 1.0;
            *sample_frequency_directions.add(index) = 1.0;
            *sample_has_advanced.add(index) = false;
            *sample_start_values.add(index) = 0.0;
            *sample_last_outputs.add(index) = 0.0;
            *sample_retrigger_outputs.add(index) = 0.0;
            *sample_retrigger_fade_ages.add(index) = -1.0;
            *sample_retrigger_fade_durations.add(index) = 0.0;
            *sample_playback_ages.add(index) = 0.0;
            *sample_release_ages.add(index) = -1.0;
            *core::ptr::addr_of_mut!(kernel_global!(SAMPLE_STRETCH_PHASES))
                .cast::<f64>()
                .add(index) = 0.0;
            *core::ptr::addr_of_mut!(kernel_global!(SAMPLE_STRETCH_ANCHORS))
                .cast::<f64>()
                .add(index) = 0.0;
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_LINKS) {
        unsafe {
            *followers.add(index) = 0.0;
            *filters.add(index) = EMPTY_FILTER_STATE;
            *trigger_armed.add(index) = true;
            *trigger_start_age.add(index) = -1.0;
            *trigger_release_age.add(index) = -1.0;
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_LINKS * MAX_FORMANT_BANDS) {
        unsafe {
            *formant_filters.add(index) = EMPTY_FILTER_STATE;
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_DELAY_SLOTS) {
        unsafe {
            *delay_indices.add(index) = 0;
            *delay_ready.add(index) = false;
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_DELAY_SLOTS) {
        unsafe {
            if let Some(buffer) = kernel_global!(LINK_DELAY_BUFFERS)[index].as_mut() {
                buffer.fill(0.0);
            }
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_COMB_SLOTS) {
        unsafe {
            *comb_indices.add(index) = 0;
            *comb_ready.add(index) = false;
        }
    }
    for index in 0..(MAX_VOICE_SLOTS * MAX_COMB_SLOTS) {
        unsafe {
            if let Some(buffer) = kernel_global!(LINK_COMB_BUFFERS)[index].as_mut() {
                buffer.fill(0.0);
            }
        }
    }
    for index in 0..MAX_LINKS {
        unsafe {
            *link_stack.add(index) = false;
        }
    }
}

#[no_mangle]
pub extern "C" fn resetVoiceSlot(voice_slot: u32) {
    let voice_slot = voice_slot as usize;
    if voice_slot >= MAX_VOICE_SLOTS {
        return;
    }
    unsafe {
        for node_index in 0..MAX_NODES {
            kernel_global!(PHASES)[voice_slot][node_index] = if node_index
                < kernel_global!(NODE_COUNT)
                && kernel_global!(NODES)[node_index].wave != 9
            {
                random_unit(voice_slot)
            } else {
                0.0
            };
            kernel_global!(QUANTISED_FREQUENCIES)[voice_slot][node_index] = 0.0;
            kernel_global!(QUANTISED_TARGETS)[voice_slot][node_index] = 0.0;
            kernel_global!(QUANTISED_STEPS)[voice_slot][node_index] = 0.0;
            kernel_global!(QUANTISED_REMAINING)[voice_slot][node_index] = 0;
            kernel_global!(FEEDBACK)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_HOLDS)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_HOLD_SET)[voice_slot][node_index] = false;
            kernel_global!(PERLIN_CURRENT)[voice_slot][node_index] = 0.0;
            kernel_global!(PERLIN_NEXT)[voice_slot][node_index] = 0.0;
            kernel_global!(PERLIN_SET)[voice_slot][node_index] = false;
            kernel_global!(CUSTOM_WAVE_DONE)[voice_slot][node_index] = false;
            kernel_global!(CUSTOM_WAVE_DIRECTIONS)[voice_slot][node_index] = 1.0;
            kernel_global!(CUSTOM_WAVE_TRIGGERED)[voice_slot][node_index] = false;
            kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] = false;
            kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index] = 1.0;
            kernel_global!(SAMPLE_FREQUENCY_DIRECTIONS)[voice_slot][node_index] = 1.0;
            kernel_global!(SAMPLE_HAS_ADVANCED)[voice_slot][node_index] = false;
            kernel_global!(SAMPLE_PLAYBACK_AGES)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index] = -1.0;
            kernel_global!(SAMPLE_START_VALUES)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_LAST_OUTPUTS)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_RETRIGGER_OUTPUTS)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_RETRIGGER_FADE_AGES)[voice_slot][node_index] = -1.0;
            kernel_global!(SAMPLE_RETRIGGER_FADE_DURATIONS)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_STRETCH_ANCHORS)[voice_slot][node_index] = 0.0;
            if node_index < kernel_global!(NODE_COUNT)
                && kernel_global!(NODES)[node_index].wave == 10
            {
                start_sample_player(
                    node_index,
                    voice_slot,
                    kernel_global!(NODES)[node_index],
                    0.0,
                    0.0,
                );
            }
        }
        for link_index in 0..MAX_LINKS {
            kernel_global!(LINK_TRIGGER_ARMED)[voice_slot][link_index] = true;
            kernel_global!(LINK_TRIGGER_START_AGE)[voice_slot][link_index] = -1.0;
            kernel_global!(LINK_TRIGGER_RELEASE_AGE)[voice_slot][link_index] = -1.0;
            kernel_global!(LINK_FOLLOWERS)[voice_slot][link_index] = 0.0;
            kernel_global!(LINK_FILTERS)[voice_slot][link_index] = EMPTY_FILTER_STATE;
            for band_index in 0..MAX_FORMANT_BANDS {
                kernel_global!(LINK_FORMANT_FILTERS)[voice_slot][link_index][band_index] =
                    EMPTY_FILTER_STATE;
            }
        }
        for slot_index in 0..MAX_DELAY_SLOTS {
            kernel_global!(LINK_DELAY_INDICES)[voice_slot][slot_index] = 0;
            kernel_global!(LINK_DELAY_READY)[voice_slot][slot_index] = false;
            if let Some(buffer) = kernel_global!(LINK_DELAY_BUFFERS)
                [voice_slot * MAX_DELAY_SLOTS + slot_index]
                .as_mut()
            {
                buffer.fill(0.0);
            }
        }
        for slot_index in 0..MAX_COMB_SLOTS {
            kernel_global!(LINK_COMB_INDICES)[voice_slot][slot_index] = 0;
            kernel_global!(LINK_COMB_READY)[voice_slot][slot_index] = false;
            if let Some(buffer) =
                kernel_global!(LINK_COMB_BUFFERS)[voice_slot * MAX_COMB_SLOTS + slot_index].as_mut()
            {
                buffer.fill(0.0);
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn resetVoiceSlotPhases(voice_slot: u32) {
    let voice_slot = voice_slot as usize;
    if voice_slot >= MAX_VOICE_SLOTS {
        return;
    }
    unsafe {
        for node_index in 0..MAX_NODES {
            kernel_global!(PHASES)[voice_slot][node_index] = 0.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn armCustomOnceTriggers(voice_slot: u32) {
    let voice_slot = voice_slot as usize;
    if voice_slot >= MAX_VOICE_SLOTS {
        return;
    }
    unsafe {
        for node_index in 0..kernel_global!(NODE_COUNT) {
            let node = kernel_global!(NODES)[node_index];
            if node.wave == 9
                && node.custom_mode == CUSTOM_MODE_ONCE
                && !kernel_global!(CUSTOM_WAVE_TRIGGERED)[voice_slot][node_index]
            {
                kernel_global!(CUSTOM_WAVE_DONE)[voice_slot][node_index] = true;
            }
        }
    }
}

fn next_stamp() -> u32 {
    unsafe {
        kernel_global!(CURRENT_STAMP) = kernel_global!(CURRENT_STAMP).wrapping_add(1);
        if kernel_global!(CURRENT_STAMP) == 0 {
            let stamps = core::ptr::addr_of_mut!(kernel_global!(CACHE_STAMPS)).cast::<u32>();
            for index in 0..MAX_NODES {
                *stamps.add(index) = 0;
            }
            kernel_global!(CURRENT_STAMP) = 1;
        }
        kernel_global!(CURRENT_STAMP)
    }
}

fn normalize_phase(phase: f64) -> f64 {
    phase - phase.floor()
}

fn link_target_index(target: i32) -> Option<usize> {
    if target <= LINK_TARGET_BASE {
        Some((LINK_TARGET_BASE - target) as usize)
    } else {
        None
    }
}

fn observe_link_meter(link_index: usize, input: f64, output: f64, envelope: f64) {
    unsafe {
        if link_index >= MAX_LINKS {
            return;
        }
        kernel_global!(LINK_METER_INPUT_SUMS)[link_index] += input.abs();
        kernel_global!(LINK_METER_OUTPUT_SUMS)[link_index] += output.abs();
        kernel_global!(LINK_METER_ENVELOPE_SUMS)[link_index] += envelope.abs();
        kernel_global!(LINK_METER_COUNTS)[link_index] =
            kernel_global!(LINK_METER_COUNTS)[link_index].saturating_add(1);
    }
    observe_link_scope(link_index, output, envelope);
}

fn observe_link_scope(link_index: usize, output: f64, envelope: f64) {
    unsafe {
        if kernel_global!(LINK_SCOPE_LINK_INDEX) != link_index as i32
            || kernel_global!(LINK_SCOPE_POINTS_ACTIVE) == 0
        {
            return;
        }
        let value = output as f32;
        let env = envelope.clamp(0.0, 1.0);
        if kernel_global!(LINK_SCOPE_MODE) == 2
            && kernel_global!(LINK_SCOPE_LAST_ENVELOPE) <= 0.001
            && env > 0.001
        {
            kernel_global!(LINK_SCOPE_DECIMATE_COUNTER) = 0;
            kernel_global!(LINK_SCOPE_COUNT) = 0;
            kernel_global!(LINK_SCOPE_WRITE_INDEX) = 0;
            kernel_global!(LINK_SCOPE_CAPTURE_ACTIVE) = true;
        }
        kernel_global!(LINK_SCOPE_LAST_ENVELOPE) = env;
        if kernel_global!(LINK_SCOPE_MODE) == 2 && !kernel_global!(LINK_SCOPE_CAPTURE_ACTIVE) {
            return;
        }
        kernel_global!(LINK_SCOPE_DECIMATE_COUNTER) =
            kernel_global!(LINK_SCOPE_DECIMATE_COUNTER).saturating_add(1);
        if kernel_global!(LINK_SCOPE_DECIMATE_COUNTER) < kernel_global!(LINK_SCOPE_DECIMATE) {
            return;
        }
        kernel_global!(LINK_SCOPE_DECIMATE_COUNTER) = 0;
        if kernel_global!(LINK_SCOPE_MODE) == 2 {
            if (kernel_global!(LINK_SCOPE_COUNT) as usize)
                < kernel_global!(LINK_SCOPE_POINTS_ACTIVE)
            {
                kernel_global!(LINK_SCOPE_SAMPLES)[kernel_global!(LINK_SCOPE_COUNT) as usize] =
                    value;
                kernel_global!(LINK_SCOPE_COUNT) =
                    kernel_global!(LINK_SCOPE_COUNT).saturating_add(1);
            }
            if (kernel_global!(LINK_SCOPE_COUNT) as usize)
                >= kernel_global!(LINK_SCOPE_POINTS_ACTIVE)
            {
                kernel_global!(LINK_SCOPE_CAPTURE_ACTIVE) = false;
            }
            return;
        }
        kernel_global!(LINK_SCOPE_SAMPLES)[kernel_global!(LINK_SCOPE_WRITE_INDEX) as usize] = value;
        kernel_global!(LINK_SCOPE_WRITE_INDEX) = (kernel_global!(LINK_SCOPE_WRITE_INDEX) + 1)
            % kernel_global!(LINK_SCOPE_POINTS_ACTIVE) as u32;
        if (kernel_global!(LINK_SCOPE_COUNT) as usize) < kernel_global!(LINK_SCOPE_POINTS_ACTIVE) {
            kernel_global!(LINK_SCOPE_COUNT) = kernel_global!(LINK_SCOPE_COUNT).saturating_add(1);
        }
    }
}

fn smooth_step(t: f64) -> f64 {
    let x = t.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

fn oscillator(
    node_index: usize,
    node: Node,
    phase: f64,
    voice_slot: usize,
    frame: usize,
    wave: i32,
    pulse_width: f64,
) -> f64 {
    let p = normalize_phase(phase);
    match wave {
        1 => 1.0 - 4.0 * ((p - 0.25).round() - (p - 0.25)).abs(),
        2 => p * 2.0 - 1.0,
        3 => 1.0 - p * 2.0,
        4 => {
            if p < pulse_width.clamp(0.0, 1.0) {
                1.0
            } else {
                -1.0
            }
        }
        5 => unsafe {
            if !kernel_global!(SAMPLE_HOLD_SET)[voice_slot][node_index] {
                kernel_global!(SAMPLE_HOLDS)[voice_slot][node_index] = random_unit(voice_slot);
                kernel_global!(SAMPLE_HOLD_SET)[voice_slot][node_index] = true;
            }
            kernel_global!(SAMPLE_HOLDS)[voice_slot][node_index]
        },
        6 => random_bipolar(voice_slot),
        7 => unsafe {
            if !kernel_global!(PERLIN_SET)[voice_slot][node_index] {
                kernel_global!(PERLIN_CURRENT)[voice_slot][node_index] = random_bipolar(voice_slot);
                kernel_global!(PERLIN_NEXT)[voice_slot][node_index] = random_bipolar(voice_slot);
                kernel_global!(PERLIN_SET)[voice_slot][node_index] = true;
            }
            let current = kernel_global!(PERLIN_CURRENT)[voice_slot][node_index];
            let next = kernel_global!(PERLIN_NEXT)[voice_slot][node_index];
            current + (next - current) * smooth_step(p)
        },
        8 => unsafe {
            kernel_global!(INPUT)[frame.min(MAX_WASM_FRAMES - 1)] as f64 * node.audio_input_gain
        },
        9 => custom_wave_value(node_index, p, frame),
        11 => node.frequency.clamp(-1.0, 1.0),
        _ => (TWO_PI * p).sin(),
    }
}

fn modulated_wave(base_wave: i32, modulation: f64) -> i32 {
    if !modulation.is_finite() {
        return base_wave;
    }
    let waves = [0, 1, 2, 3, 4, 5, 9];
    let base_index = match waves.iter().position(|wave| *wave == base_wave) {
        Some(index) => index as i32,
        None => return base_wave,
    };
    let index = ((base_index as f64 + modulation).round() as i32).clamp(0, (waves.len() - 1) as i32)
        as usize;
    waves[index]
}

fn custom_wave_curve_value(
    node_index: usize,
    phase: f64,
    previous: bool,
    endpoint: Option<f64>,
) -> f64 {
    unsafe {
        let count = if previous {
            kernel_global!(CUSTOM_WAVE_PREVIOUS_COUNTS)[node_index]
        } else {
            kernel_global!(CUSTOM_WAVE_COUNTS)[node_index]
        };
        if count < 2 {
            return 0.0;
        }
        let p = phase.clamp(0.0, 1.0);
        for point_index in 1..count {
            let previous_x = if previous {
                kernel_global!(CUSTOM_WAVE_PREVIOUS_XS)[node_index][point_index - 1]
            } else {
                kernel_global!(CUSTOM_WAVE_XS)[node_index][point_index - 1]
            };
            let previous_y = if point_index == 1 {
                endpoint.unwrap_or_else(|| {
                    if previous {
                        kernel_global!(CUSTOM_WAVE_PREVIOUS_YS)[node_index][0]
                    } else {
                        kernel_global!(CUSTOM_WAVE_YS)[node_index][0]
                    }
                })
            } else if previous {
                kernel_global!(CUSTOM_WAVE_PREVIOUS_YS)[node_index][point_index - 1]
            } else {
                kernel_global!(CUSTOM_WAVE_YS)[node_index][point_index - 1]
            };
            let next_x = if previous {
                kernel_global!(CUSTOM_WAVE_PREVIOUS_XS)[node_index][point_index]
            } else {
                kernel_global!(CUSTOM_WAVE_XS)[node_index][point_index]
            };
            let next_y = if point_index == count - 1 {
                endpoint.unwrap_or_else(|| {
                    if previous {
                        kernel_global!(CUSTOM_WAVE_PREVIOUS_YS)[node_index][point_index]
                    } else {
                        kernel_global!(CUSTOM_WAVE_YS)[node_index][point_index]
                    }
                })
            } else if previous {
                kernel_global!(CUSTOM_WAVE_PREVIOUS_YS)[node_index][point_index]
            } else {
                kernel_global!(CUSTOM_WAVE_YS)[node_index][point_index]
            };
            if p > next_x && point_index < count - 1 {
                continue;
            }
            let span = next_x - previous_x;
            if span <= 0.0 {
                return next_y;
            }
            let t = ((p - previous_x) / span).clamp(0.0, 1.0);
            return previous_y + (next_y - previous_y) * t;
        }
        if let Some(endpoint) = endpoint {
            endpoint
        } else if previous {
            kernel_global!(CUSTOM_WAVE_PREVIOUS_YS)[node_index][count - 1]
        } else {
            kernel_global!(CUSTOM_WAVE_YS)[node_index][count - 1]
        }
    }
}

fn custom_wave_value(node_index: usize, phase: f64, frame: usize) -> f64 {
    custom_wave_value_with_endpoint(node_index, phase, frame, None)
}

fn custom_wave_value_with_endpoint(
    node_index: usize,
    phase: f64,
    frame: usize,
    endpoint: Option<f64>,
) -> f64 {
    unsafe {
        let current = custom_wave_curve_value(node_index, phase, false, endpoint);
        let total = kernel_global!(CUSTOM_WAVE_MORPH_TOTAL_FRAMES)[node_index];
        let remaining_at_start =
            kernel_global!(CUSTOM_WAVE_MORPH_REMAINING_AT_QUANTUM_START)[node_index];
        if total == 0
            || remaining_at_start == 0
            || kernel_global!(CUSTOM_WAVE_PREVIOUS_COUNTS)[node_index] < 2
        {
            return current;
        }

        let frame_offset = (frame as u32).min(remaining_at_start);
        let consumed = frame_offset.saturating_add(1);
        #[cfg(feature = "parallel")]
        if !parallel::active_repeat_context().is_null() {
            parallel::record_custom_wave_frame(node_index, consumed);
        } else {
            kernel_global!(CUSTOM_WAVE_MORPH_CONSUMED_FRAMES)[node_index] =
                kernel_global!(CUSTOM_WAVE_MORPH_CONSUMED_FRAMES)[node_index].max(consumed);
        }
        #[cfg(not(feature = "parallel"))]
        {
            kernel_global!(CUSTOM_WAVE_MORPH_CONSUMED_FRAMES)[node_index] =
                kernel_global!(CUSTOM_WAVE_MORPH_CONSUMED_FRAMES)[node_index].max(consumed);
        }
        let remaining = remaining_at_start.saturating_sub(frame_offset);
        let mix = smooth_step((total.saturating_sub(remaining)) as f64 / total as f64);
        let previous = custom_wave_curve_value(node_index, phase, true, endpoint);
        previous + (current - previous) * mix
    }
}

fn custom_one_shot_edge_gain(node: Node, phase: f64, base_frequency: f64) -> f64 {
    if node.wave != 9 || !custom_mode_is_finite(node.custom_mode) || base_frequency <= 0.0 {
        return 1.0;
    }
    let fade_phase = (CUSTOM_ONESHOT_EDGE_FADE_SECONDS * base_frequency).clamp(0.0005, 0.08);
    let p = phase.clamp(0.0, 1.0);
    (p / fade_phase).min((1.0 - p) / fade_phase).clamp(0.0, 1.0)
}

fn sample_slot_for_node(node_index: usize) -> Option<usize> {
    unsafe {
        if node_index >= MAX_NODES {
            return None;
        }
        let slot = kernel_global!(SAMPLE_SLOT_FOR_NODE)[node_index];
        if slot < 0 {
            return None;
        }
        let slot = slot as usize;
        if slot >= MAX_SAMPLE_SLOTS || kernel_global!(SAMPLE_LENGTHS)[slot] == 0 {
            return None;
        }
        Some(slot)
    }
}

fn sample_range(
    node_index: usize,
    node: Node,
    start_mod: f64,
    end_mod: f64,
) -> Option<(f64, f64, f64, f64, f64, f64)> {
    let slot = sample_slot_for_node(node_index)?;
    unsafe {
        let max_frame = kernel_global!(SAMPLE_LENGTHS)[slot].saturating_sub(1) as f64;
        if max_frame <= 0.0 {
            return None;
        }
        let start = (node.sample_start + start_mod).clamp(0.0, 1.0);
        let end = (node.sample_end + end_mod).clamp(0.0, 1.0);
        let start_frame = (start * max_frame).round().clamp(0.0, max_frame);
        let end_frame = (end * max_frame).round().clamp(0.0, max_frame);
        let first_frame = start_frame.min(end_frame);
        let last_frame = start_frame.max(end_frame);
        let direction = if end_frame >= start_frame { 1.0 } else { -1.0 };
        let length = (end_frame - start_frame).abs() + 1.0;
        Some((
            start_frame,
            end_frame,
            first_frame,
            last_frame,
            direction,
            length.max(1.0),
        ))
    }
}

fn sample_playback_step(
    node_index: usize,
    node: Node,
    note_frequency: f64,
    target_frequency: f64,
    sample_rate: f64,
) -> f64 {
    let Some(slot) = sample_slot_for_node(node_index) else {
        return 0.0;
    };
    unsafe {
        let target_frequency = if target_frequency.is_finite() {
            target_frequency
        } else {
            base_frequency(node, note_frequency)
        };
        let original = node.sample_original_frequency.max(0.0001);
        let source_rate = kernel_global!(SAMPLE_RATES)[slot].max(1.0);
        (target_frequency / original) * (source_rate / sample_rate.max(1.0))
    }
}

fn sample_playback_duration(
    node_index: usize,
    node: Node,
    note_frequency: f64,
    target_frequency: f64,
    sample_rate: f64,
) -> Option<f64> {
    let (_, _, _, _, _, length) = sample_range(node_index, node, 0.0, 0.0)?;
    let step = sample_playback_step(
        node_index,
        node,
        note_frequency,
        target_frequency,
        sample_rate,
    )
    .abs()
    .max(0.0001);
    Some(
        (length / step / sample_rate.max(1.0)) * node.sample_stretch.max(0.001)
            + node.sample_release.max(0.0),
    )
}

fn start_sample_player(
    node_index: usize,
    voice_slot: usize,
    node: Node,
    start_mod: f64,
    end_mod: f64,
) {
    unsafe {
        let was_playing = kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index];
        if was_playing {
            kernel_global!(SAMPLE_RETRIGGER_OUTPUTS)[voice_slot][node_index] =
                kernel_global!(SAMPLE_LAST_OUTPUTS)[voice_slot][node_index];
            kernel_global!(SAMPLE_RETRIGGER_FADE_AGES)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_RETRIGGER_FADE_DURATIONS)[voice_slot][node_index] =
                node.sample_attack.max(SAMPLE_EDGE_FADE_SECONDS);
        } else {
            kernel_global!(SAMPLE_RETRIGGER_OUTPUTS)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_RETRIGGER_FADE_AGES)[voice_slot][node_index] = -1.0;
            kernel_global!(SAMPLE_RETRIGGER_FADE_DURATIONS)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_LAST_OUTPUTS)[voice_slot][node_index] = 0.0;
        }
        let Some((start_frame, end_frame, _, _, direction, _)) =
            sample_range(node_index, node, start_mod, end_mod)
        else {
            kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] = false;
            return;
        };
        let Some(slot) = sample_slot_for_node(node_index) else {
            kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] = false;
            return;
        };
        let frequency_direction =
            kernel_global!(SAMPLE_FREQUENCY_DIRECTIONS)[voice_slot][node_index];
        let initial_position =
            sample_player_start_boundary(start_frame, end_frame, frequency_direction);
        let start_index = (initial_position.round() as usize)
            .min(kernel_global!(SAMPLE_LENGTHS)[slot].saturating_sub(1));
        kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] = true;
        kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] = initial_position;
        kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index] = direction * frequency_direction;
        kernel_global!(SAMPLE_HAS_ADVANCED)[voice_slot][node_index] = false;
        kernel_global!(SAMPLE_PLAYBACK_AGES)[voice_slot][node_index] = 0.0;
        kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index] = -1.0;
        let Some(sample_data) = kernel_global!(SAMPLE_DATA)[slot].as_ref() else {
            kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] = false;
            return;
        };
        kernel_global!(SAMPLE_START_VALUES)[voice_slot][node_index] =
            sample_data.get(start_index).copied().unwrap_or(0.0) as f64;
        kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index] = 0.0;
        kernel_global!(SAMPLE_STRETCH_ANCHORS)[voice_slot][node_index] = initial_position;
    }
}

fn sync_sample_frequency_direction(
    node_index: usize,
    voice_slot: usize,
    node: Node,
    frequency: f64,
) {
    if !frequency.is_finite() || frequency == 0.0 {
        return;
    }
    unsafe {
        let next_direction = if frequency < 0.0 { -1.0 } else { 1.0 };
        let previous_direction =
            kernel_global!(SAMPLE_FREQUENCY_DIRECTIONS)[voice_slot][node_index];
        if next_direction == previous_direction {
            return;
        }
        kernel_global!(SAMPLE_FREQUENCY_DIRECTIONS)[voice_slot][node_index] = next_direction;
        kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index] =
            -kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index];

        // Until the playhead actually moves, let the first non-zero frequency
        // choose its starting edge. Later sign changes reverse in place.
        if kernel_global!(SAMPLE_HAS_ADVANCED)[voice_slot][node_index] {
            return;
        }
        let Some((start_frame, end_frame, _, _, _, _)) = sample_range(node_index, node, 0.0, 0.0)
        else {
            return;
        };
        let initial_position = sample_player_start_boundary(start_frame, end_frame, next_direction);
        kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] = initial_position;
        kernel_global!(SAMPLE_STRETCH_ANCHORS)[voice_slot][node_index] = initial_position;
        let Some(slot) = sample_slot_for_node(node_index) else {
            return;
        };
        let Some(sample_data) = kernel_global!(SAMPLE_DATA)[slot].as_ref() else {
            return;
        };
        let initial_index = (initial_position.round() as usize)
            .min(kernel_global!(SAMPLE_LENGTHS)[slot].saturating_sub(1));
        kernel_global!(SAMPLE_START_VALUES)[voice_slot][node_index] =
            sample_data.get(initial_index).copied().unwrap_or(0.0) as f64;
    }
}

fn advance_sample_retrigger_fade(node_index: usize, voice_slot: usize, sample_rate: f64) {
    unsafe {
        let age = kernel_global!(SAMPLE_RETRIGGER_FADE_AGES)[voice_slot][node_index];
        if age < 0.0 {
            return;
        }
        let duration = kernel_global!(SAMPLE_RETRIGGER_FADE_DURATIONS)[voice_slot][node_index]
            .max(SAMPLE_EDGE_FADE_SECONDS);
        let next_age = age + 1.0 / sample_rate.max(1.0);
        kernel_global!(SAMPLE_RETRIGGER_FADE_AGES)[voice_slot][node_index] =
            if next_age >= duration { -1.0 } else { next_age };
    }
}

fn sample_player_boundary(
    node_index: usize,
    voice_slot: usize,
    start_frame: f64,
    end_frame: f64,
    direction: f64,
) -> f64 {
    unsafe {
        if kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index] == direction {
            end_frame
        } else {
            start_frame
        }
    }
}

fn sample_player_past_end(position: f64, play_direction: f64, boundary: f64) -> bool {
    if play_direction >= 0.0 {
        position > boundary
    } else {
        position < boundary
    }
}

fn sample_player_before_start(position: f64, play_direction: f64, start_frame: f64) -> bool {
    if play_direction >= 0.0 {
        position < start_frame
    } else {
        position > start_frame
    }
}

fn sample_player_start_boundary(start_frame: f64, end_frame: f64, frequency_direction: f64) -> f64 {
    if frequency_direction < 0.0 {
        end_frame
    } else {
        start_frame
    }
}

fn sample_player_frequency_direction(frequency: f64) -> f64 {
    if frequency.is_finite() && frequency < 0.0 {
        -1.0
    } else {
        1.0
    }
}

#[cfg(test)]
mod sample_player_direction_tests {
    use super::{
        sample_player_before_start, sample_player_frequency_direction, sample_player_start_boundary,
    };

    #[test]
    fn negative_frequency_swaps_the_effective_sample_boundaries() {
        let frequency_direction = sample_player_frequency_direction(-440.0);
        assert_eq!(
            sample_player_start_boundary(20.0, 80.0, frequency_direction),
            80.0
        );
        assert_eq!(
            sample_player_start_boundary(80.0, 20.0, frequency_direction),
            20.0
        );
    }

    #[test]
    fn zero_frequency_uses_the_forward_start_boundary_while_paused() {
        let frequency_direction = sample_player_frequency_direction(0.0);
        assert_eq!(
            sample_player_start_boundary(20.0, 80.0, frequency_direction),
            20.0
        );
    }

    #[test]
    fn reversing_inside_the_region_does_not_restart_the_sample() {
        let reverse_start = sample_player_start_boundary(0.0, 100.0, -1.0);
        assert_eq!(reverse_start, 100.0);
        assert!(!sample_player_before_start(50.0, -1.0, reverse_start));
        assert!(sample_player_before_start(101.0, -1.0, reverse_start));
    }

    #[test]
    fn returning_forward_inside_the_region_does_not_restart_the_sample() {
        let forward_start = sample_player_start_boundary(0.0, 100.0, 1.0);
        assert_eq!(forward_start, 0.0);
        assert!(!sample_player_before_start(50.0, 1.0, forward_start));
        assert!(sample_player_before_start(-1.0, 1.0, forward_start));
    }
}

fn finish_sample_boundary(
    node_index: usize,
    voice_slot: usize,
    node: Node,
    start_frame: f64,
    end_frame: f64,
    first_frame: f64,
    last_frame: f64,
    direction: f64,
) {
    unsafe {
        if node.sample_mode == SAMPLE_MODE_ONE_SHOT
            && kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index] >= 0.0
        {
            return;
        }
        let play_direction = kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index];
        let boundary =
            sample_player_boundary(node_index, voice_slot, start_frame, end_frame, direction);
        let position = kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index];
        if !sample_player_past_end(position, play_direction, boundary) {
            return;
        }
        if node.sample_mode == SAMPLE_MODE_LOOP {
            let span = (end_frame - start_frame).abs().max(1.0);
            let overshoot = (position - boundary).abs();
            let wrapped = overshoot % span;
            kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] = if play_direction >= 0.0 {
                first_frame + wrapped
            } else {
                last_frame - wrapped
            };
        } else if node.sample_mode == SAMPLE_MODE_PING_PONG {
            let next_direction = -play_direction;
            let overshoot = (position - boundary).abs();
            kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index] = next_direction;
            kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] =
                (boundary + overshoot * next_direction).clamp(first_frame, last_frame);
        } else if node.sample_release > 0.0
            && kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index] < 0.0
        {
            kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] = boundary;
            kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index] = 0.0;
        } else {
            kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] = false;
        }
    }
}

fn sample_value(
    node_index: usize,
    node: Node,
    voice_slot: usize,
    sample_rate: f64,
    start_mod: f64,
    end_mod: f64,
    stretch_mod: f64,
) -> f64 {
    unsafe {
        if !kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] {
            return 0.0;
        }
        let Some(slot) = sample_slot_for_node(node_index) else {
            kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] = false;
            return 0.0;
        };
        let Some(sample_data) = kernel_global!(SAMPLE_DATA)[slot].as_ref() else {
            kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] = false;
            return 0.0;
        };
        let Some((start_frame, end_frame, first_frame, last_frame, direction, length)) =
            sample_range(node_index, node, start_mod, end_mod)
        else {
            kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] = false;
            return 0.0;
        };
        let release_age = kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index];
        if release_age >= node.sample_release.max(0.0) && release_age >= 0.0 {
            kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] = false;
            return 0.0;
        }
        let playback_start = sample_player_start_boundary(
            start_frame,
            end_frame,
            kernel_global!(SAMPLE_FREQUENCY_DIRECTIONS)[voice_slot][node_index],
        );
        if sample_player_before_start(
            kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index],
            kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index],
            playback_start,
        ) {
            start_sample_player(node_index, voice_slot, node, start_mod, end_mod);
        }
        finish_sample_boundary(
            node_index,
            voice_slot,
            node,
            start_frame,
            end_frame,
            first_frame,
            last_frame,
            direction,
        );
        if !kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] {
            return 0.0;
        }
        let current_release_age = kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index];
        let release_active = current_release_age >= 0.0;
        let stretch = (node.sample_stretch + stretch_mod).max(0.001);
        let (position, next_position, mix) = if (stretch - 1.0).abs() < 0.001 {
            let base_position = kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index];
            (base_position, base_position, 0.0)
        } else {
            let grain_frames = node.sample_cycle_length.round().clamp(1.0, length.max(1.0));
            let overlap_frames = if node.sample_overlap_ratio <= 0.0 {
                0.0
            } else {
                (grain_frames * node.sample_overlap_ratio.clamp(0.0, 1.0))
                    .round()
                    .clamp(1.0, (grain_frames - 1.0).max(1.0))
            };
            let hop_frames = (grain_frames - overlap_frames).max(1.0);
            let local = kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index]
                .clamp(0.0, grain_frames);
            let overlap_local = (local - hop_frames).max(0.0);
            let mix = if overlap_frames > 0.0 && overlap_local > 0.0 {
                smooth_step(overlap_local / overlap_frames)
            } else {
                0.0
            };
            let direction = kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index];
            let next_anchor = kernel_global!(SAMPLE_STRETCH_ANCHORS)[voice_slot][node_index]
                + (hop_frames / stretch) * direction;
            (
                kernel_global!(SAMPLE_STRETCH_ANCHORS)[voice_slot][node_index] + local * direction,
                next_anchor + overlap_local * direction,
                mix,
            )
        };
        let max_frame = kernel_global!(SAMPLE_LENGTHS)[slot].saturating_sub(1) as f64;
        let read_first_frame = if release_active { 0.0 } else { first_frame };
        let read_last_frame = if release_active {
            max_frame
        } else {
            last_frame
        };
        let position = if release_active {
            position.clamp(read_first_frame, read_last_frame)
        } else {
            position.clamp(first_frame, last_frame)
        };
        let sample_at = |read_position: f64| -> f64 {
            let read_position = read_position.clamp(read_first_frame, read_last_frame);
            let lower = (read_position.floor() as usize)
                .min(kernel_global!(SAMPLE_LENGTHS)[slot].saturating_sub(1));
            let upper = (lower + 1)
                .min(kernel_global!(SAMPLE_LENGTHS)[slot].saturating_sub(1))
                .min(read_last_frame as usize);
            let frac = read_position - lower as f64;
            let a = sample_data[lower] as f64;
            let b = sample_data[upper] as f64;
            a + (b - a) * frac
        };
        let blended = if mix > 0.0 {
            sample_at(position) * (1.0 - mix) + sample_at(next_position) * mix
        } else {
            sample_at(position)
        };
        let start_distance = (position - start_frame).abs();
        let end_distance = (end_frame - position).abs();
        let fade_frames = (kernel_global!(SAMPLE_RATES)[slot].max(sample_rate)
            * SAMPLE_EDGE_FADE_SECONDS)
            .round()
            .clamp(1.0, (length * 0.5).max(1.0));
        let end_edge = if node.sample_mode == SAMPLE_MODE_ONE_SHOT && node.sample_release > 0.0 {
            1.0
        } else {
            smooth_step(end_distance / fade_frames)
        };
        let edge = smooth_step(start_distance / fade_frames) * end_edge;
        let correction = kernel_global!(SAMPLE_START_VALUES)[voice_slot][node_index]
            * (1.0 - smooth_step(start_distance / fade_frames));
        let attack = if node.sample_attack > 0.0 {
            smooth_step(
                (kernel_global!(SAMPLE_PLAYBACK_AGES)[voice_slot][node_index] / node.sample_attack)
                    .clamp(0.0, 1.0),
            )
        } else {
            1.0
        };
        let release = if current_release_age >= 0.0 && node.sample_release > 0.0 {
            1.0 - smooth_step((current_release_age / node.sample_release).clamp(0.0, 1.0))
        } else {
            1.0
        };
        let restarted = sanitize_sample((blended - correction) * edge * attack * release, 4.0);
        let fade_age = kernel_global!(SAMPLE_RETRIGGER_FADE_AGES)[voice_slot][node_index];
        let output = if fade_age >= 0.0 {
            let duration = kernel_global!(SAMPLE_RETRIGGER_FADE_DURATIONS)[voice_slot][node_index]
                .max(SAMPLE_EDGE_FADE_SECONDS);
            let fade = smooth_step(fade_age / duration);
            kernel_global!(SAMPLE_RETRIGGER_OUTPUTS)[voice_slot][node_index] * (1.0 - fade)
                + restarted * fade
        } else {
            restarted
        };
        let output = sanitize_sample(output, 4.0);
        kernel_global!(SAMPLE_LAST_OUTPUTS)[voice_slot][node_index] = output;
        output
    }
}

fn custom_mode_is_finite(mode: i32) -> bool {
    matches!(
        mode,
        CUSTOM_MODE_ONCE
            | CUSTOM_MODE_SUSTAIN
            | CUSTOM_MODE_SUSTAIN_LOOP
            | CUSTOM_MODE_SUSTAIN_PING_PONG
    )
}

fn fold_sample(sample: f64, drive: f64) -> f64 {
    let wrapped = ((sample * drive + 1.0) % 4.0 + 4.0) % 4.0;
    if wrapped <= 2.0 {
        wrapped - 1.0
    } else {
        3.0 - wrapped
    }
}

fn sanitize_sample(value: f64, limit: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-limit, limit)
    } else {
        0.0
    }
}

fn sanitize_control_value(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

fn pan_gains(pan: f64) -> (f64, f64) {
    let angle = (pan.clamp(-1.0, 1.0) + 1.0) * core::f64::consts::PI * 0.25;
    (angle.cos(), angle.sin())
}

fn scale_contains(scale: i32, interval: i32) -> bool {
    match scale {
        1 => matches!(interval, 0 | 2 | 4 | 5 | 7 | 9 | 11),
        2 => matches!(interval, 0 | 2 | 3 | 5 | 7 | 8 | 10),
        3 => matches!(interval, 0 | 2 | 4 | 7 | 9),
        4 => matches!(interval, 0 | 3 | 5 | 7 | 10),
        5 => matches!(interval, 0 | 3 | 5 | 6 | 7 | 10),
        6 => matches!(interval, 0 | 2 | 3 | 5 | 7 | 9 | 10),
        7 => matches!(interval, 0 | 2 | 4 | 5 | 7 | 9 | 10),
        8 => matches!(interval, 0 | 2 | 3 | 5 | 7 | 8 | 11),
        _ => true,
    }
}

fn midi_pitch_class(frequency: f64) -> i32 {
    if !frequency.is_finite() || frequency <= 0.0 {
        return 0;
    }
    let midi = (69.0 + 12.0 * (frequency / 440.0).log2()).round() as i32;
    midi.rem_euclid(12)
}

fn quantise_frequency(node: Node, frequency: f64, note_frequency: f64) -> f64 {
    if node.quantise_enabled == 0 || !frequency.is_finite() || frequency <= 0.0 {
        return frequency;
    }
    let midi = 69.0 + 12.0 * (frequency / 440.0).log2();
    let center = midi.round() as i32;
    let octave_center = (center.div_euclid(12)) * 12;
    let root = if node.quantise_root < 0 {
        midi_pitch_class(note_frequency)
    } else {
        node.quantise_root.clamp(0, 11)
    };
    let mut best_midi = center;
    let mut best_distance = f64::INFINITY;
    for octave in -2..=2 {
        let octave_base = octave_center + octave * 12;
        for interval in 0..12 {
            if !scale_contains(node.quantise_scale, interval) {
                continue;
            }
            let candidate = octave_base + (root + interval).rem_euclid(12);
            let distance = ((candidate as f64) - midi).abs();
            if distance < best_distance {
                best_distance = distance;
                best_midi = candidate;
            }
        }
    }
    440.0 * 2.0_f64.powf(((best_midi as f64) - 69.0) / 12.0)
}

fn glide_frequency(
    voice_slot: usize,
    node_index: usize,
    node: Node,
    target: f64,
    sample_rate: f64,
) -> f64 {
    if node.quantise_enabled == 0 || !target.is_finite() || target <= 0.0 {
        return target;
    }
    unsafe {
        let glide = node.quantise_glide.clamp(0.0, 4.0);
        if glide <= 0.0 {
            kernel_global!(QUANTISED_FREQUENCIES)[voice_slot][node_index] = target;
            kernel_global!(QUANTISED_TARGETS)[voice_slot][node_index] = target;
            kernel_global!(QUANTISED_STEPS)[voice_slot][node_index] = 0.0;
            kernel_global!(QUANTISED_REMAINING)[voice_slot][node_index] = 0;
            return target;
        }
        let current = kernel_global!(QUANTISED_FREQUENCIES)[voice_slot][node_index];
        if !current.is_finite() || current <= 0.0 {
            kernel_global!(QUANTISED_FREQUENCIES)[voice_slot][node_index] = target;
            kernel_global!(QUANTISED_TARGETS)[voice_slot][node_index] = target;
            kernel_global!(QUANTISED_STEPS)[voice_slot][node_index] = 0.0;
            kernel_global!(QUANTISED_REMAINING)[voice_slot][node_index] = 0;
            return target;
        }
        if (target - kernel_global!(QUANTISED_TARGETS)[voice_slot][node_index]).abs() > 0.000001 {
            let remaining = (glide * sample_rate).round().max(1.0) as u32;
            kernel_global!(QUANTISED_TARGETS)[voice_slot][node_index] = target;
            kernel_global!(QUANTISED_REMAINING)[voice_slot][node_index] = remaining;
            kernel_global!(QUANTISED_STEPS)[voice_slot][node_index] =
                (target - current) / remaining as f64;
        }
        if kernel_global!(QUANTISED_REMAINING)[voice_slot][node_index] > 0 {
            kernel_global!(QUANTISED_FREQUENCIES)[voice_slot][node_index] +=
                kernel_global!(QUANTISED_STEPS)[voice_slot][node_index];
            kernel_global!(QUANTISED_REMAINING)[voice_slot][node_index] -= 1;
            if kernel_global!(QUANTISED_REMAINING)[voice_slot][node_index] == 0 {
                kernel_global!(QUANTISED_FREQUENCIES)[voice_slot][node_index] =
                    kernel_global!(QUANTISED_TARGETS)[voice_slot][node_index];
            }
        }
        kernel_global!(QUANTISED_FREQUENCIES)[voice_slot][node_index]
    }
}

fn base_frequency(node: Node, note_frequency: f64) -> f64 {
    if node.frequency_mode == 1 {
        node.frequency
    } else if node.frequency_mode == 2 {
        unsafe { (kernel_global!(TEMPO) / 60.0) / node.sync_beats.clamp(1.0 / 64.0, 64.0) }
    } else {
        note_frequency * node.ratio
    }
}

fn velocity_scale(velocity_sensitivity: f64, velocity: f64) -> f64 {
    if velocity_sensitivity == 0.0 {
        return 1.0;
    }
    let velocity = velocity.clamp(0.0, 1.0);
    if velocity_sensitivity < 0.0 {
        let inverted = (1.0 - velocity).clamp(0.0, 1.0);
        let depth = velocity_sensitivity.abs();
        if depth <= 1.0 {
            1.0 - depth + depth * inverted
        } else {
            inverted.powf(depth)
        }
    } else if velocity_sensitivity == 1.0 {
        velocity
    } else if velocity_sensitivity <= 1.0 {
        1.0 - velocity_sensitivity + velocity_sensitivity * velocity
    } else {
        velocity.powf(velocity_sensitivity)
    }
}

fn attack_curve(t: f64) -> f64 {
    1.0 - (1.0 - t.clamp(0.0, 1.0)).powi(3)
}

fn decay_curve(t: f64) -> f64 {
    (1.0 - t.clamp(0.0, 1.0)).powi(2)
}

fn held_envelope_value(link: Link, age: f64) -> f64 {
    let mut elapsed = age.max(0.0);
    if elapsed < link.env_delay {
        return 0.0;
    }
    elapsed -= link.env_delay;

    if elapsed < link.env_attack {
        return attack_curve(elapsed / link.env_attack);
    }
    if elapsed < link.env_attack + link.env_decay {
        let t = (elapsed - link.env_attack) / link.env_decay;
        return link.env_sustain + (1.0 - link.env_sustain) * decay_curve(t);
    }
    link.env_sustain
}

fn envelope_value(link: Link, age: f64, release_age: f64) -> f64 {
    if release_age < 0.0 {
        return held_envelope_value(link, age);
    }

    let release_started_age = (age - release_age).max(0.0);
    let release_level = held_envelope_value(link, release_started_age);
    release_level * decay_curve(release_age / link.env_release.max(0.001))
}

fn link_has_envelope_trigger(link_index: usize) -> bool {
    unsafe {
        if link_index >= MAX_LINKS {
            return false;
        }
        if kernel_global!(LINK_HAS_ENVELOPE_TRIGGER)[link_index] {
            return true;
        }
        let mut mod_cursor = kernel_global!(LINK_FIRST_MODULATOR)[link_index];
        while mod_cursor >= 0 {
            let mod_index = mod_cursor as usize;
            if mod_index >= MAX_LINKS {
                return false;
            }
            if kernel_global!(LINKS)[mod_index].target == TARGET_ENVELOPE_TRIGGER {
                return true;
            }
            mod_cursor = kernel_global!(LINK_NEXT_MODULATOR)[mod_index];
        }
        false
    }
}

fn triggered_envelope_value(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    note_frequency: f64,
    age: f64,
    release_age: f64,
) -> f64 {
    let has_envelope_trigger = link_has_envelope_trigger(link_index);
    if link.drone != 0 && !has_envelope_trigger {
        return 1.0;
    }

    unsafe {
        let start_age = kernel_global!(LINK_TRIGGER_START_AGE)[voice_slot][link_index];
        if voice_slot == DRONE_VOICE_SLOT || has_envelope_trigger {
            if start_age < 0.0 || age < start_age {
                return 0.0;
            }
            let trigger_release_age =
                kernel_global!(LINK_TRIGGER_RELEASE_AGE)[voice_slot][link_index];
            let effective_release_age =
                if trigger_release_age >= start_age && age >= trigger_release_age {
                    age - trigger_release_age
                } else {
                    release_age
                };
            return envelope_value(link, age - start_age, effective_release_age);
        }
        if release_age < 0.0 && link.from >= 0 {
            let node_index = link.from as usize;
            if node_index < kernel_global!(NODE_COUNT) {
                let node = kernel_global!(NODES)[node_index];
                if node.wave == 10 && node.sample_mode == SAMPLE_MODE_ONE_SHOT {
                    let target_frequency = if kernel_global!(FREQUENCY_MOD_ACTIVE)[node_index] {
                        kernel_global!(FREQUENCY_MODS)[node_index]
                    } else {
                        base_frequency(node, note_frequency)
                    };
                    if let Some(duration) = sample_playback_duration(
                        node_index,
                        node,
                        note_frequency,
                        target_frequency,
                        sample_rate,
                    ) {
                        let release_at = (duration - link.env_release.max(0.001)).max(0.0);
                        if age >= release_at {
                            let release_level = held_envelope_value(link, release_at);
                            return release_level
                                * decay_curve((age - release_at) / link.env_release.max(0.001));
                        }
                    }
                }
            }
        }
        envelope_value(link, age, release_age)
    }
}

fn trigger_node_output_envelopes(target_node_index: usize, voice_slot: usize, age: f64) {
    unsafe {
        for link_index in 0..kernel_global!(LINK_COUNT) {
            if kernel_global!(LINKS)[link_index].from == target_node_index as i32
                && kernel_global!(LINKS)[link_index].drone == 0
            {
                kernel_global!(LINK_TRIGGER_START_AGE)[voice_slot][link_index] = age;
            }
        }
    }
}

fn apply_envelope_trigger(
    target_link_index: usize,
    mod_link_index: usize,
    voice_slot: usize,
    age: f64,
    value: f64,
) {
    if !value.is_finite() {
        return;
    }

    unsafe {
        let armed = kernel_global!(LINK_TRIGGER_ARMED)[voice_slot][mod_link_index];
        if armed && value >= ENVELOPE_TRIGGER_THRESHOLD {
            kernel_global!(LINK_TRIGGER_START_AGE)[voice_slot][target_link_index] = age;
            kernel_global!(LINK_TRIGGER_RELEASE_AGE)[voice_slot][target_link_index] = -1.0;
            kernel_global!(LINK_TRIGGER_ARMED)[voice_slot][mod_link_index] = false;
        } else if !armed && value <= ENVELOPE_TRIGGER_REARM {
            if kernel_global!(LINK_TRIGGER_RELEASE_AGE)[voice_slot][target_link_index] < 0.0 {
                kernel_global!(LINK_TRIGGER_RELEASE_AGE)[voice_slot][target_link_index] = age;
            }
            kernel_global!(LINK_TRIGGER_ARMED)[voice_slot][mod_link_index] = true;
        }
    }
}

fn apply_phase_reset_trigger(
    target_node_index: usize,
    mod_link_index: usize,
    voice_slot: usize,
    value: f64,
) {
    if !value.is_finite() {
        return;
    }

    unsafe {
        let armed = kernel_global!(LINK_TRIGGER_ARMED)[voice_slot][mod_link_index];
        if armed && value >= ENVELOPE_TRIGGER_THRESHOLD {
            kernel_global!(PHASES)[voice_slot][target_node_index] = 0.0;
            kernel_global!(CUSTOM_WAVE_DONE)[voice_slot][target_node_index] = false;
            kernel_global!(CUSTOM_WAVE_DIRECTIONS)[voice_slot][target_node_index] = 1.0;
            kernel_global!(CUSTOM_WAVE_TRIGGERED)[voice_slot][target_node_index] = true;
            kernel_global!(LINK_TRIGGER_ARMED)[voice_slot][mod_link_index] = false;
        } else if !armed && value <= ENVELOPE_TRIGGER_REARM {
            kernel_global!(LINK_TRIGGER_ARMED)[voice_slot][mod_link_index] = true;
        }
    }
}

fn apply_sample_trigger(
    target_node_index: usize,
    mod_link_index: usize,
    voice_slot: usize,
    age: f64,
    value: f64,
    start_mod: f64,
    end_mod: f64,
) {
    if !value.is_finite() {
        return;
    }

    unsafe {
        let armed = kernel_global!(LINK_TRIGGER_ARMED)[voice_slot][mod_link_index];
        if armed && value >= ENVELOPE_TRIGGER_THRESHOLD {
            if target_node_index < kernel_global!(NODE_COUNT) {
                start_sample_player(
                    target_node_index,
                    voice_slot,
                    kernel_global!(NODES)[target_node_index],
                    start_mod,
                    end_mod,
                );
                trigger_node_output_envelopes(target_node_index, voice_slot, age);
            }
            kernel_global!(LINK_TRIGGER_ARMED)[voice_slot][mod_link_index] = false;
        } else if !armed && value <= ENVELOPE_TRIGGER_REARM {
            kernel_global!(LINK_TRIGGER_ARMED)[voice_slot][mod_link_index] = true;
        }
    }
}

fn random_unit(voice_slot: usize) -> f64 {
    unsafe {
        let state = kernel_global!(RNG_STATES)[voice_slot]
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        kernel_global!(RNG_STATES)[voice_slot] = state;
        state as f64 / u32::MAX as f64
    }
}

fn random_bipolar(voice_slot: usize) -> f64 {
    random_unit(voice_slot) * 2.0 - 1.0
}

fn advance_random_state(state: u32) -> u32 {
    state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223)
}

fn next_dsp_random_seed() -> u32 {
    unsafe {
        kernel_global!(DSP_RANDOM_SEED_STREAM) =
            advance_random_state(kernel_global!(DSP_RANDOM_SEED_STREAM));
        kernel_global!(DSP_RANDOM_SEED_STREAM)
    }
}

fn random_unit_from_state(state: &mut u32) -> f64 {
    *state = advance_random_state(*state);
    *state as f64 / u32::MAX as f64
}

fn dsp_random_unit(local_state: Option<&mut u32>) -> f64 {
    local_state.map_or_else(|| random_unit(DRONE_VOICE_SLOT), random_unit_from_state)
}

fn dsp_random_bipolar(local_state: Option<&mut u32>) -> f64 {
    dsp_random_unit(local_state) * 2.0 - 1.0
}

#[cfg(test)]
mod random_tests {
    use super::{advance_random_state, random_unit_from_state};

    #[test]
    fn separate_seeds_produce_separate_sequences() {
        let mut first = advance_random_state(1);
        let mut second = advance_random_state(2);
        assert_ne!(
            random_unit_from_state(&mut first),
            random_unit_from_state(&mut second)
        );
        assert_ne!(first, second);
    }

    #[test]
    fn generator_advances_only_when_called() {
        let mut state = advance_random_state(123);
        let held_state = state;
        let _ = random_unit_from_state(&mut state);
        assert_eq!(held_state, advance_random_state(123));
        assert_ne!(state, held_state);
    }
}

fn apply_link_noise(sample: f64, link: Link, voice_slot: usize) -> f64 {
    if link.noise <= 0.0 {
        return sanitize_sample(sample, 4.0);
    }
    sanitize_sample(sample + random_bipolar(voice_slot) * link.noise, 4.0)
}

fn filter_coefficients(
    filter_type: i32,
    cutoff: f64,
    q: f64,
    sample_rate: f64,
) -> (f64, f64, f64, f64, f64) {
    let cutoff = cutoff.clamp(20.0, sample_rate * 0.45);
    let q = q.clamp(0.1, 96.0);
    let omega = TWO_PI * cutoff / sample_rate;
    let sin = omega.sin();
    let cos = omega.cos();
    let alpha = sin / (2.0 * q);
    let mut b0 = 1.0;
    let mut b1 = 0.0;
    let mut b2 = 0.0;
    let a0 = 1.0 + alpha;
    let a1 = -2.0 * cos;
    let a2 = 1.0 - alpha;

    if filter_type == 1 {
        b0 = (1.0 - cos) * 0.5;
        b1 = 1.0 - cos;
        b2 = (1.0 - cos) * 0.5;
    } else if filter_type == 2 {
        b0 = (1.0 + cos) * 0.5;
        b1 = -(1.0 + cos);
        b2 = (1.0 + cos) * 0.5;
    } else if filter_type == 3 {
        b0 = alpha;
        b1 = 0.0;
        b2 = -alpha;
    } else if filter_type == 8 {
        b0 = a2;
        b1 = a1;
        b2 = a0;
    }

    (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
}

fn equalizer_coefficients(band: i32, gain_db: f64, sample_rate: f64) -> (f64, f64, f64, f64, f64) {
    let (frequency, q): (f64, f64) = match band {
        1 => (1_000.0, 0.9),
        2 => (5_000.0, 0.707),
        _ => (180.0, 0.707),
    };
    let omega = TWO_PI * frequency.clamp(20.0, sample_rate * 0.45) / sample_rate.max(1.0);
    let sin = omega.sin();
    let cos = omega.cos();
    let gain = gain_db.clamp(-24.0, 24.0);
    let a = 10.0_f64.powf(gain / 40.0);
    let alpha = sin / (2.0 * q);
    let beta = 2.0 * a.sqrt() * alpha;

    let (b0, b1, b2, a0, a1, a2) = match band {
        1 => (
            1.0 + alpha * a,
            -2.0 * cos,
            1.0 - alpha * a,
            1.0 + alpha / a,
            -2.0 * cos,
            1.0 - alpha / a,
        ),
        2 => (
            a * ((a + 1.0) + (a - 1.0) * cos + beta),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
            a * ((a + 1.0) + (a - 1.0) * cos - beta),
            (a + 1.0) - (a - 1.0) * cos + beta,
            2.0 * ((a - 1.0) - (a + 1.0) * cos),
            (a + 1.0) - (a - 1.0) * cos - beta,
        ),
        _ => (
            a * ((a + 1.0) - (a - 1.0) * cos + beta),
            2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
            a * ((a + 1.0) - (a - 1.0) * cos - beta),
            (a + 1.0) + (a - 1.0) * cos + beta,
            -2.0 * ((a - 1.0) + (a + 1.0) * cos),
            (a + 1.0) + (a - 1.0) * cos - beta,
        ),
    };

    (b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0)
}

fn apply_biquad_filter(
    state: &mut FilterState,
    sample: f64,
    coefficients: (f64, f64, f64, f64, f64),
) -> f64 {
    let (b0, b1, b2, a1, a2) = coefficients;
    let output = b0 * sample + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
    state.x2 = state.x1;
    state.x1 = sanitize_sample(sample, 4.0);
    state.y2 = state.y1;
    state.y1 = sanitize_sample(output, 4.0);
    state.y1
}

fn formant_band(
    morph: f64,
    intensity: f64,
    band_index: usize,
    sample_rate: f64,
) -> (f64, f64, f64) {
    let position = morph.clamp(0.0, 1.0) * ((FORMANT_VOWELS.len() - 1) as f64);
    let left_index = position.floor() as usize;
    let right_index = (left_index + 1).min(FORMANT_VOWELS.len() - 1);
    let t = position - left_index as f64;
    let strength = ((intensity - 0.1) / 11.9).clamp(0.0, 1.0);
    let overdrive = ((intensity - 12.0) / (FORMANT_INTENSITY_MAX - 12.0)).clamp(0.0, 1.0);
    let left = FORMANT_VOWELS[left_index][band_index];
    let right = FORMANT_VOWELS[right_index][band_index];
    let frequency = (left.frequency * (right.frequency / left.frequency).powf(t))
        .clamp(20.0, sample_rate * 0.45);
    let q = (left.q + (right.q - left.q) * t) * (0.7 + strength * 1.9 + overdrive * 4.2);
    let gain_db =
        left.gain_db + (right.gain_db - left.gain_db) * t + strength * 4.0 + overdrive * 18.0;
    (frequency, q.clamp(0.1, 96.0), 10.0_f64.powf(gain_db / 20.0))
}

fn apply_formant_filter(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    sample: f64,
) -> f64 {
    let intensity = link.filter_resonance.clamp(0.1, FORMANT_INTENSITY_MAX);
    let strength = ((intensity - 0.1) / 11.9).clamp(0.0, 1.0);
    let overdrive = ((intensity - 12.0) / (FORMANT_INTENSITY_MAX - 12.0)).clamp(0.0, 1.0);
    let mut wet = 0.0;

    unsafe {
        for band_index in 0..MAX_FORMANT_BANDS {
            let (frequency, q, gain) =
                formant_band(link.filter_cutoff, intensity, band_index, sample_rate);
            let coefficients = filter_coefficients(3, frequency, q, sample_rate);
            wet += apply_biquad_filter(
                &mut kernel_global!(LINK_FORMANT_FILTERS)[voice_slot][link_index][band_index],
                sample,
                coefficients,
            ) * gain;
        }
    }

    let dry_mix = 0.42 - strength * 0.18 - overdrive * 0.16;
    let wet_mix = 0.46 + strength * 0.38 + overdrive * 0.95;
    sanitize_sample(sample * dry_mix + wet * wet_mix, 4.0)
}

fn comb_slot_for_link(link_index: usize) -> Option<usize> {
    unsafe {
        if link_index >= MAX_LINKS {
            return None;
        }
        let existing = kernel_global!(LINK_COMB_SLOTS)[link_index];
        (existing >= 0).then_some(existing as usize)
    }
}

fn prepare_comb_slot_for_link(link_index: usize) -> Option<usize> {
    unsafe {
        if let Some(slot) = comb_slot_for_link(link_index) {
            return Some(slot);
        }
        if link_index >= MAX_LINKS || kernel_global!(LINK_COMB_SLOT_COUNT) >= MAX_COMB_SLOTS {
            return None;
        }
        let slot = kernel_global!(LINK_COMB_SLOT_COUNT);
        kernel_global!(LINK_COMB_SLOT_COUNT) += 1;
        kernel_global!(LINK_COMB_SLOTS)[link_index] = slot as i32;
        for voice_slot in 0..MAX_VOICE_SLOTS {
            let buffer_index = voice_slot * MAX_COMB_SLOTS + slot;
            if kernel_global!(LINK_COMB_BUFFERS)[buffer_index].is_none() {
                kernel_global!(LINK_COMB_BUFFERS)[buffer_index] =
                    Some(zeroed_f32_buffer(MAX_DELAY_SAMPLES));
            }
        }
        Some(slot)
    }
}

fn apply_comb_filter(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    sample: f64,
) -> f64 {
    let Some(slot) = comb_slot_for_link(link_index) else {
        return sanitize_sample(sample, 4.0);
    };
    let clean_sample = sanitize_sample(sample, 4.0);
    let frequency = link
        .filter_cutoff
        .clamp(20.0, sample_rate * 0.45)
        .min(5_000.0);
    let delay_samples = (sample_rate / frequency).clamp(1.0, (MAX_DELAY_SAMPLES - 1) as f64);
    let feedback = link.filter_resonance.clamp(-0.98, 0.98);

    unsafe {
        let buffer_index = voice_slot * MAX_COMB_SLOTS + slot;
        let Some(buffer) = kernel_global!(LINK_COMB_BUFFERS)[buffer_index].as_mut() else {
            return clean_sample;
        };
        if !kernel_global!(LINK_COMB_READY)[voice_slot][slot] {
            buffer.fill(0.0);
            kernel_global!(LINK_COMB_INDICES)[voice_slot][slot] = 0;
            kernel_global!(LINK_COMB_READY)[voice_slot][slot] = true;
        }
        let write_index = kernel_global!(LINK_COMB_INDICES)[voice_slot][slot];
        let delayed = read_delay(buffer, write_index, delay_samples);
        let write_value = sanitize_sample(clean_sample + delayed * feedback, 4.0);
        buffer[write_index] = write_value as f32;
        kernel_global!(LINK_COMB_INDICES)[voice_slot][slot] = (write_index + 1) % MAX_DELAY_SAMPLES;
        if link.filter_type == 6 {
            sanitize_sample(clean_sample - delayed * feedback.abs().max(0.45), 4.0)
        } else {
            sanitize_sample(delayed, 4.0)
        }
    }
}

fn apply_link_filter(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    sample: f64,
) -> f64 {
    if link.filter_type == 0 {
        return sample;
    }
    if link.filter_type == 4 {
        return apply_formant_filter(link_index, link, voice_slot, sample_rate, sample);
    }
    if link.filter_type == 5 || link.filter_type == 6 {
        return apply_comb_filter(link_index, link, voice_slot, sample_rate, sample);
    }

    let coefficients = filter_coefficients(
        link.filter_type,
        link.filter_cutoff,
        link.filter_resonance,
        sample_rate,
    );
    unsafe {
        apply_biquad_filter(
            &mut kernel_global!(LINK_FILTERS)[voice_slot][link_index],
            sample,
            coefficients,
        )
    }
}

fn apply_link_distortion(sample: f64, link: Link, voice_slot: usize) -> f64 {
    if link.distortion_type == 0 {
        return sample;
    }
    let gain = link.distortion_gain.clamp(0.1, 40.0);
    let driven = sanitize_sample(sample * gain, 32.0);
    let output = match link.distortion_type {
        1 => driven.clamp(-1.0, 1.0),
        3 => {
            let fuzz = driven.signum() * (1.0 - (-driven.abs() * 2.6).exp());
            fuzz + random_bipolar(voice_slot) * (gain * 0.002).min(0.08)
        }
        4 => driven / (1.0 + driven.abs()),
        5 => fold_sample(sample, gain),
        _ => driven.tanh(),
    };
    sanitize_sample(output, 4.0)
}

fn delay_slot_for_link(link_index: usize) -> Option<usize> {
    unsafe {
        if link_index >= MAX_LINKS {
            return None;
        }
        let existing = kernel_global!(LINK_DELAY_SLOTS)[link_index];
        (existing >= 0).then_some(existing as usize)
    }
}

fn prepare_delay_slot_for_link(link_index: usize) -> Option<usize> {
    unsafe {
        if let Some(slot) = delay_slot_for_link(link_index) {
            return Some(slot);
        }
        if link_index >= MAX_LINKS || kernel_global!(LINK_DELAY_SLOT_COUNT) >= MAX_DELAY_SLOTS {
            return None;
        }
        let slot = kernel_global!(LINK_DELAY_SLOT_COUNT);
        kernel_global!(LINK_DELAY_SLOT_COUNT) += 1;
        kernel_global!(LINK_DELAY_SLOTS)[link_index] = slot as i32;
        for voice_slot in 0..MAX_VOICE_SLOTS {
            let buffer_index = voice_slot * MAX_DELAY_SLOTS + slot;
            if kernel_global!(LINK_DELAY_BUFFERS)[buffer_index].is_none() {
                kernel_global!(LINK_DELAY_BUFFERS)[buffer_index] =
                    Some(zeroed_f32_buffer(MAX_DELAY_SAMPLES));
            }
        }
        Some(slot)
    }
}

fn read_delay(buffer: &[f32], write_index: usize, delay_samples: f64) -> f64 {
    let length = buffer.len() as f64;
    let mut index = write_index as f64 - delay_samples;
    while index < 0.0 {
        index += length;
    }
    let index_floor = index.floor();
    let index_a = index_floor as usize % MAX_DELAY_SAMPLES;
    let index_b = (index_a + 1) % MAX_DELAY_SAMPLES;
    let fraction = index - index_floor;
    buffer[index_a] as f64 * (1.0 - fraction) + buffer[index_b] as f64 * fraction
}

fn apply_link_delay(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    sample: f64,
) -> f64 {
    let clean_sample = sanitize_sample(sample, 4.0);
    if link.delay <= 0.0 {
        return clean_sample;
    }

    let Some(slot) = delay_slot_for_link(link_index) else {
        return clean_sample;
    };
    let max_delay_samples = (MAX_DELAY_SAMPLES - 1) as f64;
    let delay_samples = (link.delay * sample_rate).clamp(1.0, max_delay_samples);

    unsafe {
        let buffer_index = voice_slot * MAX_DELAY_SLOTS + slot;
        let Some(buffer) = kernel_global!(LINK_DELAY_BUFFERS)[buffer_index].as_mut() else {
            return clean_sample;
        };
        if !kernel_global!(LINK_DELAY_READY)[voice_slot][slot] {
            buffer.fill(clean_sample as f32);
            kernel_global!(LINK_DELAY_INDICES)[voice_slot][slot] = 0;
            kernel_global!(LINK_DELAY_READY)[voice_slot][slot] = true;
        }
        let write_index = kernel_global!(LINK_DELAY_INDICES)[voice_slot][slot];
        let delayed = read_delay(buffer, write_index, delay_samples);
        buffer[write_index] = clean_sample as f32;
        kernel_global!(LINK_DELAY_INDICES)[voice_slot][slot] =
            (write_index + 1) % MAX_DELAY_SAMPLES;
        sanitize_sample(delayed, 4.0)
    }
}

fn apply_signal_mode(
    link_index: usize,
    link: Link,
    voice_slot: usize,
    sample_rate: f64,
    sample: f64,
) -> f64 {
    if link.signal_mode == 0 {
        return sample;
    }

    if link.signal_mode == 3 {
        return sample.abs();
    }
    if link.signal_mode == 4 {
        return map_sample(sample, link);
    }
    if link.signal_mode == 5 {
        return map_sample(sample.abs(), link);
    }
    if link.signal_mode == 6 {
        return map_sample(sample, link).abs();
    }

    unsafe {
        let input = sample.abs().clamp(0.0, 1.0);
        let current = kernel_global!(LINK_FOLLOWERS)[voice_slot][link_index];
        let time = if input > current {
            link.follower_attack
        } else {
            link.follower_release
        };
        let alpha = 1.0 - (-1.0 / (sample_rate * time.max(0.001))).exp();
        let next = (current + (input - current) * alpha).clamp(0.0, 1.0);
        kernel_global!(LINK_FOLLOWERS)[voice_slot][link_index] = next;
        if link.signal_mode == 2 {
            1.0 - next
        } else {
            next
        }
    }
}

fn map_sample(sample: f64, link: Link) -> f64 {
    let source_range = link.map_src_max - link.map_src_min;
    let denominator = if source_range.abs() < 0.000001 {
        0.000001
    } else {
        source_range
    };
    link.map_target_min
        + ((sample - link.map_src_min) / denominator) * (link.map_target_max - link.map_target_min)
}

struct LinkSignal {
    signal: f64,
    amount: f64,
    pan: f64,
    value: f64,
}

#[derive(Copy, Clone)]
struct ParamAccumulator {
    set_sum: f64,
    set_count: f64,
    add: f64,
    multiply: f64,
    bend: f64,
}

impl ParamAccumulator {
    fn new() -> Self {
        Self {
            set_sum: 0.0,
            set_count: 0.0,
            add: 0.0,
            multiply: 1.0,
            bend: 0.0,
        }
    }

    fn push(&mut self, mode: i32, value: f64) {
        if !value.is_finite() {
            return;
        }

        match mode {
            PARAM_MODE_MULTIPLY => self.multiply *= value,
            PARAM_MODE_BEND => self.bend += value,
            PARAM_MODE_ADD => self.add += value,
            _ => {
                self.set_sum += value;
                self.set_count += 1.0;
            }
        }
    }

    fn apply(self, base: f64) -> f64 {
        let value = if self.set_count > 0.0 {
            self.set_sum / self.set_count
        } else {
            base
        };
        (value + self.add) * self.multiply * 2.0_f64.powf(self.bend.clamp(-32.0, 32.0))
    }
}

fn effective_link_params(
    link_index: usize,
    voice_slot: usize,
    sample_rate: f64,
    note_frequency: f64,
    velocity: f64,
    age: f64,
    release_age: f64,
    frame: usize,
    stamp: u32,
) -> Link {
    unsafe {
        if link_index >= kernel_global!(LINK_COUNT) {
            return EMPTY_LINK;
        }

        let base = kernel_global!(LINKS)[link_index];
        if kernel_global!(LINK_PARAM_STACK)[link_index] {
            return base;
        }

        kernel_global!(LINK_PARAM_STACK)[link_index] = true;

        let mut amount_mod = ParamAccumulator::new();
        let mut delay_mod = ParamAccumulator::new();
        let mut noise_mod = ParamAccumulator::new();
        let mut pan_mod = ParamAccumulator::new();
        let mut cutoff_mod = ParamAccumulator::new();
        let mut resonance_mod = ParamAccumulator::new();
        let mut distortion_gain_mod = ParamAccumulator::new();
        let mut env_delay_mod = ParamAccumulator::new();
        let mut env_attack_mod = ParamAccumulator::new();
        let mut env_decay_mod = ParamAccumulator::new();
        let mut env_sustain_mod = ParamAccumulator::new();
        let mut env_release_mod = ParamAccumulator::new();
        let mut map_src_min_mod = ParamAccumulator::new();
        let mut map_src_max_mod = ParamAccumulator::new();
        let mut map_target_min_mod = ParamAccumulator::new();
        let mut map_target_max_mod = ParamAccumulator::new();

        let mut mod_cursor = kernel_global!(LINK_FIRST_MODULATOR)[link_index];
        while mod_cursor >= 0 {
            let mod_index = mod_cursor as usize;
            let mod_link = kernel_global!(LINKS)[mod_index];
            mod_cursor = kernel_global!(LINK_NEXT_MODULATOR)[mod_index];
            if mod_link.from < 0 {
                continue;
            }

            let source = render_node(
                mod_link.from as usize,
                voice_slot,
                sample_rate,
                note_frequency,
                velocity,
                age,
                release_age,
                frame,
                stamp,
            );
            let modulation = render_link_signal(
                mod_index,
                source,
                voice_slot,
                sample_rate,
                note_frequency,
                velocity,
                age,
                release_age,
                frame,
                stamp,
                mod_link.target == TARGET_ENVELOPE_TRIGGER,
            );

            match mod_link.target {
                TARGET_AMPLITUDE => amount_mod.push(mod_link.parameter_mode, modulation.value),
                TARGET_DELAY => delay_mod.push(mod_link.parameter_mode, modulation.value),
                TARGET_NOISE => noise_mod.push(mod_link.parameter_mode, modulation.value),
                TARGET_PAN => pan_mod.push(mod_link.parameter_mode, modulation.value),
                TARGET_FILTER_CUTOFF => cutoff_mod.push(mod_link.parameter_mode, modulation.value),
                TARGET_FILTER_RESONANCE => {
                    resonance_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_DISTORTION_GAIN => {
                    distortion_gain_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_DELAY => {
                    env_delay_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_ATTACK => {
                    env_attack_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_DECAY => {
                    env_decay_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_SUSTAIN => {
                    env_sustain_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_RELEASE => {
                    env_release_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_MAP_SRC_MIN => {
                    map_src_min_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_MAP_SRC_MAX => {
                    map_src_max_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_MAP_TARGET_MIN => {
                    map_target_min_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_MAP_TARGET_MAX => {
                    map_target_max_mod.push(mod_link.parameter_mode, modulation.value)
                }
                TARGET_ENVELOPE_TRIGGER => {
                    apply_envelope_trigger(
                        link_index,
                        mod_index,
                        voice_slot,
                        age,
                        modulation.value,
                    );
                }
                _ => cutoff_mod.push(mod_link.parameter_mode, modulation.value),
            }
        }

        let mut effective = base;
        effective.amount = amount_mod.apply(base.amount).clamp(-32.0, 32.0);
        effective.delay = delay_mod.apply(base.delay).clamp(0.0, 3.0);
        effective.noise = noise_mod.apply(base.noise).clamp(0.0, 1.0);
        effective.pan = pan_mod.apply(base.pan).clamp(-1.0, 1.0);
        let cutoff_value = cutoff_mod.apply(base.filter_cutoff);
        effective.filter_cutoff = if base.filter_type == 4 {
            cutoff_value.clamp(0.0, 1.0)
        } else {
            cutoff_value.clamp(20.0, sample_rate * 0.45)
        };
        effective.filter_resonance = resonance_mod.apply(base.filter_resonance).clamp(
            0.1,
            if base.filter_type == 4 {
                FORMANT_INTENSITY_MAX
            } else {
                12.0
            },
        );
        effective.distortion_gain = distortion_gain_mod
            .apply(base.distortion_gain)
            .clamp(0.1, 40.0);
        effective.env_delay = env_delay_mod.apply(base.env_delay).clamp(0.0, 4.0);
        effective.env_attack = env_attack_mod.apply(base.env_attack).clamp(0.001, 4.0);
        effective.env_decay = env_decay_mod.apply(base.env_decay).clamp(0.001, 4.0);
        effective.env_sustain = env_sustain_mod.apply(base.env_sustain).clamp(0.0, 1.0);
        effective.env_release = env_release_mod.apply(base.env_release).clamp(0.001, 6.0);
        effective.map_src_min = map_src_min_mod.apply(base.map_src_min);
        effective.map_src_max = map_src_max_mod.apply(base.map_src_max);
        effective.map_target_min = map_target_min_mod.apply(base.map_target_min);
        effective.map_target_max = map_target_max_mod.apply(base.map_target_max);

        kernel_global!(LINK_PARAM_STACK)[link_index] = false;
        effective
    }
}

#[allow(clippy::too_many_arguments)]
fn render_link_signal(
    link_index: usize,
    source: f64,
    voice_slot: usize,
    sample_rate: f64,
    note_frequency: f64,
    velocity: f64,
    age: f64,
    release_age: f64,
    frame: usize,
    stamp: u32,
    ignore_envelope: bool,
) -> LinkSignal {
    let link = effective_link_params(
        link_index,
        voice_slot,
        sample_rate,
        note_frequency,
        velocity,
        age,
        release_age,
        frame,
        stamp,
    );
    let filtered_source = apply_link_filter(link_index, link, voice_slot, sample_rate, source);
    let signal_source =
        apply_signal_mode(link_index, link, voice_slot, sample_rate, filtered_source);
    let noisy_source = apply_link_noise(signal_source, link, voice_slot);
    let distorted_source = apply_link_distortion(noisy_source, link, voice_slot);
    let envelope = if ignore_envelope {
        1.0
    } else {
        triggered_envelope_value(
            link_index,
            link,
            voice_slot,
            sample_rate,
            note_frequency,
            age,
            release_age,
        )
    };
    let delayed_source = apply_link_delay(
        link_index,
        link,
        voice_slot,
        sample_rate,
        distorted_source * envelope * velocity_scale(link.velocity_sensitivity, velocity),
    );
    observe_link_meter(link_index, source, delayed_source * link.amount, envelope);
    LinkSignal {
        signal: delayed_source,
        amount: link.amount,
        pan: link.pan,
        value: delayed_source * link.amount,
    }
}

fn render_node(
    node_index: usize,
    voice_slot: usize,
    sample_rate: f64,
    note_frequency: f64,
    velocity: f64,
    age: f64,
    release_age: f64,
    frame: usize,
    stamp: u32,
) -> f64 {
    unsafe {
        if node_index >= kernel_global!(NODE_COUNT) {
            return 0.0;
        }
        if kernel_global!(CACHE_STAMPS)[node_index] == stamp {
            return kernel_global!(RENDER_CACHE)[node_index];
        }
        if kernel_global!(RENDER_STACK)[node_index] {
            return kernel_global!(FEEDBACK)[voice_slot][node_index];
        }

        kernel_global!(RENDER_STACK)[node_index] = true;
        let node = kernel_global!(NODES)[node_index];
        let node_base_frequency = if node.wave == 7 {
            node.speed
        } else {
            base_frequency(node, note_frequency)
        };
        let mut phase_mod = ParamAccumulator::new();
        let mut frequency_mod = ParamAccumulator::new();
        let mut wave_mod = ParamAccumulator::new();
        let mut fold_drive = ParamAccumulator::new();
        let mut mix_amount = ParamAccumulator::new();
        let mut mix_signal = 0.0;
        let mut ring_amount = ParamAccumulator::new();
        let mut ring_signal = 0.0;
        let mut sample_start_mod = ParamAccumulator::new();
        let mut sample_end_mod = ParamAccumulator::new();
        let mut sample_stretch_mod = ParamAccumulator::new();

        for link_index in 0..kernel_global!(LINK_COUNT) {
            let link = kernel_global!(LINKS)[link_index];
            if link.to != node_index as i32 {
                continue;
            }
            let source = if link.from == node_index as i32 {
                kernel_global!(FEEDBACK)[voice_slot][node_index]
            } else if link.from >= 0 {
                render_node(
                    link.from as usize,
                    voice_slot,
                    sample_rate,
                    note_frequency,
                    velocity,
                    age,
                    release_age,
                    frame,
                    stamp,
                )
            } else {
                0.0
            };
            let modulation = render_link_signal(
                link_index,
                source,
                voice_slot,
                sample_rate,
                note_frequency,
                velocity,
                age,
                release_age,
                frame,
                stamp,
                link.target == TARGET_PHASE_RESET_TRIGGER,
            );
            match link.target {
                TARGET_FREQUENCY => frequency_mod.push(link.parameter_mode, modulation.value),
                TARGET_WAVE => wave_mod.push(link.parameter_mode, modulation.value),
                TARGET_PHASE_RESET_TRIGGER => {
                    apply_phase_reset_trigger(node_index, link_index, voice_slot, modulation.value);
                }
                TARGET_SAMPLE_START => sample_start_mod.push(link.parameter_mode, modulation.value),
                TARGET_SAMPLE_END => sample_end_mod.push(link.parameter_mode, modulation.value),
                TARGET_SAMPLE_STRETCH => {
                    sample_stretch_mod.push(link.parameter_mode, modulation.value)
                }
                TARGET_SAMPLE_TRIGGER => {
                    let start_mod = sample_start_mod.apply(node.sample_start) - node.sample_start;
                    let end_mod = sample_end_mod.apply(node.sample_end) - node.sample_end;
                    apply_sample_trigger(
                        node_index,
                        link_index,
                        voice_slot,
                        age,
                        modulation.value,
                        start_mod,
                        end_mod,
                    );
                }
                TARGET_RING => {
                    ring_amount.push(link.parameter_mode, modulation.amount);
                    ring_signal += modulation.signal * modulation.amount;
                }
                TARGET_FOLD => fold_drive.push(link.parameter_mode, modulation.value.abs()),
                TARGET_MIX => {
                    mix_amount.push(link.parameter_mode, modulation.amount.max(0.0));
                    mix_signal += modulation.signal * modulation.amount.max(0.0);
                }
                _ => phase_mod.push(link.parameter_mode, modulation.value),
            }
        }

        let phase = kernel_global!(PHASES)[voice_slot][node_index];
        let linked_frequency = frequency_mod.apply(node_base_frequency);
        let frequency_value = if node.wave == 10 {
            linked_frequency
        } else {
            linked_frequency.max(0.0)
        };
        let phase_value = phase_mod.apply(0.0);
        let wave_value = wave_mod.apply(0.0);
        let fold_value = fold_drive.apply(0.0);
        let mix_value = mix_amount.apply(0.0);
        let ring_value = ring_amount.apply(0.0);
        let sample_start_value = sample_start_mod.apply(node.sample_start);
        let sample_end_value = sample_end_mod.apply(node.sample_end);
        let sample_stretch_value = sample_stretch_mod.apply(node.sample_stretch);
        let sample_start_offset = sample_start_value - node.sample_start;
        let sample_end_offset = sample_end_value - node.sample_end;
        let sample_stretch_offset = sample_stretch_value - node.sample_stretch;
        let active_wave = node.wave == 6
            || node.wave == 8
            || node.wave == 10
            || node.wave == 11
            || frequency_value > 0.0;
        let wave = modulated_wave(node.wave, wave_value);
        let custom_done = node.wave == 9
            && custom_mode_is_finite(node.custom_mode)
            && kernel_global!(CUSTOM_WAVE_DONE)[voice_slot][node_index];
        let custom_base_level = if node.wave == 9 && custom_mode_is_finite(node.custom_mode) {
            custom_wave_curve_value(node_index, 0.0, false, None)
        } else {
            0.0
        };
        let mut value = if active_wave && !custom_done {
            if node.wave == 10 {
                sync_sample_frequency_direction(node_index, voice_slot, node, frequency_value);
                sample_value(
                    node_index,
                    node,
                    voice_slot,
                    sample_rate,
                    sample_start_offset,
                    sample_end_offset,
                    sample_stretch_offset,
                )
            } else {
                oscillator(
                    node_index,
                    node,
                    phase + phase_value,
                    voice_slot,
                    frame,
                    wave,
                    0.5,
                )
            }
        } else {
            custom_base_level
        };
        let custom_edge_gain = custom_one_shot_edge_gain(node, phase, frequency_value);
        value = custom_base_level + (value - custom_base_level) * custom_edge_gain;

        if ring_value > 0.0 {
            let depth = ring_value.clamp(0.0, 1.0);
            value = sanitize_sample(
                value * (1.0 - depth) + value * (ring_signal / ring_value) * depth,
                4.0,
            );
        }
        if fold_value > 0.0 {
            value = sanitize_sample(
                fold_sample(value, 1.0 + fold_value.clamp(0.0, 8.0) * 3.0),
                4.0,
            );
        }
        if mix_value > 0.0 {
            let mix = mix_value.clamp(0.0, 1.0);
            let carrier_gain = if mix <= 0.5 {
                1.0
            } else {
                1.0 - (mix - 0.5) * 2.0
            };
            let modulator_gain = if mix_value > 1.0 {
                mix_value
            } else if mix >= 0.5 {
                1.0
            } else {
                mix * 2.0
            };
            value = sanitize_sample(
                value * carrier_gain + (mix_signal / mix_value) * modulator_gain,
                4.0,
            );
        }

        value = sanitize_sample(value, 4.0);
        kernel_global!(FREQUENCY_MODS)[node_index] = frequency_value;
        kernel_global!(FREQUENCY_MOD_ACTIVE)[node_index] = true;
        kernel_global!(SAMPLE_STRETCH_MODS)[node_index] = sample_stretch_offset;
        kernel_global!(RENDER_CACHE)[node_index] = value;
        kernel_global!(CACHE_STAMPS)[node_index] = stamp;
        kernel_global!(FEEDBACK)[voice_slot][node_index] = value;
        kernel_global!(RENDER_STACK)[node_index] = false;
        value
    }
}

fn finish_custom_phase(voice_slot: usize, node_index: usize, mut direction: f64, value: f64) {
    unsafe {
        if value >= 1.0 {
            kernel_global!(CUSTOM_WAVE_DONE)[voice_slot][node_index] = true;
            kernel_global!(PHASES)[voice_slot][node_index] = 1.0;
        } else {
            kernel_global!(PHASES)[voice_slot][node_index] = value.clamp(0.0, 1.0);
        }
        if direction == 0.0 {
            direction = 1.0;
        }
        kernel_global!(CUSTOM_WAVE_DIRECTIONS)[voice_slot][node_index] = direction;
    }
}

fn advance_custom_wave_phase(
    voice_slot: usize,
    node_index: usize,
    node: Node,
    step: f64,
    release_age: f64,
) {
    unsafe {
        let released = release_age >= 0.0;
        let current = kernel_global!(PHASES)[voice_slot][node_index];
        let mut direction = kernel_global!(CUSTOM_WAVE_DIRECTIONS)[voice_slot][node_index];
        if direction == 0.0 {
            direction = 1.0;
        }
        let start = node.custom_sustain_start.clamp(0.0, 0.999);
        let end = node.custom_sustain_end.clamp(start + 0.001, 1.0);
        let length = (end - start).max(0.001);

        match node.custom_mode {
            CUSTOM_MODE_PING_PONG => {
                let mut next = current + step * direction;
                if next >= 1.0 {
                    next = 1.0 - (next - 1.0);
                    direction = -1.0;
                } else if next <= 0.0 {
                    next = -next;
                    direction = 1.0;
                }
                finish_custom_phase(voice_slot, node_index, direction, next);
            }
            CUSTOM_MODE_ONCE => {
                finish_custom_phase(voice_slot, node_index, direction, current + step);
            }
            CUSTOM_MODE_SUSTAIN => {
                let mut next = current + step;
                if !released && next >= start {
                    next = start;
                }
                finish_custom_phase(voice_slot, node_index, direction, next);
            }
            CUSTOM_MODE_SUSTAIN_LOOP => {
                let mut next = current + step;
                if !released && next >= start {
                    next = start + (((next - start) % length) + length) % length;
                }
                finish_custom_phase(voice_slot, node_index, direction, next);
            }
            CUSTOM_MODE_SUSTAIN_PING_PONG => {
                let mut next = current + step * direction;
                if !released {
                    if next >= end {
                        next = end - (next - end);
                        direction = -1.0;
                    } else if next <= start && current >= start {
                        next = start + (start - next);
                        direction = 1.0;
                    } else if next >= start && current < start {
                        direction = 1.0;
                    }
                    finish_custom_phase(voice_slot, node_index, direction, next);
                } else {
                    if direction < 0.0 && next <= start {
                        next = start + (start - next);
                        direction = 1.0;
                    }
                    finish_custom_phase(voice_slot, node_index, direction, next);
                }
            }
            _ => {
                kernel_global!(PHASES)[voice_slot][node_index] = normalize_phase(current + step);
                kernel_global!(CUSTOM_WAVE_DIRECTIONS)[voice_slot][node_index] = direction;
            }
        }
    }
}

fn advance_phases(voice_slot: usize, sample_rate: f64, note_frequency: f64, release_age: f64) {
    unsafe {
        for node_index in 0..kernel_global!(NODE_COUNT) {
            let node = kernel_global!(NODES)[node_index];
            if node.wave == 6 || node.wave == 8 || node.wave == 11 {
                kernel_global!(FREQUENCY_MODS)[node_index] = 0.0;
                kernel_global!(FREQUENCY_MOD_ACTIVE)[node_index] = false;
                continue;
            }
            let base = if node.wave == 7 {
                node.speed
            } else {
                base_frequency(node, note_frequency)
            };
            let frequency = if kernel_global!(FREQUENCY_MOD_ACTIVE)[node_index] {
                kernel_global!(FREQUENCY_MODS)[node_index]
            } else {
                base
            };
            let target_frequency = if node.wave == 7 {
                frequency
            } else {
                quantise_frequency(node, frequency, note_frequency)
            };
            let effective_frequency = if node.wave == 7 {
                target_frequency
            } else {
                glide_frequency(voice_slot, node_index, node, target_frequency, sample_rate)
            };
            let step = effective_frequency / sample_rate;
            if node.wave == 9 {
                advance_custom_wave_phase(voice_slot, node_index, node, step, release_age);
                kernel_global!(FREQUENCY_MODS)[node_index] = 0.0;
                kernel_global!(FREQUENCY_MOD_ACTIVE)[node_index] = false;
                continue;
            }
            if node.wave == 10 {
                if kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] {
                    advance_sample_retrigger_fade(node_index, voice_slot, sample_rate);
                    let sample_step = sample_playback_step(
                        node_index,
                        node,
                        note_frequency,
                        frequency,
                        sample_rate,
                    )
                    .abs();
                    if sample_step > 0.0 {
                        kernel_global!(SAMPLE_HAS_ADVANCED)[voice_slot][node_index] = true;
                    }
                    let stretch = (node.sample_stretch
                        + kernel_global!(SAMPLE_STRETCH_MODS)[node_index])
                        .max(0.001);
                    if kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index] >= 0.0 {
                        kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index] +=
                            1.0 / sample_rate.max(1.0);
                        kernel_global!(SAMPLE_PLAYBACK_AGES)[voice_slot][node_index] +=
                            1.0 / sample_rate.max(1.0);
                        kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] += (sample_step
                            / stretch)
                            * kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index];
                        kernel_global!(SAMPLE_STRETCH_MODS)[node_index] = 0.0;
                        kernel_global!(FREQUENCY_MODS)[node_index] = 0.0;
                        kernel_global!(FREQUENCY_MOD_ACTIVE)[node_index] = false;
                        continue;
                    }
                    kernel_global!(SAMPLE_PLAYBACK_AGES)[voice_slot][node_index] +=
                        1.0 / sample_rate.max(1.0);
                    kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] += (sample_step
                        / stretch)
                        * kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index];
                    if (stretch - 1.0).abs() < 0.001 {
                        kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index] = 0.0;
                        kernel_global!(SAMPLE_STRETCH_ANCHORS)[voice_slot][node_index] =
                            kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index];
                    } else {
                        let (_, _, _, _, _, length) = sample_range(node_index, node, 0.0, 0.0)
                            .unwrap_or((0.0, 0.0, 0.0, 0.0, 1.0, 512.0));
                        let grain_frames =
                            node.sample_cycle_length.round().clamp(1.0, length.max(1.0));
                        let overlap_frames = if node.sample_overlap_ratio <= 0.0 {
                            0.0
                        } else {
                            (grain_frames * node.sample_overlap_ratio.clamp(0.0, 1.0))
                                .round()
                                .clamp(1.0, (grain_frames - 1.0).max(1.0))
                        };
                        let hop_frames = (grain_frames - overlap_frames).max(1.0);
                        kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index] +=
                            sample_step;
                        while kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index]
                            >= grain_frames
                        {
                            kernel_global!(SAMPLE_STRETCH_ANCHORS)[voice_slot][node_index] +=
                                (hop_frames / stretch)
                                    * kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index];
                            kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index] -=
                                hop_frames;
                        }
                    }
                }
                kernel_global!(SAMPLE_STRETCH_MODS)[node_index] = 0.0;
                kernel_global!(FREQUENCY_MODS)[node_index] = 0.0;
                kernel_global!(FREQUENCY_MOD_ACTIVE)[node_index] = false;
                continue;
            }
            let next_phase = kernel_global!(PHASES)[voice_slot][node_index] + step;
            if node.wave == 5 && next_phase >= 1.0 {
                kernel_global!(SAMPLE_HOLDS)[voice_slot][node_index] = random_unit(voice_slot);
                kernel_global!(SAMPLE_HOLD_SET)[voice_slot][node_index] = true;
            }
            if node.wave == 7 && next_phase >= 1.0 {
                if !kernel_global!(PERLIN_SET)[voice_slot][node_index] {
                    kernel_global!(PERLIN_CURRENT)[voice_slot][node_index] =
                        random_bipolar(voice_slot);
                    kernel_global!(PERLIN_NEXT)[voice_slot][node_index] =
                        random_bipolar(voice_slot);
                    kernel_global!(PERLIN_SET)[voice_slot][node_index] = true;
                }
                kernel_global!(PERLIN_CURRENT)[voice_slot][node_index] =
                    kernel_global!(PERLIN_NEXT)[voice_slot][node_index];
                kernel_global!(PERLIN_NEXT)[voice_slot][node_index] = random_bipolar(voice_slot);
            }
            kernel_global!(PHASES)[voice_slot][node_index] = normalize_phase(next_phase);
            kernel_global!(FREQUENCY_MODS)[node_index] = 0.0;
            kernel_global!(FREQUENCY_MOD_ACTIVE)[node_index] = false;
        }
    }
}

unsafe fn set_dsp_repeat_state(state_start: usize, state: &mut [f64]) {
    kernel_global!(DSP_REPEAT_STATE_PTR) = state.as_mut_ptr();
    kernel_global!(DSP_REPEAT_STATE_START) = state_start;
    kernel_global!(DSP_REPEAT_STATE_COUNT) = state.len();
}

unsafe fn clear_dsp_repeat_state() {
    kernel_global!(DSP_REPEAT_STATE_PTR) = core::ptr::null_mut();
    kernel_global!(DSP_REPEAT_STATE_START) = 0;
    kernel_global!(DSP_REPEAT_STATE_COUNT) = 0;
}

#[inline(always)]
unsafe fn dsp_state_ptr(index: usize) -> *mut f64 {
    #[cfg(feature = "parallel")]
    {
        let context = parallel::active_repeat_context();
        if !context.is_null() {
            let context = &*context;
            if index >= context.state_start
                && index < context.state_start.saturating_add(context.state_count)
            {
                return context.states.add(index - context.state_start);
            }
            return parallel::invalid_state_ptr();
        }
    }
    if !kernel_global!(DSP_REPEAT_STATE_PTR).is_null()
        && index >= kernel_global!(DSP_REPEAT_STATE_START)
        && index
            < kernel_global!(DSP_REPEAT_STATE_START)
                .saturating_add(kernel_global!(DSP_REPEAT_STATE_COUNT))
    {
        kernel_global!(DSP_REPEAT_STATE_PTR).add(index - kernel_global!(DSP_REPEAT_STATE_START))
    } else {
        core::ptr::addr_of_mut!(kernel_global!(DSP_STATE))
            .cast::<f64>()
            .add(index)
    }
}

fn dsp_reg(index: i32) -> f64 {
    unsafe {
        if index < 0 || index as usize >= MAX_DSP_REGS {
            0.0
        } else {
            dsp_reg_unchecked(index)
        }
    }
}

#[inline(always)]
unsafe fn dsp_regs_ptr() -> *mut f64 {
    #[cfg(feature = "parallel")]
    {
        let context = parallel::active_repeat_context();
        if !context.is_null() {
            return (*context).regs;
        }
    }
    core::ptr::addr_of_mut!(kernel_global!(DSP_REGS)).cast::<f64>()
}

#[inline(always)]
unsafe fn dsp_reg_unchecked(index: i32) -> f64 {
    *dsp_regs_ptr().add(index as usize)
}

#[inline(always)]
unsafe fn set_dsp_reg_unchecked(index: i32, value: f64) {
    *dsp_regs_ptr().add(index as usize) = value;
}

#[inline(always)]
fn sanitize_dsp_register(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-12_000.0, 12_000.0)
    } else {
        0.0
    }
}

fn set_dsp_reg(index: i32, value: f64) {
    unsafe {
        if index >= 0 && (index as usize) < MAX_DSP_REGS {
            set_dsp_reg_unchecked(
                index,
                if value.is_finite() {
                    value.clamp(-12_000.0, 12_000.0)
                } else {
                    0.0
                },
            );
        }
    }
}

// The evaluator receives this view once per operation. Repeated instances use
// their own registers and state; ordinary operations keep the existing access
// path, including serial Spread/Spawn state remapping.
#[derive(Clone, Copy)]
struct DspNodeContext {
    regs: *mut f64,
    states: *mut f64,
    state_start: usize,
    state_count: usize,
    invalid_state: *mut f64,
    #[cfg(feature = "parallel")]
    item: usize,
    #[cfg(feature = "parallel")]
    gate: f64,
}

impl DspNodeContext {
    #[inline(always)]
    unsafe fn reg(self, index: i32) -> f64 {
        if index < 0 || index as usize >= MAX_DSP_REGS {
            0.0
        } else {
            *self.regs.add(index as usize)
        }
    }

    #[inline(always)]
    unsafe fn state_ptr(self, index: usize) -> *mut f64 {
        if index >= self.state_start && index < self.state_start.saturating_add(self.state_count) {
            self.states.add(index - self.state_start)
        } else {
            self.invalid_state
        }
    }
}

#[inline(always)]
fn node_reg(context: Option<DspNodeContext>, index: i32) -> f64 {
    match context {
        Some(context) => unsafe { context.reg(index) },
        None => dsp_reg(index),
    }
}

#[inline(always)]
unsafe fn node_state_ptr(context: Option<DspNodeContext>, index: usize) -> *mut f64 {
    match context {
        Some(context) => context.state_ptr(index),
        None => dsp_state_ptr(index),
    }
}

fn dsp_value_target(index: i32) -> f64 {
    unsafe {
        if index < 0 || index as usize >= MAX_DSP_VALUES {
            0.0
        } else {
            kernel_global!(DSP_VALUE_TARGETS)[index as usize]
        }
    }
}

#[inline(always)]
unsafe fn dsp_value_unchecked(index: i32) -> f64 {
    *core::ptr::addr_of!(kernel_global!(DSP_VALUES))
        .cast::<f64>()
        .add(index as usize)
}

#[inline(always)]
unsafe fn dsp_value_target_unchecked(index: i32) -> f64 {
    *core::ptr::addr_of!(kernel_global!(DSP_VALUE_TARGETS))
        .cast::<f64>()
        .add(index as usize)
}

fn dsp_value_smoothing_alpha(sample_rate: f64) -> f64 {
    1.0 - (-1.0 / (sample_rate * DSP_VALUE_SMOOTH_SECONDS.max(0.001))).exp()
}

#[inline(always)]
unsafe fn insert_smoothing_value(index: usize) {
    if kernel_global!(DSP_VALUE_SMOOTHING_POSITIONS)[index] == usize::MAX {
        let position = kernel_global!(DSP_VALUE_SMOOTHING_COUNT);
        kernel_global!(DSP_VALUE_SMOOTHING_INDICES)[position] = index;
        kernel_global!(DSP_VALUE_SMOOTHING_POSITIONS)[index] = position;
        kernel_global!(DSP_VALUE_SMOOTHING_COUNT) += 1;
    }
}

#[inline(always)]
unsafe fn remove_smoothing_value(index: usize) {
    let position = kernel_global!(DSP_VALUE_SMOOTHING_POSITIONS)[index];
    if position == usize::MAX {
        return;
    }
    kernel_global!(DSP_VALUE_SMOOTHING_COUNT) -= 1;
    let last_index =
        kernel_global!(DSP_VALUE_SMOOTHING_INDICES)[kernel_global!(DSP_VALUE_SMOOTHING_COUNT)];
    kernel_global!(DSP_VALUE_SMOOTHING_INDICES)[position] = last_index;
    kernel_global!(DSP_VALUE_SMOOTHING_POSITIONS)[last_index] = position;
    kernel_global!(DSP_VALUE_SMOOTHING_POSITIONS)[index] = usize::MAX;
}

fn advance_dsp_values(alpha: f64) {
    unsafe {
        let mut position = 0;
        while position < kernel_global!(DSP_VALUE_SMOOTHING_COUNT) {
            let index = kernel_global!(DSP_VALUE_SMOOTHING_INDICES)[position];
            let current = kernel_global!(DSP_VALUES)[index];
            let target = kernel_global!(DSP_VALUE_TARGETS)[index];
            let delta = target - current;
            if delta == 0.0 {
                remove_smoothing_value(index);
                continue;
            }
            let next = current + delta * alpha;
            if (target - next).abs() <= DSP_VALUE_SETTLE_EPSILON {
                kernel_global!(DSP_VALUES)[index] = target;
                remove_smoothing_value(index);
            } else {
                kernel_global!(DSP_VALUES)[index] = next;
                position += 1;
            }
        }
    }
}

fn dsp_oscillator(wave: i32, phase: f64, pulse_width: f64) -> f64 {
    let p = normalize_phase(phase);
    match wave {
        1 => 1.0 - 4.0 * ((p - 0.25).round() - (p - 0.25)).abs(),
        2 => p * 2.0 - 1.0,
        3 => 1.0 - p * 2.0,
        4 => {
            if p < pulse_width.clamp(0.0, 1.0) {
                1.0
            } else {
                -1.0
            }
        }
        _ => (TWO_PI * p).sin(),
    }
}

fn dsp_kink_oscillator(phase: f64, shape: f64, squareness: f64) -> f64 {
    let p = normalize_phase(phase);
    let amount = squareness.clamp(-1.0, 1.0);
    let magnitude = amount.abs();
    let q = 0.5 * (1.0 - shape.clamp(-1.0, 1.0));
    if magnitude >= 1.0 {
        let high = p >= q;
        return if high == (amount > 0.0) { 1.0 } else { -1.0 };
    }
    let (ascending, u) = if q <= 0.0 {
        (false, p)
    } else if q >= 1.0 {
        (true, p)
    } else if p <= q {
        (true, p / q)
    } else {
        (false, (p - q) / (1.0 - q))
    };
    let straight = if ascending {
        -1.0 + 2.0 * u
    } else {
        1.0 - 2.0 * u
    };
    let exponent = 1.0 + 11.0 * magnitude / (1.0 - magnitude);
    let curved_position = if amount >= 0.0 {
        u.powf(exponent)
    } else {
        1.0 - (1.0 - u).powf(exponent)
    };
    let curved = if ascending {
        -1.0 + 2.0 * curved_position
    } else {
        1.0 - 2.0 * curved_position
    };
    straight + (curved - straight) * magnitude
}

fn dsp_sample_hold_value(input_register: i32, local_state: Option<&mut u32>) -> f64 {
    if input_register >= 0 {
        unsafe { sanitize_control_value(dsp_reg_unchecked(input_register)) }
    } else {
        dsp_random_unit(local_state)
    }
}

fn cached_biquad_coefficients(
    state_index: usize,
    kind: i32,
    parameter_a: f64,
    parameter_b: f64,
    sample_rate: f64,
    calculate: impl FnOnce() -> (BiquadCoefficients, f64),
) -> (BiquadCoefficients, f64) {
    #[cfg(feature = "parallel")]
    if !parallel::active_repeat_context().is_null() {
        return calculate();
    }
    if state_index >= MAX_DSP_STATE {
        return calculate();
    }

    unsafe {
        let cache = kernel_global!(DSP_BIQUAD_COEFFICIENT_CACHES)[state_index];
        if cache.initialized
            && cache.kind == kind
            && cache.parameter_a == parameter_a
            && cache.parameter_b == parameter_b
            && cache.sample_rate == sample_rate
        {
            return (cache.coefficients, cache.gain);
        }
    }

    let (coefficients, gain) = calculate();
    unsafe {
        kernel_global!(DSP_BIQUAD_COEFFICIENT_CACHES)[state_index] = DspBiquadCoefficientCache {
            initialized: true,
            kind,
            parameter_a,
            parameter_b,
            sample_rate,
            coefficients,
            gain,
        };
    }
    (coefficients, gain)
}

fn cached_derived_value(
    state_index: usize,
    slot: usize,
    parameter_a: f64,
    parameter_b: f64,
    calculate: impl FnOnce() -> f64,
) -> f64 {
    #[cfg(feature = "parallel")]
    if !parallel::active_repeat_context().is_null() {
        return calculate();
    }
    if state_index >= MAX_DSP_STATE || slot >= DSP_DERIVED_CACHE_VALUES_PER_STATE {
        return calculate();
    }
    let cache_index = state_index * DSP_DERIVED_CACHE_VALUES_PER_STATE + slot;

    unsafe {
        let cache = kernel_global!(DSP_DERIVED_VALUE_CACHES)[cache_index];
        if cache.initialized && cache.parameter_a == parameter_a && cache.parameter_b == parameter_b
        {
            return cache.value;
        }
    }

    let value = calculate();
    unsafe {
        kernel_global!(DSP_DERIVED_VALUE_CACHES)[cache_index] = DspDerivedValueCache {
            initialized: true,
            parameter_a,
            parameter_b,
            value,
        };
    }
    value
}

fn cached_envelope_coefficient(
    state_index: usize,
    slot: usize,
    seconds: f64,
    sample_rate: f64,
) -> f64 {
    cached_derived_value(state_index, slot, seconds, sample_rate, || {
        envelope_coefficient(seconds, sample_rate)
    })
}

fn render_dsp_biquad_state(
    state_index: usize,
    sample: f64,
    coefficients: (f64, f64, f64, f64, f64),
) -> f64 {
    unsafe {
        if state_index + 3 >= MAX_DSP_STATE {
            return sanitize_sample(sample, 4.0);
        }

        let (b0, b1, b2, a1, a2) = coefficients;
        let x1 = *dsp_state_ptr(state_index);
        let x2 = *dsp_state_ptr(state_index + 1);
        let y1 = *dsp_state_ptr(state_index + 2);
        let y2 = *dsp_state_ptr(state_index + 3);
        let output = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;

        *dsp_state_ptr(state_index + 1) = sanitize_sample(x1, 4.0);
        *dsp_state_ptr(state_index) = sanitize_sample(sample, 4.0);
        *dsp_state_ptr(state_index + 3) = sanitize_sample(y1, 4.0);
        *dsp_state_ptr(state_index + 2) = sanitize_sample(output, 4.0);
        sanitize_sample(output, 4.0)
    }
}

fn render_dsp_formant_filter(op: DspOp, sample_rate: f64) -> f64 {
    let sample = sanitize_sample(dsp_reg(op.b), 4.0);
    if op.state < 0 || (op.state as usize + MAX_FORMANT_BANDS * 4 - 1) >= MAX_DSP_STATE {
        return sample;
    }

    let state_index = op.state as usize;
    let morph = dsp_reg(op.c);
    let intensity = dsp_reg(op.d).clamp(0.1, FORMANT_INTENSITY_MAX);
    let strength = ((intensity - 0.1) / 11.9).clamp(0.0, 1.0);
    let overdrive = ((intensity - 12.0) / (FORMANT_INTENSITY_MAX - 12.0)).clamp(0.0, 1.0);
    let mut wet = 0.0;

    for band_index in 0..MAX_FORMANT_BANDS {
        let (coefficients, gain) = cached_biquad_coefficients(
            state_index + band_index * 4,
            DSP_BIQUAD_CACHE_KIND_FORMANT_BASE + band_index as i32,
            morph,
            intensity,
            sample_rate,
            || {
                let (frequency, q, gain) = formant_band(morph, intensity, band_index, sample_rate);
                (filter_coefficients(3, frequency, q, sample_rate), gain)
            },
        );
        wet += render_dsp_biquad_state(state_index + band_index * 4, sample, coefficients) * gain;
    }

    let dry_mix = 0.42 - strength * 0.18 - overdrive * 0.16;
    let wet_mix = 0.46 + strength * 0.38 + overdrive * 0.95;
    sanitize_sample(sample * dry_mix + wet * wet_mix, 4.0)
}

fn render_dsp_equalizer(op: DspOp, sample_rate: f64) -> f64 {
    let sample = sanitize_sample(dsp_reg(op.b), 4.0);
    if op.state < 0 || (op.state as usize + 11) >= MAX_DSP_STATE {
        return sample;
    }

    let state_index = op.state as usize;
    let gains = [dsp_reg(op.c), dsp_reg(op.d), dsp_reg(op.e)];
    let mut output = sample;
    for (band, gain) in gains.into_iter().enumerate() {
        let (coefficients, _) = cached_biquad_coefficients(
            state_index + band * 4,
            DSP_BIQUAD_CACHE_KIND_EQUALIZER_BASE + band as i32,
            gain,
            0.0,
            sample_rate,
            || (equalizer_coefficients(band as i32, gain, sample_rate), 1.0),
        );
        output = render_dsp_biquad_state(state_index + band * 4, output, coefficients);
    }
    sanitize_sample(output, 4.0)
}

fn render_dsp_comb_filter(op: DspOp, sample_rate: f64) -> f64 {
    let Some(slot) = dsp_effect_slot(op.state) else {
        return sanitize_sample(dsp_reg(op.b), 4.0);
    };
    {
        let sample = sanitize_sample(dsp_reg(op.b), 4.0);
        let frequency = dsp_reg(op.c)
            .clamp(20.0, sample_rate.max(1.0) * 0.45)
            .min(5_000.0);
        let delay_samples =
            (sample_rate.max(1.0) / frequency).clamp(1.0, (MAX_DSP_DELAY_SAMPLES - 1) as f64);
        let feedback = dsp_reg(op.d).clamp(-0.98, 0.98);
        let index = dsp_effect_index(slot);
        let delayed = sanitize_sample(read_dsp_effect_delay(slot, index, delay_samples), 4.0);

        write_dsp_effect_buffer(
            slot,
            index,
            sanitize_sample(sample + delayed * feedback, 4.0),
        );
        set_dsp_effect_index(slot, (index + 1) % MAX_DSP_DELAY_SAMPLES);

        if op.a == 6 {
            sanitize_sample(sample - delayed * feedback.abs().max(0.45), 4.0)
        } else {
            sanitize_sample(delayed, 4.0)
        }
    }
}

fn render_dsp_filter(op: DspOp, sample_rate: f64) -> f64 {
    if op.a == 4 {
        return render_dsp_formant_filter(op, sample_rate);
    }
    if op.a == 5 || op.a == 6 {
        return render_dsp_comb_filter(op, sample_rate);
    }
    if op.a == 7 {
        return render_dsp_equalizer(op, sample_rate);
    }

    if op.state < 0 {
        return dsp_reg(op.b);
    }
    let cutoff = dsp_reg(op.c);
    let resonance = dsp_reg(op.d);
    let (coefficients, _) = cached_biquad_coefficients(
        op.state as usize,
        op.a,
        cutoff,
        resonance,
        sample_rate,
        || {
            (
                filter_coefficients(op.a, cutoff, resonance, sample_rate),
                1.0,
            )
        },
    );
    render_dsp_biquad_state(op.state as usize, dsp_reg(op.b), coefficients)
}

fn render_dsp_selector(op: DspOp, sample_rate: f64) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 3) >= MAX_DSP_STATE {
            return dsp_reg(op.c);
        }

        let state_index = op.state as usize;
        let input = dsp_reg(op.c);
        let max_index = op.e.max(1) as f64;
        let selected_index = dsp_reg(op.a).floor() as i32;

        // Selector inputs are 1-based. A zero (or out-of-range) selection keeps
        // the previous selection active, allowing sparse trigger signals to
        // switch a selector without resetting it between pulses. The active
        // selection must still be rendered while the input is zero so its slide
        // can finish instead of advancing for a single sample only.
        let previous_index = (*dsp_state_ptr(state_index + 1)).round() as i32;
        let has_new_selection =
            selected_index >= 1 && (selected_index as f64) <= max_index && selected_index == op.d;
        let continues_previous_selection =
            (selected_index < 1 || (selected_index as f64) > max_index) && previous_index == op.d;
        if has_new_selection || continues_previous_selection {
            let uninitialized = *dsp_state_ptr(state_index) == 0.0
                && *dsp_state_ptr(state_index + 1) == 0.0
                && *dsp_state_ptr(state_index + 2) == 0.0
                && *dsp_state_ptr(state_index + 3) == 0.0;
            let slide = dsp_reg(op.b).max(0.0);
            let sample_rate = sample_rate.max(1.0);

            if uninitialized {
                *dsp_state_ptr(state_index) = sanitize_control_value(input);
                *dsp_state_ptr(state_index + 1) = selected_index as f64;
                *dsp_state_ptr(state_index + 2) = sanitize_control_value(input);
                *dsp_state_ptr(state_index + 3) = slide;
            } else if has_new_selection && previous_index != selected_index {
                *dsp_state_ptr(state_index + 2) = *dsp_state_ptr(state_index);
                *dsp_state_ptr(state_index + 3) = 0.0;
                *dsp_state_ptr(state_index + 1) = selected_index as f64;
            }

            if slide <= 0.0 {
                *dsp_state_ptr(state_index) = sanitize_control_value(input);
                *dsp_state_ptr(state_index + 3) = slide;
            } else {
                let elapsed = (*dsp_state_ptr(state_index + 3) + (1.0 / sample_rate)).min(slide);
                let mix = (elapsed / slide).clamp(0.0, 1.0);
                let start = *dsp_state_ptr(state_index + 2);
                let output = if mix >= 1.0 {
                    input
                } else {
                    start + (input - start) * mix
                };
                *dsp_state_ptr(state_index) = sanitize_control_value(output);
                *dsp_state_ptr(state_index + 3) = elapsed;
            }
        }

        sanitize_control_value(*dsp_state_ptr(state_index))
    }
}

fn dsp_effect_slot(state: i32) -> Option<usize> {
    unsafe {
        if state < 0 || state as usize >= MAX_DSP_STATE {
            return None;
        }
        let slot = kernel_global!(DSP_EFFECT_STATE_SLOTS)[state as usize];
        if slot < 0 || slot as usize >= MAX_DSP_EFFECT_SLOTS {
            return None;
        }
        Some(slot as usize)
    }
}

fn dsp_op_uses_effect_buffer(opcode: i32, kind: i32) -> bool {
    opcode == DSP_OP_DELAY
        || opcode == DSP_OP_CHORUS
        || opcode == DSP_OP_REVERB
        || opcode == DSP_OP_LIMITER
        || (opcode == DSP_OP_FILTER && (kind == 5 || kind == 6))
}

fn dsp_buffer_slot(state: i32) -> Option<usize> {
    unsafe {
        if state < 0 || state as usize >= MAX_DSP_STATE {
            return None;
        }

        let state_index = state as usize;
        let existing = kernel_global!(DSP_BUFFER_STATE_SLOTS)[state_index];
        if existing >= 0 && (existing as usize) < MAX_DSP_BUFFER_SLOTS {
            return Some(existing as usize);
        }
        None
    }
}

#[cfg(feature = "parallel")]
unsafe fn active_repeat_effect(slot: usize) -> *mut DspRepeatEffectBufferState {
    let context = parallel::active_repeat_context();
    if context.is_null() || (*context).resources.is_null() {
        return core::ptr::null_mut();
    }
    (*(*context).resources)
        .effect_buffers
        .iter_mut()
        .find(|effect| effect.slot == slot)
        .map_or(core::ptr::null_mut(), |effect| effect as *mut _)
}

fn dsp_effect_index(slot: usize) -> usize {
    unsafe {
        #[cfg(feature = "parallel")]
        {
            if !parallel::active_repeat_context().is_null() {
                let effect = active_repeat_effect(slot);
                return if effect.is_null() { 0 } else { (*effect).index };
            }
        }
        kernel_global!(DSP_EFFECT_INDICES)[slot]
    }
}

fn set_dsp_effect_index(slot: usize, index: usize) {
    unsafe {
        #[cfg(feature = "parallel")]
        {
            if !parallel::active_repeat_context().is_null() {
                let effect = active_repeat_effect(slot);
                if !effect.is_null() {
                    (*effect).index = index;
                }
                return;
            }
        }
        kernel_global!(DSP_EFFECT_INDICES)[slot] = index;
    }
}

fn read_dsp_effect_delay(slot: usize, write_index: usize, delay_samples: f64) -> f64 {
    unsafe {
        #[cfg(feature = "parallel")]
        let effect = active_repeat_effect(slot);
        #[cfg(feature = "parallel")]
        let buffer = if parallel::active_repeat_context().is_null() {
            kernel_global!(DSP_EFFECT_BUFFERS)[slot].as_ref()
        } else if effect.is_null() {
            None
        } else {
            (*effect).buffer.as_ref()
        };
        #[cfg(not(feature = "parallel"))]
        let buffer = kernel_global!(DSP_EFFECT_BUFFERS)[slot].as_ref();
        let Some(buffer) = buffer else {
            return 0.0;
        };
        let length = buffer.len();
        let delay_samples = delay_samples.clamp(1.0, (length - 1) as f64);
        let mut index = write_index as f64 - delay_samples;
        while index < 0.0 {
            index += length as f64;
        }
        let index_a = index.floor() as usize % length;
        let index_b = (index_a + 1) % length;
        let fraction = index - index.floor();
        buffer[index_a] as f64 * (1.0 - fraction) + buffer[index_b] as f64 * fraction
    }
}

fn write_dsp_effect_buffer(slot: usize, index: usize, sample: f64) {
    unsafe {
        #[cfg(feature = "parallel")]
        let effect = active_repeat_effect(slot);
        #[cfg(feature = "parallel")]
        let buffer = if parallel::active_repeat_context().is_null() {
            kernel_global!(DSP_EFFECT_BUFFERS)[slot].as_mut()
        } else if effect.is_null() {
            None
        } else {
            (*effect).buffer.as_mut()
        };
        #[cfg(not(feature = "parallel"))]
        let buffer = kernel_global!(DSP_EFFECT_BUFFERS)[slot].as_mut();
        if let Some(buffer) = buffer {
            buffer[index] = sample as f32;
        }
    }
}

fn read_dsp_buffer(slot: usize, length: usize, head: f64) -> f64 {
    unsafe {
        #[cfg(feature = "parallel")]
        let buffer = {
            let context = parallel::active_repeat_context();
            if context.is_null() {
                kernel_global!(DSP_BUFFER_BUFFERS)[slot].as_ref()
            } else if (*context).resources.is_null() {
                None
            } else {
                (*(*context).resources)
                    .buffers
                    .iter()
                    .find(|resource| resource.slot == slot)
                    .and_then(|resource| resource.buffer.as_ref())
            }
        };
        #[cfg(not(feature = "parallel"))]
        let buffer = kernel_global!(DSP_BUFFER_BUFFERS)[slot].as_ref();
        let Some(buffer) = buffer else {
            return 0.0;
        };
        let length = length.clamp(2, MAX_DSP_BUFFER_SAMPLES);
        let position = normalize_phase(head) * length as f64;
        let index_a = position.floor() as usize % length;
        let index_b = (index_a + 1) % length;
        let fraction = position - position.floor();
        buffer[index_a] as f64 * (1.0 - fraction) + buffer[index_b] as f64 * fraction
    }
}

fn write_dsp_buffer(slot: usize, length: usize, head: f64, sample: f64) {
    unsafe {
        #[cfg(feature = "parallel")]
        let buffer = {
            let context = parallel::active_repeat_context();
            if context.is_null() {
                kernel_global!(DSP_BUFFER_BUFFERS)[slot].as_mut()
            } else if (*context).resources.is_null() {
                None
            } else {
                (*(*context).resources)
                    .buffers
                    .iter_mut()
                    .find(|resource| resource.slot == slot)
                    .and_then(|resource| resource.buffer.as_mut())
            }
        };
        #[cfg(not(feature = "parallel"))]
        let buffer = kernel_global!(DSP_BUFFER_BUFFERS)[slot].as_mut();
        let Some(buffer) = buffer else {
            return;
        };
        let length = length.clamp(2, MAX_DSP_BUFFER_SAMPLES);
        let position = normalize_phase(head) * length as f64;
        let index = position.floor() as usize % length;
        buffer[index] = sanitize_sample(sample, 8.0) as f32;
    }
}

fn render_dsp_playhead(op: DspOp, sample_rate: f64) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 1) >= MAX_DSP_STATE {
            return normalize_phase(dsp_reg(op.a));
        }

        let state_index = op.state as usize;
        let reset_trigger = dsp_reg(op.e) >= ENVELOPE_TRIGGER_THRESHOLD;
        let previous_reset_trigger = *dsp_state_ptr(state_index + 1) >= ENVELOPE_TRIGGER_THRESHOLD;
        let relative_position = if reset_trigger && !previous_reset_trigger {
            0.0
        } else {
            normalize_phase(*dsp_state_ptr(state_index))
        };
        let output = normalize_phase(dsp_reg(op.a) + relative_position);
        let length_seconds = dsp_reg(op.c).max(0.001);
        let step = dsp_reg(op.b) / (length_seconds * sample_rate.max(1.0));
        *dsp_state_ptr(state_index) = normalize_phase(relative_position + step);
        *dsp_state_ptr(state_index + 1) = if reset_trigger { 1.0 } else { 0.0 };
        output
    }
}

#[cfg(test)]
mod playhead_tests {
    use super::*;

    #[test]
    fn reset_trigger_restarts_on_rising_edges_only() {
        let state = 3000;
        let op = DspOp {
            opcode: DSP_OP_PLAYHEAD,
            out: -1,
            a: 20,
            b: 21,
            c: 22,
            d: -1,
            e: 23,
            state,
            value: 0.0,
            value2: 0.0,
            value3: 0.0,
            value4: 0.0,
        };

        unsafe {
            kernel_global!(DSP_REGS)[20] = 0.2;
            kernel_global!(DSP_REGS)[21] = 1.0;
            kernel_global!(DSP_REGS)[22] = 1.0;
            kernel_global!(DSP_REGS)[23] = 0.0;
            *dsp_state_ptr(state as usize) = 0.5;
            *dsp_state_ptr(state as usize + 1) = 0.0;
        }
        assert!((render_dsp_playhead(op, 4.0) - 0.7).abs() < 0.000001);

        unsafe { kernel_global!(DSP_REGS)[23] = 1.0 };
        assert!((render_dsp_playhead(op, 4.0) - 0.2).abs() < 0.000001);
        assert!((render_dsp_playhead(op, 4.0) - 0.45).abs() < 0.000001);

        unsafe { kernel_global!(DSP_REGS)[23] = 0.0 };
        assert!((render_dsp_playhead(op, 4.0) - 0.7).abs() < 0.000001);
        unsafe { kernel_global!(DSP_REGS)[23] = 1.0 };
        assert!((render_dsp_playhead(op, 4.0) - 0.2).abs() < 0.000001);
    }
}

fn render_dsp_time(op: DspOp, sample_rate: f64) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize) >= MAX_DSP_STATE {
            return 0.0;
        }

        let state_index = op.state as usize;
        let output = (*dsp_state_ptr(state_index)).max(0.0);
        *dsp_state_ptr(state_index) = output + 1.0 / sample_rate.max(1.0);
        output
    }
}

fn render_dsp_buffer(op: DspOp, sample_rate: f64) -> f64 {
    let Some(slot) = dsp_buffer_slot(op.state) else {
        set_dsp_reg(op.e, 0.0);
        return 0.0;
    };

    let length_samples = (dsp_reg(op.d).max(0.001) * sample_rate.max(1.0))
        .round()
        .clamp(2.0, MAX_DSP_BUFFER_SAMPLES as f64) as usize;
    let externally_driven_heads = op.value4.round().max(0.0) as i32;
    let playhead_is_external = externally_driven_heads & 1 != 0;
    let record_head_is_external = externally_driven_heads & 2 != 0;
    let (playhead, record_head) = unsafe {
        if op.state < 0 || (op.state as usize + 6) >= MAX_DSP_STATE {
            (
                normalize_phase(dsp_reg(op.b)),
                normalize_phase(dsp_reg(op.c)),
            )
        } else {
            let state = op.state as usize;
            if *dsp_state_ptr(state + 6) < 0.5 {
                *dsp_state_ptr(state + 4) = normalize_phase(dsp_reg(op.b));
                *dsp_state_ptr(state + 5) = normalize_phase(dsp_reg(op.c));
                *dsp_state_ptr(state + 6) = 1.0;
            }

            let playhead = if playhead_is_external {
                normalize_phase(dsp_reg(op.b))
            } else {
                normalize_phase(*dsp_state_ptr(state + 4))
            };
            let record_head = if record_head_is_external {
                normalize_phase(dsp_reg(op.c))
            } else {
                normalize_phase(*dsp_state_ptr(state + 5))
            };
            let normalized_step = 1.0 / length_samples as f64;
            if playhead_is_external {
                *dsp_state_ptr(state + 4) = playhead;
            } else {
                *dsp_state_ptr(state + 4) =
                    normalize_phase(playhead + dsp_reg(op.value2.round() as i32) * normalized_step);
            }
            if record_head_is_external {
                *dsp_state_ptr(state + 5) = record_head;
            } else {
                *dsp_state_ptr(state + 5) = normalize_phase(
                    record_head + dsp_reg(op.value3.round() as i32) * normalized_step,
                );
            }
            (playhead, record_head)
        }
    };
    let record_head_output = read_dsp_buffer(slot, length_samples, record_head);
    set_dsp_reg(op.e, sanitize_sample(record_head_output, 8.0));
    if !unsafe { kernel_global!(DSP_BUFFER_FROZEN)[slot] } {
        write_dsp_buffer(slot, length_samples, record_head, dsp_reg(op.a));
    }
    let output = read_dsp_buffer(slot, length_samples, playhead);
    unsafe {
        if op.state >= 0 && (op.state as usize + 3) < MAX_DSP_STATE {
            let state = op.state as usize;
            *dsp_state_ptr(state + 1) = playhead;
            *dsp_state_ptr(state + 2) = record_head;
            *dsp_state_ptr(state + 3) = length_samples as f64 / sample_rate.max(1.0);
        }
    }
    sanitize_sample(output, 8.0)
}

#[cfg(test)]
mod buffer_tests {
    use super::*;

    #[test]
    fn coincident_playhead_reads_the_new_sample_while_record_head_output_reads_the_old_sample() {
        clear_dsp_resource_slots();
        let state = 200;
        prepare_dsp_buffer_slot(state).unwrap();
        let op = DspOp {
            opcode: DSP_OP_BUFFER,
            out: -1,
            a: 0,
            b: 1,
            c: 2,
            d: 3,
            e: 4,
            state,
            value: 0.0,
            value2: 5.0,
            value3: 6.0,
            value4: 3.0,
        };

        unsafe {
            kernel_global!(DSP_REGS)[0] = 0.25;
            kernel_global!(DSP_REGS)[1] = 0.0;
            kernel_global!(DSP_REGS)[2] = 0.0;
            kernel_global!(DSP_REGS)[3] = 1.0;
            kernel_global!(DSP_REGS)[5] = 100.0;
            kernel_global!(DSP_REGS)[6] = 100.0;
        }
        assert_eq!(render_dsp_buffer(op, 2.0), 0.25);
        unsafe {
            assert_eq!(kernel_global!(DSP_REGS)[4], 0.0);
            kernel_global!(DSP_REGS)[0] = 0.75;
        }

        assert_eq!(render_dsp_buffer(op, 2.0), 0.75);
        unsafe {
            assert_eq!(kernel_global!(DSP_REGS)[4], 0.25);
        }
        clear_dsp_resource_slots();
    }

    #[test]
    fn unconnected_heads_advance_at_independent_real_time_speeds() {
        clear_dsp_resource_slots();
        let state = 200;
        prepare_dsp_buffer_slot(state).unwrap();
        let op = DspOp {
            opcode: DSP_OP_BUFFER,
            out: -1,
            a: 0,
            b: 1,
            c: 2,
            d: 3,
            e: 4,
            state,
            value: 0.0,
            value2: 5.0,
            value3: 6.0,
            value4: 0.0,
        };

        unsafe {
            kernel_global!(DSP_REGS)[0] = 0.0;
            kernel_global!(DSP_REGS)[1] = 0.0;
            kernel_global!(DSP_REGS)[2] = 0.5;
            kernel_global!(DSP_REGS)[3] = 1.0;
            kernel_global!(DSP_REGS)[5] = 1.0;
            kernel_global!(DSP_REGS)[6] = -1.0;
            *dsp_state_ptr(state as usize + 4) = 0.0;
            *dsp_state_ptr(state as usize + 5) = 0.0;
            *dsp_state_ptr(state as usize + 6) = 0.0;
        }
        render_dsp_buffer(op, 4.0);
        unsafe {
            assert_eq!(*dsp_state_ptr(state as usize + 1), 0.0);
            assert_eq!(*dsp_state_ptr(state as usize + 2), 0.5);
            assert_eq!(*dsp_state_ptr(state as usize + 4), 0.25);
            assert_eq!(*dsp_state_ptr(state as usize + 5), 0.25);
        }

        render_dsp_buffer(op, 4.0);
        unsafe {
            assert_eq!(*dsp_state_ptr(state as usize + 1), 0.25);
            assert_eq!(*dsp_state_ptr(state as usize + 2), 0.25);
        }
        clear_dsp_resource_slots();
    }
}

fn render_dsp_delay(op: DspOp, sample_rate: f64) -> f64 {
    let Some(slot) = dsp_effect_slot(op.state) else {
        return dsp_reg(op.a);
    };
    {
        let sample = sanitize_sample(dsp_reg(op.a), 8.0);
        let time = dsp_reg(op.b).clamp(0.0, 1.5);
        let feedback = dsp_reg(op.c).clamp(0.0, 2.0);
        let mix = dsp_reg(op.d).clamp(0.0, 1.0);
        let index = dsp_effect_index(slot);
        if time == 0.0 {
            write_dsp_effect_buffer(slot, index, sample);
            set_dsp_effect_index(slot, (index + 1) % MAX_DSP_DELAY_SAMPLES);
            return sample;
        }
        let delayed = sanitize_sample(
            read_dsp_effect_delay(slot, index, time * sample_rate.max(1.0)),
            8.0,
        );
        write_dsp_effect_buffer(
            slot,
            index,
            sanitize_sample(sample + delayed * feedback, 8.0),
        );
        set_dsp_effect_index(slot, (index + 1) % MAX_DSP_DELAY_SAMPLES);
        sanitize_sample(sample * (1.0 - mix) + delayed * mix, 8.0)
    }
}

fn render_dsp_chorus(op: DspOp, sample_rate: f64) -> f64 {
    let Some(slot) = dsp_effect_slot(op.state) else {
        return dsp_reg(op.a);
    };
    unsafe {
        let sample = sanitize_sample(dsp_reg(op.a), 8.0);
        let rate = dsp_reg(op.b).clamp(0.05, 12.0);
        let depth = dsp_reg(op.c).clamp(0.001, 0.08);
        let mix = dsp_reg(op.d).clamp(0.0, 1.0);
        let index = dsp_effect_index(slot);
        let phase_index = op.state as usize;
        let phase = if phase_index < MAX_DSP_STATE {
            *dsp_state_ptr(phase_index)
        } else {
            0.0
        };
        let lfo = 0.5 + 0.5 * phase.sin();
        let delay_samples = (0.012 + depth * lfo) * sample_rate.max(1.0);
        let delayed = sanitize_sample(read_dsp_effect_delay(slot, index, delay_samples), 8.0);
        write_dsp_effect_buffer(slot, index, sample);
        set_dsp_effect_index(slot, (index + 1) % MAX_DSP_DELAY_SAMPLES);
        if phase_index < MAX_DSP_STATE {
            *dsp_state_ptr(phase_index) = (phase + (TWO_PI * rate) / sample_rate.max(1.0)) % TWO_PI;
        }
        sanitize_sample(sample * (1.0 - mix) + delayed * mix, 8.0)
    }
}

fn render_dsp_reverb(op: DspOp, sample_rate: f64) -> f64 {
    let Some(slot) = dsp_effect_slot(op.state) else {
        return dsp_reg(op.a);
    };
    {
        let sample = sanitize_sample(dsp_reg(op.a), 8.0);
        let size = dsp_reg(op.b).clamp(0.1, 1.0);
        let decay = dsp_reg(op.c).clamp(0.0, 0.96);
        let mix = dsp_reg(op.d).clamp(0.0, 1.0);
        if op.value2 >= 1.0 {
            let mode = dsp_reg(op.value2.round() as i32 - 1)
                .round()
                .clamp(0.0, 2.0) as usize;
            unsafe {
                let state = core::slice::from_raw_parts_mut(
                    dsp_state_ptr(op.state as usize), reverb::STATE_COUNT,
                );
                #[cfg(feature = "parallel")]
                let effect = active_repeat_effect(slot);
                #[cfg(feature = "parallel")]
                let buffer = if parallel::active_repeat_context().is_null() {
                    kernel_global!(DSP_EFFECT_BUFFERS)[slot].as_mut()
                } else if effect.is_null() {
                    None
                } else {
                    (*effect).buffer.as_mut()
                };
                #[cfg(not(feature = "parallel"))]
                let buffer = kernel_global!(DSP_EFFECT_BUFFERS)[slot].as_mut();
                if let Some(buffer) = buffer {
                    if mode != 0 {
                        let (left, right) = reverb::process(
                            buffer, state, mode, sample, size, decay, sample_rate,
                        );
                        set_dsp_reg(op.e, sanitize_sample(sample * (1.0 - mix) + right * mix, 8.0));
                        return sanitize_sample(sample * (1.0 - mix) + left * mix, 8.0);
                    }
                    if state[31] != 1.0 {
                        buffer.fill(0.0);
                        state.fill(0.0);
                        state[31] = 1.0;
                        set_dsp_effect_index(slot, 0);
                    }
                }
            }
        }
        let index = dsp_effect_index(slot);
        let scale = 0.45 + size * 0.9;
        let wet = (read_dsp_effect_delay(slot, index, 0.029 * scale * sample_rate.max(1.0))
            + read_dsp_effect_delay(slot, index, 0.037 * scale * sample_rate.max(1.0))
            + read_dsp_effect_delay(slot, index, 0.041 * scale * sample_rate.max(1.0))
            + read_dsp_effect_delay(slot, index, 0.053 * scale * sample_rate.max(1.0)))
            * 0.25;
        write_dsp_effect_buffer(slot, index, sanitize_sample(sample + wet * decay, 8.0));
        set_dsp_effect_index(slot, (index + 1) % MAX_DSP_DELAY_SAMPLES);
        let output = sanitize_sample(sample * (1.0 - mix) + wet * mix, 8.0);
        if op.value2 >= 1.0 {
            set_dsp_reg(op.e, output);
        }
        output
    }
}

fn envelope_coefficient(seconds: f64, sample_rate: f64) -> f64 {
    if seconds <= 0.0 {
        1.0
    } else {
        1.0 - (-1.0 / (sample_rate.max(1.0) * seconds.max(0.000001))).exp()
    }
}

fn render_dsp_envelope<const REPEAT: bool>(
    op: DspOp,
    sample_rate: f64,
    node_context: Option<DspNodeContext>,
) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 7) >= MAX_DSP_STATE {
            return 0.0;
        }

        let state_index = op.state as usize;
        let state_ptr = if REPEAT {
            node_context.unwrap().state_ptr(state_index)
        } else {
            dsp_state_ptr(state_index)
        };
        let state = core::slice::from_raw_parts_mut(state_ptr, 8);
        let regs = if REPEAT {
            node_context.unwrap().regs
        } else {
            dsp_regs_ptr()
        };
        let reg = |index: i32| {
            if index < 0 || index as usize >= MAX_DSP_REGS {
                0.0
            } else {
                *regs.add(index as usize)
            }
        };
        let trigger = reg(op.a) >= ENVELOPE_TRIGGER_THRESHOLD;
        let gate = reg(op.b) >= ENVELOPE_TRIGGER_THRESHOLD;
        let was_triggered = state[1] > 0.5;
        let was_gated = state[5] > 0.5;
        let delay = reg(op.c).max(0.0);
        let attack = reg(op.d).max(0.0);
        let decay = reg(op.e).max(0.0);
        let packed = op.value.round() as i32;
        let sustain_register = packed.rem_euclid(MAX_DSP_REGS as i32);
        let release_register = packed.div_euclid(MAX_DSP_REGS as i32);
        let sustain = reg(sustain_register).clamp(0.0, 1.0);
        let gate_length_register = (op.value2.round() as i32) - 1;
        let gate_length = if gate_length_register >= 0 {
            reg(gate_length_register).max(0.0)
        } else {
            0.0
        };
        let release = reg(release_register).max(0.0);
        let dt = 1.0 / sample_rate.max(1.0);
        let mut env = (state[0]).clamp(0.0, 1.0);
        let mut stage = (state[2]).round() as i32;
        let mut stage_time = (state[3]).max(0.0);
        let mut release_start = (state[4]).clamp(0.0, 1.0);
        let mut attack_start = (state[6]).clamp(0.0, 1.0);
        let mut timed_gate_elapsed = state[7].max(0.0);
        let trigger_edge = trigger && !was_triggered;
        let gate_opened = gate && !was_gated;
        let gate_closed = !gate && was_gated;

        if trigger_edge || gate_opened {
            // A hard reset to zero makes a discontinuity whenever an envelope
            // is retriggered above zero. Start the next attack at the current
            // level instead, matching the smooth "analog retrigger" response
            // expected from a musical envelope.
            attack_start = env;
            stage = if delay > 0.0 { 5 } else { 1 };
            stage_time = 0.0;
            timed_gate_elapsed = 0.0;
        } else if gate_closed {
            stage = 4;
            stage_time = 0.0;
            release_start = env;
        }

        match stage {
            5 => {
                stage_time += dt;
                // Hold the level during delay so a delayed retrigger cannot
                // introduce a gain step before its new attack begins.
                env = attack_start;
                if stage_time >= delay {
                    stage = 1;
                    stage_time = 0.0;
                }
            }
            1 => {
                stage_time += dt;
                // Even a nominally instantaneous attack gets a one-millisecond
                // ramp, preventing a discontinuity at the audio output.
                let attack_duration = attack.max(MIN_ENVELOPE_ATTACK_SECONDS);
                let progress = (stage_time / attack_duration).clamp(0.0, 1.0);
                env = attack_start + (1.0 - attack_start) * progress;
                if env >= 1.0 {
                    stage = 2;
                    stage_time = 0.0;
                }
            }
            2 => {
                stage_time += dt;
                env = if decay <= 0.0 {
                    sustain
                } else {
                    1.0 + (sustain - 1.0) * (stage_time / decay).clamp(0.0, 1.0)
                };
                if stage_time >= decay {
                    env = sustain;
                    stage_time = 0.0;
                    if gate {
                        stage = 3;
                    } else if gate_length > 0.0 {
                        stage = 6;
                    } else {
                        stage = 4;
                        release_start = env;
                    }
                }
            }
            3 => {
                if gate {
                    env = sustain;
                } else {
                    stage = 4;
                    stage_time = 0.0;
                    release_start = env;
                }
            }
            6 => {
                env = sustain;
            }
            4 => {
                stage_time += dt;
                env = if release <= 0.0 {
                    0.0
                } else {
                    release_start * (1.0 - (stage_time / release).clamp(0.0, 1.0))
                };
                if env <= 0.000001 {
                    env = 0.0;
                    stage = 0;
                    stage_time = 0.0;
                }
            }
            _ => {
                env = if gate { env } else { 0.0 };
            }
        }

        // A trigger has no held gate signal, so gate length defines the full
        // audible duration from that trigger edge. In particular, delay,
        // attack, and decay must consume time from the requested length rather
        // than adding to it before sustain starts. A connected high gate still
        // owns the envelope and holds it open until it falls.
        if gate_length > 0.0 && !gate && stage != 0 && stage != 4 {
            timed_gate_elapsed += dt;
            if timed_gate_elapsed >= gate_length {
                stage = 4;
                stage_time = 0.0;
                release_start = env;
            }
        }

        state[0] = sanitize_control_value(env).clamp(0.0, 1.0);
        state[1] = if trigger { 1.0 } else { 0.0 };
        state[2] = stage as f64;
        state[3] = stage_time;
        state[4] = release_start;
        state[5] = if gate { 1.0 } else { 0.0 };
        state[6] = attack_start;
        state[7] = timed_gate_elapsed;
        state[0]
    }
}

#[cfg(test)]
mod envelope_tests {
    use super::*;

    #[test]
    fn trigger_only_gate_length_runs_from_the_trigger_edge() {
        let state = 3600;
        let op = DspOp {
            opcode: DSP_OP_ENVELOPE,
            out: -1,
            a: 20,
            b: 21,
            c: 22,
            d: 23,
            e: 24,
            state,
            value: 25.0 + 26.0 * MAX_DSP_REGS as f64,
            value2: 28.0,
            value3: 0.0,
            value4: 0.0,
        };

        unsafe {
            for index in state..(state + 8) {
                *dsp_state_ptr(index as usize) = 0.0;
            }
            kernel_global!(DSP_REGS)[20] = 1.0;
            kernel_global!(DSP_REGS)[21] = 0.0;
            kernel_global!(DSP_REGS)[22] = 0.01;
            kernel_global!(DSP_REGS)[23] = 0.01;
            kernel_global!(DSP_REGS)[24] = 0.01;
            kernel_global!(DSP_REGS)[25] = 1.0;
            kernel_global!(DSP_REGS)[26] = 0.0;
            kernel_global!(DSP_REGS)[27] = 0.005;
        }

        render_dsp_envelope::<false>(op, 1_000.0, None);
        unsafe { kernel_global!(DSP_REGS)[20] = 0.0 };
        for _ in 0..4 {
            render_dsp_envelope::<false>(op, 1_000.0, None);
        }

        unsafe {
            assert_eq!(
                (*dsp_state_ptr(state as usize + 2)).round() as i32,
                4,
                "the timed trigger should release before delay, attack, and decay can add to its length",
            );
        }
    }
}

fn render_dsp_follower(op: DspOp, sample_rate: f64) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize) >= MAX_DSP_STATE {
            return dsp_reg(op.a).abs();
        }

        let state_index = op.state as usize;
        let target = dsp_reg(op.a).abs();
        let current = (*dsp_state_ptr(state_index)).max(0.0);
        let attack = dsp_reg(op.b).max(0.0);
        let release = dsp_reg(op.c).max(0.0);
        let coefficient = if target > current {
            cached_envelope_coefficient(state_index, DSP_DERIVED_CACHE_ATTACK, attack, sample_rate)
        } else {
            cached_envelope_coefficient(
                state_index,
                DSP_DERIVED_CACHE_RELEASE,
                release,
                sample_rate,
            )
        };
        let next = current + (target - current) * coefficient;
        *dsp_state_ptr(state_index) = sanitize_control_value(next).max(0.0);
        *dsp_state_ptr(state_index)
    }
}

fn render_dsp_dc_block(op: DspOp, sample_rate: f64) -> f64 {
    let input = sanitize_sample(dsp_reg(op.a), 4.0);
    if op.state < 0 || (op.state as usize + 1) >= MAX_DSP_STATE {
        return input;
    }

    unsafe {
        let state_index = op.state as usize;
        let previous_input = *dsp_state_ptr(state_index);
        let previous_output = *dsp_state_ptr(state_index + 1);
        // A one-pole DC blocker with a 10 Hz corner frequency. It removes
        // steady offsets while leaving the audible spectrum essentially intact.
        let coefficient = (-TWO_PI * 10.0 / sample_rate.max(1.0)).exp();
        let output = sanitize_sample(input - previous_input + coefficient * previous_output, 4.0);
        *dsp_state_ptr(state_index) = input;
        *dsp_state_ptr(state_index + 1) = output;
        output
    }
}

fn render_dsp_compressor(op: DspOp, sample_rate: f64) -> f64 {
    let sample = sanitize_sample(dsp_reg(op.a), 32.0);
    if op.state < 0 || op.state as usize >= MAX_DSP_STATE {
        return sample;
    }

    unsafe {
        let state_index = op.state as usize;
        let sidechain_register = op.value2.round() as i32;
        let detector_sample = if sidechain_register >= 0 && sidechain_register < MAX_DSP_REGS as i32
        {
            sanitize_sample(dsp_reg(sidechain_register), 32.0)
        } else {
            sample
        };
        let detector = detector_sample.abs();
        let current = (*dsp_state_ptr(state_index)).max(0.0);
        let attack = dsp_reg(op.d).clamp(0.0, 1.0);
        let release = dsp_reg(op.e).clamp(0.0, 3.0);
        let coefficient = if detector > current {
            cached_envelope_coefficient(state_index, DSP_DERIVED_CACHE_ATTACK, attack, sample_rate)
        } else {
            cached_envelope_coefficient(
                state_index,
                DSP_DERIVED_CACHE_RELEASE,
                release,
                sample_rate,
            )
        };
        let envelope = current + (detector - current) * coefficient;
        *dsp_state_ptr(state_index) = sanitize_control_value(envelope).max(0.0);

        let threshold = dsp_reg(op.b).clamp(-80.0, 0.0);
        let ratio = dsp_reg(op.c).clamp(1.0, 20.0);
        let packed = op.value.round() as i32;
        let knee_register = packed.rem_euclid(MAX_DSP_REGS as i32);
        let makeup_register = packed.div_euclid(MAX_DSP_REGS as i32);
        let knee = dsp_reg(knee_register).clamp(0.0, 40.0);
        let makeup = dsp_reg(makeup_register).clamp(-24.0, 24.0);
        let level_db = 20.0 * envelope.max(0.0000000001).log10();
        let over = level_db - threshold;
        let slope = 1.0 - 1.0 / ratio;
        let reduction_db = if knee <= 0.0 {
            over.max(0.0) * slope
        } else if over <= -knee * 0.5 {
            0.0
        } else if over >= knee * 0.5 {
            over * slope
        } else {
            let knee_position = over + knee * 0.5;
            slope * knee_position * knee_position / (2.0 * knee)
        };
        let gain = 10.0_f64.powf((makeup - reduction_db) / 20.0);
        sanitize_sample(sample * gain, 32.0)
    }
}

fn render_dsp_limiter(op: DspOp, sample_rate: f64) -> f64 {
    let sample = sanitize_sample(dsp_reg(op.a), 32.0);
    let input_gain_db = dsp_reg(op.b).clamp(-24.0, 24.0);
    let ceiling_db = dsp_reg(op.c).clamp(-24.0, 0.0);
    let release = dsp_reg(op.d).clamp(0.001, 3.0);
    let lookahead = dsp_reg(op.e).clamp(0.0, 0.02);
    let lookahead_samples = (lookahead * sample_rate.max(1.0)).round() as usize;
    let state_index = if op.state >= 0 {
        op.state as usize
    } else {
        MAX_DSP_STATE
    };
    let input_gain = cached_derived_value(
        state_index,
        DSP_DERIVED_CACHE_INPUT_GAIN,
        input_gain_db,
        0.0,
        || 10.0_f64.powf(input_gain_db / 20.0),
    );
    let ceiling = cached_derived_value(
        state_index,
        DSP_DERIVED_CACHE_CEILING,
        ceiling_db,
        0.0,
        || 10.0_f64.powf(ceiling_db / 20.0),
    );
    let driven = sanitize_sample(sample * input_gain, 32.0);
    let required_gain = if driven.abs() > ceiling {
        ceiling / driven.abs()
    } else {
        1.0
    };

    let gain = if op.state < 0 || op.state as usize + 1 >= MAX_DSP_STATE {
        required_gain
    } else {
        unsafe {
            let state_index = op.state as usize;
            let current = if *dsp_state_ptr(state_index) > 0.0 {
                (*dsp_state_ptr(state_index)).clamp(0.0, 1.0)
            } else {
                1.0
            };
            let hold_samples = (*dsp_state_ptr(state_index + 1)).max(0.0);
            let (next, next_hold) = if required_gain < current {
                (required_gain, lookahead_samples as f64)
            } else if hold_samples >= 1.0 {
                (current, hold_samples - 1.0)
            } else {
                let coefficient = cached_envelope_coefficient(
                    state_index,
                    DSP_DERIVED_CACHE_RELEASE,
                    release,
                    sample_rate,
                );
                (current + (required_gain - current) * coefficient, 0.0)
            };
            *dsp_state_ptr(state_index) = sanitize_control_value(next).clamp(0.0, 1.0);
            *dsp_state_ptr(state_index + 1) = next_hold;
            *dsp_state_ptr(state_index)
        }
    };

    let delayed = if let Some(slot) = dsp_effect_slot(op.state) {
        {
            let index = dsp_effect_index(slot);
            let output = if lookahead_samples == 0 {
                driven
            } else {
                read_dsp_effect_delay(slot, index, lookahead_samples as f64)
            };
            write_dsp_effect_buffer(slot, index, driven);
            set_dsp_effect_index(slot, (index + 1) % MAX_DSP_DELAY_SAMPLES);
            output
        }
    } else {
        driven
    };

    sanitize_sample(delayed * gain, 32.0).clamp(-ceiling, ceiling)
}

#[cfg(test)]
mod delay_tests {
    use super::*;

    #[test]
    fn zero_is_passthrough_and_positive_sub_sample_times_use_one_sample() {
        clear_dsp_resource_slots();
        let state = 63;
        let slot = prepare_dsp_effect_slot(state).unwrap();
        let op = DspOp {
            opcode: 12,
            out: -1,
            a: 0,
            b: 1,
            c: 2,
            d: 3,
            e: -1,
            state,
            value: 0.0,
            value2: 0.0,
            value3: 0.0,
            value4: 0.0,
        };
        unsafe {
            kernel_global!(DSP_EFFECT_INDICES)[slot] = 0;
            kernel_global!(DSP_EFFECT_BUFFERS)[slot]
                .as_mut()
                .unwrap()
                .fill(0.0);
            kernel_global!(DSP_REGS)[0] = 0.75;
            kernel_global!(DSP_REGS)[1] = 0.0;
            kernel_global!(DSP_REGS)[2] = 0.9;
            kernel_global!(DSP_REGS)[3] = 1.0;
        }
        assert_eq!(render_dsp_delay(op, 48_000.0), 0.75);

        unsafe {
            kernel_global!(DSP_EFFECT_INDICES)[slot] = 0;
            kernel_global!(DSP_EFFECT_BUFFERS)[slot]
                .as_mut()
                .unwrap()
                .fill(0.0);
            kernel_global!(DSP_REGS)[0] = 1.0;
            kernel_global!(DSP_REGS)[1] = 0.000000001;
            kernel_global!(DSP_REGS)[2] = 0.0;
            kernel_global!(DSP_REGS)[3] = 1.0;
        }
        assert_eq!(render_dsp_delay(op, 48_000.0), 0.0);

        unsafe {
            kernel_global!(DSP_REGS)[0] = 0.25;
        }
        assert_eq!(render_dsp_delay(op, 48_000.0), 1.0);
        clear_dsp_resource_slots();
    }
}

#[cfg(test)]
mod limiter_tests {
    use super::*;

    #[test]
    fn lookahead_is_optional_and_output_respects_the_ceiling() {
        clear_dsp_resource_slots();
        let state = 100;
        let slot = prepare_dsp_effect_slot(state).unwrap();
        let op = DspOp {
            opcode: 39,
            out: -1,
            a: 0,
            b: 1,
            c: 2,
            d: 3,
            e: 4,
            state,
            value: 0.0,
            value2: 0.0,
            value3: 0.0,
            value4: 0.0,
        };

        unsafe {
            kernel_global!(DSP_REGS)[0] = 2.0;
            kernel_global!(DSP_REGS)[1] = 0.0;
            kernel_global!(DSP_REGS)[2] = -6.0;
            kernel_global!(DSP_REGS)[3] = 0.05;
            kernel_global!(DSP_REGS)[4] = 0.0;
            *dsp_state_ptr(state as usize) = 0.0;
            *dsp_state_ptr(state as usize + 1) = 0.0;
        }
        let zero_latency = render_dsp_limiter(op, 48_000.0);
        assert!((zero_latency.abs() - 10.0_f64.powf(-6.0 / 20.0)).abs() < 0.000001);

        unsafe {
            kernel_global!(DSP_REGS)[4] = 0.001;
            *dsp_state_ptr(state as usize) = 0.0;
            *dsp_state_ptr(state as usize + 1) = 0.0;
            kernel_global!(DSP_EFFECT_INDICES)[slot] = 0;
            kernel_global!(DSP_EFFECT_BUFFERS)[slot]
                .as_mut()
                .unwrap()
                .fill(0.0);
        }
        let first = render_dsp_limiter(op, 48_000.0);
        assert_eq!(first, 0.0);
        let mut delayed_peak = 0.0;
        for _ in 0..48 {
            delayed_peak = render_dsp_limiter(op, 48_000.0);
        }
        assert!((delayed_peak.abs() - 10.0_f64.powf(-6.0 / 20.0)).abs() < 0.000001);
        clear_dsp_resource_slots();
    }
}

#[cfg(test)]
mod compressor_tests {
    use super::*;

    #[test]
    fn linked_sidechain_drives_gain_reduction_instead_of_main_signal() {
        let mut op = DspOp {
            opcode: 0,
            out: -1,
            a: 0,
            b: 2,
            c: 3,
            d: 4,
            e: 5,
            state: 0,
            value: (6 + 7 * MAX_DSP_REGS) as f64,
            value2: 1.0,
            value3: 0.0,
            value4: 0.0,
        };

        unsafe {
            kernel_global!(DSP_REGS)[0] = 0.25;
            kernel_global!(DSP_REGS)[1] = 1.0;
            kernel_global!(DSP_REGS)[2] = -24.0;
            kernel_global!(DSP_REGS)[3] = 4.0;
            kernel_global!(DSP_REGS)[4] = 0.0;
            kernel_global!(DSP_REGS)[5] = 0.1;
            kernel_global!(DSP_REGS)[6] = 0.0;
            kernel_global!(DSP_REGS)[7] = 0.0;
            *dsp_state_ptr(0) = 0.0;
        }
        let sidechained = render_dsp_compressor(op, 48_000.0);

        op.value2 = -1.0;
        unsafe {
            *dsp_state_ptr(0) = 0.0;
        }
        let self_detected = render_dsp_compressor(op, 48_000.0);

        assert!(sidechained < self_detected * 0.5);
    }
}

fn render_dsp_distortion(op: DspOp, local_state: Option<&mut u32>) -> f64 {
    let distortion_type = if op.c >= 0 { dsp_reg(op.c) } else { op.value }.round() as i32;
    if distortion_type <= 0 {
        return dsp_reg(op.a);
    }

    let gain = dsp_reg(op.b).clamp(0.1, 40.0);
    let sample = dsp_reg(op.a);
    let driven = sanitize_sample(sample * gain, 32.0);
    let output = match distortion_type {
        1 => driven.clamp(-1.0, 1.0),
        3 => {
            let fuzz = driven.signum() * (1.0 - (-driven.abs() * 2.6).exp());
            fuzz + dsp_random_bipolar(local_state) * (gain * 0.002).min(0.08)
        }
        4 => driven / (1.0 + driven.abs()),
        5 => fold_sample(sample, gain),
        _ => driven.tanh(),
    };
    sanitize_sample(output, 4.0)
}

fn dsp_sample_node_index(sample_index: i32) -> Option<usize> {
    unsafe {
        if sample_index < 0 || sample_index as usize >= MAX_DSP_SAMPLE_NODES {
            return None;
        }
        let node_index = kernel_global!(DSP_SAMPLE_NODE_INDICES)[sample_index as usize];
        if node_index < 0 || node_index as usize >= kernel_global!(NODE_COUNT) {
            return None;
        }
        Some(node_index as usize)
    }
}

fn render_dsp_sample_param(op: DspOp, repeated_resources: Option<&mut DspRepeatResourceState>) {
    let Some(node_index) = dsp_sample_node_index(op.a) else {
        return;
    };
    let value = dsp_reg(op.c);
    unsafe {
        let node = if let Some(resources) = repeated_resources {
            let Some(state) = resources.sample_mut(op.a as usize) else {
                return;
            };
            &mut state.effective_node
        } else {
            &mut kernel_global!(NODES)[node_index]
        };
        apply_dsp_sample_param(node, op.b, value);
    }
}

fn apply_dsp_sample_param(node: &mut Node, kind: i32, value: f64) {
    match kind {
        0 => {
            node.sample_mode =
                (value.round() as i32).clamp(SAMPLE_MODE_ONE_SHOT, SAMPLE_MODE_PING_PONG)
        }
        1 => node.sample_start = value.clamp(0.0, 1.0),
        2 => node.sample_end = value.clamp(0.0, 1.0),
        3 => node.sample_attack = value.max(0.0),
        4 => node.sample_release = value.max(0.0),
        5 => node.sample_stretch = value.max(0.001),
        6 => node.sample_cycle_length = value.round().max(1.0),
        7 => node.sample_overlap_ratio = value.clamp(0.0, 1.0),
        8 => node.sample_original_frequency = value.max(0.0001),
        _ => {}
    }
}

fn advance_dsp_sample_player(
    node_index: usize,
    node: Node,
    voice_slot: usize,
    target_frequency: f64,
    sample_rate: f64,
) {
    unsafe {
        if !kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] {
            return;
        }
        advance_sample_retrigger_fade(node_index, voice_slot, sample_rate);
        let sample_step = sample_playback_step(
            node_index,
            node,
            target_frequency,
            target_frequency,
            sample_rate,
        )
        .abs();
        if sample_step > 0.0 {
            kernel_global!(SAMPLE_HAS_ADVANCED)[voice_slot][node_index] = true;
        }
        let stretch = node.sample_stretch.max(0.001);
        if kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index] >= 0.0 {
            kernel_global!(SAMPLE_RELEASE_AGES)[voice_slot][node_index] +=
                1.0 / sample_rate.max(1.0);
            kernel_global!(SAMPLE_PLAYBACK_AGES)[voice_slot][node_index] +=
                1.0 / sample_rate.max(1.0);
            kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] +=
                (sample_step / stretch) * kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index];
            return;
        }
        kernel_global!(SAMPLE_PLAYBACK_AGES)[voice_slot][node_index] += 1.0 / sample_rate.max(1.0);
        kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index] +=
            (sample_step / stretch) * kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index];
        if (stretch - 1.0).abs() < 0.001 {
            kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index] = 0.0;
            kernel_global!(SAMPLE_STRETCH_ANCHORS)[voice_slot][node_index] =
                kernel_global!(SAMPLE_POSITIONS)[voice_slot][node_index];
            return;
        }

        let (_, _, _, _, _, length) =
            sample_range(node_index, node, 0.0, 0.0).unwrap_or((0.0, 0.0, 0.0, 0.0, 1.0, 512.0));
        let grain_frames = node.sample_cycle_length.round().clamp(1.0, length.max(1.0));
        let overlap_frames = if node.sample_overlap_ratio <= 0.0 {
            0.0
        } else {
            (grain_frames * node.sample_overlap_ratio.clamp(0.0, 1.0))
                .round()
                .clamp(1.0, (grain_frames - 1.0).max(1.0))
        };
        let hop_frames = (grain_frames - overlap_frames).max(1.0);
        kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index] += sample_step;
        while kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index] >= grain_frames {
            kernel_global!(SAMPLE_STRETCH_ANCHORS)[voice_slot][node_index] +=
                (hop_frames / stretch) * kernel_global!(SAMPLE_DIRECTIONS)[voice_slot][node_index];
            kernel_global!(SAMPLE_STRETCH_PHASES)[voice_slot][node_index] -= hop_frames;
        }
    }
}

fn dsp_sample_voice_count(value: f64) -> usize {
    if !value.is_finite() {
        return 1;
    }
    (value.round() as i32).clamp(1, MAX_DSP_SAMPLE_PLAYER_VOICES as i32) as usize
}

fn shrink_sample_voice_limit(
    playing: &[bool; MAX_DSP_SAMPLE_PLAYER_VOICES],
    active_voice_limit: usize,
) -> usize {
    let mut limit = active_voice_limit.min(MAX_DSP_SAMPLE_PLAYER_VOICES);
    while limit > 0 && !playing[limit - 1] {
        limit -= 1;
    }
    limit
}

#[cfg(test)]
mod sample_voice_limit_tests {
    use super::{shrink_sample_voice_limit, MAX_DSP_SAMPLE_PLAYER_VOICES};

    #[test]
    fn inactive_trailing_voices_are_removed_from_the_render_bound() {
        let mut playing = [false; MAX_DSP_SAMPLE_PLAYER_VOICES];
        playing[0] = true;
        playing[3] = true;
        assert_eq!(shrink_sample_voice_limit(&playing, 16), 4);
        playing[3] = false;
        assert_eq!(shrink_sample_voice_limit(&playing, 4), 1);
        playing[0] = false;
        assert_eq!(shrink_sample_voice_limit(&playing, 1), 0);
    }

    #[test]
    fn an_existing_high_voice_remains_renderable_after_the_voice_control_drops() {
        let mut playing = [false; MAX_DSP_SAMPLE_PLAYER_VOICES];
        playing[7] = true;
        assert_eq!(shrink_sample_voice_limit(&playing, 8), 8);
    }
}

fn select_dsp_sample_voice(node_index: usize, voice_count: usize) -> usize {
    unsafe {
        for voice in 0..voice_count {
            let voice_slot = DSP_SAMPLE_VOICE_SLOT_START + voice;
            if !kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] {
                return voice_slot;
            }
        }

        // With all voices active, steal the oldest voice. start_sample_player
        // crossfades its last output into the replacement to keep this musical.
        let mut selected_voice = DSP_SAMPLE_VOICE_SLOT_START;
        let mut longest_age = f64::NEG_INFINITY;
        for voice in 0..voice_count {
            let voice_slot = DSP_SAMPLE_VOICE_SLOT_START + voice;
            let age = kernel_global!(SAMPLE_PLAYBACK_AGES)[voice_slot][node_index];
            if age > longest_age {
                longest_age = age;
                selected_voice = voice_slot;
            }
        }
        selected_voice
    }
}

fn snapshot_dsp_sample_voice(
    sample_index: usize,
    node_index: usize,
    voice_slot: usize,
    node: Node,
    frequency: f64,
    level: f64,
) {
    if sample_index >= MAX_DSP_SAMPLE_NODES || voice_slot < DSP_SAMPLE_VOICE_SLOT_START {
        return;
    }
    let voice = voice_slot - DSP_SAMPLE_VOICE_SLOT_START;
    if voice >= MAX_DSP_SAMPLE_PLAYER_VOICES {
        return;
    }
    unsafe {
        kernel_global!(DSP_SAMPLE_VOICE_SETTINGS)[sample_index][voice] = DspSampleVoiceSettings {
            node,
            frequency: if frequency.is_finite() {
                frequency
            } else {
                220.0
            },
            level: if level.is_finite() { level } else { 0.0 },
        };
        kernel_global!(SAMPLE_FREQUENCY_DIRECTIONS)[voice_slot][node_index] =
            sample_player_frequency_direction(frequency);
    }
    start_sample_player(node_index, voice_slot, node, 0.0, 0.0);
    unsafe {
        if kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] {
            kernel_global!(DSP_SAMPLE_ACTIVE_VOICE_LIMITS)[sample_index] =
                kernel_global!(DSP_SAMPLE_ACTIVE_VOICE_LIMITS)[sample_index].max(voice + 1);
        }
    }
}

fn select_repeated_sample_voice(state: &DspSamplePlaybackState, voice_count: usize) -> usize {
    for voice in 0..voice_count {
        if !state.playing[voice] {
            return voice;
        }
    }

    let mut selected_voice = 0;
    let mut longest_age = f64::NEG_INFINITY;
    for voice in 0..voice_count {
        if state.playback_ages[voice] > longest_age {
            longest_age = state.playback_ages[voice];
            selected_voice = voice;
        }
    }
    selected_voice
}

fn start_repeated_sample_player(
    state: &mut DspSamplePlaybackState,
    node_index: usize,
    voice: usize,
    node: Node,
) {
    let was_playing = state.playing[voice];
    if was_playing {
        state.retrigger_outputs[voice] = state.last_outputs[voice];
        state.retrigger_fade_ages[voice] = 0.0;
        state.retrigger_fade_durations[voice] = node.sample_attack.max(SAMPLE_EDGE_FADE_SECONDS);
    } else {
        state.retrigger_outputs[voice] = 0.0;
        state.retrigger_fade_ages[voice] = -1.0;
        state.retrigger_fade_durations[voice] = 0.0;
        state.last_outputs[voice] = 0.0;
    }
    let Some((start_frame, end_frame, _, _, direction, _)) =
        sample_range(node_index, node, 0.0, 0.0)
    else {
        state.playing[voice] = false;
        return;
    };
    let Some(slot) = sample_slot_for_node(node_index) else {
        state.playing[voice] = false;
        return;
    };
    let frequency_direction = state.frequency_directions[voice];
    let initial_position =
        sample_player_start_boundary(start_frame, end_frame, frequency_direction);
    let start_index = (initial_position.round() as usize)
        .min(unsafe { kernel_global!(SAMPLE_LENGTHS)[slot] }.saturating_sub(1));
    state.playing[voice] = true;
    state.positions[voice] = initial_position;
    state.directions[voice] = direction * frequency_direction;
    state.has_advanced[voice] = false;
    state.playback_ages[voice] = 0.0;
    state.release_ages[voice] = -1.0;
    let Some(sample_data) = (unsafe { kernel_global!(SAMPLE_DATA)[slot].as_ref() }) else {
        state.playing[voice] = false;
        return;
    };
    state.start_values[voice] = sample_data.get(start_index).copied().unwrap_or(0.0) as f64;
    state.stretch_phases[voice] = 0.0;
    state.stretch_anchors[voice] = initial_position;
}

fn sync_repeated_sample_frequency_direction(
    state: &mut DspSamplePlaybackState,
    node_index: usize,
    voice: usize,
    node: Node,
    frequency: f64,
) {
    if !frequency.is_finite() || frequency == 0.0 {
        return;
    }
    let next_direction = if frequency < 0.0 { -1.0 } else { 1.0 };
    let previous_direction = state.frequency_directions[voice];
    if next_direction == previous_direction {
        return;
    }
    state.frequency_directions[voice] = next_direction;
    state.directions[voice] = -state.directions[voice];
    if state.has_advanced[voice] {
        return;
    }
    let Some((start_frame, end_frame, _, _, _, _)) = sample_range(node_index, node, 0.0, 0.0)
    else {
        return;
    };
    let initial_position = sample_player_start_boundary(start_frame, end_frame, next_direction);
    state.positions[voice] = initial_position;
    state.stretch_anchors[voice] = initial_position;
    let Some(slot) = sample_slot_for_node(node_index) else {
        return;
    };
    let Some(sample_data) = (unsafe { kernel_global!(SAMPLE_DATA)[slot].as_ref() }) else {
        return;
    };
    let initial_index = (initial_position.round() as usize)
        .min(unsafe { kernel_global!(SAMPLE_LENGTHS)[slot] }.saturating_sub(1));
    state.start_values[voice] = sample_data.get(initial_index).copied().unwrap_or(0.0) as f64;
}

fn finish_repeated_sample_boundary(
    state: &mut DspSamplePlaybackState,
    voice: usize,
    node: Node,
    start_frame: f64,
    end_frame: f64,
    first_frame: f64,
    last_frame: f64,
    direction: f64,
) {
    if node.sample_mode == SAMPLE_MODE_ONE_SHOT && state.release_ages[voice] >= 0.0 {
        return;
    }
    let play_direction = state.directions[voice];
    let boundary = if play_direction == direction {
        end_frame
    } else {
        start_frame
    };
    let position = state.positions[voice];
    if !sample_player_past_end(position, play_direction, boundary) {
        return;
    }
    if node.sample_mode == SAMPLE_MODE_LOOP {
        let span = (end_frame - start_frame).abs().max(1.0);
        let wrapped = (position - boundary).abs() % span;
        state.positions[voice] = if play_direction >= 0.0 {
            first_frame + wrapped
        } else {
            last_frame - wrapped
        };
    } else if node.sample_mode == SAMPLE_MODE_PING_PONG {
        let next_direction = -play_direction;
        let overshoot = (position - boundary).abs();
        state.directions[voice] = next_direction;
        state.positions[voice] =
            (boundary + overshoot * next_direction).clamp(first_frame, last_frame);
    } else if node.sample_release > 0.0 && state.release_ages[voice] < 0.0 {
        state.positions[voice] = boundary;
        state.release_ages[voice] = 0.0;
    } else {
        state.playing[voice] = false;
    }
}

fn repeated_sample_value(
    state: &mut DspSamplePlaybackState,
    node_index: usize,
    voice: usize,
    node: Node,
    sample_rate: f64,
) -> f64 {
    if !state.playing[voice] {
        return 0.0;
    }
    let Some(slot) = sample_slot_for_node(node_index) else {
        state.playing[voice] = false;
        return 0.0;
    };
    let Some(sample_data) = (unsafe { kernel_global!(SAMPLE_DATA)[slot].as_ref() }) else {
        state.playing[voice] = false;
        return 0.0;
    };
    let Some((start_frame, end_frame, first_frame, last_frame, direction, length)) =
        sample_range(node_index, node, 0.0, 0.0)
    else {
        state.playing[voice] = false;
        return 0.0;
    };
    let release_age = state.release_ages[voice];
    if release_age >= node.sample_release.max(0.0) && release_age >= 0.0 {
        state.playing[voice] = false;
        return 0.0;
    }
    let playback_start =
        sample_player_start_boundary(start_frame, end_frame, state.frequency_directions[voice]);
    if sample_player_before_start(
        state.positions[voice],
        state.directions[voice],
        playback_start,
    ) {
        start_repeated_sample_player(state, node_index, voice, node);
    }
    finish_repeated_sample_boundary(
        state,
        voice,
        node,
        start_frame,
        end_frame,
        first_frame,
        last_frame,
        direction,
    );
    if !state.playing[voice] {
        return 0.0;
    }

    let current_release_age = state.release_ages[voice];
    let release_active = current_release_age >= 0.0;
    let stretch = node.sample_stretch.max(0.001);
    let (position, next_position, mix) = if (stretch - 1.0).abs() < 0.001 {
        (state.positions[voice], state.positions[voice], 0.0)
    } else {
        let grain_frames = node.sample_cycle_length.round().clamp(1.0, length.max(1.0));
        let overlap_frames = if node.sample_overlap_ratio <= 0.0 {
            0.0
        } else {
            (grain_frames * node.sample_overlap_ratio.clamp(0.0, 1.0))
                .round()
                .clamp(1.0, (grain_frames - 1.0).max(1.0))
        };
        let hop_frames = (grain_frames - overlap_frames).max(1.0);
        let local = state.stretch_phases[voice].clamp(0.0, grain_frames);
        let overlap_local = (local - hop_frames).max(0.0);
        let mix = if overlap_frames > 0.0 && overlap_local > 0.0 {
            smooth_step(overlap_local / overlap_frames)
        } else {
            0.0
        };
        let play_direction = state.directions[voice];
        let next_anchor = state.stretch_anchors[voice] + (hop_frames / stretch) * play_direction;
        (
            state.stretch_anchors[voice] + local * play_direction,
            next_anchor + overlap_local * play_direction,
            mix,
        )
    };
    let max_frame = unsafe { kernel_global!(SAMPLE_LENGTHS)[slot] }.saturating_sub(1) as f64;
    let read_first_frame = if release_active { 0.0 } else { first_frame };
    let read_last_frame = if release_active {
        max_frame
    } else {
        last_frame
    };
    let position = position.clamp(read_first_frame, read_last_frame);
    let sample_at = |read_position: f64| -> f64 {
        let read_position = read_position.clamp(read_first_frame, read_last_frame);
        let lower = (read_position.floor() as usize)
            .min(unsafe { kernel_global!(SAMPLE_LENGTHS)[slot] }.saturating_sub(1));
        let upper = (lower + 1)
            .min(unsafe { kernel_global!(SAMPLE_LENGTHS)[slot] }.saturating_sub(1))
            .min(read_last_frame as usize);
        let frac = read_position - lower as f64;
        let a = sample_data[lower] as f64;
        let b = sample_data[upper] as f64;
        a + (b - a) * frac
    };
    let blended = if mix > 0.0 {
        sample_at(position) * (1.0 - mix) + sample_at(next_position) * mix
    } else {
        sample_at(position)
    };
    let start_distance = (position - start_frame).abs();
    let end_distance = (end_frame - position).abs();
    let fade_frames = (unsafe { kernel_global!(SAMPLE_RATES)[slot] }.max(sample_rate)
        * SAMPLE_EDGE_FADE_SECONDS)
        .round()
        .clamp(1.0, (length * 0.5).max(1.0));
    let end_edge = if node.sample_mode == SAMPLE_MODE_ONE_SHOT && node.sample_release > 0.0 {
        1.0
    } else {
        smooth_step(end_distance / fade_frames)
    };
    let edge = smooth_step(start_distance / fade_frames) * end_edge;
    let correction = state.start_values[voice] * (1.0 - smooth_step(start_distance / fade_frames));
    let attack = if node.sample_attack > 0.0 {
        smooth_step((state.playback_ages[voice] / node.sample_attack).clamp(0.0, 1.0))
    } else {
        1.0
    };
    let release = if current_release_age >= 0.0 && node.sample_release > 0.0 {
        1.0 - smooth_step((current_release_age / node.sample_release).clamp(0.0, 1.0))
    } else {
        1.0
    };
    let restarted = sanitize_sample((blended - correction) * edge * attack * release, 4.0);
    let fade_age = state.retrigger_fade_ages[voice];
    let output = if fade_age >= 0.0 {
        let duration = state.retrigger_fade_durations[voice].max(SAMPLE_EDGE_FADE_SECONDS);
        let fade = smooth_step(fade_age / duration);
        state.retrigger_outputs[voice] * (1.0 - fade) + restarted * fade
    } else {
        restarted
    };
    state.last_outputs[voice] = sanitize_sample(output, 4.0);
    state.last_outputs[voice]
}

fn advance_repeated_sample_player(
    state: &mut DspSamplePlaybackState,
    node_index: usize,
    voice: usize,
    node: Node,
    target_frequency: f64,
    sample_rate: f64,
) {
    if !state.playing[voice] {
        return;
    }
    let fade_age = state.retrigger_fade_ages[voice];
    if fade_age >= 0.0 {
        let duration = state.retrigger_fade_durations[voice].max(SAMPLE_EDGE_FADE_SECONDS);
        let next_age = fade_age + 1.0 / sample_rate.max(1.0);
        state.retrigger_fade_ages[voice] = if next_age >= duration { -1.0 } else { next_age };
    }
    let sample_step = sample_playback_step(
        node_index,
        node,
        target_frequency,
        target_frequency,
        sample_rate,
    )
    .abs();
    if sample_step > 0.0 {
        state.has_advanced[voice] = true;
    }
    let stretch = node.sample_stretch.max(0.001);
    state.playback_ages[voice] += 1.0 / sample_rate.max(1.0);
    if state.release_ages[voice] >= 0.0 {
        state.release_ages[voice] += 1.0 / sample_rate.max(1.0);
        state.positions[voice] += (sample_step / stretch) * state.directions[voice];
        return;
    }
    state.positions[voice] += (sample_step / stretch) * state.directions[voice];
    if (stretch - 1.0).abs() < 0.001 {
        state.stretch_phases[voice] = 0.0;
        state.stretch_anchors[voice] = state.positions[voice];
        return;
    }
    let (_, _, _, _, _, length) =
        sample_range(node_index, node, 0.0, 0.0).unwrap_or((0.0, 0.0, 0.0, 0.0, 1.0, 512.0));
    let grain_frames = node.sample_cycle_length.round().clamp(1.0, length.max(1.0));
    let overlap_frames = if node.sample_overlap_ratio <= 0.0 {
        0.0
    } else {
        (grain_frames * node.sample_overlap_ratio.clamp(0.0, 1.0))
            .round()
            .clamp(1.0, (grain_frames - 1.0).max(1.0))
    };
    let hop_frames = (grain_frames - overlap_frames).max(1.0);
    state.stretch_phases[voice] += sample_step;
    while state.stretch_phases[voice] >= grain_frames {
        state.stretch_anchors[voice] += (hop_frames / stretch) * state.directions[voice];
        state.stretch_phases[voice] -= hop_frames;
    }
}

fn render_repeated_dsp_sample(
    op: DspOp,
    frame: usize,
    sample_rate: f64,
    state: &mut DspSamplePlaybackState,
    video: bool,
) -> f64 {
    let Some(node_index) = dsp_sample_node_index(op.a) else {
        return 0.0;
    };
    unsafe {
        if op.state < 0 || (op.state as usize) >= MAX_DSP_STATE {
            return 0.0;
        }
        let trigger = dsp_reg(op.c) >= ENVELOPE_TRIGGER_THRESHOLD;
        let previous_trigger = *dsp_state_ptr(op.state as usize) >= ENVELOPE_TRIGGER_THRESHOLD;
        let node = state.effective_node;
        let voice_count = dsp_sample_voice_count(dsp_reg(op.d));
        if sample_slot_for_node(node_index).is_none() {
            *dsp_state_ptr(op.state as usize) = 0.0;
            state.active_voice_limit = 0;
            return 0.0;
        }
        if trigger && !previous_trigger {
            let voice = select_repeated_sample_voice(state, voice_count);
            let frequency = if dsp_reg(op.b).is_finite() {
                dsp_reg(op.b)
            } else {
                220.0
            };
            let level = if op.e >= 0 { dsp_reg(op.e) } else { 1.0 };
            state.voice_settings[voice] = DspSampleVoiceSettings {
                node,
                frequency,
                level: if level.is_finite() { level } else { 0.0 },
            };
            state.frequency_directions[voice] = sample_player_frequency_direction(frequency);
            start_repeated_sample_player(state, node_index, voice, node);
            if state.playing[voice] {
                state.active_voice_limit = state.active_voice_limit.max(voice + 1);
            }
            if video && kernel_global!(SAMPLE_TRIGGER_EVENT_COUNT) < MAX_SAMPLE_TRIGGER_EVENTS {
                if let Some(slot) = sample_slot_for_node(node_index) {
                    let (start_frame, end_frame, _, _, _, _) =
                        sample_range(node_index, node, 0.0, 0.0)
                            .unwrap_or((0.0, 0.0, 0.0, 0.0, 0.0, 0.0));
                    let source_rate = kernel_global!(SAMPLE_RATES)[slot].max(1.0);
                    let speed = (dsp_reg(op.b) / node.sample_original_frequency.max(0.0001))
                        / node.sample_stretch.max(0.001);
                    kernel_global!(SAMPLE_TRIGGER_EVENTS)
                        [kernel_global!(SAMPLE_TRIGGER_EVENT_COUNT)] = [
                        op.a as f64,
                        frame as f64,
                        start_frame / source_rate * 1000.0,
                        end_frame / source_rate * 1000.0,
                        speed,
                        level,
                        node.sample_attack.max(0.0) * 1000.0,
                        node.sample_release.max(0.0) * 1000.0,
                    ];
                    kernel_global!(SAMPLE_TRIGGER_EVENT_COUNT) += 1;
                }
            }
        }
        *dsp_state_ptr(op.state as usize) = if trigger { 1.0 } else { 0.0 };

        let mut output = 0.0;
        for voice in 0..state.active_voice_limit {
            if !state.playing[voice] {
                continue;
            }
            let voice_settings = state.voice_settings[voice];
            let live_mono_voice = voice_count == 1 && voice == 0;
            let playback_node = if live_mono_voice {
                node
            } else {
                voice_settings.node
            };
            let playback_frequency = if live_mono_voice {
                let frequency = dsp_reg(op.b);
                if frequency.is_finite() {
                    frequency
                } else {
                    220.0
                }
            } else {
                voice_settings.frequency
            };
            let playback_level = if live_mono_voice {
                let level = if op.e >= 0 { dsp_reg(op.e) } else { 1.0 };
                if level.is_finite() {
                    level
                } else {
                    0.0
                }
            } else {
                voice_settings.level
            };
            sync_repeated_sample_frequency_direction(
                state,
                node_index,
                voice,
                playback_node,
                playback_frequency,
            );
            output += repeated_sample_value(state, node_index, voice, playback_node, sample_rate)
                * playback_level;
            advance_repeated_sample_player(
                state,
                node_index,
                voice,
                playback_node,
                playback_frequency,
                sample_rate,
            );
        }
        state.active_voice_limit =
            shrink_sample_voice_limit(&state.playing, state.active_voice_limit);
        sanitize_sample(output, 4.0)
    }
}

fn render_dsp_sample(
    op: DspOp,
    frame: usize,
    sample_rate: f64,
    repeated_state: Option<&mut DspSamplePlaybackState>,
    video: bool,
) -> f64 {
    if let Some(state) = repeated_state {
        return render_repeated_dsp_sample(op, frame, sample_rate, state, video);
    }
    let Some(node_index) = dsp_sample_node_index(op.a) else {
        return 0.0;
    };
    unsafe {
        if op.state < 0 || (op.state as usize) >= MAX_DSP_STATE {
            return 0.0;
        }

        let sample_index = op.a as usize;
        let trigger = dsp_reg(op.c) >= ENVELOPE_TRIGGER_THRESHOLD;
        let previous_trigger = *dsp_state_ptr(op.state as usize) >= ENVELOPE_TRIGGER_THRESHOLD;
        let node = kernel_global!(NODES)[node_index];
        let voice_count = dsp_sample_voice_count(dsp_reg(op.d));
        let has_sample = sample_slot_for_node(node_index).is_some();

        if !has_sample {
            *dsp_state_ptr(op.state as usize) = 0.0;
            kernel_global!(DSP_SAMPLE_ACTIVE_VOICE_LIMITS)[sample_index] = 0;
            return 0.0;
        }

        if trigger && !previous_trigger {
            let voice_slot = select_dsp_sample_voice(node_index, voice_count);
            // Older compiled programs applied level in a separate multiply and
            // therefore have no Sample-op level register. Keep those graphs
            // audible while newer programs snapshot the level per voice.
            let level = if op.e >= 0 { dsp_reg(op.e) } else { 1.0 };
            snapshot_dsp_sample_voice(
                sample_index,
                node_index,
                voice_slot,
                node,
                dsp_reg(op.b),
                level,
            );
            if video && kernel_global!(SAMPLE_TRIGGER_EVENT_COUNT) < MAX_SAMPLE_TRIGGER_EVENTS {
                if let Some(slot) = sample_slot_for_node(node_index) {
                    let (start_frame, end_frame, _, _, _, _) =
                        sample_range(node_index, node, 0.0, 0.0)
                            .unwrap_or((0.0, 0.0, 0.0, 0.0, 0.0, 0.0));
                    let source_rate = kernel_global!(SAMPLE_RATES)[slot].max(1.0);
                    let speed = (dsp_reg(op.b) / node.sample_original_frequency.max(0.0001))
                        / node.sample_stretch.max(0.001);
                    kernel_global!(SAMPLE_TRIGGER_EVENTS)
                        [kernel_global!(SAMPLE_TRIGGER_EVENT_COUNT)] = [
                        sample_index as f64,
                        frame as f64,
                        start_frame / source_rate * 1000.0,
                        end_frame / source_rate * 1000.0,
                        speed,
                        level,
                        node.sample_attack.max(0.0) * 1000.0,
                        node.sample_release.max(0.0) * 1000.0,
                    ];
                    kernel_global!(SAMPLE_TRIGGER_EVENT_COUNT) += 1;
                }
            }
        }
        *dsp_state_ptr(op.state as usize) = if trigger { 1.0 } else { 0.0 };

        let mut output = 0.0;
        // Existing voices are allowed to finish if the voices input is reduced;
        // the current limit only controls allocation of new triggers.
        for voice in 0..kernel_global!(DSP_SAMPLE_ACTIVE_VOICE_LIMITS)[sample_index] {
            let voice_slot = DSP_SAMPLE_VOICE_SLOT_START + voice;
            if !kernel_global!(SAMPLE_PLAYING)[voice_slot][node_index] {
                continue;
            }
            let voice_settings = kernel_global!(DSP_SAMPLE_VOICE_SETTINGS)[sample_index][voice];
            // A monophonic player has no overlapping voices to protect, so let
            // its active voice follow the current inputs. Polyphonic playback
            // keeps each voice's trigger-time snapshot so later notes cannot
            // retune or reshape voices that are already sounding.
            let live_mono_voice = voice_count == 1 && voice == 0;
            let playback_node = if live_mono_voice {
                node
            } else {
                voice_settings.node
            };
            let playback_frequency = if live_mono_voice {
                let frequency = dsp_reg(op.b);
                if frequency.is_finite() {
                    frequency
                } else {
                    220.0
                }
            } else {
                voice_settings.frequency
            };
            let playback_level = if live_mono_voice {
                let level = if op.e >= 0 { dsp_reg(op.e) } else { 1.0 };
                if level.is_finite() {
                    level
                } else {
                    0.0
                }
            } else {
                voice_settings.level
            };
            sync_sample_frequency_direction(
                node_index,
                voice_slot,
                playback_node,
                playback_frequency,
            );
            output += sample_value(
                node_index,
                playback_node,
                voice_slot,
                sample_rate,
                0.0,
                0.0,
                0.0,
            ) * playback_level;
            advance_dsp_sample_player(
                node_index,
                playback_node,
                voice_slot,
                playback_frequency,
                sample_rate,
            );
        }
        while kernel_global!(DSP_SAMPLE_ACTIVE_VOICE_LIMITS)[sample_index] > 0 {
            let last_voice = kernel_global!(DSP_SAMPLE_ACTIVE_VOICE_LIMITS)[sample_index] - 1;
            let last_voice_slot = DSP_SAMPLE_VOICE_SLOT_START + last_voice;
            if kernel_global!(SAMPLE_PLAYING)[last_voice_slot][node_index] {
                break;
            }
            kernel_global!(DSP_SAMPLE_ACTIVE_VOICE_LIMITS)[sample_index] -= 1;
        }
        sanitize_sample(output, 4.0)
    }
}

fn render_dsp_image(op: DspOp) -> f64 {
    let slot = op.value.round() as i32;
    if slot < 0 || slot as usize >= MAX_IMAGE_SLOTS {
        return 0.0;
    }
    unsafe {
        let slot = slot as usize;
        let width = kernel_global!(IMAGE_WIDTHS)[slot];
        let height = kernel_global!(IMAGE_HEIGHTS)[slot];
        if width == 0 || height == 0 {
            return 0.0;
        }
        let Some(image_data) = kernel_global!(IMAGE_DATA)[slot].as_ref() else {
            return 0.0;
        };
        let x = ((dsp_reg(op.a).clamp(-1.0, 1.0) + 1.0) * 0.5) * (width.saturating_sub(1) as f64);
        let y = ((dsp_reg(op.b).clamp(-1.0, 1.0) + 1.0) * 0.5) * (height.saturating_sub(1) as f64);
        let x0 = x.floor() as usize;
        let y0 = y.floor() as usize;
        let x1 = (x0 + 1).min(width - 1);
        let y1 = (y0 + 1).min(height - 1);
        let tx = x - x0 as f64;
        let ty = y - y0 as f64;
        let pixel = |pixel_x: usize, pixel_y: usize, component: usize| -> f64 {
            let index = (pixel_y * width + pixel_x) * 4 + component;
            image_data.get(index).copied().unwrap_or(0) as f64 / 255.0
        };
        let sample_component = |component: usize| {
            let top = pixel(x0, y0, component)
                + (pixel(x1, y0, component) - pixel(x0, y0, component)) * tx;
            let bottom = pixel(x0, y1, component)
                + (pixel(x1, y1, component) - pixel(x0, y1, component)) * tx;
            top + (bottom - top) * ty
        };
        let red = sample_component(0);
        let green = sample_component(1);
        let blue = sample_component(2);
        match op.c {
            0 => 0.2126 * red + 0.7152 * green + 0.0722 * blue,
            1 => red,
            2 => green,
            3 => blue,
            4 => {
                let max = red.max(green).max(blue);
                let min = red.min(green).min(blue);
                let delta = max - min;
                if delta <= f64::EPSILON {
                    0.0
                } else {
                    let hue = if max == red {
                        ((green - blue) / delta).rem_euclid(6.0)
                    } else if max == green {
                        (blue - red) / delta + 2.0
                    } else {
                        (red - green) / delta + 4.0
                    };
                    hue / 6.0
                }
            }
            5 => {
                let max = red.max(green).max(blue);
                let min = red.min(green).min(blue);
                if max <= f64::EPSILON {
                    0.0
                } else {
                    (max - min) / max
                }
            }
            _ => 0.0,
        }
    }
}

fn render_dsp_function(op: DspOp) -> f64 {
    let x = dsp_reg(op.b);
    let y = dsp_reg(op.c);
    let z = dsp_reg(op.d);
    let output = match op.a {
        1 => x.abs(),
        2 => x.sin(),
        3 => x.cos(),
        4 => x.tan(),
        5 => x.tanh(),
        6 => x.min(y),
        7 => x.max(y),
        8 => x.clamp(y.min(z), y.max(z)),
        9 => sign_preserving_pow(x, y),
        10 => x.clamp(-60.0, 60.0).exp(),
        11 => x.max(0.000001).ln(),
        12 => x.max(0.0).sqrt(),
        13 => x.floor(),
        14 => x.ceil(),
        15 => x.round(),
        16 => {
            if x > 0.0 {
                1.0
            } else if x < 0.0 {
                -1.0
            } else {
                0.0
            }
        }
        17 => x - x.floor(),
        18 => x + (y - x) * z,
        19 => {
            if x < y {
                1.0
            } else {
                0.0
            }
        }
        20 => {
            if x <= y {
                1.0
            } else {
                0.0
            }
        }
        21 => {
            if x > y {
                1.0
            } else {
                0.0
            }
        }
        22 => {
            if x >= y {
                1.0
            } else {
                0.0
            }
        }
        23 => {
            if x == y {
                1.0
            } else {
                0.0
            }
        }
        24 => {
            if x != y {
                1.0
            } else {
                0.0
            }
        }
        25 => {
            if x != 0.0 && y != 0.0 {
                1.0
            } else {
                0.0
            }
        }
        26 => {
            if x != 0.0 || y != 0.0 {
                1.0
            } else {
                0.0
            }
        }
        27 => {
            if x == 0.0 {
                1.0
            } else {
                0.0
            }
        }
        _ => 0.0,
    };
    sanitize_control_value(output)
}

fn sign_preserving_pow(base: f64, exponent: f64) -> f64 {
    let magnitude = base.abs().powf(exponent);
    if base > 0.0 {
        magnitude
    } else if base < 0.0 {
        -magnitude
    } else {
        0.0
    }
}

fn render_dsp_midi_note(op: DspOp) -> f64 {
    unsafe {
        let channel = dsp_reg(op.b).round().clamp(0.0, 16.0) as usize;
        match op.a {
            1 => kernel_global!(DSP_MIDI_MONO_FREQUENCIES)[channel],
            2 => kernel_global!(DSP_MIDI_MONO_VELOCITIES)[channel],
            3 => kernel_global!(DSP_MIDI_MONO_GATES)[channel],
            4 => kernel_global!(DSP_MIDI_MONO_TRIGGERS)[channel],
            5..=9 => {
                let event = kernel_global!(DSP_MIDI_CURRENT_EVENT);
                let channel_matches = channel == 0 || channel == event.channel;
                if !kernel_global!(DSP_MIDI_CURRENT_EVENT_ACTIVE) || !channel_matches {
                    return 0.0;
                }
                match op.a {
                    5 if event.note_on => event.note,
                    6 if event.note_on => midi_note_frequency(event.note),
                    7 if event.note_on => event.velocity,
                    8 if !event.note_on => event.note,
                    9 if !event.note_on => midi_note_frequency(event.note),
                    _ => 0.0,
                }
            }
            _ => kernel_global!(DSP_MIDI_MONO_NOTES)[channel],
        }
    }
}

fn render_dsp_midi_cc(op: DspOp) -> f64 {
    let cc = dsp_reg(op.a).round().clamp(0.0, 127.0) as usize;
    let channel = dsp_reg(op.b).round().clamp(0.0, 16.0) as usize;
    unsafe { kernel_global!(DSP_MIDI_CC_VALUES)[channel][cc] }
}

#[allow(static_mut_refs)]
fn render_dsp_midi_note_send(op: DspOp) {
    unsafe {
        if op.state < 0 {
            return;
        }
        let state_index = op.state as usize;
        if state_index >= MAX_DSP_STATE {
            return;
        }

        let trigger = sanitize_control_value(dsp_reg(op.a));
        let was_triggered = *dsp_state_ptr(state_index) >= 0.5;
        *dsp_state_ptr(state_index) = if trigger >= 0.5 { 1.0 } else { 0.0 };
        if trigger < 0.5 || was_triggered {
            return;
        }

        let events = kernel_global!(DSP_MIDI_OUTPUT_EVENTS).get_or_insert_with(VecDeque::new);
        if events.len() >= 4096 {
            kernel_global!(DSP_MIDI_INPUT_OVERFLOWS) += 1;
            return; // Reject newest; accepted events retain their order.
        }
        events.push_back(DspMidiNoteEvent {
            is_cc: false,
            note_on: op.value >= 0.5,
            channel: dsp_reg(op.d).round().clamp(1.0, 16.0) as usize,
            note: dsp_reg(op.b).round().clamp(0.0, 127.0),
            velocity: dsp_reg(op.c).clamp(0.0, 1.0),
        });
    }
}

#[allow(static_mut_refs)]
fn render_dsp_midi_cc_send(op: DspOp, sample_rate: f64) {
    unsafe {
        if op.state < 0 || op.state as usize + 4 >= MAX_DSP_STATE {
            return;
        }
        let state = op.state as usize;
        let signal = dsp_reg(op.a).clamp(0.0, 1.0);
        let value = (signal * 127.0).round() / 127.0;
        let trigger = sanitize_control_value(dsp_reg(op.b));
        let trigger_connected = op.value >= 0.5;
        let throttle = dsp_reg(op.e).max(0.0);
        let initialized = *dsp_state_ptr(state + 3) >= 0.5;

        if !initialized {
            *dsp_state_ptr(state) = 0.0;
            *dsp_state_ptr(state + 1) = value;
            *dsp_state_ptr(state + 2) = throttle;
            *dsp_state_ptr(state + 3) = 1.0;
            *dsp_state_ptr(state + 4) = 0.0;
        } else {
            *dsp_state_ptr(state + 2) += 1.0 / sample_rate.max(1.0);
        }

        let was_triggered = *dsp_state_ptr(state) >= 0.5;
        *dsp_state_ptr(state) = if trigger >= 0.5 { 1.0 } else { 0.0 };
        let changed = (value - *dsp_state_ptr(state + 1)).abs() > 0.000001;
        if changed {
            *dsp_state_ptr(state + 1) = value;
            if !trigger_connected {
                *dsp_state_ptr(state + 4) = 1.0;
            }
        }

        let triggered = trigger_connected && trigger >= 0.5 && !was_triggered;
        let pending_change = !trigger_connected && *dsp_state_ptr(state + 4) >= 0.5;
        if (!triggered && !pending_change) || *dsp_state_ptr(state + 2) + f64::EPSILON < throttle {
            return;
        }

        let events = kernel_global!(DSP_MIDI_OUTPUT_EVENTS).get_or_insert_with(VecDeque::new);
        if events.len() >= 4096 {
            kernel_global!(DSP_MIDI_INPUT_OVERFLOWS) += 1;
            return; // Reject newest; accepted events retain their order.
        }
        events.push_back(DspMidiNoteEvent {
            is_cc: true,
            note_on: false,
            channel: dsp_reg(op.d).round().clamp(1.0, 16.0) as usize,
            note: dsp_reg(op.c).round().clamp(0.0, 127.0),
            velocity: value,
        });
        *dsp_state_ptr(state + 2) = 0.0;
        *dsp_state_ptr(state + 4) = 0.0;
    }
}

fn tempo_division_beats(kind: i32) -> f64 {
    match kind.rem_euclid(TEMPO_OUTPUT_COUNT) {
        0 => 16.0,
        1 => 8.0,
        2 => 4.0,
        3 => 4.0,
        4 => 2.0,
        5 => 1.0,
        6 => 1.0,
        7 => 0.5,
        8 => 0.25,
        9 => 0.125,
        _ => 1.0,
    }
}

fn tempo_click_phase_offset(kind: i32) -> f64 {
    if kind.rem_euclid(TEMPO_OUTPUT_COUNT) == 6 {
        0.5
    } else {
        0.0
    }
}

fn advance_dsp_tempo_clock(source_index: usize, bpm: f64, sample_rate: f64, frame: usize) {
    unsafe {
        let source_index = source_index.min(MAX_DSP_TEMPO_SOURCES - 1);
        let frame = (frame as u32).min(MAX_WASM_FRAMES as u32);
        if kernel_global!(DSP_TEMPO_LAST_QUANTUM_BY_SOURCE)[source_index]
            == kernel_global!(DSP_RENDER_QUANTUM_ID)
            && kernel_global!(DSP_TEMPO_LAST_FRAME_BY_SOURCE)[source_index] == frame
        {
            return;
        }

        kernel_global!(DSP_TEMPO_LAST_QUANTUM_BY_SOURCE)[source_index] =
            kernel_global!(DSP_RENDER_QUANTUM_ID);
        kernel_global!(DSP_TEMPO_LAST_FRAME_BY_SOURCE)[source_index] = frame;
        kernel_global!(DSP_TEMPO_STARTED_ON_FRAME_BY_SOURCE)[source_index] = false;

        let bpm = bpm.clamp(1.0, 999.0);
        let step = (bpm / 60.0) / sample_rate.max(1.0);
        if !kernel_global!(DSP_TEMPO_STARTED_BY_SOURCE)[source_index] {
            kernel_global!(DSP_TEMPO_STARTED_BY_SOURCE)[source_index] = true;
            kernel_global!(DSP_TEMPO_STARTED_ON_FRAME_BY_SOURCE)[source_index] = true;
        }

        let previous = kernel_global!(DSP_TEMPO_BEATS_BY_SOURCE)[source_index].max(0.0);
        kernel_global!(DSP_TEMPO_PREVIOUS_BEATS_BY_SOURCE)[source_index] = previous;
        kernel_global!(DSP_TEMPO_BEATS_BY_SOURCE)[source_index] =
            sanitize_control_value(previous + step.max(0.0)).max(0.0);
    }
}

fn tempo_boundary_crossed(
    previous_beats: f64,
    current_beats: f64,
    division_beats: f64,
    offset_beats: f64,
) -> bool {
    if division_beats <= 0.0 || current_beats <= previous_beats {
        return false;
    }

    let previous_boundary = ((previous_beats - offset_beats) / division_beats).floor();
    let current_boundary = ((current_beats - offset_beats) / division_beats).floor();
    current_boundary > previous_boundary
}

fn tempo_swung_boundary_time(
    boundary_index: i64,
    division_beats: f64,
    offset_beats: f64,
    swing: f64,
) -> f64 {
    let base = offset_beats + boundary_index as f64 * division_beats;
    if boundary_index.rem_euclid(2) == 0 {
        base
    } else {
        base + swing.clamp(-1.0, 1.0) * division_beats * 0.5
    }
}

fn tempo_swung_boundary_crossed(
    previous_beats: f64,
    current_beats: f64,
    division_beats: f64,
    offset_beats: f64,
    swing: f64,
) -> bool {
    if swing.abs() < 0.000001 {
        return tempo_boundary_crossed(previous_beats, current_beats, division_beats, offset_beats);
    }

    if division_beats <= 0.0 || current_beats <= previous_beats {
        return false;
    }

    let max_shift = division_beats * 0.5;
    let start_index =
        ((previous_beats - offset_beats - max_shift) / division_beats).floor() as i64 - 1;
    let end_index =
        ((current_beats - offset_beats + max_shift) / division_beats).floor() as i64 + 1;

    for boundary_index in start_index..=end_index {
        let boundary =
            tempo_swung_boundary_time(boundary_index, division_beats, offset_beats, swing);
        if boundary > previous_beats && boundary <= current_beats {
            return true;
        }
    }

    false
}

// Shared transport-delivery primitive; adapter converts its own timeline into
// this authoritative musical position. No clock is invented by the evaluator.
#[allow(dead_code)] // Native adapter today; state/semantics also compile into WASM.
fn deliver_dsp_host_position(frame: u64, beat: f64, bpm: f64, running: bool, discontinuity: bool) {
    unsafe {
        kernel_global!(HOST_PREVIOUS_BEAT) =
            if !kernel_global!(HOST_TIMELINE_ACTIVE) || discontinuity {
                beat - 1e-9
            } else {
                kernel_global!(HOST_BEAT)
            };
        kernel_global!(HOST_FRAME) = frame;
        kernel_global!(HOST_BEAT) = beat;
        kernel_global!(HOST_BPM) = bpm;
        kernel_global!(HOST_RUNNING) = running;
        kernel_global!(HOST_TIMELINE_ACTIVE) = true;
    }
}

fn render_dsp_tempo(op: DspOp, frame: usize, sample_rate: f64) -> f64 {
    unsafe {
        if kernel_global!(HOST_TIMELINE_ACTIVE) {
            return render_dsp_tempo_position(
                op.c,
                kernel_global!(HOST_BPM),
                dsp_reg(op.e).clamp(-1.0, 1.0),
                kernel_global!(HOST_PREVIOUS_BEAT),
                kernel_global!(HOST_BEAT),
                false,
                kernel_global!(HOST_RUNNING),
            );
        }

        if sample_rate <= 0.0 {
            return 0.0;
        }

        let source = dsp_reg(op.b).round() as i32;
        let midi_source = dsp_reg(op.d)
            .round()
            .clamp(0.0, (MAX_DSP_TEMPO_SOURCES - 1) as f64) as usize;
        let internal_bpm = dsp_reg(op.a).clamp(1.0, 999.0);
        let source_index = if source == 1 {
            midi_source
        } else {
            DSP_TEMPO_INTERNAL_SOURCE
        };
        let bpm = if source == 1 {
            if midi_source == 0 {
                kernel_global!(DSP_TEMPO_BPM)
            } else {
                kernel_global!(DSP_TEMPO_BPM_BY_SOURCE)[midi_source]
            }
        } else {
            internal_bpm
        }
        .clamp(1.0, 999.0);
        let swing = dsp_reg(op.e).clamp(-1.0, 1.0);
        advance_dsp_tempo_clock(source_index, bpm, sample_rate, frame);

        render_dsp_tempo_position(
            op.c,
            bpm,
            swing,
            kernel_global!(DSP_TEMPO_PREVIOUS_BEATS_BY_SOURCE)[source_index],
            kernel_global!(DSP_TEMPO_BEATS_BY_SOURCE)[source_index],
            kernel_global!(DSP_TEMPO_STARTED_ON_FRAME_BY_SOURCE)[source_index],
            true,
        )
    }
}

fn render_dsp_tempo_position(
    kind: i32,
    bpm: f64,
    swing: f64,
    previous: f64,
    current: f64,
    started: bool,
    running: bool,
) -> f64 {
    if !running {
        return 0.0;
    }
    let frequency = (bpm / 60.0) / tempo_division_beats(kind);
    if kind >= TEMPO_OUTPUT_COUNT {
        return sanitize_control_value(frequency);
    }

    let offset = tempo_click_phase_offset(kind);
    let click = if started && offset <= 0.0 {
        true
    } else {
        tempo_swung_boundary_crossed(previous, current, tempo_division_beats(kind), offset, swing)
    };
    if click {
        1.0
    } else {
        0.0
    }
}

fn advance_accumulator(value: f64, increment: f64, low: f64, high: f64) -> f64 {
    if high <= low {
        return low;
    }

    let next = value + increment;
    if next > high {
        low
    } else if next < low {
        high
    } else {
        next
    }
}

fn accumulator_should_advance(continuous: bool, trigger: bool, previous_trigger: bool) -> bool {
    continuous || (trigger && !previous_trigger)
}

fn render_dsp_accumulator(op: DspOp) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 2) >= MAX_DSP_STATE {
            return dsp_reg(op.b);
        }

        let state_index = op.state as usize;
        let trigger = dsp_reg(op.a) >= ENVELOPE_TRIGGER_THRESHOLD;
        let previous_trigger = *dsp_state_ptr(state_index + 1) >= ENVELOPE_TRIGGER_THRESHOLD;
        let reset = dsp_reg(op.e) >= ENVELOPE_TRIGGER_THRESHOLD;
        let previous_reset = *dsp_state_ptr(state_index + 2) >= ENVELOPE_TRIGGER_THRESHOLD;
        let min = dsp_reg(op.b);
        let max = dsp_reg(op.c);
        let increment = dsp_reg(op.d);
        let continuous = op.value >= 0.5;
        let low = min.min(max);
        let high = min.max(max);
        let mut value = (*dsp_state_ptr(state_index)).clamp(low, high);

        if !(*dsp_state_ptr(state_index)).is_finite() || (value == 0.0 && low > 0.0) {
            value = low;
        }

        if reset && !previous_reset {
            value = low;
        } else if accumulator_should_advance(continuous, trigger, previous_trigger) {
            value = advance_accumulator(value, increment, low, high);
        }

        *dsp_state_ptr(state_index) = sanitize_control_value(value);
        *dsp_state_ptr(state_index + 1) = if trigger { 1.0 } else { 0.0 };
        *dsp_state_ptr(state_index + 2) = if reset { 1.0 } else { 0.0 };
        *dsp_state_ptr(state_index)
    }
}

fn render_dsp_random(op: DspOp, local_state: Option<&mut u32>) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 3) >= MAX_DSP_STATE {
            return 0.0;
        }

        let state_index = op.state as usize;
        let trigger = op.a >= 0 && dsp_reg(op.a) >= ENVELOPE_TRIGGER_THRESHOLD;
        let initialized = *dsp_state_ptr(state_index + 3) >= 0.5;
        let previous_trigger = *dsp_state_ptr(state_index + 1) >= ENVELOPE_TRIGGER_THRESHOLD;

        if !initialized {
            let mut random_state = local_state.map_or_else(next_dsp_random_seed, |state| {
                *state = advance_random_state(*state);
                *state
            });
            *dsp_state_ptr(state_index) = random_unit_from_state(&mut random_state);
            *dsp_state_ptr(state_index + 1) = if trigger { 1.0 } else { 0.0 };
            *dsp_state_ptr(state_index + 2) = random_state as f64;
            *dsp_state_ptr(state_index + 3) = 1.0;
        } else {
            if trigger && !previous_trigger {
                let mut random_state = (*dsp_state_ptr(state_index + 2))
                    .round()
                    .clamp(0.0, u32::MAX as f64) as u32;
                *dsp_state_ptr(state_index) = random_unit_from_state(&mut random_state);
                *dsp_state_ptr(state_index + 2) = random_state as f64;
            }
            *dsp_state_ptr(state_index + 1) = if trigger { 1.0 } else { 0.0 };
        }

        let unit = (*dsp_state_ptr(state_index)).clamp(0.0, 1.0);
        let range_min = dsp_reg(op.b);
        let range_max = dsp_reg(op.c);
        sanitize_control_value(range_min + (range_max - range_min) * unit)
    }
}

#[cfg(test)]
mod accumulator_tests {
    use super::{accumulator_should_advance, advance_accumulator, sanitize_control_value};

    #[test]
    fn trigger_mode_advances_only_on_a_rising_edge() {
        assert!(accumulator_should_advance(false, true, false));
        assert!(!accumulator_should_advance(false, true, true));
        assert!(!accumulator_should_advance(false, false, false));
    }

    #[test]
    fn continuous_mode_advances_without_a_trigger() {
        assert!(accumulator_should_advance(true, false, false));
        assert!(accumulator_should_advance(true, true, true));
    }

    #[test]
    fn floating_point_increments_and_range_wrapping_are_supported() {
        assert_eq!(advance_accumulator(0.25, 0.125, 0.0, 1.0), 0.375);
        assert_eq!(advance_accumulator(0.9, 0.2, 0.0, 1.0), 0.0);
        assert_eq!(advance_accumulator(0.1, -0.2, 0.0, 1.0), 1.0);
        assert_eq!(advance_accumulator(0.5, 1.0, 0.5, 0.5), 0.5);
    }

    #[test]
    fn dsp_values_are_not_amplitude_clamped() {
        assert_eq!(sanitize_control_value(440.0), 440.0);
        assert_eq!(sanitize_control_value(-24_000.0), -24_000.0);
        assert_eq!(sanitize_control_value(f64::INFINITY), 0.0);
    }
}

fn render_dsp_sequencer(op: DspOp, frame: usize) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 7) >= MAX_DSP_STATE {
            return 0.0;
        }

        let steps = (dsp_reg(op.b).round() as i32).clamp(SEQUENCER_MIN_STEPS, SEQUENCER_MAX_STEPS);
        let rows = (dsp_reg(op.d).round() as i32).clamp(SEQUENCER_MIN_ROWS, SEQUENCER_MAX_ROWS);
        let row = dsp_reg(op.c).round() as i32;

        let state_index = op.state as usize;
        let frame_token = kernel_global!(DSP_RENDER_QUANTUM_ID) as f64
            * (MAX_WASM_FRAMES as f64 + 1.0)
            + frame as f64;
        if (*dsp_state_ptr(state_index + 3) - frame_token).abs() >= 0.5 {
            let trigger = dsp_reg(op.a) >= ENVELOPE_TRIGGER_THRESHOLD;
            let previous_trigger = *dsp_state_ptr(state_index + 1) >= ENVELOPE_TRIGGER_THRESHOLD;
            let pulse = trigger && !previous_trigger;
            let reset = dsp_reg(op.e) >= ENVELOPE_TRIGGER_THRESHOLD;
            let previous_reset = *dsp_state_ptr(state_index + 5) >= ENVELOPE_TRIGGER_THRESHOLD;
            let reset_pulse = reset && !previous_reset;
            let mut pulse_count = (*dsp_state_ptr(state_index + 4)).round() as i32;
            if !(*dsp_state_ptr(state_index + 4)).is_finite() || pulse_count < 0 {
                pulse_count = 0;
            }
            if reset_pulse {
                pulse_count = 0;
                *dsp_state_ptr(state_index + 6) = 0.0;
            }
            if pulse {
                let elapsed_frames = *dsp_state_ptr(state_index + 6);
                if pulse_count > 0 && elapsed_frames >= 1.0 {
                    *dsp_state_ptr(state_index + 7) = elapsed_frames;
                }
                *dsp_state_ptr(state_index + 6) = 0.0;
                pulse_count += 1;
            } else if pulse_count > 0 {
                *dsp_state_ptr(state_index + 6) += 1.0;
            }
            let initialized = pulse_count > 0;
            let step = if initialized {
                (pulse_count - 1).rem_euclid(steps.max(1))
            } else {
                0
            };

            *dsp_state_ptr(state_index) = step as f64;
            *dsp_state_ptr(state_index + 1) = if trigger { 1.0 } else { 0.0 };
            *dsp_state_ptr(state_index + 2) = if pulse { 1.0 } else { 0.0 };
            *dsp_state_ptr(state_index + 3) = frame_token;
            *dsp_state_ptr(state_index + 4) = pulse_count as f64;
            *dsp_state_ptr(state_index + 5) = if reset { 1.0 } else { 0.0 };
        }

        let step = (*dsp_state_ptr(state_index)).round() as i32;
        let interval_frames = *dsp_state_ptr(state_index + 7);
        let fractional_step = if interval_frames >= 1.0 {
            (*dsp_state_ptr(state_index + 6) / interval_frames).clamp(0.0, 0.999_999)
        } else {
            0.0
        };
        let position = step.max(0) as f64 + fractional_step;
        let binding_index = op.value.round().max(0.0) as usize;
        let Some(config) = (*core::ptr::addr_of!(kernel_global!(DSP_SEQUENCER_CONFIGS)))
            .get(binding_index)
            .and_then(|config| config.as_ref())
        else {
            return 0.0;
        };
        if row == -1 && *dsp_state_ptr(state_index + 4) >= 1.0 {
            return if config.gate_mode {
                position
            } else {
                step.max(0) as f64
            };
        }

        if row < 0 || row >= rows || row as usize >= config.rows {
            return 0.0;
        }
        if *dsp_state_ptr(state_index + 4) < 1.0 {
            return 0.0;
        }
        let row_start = row as usize * config.steps;
        let row_events = &config.events[row_start..row_start + config.steps];
        if config.gate_mode {
            return row_events
                .iter()
                .find(|event| event.active && position >= event.start && position < event.end)
                .map_or(0.0, |event| event.velocity);
        }

        let previous_position = if *dsp_state_ptr(state_index + 2) >= 0.5 {
            step as f64 - 0.000_001
        } else if interval_frames >= 1.0 && *dsp_state_ptr(state_index + 6) >= 1.0 {
            step.max(0) as f64
                + ((*dsp_state_ptr(state_index + 6) - 1.0) / interval_frames).clamp(0.0, 0.999_999)
        } else {
            position
        };
        row_events
            .iter()
            .filter(|event| {
                event.active
                    && event.start >= 0.0
                    && event.start < steps as f64
                    && previous_position < event.start
                    && position >= event.start
            })
            .map(|event| event.velocity)
            .sum::<f64>()
            .clamp(0.0, 1.0)
    }
}

// State layout: previous position, previous pulse count, initialized flag,
// zero-separator flag, queue length, then one queued note and velocity per
// Roll row. Note-off streams additionally store the originally triggered note
// for every relative row, preserving Spawn release tags through retuning edits.
// The zero separator makes every queued note a fresh Spawn trigger, even when
// several notes begin or end at precisely the same roll position.
fn render_dsp_roll_note_event(op: DspOp) -> f64 {
    unsafe {
        const NOTE_QUEUE_START: usize = 5;
        const VELOCITY_QUEUE_START: usize = NOTE_QUEUE_START + SEQUENCER_MAX_ROWS as usize;
        const ACTIVE_NOTE_START: usize = VELOCITY_QUEUE_START + SEQUENCER_MAX_ROWS as usize;
        let is_note_off = op.value2 >= 0.5;
        let state_count = if is_note_off {
            ACTIVE_NOTE_START + SEQUENCER_MAX_ROWS as usize
        } else {
            VELOCITY_QUEUE_START + SEQUENCER_MAX_ROWS as usize
        };
        if op.state < 0 || (op.state as usize + state_count) > MAX_DSP_STATE {
            return 0.0;
        }
        if op.a < 0 || (op.a as usize + 7) >= MAX_DSP_STATE {
            return 0.0;
        }

        let source_state = op.a as usize;
        if *dsp_state_ptr(source_state + 4) < 1.0 {
            return 0.0;
        }
        let binding_index = op.value.round().max(0.0) as usize;
        let Some(config) = (*core::ptr::addr_of!(kernel_global!(DSP_SEQUENCER_CONFIGS)))
            .get(binding_index)
            .and_then(|config| config.as_ref())
        else {
            return 0.0;
        };

        let interval_frames = *dsp_state_ptr(source_state + 7);
        let fractional_step = if interval_frames >= 1.0 {
            (*dsp_state_ptr(source_state + 6) / interval_frames).clamp(0.0, 0.999_999)
        } else {
            0.0
        };
        let position = (*dsp_state_ptr(source_state)).round().max(0.0) + fractional_step;
        let pulse_count = (*dsp_state_ptr(source_state + 4)).round().max(0.0);
        let state = op.state as usize;
        let initialized = *dsp_state_ptr(state + 2) >= 0.5;
        let previous_position = if initialized {
            *dsp_state_ptr(state)
        } else {
            -0.000_001
        };
        let previous_pulse_count = *dsp_state_ptr(state + 1);
        let wrapped =
            initialized && pulse_count > previous_pulse_count && position < previous_position;
        let crossed = |boundary: f64| {
            if wrapped {
                (boundary > previous_position && boundary <= config.steps as f64)
                    || boundary <= position
            } else {
                previous_position < boundary && boundary <= position
            }
        };
        let queue_event = |note: f64, velocity: f64| {
            let count = (*dsp_state_ptr(state + 4))
                .round()
                .clamp(0.0, SEQUENCER_MAX_ROWS as f64) as usize;
            if count < SEQUENCER_MAX_ROWS as usize {
                *dsp_state_ptr(state + NOTE_QUEUE_START + count) = note;
                *dsp_state_ptr(state + VELOCITY_QUEUE_START + count) = velocity;
                *dsp_state_ptr(state + 4) = (count + 1) as f64;
            }
        };

        for row in 0..config.rows.min(SEQUENCER_MAX_ROWS as usize) {
            let row_start = row * config.steps;
            let row_events = &config.events[row_start..row_start + config.steps];
            if is_note_off {
                // Release before replacing the retained row note: an old gate
                // ending as a new one begins must release the old Spawn voice.
                for event in row_events
                    .iter()
                    .filter(|event| event.active && crossed(event.end))
                {
                    let captured_note = *dsp_state_ptr(state + ACTIVE_NOTE_START + row);
                    // MIDI note 0 cannot tag a Spawn instance (zero is the
                    // event separator), so zero safely denotes an uncaptured
                    // row after a fresh compile.
                    queue_event(
                        if captured_note > 0.0 {
                            captured_note
                        } else {
                            event.note
                        },
                        event.velocity,
                    );
                    *dsp_state_ptr(state + ACTIVE_NOTE_START + row) = f64::NAN;
                }
                for event in row_events
                    .iter()
                    .filter(|event| event.active && crossed(event.start))
                {
                    *dsp_state_ptr(state + ACTIVE_NOTE_START + row) = event.note;
                }
            } else {
                for event in row_events
                    .iter()
                    .filter(|event| event.active && crossed(event.start))
                {
                    queue_event(event.note, event.velocity);
                }
            }
        }

        *dsp_state_ptr(state) = position;
        *dsp_state_ptr(state + 1) = pulse_count;
        *dsp_state_ptr(state + 2) = 1.0;

        if *dsp_state_ptr(state + 3) >= 0.5 {
            *dsp_state_ptr(state + 3) = 0.0;
            return 0.0;
        }
        let count = (*dsp_state_ptr(state + 4))
            .round()
            .clamp(0.0, SEQUENCER_MAX_ROWS as f64) as usize;
        if count == 0 {
            return 0.0;
        }
        let note = *dsp_state_ptr(state + NOTE_QUEUE_START);
        let velocity = *dsp_state_ptr(state + VELOCITY_QUEUE_START);
        for index in 1..count {
            *dsp_state_ptr(state + NOTE_QUEUE_START + index - 1) =
                *dsp_state_ptr(state + NOTE_QUEUE_START + index);
            *dsp_state_ptr(state + VELOCITY_QUEUE_START + index - 1) =
                *dsp_state_ptr(state + VELOCITY_QUEUE_START + index);
        }
        *dsp_state_ptr(state + 4) = (count - 1) as f64;
        *dsp_state_ptr(state + 3) = 1.0;
        match op.value3.round() as i32 {
            1 => 440.0 * 2.0_f64.powf((note - 69.0) / 12.0),
            2 => velocity,
            _ => note,
        }
    }
}

fn render_dsp_button(op: DspOp) -> f64 {
    unsafe {
        if op.state < 0 || (op.state as usize + 2) >= MAX_DSP_STATE {
            return if dsp_value_target(op.a) >= ENVELOPE_TRIGGER_THRESHOLD {
                1.0
            } else {
                0.0
            };
        }

        let state_index = op.state as usize;
        let pressed = dsp_value_target(op.a) >= ENVELOPE_TRIGGER_THRESHOLD;
        let mode = dsp_value_target(op.b).round() as i32;
        let clicks = dsp_value_target(op.c).round();
        let initialized = *dsp_state_ptr(state_index + 2) >= 0.5;
        let previous_clicks = if initialized {
            (*dsp_state_ptr(state_index + 1)).round()
        } else {
            clicks
        };

        let output = if mode == 1 {
            if initialized && (clicks - previous_clicks).abs() >= 0.5 {
                1.0
            } else {
                0.0
            }
        } else if pressed {
            1.0
        } else {
            0.0
        };

        *dsp_state_ptr(state_index) = if pressed { 1.0 } else { 0.0 };
        *dsp_state_ptr(state_index + 1) = clicks;
        *dsp_state_ptr(state_index + 2) = 1.0;
        output
    }
}

fn render_dsp_end_trigger(op: DspOp) -> f64 {
    unsafe {
        if op.state < 0 || op.a < 0 {
            return 0.0;
        }
        let state_index = op.state as usize;
        let source_index = op.a as usize;
        let is_custom_wave = op.value >= 0.5;

        if !is_custom_wave {
            if state_index >= MAX_DSP_STATE || source_index + 2 >= MAX_DSP_STATE {
                return 0.0;
            }
            let active = *dsp_state_ptr(state_index) >= 0.5;
            let envelope_stage = (*dsp_state_ptr(source_index + 2)).round() as i32;
            let ended = active && envelope_stage == 0;
            *dsp_state_ptr(state_index) = if envelope_stage != 0 { 1.0 } else { 0.0 };
            return if ended { 1.0 } else { 0.0 };
        }

        if state_index + 4 >= MAX_DSP_STATE
            || source_index + 3 >= MAX_DSP_STATE
            || op.b < 0
            || op.b as usize >= MAX_NODES
        {
            return 0.0;
        }

        let node = kernel_global!(NODES)[op.b as usize];
        let phase = (*dsp_state_ptr(source_index)).clamp(0.0, 1.0);
        let reset = *dsp_state_ptr(source_index + 1) >= ENVELOPE_TRIGGER_THRESHOLD;
        let direction = *dsp_state_ptr(source_index + 2);
        let done = *dsp_state_ptr(source_index + 3) >= 0.5;
        let previous_phase = (*dsp_state_ptr(state_index)).clamp(0.0, 1.0);
        let previous_direction = *dsp_state_ptr(state_index + 1);
        let previous_done = *dsp_state_ptr(state_index + 2) >= 0.5;
        let previous_reset = *dsp_state_ptr(state_index + 3) >= 0.5;
        let initialized = *dsp_state_ptr(state_index + 4) >= 0.5;
        let reset_edge = reset && !previous_reset;

        let ended = if reset_edge {
            false
        } else {
            match node.custom_mode {
                CUSTOM_MODE_ONCE => done && (!initialized || !previous_done),
                CUSTOM_MODE_PING_PONG | CUSTOM_MODE_SUSTAIN_PING_PONG => {
                    initialized && previous_direction < 0.0 && direction >= 0.0
                }
                CUSTOM_MODE_SUSTAIN => {
                    let sustain_start = node.custom_sustain_start.clamp(0.0, 0.999);
                    phase >= sustain_start && (!initialized || previous_phase < sustain_start)
                }
                CUSTOM_MODE_LOOP | CUSTOM_MODE_SUSTAIN_LOOP => {
                    initialized && phase < previous_phase
                }
                _ => false,
            }
        };

        *dsp_state_ptr(state_index) = phase;
        *dsp_state_ptr(state_index + 1) = direction;
        *dsp_state_ptr(state_index + 2) = if done { 1.0 } else { 0.0 };
        *dsp_state_ptr(state_index + 3) = if reset { 1.0 } else { 0.0 };
        *dsp_state_ptr(state_index + 4) = 1.0;
        if ended {
            1.0
        } else {
            0.0
        }
    }
}

fn render_dsp_phase_oscillator_output(
    op: DspOp,
    render_phase: f64,
    state_index: Option<usize>,
    frame: usize,
    node_context: Option<DspNodeContext>,
    mut local_state: Option<&mut u32>,
) -> f64 {
    unsafe {
        match op.a {
            6 => dsp_random_bipolar(local_state),
            7 => {
                if let Some(index) = state_index {
                    if index + 2 < MAX_DSP_STATE {
                        if *node_state_ptr(node_context, index + 1) == 0.0
                            && *node_state_ptr(node_context, index + 2) == 0.0
                            && render_phase == 0.0
                        {
                            *node_state_ptr(node_context, index + 1) =
                                dsp_random_bipolar(local_state.as_deref_mut());
                            *node_state_ptr(node_context, index + 2) =
                                dsp_random_bipolar(local_state);
                        }
                        let current = *node_state_ptr(node_context, index + 1);
                        let next = *node_state_ptr(node_context, index + 2);
                        current + (next - current) * smooth_step(render_phase)
                    } else {
                        0.0
                    }
                } else {
                    0.0
                }
            }
            9 => {
                let node_index = op.value.round() as i32;
                if node_index >= 0 && (node_index as usize) < MAX_NODES {
                    let endpoint = node_reg(node_context, op.c).clamp(-1.0, 1.0);
                    custom_wave_value_with_endpoint(
                        node_index as usize,
                        render_phase,
                        frame,
                        Some(endpoint),
                    )
                } else {
                    0.0
                }
            }
            4 => dsp_oscillator(op.a, render_phase, node_reg(node_context, op.value as i32)),
            12 => dsp_kink_oscillator(
                render_phase,
                node_reg(node_context, op.value as i32),
                node_reg(node_context, op.c),
            ),
            _ => dsp_oscillator(op.a, render_phase, 0.5),
        }
    }
}

#[inline(always)]
unsafe fn map_dsp_oscillator_range(
    op: DspOp,
    output: f64,
    node_context: Option<DspNodeContext>,
) -> f64 {
    if op.value4 < 0.5 {
        return output;
    }
    let range_min_register = op.value2.round() as i32;
    let range_max_register = op.value3.round() as i32;
    let range_min = node_reg(node_context, range_min_register);
    let range_max = node_reg(node_context, range_max_register);
    range_min + (output + 1.0) * 0.5 * (range_max - range_min)
}

fn render_dsp_slew(op: DspOp, sample_rate: f64) -> f64 {
    unsafe {
        let target = dsp_reg(op.a);
        if op.state < 0 || op.state as usize >= MAX_DSP_STATE {
            return target;
        }

        let state_index = op.state as usize;
        let seconds = op.value.max(0.0);
        let initialize_from_target = op.value2 >= 0.5 && state_index + 1 < MAX_DSP_STATE;
        if initialize_from_target && *dsp_state_ptr(state_index + 1) < 0.5 {
            *dsp_state_ptr(state_index) = sanitize_control_value(target);
            *dsp_state_ptr(state_index + 1) = 1.0;
            if op.value3 >= 0.5 && state_index + 3 < MAX_DSP_STATE {
                *dsp_state_ptr(state_index + 2) = sanitize_control_value(target);
                *dsp_state_ptr(state_index + 3) = 0.0;
            }
            return sanitize_control_value(target);
        }

        if op.value3 >= 0.5 && state_index + 3 < MAX_DSP_STATE {
            let mut current = *dsp_state_ptr(state_index);
            if !current.is_finite() {
                current = 0.0;
            }
            let previous_target = *dsp_state_ptr(state_index + 2);
            if (target - previous_target).abs() > f64::EPSILON {
                let seconds = dsp_reg(op.b).max(0.0);
                if previous_target > 0.0 && target > 0.0 && seconds > 0.0 && sample_rate > 0.0 {
                    *dsp_state_ptr(state_index + 3) =
                        (target - current).abs() / (seconds * sample_rate.max(1.0));
                } else {
                    current = target;
                    *dsp_state_ptr(state_index) = sanitize_control_value(current);
                    *dsp_state_ptr(state_index + 3) = 0.0;
                }
                *dsp_state_ptr(state_index + 2) = sanitize_control_value(target);
            }

            let step = *dsp_state_ptr(state_index + 3);
            let delta = target - current;
            current = if delta.abs() <= step {
                target
            } else if step > 0.0 {
                current + step.copysign(delta)
            } else {
                target
            };
            *dsp_state_ptr(state_index) = sanitize_control_value(current);
            return sanitize_control_value(current);
        }

        if seconds <= 0.0 || sample_rate <= 0.0 {
            *dsp_state_ptr(state_index) = sanitize_control_value(target);
            return target;
        }

        let mut current = *dsp_state_ptr(state_index);
        if !current.is_finite() {
            current = 0.0;
        }

        let delta = target - current;
        let step = 1.0 / (seconds * sample_rate.max(1.0));
        current = if delta.abs() <= step {
            target
        } else {
            current + step.copysign(delta)
        };

        *dsp_state_ptr(state_index) = sanitize_control_value(current);
        *dsp_state_ptr(state_index)
    }
}

fn render_dsp_op<const REPEAT: bool>(
    op: DspOp,
    frame: usize,
    sample_rate: f64,
    left_sample: &mut f64,
    right_sample: &mut f64,
    node_context: Option<DspNodeContext>,
    mut repeated_resources: Option<&mut DspRepeatResourceState>,
) {
    let regs = unsafe {
        if REPEAT {
            node_context.unwrap().regs
        } else {
            dsp_regs_ptr()
        }
    };
    let dsp_reg = |index: i32| unsafe {
        if index < 0 || index as usize >= MAX_DSP_REGS {
            0.0
        } else {
            *regs.add(index as usize)
        }
    };
    let dsp_reg_unchecked = |index: i32| unsafe { *regs.add(index as usize) };
    let dsp_regs_ptr = || regs;
    let dsp_state_ptr = |index| unsafe {
        if REPEAT {
            node_context.unwrap().state_ptr(index)
        } else {
            dsp_state_ptr(index)
        }
    };
    let set_dsp_reg = |index: i32, value| unsafe {
        if index >= 0 && (index as usize) < MAX_DSP_REGS {
            *regs.add(index as usize) = sanitize_dsp_register(value);
        }
    };
    let set_dsp_reg_unchecked = |index: i32, value| unsafe {
        *regs.add(index as usize) = value;
    };
    let set_dsp_reg_sanitized_unchecked = |index: i32, value| unsafe {
        *regs.add(index as usize) = sanitize_dsp_register(value);
    };
    let _ = op.value;
    match op.opcode {
        DSP_OP_CACHED_CONTROL => unsafe {
            let cache_index = op.state as usize;
            let mut cache = kernel_global!(DSP_CONTROL_CACHES)[cache_index];
            let mut unchanged = cache.initialized
                && kernel_global!(DSP_REGS)[op.out as usize].to_bits() == cache.output.to_bits();
            for input in 0..cache.count as usize {
                let current = kernel_global!(DSP_REGS)[cache.inputs[input] as usize];
                unchanged &= current.to_bits() == cache.previous[input].to_bits();
                cache.previous[input] = current;
            }
            if !unchanged {
                let original = DspOp {
                    opcode: cache.opcode,
                    state: -1,
                    ..op
                };
                render_dsp_op::<false>(
                    original,
                    frame,
                    sample_rate,
                    left_sample,
                    right_sample,
                    None,
                    None,
                );
                cache.output = kernel_global!(DSP_REGS)[op.out as usize];
                cache.initialized = true;
            }
            kernel_global!(DSP_CONTROL_CACHES)[cache_index] = cache;
        },
        DSP_OP_VALUE => unsafe {
            let value = if op.value >= DSP_VALUE_MODE_IMMEDIATE {
                dsp_value_target_unchecked(op.a)
            } else {
                dsp_value_unchecked(op.a)
            };
            set_dsp_reg_sanitized_unchecked(op.out, value);
        },
        DSP_OP_ADD => unsafe {
            let regs = dsp_regs_ptr();
            let value = *regs.add(op.a as usize) + *regs.add(op.b as usize);
            *regs.add(op.out as usize) = sanitize_dsp_register(value);
        },
        DSP_OP_MUL => unsafe {
            let regs = dsp_regs_ptr();
            let value = *regs.add(op.a as usize) * *regs.add(op.b as usize);
            *regs.add(op.out as usize) = sanitize_dsp_register(value);
        },
        DSP_OP_SUB => unsafe {
            let regs = dsp_regs_ptr();
            let value = *regs.add(op.a as usize) - *regs.add(op.b as usize);
            *regs.add(op.out as usize) = sanitize_dsp_register(value);
        },
        DSP_OP_DIV => {
            let regs = dsp_regs_ptr();
            let denominator = unsafe { *regs.add(op.b as usize) };
            let output = if denominator.abs() <= 0.000001 {
                0.0
            } else {
                (unsafe { *regs.add(op.a as usize) }) / denominator
            };
            unsafe { *regs.add(op.out as usize) = sanitize_dsp_register(output) };
        }
        DSP_OP_NEG => unsafe {
            let regs = dsp_regs_ptr();
            *regs.add(op.out as usize) = -*regs.add(op.a as usize);
        },
        DSP_OP_BEND => {
            let exponent = dsp_reg_unchecked(op.a).clamp(-32.0, 32.0);
            set_dsp_reg_sanitized_unchecked(op.out, 2.0_f64.powf(exponent));
        }
        DSP_OP_OSC => unsafe {
            let frequency = if op.b >= 0 {
                dsp_reg_unchecked(op.b).max(0.0)
            } else {
                0.0
            };
            let state_index = if op.state >= 0 && (op.state as usize) < MAX_DSP_STATE {
                Some(op.state as usize)
            } else {
                None
            };
            if op.a >= 0 && op.a <= 4 && op.d < 0 && op.e < 0 {
                let index = op.state as usize;
                let phase_state = dsp_state_ptr(index);
                let phase = *phase_state;
                let pulse_width = if op.a == 4 {
                    dsp_reg_unchecked(op.value as i32)
                } else {
                    0.5
                };
                let output = map_dsp_oscillator_range(
                    op,
                    dsp_oscillator(op.a, phase, pulse_width),
                    node_context,
                );
                set_dsp_reg_unchecked(op.out, output);
                *phase_state = normalize_phase(phase + frequency / sample_rate.max(1.0));
                return;
            }
            let mut phase = state_index
                .map(|index| *dsp_state_ptr(index))
                .unwrap_or(0.0);
            let mut phase_reset_fade_started = false;
            if op.a != 5 && op.a != 7 && op.e >= 0 {
                if let Some(index) = state_index {
                    if index + 1 < MAX_DSP_STATE && op.e >= 0 {
                        let reset_trigger = dsp_reg_unchecked(op.e) >= ENVELOPE_TRIGGER_THRESHOLD;
                        let previous_reset_trigger =
                            *dsp_state_ptr(index + 1) >= ENVELOPE_TRIGGER_THRESHOLD;
                        if reset_trigger && !previous_reset_trigger {
                            let reset_fade_index = if op.a == 9 { index + 4 } else { index + 2 };
                            if reset_fade_index + 1 < MAX_DSP_STATE {
                                let previous_render_phase = if op.d >= 0 {
                                    phase + dsp_reg_unchecked(op.d)
                                } else {
                                    phase
                                };
                                *dsp_state_ptr(reset_fade_index) =
                                    render_dsp_phase_oscillator_output(
                                        op,
                                        previous_render_phase,
                                        state_index,
                                        frame,
                                        node_context,
                                        repeated_resources
                                            .as_deref_mut()
                                            .map(|resources| &mut resources.random_state),
                                    );
                                *dsp_state_ptr(reset_fade_index + 1) = 0.0;
                                phase_reset_fade_started = true;
                            }
                            phase = 0.0;
                            *dsp_state_ptr(index) = 0.0;
                            if op.a == 9 && index + 3 < MAX_DSP_STATE {
                                *dsp_state_ptr(index + 2) = 1.0;
                                *dsp_state_ptr(index + 3) = 0.0;
                            }
                        }
                        *dsp_state_ptr(index + 1) = if reset_trigger { 1.0 } else { 0.0 };
                    }
                }
            }
            let render_phase = if op.a != 5 && op.a != 7 && op.d >= 0 {
                phase + dsp_reg_unchecked(op.d)
            } else {
                phase
            };
            let custom_wave_is_done = op.a == 9
                && state_index
                    .map(|index| index + 3 < MAX_DSP_STATE && *dsp_state_ptr(index + 3) >= 0.5)
                    .unwrap_or(false);
            let mut output = if custom_wave_is_done {
                dsp_reg_unchecked(op.c).clamp(-1.0, 1.0)
            } else {
                match op.a {
                    5 => {
                        if let Some(index) = state_index {
                            if index + 2 < MAX_DSP_STATE && *dsp_state_ptr(index + 2) == 0.0 {
                                *dsp_state_ptr(index + 1) = dsp_sample_hold_value(
                                    op.c,
                                    repeated_resources
                                        .as_deref_mut()
                                        .map(|resources| &mut resources.random_state),
                                );
                                *dsp_state_ptr(index + 2) = 1.0;
                            }
                            let trigger = if op.d >= 0 {
                                dsp_reg_unchecked(op.d) >= ENVELOPE_TRIGGER_THRESHOLD
                            } else {
                                false
                            };
                            let previous_trigger =
                                *dsp_state_ptr(index) >= ENVELOPE_TRIGGER_THRESHOLD;
                            if trigger && !previous_trigger {
                                *dsp_state_ptr(index + 1) = dsp_sample_hold_value(
                                    op.c,
                                    repeated_resources
                                        .as_deref_mut()
                                        .map(|resources| &mut resources.random_state),
                                );
                            }
                            *dsp_state_ptr(index) = if trigger { 1.0 } else { 0.0 };
                            if index + 1 < MAX_DSP_STATE {
                                *dsp_state_ptr(index + 1)
                            } else {
                                0.0
                            }
                        } else {
                            0.0
                        }
                    }
                    _ => render_dsp_phase_oscillator_output(
                        op,
                        render_phase,
                        state_index,
                        frame,
                        node_context,
                        repeated_resources
                            .as_deref_mut()
                            .map(|resources| &mut resources.random_state),
                    ),
                }
            };
            if op.a != 5 && op.a != 7 && op.e >= 0 {
                if let Some(index) = state_index {
                    let reset_fade_index = if op.a == 9 { index + 4 } else { index + 2 };
                    if reset_fade_index + 1 < MAX_DSP_STATE {
                        let fade_age = (*dsp_state_ptr(reset_fade_index + 1)).max(0.0);
                        if phase_reset_fade_started
                            || (fade_age > 0.0 && fade_age < PHASE_RESET_FADE_SECONDS)
                        {
                            let mix = smooth_step(fade_age / PHASE_RESET_FADE_SECONDS);
                            let previous_output = *dsp_state_ptr(reset_fade_index);
                            output = previous_output + (output - previous_output) * mix;
                            *dsp_state_ptr(reset_fade_index + 1) =
                                fade_age + 1.0 / sample_rate.max(1.0);
                        }
                    }
                }
            }
            output = map_dsp_oscillator_range(op, output, node_context);
            set_dsp_reg_unchecked(op.out, output);
            if let Some(index) = state_index {
                let next_phase = phase + frequency / sample_rate.max(1.0);
                if op.a == 7 && next_phase >= 1.0 && index + 2 < MAX_DSP_STATE {
                    *dsp_state_ptr(index + 1) = *dsp_state_ptr(index + 2);
                    *dsp_state_ptr(index + 2) = dsp_random_bipolar(
                        repeated_resources
                            .as_deref_mut()
                            .map(|resources| &mut resources.random_state),
                    );
                }
                if op.a == 9 && index + 3 < MAX_DSP_STATE {
                    let node_index = op.value.round() as i32;
                    if node_index >= 0 && (node_index as usize) < MAX_NODES {
                        let node = kernel_global!(NODES)[node_index as usize];
                        let start = node.custom_sustain_start.clamp(0.0, 0.999);
                        let end = node.custom_sustain_end.clamp(start + 0.001, 1.0);
                        let length = (end - start).max(0.001);
                        let mut direction = if *dsp_state_ptr(index + 2) == 0.0 {
                            1.0
                        } else {
                            *dsp_state_ptr(index + 2)
                        };
                        let mut custom_next = next_phase;
                        let mut done = *dsp_state_ptr(index + 3) >= 0.5;

                        if done {
                            custom_next = phase;
                        } else {
                            match node.custom_mode {
                                CUSTOM_MODE_PING_PONG => {
                                    custom_next =
                                        phase + (frequency / sample_rate.max(1.0)) * direction;
                                    if custom_next >= 1.0 {
                                        custom_next = 1.0 - (custom_next - 1.0);
                                        direction = -1.0;
                                    } else if custom_next <= 0.0 {
                                        custom_next = -custom_next;
                                        direction = 1.0;
                                    }
                                }
                                CUSTOM_MODE_ONCE => {
                                    if custom_next >= 1.0 {
                                        custom_next = 1.0;
                                        done = true;
                                    }
                                }
                                CUSTOM_MODE_SUSTAIN => {
                                    if custom_next >= start {
                                        custom_next = start;
                                    }
                                }
                                CUSTOM_MODE_SUSTAIN_LOOP => {
                                    if custom_next >= start {
                                        custom_next = start
                                            + (((custom_next - start) % length) + length) % length;
                                    }
                                }
                                CUSTOM_MODE_SUSTAIN_PING_PONG => {
                                    custom_next =
                                        phase + (frequency / sample_rate.max(1.0)) * direction;
                                    if custom_next >= end {
                                        custom_next = end - (custom_next - end);
                                        direction = -1.0;
                                    } else if custom_next <= start && phase >= start {
                                        custom_next = start + (start - custom_next);
                                        direction = 1.0;
                                    } else if custom_next >= start && phase < start {
                                        direction = 1.0;
                                    }
                                }
                                _ => {
                                    custom_next = normalize_phase(custom_next);
                                }
                            }
                        }

                        *dsp_state_ptr(index) = custom_next.clamp(0.0, 1.0);
                        *dsp_state_ptr(index + 2) = direction;
                        *dsp_state_ptr(index + 3) = if done { 1.0 } else { 0.0 };
                    } else {
                        *dsp_state_ptr(index) = normalize_phase(next_phase);
                    }
                } else if op.a != 5 {
                    *dsp_state_ptr(index) = normalize_phase(next_phase);
                }
            }
        },
        DSP_OP_INPUT => unsafe {
            let frame = frame.min(MAX_WASM_FRAMES - 1);
            let selector = if kernel_global!(DSP_STEREO_INPUT_ENABLED) {
                op.b
            } else {
                -1
            };
            let input = match selector {
                0 => kernel_global!(INPUT_LEFT)[frame],
                1 => kernel_global!(INPUT_RIGHT)[frame],
                _ => kernel_global!(INPUT)[frame],
            } as f64;
            set_dsp_reg(op.out, input * dsp_reg(op.a));
        },
        DSP_OP_FILTER => set_dsp_reg(op.out, render_dsp_filter(op, sample_rate)),
        DSP_OP_DC_BLOCK => set_dsp_reg(op.out, render_dsp_dc_block(op, sample_rate)),
        DSP_OP_OUTPUT => {
            let sample = sanitize_sample(dsp_reg(op.a), 8.0);
            if op.b == 0 {
                *left_sample = sanitize_sample(*left_sample + sample, 8.0);
            } else if op.b == 1 {
                *right_sample = sanitize_sample(*right_sample + sample, 8.0);
            }
        }
        DSP_OP_ABS => unsafe {
            let regs = dsp_regs_ptr();
            *regs.add(op.out as usize) = (*regs.add(op.a as usize)).abs();
        },
        DSP_OP_MAP => {
            let source = dsp_reg(op.a);
            let src_min = dsp_reg(op.b);
            let src_max = dsp_reg(op.c);
            let target_min = dsp_reg(op.d);
            let target_max = dsp_reg(op.e);
            let denominator = (src_max - src_min)
                .abs()
                .max(0.000001)
                .copysign(src_max - src_min);
            let mapped =
                target_min + ((source - src_min) / denominator) * (target_max - target_min);
            set_dsp_reg(op.out, mapped);
        }
        DSP_OP_FEEDBACK_READ => unsafe {
            let value = if op.state >= 0 && (op.state as usize) < MAX_DSP_STATE {
                *dsp_state_ptr(op.state as usize)
            } else {
                0.0
            };
            set_dsp_reg(op.out, value);
        },
        DSP_OP_FEEDBACK_WRITE => unsafe {
            if op.state >= 0 && (op.state as usize) < MAX_DSP_STATE {
                *dsp_state_ptr(op.state as usize) = sanitize_control_value(dsp_reg(op.a));
            }
        },
        DSP_OP_SELECT => set_dsp_reg(op.out, render_dsp_selector(op, sample_rate)),
        DSP_OP_DELAY => set_dsp_reg(op.out, render_dsp_delay(op, sample_rate)),
        DSP_OP_CHORUS => set_dsp_reg(op.out, render_dsp_chorus(op, sample_rate)),
        DSP_OP_REVERB => set_dsp_reg(op.out, render_dsp_reverb(op, sample_rate)),
        DSP_OP_FOLD => {
            let sample = dsp_reg(op.a);
            let amount = dsp_reg(op.b).max(0.0);
            set_dsp_reg(op.out, fold_sample(sample, 1.0 + amount * 3.0));
        }
        DSP_OP_ENVELOPE => set_dsp_reg(
            op.out,
            render_dsp_envelope::<REPEAT>(op, sample_rate, node_context),
        ),
        DSP_OP_FOLLOWER => set_dsp_reg(op.out, render_dsp_follower(op, sample_rate)),
        DSP_OP_HARD_CLIP => {
            let drive = dsp_reg(op.b).max(0.0);
            set_dsp_reg(op.out, (dsp_reg(op.a) * drive).clamp(-1.0, 1.0));
        }
        DSP_OP_SOFT_CLIP => {
            let drive = dsp_reg(op.b).max(0.0);
            set_dsp_reg(op.out, (dsp_reg(op.a) * drive).tanh());
        }
        DSP_OP_DISTORTION => set_dsp_reg(
            op.out,
            render_dsp_distortion(
                op,
                repeated_resources
                    .as_deref_mut()
                    .map(|resources| &mut resources.random_state),
            ),
        ),
        DSP_OP_SAMPLE_PARAM => render_dsp_sample_param(op, repeated_resources.as_deref_mut()),
        DSP_OP_SAMPLE => {
            let repeated_sample = repeated_resources
                .as_deref_mut()
                .and_then(|resources| resources.sample_mut(op.a.max(0) as usize));
            set_dsp_reg(
                op.out,
                render_dsp_sample(op, frame, sample_rate, repeated_sample, op.value2 >= 0.5),
            );
        }
        DSP_OP_FUNCTION => set_dsp_reg(op.out, render_dsp_function(op)),
        DSP_OP_MIDI_NOTE => set_dsp_reg(op.out, render_dsp_midi_note(op)),
        DSP_OP_MIDI_CC => set_dsp_reg(op.out, render_dsp_midi_cc(op)),
        DSP_OP_MIDI_NOTE_SEND => render_dsp_midi_note_send(op),
        DSP_OP_MIDI_CC_SEND => render_dsp_midi_cc_send(op, sample_rate),
        DSP_OP_TEMPO => set_dsp_reg(op.out, render_dsp_tempo(op, frame, sample_rate)),
        DSP_OP_ACCUMULATOR => set_dsp_reg(op.out, render_dsp_accumulator(op)),
        DSP_OP_RANDOM => set_dsp_reg(
            op.out,
            render_dsp_random(
                op,
                repeated_resources
                    .as_deref_mut()
                    .map(|resources| &mut resources.random_state),
            ),
        ),
        DSP_OP_SEQUENCER => set_dsp_reg(op.out, render_dsp_sequencer(op, frame)),
        DSP_OP_ROLL_NOTE_EVENT => set_dsp_reg(op.out, render_dsp_roll_note_event(op)),
        DSP_OP_BUTTON => set_dsp_reg(op.out, render_dsp_button(op)),
        DSP_OP_END_TRIGGER => set_dsp_reg(op.out, render_dsp_end_trigger(op)),
        DSP_OP_SLEW => set_dsp_reg(op.out, render_dsp_slew(op, sample_rate)),
        DSP_OP_PLAYHEAD => set_dsp_reg(op.out, render_dsp_playhead(op, sample_rate)),
        DSP_OP_TIME => set_dsp_reg(op.out, render_dsp_time(op, sample_rate)),
        DSP_OP_COMPRESS => set_dsp_reg(op.out, render_dsp_compressor(op, sample_rate)),
        DSP_OP_LIMITER => set_dsp_reg(op.out, render_dsp_limiter(op, sample_rate)),
        DSP_OP_QUANTISE => set_dsp_reg(
            op.out,
            quantise_frequency_signal(dsp_reg(op.a), dsp_reg(op.b), dsp_reg(op.c)),
        ),
        DSP_OP_BLOCK_LATCH => unsafe {
            if op.state >= 0 && (op.state as usize) < MAX_DSP_STATE {
                let state = op.state as usize;
                if frame == 0 {
                    *dsp_state_ptr(state) = sanitize_control_value(dsp_reg(op.a)).floor().max(0.0);
                }
                set_dsp_reg(op.out, *dsp_state_ptr(state));
            } else {
                set_dsp_reg(op.out, sanitize_control_value(dsp_reg(op.a)));
            }
        },
        DSP_OP_SPREAD_INDEX => unsafe {
            #[cfg(feature = "parallel")]
            let item = {
                node_context.map_or(kernel_global!(DSP_SPREAD_ITEM_INDEX), |context| {
                    context.item
                })
            };
            #[cfg(not(feature = "parallel"))]
            let item = kernel_global!(DSP_SPREAD_ITEM_INDEX);
            set_dsp_reg(op.out, (item + 1) as f64);
        },
        DSP_OP_SPAWN_INSTANCE_GATE => unsafe {
            #[cfg(feature = "parallel")]
            let gate = {
                node_context.map_or(kernel_global!(DSP_SPAWN_INSTANCE_GATE), |context| {
                    context.gate
                })
            };
            #[cfg(not(feature = "parallel"))]
            let gate = kernel_global!(DSP_SPAWN_INSTANCE_GATE);
            set_dsp_reg(op.out, gate);
        },
        DSP_OP_SPREAD_COLLECT => {
            let current = dsp_reg(op.out);
            let item = dsp_reg(op.a);
            set_dsp_reg(
                op.out,
                if op.b == 1 {
                    current * item
                } else {
                    current + item
                },
            );
        }
        DSP_OP_SPREAD_BEGIN | DSP_OP_SPREAD_END | DSP_OP_SPAWN_BEGIN | DSP_OP_SPAWN_END => {}
        DSP_OP_BUFFER => set_dsp_reg(op.out, render_dsp_buffer(op, sample_rate)),
        DSP_OP_IMAGE => set_dsp_reg(op.out, render_dsp_image(op)),
        _ => {}
    }
}

fn quantise_midi_note(note: f64, scale_value: f64, root_value: f64) -> f64 {
    if !note.is_finite() {
        return 0.0;
    }

    const CHROMATIC: &[i32] = &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const MAJOR: &[i32] = &[0, 2, 4, 5, 7, 9, 11];
    const MINOR: &[i32] = &[0, 2, 3, 5, 7, 8, 10];
    const HARMONIC_MINOR: &[i32] = &[0, 2, 3, 5, 7, 8, 11];
    const MELODIC_MINOR: &[i32] = &[0, 2, 3, 5, 7, 9, 11];
    const MAJOR_PENTATONIC: &[i32] = &[0, 2, 4, 7, 9];
    const MINOR_PENTATONIC: &[i32] = &[0, 3, 5, 7, 10];
    const BLUES: &[i32] = &[0, 3, 5, 6, 7, 10];
    const DORIAN: &[i32] = &[0, 2, 3, 5, 7, 9, 10];
    const PHRYGIAN: &[i32] = &[0, 1, 3, 5, 7, 8, 10];
    const LYDIAN: &[i32] = &[0, 2, 4, 6, 7, 9, 11];
    const MIXOLYDIAN: &[i32] = &[0, 2, 4, 5, 7, 9, 10];
    const LOCRIAN: &[i32] = &[0, 1, 3, 5, 6, 8, 10];
    const WHOLE_TONE: &[i32] = &[0, 2, 4, 6, 8, 10];
    const DIMINISHED_WHOLE_HALF: &[i32] = &[0, 2, 3, 5, 6, 8, 9, 11];
    const DIMINISHED_HALF_WHOLE: &[i32] = &[0, 1, 3, 4, 6, 7, 9, 10];

    let scale = match scale_value.round().clamp(0.0, 15.0) as i32 {
        1 => MAJOR,
        2 => MINOR,
        3 => HARMONIC_MINOR,
        4 => MELODIC_MINOR,
        5 => MAJOR_PENTATONIC,
        6 => MINOR_PENTATONIC,
        7 => BLUES,
        8 => DORIAN,
        9 => PHRYGIAN,
        10 => LYDIAN,
        11 => MIXOLYDIAN,
        12 => LOCRIAN,
        13 => WHOLE_TONE,
        14 => DIMINISHED_WHOLE_HALF,
        15 => DIMINISHED_HALF_WHOLE,
        _ => CHROMATIC,
    };
    // Root is a pitch class, not an octave-specific MIDI note. Remapping old
    // saved MIDI-note roots through modulo 12 preserves their musical key.
    let root = if root_value.is_finite() {
        root_value.round().rem_euclid(12.0)
    } else {
        0.0
    };
    let relative = note - root;
    let centre_octave = (relative / 12.0).floor() as i32;
    let mut nearest = root;
    let mut nearest_distance = f64::INFINITY;

    for octave in (centre_octave - 1)..=(centre_octave + 1) {
        for semitone in scale {
            let candidate = root + (octave * 12 + semitone) as f64;
            let distance = (candidate - note).abs();
            if distance < nearest_distance
                || ((distance - nearest_distance).abs() <= f64::EPSILON && candidate > nearest)
            {
                nearest = candidate;
                nearest_distance = distance;
            }
        }
    }
    nearest
}

fn quantise_frequency_signal(frequency: f64, scale_value: f64, root_value: f64) -> f64 {
    if !frequency.is_finite() || frequency == 0.0 {
        return 0.0;
    }

    let direction = frequency.signum();
    let midi_note = 69.0 + 12.0 * (frequency.abs() / 440.0).log2();
    let quantised_note = quantise_midi_note(midi_note, scale_value, root_value);
    direction * 440.0 * 2.0_f64.powf((quantised_note - 69.0) / 12.0)
}

#[cfg(test)]
mod quantise_tests {
    use super::quantise_frequency_signal;

    fn frequency_for_midi_note(note: f64) -> f64 {
        440.0 * 2.0_f64.powf((note - 69.0) / 12.0)
    }

    fn assert_near(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 0.000001,
            "{actual} != {expected}"
        );
    }

    #[test]
    fn chromatic_rounds_to_the_nearest_semitone_and_breaks_ties_upward() {
        assert_near(
            quantise_frequency_signal(frequency_for_midi_note(60.49), 0.0, 60.0),
            frequency_for_midi_note(60.0),
        );
        assert_near(
            quantise_frequency_signal(frequency_for_midi_note(60.5), 0.0, 60.0),
            frequency_for_midi_note(61.0),
        );
    }

    #[test]
    fn major_scale_uses_the_selected_root_across_octaves() {
        assert_near(
            quantise_frequency_signal(frequency_for_midi_note(55.0), 1.0, 54.0),
            frequency_for_midi_note(56.0),
        );
        assert_near(
            quantise_frequency_signal(frequency_for_midi_note(67.0), 1.0, 54.0),
            frequency_for_midi_note(68.0),
        );
    }

    #[test]
    fn minor_scale_snaps_frequency_and_preserves_reverse_direction() {
        assert_near(
            quantise_frequency_signal(-frequency_for_midi_note(55.8), 2.0, 57.0),
            -frequency_for_midi_note(55.0),
        );
    }
}

fn capture_dsp_scopes() {
    unsafe {
        for slot in 0..kernel_global!(DSP_SCOPE_SLOT_COUNT) {
            let register = kernel_global!(DSP_SCOPE_REGS)[slot];
            if register < 0 || register as usize >= MAX_DSP_REGS {
                continue;
            }

            kernel_global!(DSP_SCOPE_DECIMATE_COUNTERS)[slot] =
                kernel_global!(DSP_SCOPE_DECIMATE_COUNTERS)[slot].saturating_add(1);
            if kernel_global!(DSP_SCOPE_DECIMATE_COUNTERS)[slot]
                < kernel_global!(DSP_SCOPE_DECIMATE)[slot]
            {
                continue;
            }
            kernel_global!(DSP_SCOPE_DECIMATE_COUNTERS)[slot] = 0;

            let active_points =
                kernel_global!(DSP_SCOPE_POINTS_ACTIVE)[slot].clamp(32, LINK_SCOPE_POINTS);
            let write_index =
                (kernel_global!(DSP_SCOPE_WRITE_INDICES)[slot] as usize).min(active_points - 1);
            kernel_global!(DSP_SCOPE_SAMPLES)[slot][write_index] =
                sanitize_control_value(kernel_global!(DSP_REGS)[register as usize]) as f32;
            kernel_global!(DSP_SCOPE_WRITE_INDICES)[slot] =
                ((write_index + 1) % active_points) as u32;
            if (kernel_global!(DSP_SCOPE_COUNTS)[slot] as usize) < active_points {
                kernel_global!(DSP_SCOPE_COUNTS)[slot] =
                    kernel_global!(DSP_SCOPE_COUNTS)[slot].saturating_add(1);
            }
        }
    }
}

fn capture_dsp_meters() {
    unsafe {
        for slot in 0..kernel_global!(DSP_METER_SLOT_COUNT) {
            let register = kernel_global!(DSP_METER_REGS)[slot];
            if register < 0 || register as usize >= MAX_DSP_REGS {
                continue;
            }
            let value = kernel_global!(DSP_REGS)[register as usize];
            kernel_global!(DSP_METER_SUMS)[slot] += value.abs();
            kernel_global!(DSP_METER_SIGNED_SUMS)[slot] += value;
            kernel_global!(DSP_METER_COUNTS)[slot] =
                kernel_global!(DSP_METER_COUNTS)[slot].saturating_add(1);
        }
    }
}

unsafe fn dsp_template_resource_layout(
    op_index: usize,
    end_index: usize,
) -> DspRepeatResourceLayout {
    let mut sample_indices = Vec::new();
    let mut effect_slots = Vec::new();
    let mut buffer_slots = Vec::new();
    for template_index in (op_index + 1)..end_index {
        let template_op = kernel_global!(DSP_OPS)[template_index];
        if template_op.opcode == DSP_OP_SAMPLE && template_op.a >= 0 {
            let sample_index = template_op.a as usize;
            if sample_index < MAX_DSP_SAMPLE_NODES && !sample_indices.contains(&sample_index) {
                sample_indices.push(sample_index);
            }
        }
        if dsp_op_uses_effect_buffer(template_op.opcode, template_op.a) {
            if let Some(slot) = dsp_effect_slot(template_op.state) {
                if !effect_slots.contains(&slot) {
                    effect_slots.push(slot);
                }
            }
        }
        if template_op.opcode == DSP_OP_BUFFER {
            if let Some(slot) = dsp_buffer_slot(template_op.state) {
                if !buffer_slots.contains(&slot) {
                    buffer_slots.push(slot);
                }
            }
        }
    }
    DspRepeatResourceLayout {
        state_start: kernel_global!(DSP_OPS)[op_index].state.max(0) as usize,
        state_count: kernel_global!(DSP_OPS)[op_index].value2.round().max(0.0) as usize,
        sample_indices,
        effect_slots,
        buffer_slots,
    }
}

#[cfg(test)]
mod repeated_resource_state_tests {
    use super::*;

    #[test]
    fn sample_playback_remap_preserves_active_voice_state() {
        let mut source = DspSamplePlaybackState::new(2);
        source.active_voice_limit = 3;
        source.playing[2] = true;
        source.positions[2] = 1234.5;
        source.playback_ages[2] = 0.75;
        source.stretch_phases[2] = 64.0;

        let remapped = remap_dsp_sample_playback_state(&source, 7);

        assert_eq!(remapped.sample_index, 7);
        assert_eq!(remapped.active_voice_limit, 3);
        assert!(remapped.playing[2]);
        assert_eq!(remapped.positions[2], 1234.5);
        assert_eq!(remapped.playback_ages[2], 0.75);
        assert_eq!(remapped.stretch_phases[2], 64.0);
    }

    #[test]
    fn repeated_instances_keep_sample_state_directly_owned() {
        unsafe {
            let layout = DspRepeatResourceLayout {
                state_start: 0,
                state_count: 1,
                sample_indices: vec![0],
                effect_slots: vec![0],
                buffer_slots: vec![0],
            };
            let mut first = DspRepeatResourceState::new(&layout);
            let mut second = DspRepeatResourceState::new(&layout);

            first.sample_mut(0).unwrap().playing[0] = true;
            first.sample_mut(0).unwrap().positions[0] = 128.0;
            second.sample_mut(0).unwrap().playing[0] = true;
            second.sample_mut(0).unwrap().positions[0] = 32.0;

            first.load_into_workspace();
            kernel_global!(DSP_EFFECT_BUFFERS)[0].as_mut().unwrap()[0] = 0.75;
            kernel_global!(DSP_EFFECT_INDICES)[0] = 9;
            kernel_global!(DSP_BUFFER_BUFFERS)[0].as_mut().unwrap()[0] = 0.5;
            first.save_from_workspace();

            second.load_into_workspace();
            assert_eq!(first.sample_mut(0).unwrap().positions[0], 128.0);
            assert_eq!(second.sample_mut(0).unwrap().positions[0], 32.0);
            assert_eq!(
                kernel_global!(DSP_EFFECT_BUFFERS)[0].as_ref().unwrap()[0],
                0.0
            );
            assert_eq!(kernel_global!(DSP_EFFECT_INDICES)[0], 0);
            assert_eq!(
                kernel_global!(DSP_BUFFER_BUFFERS)[0].as_ref().unwrap()[0],
                0.0
            );
            kernel_global!(DSP_EFFECT_BUFFERS)[0].as_mut().unwrap()[0] = 0.25;
            kernel_global!(DSP_EFFECT_INDICES)[0] = 3;
            kernel_global!(DSP_BUFFER_BUFFERS)[0].as_mut().unwrap()[0] = 0.125;
            second.save_from_workspace();

            first.load_into_workspace();
            assert_eq!(first.sample_mut(0).unwrap().positions[0], 128.0);
            assert_eq!(
                kernel_global!(DSP_EFFECT_BUFFERS)[0].as_ref().unwrap()[0],
                0.75
            );
            assert_eq!(kernel_global!(DSP_EFFECT_INDICES)[0], 9);
            assert_eq!(
                kernel_global!(DSP_BUFFER_BUFFERS)[0].as_ref().unwrap()[0],
                0.5
            );
            first.save_from_workspace();

            second.load_into_workspace();
            assert_eq!(second.sample_mut(0).unwrap().positions[0], 32.0);
            assert_eq!(
                kernel_global!(DSP_EFFECT_BUFFERS)[0].as_ref().unwrap()[0],
                0.25
            );
            assert_eq!(kernel_global!(DSP_EFFECT_INDICES)[0], 3);
            assert_eq!(
                kernel_global!(DSP_BUFFER_BUFFERS)[0].as_ref().unwrap()[0],
                0.125
            );
            second.save_from_workspace();
        }
    }

    #[test]
    fn repeated_scalar_state_is_mutated_through_a_direct_view() {
        let mut instance_state = vec![10.0, 20.0, 30.0];
        unsafe {
            let previous_global = *dsp_state_ptr(101);
            set_dsp_repeat_state(100, &mut instance_state);
            *dsp_state_ptr(101) = 42.0;
            assert_eq!(instance_state, vec![10.0, 42.0, 30.0]);
            clear_dsp_repeat_state();
            assert_eq!(*dsp_state_ptr(101), previous_global);
        }
    }

    #[test]
    fn effect_states_do_not_alias_by_modulo() {
        clear_dsp_resource_slots();
        let first = prepare_dsp_effect_slot(0).unwrap();
        let sixty_fifth = prepare_dsp_effect_slot(64).unwrap();
        assert_ne!(first, sixty_fifth);
        clear_dsp_resource_slots();
    }

    #[test]
    fn repeated_state_migration_keeps_matches_and_initializes_additions() {
        let mut plan = DspRepeatMigrationPlan::new();
        plan.state_ranges.push((0, 2, 2));
        plan.state_ranges.push((3, 0, 1));
        assert_eq!(
            migrate_dsp_repeat_state(&[10.0, 11.0, 12.0, 13.0], 4, 5, &plan),
            vec![13.0, 0.0, 10.0, 11.0, 0.0],
        );
    }
}

fn block_optional_inputs(registers: &[i32]) -> ([i32; 8], usize) {
    let mut inputs = [-1; 8];
    let mut count = 0;
    for &register in registers {
        if register >= 0 {
            inputs[count] = register;
            count += 1;
        }
    }
    (inputs, count)
}

fn block_op_inputs(op: DspOp) -> Option<([i32; 8], usize)> {
    match op.opcode {
        DSP_OP_VALUE => Some(([-1; 8], 0)),
        DSP_OP_ADD | DSP_OP_MUL | DSP_OP_SUB | DSP_OP_DIV => {
            Some(([op.a, op.b, -1, -1, -1, -1, -1, -1], 2))
        }
        DSP_OP_NEG | DSP_OP_ABS | DSP_OP_DC_BLOCK => Some(([op.a, -1, -1, -1, -1, -1, -1, -1], 1)),
        DSP_OP_FUNCTION => Some(block_optional_inputs(&[op.b, op.c, op.d])),
        DSP_OP_DELAY => Some(block_optional_inputs(&[op.a, op.b, op.c, op.d])),
        DSP_OP_CACHED_CONTROL if op.state >= 0 && (op.state as usize) < MAX_DSP_OPS => unsafe {
            let cache = kernel_global!(DSP_CONTROL_CACHES)[op.state as usize];
            if cache.count == 0
                || cache.count > 4
                || !matches!(cache.opcode, DSP_OP_FUNCTION | DSP_OP_DIV)
            {
                return None;
            }
            let mut inputs = [-1; 8];
            inputs[..cache.count as usize].copy_from_slice(&cache.inputs[..cache.count as usize]);
            Some((inputs, cache.count as usize))
        },
        DSP_OP_OSC if (0..=4).contains(&op.a) && op.d < 0 && op.e < 0 && op.state >= 0 => {
            let pulse_width = if op.a == 4 {
                op.value.round() as i32
            } else {
                -1
            };
            if op.value4 >= 0.5 {
                Some((
                    [
                        op.b,
                        op.value2.round() as i32,
                        op.value3.round() as i32,
                        pulse_width,
                        -1,
                        -1,
                        -1,
                        -1,
                    ],
                    if pulse_width >= 0 { 4 } else { 3 },
                ))
            } else {
                Some((
                    [op.b, pulse_width, -1, -1, -1, -1, -1, -1],
                    if pulse_width >= 0 { 2 } else { 1 },
                ))
            }
        }
        DSP_OP_OSC if op.a == 12 && op.state >= 0 && valid_dsp_register_value(op.value) => {
            let mut inputs = [-1; 8];
            let mut count = 0;
            for register in [op.b, op.c, op.value as i32, op.d, op.e] {
                if register >= 0 {
                    inputs[count] = register;
                    count += 1;
                }
            }
            if op.value4 >= 0.5 {
                inputs[count] = op.value2.round() as i32;
                inputs[count + 1] = op.value3.round() as i32;
                count += 2;
            }
            Some((inputs, count))
        }
        DSP_OP_FILTER if matches!(op.a, 1 | 2 | 3 | 8) && op.state >= 0 => {
            Some(([op.b, op.c, op.d, -1, -1, -1, -1, -1], 3))
        }
        DSP_OP_OUTPUT if op.b == 0 || op.b == 1 => Some(([op.a, -1, -1, -1, -1, -1, -1, -1], 1)),
        _ => None,
    }
}

fn mixed_op_inputs(op: DspOp) -> Option<([i32; 8], usize)> {
    match op.opcode {
        DSP_OP_FEEDBACK_READ => Some(([-1; 8], 0)),
        DSP_OP_FEEDBACK_WRITE => Some(([op.a, -1, -1, -1, -1, -1, -1, -1], 1)),
        _ => block_op_inputs(op),
    }
}

fn block_op_numeric_state(op: DspOp) -> Option<(usize, usize)> {
    match op.opcode {
        DSP_OP_OSC if op.state >= 0 => Some((op.state as usize, if op.e >= 0 { 4 } else { 1 })),
        DSP_OP_FILTER if op.state >= 0 => Some((op.state as usize, 4)),
        DSP_OP_DC_BLOCK if op.state >= 0 => Some((op.state as usize, 2)),
        _ => None,
    }
}

fn tarjan_dsp_component(
    node: usize,
    edges: &[Vec<usize>],
    serial: &mut usize,
    indices: &mut [usize],
    low: &mut [usize],
    stack: &mut Vec<usize>,
    on_stack: &mut [bool],
    components: &mut Vec<Vec<usize>>,
) {
    indices[node] = *serial;
    low[node] = *serial;
    *serial += 1;
    stack.push(node);
    on_stack[node] = true;
    for &next in &edges[node] {
        if indices[next] == usize::MAX {
            tarjan_dsp_component(
                next, edges, serial, indices, low, stack, on_stack, components,
            );
            low[node] = low[node].min(low[next]);
        } else if on_stack[next] {
            low[node] = low[node].min(indices[next]);
        }
    }
    if low[node] == indices[node] {
        let mut members = Vec::new();
        loop {
            let member = stack.pop().unwrap();
            on_stack[member] = false;
            members.push(member);
            if member == node {
                break;
            }
        }
        members.sort_unstable();
        components.push(members);
    }
}

// The first mixed implementation deliberately bounds the op graph and keeps
// resource/repeat/event programs on the scalar interpreter. Feedback state is
// only consumed in an SCC that also contains its write, so a block cannot
// accidentally turn a one-sample history edge into a same-sample edge.
fn build_dsp_mixed_plan() -> Option<DspBlockPlan> {
    unsafe {
        let count = kernel_global!(DSP_OP_COUNT);
        if count == 0 || count > 512 {
            return None;
        }
        let mut producer = [usize::MAX; MAX_DSP_REGS];
        let mut state_used = [false; MAX_DSP_STATE];
        let mut effect_used = [false; MAX_DSP_EFFECT_SLOTS];
        let mut feedback_reads = [usize::MAX; MAX_DSP_STATE];
        let mut feedback_writes = [usize::MAX; MAX_DSP_STATE];
        let mut highest_register = 0;
        let mut value_op_count = 0;
        let mut output_previous: Option<usize> = None;
        let mut edges = vec![Vec::new(); count];
        for index in 0..count {
            let op = kernel_global!(DSP_OPS)[index];
            let (inputs, input_count) = mixed_op_inputs(op)?;
            for &register in &inputs[..input_count] {
                if !valid_dsp_register(register) {
                    return None;
                }
                let source = producer[register as usize];
                if source == usize::MAX {
                    return None;
                }
                edges[source].push(index);
            }
            if let Some((start, length)) = block_op_numeric_state(op) {
                if start + length > MAX_DSP_STATE
                    || state_used[start..start + length].iter().any(|used| *used)
                {
                    return None;
                }
                state_used[start..start + length].fill(true);
            }
            if op.opcode == DSP_OP_DELAY {
                let slot = dsp_effect_slot(op.state)?;
                if effect_used[slot] {
                    return None;
                }
                effect_used[slot] = true;
            }
            if op.opcode == DSP_OP_FEEDBACK_READ || op.opcode == DSP_OP_FEEDBACK_WRITE {
                if op.state < 0 || op.state as usize >= MAX_DSP_STATE {
                    return None;
                }
                let slot = if op.opcode == DSP_OP_FEEDBACK_READ {
                    &mut feedback_reads[op.state as usize]
                } else {
                    &mut feedback_writes[op.state as usize]
                };
                if *slot != usize::MAX {
                    return None;
                }
                *slot = index;
            }
            if op.opcode == DSP_OP_VALUE {
                value_op_count += 1;
            }
            if op.opcode == DSP_OP_OUTPUT {
                if let Some(previous) = output_previous {
                    edges[previous].push(index);
                }
                output_previous = Some(index);
            } else if op.opcode != DSP_OP_FEEDBACK_WRITE {
                if !valid_dsp_register(op.out) || producer[op.out as usize] != usize::MAX {
                    return None;
                }
                producer[op.out as usize] = index;
                highest_register = highest_register.max(op.out as usize + 1);
            }
        }
        let mut has_feedback = false;
        for state in 0..MAX_DSP_STATE {
            let read = feedback_reads[state];
            let write = feedback_writes[state];
            if read == usize::MAX && write == usize::MAX {
                continue;
            }
            if read == usize::MAX || write == usize::MAX || state_used[state] {
                return None;
            }
            has_feedback = true;
            edges[write].push(read);
        }
        if !has_feedback {
            return None;
        }

        let mut indices = vec![usize::MAX; count];
        let mut low = vec![0; count];
        let mut stack = Vec::new();
        let mut on_stack = vec![false; count];
        let mut components = Vec::new();
        let mut serial = 0;
        for index in 0..count {
            if indices[index] == usize::MAX {
                tarjan_dsp_component(
                    index,
                    &edges,
                    &mut serial,
                    &mut indices,
                    &mut low,
                    &mut stack,
                    &mut on_stack,
                    &mut components,
                );
            }
        }
        let mut component_of = vec![0; count];
        for (component, members) in components.iter().enumerate() {
            for &index in members {
                component_of[index] = component;
            }
        }
        for state in 0..MAX_DSP_STATE {
            if feedback_reads[state] != usize::MAX
                && component_of[feedback_reads[state]] != component_of[feedback_writes[state]]
            {
                return None;
            }
        }
        let mut following = vec![Vec::new(); components.len()];
        let mut indegree = vec![0usize; components.len()];
        for (from, successors) in edges.iter().enumerate() {
            for &to in successors {
                let source = component_of[from];
                let target = component_of[to];
                if source != target && !following[source].contains(&target) {
                    following[source].push(target);
                    indegree[target] += 1;
                }
            }
        }
        let mut ready: Vec<usize> = (0..components.len())
            .filter(|&id| indegree[id] == 0)
            .collect();
        let mut stages = Vec::with_capacity(components.len());
        while !ready.is_empty() {
            ready.sort_unstable_by_key(|&id| components[id][0]);
            let component = ready.remove(0);
            let members = &components[component];
            let cyclic = members.len() > 1 || edges[members[0]].contains(&members[0]);
            if cyclic
                && !members
                    .iter()
                    .any(|&index| kernel_global!(DSP_OPS)[index].opcode == DSP_OP_FEEDBACK_READ)
            {
                return None;
            }
            stages.push(DspBlockStage {
                ops: members.clone(),
                cyclic,
            });
            for &next in &following[component] {
                indegree[next] -= 1;
                if indegree[next] == 0 {
                    ready.push(next);
                }
            }
        }
        if stages.len() != components.len() {
            return None;
        }
        let cyclic_ops: usize = stages
            .iter()
            .filter(|stage| stage.cyclic)
            .map(|stage| stage.ops.len())
            .sum();
        let block_ops = count - cyclic_ops;
        // For a tiny acyclic fringe, copying buffers around the cyclic
        // interpreter costs more than keeping the entire program scalar.
        if block_ops < 16 || block_ops < cyclic_ops * 2 {
            return None;
        }
        let mut value_stream_for_op = vec![usize::MAX; count];
        let mut value_stream_sources = Vec::with_capacity(value_op_count);
        for index in 0..count {
            let op = kernel_global!(DSP_OPS)[index];
            if op.opcode == DSP_OP_VALUE {
                let source = (op.a, op.value >= DSP_VALUE_MODE_IMMEDIATE);
                let stream = value_stream_sources
                    .iter()
                    .position(|existing| *existing == source)
                    .unwrap_or_else(|| {
                        value_stream_sources.push(source);
                        value_stream_sources.len() - 1
                    });
                value_stream_for_op[index] = stream;
                if value_stream_sources.len() > MAX_DSP_BLOCK_VALUE_STREAMS {
                    return None;
                }
            }
        }
        let value_stream_count = value_stream_sources.len();
        let mut slots = vec![usize::MAX; highest_register];
        let mut slot_count = 0;
        for register in 0..highest_register {
            if producer[register] != usize::MAX {
                slots[register] = slot_count;
                slot_count += 1;
            }
        }
        if slot_count > MAX_DSP_BLOCK_SLOTS {
            return None;
        }
        Some(DspBlockPlan {
            slots,
            value_stream_for_op,
            value_stream_sources,
            buffers: vec![0.0; slot_count * DSP_BLOCK_FRAMES],
            value_streams: vec![0.0; value_stream_count * DSP_BLOCK_FRAMES],
            left: [0.0; DSP_BLOCK_FRAMES],
            right: [0.0; DSP_BLOCK_FRAMES],
            slot_count,
            value_stream_count,
            stages,
            mixed: true,
        })
    }
}

fn build_dsp_block_plan() -> Option<DspBlockPlan> {
    unsafe {
        if kernel_global!(DSP_OP_COUNT) == 0 {
            return None;
        }
        let mut defined = [false; MAX_DSP_REGS];
        let mut last_use = [0usize; MAX_DSP_REGS];
        let mut state_used = [false; MAX_DSP_STATE];
        let mut effect_used = [false; MAX_DSP_EFFECT_SLOTS];
        let mut highest_register = 0;
        let mut value_op_count = 0;
        for index in 0..kernel_global!(DSP_OP_COUNT) {
            let op = kernel_global!(DSP_OPS)[index];
            let (inputs, count) = block_op_inputs(op)?;
            for &register in &inputs[..count] {
                if !valid_dsp_register(register) || !defined[register as usize] {
                    return None;
                }
                last_use[register as usize] = index;
            }
            if let Some((start, length)) = block_op_numeric_state(op) {
                if start + length > MAX_DSP_STATE
                    || state_used[start..start + length].iter().any(|used| *used)
                {
                    return None;
                }
                state_used[start..start + length].fill(true);
            }
            if op.opcode == DSP_OP_DELAY {
                let slot = dsp_effect_slot(op.state)?;
                if effect_used[slot] {
                    return None;
                }
                effect_used[slot] = true;
            }
            if op.opcode == DSP_OP_VALUE {
                value_op_count += 1;
            }
            if op.opcode != DSP_OP_OUTPUT {
                if !valid_dsp_register(op.out) || defined[op.out as usize] {
                    return None;
                }
                defined[op.out as usize] = true;
                last_use[op.out as usize] = index;
                highest_register = highest_register.max(op.out as usize + 1);
            }
        }
        for slot in 0..kernel_global!(DSP_METER_SLOT_COUNT) {
            let register = kernel_global!(DSP_METER_REGS)[slot];
            if valid_dsp_register(register) && defined[register as usize] {
                last_use[register as usize] = kernel_global!(DSP_OP_COUNT);
            }
        }
        for slot in 0..kernel_global!(DSP_SCOPE_SLOT_COUNT) {
            let register = kernel_global!(DSP_SCOPE_REGS)[slot];
            if valid_dsp_register(register) && defined[register as usize] {
                last_use[register as usize] = kernel_global!(DSP_OP_COUNT);
            }
        }
        let mut slots = vec![usize::MAX; highest_register];
        let mut active = [false; MAX_DSP_REGS];
        let mut free = Vec::new();
        let mut slot_count = 0;
        let mut value_stream_for_op = vec![usize::MAX; kernel_global!(DSP_OP_COUNT)];
        let mut value_stream_sources = Vec::with_capacity(value_op_count);
        for index in 0..kernel_global!(DSP_OP_COUNT) {
            let op = kernel_global!(DSP_OPS)[index];
            if op.opcode == DSP_OP_VALUE {
                let source = (op.a, op.value >= DSP_VALUE_MODE_IMMEDIATE);
                let stream = value_stream_sources
                    .iter()
                    .position(|existing| *existing == source)
                    .unwrap_or_else(|| {
                        value_stream_sources.push(source);
                        value_stream_sources.len() - 1
                    });
                value_stream_for_op[index] = stream;
                if value_stream_sources.len() > MAX_DSP_BLOCK_VALUE_STREAMS {
                    return None;
                }
            }
            if op.opcode != DSP_OP_OUTPUT {
                let slot = free.pop().unwrap_or_else(|| {
                    let next = slot_count;
                    slot_count += 1;
                    next
                });
                if slot_count > MAX_DSP_BLOCK_SLOTS {
                    return None;
                }
                slots[op.out as usize] = slot;
                active[op.out as usize] = true;
            }
            let (inputs, count) = block_op_inputs(op)?;
            for &register in &inputs[..count] {
                let register = register as usize;
                if last_use[register] == index && active[register] {
                    active[register] = false;
                    free.push(slots[register]);
                }
            }
            if op.opcode != DSP_OP_OUTPUT {
                let register = op.out as usize;
                if last_use[register] == index && active[register] {
                    active[register] = false;
                    free.push(slots[register]);
                }
            }
        }
        let value_stream_count = value_stream_sources.len();
        Some(DspBlockPlan {
            slots,
            value_stream_for_op,
            value_stream_sources,
            buffers: vec![0.0; slot_count * DSP_BLOCK_FRAMES],
            value_streams: vec![0.0; value_stream_count * DSP_BLOCK_FRAMES],
            left: [0.0; DSP_BLOCK_FRAMES],
            right: [0.0; DSP_BLOCK_FRAMES],
            slot_count,
            value_stream_count,
            stages: (0..kernel_global!(DSP_OP_COUNT))
                .map(|index| DspBlockStage {
                    ops: vec![index],
                    cyclic: false,
                })
                .collect(),
            mixed: false,
        })
    }
}

#[no_mangle]
pub extern "C" fn compileDspBlockPlan() -> i32 {
    unsafe {
        *core::ptr::addr_of_mut!(kernel_global!(DSP_BLOCK_PLAN)) =
            build_dsp_block_plan().or_else(build_dsp_mixed_plan);
        // The exact KinkOsc and sign-preserving power helpers dominate this
        // patch's cost. Ordinary block dispatch regressed in offline runs, so
        // retain scalar automatic rendering for this provisional workload
        // class until a broader cost model is measured. SIMD can still block
        // the independent arithmetic around those sample-ordered helpers.
        kernel_global!(DSP_BLOCK_AUTO_ENABLED) =
            cfg!(all(target_arch = "wasm32", target_feature = "simd128"))
                || !(0..kernel_global!(DSP_OP_COUNT)).any(|index| {
                    let op = kernel_global!(DSP_OPS)[index];
                    (op.opcode == DSP_OP_OSC && op.a == 12)
                        || (op.opcode == DSP_OP_FUNCTION && op.a == 9)
                        || (op.opcode == DSP_OP_CACHED_CONTROL
                            && op.state >= 0
                            && (op.state as usize) < MAX_DSP_OPS
                            && kernel_global!(DSP_CONTROL_CACHES)[op.state as usize].opcode
                                == DSP_OP_FUNCTION
                            && op.a == 9)
                });
        match (*core::ptr::addr_of!(kernel_global!(DSP_BLOCK_PLAN))).as_ref() {
            Some(plan) if plan.mixed => 2,
            Some(_) => 1,
            None => 0,
        }
    }
}

#[no_mangle]
pub extern "C" fn dspBlockPlanBytes() -> u32 {
    unsafe {
        (*core::ptr::addr_of!(kernel_global!(DSP_BLOCK_PLAN)))
            .as_ref()
            .map_or(0, |plan| {
                ((plan.slot_count + plan.value_stream_count) * DSP_BLOCK_FRAMES * 8) as u32
            })
    }
}

#[no_mangle]
pub extern "C" fn setDspBlockRendering(enabled: i32) {
    unsafe {
        kernel_global!(DSP_BLOCK_RENDERING_OVERRIDE) = enabled >= 0;
        kernel_global!(DSP_BLOCK_RENDERING_ENABLED) = enabled != 0;
    }
}

#[no_mangle]
pub extern "C" fn dspBlockRenderingEnabled() -> i32 {
    unsafe {
        i32::from(
            (*core::ptr::addr_of!(kernel_global!(DSP_BLOCK_PLAN))).is_some()
                && if kernel_global!(DSP_BLOCK_RENDERING_OVERRIDE) {
                    kernel_global!(DSP_BLOCK_RENDERING_ENABLED)
                } else {
                    kernel_global!(DSP_BLOCK_AUTO_ENABLED)
                },
        )
    }
}

#[inline(always)]
fn block_register(plan: &DspBlockPlan, register: i32, frame: usize) -> f64 {
    plan.buffers[plan.slots[register as usize] * DSP_BLOCK_FRAMES + frame]
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
unsafe fn render_simd_binary(plan: &mut DspBlockPlan, op: DspOp, count: usize, offset: usize) {
    use core::arch::wasm32::{f64x2_add, f64x2_mul, f64x2_sub, v128, v128_load, v128_store};
    let left = plan
        .buffers
        .as_ptr()
        .add(plan.slots[op.a as usize] * DSP_BLOCK_FRAMES);
    let right = plan
        .buffers
        .as_ptr()
        .add(plan.slots[op.b as usize] * DSP_BLOCK_FRAMES);
    let output = plan.buffers.as_mut_ptr().add(offset);
    let mut frame = 0;
    while frame + 2 <= count {
        let a = v128_load(left.add(frame) as *const v128);
        let b = v128_load(right.add(frame) as *const v128);
        let result = match op.opcode {
            DSP_OP_ADD => f64x2_add(a, b),
            DSP_OP_MUL => f64x2_mul(a, b),
            _ => f64x2_sub(a, b),
        };
        let mut lanes = [0.0_f64; 2];
        v128_store(lanes.as_mut_ptr() as *mut v128, result);
        *output.add(frame) = sanitize_dsp_register(lanes[0]);
        *output.add(frame + 1) = sanitize_dsp_register(lanes[1]);
        frame += 2;
    }
    if frame < count {
        let a = *left.add(frame);
        let b = *right.add(frame);
        *output.add(frame) = sanitize_dsp_register(match op.opcode {
            DSP_OP_ADD => a + b,
            DSP_OP_MUL => a * b,
            _ => a - b,
        });
    }
}

unsafe fn render_dsp_block(plan: &mut DspBlockPlan, frames: usize, sample_rate: f64, alpha: f64) {
    for start in (0..frames).step_by(DSP_BLOCK_FRAMES) {
        let count = (frames - start).min(DSP_BLOCK_FRAMES);
        plan.left[..count].fill(0.0);
        plan.right[..count].fill(0.0);

        // Capture the current value at every sample before any operation is
        // evaluated. Each smoother and MIDI timeline advances exactly once.
        for frame in 0..count {
            advance_dsp_midi_note_event();
            advance_dsp_values(alpha);
            for (stream, &(value_index, immediate)) in plan.value_stream_sources.iter().enumerate()
            {
                let value = if immediate {
                    dsp_value_target_unchecked(value_index)
                } else {
                    dsp_value_unchecked(value_index)
                };
                plan.value_streams[stream * DSP_BLOCK_FRAMES + frame] =
                    sanitize_dsp_register(value);
            }
        }

        for stage_index in 0..plan.stages.len() {
            if plan.stages[stage_index].cyclic {
                for frame in 0..count {
                    for member in 0..plan.stages[stage_index].ops.len() {
                        let index = plan.stages[stage_index].ops[member];
                        let op = kernel_global!(DSP_OPS)[index];
                        let (inputs, input_count) = mixed_op_inputs(op).unwrap();
                        for &register in &inputs[..input_count] {
                            kernel_global!(DSP_REGS)[register as usize] =
                                block_register(plan, register, frame);
                        }
                        render_dsp_op::<false>(
                            op,
                            start + frame,
                            sample_rate,
                            &mut plan.left[frame],
                            &mut plan.right[frame],
                            None,
                            None,
                        );
                        if op.opcode != DSP_OP_OUTPUT && op.opcode != DSP_OP_FEEDBACK_WRITE {
                            let offset = plan.slots[op.out as usize] * DSP_BLOCK_FRAMES;
                            plan.buffers[offset + frame] =
                                kernel_global!(DSP_REGS)[op.out as usize];
                        }
                    }
                }
                continue;
            }
            for member in 0..plan.stages[stage_index].ops.len() {
                let index = plan.stages[stage_index].ops[member];
                let op = kernel_global!(DSP_OPS)[index];
                if op.opcode == DSP_OP_OUTPUT {
                    for frame in 0..count {
                        let sample = sanitize_sample(block_register(plan, op.a, frame), 8.0);
                        let channel = if op.b == 0 {
                            &mut plan.left[frame]
                        } else {
                            &mut plan.right[frame]
                        };
                        *channel = sanitize_sample(*channel + sample, 8.0);
                    }
                    continue;
                }
                let offset = plan.slots[op.out as usize] * DSP_BLOCK_FRAMES;
                #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
                if matches!(op.opcode, DSP_OP_ADD | DSP_OP_MUL | DSP_OP_SUB) {
                    render_simd_binary(plan, op, count, offset);
                    kernel_global!(DSP_REGS)[op.out as usize] = plan.buffers[offset + count - 1];
                    continue;
                }
                for frame in 0..count {
                    let value = if matches!(
                        op.opcode,
                        DSP_OP_FUNCTION | DSP_OP_CACHED_CONTROL | DSP_OP_DELAY | DSP_OP_DC_BLOCK
                    ) || (op.opcode == DSP_OP_OSC && op.a == 12)
                    {
                        // Reuse the interpreter's exact maths and state updates.
                        // Each input is already a per-sample stream from an earlier
                        // stage, so stateful effects still run in sample order.
                        let (inputs, input_count) = block_op_inputs(op).unwrap();
                        for &register in &inputs[..input_count] {
                            kernel_global!(DSP_REGS)[register as usize] =
                                block_register(plan, register, frame);
                        }
                        render_dsp_op::<false>(
                            op,
                            start + frame,
                            sample_rate,
                            &mut plan.left[frame],
                            &mut plan.right[frame],
                            None,
                            None,
                        );
                        kernel_global!(DSP_REGS)[op.out as usize]
                    } else {
                        match op.opcode {
                            DSP_OP_VALUE => {
                                let stream = plan.value_stream_for_op[index];
                                plan.value_streams[stream * DSP_BLOCK_FRAMES + frame]
                            }
                            DSP_OP_ADD => sanitize_dsp_register(
                                block_register(plan, op.a, frame)
                                    + block_register(plan, op.b, frame),
                            ),
                            DSP_OP_MUL => sanitize_dsp_register(
                                block_register(plan, op.a, frame)
                                    * block_register(plan, op.b, frame),
                            ),
                            DSP_OP_SUB => sanitize_dsp_register(
                                block_register(plan, op.a, frame)
                                    - block_register(plan, op.b, frame),
                            ),
                            DSP_OP_DIV => {
                                let denominator = block_register(plan, op.b, frame);
                                sanitize_dsp_register(if denominator.abs() <= 0.000001 {
                                    0.0
                                } else {
                                    block_register(plan, op.a, frame) / denominator
                                })
                            }
                            DSP_OP_NEG => -block_register(plan, op.a, frame),
                            DSP_OP_ABS => block_register(plan, op.a, frame).abs(),
                            DSP_OP_OSC => {
                                let frequency = block_register(plan, op.b, frame).max(0.0);
                                let state = dsp_state_ptr(op.state as usize);
                                let phase = *state;
                                let pulse_width = if op.a == 4 {
                                    block_register(plan, op.value.round() as i32, frame)
                                } else {
                                    0.5
                                };
                                let output = dsp_oscillator(op.a, phase, pulse_width);
                                let output = if op.value4 >= 0.5 {
                                    let min = block_register(plan, op.value2.round() as i32, frame);
                                    let max = block_register(plan, op.value3.round() as i32, frame);
                                    min + (output + 1.0) * 0.5 * (max - min)
                                } else {
                                    output
                                };
                                *state = normalize_phase(phase + frequency / sample_rate.max(1.0));
                                output
                            }
                            DSP_OP_FILTER => {
                                kernel_global!(DSP_REGS)[op.b as usize] =
                                    block_register(plan, op.b, frame);
                                kernel_global!(DSP_REGS)[op.c as usize] =
                                    block_register(plan, op.c, frame);
                                kernel_global!(DSP_REGS)[op.d as usize] =
                                    block_register(plan, op.d, frame);
                                sanitize_dsp_register(render_dsp_filter(op, sample_rate))
                            }
                            _ => unreachable!(),
                        }
                    };
                    plan.buffers[offset + frame] = value;
                }
                // The scalar interpreter leaves every register holding its most
                // recent sample, including registers whose scratch slot is reused.
                kernel_global!(DSP_REGS)[op.out as usize] = plan.buffers[offset + count - 1];
            }
        }

        for frame in 0..count {
            for slot in 0..kernel_global!(DSP_METER_SLOT_COUNT) {
                let register = kernel_global!(DSP_METER_REGS)[slot];
                if register >= 0
                    && (register as usize) < plan.slots.len()
                    && plan.slots[register as usize] != usize::MAX
                {
                    kernel_global!(DSP_REGS)[register as usize] =
                        block_register(plan, register, frame);
                }
            }
            for slot in 0..kernel_global!(DSP_SCOPE_SLOT_COUNT) {
                let register = kernel_global!(DSP_SCOPE_REGS)[slot];
                if register >= 0
                    && (register as usize) < plan.slots.len()
                    && plan.slots[register as usize] != usize::MAX
                {
                    kernel_global!(DSP_REGS)[register as usize] =
                        block_register(plan, register, frame);
                }
            }
            capture_dsp_meters();
            capture_dsp_scopes();
            kernel_global!(LEFT)[start + frame] += plan.left[frame] as f32;
            kernel_global!(RIGHT)[start + frame] += plan.right[frame] as f32;
        }
    }
}

unsafe fn render_dsp_ops(
    frame: usize,
    sample_rate: f64,
    left_sample: &mut f64,
    right_sample: &mut f64,
    use_control_cache: bool,
) {
    if let Some(mut sequence) = (&mut *core::ptr::addr_of_mut!(kernel_global!(DSP_BOUNDED_PROGRAM))).take() {
        sequence.render(frame, sample_rate, left_sample, right_sample, None);
        kernel_global!(DSP_BOUNDED_PROGRAM) = Some(sequence);
        return;
    }
    let mut op_index = 0;
    while op_index < kernel_global!(DSP_OP_COUNT) {
        let mut op = kernel_global!(DSP_OPS)[op_index];
        if op.opcode != DSP_OP_SPREAD_BEGIN && op.opcode != DSP_OP_SPAWN_BEGIN {
            if !use_control_cache && op.opcode == DSP_OP_CACHED_CONTROL {
                op.opcode = kernel_global!(DSP_CONTROL_CACHES)[op_index].opcode;
                op.state = -1;
            }
            render_dsp_op::<false>(
                op,
                frame,
                sample_rate,
                left_sample,
                right_sample,
                None,
                None,
            );
            op_index += 1;
            continue;
        }

        let end_index = op.b.max(op_index as i32 + 1) as usize;
        if end_index >= kernel_global!(DSP_OP_COUNT) {
            return;
        }
        let count = dsp_reg(op.a).floor().max(0.0) as usize;
        let count = if op.opcode == DSP_OP_SPREAD_BEGIN
            && kernel_global!(DSP_REPEAT_CAPACITY) > 0
            && count > kernel_global!(DSP_REPEAT_CAPACITY)
        {
            kernel_global!(DSP_REPEAT_EXHAUSTIONS) += 1;
            kernel_global!(DSP_REPEAT_CAPACITY)
        } else {
            count
        };
        let spread_slot = op.value.round().max(0.0) as usize;
        let state_start = op.state.max(0) as usize;
        let state_count = op.value2.round().max(0.0) as usize;
        if spread_slot >= MAX_DSP_SPREADS || state_start.saturating_add(state_count) > MAX_DSP_STATE
        {
            op_index = end_index + 1;
            continue;
        }

        if kernel_global!(DSP_REPEAT_CAPACITY) > 0 && kernel_global!(DSP_SPREAD_CONTEXT) != 0 {
            kernel_global!(DSP_REPEAT_EXHAUSTIONS) += 1;
            op_index = end_index + 1;
            continue;
        }
        // Every collector is reset once per sample. Sum/set links start at
        // zero; multiply links start at the multiplicative identity.
        for template_index in (op_index + 1)..end_index {
            let template_op = kernel_global!(DSP_OPS)[template_index];
            if template_op.opcode == DSP_OP_SPREAD_COLLECT {
                set_dsp_reg(template_op.out, if template_op.b == 1 { 1.0 } else { 0.0 });
            }
        }

        if op.opcode == DSP_OP_SPAWN_BEGIN {
            let mut runtime = kernel_global!(DSP_SPAWN_RUNTIMES)[spread_slot]
                .take()
                .unwrap_or_else(DspSpawnRuntime::new);
            if runtime.resource_layout.is_none() {
                runtime.resource_layout = Some(dsp_template_resource_layout(op_index, end_index));
            }
            let context = kernel_global!(DSP_SPREAD_CONTEXT).min(MAX_VOICE_SLOTS);
            let trigger_value = dsp_reg(op.a);
            let trigger = trigger_value >= ENVELOPE_TRIGGER_THRESHOLD;
            let release_value = if op.d >= 0 { dsp_reg(op.d) } else { 0.0 };
            let release_trigger = release_value >= ENVELOPE_TRIGGER_THRESHOLD;
            let release_edge =
                release_trigger && !runtime.previous_release_trigger_by_context[context];
            if release_edge {
                for instance in &mut runtime.instances_by_context[context] {
                    if (instance.tag - release_value).abs() <= 0.000001 {
                        instance.gate = false;
                    }
                }
            }
            runtime.previous_release_trigger_by_context[context] = release_trigger;
            if trigger && !runtime.previous_trigger_by_context[context] {
                if kernel_global!(DSP_REPEAT_CAPACITY) > 0 {
                    if let Some(mut instance) = runtime.free_instances_by_context[context].pop() {
                        instance.states.fill(0.0);
                        instance
                            .resources
                            .reset_for_transport(&[false; MAX_DSP_BUFFER_SLOTS]);
                        instance.resources.random_state = next_dsp_random_seed();
                        instance.tag = trigger_value;
                        instance.gate = true;
                        instance.kill_triggered = false;
                        runtime.instances_by_context[context].push(instance);
                    } else {
                        kernel_global!(DSP_REPEAT_EXHAUSTIONS) += 1;
                    }
                } else {
                    runtime.instances_by_context[context].push(DspSpawnInstance {
                        states: vec![0.0; state_count],
                        resources: DspRepeatResourceState::new(
                            runtime.resource_layout.as_ref().unwrap(),
                        ),
                        tag: trigger_value,
                        gate: true,
                        kill_triggered: false,
                    });
                }
            }
            runtime.previous_trigger_by_context[context] = trigger;

            let instances = &mut runtime.instances_by_context[context];
            set_dsp_reg(op.out, instances.len() as f64);
            #[cfg(feature = "parallel")]
            if parallel::render_repeat(
                op_index,
                instances.len(),
                core::ptr::null_mut(),
                instances.as_mut_ptr(),
                core::ptr::null_mut(),
                state_count,
                frame,
                sample_rate,
            ) {
                if parallel::failed() {
                    kernel_global!(DSP_SPAWN_RUNTIMES)[spread_slot] = Some(runtime);
                    return;
                }
                kernel_global!(DSP_SPAWN_INSTANCE_GATE) =
                    if instances.last().is_some_and(|instance| instance.gate) {
                        1.0
                    } else {
                        0.0
                    };
                let mut original_index = 0;
                let mut instance_index = 0;
                let mut last_rendered_index = 0;
                while instance_index < instances.len() {
                    last_rendered_index = instance_index;
                    let instance = &mut instances[instance_index];
                    let kill_trigger = op.c >= 0
                        && parallel::repeat_kill_result(original_index)
                            >= ENVELOPE_TRIGGER_THRESHOLD;
                    let kill_edge = kill_trigger && !instance.kill_triggered;
                    instance.kill_triggered = kill_trigger;
                    original_index += 1;
                    if kill_edge {
                        let removed = instances.remove(instance_index);
                        if kernel_global!(DSP_REPEAT_CAPACITY) > 0 {
                            runtime.free_instances_by_context[context].push(removed);
                        }
                    } else {
                        instance_index += 1;
                    }
                }
                kernel_global!(DSP_SPREAD_ITEM_INDEX) = last_rendered_index;
                kernel_global!(DSP_SPAWN_RUNTIMES)[spread_slot] = Some(runtime);
                op_index = end_index + 1;
                continue;
            }
            let mut instance_index = 0;
            while instance_index < instances.len() {
                let instance = &mut instances[instance_index];
                if op.c >= 0 {
                    set_dsp_reg(op.c, 0.0);
                }
                instance.resources.load_into_workspace();
                set_dsp_repeat_state(state_start, &mut instance.states);
                kernel_global!(DSP_SPREAD_ITEM_INDEX) = instance_index;
                kernel_global!(DSP_SPAWN_INSTANCE_GATE) = if instance.gate { 1.0 } else { 0.0 };
                for template_index in (op_index + 1)..end_index {
                    render_dsp_op::<false>(
                        kernel_global!(DSP_OPS)[template_index],
                        frame,
                        sample_rate,
                        left_sample,
                        right_sample,
                        None,
                        Some(&mut instance.resources),
                    );
                }
                let kill_trigger = op.c >= 0 && dsp_reg(op.c) >= ENVELOPE_TRIGGER_THRESHOLD;
                let kill_edge = kill_trigger && !instance.kill_triggered;
                instance.kill_triggered = kill_trigger;
                clear_dsp_repeat_state();
                instance.resources.save_from_workspace();
                if kill_edge {
                    let removed = instances.remove(instance_index);
                    if kernel_global!(DSP_REPEAT_CAPACITY) > 0 {
                        runtime.free_instances_by_context[context].push(removed);
                    }
                } else {
                    instance_index += 1;
                }
            }
            kernel_global!(DSP_SPAWN_RUNTIMES)[spread_slot] = Some(runtime);
            op_index = end_index + 1;
            continue;
        }

        if state_count == 0 {
            #[cfg(feature = "parallel")]
            if parallel::render_repeat(
                op_index,
                count,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                0,
                frame,
                sample_rate,
            ) {
                if parallel::failed() {
                    return;
                }
                op_index = end_index + 1;
                continue;
            }
            for item_index in 0..count {
                kernel_global!(DSP_SPREAD_ITEM_INDEX) = item_index;
                for template_index in (op_index + 1)..end_index {
                    render_dsp_op::<false>(
                        kernel_global!(DSP_OPS)[template_index],
                        frame,
                        sample_rate,
                        left_sample,
                        right_sample,
                        None,
                        None,
                    );
                }
            }
            op_index = end_index + 1;
            continue;
        }

        let mut runtime = kernel_global!(DSP_SPREAD_RUNTIMES)[spread_slot]
            .take()
            .unwrap_or_else(DspSpreadRuntime::new);
        if runtime.resource_layout.is_none() {
            runtime.resource_layout = Some(dsp_template_resource_layout(op_index, end_index));
        }
        let context = kernel_global!(DSP_SPREAD_CONTEXT).min(MAX_VOICE_SLOTS);
        let required_states = count.saturating_mul(state_count);
        let states = &mut runtime.states_by_context[context];
        states.resize(required_states, 0.0);
        let resource_layout = runtime.resource_layout.as_ref().unwrap();
        let resources = &mut runtime.resources_by_context[context];
        if kernel_global!(DSP_REPEAT_CAPACITY) > 0 {
            while resources.len() > count {
                runtime.spare_resources_by_context[context].push(resources.pop().unwrap());
            }
            while resources.len() < count {
                let Some(mut resource) = runtime.spare_resources_by_context[context].pop() else {
                    break;
                };
                resource.reset_for_transport(&[false; MAX_DSP_BUFFER_SLOTS]);
                resource.random_state = next_dsp_random_seed();
                resources.push(resource);
            }
        } else {
            resources.resize_with(count, || DspRepeatResourceState::new(resource_layout));
            resources.truncate(count);
        }

        #[cfg(feature = "parallel")]
        if parallel::render_repeat(
            op_index,
            count,
            states.as_mut_ptr(),
            core::ptr::null_mut(),
            resources.as_mut_ptr(),
            state_count,
            frame,
            sample_rate,
        ) {
            kernel_global!(DSP_SPREAD_RUNTIMES)[spread_slot] = Some(runtime);
            if parallel::failed() {
                return;
            }
            op_index = end_index + 1;
            continue;
        }

        if state_count == 1 {
            for item_index in 0..count {
                kernel_global!(DSP_SPREAD_ITEM_INDEX) = item_index;
                resources[item_index].load_into_workspace();
                set_dsp_repeat_state(state_start, core::slice::from_mut(&mut states[item_index]));
                for template_index in (op_index + 1)..end_index {
                    render_dsp_op::<false>(
                        kernel_global!(DSP_OPS)[template_index],
                        frame,
                        sample_rate,
                        left_sample,
                        right_sample,
                        None,
                        Some(&mut resources[item_index]),
                    );
                }
                clear_dsp_repeat_state();
                resources[item_index].save_from_workspace();
            }
        } else {
            for item_index in 0..count {
                kernel_global!(DSP_SPREAD_ITEM_INDEX) = item_index;
                let item_state_start = item_index.saturating_mul(state_count);
                resources[item_index].load_into_workspace();
                set_dsp_repeat_state(
                    state_start,
                    &mut states[item_state_start..item_state_start + state_count],
                );
                for template_index in (op_index + 1)..end_index {
                    render_dsp_op::<false>(
                        kernel_global!(DSP_OPS)[template_index],
                        frame,
                        sample_rate,
                        left_sample,
                        right_sample,
                        None,
                        Some(&mut resources[item_index]),
                    );
                }
                clear_dsp_repeat_state();
                resources[item_index].save_from_workspace();
            }
        }
        kernel_global!(DSP_SPREAD_RUNTIMES)[spread_slot] = Some(runtime);
        op_index = end_index + 1;
    }
}

/// Shared scalar graph execution. Input/event delivery is adapter-owned; graph
/// scheduling, value smoothing and monitoring are identical for every adapter.
unsafe fn render_shared_frame(frame: usize, sample_rate: f64, alpha: f64) -> (f64, f64) {
    advance_dsp_values(alpha);
    let mut left = 0.0;
    let mut right = 0.0;
    render_dsp_ops(frame, sample_rate, &mut left, &mut right, true);
    #[cfg(feature = "parallel")]
    if parallel::failed() {
        return (left, right);
    }
    capture_dsp_meters();
    capture_dsp_scopes();
    (left, right)
}

#[no_mangle]
pub extern "C" fn renderDspProgram(frames: u32, sample_rate: f64) {
    let frames = (frames as usize).min(MAX_WASM_FRAMES);
    if frames == 0 || sample_rate <= 0.0 {
        return;
    }
    let value_smoothing_alpha = dsp_value_smoothing_alpha(sample_rate);

    #[cfg(feature = "parallel")]
    if !parallel::begin_quantum() {
        return;
    }

    unsafe {
        kernel_global!(DSP_SPREAD_CONTEXT) = 0;
        if dspBlockRenderingEnabled() != 0 {
            if let Some(mut plan) =
                (*core::ptr::addr_of_mut!(kernel_global!(DSP_BLOCK_PLAN))).take()
            {
                render_dsp_block(&mut plan, frames, sample_rate, value_smoothing_alpha);
                *core::ptr::addr_of_mut!(kernel_global!(DSP_BLOCK_PLAN)) = Some(plan);
                #[cfg(feature = "parallel")]
                parallel::end_quantum();
                return;
            }
        }
        for frame in 0..frames {
            let mut left_sample = 0.0;
            let mut right_sample = 0.0;
            advance_dsp_midi_note_event();
            let (left, right) = render_shared_frame(frame, sample_rate, value_smoothing_alpha);
            left_sample += left;
            right_sample += right;
            #[cfg(feature = "parallel")]
            if parallel::failed() {
                return;
            }
            kernel_global!(LEFT)[frame] += left_sample as f32;
            kernel_global!(RIGHT)[frame] += right_sample as f32;
        }
    }
    #[cfg(feature = "parallel")]
    parallel::end_quantum();
}

#[no_mangle]
pub extern "C" fn renderDspProgramVoice(
    slot: u32,
    frames: u32,
    sample_rate: f64,
    channel: f64,
    note: f64,
    note_frequency: f64,
    velocity: f64,
    lifecycle_gain: f64,
    voice_age: f64,
    release_age: f64,
    stolen_age: f64,
) {
    let frames = (frames as usize).min(MAX_WASM_FRAMES);
    if frames == 0 || sample_rate <= 0.0 {
        return;
    }

    let voice_slot = (slot as usize).min(MAX_VOICE_SLOTS - 1);
    let base_amp = velocity.clamp(0.0, 1.0) * lifecycle_gain.clamp(0.0, 1.0);
    let value_smoothing_alpha = dsp_value_smoothing_alpha(sample_rate);

    unsafe {
        kernel_global!(DSP_SPREAD_CONTEXT) = voice_slot + 1;
        for index in 0..MAX_DSP_STATE {
            *dsp_state_ptr(index) = kernel_global!(DSP_VOICE_STATES)[voice_slot][index];
        }

        for frame in 0..frames {
            let mut left_sample = 0.0;
            let mut right_sample = 0.0;
            let sample_offset = frame as f64 / sample_rate;
            let age = voice_age + sample_offset;
            let sample_release_age = if release_age < 0.0 {
                -1.0
            } else {
                release_age + sample_offset
            };
            let sample_stolen_age = if stolen_age < 0.0 {
                -1.0
            } else {
                stolen_age + sample_offset
            };
            let steal_gain = if sample_stolen_age < 0.0 {
                1.0
            } else {
                1.0 - smooth_step(sample_stolen_age / VOICE_STEAL_FADE_SECONDS)
            };
            let amp = base_amp * smooth_step(age / VOICE_START_FADE_SECONDS) * steal_gain;

            kernel_global!(DSP_CURRENT_CHANNEL) = channel.round().clamp(1.0, 16.0);
            kernel_global!(DSP_CURRENT_NOTE) = note.clamp(0.0, 127.0);
            kernel_global!(DSP_CURRENT_FREQUENCY) = note_frequency.max(0.0);
            kernel_global!(DSP_CURRENT_VELOCITY) = velocity.clamp(0.0, 1.0);
            kernel_global!(DSP_CURRENT_GATE) =
                if sample_release_age < 0.0 && sample_stolen_age < 0.0 {
                    1.0
                } else {
                    0.0
                };
            kernel_global!(DSP_CURRENT_TRIGGER) = if sample_release_age < 0.0
                && sample_stolen_age < 0.0
                && age <= 1.0 / sample_rate
            {
                1.0
            } else {
                0.0
            };

            advance_dsp_values(value_smoothing_alpha);
            render_dsp_ops(
                frame,
                sample_rate,
                &mut left_sample,
                &mut right_sample,
                false,
            );
            capture_dsp_meters();
            capture_dsp_scopes();
            kernel_global!(LEFT)[frame] += (left_sample * amp) as f32;
            kernel_global!(RIGHT)[frame] += (right_sample * amp) as f32;
        }

        for index in 0..MAX_DSP_STATE {
            kernel_global!(DSP_VOICE_STATES)[voice_slot][index] = *dsp_state_ptr(index);
        }
    }
}

#[no_mangle]
pub extern "C" fn renderVoiceGraph(
    slot: u32,
    frames: u32,
    sample_rate: f64,
    note_frequency: f64,
    velocity: f64,
    lifecycle_gain: f64,
    voice_age: f64,
    release_age: f64,
    stolen_age: f64,
) {
    let frames = (frames as usize).min(MAX_WASM_FRAMES);
    if frames == 0 || sample_rate <= 0.0 {
        return;
    }

    let voice_slot = (slot as usize).min(MAX_VOICE_SLOTS - 1);
    let left = kernel_address!(mut LEFT).cast::<f32>();
    let right = kernel_address!(mut RIGHT).cast::<f32>();
    let base_amp = velocity.clamp(0.0, 1.0) * lifecycle_gain.clamp(0.0, 1.0);

    for frame in 0..frames {
        let stamp = next_stamp();
        let mut left_sample = 0.0;
        let mut right_sample = 0.0;
        let sample_offset = frame as f64 / sample_rate;
        let age = voice_age + sample_offset;
        let sample_release_age = if release_age < 0.0 {
            -1.0
        } else {
            release_age + sample_offset
        };
        let sample_stolen_age = if stolen_age < 0.0 {
            -1.0
        } else {
            stolen_age + sample_offset
        };
        let steal_gain = if sample_stolen_age < 0.0 {
            1.0
        } else {
            1.0 - smooth_step(sample_stolen_age / VOICE_STEAL_FADE_SECONDS)
        };
        let amp = base_amp * smooth_step(age / VOICE_START_FADE_SECONDS) * steal_gain;

        unsafe {
            for link_index in 0..kernel_global!(LINK_COUNT) {
                let link = kernel_global!(LINKS)[link_index];
                if link.to != AUDIO_TARGET || link.from < 0 {
                    continue;
                }
                let source = render_node(
                    link.from as usize,
                    voice_slot,
                    sample_rate,
                    note_frequency,
                    velocity,
                    age,
                    sample_release_age,
                    frame,
                    stamp,
                );
                let modulation = render_link_signal(
                    link_index,
                    source,
                    voice_slot,
                    sample_rate,
                    note_frequency,
                    velocity,
                    age,
                    sample_release_age,
                    frame,
                    stamp,
                    false,
                );
                let signal = modulation.value * amp;
                let (left_gain, right_gain) = pan_gains(modulation.pan);
                left_sample = sanitize_sample(left_sample + signal * left_gain, 8.0);
                right_sample = sanitize_sample(right_sample + signal * right_gain, 8.0);
            }

            *left.add(frame) += left_sample as f32;
            *right.add(frame) += right_sample as f32;
        }

        advance_phases(voice_slot, sample_rate, note_frequency, sample_release_age);
    }
}
