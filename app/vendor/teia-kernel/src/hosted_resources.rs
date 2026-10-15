//! Native resource descriptions. Acquisition/decoding belongs to the host; all
//! installation uses the same Rust setters as the browser adapter, off-render.
use super::*;

#[derive(Default)]
pub struct Resources {
    pub samples: Vec<Sample>,
    pub images: Vec<Image>,
    pub custom_waves: Vec<CustomWave>,
    pub sequencers: Vec<Sequencer>,
    pub buffers: Vec<Buffer>,
    /// Explicit finite active-item budget for every compiled repeat template.
    pub repeat_capacity: Option<u32>,
    pub repeat_memory_budget: u32,
}
pub struct Sample {
    pub samples: Vec<f32>,
    pub sample_rate: f64,
    pub release: f64,
}
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}
pub struct CustomWave {
    pub mode: i32,
    pub sustain_start: f64,
    pub sustain_end: f64,
    pub points: Vec<(f64, f64)>,
}
pub struct Sequencer {
    pub gate_mode: bool,
    pub steps: u32,
    pub rows: Vec<Vec<SequenceEvent>>,
}
pub struct SequenceEvent {
    pub active: bool,
    pub start: f64,
    pub end: f64,
    pub velocity: f64,
    pub note: f64,
}
pub struct Buffer {
    pub state: u32,
    pub samples: Vec<f32>,
    pub sample_rate: f64,
}

