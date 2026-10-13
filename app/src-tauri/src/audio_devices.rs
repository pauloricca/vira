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
        Some(name) => host
            .output_devices()?
            .find(|d| d.name().ok().as_deref() == Some(name))
            .ok_or_else(|| anyhow::anyhow!("Device disconnected: {name}")),
    }
}

#[cfg(target_os = "macos")]
pub fn config(device: &cpal::Device) -> Result<cpal::StreamConfig> {
    use cpal::traits::DeviceTrait;
    let channels = device
        .supported_output_configs()?
        .filter(|c| {
            c.channels() >= 2
                && c.sample_format() == cpal::SampleFormat::F32
                && c.min_sample_rate().0 <= 48000
                && c.max_sample_rate().0 >= 48000
        })
        .map(|c| c.channels())
        .min()
        .ok_or_else(|| anyhow::anyhow!("Device must support stereo float32 at 48 kHz"))?;
    Ok(cpal::StreamConfig {
        channels,
        sample_rate: cpal::SampleRate(48000),
        buffer_size: cpal::BufferSize::Default,
    })
}

#[cfg(target_os = "macos")]
pub fn inventory() -> Result<serde_json::Value> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let default = host.default_output_device().and_then(|d| d.name().ok());
    let devices = host
        .output_devices()?
        .filter_map(|device| {
            let name = device.name().ok()?;
            Some(serde_json::json!({"id":name,"name":name,"supported":config(&device).is_ok()}))
        })
        .collect::<Vec<_>>();
    Ok(serde_json::json!({"devices":devices,"default_device":default}))
}

#[cfg(test)]
mod tests {
    use super::*;
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
