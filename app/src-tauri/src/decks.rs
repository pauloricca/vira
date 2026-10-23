//! UI-independent two-deck transport. Only the producer owns these voices.
use crate::{
    dsp::{Dsp, CHUNK},
    source::Source,
    timing::{Grid, Transport},
};
use anyhow::{bail, Result};
use std::sync::Arc;

pub const PRODUCER_FRAMES: usize = 128;
pub const QUEUE_FRAMES: usize = 1024;
pub const MIX_GAIN: f32 = 0.45;

fn crossfader_gains(position: f32, enabled: bool) -> [f32; 2] {
    if !enabled {
        return [1., 1.];
    }
    if position <= -1. {
        return [1., 0.];
    }
    if position >= 1. {
        return [0., 1.];
    }
    let angle = (position + 1.) * std::f32::consts::FRAC_PI_4;
    [angle.cos(), angle.sin()]
}

// Shared by deck automation and library Play All.
#[cfg(test)]
fn transition_fades(progress: f64, bass_swap: bool) -> [f32; 2] {
    transition_fades_at(progress, bass_swap, 0.5)
}
fn transition_fades_at(progress: f64, bass_swap: bool, pivot: f64) -> [f32; 2] {
    let p = progress.clamp(0., 1.) as f32;
    if bass_swap {
        let pivot = pivot.clamp(0.000001, 0.999999) as f32;
        [((1. - p) / (1. - pivot)).min(1.), (p / pivot).min(1.)]
    } else {
        [((1. - p) / 0.8).min(1.), (p / 0.8).min(1.)]
    }
}
fn swap_due(beats: f64, swap_beat: f64, bpm: f64) -> bool {
    // The existing 10 ms EQ ramp completes on the chosen musical beat.
    beats + bpm * 0.010 / 60. >= swap_beat
}
#[cfg(test)]
fn bass_swap_due(beats: f64, length: f64, bpm: f64) -> bool {
    swap_due(beats, length / 2., bpm)
}

/// Pointer targets change at UI rate; retain motion and gain at audio rate.
#[derive(Clone, Copy)]
struct ScrubMotion {
    position: f64,
    target: f64,
    reference: f64,
    reference_step: f64,
    ramp_remaining: usize,
    packet_age: usize,
    velocity: f64,
    envelope: f32,
}
impl ScrubMotion {
    fn new(position: usize) -> Self {
        Self {
            position: position as f64,
            target: position as f64,
            reference: position as f64,
            reference_step: 0.,
            ramp_remaining: 0,
            packet_age: 0,
            velocity: 0.,
            envelope: 0.,
        }
    }
    fn retarget(&mut self, target: usize) {
        // Reconstruct motion between UI packets instead of feeding position
        // steps into the audio follower. A steady drag then has steady speed.
        // Bound the ramp after a long stationary hold or batched commands.
        let rate = crate::sample_rate::get();
        self.ramp_remaining = self.packet_age.clamp(rate / 250, rate / 20);
        self.target = target as f64;
        self.reference_step = (self.target - self.reference) / self.ramp_remaining as f64;
        self.packet_age = 0;
    }
    fn advance(&mut self, start: usize, end: usize) {
        let rate = crate::sample_rate::get() as f64;
        if self.ramp_remaining > 0 {
            self.reference += self.reference_step;
            self.ramp_remaining -= 1;
            if self.ramp_remaining == 0 {
                self.reference = self.target;
            }
        }
        // Critically damped follower: about 40 ms behind the reconstructed motion.
        // This also suppresses small timing variations in delivered UI packets.
        // No velocity or envelope reset when the next pointer packet arrives.
        let omega = 1. / (rate * 0.020);
        self.velocity +=
            omega * omega * (self.reference - self.position) - 2. * omega * self.velocity;
        self.position = (self.position + self.velocity).clamp(start as f64, end as f64);
        if (self.position == start as f64 && self.velocity < 0.)
            || (self.position == end as f64 && self.velocity > 0.)
        {
            self.velocity = 0.;
        }
        if self.ramp_remaining == 0
            && (self.target - self.position).abs() < 0.001
            && self.velocity.abs() < 0.0001
        {
            self.position = self.target;
            self.velocity = 0.;
        }
        let gain = (self.velocity.abs() / 0.05).min(1.) as f32;
        self.envelope += (gain - self.envelope) / (rate as f32 * 0.002);
        if gain == 0. && self.envelope < 0.00001 {
            self.envelope = 0.;
        }
    }
}

/// Four-point Catmull-Rom reconstruction, with repeated edge samples.
/// Used by scrubbing and the vinyl stop; no allocation or filter setup.
fn source_scrub_sample(source: &Source, channel: usize, position: f64, start: usize) -> f32 {
    scrub_interpolate(source.len(), position, start, |index| {
        source.sample(channel, index)
    })
}
#[cfg(test)]
fn scrub_sample(channel: &[f32], position: f64, start: usize) -> f32 {
    scrub_interpolate(channel.len(), position, start, |index| channel[index])
}
fn scrub_interpolate(
    length: usize,
    position: f64,
    start: usize,
    sample: impl Fn(usize) -> f32,
) -> f32 {
    let end = length - 1;
    let index = (position.floor() as usize).clamp(start, end);
    let t = (position - index as f64) as f32;
    let a = sample(index.saturating_sub(1).max(start));
    let b = sample(index);
    let c = sample((index + 1).min(end));
    let d = sample((index + 2).min(end));
    b + 0.5 * t * (c - a + t * (2. * a - 5. * b + 4. * c - d + t * (3. * (b - c) + d - a)))
}

pub struct Voice {
    dsp: Dsp,
    direct_playback: bool,
    pub mixer: crate::mixer::MixerDsp,
    scrub: Option<ScrubMotion>,
    wheel_scrub: Option<(f64, f64, f64, f32)>,
    vinyl_tail: Option<(f64, f64, usize, bool)>, // position, initial speed, frames left, rewind
    pub grid: Option<Grid>,
    pub target_bpm: f64,
    pub pitch_semitones: f64,
    pub click_gain: f32,
    pub click_panel_open: bool,
    pub synced: bool,
    pub launch_beat: Option<f64>,
    pub reposition_seconds: f64,
    pub timing_error: u8,
    clock: Transport,
    tempo_ramp: Option<(f64, usize)>,
    jog: Option<(f64, f64, f64)>, // base speed, remaining frames, smoothed speed offset
    output: u64,
    transition: usize,
    transition_from: [f32; 2],
    jump_tail: Vec<[f32; 2]>,
    jump_scratch: Vec<[f32; 2]>,
    jump_length: usize,
    jump_read: usize,
    last_sample: [f32; 2],
    pre_fader: [f32; 2],
    pub source: Arc<Source>,
    start: usize,
    input: usize,
    pub position: usize,
    pub playing: bool,
    pub cue_position: usize,
    pub hot_cues: [Option<usize>; 4],
    pub cue_identity: Option<Arc<str>>,
    pub cue_preview: bool,
    hot_cue_preview: Option<(usize, usize)>,
    pub loop_start: Option<usize>,
    pub loop_end: Option<usize>,
    pub loop_length: Option<f64>,
    loop_phase_offset: Option<f64>,
    loop_release_beat: Option<f64>,
    pub slip_enabled: bool,
    slip_position: Option<f64>,
    pub gain: f32,
    pub generation: u64,
    pub position_epoch: u64,
    pad: usize,
    skip: usize,
    tail: usize,
    left: [f32; CHUNK],
    right: [f32; CHUNK],
    read: usize,
    available: usize,
}
impl Voice {
    // Construction and buffer reservation occur on the ordinary preparation thread.
    pub fn new(source: Arc<Source>, generation: u64) -> Self {
        let dsp = Dsp::new(3, 1.0, 0.0);
        Self {
            dsp,
            direct_playback: true,
            mixer: crate::mixer::MixerDsp::default(),
            scrub: None,
            wheel_scrub: None,
            vinyl_tail: None,
            grid: None,
            target_bpm: 0.,
            pitch_semitones: 0.,
            click_gain: 0.,
            click_panel_open: false,
            synced: false,
            launch_beat: None,
            reposition_seconds: 0.,
            timing_error: 0,
            clock: Transport {
                output: 0,
                source: 0.,
                speed: 1.,
            },
            output: 0,
            tempo_ramp: None,
            jog: None,
            transition: 0,
            transition_from: [0.; 2],
            jump_tail: vec![[0.; 2]; crate::sample_rate::get() / 10],
            jump_scratch: vec![[0.; 2]; crate::sample_rate::get() / 10],
            jump_length: 0,
            jump_read: 0,
            last_sample: [0.; 2],
            pre_fader: [0.; 2],
            source,
            start: 0,
            input: 0,
            position: 0,
            playing: false,
            cue_position: 0,
            hot_cues: [None; 4],
            cue_identity: None,
            cue_preview: false,
            hot_cue_preview: None,
            loop_start: None,
            loop_end: None,
            loop_length: None,
            loop_phase_offset: None,
            loop_release_beat: None,
            slip_enabled: false,
            slip_position: None,
            gain: 0.8,
            generation,
            position_epoch: 0,
            pad: 0,
            skip: 0,
            tail: 0,
            left: [0.; CHUNK],
            right: [0.; CHUNK],
            read: 0,
            available: 0,
        }
    }
    pub fn set_start(&mut self, seconds: f64) {
        self.start = (seconds * (crate::sample_rate::get() as f64)).round() as usize;
        self.start = self.start.min(self.source.len().saturating_sub(1));
        self.cue_position = self.start;
        self.seek(self.start);
    }
    pub fn restore_hot_cues(&mut self, seconds: [Option<f64>; 4]) {
        self.hot_cues = seconds.map(|seconds| {
            seconds.filter(|s| s.is_finite() && *s >= 0.).map(|s| {
                ((s * crate::sample_rate::get() as f64).round() as usize)
                    .clamp(self.start, self.source.len().saturating_sub(1))
            })
        });
    }
    pub fn seek(&mut self, position: usize) {
        self.seek_inner(position, true);
    }
    fn seek_inner(&mut self, position: usize, reset_mixer: bool) {
        self.vinyl_tail = None;
        self.jump_length = 0;
        self.jump_read = 0;
        self.clear_jog();
        // Retain the accepted reset path; no replacement-stretcher shortcut.
        self.scrub = None;
        self.wheel_scrub = None;
        self.cue_preview = false;
        self.hot_cue_preview = None;
        self.dsp.reset();
        if reset_mixer {
            self.mixer.reset();
        }
        self.launch_beat = None;
        self.position_epoch += 1;
        self.input = position.clamp(self.start, self.source.len());
        self.position = self.input;
        self.clock = Transport {
            output: self.output,
            source: self.input as f64,
            speed: self.clock.speed,
        };
        self.slip_position =
            (self.slip_enabled && self.loop_end.is_some()).then_some(self.position as f64);
        self.transition = crate::sample_rate::fine_frames();
        self.transition_from = self.last_sample;
        self.pad = self.dsp.padding();
        self.skip = self.dsp.delay();
        self.direct_playback = self.clock.speed == 1. && self.pitch_semitones == 0.;
        if self.direct_playback {
            self.pad = 0;
            self.skip = 0;
        }
        self.tail = 0;
        self.read = 0;
        self.available = 0;
        if self.position == self.source.len() {
            self.playing = false;
        }
    }
    fn phrase_jump(&mut self, position: usize, frames: usize) {
        if frames == 0 || !self.playing || self.launch_beat.is_some() {
            self.seek(position);
            return;
        }
        // Render the outgoing continuation on the producer, into buffers reserved
        // at voice construction. Keep the destination clock at the command boundary.
        let frames = frames.min(self.jump_scratch.len());
        let output = self.output;
        let speed = self.clock.speed;
        let tempo_ramp = self.tempo_ramp;
        let previous = self.last_sample;
        for index in 0..frames {
            if self.next_mode::<true>().is_err() {
                self.jump_scratch[index..frames].fill([0.; 2]);
                break;
            }
            self.jump_scratch[index] = self.last_sample;
            if !self.playing {
                self.jump_scratch[index + 1..frames].fill([0.; 2]);
                break;
            }
        }
        self.output = output;
        self.clock.speed = speed;
        self.dsp.ratios(speed, self.pitch_semitones);
        self.tempo_ramp = tempo_ramp;
        self.playing = true;
        self.last_sample = previous;
        self.seek_inner(position, false);
        std::mem::swap(&mut self.jump_tail, &mut self.jump_scratch);
        self.jump_length = frames;
        self.transition = 0;
    }
    pub fn seconds(&self) -> f64 {
        self.clock
            .at(self.output)
            .clamp(self.start as f64, self.source.len() as f64)
            / (crate::sample_rate::get() as f64)
    }
    fn loop_point(&self, snap: bool) -> usize {
        let seconds = self.seconds();
        let seconds = if snap {
            self.grid
                .map_or(seconds, |grid| grid.seconds(grid.beat(seconds).round()))
        } else {
            seconds
        };
        ((seconds * (crate::sample_rate::get() as f64))
            .round()
            .max(0.) as usize)
            .max(self.start)
    }
    pub fn pitch(&mut self, semitones: f64) -> Result<()> {
        if !semitones.is_finite() || !(-6.0..=6.0).contains(&semitones) || semitones.fract() != 0. {
            bail!("Pitch must be a whole semitone between -6 and 6");
        }
        if self.pitch_semitones == semitones {
            return Ok(());
        }
        self.clear_jog();
        let position = self.clock.at(self.output);
        let slip = self.slip_position;
        let launch = self.launch_beat;
        let epoch = self.position_epoch;
        let preview = self.cue_preview;
        let hot_preview = self.hot_cue_preview;
        self.pitch_semitones = semitones;
        self.dsp.ratios(self.clock.speed, semitones);
        self.seek(position.round() as usize);
        self.clock.source = position;
        self.slip_position = slip;
        self.launch_beat = launch;
        self.position_epoch = epoch;
        self.cue_preview = preview;
        self.hot_cue_preview = hot_preview;
        Ok(())
    }
    pub fn tempo(&mut self, target: f64) -> Result<()> {
        self.clear_jog();
        let speed = self
            .grid
            .ok_or_else(|| anyhow::anyhow!("Apply a source grid first"))?
            .speed(target)?;
        self.tempo_ramp = None;
        let position = self.clock.at(self.output);
        let slip_position = self.slip_position;
        self.target_bpm = target;
        self.timing_error = 0;
        self.clock = Transport {
            output: self.output,
            source: position,
            speed,
        };
        // Discard prepared DSP output at this render boundary; re-prime at the new
        // ratio so all subsequent samples and click positions use the same anchor.
        self.dsp.ratios(speed, self.pitch_semitones);
        let epoch = self.position_epoch;
        let launch = self.launch_beat;
        self.seek(position.round() as usize);
        self.slip_position = slip_position;
        self.launch_beat = launch;
        self.position_epoch = epoch; // Ratio re-prime preserves position, unlike an explicit seek.
        self.clock.source = position;
        Ok(())
    }
    fn smooth_tempo(&mut self, target: f64) -> Result<()> {
        self.clear_jog();
        let speed = self
            .grid
            .ok_or_else(|| anyhow::anyhow!("Apply a source grid first"))?
            .speed(target)?;
        if !self.playing {
            return self.tempo(target);
        }
        if self.target_bpm != target {
            // Publish the requested value immediately for controller pickup; the
            // render clock and stretcher follow it together over 80 ms.
            self.target_bpm = target;
            self.tempo_ramp = Some((speed, crate::sample_rate::get() * 80 / 1000));
        }
        self.timing_error = 0;
        Ok(())
    }
    fn advance_tempo_ramp(&mut self) {
        if self.output % PRODUCER_FRAMES as u64 != 0 {
            return;
        }
        if let Some((target, remaining)) = self.tempo_ramp {
            let frames = remaining.min(PRODUCER_FRAMES);
            let speed = if frames == remaining {
                target
            } else {
                self.clock.speed + (target - self.clock.speed) * frames as f64 / remaining as f64
            };
            self.clock = Transport {
                output: self.output,
                source: self.clock.at(self.output),
                speed,
            };
            // Keep buffered audio and DSP history intact during a slider sweep.
            self.dsp.ratios(speed, self.pitch_semitones);
            self.tempo_ramp = (remaining > frames).then_some((target, remaining - frames));
        }
    }
    fn clear_jog(&mut self) {
        if let Some((base, _, _)) = self.jog.take() {
            self.clock = Transport {
                output: self.output,
                source: self.clock.at(self.output),
                speed: base,
            };
            self.dsp.ratios(base, self.pitch_semitones);
        }
    }
    fn advance_jog(&mut self) {
        if self.synced {
            self.clear_jog();
            return;
        }
        if self.output % PRODUCER_FRAMES as u64 != 0 {
            return;
        }
        if let Some((_, remaining, velocity)) = self.jog {
            let base = self.clock.speed;
            // Two-pole movement smoothing, updated at render boundaries without
            // seeking, clearing DSP history, or changing the selected BPM.
            if (base <= 0.05 && remaining < 0.) || (base >= 20. && remaining > 0.) {
                self.clear_jog();
                return;
            }
            let wanted = remaining / (crate::sample_rate::get() as f64 * 0.08);
            let velocity = (velocity + (wanted - velocity) * 0.12)
                .clamp((0.05 - base).max(-base * 0.8), (20. - base).min(base * 0.8));
            self.clock = Transport {
                output: self.output,
                source: self.clock.at(self.output),
                speed: base + velocity,
            };
            self.dsp.ratios(self.clock.speed, self.pitch_semitones);
            let remaining = remaining - velocity * PRODUCER_FRAMES as f64;
            self.jog = Some((base, remaining, velocity));
            if remaining.abs() < 0.01 && velocity.abs() < 0.00001 {
                self.clear_jog();
            }
        }
    }
    fn jog_by(&mut self, seconds: f64) {
        if seconds == 0. || self.cue_preview {
            return;
        }
        if self.playing {
            if self.synced || self.launch_beat.is_some() {
                return;
            }
            let (base, remaining, velocity) = self.jog.unwrap_or((self.clock.speed, 0., 0.));
            self.jog = Some((
                base,
                (remaining + seconds * (crate::sample_rate::get() as f64)).clamp(
                    -10. * crate::sample_rate::get() as f64,
                    10. * crate::sample_rate::get() as f64,
                ),
                velocity,
            ));
        } else {
            let from = self.seconds() * (crate::sample_rate::get() as f64);
            let (position, target, velocity, envelope) =
                self.wheel_scrub.unwrap_or((from, from, 0., 0.));
            let target = (target + seconds * (crate::sample_rate::get() as f64)).clamp(
                self.start as f64,
                self.source.len().saturating_sub(1) as f64,
            );
            if self.wheel_scrub.is_none() {
                self.seek(from.round() as usize);
            }
            self.wheel_scrub = Some((position, target, velocity, envelope));
            self.position_epoch += 1;
        }
    }
    fn set_bass(&mut self, value: f32) {
        self.set_eq(0, value);
    }
    fn set_eq(&mut self, band: usize, value: f32) {
        if self.mixer.settings.eq[band] != value {
            let mut settings = self.mixer.settings;
            settings.eq[band] = value;
            self.mixer.set(settings);
        }
    }
    fn continuous_tempo(&mut self, bpm: f64) {
        self.clear_jog();
        let ramping = self.tempo_ramp.is_some();
        self.tempo_ramp = None;
        if self.target_bpm == bpm && !ramping {
            return;
        }
        if let Some(grid) = self.grid {
            let position = self.clock.at(self.output);
            let speed = bpm / grid.bpm;
            self.clock = Transport {
                output: self.output,
                source: position,
                speed,
            };
            self.target_bpm = bpm;
            self.dsp.ratios(speed, self.pitch_semitones);
        }
    }
    pub fn apply_grid(&mut self, grid: Grid) {
        self.grid = Some(grid);
        self.clear_loop();
        self.synced = false;
        self.launch_beat = None;
        let _ = self.tempo(grid.bpm);
    }
    pub fn play(&mut self) {
        if self.vinyl_tail.is_some() {
            self.seek(self.position);
        }
        self.clear_jog();
        if self.scrub.is_some() || self.wheel_scrub.is_some() {
            self.seek(self.position);
        }
        if self.position >= self.source.len() {
            self.seek(0);
        }
        self.playing = true;
    }
    pub fn stop(&mut self) {
        self.playing = false;
        self.loop_release_beat = None;
        self.seek(0);
    }
    fn halt(&mut self, vinyl: bool, rewind: bool) {
        let audible = self.playing && self.launch_beat.is_none() && !self.cue_preview;
        self.clear_jog();
        self.playing = false;
        self.cue_preview = false;
        self.hot_cue_preview = None;
        self.launch_beat = None;
        if vinyl && audible {
            self.tempo_ramp = None;
            self.scrub = None;
            self.wheel_scrub = None;
            let frames = crate::sample_rate::get() * 300 / 1000;
            self.transition_from = self.last_sample;
            self.vinyl_tail = Some((self.clock.at(self.output), self.clock.speed, frames, rewind));
        } else if rewind {
            self.stop();
        } else if self.wheel_scrub.is_some() || self.vinyl_tail.is_some() {
            self.seek(self.position);
        }
    }
    fn set_slip(&mut self, enabled: bool) {
        self.slip_enabled = enabled;
        self.slip_position =
            (enabled && self.loop_end.is_some()).then_some(self.clock.at(self.output));
    }
    fn begin_slip_if_needed(&mut self) {
        if self.slip_enabled && self.slip_position.is_none() {
            self.slip_position = Some(self.clock.at(self.output));
        }
    }
    fn release_loop(&mut self) {
        let resume = self.slip_position.take();
        self.clear_loop();
        if let Some(position) = resume {
            self.seek(position.round() as usize);
        }
    }
    fn remember_loop_phase(&mut self, global_beat: f64) {
        if self.loop_phase_offset.is_none() {
            self.loop_phase_offset = self.grid.map(|g| global_beat - g.beat(self.seconds()));
        }
        self.loop_release_beat = None;
    }
    fn request_loop_release(&mut self, global_beat: f64, quantum: u8) {
        if self.synced && self.playing && self.slip_position.is_none() {
            if let (Some(grid), Some(end)) = (self.grid, self.loop_end) {
                // Wait for the master's matching phase at OUT, then continue
                // from OUT itself. Only SLIP follows the background playhead.
                let offset = self
                    .loop_phase_offset
                    .unwrap_or(global_beat - grid.beat(self.seconds()));
                let out_phase = grid.beat(end as f64 / (crate::sample_rate::get() as f64)) + offset;
                self.loop_release_beat.get_or_insert_with(|| {
                    let quantum = f64::from(quantum);
                    out_phase + ((global_beat - out_phase - 1e-9) / quantum).ceil() * quantum
                });
                return;
            }
        }
        self.release_loop();
    }
    fn finish_loop_release(&mut self, global_beat: f64, beat_step: f64) {
        if !self.playing || self.launch_beat.is_some() {
            return;
        }
        if !self.synced && self.loop_release_beat.is_some() {
            self.release_loop();
            return;
        }
        // Decks advances the master before rendering this sample; the voice's
        // current position belongs to the beginning of that same sample.
        let now = global_beat - beat_step;
        if let Some(release) = self.loop_release_beat.filter(|beat| now + 1e-9 >= *beat) {
            if let (Some(grid), Some(end)) = (self.grid, self.loop_end) {
                // Account only for the fraction of a sample past the deadline,
                // never for the time the track spent looping.
                let position = end as f64
                    + (now - release).max(0.) * 60. / grid.bpm * (crate::sample_rate::get() as f64);
                self.clear_loop();
                self.seek(position.round().max(0.) as usize);
            }
        }
    }
    fn clear_loop(&mut self) {
        self.loop_start = None;
        self.loop_end = None;
        self.loop_length = None;
        self.loop_phase_offset = None;
        self.loop_release_beat = None;
        self.slip_position = None;
    }
    pub fn next(&mut self) -> Result<[f32; 2]> {
        self.next_mode::<false>()
    }
    fn next_mode<const ROUTED: bool>(&mut self) -> Result<[f32; 2]> {
        self.pre_fader = [0.; 2];
        if self.source.len() == 0 || self.start >= self.source.len() {
            self.playing = false;
            return Ok([0.; 2]);
        }
        if let Some((mut position, speed, remaining, rewind)) = self.vinyl_tail {
            let length = crate::sample_rate::get() * 300 / 1000;
            let progress = remaining as f64 / length as f64;
            // Resampling drops pitch with speed, like a platter braking. Bypass
            // the pitch-preserving stretcher and fade the final 30 ms to silence.
            let gain = (progress * 10.).min(1.) as f32;
            if position as usize >= self.source.loaded() && self.source.loaded() < self.source.len()
            {
                return Ok([0.; 2]);
            }
            let mut sample = [0, 1].map(|channel| {
                source_scrub_sample(&self.source, channel, position, self.start) * gain
            });
            // Blend away from the stretcher output over the first 5 ms.
            let blend =
                ((length - remaining) as f32 / crate::sample_rate::fine_frames() as f32).min(1.);
            for (value, previous) in sample.iter_mut().zip(self.transition_from) {
                *value = previous * (1. - blend) + *value * blend;
            }
            position =
                (position + speed * progress).min(self.source.len().saturating_sub(1) as f64);
            self.position = position.round() as usize;
            self.clock.source = position;
            self.clock.output = self.output;
            self.last_sample = sample;
            if !ROUTED {
                sample = self.mixer.process(sample);
            }
            self.pre_fader = sample;
            if remaining <= 1 {
                if rewind {
                    self.stop();
                } else {
                    self.seek(self.position);
                }
            } else {
                self.vinyl_tail = Some((position, speed, remaining - 1, rewind));
            }
            return Ok(if ROUTED {
                sample
            } else {
                sample.map(|v| v * self.gain)
            });
        }
        if let Some((position, target, velocity, envelope)) = self.wheel_scrub {
            // Critically damped motion retains velocity between MIDI packets.
            // Fade with the movement, including a quiet stop at the destination.
            let velocity = velocity
                + ((target - position) / (crate::sample_rate::get() as f64 * 0.04) - velocity)
                    / (crate::sample_rate::get() as f64 * 0.01);
            let position = (position + velocity).clamp(
                self.start as f64,
                self.source.len().saturating_sub(1) as f64,
            );
            let envelope = envelope
                + ((velocity.abs() / 0.05).min(1.) as f32 - envelope)
                    / (crate::sample_rate::get() as f32 * 0.002);
            let index = position.floor() as usize;
            let next = (index + 1).min(self.source.len() - 1);
            let fraction = (position - position.floor()) as f32;
            if next >= self.source.loaded() && self.source.loaded() < self.source.len() {
                return Ok([0.; 2]);
            }
            let sample = [0, 1].map(|channel| {
                let a = self.source.sample(channel, index);
                (a + (self.source.sample(channel, next) - a) * fraction) * envelope
            });
            self.output += 1;
            self.position = position.round() as usize;
            self.clock.source = position;
            self.clock.output = self.output;
            self.wheel_scrub = Some((position, target, velocity, envelope));
            let sample = if ROUTED {
                sample
            } else {
                self.mixer.process(sample)
            };
            self.last_sample = sample;
            self.pre_fader = sample;
            return Ok(if ROUTED {
                sample
            } else {
                sample.map(|v| v * self.gain)
            });
        }
        if let Some(mut motion) = self.scrub {
            motion.packet_age = motion.packet_age.saturating_add(1);
            if motion.position == motion.target && motion.velocity == 0. && motion.envelope == 0. {
                self.scrub = Some(motion);
                return Ok([0.; 2]);
            }
            motion.advance(self.start, self.source.len() - 1);
            if motion.position as usize >= self.source.loaded()
                && self.source.loaded() < self.source.len()
            {
                return Ok([0.; 2]);
            }
            let sample = [0, 1].map(|channel| {
                source_scrub_sample(&self.source, channel, motion.position, self.start)
                    * motion.envelope
            });
            self.output += 1;
            self.position = motion.position.round() as usize;
            self.clock.source = motion.position;
            self.clock.output = self.output;
            self.scrub = Some(motion);
            let sample = if ROUTED {
                sample
            } else {
                self.mixer.process(sample)
            };
            self.last_sample = sample;
            self.pre_fader = sample;
            return Ok(if ROUTED {
                sample
            } else {
                sample.map(|v| v * self.gain)
            });
        }
        if !self.playing || self.launch_beat.is_some() {
            return Ok([0.; 2]);
        }
        if self.output % PRODUCER_FRAMES as u64 == 0 {
            if let Some((base, _, _)) = self.jog {
                self.clock = Transport {
                    output: self.output,
                    source: self.clock.at(self.output),
                    speed: base,
                };
            }
        }
        self.advance_tempo_ramp();
        self.advance_jog();
        if self.direct_playback && (self.clock.speed != 1. || self.pitch_semitones != 0.) {
            // A smooth tempo/jog change does not seek. Start the stretcher at
            // the current audible source position, discarding only direct-path
            // read-ahead, and blend using the existing 5 ms transition.
            self.direct_playback = false;
            self.dsp.reset();
            self.input =
                (self.clock.at(self.output).round() as usize).clamp(self.start, self.source.len());
            self.read = 0;
            self.available = 0;
            self.pad = self.dsp.padding();
            self.skip = self.dsp.delay();
            self.tail = 0;
            self.transition = crate::sample_rate::fine_frames();
            self.transition_from = self.last_sample;
        }
        if let (Some(start), Some(end)) = (self.loop_start, self.loop_end) {
            if self.clock.at(self.output) >= end as f64 {
                let slip_position = self.slip_position;
                self.seek(start);
                self.slip_position = slip_position;
            }
        }
        // Startup delay grows with sample rate. Allow the reported discard
        // frames as well as the fixed bounded decoding work.
        for _ in 0..self.skip.saturating_add(4096) {
            if self.read < self.available {
                let mut value = [self.left[self.read], self.right[self.read]];
                self.read += 1;
                if self.skip > 0 {
                    self.skip -= 1;
                    continue;
                }
                let seconds = self.seconds();
                let mut click = 0.;
                if let Some(grid) = self
                    .grid
                    .filter(|_| self.click_panel_open && self.click_gain > 0.)
                {
                    let beat = grid.beat(seconds);
                    let fraction = beat.rem_euclid(1.);
                    let age = fraction * 60. / self.target_bpm.max(1.);
                    if age < 0.025 {
                        let downbeat = (beat.floor() as i64).rem_euclid(4) == 0;
                        let frequency = if downbeat { 1600. } else { 1000. };
                        click = (std::f64::consts::TAU * frequency * age).sin() as f32
                            * (1. - age / 0.025) as f32
                            * self.click_gain
                            * if downbeat { 0.7 } else { 0.4 };
                    }
                }
                if self.transition > 0 {
                    let mix =
                        1. - self.transition as f32 / crate::sample_rate::fine_frames() as f32;
                    for (sample, previous) in value.iter_mut().zip(self.transition_from) {
                        *sample = previous * (1. - mix) + *sample * mix;
                    }
                    self.transition -= 1;
                }
                if self.jump_read < self.jump_length {
                    let mix = self.jump_read as f32 / self.jump_length as f32;
                    for (sample, outgoing) in value.iter_mut().zip(self.jump_tail[self.jump_read]) {
                        *sample = outgoing * (1. - mix) + *sample * mix;
                    }
                    self.jump_read += 1;
                }
                self.last_sample = value;
                if !ROUTED {
                    value = self.mixer.process(value);
                }
                self.output += 1;
                if let Some(position) = &mut self.slip_position {
                    *position += self.clock.speed;
                }
                self.position = self
                    .clock
                    .at(self.output)
                    .min(self.source.len() as f64)
                    .round() as usize;
                if self.position >= self.source.len() && self.loop_end.is_none() {
                    self.playing = false;
                }
                self.pre_fader = value.map(|v| v + click);
                // The timing reference click retains its independent volume.
                return Ok(value.map(|v| v * if ROUTED { 1. } else { self.gain } + click));
            }
            if self.direct_playback {
                let n = CHUNK.min(self.source.len().saturating_sub(self.input));
                if n == 0 {
                    self.playing = false;
                    return Ok([0.; 2]);
                }
                let n = self
                    .source
                    .copy(self.input, &mut self.left[..n], &mut self.right[..n]);
                if n == 0 {
                    return Ok([0.; 2]);
                }
                self.input += n;
                self.read = 0;
                self.available = n;
            } else if self.dsp.available() > 0 {
                self.available = self.dsp.retrieve(&mut self.left, &mut self.right);
                self.read = 0;
            } else if self.pad > 0 {
                let n = self.pad.min(CHUNK);
                let zero = [0.; CHUNK];
                self.dsp.process(&zero[..n], &zero[..n], false);
                self.pad -= n;
            } else if self.input < self.source.len() {
                let n = CHUNK.min(self.source.len().saturating_sub(self.input));
                let left = self.source.channel(0, self.input);
                let right = self.source.channel(1, self.input);
                let n = n.min(left.len()).min(right.len());
                if n == 0 {
                    return Ok([0.; 2]);
                }
                self.dsp.process(&left[..n], &right[..n], false);
                self.input += n;
            } else {
                let zero = [0.; CHUNK];
                self.dsp.process(&zero, &zero, false);
                self.tail += CHUNK;
                if self.tail > self.dsp.padding() + self.dsp.delay() * 2 + CHUNK * 8 {
                    bail!("Rubber Band produced a short finite track");
                }
            }
        }
        bail!("Rubber Band made no bounded progress")
    }
}

// Independent library transport, mixed after the cue routing graph.
pub struct Audition {
    pub master: bool,
    pub source: Arc<Source>,
    pub position: usize,
    pub playing: bool,
    pub generation: u64,
    pub index: u64,
    pub sequence: bool,
    pub bars: u8,
    bass_swap: bool,
    smart: bool,
    swap_beat: f64,
    voice: Box<Voice>,
    stretched: bool,
    queued: Option<Box<Audition>>,
    retired: Option<Box<Audition>>,
    overlap_start: usize,
    overlap_beats: f64,
    mixed_beats: f64,
    level: f32,
    stream: Option<crate::audition_stream::Stream>,
}
impl Audition {
    pub fn new(source: Arc<Source>, generation: u64) -> Self {
        let mut voice = Box::new(Voice::new(source.clone(), generation));
        voice.gain = 1.;
        voice.playing = true;
        Self {
            source,
            voice,
            master: false,
            position: 0,
            playing: true,
            generation,
            index: 0,
            sequence: false,
            bars: 0,
            bass_swap: false,
            smart: false,
            swap_beat: 0.,
            stretched: false,
            queued: None,
            retired: None,
            overlap_start: usize::MAX,
            overlap_beats: 0.,
            mixed_beats: 0.,
            level: 0.,
            stream: None,
        }
    }
    pub(crate) fn streaming(stream: crate::audition_stream::Stream, generation: u64) -> Self {
        let mut voice = Self::new(
            Arc::new(Source {
                left: Vec::new(),
                right: Vec::new(),
                progressive: None,
                bass_profile: Default::default(),
            }),
            generation,
        );
        voice.stream = Some(stream);
        voice
    }
    fn at_end(&self) -> bool {
        self.stream
            .as_ref()
            .map_or(self.position >= self.source.len(), |stream| stream.ended())
    }
    fn seek(&mut self, position: usize) {
        let frames = self
            .stream
            .as_ref()
            .map_or(self.source.len(), |stream| stream.frames);
        self.position = position.min(frames);
        self.level = 0.;
        if let Some(stream) = &mut self.stream {
            stream.seek(self.position);
        } else {
            self.voice.seek(self.position);
            self.mixed_beats = 0.;
            if let Some(grid) = self.voice.grid {
                self.set_tempo(grid.bpm);
            }
            self.plan_overlap();
        }
    }
    pub fn set_grid(&mut self, grid: Option<Grid>) {
        if let Some(grid) = grid {
            self.voice.apply_grid(grid);
        }
    }
    fn plan_overlap(&mut self) {
        self.overlap_start = usize::MAX;
        self.overlap_beats = 0.;
        self.voice.set_bass(0.5);
        self.voice.set_eq(2, 0.5);
        let Some(next) = &mut self.queued else { return };
        next.position = 0;
        next.stretched = false;
        next.voice.set_bass(0.5);
        next.voice.set_eq(2, 0.5);
        next.voice.seek(0);
        if let Some(grid) = next.voice.grid {
            next.set_tempo(grid.bpm);
        }
        let (Some(a), Some(b)) = (self.voice.grid, next.voice.grid) else {
            return;
        };
        if self.bars == 0 || a.speed(b.bpm).is_err() || b.speed(a.bpm).is_err() {
            return;
        }
        let beats = self.bars as f64 * 4.;
        let start =
            self.source.len() as f64 - beats * 60. / a.bpm * (crate::sample_rate::get() as f64);
        if start <= self.position as f64 {
            return;
        }
        // Match the incoming grid phase at the exact source-time overlap boundary.
        let phase = a
            .beat(start / (crate::sample_rate::get() as f64))
            .rem_euclid(4.);
        let incoming = b.seconds(phase);
        if incoming + beats * 60. / b.bpm
            >= next.source.len() as f64 / (crate::sample_rate::get() as f64)
        {
            return;
        }
        next.position = (incoming * (crate::sample_rate::get() as f64)).round() as usize;
        next.voice.seek(next.position);
        next.voice.playing = true;
        next.stretched = true;
        next.set_tempo(a.bpm);
        if self.bass_swap {
            next.voice.set_bass(0.);
        }
        self.overlap_start = start.round() as usize;
        self.overlap_beats = beats;
        self.swap_beat = if self.smart {
            next.source
                .bass()
                .and_then(|profile| profile.drop_beat(b, incoming, beats))
                .unwrap_or(beats / 2.)
        } else {
            beats / 2.
        };
    }
    // A continuous tempo change keeps the stretcher and source clock alive.
    // Re-priming Voice::tempo at each ramp step would repeatedly reset the audio.
    fn set_tempo(&mut self, bpm: f64) {
        if let Some(grid) = self.voice.grid {
            let position = self.voice.clock.at(self.voice.output);
            let speed = bpm / grid.bpm;
            self.voice.clock = Transport {
                output: self.voice.output,
                source: position,
                speed,
            };
            self.voice.target_bpm = bpm;
            self.voice.dsp.ratios(speed, 0.);
        }
    }
    fn sample(&mut self) -> Result<[f32; 2]> {
        self.level = (self.level + 1. / crate::sample_rate::fine_frames() as f32).min(1.);
        let sample = if self.stretched {
            self.voice.playing = true;
            let sample = self.voice.next()?;
            self.position = self.voice.position;
            sample
        } else {
            let sample = [
                self.source.sample(0, self.position),
                self.source.sample(1, self.position),
            ];
            self.position += 1;
            self.voice.last_sample = sample;
            sample
        };
        Ok(sample.map(|v| v * MIX_GAIN * self.level))
    }
    fn next(&mut self) -> Result<[f32; 2]> {
        if !self.playing {
            return Ok([0.; 2]);
        }
        if let Some(stream) = &mut self.stream {
            if let Some(sample) = stream.sample() {
                self.position += 1;
                self.level = (self.level + 1. / crate::sample_rate::fine_frames() as f32).min(1.);
                return Ok(sample.map(|v| v * MIX_GAIN * self.level));
            }
            // Buffer starvation is temporary: hold source time rather than skip audio.
            if stream.ended() {
                self.playing = false;
                self.level = 0.;
            }
            return Ok([0.; 2]);
        }
        if self.sequence
            && self.queued.is_some()
            && (self.position >= self.source.len()
                || self.overlap_beats > 0. && self.mixed_beats >= self.overlap_beats)
        {
            let mut next = self.queued.take().unwrap();
            next.sequence = self.sequence;
            next.bars = self.bars;
            next.bass_swap = self.bass_swap;
            next.smart = self.smart;
            if self.bass_swap {
                next.voice.set_bass(0.5);
            }
            if let Some(grid) = next.voice.grid {
                next.set_tempo(grid.bpm);
            }
            std::mem::swap(self, &mut next);
            // Reclaimed by the next queue command on the ordinary retirement thread.
            self.retired = Some(next);
        }
        if self.position >= self.source.len() {
            self.playing = false;
            self.level = 0.;
            return Ok([0.; 2]);
        }
        let overlap = self.sequence && self.queued.is_some() && self.position >= self.overlap_start;
        if overlap && !self.stretched {
            self.voice.seek(self.position);
            self.voice.playing = true;
            self.stretched = true;
        }
        if overlap {
            let from = self.voice.grid.unwrap().bpm;
            let to = self.queued.as_ref().unwrap().voice.grid.unwrap().bpm;
            let progress = (self.mixed_beats / self.overlap_beats).min(1.);
            let bpm = from + (to - from) * progress;
            if self.voice.output % 128 == 0 || self.mixed_beats == 0. {
                self.set_tempo(bpm);
                self.queued.as_mut().unwrap().set_tempo(bpm);
            }
            if self.bass_swap && swap_due(self.mixed_beats, self.swap_beat, bpm) {
                self.voice.set_bass(0.);
                self.queued.as_mut().unwrap().voice.set_bass(0.5);
            }
            if self.bass_swap {
                let incoming =
                    transition_fades_at(progress, true, self.swap_beat / self.overlap_beats)[1];
                self.voice.set_eq(2, 0.5 * (1. - incoming));
            }
            let a = self.sample()?;
            let b = self.queued.as_mut().unwrap().sample()?;
            self.mixed_beats += bpm / (60. * (crate::sample_rate::get() as f64));
            // Linear fades keep correlated material below the sum of two full-level tracks.
            let fades = transition_fades_at(
                progress,
                self.bass_swap,
                self.swap_beat / self.overlap_beats,
            );
            return Ok(std::array::from_fn(|c| a[c] * fades[0] + b[c] * fades[1]));
        }
        let sample = self.sample()?;
        if self.position >= self.source.len() && !(self.sequence && self.queued.is_some()) {
            self.playing = false;
        }
        Ok(sample)
    }
}