fn resource_node(wave: i32, mode: i32, start: f64, end: f64, release: f64) -> i32 {
    addDspResourceNode(wave, mode, start, end, release)
}
impl Resources {
    pub(super) fn install(&self) -> Result<Vec<i32>, Error> {
        let mut waves = Vec::new();
        for wave in &self.custom_waves {
            if wave.points.len() < 2
                || wave.points.len() > MAX_CUSTOM_WAVE_POINTS
                || ![wave.sustain_start, wave.sustain_end]
                    .iter()
                    .all(|v| v.is_finite())
                || wave
                    .points
                    .iter()
                    .any(|(x, y)| !x.is_finite() || !y.is_finite())
            {
                return Err(Error::InvalidValues);
            }
            let node = resource_node(9, wave.mode, wave.sustain_start, wave.sustain_end, 0.0);
            if node < 0 {
                return Err(Error::Capacity);
            }
            for (x, y) in &wave.points {
                if addCustomWavePoint(node, *x, *y) < 0 {
                    return Err(Error::Capacity);
                }
            }
            waves.push(node);
        }
        for (binding, sample) in self.samples.iter().enumerate() {
            if sample.samples.is_empty()
                || sample.samples.len() > MAX_SAMPLE_FRAMES
                || sample.samples.iter().any(|v| !v.is_finite())
                || !sample.release.is_finite()
                || !sample.sample_rate.is_finite()
                || sample.sample_rate <= 0.0
            {
                return Err(Error::InvalidValues);
            }
            let node = resource_node(10, 0, 0.5, 0.75, sample.release);
            if node < 0 || setDspSampleNode(binding as u32, node) < 0 {
                return Err(Error::Capacity);
            }
            let slot = setSampleData(node, sample.sample_rate, sample.samples.len() as u32);
            if slot < 0 {
                return Err(Error::Capacity);
            }
            unsafe {
                std::ptr::copy_nonoverlapping(
                    sample.samples.as_ptr(),
                    sampleDataPtr(slot as u32),
                    sample.samples.len(),
                );
            }
        }
        for (binding, image) in self.images.iter().enumerate() {
            if image.width == 0
                || image.height == 0
                || image.width > MAX_IMAGE_DIMENSION as u32
                || image.height > MAX_IMAGE_DIMENSION as u32
                || image.rgba.len() != image.width as usize * image.height as usize * 4
                || setImageData(
                    binding as i32,
                    image.width,
                    image.height,
                    image.rgba.len() as u32,
                ) < 0
            {
                return Err(Error::InvalidValues);
            }
            unsafe {
                std::ptr::copy_nonoverlapping(
                    image.rgba.as_ptr(),
                    imageDataPtr(binding as u32),
                    image.rgba.len(),
                );
            }
        }
        if self.sequencers.len() > MAX_DSP_SPREADS {
            return Err(Error::Capacity);
        }
        for (binding, config) in self.sequencers.iter().enumerate() {
            if !(1..=SEQUENCER_MAX_STEPS as u32).contains(&config.steps)
                || config.rows.is_empty()
                || config.rows.len() > SEQUENCER_MAX_ROWS as usize
            {
                return Err(Error::InvalidValues);
            }
            beginDspSequencerUpdate(
                binding as u32,
                config.gate_mode as u32,
                config.steps,
                config.rows.len() as u32,
            );
            for (row, events) in config.rows.iter().enumerate() {
                if events.len() != config.steps as usize {
                    return Err(Error::InvalidValues);
                }
                for (slot, event) in events.iter().enumerate() {
                    if ![event.start, event.end, event.velocity, event.note]
                        .iter()
                        .all(|v| v.is_finite())
                    {
                        return Err(Error::InvalidValues);
                    }
                    setDspSequencerEvent(
                        binding as u32,
                        row as u32,
                        slot as u32,
                        event.active as u32,
                        event.start,
                        event.end,
                        event.velocity,
                        event.note,
                    );
                }
            }
        }
        Ok(waves)
    }
    pub(super) fn restore_buffers(&self, sample_rate: f64) -> Result<(), Error> {
        for buffer in &self.buffers {
            if !valid_dsp_state_range(buffer.state as i32, 7)
                || buffer.samples.len() > MAX_DSP_BUFFER_SAMPLES
                || buffer.samples.iter().any(|v| !v.is_finite())
                || !buffer.sample_rate.is_finite()
                || buffer.sample_rate <= 0.0
            {
                return Err(Error::InvalidValues);
            }
            let ptr = dspBufferPtr(buffer.state);
            if ptr.is_null() {
                return Err(Error::Capacity);
            }
            unsafe {
                std::ptr::copy_nonoverlapping(buffer.samples.as_ptr(), ptr, buffer.samples.len());
            }
            if restoreDspBufferSnapshot(
                buffer.state,
                buffer.samples.len() as u32,
                buffer.sample_rate,
                sample_rate,
            ) < 0
            {
                return Err(Error::InvalidValues);
            }
        }
        Ok(())
    }
    pub(super) fn validate_requirements(&self, ops: &[DspOp]) -> Result<(), Error> {
        for op in ops {
            let has = |value: f64, length: usize| {
                value.fract() == 0.0 && value >= 0.0 && value < length as f64
            };
            if ((op.opcode == DSP_OP_SAMPLE || op.opcode == DSP_OP_SAMPLE_PARAM)
                && !has(op.a as f64, self.samples.len()))
                || (op.opcode == DSP_OP_IMAGE && !has(op.value, self.images.len()))
                || (op.opcode == DSP_OP_OSC && op.a == 9 && !has(op.value, self.custom_waves.len()))
                || (op.opcode == DSP_OP_END_TRIGGER
                    && op.value >= 0.5
                    && !has(op.b as f64, self.custom_waves.len()))
                || (matches!(op.opcode, DSP_OP_SEQUENCER | DSP_OP_ROLL_NOTE_EVENT)
                    && !has(op.value, self.sequencers.len()))
            {
                return Err(Error::MissingResource(
                    "sample/image/wave/sequencer binding",
                ));
            }
            if matches!(op.opcode, DSP_OP_SPREAD_BEGIN | DSP_OP_SPAWN_BEGIN)
                && self.repeat_capacity.is_none()
            {
                return Err(Error::MissingResource(
                    "explicit repeat capacity and memory budget",
                ));
            }
        }
        Ok(())
    }
}
