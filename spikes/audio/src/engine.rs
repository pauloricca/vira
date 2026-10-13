use crate::{
    audio::{Audio, Voice},
    metrics::Timing,
};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc, time::Instant};
#[derive(Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct VoiceSpec {
    pub source: usize,
    pub position: usize,
    pub speed: f64,
    pub pitch: f64,
    pub gain: f32,
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Start { position: usize },
    Stop,
    Seek { position: usize },
    Ratios { speed: f64, pitch: f64 },
}
#[derive(Deserialize, Serialize, Clone)]
pub struct Event {
    pub frame: u64,
    pub voice: usize,
    #[serde(flatten)]
    pub action: Action,
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub sources: Vec<String>,
    pub engine: u32,
    pub duration_frames: u64,
    pub block_frames: usize,
    pub queue_frames: usize,
    pub voices: Vec<VoiceSpec>,
    pub events: Vec<Event>,
}
pub fn valid_ratios(speed: f64, pitch: f64) -> bool {
    speed.is_finite()
        && (0.5..=2.).contains(&speed)
        && pitch.is_finite()
        && (-12. ..=12.).contains(&pitch)
}
impl Manifest {
    pub fn read(path: &Path) -> Result<Self> {
        let m: Self = serde_json::from_slice(&std::fs::read(path)?)?;
        ensure!([2, 3].contains(&m.engine), "engine must be 2 or 3");
        ensure!(
            m.duration_frames > 0 && m.duration_frames <= 48000 * 3600,
            "duration must be in (0, 1 hour]"
        );
        ensure!(
            [128, 256, 512].contains(&m.block_frames),
            "block_frames must be 128, 256 or 512"
        );
        ensure!(
            m.queue_frames >= m.block_frames * 2 && m.queue_frames <= 48000,
            "queue_frames must hold 2 blocks and at most 1 second"
        );
        ensure!(
            !m.voices.is_empty() && m.voices.len() <= 64,
            "require 1..64 voices"
        );
        ensure!(
            m.events.windows(2).all(|w| w[0].frame <= w[1].frame),
            "events must be ordered"
        );
        for v in &m.voices {
            ensure!(
                v.source < m.sources.len()
                    && valid_ratios(v.speed, v.pitch)
                    && v.gain.is_finite()
                    && (0. ..=1.).contains(&v.gain),
                "invalid voice"
            );
        }
        for e in &m.events {
            ensure!(
                e.voice < m.voices.len() && e.frame < m.duration_frames,
                "invalid event position/voice"
            );
            if let Action::Ratios { speed, pitch } = e.action {
                ensure!(valid_ratios(speed, pitch), "invalid event ratios");
            }
        }
        Ok(m)
    }
}
pub struct Engine {
    pub manifest: Manifest,
    voices: Vec<Voice>,
    pub frame: u64,
    event: usize,
    pub blocks: Timing,
    pub preload_bytes: usize,
    pub clipped_samples: u64,
    pub peak: f32,
}
impl Engine {
    pub fn new(manifest: Manifest) -> Result<Self> {
        let sources: Vec<Arc<Audio>> = manifest
            .sources
            .iter()
            .map(|p| Audio::load(Path::new(p)).map(Arc::new))
            .collect::<Result<_>>()?;
        let preload_bytes = sources.iter().map(|a| a.bytes()).sum();
        let mut voices = Vec::new();
        for v in &manifest.voices {
            ensure!(
                v.position < sources[v.source].len(),
                "initial source position out of range"
            );
            voices.push(Voice::new(
                sources[v.source].clone(),
                manifest.engine,
                v.speed,
                v.pitch,
                v.position,
                v.gain,
            ));
        }
        for e in &manifest.events {
            if let Action::Start { position } | Action::Seek { position } = e.action {
                ensure!(
                    position < voices[e.voice].source.len(),
                    "event source position out of range"
                );
            }
        }
        Ok(Self {
            manifest,
            voices,
            frame: 0,
            event: 0,
            blocks: Timing::default(),
            preload_bytes,
            clipped_samples: 0,
            peak: 0.,
        })
    }
    pub fn render(&mut self, out: &mut [[f32; 2]]) -> Result<usize> {
        let t = Instant::now();
        let n = out
            .len()
            .min((self.manifest.duration_frames - self.frame) as usize);
        for dst in &mut out[..n] {
            while self.event < self.manifest.events.len()
                && self.manifest.events[self.event].frame == self.frame
            {
                let e = &self.manifest.events[self.event];
                let v = &mut self.voices[e.voice];
                match e.action {
                    Action::Start { position } => {
                        v.seek(position);
                        v.active = true;
                    }
                    Action::Stop => v.active = false,
                    Action::Seek { position } => v.seek(position),
                    Action::Ratios { speed, pitch } => v.dsp.ratios(speed, pitch),
                }
                self.event += 1;
            }
            *dst = [0.; 2];
            for v in &mut self.voices {
                let f = v.next().context("rendering voice")?;
                dst[0] += f[0];
                dst[1] += f[1];
            }
            for s in dst {
                self.peak = self.peak.max(s.abs());
                if s.abs() > 1. {
                    self.clipped_samples += 1;
                }
            }
            self.frame += 1;
        }
        self.blocks.add(t.elapsed().as_nanos() as u64);
        Ok(n)
    }
    pub fn report(&self) -> Value {
        json!({"manifest":self.manifest,"rendered_frames":self.frame,"preloaded_audio_bytes":self.preload_bytes,"producer_blocks":self.blocks.report(),"peak_amplitude":self.peak,"samples_above_full_scale":self.clipped_samples,"voices":self.voices.iter().map(|v|json!({"native_process":v.dsp.calls.report(),"current_start_delay_frames":v.dsp.delay(),"current_start_pad_frames":v.dsp.padding()})).collect::<Vec<_>>()})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parse_script_actions() {
        let data = r#"{"frame":17,"voice":0,"action":"seek","position":501}"#;
        let event: Event = serde_json::from_str(data).unwrap();
        assert_eq!(event.frame, 17);
        assert!(matches!(event.action, Action::Seek { position: 501 }));
        assert!(serde_json::from_str::<Event>(
            r#"{"frame":0,"voice":0,"action":"seek","positoin":12}"#
        )
        .is_err());
    }
    #[test]
    fn stop_and_retrigger_are_sample_positioned() {
        let source = Arc::new(Audio {
            left: vec![0.1; 96000],
            right: vec![0.1; 96000],
        });
        let voice = Voice::new(source, 2, 1., 0., 0, 1.);
        let m = Manifest {
            sources: vec![],
            engine: 2,
            duration_frames: 1024,
            block_frames: 128,
            queue_frames: 512,
            voices: vec![],
            events: vec![
                Event {
                    frame: 17,
                    voice: 0,
                    action: Action::Start { position: 0 },
                },
                Event {
                    frame: 301,
                    voice: 0,
                    action: Action::Stop,
                },
                Event {
                    frame: 777,
                    voice: 0,
                    action: Action::Start { position: 0 },
                },
            ],
        };
        let mut e = Engine {
            manifest: m,
            voices: vec![voice],
            frame: 0,
            event: 0,
            blocks: Timing::default(),
            preload_bytes: 0,
            clipped_samples: 0,
            peak: 0.,
        };
        let mut output = vec![[0.; 2]; 1024];
        for block in output.chunks_mut(128) {
            e.render(block).unwrap();
        }
        assert!(output[..17]
            .iter()
            .chain(&output[301..777])
            .all(|f| *f == [0.; 2]));
        assert!(output[100..301].iter().any(|f| f[0].abs() > 0.01));
        assert_eq!(&output[17..264], &output[777..1024]);
    }
}
