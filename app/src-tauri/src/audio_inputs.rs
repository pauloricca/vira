//! Live device sources. Capture callbacks feed bounded queues; graph rendering never waits.
use anyhow::Result;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, Weak,
};

pub fn device_id(name: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("input-{:x}", Sha256::digest(name.as_bytes()))[..38].into()
}

pub struct Capture {
    reader: Mutex<crate::cue_output::CueOutput>,
    stop: Arc<AtomicBool>,
    rate: u32,
}
impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}
impl Capture {
    pub fn render(&self, data: &mut [f32]) {
        data.fill(0.);
        if self.stop.load(Ordering::Acquire) {
            return;
        }
        if let Ok(mut reader) = self.reader.try_lock() {
            reader.render_at_rate(data, 2, self.rate as f64 / 48000.);
        }
    }
}
#[derive(Default)]
pub struct Inputs(Mutex<std::collections::HashMap<String, Weak<Capture>>>);
impl Inputs {
    pub fn failed(&self, id: &str) -> bool {
        self.0
            .lock()
            .unwrap()
            .get(id)
            .and_then(Weak::upgrade)
            .is_some_and(|source| source.stop.load(Ordering::Acquire))
    }
    #[cfg(target_os = "macos")]
    pub fn open(&self, id: &str) -> Result<Arc<Capture>> {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
        let port = if id.starts_with("instrument-in-") {
            Some(crate::instruments::audio(id, true)?)
        } else {
            None
        };
        let key = port.as_ref().map_or_else(
            || id.to_owned(),
            |p| format!("{id}:{}:{:?}", p.device, p.channels),
        );
        let mut sources = self.0.lock().unwrap();
        if let Some(source) = sources.get(&key).and_then(Weak::upgrade) {
            if !source.stop.load(Ordering::Acquire) {
                return Ok(source);
            }
        }
        let id_owned = id.to_owned();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let (mut writer, reader) = rtrb::RingBuffer::new(8192);
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        std::thread::spawn(move || {
            let result = (|| -> Result<(cpal::Stream, u32)> {
                let device = cpal::default_host()
                    .input_devices()?
                    .find(|d| {
                        d.name().ok().is_some_and(|name| {
                            port.as_ref()
                                .map_or_else(|| device_id(&name) == id_owned, |p| p.device == name)
                        })
                    })
                    .ok_or_else(|| anyhow::anyhow!("Input device disconnected"))?;
                let supported = device.default_input_config()?;
                let rate = supported.sample_rate().0;
                let channels = supported.channels() as usize;
                anyhow::ensure!(channels > 0, "Input device has no channels");
                let selected = port.as_ref().map_or_else(
                    || vec![1, if channels > 1 { 2 } else { 1 }],
                    |p| p.channels.clone(),
                );
                anyhow::ensure!(
                    selected.iter().all(|c| *c <= channels),
                    "Input channels unavailable"
                );
                let left_channel = selected[0] - 1;
                let right_channel = selected.get(1).copied().unwrap_or(selected[0]) - 1;
                let config = supported.config();
                let failed = thread_stop.clone();
                let on_error = move |_: cpal::StreamError| {
                    failed.store(true, Ordering::Release);
                };
                macro_rules! stream {
                    ($sample:ty, $convert:expr) => {
                        device.build_input_stream(
                            &config,
                            move |data: &[$sample], _: &cpal::InputCallbackInfo| {
                                for frame in data.chunks_exact(channels) {
                                    let convert = $convert;
                                    let left = convert(frame[left_channel]);
                                    let right = convert(frame[right_channel]);
                                    let _ = writer.push([left, right]);
                                }
                            },
                            on_error,
                            None,
                        )?
                    };
                }
                let stream = match supported.sample_format() {
                    cpal::SampleFormat::F32 => {
                        stream!(f32, |v: f32| if v.is_finite() { v } else { 0. })
                    }
                    cpal::SampleFormat::I16 => stream!(i16, |v: i16| v as f32 / 32768.),
                    cpal::SampleFormat::U16 => stream!(u16, |v: u16| (v as f32 - 32768.) / 32768.),
                    format => anyhow::bail!("Unsupported input sample format: {format}"),
                };
                stream.play()?;
                Ok((stream, rate))
            })();
            match result {
                Ok((stream, rate)) => {
                    let _ = ready_tx.send(Ok(rate));
                    while !thread_stop.load(Ordering::Acquire) {
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                    drop(stream);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Audio input unavailable: {e:#}")));
                }
            }
        });
        let rate = match ready_rx.recv_timeout(std::time::Duration::from_secs(30)) {
            Ok(Ok(rate)) => rate,
            result => {
                stop.store(true, Ordering::Release);
                anyhow::bail!("{}", match result { Ok(Err(e)) => e, _ => "Timed out opening audio input; check microphone permission in System Settings".into() });
            }
        };
        let source = Arc::new(Capture {
            reader: Mutex::new(crate::cue_output::CueOutput::new(reader)),
            stop,
            rate,
        });
        sources.insert(key, Arc::downgrade(&source));
        Ok(source)
    }
}

#[cfg(target_os = "macos")]
pub fn nodes() -> Result<Vec<crate::routing::Node>> {
    use crate::routing::{Kind, Node};
    use cpal::traits::{DeviceTrait, HostTrait};
    Ok(cpal::default_host()
        .input_devices()?
        .filter_map(|d| d.name().ok())
        .enumerate()
        .map(|(i, name)| Node {
            id: device_id(&name),
            kind: Kind::Input,
            deck: None,
            label: name,
            x: 40. + (i % 8) as f32 * 190.,
            y: 650. + (i / 8) as f32 * 150.,
            value: 1.,
            patch_inputs: None,
        })
        .collect())
}

#[cfg(test)]
pub fn test_capture(samples: usize, value: [f32; 2], rate: u32) -> Arc<Capture> {
    let (mut writer, reader) = rtrb::RingBuffer::new(8192);
    for _ in 0..samples {
        writer.push(value).unwrap();
    }
    Arc::new(Capture {
        reader: Mutex::new(crate::cue_output::CueOutput::new(reader)),
        stop: Arc::new(AtomicBool::new(false)),
        rate,
    })
}
