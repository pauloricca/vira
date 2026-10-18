//! Constant 4/4 grid. Source time and output sample time are distinct domains.
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Grid {
    pub bpm: f64,
    pub downbeat_seconds: f64,
    pub reviewed: bool,
}
impl Grid {
    pub fn validate(self, duration: f64) -> Result<Self> {
        ensure!(
            self.bpm.is_finite() && (30.0..=300.0).contains(&self.bpm),
            "Source BPM must be 30–300"
        );
        ensure!(
            self.downbeat_seconds.is_finite()
                && self.downbeat_seconds >= 0.
                && self.downbeat_seconds < duration,
            "Downbeat must lie within the source"
        );
        Ok(self)
    }
    pub fn beat(self, seconds: f64) -> f64 {
        (seconds - self.downbeat_seconds) * self.bpm / 60.
    }
    pub fn seconds(self, beat: f64) -> f64 {
        self.downbeat_seconds + beat * 60. / self.bpm
    }
    pub fn speed(self, target: f64) -> Result<f64> {
        let speed = target / self.bpm;
        ensure!(
            target.is_finite() && (15.0..=600.0).contains(&target),
            "Target BPM must be 15–600"
        );
        Ok(speed)
    }
    // Same phase modulo a bar, nearest valid position, earlier on an exact tie.
    pub fn align(self, current: f64, leader_beat: f64, duration: f64) -> Result<f64> {
        self.align_quantum(current, leader_beat, duration, 4.)
    }
    pub fn align_quantum(
        self,
        current: f64,
        leader_beat: f64,
        duration: f64,
        quantum: f64,
    ) -> Result<f64> {
        self.align_quantum_from(current, leader_beat, 0., duration, quantum)
    }
    pub fn align_quantum_from(
        self,
        current: f64,
        leader_beat: f64,
        start: f64,
        duration: f64,
        quantum: f64,
    ) -> Result<f64> {
        let phase = leader_beat.rem_euclid(quantum);
        // The playable start is rounded to a source frame. Keep the first
        // grid boundary eligible when it rounds to that same frame.
        let rounding = self.bpm / (60. * 48000. * 2. * quantum) + 1e-12;
        let low = ((self.beat(start) - phase) / quantum - rounding).ceil();
        let high = ((self.beat(duration - 1. / 48000.) - phase) / quantum).floor();
        ensure!(low <= high, "No matching bar phase lies within this source");
        let bar = ((self.beat(current) - phase) / quantum + 0.5 - 1e-12)
            .floor()
            .clamp(low, high);
        Ok(self.seconds(bar * quantum + phase).max(start))
    }
}
/// A stable source-frame anchor evaluated against output samples, never a rounded beat increment.
#[derive(Clone, Copy, Debug)]
pub struct Transport {
    pub output: u64,
    pub source: f64,
    pub speed: f64,
}
impl Transport {
    pub fn at(self, output: u64) -> f64 {
        self.source + (output - self.output) as f64 * self.speed
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mappings_both_directions_and_negative_bars() {
        let grid = Grid {
            bpm: 120.,
            downbeat_seconds: 2.,
            reviewed: true,
        };
        assert_eq!(grid.beat(0.), -4.);
        for speed in [0.5, 0.8, 1., 1.25, 2.] {
            let t = Transport {
                output: 123,
                source: 48000.,
                speed,
            };
            assert_eq!(t.at(48123), 48000. + 48000. * speed);
            assert!((grid.speed(120. * speed).unwrap() - speed).abs() < 1e-12);
            assert!((grid.seconds(grid.beat(23.456)) - 23.456).abs() < 1e-12);
        }
        assert!(grid.speed(241.).is_ok());
        for target in [0., 14.99, 600.01, f64::NAN, f64::INFINITY] {
            assert!(grid.speed(target).is_err());
        }
        for bpm in [30., 120., 300.] {
            for target in [15., 60., 300., 600.] {
                let source = Grid { bpm, ..grid };
                assert_eq!(source.speed(target).unwrap(), target / bpm);
            }
        }
        assert!(Grid {
            bpm: f64::NAN,
            ..grid
        }
        .validate(10.)
        .is_err());
    }
    #[test]
    fn nearest_phase_is_not_same_song_bar_and_respects_boundaries() {
        let grid = Grid {
            bpm: 120.,
            downbeat_seconds: 0.,
            reviewed: true,
        };
        assert_eq!(grid.align(101., 0., 200.).unwrap(), 100.);
        assert_eq!(grid.align_quantum(101., 0., 200., 1.).unwrap(), 101.);
        assert_eq!(grid.align(199.9, 1., 200.).unwrap(), 198.5);
        assert!(grid.align(0., 3., 0.1).is_err());
        let offset = Grid {
            downbeat_seconds: 0.2555542936878912,
            ..grid
        };
        let start = (offset.downbeat_seconds * 48000.).round() / 48000.;
        assert_eq!(
            offset
                .align_quantum_from(start, 0., start, 10., 4.)
                .unwrap(),
            start
        );
    }
}
