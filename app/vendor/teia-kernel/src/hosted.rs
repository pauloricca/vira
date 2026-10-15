//! Owned native adapter for the shared Teia preparation and graph evaluator.
//! Resource preparation and explicit repeat budgets happen off-render.
use super::*;
#[path = "hosted_resources.rs"]
mod resources;
pub use resources::*;
#[path = "hosted_observation.rs"]
mod observation;
pub use observation::*;
use std::cell::Cell;
use std::marker::PhantomData;

pub const API_VERSION: u32 = 1;
pub const PROFILE: &str = "native-scalar-v1";
pub const MAX_BLOCK_FRAMES: usize = MAX_WASM_FRAMES;
pub const MAX_EVENTS: usize = 256;
pub const MAX_MIDI_OUTPUT: usize = 4096;
static NEXT_OWNER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
const MAX_HELD_NOTES: usize = 16 * 128;

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    Version,
    Configuration,
    Capacity,
    UnsupportedOpcode(usize),
    InvalidOperation(usize),
    InvalidValues,
    MissingResource(&'static str),
    StaleGeneration,
    InvalidBlock,
    UnsupportedEvent,
    EventOverflow,
    InvalidTimeline,
}
#[derive(Clone, Copy, Debug)]
pub struct Operation {
    pub opcode: i32,
    pub out: i32,
    pub a: i32,
    pub b: i32,
    pub c: i32,
    pub d: i32,
    pub e: i32,
    pub state: i32,
    pub value: f64,
    pub value2: f64,
    pub value3: f64,
    pub value4: f64,
}
/// Immutable executable. Decode/validate JSON and construct this off-render.
pub struct PreparedProgram {
    ops: Vec<DspOp>,
    values: Vec<f64>,
    generation: u64,
    needs_timeline: bool,
}
impl PreparedProgram {
    pub fn prepare(
        version: u32,
        generation: u64,
        operations: &[Operation],
        values: &[f64],
    ) -> Result<Self, Error> {
        if version != 1 {
            return Err(Error::Version);
        }
        if generation == 0 || operations.len() > MAX_DSP_OPS || values.len() > MAX_DSP_VALUES {
            return Err(Error::Capacity);
        }
        if values.iter().any(|v| !v.is_finite()) {
            return Err(Error::InvalidValues);
        }
        let ops: Vec<DspOp> = operations
            .iter()
            .map(|op| DspOp {
                opcode: op.opcode,
                out: op.out,
                a: op.a,
                b: op.b,
                c: op.c,
                d: op.d,
                e: op.e,
                state: op.state,
                value: op.value,
                value2: op.value2,
                value3: op.value3,
                value4: op.value4,
            })
            .collect();
        validate_engine_program(&ops, values.len()).map_err(Error::InvalidOperation)?;
        let needs_timeline = ops.iter().any(|op| op.opcode == DSP_OP_TEMPO);
        Ok(Self {
            ops,
            values: values.to_vec(),
            generation,
            needs_timeline,
        })
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
}
#[derive(Clone, Copy, Debug)]
pub struct ControlEvent {
    pub offset: usize,
    pub value_index: usize,
    pub value: f64,
    pub generation: u64,
}
#[derive(Clone, Copy, Debug)]
pub enum EventKind {
    Control {
        value_index: usize,
        value: f64,
        generation: u64,
    },
    NoteOn {
        channel: u8,
        note: u8,
        velocity: f64,
    },
    NoteOff {
        channel: u8,
        note: u8,
    },
    ControlChange {
        channel: u8,
        controller: u8,
        value: f64,
    },
    /// 14-bit MIDI value, center 8192; explicit host bend sensitivity 0..48 semitones.
    PitchBend {
        channel: u8,
        value: u16,
        range_semitones: f64,
    },
    UnsupportedMidi {
        status: u8,
    },
}
#[derive(Clone, Copy, Debug)]
pub struct Event {
    pub offset: usize,
    pub kind: EventKind,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Discontinuity {
    None,
    Start,
    Stop,
    Seek,
    Loop,
}
#[derive(Clone, Copy, Debug)]
pub struct TimelineSegment {
    pub offset: usize,
    pub render_frame: u64,
    pub beat: f64,
    pub bpm: f64,
    pub running: bool,
    pub discontinuity: Discontinuity,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum MidiOutputKind {
    NoteOn,
    NoteOff,
    ControlChange,
}
#[derive(Clone, Copy, Debug)]
pub struct MidiOutput {
    pub offset: usize,
    pub kind: MidiOutputKind,
    pub channel: u8,
    pub number: u8,
    pub value: f64,
}
impl Default for MidiOutput {
    fn default() -> Self {
        Self {
            offset: 0,
            kind: MidiOutputKind::NoteOff,
            channel: 1,
            number: 0,
            value: 0.0,
        }
    }
}
#[derive(Default, Clone, Copy, Debug)]
pub struct Feedback {
    pub generation: u64,
    pub rendered_frames: u64,
    pub rejected_blocks: u64,
    pub event_overflows: u64,
    pub midi_output_overflows: u64,
    pub repeat_exhaustions: u64,
    pub held_notes: usize,
    pub queued_notes: usize,
    pub has_timeline: bool,
    pub peak: f32,
    pub render_frame: u64,
    pub beat: f64,
    pub bpm: f64,
    pub running: bool,
}
/// Exclusive ownership may move off-render; !Sync + &mut processing prevent
/// concurrent mutation. All preparation/allocation/destruction are off-render.
pub struct Instance {
    state: Box<native_state::KernelState>,
    sample_rate: f64,
    max_block: usize,
    generation: u64,
    identity: Identity,
    root_buffer_states: Vec<u32>,
    needs_timeline: bool,
    feedback: Feedback,
    smooth_controls: bool,
    observation: Option<ObservationPlan>,
    owner: u64,
    capture_epoch: u64,
    capture_serial: u64,
    captures: [u64; MAX_DSP_BUFFER_SLOTS],
    _owner: PhantomData<Cell<()>>,
}
// SAFETY: each instance owns its program/resources; temporary repeat-state
// pointers are installed/restored only during exclusive processing. ACTIVE is scoped/restored per call, so moving an idle owner shares no state.
unsafe impl Send for Instance {}
impl Instance {
    pub fn new(
        prepared: &PreparedProgram,
        sample_rate: f64,
        max_block: usize,
    ) -> Result<Self, Error> {
        Self::new_with_resources(prepared, sample_rate, max_block, &Resources::default())
    }
    pub fn new_with_resources(
        prepared: &PreparedProgram,
        sample_rate: f64,
        max_block: usize,
        resources: &Resources,
    ) -> Result<Self, Error> {
        resources.validate_requirements(&prepared.ops)?;
        if !sample_rate.is_finite()
            || !(8000.0..=384000.0).contains(&sample_rate)
            || max_block == 0
            || max_block > MAX_BLOCK_FRAMES
        {
            return Err(Error::Configuration);
        }
        let mut state = native_state::KernelState::new();
        state.DSP_STEREO_INPUT_ENABLED = true;
        // Exactly the same installation/cache/resource preparation as WASM.
        let installed = native_state::enter(&mut state, || -> Result<(), Error> {
            let waves = resources.install()?;
            for (index, value) in prepared.values.iter().enumerate() {
                setDspValue(index as u32, *value);
            }
            for source in &prepared.ops {
                let mut op = *source;
                if op.opcode == DSP_OP_OSC && op.a == 9 {
                    op.value = waves[op.value as usize] as f64;
                }
                if op.opcode == DSP_OP_END_TRIGGER && op.value >= 0.5 {
                    op.b = waves[op.b as usize];
                }
                if addDspOp(
                    op.opcode, op.out, op.a, op.b, op.c, op.d, op.e, op.state, op.value, op.value2,
                    op.value3, op.value4,
                ) < 0
                {
                    return Err(Error::Capacity);
                }
            }
            resources.restore_buffers(sample_rate)?;
            if let Some(capacity) = resources.repeat_capacity {
                if prepareDspRealtime(capacity, resources.repeat_memory_budget) < 0 {
                    return Err(Error::Capacity);
                }
            }
            Ok(())
        });
        installed?;
        // Bounded resources are allocated before the execution-thread handoff.
        state.DSP_MIDI_HELD_NOTES = Some(Vec::with_capacity(MAX_HELD_NOTES));
        state.DSP_MIDI_NOTE_EVENTS = Some(VecDeque::with_capacity(4096));
        state.DSP_MIDI_OUTPUT_EVENTS = Some(VecDeque::with_capacity(MAX_DSP_OPS));
        Ok(Self {
            state,
            observation: None,
            owner: NEXT_OWNER.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            capture_epoch: 0,
            capture_serial: 0,
            captures: [0; MAX_DSP_BUFFER_SLOTS],
            sample_rate,
            max_block,
            generation: prepared.generation,
            identity: prepared.identity(),
            root_buffer_states: prepared
                .ops
                .iter()
                .filter(|op| {
                    op.opcode == DSP_OP_BUFFER
                        && observation::root_buffer(&prepared.ops, op.state as u32)
                })
                .map(|op| op.state as u32)
                .collect(),
            smooth_controls: false, // Version-1 compatibility; opt into standalone smoothing below.
            needs_timeline: prepared.needs_timeline,
            feedback: Feedback {
                generation: prepared.generation,
                ..Feedback::default()
            },
            _owner: PhantomData,
        })
    }
    /// Select standalone target smoothing, or explicit immediate controls used
    /// by the original version-1 host API. Configure outside the render callback.
    pub fn set_control_smoothing(&mut self, enabled: bool) {
        self.smooth_controls = enabled;
    }
    pub fn memory_bytes() -> usize {
        std::mem::size_of::<native_state::KernelState>()
            + MAX_HELD_NOTES * std::mem::size_of::<DspMidiHeldNote>()
            + MAX_DSP_OPS * std::mem::size_of::<DspMidiNoteEvent>()
    }
    pub fn feedback(&self) -> Feedback {
        self.feedback
    }
    pub fn dispose(self) {
        drop(self);
    }
    pub fn reset(&mut self) {
        self.capture_epoch += 1;
        self.captures.fill(0);
        self.state.DSP_BUFFER_FROZEN.fill(false);
        native_state::enter(&mut self.state, || resetDspRuntimeState());
        self.state.HOST_PITCH_BEND.fill(0.0);
        self.state.DSP_MIDI_CC_VALUES.fill([0.0; 128]);
        self.state.HOST_TIMELINE_ACTIVE = false;
        self.feedback.rendered_frames = 0;
        self.feedback.peak = 0.0;
        self.feedback.running = false;
        self.state.HOST_RUNNING = false;
        self.state.HOST_FRAME = 0;
        self.state.HOST_BEAT = 0.0;
        self.state.HOST_PREVIOUS_BEAT = 0.0;
        self.feedback.render_frame = 0;
        self.feedback.beat = 0.0;
        self.feedback.repeat_exhaustions = self.state.DSP_REPEAT_EXHAUSTIONS;
        self.feedback.held_notes = 0;
        self.feedback.queued_notes = 0;
    }
    /// Compatibility convenience for numeric controls and no host timeline/MIDI.
    pub fn process(
        &mut self,
        input: [&[f32]; 2],
        output: [&mut [f32]; 2],
        controls: &[ControlEvent],
    ) -> Result<(), Error> {
        let result = self
            .process_inner(input, output, controls, &[], &[], &mut [])
            .map(|_| ());
        if result.is_err() {
            self.feedback.rejected_blocks += 1;
        }
        result
    }
    /// All events at an offset apply in supplied order before evaluating that
    /// sample. Monophonic MIDI uses last-note priority while retaining all held
    /// keys. Note pulses use the shared bounded queue with blank separators.
    pub fn process_host(
        &mut self,
        input: [&[f32]; 2],
        output: [&mut [f32]; 2],
        events: &[Event],
        timeline: &[TimelineSegment],
        midi_output: &mut [MidiOutput],
    ) -> Result<usize, Error> {
        let result = self.process_inner(input, output, &[], events, timeline, midi_output);
        if result.is_err() {
            self.feedback.rejected_blocks += 1;
        }
        result
    }
    fn validate_control(&self, index: usize, value: f64, generation: u64) -> Result<(), Error> {
        if generation != self.generation {
            return Err(Error::StaleGeneration);
        }
        if index >= MAX_DSP_VALUES || !self.state.DSP_VALUE_INITIALIZED[index] || !value.is_finite()
        {
            return Err(Error::InvalidBlock);
        }
        Ok(())
    }
    fn validate_timeline(&self, timeline: &[TimelineSegment], frames: usize) -> Result<(), Error> {
        if timeline.is_empty() {
            return if self.needs_timeline {
                Err(Error::InvalidTimeline)
            } else {
                Ok(())
            };
        }
        if timeline.len() > MAX_EVENTS || timeline[0].offset != 0 {
            return Err(Error::InvalidTimeline);
        }
        for (index, segment) in timeline.iter().enumerate() {
            if segment.offset >= frames
                || !segment.beat.is_finite()
                || segment.beat.abs() > 1e6
                || !segment.bpm.is_finite()
                || !(1.0..=999.0).contains(&segment.bpm)
                || segment
                    .render_frame
                    .checked_add((frames - segment.offset) as u64)
                    .is_none()
            {
                return Err(Error::InvalidTimeline);
            }
            if index > 0 {
                let prev = timeline[index - 1];
                if segment.offset <= prev.offset {
                    return Err(Error::InvalidTimeline);
                }
                if segment.discontinuity == Discontinuity::None {
                    let count = (segment.offset - prev.offset) as u64;
                    let beat = prev.beat
                        + if prev.running {
                            count as f64 * prev.bpm / (60.0 * self.sample_rate)
                        } else {
                            0.0
                        };
                    if segment.render_frame != prev.render_frame + count
                        || (segment.beat - beat).abs() > 1e-8
                    {
                        return Err(Error::InvalidTimeline);
                    }
                }
            } else if self.state.HOST_TIMELINE_ACTIVE
                && segment.discontinuity == Discontinuity::None
            {
                let beat = self.state.HOST_BEAT
                    + if self.state.HOST_RUNNING {
                        self.state.HOST_BPM / (60.0 * self.sample_rate)
                    } else {
                        0.0
                    };
                if self.state.HOST_FRAME.checked_add(1) != Some(segment.render_frame)
                    || (segment.beat - beat).abs() > 1e-8
                {
                    return Err(Error::InvalidTimeline);
                }
            }
        }
        Ok(())
    }
    fn process_inner(
        &mut self,
        input: [&[f32]; 2],
        output: [&mut [f32]; 2],
        controls: &[ControlEvent],
        events: &[Event],
        timeline: &[TimelineSegment],
        midi_output: &mut [MidiOutput],
    ) -> Result<usize, Error> {
        let frames = output[0].len();
        if frames == 0
            || frames > self.max_block
            || output[1].len() != frames
            || input
                .iter()
                .any(|c| c.len() != frames || c.iter().any(|v| !v.is_finite()))
            || midi_output.len() > MAX_MIDI_OUTPUT
        {
            return Err(Error::InvalidBlock);
        }
        if controls.len() + events.len() > MAX_EVENTS {
            self.feedback.event_overflows += 1;
            return Err(Error::EventOverflow);
        }
        for (index, event) in controls.iter().enumerate() {
            if event.offset >= frames || (index > 0 && event.offset < controls[index - 1].offset) {
                return Err(Error::InvalidBlock);
            }
            self.validate_control(event.value_index, event.value, event.generation)?;
        }
        for (index, event) in events.iter().enumerate() {
            if event.offset >= frames || (index > 0 && event.offset < events[index - 1].offset) {
                return Err(Error::InvalidBlock);
            }
            match event.kind {
                EventKind::Control {
                    value_index,
                    value,
                    generation,
                } => self.validate_control(value_index, value, generation)?,
                EventKind::NoteOn {
                    channel,
                    note,
                    velocity,
                } if (1..=16).contains(&channel)
                    && note < 128
                    && velocity.is_finite()
                    && (0.0..=1.0).contains(&velocity) => {}
                EventKind::NoteOff { channel, note }
                    if (1..=16).contains(&channel) && note < 128 => {}
                EventKind::ControlChange {
                    channel,
                    controller,
                    value,
                } if (1..=16).contains(&channel)
                    && controller < 128
                    && value.is_finite()
                    && (0.0..=1.0).contains(&value) => {}
                EventKind::PitchBend {
                    channel,
                    value,
                    range_semitones,
                } if (1..=16).contains(&channel)
                    && value <= 16383
                    && range_semitones.is_finite()
                    && (0.0..=48.0).contains(&range_semitones) => {}
                _ => return Err(Error::UnsupportedEvent),
            }
        }
        let queued_notes = self
            .state
            .DSP_MIDI_NOTE_EVENTS
            .as_ref()
            .map_or(0, |q| q.len());
        let new_notes = events
            .iter()
            .filter(|e| matches!(e.kind, EventKind::NoteOn { .. } | EventKind::NoteOff { .. }))
            .count();
        if queued_notes + new_notes > 4096 {
            self.feedback.event_overflows += 1;
            return Err(Error::EventOverflow);
        }
        self.validate_timeline(timeline, frames)?;
        // All validation above precedes output/state mutation.
        self.state.INPUT_LEFT[..frames].copy_from_slice(input[0]);
        self.state.INPUT_RIGHT[..frames].copy_from_slice(input[1]);
        for frame in 0..frames {
            self.state.INPUT[frame] = (input[0][frame] + input[1][frame]) * 0.5;
        }
        if timeline.is_empty() {
            self.state.HOST_TIMELINE_ACTIVE = false;
        }
        let sample_rate = self.sample_rate;
        let smoothing_alpha = dsp_value_smoothing_alpha(sample_rate);
        let smooth_controls = self.smooth_controls;
        let state = &mut self.state;
        let mut peak = 0.0_f32;
        let mut output_count = 0;
        let mut overflow = 0_u64;
        native_state::enter(state, || unsafe {
            beginDspRenderQuantum();
            let mut next_control = 0;
            let mut next_event = 0;
            let mut segment_index = 0;
            for frame in 0..frames {
                kernel_global!(DSP_MIDI_MONO_TRIGGERS).fill(0.0);
                kernel_global!(DSP_MIDI_CURRENT_EVENT_ACTIVE) = false;
                if !timeline.is_empty() {
                    if segment_index + 1 < timeline.len()
                        && timeline[segment_index + 1].offset == frame
                    {
                        segment_index += 1;
                    }
                    let segment = timeline[segment_index];
                    let beat = segment.beat
                        + if segment.running {
                            (frame - segment.offset) as f64 * segment.bpm / (60.0 * sample_rate)
                        } else {
                            0.0
                        };
                    deliver_dsp_host_position(
                        segment.render_frame + (frame - segment.offset) as u64,
                        beat,
                        segment.bpm,
                        segment.running,
                        frame == segment.offset && segment.discontinuity != Discontinuity::None,
                    );
                }
                while next_control < controls.len() && controls[next_control].offset == frame {
                    let event = controls[next_control];
                    apply_control(event.value_index, event.value, smooth_controls);
                    next_control += 1;
                }
                while next_event < events.len() && events[next_event].offset == frame {
                    apply_event(events[next_event].kind, smooth_controls);
                    next_event += 1;
                }
                advance_dsp_midi_note_event();
                let (left, right) = render_shared_frame(frame, sample_rate, smoothing_alpha);
                while let Some(event) = kernel_global!(DSP_MIDI_OUTPUT_EVENTS)
                    .as_mut()
                    .unwrap()
                    .pop_front()
                {
                    if output_count < midi_output.len() {
                        midi_output[output_count] = MidiOutput {
                            offset: frame,
                            kind: if event.is_cc {
                                MidiOutputKind::ControlChange
                            } else if event.note_on {
                                MidiOutputKind::NoteOn
                            } else {
                                MidiOutputKind::NoteOff
                            },
                            channel: event.channel as u8,
                            number: event.note as u8,
                            value: event.velocity,
                        };
                        output_count += 1;
                    } else {
                        overflow += 1;
                    } // Drop newest after caller's bounded output buffer fills.
                }
                output[0][frame] = left as f32;
                output[1][frame] = right as f32;
                peak = peak.max((left as f32).abs()).max((right as f32).abs());
            }
        });
        self.feedback.has_timeline = self.state.HOST_TIMELINE_ACTIVE;
        self.feedback.repeat_exhaustions = self.state.DSP_REPEAT_EXHAUSTIONS;
        self.feedback.held_notes = self.state.DSP_MIDI_HELD_NOTES.as_ref().unwrap().len();
        self.feedback.queued_notes = self.state.DSP_MIDI_NOTE_EVENTS.as_ref().unwrap().len();
        self.feedback.rendered_frames += frames as u64;
        self.feedback.peak = peak;
        self.feedback.midi_output_overflows += overflow;
        self.feedback.render_frame = self.state.HOST_FRAME;
        self.feedback.beat = self.state.HOST_BEAT;
        self.feedback.bpm = self.state.HOST_BPM;
        self.feedback.running = self.state.HOST_TIMELINE_ACTIVE && self.state.HOST_RUNNING;
        Ok(output_count)
    }
}
unsafe fn apply_control(index: usize, value: f64, smooth: bool) {
    if smooth {
        setDspValue(index as u32, value);
    } else {
        setDspValueImmediate(index as u32, value);
    }
}
unsafe fn apply_event(kind: EventKind, smooth: bool) {
    match kind {
        EventKind::Control {
            value_index, value, ..
        } => apply_control(value_index, value, smooth),
        EventKind::NoteOn {
            channel,
            note,
            velocity,
        } => kernel_global!(DSP_MIDI_NOTE_EVENTS)
            .as_mut()
            .unwrap()
            .push_back(DspMidiNoteEvent {
                is_cc: false,
                note_on: velocity > 0.0,
                channel: channel as usize,
                note: note as f64,
                velocity,
            }),
        EventKind::NoteOff { channel, note } => kernel_global!(DSP_MIDI_NOTE_EVENTS)
            .as_mut()
            .unwrap()
            .push_back(DspMidiNoteEvent {
                is_cc: false,
                note_on: false,
                channel: channel as usize,
                note: note as f64,
                velocity: 0.0,
            }),
        EventKind::ControlChange {
            channel,
            controller,
            value,
        } => setDspMidiCc(channel as u32, controller as u32, value),
        EventKind::PitchBend {
            channel,
            value,
            range_semitones,
        } => {
            let centered = value as f64 - 8192.0;
            (*native_state::current()).HOST_PITCH_BEND[channel as usize] =
                centered / if centered < 0.0 { 8192.0 } else { 8191.0 } * range_semitones;
            refresh_dsp_midi_mono_values(None);
        }
        EventKind::UnsupportedMidi { .. } => unreachable!("validated before rendering"),
    }
}

#[cfg(test)]
mod equivalence {
    use super::*;
    include!("../tests/fixtures/shared.rs");

