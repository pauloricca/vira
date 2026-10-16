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

pub struct Voice {
    dsp: Dsp,
    pub mixer: crate::mixer::MixerDsp,
    scrub: Option<(f64, f64, usize)>,
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
    output: u64,
    transition: usize,
    transition_from: [f32; 2],
    last_sample: [f32; 2],
    pre_fader: [f32; 2],
    pub source: Arc<Source>,
    start: usize,
    input: usize,
    pub position: usize,
    pub playing: bool,
    pub cue_position: usize,
    pub cue_preview: bool,
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
        let pad = dsp.padding();
        let skip = dsp.delay();
        Self {
            dsp,
            mixer: crate::mixer::MixerDsp::default(),
            scrub: None,
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
            transition: 0,
            transition_from: [0.; 2],
            last_sample: [0.; 2],
            pre_fader: [0.; 2],
            source,
            start: 0,
            input: 0,
            position: 0,
            playing: false,
            cue_position: 0,
            cue_preview: false,
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
            pad,
            skip,
            tail: 0,
            left: [0.; CHUNK],
            right: [0.; CHUNK],
            read: 0,
            available: 0,
        }
    }
    pub fn set_start(&mut self, seconds: f64) {
        self.start = (seconds * 48000.).round() as usize;
        self.start = self.start.min(self.source.len().saturating_sub(1));
        self.cue_position = self.start;
        self.seek(self.start);
    }
    pub fn seek(&mut self, position: usize) {
        // Retain the accepted reset path; no replacement-stretcher shortcut.
        self.scrub = None;
        self.cue_preview = false;
        self.dsp.reset();
        self.mixer.reset();
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
        self.transition = 240;
        self.transition_from = self.last_sample;
        self.pad = self.dsp.padding();
        self.skip = self.dsp.delay();
        self.tail = 0;
        self.read = 0;
        self.available = 0;
        if self.position == self.source.len() {
            self.playing = false;
        }
    }
    pub fn seconds(&self) -> f64 {
        self.clock
            .at(self.output)
            .clamp(self.start as f64, self.source.len() as f64)
            / 48000.
    }
    fn loop_point(&self, snap: bool) -> usize {
        let seconds = self.seconds();
        let seconds = if snap {
            self.grid
                .map_or(seconds, |grid| grid.seconds(grid.beat(seconds).round()))
        } else {
            seconds
        };
        ((seconds * 48000.).round().max(0.) as usize).max(self.start)
    }
    pub fn pitch(&mut self, semitones: f64) -> Result<()> {
        if !semitones.is_finite() || !(-6.0..=6.0).contains(&semitones) || semitones.fract() != 0. {
            bail!("Pitch must be a whole semitone between -6 and 6");
        }
        if self.pitch_semitones == semitones {
            return Ok(());
        }
        let position = self.clock.at(self.output);
        let slip = self.slip_position;
        let launch = self.launch_beat;
        let epoch = self.position_epoch;
        let preview = self.cue_preview;
        self.pitch_semitones = semitones;
        self.dsp.ratios(self.clock.speed, semitones);
        self.seek(position.round() as usize);
        self.clock.source = position;
        self.slip_position = slip;
        self.launch_beat = launch;
        self.position_epoch = epoch;
        self.cue_preview = preview;
        Ok(())
    }
    pub fn tempo(&mut self, target: f64) -> Result<()> {
        let speed = self
            .grid
            .ok_or_else(|| anyhow::anyhow!("Apply a source grid first"))?
            .speed(target)?;
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
    fn set_bass(&mut self, value: f32) {
        if self.mixer.settings.eq[0] != value {
            let mut settings = self.mixer.settings;
            settings.eq[0] = value;
            self.mixer.set(settings);
        }
    }
    fn continuous_tempo(&mut self, bpm: f64) {
        if self.target_bpm == bpm {
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
        if self.scrub.is_some() {
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
                let out_phase = grid.beat(end as f64 / 48000.) + offset;
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
                let position = end as f64 + (now - release).max(0.) * 60. / grid.bpm * 48000.;
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
        if let Some((from, target, remaining)) = self.scrub {
            if remaining == 0 || (target - from).abs() < 0.001 {
                return Ok([0.; 2]);
            }
            // Traverse only the pointer's displacement, including backwards.
            // Ease each bounded segment, then stay silent at its destination.
            let progress = (1921 - remaining) as f64 / 1920.;
            let position = from + (target - from) * progress * progress * (3. - 2. * progress);
            let index = (position.floor() as usize).min(self.source.len() - 1);
            let next = (index + 1).min(self.source.len() - 1);
            let fraction = (position - position.floor()) as f32;
            let envelope = ((1920 - remaining).min(remaining) as f32 / 96.).min(1.);
            let sample = [&self.source.left, &self.source.right].map(|channel| {
                (channel[index] + (channel[next] - channel[index]) * fraction) * envelope
            });
            self.position = position.round() as usize;
            self.clock.source = position;
            self.clock.output = self.output;
            self.scrub = Some((from, target, remaining - 1));
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
        if let (Some(start), Some(end)) = (self.loop_start, self.loop_end) {
            if self.clock.at(self.output) >= end as f64 {
                let slip_position = self.slip_position;
                self.seek(start);
                self.slip_position = slip_position;
            }
        }
        for _ in 0..4096 {
            if self.read < self.available {
                let mut value = [self.left[self.read], self.right[self.read]];
                self.read += 1;
                if self.skip > 0 {
                    self.skip -= 1;
                    continue;
                }
                if !ROUTED {
                    value = self.mixer.process(value);
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
                    let mix = 1. - self.transition as f32 / 240.;
                    for (sample, previous) in value.iter_mut().zip(self.transition_from) {
                        *sample = previous * (1. - mix) + *sample * mix;
                    }
                    self.transition -= 1;
                }
                self.last_sample = value;
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
            if self.dsp.available() > 0 {
                self.available = self.dsp.retrieve(&mut self.left, &mut self.right);
                self.read = 0;
            } else if self.pad > 0 {
                let n = self.pad.min(CHUNK);
                let zero = [0.; CHUNK];
                self.dsp.process(&zero[..n], &zero[..n], false);
                self.pad -= n;
            } else if self.input < self.source.len() {
                let n = CHUNK.min(self.source.len() - self.input);
                self.dsp.process(
                    &self.source.left[self.input..self.input + n],
                    &self.source.right[self.input..self.input + n],
                    false,
                );
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
        let Some(next) = &mut self.queued else { return };
        next.position = 0;
        next.stretched = false;
        next.voice.set_bass(0.5);
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
        let start = self.source.len() as f64 - beats * 60. / a.bpm * 48000.;
        if start <= self.position as f64 {
            return;
        }
        // Match the incoming grid phase at the exact source-time overlap boundary.
        let phase = a.beat(start / 48000.).rem_euclid(4.);
        let incoming = b.seconds(phase);
        if incoming + beats * 60. / b.bpm >= next.source.len() as f64 / 48000. {
            return;
        }
        next.position = (incoming * 48000.).round() as usize;
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
                .bass_profile
                .drop_beat(b, incoming, beats)
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
        self.level = (self.level + 1. / 240.).min(1.);
        let sample = if self.stretched {
            self.voice.playing = true;
            let sample = self.voice.next()?;
            self.position = self.voice.position;
            sample
        } else {
            let sample = [
                self.source.left[self.position],
                self.source.right[self.position],
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
            let a = self.sample()?;
            let b = self.queued.as_mut().unwrap().sample()?;
            self.mixed_beats += bpm / (60. * 48000.);
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

pub enum Retired {
    Audition(Box<Audition>),
    Voice(Box<Voice>),
    Routing(Box<crate::routing::Plan>),
}

pub enum Command {
    AuditionInstall(Box<Audition>),
    AuditionStop,
    AuditionQueue(u64, u64, Box<Audition>),
    AuditionSequence(u64, bool, u8),
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
    Stop(usize, u64),
    LoopIn(usize, u64, bool),
    LoopOut(usize, u64, bool),
    LoopLength(usize, u64, f64, bool),
    Slip(usize, u64, bool),
    Seek(usize, u64, usize),
    ScrubStart(usize, u64, usize),
    Scrub(usize, u64, usize, bool),
    Gain(usize, u64, f32),
    Mixer(usize, u64, u8, f32),
    Remove(usize, u64),
    Grid(usize, u64, Grid),
    Tempo(usize, [u64; 2], f64),
    Pitch(usize, u64, f64),
    Click(usize, u64, f32),
    ClickPanel(usize, u64, bool),
    AutoTransition(usize, [u64; 2], bool),
    AutoBars(u8),
    AutoTempo(bool),
    AutoStyle(u8),
    MasterTempo(f64),
    Drift(usize, [u64; 2]),
    DriftRate(f64),
    SyncQuantum(u8),
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
    pub drift_rate: f64,
    pub sync_quantum: u8,
    pub drift_target: Option<usize>,
    pub output_frame: u64,
    pub global_beat: f64,
}

#[derive(Clone, Copy)]
struct AutoTransition {
    from: usize,
    generations: [u64; 2],
    end: bool,
    start_seconds: f64,
    incoming_start: usize,
    beats: f64,
    mixed_beats: f64,
    started: bool,
    initial_bpm: f64,
    target_bpm: f64,
    saved_crossfader: f32,
    starting_gains: [f32; 2],
    starting_bass: [f32; 2],
    bass_swap: bool,
    swap_beat: f64,
    style: u8,
}

pub struct Decks {
    auto: Option<AutoTransition>,
    auto_bars: u8,
    auto_tempo: bool,
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
    pub voices: [Option<Box<Voice>>; 2],
    pub master_bpm: f64,
    pub drift_rate: f64,
    pub sync_quantum: u8,
    drift_target: Option<usize>,
    global_beat: f64,
    output_frame: u64,
}
impl Decks {
    pub fn new() -> Self {
        Self {
            auto: None,
            auto_bars: 8,
            auto_tempo: true,
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
            voices: [None, None],
            master_bpm: 120.,
            drift_rate: 1.,
            sync_quantum: 4,
            drift_target: None,
            global_beat: 0.,
            output_frame: 0,
        }
    }
    fn cancel_auto(&mut self) {
        if let Some(auto) = self.auto.take() {
            if self.matches(auto.generations) {
                // Arming lowers the stopped incoming fader. Restore it even if
                // cancelled before the musical launch boundary.
                let incoming = 1 - auto.from;
                self.voices[incoming].as_mut().unwrap().gain = auto.starting_gains[incoming];
                if auto.started {
                    self.voices[incoming].as_mut().unwrap().playing = false;
                    self.voices[auto.from].as_mut().unwrap().gain = auto.starting_gains[auto.from];
                    if auto.bass_swap {
                        for deck in 0..2 {
                            self.voices[deck]
                                .as_mut()
                                .unwrap()
                                .set_bass(auto.starting_bass[deck]);
                        }
                    }
                }
            }
            self.crossfader = auto.saved_crossfader;
            self.crossfader_target = crossfader_gains(self.crossfader, self.crossfader_enabled);
            self.crossfader_ramp = 240;
        }
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
        let target = if self.auto_tempo {
            bg.bpm
        } else {
            self.master_bpm
        };
        for grid in [ag, bg] {
            grid.speed(self.master_bpm)?;
            grid.speed(target)?;
        }
        // Cue is an explicit, sample-accurate launch point. Do not replace it
        // with a nearby beat-phase position when starting an automatic transition.
        let incoming_start = b.cue_position.max(b.start);
        let incoming = incoming_start as f64 / 48000.;
        let incoming_length = b.source.len() as f64 / 48000.;
        anyhow::ensure!(
            incoming_start < b.source.len(),
            "Incoming cue is at the end of the track"
        );
        let length = a.source.len() as f64 / 48000.;
        let position = a.seconds();
        let origin = a.start as f64 / 48000.;
        // Try the configured overlap first, then each shorter supported length.
        // Each NOW candidate keeps its own phrase boundaries anchored to track start.
        let (start, beats) = [32_u8, 16, 8, 4, 2, 1, 0]
            .into_iter()
            .filter(|bars| *bars <= self.auto_bars)
            .find_map(|bars| {
                let beats = f64::from(bars) * 4.;
                let duration = beats * 60. / ag.bpm;
                let start = if end || bars == 0 {
                    length - duration
                } else {
                    origin + (((position - origin) / duration).floor() + 1.) * duration
                };
                (start >= position
                    && start + duration <= length + 1e-6
                    && incoming + beats * 60. / bg.bpm < incoming_length)
                    .then_some((start, beats))
            })
            .ok_or_else(|| anyhow::anyhow!("No playable transition remains"))?;
        let auto = AutoTransition {
            from,
            generations,
            end,
            start_seconds: start,
            incoming_start,
            beats,
            mixed_beats: 0.,
            started: false,
            initial_bpm: self.master_bpm,
            target_bpm: target,
            saved_crossfader: self.crossfader,
            starting_gains: std::array::from_fn(|d| self.voices[d].as_ref().unwrap().gain),
            starting_bass: std::array::from_fn(|d| {
                self.voices[d].as_ref().unwrap().mixer.settings.eq[0]
            }),
            bass_swap: self.auto_bass_swap,
            style: if self.auto_smart {
                2
            } else if self.auto_bass_swap {
                1
            } else {
                0
            },
            swap_beat: if self.auto_smart {
                b.source
                    .bass_profile
                    .drop_beat(bg, incoming, beats)
                    .unwrap_or(beats / 2.)
            } else {
                beats / 2.
            },
        };
        self.drift_target = None;
        self.global_beat = ag.beat(a.seconds());
        for voice in self.voices.iter_mut().flatten() {
            if (voice.target_bpm - self.master_bpm).abs() > 1e-9 {
                voice.tempo(self.master_bpm)?;
            }
            voice.synced = true;
            voice.launch_beat = None;
        }
        // Silence the incoming channel before playback can begin, in both modes.
        // Its old fader position is retained only for cancellation.
        self.voices[1 - from].as_mut().unwrap().gain = 0.;
        self.auto = Some(auto);
        Ok(())
    }
    fn advance_auto(&mut self) {
        let Some(mut auto) = self.auto else { return };
        if !self.matches(auto.generations)
            || (!auto.started
                && !self.voices[auto.from].as_ref().is_some_and(|v| {
                    v.playing || (auto.beats == 0. && v.position >= v.source.len())
                }))
            || (auto.started
                && !self.voices[1 - auto.from]
                    .as_ref()
                    .is_some_and(|v| v.playing))
        {
            self.cancel_auto();
            return;
        }
        let a = self.voices[auto.from].as_ref().unwrap();
        let outgoing_ended = !a.playing;
        // A loop may repeat source positions, but must not repeat or postpone AUTO's
        // timeline. Lock the launch boundary to the continuing master beat clock.
        let launch_beat = a.grid.unwrap().beat(auto.start_seconds);
        if !auto.started && self.global_beat + self.master_bpm / (60. * 48000.) >= launch_beat {
            // Capture the outgoing level at the musical boundary, including changes
            // made while waiting. Keep the incoming deck's pre-arm level for cancel.
            auto.starting_gains[auto.from] = a.gain;
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
        let progress = if auto.beats == 0. || outgoing_ended {
            1.
        } else {
            (auto.mixed_beats / auto.beats).min(1.)
        };
        self.master_bpm = auto.initial_bpm + (auto.target_bpm - auto.initial_bpm) * progress;
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
        if auto.bass_swap && swap_due(auto.mixed_beats, auto.swap_beat, self.master_bpm) {
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
        auto.mixed_beats += self.master_bpm / (60. * 48000.);
        if progress >= 1. {
            let voice = self.voices[auto.from].as_mut().unwrap();
            voice.playing = false;
            if auto.bass_swap {
                voice.set_bass(auto.starting_bass[auto.from]);
            }
            self.auto = None;
            self.crossfader_target = crossfader_gains(self.crossfader, self.crossfader_enabled);
            self.crossfader_ramp = 240;
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
            let anchor = if d == auto.from {
                auto.start_seconds
            } else {
                auto.incoming_start as f64 / 48000.
            };
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
                        let start = start as f64 / 48000.;
                        let end = end as f64 / 48000.;
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
        grid.speed(self.master_bpm)?;
        let position = if voice.playing {
            Some(grid.align_quantum_from(
                voice.seconds(),
                self.global_beat,
                voice.start as f64 / 48000.,
                voice.source.len() as f64 / 48000.,
                f64::from(self.sync_quantum),
            )?)
        } else {
            None
        };
        let voice = self.voices[deck].as_mut().unwrap();
        if (voice.target_bpm - self.master_bpm).abs() > 1e-9 {
            voice.tempo(self.master_bpm)?;
        }
        if let Some(position) = position {
            voice.reposition_seconds = position - voice.seconds();
            voice.seek((position * 48000.).round() as usize);
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
                voice.start as f64 / 48000.,
                voice.source.len() as f64 / 48000.,
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
        if (voice.target_bpm - self.master_bpm).abs() > 1e-9 {
            voice.tempo(self.master_bpm)?;
        }
        if let Some(position) = immediate_position {
            voice.reposition_seconds = position - voice.seconds();
            voice.seek((position * 48000.).round() as usize);
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
        let cancels_auto = match &command {
            Command::Install {
                deck, generation, ..
            } => *generation == latest[*deck],
            Command::Remove(d, through) => self.voices[*d]
                .as_ref()
                .is_some_and(|v| v.generation <= *through),
            Command::Play(d, g)
            | Command::Pause(d, g)
            | Command::PlayPause(d, g)
            | Command::Stop(d, g)
            | Command::CuePress(d, g)
            | Command::CueRelease(d, g)
            | Command::Seek(d, g, _)
            | Command::ScrubStart(d, g, _)
            | Command::Scrub(d, g, _, _)
            | Command::Grid(d, g, _) => {
                self.voices[*d].as_ref().is_some_and(|v| v.generation == *g)
            }
            Command::Gain(d, g, _) => {
                self.auto.is_some_and(|a| a.started || *d != a.from)
                    && self.voices[*d].as_ref().is_some_and(|v| v.generation == *g)
            }
            Command::Mixer(d, g, 1, _) => {
                self.auto.is_some_and(|a| a.started && a.bass_swap)
                    && self.voices[*d].as_ref().is_some_and(|v| v.generation == *g)
            }
            Command::Tempo(_, generations, _)
            | Command::Sync(_, generations, _)
            | Command::Drift(_, generations) => self.matches(*generations),
            Command::MasterTempo(_) | Command::Crossfader(_) | Command::CrossfaderEnabled(_) => {
                true
            }
            _ => false,
        };
        if cancels_auto {
            self.cancel_auto();
        }
        match command {
            Command::AutoBars(bars) => {
                if [0, 1, 2, 4, 8, 16, 32].contains(&bars) {
                    self.auto_bars = bars;
                }
            }
            Command::AutoTempo(enabled) => self.auto_tempo = enabled,
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
            Command::AuditionInstall(mut voice) => {
                voice.bass_swap = self.auto_bass_swap;
                voice.smart = self.auto_smart;
                return self.audition.replace(voice).map(Retired::Audition);
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
                            voice.position = position.min(voice.source.len());
                            voice.level = 0.;
                            voice.voice.seek(voice.position);
                            voice.mixed_beats = 0.;
                            if let Some(grid) = voice.voice.grid {
                                voice.set_tempo(grid.bpm);
                            }
                            voice.plan_overlap();
                        } else {
                            if !voice.playing && voice.position >= voice.source.len() {
                                voice.position = 0;
                                voice.voice.seek(0);
                                voice.mixed_beats = 0.;
                                if let Some(grid) = voice.voice.grid {
                                    voice.set_tempo(grid.bpm);
                                }
                                voice.plan_overlap();
                            }
                            voice.playing = !voice.playing;
                        }
                    }
                }
            }
            Command::Routing(mut plan) => {
                plan.inherit(&mut self.routing);
                self.route_from = self.route_last;
                self.route_transition = 240;
                return Some(Retired::Routing(std::mem::replace(&mut self.routing, plan)));
            }
            Command::HeadphoneCue(deck, enabled) => self.headphone_cue[deck] = enabled,
            Command::Crossfader(position) => {
                self.crossfader = position;
                self.crossfader_target = crossfader_gains(position, self.crossfader_enabled);
                self.crossfader_ramp = 240; // 5 ms at 48 kHz; avoid gain discontinuities.
            }
            Command::CrossfaderEnabled(enabled) => {
                self.crossfader_enabled = enabled;
                self.crossfader_target = crossfader_gains(self.crossfader, enabled);
                self.crossfader_ramp = 240;
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
                    if !reset_mixer {
                        voice.gain = old.gain;
                        voice.mixer.set(old.mixer.settings);
                    }
                    if preserve_lock && old.synced {
                        if voice
                            .grid
                            .is_some_and(|grid| grid.speed(self.master_bpm).is_ok())
                        {
                            if voice.tempo(self.master_bpm).is_ok() {
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
            Command::CuePress(d, g) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && !v.cue_preview {
                        if v.playing {
                            v.playing = false;
                            v.seek(v.cue_position);
                        } else {
                            // Cue is sample-accurate and independent of the beat grid.
                            let position = (v.seconds() * 48000.).round() as usize;
                            if position.abs_diff(v.cue_position) > 1 {
                                v.cue_position = position.min(v.source.len().saturating_sub(1));
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
                    if v.generation == g && v.cue_preview {
                        v.playing = false;
                        v.seek(v.cue_position);
                    }
                }
            }
            Command::Play(d, g) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && v.cue_preview {
                        // Latch the audition without restarting or scheduling a launch.
                        v.cue_preview = false;
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
                        v.playing = false;
                        v.cue_preview = false;
                        v.launch_beat = None;
                    }
                }
            }
            Command::Stop(d, g) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        v.stop();
                    }
                }
            }
            Command::Pitch(d, g, semitones) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        let _ = v.pitch(semitones);
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
                            let now = (v.seconds() * 48000.).round() as usize;
                            let (start, end) = if align {
                                let first_beat = (grid.beat(v.seconds()) / beats).floor() * beats;
                                // Track time zero is the earliest loop start. If the
                                // containing grid segment begins outside the source,
                                // move the whole loop forward, preserving its length.
                                let first_seconds =
                                    grid.seconds(first_beat).max(v.start as f64 / 48000.);
                                let first = (first_seconds * 48000.).round() as usize;
                                let last = ((first_seconds + beats * 60. / grid.bpm) * 48000.)
                                    .round() as usize;
                                (first, last.min(v.source.len()))
                            } else {
                                let first = v.loop_start.unwrap_or(now);
                                let frames =
                                    (beats * 60. / grid.bpm * 48000.).round().max(1.) as usize;
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
            Command::Seek(d, g, p) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        let looping = v.loop_end.is_some();
                        if v.playing && v.launch_beat.is_none() {
                            // Resolve against the deck's current phase at the render boundary.
                            let target = if let Some(grid) = v.grid {
                                match grid.align_quantum_from(
                                    p as f64 / 48000.,
                                    if looping && v.synced {
                                        self.global_beat
                                    } else {
                                        grid.beat(v.seconds())
                                    },
                                    v.start as f64 / 48000.,
                                    v.source.len() as f64 / 48000.,
                                    f64::from(self.sync_quantum),
                                ) {
                                    Ok(seconds) => (seconds * 48000.).round() as usize,
                                    Err(_) => return None,
                                }
                            } else {
                                p
                            };
                            if looping {
                                v.clear_loop();
                            }
                            v.seek(target);
                        } else {
                            if looping {
                                v.clear_loop();
                            }
                            v.seek(p);
                        }
                    }
                }
            }
            Command::ScrubStart(d, g, p) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && !v.playing {
                        v.seek(p);
                        v.scrub = Some((v.position as f64, v.position as f64, 0));
                    }
                }
            }
            Command::Scrub(d, g, p, moving) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && !v.playing && v.scrub.is_some() {
                        if moving {
                            let from = v.seconds() * 48000.;
                            v.scrub = Some((from, p.clamp(v.start, v.source.len()) as f64, 1920));
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
                    }
                }
            }
            Command::Grid(d, g, grid) => {
                if self.voices[d].as_ref().is_some_and(|v| {
                    v.generation == g && grid.validate(v.source.len() as f64 / 48000.).is_ok()
                }) {
                    self.clear_sync(d);
                    self.voices[d].as_mut().unwrap().apply_grid(grid);
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
            Command::Tempo(d, generations, target) => {
                if self.matches(generations) {
                    let valid = self.voices[d]
                        .as_ref()
                        .and_then(|v| v.grid)
                        .is_some_and(|g| g.speed(target).is_ok());
                    if valid {
                        self.voices[d].as_mut().unwrap().synced = false;
                        self.voices[d].as_mut().unwrap().launch_beat = None;
                        let _ = self.voices[d].as_mut().unwrap().tempo(target);
                    } else if let Some(v) = &mut self.voices[d] {
                        v.timing_error = 2;
                    }
                }
            }
            Command::MasterTempo(bpm) => {
                if bpm.is_finite() && (15.0..=600.0).contains(&bpm) {
                    self.master_bpm = bpm;
                    self.drift_target = None;
                }
            }
            Command::Drift(d, generations) => {
                if self.matches(generations)
                    && self.voices[d].as_ref().is_some_and(|v| v.grid.is_some())
                {
                    self.drift_target = Some(d);
                }
            }
            Command::DriftRate(rate) => {
                if rate.is_finite() && (0.01..=100.).contains(&rate) {
                    self.drift_rate = rate;
                }
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
                        self.voices[d].as_mut().unwrap().synced = true;
                    } else if let Some(v) = &mut self.voices[d] {
                        v.timing_error = 1;
                    }
                }
            }
        }
        None
    }
    pub fn next(&mut self) -> Result<Frame> {
        self.next_inner(false)
    }
    fn next_inner(&mut self, deferred: bool) -> Result<Frame> {
        self.advance_auto();
        let mut frame = Frame {
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
        if let Some(d) = self.drift_target {
            if let Some(v) = &self.voices[d] {
                let target = v.grid.unwrap().bpm;
                let step = self.drift_rate / 48000.;
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
                } else {
                    self.master_bpm = next;
                    if next == target {
                        self.drift_target = None;
                    }
                }
            } else {
                self.drift_target = None;
            }
        }
        if self
            .voices
            .iter()
            .flatten()
            .any(|v| v.playing && v.launch_beat.is_none())
        {
            self.global_beat += self.master_bpm / (60. * 48000.);
        }
        frame.global_beat = self.global_beat;
        frame.master_bpm = self.master_bpm;
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
            self.cue_current[d] += (target - self.cue_current[d]).clamp(-1. / 240., 1. / 240.);
            if let Some(voice) = voice {
                if voice
                    .launch_beat
                    .is_some_and(|beat| self.global_beat >= beat)
                {
                    voice.launch_beat = None;
                }
                let update_delta = if self.drift_target.is_some() {
                    0.05
                } else {
                    0.000001
                };
                if voice.synced && (voice.target_bpm - self.master_bpm).abs() > update_delta {
                    if voice.grid.is_some_and(|g| g.speed(self.master_bpm).is_ok()) {
                        let _ = voice.tempo(self.master_bpm);
                    } else {
                        voice.synced = false;
                        voice.timing_error = 2;
                    }
                }
                voice.finish_loop_release(self.global_beat, self.master_bpm / (60. * 48000.));
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
            let blend = 1. - self.route_transition as f32 / 240.;
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
        // A stopped deck produces no headphone audio, even when selected.
        for d in 0..2 {
            decks.command(Command::HeadphoneCue(d, true), [1, 1]);
            decks.command(Command::Pause(d, 1), [1, 1]);
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
        decks.command(Command::AutoTempo(change_tempo), [1, 1]);
        decks.command(Command::Play(from, 1), [1, 1]);
        decks
    }
    #[test]
    fn thirty_two_bar_overlap_is_supported_by_decks_and_library_play_all() {
        let source = Arc::new(Source {
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
    fn cancelling_bass_swap_restores_bass_and_manual_low_eq_takes_over() {
        for manual in [false, true] {
            let mut decks = auto_decks(0, 1, false);
            decks.command(Command::Mixer(0, 1, 1, 0.7), [1, 1]);
            decks.command(Command::Mixer(1, 1, 1, 0.8), [1, 1]);
            decks.command(Command::AutoStyle(1), [1, 1]);
            decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
            for _ in 0..48000 * 3 + 1000 {
                decks.next().unwrap();
            }
            assert_eq!(decks.voices[0].as_ref().unwrap().mixer.settings.eq[0], 0.);
            if manual {
                decks.command(Command::Mixer(0, 1, 1, 0.4), [1, 1]);
            } else {
                decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
            }
            assert!(decks.auto.is_none());
            assert_eq!(
                decks.voices[0].as_ref().unwrap().mixer.settings.eq[0],
                if manual { 0.4 } else { 0.7 }
            );
            assert_eq!(decks.voices[1].as_ref().unwrap().mixer.settings.eq[0], 0.8);
            assert!(!decks.voices[1].as_ref().unwrap().playing);
        }
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
    fn arming_either_mode_lowers_incoming_fader_and_cancelling_restores_it() {
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
                assert_eq!(decks.voices[1 - from].as_ref().unwrap().gain, 1.);
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
    fn transition_guides_report_cues_fader_points_and_bass_swap_and_clear_on_cancel() {
        for style in [0, 1, 2] {
            let mut decks = auto_decks(0, 8, false);
            decks.voices[1].as_mut().unwrap().cue_position = 7 * 48000;
            decks.command(Command::AutoStyle(style), [1, 1]);
            decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
            let frame = decks.next().unwrap();
            assert_eq!(frame.auto_style, style);
            assert!(!frame.auto_started);
            assert_eq!(frame.auto_points[0][0], 16.);
            assert_eq!(frame.auto_points[1][0], 7.);
            assert_eq!(frame.auto_points[0][4], 32.);
            assert!((frame.auto_points[1][4] - (7. + 32. * 60. / 140.)).abs() < 1e-9);
            assert_eq!(frame.auto_points[0][3], 24.);
            if style == 0 {
                assert_eq!(frame.auto_points[0][1], 19.2);
                assert_eq!(frame.auto_points[0][2], 28.8);
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
        decks.command(Command::Gain(0, 0, 0.2), [1, 1]);
        assert!(decks.auto.is_some());
        decks.command(Command::Gain(0, 1, 0.35), [1, 1]);
        assert!(decks.auto.is_none());
        assert_eq!(decks.voices[0].as_ref().unwrap().gain, 0.35);
        assert!(!decks.voices[1].as_ref().unwrap().playing);
    }
    #[test]
    fn automatic_end_and_zero_overlap_schedule_at_eof_and_cancel_when_replaced() {
        for bars in [0, 1, 8] {
            let mut decks = auto_decks(0, bars, false);
            decks.command(Command::AutoTransition(0, [1, 1], true), [1, 1]);
            assert_eq!(
                decks.auto.unwrap().start_seconds,
                40. - f64::from(bars) * 2.
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
    fn automatic_transition_cancel_during_crossfade_restores_mixer_and_stops_incoming() {
        let mut decks = auto_decks(0, 1, true);
        decks.command(Command::Crossfader(0.65), [1, 1]);
        decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
        for _ in 0..48000 * 3 {
            decks.next().unwrap();
        }
        assert!(decks.auto.unwrap().started);
        let bpm = decks.master_bpm;
        let gains = decks.auto.unwrap().starting_gains;
        decks.command(Command::AutoTransition(0, [1, 1], false), [1, 1]);
        assert!(decks.auto.is_none());
        assert!(!decks.voices[1].as_ref().unwrap().playing);
        assert_eq!(decks.crossfader, 0.65);
        for (deck, gain) in gains.into_iter().enumerate() {
            assert_eq!(decks.voices[deck].as_ref().unwrap().gain, gain);
        }
        for _ in 0..1000 {
            decks.next().unwrap();
        }
        assert_eq!(decks.master_bpm, bpm);
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
                assert!(!decks.voices[incoming].as_ref().unwrap().playing);
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
    fn scrub_follows_motion_then_is_silent_and_ignores_playing_decks() {
        let mut decks = Decks::new();
        install(&mut decks, 0, 1, source());
        decks.command(Command::ScrubStart(0, 1, 12000), [1, 1]);
        assert_eq!(decks.next().unwrap().samples, [0.; 2]);
        decks.command(Command::Scrub(0, 1, 24000, true), [1, 1]);
        let mut audible = false;
        for _ in 0..1920 {
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
        for _ in 0..1920 {
            decks.next().unwrap();
        }
        assert_eq!(decks.next().unwrap().positions[0], 6000);
        decks.command(Command::Scrub(0, 1, 6000, false), [1, 1]);
        decks.command(Command::Play(0, 1), [1, 1]);
        decks.command(Command::ScrubStart(0, 1, 30000), [1, 1]);
        assert!(decks.next().unwrap().positions[0] < 10000);
    }
    #[test]
    fn finite_play_pause_stop_seek_and_end_without_looping() {
        let mut decks = Decks::new();
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
            let source = Arc::new(Source {
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
    fn drift_is_rate_limited_and_keeps_lock_states() {
        let mut decks = decks();
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
        decks.command(Command::Sync(0, [1, 1], true), [1, 1]);
        decks.command(Command::Gain(0, 1, 0.25), [1, 1]);
        decks.command(Command::Mixer(0, 1, 0, 6.), [1, 1]);
        decks.command(Command::Mixer(0, 1, 4, -0.5), [1, 1]);
        let source = decks.voices[0].as_ref().unwrap().source.clone();
        let mut next = Voice::new(source.clone(), 2);
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
        assert_eq!(voice.gain, 0.8);
        assert_eq!(voice.mixer.settings, crate::mixer::Settings::default());

        decks.command(Command::Gain(0, 2, 0.3), [2, 1]);
        decks.command(Command::Mixer(0, 2, 4, 0.7), [2, 1]);
        let mut third = Voice::new(source, 3);
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
    fn track(bpm: Option<f64>, index: u64) -> Box<Audition> {
        let samples: Vec<f32> = (0..48000 * 8)
            .map(|i| (i as f32 * 440. * std::f32::consts::TAU / 48000.).sin() * 0.2)
            .collect();
        let mut voice = Box::new(Audition::new(
            Arc::new(Source {
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
                assert_eq!(voice.voice.mixer.settings.eq[0], 0.5);
                assert_eq!(
                    voice.queued.as_ref().unwrap().voice.mixer.settings.eq[0],
                    0.
                );
            }
            if voice.mixed_beats > 2.1 {
                saw_swap = true;
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
        for (a, b) in [
            (None, Some(120.)),
            (Some(120.), None),
            (Some(60.), Some(180.)),
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
