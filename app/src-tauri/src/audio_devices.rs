//! Saved output routes. An unavailable explicit route never falls back to speakers.
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Routes {
    pub master: Option<String>,
    pub cue: Option<String>,
    /// None follows the master device current/default rate.
    #[serde(default)]
    pub working_rate: Option<u32>,
    #[serde(default = "default_pair")]
    pub master_channels: [u16; 2],
    #[serde(default = "default_pair")]
    pub cue_channels: [u16; 2],
}
fn default_pair() -> [u16; 2] {
    [1, 2]
}
impl Default for Routes {
    fn default() -> Self {
        Self {
            master: None,
            cue: None,
            working_rate: None,
            master_channels: default_pair(),
            cue_channels: default_pair(),
        }
    }
}
/// Write one stereo bus to its one-based hardware channels, leaving other buses intact.
pub fn write_pair(frame: &mut [f32], channels: [u16; 2], samples: [f32; 2]) {
    for (channel, sample) in channels.into_iter().zip(samples) {
        if let Some(target) = channel
            .checked_sub(1)
            .and_then(|index| frame.get_mut(index as usize))
        {
            *target = sample;
        }
    }
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
    pub fn shared_device(&self, default: Option<&str>) -> bool {
        self.cue
            .as_deref()
            .is_some_and(|cue| Some(cue) == self.master.as_deref().or(default))
    }
    pub fn required_master_channels(&self, default: Option<&str>) -> u16 {
        self.master_channels
            .into_iter()
            .chain(
                self.shared_device(default)
                    .then_some(self.cue_channels)
                    .into_iter()
                    .flatten(),
            )
            .max()
            .unwrap_or(2)
    }
    pub fn engine_rate(&self, native_rate: u32) -> u32 {
        self.working_rate.unwrap_or(native_rate)
    }
    pub fn validate(&self, default: Option<&str>) -> Result<()> {
        ensure!(
            self.working_rate
                .is_none_or(|rate| [44100, 48000, 88200, 96000, 176400, 192000].contains(&rate)),
            "Choose a working audio rate from 44.1, 48, 88.2, 96, 176.4 or 192 kHz"
        );
        for pair in [
            Some(self.master_channels),
            self.cue.as_ref().map(|_| self.cue_channels),
        ]
        .into_iter()
        .flatten()
        {
            ensure!(
                pair[0] > 0 && pair[1] > 0 && pair[0] != pair[1],
                "Choose two distinct output channels"
            );
        }
        ensure!(
            !self.shared_device(default)
                || !self
                    .master_channels
                    .iter()
                    .any(|channel| self.cue_channels.contains(channel)),
            "Master and cue channels must not overlap on the same device"
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
    config_channels(device, rate, 2)
}
#[cfg(target_os = "macos")]
pub fn config_channels(
    device: &cpal::Device,
    rate: u32,
    required: u16,
) -> Result<cpal::StreamConfig> {
    let channels = ranges(device)?
        .into_iter()
        .filter(|&(channels, low, high)| channels >= required.max(2) && low <= rate && rate <= high)
        .map(|c| c.0)
        .min()
        .ok_or_else(|| {
            anyhow::anyhow!(
                "Device cannot open the selected channels at {} kHz. Choose available channels or reapply output settings for its native rate.",
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
    fn channel_routes_keep_legacy_defaults_and_allow_disjoint_shared_pairs() {
        let mut routes: Routes =
            serde_json::from_str(r#"{"master":null,"cue":"Starlight"}"#).unwrap();
        assert_eq!(routes.master_channels, [1, 2]);
        assert_eq!(routes.cue_channels, [1, 2]);
        assert!(routes.validate(Some("Starlight")).is_err());
        routes.cue_channels = [3, 4];
        routes.validate(Some("Starlight")).unwrap();
        assert!(routes.shared_device(Some("Starlight")));
        assert_eq!(routes.required_master_channels(Some("Starlight")), 4);
        assert_eq!(routes.required_master_channels(Some("Speakers")), 2);
        let restored: Routes =
            serde_json::from_value(serde_json::to_value(&routes).unwrap()).unwrap();
        assert_eq!(restored.cue_channels, [3, 4]);
        for pair in [[2, 3], [1, 4], [0, 4], [3, 3]] {
            routes.cue_channels = pair;
            assert!(routes.validate(Some("Starlight")).is_err());
        }
    }
    #[test]
    fn working_rate_defaults_to_native_and_round_trips_fixed_rates() {
        let mut routes: Routes = serde_json::from_str(r#"{"master":null,"cue":null}"#).unwrap();
        assert_eq!(routes.working_rate, None);
        assert_eq!(routes.engine_rate(44100), 44100);
        for rate in [44100, 48000, 88200, 96000, 176400, 192000] {
            routes.working_rate = Some(rate);
            routes.validate(None).unwrap();
            let restored: Routes =
                serde_json::from_value(serde_json::to_value(&routes).unwrap()).unwrap();
            assert_eq!(restored.engine_rate(44100), rate);
        }
        routes.working_rate = Some(0);
        assert!(routes.validate(None).is_err());
        routes.working_rate = Some(384000);
        assert!(routes.validate(None).is_err());
    }
    #[test]
    fn channel_mapping_keeps_master_and_cue_isolated_in_one_frame() {
        let mut frame = [0.; 8];
        write_pair(&mut frame, [1, 2], [0.6, -0.4]);
        write_pair(&mut frame, [3, 4], [-0.3, 0.2]);
        assert_eq!(frame, [0.6, -0.4, -0.3, 0.2, 0., 0., 0., 0.]);
        frame.fill(0.);
        write_pair(&mut frame, [5, 6], [0.1, 0.2]);
        write_pair(&mut frame, [1, 2], [0., 0.]);
        assert_eq!(frame, [0., 0., 0., 0., 0.1, 0.2, 0., 0.]);
    }
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
            ..Routes::default()
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
