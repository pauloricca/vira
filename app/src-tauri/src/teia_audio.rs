//! One master insert, processed in the existing producer block. No UI/audio IPC.
use crate::decks::{Frame, PRODUCER_FRAMES};
use rtrb::{Consumer, Producer};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering::SeqCst},
    Arc,
};
use teia_kernel::hosted::{ControlEvent, Discontinuity, Instance, TimelineSegment};

pub struct Telemetry {
    pub latest: AtomicU64,
    pub generation: AtomicU64,
    pub peak: AtomicU64,
    pub failures: AtomicU64,
    pub reset_generation: AtomicU64,
    pub repeat_exhaustions: AtomicU64,
    pub clock_running: AtomicBool,
    pub beat: AtomicU64,
    pub bpm: AtomicU64,
    pub timeline_running: AtomicBool,
    pub render_frame: AtomicU64,
    pub alive: AtomicBool,
    pub values: [AtomicU64; 2048],
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn off_and_passthrough_freeze_dsp_and_resume_with_latest_parameter() {
        let prepared: crate::teia::Prepared = serde_json::from_value(serde_json::json!({
            "profile":"native-scalar-v1", "layout":"pause-test", "diagnostics":[], "parameters":[],
            "program":{"version":1,"values":[0.5],"ops":[{"opcode":0,"out":0,"a":0},{"opcode":5,"a":0,"b":0},{"opcode":5,"a":0,"b":1}]}
        })).unwrap();
        let program = crate::teia::validate_prepared(&prepared, 1).unwrap();
        let instance =
            Instance::new(&program, crate::sample_rate::get() as f64, PRODUCER_FRAMES).unwrap();
        let (mut ports, mut driver) = channel();
        driver.silent_bypass = true;
        ports
            .commands
            .push(Command {
                id: 1,
                action: Action::Install {
                    ticket: 0,
                    live: Box::new(Live {
                        instance,
                        generation: 1,
                        values: vec![0.5],
                    }),
                },
            })
            .ok()
            .unwrap();
        driver.commands();
        let mut block = [Frame {
            samples: [0.2, -0.3],
            master_bpm: 120.,
            ..Frame::default()
        }; PRODUCER_FRAMES];
        driver.process(&mut block);
        let rendered = driver
            .live
            .as_ref()
            .unwrap()
            .instance
            .feedback()
            .rendered_frames;
        for passthrough in [false, true] {
            ports
                .commands
                .push(Command {
                    id: 2,
                    action: if passthrough {
                        Action::Passthrough(true)
                    } else {
                        Action::Bypass(true)
                    },
                })
                .ok()
                .unwrap();
            driver.commands();
            for i in 0..300 {
                ports
                    .commands
                    .push(Command {
                        id: 3,
                        action: Action::Values {
                            generation: 1,
                            ticket: 0,
                            values: vec![ControlEvent {
                                offset: 0,
                                value_index: 0,
                                value: i as f64 / 1000.,
                                generation: 1,
                            }]
                            .into_boxed_slice(),
                        },
                    })
                    .ok()
                    .unwrap();
                driver.commands();
                block.fill(Frame {
                    samples: [0.2, -0.3],
                    master_bpm: 120.,
                    ..Frame::default()
                });
                driver.process(&mut block);
                while ports.acks.pop().is_ok() {}
                while ports.retired.pop().is_ok() {}
            }
            assert_eq!(
                driver
                    .live
                    .as_ref()
                    .unwrap()
                    .instance
                    .feedback()
                    .rendered_frames,
                rendered
            );
            assert_eq!(
                block[127].samples,
                if passthrough { [0.2, -0.3] } else { [0.; 2] }
            );
            ports
                .commands
                .push(Command {
                    id: 4,
                    action: Action::Bypass(false),
                })
                .ok()
                .unwrap();
            driver.commands();
        }
        ports
            .commands
            .push(Command {
                id: 5,
                action: Action::Passthrough(false),
            })
            .ok()
            .unwrap();
        driver.commands();
        for _ in 0..4 {
            driver.process(&mut block);
        }
        assert!(
            driver
                .live
                .as_ref()
                .unwrap()
                .instance
                .feedback()
                .rendered_frames
                > rendered
        );
        assert!((block[127].samples[0] - 0.299).abs() < 1e-6);
        assert_eq!(driver.telemetry.failures.load(SeqCst), 0);
    }
}
impl Default for Telemetry {
    fn default() -> Self {
        Self {
            latest: 0.into(),
            generation: 0.into(),
            peak: 0.into(),
            failures: 0.into(),
            reset_generation: 0.into(),
            repeat_exhaustions: 0.into(),
            clock_running: false.into(),
            beat: 0.into(),
            bpm: 120f64.to_bits().into(),
            timeline_running: false.into(),
            render_frame: 0.into(),
            alive: false.into(),
            values: std::array::from_fn(|_| 0.into()),
        }
    }
}
pub struct Live {
    pub instance: Instance,
    pub generation: u64,
    pub values: Vec<f64>,
}
pub enum Action {
    Install {
        ticket: u64,
        live: Box<Live>,
    },
    Values {
        generation: u64,
        ticket: u64,
        values: Box<[ControlEvent]>,
    },
    Bypass(bool),
    Passthrough(bool),
    Clock(bool),
    Reset(u64),
    Remove,
}
pub struct Command {
    pub id: u64,
    pub action: Action,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Status {
    Installed,
    Updated,
    Superseded,
    Stale,
}
#[derive(Clone, Copy)]
pub struct Ack {
    pub id: u64,
    pub generation: u64,
    pub status: Status,
}
pub enum Retired {
    Live(Box<Live>),
    Values(Box<[ControlEvent]>),
}
pub struct Ports {
    pub commands: Producer<Command>,
    pub acks: Consumer<Ack>,
    pub retired: Consumer<Retired>,
}
pub struct Driver {
    pub silent_bypass: bool,
    pub facilities: crate::teia_facilities::Render,
    suspended: bool,
    pub midi: crate::teia_midi::Render,
    midi_output: [teia_kernel::hosted::MidiOutput; 256],
    midi_overflows: u64,
    commands: Consumer<Command>,
    acks: Producer<Ack>,
    retired: Producer<Retired>,
    pub telemetry: Arc<Telemetry>,
    live: Option<Box<Live>>,
    bypass: bool,
    passthrough: bool,
    transition: usize,
    from: [f32; 2],
    last: [f32; 2],
    input: [[f32; PRODUCER_FRAMES]; 2],
    output: [[f32; PRODUCER_FRAMES]; 2],
    previous: Option<TimelineSegment>,
    clock_beat: f64,
    staged: [ControlEvent; 256],
    staged_len: usize,
    pending_ack: Option<Ack>,
}
pub fn channel() -> (Ports, Driver) {
    let (commands, rx) = rtrb::RingBuffer::new(32);
    let (tx, acks) = rtrb::RingBuffer::new(32);
    let (retired, retire_rx) = rtrb::RingBuffer::new(64);
    let telemetry = Arc::new(Telemetry::default());
    (
        Ports {
            commands,
            acks,
            retired: retire_rx,
        },
        Driver {
            silent_bypass: false,
            facilities: crate::teia_facilities::channel(),
            suspended: false,
            midi: crate::teia_midi::channel(),
            midi_output: [teia_kernel::hosted::MidiOutput::default(); 256],
            midi_overflows: 0,
            commands: rx,
            acks: tx,
            retired,
            telemetry,
            live: None,
            bypass: false,
            passthrough: false,
            transition: 0,
            from: [0.; 2],
            last: [0.; 2],
            input: [[0.; PRODUCER_FRAMES]; 2],
            output: [[0.; PRODUCER_FRAMES]; 2],
            previous: None,
            clock_beat: 0.,
            staged: [ControlEvent {
                offset: 0,
                value_index: 0,
                value: 0.,
                generation: 0,
            }; 256],
            staged_len: 0,
            pending_ack: None,
        },
    )
}
impl Drop for Driver {
    fn drop(&mut self) {
        self.telemetry.alive.store(false, SeqCst);
        self.midi.host.generation.store(0, SeqCst);
        self.midi.host.invalidate();
    }
}
impl Driver {
    pub fn commands(&mut self) {
        // Reserve retirement/ack capacity before accepting ownership. No drops on RT.
        if self.retired.slots() < 2 || self.acks.slots() == 0 {
            return;
        }
        let Ok(command) = self.commands.pop() else {
            return;
        };
        let mut status = Status::Updated;
        match command.action {
            Action::Install { ticket, live } => {
                // This CAS is the installation linearization point. A later revision
                // is a later edit, even if its IPC acknowledgement arrives first.
                if self
                    .telemetry
                    .latest
                    .compare_exchange(ticket, ticket, SeqCst, SeqCst)
                    .is_err()
                {
                    status = Status::Superseded;
                    let _ = self.retired.push(Retired::Live(live));
                } else {
                    for (i, value) in live.values.iter().enumerate() {
                        self.telemetry.values[i].store(value.to_bits(), SeqCst);
                    }
                    if let Some(old) = self.live.replace(live) {
                        let _ = self.retired.push(Retired::Live(old));
                    }
                    self.telemetry
                        .generation
                        .store(self.live.as_ref().unwrap().generation, SeqCst);
                    self.midi.host.generation.store(
                        if self.midi.host.ready.load(SeqCst) {
                            self.live.as_ref().unwrap().generation
                        } else {
                            0
                        },
                        SeqCst,
                    );
                    self.midi.host.muted.store(false, SeqCst);
                    self.midi.host.invalidate();
                    self.previous = None;
                    self.staged_len = 0;
                    self.from = self.last;
                    self.transition = crate::sample_rate::fine_frames();
                    self.midi_overflows = 0;
                    self.suspended = false;
                    self.telemetry.reset_generation.store(0, SeqCst);
                    status = Status::Installed;
                }
            }
            Action::Values {
                generation,
                ticket,
                values,
            } => {
                if self.telemetry.latest.load(SeqCst) != ticket {
                    status = Status::Superseded;
                } else if let Some(live) = self.live.as_mut().filter(|l| l.generation == generation)
                {
                    let _ = live;
                    // Controls execute before sample zero of the next full block.
                    for value in values.iter() {
                        // Keep the latest value per parameter while DSP is paused.
                        if let Some(staged) = self.staged[..self.staged_len]
                            .iter_mut()
                            .find(|staged| staged.value_index == value.value_index)
                        {
                            *staged = *value;
                        } else {
                            self.staged[self.staged_len] = *value;
                            self.staged_len += 1;
                        }
                        self.telemetry.values[value.value_index]
                            .store(value.value.to_bits(), SeqCst);
                    }
                } else {
                    status = Status::Stale;
                }
                let _ = self.retired.push(Retired::Values(values));
            }
            Action::Clock(running) => {
                if !running {
                    self.midi.host.invalidate();
                }
                self.telemetry.clock_running.store(running, SeqCst);
            }
            Action::Bypass(bypass) => {
                self.midi.host.invalidate();
                self.bypass = bypass;
                self.from = self.last;
                self.transition = crate::sample_rate::fine_frames();
            }
            Action::Passthrough(passthrough) => {
                self.midi.host.invalidate();
                self.passthrough = passthrough;
                self.from = self.last;
                self.transition = crate::sample_rate::fine_frames();
            }
            Action::Reset(generation) => {
                if self
                    .live
                    .as_ref()
                    .is_some_and(|l| l.generation == generation)
                {
                    self.suspended = true;
                    self.telemetry.reset_generation.store(generation, SeqCst);
                    self.midi.host.invalidate();
                } else {
                    status = Status::Stale;
                }
            }
            Action::Remove => {
                self.suspended = false;
                self.telemetry.reset_generation.store(0, SeqCst);
                if let Some(old) = self.live.take() {
                    let _ = self.retired.push(Retired::Live(old));
                }
                self.telemetry.generation.store(0, SeqCst);
                self.midi.host.generation.store(0, SeqCst);
                self.midi.host.invalidate();
                self.from = self.last;
                self.transition = crate::sample_rate::fine_frames();
                self.previous = None;
                self.telemetry.clock_running.store(false, SeqCst);
                self.clock_beat = 0.;
            }
        }
        self.pending_ack = Some(Ack {
            id: command.id,
            generation: self.telemetry.generation.load(SeqCst),
            status,
        });
    }
    pub fn needs_process(&self) -> bool {
        self.live.is_some() || self.pending_ack.is_some()
    }
    pub fn process(&mut self, block: &mut [Frame; PRODUCER_FRAMES]) {
        self.process_inputs(block, None);
    }
    pub fn process_routed(
        &mut self,
        block: &mut [Frame; PRODUCER_FRAMES],
        inputs: &[[[f32; PRODUCER_FRAMES]; 2]],
    ) {
        self.process_inputs(block, Some(inputs));
    }
    fn process_inputs(
        &mut self,
        block: &mut [Frame; PRODUCER_FRAMES],
        routed: Option<&[[[f32; PRODUCER_FRAMES]; 2]]>,
    ) {
        if self.midi.host.reset.swap(false, SeqCst) {
            if let Some(live) = self.live.as_ref() {
                self.suspended = true;
                self.telemetry
                    .reset_generation
                    .store(live.generation, SeqCst);
                self.facilities.host.epoch.fetch_add(1, SeqCst);
            }
            self.previous = None;
        }
        self.facilities
            .boundary(self.live.as_mut().map(|l| &mut l.instance));
        if self.bypass || self.passthrough {
            // Service control/editor requests without advancing the DSP, its clock,
            // observers or input buffers. Parameter updates wait for reactivation.
            self.previous = None;
            self.midi.discard_input();
            self.telemetry.timeline_running.store(false, SeqCst);
            self.telemetry.peak.store(0f64.to_bits(), SeqCst);
            self.finish_block(block, routed, false);
            return;
        }
        for (i, frame) in block.iter().enumerate() {
            for c in 0..2 {
                self.input[c][i] = frame.samples[c];
            }
        }
        let mut timeline = [TimelineSegment {
            offset: 0,
            render_frame: 0,
            beat: 0.,
            bpm: 120.,
            running: false,
            discontinuity: Discontinuity::None,
        }; PRODUCER_FRAMES];
        for (i, frame) in block.iter().enumerate() {
            let decks_running = (0..2).any(|d| frame.playing[d] && !frame.launch_pending[d]);
            let running = decks_running || self.telemetry.clock_running.load(SeqCst);
            if decks_running {
                self.clock_beat = frame.global_beat;
            }
            let mut segment = TimelineSegment {
                offset: i,
                render_frame: frame.output_frame,
                beat: if decks_running {
                    frame.global_beat
                } else {
                    self.clock_beat
                },
                bpm: frame.master_bpm,
                running,
                discontinuity: Discontinuity::None,
            };
            if let Some(previous) = self.previous {
                let expected = previous.beat
                    + if previous.running {
                        previous.bpm / (60. * (crate::sample_rate::get() as f64))
                    } else {
                        0.
                    };
                if running != previous.running {
                    segment.discontinuity = if running {
                        Discontinuity::Start
                    } else {
                        Discontinuity::Stop
                    };
                } else if segment.render_frame != previous.render_frame + 1
                    || (segment.beat - expected).abs() > 1e-8
                {
                    segment.discontinuity = Discontinuity::Seek;
                }
            } else {
                segment.discontinuity = Discontinuity::Seek;
            }
            self.previous = Some(segment);
            timeline[i] = segment;
            if running {
                self.clock_beat =
                    segment.beat + segment.bpm / (60. * (crate::sample_rate::get() as f64));
            }
        }
        let mut valid = false;
        if let Some(live) = self.live.as_mut().filter(|_| !self.suspended) {
            let [left, right] = &mut self.output;
            let mut events: [teia_kernel::hosted::Event; 256] = std::array::from_fn(|i| {
                let value = self.staged[i];
                teia_kernel::hosted::Event {
                    offset: value.offset,
                    kind: teia_kernel::hosted::EventKind::Control {
                        value_index: value.value_index,
                        value: value.value,
                        generation: value.generation,
                    },
                }
            });
            let midi_epoch = self.midi.host.epoch.load(SeqCst);
            let first_frame = block[0].output_frame;
            self.midi.prepare_input(midi_epoch);
            let mut event_count = self.staged_len;
            while event_count < events.len() {
                let Some(event) = self.midi.input_before(first_frame + PRODUCER_FRAMES as u64)
                else {
                    break;
                };
                if event.generation != live.generation || event.epoch != midi_epoch {
                    continue;
                }
                if event.frame < first_frame {
                    self.midi.host.late_inputs.fetch_add(1, SeqCst);
                }
                events[event_count] = teia_kernel::hosted::Event {
                    offset: event.frame.saturating_sub(first_frame) as usize,
                    kind: event.kind,
                };
                event_count += 1;
            }
            // Stable insertion sort preserves input ordering at equal offsets,
            // including controls before MIDI. Fixed storage, no allocation.
            for i in 1..event_count {
                let event = events[i];
                let mut j = i;
                while j > 0 && events[j - 1].offset > event.offset {
                    events[j] = events[j - 1];
                    j -= 1;
                }
                events[j] = event;
            }
            let result = if let Some(inputs) = routed {
                live.instance.process_host_routed(
                    [&self.input[0], &self.input[1]],
                    inputs,
                    [left, right],
                    &events[..event_count],
                    &timeline,
                    &mut self.midi_output,
                )
            } else {
                live.instance.process_host(
                    [&self.input[0], &self.input[1]],
                    [left, right],
                    &events[..event_count],
                    &timeline,
                    &mut self.midi_output,
                )
            };
            valid = result.is_ok();
            if let Ok(count) = result {
                if !self.bypass
                    && !self.passthrough
                    && self.midi.host.generation.load(SeqCst) == live.generation
                {
                    for event in self.midi_output[..count].iter().copied() {
                        self.midi.output(crate::teia_midi::Output {
                            epoch: midi_epoch,
                            generation: live.generation,
                            frame: first_frame + event.offset as u64,
                            event,
                        });
                    }
                }
            }
            if !valid {
                self.midi.host.mute();
                self.telemetry.failures.fetch_add(1, SeqCst);
            }
            self.facilities.collect(&mut live.instance);
            let feedback = live.instance.feedback();
            let overflows = feedback
                .midi_output_overflows
                .saturating_sub(self.midi_overflows);
            if overflows != 0 {
                self.midi.host.output_drops.fetch_add(overflows, SeqCst);
                self.midi.host.mute();
            }
            self.midi_overflows = feedback.midi_output_overflows;
            self.telemetry
                .repeat_exhaustions
                .store(feedback.repeat_exhaustions, SeqCst);
            self.telemetry.beat.store(feedback.beat.to_bits(), SeqCst);
            self.telemetry.bpm.store(feedback.bpm.to_bits(), SeqCst);
            self.telemetry
                .timeline_running
                .store(feedback.running, SeqCst);
            self.telemetry
                .render_frame
                .store(feedback.render_frame, SeqCst);
            self.telemetry
                .peak
                .store((live.instance.feedback().peak as f64).to_bits(), SeqCst);
        }
        self.staged_len = 0;
        self.finish_block(block, routed, valid);
    }
    fn finish_block(
        &mut self,
        block: &mut [Frame; PRODUCER_FRAMES],
        routed: Option<&[[[f32; PRODUCER_FRAMES]; 2]]>,
        valid: bool,
    ) {
        if let Some(ack) = self.pending_ack.take() {
            let _ = self.acks.push(ack);
        }
        for (i, frame) in block.iter_mut().enumerate() {
            let target = if self.bypass && self.silent_bypass {
                [0.; 2]
            } else if self.passthrough && !self.bypass {
                // All exposed stereo inputs feed the patch's existing audio output.
                // Sum before the final safety clamp, preserving left/right channels.
                routed.map_or(frame.samples, |inputs| {
                    inputs.iter().fold([0.; 2], |sum, input| {
                        [sum[0] + input[0][i], sum[1] + input[1][i]]
                    })
                })
            } else if valid && !self.bypass {
                [self.output[0][i], self.output[1][i]]
            } else {
                if self.silent_bypass {
                    [0.; 2]
                } else {
                    frame.samples
                }
            };
            let alpha = if self.transition > 0 {
                let alpha = 1. - self.transition as f32 / crate::sample_rate::fine_frames() as f32;
                self.transition -= 1;
                alpha
            } else {
                1.
            };
            for c in 0..2 {
                frame.samples[c] = (self.from[c] * (1. - alpha) + target[c] * alpha).clamp(-1., 1.);
            }
            self.last = frame.samples;
        }
    }
}
