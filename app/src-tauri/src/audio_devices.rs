//! Saved output routes. An unavailable explicit route never falls back to speakers.
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Routes {
    pub master: Option<String>,
    pub cue: Option<String>,
}
impl Routes {
    fn path() -> std::path::PathBuf {
        std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
            .join("Library/Application Support/uk.ricca.vira/audio.json")
    }
    pub fn load() -> Self {
        std::fs::read(Self::path())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }
    pub fn save(&self) -> Result<()> {
        let path = Self::path();
        std::fs::create_dir_all(path.parent().unwrap())?;
        let temporary = path.with_extension("json.tmp");
        std::fs::write(&temporary, serde_json::to_vec(self)?)?;
        std::fs::rename(temporary, path)?;
        Ok(())
    }
    pub fn validate(&self, default: Option<&str>) -> Result<()> {
        ensure!(
            self.cue
                .as_deref()
                .is_none_or(|cue| Some(cue) != self.master.as_deref().or(default)),
            "Choose different devices for master out and cue headphones"
        );
        Ok(())
    }
}

#[cfg(target_os = "macos")]
pub fn resolve(host: &cpal::Host, name: Option<&str>) -> Result<cpal::Device> {
    use cpal::traits::{DeviceTrait, HostTrait};
    match name {
        None => host
            .default_output_device()
            .ok_or_else(|| anyhow::anyhow!("No default output device")),
        // Resolve by name before probing output capabilities, so an unrelated
        // device (for example a Continuity microphone) cannot block this route.
        Some(name) => host
            .devices()?
            .find(|d| d.name().ok().as_deref() == Some(name))
            .ok_or_else(|| anyhow::anyhow!("Device disconnected: {name}")),
    }
}

/// Select the device's current/default rate when possible; otherwise prefer a
/// common music rate. The bounds keep filter cutoffs below Nyquist and cache
/// storage bounded while covering 44.1/48/88.2/96/176.4/192 kHz devices.
pub fn choose_rate(default: u32, ranges: &[(u16, u32, u32)]) -> Option<(u16, u32)> {
    let at = |rate| {
        ranges
            .iter()
            .filter(|&&(channels, low, high)| {
                channels >= 2 && (44100..=192000).contains(&rate) && low <= rate && rate <= high
            })
            .map(|&(channels, _, _)| (channels, rate))
            .min()
    };
    at(default)
        .or_else(|| at(48000))
        .or_else(|| at(44100))
        .or_else(|| {
            ranges
                .iter()
                .filter_map(|&(_, low, high)| {
                    let rate = low.max(44100);
                    (rate <= high.min(192000)).then(|| at(rate)).flatten()
                })
                .min_by_key(|&(channels, rate)| (rate, channels))
        })
}

#[cfg(target_os = "macos")]
fn ranges(device: &cpal::Device) -> Result<Vec<(u16, u32, u32)>> {
    use cpal::traits::DeviceTrait;
    Ok(device
        .supported_output_configs()?
        .filter(|c| c.sample_format() == cpal::SampleFormat::F32)
        .map(|c| (c.channels(), c.min_sample_rate().0, c.max_sample_rate().0))
        .collect())
}
#[cfg(target_os = "macos")]
pub fn config(device: &cpal::Device) -> Result<cpal::StreamConfig> {
    use cpal::traits::DeviceTrait;
    let default = device
        .default_output_config()
        .map(|c| c.sample_rate().0)
        .unwrap_or(48000);
    let (channels, rate) = choose_rate(default, &ranges(device)?)
        .ok_or_else(|| anyhow::anyhow!("Device needs stereo float32 output at 44.1–192 kHz"))?;
    Ok(cpal::StreamConfig {
        channels,
        sample_rate: cpal::SampleRate(rate),
        buffer_size: cpal::BufferSize::Default,
    })
}
#[cfg(target_os = "macos")]
pub fn config_at(device: &cpal::Device, rate: u32) -> Result<cpal::StreamConfig> {
    let channels = ranges(device)?
        .into_iter()
        .filter(|&(channels, low, high)| channels >= 2 && low <= rate && rate <= high)
        .map(|c| c.0)
        .min()
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Device does not support the engine rate ({} kHz). Reapply output settings to use its native rate, or choose devices with a shared rate.",
                rate as f64 / 1000.
            )
        })?;
    Ok(cpal::StreamConfig {
        channels,
        sample_rate: cpal::SampleRate(rate),
        buffer_size: cpal::BufferSize::Default,
    })
}
#[cfg(target_os = "macos")]
pub fn inventory() -> Result<serde_json::Value> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let default = host.default_output_device().and_then(|d| d.name().ok());
    let devices = host.output_devices()?.filter_map(|device| {
        let name = device.name().ok()?;
        let config = config(&device).ok();
        Some(serde_json::json!({"id":name,"name":name,"supported":config.is_some(),
            "sample_rate":config.map(|c| c.sample_rate.0),"rate_ranges":ranges(&device).unwrap_or_default()}))
    }).collect::<Vec<_>>();
    Ok(
        serde_json::json!({"devices":devices,"default_device":default,"sample_rate":crate::sample_rate::get()}),
    )
}

