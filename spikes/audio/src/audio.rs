use crate::dsp::{Dsp, CHUNK};
use anyhow::{bail, ensure, Context, Result};
use std::path::Path;
use std::sync::Arc;

pub struct Audio {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
}
impl Audio {
    pub fn load(path: &Path) -> Result<Self> {
        let mut reader =
            hound::WavReader::open(path).with_context(|| format!("reading {}", path.display()))?;
        let spec = reader.spec();
        ensure!(
            spec.sample_rate == 48000 && spec.channels == 2,
            "{}: require stereo 48 kHz WAV; convert outside the harness",
            path.display()
        );
        let samples: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => reader
                .samples::<f32>()
                .collect::<std::result::Result<_, _>>()?,
            hound::SampleFormat::Int => {
                let scale = 2_f32.powi(spec.bits_per_sample as i32 - 1);
                reader
                    .samples::<i32>()
                    .map(|v| v.map(|x| x as f32 / scale))
                    .collect::<std::result::Result<_, _>>()?
            }
        };
        ensure!(
            !samples.is_empty()
                && samples.len().is_multiple_of(2)
                && samples.iter().all(|x| x.is_finite()),
            "empty, incomplete or non-finite source"
        );
        Ok(Self {
            left: samples.iter().step_by(2).copied().collect(),
            right: samples.iter().skip(1).step_by(2).copied().collect(),
        })
    }
    pub fn len(&self) -> usize {
        self.left.len()
    }
    pub fn bytes(&self) -> usize {
        self.len() * 8
    }
}
pub fn write(path: &Path, frames: &[[f32; 2]]) -> Result<()> {
    let mut writer = hound::WavWriter::create(
        path,
        hound::WavSpec {
            channels: 2,
            sample_rate: 48000,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        },
    )?;
    for f in frames {
        writer.write_sample(f[0])?;
        writer.write_sample(f[1])?;
    }
    writer.finalize()?;
    Ok(())
}

/// Owned and used on the producer only. Native work, including reset, never enters the callback.
pub struct Voice {
    pub dsp: Dsp,
    pub source: Arc<Audio>,
    pub position: usize,
    pub gain: f32,
    pub active: bool,
    pad: usize,
    skip: usize,
    left: [f32; CHUNK],
    right: [f32; CHUNK],
    read: usize,
    available: usize,
}
impl Voice {
    pub fn new(
        source: Arc<Audio>,
        engine: u32,
        speed: f64,
        pitch: f64,
        position: usize,
        gain: f32,
    ) -> Self {
        let dsp = Dsp::new(engine, speed, pitch);
        let pad = dsp.padding();
        let skip = dsp.delay();
        Self {
            dsp,
            source,
            position,
            gain,
            active: false,
            pad,
            skip,
            left: [0.; CHUNK],
            right: [0.; CHUNK],
            read: 0,
            available: 0,
        }
    }
    pub fn seek(&mut self, position: usize) {
        self.dsp.reset();
        self.position = position;
        self.pad = self.dsp.padding();
        self.skip = self.dsp.delay();
        self.read = 0;
        self.available = 0;
    }
    pub fn next(&mut self) -> Result<[f32; 2]> {
        if !self.active {
            return Ok([0.; 2]);
        }
        // Hard guard against an ABI/progress defect; valid ratios need far fewer iterations.
        for _ in 0..4096 {
            if self.read < self.available {
                let frame = [
                    self.left[self.read] * self.gain,
                    self.right[self.read] * self.gain,
                ];
                self.read += 1;
                if self.skip > 0 {
                    self.skip -= 1;
                    continue;
                }
                return Ok(frame);
            }
            if self.dsp.available() > 0 {
                self.available = self.dsp.retrieve(&mut self.left, &mut self.right);
                self.read = 0;
            } else if self.pad > 0 {
                let n = self.pad.min(CHUNK);
                let zero = [0.; CHUNK];
                self.dsp.process(&zero[..n], &zero[..n], false);
                self.pad -= n;
            } else {
                self.position %= self.source.len();
                let n = CHUNK.min(self.source.len() - self.position);
                self.dsp.process(
                    &self.source.left[self.position..self.position + n],
                    &self.source.right[self.position..self.position + n],
                    false,
                );
                self.position += n;
            }
        }
        bail!("Rubber Band did not produce output within progress guard")
    }
}

/// Finite real-time-mode render: pad input, drain final tail, discard start delay,
/// and retain precisely the requested duration. No offline study pass is used.
pub fn excerpt(
    source: &Audio,
    start: usize,
    frames: usize,
    engine: u32,
    speed: f64,
    pitch: f64,
) -> Result<(Vec<[f32; 2]>, serde_json::Value)> {
    ensure!(
        start
            .checked_add(frames)
            .is_some_and(|end| end <= source.len()),
        "excerpt exceeds source"
    );
    let mut dsp = Dsp::new(engine, speed, pitch);
    let padding = dsp.padding();
    let delay = dsp.delay();
    let mut skip = delay;
    let mut output = Vec::new();
    let mut l = [0.; CHUNK];
    let mut r = [0.; CHUNK];
    let drain = |dsp: &mut Dsp,
                 output: &mut Vec<[f32; 2]>,
                 skip: &mut usize,
                 l: &mut [f32; CHUNK],
                 r: &mut [f32; CHUNK]| {
        while dsp.available() > 0 {
            let n = dsp.retrieve(l, r);
            for i in 0..n {
                if *skip > 0 {
                    *skip -= 1;
                } else {
                    output.push([l[i], r[i]]);
                }
            }
        }
    };
    for offset in (0..padding).step_by(CHUNK) {
        let n = CHUNK.min(padding - offset);
        let zero = [0.; CHUNK];
        dsp.process(&zero[..n], &zero[..n], false);
        drain(&mut dsp, &mut output, &mut skip, &mut l, &mut r);
    }
    for offset in (0..frames).step_by(CHUNK) {
        let n = CHUNK.min(frames - offset);
        dsp.process(
            &source.left[start + offset..start + offset + n],
            &source.right[start + offset..start + offset + n],
            false,
        );
        drain(&mut dsp, &mut output, &mut skip, &mut l, &mut r);
    }
    // Supply explicit silence to flush the real-time resampler/filter tail. The
    // finite source duration stays separate from this input; trim after draining.
    let tail_input = padding + delay * 2 + CHUNK * 8;
    for offset in (0..tail_input).step_by(CHUNK) {
        let n = CHUNK.min(tail_input - offset);
        let zero = [0.; CHUNK];
        dsp.process(&zero[..n], &zero[..n], offset + n == tail_input);
        drain(&mut dsp, &mut output, &mut skip, &mut l, &mut r);
    }
    ensure!(dsp.available() == -1, "final output not fully drained");
    let expected = (frames as f64 / speed).round() as usize;
    ensure!(
        output.len() >= expected,
        "short output: {} vs expected {expected}",
        output.len()
    );
    let tail = output.len() - expected;
    output.truncate(expected);
    Ok((
        output,
        serde_json::json!({"start_pad_frames":padding,"start_delay_frames":delay,"tail_silence_input_frames":tail_input,"tail_trimmed_frames":tail,"output_frames":expected,"native_process":dsp.calls.report()}),
    ))
}
