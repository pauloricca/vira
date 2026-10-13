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

pub struct Voice {
    dsp: Dsp,
    pub mixer: crate::mixer::MixerDsp,
    scrub: Option<(f64, f64, usize)>,
    pub grid: Option<Grid>,
    pub target_bpm: f64,
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
    input: usize,
    pub position: usize,
    pub playing: bool,
    pub cue_position: usize,
    pub cue_preview: bool,
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
            input: 0,
            position: 0,
            playing: false,
            cue_position: 0,
            cue_preview: false,
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
    pub fn seek(&mut self, position: usize) {
        // Retain the accepted reset path; no replacement-stretcher shortcut.
        self.scrub = None;
        self.cue_preview = false;
        self.dsp.reset();
        self.mixer.reset();
        self.launch_beat = None;
        self.position_epoch += 1;
        self.input = position.min(self.source.len());
        self.position = self.input;
        self.clock = Transport {
            output: self.output,
            source: self.input as f64,
            speed: self.clock.speed,
        };
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
        self.clock.at(self.output).min(self.source.len() as f64) / 48000.
    }
    pub fn tempo(&mut self, target: f64) -> Result<()> {
        let speed = self
            .grid
            .ok_or_else(|| anyhow::anyhow!("Apply a source grid first"))?
            .speed(target)?;
        let position = self.clock.at(self.output);
        self.target_bpm = target;
        self.timing_error = 0;
        self.clock = Transport {
            output: self.output,
            source: position,
            speed,
        };
        // Discard prepared DSP output at this render boundary; re-prime at the new
        // ratio so all subsequent samples and click positions use the same anchor.
        self.dsp.ratios(speed, 0.);
        let epoch = self.position_epoch;
        let launch = self.launch_beat;
        self.seek(position.round() as usize);
        self.launch_beat = launch;
        self.position_epoch = epoch; // Ratio re-prime preserves position, unlike an explicit seek.
        self.clock.source = position;
        Ok(())
    }
    pub fn apply_grid(&mut self, grid: Grid) {
        self.grid = Some(grid);
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
        self.seek(0);
    }
    pub fn next(&mut self) -> Result<[f32; 2]> {
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
            let sample = self.mixer.process(sample);
            self.last_sample = sample;
            self.pre_fader = sample;
            return Ok(sample.map(|v| v * self.gain));
        }
        if !self.playing || self.launch_beat.is_some() {
            return Ok([0.; 2]);
        }
        for _ in 0..4096 {
            if self.read < self.available {
                let mut value = [self.left[self.read], self.right[self.read]];
                self.read += 1;
                if self.skip > 0 {
                    self.skip -= 1;
                    continue;
                }
                value = self.mixer.process(value);
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
                self.position = self
                    .clock
                    .at(self.output)
                    .min(self.source.len() as f64)
                    .round() as usize;
                if self.position >= self.source.len() {
                    self.playing = false;
                }
                self.pre_fader = value.map(|v| v + click);
                // The timing reference click retains its independent volume.
                return Ok(value.map(|v| v * self.gain + click));
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

pub enum Command {
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
    Seek(usize, u64, usize),
    ScrubStart(usize, u64, usize),
    Scrub(usize, u64, usize, bool),
    Gain(usize, u64, f32),
    Mixer(usize, u64, u8, f32),
    Remove(usize, u64),
    Grid(usize, u64, Grid),
    Tempo(usize, [u64; 2], f64),
    Click(usize, u64, f32),
    ClickPanel(usize, u64, bool),
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
    pub gains: [f32; 2],
    pub mixer: [crate::mixer::Settings; 2],
    pub grids: [Option<Grid>; 2],
    pub targets: [f64; 2],
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

pub struct Decks {
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
            Some(grid.align_quantum(
                voice.seconds(),
                self.global_beat,
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
        voice.launch_beat = Some(launch_beat);
        voice.reposition_seconds = 0.;
        voice.timing_error = 0;
        Ok(())
    }
    // Retired ownership is returned to the caller to dispose on a normal thread.
    pub fn command(&mut self, command: Command, latest: [u64; 2]) -> Option<Box<Voice>> {
        match command {
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
                    return Some(voice);
                }
                if let Some(old) = &self.voices[deck] {
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
                return self.voices[deck].replace(voice);
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
            Command::Seek(d, g, p) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g {
                        if v.playing && v.launch_beat.is_none() {
                            // Resolve against the deck's current phase at the render boundary.
                            let target = if let Some(grid) = v.grid {
                                match grid.align_quantum(
                                    p as f64 / 48000.,
                                    grid.beat(v.seconds()),
                                    v.source.len() as f64 / 48000.,
                                    f64::from(self.sync_quantum),
                                ) {
                                    Ok(seconds) => (seconds * 48000.).round() as usize,
                                    Err(_) => return None,
                                }
                            } else {
                                p
                            };
                            v.seek(target);
                        } else {
                            v.seek(p);
                            v.synced = false;
                        }
                    }
                }
            }
            Command::ScrubStart(d, g, p) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && !v.playing {
                        v.seek(p);
                        v.synced = false;
                        v.scrub = Some((v.position as f64, v.position as f64, 0));
                    }
                }
            }
            Command::Scrub(d, g, p, moving) => {
                if let Some(v) = &mut self.voices[d] {
                    if v.generation == g && !v.playing && v.scrub.is_some() {
                        if moving {
                            let from = v.seconds() * 48000.;
                            v.scrub = Some((from, p.min(v.source.len()) as f64, 1920));
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
                    return self.voices[d].take();
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
        let mut frame = Frame {
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
                let sample = voice.next()?;
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
                frame.gains[d] = voice.gain;
                frame.mixer[d] = voice.mixer.settings;
                frame.grids[d] = voice.grid;
                frame.targets[d] = voice.target_bpm;
                frame.synced[d] = voice.synced;
                frame.launch_pending[d] = voice.launch_beat.is_some();
                frame.clicks[d] = voice.click_gain;
                frame.timing_errors[d] = voice.timing_error;
                frame.reposition[d] = voice.reposition_seconds;
            }
        }
        for sample in frame.samples.iter_mut().chain(frame.cue_samples.iter_mut()) {
            *sample = sample.clamp(-1., 1.);
        }
        Ok(frame)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

    fn source() -> Arc<Source> {
        let left: Vec<f32> = (0..48000)
            .map(|i| ((i as f32 * 440. * std::f32::consts::TAU) / 48000.).sin() * 0.2)
            .collect();
        Arc::new(Source {
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
