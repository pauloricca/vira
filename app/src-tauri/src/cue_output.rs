//! Bounded stereo bridge between independently clocked output devices.
//! Linear interpolation makes small clock corrections without skipping samples.
pub struct CueOutput {
    pub consumer: rtrb::Consumer<[f32; 2]>,
    pair: Option<[[f32; 2]; 2]>,
    phase: f64,
}
impl CueOutput {
    pub fn new(consumer: rtrb::Consumer<[f32; 2]>) -> Self {
        Self {
            consumer,
            pair: None,
            phase: 0.,
        }
    }
    pub fn reset(&mut self) {
        for _ in 0..self.consumer.slots() {
            let _ = self.consumer.pop();
        }
        self.pair = None;
        self.phase = 0.;
    }
    pub fn render(&mut self, data: &mut [f32], channels: usize) {
        self.render_at_rate(data, channels, 1.);
    }
    /// Bounded scratch storage maps the stereo bridge onto any hardware pair.
    pub fn render_mapped(&mut self, data: &mut [f32], channels: usize, pair: [u16; 2], ratio: f64) {
        data.fill(0.);
        for chunk in data.chunks_mut(channels * 256) {
            let frames = chunk.len() / channels;
            let mut stereo = [0.; 512];
            self.render_at_rate(&mut stereo[..frames * 2], 2, ratio);
            for (index, frame) in chunk.chunks_exact_mut(channels).enumerate() {
                crate::audio_devices::write_pair(
                    frame,
                    pair,
                    [stereo[index * 2], stereo[index * 2 + 1]],
                );
            }
        }
    }
    pub fn render_at_rate(&mut self, data: &mut [f32], channels: usize, source_rate: f64) {
        data.fill(0.);
        // Recover from a stopped/disconnected callback without replaying old audio.
        let target =
            (((data.len() / channels + 512) as f64 * source_rate).ceil() as usize).clamp(2, 4096);
        if self.consumer.slots() > 6144 {
            self.reset();
        }
        if self.pair.is_none() {
            if self.consumer.slots() < target {
                return;
            }
            self.pair = Some([self.consumer.pop().unwrap(), self.consumer.pop().unwrap()]);
            self.phase = 0.;
        }
        // Keep ~10 ms queued. +/-0.5% covers separate hardware clocks and
        // gradually corrects queue fill; neither callback blocks the other.
        let rate = source_rate
            * (1. + (self.consumer.slots() as f64 - target as f64) * 0.00002).clamp(0.995, 1.005);
        for frame in data.chunks_exact_mut(channels) {
            let pair = self.pair.unwrap();
            for channel in 0..2 {
                frame[channel] =
                    pair[0][channel] + (pair[1][channel] - pair[0][channel]) * self.phase as f32;
            }
            self.phase += rate;
            while self.phase >= 1. {
                let Some(pair) = self.pair.as_mut() else {
                    return;
                };
                let Ok(next) = self.consumer.pop() else {
                    self.pair = None;
                    return;
                };
                *pair = [pair[1], next];
                self.phase -= 1.;
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn separate_cue_maps_only_its_pair_at_different_native_rates() {
        for ratio in [96000. / 44100., 44100. / 96000., 1.] {
            let (mut producer, consumer) = rtrb::RingBuffer::new(8192);
            for _ in 0..4096 {
                producer.push([0.25, -0.5]).unwrap();
            }
            let mut cue = CueOutput::new(consumer);
            let mut data = [1.; 256 * 8];
            let before = cue.consumer.slots();
            cue.render_mapped(&mut data, 8, [3, 4], ratio);
            assert!(data
                .chunks_exact(8)
                .all(|frame| frame == [0., 0., 0.25, -0.5, 0., 0., 0., 0.]));
            let consumed = before - cue.consumer.slots();
            assert!((consumed as f64 - 256. * ratio).abs() < 10.);
        }
    }
    #[test]
    fn converts_input_sample_rates_to_engine_time() {
        for rate in [44100, 48000, 96000] {
            let (mut producer, consumer) = rtrb::RingBuffer::new(8192);
            for _ in 0..2048 {
                producer.push([0.2, -0.3]).unwrap();
            }
            let mut bridge = CueOutput::new(consumer);
            let before = bridge.consumer.slots();
            let mut data = [0.; 480 * 2];
            bridge.render_at_rate(&mut data, 2, rate as f64 / 48000.);
            let consumed = before - bridge.consumer.slots();
            assert!((rate / 100 - 10..=rate / 100 + 10).contains(&(consumed as u32)));
            assert!(data.chunks_exact(2).all(|frame| frame == [0.2, -0.3]));
        }
    }
    #[test]
    fn bridges_clock_drift_without_unbounded_latency_or_other_channels() {
        let (mut producer, consumer) = rtrb::RingBuffer::new(8192);
        let mut cue = CueOutput::new(consumer);
        for _ in 0..1024 {
            producer.push([0.2, -0.3]).unwrap();
        }
        for _ in 0..1000 {
            for _ in 0..257 {
                producer.push([0.2, -0.3]).unwrap();
            }
            let mut data = [0.; 256 * 4];
            cue.render(&mut data, 4);
            for sample in data.chunks_exact(4) {
                assert_eq!(sample, [0.2, -0.3, 0., 0.]);
            }
            assert!(cue.consumer.slots() < 1024);
        }
        cue.reset();
        let mut data = [1.; 256 * 2];
        cue.render(&mut data, 2);
        assert_eq!(data, [0.; 256 * 2]);
    }
    #[test]
    fn slower_master_clock_does_not_starve_cue() {
        let (mut producer, consumer) = rtrb::RingBuffer::new(8192);
        let mut cue = CueOutput::new(consumer);
        for _ in 0..1024 {
            producer.push([0.2, -0.3]).unwrap();
        }
        for _ in 0..1000 {
            for _ in 0..255 {
                producer.push([0.2, -0.3]).unwrap();
            }
            let mut data = [0.; 256 * 2];
            cue.render(&mut data, 2);
            assert!(data.chunks_exact(2).all(|s| s == [0.2, -0.3]));
        }
    }
    #[test]
    fn stalled_device_discards_stale_audio() {
        let (mut producer, consumer) = rtrb::RingBuffer::new(8192);
        let mut cue = CueOutput::new(consumer);
        for _ in 0..8192 {
            producer.push([1., 1.]).unwrap();
        }
        let mut data = [1.; 512];
        cue.render(&mut data, 2);
        assert_eq!(data, [0.; 512]);
        assert_eq!(cue.consumer.slots(), 0);
    }
}
