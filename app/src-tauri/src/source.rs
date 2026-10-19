use crate::{service_response, valid_id};
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io::Read, sync::Arc};

pub const MAX_SOURCE_BYTES: usize = 256 * 1024 * 1024;

pub(crate) struct LoadPriority(String);
impl LoadPriority {
    pub(crate) fn begin() -> Result<Self> {
        let token = format!(
            "{:x}-{:x}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos()
        );
        service_response(
            "/v1/load-priority",
            Some(serde_json::json!({"token":token,"active":true})),
            true,
        )
        .map_err(anyhow::Error::msg)?;
        Ok(Self(token))
    }
}
impl Drop for LoadPriority {
    fn drop(&mut self) {
        let _ = service_response(
            "/v1/load-priority",
            Some(serde_json::json!({"token":self.0,"active":false})),
            true,
        );
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Prepared {
    pub schema_version: u32,
    pub conversion_version: String,
    pub settings: serde_json::Value,
    pub source_hash: String,
    pub artifact_id: String,
    pub track_id: String,
    pub title: String,
    pub artist: String,
    pub filename: String,
    pub frames: usize,
    pub duration_seconds: f64,
    /// Playable zero in source coordinates; file timestamps remain unchanged.
    #[serde(default)]
    pub start_seconds: f64,
    #[serde(default)]
    pub peak_frames: usize,
    #[serde(default)]
    pub peaks: Vec<[f32; 2]>,
    #[serde(default)]
    pub fine_peak_frames: usize,
    #[serde(default)]
    pub fine_peaks: Vec<[f32; 2]>,
    #[serde(default)]
    pub features: Vec<[f32; 2]>,
    #[serde(default)]
    pub fine_features: Vec<[f32; 2]>,
    pub pcm_hash: String,
    pub pcm_bytes: usize,
}

pub struct Source {
    pub(crate) bass_profile: crate::smart::BassProfile,
    pub left: Vec<f32>,
    pub right: Vec<f32>,
}
impl Source {
    pub fn len(&self) -> usize {
        self.left.len()
    }
    pub fn bytes(&self) -> usize {
        self.len() * 8
    }
}

impl Prepared {
    pub fn validate_audio(&self, track_id: &str, hash: &str) -> Result<()> {
        ensure!(
            self.schema_version == 1
                && self.conversion_version
                    == format!("ffmpeg-stereo-f32le-{}-v1", crate::sample_rate::get()),
            "Prepared audio version mismatch"
        );
        ensure!(
            self.track_id == track_id
                && self.source_hash == hash
                && valid_id(&self.artifact_id)
                && valid_id(&self.pcm_hash),
            "Prepared source identity mismatch"
        );
        ensure!(
            format!(
                "{:x}",
                Sha256::digest(
                    format!("{}{}", self.source_hash, self.conversion_version).as_bytes()
                )
            ) == self.artifact_id,
            "Prepared artifact does not match the source/conversion version"
        );
        ensure!(
            self.settings
                == serde_json::json!({"sample_rate":crate::sample_rate::get(),"channels":2,"format":"f32le"}),
            "Unsupported prepared PCM settings"
        );
        ensure!(
            self.frames > 0
                && self.frames <= MAX_SOURCE_BYTES / 8
                && self.frames.checked_mul(8) == Some(self.pcm_bytes),
            "Full-track preload exceeds the 256 MiB per-source development limit"
        );
        ensure!(
            self.duration_seconds.is_finite()
                && (self.duration_seconds - self.frames as f64 / crate::sample_rate::get() as f64)
                    .abs()
                    < 1e-6,
            "Prepared duration mismatch"
        );
        Ok(())
    }
    pub fn validate(&self, track_id: &str, hash: &str) -> Result<()> {
        self.validate_audio(track_id, hash)?;
        ensure!(
            self.peak_frames > 0
                && self.peaks.len() == self.frames.div_ceil(self.peak_frames)
                && self.peaks.len() <= 1024
                && self
                    .peaks
                    .iter()
                    .flatten()
                    .all(|v| v.is_finite() && *v >= 0.0),
            "Invalid waveform peaks"
        );
        ensure!(
            self.fine_peak_frames == crate::sample_rate::fine_frames()
                && self.fine_peaks.len() == self.frames.div_ceil(crate::sample_rate::fine_frames())
                && self
                    .fine_peaks
                    .iter()
                    .flatten()
                    .all(|v| v.is_finite() && *v >= 0.),
            "Invalid fine waveform peaks"
        );
        ensure!(
            (self.features.is_empty() || self.features.len() == self.peaks.len())
                && (self.fine_features.is_empty()
                    || self.fine_features.len() == self.fine_peaks.len())
                && self
                    .features
                    .iter()
                    .chain(self.fine_features.iter())
                    .flatten()
                    .all(|v| v.is_finite() && *v >= 0. && *v <= 1.),
            "Invalid waveform frequency features"
        );
        Ok(())
    }
    pub fn download(&self, current: impl Fn() -> bool) -> Result<Arc<Source>> {
        let mut response = service_response(
            &format!("/v1/prepared/{}/pcm", self.artifact_id),
            None,
            false,
        )
        .map_err(anyhow::Error::msg)?;
        ensure!(
            response.content_length() == Some(self.pcm_bytes as u64),
            "Prepared PCM download length mismatch"
        );
        let mut left = Vec::with_capacity(self.frames);
        let mut right = Vec::with_capacity(self.frames);
        let mut buffer = [0_u8; 65536];
        let mut remaining = self.pcm_bytes;
        let mut hash = Sha256::new();
        while remaining > 0 {
            ensure!(current(), "Load superseded by a newer selection");
            let length = remaining.min(buffer.len());
            response.read_exact(&mut buffer[..length])?;
            hash.update(&buffer[..length]);
            for frame in buffer[..length].chunks_exact(8) {
                let l = f32::from_le_bytes(frame[..4].try_into()?);
                let r = f32::from_le_bytes(frame[4..].try_into()?);
                ensure!(
                    l.is_finite() && r.is_finite(),
                    "Non-finite playback samples"
                );
                left.push(l);
                right.push(r);
            }
            remaining -= length;
        }
        ensure!(
            format!("{:x}", hash.finalize()) == self.pcm_hash,
            "Prepared PCM content hash mismatch; retry loading"
        );
        let bass_profile = crate::smart::BassProfile::analyze(&left, &right, current)?;
        Ok(Arc::new(Source {
            left,
            right,
            bass_profile,
        }))
    }
}

pub fn prepare_track(track_id: &str, request: Option<(usize, u64)>) -> Result<Prepared> {
    prepare(track_id, request, false)
}
pub fn prepare_playback(track_id: &str, deck: usize, generation: u64) -> Result<Prepared> {
    prepare(track_id, Some((deck, generation)), true)
}
pub fn prepare_audition(track_id: &str) -> Result<Prepared> {
    prepare(track_id, None, true)
}
fn prepare(track_id: &str, request: Option<(usize, u64)>, audition: bool) -> Result<Prepared> {
    ensure!(valid_id(track_id), "Loading requires a library track ID");
    let value = service_response(
        "/v1/prepare",
        Some({
            let mut body = match request {
                Some((deck, generation)) => {
                    serde_json::json!({"track_id":track_id,"deck":deck,"generation":generation})
                }
                None => serde_json::json!({"track_id":track_id}),
            };
            if audition {
                body["audition"] = serde_json::json!(true);
            }
            body["sample_rate"] = serde_json::json!(crate::sample_rate::get());
            body
        }),
        true,
    )
    .map_err(anyhow::Error::msg)?
    .json::<Prepared>()?;
    // Preparation resolves the current row and verifies source bytes before it
    // returns. Validate that descriptor directly, without a whole-library fetch.
    ensure!(valid_id(&value.source_hash), "Invalid prepared source hash");
    let expected_hash = &value.source_hash;
    if audition {
        value.validate_audio(track_id, expected_hash)?;
    } else {
        value.validate(track_id, expected_hash)?;
    }
    Ok(value)
}

#[cfg(test)]
mod rate_tests {
    use super::*;
    #[test]
    fn sample_rate_contract_rejects_audio_prepared_for_another_rate() {
        let rate = crate::sample_rate::get();
        let track = "a".repeat(64);
        let hash = "b".repeat(64);
        let version = format!("ffmpeg-stereo-f32le-{rate}-v1");
        let artifact = format!(
            "{:x}",
            Sha256::digest(format!("{hash}{version}").as_bytes())
        );
        let frames = rate * 2;
        let width = frames.div_ceil(1024);
        let mut prepared: Prepared = serde_json::from_value(serde_json::json!({
            "schema_version":1,"conversion_version":version,"settings":{"sample_rate":rate,"channels":2,"format":"f32le"},
            "source_hash":hash,"artifact_id":artifact,"track_id":track,"title":"Tone","artist":"","filename":"tone.wav",
            "frames":frames,"duration_seconds":2.,"peak_frames":width,"peaks":vec![[0.2,0.1];frames.div_ceil(width)],
            "fine_peak_frames":crate::sample_rate::fine_frames(),"fine_peaks":vec![[0.2,0.1];frames.div_ceil(crate::sample_rate::fine_frames())],
            "pcm_hash":"c".repeat(64),"pcm_bytes":frames*8
        })).unwrap();
        prepared.validate(&track, &hash).unwrap();
        prepared.settings["sample_rate"] =
            serde_json::json!(if rate == 44100 { 48000 } else { 44100 });
        assert!(prepared.validate_audio(&track, &hash).is_err());
    }
}
