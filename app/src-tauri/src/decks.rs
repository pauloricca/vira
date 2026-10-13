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

pub struct Voice {
    dsp: Dsp,
    pub grid: Option<Grid>,
    pub target_bpm: f64,
    pub click_gain: f32,
    pub synced: bool,
    pub launch_beat: Option<f64>,
    pub reposition_seconds: f64,
    pub timing_error: u8,
    clock: Transport,
    output: u64,
    transition: usize,
    transition_from: [f32; 2],
    last_sample: [f32; 2],
    pub source: Arc<Source>,
    input: usize,
    pub position: usize,
    pub playing: bool,
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
            grid: None,
            target_bpm: 0.,
            click_gain: 0.,
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
            source,
            input: 0,
            position: 0,
            playing: false,
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
        self.dsp.reset();
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
        if !self.playing || self.launch_beat.is_some() {
            return Ok([0.; 2]);
        }
        for _ in 0..4096 {
            if self.read < self.available {
                let mut value = [
                    self.left[self.read] * self.gain,
                    self.right[self.read] * self.gain,
                ];
                self.read += 1;
                if self.skip > 0 {
                    self.skip -= 1;
                    continue;
                }
                let seconds = self.seconds();
                if let Some(grid) = self.grid.filter(|_| self.click_gain > 0.) {
                    let beat = grid.beat(seconds);
                    let fraction = beat.rem_euclid(1.);
                    let age = fraction * 60. / self.target_bpm.max(1.);
                    if age < 0.025 {
                        let downbeat = (beat.floor() as i64).rem_euclid(4) == 0;
                        let frequency = if downbeat { 1600. } else { 1000. };
                        let click = (std::f64::consts::TAU * frequency * age).sin() as f32
                            * (1. - age / 0.025) as f32
                            * self.click_gain
                            * if downbeat { 0.7 } else { 0.4 };
                        for sample in &mut value {
                            *sample += click;
                        }
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
                return Ok(value);
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
    },
    Play(usize, u64),
    Pause(usize, u64),
    Stop(usize, u64),
    Seek(usize, u64, usize),
    Gain(usize, u64, f32),
    Remove(usize, u64),
    Grid(usize, u64, Grid),
    Tempo(usize, [u64; 2], f64),
    Click(usize, u64, f32),
    MasterTempo(f64),
    Drift(usize, [u64; 2]),
    DriftRate(f64),
    SyncQuantum(u8),
    Sync(usize, [u64; 2], bool),
}

#[derive(Clone, Copy, Default, Debug)]
pub struct Frame {
    pub samples: [f32; 2],
    pub positions: [u64; 2],
    pub generations: [u64; 2],
    pub position_epochs: [u64; 2],
    pub playing: [bool; 2],
    pub gains: [f32; 2],
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
            Command::Install {
                deck,
                generation,
                mut voice,
            } => {
                if generation != latest[deck] {
                    return Some(voice);
                }
                if let Some(old) = &self.voices[deck] {
                    voice.gain = old.gain;
                }
                self.clear_sync(deck);
                return self.voices[deck].replace(voice);
            }
            Command::Play(d, g) => {
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
                        v.seek(p);
                        v.synced = false;
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
                    && self.voices[d]
                        .as_ref()
                        .is_some_and(|v| v.grid.is_some() && !v.synced)
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
                        if self.drift_target == Some(d) {
                            self.drift_target = None;
                        }
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
                let target = v.target_bpm;
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
        for (d, voice) in self.voices.iter_mut().enumerate() {
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
                for (target, value) in frame.samples.iter_mut().zip(sample) {
                    *target += value * MIX_GAIN;
                }
                frame.positions[d] = voice.position as u64;
                frame.generations[d] = voice.generation;
                frame.position_epochs[d] = voice.position_epoch;
                frame.playing[d] = voice.playing;
                frame.gains[d] = voice.gain;
                frame.grids[d] = voice.grid;
                frame.targets[d] = voice.target_bpm;
                frame.synced[d] = voice.synced;
                frame.launch_pending[d] = voice.launch_beat.is_some();
                frame.clicks[d] = voice.click_gain;
                frame.timing_errors[d] = voice.timing_error;
                frame.reposition[d] = voice.reposition_seconds;
            }
        }
        for sample in &mut frame.samples {
            *sample = sample.clamp(-1., 1.);
        }
        Ok(frame)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
            },
            latest,
        ));
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
        assert_eq!(decks.drift_target, Some(1));
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
            },
            [2, 1],
        ));
        assert!(!decks.voices[0].as_ref().unwrap().synced);
        assert!(decks.voices[1].as_ref().unwrap().synced);
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
