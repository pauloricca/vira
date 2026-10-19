//! Audio-clock selection using channel sound after EQ and the channel fader,
//! before crossfader/master gain. A 100 ms energy envelope avoids sample chatter.
pub struct Tracker {
    alpha: f64,
    playing: [bool; 2],
    energy: [f64; 2],
    weight: [f64; 2],
    last_started: usize,
    selected: usize,
}
impl Default for Tracker {
    fn default() -> Self {
        Self {
            alpha: 1. - (-1. / (crate::sample_rate::get() as f64 * 0.1)).exp(),
            playing: [false; 2],
            energy: [0.; 2],
            weight: [0.; 2],
            last_started: 0,
            selected: 0,
        }
    }
}
impl Tracker {
    pub fn observe(&mut self, playing: [bool; 2], samples: [[f32; 2]; 2]) {
        let alpha = self.alpha;
        for d in 0..2 {
            if playing[d] && !self.playing[d] {
                self.last_started = d;
                self.energy[d] = 0.;
                self.weight[d] = 0.;
            }
            if playing[d] {
                let power = samples[d]
                    .iter()
                    .map(|s| {
                        if s.is_finite() {
                            (*s as f64).powi(2)
                        } else {
                            0.
                        }
                    })
                    .sum::<f64>()
                    / 2.;
                self.energy[d] += alpha * (power - self.energy[d]);
                self.weight[d] += alpha * (1. - self.weight[d]);
            }
        }
        self.playing = playing;
    }
    pub fn selected(&mut self) -> usize {
        self.selected = match self.playing {
            [true, false] => 0,
            [false, true] => 1,
            [true, true] => {
                let a = self.energy[0] / self.weight[0].max(f64::MIN_POSITIVE);
                let b = self.energy[1] / self.weight[1].max(f64::MIN_POSITIVE);
                if (a - b).abs() <= 1e-12 + a.max(b) * 1e-6 {
                    self.last_started
                } else {
                    usize::from(b > a)
                }
            }
            [false, false] => self.selected,
        };
        self.selected
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sole_playing_deck_wins_even_when_silent_and_stopped_holds_target() {
        let mut t = Tracker::default();
        t.observe([false, true], [[1.; 2], [0.; 2]]);
        assert_eq!(t.selected(), 1);
        t.observe([false, false], [[0.; 2]; 2]);
        assert_eq!(t.selected(), 1);
        t.observe([true, false], [[0.; 2], [1.; 2]]);
        assert_eq!(t.selected(), 0);
    }
    #[test]
    fn measures_actual_stereo_channel_energy_and_latest_start_breaks_ties() {
        let mut t = Tracker::default();
        t.observe([true, false], [[0.5; 2], [0.; 2]]);
        assert_eq!(t.selected(), 0);
        t.observe([true, true], [[0.5; 2]; 2]);
        assert_eq!(t.selected(), 1);
        for _ in 0..24000 {
            t.observe([true, true], [[0.8, 0.], [0.1; 2]]);
        }
        assert_eq!(t.selected(), 0);
        t.observe([false, true], [[0.; 2], [0.5; 2]]);
        t.observe([true, true], [[0.5; 2]; 2]);
        for _ in 0..96000 {
            t.observe([true, true], [[0.5; 2]; 2]);
        }
        assert_eq!(t.selected(), 0);
    }
}
