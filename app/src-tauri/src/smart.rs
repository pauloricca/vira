//! Compact stereo bass-energy lookahead, built on the ordinary PCM loading thread.
//! This deliberately conservative heuristic identifies bass returns, not song labels.
use crate::timing::Grid;
use anyhow::{ensure, Result};
fn step() -> usize {
    crate::sample_rate::get() / 20
} // // 50 ms buckets; stereo power avoids phase cancellation.

#[derive(Default, serde::Serialize, serde::Deserialize)]
pub struct BassProfile {
    frames: usize,
    prefix: Vec<[f64; 2]>, // cumulative mean bass / full-band power
}
impl BassProfile {
    /// Version covers bucket spacing, filters and power calculation, independent of grid edits.
    pub fn cached(
        directory: &std::path::Path,
        artifact: &str,
        pcm_hash: &str,
        left: &[f32],
        right: &[f32],
        current: impl Fn() -> bool,
    ) -> Result<Self> {
        ensure!(current(), "Load superseded during bass lookahead");
        ensure!(
            left.len() == right.len(),
            "Bass profile requires matching stereo channels"
        );
        let rate = crate::sample_rate::get();
        let path = directory.join(format!("{artifact}-{pcm_hash}-{rate}-v1.json"));
        // Ignore corrupt/old cache files and bound reads before deserializing.
        let max_bytes = (left.len().div_ceil(step()) + 1) as u64 * 64 + 1024;
        if std::fs::metadata(&path).is_ok_and(|meta| meta.len() <= max_bytes) {
            if let Ok(bytes) = std::fs::read(&path) {
                if let Ok(profile) = serde_json::from_slice::<Self>(&bytes) {
                    if profile.frames == left.len()
                        && profile.prefix.len() == left.len().div_ceil(step()) + 1
                        && profile.prefix.first() == Some(&[0., 0.])
                        && profile
                            .prefix
                            .iter()
                            .flatten()
                            .all(|v| v.is_finite() && *v >= 0.)
                        && profile
                            .prefix
                            .windows(2)
                            .all(|p| p[1][0] >= p[0][0] && p[1][1] >= p[0][1])
                    {
                        ensure!(current(), "Load superseded during bass lookahead");
                        return Ok(profile);
                    }
                }
            }
        }
        let profile = Self::analyze(left, right, &current)?;
        ensure!(current(), "Load superseded during bass lookahead");
        // Persistence is best effort: an unwritable cache must never prevent playback.
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let temporary = path.with_extension(format!(
            "{}.{}.tmp",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        if std::fs::create_dir_all(directory).is_ok() {
            if let Ok(bytes) = serde_json::to_vec(&profile) {
                if std::fs::write(&temporary, bytes).is_ok() {
                    let _ = std::fs::rename(&temporary, &path);
                }
                let _ = std::fs::remove_file(&temporary);
            }
        }
        Ok(profile)
    }
    pub fn analyze(left: &[f32], right: &[f32], current: impl Fn() -> bool) -> Result<Self> {
        ensure!(
            left.len() == right.len(),
            "Bass profile requires matching stereo channels"
        );
        let mut prefix = Vec::with_capacity(left.len().div_ceil(step()) + 1);
        prefix.push([0., 0.]);
        let low_a = 1. - (-std::f64::consts::TAU * 220. / crate::sample_rate::get() as f64).exp();
        let high_a = 1. - (-std::f64::consts::TAU * 35. / crate::sample_rate::get() as f64).exp();
        let mut lp = [[0.; 2]; 2];
        let mut baseline = [0.; 2];
        for first in (0..left.len()).step_by(step()) {
            ensure!(current(), "Load superseded during bass lookahead");
            let end = (first + step()).min(left.len());
            let mut power = [0., 0.];
            for i in first..end {
                for (channel, x) in [left[i] as f64, right[i] as f64].into_iter().enumerate() {
                    lp[channel][0] += low_a * (x - lp[channel][0]);
                    lp[channel][1] += low_a * (lp[channel][0] - lp[channel][1]);
                    baseline[channel] += high_a * (lp[channel][1] - baseline[channel]);
                    let bass = lp[channel][1] - baseline[channel];
                    power[0] += bass * bass;
                    power[1] += x * x;
                }
            }
            let old = *prefix.last().unwrap();
            prefix.push(std::array::from_fn(|band| {
                old[band] + power[band] / (2. * (end - first) as f64)
            }));
        }
        Ok(Self {
            prefix,
            frames: left.len(),
        })
    }
    fn at(&self, seconds: f64, band: usize) -> f64 {
        let bucket = (seconds * crate::sample_rate::get() as f64 / step() as f64)
            .clamp(0., (self.prefix.len() - 1) as f64);
        let lo = bucket.floor() as usize;
        let hi = (lo + 1).min(self.prefix.len() - 1);
        self.prefix[lo][band] + (self.prefix[hi][band] - self.prefix[lo][band]) * bucket.fract()
    }
    fn mean(&self, start: f64, end: f64, band: usize) -> f64 {
        ((self.at(end, band) - self.at(start, band))
            / ((end - start) * crate::sample_rate::get() as f64 / step() as f64))
            .max(0.)
    }
    /// Return beats from the incoming cue, using the current grid rather than cached bar labels.
    /// At most 32 bar boundaries are inspected for the supported overlaps; no PCM reads here.
    pub fn drop_beat(&self, grid: Grid, cue: f64, overlap_beats: f64) -> Option<f64> {
        if self.prefix.len() < 2 || overlap_beats < 12. {
            return None;
        }
        let beat = 60. / grid.bpm;
        let bar = beat * 4.;
        let end = cue + overlap_beats * beat;
        let track_end = self.frames as f64 / crate::sample_rate::get() as f64;
        let first_bar = (grid.beat(cue + 2. * bar) / 4. - 1e-8).ceil() as i64;
        let mut best: Option<(f64, f64)> = None;
        for index in first_bar..first_bar + 32 {
            let time = grid.seconds(index as f64 * 4.);
            if time > end - beat {
                break;
            } // Leave a beat for the outgoing fade.
            if time - 2. * bar < cue - 1e-6 || time + 2. * bar > track_end {
                continue;
            }
            let before =
                self.mean(time - 2. * bar, time - bar, 0)
                    .max(self.mean(time - bar, time, 0));
            let after =
                self.mean(time, time + bar, 0)
                    .min(self.mean(time + bar, time + 2. * bar, 0));
            let attack = self.mean(time, time + beat, 0);
            let preceding_beat = self.mean(time - beat, time, 0);
            let total = self.mean(time, time + 2. * bar, 1);
            // Both preceding bars must be bass-light; both following bars must
            // sustain audible bass. An immediate return rejects slow swells and fills.
            if after < 0.015_f64.powi(2)
                || after < before * 4.
                || after < total * 0.12
                || attack < after * 0.5
                || attack < preceding_beat * 3.
            {
                continue;
            }
            let offset = (time - cue) / beat;
            let confidence = (after / before.max(1e-8)).min(100.);
            let score = confidence - (offset - overlap_beats / 2.).abs() * 0.001;
            if best.is_none_or(|(_, old)| score > old) {
                best = Some((offset, score));
            }
        }
        best.map(|(offset, _)| offset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persistent_profile_reuses_valid_data_and_recovers_from_corruption() {
        let directory =
            std::env::temp_dir().join(format!("vira-bass-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        let samples = vec![0.1; step() * 3];
        let fresh = BassProfile::cached(&directory, "artifact", "pcm", &samples, &samples, || true)
            .unwrap();
        let path = std::fs::read_dir(&directory)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        // A cache hit must not run the PCM analysis loop (which checks once per bucket).
        let calls = std::cell::Cell::new(0);
        let cached = BassProfile::cached(&directory, "artifact", "pcm", &samples, &samples, || {
            calls.set(calls.get() + 1);
            true
        })
        .unwrap();
        assert_eq!(calls.get(), 2);
        assert_eq!(fresh.prefix, cached.prefix);
        std::fs::write(&path, b"invalid json").unwrap();
        let recovered =
            BassProfile::cached(&directory, "artifact", "pcm", &samples, &samples, || true)
                .unwrap();
        assert_eq!(fresh.prefix, recovered.prefix);
        std::fs::write(&path, br#"{"frames":1,"prefix":[[0,0]]}"#).unwrap();
        let recovered =
            BassProfile::cached(&directory, "artifact", "pcm", &samples, &samples, || true)
                .unwrap();
        assert_eq!(fresh.prefix, recovered.prefix);
        assert!(
            BassProfile::cached(&directory, "artifact", "pcm", &samples, &samples, || false)
                .is_err()
        );
        let silence = vec![0.; samples.len()];
        let changed = BassProfile::cached(
            &directory,
            "artifact",
            "new-pcm",
            &silence,
            &silence,
            || true,
        )
        .unwrap();
        assert_ne!(fresh.prefix, changed.prefix);
        // A path occupied by a file is an unwritable cache, not a playback failure.
        assert!(BassProfile::cached(&path, "artifact", "pcm", &samples, &samples, || true).is_ok());
        std::fs::remove_dir_all(directory).unwrap();
    }
    fn profile(bass: impl Fn(f64) -> f64, right_only: bool) -> BassProfile {
        let mut left = Vec::new();
        let mut right = Vec::new();
        for i in 0..crate::sample_rate::get() * 20 {
            let t = i as f64 / crate::sample_rate::get() as f64;
            let x = (bass(t) * (std::f64::consts::TAU * 80. * t).sin()
                + 0.04 * (std::f64::consts::TAU * 8000. * t).sin()) as f32;
            left.push(if right_only { 0. } else { x });
            right.push(-x);
        }
        BassProfile::analyze(&left, &right, || true).unwrap()
    }
    fn grid() -> Grid {
        Grid {
            bpm: 120.,
            downbeat_seconds: 0.,
            reviewed: true,
        }
    }
    #[test]
    fn finds_sustained_bar_aligned_bass_return_in_stereo_and_right_channel() {
        for right_only in [false, true] {
            let p = profile(|t| if t < 6. { 0.002 } else { 0.25 }, right_only);
            assert_eq!(p.drop_beat(grid(), 0., 32.), Some(12.));
            assert_eq!(p.drop_beat(grid(), 2., 32.), Some(8.));
            assert_eq!(p.drop_beat(grid(), 0.5, 32.), Some(11.));
            let shifted = Grid {
                downbeat_seconds: 0.25,
                ..grid()
            };
            assert_eq!(p.drop_beat(shifted, 0., 32.), None);
            assert_eq!(p.drop_beat(grid(), 0., 8.), None);
            assert_eq!(p.drop_beat(grid(), 8., 32.), None);
        }
    }
    #[test]
    fn rejects_steady_bass_fills_swells_off_bar_returns_and_inaudible_changes() {
        for p in [
            profile(|_| 0.25, false),
            profile(
                |t| {
                    if (6. ..6.15).contains(&t) {
                        0.25
                    } else {
                        0.002
                    }
                },
                false,
            ),
            profile(|t| (0.25 * ((t - 2.) / 4.).clamp(0., 1.)).max(0.002), false),
            profile(|t| if t < 6.7 { 0.002 } else { 0.25 }, false),
            profile(|t| if t < 6. { 0.00001 } else { 0.001 }, false),
            profile(|t| if (4. ..6.).contains(&t) { 0.002 } else { 0.25 }, false),
        ] {
            assert_eq!(p.drop_beat(grid(), 0., 32.), None);
        }
    }
    #[test]
    fn cancelled_profile_work_stops_and_missing_data_falls_back() {
        assert!(BassProfile::analyze(&[0.; 8], &[0.; 8], || false).is_err());
        assert_eq!(BassProfile::default().drop_beat(grid(), 0., 32.), None);
    }
}