    fn compare(name: &str, operations: &[Operation], values: &[f64], resources: &Resources) {
        let prepared = PreparedProgram::prepare(1, 1, operations, values)
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        let mut native = Instance::new_with_resources(&prepared, 48000.0, 128, resources)
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        native.set_control_smoothing(true);
        // The reference invokes the existing standalone exports, under a separate
        // owned state solely to isolate test fixtures. No hosted process calls.
        let mut reference = native_state::KernelState::new();
        native_state::enter(&mut reference, || {
            let waves = resources.install().unwrap();
            setDspStereoInputEnabled(1);
            for (index, value) in values.iter().enumerate() {
                setDspValue(index as u32, *value);
            }
            for source in operations {
                let mut op = *source;
                if op.opcode == DSP_OP_OSC && op.a == 9 {
                    op.value = waves[op.value as usize] as f64;
                }
                if op.opcode == DSP_OP_END_TRIGGER && op.value >= 0.5 {
                    op.b = waves[op.b as usize];
                }
                assert!(
                    addDspOp(
                        op.opcode, op.out, op.a, op.b, op.c, op.d, op.e, op.state, op.value,
                        op.value2, op.value3, op.value4
                    ) >= 0,
                    "{name}"
                );
            }
            resources.restore_buffers(48000.0).unwrap();
            if let Some(capacity) = resources.repeat_capacity {
                assert_eq!(
                    prepareDspRealtime(capacity, resources.repeat_memory_budget),
                    1
                );
            }
        });
        let input: Vec<f32> = (0..128).map(|i| (i as f32 * 0.13).sin() * 0.25).collect();
        for block in 0..6 {
            let mut a = [0.0; 128];
            let mut b = [0.0; 128];
            let controls = if block == 2 && !values.is_empty() {
                vec![ControlEvent {
                    offset: 0,
                    value_index: 0,
                    value: values[0] * 0.5 + 0.1,
                    generation: 1,
                }]
            } else {
                vec![]
            };
            native
                .process([&input, &input], [&mut a, &mut b], &controls)
                .unwrap();
            native_state::enter(&mut reference, || unsafe {
                if let Some(event) = controls.first() {
                    setDspValue(event.value_index as u32, event.value);
                }
                clear(128);
                beginDspRenderQuantum();
                (&mut kernel_global!(INPUT))[..128].copy_from_slice(&input);
                (&mut kernel_global!(INPUT_LEFT))[..128].copy_from_slice(&input);
                (&mut kernel_global!(INPUT_RIGHT))[..128].copy_from_slice(&input);
                renderDspProgram(128, 48000.0);
                for i in 0..128 {
                    assert!(
                        (a[i] - kernel_global!(LEFT)[i]).abs() < 1e-6,
                        "{name} block {block} frame {i}: {} != {}",
                        a[i],
                        kernel_global!(LEFT)[i]
                    );
                    assert!(
                        (b[i] - kernel_global!(RIGHT)[i]).abs() < 1e-6,
                        "{name} right block {block} frame {i}"
                    );
                }
            });
            if block == 3 {
                native.reset();
                native_state::enter(&mut reference, || resetDspRuntimeState());
            }
        }
    }
    #[test]
    fn actual_compiled_graphs_match_standalone_exports() {
        for (name, ops, values, mut resources) in fixtures() {
            if name == "Buffer" {
                resources.buffers.push(Buffer {
                    state: ops
                        .iter()
                        .find(|op| op.opcode == DSP_OP_BUFFER)
                        .unwrap()
                        .state as u32,
                    samples: vec![0.25, -0.5, 0.75, 1.0],
                    sample_rate: 24000.0,
                });
            }
            compare(name, &ops, &values, &resources);
        }
    }
    #[test]
    fn images_and_custom_waves_match_standalone() {
        let resources = Resources {
            images: vec![Image {
                width: 1,
                height: 1,
                rgba: vec![128, 64, 255, 255],
            }],
            custom_waves: vec![CustomWave {
                mode: 0,
                sustain_start: 0.5,
                sustain_end: 0.75,
                points: vec![(0.0, -1.0), (0.5, 1.0), (1.0, -1.0)],
            }],
            ..Resources::default()
        };
        let mut osc = Operation {
            opcode: DSP_OP_OSC,
            out: 1,
            a: 9,
            b: 0,
            c: 0,
            d: -1,
            e: -1,
            state: 0,
            value: 0.0,
            value2: 0.0,
            value3: 0.0,
            value4: 0.0,
        };
        let value = Operation {
            opcode: 0,
            out: 0,
            a: 0,
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
        let output = Operation {
            opcode: 5,
            out: -1,
            a: 1,
            b: 0,
            ..value
        };
        compare("custom wave", &[value, osc, output], &[220.0], &resources);
        osc = Operation {
            opcode: DSP_OP_IMAGE,
            out: 1,
            a: 0,
            b: 0,
            c: 1,
            state: -1,
            ..osc
        };
        compare("image", &[value, osc, output], &[0.5], &resources);
    }
    #[test]
    fn timestamped_midi_and_transport_match_standalone_delivery() {
        let base = Operation {
            opcode: 0,
            out: 0,
            a: 0,
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
        let ops = [
            base,
            Operation {
                opcode: DSP_OP_MIDI_NOTE,
                out: 1,
                a: 1,
                b: 0,
                ..base
            },
            Operation {
                opcode: DSP_OP_OUTPUT,
                out: -1,
                a: 1,
                b: 0,
                ..base
            },
        ];
        let prepared = PreparedProgram::prepare(1, 1, &ops, &[0.0]).unwrap();
        let mut native = Instance::new(&prepared, 48000.0, 8).unwrap();
        let mut reference = native_state::KernelState::new();
        native_state::enter(&mut reference, || {
            setDspValue(0, 0.0);
            for op in ops {
                assert!(
                    addDspOp(
                        op.opcode, op.out, op.a, op.b, op.c, op.d, op.e, op.state, op.value,
                        op.value2, op.value3, op.value4
                    ) >= 0
                );
            }
        });
        let events = [
            Event {
                offset: 1,
                kind: EventKind::NoteOn {
                    channel: 1,
                    note: 69,
                    velocity: 1.0,
                },
            },
            Event {
                offset: 4,
                kind: EventKind::NoteOff {
                    channel: 1,
                    note: 69,
                },
            },
        ];
        let input = [0.0; 8];
        let mut left = [0.0; 8];
        let mut right = [0.0; 8];
        native
            .process_host(
                [&input, &input],
                [&mut left, &mut right],
                &events,
                &[],
                &mut [],
            )
            .unwrap();
        native_state::enter(&mut reference, || unsafe {
            beginDspRenderQuantum();
            for frame in 0..8 {
                if frame == 1 {
                    queueDspMidiNoteEvent(1, 1, 69.0, 1.0);
                }
                if frame == 4 {
                    queueDspMidiNoteEvent(0, 1, 69.0, 0.0);
                }
                advance_dsp_midi_note_event();
                let (expected, _) =
                    render_shared_frame(frame, 48000.0, dsp_value_smoothing_alpha(48000.0));
                assert_eq!(left[frame], expected as f32);
            }
        });
        let ops = [
            Operation {
                opcode: DSP_OP_VALUE,
                out: 0,
                a: 0,
                ..base
            },
            Operation {
                opcode: DSP_OP_TEMPO,
                out: 1,
                a: 0,
                b: 0,
                c: 15,
                d: 0,
                e: 0,
                ..base
            },
            Operation {
                opcode: DSP_OP_OUTPUT,
                out: -1,
                a: 1,
                b: 0,
                ..base
            },
        ];
        let prepared = PreparedProgram::prepare(1, 1, &ops, &[0.0]).unwrap();
        let mut native = Instance::new(&prepared, 48000.0, 8).unwrap();
        let segments = [
            TimelineSegment {
                offset: 0,
                render_frame: 100,
                beat: 2.0,
                bpm: 120.0,
                running: true,
                discontinuity: Discontinuity::Seek,
            },
            TimelineSegment {
                offset: 4,
                render_frame: 104,
                beat: 3.0,
                bpm: 180.0,
                running: false,
                discontinuity: Discontinuity::Stop,
            },
        ];
        native
            .process_host(
                [&input, &input],
                [&mut left, &mut right],
                &[],
                &segments,
                &mut [],
            )
            .unwrap();
        let mut reference = native_state::KernelState::new();
        native_state::enter(&mut reference, || unsafe {
            setDspValue(0, 0.0);
            for op in ops {
                assert!(
                    addDspOp(
                        op.opcode, op.out, op.a, op.b, op.c, op.d, op.e, op.state, op.value,
                        op.value2, op.value3, op.value4
                    ) >= 0
                );
            }
            for frame in 0..8 {
                let segment = segments[if frame < 4 { 0 } else { 1 }];
                let beat = segment.beat
                    + if segment.running {
                        (frame - segment.offset) as f64 * segment.bpm / (60.0 * 48000.0)
                    } else {
                        0.0
                    };
                deliver_dsp_host_position(
                    segment.render_frame + (frame - segment.offset) as u64,
                    beat,
                    segment.bpm,
                    segment.running,
                    frame == segment.offset,
                );
                let (expected, _) =
                    render_shared_frame(frame, 48000.0, dsp_value_smoothing_alpha(48000.0));
                assert_eq!(left[frame], expected as f32);
            }
        });
    }
    #[test]
    fn snapshot_preparation_matches_standalone_interpolation() {
        let source = [-0.0_f32, 0.25, -0.5, 1.0];
        for source_rate in [24000.0, 48000.0, 96000.0, 44100.0] {
            let mut state = native_state::KernelState::new();
            native_state::enter(&mut state, || unsafe {
                let target = dspBufferPtr(0);
                std::ptr::copy_nonoverlapping(source.as_ptr(), target, source.len());
                let count = restoreDspBufferSnapshot(0, source.len() as u32, source_rate, 48000.0);
                let expected_count = (source.len() as f64 * 48000.0 / source_rate)
                    .round()
                    .clamp(2.0, MAX_DSP_BUFFER_SAMPLES as f64)
                    as usize;
                assert_eq!(count as usize, expected_count);
                for index in 0..expected_count {
                    let position =
                        index as f64 * (source.len() - 1) as f64 / (expected_count - 1) as f64;
                    let left = position.floor() as usize;
                    let right = (left + 1).min(source.len() - 1);
                    let mix = position - left as f64;
                    let expected =
                        (source[left] as f64 * (1.0 - mix) + source[right] as f64 * mix) as f32;
                    assert!((*target.add(index) - expected).abs() < 1e-7);
                }
                assert_eq!(*target.add(expected_count), 0.0);
                assert_eq!(getDspState(3), expected_count as f64 / 48000.0);
            });
        }
    }
}
