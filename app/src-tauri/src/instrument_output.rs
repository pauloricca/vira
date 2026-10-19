//! Optional hardware sends owned by a compiled plan; callbacks only drain a bounded queue.
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
pub struct Output {
    producer: rtrb::Producer<[f32; 2]>,
    stop: Arc<AtomicBool>,
}
impl Drop for Output {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}
impl Output {
    pub fn push(&mut self, sample: [f32; 2]) {
        let _ = self.producer.push(sample);
    }
    #[cfg(target_os = "macos")]
    pub fn open(port: crate::instruments::AudioPort) -> anyhow::Result<Self> {
        use cpal::traits::{DeviceTrait, StreamTrait};
        let (producer, consumer) = rtrb::RingBuffer::new(8192);
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let result = (|| -> anyhow::Result<cpal::Stream> {
                let device =
                    crate::audio_devices::resolve(&cpal::default_host(), Some(&port.device))?;
                let required = *port.channels.iter().max().unwrap();
                let channels = device
                    .supported_output_configs()?
                    .filter(|c| {
                        c.channels() as usize >= required
                            && c.sample_format() == cpal::SampleFormat::F32
                            && c.min_sample_rate().0 <= crate::sample_rate::get() as u32
                            && c.max_sample_rate().0 >= crate::sample_rate::get() as u32
                    })
                    .map(|c| c.channels())
                    .min()
                    .ok_or_else(|| {
                        anyhow::anyhow!("Output channels unavailable on {}", port.device)
                    })?;
                let config = cpal::StreamConfig {
                    channels,
                    sample_rate: cpal::SampleRate(crate::sample_rate::get() as u32),
                    buffer_size: cpal::BufferSize::Default,
                };
                let mut reader = crate::cue_output::CueOutput::new(consumer);
                let failed = thread_stop.clone();
                let stream = device.build_output_stream(
                    &config,
                    move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                        // Process bounded chunks without allocating in the callback.
                        for chunk in data.chunks_mut(channels as usize * 256) {
                            let frames = chunk.len() / channels as usize;
                            let mut stereo = [0.; 512];
                            reader.render(&mut stereo[..frames * 2], 2);
                            chunk.fill(0.);
                            for (i, frame) in chunk.chunks_exact_mut(channels as usize).enumerate()
                            {
                                map_frame(
                                    frame,
                                    [stereo[i * 2], stereo[i * 2 + 1]],
                                    &port.channels,
                                );
                            }
                        }
                    },
                    move |_| {
                        failed.store(true, Ordering::Release);
                    },
                    None,
                )?;
                stream.play()?;
                Ok(stream)
            })();
            match result {
                Ok(stream) => {
                    let _ = tx.send(Ok(()));
                    while !thread_stop.load(Ordering::Acquire) {
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                    drop(stream);
                }
                Err(error) => {
                    let _ = tx.send(Err(error.to_string()));
                }
            }
        });
        match rx.recv_timeout(std::time::Duration::from_secs(10)) {
            Ok(Ok(())) => Ok(Self { producer, stop }),
            result => {
                stop.store(true, Ordering::Release);
                anyhow::bail!(
                    "{}",
                    match result {
                        Ok(Err(e)) => e,
                        _ => "Timed out opening instrument output".into(),
                    }
                )
            }
        }
    }
}

fn map_frame(frame: &mut [f32], stereo: [f32; 2], channels: &[usize]) {
    if channels.len() == 1 {
        frame[channels[0] - 1] = (stereo[0] + stereo[1]) * 0.5;
    } else {
        frame[channels[0] - 1] = stereo[0];
        frame[channels[1] - 1] = stereo[1];
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hardware_mapping_keeps_other_channels_silent_and_sums_mono() {
        let mut frame = [0.; 8];
        map_frame(&mut frame, [0.8, -0.2], &[4, 7]);
        assert_eq!(frame, [0., 0., 0., 0.8, 0., 0., -0.2, 0.]);
        frame.fill(0.);
        map_frame(&mut frame, [0.8, -0.2], &[8]);
        assert!((frame[7] - 0.3).abs() < 0.00001);
        assert_eq!(&frame[..7], &[0.; 7]);
    }
}
