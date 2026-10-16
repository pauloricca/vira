use crate::{service_response, valid_id, FileStatus};
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io::Read, sync::Arc};

pub const RATE: usize = 48000;
pub const MAX_SOURCE_BYTES: usize = 256 * 1024 * 1024;

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
            self.schema_version == 1 && self.conversion_version == "ffmpeg-stereo-f32le-48000-v1",
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
            self.settings == serde_json::json!({"sample_rate":48000,"channels":2,"format":"f32le"}),
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
                && (self.duration_seconds - self.frames as f64 / RATE as f64).abs() < 1e-6,
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
            self.fine_peak_frames == 240
                && self.fine_peaks.len() == self.frames.div_ceil(240)
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
pub fn prepare_audition(track_id: &str) -> Result<Prepared> {
    prepare(track_id, None, true)
}
fn prepare(track_id: &str, request: Option<(usize, u64)>, audition: bool) -> Result<Prepared> {
    ensure!(valid_id(track_id), "Loading requires a library track ID");
    let library = crate::library_state().map_err(anyhow::Error::msg)?;
    let track = library
        .tracks
        .iter()
        .find(|t| t.id == track_id && matches!(t.status, FileStatus::Ready))
        .ok_or_else(|| anyhow::anyhow!("Track is unavailable. Refresh the library"))?;
    let value = service_response(
        "/v1/prepare",
        Some(match request {
            Some((deck, generation)) => {
                serde_json::json!({"track_id":track_id,"deck":deck,"generation":generation})
            }
            None if audition => serde_json::json!({"track_id":track_id,"audition":true}),
            None => serde_json::json!({"track_id":track_id}),
        }),
        true,
    )
    .map_err(anyhow::Error::msg)?
    .json::<Prepared>()?;
    // The listing may not have identified this content yet. Preparation publishes
    // the verified hash on the same row; validate against that authoritative state.
    let identified;
    let expected_hash = if track.source_hash.as_deref() == Some(value.source_hash.as_str()) {
        track.source_hash.as_deref().unwrap()
    } else {
        identified = crate::library_state().map_err(anyhow::Error::msg)?;
        identified
            .tracks
            .iter()
            .find(|t| t.id == track_id)
            .and_then(|t| t.source_hash.as_deref())
            .ok_or_else(|| {
                anyhow::anyhow!("Source was replaced while preparing. Refresh the library")
            })?
    };
    if audition {
        value.validate_audio(track_id, expected_hash)?;
    } else {
        value.validate(track_id, expected_hash)?;
    }
    Ok(value)
}