pub const LOAD_BLOCKED: &str = "Stop playback or lower the deck fader to 0 before loading a track.";

pub struct CueChange {
    pub identity: Arc<str>,
    pub slot: usize,
    pub seconds: Option<f64>,
}

pub enum Retired {
    CueChange(CueChange),
    RejectedLoad(usize, Box<Voice>),
    Audition(Box<Audition>),
    Voice(Box<Voice>),
    Routing(Box<crate::routing::Plan>),
}

pub enum Command {
    SourceIdentity(usize, u64, Arc<str>),
    AuditionInstall(Box<Audition>),
    AuditionStop,
    AuditionQueue(u64, u64, Box<Audition>),
    AuditionSequence(u64, bool, u8),
    AuditionUpgrade(u64, Box<Audition>),
    AuditionControl(u64, Option<usize>),
    Routing(Box<crate::routing::Plan>),
    Install {
        deck: usize,
        generation: u64,
        voice: Box<Voice>,
        preserve_lock: bool,
        reset_mixer: bool,
    },
    Play(usize, u64),
    Pause(usize, u64),
    PlayPause(usize, u64),
    CuePress(usize, u64),
    CueRelease(usize, u64),
    HotCue(usize, u64, usize, bool),
    HotCueRelease(usize, u64, usize),
    HotCueMove(usize, u64, usize, f64),
    Stop(usize, u64),
    LoopIn(usize, u64, bool),
    LoopOut(usize, u64, bool),
    LoopLength(usize, u64, f64, bool),
    Slip(usize, u64, bool),
    Seek(usize, u64, usize),
    PhraseJump(usize, u64, usize),
    JumpCrossfade(usize),
    Jog(usize, u64, f64),
    ScrubStart(usize, u64, usize),
    Scrub(usize, u64, usize, bool),
    Gain(usize, u64, f32),
    Mixer(usize, u64, u8, f32),
    Remove(usize, u64),
    Grid(usize, u64, Grid),
    ReinterpretGrid(usize, u64, Grid),
    TapGridStart(usize, u64),
    TappedGrid(usize, u64, Grid),
    ShiftBarGrid(usize, u64, Grid),
    Tempo(usize, [u64; 2], f64),
    SmoothTempo(usize, [u64; 2], f64),
    Pitch(usize, u64, f64),
    Click(usize, u64, f32),
    ClickPanel(usize, u64, bool),
    AutoTransition(usize, [u64; 2], bool),
    FastAutoTransition(usize, [u64; 2], bool, u8),
    EditAuto(usize, [u64; 2], u8, f64),
    AutoBars(u8),
    AutoTempo(f64),
    AutoStyle(u8),
    MasterTempo(f64),
    MasterTarget(f64),
    Drift(usize, [u64; 2]),
    DriftRate(f64),
    SyncQuantum(u8),
    VinylStop(bool),
    Crossfader(f32),
    CrossfaderEnabled(bool),
    HeadphoneCue(usize, bool),
    Sync(usize, [u64; 2], bool),
}

#[derive(Clone, Copy, Default, Debug)]
pub struct Frame {
    pub audition_master: bool,
    pub audition_samples: [f32; 2],
    pub audition_generation: u64,
    pub audition_index: u64,
    pub audition_position: u64,
    pub audition_playing: bool,
    pub routing_players: [[f32; 2]; 2],
    pub routing_cross: [f32; 2],
    pub routing_cue: [f32; 2],
    pub auto_mode: [u8; 2],
    pub auto_fast: bool,
    pub auto_points: [[f64; 5]; 2],
    pub auto_remaining: [f64; 5],
    pub auto_style: u8,
    pub auto_started: bool,
    pub crossfader: f32,
    pub crossfader_enabled: bool,
    pub samples: [f32; 2],
    pub cue_samples: [f32; 2],
    pub headphone_cue: [bool; 2],
    pub deck_samples: [[f32; 2]; 2],
    pub positions: [u64; 2],
    pub generations: [u64; 2],
    pub position_epochs: [u64; 2],
    pub playing: [bool; 2],
    pub cue_positions: [u64; 2],
    pub hot_cues: [[Option<u64>; 4]; 2],
    pub cue_preview: [bool; 2],
    pub loop_starts: [Option<u64>; 2],
    pub loop_ends: [Option<u64>; 2],
    pub loop_lengths: [Option<f64>; 2],
    pub loop_release_pending: [bool; 2],
    pub slip_enabled: [bool; 2],
    pub gains: [f32; 2],
    pub mixer: [crate::mixer::Settings; 2],
    pub grids: [Option<Grid>; 2],
    pub targets: [f64; 2],
    pub pitches: [f64; 2],
    pub synced: [bool; 2],
    pub launch_pending: [bool; 2],
    pub clicks: [f32; 2],
    pub timing_errors: [u8; 2],
    pub reposition: [f64; 2],
    pub master_bpm: f64,
    pub master_bpm_set: bool,
    pub drift_rate: f64,
    pub sync_quantum: u8,
    pub drift_target: Option<usize>,
    pub output_frame: u64,
    pub global_beat: f64,
    pub master_running: bool,
}

#[derive(Clone, Copy)]
struct AutoTransition {
    fast: bool,
    from: usize,
    generations: [u64; 2],
    end: bool,
    start_seconds: f64,
    incoming_start: usize,
    guide_start: [f64; 2],
    beats: f64,
    mixed_beats: f64,
    started: bool,
    initial_bpm: f64,
    target_bpm: f64,
    manual_tempo: bool,
    saved_crossfader: f32,
    starting_gains: [f32; 2],
    starting_bass: [f32; 2],
    starting_high: f32,
    manual_high: bool,
    bass_swap: bool,
    bass_swapped: bool,
    swap_beat: f64,
    style: u8,
}