/// Open a silent native stream for hardware acceptance without modifying saved
/// routes or launching the UI. The report distinguishes callbacks from enumeration.
#[cfg(target_os = "macos")]
pub fn check(name: Option<&str>) -> Result<serde_json::Value> {
    use cpal::traits::{DeviceTrait, StreamTrait};
    use std::sync::{
        atomic::{AtomicU64, Ordering::Relaxed},
        Arc,
    };
    let device = resolve(&cpal::default_host(), name)?;
    let mut config = config(&device)?;
    config.buffer_size = cpal::BufferSize::Fixed(256);
    let channels = config.channels as usize;
    let frames = Arc::new(AtomicU64::new(0));
    let errors = Arc::new(AtomicU64::new(0));
    let count = frames.clone();
    let failures = errors.clone();
    let stream = device.build_output_stream(
        &config,
        move |data: &mut [f32], _| {
            data.fill(0.);
            count.fetch_add((data.len() / channels) as u64, Relaxed);
        },
        move |_| {
            failures.fetch_add(1, Relaxed);
        },
        None,
    )?;
    stream.play()?;
    std::thread::sleep(std::time::Duration::from_millis(500));
    drop(stream);
    let report = serde_json::json!({"device":device.name()?,"sample_rate":config.sample_rate.0,
        "channels":channels,"callback_frames":frames.load(Relaxed),"device_errors":errors.load(Relaxed)});
    ensure!(
        frames.load(Relaxed) > 0 && errors.load(Relaxed) == 0,
        "Native output check failed: {report}"
    );
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sample_rate_contract_chooses_current_rate_and_rejects_invalid_formats() {
        assert_eq!(choose_rate(44100, &[(4, 44100, 44100)]), Some((4, 44100)));
        assert_eq!(choose_rate(96000, &[(2, 44100, 192000)]), Some((2, 96000)));
        assert_eq!(choose_rate(22050, &[(2, 44100, 44100)]), Some((2, 44100)));
        assert_eq!(
            choose_rate(48000, &[(4, 44100, 96000), (2, 44100, 96000)]),
            Some((2, 48000))
        );
        assert_eq!(choose_rate(32000, &[(2, 96000, 96000)]), Some((2, 96000)));
        assert_eq!(choose_rate(44100, &[(1, 44100, 44100)]), None);
        assert_eq!(choose_rate(384000, &[(2, 384000, 384000)]), None);
    }
    #[test]
    fn cue_never_shares_explicit_or_default_master() {
        let routes = Routes {
            master: None,
            cue: Some("Speakers".into()),
        };
        assert!(routes.validate(Some("Speakers")).is_err());
        assert!(routes.validate(Some("Interface")).is_ok());
        let routes = Routes {
            master: Some("Speakers".into()),
            ..routes
        };
        assert!(routes.validate(Some("Interface")).is_err());
        assert!(Routes::default().validate(None).is_ok());
    }
}