pub struct Decks {
    pub note_lanes: [crate::deck_notes::Lane; 2],
    pub cue_lanes: [crate::deck_notes::CueLane; 2],
    auto: Option<AutoTransition>,
    auto_bars: u8,
    auto_tempo: f64,
    auto_bass_swap: bool,
    auto_smart: bool,
    audition: Option<Box<Audition>>,
    routing: Box<crate::routing::Plan>,
    route_transition: u32,
    route_from: [[f32; 2]; 2],
    route_last: [[f32; 2]; 2],
    headphone_cue: [bool; 2],
    cue_current: [f32; 2],
    crossfader: f32,
    crossfader_enabled: bool,
    crossfader_current: [f32; 2],
    crossfader_target: [f32; 2],
    crossfader_ramp: u32,
    jump_crossfade: usize,
    vinyl_stop: bool,
    pub voices: [Option<Box<Voice>>; 2],
    pub master_bpm: f64,
    pub master_bpm_set: bool,
    pub drift_rate: f64,
    pub sync_quantum: u8,
    drift_target: Option<usize>,
    tempo_target: Option<f64>,
    global_beat: f64,
    output_frame: u64,
}
impl Decks {
    pub fn new() -> Self {
        Self {
            note_lanes: std::array::from_fn(|_| crate::deck_notes::Lane::new()),
            cue_lanes: std::array::from_fn(|_| crate::deck_notes::CueLane::new()),
            auto: None,
            auto_bars: 8,
            auto_tempo: 1.,
            auto_bass_swap: false,
            auto_smart: false,
            audition: None,
            routing: crate::routing::Graph::default().compile().unwrap(),
            route_transition: 0,
            route_from: [[0.; 2]; 2],
            route_last: [[0.; 2]; 2],
            headphone_cue: [false; 2],
            cue_current: [0.; 2],
            crossfader: 0.,
            crossfader_enabled: true,
            crossfader_current: crossfader_gains(0., true),
            crossfader_target: crossfader_gains(0., true),
            crossfader_ramp: 0,
            jump_crossfade: 1440,
            vinyl_stop: true,
            voices: [None, None],
            master_bpm: 120.,
            master_bpm_set: false,
            drift_rate: 1.,
            sync_quantum: 4,
            drift_target: None,
            tempo_target: None,
            global_beat: 0.,
            output_frame: 0,
        }
    }
    fn cancel_auto(&mut self) {
        // Release automation only. A DJ taking over must inherit the exact
        // transport and mix, including a partially completed bass swap or fade.
        self.auto = None;
    }
    fn arm_auto(&mut self, from: usize, generations: [u64; 2], end: bool) -> Result<()> {
        anyhow::ensure!(
            self.matches(generations),
            "Source replaced; retry transition"
        );
        let a = self.voices[from]
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Load both decks"))?;
        let b = self.voices[1 - from]
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Load both decks"))?;
        anyhow::ensure!(
            a.playing && !b.playing && a.launch_beat.is_none() && !a.cue_preview,
            "Only the outgoing deck can be playing"
        );
        anyhow::ensure!(
            a.loop_end.is_none() && b.loop_end.is_none() && a.scrub.is_none() && b.scrub.is_none(),
            "Release loops and scrubbing before an automatic transition"
        );
        let ag = a
            .grid
            .ok_or_else(|| anyhow::anyhow!("Both decks need timing grids"))?;
        let bg = b
            .grid
            .ok_or_else(|| anyhow::anyhow!("Both decks need timing grids"))?;
        let target = self.master_bpm + (bg.bpm - self.master_bpm) * self.auto_tempo;
        for grid in [ag, bg] {
            grid.speed(self.master_bpm)?;
            grid.speed(target)?;
        }
        // Cue is an explicit, sample-accurate launch point. Do not replace it
        // with a nearby beat-phase position when starting an automatic transition.
        let incoming_start = b.cue_position.max(b.start);
        let incoming = incoming_start as f64 / (crate::sample_rate::get() as f64);
        let incoming_length = b.source.len() as f64 / (crate::sample_rate::get() as f64);
        anyhow::ensure!(
            incoming_start < b.source.len(),
            "Incoming cue is at the end of the track"
        );
        let length = a.source.len() as f64 / (crate::sample_rate::get() as f64);
        let position = a.seconds();
        let cue_beat = bg.beat(incoming);
        // A loaded cue is rounded to a source frame. Treat a boundary rounded
        // within half a frame as exact, without moving an intentional manual cue.
        let cue_beat = if (cue_beat - cue_beat.round()).abs()
            <= bg.bpm / (60. * (crate::sample_rate::get() as f64) * 2.) + 1e-9
        {
            cue_beat.round()
        } else {
            cue_beat
        };
        // Try the configured overlap first, then each shorter supported length.
        // Both modes match the incoming cue's phrase phase on the outgoing grid.
        // EOF may include a partial bar or tail, so it is a limit, not an anchor.
        let (start, beats) = [32_u8, 16, 8, 4, 2, 1, 0]
            .into_iter()
            .filter(|bars| *bars <= self.auto_bars)
            .find_map(|bars| {
                let beats = f64::from(bars) * 4.;
                let duration = beats * 60. / ag.bpm;
                let start = if bars == 0 {
                    length
                } else {
                    let phase = cue_beat.rem_euclid(beats);
                    let phrase = if end {
                        ((ag.beat(length - duration) - phase) / beats + 1e-12).floor()
                    } else {
                        ((ag.beat(position) - phase) / beats + 1e-12).floor() + 1.
                    };
                    ag.seconds(phrase * beats + phase)
                };
                (start >= position
                    && start + duration <= length + 1e-6
                    && incoming + beats * 60. / bg.bpm < incoming_length)
                    .then_some((start, beats))
            })
            .ok_or_else(|| anyhow::anyhow!("No playable transition remains"))?;
        let auto = AutoTransition {
            fast: false,
            from,
            generations,
            end,
            start_seconds: start,
            incoming_start,
            guide_start: std::array::from_fn(|d| if d == from { start } else { incoming }),
            beats,
            mixed_beats: 0.,
            started: false,
            initial_bpm: self.master_bpm,
            target_bpm: target,
            manual_tempo: false,
            saved_crossfader: self.crossfader,
            starting_gains: std::array::from_fn(|d| self.voices[d].as_ref().unwrap().gain),
            starting_high: a.mixer.settings.eq[2],
            manual_high: false,
            starting_bass: std::array::from_fn(|d| {
                self.voices[d].as_ref().unwrap().mixer.settings.eq[0]
            }),
            bass_swap: self.auto_bass_swap,
            bass_swapped: false,
            style: if self.auto_smart {
                2
            } else if self.auto_bass_swap {
                1
            } else {
                0
            },
            swap_beat: if self.auto_smart {
                b.source
                    .bass()
                    .and_then(|profile| profile.drop_beat(bg, incoming, beats))
                    .unwrap_or(beats / 2.)
            } else {
                beats / 2.
            },
        };
        self.drift_target = None;
        self.tempo_target = None;
        self.global_beat = ag.beat(a.seconds());
        for voice in self.voices.iter_mut().flatten() {
            if (voice.target_bpm - self.master_bpm).abs() > 1e-9 {
                voice.tempo(self.master_bpm)?;
            }
            voice.synced = true;
            voice.launch_beat = None;
        }
        // Silence the incoming channel before playback can begin, in both modes.
        self.voices[1 - from].as_mut().unwrap().gain = 0.;
        self.auto = Some(auto);
        Ok(())
    }
    fn replan_auto_after_seek(&mut self, mut auto: AutoTransition) -> Result<()> {
        let outgoing = self.voices[auto.from].as_ref().unwrap();
        let grid = outgoing.grid.unwrap();
        let position = outgoing.seconds();
        let length = outgoing.source.len() as f64 / (crate::sample_rate::get() as f64);
        self.global_beat = grid.beat(position);
        // A seek before the planned overlap leaves it valid. Preserve every
        // anchor, including manually chosen outgoing transition points.
        if position <= auto.start_seconds + 1e-6
            && auto.start_seconds + auto.beats * 60. / grid.bpm <= length + 1e-6
        {
            return Ok(());
        }
        let mut beats = auto.beats;
        // Retain the edited incoming anchor, swap and overlap. Only relocate the
        // outgoing region, preserving its own phrase phase (area edits are local).
        let start = loop {
            let duration = beats * 60. / grid.bpm;
            let start = if beats == 0. {
                length
            } else {
                let quantum = beats.min(16.);
                let phase = grid.beat(auto.start_seconds).rem_euclid(quantum);
                let phrase = if auto.end {
                    ((grid.beat(length - duration) - phase) / quantum + 1e-12).floor()
                } else {
                    ((grid.beat(position) - phase) / quantum + 1e-12).floor() + 1.
                };
                grid.seconds(phrase * quantum + phase)
            };
            if start >= position - 1e-6 && start + duration <= length + 1e-6 {
                break start;
            }
            anyhow::ensure!(beats > 0., "No playable transition remains");
            beats = if beats > 16. {
                beats - 16.
            } else if beats > 8. {
                8.
            } else if beats > 4. {
                4.
            } else {
                0.
            };
        };
        auto.start_seconds = start;
        auto.guide_start[auto.from] = start;
        auto.beats = beats;
        auto.swap_beat = auto.swap_beat.min(beats);
        self.auto = Some(auto);
        Ok(())
    }
    // Absolute source-time targets make repeated/coalesced pointer updates idempotent.
    // Kinds: area, start, swap, end. Every edit preserves the original phrase phase.
    fn edit_auto(&mut self, deck: usize, generations: [u64; 2], kind: u8, seconds: f64) {
        let Some(mut auto) = self.auto else { return };
        if auto.started
            || auto.generations != generations
            || !self.matches(generations)
            || !seconds.is_finite()
            || kind > 3
            || (kind == 2 && !auto.bass_swap)
            || self
                .voices
                .iter()
                .flatten()
                .any(|v| v.loop_end.is_some() || v.scrub.is_some())
        {
            return;
        }
        let beat_seconds = 60. / self.voices[deck].as_ref().unwrap().grid.unwrap().bpm;
        let offset = match kind {
            2 => auto.swap_beat,
            3 => auto.beats,
            _ => 0.,
        };
        let delta =
            ((seconds - auto.guide_start[deck] - offset * beat_seconds) / beat_seconds).round();
        if delta == 0. {
            return;
        }
        match kind {
            0 => auto.guide_start[deck] += delta * beat_seconds,
            1 => {
                for d in 0..2 {
                    auto.guide_start[d] +=
                        delta * 60. / self.voices[d].as_ref().unwrap().grid.unwrap().bpm;
                }
                auto.beats -= delta;
                auto.swap_beat -= delta;
            }
            2 => auto.swap_beat += delta,
            3 => auto.beats += delta,
            _ => unreachable!(),
        }
        if !auto.bass_swap {
            auto.swap_beat = auto.beats / 2.;
        }
        if auto.beats < 0. || auto.swap_beat < 0. || auto.swap_beat > auto.beats {
            return;
        }
        let outgoing = self.voices[auto.from].as_ref().unwrap();
        // Never move the launch behind the continuing master clock, including loops.
        if outgoing.grid.unwrap().beat(auto.guide_start[auto.from]) <= self.global_beat {
            return;
        }
        for d in 0..2 {
            let voice = self.voices[d].as_ref().unwrap();
            let start = auto.guide_start[d];
            let end = start + auto.beats * 60. / voice.grid.unwrap().bpm;
            if start < voice.start as f64 / (crate::sample_rate::get() as f64) - 1e-6
                || end > voice.source.len() as f64 / (crate::sample_rate::get() as f64) + 1e-6
            {
                return;
            }
        }
        auto.start_seconds = auto.guide_start[auto.from];
        auto.incoming_start =
            (auto.guide_start[1 - auto.from] * (crate::sample_rate::get() as f64)).round() as usize;
        self.auto = Some(auto);
    }
    fn advance_auto(&mut self) {
        let Some(mut auto) = self.auto else { return };
        if !self.matches(auto.generations)
            || (!auto.started
                && !self.voices[auto.from].as_ref().is_some_and(|v| {
                    v.playing || (auto.beats == 0. && v.position >= v.source.len())
                }))
        {
            self.cancel_auto();
            return;
        }
        let a = self.voices[auto.from].as_ref().unwrap();
        let outgoing_ended = !a.playing && a.position >= a.source.len();
        // A loop may repeat source positions, but must not repeat or postpone AUTO's
        // timeline. Lock the launch boundary to the continuing master beat clock.
        let launch_beat = a.grid.unwrap().beat(auto.start_seconds);
        if !auto.started
            && self.global_beat + self.master_bpm / (60. * (crate::sample_rate::get() as f64))
                >= launch_beat
        {
            // Capture the outgoing level at the musical boundary, including changes
            // made while waiting.
            auto.starting_gains[auto.from] = a.gain;
            auto.starting_high = a.mixer.settings.eq[2];
            auto.saved_crossfader = self.crossfader;
            auto.starting_bass =
                std::array::from_fn(|d| self.voices[d].as_ref().unwrap().mixer.settings.eq[0]);
            let b = self.voices[1 - auto.from].as_mut().unwrap();
            b.gain = 0.;
            b.seek(auto.incoming_start);
            if auto.bass_swap && auto.beats > 0. {
                b.set_bass(0.);
            }
            b.playing = true;
            auto.started = true;
        }
        if !auto.started {
            return;
        }
        // Natural EOF on either side completes the handoff. Pausing the outgoing
        // deck during the overlap leaves the handoff on its musical timeline.
        let incoming_ended = !self.voices[1 - auto.from].as_ref().unwrap().playing;
        let progress = if auto.beats == 0. || outgoing_ended || incoming_ended {
            1.
        } else {
            (auto.mixed_beats / auto.beats).min(1.)
        };
        if !auto.manual_tempo {
            self.master_bpm = auto.initial_bpm + (auto.target_bpm - auto.initial_bpm) * progress;
        }
        for voice in self.voices.iter_mut().flatten() {
            voice.continuous_tempo(self.master_bpm);
        }
        let outgoing = auto.from;
        let incoming = 1 - outgoing;
        let fades = transition_fades_at(
            progress,
            auto.bass_swap,
            if auto.beats > 0. {
                auto.swap_beat / auto.beats
            } else {
                0.5
            },
        );
        self.voices[outgoing].as_mut().unwrap().gain = auto.starting_gains[outgoing] * fades[0];
        self.voices[incoming].as_mut().unwrap().gain = auto.starting_gains[outgoing] * fades[1];
        if auto.bass_swap && !auto.manual_high {
            self.voices[outgoing]
                .as_mut()
                .unwrap()
                .set_eq(2, auto.starting_high * (1. - fades[1]));
        }
        // Scheduled EQ changes fire once so later manual edits remain effective.
        if auto.bass_swap
            && !auto.bass_swapped
            && swap_due(auto.mixed_beats, auto.swap_beat, self.master_bpm)
        {
            auto.bass_swapped = true;
            self.voices[outgoing].as_mut().unwrap().set_bass(0.);
            self.voices[incoming].as_mut().unwrap().set_bass(0.5);
        }
        // Center the crossfader during the first bar (or the entire shorter overlap).
        // Respect its bypass state; the deck faders perform the actual handoff.
        let centering = if progress >= 1. || auto.beats == 0. {
            1.
        } else {
            (auto.mixed_beats / auto.beats.min(4.)).min(1.)
        };
        self.crossfader = auto.saved_crossfader * (1. - centering as f32);
        self.crossfader_target = crossfader_gains(self.crossfader, self.crossfader_enabled);
        self.crossfader_current = self.crossfader_target;
        self.crossfader_ramp = 0;
        auto.mixed_beats += self.master_bpm / (60. * (crate::sample_rate::get() as f64));
        if progress >= 1. {
            let voice = self.voices[auto.from].as_mut().unwrap();
            voice.playing = false;
            if auto.bass_swap {
                voice.set_bass(auto.starting_bass[auto.from]);
                if !auto.manual_high {
                    voice.set_eq(2, auto.starting_high);
                }
            }
            self.auto = None;
            self.crossfader_target = crossfader_gains(self.crossfader, self.crossfader_enabled);
            self.crossfader_ramp = crate::sample_rate::fine_frames() as u32;
        } else {
            self.auto = Some(auto);
        }
    }
    fn transition_guides(&self, frame: &mut Frame) {
        let Some(auto) = self.auto else { return };
        let outgoing = self.voices[auto.from].as_ref().unwrap();
        let launch = outgoing.grid.unwrap().beat(auto.start_seconds);
        let elapsed = if auto.started {
            auto.mixed_beats
        } else {
            self.global_beat - launch
        };
        // Start, outgoing fade start, incoming fade end, bass swap, end.
        let offsets = [
            0.,
            if auto.bass_swap {
                auto.swap_beat
            } else {
                auto.beats * 0.2
            },
            if auto.bass_swap {
                auto.swap_beat
            } else {
                auto.beats * 0.8
            },
            auto.swap_beat,
            auto.beats,
        ];
        frame.auto_style = auto.style;
        frame.auto_started = auto.started;
        frame.auto_remaining = offsets.map(|beat| beat - elapsed);
        for d in 0..2 {
            let voice = self.voices[d].as_ref().unwrap();
            let seconds_per_beat = 60. / voice.grid.unwrap().bpm;
            let anchor = auto.guide_start[d];
            frame.auto_points[d] = std::array::from_fn(|i| {
                let original = anchor + offsets[i] * seconds_per_beat;
                // Upcoming loop events keep their planned time, but appear at the
                // source position that will actually be heard at that moment.
                if frame.auto_remaining[i] >= 0. {
                    if let (Some(start), Some(end)) = (voice.loop_start, voice.loop_end) {
                        let position = if auto.started || d == auto.from {
                            voice.seconds() + frame.auto_remaining[i] * seconds_per_beat
                        } else {
                            original
                        };
                        let start = start as f64 / (crate::sample_rate::get() as f64);
                        let end = end as f64 / (crate::sample_rate::get() as f64);
                        if position >= end && end > start {
                            return start + (position - start).rem_euclid(end - start);
                        }
                        return position;
                    }
                }
                original
            });
        }
    }
    fn matches(&self, generations: [u64; 2]) -> bool {
        (0..2).all(|d| self.voices[d].as_ref().map_or(0, |v| v.generation) == generations[d])
    }
    fn clear_sync(&mut self, deck: usize) {
        if let Some(v) = &mut self.voices[deck] {
            v.synced = false;
        }
        if self.drift_target == Some(deck) {
            self.drift_target = None;
        }
    }
    fn align_to_master(&mut self, deck: usize) -> Result<()> {
        let voice = self.voices[deck]
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Load a deck before locking"))?;
        let grid = voice
            .grid
            .ok_or_else(|| anyhow::anyhow!("Apply a timing grid before locking"))?;
        if !voice.synced
            && voice.playing
            && voice.launch_beat.is_none()
            && !self
                .voices
                .iter()
                .enumerate()
                .any(|(other, v)| other != deck && v.as_ref().is_some_and(|v| v.playing))
            && !crate::patterns::clock_running()
        {
            // The only running source owns the phase. Lock without seeking or
            // resetting its stretcher, even when an idle deck is already locked.
            self.global_beat = grid.beat(voice.seconds());
            self.master_bpm = voice.target_bpm;
            self.master_bpm_set = true;
            self.tempo_target = None;
            self.drift_target = None;
            let voice = self.voices[deck].as_mut().unwrap();
            if voice.tempo_ramp.is_some() {
                voice.continuous_tempo(self.master_bpm);
            }
            if voice.loop_end.is_some() {
                voice.loop_phase_offset = Some(0.);
            }
            voice.timing_error = 0;
            return Ok(());
        }
        grid.speed(self.master_bpm)?;
        let position = if voice.playing {
            Some(grid.align_quantum_from(
                voice.seconds(),
                self.global_beat,
                voice.start as f64 / (crate::sample_rate::get() as f64),
                voice.source.len() as f64 / (crate::sample_rate::get() as f64),
                f64::from(self.sync_quantum),
            )?)
        } else {
            None
        };
        let voice = self.voices[deck].as_mut().unwrap();
        if self.master_bpm_set
            && ((voice.target_bpm - self.master_bpm).abs() > 1e-9 || voice.tempo_ramp.is_some())
        {
            voice.tempo(self.master_bpm)?;
        }
        if let Some(position) = position {
            voice.reposition_seconds = position - voice.seconds();
            voice.seek((position * (crate::sample_rate::get() as f64)).round() as usize);
        }
        voice.timing_error = 0;
        Ok(())
    }
    fn schedule_launch_to_master(&mut self, deck: usize) -> Result<()> {
        let voice = self.voices[deck]
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Load a deck before playing"))?;
        let grid = voice
            .grid
            .ok_or_else(|| anyhow::anyhow!("Apply a timing grid before locking"))?;
        grid.speed(self.master_bpm)?;
        let source_beat = grid.beat(voice.seconds());
        let quantum = f64::from(self.sync_quantum);
        let master_phase = self.global_beat.rem_euclid(quantum);
        // During beat 1 of a bar, join the bar already playing. The source cue
        // may lie just before its detected downbeat, so align its actual grid
        // phase rather than requiring it to start precisely on beat 1.
        let immediate_position = if self.sync_quantum == 4 && master_phase < 1. {
            grid.align_quantum_from(
                voice.seconds(),
                self.global_beat,
                voice.start as f64 / (crate::sample_rate::get() as f64),
                voice.source.len() as f64 / (crate::sample_rate::get() as f64),
                quantum,
            )
            .ok()
        } else {
            None
        };
        let source_boundary = (source_beat / quantum).ceil() * quantum;
        let lead_beats = source_boundary - source_beat;
        let master_boundary = (self.global_beat / quantum).ceil() * quantum;
        let mut launch_beat = master_boundary - lead_beats;
        if launch_beat < self.global_beat - 1e-9 {
            launch_beat += quantum;
        }
        let voice = self.voices[deck].as_mut().unwrap();
        if self.master_bpm_set && (voice.target_bpm - self.master_bpm).abs() > 1e-9 {
            voice.tempo(self.master_bpm)?;
        }
        if let Some(position) = immediate_position {
            voice.reposition_seconds = position - voice.seconds();
            voice.seek((position * (crate::sample_rate::get() as f64)).round() as usize);
            voice.timing_error = 0;
            return Ok(());
        }
        voice.launch_beat = Some(launch_beat);
        voice.reposition_seconds = 0.;
        voice.timing_error = 0;
        Ok(())
    }
    // Retired ownership is returned to the caller to dispose on a normal thread.
    pub fn command(&mut self, command: Command, latest: [u64; 2]) -> Option<Retired> {
        // Check before cancelling transitions or changing any deck state. A load
        // may have been prepared while this deck was stopped or muted.
        if let Command::Install {
            deck, generation, ..
        } = &command
        {
            if *generation == latest[*deck]
                && self.voices[*deck]
                    .as_ref()
                    .is_some_and(|v| v.playing && v.gain != 0.)
            {
                if let Command::Install { deck, voice, .. } = command {
                    return Some(Retired::RejectedLoad(deck, voice));
                }
            }
        }
        let cancels_auto = match &command {
            Command::Install {
                deck, generation, ..
            } => *generation == latest[*deck],
            Command::Remove(d, through) => self.voices[*d]
                .as_ref()
                .is_some_and(|v| v.generation <= *through),
            Command::Play(d, g) | Command::Pause(d, g) | Command::PlayPause(d, g) => {
                !self.auto.is_some_and(|a| a.started && *d == a.from)
                    && self.voices[*d].as_ref().is_some_and(|v| v.generation == *g)
            }
            Command::Stop(d, g)
            | Command::CuePress(d, g)
            | Command::CueRelease(d, g)
            | Command::ScrubStart(d, g, _)
            | Command::Scrub(d, g, _, _)
            | Command::Grid(d, g, _)
            | Command::TapGridStart(d, g)
            | Command::TappedGrid(d, g, _)
            | Command::ReinterpretGrid(d, g, _) => {
                self.voices[*d].as_ref().is_some_and(|v| v.generation == *g)
            }
            Command::Gain(d, g, _) => {
                self.auto.is_some_and(|a| a.started || *d != a.from)
                    && self.voices[*d].as_ref().is_some_and(|v| v.generation == *g)
            }
            Command::Tempo(_, generations, _)
            | Command::SmoothTempo(_, generations, _)
            | Command::Sync(_, generations, _) => self.matches(*generations),
            Command::Crossfader(_) | Command::CrossfaderEnabled(_) => true,
            _ => false,
        };
        if cancels_auto {
            self.cancel_auto();
        }
        let phrase_jump = matches!(&command, Command::PhraseJump(..));
        match command {
            Command::VinylStop(enabled) => self.vinyl_stop = enabled,
            Command::AutoBars(bars) => {
                if [0, 1, 2, 4, 8, 16, 32].contains(&bars) {
                    self.auto_bars = bars;
                }
            }
            Command::AutoTempo(amount) => self.auto_tempo = amount.clamp(0., 1.),
            Command::AutoStyle(style) => {
                self.auto_bass_swap = style != 0;
                self.auto_smart = style == 2;
                if let Some(voice) = &mut self.audition {
                    if voice.mixed_beats == 0. {
                        voice.bass_swap = self.auto_bass_swap;
                        voice.smart = self.auto_smart;
                        voice.plan_overlap();
                    }
                }
            }
            Command::EditAuto(d, generations, kind, seconds) => {
                self.edit_auto(d, generations, kind, seconds);
            }
            Command::FastAutoTransition(d, generations, end, bars) => {
                if self.matches(generations)
                    && !self.auto.is_some_and(|a| a.started)
                    && [0, 1, 2, 4, 8, 16, 32].contains(&bars)
                {
                    self.cancel_auto();
                    let saved = self.auto_bars;
                    self.auto_bars = bars;
                    let result = self.arm_auto(d, generations, end);
                    self.auto_bars = saved;
                    if result.is_ok() {
                        if let Some(auto) = &mut self.auto {
                            auto.fast = true;
                        }
                    } else if let Some(v) = &mut self.voices[d] {
                        v.timing_error = 4;
                    }
                }
            }
            Command::AutoTransition(d, generations, end) => {
                if self.matches(generations) {
                    let cancel = self.auto.is_some_and(|a| a.from == d && a.end == end);
                    self.cancel_auto();
                    if !cancel && self.arm_auto(d, generations, end).is_err() {
                        if let Some(v) = &mut self.voices[d] {
                            v.timing_error = 4;
                        }
                    }
                }
            }
            Command::SourceIdentity(deck, generation, identity) => {
                if let Some(voice) = &mut self.voices[deck] {
                    if voice.generation == generation && voice.cue_identity.is_none() {
                        voice.cue_identity = Some(identity);
                    }
                }
            }
            Command::AuditionInstall(mut voice) => {
                voice.bass_swap = self.auto_bass_swap;
                voice.smart = self.auto_smart;
                return self.audition.replace(voice).map(Retired::Audition);
            }
            Command::AuditionUpgrade(generation, mut prepared) => {
                if let Some(voice) = &self.audition {
                    if voice.generation == generation && voice.index == 0 && voice.stream.is_some()
                    {
                        prepared.master = voice.master;
                        prepared.sequence = voice.sequence;
                        prepared.bars = voice.bars;
                        prepared.bass_swap = voice.bass_swap;
                        prepared.smart = voice.smart;
                        prepared.seek(voice.position);
                        prepared.playing = voice.playing;
                        prepared.level = voice.level;
                        return self.audition.replace(prepared).map(Retired::Audition);
                    }
                }
                return Some(Retired::Audition(prepared));
            }
            Command::AuditionQueue(generation, index, next) => {
                if let Some(voice) = &mut self.audition {
                    if voice.generation == generation
                        && voice.index == index
                        && voice.sequence
                        && voice.mixed_beats == 0.
                    {
                        let retired = voice.retired.take().or_else(|| voice.queued.take());
                        voice.queued = Some(next);
                        if voice.position >= voice.source.len() {
                            voice.playing = true;
                        }
                        voice.plan_overlap();
                        return retired.map(Retired::Audition);
                    }
                }
                return Some(Retired::Audition(next));
            }
            Command::AuditionSequence(generation, enabled, bars) => {
                if let Some(voice) = &mut self.audition {
                    if voice.generation == generation {
                        voice.sequence = enabled;
                        voice.bars = bars;
                        if voice.mixed_beats == 0. {
                            voice.bass_swap = self.auto_bass_swap;
                            voice.smart = self.auto_smart;
                            voice.plan_overlap();
                        }
                        if !enabled {
                            voice.overlap_start = usize::MAX;
                            voice.mixed_beats = 0.;
                            voice.voice.set_bass(0.5);
                            voice.voice.set_eq(2, 0.5);
                            if let Some(grid) = voice.voice.grid {
                                voice.set_tempo(grid.bpm);
                            }
                            return voice.queued.take().map(Retired::Audition);
                        }
                    }
                }
            }
            Command::AuditionStop => return self.audition.take().map(Retired::Audition),
            Command::AuditionControl(generation, position) => {
                if let Some(voice) = &mut self.audition {
                    if voice.generation == generation {
                        if let Some(position) = position {
                            voice.seek(position);
                        } else {
                            if !voice.playing && voice.at_end() {
                                voice.seek(0);
                            }
                            voice.playing = !voice.playing;
                        }
                    }
                }
            }
            Command::Routing(mut plan) => {
                plan.inherit(&mut self.routing);
                self.route_from = self.route_last;
                self.route_transition = crate::sample_rate::fine_frames() as u32;
                return Some(Retired::Routing(std::mem::replace(&mut self.routing, plan)));
            }
            Command::HeadphoneCue(deck, enabled) => self.headphone_cue[deck] = enabled,
            Command::Crossfader(position) => {
                self.crossfader = position;
                self.crossfader_target = crossfader_gains(position, self.crossfader_enabled);
                self.crossfader_ramp = crate::sample_rate::fine_frames() as u32;
                // 5 ms; avoid gain discontinuities.
            }
            Command::CrossfaderEnabled(enabled) => {
                self.crossfader_enabled = enabled;
                self.crossfader_target = crossfader_gains(self.crossfader, enabled);
                self.crossfader_ramp = crate::sample_rate::fine_frames() as u32;
            }
            Command::Install {
                deck,
                generation,
                mut voice,
                preserve_lock,
                reset_mixer,
            } => {
                if generation != latest[deck] {
                    return Some(Retired::Voice(voice));
                }
                if let Some(old) = &self.voices[deck] {
                    voice.slip_enabled = old.slip_enabled;
                    voice.gain = old.gain;
                    if !reset_mixer {
                        let mut settings = old.mixer.settings;
                        settings.trim = voice.mixer.settings.trim;
                        voice.mixer.set(settings);
                    }
                    if preserve_lock && old.synced {
                        if voice
                            .grid
                            .is_some_and(|grid| grid.speed(self.master_bpm).is_ok())
                        {
                            if !self.master_bpm_set || voice.tempo(self.master_bpm).is_ok() {
                                voice.synced = true;
                            }
                        }
                    }
                }
                if self.drift_target == Some(deck) {
                    self.drift_target = None;
                }
                return self.voices[deck].replace(voice).map(Retired::Voice);
            }
            Command::PlayPause(d, g) => {
                if let Some(v) = &self.voices[d] {
                    if v.generation == g {
                        let command = if v.playing && !v.cue_preview {
                            Command::Pause(d, g)
                        } else {
                            Command::Play(d, g)
                        };
                        return self.command(command, latest);
                    }
                }
            }
            Command::HotCueMove(d, g, slot, seconds) => {
                if slot >= 4 || !seconds.is_finite() || seconds < 0. {
                    return None;
                }
                if let Some(v) = &mut self.voices[d] {
                    if v.generation != g || v.hot_cues[slot].is_none() || v.cue_preview {
                        return None;
                    }
                    let position = ((seconds * crate::sample_rate::get() as f64).round() as usize)
                        .clamp(v.start, v.source.len().saturating_sub(1));
                    v.hot_cues[slot] = Some(position);
                    return v.cue_identity.as_ref().map(|identity| {
                        Retired::CueChange(CueChange {
                            identity: identity.clone(),
                            slot,
                            seconds: Some(position as f64 / crate::sample_rate::get() as f64),
                        })
                    });
                }
            }
            Command::HotCue(d, g, slot, clear) => {
                if slot >= 4 || !self.voices[d].as_ref().is_some_and(|v| v.generation == g) {
                    return None;
                }
                if !clear && self.voices[d].as_ref().unwrap().hot_cues[slot].is_some() {
                    self.cancel_auto();
                }
                let v = self.voices[d].as_mut().unwrap();
                if clear {
                    v.hot_cues[slot] = None;
                } else if let Some(position) = v.hot_cues[slot] {
                    let preview = !v.playing || v.cue_preview;
                    v.clear_loop();
                    v.seek(position);
                    v.play();
                    v.cue_preview = preview;
                    v.hot_cue_preview = preview.then_some((slot, position));
                    return None;
                } else {
                    // Capture on the audio thread, at the rendered playhead, without snapping.
                    v.hot_cues[slot] =
                        Some(v.position.clamp(v.start, v.source.len().saturating_sub(1)));
                }
                return v.cue_identity.as_ref().map(|identity| {
                    Retired::CueChange(CueChange {
                        identity: identity.clone(),
                        slot,
                        seconds: v.hot_cues[slot]
                            .map(|p| p as f64 / crate::sample_rate::get() as f64),
                    })
                });
            }
            Command::HotCueRelease(d, g, slot) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && v.cue_preview {
                        if let Some((held_slot, position)) = v.hot_cue_preview {
                            if slot == held_slot {
                                v.playing = false;
                                v.seek(position);
                            }
                        }
                    }
                }
            }
            Command::CuePress(d, g) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && !v.cue_preview {
                        if v.playing {
                            v.playing = false;
                            v.seek(v.cue_position);
                        } else {
                            let position =
                                (v.seconds() * (crate::sample_rate::get() as f64)).round() as usize;
                            if position.abs_diff(v.cue_position) > 1 {
                                let seconds = if v.synced {
                                    v.grid.map_or(v.seconds(), |grid| {
                                        grid.align_quantum_from(
                                            v.seconds(),
                                            0.,
                                            v.start as f64 / (crate::sample_rate::get() as f64),
                                            v.source.len() as f64
                                                / (crate::sample_rate::get() as f64),
                                            f64::from(self.sync_quantum),
                                        )
                                        .unwrap_or(v.seconds())
                                    })
                                } else {
                                    v.seconds()
                                };
                                v.cue_position = ((seconds * (crate::sample_rate::get() as f64))
                                    .round()
                                    .max(0.)
                                    as usize)
                                    .clamp(v.start, v.source.len().saturating_sub(1));
                                v.seek(v.cue_position);
                            } else {
                                v.seek(v.cue_position);
                                v.play();
                                v.cue_preview = true;
                            }
                        }
                    }
                }
            }
            Command::CueRelease(d, g) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && v.cue_preview && v.hot_cue_preview.is_none() {
                        v.playing = false;
                        v.seek(v.cue_position);
                    }
                }
            }
            Command::Play(d, g) => {
                if !self.master_bpm_set {
                    if let Some(v) = self.voices[d]
                        .as_ref()
                        .filter(|v| v.generation == g && v.grid.is_some())
                    {
                        self.master_bpm = v.target_bpm;
                        self.master_bpm_set = true;
                    }
                }
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && v.cue_preview {
                        // Latch the audition without restarting or scheduling a launch.
                        v.cue_preview = false;
                        v.hot_cue_preview = None;
                        return None;
                    }
                }
                let first = !self
                    .voices
                    .iter()
                    .flatten()
                    .any(|v| v.playing && v.launch_beat.is_none());
                if self.voices[d]
                    .as_ref()
                    .is_some_and(|v| v.generation == g && !v.playing)
                {
                    let v = self.voices[d].as_mut().unwrap();
                    v.play();
                    if first {
                        // The first deck starts the clock from its current grid
                        // position, including negative beats before the downbeat.
                        // Never seek away a pickup beat to meet an idle clock.
                        self.global_beat = v.grid.map_or(0., |grid| grid.beat(v.seconds()));
                        v.reposition_seconds = 0.;
                    } else if v.synced && self.schedule_launch_to_master(d).is_err() {
                        let v = self.voices[d].as_mut().unwrap();
                        v.synced = false;
                        v.timing_error = 3;
                    }
                    let v = self.voices[d].as_mut().unwrap();
                    if v.loop_end.is_some() {
                        let pending = v.loop_release_beat.is_some();
                        let start = v.launch_beat.unwrap_or(self.global_beat);
                        v.loop_phase_offset = v.grid.map(|grid| start - grid.beat(v.seconds()));
                        if pending {
                            v.loop_release_beat = None;
                            v.request_loop_release(start, self.sync_quantum);
                        }
                    }
                }
            }
            Command::Pause(d, g) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        v.halt(self.vinyl_stop, false);
                    }
                }
            }
            Command::Stop(d, g) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        v.halt(self.vinyl_stop, true);
                    }
                }
            }
            Command::Pitch(d, g, semitones) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        if semitones.is_finite()
                            && (-6. ..=6.).contains(&semitones)
                            && semitones.fract() == 0.
                        {
                            self.note_lanes[d].manual = semitones;
                            let shift = self.note_lanes[d].pitch(self.output_frame);
                            let _ = v.pitch(shift);
                        }
                    }
                }
            }
            Command::Slip(d, g, enabled) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        v.set_slip(enabled);
                    }
                }
            }
            Command::LoopIn(d, g, snap) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        if v.loop_end.is_some() {
                            v.request_loop_release(self.global_beat, self.sync_quantum);
                            if v.loop_release_beat.is_some() {
                                return None;
                            }
                        }
                        v.loop_phase_offset = None;
                        v.remember_loop_phase(self.global_beat);
                        v.loop_start =
                            Some(v.loop_point(snap).min(v.source.len().saturating_sub(1)));
                        v.loop_end = None;
                        v.loop_length = None;
                    }
                }
            }
            Command::LoopOut(d, g, snap) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        if v.loop_end.is_some() {
                            v.request_loop_release(self.global_beat, self.sync_quantum);
                            return None;
                        }
                        if let Some(start) = v.loop_start {
                            let end = v.loop_point(snap).min(v.source.len());
                            if end > start {
                                v.remember_loop_phase(self.global_beat);
                                v.loop_end = Some(end);
                                v.loop_length = None;
                                v.begin_slip_if_needed();
                            }
                        }
                    }
                }
            }
            Command::LoopLength(d, g, beats, align) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        if v.loop_end.is_some() && v.loop_length == Some(beats) {
                            v.request_loop_release(self.global_beat, self.sync_quantum);
                        } else if let Some(grid) = v.grid {
                            let now =
                                (v.seconds() * (crate::sample_rate::get() as f64)).round() as usize;
                            let (start, end) = if align {
                                let first_beat = (grid.beat(v.seconds()) / beats).floor() * beats;
                                // Track time zero is the earliest loop start. If the
                                // containing grid segment begins outside the source,
                                // move the whole loop forward, preserving its length.
                                let first_seconds = grid
                                    .seconds(first_beat)
                                    .max(v.start as f64 / (crate::sample_rate::get() as f64));
                                let first = (first_seconds * (crate::sample_rate::get() as f64))
                                    .round() as usize;
                                let last = ((first_seconds + beats * 60. / grid.bpm)
                                    * (crate::sample_rate::get() as f64))
                                    .round() as usize;
                                (first, last.min(v.source.len()))
                            } else {
                                let first = v.loop_start.unwrap_or(now);
                                let frames = (beats * 60. / grid.bpm
                                    * (crate::sample_rate::get() as f64))
                                    .round()
                                    .max(1.) as usize;
                                (first, first.saturating_add(frames).min(v.source.len()))
                            };
                            if end > start {
                                v.remember_loop_phase(self.global_beat);
                                v.loop_start = Some(start);
                                v.loop_end = Some(end);
                                v.loop_length = Some(beats);
                                v.begin_slip_if_needed();
                                if now >= end || now < start {
                                    let slip_position = v.slip_position;
                                    v.seek(start);
                                    v.slip_position = slip_position;
                                }
                            }
                        }
                    }
                }
            }
            Command::Seek(d, g, p) | Command::PhraseJump(d, g, p) => {
                if !self.voices[d].as_ref().is_some_and(|v| v.generation == g) {
                    return None;
                }
                let replan = self.auto.filter(|a| a.from == d && !a.started);
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        let looping = v.loop_end.is_some();
                        if v.playing && v.launch_beat.is_none() {
                            // Resolve against the deck's current phase at the render boundary.
                            let target = if let Some(grid) = v.grid {
                                match grid.align_quantum_from(
                                    p as f64 / (crate::sample_rate::get() as f64),
                                    if looping && v.synced {
                                        self.global_beat
                                    } else {
                                        grid.beat(v.seconds())
                                    },
                                    v.start as f64 / (crate::sample_rate::get() as f64),
                                    v.source.len() as f64 / (crate::sample_rate::get() as f64),
                                    f64::from(self.sync_quantum),
                                ) {
                                    Ok(seconds) => (seconds * (crate::sample_rate::get() as f64))
                                        .round()
                                        as usize,
                                    Err(_) => return None,
                                }
                            } else {
                                p
                            };
                            if looping {
                                v.clear_loop();
                            }
                            if phrase_jump {
                                v.phrase_jump(target, self.jump_crossfade);
                            } else {
                                v.seek(target);
                            }
                        } else {
                            if looping {
                                v.clear_loop();
                            }
                            v.seek(p);
                        }
                    }
                }
                if let Some(mut auto) = self.auto.filter(|a| a.started) {
                    // Keep the current fade/tempo progress. Only compress the remaining
                    // timeline if a seek leaves less playable material than the overlap.
                    let remaining = (auto.beats - auto.mixed_beats).max(0.);
                    let available = self
                        .voices
                        .iter()
                        .flatten()
                        .filter(|v| v.loop_end.is_none())
                        .map(|v| {
                            ((v.source.len() as f64 / (crate::sample_rate::get() as f64)
                                - v.seconds())
                                * v.grid.unwrap().bpm
                                / 60.)
                                .max(0.)
                        })
                        .fold(remaining, f64::min);
                    if remaining > 0. && available < remaining {
                        let scale = available / remaining;
                        auto.beats *= scale;
                        auto.mixed_beats *= scale;
                        auto.swap_beat *= scale;
                    }
                    auto.guide_start = std::array::from_fn(|deck| {
                        let voice = self.voices[deck].as_ref().unwrap();
                        voice.seconds() - auto.mixed_beats * 60. / voice.grid.unwrap().bpm
                    });
                    self.auto = Some(auto);
                }
                if let Some(auto) = replan {
                    if self.replan_auto_after_seek(auto).is_err() {
                        self.cancel_auto();
                        if let Some(v) = &mut self.voices[d] {
                            v.timing_error = 4;
                        }
                    }
                }
            }
            Command::Jog(d, g, seconds) => {
                if seconds.is_finite() && seconds.abs() <= 10. {
                    if let Some(v) = &mut self.voices[d] {
                        if v.generation == g {
                            v.jog_by(seconds);
                        }
                    }
                }
            }
            Command::ScrubStart(d, g, p) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && !v.playing {
                        v.seek(p);
                        v.scrub = Some(ScrubMotion::new(v.position.min(v.source.len() - 1)));
                    }
                }
            }
            Command::Scrub(d, g, p, moving) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && !v.playing && v.scrub.is_some() {
                        if moving {
                            v.scrub
                                .as_mut()
                                .unwrap()
                                .retarget(p.clamp(v.start, v.source.len() - 1));
                            v.position_epoch += 1;
                        } else {
                            v.seek(p);
                        }
                    }
                }
            }
            Command::Remove(d, through_generation) => {
                if self.voices[d]
                    .as_ref()
                    .is_some_and(|v| v.generation <= through_generation)
                {
                    self.clear_sync(d);
                    return self.voices[d].take().map(Retired::Voice);
                }
            }
            Command::Gain(d, g, gain) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        v.gain = gain;
                    }
                }
            }
            Command::Mixer(d, g, parameter, value) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        let mut settings = v.mixer.settings;
                        match parameter {
                            0 => settings.trim = value,
                            1..=3 => settings.eq[parameter as usize - 1] = value,
                            4 => settings.filter = value,
                            _ => return None,
                        }
                        v.mixer.set(settings);
                        if parameter == 3 {
                            if let Some(auto) = &mut self.auto {
                                if auto.started && auto.from == d {
                                    auto.manual_high = true;
                                }
                            }
                        }
                    }
                }
            }
            Command::Grid(d, g, grid) => {
                if self.voices[d].as_ref().is_some_and(|v| {
                    v.generation == g
                        && grid
                            .validate(v.source.len() as f64 / (crate::sample_rate::get() as f64))
                            .is_ok()
                }) {
                    self.clear_sync(d);
                    self.voices[d].as_mut().unwrap().apply_grid(grid);
                }
            }
            Command::ShiftBarGrid(d, g, grid) => {
                // Check again at the render boundary: another deck may have
                // started since the UI requested the correction.
                let other_playing = self.voices[1 - d].as_ref().is_some_and(|v| v.playing);
                if let Some(v) = self.voices[d].as_mut().filter(|v| {
                    !other_playing
                        && v.generation == g
                        && v.playing
                        && v.launch_beat.is_none()
                        && v.grid.is_some_and(|old| old.bpm == grid.bpm)
                        && grid
                            .validate(v.source.len() as f64 / (crate::sample_rate::get() as f64))
                            .is_ok()
                }) {
                    let beat = grid.beat(v.seconds());
                    let delta = beat - self.global_beat;
                    v.grid = Some(grid);
                    if let Some(offset) = &mut v.loop_phase_offset {
                        *offset = 0.;
                    }
                    if let Some(release) = &mut v.loop_release_beat {
                        *release += delta;
                    }
                    self.global_beat = beat;
                    self.master_bpm = v.target_bpm;
                    self.master_bpm_set = true;
                    self.tempo_target = None;
                    self.drift_target = None;
                    self.cancel_auto();
                }
            }
            Command::TapGridStart(d, g) => {
                if self.voices[d].as_ref().is_some_and(|v| v.generation == g)
                    && self.voices[1 - d].as_ref().is_some_and(|v| v.synced)
                {
                    self.clear_sync(d);
                }
            }
            Command::ReinterpretGrid(d, g, grid) | Command::TappedGrid(d, g, grid) => {
                let tapped = matches!(command, Command::TappedGrid(..));
                let other_locked = self.voices[1 - d].as_ref().is_some_and(|v| v.synced);
                if let Some(v) = self.voices[d].as_mut().filter(|v| {
                    v.generation == g
                        && grid
                            .validate(v.source.len() as f64 / (crate::sample_rate::get() as f64))
                            .is_ok()
                }) {
                    let ratio = v.grid.map_or(1., |old| grid.bpm / old.bpm);
                    // Only reinterpret the beat count: leave the transport, prepared
                    // DSP samples, pitch, loop endpoints and playhead untouched.
                    v.grid = Some(grid);
                    v.target_bpm = grid.bpm * v.clock.speed;
                    v.tempo_ramp = None;
                    v.loop_length = v.loop_length.map(|beats| beats * ratio);
                    v.loop_phase_offset = None;
                    v.loop_release_beat = None;
                    if tapped {
                        v.synced = !other_locked;
                        v.launch_beat = None;
                        if !other_locked {
                            self.global_beat = grid.beat(v.seconds());
                            self.master_bpm_set = true;
                        }
                    }
                    if tapped && !other_locked
                        || !tapped && v.synced && v.playing && v.launch_beat.is_none()
                    {
                        self.master_bpm = v.target_bpm;
                        self.tempo_target = None;
                        self.drift_target = None;
                    }
                }
            }
            Command::Click(d, g, gain) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        v.click_gain = gain;
                    }
                }
            }
            Command::ClickPanel(d, g, open) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        v.click_panel_open = open;
                    }
                }
            }
            Command::Tempo(d, generations, target)
            | Command::SmoothTempo(d, generations, target) => {
                let smooth = matches!(command, Command::SmoothTempo(..));
                if self.matches(generations) {
                    let valid = self.voices[d]
                        .as_ref()
                        .and_then(|v| v.grid)
                        .is_some_and(|g| g.speed(target).is_ok());
                    if valid {
                        self.voices[d].as_mut().unwrap().synced = false;
                        self.voices[d].as_mut().unwrap().launch_beat = None;
                        let voice = self.voices[d].as_mut().unwrap();
                        let _ = if smooth {
                            voice.smooth_tempo(target)
                        } else {
                            voice.tempo(target)
                        };
                    } else if let Some(v) = &mut self.voices[d] {
                        v.timing_error = 2;
                    }
                }
            }
            Command::MasterTempo(bpm) => {
                if bpm.is_finite() && (15.0..=600.0).contains(&bpm) {
                    if let Some(auto) = &mut self.auto {
                        auto.manual_tempo = true;
                    }
                    self.tempo_target = None;
                    self.master_bpm = bpm;
                    self.master_bpm_set = true;
                    self.drift_target = None;
                }
            }
            Command::MasterTarget(bpm) => {
                if bpm.is_finite() && (15.0..=600.0).contains(&bpm) {
                    if let Some(auto) = &mut self.auto {
                        auto.manual_tempo = true;
                    }
                    self.tempo_target = Some(bpm);
                    self.drift_target = None;
                    self.master_bpm_set = true;
                }
            }
            Command::Drift(d, generations) => {
                if self.matches(generations)
                    && self.voices[d].as_ref().is_some_and(|v| v.grid.is_some())
                {
                    if let Some(auto) = &mut self.auto {
                        auto.manual_tempo = true;
                    }
                    if !self.master_bpm_set {
                        self.master_bpm = self.voices[d].as_ref().unwrap().grid.unwrap().bpm;
                        self.master_bpm_set = true;
                    }
                    self.tempo_target = None;
                    self.drift_target = Some(d);
                }
            }
            Command::DriftRate(rate) => {
                if rate.is_finite() && (0.01..=100.).contains(&rate) {
                    self.drift_rate = rate;
                }
            }
            Command::JumpCrossfade(frames) => {
                self.jump_crossfade = frames.min(crate::sample_rate::get() / 10);
            }
            Command::SyncQuantum(quantum) => {
                if quantum == 1 || quantum == 4 {
                    self.sync_quantum = quantum;
                }
            }
            Command::Sync(d, generations, enabled) => {
                if self.matches(generations) {
                    if !enabled {
                        if let Some(v) = &mut self.voices[d] {
                            v.synced = false;
                            v.launch_beat = None;
                            v.timing_error = 0;
                        }
                    } else if self.align_to_master(d).is_ok() {
                        let voice = self.voices[d].as_mut().unwrap();
                        voice.clear_jog();
                        voice.synced = true;
                    } else if let Some(v) = &mut self.voices[d] {
                        v.timing_error = 1;
                    }
                }
            }
        }
        None
    }
    pub fn next(&mut self) -> Result<Frame> {
        self.prepare_notes();
        self.next_inner(false)
    }
    fn prepare_notes(&mut self) {
        for d in 0..2 {
            let (generation, pitch) = self.voices[d]
                .as_ref()
                .map_or((0, 0.), |v| (v.generation, v.pitch_semitones));
            self.note_lanes[d].prepare(generation, pitch);
            self.cue_lanes[d].prepare(generation);
        }
    }
    fn next_inner(&mut self, deferred: bool) -> Result<Frame> {
        for d in 0..2 {
            while let Some((slot, on)) = self.cue_lanes[d].next(self.output_frame) {
                if on {
                    // Sequenced gates never create a missing cue and always preview,
                    // including when the deck was already playing before the event.
                    if let Some(position) = self.voices[d].as_ref().and_then(|v| v.hot_cues[slot]) {
                        self.cancel_auto();
                        let v = self.voices[d].as_mut().unwrap();
                        v.clear_loop();
                        v.seek(position);
                        v.play();
                        v.cue_preview = true;
                        v.hot_cue_preview = Some((slot, position));
                    }
                } else if let Some(v) = &mut self.voices[d] {
                    if let Some((held_slot, position)) = v.hot_cue_preview.filter(|_| v.cue_preview)
                    {
                        if held_slot == slot {
                            v.playing = false;
                            v.seek(position);
                        }
                    }
                }
            }
            if let Some(v) = &mut self.voices[d] {
                let shift = self.note_lanes[d].pitch(self.output_frame);
                if self.note_lanes[d]
                    .midi
                    .host
                    .generation
                    .load(std::sync::atomic::Ordering::SeqCst)
                    == v.generation
                {
                    v.pitch(shift)?;
                }
            }
        }
        self.advance_auto();
        let mut frame = Frame {
            auto_fast: self.auto.is_some_and(|a| a.fast),
            auto_mode: std::array::from_fn(|d| {
                self.auto
                    .filter(|a| a.from == d)
                    .map_or(0, |a| if a.end { 2 } else { 1 })
            }),
            headphone_cue: self.headphone_cue,
            crossfader: self.crossfader,
            crossfader_enabled: self.crossfader_enabled,
            output_frame: self.output_frame,
            ..Frame::default()
        };
        if !self
            .voices
            .iter()
            .flatten()
            .any(|v| v.playing && v.launch_beat.is_none())
        {
            if let Some(d) = self.voices.iter().position(|v| {
                v.as_ref()
                    .is_some_and(|v| v.playing && v.launch_beat.is_some())
            }) {
                let voice = self.voices[d].as_mut().unwrap();
                self.global_beat = voice.grid.map_or(0., |grid| grid.beat(voice.seconds()));
                voice.launch_beat = None;
            }
        }
        let master_ramping = self.drift_target.is_some() || self.tempo_target.is_some();
        if master_ramping {
            let target = self.tempo_target.or_else(|| {
                self.drift_target
                    .and_then(|d| self.voices[d].as_ref()?.grid.map(|g| g.bpm))
            });
            if let Some(target) = target {
                let step = self.drift_rate / (crate::sample_rate::get() as f64);
                let next = if (target - self.master_bpm).abs() <= step {
                    target
                } else {
                    self.master_bpm + step.copysign(target - self.master_bpm)
                };
                if self
                    .voices
                    .iter()
                    .flatten()
                    .any(|v| v.synced && !v.grid.is_some_and(|g| g.speed(next).is_ok()))
                {
                    self.drift_target = None;
                    self.tempo_target = None;
                } else {
                    self.master_bpm = next;
                    if next == target {
                        self.tempo_target = None;
                        self.drift_target = None;
                    }
                }
            } else {
                self.drift_target = None;
            }
        }
        let patterns_running = crate::patterns::clock_running();
        if patterns_running {
            self.master_bpm_set = true;
        }
        frame.master_running = self
            .voices
            .iter()
            .flatten()
            .any(|v| v.playing && v.launch_beat.is_none())
            || patterns_running;
        if frame.master_running {
            self.global_beat += self.master_bpm / (60. * (crate::sample_rate::get() as f64));
        }
        frame.global_beat = self.global_beat;
        frame.master_bpm = self.master_bpm;
        frame.master_bpm_set = self.master_bpm_set;
        frame.drift_rate = self.drift_rate;
        frame.sync_quantum = self.sync_quantum;
        frame.drift_target = self.drift_target;
        self.output_frame += 1;
        if self.crossfader_ramp > 0 {
            for d in 0..2 {
                self.crossfader_current[d] += (self.crossfader_target[d]
                    - self.crossfader_current[d])
                    / self.crossfader_ramp as f32;
            }
            self.crossfader_ramp -= 1;
        }
        let routed = !self.routing.conventional;
        let mut players = [[0.; 2]; 2];
        for (d, voice) in self.voices.iter_mut().enumerate() {
            let target = if self.headphone_cue[d] { 1. } else { 0. };
            self.cue_current[d] += (target - self.cue_current[d]).clamp(
                -1. / crate::sample_rate::fine_frames() as f32,
                1. / crate::sample_rate::fine_frames() as f32,
            );
            if let Some(voice) = voice {
                if voice
                    .launch_beat
                    .is_some_and(|beat| self.global_beat >= beat)
                {
                    voice.launch_beat = None;
                }
                let update_delta = if self.drift_target.is_some() || self.tempo_target.is_some() {
                    0.05
                } else {
                    0.000001
                };
                if self.master_bpm_set
                    && voice.vinyl_tail.is_none()
                    && voice.synced
                    && (voice.target_bpm - self.master_bpm).abs() > update_delta
                {
                    if voice.grid.is_some_and(|g| g.speed(self.master_bpm).is_ok()) {
                        if master_ramping {
                            // Gradual master changes follow the same continuous
                            // ratio path as automatic transitions. Re-seeking
                            // every 0.05 BPM repeatedly re-primes the stretcher
                            // and fades the audio on the real-time producer.
                            voice.continuous_tempo(self.master_bpm);
                        } else {
                            let _ = voice.tempo(self.master_bpm);
                        }
                    } else {
                        voice.synced = false;
                        voice.timing_error = 2;
                    }
                }
                voice.finish_loop_release(
                    self.global_beat,
                    self.master_bpm / (60. * (crate::sample_rate::get() as f64)),
                );
                let sample = if routed {
                    voice.next_mode::<true>()?
                } else {
                    voice.next()?
                };
                if routed {
                    players[d] = sample;
                }
                frame.deck_samples[d] = sample;
                for channel in 0..2 {
                    frame.cue_samples[channel] +=
                        voice.pre_fader[channel] * MIX_GAIN * self.cue_current[d];
                }
                for (target, value) in frame.samples.iter_mut().zip(sample) {
                    *target += value * MIX_GAIN * self.crossfader_current[d];
                }
                frame.positions[d] = voice.position as u64;
                frame.generations[d] = voice.generation;
                frame.position_epochs[d] = voice.position_epoch;
                frame.playing[d] = voice.playing;
                frame.cue_positions[d] = voice.cue_position as u64;
                frame.hot_cues[d] = voice.hot_cues.map(|p| p.map(|p| p as u64));
                frame.cue_preview[d] = voice.cue_preview;
                frame.loop_starts[d] = voice.loop_start.map(|p| p as u64);
                frame.loop_ends[d] = voice.loop_end.map(|p| p as u64);
                frame.loop_lengths[d] = voice.loop_length;
                frame.loop_release_pending[d] = voice.loop_release_beat.is_some();
                frame.slip_enabled[d] = voice.slip_enabled;
                frame.gains[d] = voice.gain;
                frame.mixer[d] = voice.mixer.settings;
                frame.grids[d] = voice.grid;
                frame.targets[d] = voice.target_bpm;
                frame.pitches[d] = voice.pitch_semitones;
                frame.synced[d] = voice.synced;
                frame.launch_pending[d] = voice.launch_beat.is_some();
                frame.clicks[d] = voice.click_gain;
                frame.timing_errors[d] = voice.timing_error;
                frame.reposition[d] = voice.reposition_seconds;
            }
        }
        self.transition_guides(&mut frame);
        if let Some(voice) = &mut self.audition {
            if (voice.master || voice.sequence) && frame.playing.iter().any(|playing| *playing) {
                voice.playing = false;
            }
            frame.audition_master = voice.master;
            frame.audition_samples = voice.next()?;
            frame.audition_index = voice.index;
            frame.audition_generation = voice.generation;
            frame.audition_position = voice.position as u64;
            frame.audition_playing = voice.playing;
        }
        frame.routing_players = players;
        frame.routing_cross = self.crossfader_current;
        frame.routing_cue = self.cue_current;
        if routed && !deferred {
            let (outputs, meters) = self.routing.render(
                players,
                frame.mixer,
                frame.gains,
                self.crossfader_current,
                self.cue_current,
            );
            frame.samples = outputs[0];
            frame.cue_samples = outputs[1];
            frame.deck_samples = meters;
        }
        if deferred {
            return Ok(frame);
        }
        self.finish_routing(&mut frame);
        Ok(frame)
    }
    fn finish_routing(&mut self, frame: &mut Frame) {
        if self.route_transition > 0 {
            let blend =
                1. - self.route_transition as f32 / crate::sample_rate::fine_frames() as f32;
            for (output, previous) in [&mut frame.samples, &mut frame.cue_samples]
                .into_iter()
                .zip(self.route_from)
            {
                for c in 0..2 {
                    output[c] = previous[c] * (1. - blend) + output[c] * blend;
                }
            }
            self.route_transition -= 1;
        }
        self.route_last = [frame.samples, frame.cue_samples];
        for c in 0..2 {
            if frame.audition_master {
                frame.samples[c] += frame.audition_samples[c];
            } else {
                frame.cue_samples[c] += frame.audition_samples[c];
            }
        }
        for sample in frame.samples.iter_mut().chain(frame.cue_samples.iter_mut()) {
            *sample = sample.clamp(-1., 1.);
        }
    }
    pub fn next_block(
        &mut self,
        block: &mut [Frame; PRODUCER_FRAMES],
        drivers: &mut [crate::teia_audio::Driver],
    ) -> Result<()> {
        // Drain incoming MIDI and inspect route cancellation once per block.
        // Repeating preparation per sample resets the 2,048-slot release scan,
        // even when idle. Timestamped events are still applied by next_inner at
        // their exact frame within this block.
        self.prepare_notes();
        let routed = !self.routing.conventional;
        for frame in block.iter_mut() {
            *frame = self.next_inner(routed)?;
        }
        if routed {
            self.routing.render_block(block, drivers);
            for frame in block.iter_mut() {
                self.finish_routing(frame);
            }
        }
        self.routing.capture_waveforms(block);
        // Inactive hosts must still acknowledge commands (including installation).
        for (slot, driver) in drivers.iter_mut().enumerate() {
            if !self.routing.has_patch(slot) && driver.needs_process() {
                let mut silent = *block;
                for frame in &mut silent {
                    frame.samples = [0.; 2];
                    frame.cue_samples = [0.; 2];
                }
                driver.process(&mut silent);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_tempo_and_key_play_source_samples_without_stretching() {
        let pcm: Vec<_> = (0..2049).map(|i| (i as f32 * 0.13).sin() * 0.2).collect();
        let source = Arc::new(Source {
            progressive: None,
            bass_profile: Default::default(),
            left: pcm.clone(),
            right: pcm.iter().map(|x| -x).collect(),
        });
        let mut voice = Voice::new(source, 1);
        voice.gain = 1.;
        voice.play();
        for (i, sample) in pcm.iter().enumerate() {
            let value = voice.next().unwrap();
            if i >= crate::sample_rate::fine_frames() {
                assert_eq!(value, [*sample, -*sample]);
            }
            assert_eq!(voice.position, i + 1);
        }
        assert!(!voice.playing);
        assert_eq!(voice.dsp.calls.count, 0);
    }

    #[test]
    fn direct_playback_enters_stretcher_on_smooth_tempo_and_jog_changes() {
        for jog in [false, true] {
            let mut voice = Voice::new(source(), 1);
            voice.apply_grid(Grid {
                bpm: 120.,
                downbeat_seconds: 0.,
                reviewed: true,
            });
            voice.play();
            for _ in 0..1000 {
                voice.next().unwrap();
            }
            let epoch = voice.position_epoch;
            let position = voice.seconds();
            if jog {
                voice.jog_by(0.03);
            } else {
                voice.smooth_tempo(132.).unwrap();
            }
            for _ in 0..crate::sample_rate::get() / 5 {
                assert!(voice.next().unwrap().iter().all(|x| x.is_finite()));
            }
            assert!(!voice.direct_playback);
            assert!(voice.dsp.calls.count > 0);
            assert_eq!(voice.position_epoch, epoch);
            assert!(voice.seconds() > position + 0.18 && voice.seconds() < position + 0.25);
            voice.tempo(120.).unwrap();
            assert!(voice.direct_playback);
            let calls = voice.dsp.calls.count;
            for _ in 0..1024 {
                voice.next().unwrap();
            }
            assert_eq!(voice.dsp.calls.count, calls);
        }
    }

    #[test]
    fn sample_rate_contract_preserves_duration_pitch_beats_and_seek() {
        let rate = crate::sample_rate::get();
        let pcm: Vec<_> = (0..rate * 4)
            .map(|i| (i as f32 * 440. * std::f32::consts::TAU / rate as f32).sin() * 0.2)
            .collect();
        let source = Arc::new(Source {
            progressive: None,
            bass_profile: Default::default(),
            left: pcm.clone(),
            right: pcm,
        });
        let grid = Grid {
            bpm: 120.,
            downbeat_seconds: 0.,
            reviewed: true,
        };
        for speed in [1., 1.25] {
            let mut voice = Voice::new(source.clone(), 1);
            voice.apply_grid(grid);
            voice.tempo(120. * speed).unwrap();
            voice.play();
            let mut frames = 0;
            let mut crossings = 0;
            let mut previous = 0.;
            while voice.playing {
                let sample = voice.next().unwrap()[0];
                if (rate..rate * 2).contains(&frames) && previous <= 0. && sample > 0. {
                    crossings += 1;
                }
                previous = sample;
                frames += 1;
            }
            assert!((frames as f64 - 4. * rate as f64 / speed).abs() <= 1.);
            assert!(
                (crossings as i32 - 440).abs() <= 3,
                "pitch changed at {rate} Hz: {crossings}"
            );
            voice.seek(rate * 2);
            assert!((voice.seconds() - 2.).abs() <= 1. / rate as f64);
        }
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source);
        decks.voices[0].as_mut().unwrap().apply_grid(grid);
        decks.command(Command::MasterTempo(120.), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        let start = decks.global_beat;
        for _ in 0..rate {
            decks.next().unwrap();
        }
        assert!((decks.global_beat - start - 2.).abs() < 1e-8);
        assert!((decks.voices[0].as_ref().unwrap().seconds() - 1.).abs() <= 1. / rate as f64);
    }

    #[test]
    fn gradual_master_tempo_does_not_repeatedly_fade_or_reprime_playback() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        let voice = decks.voices[0].as_mut().unwrap();
        voice.apply_grid(Grid {
            bpm: 120.,
            downbeat_seconds: 0.,
            reviewed: true,
        });
        voice.synced = true;
        voice.play();
        decks.command(Command::MasterTempo(120.), [1, 0]);
        decks.command(Command::DriftRate(2.), [1, 0]);
        decks.command(Command::MasterTarget(121.), [1, 0]);
        let mut block = [Frame::default(); PRODUCER_FRAMES];
        for _ in 0..crate::sample_rate::get().div_ceil(PRODUCER_FRAMES) {
            decks.next_block(&mut block, &mut []).unwrap();
            assert!(block
                .iter()
                .all(|f| f.samples.iter().all(|x| x.is_finite())));
            if decks.output_frame > crate::sample_rate::get() as u64 / 10 {
                assert_eq!(decks.voices[0].as_ref().unwrap().transition, 0);
            }
        }
        assert_eq!(decks.master_bpm, 121.);
        assert_eq!(decks.voices[0].as_ref().unwrap().target_bpm, 121.);
    }

    #[test]
    fn master_numeric_target_uses_drift_rate_and_stops_exactly() {
        let mut decks = Decks::new();
        decks.command(Command::MasterTempo(120.), [0, 0]);
        decks.command(Command::DriftRate(2.), [0, 0]);
        decks.command(Command::MasterTarget(123.), [0, 0]);
        for _ in 0..48000 {
            decks.next().unwrap();
        }
        assert!((decks.master_bpm - 122.).abs() < 1e-6);
        for _ in 0..48000 {
            decks.next().unwrap();
        }
        assert_eq!(decks.master_bpm, 123.);
        assert_eq!(decks.tempo_target, None);
        decks.command(Command::MasterTarget(119.), [0, 0]);
        for _ in 0..24000 {
            decks.next().unwrap();
        }
        assert!((decks.master_bpm - 122.).abs() < 1e-6);
        decks.command(Command::MasterTempo(125.), [0, 0]);
        assert_eq!(decks.tempo_target, None);
    }

    #[test]
    fn active_deck_uses_rendered_eq_and_fader_levels_before_crossfader() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        install(&mut decks, 1, 1, source());
        decks.command(Command::Play(0, 1), [1, 1]);
        decks.command(Command::Play(1, 1), [1, 1]);
        decks.command(Command::Crossfader(1.), [1, 1]);
        decks.command(Command::Gain(1, 1, 0.1), [1, 1]);
        let mut tracker = crate::active_deck::Tracker::default();
        let observe = |decks: &mut Decks, tracker: &mut crate::active_deck::Tracker, count| {
            for _ in 0..count {
                let frame = decks.next().unwrap();
                tracker.observe(frame.playing, frame.deck_samples);
            }
            tracker.selected()
        };
        assert_eq!(observe(&mut decks, &mut tracker, 8000), 0);
        decks.command(Command::Gain(0, 1, 0.), [1, 1]);
        decks.command(Command::Gain(1, 1, 1.), [1, 1]);
        assert_eq!(observe(&mut decks, &mut tracker, 10000), 1);
        decks.command(Command::Gain(0, 1, 1.), [1, 1]);
        for band in 1..=3 {
            decks.command(Command::Mixer(1, 1, band, 0.), [1, 1]);
        }
        assert_eq!(observe(&mut decks, &mut tracker, 16000), 0);
    }
    #[test]
    fn cue_pattern_gates_play_exact_frames_and_return_without_changing_pitch() {
        use teia_kernel::hosted::EventKind;
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.voices[0]
            .as_mut()
            .unwrap()
            .restore_hot_cues([Some(0.25), None, None, None]);
        decks.command(Command::Pitch(0, 1, 2.), [1, 0]);
        decks.cue_lanes[0].prepare(1);
        let host = decks.cue_lanes[0].midi.host.clone();
        host.enqueue(
            10,
            EventKind::NoteOn {
                channel: 1,
                note: 0,
                velocity: 1.,
            },
        );
        host.enqueue(
            30,
            EventKind::NoteOff {
                channel: 1,
                note: 0,
            },
        );
        // Unset slots are ignored, rather than being created by the sequencer.
        host.enqueue(
            40,
            EventKind::NoteOn {
                channel: 1,
                note: 1,
                velocity: 1.,
            },
        );
        host.enqueue(
            50,
            EventKind::NoteOff {
                channel: 1,
                note: 1,
            },
        );
        let mut block = [Frame::default(); PRODUCER_FRAMES];
        decks.next_block(&mut block, &mut []).unwrap();
        assert!(!block[9].playing[0]);
        assert!(block[10].playing[0] && block[10].cue_preview[0]);
        assert!(block[29].playing[0]);
        assert!(!block[30].playing[0] && !block[30].cue_preview[0]);
        assert_eq!(
            block[30].positions[0],
            (crate::sample_rate::get() / 4) as u64
        );
        assert!(block
            .iter()
            .all(|f| f.pitches[0] == 2. && f.hot_cues[0][1].is_none()));
        assert!(!block[40].playing[0]);
    }
    #[test]
    fn cue_pattern_route_cancellation_releases_and_track_replacement_drops_old_gates() {
        use teia_kernel::hosted::EventKind;
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.voices[0]
            .as_mut()
            .unwrap()
            .restore_hot_cues([Some(0.25), None, None, None]);
        let mut block = [Frame::default(); PRODUCER_FRAMES];
        decks.next_block(&mut block, &mut []).unwrap();
        let host = decks.cue_lanes[0].midi.host.clone();
        host.anchor(decks.output_frame, 1_000_000_000);
        assert!(host.enqueue_routed_time(
            1_000_000_000,
            EventKind::NoteOn {
                channel: 1,
                note: 0,
                velocity: 1.
            },
            7
        ));
        decks.command(Command::Play(0, 1), [1, 0]);
        decks.next_block(&mut block, &mut []).unwrap();
        assert!(block[0].playing[0] && block[0].cue_preview[0]);
        host.cancel_route(7);
        decks.next_block(&mut block, &mut []).unwrap();
        assert!(block.iter().all(|f| !f.playing[0]));
        assert!(host.enqueue_routed_time(
            2_000_000_000,
            EventKind::NoteOn {
                channel: 1,
                note: 0,
                velocity: 1.
            },
            7
        ));
        install(&mut decks, 0, 2, source());
        decks.next_block(&mut block, &mut []).unwrap();
        assert!(block
            .iter()
            .all(|f| !f.playing[0] && f.hot_cues[0] == [None; 4]));
    }
    #[test]
    fn deck_note_events_change_pitch_at_render_frame_and_restore_manual_control() {
        use teia_kernel::hosted::EventKind;
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(Command::Pitch(0, 1, -1.), [1, 0]);
        decks.note_lanes[0].prepare(1, -1.);
        let h = decks.note_lanes[0].midi.host.clone();
        h.enqueue(
            10,
            EventKind::NoteOn {
                channel: 1,
                note: 64,
                velocity: 1.,
            },
        );
        h.enqueue(
            20,
            EventKind::NoteOff {
                channel: 1,
                note: 64,
            },
        );
        let mut block = [Frame::default(); PRODUCER_FRAMES];
        decks.next_block(&mut block, &mut []).unwrap();
        assert_eq!(block[9].pitches[0], -1.);
        assert_eq!(block[10].pitches[0], 3.);
        assert_eq!(block[19].pitches[0], 3.);
        assert_eq!(block[20].pitches[0], -1.);
    }
    #[test]
    fn deck_note_blocks_preserve_future_events_and_release_cancelled_routes() {
        use teia_kernel::hosted::EventKind;
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(Command::Pitch(0, 1, -1.), [1, 0]);
        let mut block = [Frame::default(); PRODUCER_FRAMES];
        decks.next_block(&mut block, &mut []).unwrap();
        let h = decks.note_lanes[0].midi.host.clone();
        h.anchor(
            decks.output_frame + PRODUCER_FRAMES as u64 + 17,
            1_000_000_000,
        );
        assert!(h.enqueue_routed_time(
            1_000_000_000,
            EventKind::NoteOn {
                channel: 1,
                note: 64,
                velocity: 1.,
            },
            3,
        ));
        decks.next_block(&mut block, &mut []).unwrap();
        assert!(block.iter().all(|frame| frame.pitches[0] == -1.));
        decks.next_block(&mut block, &mut []).unwrap();
        assert_eq!(block[16].pitches[0], -1.);
        assert_eq!(block[17].pitches[0], 3.);
        assert_eq!(block[PRODUCER_FRAMES - 1].pitches[0], 3.);
        h.cancel_route(3);
        decks.next_block(&mut block, &mut []).unwrap();
        assert!(block.iter().all(|frame| frame.pitches[0] == -1.));
    }
    #[test]
    fn first_play_establishes_master_once() {
        for first in 0..2 {
            let mut decks = Decks::new();
            for d in 0..2 {
                install(&mut decks, d, 1, source());
                let v = decks.voices[d].as_mut().unwrap();
                v.apply_grid(Grid {
                    bpm: 128. + d as f64 * 12.,
                    downbeat_seconds: 0.,
                    reviewed: false,
                });
            }
            decks.command(Command::Sync(first, [1, 1], true), [1, 1]);
            assert!(!decks.next().unwrap().master_bpm_set);
            assert_eq!(
                decks.voices[first].as_ref().unwrap().target_bpm,
                128. + first as f64 * 12.
            );
            decks.command(Command::Play(first, 99), [1, 1]);
            assert!(!decks.master_bpm_set);
            decks.command(Command::Play(first, 1), [1, 1]);
            let expected = 128. + first as f64 * 12.;
            assert!(decks.next().unwrap().master_bpm_set);
            assert_eq!(decks.master_bpm, expected);
            decks.command(Command::Pause(first, 1), [1, 1]);
            decks.command(Command::Play(1 - first, 1), [1, 1]);
            assert_eq!(decks.master_bpm, expected);
        }
    }

    #[test]
    fn tapped_grid_preserves_transport_and_follows_only_without_another_lock() {
        for other_locked in [false, true] {
            for playing in [false, true] {
                let mut decks = Decks::new();
                for d in 0..2 {
                    install(&mut decks, d, 1, source());
                    let v = decks.voices[d].as_mut().unwrap();
                    v.apply_grid(Grid {
                        bpm: 120.,
                        downbeat_seconds: 0.,
                        reviewed: true,
                    });
                    v.tempo(126.).unwrap();
                    v.synced = d == 0 || other_locked;
                    v.playing = playing;
                }
                decks.master_bpm = 126.;
                decks.master_bpm_set = true;
                decks.global_beat = 9.;
                let before = decks.voices[0].as_ref().unwrap();
                let speed = before.clock.speed;
                let position = before.clock.at(before.output);
                let epoch = before.position_epoch;
                decks.command(Command::TapGridStart(0, 99), [1, 1]);
                assert!(decks.voices[0].as_ref().unwrap().synced);
                decks.command(Command::TapGridStart(0, 1), [1, 1]);
                assert_eq!(decks.voices[0].as_ref().unwrap().synced, !other_locked);
                let grid = Grid {
                    bpm: 100.,
                    downbeat_seconds: 0.01,
                    reviewed: false,
                };
                decks.command(Command::TappedGrid(0, 99, grid), [1, 1]);
                assert_eq!(decks.voices[0].as_ref().unwrap().grid.unwrap().bpm, 120.);
                decks.command(Command::TappedGrid(0, 1, grid), [1, 1]);
                let v = decks.voices[0].as_ref().unwrap();
                assert_eq!(v.clock.speed, speed);
                assert_eq!(v.clock.at(v.output), position);
                assert_eq!(v.position_epoch, epoch);
                assert_eq!(v.playing, playing);
                assert_eq!(v.synced, !other_locked);
                assert_eq!(v.target_bpm, 100. * speed);
                assert_eq!(
                    decks.master_bpm,
                    if other_locked { 126. } else { 100. * speed }
                );
                assert_eq!(
                    decks.global_beat,
                    if other_locked {
                        9.
                    } else {
                        grid.beat(v.seconds())
                    }
                );
            }
        }
    }

    #[test]
    fn source_bpm_corrections_preserve_live_audio_speed_and_lock() {
        for locked in [false, true] {
            for bpm in [60., 240., 119.] {
                let setup = || {
                    let mut decks = Decks::new();
                    install(&mut decks, 0, 1, source());
                    let v = decks.voices[0].as_mut().unwrap();
                    v.apply_grid(Grid {
                        bpm: 120.,
                        downbeat_seconds: 0.,
                        reviewed: true,
                    });
                    v.tempo(126.).unwrap();
                    v.synced = locked;
                    decks.master_bpm = 126.;
                    decks.master_bpm_set = true;
                    decks.command(Command::Play(0, 1), [1, 0]);
                    for _ in 0..4096 {
                        decks.next().unwrap();
                    }
                    decks
                };
                let mut original = setup();
                let mut corrected = setup();
                let before = corrected.voices[0].as_ref().unwrap();
                let epoch = before.position_epoch;
                let position = before.clock.at(before.output);
                corrected.command(
                    Command::ReinterpretGrid(
                        0,
                        1,
                        Grid {
                            bpm,
                            downbeat_seconds: 0.,
                            reviewed: false,
                        },
                    ),
                    [1, 0],
                );
                let v = corrected.voices[0].as_ref().unwrap();
                assert_eq!(v.clock.at(v.output), position);
                assert_eq!(v.position_epoch, epoch);
                assert_eq!(v.clock.speed, 1.05);
                assert_eq!(v.target_bpm, bpm * 1.05);
                assert_eq!(v.synced, locked);
                assert_eq!(corrected.master_bpm, if locked { bpm * 1.05 } else { 126. });
                for _ in 0..4096 {
                    let a = original.next().unwrap();
                    let b = corrected.next().unwrap();
                    assert_eq!(a.deck_samples, b.deck_samples);
                    assert_eq!(a.positions[0], b.positions[0]);
                }
            }
        }
    }

    #[test]
    fn solo_bar_shift_follows_grid_without_changing_audio_speed_or_lock() {
        for deck in 0..2 {
            for locked in [false, true] {
                for direction in [-1., 1.] {
                    let setup = || {
                        let mut decks = auto_decks(deck, 8, false);
                        decks.auto = None;
                        let voice = decks.voices[deck].as_mut().unwrap();
                        voice.grid.as_mut().unwrap().downbeat_seconds = 1.;
                        voice.synced = locked;
                        voice.tempo(126.).unwrap();
                        decks.master_bpm = 126.;
                        for _ in 0..1024 {
                            decks.next().unwrap();
                        }
                        decks
                    };
                    let mut original = setup();
                    let mut corrected = setup();
                    let before = corrected.voices[deck].as_ref().unwrap();
                    let mut grid = before.grid.unwrap();
                    grid.downbeat_seconds = 1. + direction * 60. / grid.bpm;
                    let position = before.seconds();
                    let epoch = before.position_epoch;
                    let speed = before.clock.speed;
                    corrected.command(Command::ShiftBarGrid(deck, 1, grid), [1, 1]);
                    let voice = corrected.voices[deck].as_ref().unwrap();
                    assert_eq!(voice.grid.unwrap().downbeat_seconds, grid.downbeat_seconds);
                    assert_eq!(voice.seconds(), position);
                    assert_eq!(voice.position_epoch, epoch);
                    assert_eq!(voice.clock.speed, speed);
                    assert_eq!(voice.synced, locked);
                    assert_eq!(corrected.global_beat, grid.beat(position));
                    assert_eq!(corrected.master_bpm, voice.target_bpm);
                    for _ in 0..1024 {
                        let a = original.next().unwrap();
                        let b = corrected.next().unwrap();
                        assert_eq!(a.deck_samples, b.deck_samples);
                        assert_eq!(a.positions, b.positions);
                    }
                }
            }
        }
    }

    #[test]
    fn bar_shift_rejects_two_playing_decks_and_stale_generations() {
        for stale in [false, true] {
            let mut decks = auto_decks(0, 8, false);
            decks.auto = None;
            decks.voices[1].as_mut().unwrap().playing = !stale;
            let before = decks.voices[0].as_ref().unwrap().grid.unwrap();
            let beat = decks.global_beat;
            decks.command(
                Command::ShiftBarGrid(
                    0,
                    if stale { 99 } else { 1 },
                    Grid {
                        downbeat_seconds: before.downbeat_seconds + 60. / before.bpm,
                        ..before
                    },
                ),
                [1, 1],
            );
            assert_eq!(
                decks.voices[0]
                    .as_ref()
                    .unwrap()
                    .grid
                    .unwrap()
                    .downbeat_seconds,
                before.downbeat_seconds
            );
            assert_eq!(decks.global_beat, beat);
        }
    }

    #[test]
    fn inactive_source_bpm_corrections_leave_master_and_other_audio_unchanged() {
        for waiting in [false, true] {
            for bpm in [60., 240.] {
                let setup = || {
                    let mut decks = auto_decks(1, 8, false);
                    decks.master_bpm = 140.;
                    decks.master_bpm_set = true;
                    let voice = decks.voices[0].as_mut().unwrap();
                    voice.synced = true;
                    voice.playing = waiting;
                    voice.launch_beat = waiting.then_some(100.);
                    decks
                };
                let mut original = setup();
                let mut corrected = setup();
                corrected.command(
                    Command::ReinterpretGrid(
                        0,
                        1,
                        Grid {
                            bpm,
                            downbeat_seconds: 0.,
                            reviewed: false,
                        },
                    ),
                    [1, 1],
                );
                assert_eq!(corrected.master_bpm, 140.);
                assert_eq!(corrected.voices[0].as_ref().unwrap().grid.unwrap().bpm, bpm);
                for _ in 0..256 {
                    let a = original.next().unwrap();
                    let b = corrected.next().unwrap();
                    assert_eq!(a.master_bpm, b.master_bpm);
                    assert_eq!(a.deck_samples[1], b.deck_samples[1]);
                    assert_eq!(a.positions[1], b.positions[1]);
                }
            }
        }
    }

    #[test]
    fn explicit_master_before_first_play_is_preserved() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.voices[0].as_mut().unwrap().apply_grid(Grid {
            bpm: 140.,
            downbeat_seconds: 0.,
            reviewed: false,
        });
        decks.command(Command::MasterTempo(125.), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        assert_eq!(decks.master_bpm, 125.);
        assert!(decks.master_bpm_set);
    }

    #[test]
    fn master_audition_stops_when_a_deck_plays() {
        let mut decks = Decks::new();
        let mut voice = Audition::new(source(), 9);
        voice.master = true;
        drop(decks.command(Command::AuditionInstall(Box::new(voice)), [0, 0]));
        let mut peak = 0_f32;
        for _ in 0..1000 {
            let frame = decks.next().unwrap();
            peak = peak.max(frame.samples[0].abs());
            assert_eq!(frame.cue_samples, [0.; 2]);
        }
        assert!(peak > 0.);
        install(&mut decks, 0, 1, source());
        decks.command(Command::Play(0, 1), [1, 0]);
        assert!(!decks.next().unwrap().audition_playing);
    }
    #[test]
    fn library_audition_is_cue_only_in_default_and_edited_routing() {
        for edited in [false, true] {
            let mut decks = Decks::new();
            let mut reference = Decks::new();
            if edited {
                // A disconnected cue output cannot redirect the audition to master.
                let mut graph = crate::routing::Graph::default();
                graph.wires.clear();
                drop(decks.command(Command::Routing(graph.clone().compile().unwrap()), [0, 0]));
                drop(reference.command(Command::Routing(graph.compile().unwrap()), [0, 0]));
            }
            install(&mut decks, 0, 1, source());
            install(&mut reference, 0, 1, source());
            decks.command(Command::Play(0, 1), [1, 0]);
            reference.command(Command::Play(0, 1), [1, 0]);
            drop(decks.command(
                Command::AuditionInstall(Box::new(Audition::new(source(), 7))),
                [1, 0],
            ));
            let mut cue_peak = 0_f32;
            for _ in 0..1000 {
                let a = decks.next().unwrap();
                let b = reference.next().unwrap();
                assert_eq!(a.samples, b.samples);
                assert_eq!(a.positions, b.positions);
                assert_eq!(a.playing, b.playing);
                cue_peak = cue_peak.max(a.cue_samples[0].abs());
            }
            assert!(cue_peak > 0.05);
            let mut block = [Frame::default(); PRODUCER_FRAMES];
            decks.next_block(&mut block, &mut []).unwrap();
            assert!(block.iter().any(|frame| frame.cue_samples[0].abs() > 0.05));
            decks.command(Command::AuditionControl(7, None), [1, 0]);
            let paused = decks.next().unwrap();
            assert_eq!(paused.audition_position, 1000 + PRODUCER_FRAMES as u64);
            assert!(!paused.audition_playing);
            assert_eq!(paused.cue_samples, [0.; 2]);
            decks.command(Command::AuditionControl(7, Some(47000)), [1, 0]);
            decks.command(Command::AuditionControl(6, None), [1, 0]);
            assert!(!decks.next().unwrap().audition_playing);
            decks.command(Command::AuditionControl(7, None), [1, 0]);
            for _ in 0..1000 {
                decks.next().unwrap();
            }
            assert!(!decks.next().unwrap().audition_playing);
            decks.command(Command::AuditionControl(7, None), [1, 0]);
            assert_eq!(decks.next().unwrap().audition_position, 1);
            drop(decks.command(Command::AuditionStop, [1, 0]));
            let stopped = decks.next().unwrap();
            assert_eq!(stopped.audition_generation, 0);
            assert_eq!(stopped.cue_samples, [0.; 2]);
        }
    }

    #[test]
    fn equal_power_curve_has_silent_endpoints_and_constant_power() {
        assert_eq!(crossfader_gains(-1., true), [1., 0.]);
        assert_eq!(crossfader_gains(1., true), [0., 1.]);
        let centre = crossfader_gains(0., true);
        assert!((centre[0] - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
        assert!((centre[1] - centre[0]).abs() < 1e-6);
        for step in 0..=200 {
            let position = step as f32 / 100. - 1.;
            let [a, b] = crossfader_gains(position, true);
            assert!((a * a + b * b - 1.).abs() < 1e-6);
            assert_eq!(crossfader_gains(position, false), [1., 1.]);
        }
    }

    #[test]
    fn crossfader_attenuates_master_after_channel_meters_and_bypasses_when_hidden() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        install(&mut decks, 1, 1, source());
        decks.command(Command::Play(0, 1), [1, 1]);
        decks.command(Command::Play(1, 1), [1, 1]);
        for position in [-1., 0., 1.] {
            decks.command(Command::Crossfader(position), [1, 1]);
            for _ in 0..240 {
                decks.next().unwrap();
            }
            let frame = decks.next().unwrap();
            let gains = crossfader_gains(position, true);
            for channel in 0..2 {
                let expected = MIX_GAIN
                    * (frame.deck_samples[0][channel] * gains[0]
                        + frame.deck_samples[1][channel] * gains[1]);
                assert!((frame.samples[channel] - expected).abs() < 1e-6);
            }
        }
        decks.command(Command::CrossfaderEnabled(false), [1, 1]);
        for _ in 0..240 {
            decks.next().unwrap();
        }
        let frame = decks.next().unwrap();
        assert!(!frame.crossfader_enabled);
        assert_eq!(frame.crossfader, 1.);
        assert!(
            (frame.samples[0] - MIX_GAIN * (frame.deck_samples[0][0] + frame.deck_samples[1][0]))
                .abs()
                < 1e-6
        );
        assert!(frame.deck_samples[0][0].abs() > 0.001);
    }
    #[test]
    fn headphone_cue_bypasses_faders_selects_both_and_never_changes_master() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        install(&mut decks, 1, 1, source());
        for d in 0..2 {
            decks.command(Command::Play(d, 1), [1, 1]);
            decks.command(Command::Gain(d, 1, 0.), [1, 1]);
        }
        decks.command(Command::Crossfader(1.), [1, 1]);
        let mut power = 0.;
        for selection in [[true, false], [false, true], [true, true], [false, false]] {
            for d in 0..2 {
                decks.command(Command::HeadphoneCue(d, selection[d]), [1, 1]);
            }
            for _ in 0..480 {
                decks.next().unwrap();
            }
            for _ in 0..480 {
                let frame = decks.next().unwrap();
                assert_eq!(frame.samples, [0.; 2]);
                assert_eq!(frame.deck_samples, [[0.; 2]; 2]);
                let expected = (0..2)
                    .filter(|d| selection[*d])
                    .map(|d| decks.voices[d].as_ref().unwrap().pre_fader[0] * MIX_GAIN)
                    .sum::<f32>();
                assert!((frame.cue_samples[0] - expected).abs() < 1e-6);
                assert_eq!(frame.headphone_cue, selection);
                power += frame.cue_samples[0].abs();
            }
        }
        assert!(power > 1.);
        // A stopped deck produces no headphone audio after its braking tail.
        for d in 0..2 {
            decks.command(Command::HeadphoneCue(d, true), [1, 1]);
            decks.command(Command::Pause(d, 1), [1, 1]);
        }
        for _ in 0..crate::sample_rate::get() * 300 / 1000 {
            decks.next().unwrap();
        }
        assert_eq!(decks.next().unwrap().cue_samples, [0.; 2]);
    }

    #[test]
    fn routing_default_remains_sample_identical_after_graph_layout_changes() {
        let mut old = Decks::new();
        let mut edited = Decks::new();
        for decks in [&mut old, &mut edited] {
            install(decks, 0, 1, source());
            install(decks, 1, 1, source());
            for d in 0..2 {
                decks.command(Command::Mixer(d, 1, 1, 0.7), [1, 1]);
                decks.command(Command::Mixer(d, 1, 4, -0.2), [1, 1]);
                decks.command(Command::Play(d, 1), [1, 1]);
            }
        }
        let mut graph = crate::routing::Graph::default();
        graph.nodes.reverse();
        graph.wires.reverse();
        let plan = graph.compile().unwrap();
        assert!(plan.conventional);
        drop(edited.command(Command::Routing(plan), [1, 1]));
        for i in 0..10000 {
            let a = old.next().unwrap();
            let b = edited.next().unwrap();
            if i >= 240 {
                assert_eq!(a.samples, b.samples);
                assert_eq!(a.cue_samples, b.cue_samples);
                assert_eq!(a.deck_samples, b.deck_samples);
            }
        }
    }
    fn auto_decks(from: usize, bars: u8, change_tempo: bool) -> Decks {
        let mut decks = Decks::new();
        let source = Arc::new(Source {
            progressive: None,
            bass_profile: Default::default(),
            left: vec![0.1; 48000 * 40],
            right: vec![0.1; 48000 * 40],
        });
        for d in 0..2 {
            install(&mut decks, d, 1, source.clone());
            decks.command(
                Command::Grid(
                    d,
                    1,
                    Grid {
                        bpm: if d == from { 120. } else { 140. },
                        downbeat_seconds: 0.,
                        reviewed: true,
                    },
                ),
                [1, 1],
            );
        }
        decks.command(Command::AutoBars(bars), [1, 1]);
        decks.command(
            Command::AutoTempo(if change_tempo { 1. } else { 0. }),
            [1, 1],
        );
        decks.command(Command::Play(from, 1), [1, 1]);
        decks
    }
    #[test]
    fn auto_bpm_shift_interpolates_up_and_down_and_is_captured_when_armed() {
        for from in [0, 1] {
            for initial in [120., 160.] {
                for amount in [0., 0.25, 0.5, 1.] {
                    for fast in [false, true] {
                        let mut decks = auto_decks(from, 1, true);
                        decks.master_bpm = initial;
                        decks.command(Command::AutoTempo(amount), [1, 1]);
                        let command = if fast {
                            Command::FastAutoTransition(from, [1, 1], false, 1)
                        } else {
                            Command::AutoTransition(from, [1, 1], false)
                        };
                        decks.command(command, [1, 1]);
                        let target = initial + (140. - initial) * amount;
                        assert_eq!(decks.auto.unwrap().target_bpm, target);
                        // Changing the setting leaves an already armed ramp intact.
                        decks.command(Command::AutoTempo(1. - amount), [1, 1]);
                        decks.voices[1 - from].as_mut().unwrap().playing = true;
                        let auto = decks.auto.as_mut().unwrap();
                        auto.started = true;
                        auto.mixed_beats = auto.beats / 2.;
                        decks.advance_auto();
                        assert!((decks.master_bpm - (initial + target) / 2.).abs() < 1e-9);
                        let auto = decks.auto.as_mut().unwrap();
                        auto.mixed_beats = auto.beats;
                        decks.advance_auto();
                        assert!(decks.auto.is_none());
                        assert!((decks.master_bpm - target).abs() < 1e-9);
                        assert!(
                            (decks.voices[1 - from].as_ref().unwrap().target_bpm - target).abs()
                                < 1e-9
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn fast_auto_uses_its_own_overlap_and_retains_normal_settings() {
        for from in [0, 1] {
            for end in [false, true] {
                let mut decks = auto_decks(from, 8, false);
                decks.command(Command::FastAutoTransition(from, [1, 1], end, 4), [1, 1]);
                let auto = decks.auto.unwrap();
                assert!(auto.fast);
                assert_eq!(auto.beats, 16.);
                assert_eq!(auto.end, end);
                assert_eq!(decks.auto_bars, 8);
                assert!(decks.next().unwrap().auto_fast);
                decks.command(Command::AutoTransition(from, [1, 1], end), [1, 1]);
                assert!(decks.auto.is_none());
                decks.command(Command::AutoTransition(from, [1, 1], end), [1, 1]);
                assert_eq!(decks.auto.unwrap().beats, 32.);
                assert!(!decks.auto.unwrap().fast);
            }
        }
    }

    #[test]
    fn thirty_two_bar_overlap_is_supported_by_decks_and_library_play_all() {
        let source = Arc::new(Source {
            progressive: None,
            bass_profile: Default::default(),
            left: vec![0.; 48000 * 130],
            right: vec![0.; 48000 * 130],
        });
        let mut decks = auto_decks(0, 32, true);
        for v in decks.voices.iter_mut().flatten() {
            v.source = source.clone();
        }
        decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
        assert_eq!(decks.auto.unwrap().beats, 128.);
        assert_eq!(decks.auto.unwrap().start_seconds, 64.);
        decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
        let mut current = Audition::new(source.clone(), 7);
        let mut incoming = Audition::new(source, 8);
        for voice in [&mut current, &mut incoming] {
            voice.set_grid(Some(Grid {
                bpm: 120.,
                downbeat_seconds: 0.,
                reviewed: true,
            }));
        }
        drop(decks.command(Command::AuditionInstall(Box::new(current)), [1, 1]));
        decks.command(Command::AuditionSequence(7, true, 32), [1, 1]);
        drop(decks.command(Command::AuditionQueue(7, 0, Box::new(incoming)), [1, 1]));
        let audition = decks.audition.as_ref().unwrap();
        assert_eq!(audition.overlap_beats, 128.);
        assert_eq!(audition.overlap_start, 48000 * 66);
    }
    #[test]
    fn automatic_transitions_follow_shifted_yellow_phrases_on_either_deck() {
        for from in 0..2 {
            for end in [false, true] {
                // At 120 BPM a four-beat backward shift wraps the anchor to 6s.
                // Cover shifted outgoing and incoming grids, plus a cue before
                // the incoming yellow beat and one directly on it.
                for (out_anchor, in_anchor, cue, now_start, end_start) in [
                    (6., 0., 0., 6., 30.),
                    (0., 6., 0., 2., 26.),
                    (6., 2., 2., 6., 30.),
                    (6., 2., 0., 4., 28.),
                ] {
                    let mut decks = auto_decks(from, 4, false);
                    for (d, anchor) in [(from, out_anchor), (1 - from, in_anchor)] {
                        decks.voices[d].as_mut().unwrap().apply_grid(Grid {
                            bpm: 120.,
                            downbeat_seconds: anchor,
                            reviewed: false,
                        });
                    }
                    decks.voices[1 - from].as_mut().unwrap().cue_position = (cue * 48000.) as usize;
                    decks.arm_auto(from, [1, 1], end).unwrap();
                    let auto = decks.auto.unwrap();
                    assert_eq!(auto.start_seconds, if end { end_start } else { now_start });
                    assert_eq!(auto.beats, 16.);
                    assert_eq!(auto.incoming_start, (cue * 48000.) as usize);
                    decks.global_beat = decks.voices[from]
                        .as_ref()
                        .unwrap()
                        .grid
                        .unwrap()
                        .beat(auto.start_seconds);
                    decks.voices[from]
                        .as_mut()
                        .unwrap()
                        .seek((auto.start_seconds * 48000.) as usize);
                    for _ in 0..480 {
                        let frame = decks.next().unwrap();
                        assert!(frame.playing.iter().all(|playing| *playing));
                        let outgoing = decks.voices[from].as_ref().unwrap();
                        let incoming = decks.voices[1 - from].as_ref().unwrap();
                        let phase = (outgoing.grid.unwrap().beat(outgoing.seconds())
                            - incoming.grid.unwrap().beat(incoming.seconds()))
                        .rem_euclid(16.);
                        assert!(phase.min(16. - phase) < 0.001);
                    }
                }
            }
        }
    }
    #[test]
    fn automatic_end_ignores_partial_phrases_at_eof_and_matches_the_incoming_cue_phase() {
        for from in 0..2 {
            for cue_beats in [0., 5.25] {
                let mut decks = auto_decks(from, 8, false);
                for d in 0..2 {
                    let voice = decks.voices[d].as_mut().unwrap();
                    let grid = Grid {
                        bpm: if d == from { 136. } else { 130. },
                        downbeat_seconds: if d == from { 0.23117 } else { 0.31729 },
                        reviewed: true,
                    };
                    voice.apply_grid(grid);
                    voice.set_start(grid.downbeat_seconds);
                    if d != from {
                        voice.cue_position = (grid.seconds(cue_beats) * 48000.).round() as usize;
                    }
                }
                decks.arm_auto(from, [1, 1], true).unwrap();
                let auto = decks.auto.unwrap();
                let outgoing = decks.voices[from].as_ref().unwrap();
                let incoming = decks.voices[1 - from].as_ref().unwrap();
                let ag = outgoing.grid.unwrap();
                let bg = incoming.grid.unwrap();
                let incoming_beat = bg.beat(auto.incoming_start as f64 / 48000.);
                let phase = (ag.beat(auto.start_seconds) - incoming_beat).rem_euclid(auto.beats);
                assert!(
                    phase.min(auto.beats - phase) < 0.0001,
                    "{phase} beats out of phrase"
                );
                let end = auto.start_seconds + auto.beats * 60. / ag.bpm;
                assert!(end <= 40. + 1. / 48000.);
                assert!(end + auto.beats * 60. / ag.bpm > 40.);
                assert_eq!(auto.incoming_start, incoming.cue_position);
                // Exercise the actual launch at a different master tempo, then
                // check the grids remain aligned through the tempo ramp.
                decks.master_bpm = 132.3;
                decks.auto.as_mut().unwrap().initial_bpm = 132.3;
                decks.auto.as_mut().unwrap().target_bpm = bg.bpm;
                for voice in decks.voices.iter_mut().flatten() {
                    voice.tempo(132.3).unwrap();
                }
                decks.voices[from]
                    .as_mut()
                    .unwrap()
                    .seek((auto.start_seconds * 48000.).round() as usize);
                decks.global_beat = ag.beat(decks.voices[from].as_ref().unwrap().seconds());
                for _ in 0..4800 {
                    let frame = decks.next().unwrap();
                    assert!(frame.playing.iter().all(|playing| *playing));
                    let a = decks.voices[from].as_ref().unwrap();
                    let b = decks.voices[1 - from].as_ref().unwrap();
                    let phase = (ag.beat(a.seconds()) - bg.beat(b.seconds())).rem_euclid(32.);
                    assert!(
                        phase.min(32. - phase) < 0.001,
                        "rendered phase error: {phase}"
                    );
                }
            }
        }
    }
    #[test]
    fn automatic_now_matches_a_custom_cue_instead_of_the_trimmed_file_start() {
        for from in 0..2 {
            let mut decks = auto_decks(from, 8, false);
            let outgoing = decks.voices[from].as_mut().unwrap();
            outgoing.grid.as_mut().unwrap().downbeat_seconds = 0.23;
            outgoing.set_start(0.1);
            outgoing.seek(48000 * 3);
            let incoming = decks.voices[1 - from].as_mut().unwrap();
            incoming.grid.as_mut().unwrap().downbeat_seconds = 0.31;
            incoming.cue_position = 48000 * 7 + 1234;
            decks.arm_auto(from, [1, 1], false).unwrap();
            let auto = decks.auto.unwrap();
            let ag = decks.voices[from].as_ref().unwrap().grid.unwrap();
            let bg = decks.voices[1 - from].as_ref().unwrap().grid.unwrap();
            let phase = (ag.beat(auto.start_seconds)
                - bg.beat(auto.incoming_start as f64 / 48000.))
            .rem_euclid(auto.beats);
            assert!(phase.min(auto.beats - phase) < 0.0001);
            assert!(auto.start_seconds > 3.);
            assert!(auto.start_seconds - auto.beats * 60. / ag.bpm <= 3.);
        }
    }
    #[test]
    fn automatic_now_counts_eight_bar_phrases_from_track_start_and_can_cancel() {
        let mut decks = auto_decks(0, 8, true);
        decks.command(Command::Seek(0, 1, 48000 * 3), [1, 1]);
        decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
        assert_eq!(decks.auto.unwrap().start_seconds, 16.);
        assert!(decks.voices.iter().flatten().all(|v| v.synced));
        assert_eq!(decks.next().unwrap().auto_mode, [1, 0]);
        assert!(!decks.voices[1].as_ref().unwrap().playing);
        decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
        assert!(decks.auto.is_none());
        assert!(decks.voices[0].as_ref().unwrap().playing);
        assert!(!decks.voices[1].as_ref().unwrap().playing);
    }
    #[test]
    fn seeking_during_transition_preserves_progress_and_reanchors_guides() {
        for from in 0..2 {
            for deck in 0..2 {
                for style in [0, 1, 2] {
                    let mut decks = auto_decks(from, 1, true);
                    decks.command(Command::AutoStyle(style), [1, 1]);
                    decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                    let mut auto = decks.auto.unwrap();
                    decks.voices[from]
                        .as_mut()
                        .unwrap()
                        .seek((auto.start_seconds * 48000.) as usize);
                    decks.global_beat = decks.voices[from]
                        .as_ref()
                        .unwrap()
                        .grid
                        .unwrap()
                        .beat(auto.start_seconds);
                    decks.next().unwrap();
                    auto = decks.auto.unwrap();
                    auto.mixed_beats = 1.;
                    decks.auto = Some(auto);
                    for seconds in [12, 2, 39] {
                        let before = decks.auto.unwrap();
                        let gains = decks.voices.each_ref().map(|v| v.as_ref().unwrap().gain);
                        let bpm = decks.master_bpm;
                        decks.command(Command::Seek(deck, 1, seconds * 48000), [1, 1]);
                        let after = decks.auto.expect("seek preserves handoff");
                        assert!(after.started);
                        assert_eq!(after.bass_swapped, before.bass_swapped);
                        assert!(
                            (after.mixed_beats / after.beats - before.mixed_beats / before.beats)
                                .abs()
                                < 1e-9
                        );
                        assert_eq!(decks.master_bpm, bpm);
                        assert_eq!(
                            decks.voices.each_ref().map(|v| v.as_ref().unwrap().gain),
                            gains
                        );
                        assert!(decks
                            .voices
                            .iter()
                            .flatten()
                            .all(|v| v.playing && v.generation == 1));
                        for d in 0..2 {
                            let v = decks.voices[d].as_ref().unwrap();
                            assert!(
                                (after.guide_start[d]
                                    + after.mixed_beats * 60. / v.grid.unwrap().bpm
                                    - v.seconds())
                                .abs()
                                    < 1e-9
                            );
                            assert!(
                                after.guide_start[d] + after.beats * 60. / v.grid.unwrap().bpm
                                    <= 40. + 1e-9
                            );
                        }
                        decks.next().unwrap();
                        assert!(decks.auto.is_some());
                    }
                    let before = decks.auto.unwrap();
                    decks.command(Command::Seek(deck, 0, 0), [1, 1]);
                    assert_eq!(decks.auto.unwrap().guide_start, before.guide_start);
                    while decks.auto.is_some() {
                        decks.next().unwrap();
                    }
                    assert!(!decks.voices[from].as_ref().unwrap().playing);
                    // A compressed handoff must complete, rather than cancel and
                    // restore the incoming deck's original silent fader.
                    assert_eq!(decks.voices[from].as_ref().unwrap().gain, 0.);
                    assert!(decks.voices[1 - from].as_ref().unwrap().gain > 0.);
                }
            }
        }
    }
    #[test]
    fn outgoing_seeks_before_armed_transition_preserve_all_planned_points() {
        for from in 0..2 {
            for end in [false, true] {
                for edited in [false, true] {
                    let mut decks = auto_decks(from, 8, true);
                    decks.command(Command::AutoStyle(1), [1, 1]);
                    decks.command(Command::AutoTransition(from, [1, 1], end), [1, 1]);
                    if edited {
                        let start = decks.auto.unwrap().start_seconds;
                        let target = if end { start - 8. } else { start + 8. };
                        decks.command(Command::EditAuto(from, [1, 1], 0, target), [1, 1]);
                        assert!((decks.auto.unwrap().start_seconds - target).abs() < 1e-6);
                    }
                    let before = decks.auto.unwrap();
                    let mut original = Frame::default();
                    decks.transition_guides(&mut original);
                    // Forward and backward seeks remain clear of the planned overlap.
                    for seconds in [4, 2, 6, 0] {
                        decks.command(Command::Seek(from, 1, seconds * 48000), [1, 1]);
                        let after = decks.auto.expect("AUTO stays armed");
                        let mut frame = Frame::default();
                        decks.transition_guides(&mut frame);
                        assert_eq!(after.start_seconds, before.start_seconds);
                        assert_eq!(frame.auto_points, original.auto_points);
                        assert_eq!(after.incoming_start, before.incoming_start);
                        assert_eq!(after.beats, before.beats);
                        assert_eq!(after.swap_beat, before.swap_beat);
                        assert_eq!(after.target_bpm, before.target_bpm);
                        assert!(!after.started);
                        let voice = decks.voices[from].as_ref().unwrap();
                        assert_eq!(decks.global_beat, voice.grid.unwrap().beat(voice.seconds()));
                    }
                }
            }
        }
    }
    #[test]
    fn seeking_outgoing_deck_replans_armed_auto_transition() {
        for end in [false, true] {
            let mut decks = auto_decks(0, 1, false);
            decks.command(Command::AutoTransition(0, [1, 1], end), [1, 1]);
            let previous = decks.auto.unwrap().start_seconds;
            decks.command(Command::Seek(0, 1, 48000 * 20), [1, 1]);
            let auto = decks.auto.expect("AUTO remains armed after seek");
            assert_eq!(auto.end, end);
            assert!(auto.start_seconds >= decks.voices[0].as_ref().unwrap().seconds());
            if !end {
                assert!(auto.start_seconds > previous);
            }
            assert_eq!(
                decks.next().unwrap().auto_mode,
                [if end { 2 } else { 1 }, 0]
            );
        }
    }
    #[test]
    fn outgoing_seek_preserves_edited_incoming_points_and_armed_settings() {
        for from in 0..2 {
            for end in [false, true] {
                for style in [0, 1, 2] {
                    let mut decks = auto_decks(from, 8, false);
                    let source = Arc::new(Source {
                        progressive: None,
                        bass_profile: Default::default(),
                        left: vec![0.; 48000 * 130],
                        right: vec![0.; 48000 * 130],
                    });
                    for voice in decks.voices.iter_mut().flatten() {
                        voice.source = source.clone();
                    }
                    let incoming = 1 - from;
                    decks.voices[incoming].as_mut().unwrap().cue_position = 24 * 48000;
                    decks.command(Command::AutoStyle(style), [1, 1]);
                    decks.command(Command::AutoTransition(from, [1, 1], end), [1, 1]);
                    let step =
                        16. * 60. / decks.voices[incoming].as_ref().unwrap().grid.unwrap().bpm;
                    let start = decks.auto.unwrap().guide_start[incoming];
                    decks.command(Command::EditAuto(incoming, [1, 1], 1, start - step), [1, 1]);
                    let start = decks.auto.unwrap().guide_start[incoming];
                    decks.command(
                        Command::EditAuto(incoming, [1, 1], 0, start + 2. * step),
                        [1, 1],
                    );
                    if style != 0 {
                        let swap = decks.auto.unwrap().guide_start[incoming]
                            + decks.auto.unwrap().swap_beat * step / 16.;
                        decks.command(Command::EditAuto(incoming, [1, 1], 2, swap - step), [1, 1]);
                    }
                    let before = decks.auto.unwrap();
                    assert_eq!(before.beats, 48.);
                    assert!(before.guide_start[incoming] > 24.);
                    let mut original = Frame::default();
                    decks.transition_guides(&mut original);
                    // Next-transition settings must not replace the armed plan either.
                    decks.command(Command::AutoBars(1), [1, 1]);
                    decks.command(Command::AutoStyle((style + 1) % 3), [1, 1]);
                    for seek in [40, 16, 64] {
                        decks.command(Command::Seek(from, 1, 48000 * seek), [1, 1]);
                        let after = decks.auto.expect("AUTO stays armed");
                        let mut frame = Frame::default();
                        decks.transition_guides(&mut frame);
                        assert_eq!(frame.auto_points[incoming], original.auto_points[incoming]);
                        assert_eq!(after.incoming_start, before.incoming_start);
                        assert_eq!(after.beats, before.beats);
                        assert_eq!(after.swap_beat, before.swap_beat);
                        assert_eq!(after.style, before.style);
                        assert_eq!(after.starting_gains, before.starting_gains);
                        assert_eq!(after.end, end);
                        assert!(
                            after.start_seconds >= decks.voices[from].as_ref().unwrap().seconds()
                        );
                        let phase = ((after.start_seconds - before.start_seconds) * 120. / 60.)
                            .rem_euclid(16.);
                        assert!(phase.min(16. - phase) < 1e-6);
                    }
                    // Near EOF, keep the edited incoming start and shorten only as needed.
                    decks.command(Command::Seek(from, 1, 48000 * 126), [1, 1]);
                    let shortened = decks.auto.expect("Shorter AUTO remains armed");
                    assert_eq!(shortened.incoming_start, before.incoming_start);
                    assert_eq!(
                        shortened.guide_start[incoming],
                        before.guide_start[incoming]
                    );
                    assert!(shortened.beats < before.beats);
                    assert!(shortened.start_seconds + shortened.beats * 0.5 <= 130. + 1e-6);
                    assert_eq!(shortened.swap_beat, before.swap_beat.min(shortened.beats));
                }
            }
        }
    }
    #[test]
    fn automatic_transition_renders_handoff_in_both_directions_and_tempo_modes() {
        for from in 0..2 {
            for change in [false, true] {
                let mut decks = auto_decks(from, 1, change);
                decks.crossfader_enabled = false;
                decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                let mut midpoint = false;
                for _ in 0..48000 * 5 {
                    let frame = decks.next().unwrap();
                    assert!(frame.samples.iter().all(|s| s.is_finite()));
                    if let Some(auto) = decks.auto {
                        if auto.started && auto.mixed_beats > 1. && auto.mixed_beats < 3. {
                            midpoint = true;
                            assert!(frame.playing.iter().all(|p| *p));
                            assert!(frame.routing_cross.iter().all(|gain| *gain > 0.));
                            if change {
                                assert!(frame.master_bpm > 120. && frame.master_bpm < 140.);
                            } else {
                                assert_eq!(frame.master_bpm, 120.);
                            }
                            let a = decks.voices[from].as_ref().unwrap();
                            let b = decks.voices[1 - from].as_ref().unwrap();
                            let phase = (a.grid.unwrap().beat(a.seconds())
                                - b.grid.unwrap().beat(b.seconds()))
                            .rem_euclid(4.);
                            assert!(phase.min(4. - phase) < 0.001);
                        }
                    } else {
                        assert!(midpoint);
                        assert!(!frame.playing[from]);
                        assert!(frame.playing[1 - from]);
                        assert_eq!(frame.master_bpm, if change { 140. } else { 120. });
                        break;
                    }
                }
                assert!(decks.auto.is_none());
            }
        }
    }
    #[test]
    fn crossfade_ramps_incoming_over_zero_to_eighty_percent_and_outgoing_over_twenty_to_one_hundred(
    ) {
        for (progress, expected) in [
            (0., [1., 0.]),
            (0.1, [1., 0.125]),
            (0.2, [1., 0.25]),
            (0.5, [0.625, 0.625]),
            (0.8, [0.25, 1.]),
            (0.9, [0.125, 1.]),
            (1., [0., 1.]),
        ] {
            let actual = transition_fades(progress, false);
            for deck in 0..2 {
                assert!((actual[deck] - expected[deck]).abs() < 1e-6);
            }
        }
        assert_eq!(transition_fades(0.5, true), [1., 1.]);
        assert_eq!(transition_fades(-1., false), [1., 0.]);
        assert_eq!(transition_fades(2., false), [0., 1.]);
    }
    #[test]
    fn automatic_faders_start_incoming_silent_and_center_the_crossfader_in_the_first_bar() {
        for from in 0..2 {
            for enabled in [false, true] {
                let mut decks = auto_decks(from, 2, false);
                let initial_cross = if from == 0 { -0.6 } else { 0.6 };
                decks.command(Command::Crossfader(initial_cross), [1, 1]);
                decks.command(Command::CrossfaderEnabled(enabled), [1, 1]);
                decks.command(Command::Gain(from, 1, 0.7), [1, 1]);
                decks.command(Command::Gain(1 - from, 1, 0.2), [1, 1]);
                decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                for _ in 0..1000 {
                    let frame = decks.next().unwrap();
                    assert_eq!(frame.gains[from], 0.7);
                    assert_eq!(frame.gains[1 - from], 0.);
                    assert_eq!(frame.crossfader, initial_cross);
                }
                // Outgoing adjustments while armed still set the final incoming level.
                decks.command(Command::Gain(from, 1, 0.6), [1, 1]);
                let boundary = decks.auto.unwrap().start_seconds;
                decks.voices[from]
                    .as_mut()
                    .unwrap()
                    .seek((boundary * 48000.) as usize);
                decks.global_beat = decks.voices[from]
                    .as_ref()
                    .unwrap()
                    .grid
                    .unwrap()
                    .beat(boundary);
                let first = decks.next().unwrap();
                assert_eq!(first.gains[from], 0.6);
                assert_eq!(first.gains[1 - from], 0.);
                assert_eq!(first.deck_samples[1 - from], [0., 0.]);
                assert_eq!(first.crossfader, initial_cross);
                let mut previous = first;
                let mut middle = false;
                for _ in 0..48000 * 5 {
                    let auto = decks.auto.unwrap();
                    let p = auto.mixed_beats / auto.beats;
                    let frame = decks.next().unwrap();
                    if p < 0.2 {
                        assert_eq!(frame.gains[from], 0.6);
                    }
                    if p >= 0.8 {
                        assert_eq!(frame.gains[1 - from], 0.6);
                    }
                    if (0.49..0.51).contains(&p) {
                        assert!(frame.gains[from] > 0.36 && frame.gains[1 - from] > 0.36);
                    }
                    assert!(frame.gains[from] <= previous.gains[from]);
                    assert!(frame.gains[1 - from] >= previous.gains[1 - from]);
                    let sum = frame.gains[from] + frame.gains[1 - from];
                    assert!((0.6 - 1e-6..=0.75 + 1e-6).contains(&sum));
                    assert!((frame.crossfader - previous.crossfader).abs() < 0.001);
                    assert_eq!(frame.crossfader_enabled, enabled);
                    if !enabled {
                        assert_eq!(frame.routing_cross, [1., 1.]);
                    }
                    if frame.gains[from] < 0.29 && !middle {
                        middle = true;
                        assert!(frame.gains[1 - from] > 0.3);
                        assert_eq!(frame.crossfader, 0.);
                    }
                    previous = frame;
                    if decks.auto.is_none() {
                        assert!(middle);
                        assert_eq!(frame.gains[from], 0.);
                        assert_eq!(frame.gains[1 - from], 0.6);
                        assert_eq!(frame.crossfader, 0.);
                        break;
                    }
                }
                assert!(decks.auto.is_none());
            }
        }
    }
    #[test]
    fn outgoing_high_follows_incoming_fade_and_restores_after_handoff() {
        for from in 0..2 {
            for style in 0..=2 {
                let mut decks = auto_decks(from, 2, false);
                decks.command(Command::AutoStyle(style), [1, 1]);
                decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                // Capture edits made while waiting, rather than the armed value.
                decks.command(Command::Mixer(from, 1, 3, 0.8), [1, 1]);
                decks.command(Command::Mixer(1 - from, 1, 3, 0.6), [1, 1]);
                decks.advance_auto();
                assert_eq!(
                    decks.voices[from].as_ref().unwrap().mixer.settings.eq[2],
                    0.8
                );
                let start = decks.auto.unwrap().start_seconds;
                decks.global_beat = decks.voices[from]
                    .as_ref()
                    .unwrap()
                    .grid
                    .unwrap()
                    .beat(start);
                decks.advance_auto();
                assert!(decks.auto.unwrap().started);
                // Exercise an off-midpoint Smart pivot as well as Bass swap.
                let pivot = if style == 2 { 3. } else { 4. };
                decks.auto.as_mut().unwrap().swap_beat = pivot;
                for (beat, fraction) in [(0., 1.), (pivot / 2., 0.5), (pivot, 0.), (7., 0.)] {
                    decks.auto.as_mut().unwrap().mixed_beats = beat;
                    decks.advance_auto();
                    let expected = if style == 0 { 0.8 } else { 0.8 * fraction };
                    assert_eq!(
                        decks.voices[from].as_ref().unwrap().mixer.settings.eq[2],
                        expected
                    );
                    assert_eq!(
                        decks.voices[1 - from].as_ref().unwrap().mixer.settings.eq[2],
                        0.6
                    );
                }
                decks.auto.as_mut().unwrap().mixed_beats = 8.;
                decks.advance_auto();
                assert!(decks.auto.is_none());
                assert_eq!(
                    decks.voices[from].as_ref().unwrap().mixer.settings.eq[2],
                    0.8
                );
            }
        }
    }
    #[test]
    fn outgoing_high_preserves_cancelled_level_and_respects_manual_takeover() {
        for style in [1, 2] {
            for manual in [false, true] {
                let mut decks = auto_decks(0, 2, false);
                decks.command(Command::AutoStyle(style), [1, 1]);
                decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
                let start = decks.auto.unwrap().start_seconds;
                decks.global_beat = decks.voices[0].as_ref().unwrap().grid.unwrap().beat(start);
                decks.advance_auto();
                decks.auto.as_mut().unwrap().mixed_beats = 2.;
                decks.advance_auto();
                assert_eq!(decks.voices[0].as_ref().unwrap().mixer.settings.eq[2], 0.25);
                if manual {
                    decks.command(Command::Mixer(0, 1, 3, 0.7), [1, 1]);
                    decks.auto.as_mut().unwrap().mixed_beats = 3.;
                    decks.advance_auto();
                    assert_eq!(decks.voices[0].as_ref().unwrap().mixer.settings.eq[2], 0.7);
                    decks.auto.as_mut().unwrap().mixed_beats = 8.;
                    decks.advance_auto();
                    assert!(decks.auto.is_none());
                    assert_eq!(decks.voices[0].as_ref().unwrap().mixer.settings.eq[2], 0.7);
                } else {
                    decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
                    assert!(decks.auto.is_none());
                    decks.advance_auto();
                    assert_eq!(decks.voices[0].as_ref().unwrap().mixer.settings.eq[2], 0.25);
                }
            }
        }
    }
    #[test]
    fn bass_swap_holds_outgoing_volume_then_exchanges_bass_before_the_midpoint() {
        for from in 0..2 {
            for ramp in [false, true] {
                let mut decks = auto_decks(from, 2, ramp);
                decks.command(Command::Gain(from, 1, 0.6), [1, 1]);
                decks.command(Command::Gain(1 - from, 1, 0.1), [1, 1]);
                decks.command(Command::Mixer(from, 1, 1, 0.7), [1, 1]);
                decks.command(Command::Mixer(1 - from, 1, 1, 0.8), [1, 1]);
                decks.command(Command::Mixer(from, 1, 2, 0.3), [1, 1]);
                decks.command(Command::AutoStyle(1), [1, 1]);
                decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                // Mode changes affect the next transition, never one already engaged.
                decks.command(Command::AutoStyle(0), [1, 1]);
                assert!(decks.auto.unwrap().bass_swap);
                let first = decks.next().unwrap();
                assert_eq!(first.mixer[1 - from].eq[0], 0.8); // No change while waiting.
                let start = decks.auto.unwrap().start_seconds;
                decks.voices[from]
                    .as_mut()
                    .unwrap()
                    .seek((start * 48000.) as usize);
                decks.global_beat = decks.voices[from]
                    .as_ref()
                    .unwrap()
                    .grid
                    .unwrap()
                    .beat(start);
                let first = decks.next().unwrap();
                assert_eq!(first.gains[from], 0.6);
                assert_eq!(first.gains[1 - from], 0.);
                assert_eq!(first.deck_samples[1 - from], [0., 0.]);
                assert_eq!(first.mixer[1 - from].eq[0], 0.);
                let mut swapped = false;
                let mut saw_second_half = false;
                for _ in 0..48000 * 5 {
                    let before = decks.auto.unwrap();
                    let frame = decks.next().unwrap();
                    assert!(frame.samples.iter().all(|v| v.is_finite()));
                    assert_eq!(frame.mixer[from].eq[1], 0.3);
                    if before.mixed_beats < before.beats / 2. {
                        assert_eq!(frame.gains[from], 0.6);
                    }
                    if !swapped && frame.mixer[from].eq[0] == 0. {
                        swapped = true;
                        let lead =
                            (before.beats / 2. - before.mixed_beats) * 60. / frame.master_bpm;
                        assert!((0.0099..=0.0101).contains(&lead), "Bass swap lead: {lead}");
                        assert_eq!(frame.mixer[1 - from].eq[0], 0.5);
                    }
                    if before.mixed_beats > before.beats / 2. + 0.001 && decks.auto.is_some() {
                        saw_second_half = true;
                        assert!(frame.gains[from] < 0.6);
                        assert_eq!(frame.gains[1 - from], 0.6);
                        assert_eq!(frame.mixer[from].eq[0], 0.);
                        assert_eq!(frame.mixer[1 - from].eq[0], 0.5);
                    }
                    if decks.auto.is_none() {
                        assert!(swapped && saw_second_half);
                        assert_eq!(frame.gains[from], 0.);
                        assert_eq!(frame.gains[1 - from], 0.6);
                        assert_eq!(frame.mixer[from].eq[0], 0.7); // Restore stopped deck.
                        assert_eq!(frame.mixer[1 - from].eq[0], 0.5);
                        break;
                    }
                }
                assert!(decks.auto.is_none());
            }
        }
    }
    #[test]
    fn manual_eq_keeps_bass_swap_running() {
        for from in 0..2 {
            for style in [1, 2] {
                let mut decks = auto_decks(from, 1, false);
                decks.command(Command::AutoStyle(style), [1, 1]);
                decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                decks.command(Command::Mixer(from, 1, 1, 0.7), [1, 1]);
                while !decks.auto.unwrap().started {
                    decks.next().unwrap();
                }
                for deck in 0..2 {
                    for band in 1..=3 {
                        decks.command(Command::Mixer(deck, 1, band, 0.4), [1, 1]);
                    }
                }
                decks.next().unwrap();
                assert!(decks.auto.is_some());
                assert!(decks
                    .voices
                    .iter()
                    .flatten()
                    .all(|v| v.playing && v.mixer.settings.eq[0] == 0.4));
                while !decks.auto.unwrap().bass_swapped {
                    decks.next().unwrap();
                }
                assert_eq!(
                    decks.voices[from].as_ref().unwrap().mixer.settings.eq[0],
                    0.
                );
                assert_eq!(
                    decks.voices[1 - from].as_ref().unwrap().mixer.settings.eq[0],
                    0.5
                );
                for deck in 0..2 {
                    decks.command(Command::Mixer(deck, 1, 1, 0.3), [1, 1]);
                }
                for _ in 0..1000 {
                    decks.next().unwrap();
                }
                assert!(decks.auto.is_some());
                assert!(decks
                    .voices
                    .iter()
                    .flatten()
                    .all(|v| v.playing && v.generation == 1 && v.mixer.settings.eq[0] == 0.3));
                while decks.auto.is_some() {
                    decks.next().unwrap();
                }
                assert!(!decks.voices[from].as_ref().unwrap().playing);
                assert!(decks.voices[1 - from].as_ref().unwrap().playing);
                assert_eq!(
                    decks.voices[from].as_ref().unwrap().mixer.settings.eq[0],
                    0.7
                );
                assert_eq!(
                    decks.voices[1 - from].as_ref().unwrap().mixer.settings.eq[0],
                    0.3
                );
            }
        }
    }
    #[test]
    fn cancelling_bass_swap_preserves_bass_and_playback() {
        let mut decks = auto_decks(0, 1, false);
        decks.command(Command::Mixer(0, 1, 1, 0.7), [1, 1]);
        decks.command(Command::Mixer(1, 1, 1, 0.8), [1, 1]);
        decks.command(Command::AutoStyle(1), [1, 1]);
        decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
        for _ in 0..48000 * 3 + 1000 {
            decks.next().unwrap();
        }
        assert_eq!(decks.voices[0].as_ref().unwrap().mixer.settings.eq[0], 0.);
        decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
        assert!(decks.auto.is_none());
        assert_eq!(decks.voices[0].as_ref().unwrap().mixer.settings.eq[0], 0.);
        assert_eq!(decks.voices[1].as_ref().unwrap().mixer.settings.eq[0], 0.5);
        assert!(decks.voices.iter().flatten().all(|v| v.playing));
    }
    #[test]
    fn bass_swap_handles_sub_bar_midpoints_and_zero_overlap_without_leaving_eq_cut() {
        assert_eq!(transition_fades(0.25, true), [1., 0.5]);
        assert_eq!(transition_fades(0.5, true), [1., 1.]);
        assert_eq!(transition_fades(0.75, true), [0.5, 1.]);
        assert!(!bass_swap_due(0.97, 2., 120.));
        assert!(bass_swap_due(0.98, 2., 120.));
        let mut decks = auto_decks(0, 0, false);
        decks.command(Command::AutoStyle(1), [1, 1]);
        decks.command(Command::AutoTransition(0, [1, 1], true), [1, 1]);
        decks.voices[0].as_mut().unwrap().seek(48000 * 40 - 1);
        decks.global_beat = decks.voices[0]
            .as_ref()
            .unwrap()
            .grid
            .unwrap()
            .beat(decks.voices[0].as_ref().unwrap().seconds());
        for _ in 0..10 {
            decks.next().unwrap();
        }
        assert!(decks.auto.is_none());
        assert!(decks
            .voices
            .iter()
            .flatten()
            .all(|v| v.mixer.settings.eq[0] == 0.5));
    }
    #[test]
    fn arming_either_mode_lowers_incoming_fader_and_cancelling_preserves_it() {
        for from in 0..2 {
            for bass_swap in [false, true] {
                let mut decks = auto_decks(from, 1, false);
                decks.command(Command::Gain(1 - from, 1, 1.), [1, 1]);
                decks.command(Command::AutoStyle(u8::from(bass_swap)), [1, 1]);
                decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                let armed = decks.next().unwrap();
                assert_eq!(armed.gains[1 - from], 0.);
                assert!(!armed.playing[1 - from]);
                decks.command(Command::Gain(from, 1, 0.55), [1, 1]);
                assert!(decks.auto.is_some());
                decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                assert!(decks.auto.is_none());
                assert_eq!(decks.voices[1 - from].as_ref().unwrap().gain, 0.);
                assert_eq!(decks.voices[from].as_ref().unwrap().gain, 0.55);
                assert!(!decks.voices[1 - from].as_ref().unwrap().playing);
                // Adjusting the muted incoming fader manually takes over immediately.
                decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                decks.command(Command::Gain(1 - from, 1, 0.4), [1, 1]);
                assert!(decks.auto.is_none());
                assert_eq!(decks.voices[1 - from].as_ref().unwrap().gain, 0.4);
            }
        }
    }
    #[test]
    fn adding_changing_and_releasing_loops_keeps_the_active_transition_on_schedule() {
        for from in 0..2 {
            for bass_swap in [false, true] {
                for loop_incoming in [false, true] {
                    let mut decks = auto_decks(from, 2, true);
                    let mut reference = auto_decks(from, 2, true);
                    for d in [&mut decks, &mut reference] {
                        d.command(Command::AutoStyle(u8::from(bass_swap)), [1, 1]);
                        d.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                        let boundary = d.auto.unwrap().start_seconds;
                        d.voices[from]
                            .as_mut()
                            .unwrap()
                            .seek((boundary * 48000.) as usize);
                        d.global_beat = d.voices[from]
                            .as_ref()
                            .unwrap()
                            .grid
                            .unwrap()
                            .beat(boundary);
                    }
                    let loop_deck = if loop_incoming { 1 - from } else { from };
                    let mut wrapped = false;
                    let mut previous = 0;
                    for frame_index in 0..48000 * 5 {
                        match frame_index {
                            2400 => {
                                decks.command(Command::LoopIn(loop_deck, 1, false), [1, 1]);
                            }
                            14400 => {
                                decks.command(Command::LoopOut(loop_deck, 1, false), [1, 1]);
                            }
                            24000 => {
                                decks.command(Command::LoopLength(loop_deck, 1, 0.5, true), [1, 1]);
                            }
                            48000 => {
                                decks.command(Command::LoopLength(loop_deck, 1, 1., false), [1, 1]);
                            }
                            72000 => {
                                decks.command(Command::LoopOut(loop_deck, 1, false), [1, 1]);
                            }
                            _ => {}
                        }
                        let a = decks.next().unwrap();
                        let b = reference.next().unwrap();
                        assert_eq!(a.auto_mode, b.auto_mode);
                        assert_eq!(a.auto_remaining, b.auto_remaining);
                        assert_eq!(a.gains, b.gains);
                        assert_eq!(a.master_bpm, b.master_bpm);
                        assert_eq!(a.crossfader, b.crossfader);
                        assert_eq!(a.playing, b.playing);
                        assert_eq!(a.mixer, b.mixer);
                        if a.positions[loop_deck] < previous {
                            wrapped = true;
                        }
                        previous = a.positions[loop_deck];
                        if decks.auto.is_none() {
                            assert!(reference.auto.is_none());
                            assert!(wrapped);
                            assert!(!a.playing[from]);
                            assert!(a.playing[1 - from]);
                            break;
                        }
                    }
                    assert!(decks.auto.is_none());
                }
            }
        }
    }
    #[test]
    fn a_loop_added_while_auto_is_waiting_does_not_delay_the_scheduled_launch() {
        for end in [false, true] {
            let mut decks = auto_decks(0, 1, false);
            // NOW's boundary is at 2 s; END's is at 38 s. Start equally close to either.
            let position = if end { 37 } else { 1 };
            decks.voices[0].as_mut().unwrap().seek(position * 48000);
            decks.command(Command::AutoTransition(0, [1, 1], end), [1, 1]);
            decks.command(Command::LoopLength(0, 1, 0.5, false), [1, 1]);
            assert!(decks.auto.is_some());
            assert!(!decks.voices[1].as_ref().unwrap().playing);
            let mut launched = false;
            for frame in 0..48000 * 4 {
                let output = decks.next().unwrap();
                if !launched && output.playing[1] {
                    launched = true;
                    assert!((frame as i64 - 48000).abs() <= 2);
                    assert!(output.position_epochs[0] > 2); // The source loop actually wrapped.
                }
                if decks.auto.is_none() {
                    assert!(launched);
                    assert_eq!(output.playing, [false, true]);
                    break;
                }
            }
            assert!(decks.auto.is_none());
        }
    }
    fn smart_track(drop: Option<f64>) -> Arc<Source> {
        let samples: Vec<f32> = (0..48000 * 20)
            .map(|i| {
                let t = i as f64 / 48000.;
                let level = if drop.is_some_and(|at| t < at) {
                    0.002
                } else {
                    0.25
                };
                (level * (std::f64::consts::TAU * 80. * t).sin()
                    + 0.04 * (std::f64::consts::TAU * 8000. * t).sin()) as f32
            })
            .collect();
        let bass_profile = crate::smart::BassProfile::analyze(&samples, &samples, || true).unwrap();
        Arc::new(Source {
            left: samples.clone(),
            right: samples,
            progressive: None,
            bass_profile,
        })
    }
    #[test]
    fn smart_uses_early_and_late_drops_for_faders_and_bass_with_tempo_ramps_and_loops() {
        for from in 0..2 {
            for (drop, ramp) in [(6., false), (10., true)] {
                let mut decks = auto_decks(from, 8, ramp);
                decks.voices[1 - from].as_mut().unwrap().source = smart_track(Some(drop));
                decks.command(
                    Command::Grid(
                        1 - from,
                        1,
                        Grid {
                            bpm: 120.,
                            downbeat_seconds: 0.,
                            reviewed: true,
                        },
                    ),
                    [1, 1],
                );
                if ramp {
                    decks.master_bpm = 100.;
                }
                decks.command(Command::AutoStyle(2), [1, 1]);
                decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                let plan = decks.auto.unwrap();
                assert_eq!(plan.swap_beat, drop * 2.);
                assert_ne!(plan.swap_beat, plan.beats / 2.);
                decks.voices[from]
                    .as_mut()
                    .unwrap()
                    .seek((plan.start_seconds * 48000.) as usize);
                decks.global_beat = decks.voices[from]
                    .as_ref()
                    .unwrap()
                    .grid
                    .unwrap()
                    .beat(plan.start_seconds);
                let mut saw_swap = false;
                let mut second_phase = false;
                for frame_index in 0..48000 * 22 {
                    if frame_index == 24000 {
                        decks.command(Command::LoopLength(from, 1, 1., false), [1, 1]);
                    }
                    let before = decks.auto.unwrap();
                    let frame = decks.next().unwrap();
                    assert!(frame.samples.iter().all(|x| x.is_finite()));
                    if frame_index == 0 {
                        assert_eq!(frame.auto_style, 2);
                        assert!((frame.auto_points[1 - from][3] - drop).abs() < 1e-6);
                    }
                    if before.mixed_beats < plan.swap_beat - 0.01 {
                        assert_eq!(frame.gains[from], 0.8);
                    }
                    if !saw_swap && frame.mixer[from].eq[0] == 0. {
                        saw_swap = true;
                        let lead = (plan.swap_beat - before.mixed_beats) * 60. / frame.master_bpm;
                        assert!((0.0098..=0.0102).contains(&lead));
                        assert!((frame.positions[1 - from] as f64 / 48000. - drop).abs() < 0.03);
                        assert_eq!(frame.mixer[1 - from].eq[0], 0.5);
                    }
                    if before.mixed_beats > plan.swap_beat + 0.01 && decks.auto.is_some() {
                        second_phase = true;
                        assert_eq!(frame.gains[1 - from], 0.8);
                        assert!(frame.gains[from] < 0.8);
                    }
                    if decks.auto.is_none() {
                        assert!(saw_swap && second_phase);
                        assert_eq!(frame.playing[from], false);
                        assert_eq!(frame.playing[1 - from], true);
                        assert_eq!(frame.gains[1 - from], 0.8);
                        break;
                    }
                }
                assert!(decks.auto.is_none());
            }
        }
    }
    #[test]
    fn smart_without_clear_drop_matches_bass_swap_sample_for_sample() {
        let source = smart_track(None);
        let mut smart = auto_decks(0, 4, true);
        let mut bass = auto_decks(0, 4, true);
        for (decks, style) in [(&mut smart, 2), (&mut bass, 1)] {
            decks.voices[1].as_mut().unwrap().source = source.clone();
            decks.command(Command::AutoStyle(style), [1, 1]);
            decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
            let plan = decks.auto.unwrap();
            assert_eq!(plan.swap_beat, plan.beats / 2.);
            decks.voices[0]
                .as_mut()
                .unwrap()
                .seek((plan.start_seconds * 48000.) as usize);
            decks.global_beat = decks.voices[0]
                .as_ref()
                .unwrap()
                .grid
                .unwrap()
                .beat(plan.start_seconds);
        }
        for _ in 0..48000 * 10 {
            let a = smart.next().unwrap();
            let b = bass.next().unwrap();
            assert_eq!(a.samples, b.samples);
            assert_eq!(a.gains, b.gains);
            assert_eq!(a.mixer, b.mixer);
            assert_eq!(a.master_bpm, b.master_bpm);
            assert_eq!(a.playing, b.playing);
            if smart.auto.is_none() {
                assert!(bass.auto.is_none());
                return;
            }
        }
        panic!("Fallback did not finish");
    }
    #[test]
    fn smart_respects_incoming_cue_and_current_grid_and_ignores_drops_outside_overlap() {
        let source = smart_track(Some(10.));
        for (cue, expected) in [(2., 16.), (8., 16.)] {
            let mut decks = auto_decks(0, 8, false);
            decks.voices[1].as_mut().unwrap().source = source.clone();
            decks.command(
                Command::Grid(
                    1,
                    1,
                    Grid {
                        bpm: 120.,
                        downbeat_seconds: 0.,
                        reviewed: true,
                    },
                ),
                [1, 1],
            );
            decks.voices[1].as_mut().unwrap().cue_position = (cue * 48000.) as usize;
            // Use a shorter overlap if there is insufficient material after the cue.
            decks.command(Command::AutoBars(4), [1, 1]);
            decks.command(Command::AutoStyle(2), [1, 1]);
            decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
            let plan = decks.auto.unwrap();
            // Cue 2 puts the drop exactly at the end, cue 8 leaves only one bass-light bar:
            // neither qualifies, so both use the exact midpoint of a four-bar overlap.
            assert_eq!(plan.swap_beat, expected / 2.);
        }
    }
    #[test]
    fn planned_transition_edits_snap_link_points_and_move_only_the_selected_area() {
        for from in 0..2 {
            for deck in 0..2 {
                for kind in 0..4 {
                    let mut decks = auto_decks(from, 8, false);
                    let source = Arc::new(Source {
                        progressive: None,
                        bass_profile: Default::default(),
                        left: vec![0.; 48000 * 130],
                        right: vec![0.; 48000 * 130],
                    });
                    for voice in decks.voices.iter_mut().flatten() {
                        voice.source = source.clone();
                    }
                    decks.command(Command::AutoBars(16), [1, 1]);
                    decks.command(Command::AutoStyle(1), [1, 1]);
                    // Leave enough material before the incoming start for linked resizing.
                    decks.voices[1 - from].as_mut().unwrap().cue_position = 12 * 48000;
                    decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                    let before = decks.auto.unwrap();
                    let mut original = Frame::default();
                    decks.transition_guides(&mut original);
                    let index = match kind {
                        2 => 3,
                        3 => 4,
                        _ => 0,
                    };
                    let seconds_per_beat =
                        60. / decks.voices[deck].as_ref().unwrap().grid.unwrap().bpm;
                    let target = original.auto_points[deck][index] + seconds_per_beat + 0.1;
                    decks.command(Command::EditAuto(deck, [1, 1], kind, target), [1, 1]);
                    let mut edited = Frame::default();
                    decks.transition_guides(&mut edited);
                    for d in 0..2 {
                        let step = 60. / decks.voices[d].as_ref().unwrap().grid.unwrap().bpm;
                        for i in [0, 3, 4] {
                            let moves = if kind == 0 { d == deck } else { i == index };
                            let expected =
                                original.auto_points[d][i] + if moves { step } else { 0. };
                            assert!(
                                (edited.auto_points[d][i] - expected).abs() < 1e-6,
                                "from {from} deck {deck} kind {kind} point {i}"
                            );
                        }
                    }
                    // Repeating an absolute target must not add another step.
                    decks.command(Command::EditAuto(deck, [1, 1], kind, target), [1, 1]);
                    assert_eq!(
                        decks.auto.unwrap().guide_start,
                        edited.auto_points.map(|p| p[0])
                    );
                    assert_eq!(
                        decks.auto.unwrap().incoming_start,
                        (edited.auto_points[1 - from][0] * 48000.).round() as usize
                    );
                    assert_eq!(
                        decks.auto.unwrap().start_seconds,
                        edited.auto_points[from][0]
                    );
                    assert_eq!(decks.auto.unwrap().starting_gains, before.starting_gains);
                }
            }
        }
    }
    #[test]
    fn moved_transition_launches_at_edited_boundary_and_incoming_position() {
        for from in 0..2 {
            for deck in 0..2 {
                let mut decks = auto_decks(from, 8, false);
                decks.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                let before = decks.auto.unwrap();
                let step = 16. * 60. / decks.voices[deck].as_ref().unwrap().grid.unwrap().bpm;
                decks.command(
                    Command::EditAuto(deck, [1, 1], 0, before.guide_start[deck] + step),
                    [1, 1],
                );
                let edited = decks.auto.unwrap();
                let launch = decks.voices[from]
                    .as_ref()
                    .unwrap()
                    .grid
                    .unwrap()
                    .beat(edited.start_seconds);
                decks.global_beat = launch - 1.;
                decks.advance_auto();
                assert!(!decks.auto.unwrap().started);
                decks.global_beat = launch;
                decks.advance_auto();
                assert!(decks.auto.unwrap().started);
                let incoming = decks.voices[1 - from].as_ref().unwrap();
                assert!(incoming.playing);
                assert!((incoming.seconds() - edited.guide_start[1 - from]).abs() <= 1. / 48000.);
            }
        }
    }
    #[test]
    fn transition_edits_reject_crossing_bounds_stale_sources_and_active_transitions() {
        let mut decks = auto_decks(0, 8, false);
        decks.command(Command::AutoStyle(1), [1, 1]);
        decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
        let before = decks.auto.unwrap();
        for (kind, seconds, generations) in [
            (0, -8., [1, 1]),
            (0, 100., [1, 1]),
            (0, 0., [1, 1]),
            (2, 100., [1, 1]),
            (3, 0., [1, 1]),
            (0, 24., [2, 1]),
        ] {
            decks.command(Command::EditAuto(0, generations, kind, seconds), [1, 1]);
            let after = decks.auto.unwrap();
            assert_eq!(after.guide_start, before.guide_start);
            assert_eq!(after.beats, before.beats);
            assert_eq!(after.swap_beat, before.swap_beat);
        }
        decks.auto.as_mut().unwrap().started = true;
        decks.command(Command::EditAuto(0, [1, 1], 0, 24.), [1, 1]);
        assert_eq!(decks.auto.unwrap().guide_start, before.guide_start);
    }
    #[test]
    fn transition_guides_report_cues_fader_points_and_bass_swap_and_clear_on_cancel() {
        for style in [0, 1, 2] {
            let mut decks = auto_decks(0, 8, false);
            decks.voices[1].as_mut().unwrap().cue_position = 7 * 48000;
            decks.command(Command::AutoStyle(style), [1, 1]);
            decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
            let frame = decks.next().unwrap();
            assert_eq!(frame.auto_style, style);
            assert!(!frame.auto_started);
            let launch = 7. * 140. / 120.;
            assert!((frame.auto_points[0][0] - launch).abs() < 1e-9);
            assert_eq!(frame.auto_points[1][0], 7.);
            assert!((frame.auto_points[0][4] - (launch + 16.)).abs() < 1e-9);
            assert!((frame.auto_points[1][4] - (7. + 32. * 60. / 140.)).abs() < 1e-9);
            assert!((frame.auto_points[0][3] - (launch + 8.)).abs() < 1e-9);
            if style == 0 {
                assert!((frame.auto_points[0][1] - (launch + 3.2)).abs() < 1e-9);
                assert!((frame.auto_points[0][2] - (launch + 12.8)).abs() < 1e-9);
            } else {
                assert_eq!(frame.auto_points[0][1], frame.auto_points[0][3]);
            }
            assert!((frame.auto_remaining[4] - frame.auto_remaining[0] - 32.).abs() < 1e-6);
            decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
            let frame = decks.next().unwrap();
            assert_eq!(frame.auto_mode, [0, 0]);
            assert_eq!(frame.auto_points, [[0.; 5]; 2]);
        }
    }
    #[test]
    fn moving_a_fader_during_automatic_transition_cancels_without_overwriting_the_user() {
        let mut decks = auto_decks(0, 1, false);
        decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
        for _ in 0..48000 * 3 {
            decks.next().unwrap();
        }
        assert!(decks.auto.unwrap().started);
        let incoming_gain = decks.voices[1].as_ref().unwrap().gain;
        decks.command(Command::Gain(0, 0, 0.2), [1, 1]);
        assert!(decks.auto.is_some());
        decks.command(Command::Gain(0, 1, 0.35), [1, 1]);
        assert!(decks.auto.is_none());
        assert_eq!(decks.voices[0].as_ref().unwrap().gain, 0.35);
        assert_eq!(decks.voices[1].as_ref().unwrap().gain, incoming_gain);
        assert!(decks.voices.iter().flatten().all(|v| v.playing));
    }
    #[test]
    fn automatic_end_uses_the_last_complete_phrase_and_zero_overlap_uses_eof() {
        for bars in [0, 1, 8] {
            let mut decks = auto_decks(0, bars, false);
            decks.command(Command::AutoTransition(0, [1, 1], true), [1, 1]);
            assert_eq!(
                decks.auto.unwrap().start_seconds,
                if bars == 8 {
                    16.
                } else {
                    40. - f64::from(bars) * 2.
                }
            );
            if bars == 0 {
                // Approach EOF without spending this test rendering forty seconds.
                let v = decks.voices[0].as_mut().unwrap();
                v.seek(48000 * 40 - 1);
                decks.global_beat = v.grid.unwrap().beat(v.seconds());
                for _ in 0..10 {
                    decks.next().unwrap();
                }
                assert!(decks.auto.is_none());
                assert!(decks.voices[1].as_ref().unwrap().playing);
                assert!(decks.voices[1].as_ref().unwrap().seconds() < 0.001);
            } else {
                install(&mut decks, 1, 2, source());
                assert!(decks.auto.is_none());
                assert!(!decks.voices[1].as_ref().unwrap().playing);
            }
        }
    }
    #[test]
    fn pausing_outgoing_during_overlap_keeps_the_transition_on_schedule() {
        for from in 0..2 {
            for change_tempo in [false, true] {
                for bass_swap in [false, true] {
                    for resume in [false, true] {
                        let mut decks = auto_decks(from, 1, change_tempo);
                        decks.command(Command::VinylStop(false), [1, 1]);
                        let mut reference = auto_decks(from, 1, change_tempo);
                        for d in [&mut decks, &mut reference] {
                            d.command(Command::AutoStyle(u8::from(bass_swap)), [1, 1]);
                            d.command(Command::AutoTransition(from, [1, 1], false), [1, 1]);
                            let boundary = d.auto.unwrap().start_seconds;
                            d.voices[from]
                                .as_mut()
                                .unwrap()
                                .seek((boundary * 48000.) as usize);
                            d.global_beat = d.voices[from]
                                .as_ref()
                                .unwrap()
                                .grid
                                .unwrap()
                                .beat(boundary);
                            d.next().unwrap();
                        }
                        let command = if resume {
                            Command::PlayPause(from, 1)
                        } else {
                            Command::Pause(from, 1)
                        };
                        decks.command(command, [1, 1]);
                        assert!(decks.auto.unwrap().started);
                        let paused_position = decks.voices[from].as_ref().unwrap().position;
                        let mut completed = false;
                        for i in 0..48000 * 3 {
                            if resume && i == 4800 {
                                decks.command(Command::PlayPause(from, 1), [1, 1]);
                                assert!(decks.auto.unwrap().started);
                            }
                            let actual = decks.next().unwrap();
                            let expected = reference.next().unwrap();
                            assert_eq!(actual.auto_mode, expected.auto_mode);
                            assert_eq!(actual.gains, expected.gains);
                            assert_eq!(actual.master_bpm, expected.master_bpm);
                            assert_eq!(actual.crossfader, expected.crossfader);
                            assert_eq!(actual.mixer, expected.mixer);
                            assert_eq!(actual.positions[1 - from], expected.positions[1 - from]);
                            assert!(actual.playing[1 - from]);
                            if !resume || i < 4800 {
                                assert!(!actual.playing[from]);
                                assert_eq!(actual.positions[from], paused_position as u64);
                            }
                            if decks.auto.is_none() {
                                assert!(!actual.playing[from]);
                                completed = true;
                                break;
                            }
                        }
                        assert!(completed, "Paused outgoing deck prevented the handoff");
                    }
                }
            }
        }
    }
    #[test]
    fn cancelling_automatic_transition_preserves_the_current_mix_and_sound() {
        for from in 0..2 {
            for style in 0..3 {
                for end in [false, true] {
                    for progress in [0.1, 0.6, 0.9] {
                        let mut decks = auto_decks(from, 1, true);
                        decks.command(Command::Crossfader(0.65), [1, 1]);
                        decks.command(Command::AutoStyle(style), [1, 1]);
                        decks.command(Command::AutoTransition(from, [1, 1], end), [1, 1]);
                        let auto = decks.auto.unwrap();
                        decks.global_beat = decks.voices[from]
                            .as_ref()
                            .unwrap()
                            .grid
                            .unwrap()
                            .beat(auto.start_seconds);
                        decks.next().unwrap();
                        decks.auto.as_mut().unwrap().mixed_beats = auto.beats * progress;
                        let before = decks.next().unwrap();
                        decks.command(Command::AutoTransition(from, [1, 1], end), [1, 1]);
                        assert!(decks.auto.is_none());
                        for i in 0..1000 {
                            let after = decks.next().unwrap();
                            assert_eq!(after.playing, [true, true]);
                            assert_eq!(after.gains, before.gains);
                            assert_eq!(after.mixer, before.mixer);
                            assert_eq!(after.crossfader, before.crossfader);
                            assert_eq!(after.master_bpm, before.master_bpm);
                            assert_eq!(after.cue_positions, before.cue_positions);
                            assert_eq!(after.position_epochs, before.position_epochs);
                            assert_eq!(after.synced, before.synced);
                            if i > 240 {
                                assert!(after
                                    .positions
                                    .iter()
                                    .zip(before.positions)
                                    .all(|(a, b)| *a > b));
                                assert!(after.samples.iter().any(|s| s.abs() > 0.001));
                            }
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn master_tempo_controls_keep_armed_and_active_transitions_running() {
        for from in 0..2 {
            for style in 0..3 {
                for end in [false, true] {
                    for active in [false, true] {
                        for control in 0..3 {
                            let mut decks = auto_decks(from, 1, true);
                            // Render the outgoing deck past its initial playback ramp.
                            // Check continuity of established audio, not startup silence.
                            for _ in 0..4800 {
                                decks.next().unwrap();
                            }
                            decks.command(Command::AutoStyle(style), [1, 1]);
                            decks.command(Command::AutoTransition(from, [1, 1], end), [1, 1]);
                            let planned = decks.auto.unwrap();
                            if active {
                                decks.global_beat = decks.voices[from]
                                    .as_ref()
                                    .unwrap()
                                    .grid
                                    .unwrap()
                                    .beat(planned.start_seconds);
                                decks.next().unwrap();
                                decks.auto.as_mut().unwrap().mixed_beats = planned.beats * 0.4;
                                decks.next().unwrap();
                            }
                            let before = decks.auto.unwrap();
                            let bpm = decks.master_bpm;
                            // The small target also exercises reaching the target while
                            // AUTO is still running, without resuming its old tempo ramp.
                            let command = match control {
                                0 => Command::MasterTempo(132.),
                                1 => Command::MasterTarget(bpm + 0.001),
                                _ => Command::Drift(1 - from, [1, 1]),
                            };
                            decks.command(command, [1, 1]);
                            let after = decks.auto.unwrap();
                            assert!(after.manual_tempo);
                            assert_eq!(after.started, before.started);
                            assert_eq!(after.mixed_beats, before.mixed_beats);
                            assert_eq!(after.guide_start, before.guide_start);
                            assert_eq!(after.beats, before.beats);
                            assert_eq!(after.bass_swapped, before.bass_swapped);
                            if !active {
                                let waiting = decks.next().unwrap();
                                assert_eq!(waiting.playing[from], true);
                                assert_eq!(waiting.playing[1 - from], false);
                                decks.global_beat = decks.voices[from]
                                    .as_ref()
                                    .unwrap()
                                    .grid
                                    .unwrap()
                                    .beat(planned.start_seconds);
                            }
                            let progress = decks.auto.unwrap().mixed_beats;
                            for _ in 0..480 {
                                let frame = decks.next().unwrap();
                                assert_eq!(frame.playing, [true, true]);
                                assert_eq!(frame.synced, [true, true]);
                                assert!(decks.auto.unwrap().started);
                                assert!(frame.samples.iter().any(|s| s.abs() > 0.001));
                            }
                            assert!(decks.auto.unwrap().mixed_beats > progress);
                            match control {
                                0 => assert_eq!(decks.master_bpm, 132.),
                                1 => {
                                    assert_eq!(decks.master_bpm, bpm + 0.001);
                                    assert!(decks.tempo_target.is_none());
                                }
                                _ => assert!(decks.master_bpm > bpm && decks.master_bpm < 140.),
                            }
                            // Finish on the beat timeline and ensure the old automatic
                            // incoming BPM cannot overwrite the user's tempo at handoff.
                            decks.auto.as_mut().unwrap().mixed_beats = planned.beats - 0.001;
                            let mut completed = false;
                            for _ in 0..1000 {
                                let frame = decks.next().unwrap();
                                assert!(frame.playing[1 - from]);
                                if decks.auto.is_none() {
                                    assert!(!frame.playing[from]);
                                    assert_eq!(frame.gains[from], 0.);
                                    assert_ne!(frame.master_bpm, 140.);
                                    completed = true;
                                    break;
                                }
                            }
                            assert!(completed);
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn automatic_end_reaches_original_incoming_tempo_at_the_source_end() {
        let mut decks = auto_decks(0, 1, true);
        decks.voices[0].as_mut().unwrap().seek(48000 * 37);
        decks.command(Command::AutoTransition(0, [1, 1], true), [1, 1]);
        assert_eq!(decks.auto.unwrap().start_seconds, 38.);
        for _ in 0..48000 * 4 {
            let frame = decks.next().unwrap();
            if decks.auto.is_none() {
                assert_eq!(frame.master_bpm, 140.);
                assert_eq!(frame.playing, [false, true]);
                assert!((frame.positions[0] as f64 / 48000. - 40.).abs() < 0.001);
                return;
            }
        }
        panic!("Automatic end did not complete");
    }
    #[test]
    fn stale_commands_cannot_cancel_an_armed_automatic_transition() {
        let mut decks = auto_decks(0, 1, true);
        decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
        decks.command(Command::Pause(0, 0), [1, 1]);
        decks.command(Command::Sync(0, [0, 1], false), [1, 1]);
        drop(decks.command(
            Command::Install {
                deck: 1,
                generation: 0,
                voice: Box::new(Voice::new(source(), 0)),
                preserve_lock: false,
                reset_mixer: false,
            },
            [1, 1],
        ));
        assert!(decks.auto.is_some());
        assert_eq!(decks.next().unwrap().auto_mode, [1, 0]);
    }
    #[test]
    fn automatic_transitions_start_at_the_incoming_cue_in_both_modes_and_directions() {
        for from in 0..2 {
            for end in [false, true] {
                let mut decks = auto_decks(from, 1, false);
                let incoming = 1 - from;
                // Use the same controls as setting and then leaving a manual cue.
                let cue = 48000 * 7 + 1234;
                decks.command(Command::Seek(incoming, 1, cue), [1, 1]);
                decks.command(Command::CuePress(incoming, 1), [1, 1]);
                decks.command(Command::Seek(incoming, 1, 48000 * 12), [1, 1]);
                decks.command(Command::AutoTransition(from, [1, 1], end), [1, 1]);
                let auto = decks.auto.unwrap();
                assert_eq!(auto.incoming_start, cue);
                decks.voices[from]
                    .as_mut()
                    .unwrap()
                    .seek((auto.start_seconds * 48000.) as usize);
                decks.global_beat = decks.voices[from]
                    .as_ref()
                    .unwrap()
                    .grid
                    .unwrap()
                    .beat(auto.start_seconds);
                let first = decks.next().unwrap();
                assert!(first.playing[incoming]);
                assert_eq!(first.cue_positions[incoming], cue as u64);
                assert!((first.positions[incoming] as i64 - cue as i64).abs() <= 2);
                decks.command(Command::AutoTransition(from, [1, 1], end), [1, 1]);
                assert!(decks.voices[incoming].as_ref().unwrap().playing);
                assert_eq!(decks.voices[incoming].as_ref().unwrap().cue_position, cue);
            }
        }
    }
    #[test]
    fn automatic_overlaps_shorten_to_the_largest_supported_length_that_fits() {
        for from in 0..2 {
            for end in [false, true] {
                for (position, bars, boundary) in [(35, 2, 36.), (37, 1, 38.), (39, 0, 40.)] {
                    let mut decks = auto_decks(from, 8, false);
                    decks.voices[from].as_mut().unwrap().seek(48000 * position);
                    decks.command(Command::AutoTransition(from, [1, 1], end), [1, 1]);
                    let auto = decks.auto.unwrap();
                    assert_eq!(auto.beats, bars as f64 * 4.);
                    assert_eq!(auto.start_seconds, boundary);
                    assert_eq!(decks.auto_bars, 8); // Fallback does not change Settings.
                    assert!(decks.voices.iter().flatten().all(|v| v.synced));
                    // Exercise the actual shortened handoff, including zero overlap.
                    for _ in 0..48000 * 6 {
                        let frame = decks.next().unwrap();
                        if decks.auto.is_none() {
                            assert!(!frame.playing[from]);
                            assert!(frame.playing[1 - from]);
                            assert_eq!(frame.gains[from], 0.);
                            break;
                        }
                    }
                    assert!(decks.auto.is_none());
                }
            }
        }
    }
    #[test]
    fn shortened_zero_overlap_hands_off_at_eof_even_when_locked_playback_runs_faster() {
        let mut decks = auto_decks(0, 8, false);
        decks.master_bpm = 180.;
        decks.voices[0].as_mut().unwrap().seek(48000 * 40 - 2);
        decks.command(Command::AutoTransition(0, [1, 1], true), [1, 1]);
        assert_eq!(decks.auto.unwrap().beats, 0.);
        for _ in 0..16 {
            decks.next().unwrap();
        }
        assert!(decks.auto.is_none());
        assert!(!decks.voices[0].as_ref().unwrap().playing);
        assert!(decks.voices[1].as_ref().unwrap().playing);
        assert_eq!(decks.crossfader, 0.);
    }
    #[test]
    fn incoming_cue_also_limits_the_available_overlap_and_zero_overlap_uses_it() {
        let mut decks = auto_decks(0, 8, false);
        let cue = 48000 * 38;
        decks.voices[1].as_mut().unwrap().cue_position = cue;
        decks.command(Command::AutoTransition(0, [1, 1], true), [1, 1]);
        // At 140 BPM, one bar fits after this cue; two bars do not.
        assert_eq!(decks.auto.unwrap().beats, 4.);
        assert_eq!(decks.auto.unwrap().incoming_start, cue);
        decks.command(Command::AutoTransition(0, [1, 1], true), [1, 1]);
        decks.command(Command::AutoBars(0), [1, 1]);
        decks.command(Command::AutoTransition(0, [1, 1], true), [1, 1]);
        decks.voices[0].as_mut().unwrap().seek(48000 * 40 - 1);
        decks.global_beat = decks.voices[0]
            .as_ref()
            .unwrap()
            .grid
            .unwrap()
            .beat(decks.voices[0].as_ref().unwrap().seconds());
        for _ in 0..10 {
            decks.next().unwrap();
        }
        assert!(decks.auto.is_none());
        assert!((decks.voices[1].as_ref().unwrap().seconds() - 38.).abs() < 0.001);
    }
    #[test]
    fn automatic_transition_rejects_missing_grids_and_two_playing_decks() {
        let mut decks = auto_decks(0, 8, true);
        decks.voices[1].as_mut().unwrap().grid = None;
        assert!(decks.arm_auto(0, [1, 1], false).is_err());
        let mut decks = auto_decks(0, 8, true);
        decks.voices[1].as_mut().unwrap().playing = true;
        assert!(decks.arm_auto(0, [1, 1], false).is_err());
    }
    fn source() -> Arc<Source> {
        let left: Vec<f32> = (0..48000)
            .map(|i| ((i as f32 * 440. * std::f32::consts::TAU) / 48000.).sin() * 0.2)
            .collect();
        Arc::new(Source {
            progressive: None,
            bass_profile: Default::default(),
            right: left.iter().map(|v| v * 0.5).collect(),
            left,
        })
    }
    fn install(decks: &mut Decks, d: usize, g: u64, source: Arc<Source>) {
        let mut latest = [1, 1];
        latest[d] = g;
        drop(decks.command(
            Command::Install {
                deck: d,
                generation: g,
                voice: Box::new(Voice::new(source, g)),
                preserve_lock: false,
                reset_mixer: false,
            },
            latest,
        ));
    }
    #[test]
    fn hot_cues_hold_preview_release_and_play_latches_without_restarting() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.voices[0]
            .as_mut()
            .unwrap()
            .restore_hot_cues([Some(0.25), Some(0.5), None, None]);
        decks.command(Command::HotCue(0, 1, 0, false), [1, 1]);
        for _ in 0..1024 {
            decks.next().unwrap();
        }
        assert!(decks.voices[0].as_ref().unwrap().cue_preview);
        decks.command(Command::CueRelease(0, 1), [1, 1]);
        decks.command(Command::HotCueRelease(0, 1, 1), [1, 1]);
        assert!(decks.voices[0].as_ref().unwrap().playing);
        decks.command(Command::HotCueRelease(0, 1, 0), [1, 1]);
        let voice = decks.voices[0].as_ref().unwrap();
        assert!(!voice.playing && !voice.cue_preview);
        assert_eq!(voice.position, crate::sample_rate::get() / 4);
        for play in [Command::Play(0, 1), Command::PlayPause(0, 1)] {
            decks.command(Command::HotCue(0, 1, 0, false), [1, 1]);
            for _ in 0..1024 {
                decks.next().unwrap();
            }
            let position = decks.voices[0].as_ref().unwrap().position;
            decks.command(play, [1, 1]);
            let voice = decks.voices[0].as_ref().unwrap();
            assert_eq!(voice.position, position);
            assert!(voice.playing && !voice.cue_preview);
            decks.command(Command::HotCueRelease(0, 1, 0), [1, 1]);
            assert!(decks.voices[0].as_ref().unwrap().playing);
            decks.command(Command::Pause(0, 1), [1, 1]);
        }
    }
    #[test]
    fn hot_cues_restore_source_seconds_and_emit_only_edits_for_persistence() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        let voice = decks.voices[0].as_mut().unwrap();
        voice.cue_identity = Some(Arc::from("a".repeat(64)));
        voice.restore_hot_cues([Some(0.), None, Some(0.25), None]);
        assert_eq!(
            voice.hot_cues,
            [Some(0), None, Some(crate::sample_rate::get() / 4), None]
        );
        assert!(decks
            .command(Command::HotCue(0, 1, 2, false), [1, 1])
            .is_none());
        assert_eq!(
            decks.voices[0].as_ref().unwrap().position,
            crate::sample_rate::get() / 4
        );
        let Some(Retired::CueChange(saved)) =
            decks.command(Command::HotCue(0, 1, 1, false), [1, 1])
        else {
            panic!("Cue capture must emit a save")
        };
        assert_eq!(saved.identity.as_ref(), "a".repeat(64));
        assert_eq!(saved.slot, 1);
        assert_eq!(saved.seconds, Some(0.25));
        let Some(Retired::CueChange(cleared)) =
            decks.command(Command::HotCue(0, 1, 2, true), [1, 1])
        else {
            panic!("Cue clear must emit a save")
        };
        assert_eq!(cleared.slot, 2);
        assert_eq!(cleared.seconds, None);
        assert!(decks
            .command(Command::HotCue(0, 0, 0, true), [1, 1])
            .is_none());
        assert_eq!(decks.voices[0].as_ref().unwrap().hot_cues[0], Some(0));
    }
    #[test]
    fn hot_cue_move_preserves_transport_and_emits_a_clamped_save() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        let voice = decks.voices[0].as_mut().unwrap();
        voice.cue_identity = Some(Arc::from("a".repeat(64)));
        voice.restore_hot_cues([Some(0.25), None, None, None]);
        let position = voice.position;
        let playing = voice.playing;
        let Some(Retired::CueChange(saved)) =
            decks.command(Command::HotCueMove(0, 1, 0, 0.12345), [1, 1])
        else {
            panic!("Cue move must emit a save")
        };
        let expected = (0.12345 * crate::sample_rate::get() as f64).round() as usize;
        assert_eq!(
            saved.seconds,
            Some(expected as f64 / crate::sample_rate::get() as f64)
        );
        assert_eq!(saved.slot, 0);
        assert_eq!(decks.voices[0].as_ref().unwrap().position, position);
        assert_eq!(decks.voices[0].as_ref().unwrap().playing, playing);
        for (generation, slot, seconds) in [(0, 0, 0.5), (1, 1, 0.5), (1, 0, f64::NAN), (1, 0, -1.)]
        {
            assert!(decks
                .command(Command::HotCueMove(0, generation, slot, seconds), [1, 1])
                .is_none());
        }
        assert_eq!(
            decks.voices[0].as_ref().unwrap().hot_cues[0],
            Some(expected)
        );
        decks.command(Command::HotCueMove(0, 1, 0, 1000.), [1, 1]);
        let voice = decks.voices[0].as_ref().unwrap();
        assert_eq!(voice.hot_cues[0], Some(voice.source.len() - 1));
    }
    #[test]
    fn hot_cues_capture_recall_clear_and_reset_with_track() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        for slot in 0..4 {
            decks.command(Command::Seek(0, 1, 12000 + slot * 1000), [1, 1]);
            decks.command(Command::HotCue(0, 1, slot, false), [1, 1]);
        }
        assert_eq!(
            decks.next().unwrap().hot_cues[0],
            [Some(12000), Some(13000), Some(14000), Some(15000)]
        );
        decks.command(Command::Seek(0, 1, 20000), [1, 1]);
        decks.command(Command::HotCue(0, 1, 0, false), [1, 1]);
        let voice = decks.voices[0].as_ref().unwrap();
        assert_eq!(voice.position, 12000);
        assert!(voice.playing && voice.cue_preview);
        decks.command(Command::HotCueRelease(0, 1, 0), [1, 1]);
        assert!(!decks.voices[0].as_ref().unwrap().playing);
        decks.command(Command::Play(0, 1), [1, 1]);
        decks.next().unwrap();
        let before = decks.voices[0].as_ref().unwrap().position;
        decks.command(Command::HotCue(0, 1, 2, true), [1, 1]);
        assert_eq!(decks.voices[0].as_ref().unwrap().position, before);
        decks.command(Command::HotCue(0, 1, 1, false), [1, 1]);
        let voice = decks.voices[0].as_ref().unwrap();
        assert_eq!(voice.position, 13000);
        assert!(voice.playing);
        assert_eq!(voice.hot_cues[2], None);
        assert_eq!(voice.cue_position, 0);
        decks.command(Command::Pause(0, 1), [1, 1]);
        install(&mut decks, 0, 2, source());
        decks.command(Command::HotCue(0, 1, 0, false), [2, 1]);
        assert_eq!(decks.next().unwrap().hot_cues[0], [None; 4]);
    }
    #[test]
    fn pioneer_cue_sets_returns_previews_and_latches() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(Command::Seek(0, 1, 12000), [1, 1]);
        decks.command(Command::CuePress(0, 1), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.cue_positions[0], 12000);
        assert!(!frame.playing[0]);
        decks.command(Command::CueRelease(0, 1), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..1024 {
            decks.next().unwrap();
        }
        decks.command(Command::CuePress(0, 1), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.positions[0], 12000);
        assert!(!frame.playing[0]);
        decks.command(Command::CueRelease(0, 1), [1, 1]);
        decks.command(Command::CuePress(0, 1), [1, 1]);
        let mut audible = false;
        for _ in 0..1024 {
            let frame = decks.next().unwrap();
            audible |= frame.samples.iter().any(|s| s.abs() > 0.001);
            assert!(frame.cue_preview[0] && frame.playing[0]);
        }
        assert!(audible);
        decks.command(Command::CueRelease(0, 1), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.positions[0], 12000);
        assert!(!frame.playing[0] && !frame.cue_preview[0]);
        decks.command(Command::CuePress(0, 1), [1, 1]);
        for _ in 0..300 {
            decks.next().unwrap();
        }
        let before = decks.voices[0].as_ref().unwrap().position;
        decks.command(Command::PlayPause(0, 1), [1, 1]);
        decks.command(Command::CueRelease(0, 1), [1, 1]);
        let frame = decks.next().unwrap();
        assert!(frame.positions[0] > before as u64);
        assert!(frame.playing[0] && !frame.cue_preview[0]);
        decks.command(Command::PlayPause(0, 1), [1, 1]);
        assert!(!decks.next().unwrap().playing[0]);
    }

    #[test]
    fn cue_setting_snaps_only_locked_decks_to_the_selected_grid_boundary() {
        let audio = Arc::new(Source {
            left: vec![0.; 480000],
            right: vec![0.; 480000],
            progressive: None,
            bass_profile: Default::default(),
        });
        for (locked, quantum, position, expected) in [
            (true, 4, 1.0, 0.25),
            (true, 4, 1.4, 2.25),
            (true, 1, 1.4, 1.25),
            (true, 1, 1.6, 1.75),
            (false, 4, 1.4, 1.4),
            (false, 1, 1.6, 1.6),
            (true, 4, 9.9, 8.25),
        ] {
            let mut decks = Decks::new();
            install(&mut decks, 0, 1, audio.clone());
            decks.sync_quantum = quantum;
            let voice = decks.voices[0].as_mut().unwrap();
            voice.apply_grid(Grid {
                bpm: 120.,
                downbeat_seconds: 0.25,
                reviewed: true,
            });
            voice.set_start(0.25);
            voice.synced = locked;
            decks.command(Command::Seek(0, 1, (position * 48000.) as usize), [1, 1]);
            decks.command(Command::CuePress(0, 1), [1, 1]);
            let frame = decks.next().unwrap();
            let expected = (expected * 48000_f64).round() as u64;
            assert_eq!(frame.cue_positions[0], expected);
            assert_eq!(frame.positions[0], expected);
            assert!(!frame.playing[0] && !frame.cue_preview[0]);
            // A snap back to the existing cue still sets it; the next press previews.
            decks.command(Command::CueRelease(0, 1), [1, 1]);
            decks.command(Command::CuePress(0, 1), [1, 1]);
            assert!(decks.voices[0].as_ref().unwrap().cue_preview);
            decks.command(Command::CueRelease(0, 1), [1, 1]);
            assert_eq!(decks.voices[0].as_ref().unwrap().position as u64, expected);
        }
    }

    #[test]
    fn cue_is_immediate_with_sync_and_old_gestures_cannot_affect_replacement() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        install(&mut decks, 1, 1, source());
        decks.command(Command::Play(1, 1), [1, 1]);
        let voice = decks.voices[0].as_mut().unwrap();
        voice.apply_grid(Grid {
            bpm: 120.,
            downbeat_seconds: 0.,
            reviewed: true,
        });
        voice.synced = true;
        decks.command(Command::CuePress(0, 1), [1, 1]);
        let frame = decks.next().unwrap();
        assert!(frame.playing[0] && frame.cue_preview[0]);
        assert!(!frame.launch_pending[0]);
        decks.command(Command::CueRelease(0, 1), [1, 1]);
        install(&mut decks, 0, 2, source());
        decks.command(Command::CuePress(0, 2), [2, 1]);
        decks.command(Command::CueRelease(0, 1), [2, 1]);
        decks.command(Command::CuePress(0, 1), [2, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.cue_positions[0], 0);
        assert!(frame.cue_preview[0]);
        decks.command(Command::Stop(0, 2), [2, 1]);
        assert!(!decks.next().unwrap().cue_preview[0]);
    }

    #[test]
    fn scrub_cubic_reduces_fractional_sine_error_and_handles_edges() {
        let frequency = 0.12 * std::f64::consts::TAU;
        let samples: Vec<f32> = (0..1024)
            .map(|i| (i as f64 * frequency).sin() as f32)
            .collect();
        let mut linear_error = 0.;
        let mut cubic_error = 0.;
        for i in 2..1021 {
            let position = i as f64 + 0.37;
            let expected = (position * frequency).sin() as f32;
            let linear = samples[i] + 0.37 * (samples[i + 1] - samples[i]);
            linear_error += (linear - expected).powi(2);
            cubic_error += (scrub_sample(&samples, position, 0) - expected).powi(2);
        }
        assert!(cubic_error < linear_error * 0.1);
        for channel in [&[0.5][..], &[0.5, -0.5][..]] {
            assert_eq!(scrub_sample(channel, 0., 0), 0.5);
            assert_eq!(
                scrub_sample(channel, (channel.len() - 1) as f64, 0),
                *channel.last().unwrap()
            );
        }
        assert_eq!(scrub_sample(&samples, 12., 12), samples[12]);
    }

    #[test]
    fn scrub_steady_drag_keeps_speed_stable_between_pointer_packets() {
        let rate = crate::sample_rate::get();
        for (intervals, tolerance) in [
            (vec![rate / 60], 0.001),
            (vec![rate / 30], 0.001),
            (
                vec![rate * 7 / 480, rate / 60, rate * 9 / 480, rate / 60],
                0.05,
            ),
        ] {
            for speed in [0.5, 1., 2., -1.] {
                let start = rate * 5;
                let mut motion = ScrubMotion::new(start);
                let mut packet = 0;
                let mut next_packet = intervals[0];
                for frame in 0..rate * 2 {
                    if frame == next_packet {
                        motion.retarget((start as f64 + frame as f64 * speed).round() as usize);
                        packet += 1;
                        next_packet += intervals[packet % intervals.len()];
                    }
                    motion.packet_age += 1;
                    motion.advance(0, rate * 20);
                    if frame > rate {
                        assert!(
                            (motion.velocity / speed - 1.).abs() < tolerance,
                            "speed {speed}, intervals {intervals:?}, actual {}",
                            motion.velocity
                        );
                    }
                }
                // No new packets: finish the ramp and settle at the exact target.
                for _ in 0..rate {
                    motion.advance(0, rate * 20);
                }
                assert_eq!(motion.position, motion.target);
                assert_eq!(motion.envelope, 0.);
            }
        }
    }

    #[test]
    fn scrub_packets_preserve_velocity_and_envelope_and_reversals_settle() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(Command::ScrubStart(0, 1, 12000), [1, 1]);
        decks.command(Command::Scrub(0, 1, 24000, true), [1, 1]);
        for _ in 0..768 {
            decks.next().unwrap();
        }
        let before = decks.voices[0].as_ref().unwrap().scrub.unwrap();
        assert!(before.velocity > 0. && before.envelope > 0.9);
        decks.command(Command::Scrub(0, 1, 30000, true), [1, 1]);
        let after = decks.voices[0].as_ref().unwrap().scrub.unwrap();
        assert_eq!(before.position, after.position);
        assert_eq!(before.velocity, after.velocity);
        assert_eq!(before.envelope, after.envelope);
        decks.next().unwrap();
        assert!(decks.voices[0].as_ref().unwrap().scrub.unwrap().envelope > 0.9);
        decks.command(Command::Scrub(0, 1, 0, true), [1, 1]);
        for _ in 0..24000 {
            assert!(decks.next().unwrap().samples.iter().all(|s| s.is_finite()));
        }
        let motion = decks.voices[0].as_ref().unwrap().scrub.unwrap();
        assert_eq!(motion.position, 0.);
        assert_eq!(motion.velocity, 0.);
        assert_eq!(motion.envelope, 0.);
    }

    #[test]
    fn scrub_follows_motion_then_is_silent_and_ignores_playing_decks() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(Command::ScrubStart(0, 1, 12000), [1, 1]);
        assert_eq!(decks.next().unwrap().samples, [0.; 2]);
        decks.command(Command::Scrub(0, 1, 24000, true), [1, 1]);
        let mut audible = false;
        for _ in 0..24000 {
            let frame = decks.next().unwrap();
            audible |= frame.samples.iter().any(|s| s.abs() > 0.001);
            assert!(!frame.playing[0]);
        }
        assert!(audible);
        for _ in 0..2000 {
            assert_eq!(decks.next().unwrap().samples, [0.; 2]);
        }
        assert_eq!(decks.next().unwrap().positions[0], 24000);
        decks.command(Command::Scrub(0, 1, 6000, true), [1, 1]);
        for _ in 0..24000 {
            decks.next().unwrap();
        }
        assert_eq!(decks.next().unwrap().positions[0], 6000);
        decks.command(Command::Scrub(0, 1, 6000, false), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        decks.command(Command::ScrubStart(0, 1, 30000), [1, 1]);
        assert!(decks.next().unwrap().positions[0] < 10000);
    }
    #[test]
    fn phrase_jump_blends_continuing_audio_and_preserves_destination_clock() {
        for frames in [240, 1440, 4800] {
            for speed in [0.8, 1., 1.2] {
                let source = source();
                let make_voice = || {
                    let mut v = Voice::new(source.clone(), 1);
                    v.grid = Some(Grid {
                        bpm: 120.,
                        downbeat_seconds: 0.,
                        reviewed: true,
                    });
                    v.tempo(120. * speed).unwrap();
                    v.pitch(2.).unwrap();
                    v.playing = true;
                    v
                };
                let mut jumped = make_voice();
                let mut outgoing = make_voice();
                let mut incoming = make_voice();
                for _ in 0..2048 {
                    jumped.next_mode::<true>().unwrap();
                    outgoing.next_mode::<true>().unwrap();
                    incoming.next_mode::<true>().unwrap();
                }
                let continuation: Vec<_> = (0..frames)
                    .map(|_| outgoing.next_mode::<true>().unwrap())
                    .collect();
                // Match the accepted stretcher reset history after outgoing lookahead.
                for _ in 0..frames {
                    incoming.next_mode::<true>().unwrap();
                }
                incoming.output = jumped.output;
                incoming.dsp.ratios(speed, incoming.pitch_semitones);
                jumped.phrase_jump(24000, frames);
                incoming.seek(24000);
                incoming.transition = 0;
                assert_eq!(jumped.output, incoming.output);
                assert_eq!(jumped.position_epoch, incoming.position_epoch);
                for index in 0..frames + 256 {
                    let a = continuation.get(index).copied().unwrap_or([0.; 2]);
                    let b = incoming.next_mode::<true>().unwrap();
                    let actual = jumped.next_mode::<true>().unwrap();
                    let mix = (index as f32 / frames as f32).min(1.);
                    for channel in 0..2 {
                        let expected = a[channel] * (1. - mix) + b[channel] * mix;
                        assert!(
                            (actual[channel] - expected).abs() < 1e-5,
                            "duration={frames} speed={speed} frame={index} actual={} expected={expected} a={} b={}", actual[channel], a[channel], b[channel]
                        );
                    }
                    assert!((jumped.seconds() - incoming.seconds()).abs() < 1e-9);
                }
                // A second jump can overlap the first; ordinary seeks cancel it.
                jumped.phrase_jump(12000, frames);
                jumped.next().unwrap();
                jumped.phrase_jump(24000, frames);
                assert!(jumped.next().unwrap().iter().all(|v| v.is_finite()));
                jumped.seek(0);
                assert_eq!(jumped.jump_length, 0);
            }
        }
    }
    #[test]
    fn phrase_jump_respects_disabled_fade_pause_and_stale_commands() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(Command::PhraseJump(0, 1, 12000), [1, 1]);
        assert_eq!(decks.voices[0].as_ref().unwrap().jump_length, 0);
        decks.command(Command::Play(0, 1), [1, 1]);
        decks.command(Command::PhraseJump(0, 0, 24000), [1, 1]);
        assert_eq!(decks.voices[0].as_ref().unwrap().position, 12000);
        decks.command(Command::JumpCrossfade(480), [1, 1]);
        decks.command(Command::PhraseJump(0, 1, 24000), [1, 1]);
        assert_eq!(decks.voices[0].as_ref().unwrap().jump_length, 480);
        decks.command(Command::JumpCrossfade(0), [1, 1]);
        decks.command(Command::PhraseJump(0, 1, 12000), [1, 1]);
        assert_eq!(decks.voices[0].as_ref().unwrap().jump_length, 0);
        let voice = decks.voices[0].as_mut().unwrap();
        voice.seek(47990);
        voice.phrase_jump(12000, 480);
        assert!(voice.playing);
        assert_eq!(voice.position, 12000);
        assert!(voice.jump_tail[10..480]
            .iter()
            .all(|sample| *sample == [0.; 2]));
    }
    #[test]
    fn vinyl_stop_decelerates_to_silence_and_resumes_at_normal_speed() {
        for rewind in [false, true] {
            let mut decks = Decks::new();
            install(&mut decks, 0, 1, source());
            decks.command(Command::Play(0, 1), [1, 1]);
            for _ in 0..1000 {
                decks.next().unwrap();
            }
            decks.command(
                if rewind {
                    Command::Stop(0, 1)
                } else {
                    Command::PlayPause(0, 1)
                },
                [1, 1],
            );
            let length = crate::sample_rate::get() * 300 / 1000;
            let mut crossings = [0; 3];
            let mut previous = 0.;
            let mut peak = 0_f32;
            for frame in 0..length {
                let sample = decks.next().unwrap().deck_samples[0][0];
                assert!(sample.is_finite());
                peak = peak.max(sample.abs());
                if sample > 0. && previous <= 0. {
                    crossings[(frame * 3 / length).min(2)] += 1;
                }
                previous = sample;
            }
            assert!(peak > 0.01);
            assert!(
                crossings[0] > crossings[1] && crossings[1] > crossings[2],
                "Pitch must fall: {crossings:?}"
            );
            let voice = decks.voices[0].as_ref().unwrap();
            assert!(voice.vinyl_tail.is_none());
            assert!(!voice.playing);
            assert_eq!(voice.clock.speed, 1.);
            if rewind {
                assert_eq!(voice.position, 0);
            } else {
                assert!((voice.position as f64 - (1000. + length as f64 / 2.)).abs() < 2.);
            }
            assert_eq!(decks.next().unwrap().deck_samples[0], [0.; 2]);
            let position = decks.voices[0].as_ref().unwrap().position;
            decks.command(Command::Play(0, 1), [1, 1]);
            assert_eq!(decks.next().unwrap().positions[0], position as u64 + 1);
        }
    }
    #[test]
    fn vinyl_stop_can_be_interrupted_and_pending_launches_stop_silently() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..1000 {
            decks.next().unwrap();
        }
        decks.command(Command::Pause(0, 1), [1, 1]);
        for _ in 0..100 {
            decks.next().unwrap();
        }
        decks.command(Command::Play(0, 1), [1, 1]);
        let voice = decks.voices[0].as_ref().unwrap();
        assert!(voice.playing && voice.vinyl_tail.is_none());
        assert_eq!(voice.clock.speed, 1.);
        decks.voices[0].as_mut().unwrap().launch_beat = Some(100.);
        decks.command(Command::Pause(0, 1), [1, 1]);
        assert!(decks.voices[0].as_ref().unwrap().vinyl_tail.is_none());
        assert_eq!(decks.next().unwrap().deck_samples[0], [0.; 2]);
    }
    #[test]
    fn finite_play_pause_stop_seek_and_end_without_looping() {
        let mut decks = Decks::new();
        decks.command(Command::VinylStop(false), [0, 0]);
        install(&mut decks, 0, 1, source());
        assert_eq!(decks.next().unwrap().positions, [0, 0]);
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..200 {
            decks.next().unwrap();
        }
        decks.command(Command::Pause(0, 1), [1, 1]);
        for _ in 0..200 {
            assert_eq!(decks.next().unwrap().positions[0], 200);
        }
        decks.command(Command::Seek(0, 1, 47000), [1, 1]);
        assert_eq!(decks.next().unwrap().positions[0], 47000);
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..1000 {
            assert!(decks.next().unwrap().samples.iter().all(|v| v.is_finite()));
        }
        for _ in 0..200 {
            let frame = decks.next().unwrap();
            assert_eq!(frame.positions[0], 48000);
            assert!(!frame.playing[0]);
            assert_eq!(frame.samples, [0., 0.]);
        }
        decks.command(Command::Stop(0, 1), [1, 1]);
        assert_eq!(decks.next().unwrap().positions[0], 0);
    }
    #[test]
    fn beat_loop_wraps_switches_length_and_releases() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(
            Command::Grid(
                0,
                1,
                Grid {
                    bpm: 120.,
                    downbeat_seconds: 0.,
                    reviewed: true,
                },
            ),
            [1, 1],
        );
        decks.command(Command::Seek(0, 1, 12000), [1, 1]);
        decks.command(Command::LoopLength(0, 1, 1., false), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.loop_starts[0], Some(12000));
        assert_eq!(frame.loop_ends[0], Some(36000));
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..25000 {
            decks.next().unwrap();
        }
        assert!(decks.voices[0].as_ref().unwrap().playing);
        assert!(decks.voices[0].as_ref().unwrap().position < 15000);
        decks.command(Command::LoopLength(0, 1, 0.5, false), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.loop_starts[0], Some(12000));
        assert_eq!(frame.loop_ends[0], Some(24000));
        assert_eq!(frame.loop_lengths[0], Some(0.5));
        decks.command(Command::LoopLength(0, 1, 0.5, false), [1, 1]);
        assert_eq!(decks.next().unwrap().loop_ends[0], None);
        decks.command(Command::LoopLength(0, 1, 1. / 32., false), [1, 1]);
        for _ in 0..3000 {
            let frame = decks.next().unwrap();
            assert!(frame.samples.iter().all(|sample| sample.is_finite()));
            assert!(frame.positions[0] <= frame.loop_ends[0].unwrap());
        }
    }
    #[test]
    fn manual_loop_in_and_out_follow_playhead() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(Command::Seek(0, 1, 8000), [1, 1]);
        decks.command(Command::LoopIn(0, 1, false), [1, 1]);
        decks.command(Command::Seek(0, 1, 16000), [1, 1]);
        decks.command(Command::LoopOut(0, 1, false), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.loop_starts[0], Some(8000));
        assert_eq!(frame.loop_ends[0], Some(16000));
        assert_eq!(frame.loop_lengths[0], None);
    }
    #[test]
    fn manual_loop_points_snap_to_nearest_grid_beats_when_enabled() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(
            Command::Grid(
                0,
                1,
                Grid {
                    bpm: 120.,
                    downbeat_seconds: 0.1,
                    reviewed: true,
                },
            ),
            [1, 1],
        );
        decks.command(Command::Seek(0, 1, 16000), [1, 1]); // 0.333 s rounds to 0.1 s.
        decks.command(Command::LoopIn(0, 1, true), [1, 1]);
        decks.command(Command::Seek(0, 1, 41000), [1, 1]); // 0.854 s rounds to 1.0 s, clipped to track end.
        decks.command(Command::LoopOut(0, 1, true), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.loop_starts[0], Some(4800));
        assert_eq!(frame.loop_ends[0], Some(48000));
        decks.command(Command::LoopIn(0, 1, false), [1, 1]);
        assert_eq!(decks.next().unwrap().loop_starts[0], Some(41000));
    }
    #[test]
    fn slip_returns_to_background_position_after_switching_and_releasing_a_loop() {
        let mut decks = Decks::new();
        decks.command(Command::VinylStop(false), [0, 0]);
        install(&mut decks, 0, 1, source());
        decks.command(
            Command::Grid(
                0,
                1,
                Grid {
                    bpm: 120.,
                    downbeat_seconds: 0.,
                    reviewed: true,
                },
            ),
            [1, 1],
        );
        decks.command(Command::Slip(0, 1, true), [1, 1]);
        decks.command(Command::LoopLength(0, 1, 0.5, false), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..30000 {
            decks.next().unwrap();
        }
        assert!(decks.voices[0].as_ref().unwrap().position < 12000);
        assert_eq!(
            decks.voices[0].as_ref().unwrap().slip_position,
            Some(30000.)
        );
        decks.command(Command::Pause(0, 1), [1, 1]);
        for _ in 0..1000 {
            decks.next().unwrap();
        }
        assert_eq!(
            decks.voices[0].as_ref().unwrap().slip_position,
            Some(30000.)
        );
        decks.command(Command::LoopLength(0, 1, 1., false), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..1000 {
            decks.next().unwrap();
        }
        decks.command(Command::Tempo(0, [1, 0], 240.), [1, 1]);
        for _ in 0..1000 {
            decks.next().unwrap();
        }
        assert_eq!(
            decks.voices[0].as_ref().unwrap().slip_position,
            Some(33000.)
        );
        decks.command(Command::LoopLength(0, 1, 1., false), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.loop_ends[0], None);
        assert!((frame.positions[0] as i64 - 33002).abs() <= 2);
        assert!(frame.slip_enabled[0]);
    }
    #[test]
    fn manual_slip_release_and_disabled_slip_keep_the_expected_playhead() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(Command::Seek(0, 1, 8000), [1, 1]);
        decks.command(Command::Slip(0, 1, true), [1, 1]);
        decks.command(Command::LoopIn(0, 1, false), [1, 1]);
        decks.command(Command::Seek(0, 1, 16000), [1, 1]);
        decks.command(Command::LoopOut(0, 1, false), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..10000 {
            decks.next().unwrap();
        }
        decks.command(Command::LoopOut(0, 1, false), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.loop_ends[0], None);
        assert!((frame.positions[0] as i64 - 26001).abs() <= 1);
        decks.command(Command::Slip(0, 1, false), [1, 1]);
        decks.command(Command::LoopLength(0, 1, 0.5, false), [1, 1]);
        for _ in 0..18000 {
            decks.next().unwrap();
        }
        let looped = decks.voices[0].as_ref().unwrap().position;
        decks.command(Command::LoopLength(0, 1, 0.5, false), [1, 1]);
        let frame = decks.next().unwrap();
        assert!((frame.positions[0] as i64 - (looped + 1) as i64).abs() <= 1);
    }
    #[test]
    fn playable_zero_is_the_first_beat_for_locked_and_unlocked_transport() {
        for locked in [false, true] {
            let mut decks = Decks::new();
            decks.command(Command::VinylStop(false), [0, 0]);
            let source = Arc::new(Source {
                progressive: None,
                bass_profile: Default::default(),
                left: vec![0.1; 48000 * 5],
                right: vec![0.1; 48000 * 5],
            });
            install(&mut decks, 0, 1, source);
            let voice = decks.voices[0].as_mut().unwrap();
            voice.apply_grid(Grid {
                bpm: 120.,
                downbeat_seconds: 0.1,
                reviewed: true,
            });
            voice.set_start(0.1);
            decks.command(Command::Sync(0, [1, 0], locked), [1, 0]);
            let frame = decks.next().unwrap();
            assert_eq!(frame.positions[0], 4800);
            assert_eq!(frame.cue_positions[0], 4800);
            assert_eq!(frame.synced[0], locked);
            assert!(!frame.playing[0]);
            decks.command(Command::LoopLength(0, 1, 4., true), [1, 1]);
            let frame = decks.next().unwrap();
            assert_eq!(
                (frame.loop_starts[0], frame.loop_ends[0]),
                (Some(4800), Some(100800))
            );
            decks.command(Command::Play(0, 1), [1, 1]);
            for _ in 0..100810 {
                let frame = decks.next().unwrap();
                assert!((4800..=100800).contains(&frame.positions[0]));
            }
            assert!(decks.next().unwrap().positions[0] < 10000);
            decks.command(Command::Stop(0, 1), [1, 1]);
            assert_eq!(decks.next().unwrap().positions[0], 4800);
            decks.command(Command::Seek(0, 1, 0), [1, 1]);
            assert_eq!(decks.next().unwrap().positions[0], 4800);
            decks.command(Command::ScrubStart(0, 1, 4800), [1, 1]);
            decks.command(Command::Scrub(0, 1, 0, true), [1, 1]);
            for _ in 0..1921 {
                assert_eq!(decks.next().unwrap().positions[0], 4800);
            }
            decks.command(Command::Scrub(0, 1, 0, false), [1, 1]);
            decks.command(Command::Seek(0, 1, usize::MAX), [1, 1]);
            assert_eq!(decks.next().unwrap().positions[0], 240000);
            decks.command(Command::Play(0, 1), [1, 1]);
            assert!((4800..10000).contains(&decks.next().unwrap().positions[0]));
        }
    }
    #[test]
    fn loops_at_track_start_keep_the_full_length_with_offset_grids() {
        for downbeat_seconds in [0., 0.000001, 0.1, 0.5, 2.1] {
            for beats in [0.125, 0.5, 1., 4., 8., 64.] {
                for align in [false, true] {
                    let mut decks = Decks::new();
                    let source = Arc::new(Source {
                        progressive: None,
                        bass_profile: Default::default(),
                        left: vec![0.; 48000 * 40],
                        right: vec![0.; 48000 * 40],
                    });
                    install(&mut decks, 0, 1, source);
                    decks.command(
                        Command::Grid(
                            0,
                            1,
                            Grid {
                                bpm: 120.,
                                downbeat_seconds,
                                reviewed: true,
                            },
                        ),
                        [1, 1],
                    );
                    decks.command(Command::LoopLength(0, 1, beats, align), [1, 1]);
                    let frame = decks.next().unwrap();
                    assert_eq!(frame.loop_starts[0], Some(0));
                    assert_eq!(frame.loop_ends[0], Some((beats * 24000.).round() as u64));
                    assert_eq!(frame.loop_lengths[0], Some(beats));
                    assert_eq!(frame.positions[0], 0);
                    assert!(!frame.playing[0]);
                }
            }
        }
    }
    #[test]
    fn aligned_lengths_select_the_grid_segment_containing_the_playhead() {
        let mut decks = Decks::new();
        let source = Arc::new(Source {
            progressive: None,
            bass_profile: Default::default(),
            left: vec![0.; 48000 * 5],
            right: vec![0.; 48000 * 5],
        });
        install(&mut decks, 0, 1, source);
        decks.command(
            Command::Grid(
                0,
                1,
                Grid {
                    bpm: 120.,
                    downbeat_seconds: 0.1,
                    reviewed: true,
                },
            ),
            [1, 1],
        );
        decks.command(Command::Seek(0, 1, 41280), [1, 1]); // 0.86 s, inside beat 2.
        decks.command(Command::LoopLength(0, 1, 1., true), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(
            (frame.loop_starts[0], frame.loop_ends[0]),
            (Some(28800), Some(52800))
        );
        decks.command(Command::LoopLength(0, 1, 4., true), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(
            (frame.loop_starts[0], frame.loop_ends[0]),
            (Some(4800), Some(100800))
        );
        decks.command(Command::LoopLength(0, 1, 8., true), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(
            (frame.loop_starts[0], frame.loop_ends[0]),
            (Some(4800), Some(196800))
        );
        decks.command(Command::LoopLength(0, 1, 1. / 2., true), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(
            (frame.loop_starts[0], frame.loop_ends[0]),
            (Some(40800), Some(52800))
        );
    }
    #[test]
    fn pause_resume_and_unity_seek_preserve_output_equivalence() {
        let shared = source();
        let mut direct = Voice::new(shared.clone(), 1);
        let mut paused = Voice::new(shared.clone(), 1);
        direct.play();
        paused.play();
        for _ in 0..500 {
            assert_eq!(direct.next().unwrap(), paused.next().unwrap());
        }
        paused.playing = false;
        for _ in 0..500 {
            assert_eq!(paused.next().unwrap(), [0., 0.]);
        }
        paused.play();
        for _ in 0..500 {
            assert_eq!(direct.next().unwrap(), paused.next().unwrap());
        }
        direct.seek(12000);
        let mut fresh = Voice::new(shared, 1);
        fresh.seek(12000);
        fresh.play();
        // The first 5 ms intentionally crossfade from each voice's previous
        // output. Once that explicit transition settles, DSP output is identical.
        for _ in 0..240 {
            direct.next().unwrap();
            fresh.next().unwrap();
        }
        for _ in 0..4096 {
            assert_eq!(direct.next().unwrap(), fresh.next().unwrap());
        }
    }
    #[test]
    fn commands_replacement_and_old_generations_are_isolated() {
        let shared = source();
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, shared.clone());
        install(&mut decks, 1, 1, shared.clone());
        assert!(Arc::ptr_eq(
            &decks.voices[0].as_ref().unwrap().source,
            &decks.voices[1].as_ref().unwrap().source
        ));
        for d in 0..2 {
            decks.command(Command::Play(d, 1), [1, 1]);
        }
        for _ in 0..1000 {
            decks.next().unwrap();
        }
        decks.command(Command::Seek(0, 1, 20000), [1, 1]);
        decks.command(Command::Gain(0, 1, 0.1), [1, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.positions, [20001, 1001]);
        assert_eq!(frame.gains, [0.1, 0.8]);
        let retired = decks.command(
            Command::Install {
                deck: 0,
                generation: 2,
                voice: Box::new(Voice::new(shared.clone(), 2)),
                preserve_lock: false,
                reset_mixer: false,
            },
            [3, 1],
        );
        assert!(retired.is_some());
        assert_eq!(decks.next().unwrap().generations, [1, 1]);
        drop(retired);
        decks.command(Command::Pause(0, 1), [3, 1]);
        install(&mut decks, 0, 3, shared);
        decks.command(Command::Play(0, 1), [3, 1]);
        let frame = decks.next().unwrap();
        assert_eq!(frame.positions[0], 0);
        assert!(!frame.playing[0]);
        assert!(frame.playing[1]);
    }
    #[test]
    fn frame_positions_follow_output_not_decoder_lookahead() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(Command::Play(0, 1), [1, 1]);
        let (mut producer, mut consumer) = rtrb::RingBuffer::new(1024);
        for _ in 0..1024 {
            producer.push(decks.next().unwrap()).unwrap();
        }
        assert_eq!(decks.voices[0].as_ref().unwrap().position, 1024);
        for position in 1..=128 {
            assert_eq!(consumer.pop().unwrap().positions[0], position);
        }
        assert_eq!(decks.voices[0].as_ref().unwrap().position, 1024);
    }
}

#[cfg(test)]
mod timing_tests {
    use super::*;
    #[test]
    fn locked_slip_release_is_immediate_and_loop_changes_cancel_pending_release() {
        let mut decks = decks();
        for d in 0..2 {
            decks.command(Command::Sync(d, [1, 1], true), [1, 1]);
            decks.command(Command::Play(d, 1), [1, 1]);
        }
        decks.command(Command::Slip(0, 1, true), [1, 1]);
        decks.command(Command::LoopLength(0, 1, 0.5, false), [1, 1]);
        for _ in 0..36000 {
            decks.next().unwrap();
        }
        decks.command(Command::LoopLength(0, 1, 0.5, false), [1, 1]);
        let frame = decks.next().unwrap();
        assert!(frame.loop_ends[0].is_none());
        assert!(!frame.loop_release_pending[0]);
        assert!(phase_error(&decks, 0) < 0.0001);
        decks.command(Command::Slip(0, 1, false), [1, 1]);
        decks.command(Command::LoopLength(0, 1, 0.5, true), [1, 1]);
        for _ in 0..24000 {
            decks.next().unwrap();
        }
        decks.command(Command::LoopLength(0, 1, 0.5, true), [1, 1]);
        assert!(decks.next().unwrap().loop_release_pending[0]);
        decks.command(Command::LoopLength(0, 1, 1., true), [1, 1]);
        assert!(!decks.next().unwrap().loop_release_pending[0]);
        decks.command(Command::LoopLength(0, 1, 1., true), [1, 1]);
        assert!(decks.next().unwrap().loop_release_pending[0]);
        decks.command(Command::Seek(0, 1, 96000), [1, 1]);
        let frame = decks.next().unwrap();
        assert!(frame.loop_ends[0].is_none());
        assert!(!frame.loop_release_pending[0]);
        assert!(phase_error(&decks, 0) < 0.0001);
    }
    #[test]
    fn locked_loop_release_resumes_at_out_with_configured_phase_without_slip() {
        for (quantum, manual) in [(1, false), (1, true), (4, false), (4, true)] {
            let mut decks = decks();
            decks.command(Command::SyncQuantum(quantum), [1, 1]);
            for d in 0..2 {
                decks.command(Command::Sync(d, [1, 1], true), [1, 1]);
                decks.command(Command::Play(d, 1), [1, 1]);
            }
            for _ in 0..18000 {
                decks.next().unwrap();
            }
            let before = decks.voices[1].as_ref().unwrap();
            let offset = decks.global_beat - before.grid.unwrap().beat(before.seconds());
            if manual {
                decks.command(Command::LoopIn(1, 1, false), [1, 1]);
                for _ in 0..13001 {
                    decks.next().unwrap();
                }
                decks.command(Command::LoopOut(1, 1, false), [1, 1]);
            } else {
                decks.command(Command::LoopLength(1, 1, 0.5, true), [1, 1]);
            }
            for _ in 0..180000 {
                decks.next().unwrap();
            }
            let out = decks.voices[1].as_ref().unwrap().loop_end.unwrap();
            assert!(!decks.voices[1].as_ref().unwrap().slip_enabled);
            if manual {
                decks.command(Command::LoopOut(1, 1, false), [1, 1]);
            } else {
                decks.command(Command::LoopLength(1, 1, 0.5, true), [1, 1]);
            }
            assert!(decks.next().unwrap().loop_release_pending[1]);
            let release = decks.voices[1].as_ref().unwrap().loop_release_beat.unwrap();
            assert!(release >= decks.global_beat);
            assert!(release - decks.global_beat <= f64::from(quantum));
            let grid = decks.voices[1].as_ref().unwrap().grid.unwrap();
            let phase_error =
                (release - grid.beat(out as f64 / 48000.) - offset).rem_euclid(f64::from(quantum));
            assert!(phase_error.min(f64::from(quantum) - phase_error) < 1e-8);
            decks.command(Command::MasterTempo(150.), [1, 1]);
            let mut released = false;
            for press in 0..96002 {
                let frame = decks.next().unwrap();
                if frame.loop_ends[1].is_none() {
                    assert!(!frame.loop_release_pending[1]);
                    assert!(frame.synced.iter().all(|locked| *locked));
                    assert!((decks.global_beat - release).abs() < 0.0002);
                    assert!(
                        (frame.positions[1] as i64 - out as i64).abs() <= 3,
                        "Release must continue at OUT, not at a background position"
                    );
                    released = true;
                    break;
                }
                // Both the active length and OUT must keep the original deadline.
                let command = if !manual && press % 2 == 0 {
                    Command::LoopLength(1, 1, 0.5, true)
                } else {
                    Command::LoopOut(1, 1, false)
                };
                decks.command(command, [1, 1]);
                assert_eq!(
                    decks.voices[1].as_ref().unwrap().loop_release_beat,
                    Some(release)
                );
            }
            assert!(released);
            for _ in 0..24000 {
                decks.next().unwrap();
                let voice = decks.voices[1].as_ref().unwrap();
                let error = (voice.grid.unwrap().beat(voice.seconds()) + offset
                    - decks.global_beat)
                    .rem_euclid(f64::from(quantum));
                assert!(error.min(f64::from(quantum) - error) < 0.0002);
            }
        }
    }
    fn phase_error(decks: &Decks, deck: usize) -> f64 {
        let voice = decks.voices[deck].as_ref().unwrap();
        let delta = (voice.grid.unwrap().beat(voice.seconds()) - decks.global_beat).rem_euclid(4.);
        delta.min(4. - delta)
    }
    #[test]
    fn playing_seek_preserves_local_beat_or_bar_phase_and_lock() {
        for quantum in [1, 4] {
            for locked in [false, true] {
                let mut decks = decks();
                decks.sync_quantum = quantum;
                let v = decks.voices[0].as_mut().unwrap();
                v.seek(63600); // 1.325 seconds, offset from both beat and bar boundaries.
                v.playing = true;
                v.synced = locked;
                let grid = v.grid.unwrap();
                let before = grid.beat(v.seconds());
                decks.command(Command::Seek(0, 1, 333600), [1, 1]);
                let v = decks.voices[0].as_ref().unwrap();
                let error = (grid.beat(v.seconds()) - before).rem_euclid(f64::from(quantum));
                assert!(error.min(f64::from(quantum) - error) < 0.0001);
                assert!((v.seconds() - 6.95).abs() <= f64::from(quantum) * 0.25 + 0.0001);
                assert!(v.playing);
                assert_eq!(v.synced, locked);
                // Edge clicks choose a valid matching phase rather than clamping it away.
                for target in [0, 480000] {
                    decks.command(Command::Seek(0, 1, target), [1, 1]);
                    let v = decks.voices[0].as_ref().unwrap();
                    let error = (grid.beat(v.seconds()) - before).rem_euclid(f64::from(quantum));
                    assert!(error.min(f64::from(quantum) - error) < 0.0001);
                    assert!(v.seconds() >= 0. && v.seconds() < 10.);
                }
                decks.voices[0].as_mut().unwrap().playing = false;
                decks.command(Command::Seek(0, 1, 333600), [1, 1]);
                assert!((decks.voices[0].as_ref().unwrap().seconds() - 6.95).abs() < 0.0001);
            }
        }
    }
    #[test]
    fn seeking_a_locked_loop_releases_it_and_rejoins_the_master_phrase() {
        let mut decks = decks();
        decks.command(Command::Play(0, 1), [1, 1]);
        decks.command(Command::Play(1, 1), [1, 1]);
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        decks.command(Command::Slip(1, 1, true), [1, 1]);
        decks.command(Command::LoopLength(1, 1, 1., false), [1, 1]);
        for _ in 0..36000 {
            decks.next().unwrap();
        }
        assert!(decks.voices[1].as_ref().unwrap().loop_end.is_some());
        assert!(phase_error(&decks, 1) > 0.5);

        decks.command(Command::Seek(1, 1, 288000), [1, 1]);
        let voice = decks.voices[1].as_ref().unwrap();
        assert!(voice.synced);
        assert!(voice.playing);
        assert!(voice.loop_start.is_none());
        assert!(voice.loop_end.is_none());
        assert!(voice.loop_length.is_none());
        assert!(voice.slip_position.is_none());
        assert!((voice.seconds() - 6.).abs() < 0.5);
        assert!(phase_error(&decks, 1) < 0.0001);
        for _ in 0..48000 {
            decks.next().unwrap();
        }
        assert!(phase_error(&decks, 1) < 0.0001);
        assert!(decks.voices[1].as_ref().unwrap().seconds() > 6.);
    }
    fn advance_until_launch(decks: &mut Decks, deck: usize) {
        for _ in 0..240000 {
            decks.next().unwrap();
            if decks.voices[deck].as_ref().unwrap().launch_beat.is_none() {
                return;
            }
        }
        panic!("Deck did not launch within five seconds");
    }
    fn decks() -> Decks {
        let left: Vec<f32> = (0..480000)
            .map(|i| (i as f32 * 440. * std::f32::consts::TAU / 48000.).sin() * 0.2)
            .collect();
        let source = Arc::new(Source {
            progressive: None,
            bass_profile: Default::default(),
            right: left.clone(),
            left,
        });
        let mut decks = Decks::new();
        for d in 0..2 {
            let mut voice = Voice::new(source.clone(), 1);
            voice.apply_grid(Grid {
                bpm: if d == 0 { 120. } else { 100. },
                downbeat_seconds: 0.1,
                reviewed: true,
            });
            decks.command(
                Command::Install {
                    deck: d,
                    generation: 1,
                    voice: Box::new(voice),
                    preserve_lock: false,
                    reset_mixer: false,
                },
                [1, 1],
            );
        }
        decks
    }
    #[test]
    fn midi_jog_smooths_displacement_without_seeking_and_preserves_tempo() {
        for direction in [-1., 1.] {
            let mut decks = decks();
            let voice = decks.voices[0].as_mut().unwrap();
            voice.seek(48000 * 4);
            voice.play();
            for _ in 0..48000 {
                decks.next().unwrap();
            }
            let voice = decks.voices[0].as_ref().unwrap();
            let start = voice.clock.at(voice.output);
            let epoch = voice.position_epoch;
            let bpm = voice.target_bpm;
            decks.command(Command::Jog(0, 99, 0.05), [1, 1]);
            decks.command(Command::Jog(0, 1, f64::NAN), [1, 1]);
            assert!(decks.voices[0].as_ref().unwrap().jog.is_none());
            decks.command(Command::Jog(0, 1, direction * 0.05), [1, 1]);
            decks.command(Command::Jog(0, 1, direction * 0.05), [1, 1]);
            let mut energy = 0.;
            let mut previous = decks.voices[0].as_ref().unwrap().last_sample[0];
            let mut max_jump = 0_f32;
            for _ in 0..96000 {
                let sample = decks.next().unwrap();
                energy += sample.samples[0] * sample.samples[0];
                let current = decks.voices[0].as_ref().unwrap().last_sample[0];
                max_jump = max_jump.max((current - previous).abs());
                previous = current;
                assert_eq!(decks.voices[0].as_ref().unwrap().position_epoch, epoch);
            }
            let voice = decks.voices[0].as_ref().unwrap();
            assert!(
                (voice.clock.at(voice.output) - start - 96000. - direction * 4800.).abs() < 2.,
                "direction={direction} start={start} actual={} speed={} jog={:?}",
                voice.clock.at(voice.output),
                voice.clock.speed,
                voice.jog
            );
            assert!(voice.jog.is_none());
            assert_eq!(voice.clock.speed, 1.);
            assert_eq!(voice.target_bpm, bpm);
            assert!(energy > 1.);
            assert!(
                max_jump < 0.08,
                "Wheel produced a discontinuity: {max_jump}"
            );
        }
    }
    #[test]
    fn midi_jog_auditions_stopped_decks_accumulates_and_obeys_live_lock() {
        let mut decks = decks();
        decks.command(Command::Jog(0, 1, 0.1), [1, 1]);
        decks.command(Command::Jog(0, 1, 0.1), [1, 1]);
        let mut energy = 0.;
        for _ in 0..24000 {
            let sample = decks.next().unwrap();
            energy += sample.samples[0] * sample.samples[0];
        }
        let voice = decks.voices[0].as_ref().unwrap();
        assert!(!voice.playing);
        assert!((voice.seconds() - 0.2).abs() < 0.0001);
        assert!(energy > 0.01);
        decks.command(Command::Jog(0, 1, -10.), [1, 1]);
        for _ in 0..24000 {
            decks.next().unwrap();
        }
        assert!(decks.voices[0].as_ref().unwrap().seconds() < 0.0001);
        decks.command(Command::Play(0, 1), [1, 1]);
        assert!(decks.voices[0].as_ref().unwrap().wheel_scrub.is_none());
        decks.command(Command::Jog(0, 1, 0.1), [1, 1]);
        for _ in 0..1000 {
            decks.next().unwrap();
        }
        decks.command(Command::Sync(0, [1, 1], true), [1, 1]);
        decks.command(Command::Jog(0, 1, 0.1), [1, 1]);
        let voice = decks.voices[0].as_ref().unwrap();
        assert!(voice.synced);
        assert!(voice.jog.is_none());
        assert_eq!(voice.clock.speed, decks.master_bpm / 120.);
        decks.command(Command::Pause(0, 1), [1, 1]);
        decks.command(Command::Jog(0, 1, 0.1), [1, 1]);
        assert!(decks.voices[0].as_ref().unwrap().wheel_scrub.is_some());
    }
    #[test]
    fn controller_tempo_sweep_preserves_audio_and_settles_at_latest_target() {
        let mut decks = decks();
        decks.voices[0].as_mut().unwrap().play();
        for _ in 0..48000 {
            decks.next().unwrap();
        }
        let epoch = decks.voices[0].as_ref().unwrap().position_epoch;
        let mut previous = decks.voices[0].as_ref().unwrap().last_sample[0];
        let mut max_jump = 0_f32;
        for bpm in [121., 123., 126., 129.6, 125., 120., 110.4] {
            let voice = decks.voices[0].as_ref().unwrap();
            let position = voice.clock.at(voice.output);
            let input = voice.input;
            let available = voice.available;
            let speed = voice.clock.speed;
            decks.command(Command::SmoothTempo(0, [1, 1], bpm), [1, 1]);
            let voice = decks.voices[0].as_ref().unwrap();
            assert_eq!(voice.clock.at(voice.output), position);
            assert_eq!(voice.clock.speed, speed);
            assert_eq!(voice.input, input);
            assert_eq!(voice.available, available);
            assert_eq!(voice.target_bpm, bpm);
            assert_eq!(voice.transition, 0, "Controller must not re-prime audio");
            let mut energy = 0_f32;
            for _ in 0..1680 {
                decks.next().unwrap();
                let voice = decks.voices[0].as_ref().unwrap();
                let sample = voice.last_sample[0];
                max_jump = max_jump.max((sample - previous).abs());
                energy += sample * sample;
                previous = sample;
                assert_eq!(voice.position_epoch, epoch);
            }
            assert!((energy / 1680.).sqrt() > 0.05, "Sweep must not mute audio");
        }
        assert!(
            max_jump < 0.08,
            "Sweep produced a discontinuity: {max_jump}"
        );
        for _ in 0..3840 {
            decks.next().unwrap();
        }
        let voice = decks.voices[0].as_ref().unwrap();
        assert!(voice.tempo_ramp.is_none());
        assert_eq!(voice.clock.speed, 110.4 / 120.);
        assert_eq!(voice.target_bpm, 110.4);
        // Stale and invalid input cannot change a live ramp or its target.
        decks.command(Command::SmoothTempo(0, [99, 1], 130.), [1, 1]);
        decks.command(Command::SmoothTempo(0, [1, 1], f64::NAN), [1, 1]);
        assert_eq!(decks.voices[0].as_ref().unwrap().target_bpm, 110.4);
        decks.command(Command::SmoothTempo(0, [1, 1], 130.), [1, 1]);
        decks.command(Command::Tempo(0, [1, 1], 120.), [1, 1]);
        let voice = decks.voices[0].as_mut().unwrap();
        assert!(voice.tempo_ramp.is_none());
        assert_eq!(voice.clock.speed, 1.);
        voice.playing = false;
        voice.smooth_tempo(126.).unwrap();
        assert!(voice.tempo_ramp.is_none());
        assert_eq!(voice.clock.speed, 1.05);
        voice.playing = true;
        voice.smooth_tempo(130.).unwrap();
        voice.continuous_tempo(130.);
        assert!(voice.tempo_ramp.is_none());
        assert_eq!(voice.clock.speed, 130. / 120.);
        voice.smooth_tempo(140.).unwrap();
        decks.command(Command::Sync(0, [1, 1], true), [1, 1]);
        let voice = decks.voices[0].as_ref().unwrap();
        assert!(voice.synced);
        assert!(voice.tempo_ramp.is_none());
        assert_eq!(voice.clock.speed, decks.master_bpm / 120.);
    }
    #[test]
    fn locking_the_only_playing_deck_adopts_its_clock_without_changing_audio() {
        for deck in 0..2 {
            for quantum in [1, 4] {
                for master_bpm in [100., 120.] {
                    for looping in [false, true] {
                        let setup = || {
                            let mut decks = decks();
                            decks.command(Command::SyncQuantum(quantum), [1, 1]);
                            // A loaded, locked, paused deck does not own the clock.
                            decks.command(Command::Sync(1 - deck, [1, 1], true), [1, 1]);
                            decks.command(Command::Play(deck, 1), [1, 1]);
                            decks.command(Command::Seek(deck, 1, 72000), [1, 1]);
                            if looping {
                                decks.command(Command::LoopLength(deck, 1, 0.5, false), [1, 1]);
                            }
                            decks.command(Command::MasterTempo(master_bpm), [1, 1]);
                            for _ in 0..1234 {
                                decks.next().unwrap();
                            }
                            decks
                        };
                        let mut original = setup();
                        let mut locked = setup();
                        let before = locked.voices[deck].as_ref().unwrap();
                        let seconds = before.seconds();
                        let epoch = before.position_epoch;
                        let bpm = before.target_bpm;
                        let beat = before.grid.unwrap().beat(seconds);
                        assert!((locked.global_beat - beat).abs() > 0.1);
                        locked.command(Command::Sync(deck, [1, 1], true), [1, 1]);
                        let voice = locked.voices[deck].as_ref().unwrap();
                        assert!(voice.synced);
                        assert_eq!(voice.seconds(), seconds);
                        assert_eq!(voice.position_epoch, epoch);
                        assert_eq!(locked.master_bpm, bpm);
                        assert!(locked.master_bpm_set);
                        assert_eq!(locked.global_beat, beat);
                        for _ in 0..512 {
                            let a = original.next().unwrap();
                            let b = locked.next().unwrap();
                            assert_eq!(a.deck_samples[deck], b.deck_samples[deck]);
                            assert_eq!(a.positions[deck], b.positions[deck]);
                        }
                    }
                }
            }
        }
    }
    #[test]
    fn independent_master_and_deck_locks() {
        let mut decks = decks();
        assert_eq!(decks.master_bpm, 120.);
        decks.command(Command::Sync(0, [1, 1], true), [1, 1]);
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        assert!(decks.voices.iter().all(|v| v.as_ref().unwrap().synced));
        decks.command(Command::MasterTempo(125.), [1, 1]);
        decks.next().unwrap();
        assert!(decks
            .voices
            .iter()
            .all(|v| v.as_ref().unwrap().target_bpm == 125.));
        decks.command(Command::Sync(1, [1, 1], false), [1, 1]);
        decks.command(Command::MasterTempo(130.), [1, 1]);
        decks.next().unwrap();
        assert_eq!(decks.voices[0].as_ref().unwrap().target_bpm, 130.);
        assert_eq!(decks.voices[1].as_ref().unwrap().target_bpm, 125.);
    }
    #[test]
    fn idle_clock_freezes_and_first_deck_preserves_pickup_beat() {
        let mut decks = decks();
        decks.command(
            Command::Grid(
                0,
                1,
                Grid {
                    bpm: 120.,
                    downbeat_seconds: 0.5,
                    reviewed: true,
                },
            ),
            [1, 1],
        );
        decks.command(Command::Sync(0, [1, 1], true), [1, 1]);
        for _ in 0..48000 {
            decks.next().unwrap();
        }
        assert_eq!(decks.global_beat, 0.);
        decks.command(Command::Play(0, 1), [1, 1]);
        assert_eq!(decks.global_beat, -1.);
        assert_eq!(decks.voices[0].as_ref().unwrap().position, 0);
        assert_eq!(decks.voices[0].as_ref().unwrap().reposition_seconds, 0.);
        for _ in 0..24000 {
            decks.next().unwrap();
        }
        assert!(phase_error(&decks, 0) < 0.0001);
        decks.command(Command::Pause(0, 1), [1, 1]);
        let frozen = decks.global_beat;
        for _ in 0..48000 {
            decks.next().unwrap();
        }
        assert_eq!(decks.global_beat, frozen);
        decks.command(Command::Stop(0, 1), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        assert_eq!(decks.global_beat, -1.);
        assert_eq!(decks.voices[0].as_ref().unwrap().position, 0);
        decks.command(Command::Play(1, 1), [1, 1]);
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        assert!(phase_error(&decks, 1) < 0.0001);
        decks.command(Command::Pause(0, 1), [1, 1]);
        let before = decks.global_beat;
        decks.next().unwrap();
        assert!(
            decks.global_beat > before,
            "The other playing deck keeps the clock running"
        );
    }
    #[test]
    fn early_bar_launch_advances_past_an_offset_source_downbeat() {
        let mut decks = decks(); // Deck B's first downbeat is 0.1 s into the source.
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..105600 {
            decks.next().unwrap();
        }
        assert!((decks.global_beat - 4.2).abs() < 0.0001);
        decks.command(Command::Play(1, 1), [1, 1]);
        let voice = decks.voices[1].as_ref().unwrap();
        assert!(voice.launch_beat.is_none());
        assert!((voice.seconds() - 0.22).abs() < 1. / 48000.);
        assert!(phase_error(&decks, 1) < 0.0001);
    }
    #[test]
    fn paused_seek_and_rolling_scrub_keep_the_master_lock() {
        let mut decks = decks();
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        decks.command(Command::Seek(1, 1, 48000), [1, 1]);
        assert!(decks.voices[1].as_ref().unwrap().synced);
        decks.command(Command::ScrubStart(1, 1, 96000), [1, 1]);
        decks.command(Command::Scrub(1, 1, 120000, true), [1, 1]);
        decks.command(Command::Scrub(1, 1, 120000, false), [1, 1]);
        assert!(decks.voices[1].as_ref().unwrap().synced);
        assert!((decks.voices[1].as_ref().unwrap().seconds() - 2.5).abs() < 1. / 48000.);
    }
    #[test]
    fn locked_deck_joins_current_bar_during_its_first_beat() {
        for phase in [0.02, 0.5, 0.99] {
            let mut decks = decks();
            decks.command(
                Command::Grid(
                    1,
                    1,
                    Grid {
                        bpm: 100.,
                        downbeat_seconds: 0.,
                        reviewed: true,
                    },
                ),
                [1, 1],
            );
            decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
            decks.command(Command::Play(0, 1), [1, 1]);
            for _ in 0..((4. + phase + 0.2) * 24000.) as usize {
                decks.next().unwrap();
            }
            assert!((decks.global_beat - (4. + phase)).abs() < 0.0001);
            decks.command(Command::Play(1, 1), [1, 1]);
            let voice = decks.voices[1].as_ref().unwrap();
            assert!(voice.launch_beat.is_none(), "phase {phase}");
            assert!((voice.seconds() - phase * 0.6).abs() < 1. / 48000.);
            assert!(phase_error(&decks, 1) < 0.0001);
            let frame = decks.next().unwrap();
            assert!(!frame.launch_pending[1]);
            assert!(frame.playing[1]);
        }
    }
    #[test]
    fn locked_deck_waits_after_beat_two_of_current_bar() {
        let mut decks = decks();
        decks.command(
            Command::Grid(
                1,
                1,
                Grid {
                    bpm: 100.,
                    downbeat_seconds: 0.,
                    reviewed: true,
                },
            ),
            [1, 1],
        );
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..129600 {
            decks.next().unwrap();
        }
        assert!((decks.global_beat - 5.2).abs() < 0.0001);
        decks.command(Command::Play(1, 1), [1, 1]);
        assert_eq!(decks.voices[1].as_ref().unwrap().launch_beat, Some(8.));
        assert_eq!(decks.voices[1].as_ref().unwrap().position, 0);
    }
    #[test]
    fn locked_deck_waits_for_upcoming_bar_without_skipping_its_start() {
        let mut decks = decks();
        decks.command(
            Command::Grid(
                1,
                1,
                Grid {
                    bpm: 100.,
                    downbeat_seconds: 0.,
                    reviewed: true,
                },
            ),
            [1, 1],
        );
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..96000 {
            decks.next().unwrap();
        }
        assert!((decks.global_beat - 3.8).abs() < 0.0001);
        decks.command(Command::Play(1, 1), [1, 1]);
        assert_eq!(decks.voices[1].as_ref().unwrap().launch_beat, Some(4.));
        for _ in 0..4700 {
            decks.next().unwrap();
        }
        let waiting = decks.voices[1].as_ref().unwrap();
        assert!(waiting.launch_beat.is_some());
        assert_eq!(waiting.position, 0);
        assert_eq!(waiting.output, 0);
        let mut remaining = 0;
        while decks.voices[1].as_ref().unwrap().launch_beat.is_some() && remaining < 200 {
            decks.next().unwrap();
            remaining += 1;
        }
        assert!(
            (99..=102).contains(&remaining),
            "Unexpected launch delay: {remaining} frames"
        );
        assert!(decks.voices[1].as_ref().unwrap().position < 10);
        assert!(phase_error(&decks, 1) < 0.0001);
    }
    #[test]
    fn beat_setting_launches_on_next_beat_instead_of_next_bar() {
        let mut decks = decks();
        decks.command(
            Command::Grid(
                1,
                1,
                Grid {
                    bpm: 100.,
                    downbeat_seconds: 0.,
                    reviewed: true,
                },
            ),
            [1, 1],
        );
        decks.command(Command::SyncQuantum(1), [1, 1]);
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..60000 {
            decks.next().unwrap();
        }
        assert!((decks.global_beat - 2.3).abs() < 0.0001);
        decks.command(Command::Play(1, 1), [1, 1]);
        assert_eq!(decks.voices[1].as_ref().unwrap().launch_beat, Some(3.));
        assert_eq!(decks.voices[1].as_ref().unwrap().position, 0);
        advance_until_launch(&mut decks, 1);
        assert!(decks.voices[1].as_ref().unwrap().position < 10);
        let source_beat = decks.voices[1]
            .as_ref()
            .unwrap()
            .grid
            .unwrap()
            .beat(decks.voices[1].as_ref().unwrap().seconds());
        let beat_offset = (source_beat - decks.global_beat).rem_euclid(1.);
        assert!(beat_offset.min(1. - beat_offset) < 0.0001);
    }
    #[test]
    fn queued_pickup_is_preserved_if_the_running_deck_stops() {
        let mut decks = decks();
        decks.command(
            Command::Grid(
                1,
                1,
                Grid {
                    bpm: 100.,
                    downbeat_seconds: 0.6,
                    reviewed: true,
                },
            ),
            [1, 1],
        );
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        for _ in 0..96000 {
            decks.next().unwrap();
        }
        decks.command(Command::Play(1, 1), [1, 1]);
        assert!((decks.voices[1].as_ref().unwrap().launch_beat.unwrap() - 7.).abs() < 0.0001);
        decks.command(Command::Stop(0, 1), [1, 1]);
        decks.next().unwrap();
        assert!(decks.voices[1].as_ref().unwrap().launch_beat.is_none());
        assert!(decks.voices[1].as_ref().unwrap().position < 10);
        assert!(phase_error(&decks, 1) < 0.0001);
    }
    #[test]
    fn locked_decks_follow_master_bar_phase_on_lock_resume_and_tempo_change() {
        let mut decks = decks();
        decks.command(Command::Play(0, 1), [1, 1]);
        decks.command(Command::Play(1, 1), [1, 1]);
        decks.command(Command::Seek(0, 1, 72000), [1, 1]);
        decks.command(Command::Seek(1, 1, 240000), [1, 1]);
        for _ in 0..24000 {
            decks.next().unwrap();
        }
        decks.command(Command::Sync(0, [1, 1], true), [1, 1]);
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        assert!(phase_error(&decks, 0) < 0.0001);
        assert!(phase_error(&decks, 1) < 0.0001);
        decks.command(Command::MasterTempo(125.), [1, 1]);
        for _ in 0..24000 {
            decks.next().unwrap();
        }
        assert!(phase_error(&decks, 0) < 0.0002);
        assert!(phase_error(&decks, 1) < 0.0002);
        decks.command(Command::Pause(0, 1), [1, 1]);
        for _ in 0..24000 {
            decks.next().unwrap();
        }
        assert!(decks.voices[0].as_ref().unwrap().synced);
        decks.command(Command::Play(0, 1), [1, 1]);
        assert!(decks.voices[0].as_ref().unwrap().launch_beat.is_some());
        advance_until_launch(&mut decks, 0);
        assert!(phase_error(&decks, 0) < 0.0001);
        decks.command(Command::Stop(0, 1), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        advance_until_launch(&mut decks, 0);
        assert!(phase_error(&decks, 0) < 0.0001);
        decks.command(Command::Sync(1, [1, 1], false), [1, 1]);
        decks.command(Command::Tempo(1, [1, 1], 110.), [1, 1]);
        decks.command(Command::Drift(1, [1, 1]), [1, 1]);
        for _ in 0..24000 {
            decks.next().unwrap();
        }
        assert!(phase_error(&decks, 0) < 0.001);
        assert!(decks.voices[0].as_ref().unwrap().synced);
    }
    #[test]
    fn rendered_clicks_land_on_master_beats() {
        let mut decks = decks();
        decks.command(Command::Gain(0, 1, 0.), [1, 1]);
        decks.command(Command::Click(0, 1, 1.), [1, 1]);
        decks.command(Command::ClickPanel(0, 1, true), [1, 1]);
        decks.command(Command::MasterTempo(125.), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        decks.command(Command::Sync(0, [1, 1], true), [1, 1]);
        let mut silent = 2400;
        let mut onsets = 0;
        let mut max_error_ms: f64 = 0.;
        for sample in 0..192000 {
            let frame = decks.next().unwrap();
            if frame.samples[0].abs() > 0.015 {
                if silent > 1000 && sample > 2400 {
                    onsets += 1;
                    let phase = frame.global_beat.rem_euclid(1.);
                    max_error_ms =
                        max_error_ms.max(phase.min(1. - phase) * 60000. / frame.master_bpm);
                }
                silent = 0;
            } else {
                silent += 1;
            }
        }
        assert!(onsets >= 5, "Expected several audible beat clicks");
        assert!(
            max_error_ms <= 10.,
            "Master click offset {max_error_ms:.3} ms"
        );
    }
    #[test]
    fn click_is_silent_outside_the_timing_panel_and_resumes_at_its_saved_volume() {
        let mut decks = decks();
        decks.command(Command::Gain(0, 1, 0.), [1, 1]);
        decks.command(Command::Click(0, 1, 1.), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        let audible =
            |decks: &mut Decks| (0..30000).any(|_| decks.next().unwrap().samples[0].abs() > 0.015);
        assert!(!audible(&mut decks));
        decks.command(Command::ClickPanel(0, 1, true), [1, 1]);
        assert!(audible(&mut decks));
        decks.command(Command::ClickPanel(0, 1, false), [1, 1]);
        assert!(!audible(&mut decks));
        assert_eq!(decks.voices[0].as_ref().unwrap().click_gain, 1.);
        decks.command(Command::ClickPanel(0, 1, true), [1, 1]);
        assert!(audible(&mut decks));
    }
    #[test]
    fn lock_accepts_large_bpm_changes_and_renders_audio() {
        for (source_bpm, target) in [(30., 600.), (300., 15.), (100., 300.), (120., 30.)] {
            let mut decks = decks();
            decks.voices[1].as_mut().unwrap().apply_grid(Grid {
                bpm: source_bpm,
                downbeat_seconds: 0.1,
                reviewed: true,
            });
            decks.command(Command::MasterTempo(target), [1, 1]);
            decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
            let voice = decks.voices[1].as_ref().unwrap();
            assert!(voice.synced, "{source_bpm} BPM should lock to {target}");
            assert_eq!(voice.target_bpm, target);
            assert_eq!(voice.clock.speed, target / source_bpm);
            assert_eq!(voice.timing_error, 0);
            decks.command(Command::Play(1, 1), [1, 1]);
            let mut peak = 0_f32;
            for _ in 0..12000 {
                let frame = decks.next().unwrap();
                assert!(frame.samples.iter().all(|sample| sample.is_finite()));
                peak = peak.max(frame.samples[0].abs());
            }
            assert!(peak > 0.001, "Silent at {source_bpm} -> {target} BPM");
            assert!(decks.voices[1].as_ref().unwrap().synced);
            // Changing the master while locked must retain the lock as well.
            let next_target = if target == 600. { 15. } else { 600. };
            decks.command(Command::MasterTempo(next_target), [1, 1]);
            decks.next().unwrap();
            let voice = decks.voices[1].as_ref().unwrap();
            assert!(voice.synced);
            assert_eq!(voice.target_bpm, next_target);
            assert_eq!(voice.timing_error, 0);
        }
    }
    #[test]
    fn drift_crosses_large_bpm_differences_in_both_directions_without_unlocking() {
        for (source_bpm, target) in [(30., 300.), (300., 30.)] {
            let mut decks = decks();
            for (deck, bpm) in [(0, source_bpm), (1, target)] {
                decks.voices[deck].as_mut().unwrap().apply_grid(Grid {
                    bpm,
                    downbeat_seconds: 0.1,
                    reviewed: true,
                });
            }
            decks.command(Command::MasterTempo(source_bpm), [1, 1]);
            decks.command(Command::Sync(0, [1, 1], true), [1, 1]);
            decks.command(Command::DriftRate(100.), [1, 1]);
            decks.command(Command::Drift(1, [1, 1]), [1, 1]);
            for _ in 0..(3 * 48000) {
                let frame = decks.next().unwrap();
                assert!(frame.synced[0]);
            }
            assert_eq!(decks.master_bpm, target);
            assert_eq!(decks.drift_target, None);
            let follower = decks.voices[0].as_ref().unwrap();
            assert_eq!(follower.target_bpm, target);
            assert_eq!(follower.clock.speed, target / source_bpm);
            assert_eq!(follower.timing_error, 0);
        }
    }
    #[test]
    fn drift_is_rate_limited_and_keeps_lock_states() {
        let mut decks = decks();
        decks.command(Command::MasterTempo(120.), [1, 1]);
        decks.command(Command::Tempo(1, [1, 1], 110.), [1, 1]);
        decks.command(Command::Sync(0, [1, 1], true), [1, 1]);
        decks.command(Command::Drift(1, [1, 1]), [1, 1]);
        for _ in 0..48000 {
            decks.next().unwrap();
        }
        assert!((decks.master_bpm - 119.).abs() < 0.0001);
        assert!(decks.voices[0].as_ref().unwrap().synced);
        assert!(!decks.voices[1].as_ref().unwrap().synced);
        decks.command(Command::DriftRate(2.), [1, 1]);
        for _ in 0..48000 {
            decks.next().unwrap();
        }
        assert!((decks.master_bpm - 117.).abs() < 0.0001);
        decks.command(Command::Drift(0, [1, 1]), [1, 1]);
        assert_eq!(decks.drift_target, Some(0));
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        decks.command(Command::Drift(1, [1, 1]), [1, 1]);
        for _ in 0..48000 {
            decks.next().unwrap();
        }
        assert!((decks.master_bpm - 115.).abs() < 0.0001);
        assert!(decks.voices[0].as_ref().unwrap().synced);
        assert!(decks.voices[1].as_ref().unwrap().synced);
        for _ in 0..(8 * 48000) {
            decks.next().unwrap();
        }
        assert_eq!(decks.master_bpm, 100.);
        assert_eq!(decks.drift_target, None);
    }
    #[test]
    fn load_protects_playing_deck_unless_its_fader_is_zero() {
        for (playing, gain, allowed) in [
            (true, 0.8, false),
            (true, 0.001, false),
            (true, 0., true),
            (false, 0.8, true),
        ] {
            let mut decks = decks();
            let old = decks.voices[0].as_mut().unwrap();
            old.playing = playing;
            old.gain = gain;
            let source = old.source.clone();
            let retired = decks.command(
                Command::Install {
                    deck: 0,
                    generation: 2,
                    voice: Box::new(Voice::new(source, 2)),
                    preserve_lock: true,
                    reset_mixer: true,
                },
                [2, 1],
            );
            assert_eq!(
                decks.voices[0].as_ref().unwrap().generation,
                if allowed { 2 } else { 1 }
            );
            assert_eq!(
                matches!(retired, Some(Retired::RejectedLoad(0, _))),
                !allowed
            );
            if !allowed {
                assert!(decks.voices[0].as_ref().unwrap().playing);
                assert_eq!(decks.voices[0].as_ref().unwrap().gain, gain);
            }
        }
    }
    #[test]
    fn replacing_a_deck_only_clears_its_own_lock() {
        let mut decks = decks();
        decks.command(Command::Sync(0, [1, 1], true), [1, 1]);
        decks.command(Command::Sync(1, [1, 1], true), [1, 1]);
        let source = decks.voices[0].as_ref().unwrap().source.clone();
        drop(decks.command(
            Command::Install {
                deck: 0,
                generation: 2,
                voice: Box::new(Voice::new(source, 2)),
                preserve_lock: false,
                reset_mixer: false,
            },
            [2, 1],
        ));
        assert!(!decks.voices[0].as_ref().unwrap().synced);
        assert!(decks.voices[1].as_ref().unwrap().synced);
    }
    #[test]
    fn replacement_options_preserve_lock_and_reset_or_keep_mixer() {
        let mut decks = decks();
        decks.command(Command::MasterTempo(120.), [1, 1]);
        decks.command(Command::Sync(0, [1, 1], true), [1, 1]);
        decks.command(Command::Gain(0, 1, 0.25), [1, 1]);
        decks.command(Command::Mixer(0, 1, 0, 6.), [1, 1]);
        decks.command(Command::Mixer(0, 1, 4, -0.5), [1, 1]);
        let source = decks.voices[0].as_ref().unwrap().source.clone();
        let mut next = Voice::new(source.clone(), 2);
        let mut settings = next.mixer.settings;
        settings.trim = -4.;
        next.mixer.set(settings);
        next.apply_grid(Grid {
            bpm: 100.,
            downbeat_seconds: 0.1,
            reviewed: true,
        });
        drop(decks.command(
            Command::Install {
                deck: 0,
                generation: 2,
                voice: Box::new(next),
                preserve_lock: true,
                reset_mixer: true,
            },
            [2, 1],
        ));
        let voice = decks.voices[0].as_ref().unwrap();
        assert!(voice.synced);
        assert_eq!(voice.target_bpm, decks.master_bpm);
        assert_eq!(voice.gain, 0.25);
        assert_eq!(voice.mixer.settings.trim, -4.);
        assert_eq!(
            voice.mixer.settings.eq,
            crate::mixer::Settings::default().eq
        );
        assert_eq!(voice.mixer.settings.filter, 0.);

        decks.command(Command::Gain(0, 2, 0.3), [2, 1]);
        decks.command(Command::Mixer(0, 2, 4, 0.7), [2, 1]);
        let mut third = Voice::new(source, 3);
        let mut settings = third.mixer.settings;
        settings.trim = 2.;
        third.mixer.set(settings);
        third.apply_grid(Grid {
            bpm: 110.,
            downbeat_seconds: 0.1,
            reviewed: true,
        });
        drop(decks.command(
            Command::Install {
                deck: 0,
                generation: 3,
                voice: Box::new(third),
                preserve_lock: false,
                reset_mixer: false,
            },
            [3, 1],
        ));
        let voice = decks.voices[0].as_ref().unwrap();
        assert!(!voice.synced);
        assert_eq!(voice.gain, 0.3);
        assert_eq!(voice.mixer.settings.trim, 2.);
        assert_eq!(voice.mixer.settings.filter, 0.7);
    }
    #[test]
    fn rendered_known_source_events_follow_output_mapping() {
        let mut pcm = vec![0.; 384000];
        for second in [1, 3, 6] {
            for i in 0..240 {
                pcm[second * 48000 + i] = (i as f32 * std::f32::consts::TAU * 1000. / 48000.).sin()
                    * (1. - i as f32 / 240.);
            }
        }
        let source = Arc::new(Source {
            progressive: None,
            bass_profile: Default::default(),
            left: pcm.clone(),
            right: pcm,
        });
        for speed in [0.5, 0.8, 1.25, 2.0] {
            let mut voice = Voice::new(source.clone(), 1);
            voice.apply_grid(Grid {
                bpm: 120.,
                downbeat_seconds: 0.,
                reviewed: true,
            });
            voice.tempo(120. * speed).unwrap();
            voice.play();
            let mut output = Vec::new();
            while voice.playing {
                output.push(voice.next().unwrap()[0]);
            }
            for second in [1, 3, 6] {
                let expected = (second as f64 * 48000. / speed).round() as usize;
                let radius = 2400;
                let peak = (expected - radius..expected + radius)
                    .max_by(|a, b| output[*a].abs().total_cmp(&output[*b].abs()))
                    .unwrap();
                let delta = (peak as f64 - expected as f64) / 48.;
                println!(
                    "known source event speed={speed} source={second}s peak offset={delta:.3} ms"
                );
                assert!(output[peak].abs() > 0.05);
                assert!(
                    delta.abs() <= 30.,
                    "Local transient displaced >30 ms in controlled reference"
                );
            }
        }
    }
    #[test]
    fn pitch_shifts_audio_without_changing_duration_and_survives_tempo_and_seek() {
        for shift in [-6., 3., 6.] {
            let mut decks = decks();
            decks.command(Command::Pitch(0, 99, 3.), [1, 1]);
            assert_eq!(decks.voices[0].as_ref().unwrap().pitch_semitones, 0.);
            decks.command(Command::Pitch(0, 1, shift), [1, 1]);
            let voice = decks.voices[0].as_mut().unwrap();
            assert!(voice.pitch(f64::NAN).is_err());
            assert!(voice.pitch(7.).is_err());
            assert!(voice.pitch(0.5).is_err());
            voice.tempo(150.).unwrap();
            voice.seek(0);
            voice.play();
            let mut crossings = 0;
            let mut previous = 0.;
            let mut frames = 0;
            while voice.playing {
                let value = voice.next().unwrap()[0];
                if (48000..144000).contains(&frames) && previous <= 0. && value > 0. {
                    crossings += 1;
                }
                previous = value;
                frames += 1;
            }
            let expected = 440. * 2_f64.powf(shift / 12.);
            assert!((crossings as f64 / 2. - expected).abs() < 3.);
            assert!((frames as f64 - 480000. / 1.25).abs() <= 1.);
            voice.pitch(0.).unwrap();
            assert_eq!(voice.pitch_semitones, 0.);
            assert_eq!(Voice::new(voice.source.clone(), 2).pitch_semitones, 0.);
        }
    }

    #[test]
    fn rendered_tone_preserves_pitch_and_source_duration_at_both_ratios() {
        for speed in [0.5, 0.8, 1.25, 2.0] {
            let mut decks = decks();
            let voice = decks.voices[0].as_mut().unwrap();
            voice.tempo(120. * speed).unwrap();
            voice.play();
            let mut crossings = 0;
            let mut previous = 0.;
            let mut frames = 0;
            while voice.playing {
                let value = voice.next().unwrap()[0];
                if (48000..144000).contains(&frames) && previous <= 0. && value > 0. {
                    crossings += 1;
                }
                previous = value;
                frames += 1;
            }
            println!(
                "rendered speed={speed} duration={frames} frames pitch={} Hz",
                crossings as f64 / 2.
            );
            assert!((crossings as f64 / 2. - 440.).abs() < 2.);
            assert!((frames as f64 - 480000. / speed).abs() <= 1.);
        }
    }
}

#[cfg(test)]
mod audition_sequence_tests {
    use super::*;
    #[test]
    fn audition_stream_pause_upgrade_and_stale_completion_preserve_transport() {
        let mut decks = Decks::new();
        let stream = crate::audition_stream::Stream::fixture(&vec![[0.2; 2]; 2048]);
        let status = stream.status.clone();
        drop(decks.command(
            Command::AuditionInstall(Box::new(Audition::streaming(stream, 7))),
            [0, 0],
        ));
        let mut peak = 0_f32;
        for _ in 0..1024 {
            let frame = decks.next().unwrap();
            peak = peak.max(frame.cue_samples[0].abs());
        }
        assert!(peak > 0.);
        let position = decks.audition.as_ref().unwrap().position;
        decks.command(Command::AuditionControl(7, None), [0, 0]);
        assert!(!decks.next().unwrap().audition_playing);
        assert_eq!(decks.audition.as_ref().unwrap().position, position);
        decks.command(Command::AuditionSequence(7, true, 1), [0, 0]);
        drop(decks.command(Command::AuditionUpgrade(6, track(Some(120.), 0)), [0, 0]));
        assert!(decks.audition.as_ref().unwrap().stream.is_some());
        drop(decks.command(Command::AuditionUpgrade(7, track(Some(120.), 0)), [0, 0]));
        let voice = decks.audition.as_ref().unwrap();
        assert_eq!(voice.position, position);
        assert!(!voice.playing);
        assert!(voice.sequence);
        assert!(voice.stream.is_none());
        assert!(voice.voice.grid.is_some());
        assert!(status.error().is_none());
        drop(decks.command(Command::AuditionStop, [0, 0]));
        drop(decks.command(Command::AuditionUpgrade(7, track(Some(120.), 0)), [0, 0]));
        assert!(decks.audition.is_none());
    }
    #[test]
    fn audition_stream_underflow_holds_position_instead_of_ending_or_skipping() {
        let stream = crate::audition_stream::Stream::fixture(&[[0.2; 2]]);
        let mut voice = Audition::streaming(stream, 7);
        voice.next().unwrap();
        voice.seek(0); // Discards the old epoch, waiting for the new seek buffer.
        for _ in 0..1024 {
            assert_eq!(voice.next().unwrap(), [0.; 2]);
        }
        assert!(voice.playing);
        assert_eq!(voice.position, 0);
    }
    fn track(bpm: Option<f64>, index: u64) -> Box<Audition> {
        let samples: Vec<f32> = (0..48000 * 8)
            .map(|i| (i as f32 * 440. * std::f32::consts::TAU / 48000.).sin() * 0.2)
            .collect();
        let mut voice = Box::new(Audition::new(
            Arc::new(Source {
                progressive: None,
                bass_profile: Default::default(),
                left: samples.clone(),
                right: samples,
            }),
            7,
        ));
        voice.index = index;
        voice.set_grid(bpm.map(|bpm| Grid {
            bpm,
            downbeat_seconds: 0.1,
            reviewed: false,
        }));
        voice
    }
    fn sequence(bars: u8, first: Option<f64>, second: Option<f64>) -> Decks {
        let mut decks = Decks::new();
        drop(decks.command(Command::AuditionInstall(track(first, 0)), [0, 0]));
        drop(decks.command(Command::AuditionSequence(7, true, bars), [0, 0]));
        drop(decks.command(Command::AuditionQueue(7, 0, track(second, 1)), [0, 0]));
        decks
    }
    #[test]
    fn play_all_smart_uses_a_drop_and_replans_to_midpoint_when_mode_changes() {
        let samples: Vec<f32> = (0..48000 * 20)
            .map(|i| {
                let t = i as f64 / 48000.;
                ((if t < 6. { 0.002 } else { 0.25 }) * (std::f64::consts::TAU * 80. * t).sin())
                    as f32
            })
            .collect();
        let bass_profile = crate::smart::BassProfile::analyze(&samples, &samples, || true).unwrap();
        let source = Arc::new(Source {
            left: samples.clone(),
            right: samples,
            progressive: None,
            bass_profile,
        });
        let mut a = Audition::new(source.clone(), 7);
        let mut b = Audition::new(source, 8);
        let grid = Grid {
            bpm: 120.,
            downbeat_seconds: 0.,
            reviewed: true,
        };
        a.set_grid(Some(grid));
        b.set_grid(Some(grid));
        let mut decks = Decks::new();
        decks.command(Command::AutoStyle(2), [0, 0]);
        drop(decks.command(Command::AuditionInstall(Box::new(a)), [0, 0]));
        decks.command(Command::AuditionSequence(7, true, 8), [0, 0]);
        drop(decks.command(Command::AuditionQueue(7, 0, Box::new(b)), [0, 0]));
        assert_eq!(decks.audition.as_ref().unwrap().swap_beat, 12.);
        decks.command(Command::AutoStyle(1), [0, 0]);
        assert_eq!(decks.audition.as_ref().unwrap().swap_beat, 16.);
    }
    #[test]
    fn play_all_bass_swap_changes_eq_at_midpoint_and_resets_on_disable() {
        let mut decks = sequence(1, Some(120.), Some(140.));
        decks.command(Command::AutoStyle(1), [0, 0]);
        assert!(decks.audition.as_ref().unwrap().bass_swap);
        let mut saw_first_half = false;
        let mut saw_swap = false;
        for _ in 0..48000 * 8 {
            decks.next().unwrap();
            let voice = decks.audition.as_ref().unwrap();
            if voice.mixed_beats > 0.5 && voice.mixed_beats < 1. {
                saw_first_half = true;
                assert!(voice.voice.mixer.settings.eq[2] > 0.25);
                assert!(voice.voice.mixer.settings.eq[2] < 0.5);
                assert_eq!(
                    voice.queued.as_ref().unwrap().voice.mixer.settings.eq[2],
                    0.5
                );
                assert_eq!(voice.voice.mixer.settings.eq[0], 0.5);
                assert_eq!(
                    voice.queued.as_ref().unwrap().voice.mixer.settings.eq[0],
                    0.
                );
            }
            if voice.mixed_beats > 2.1 {
                saw_swap = true;
                assert_eq!(voice.voice.mixer.settings.eq[2], 0.);
                assert_eq!(voice.voice.mixer.settings.eq[0], 0.);
                assert_eq!(
                    voice.queued.as_ref().unwrap().voice.mixer.settings.eq[0],
                    0.5
                );
                break;
            }
        }
        assert!(saw_first_half && saw_swap);
        decks.command(Command::AuditionSequence(7, false, 0), [0, 0]);
        assert_eq!(
            decks.audition.as_ref().unwrap().voice.mixer.settings.eq[0],
            0.5
        );
        assert_eq!(
            decks.audition.as_ref().unwrap().voice.mixer.settings.eq[2],
            0.5
        );
    }
    #[test]
    fn play_all_without_overlap_hands_off_at_eof_and_stops_at_the_last_track() {
        let mut decks = sequence(0, Some(120.), Some(130.));
        for _ in 0..48000 * 8 {
            decks.next().unwrap();
        }
        assert_eq!(decks.audition.as_ref().unwrap().index, 0);
        let next = decks.next().unwrap();
        assert_eq!(next.audition_index, 1);
        assert_eq!(next.audition_position, 1);
        for _ in 1..48000 * 8 {
            decks.next().unwrap();
        }
        assert!(!decks.next().unwrap().audition_playing);
    }
    #[test]
    fn play_all_overlap_shares_a_ramping_bpm_and_preserves_grid_phase() {
        for target in [100., 140.] {
            let mut decks = sequence(1, Some(120.), Some(target));
            let mut saw_midpoint = false;
            for _ in 0..48000 * 10 {
                let frame = decks.next().unwrap();
                assert!(frame
                    .audition_samples
                    .iter()
                    .all(|sample| sample.is_finite()));
                let current = decks.audition.as_ref().unwrap();
                if current.index == 1 {
                    assert_eq!(current.voice.target_bpm, target);
                    assert!(current.position > 48000);
                    assert!(saw_midpoint);
                    break;
                }
                if current.mixed_beats > 1. && current.mixed_beats < 3. {
                    let incoming = current.queued.as_ref().unwrap();
                    assert_eq!(current.voice.target_bpm, incoming.voice.target_bpm);
                    let low = target.min(120.);
                    let high = target.max(120.);
                    assert!((low..high).contains(&current.voice.target_bpm));
                    let a = current
                        .voice
                        .grid
                        .unwrap()
                        .beat(current.position as f64 / 48000.);
                    let b = incoming
                        .voice
                        .grid
                        .unwrap()
                        .beat(incoming.position as f64 / 48000.);
                    let phase_error = (a - b + 2.).rem_euclid(4.) - 2.;
                    assert!(phase_error.abs() < 0.002, "phase error {phase_error}");
                    saw_midpoint = true;
                }
            }
            assert_eq!(decks.audition.as_ref().unwrap().index, 1);
        }
    }
    #[test]
    fn unusable_grids_fall_back_to_consecutive_playback() {
        // Large valid tempo ratios are supported; only invalid grids/targets
        // should force consecutive playback.
        for (a, b) in [
            (None, Some(120.)),
            (Some(120.), None),
            (Some(60.), Some(601.)),
        ] {
            let decks = sequence(1, a, b);
            assert_eq!(decks.audition.as_ref().unwrap().overlap_start, usize::MAX);
        }
    }
    #[test]
    fn play_all_pause_seek_disable_and_stale_queue_are_safe() {
        let mut decks = sequence(1, Some(120.), Some(130.));
        decks.command(Command::AuditionControl(7, None), [0, 0]);
        for _ in 0..1000 {
            assert_eq!(decks.next().unwrap().audition_position, 0);
        }
        decks.command(Command::AuditionControl(7, Some(48000)), [0, 0]);
        assert!(!decks.next().unwrap().audition_playing);
        decks.command(Command::AuditionControl(7, None), [0, 0]);
        assert_eq!(decks.next().unwrap().audition_position, 48001);
        assert!(decks
            .command(Command::AuditionQueue(6, 0, track(None, 1)), [0, 0])
            .is_some());
        drop(decks.command(Command::AuditionSequence(7, false, 0), [0, 0]));
        assert!(decks.audition.as_ref().unwrap().queued.is_none());
        for _ in 0..48000 * 8 {
            decks.next().unwrap();
        }
        assert_eq!(decks.audition.as_ref().unwrap().index, 0);
        assert!(!decks.next().unwrap().audition_playing);
    }
}
