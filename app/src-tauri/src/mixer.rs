//! Per-deck stereo trim, three-band kill EQ and bipolar filter at the engine sample rate.
fn ramp() -> usize {
    crate::sample_rate::get() / 100
} // 10 ms control ramps.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Settings {
    pub trim: f32,    // dB, -12 .. +12
    pub eq: [f32; 3], // normalized low/mid/high: 0 = kill, .5 = unity, 1 = +6 dB
    pub filter: f32,  // -1 = low pass, 0 = bypass, +1 = high pass
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            trim: 0.,
            eq: [0.5; 3],
            filter: 0.,
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Biquad {
    coefficients: [f64; 5],
    state: [[f64; 2]; 2],
}
impl Biquad {
    fn tune(&mut self, hz: f64, high: bool) {
        let omega = std::f64::consts::TAU * hz / crate::sample_rate::get() as f64;
        let c = omega.cos();
        let alpha = omega.sin() / std::f64::consts::SQRT_2;
        let a = 1. + alpha;
        let b = if high { (1. + c) / 2. } else { (1. - c) / 2. };
        self.coefficients = [
            b / a,
            (if high { -2. } else { 2. }) * b / a,
            b / a,
            -2. * c / a,
            (1. - alpha) / a,
        ];
    }
    fn process(&mut self, x: f64, channel: usize) -> f64 {
        let [b0, b1, b2, a1, a2] = self.coefficients;
        let s = &mut self.state[channel];
        let y = b0 * x + s[0];
        s[0] = b1 * x - a1 * y + s[1];
        s[1] = b2 * x - a2 * y;
        y
    }
}
#[derive(Default)]
struct Crossover {
    low: [Biquad; 2],
    high: [Biquad; 2],
}
impl Crossover {
    fn new(hz: f64) -> Self {
        let mut s = Self::default();
        for f in &mut s.low {
            f.tune(hz, false);
        }
        for f in &mut s.high {
            f.tune(hz, true);
        }
        s
    }
    fn split(&mut self, x: f64, channel: usize) -> [f64; 2] {
        let mut l = x;
        let mut h = x;
        for f in &mut self.low {
            l = f.process(l, channel);
        }
        for f in &mut self.high {
            h = f.process(h, channel);
        }
        [l, h]
    }
}

pub struct MixerDsp {
    pub settings: Settings,
    low: Crossover,
    upper: Crossover,
    low_phase: Crossover,
    filter: [Biquad; 2],
    current: [f64; 6], // trim, band amplitudes, filter position, EQ wet blend
    target: [f64; 6],
    remaining: usize,
    filter_tick: usize,
    filter_position: Option<f64>,
    filter_high: bool,
    eq_running: bool,
    filter_running: bool,
    eq_startup: usize,
    filter_startup: usize,
    filter_blend: f64,
}
impl Default for MixerDsp {
    fn default() -> Self {
        Self {
            settings: Settings::default(),
            low: Crossover::new(250.),
            upper: Crossover::new(2500.),
            low_phase: Crossover::new(2500.),
            filter: [Biquad::default(); 2],
            current: [1., 1., 1., 1., 0., 0.],
            target: [1., 1., 1., 1., 0., 0.],
            remaining: 0,
            filter_tick: 0,
            filter_position: None,
            filter_high: false,
            eq_running: false,
            filter_running: false,
            eq_startup: 0,
            filter_startup: 0,
            filter_blend: 0.,
        }
    }
}
pub fn band_amplitude(value: f32) -> f64 {
    if value <= 0.5 {
        (value as f64 * 2.).powi(2)
    } else {
        10_f64.powf((value as f64 - 0.5) * 12. / 20.)
    }
}
impl MixerDsp {
    fn tune_filter(&mut self, position: f64) {
        if self.filter_position == Some(position) {
            return;
        }
        let hz = if position < 0. {
            20_000. * (30_f64 / 20_000.).powf(-position)
        } else {
            20. * (18_000_f64 / 20.).powf(position)
        };
        self.filter[0].tune(hz, position > 0.);
        self.filter[1].coefficients = self.filter[0].coefficients;
        self.filter_position = Some(position);
        self.filter_high = position > 0.;
    }
    pub fn set(&mut self, settings: Settings) {
        self.settings = settings;
        self.target = [
            10_f64.powf(settings.trim as f64 / 20.),
            band_amplitude(settings.eq[0]),
            band_amplitude(settings.eq[1]),
            band_amplitude(settings.eq[2]),
            settings.filter as f64,
            if settings.eq == [0.5; 3] { 0. } else { 1. },
        ];
        self.remaining = ramp();
    }
    pub fn reset(&mut self) {
        self.reset_eq();
        for f in &mut self.filter {
            f.state = [[0.; 2]; 2];
        }
        self.eq_running = false;
        self.filter_running = false;
        self.filter_blend = 0.;
    }
    fn reset_eq(&mut self) {
        for crossover in [&mut self.low, &mut self.upper, &mut self.low_phase] {
            for f in crossover.low.iter_mut().chain(crossover.high.iter_mut()) {
                f.state = [[0.; 2]; 2];
            }
        }
    }
    fn advance_controls(&mut self) {
        if self.remaining > 0 {
            for i in 0..6 {
                self.current[i] += (self.target[i] - self.current[i]) / self.remaining as f64;
            }
            self.remaining -= 1;
            if self.remaining == 0 {
                // Land exactly on neutral so processing can be bypassed.
                self.current = self.target;
            }
        }
    }
    fn startup_blend(remaining: &mut usize) -> f64 {
        let blend = 1. - *remaining as f64 / ramp() as f64;
        *remaining = remaining.saturating_sub(1);
        blend
    }
    fn prepare_eq(&mut self, wet: f64) -> f64 {
        if wet == 0. {
            self.eq_running = false;
            return 0.;
        }
        if !self.eq_running {
            self.reset_eq();
            self.eq_startup = ramp();
            self.eq_running = true;
        }
        wet * Self::startup_blend(&mut self.eq_startup)
    }
    fn prepare_filter(&mut self, position: f64) -> f64 {
        if position == 0. {
            self.filter_running = false;
            self.filter_blend = 0.;
            return 0.;
        }
        // A sign change replaces the entire transfer function. Keep the old
        // coefficients/history together until they have faded fully to dry,
        // even when the control ramp skips exactly zero between samples.
        if self.filter_running && self.filter_high != (position > 0.) {
            self.filter_blend = (self.filter_blend - 1. / ramp() as f64).max(0.);
            if self.filter_blend > 0. {
                return self.filter_blend;
            }
            self.filter_running = false;
        }
        if !self.filter_running {
            for f in &mut self.filter {
                f.state = [[0.; 2]; 2];
            }
            self.filter_tick = 0;
            self.filter_startup = ramp();
            self.filter_running = true;
        }
        if self.filter_tick == 0 {
            self.tune_filter(position);
        }
        self.filter_tick = (self.filter_tick + 1) % 16;
        // Fade fresh filter history into the dry signal over 10 ms.
        let desired =
            (position.abs() / 0.04).min(1.) * Self::startup_blend(&mut self.filter_startup);
        self.filter_blend = desired.min(self.filter_blend + 1. / ramp() as f64);
        self.filter_blend
    }
    fn eq_sample(&mut self, x: f64, channel: usize, wet: f64) -> f64 {
        if !self.eq_running {
            return x;
        }
        let [_, lo, mid, hi, _, _] = self.current;
        let [low, upper] = self.low.split(x, channel);
        let [middle, high] = self.upper.split(upper, channel);
        let low = self.low_phase.split(low, channel).iter().sum::<f64>();
        x * (1. - wet) + (low * lo + middle * mid + high * hi) * wet
    }
    fn filter_sample(&mut self, x: f64, channel: usize, blend: f64) -> f64 {
        if !self.filter_running {
            return x;
        }
        let mut filtered = x;
        for f in &mut self.filter {
            filtered = f.process(filtered, channel);
        }
        x * (1. - blend) + filtered * blend
    }
    // Separate processors for editable graph stages. Each owns independent state.
    pub fn process_stage(&mut self, input: [f32; 2], stage: u8) -> [f32; 2] {
        self.advance_controls();
        let wet = if stage == 1 {
            self.prepare_eq(self.current[5])
        } else {
            0.
        };
        let blend = if stage >= 2 {
            self.prepare_filter(self.current[4])
        } else {
            0.
        };
        std::array::from_fn(|channel| {
            let x = input[channel] as f64;
            match stage {
                0 => (x * self.current[0]) as f32,
                1 => self.eq_sample(x, channel, wet) as f32,
                _ => self.filter_sample(x, channel, blend) as f32,
            }
        })
    }
    pub fn process(&mut self, input: [f32; 2]) -> [f32; 2] {
        self.advance_controls();
        let wet = self.prepare_eq(self.current[5]);
        let blend = self.prepare_filter(self.current[4]);
        std::array::from_fn(|channel| {
            let dry = input[channel] as f64 * self.current[0];
            let x = self.eq_sample(dry, channel, wet);
            self.filter_sample(x, channel, blend) as f32
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn render(dsp: &mut MixerDsp, input: [f32; 2], stage: Option<u8>) -> [f32; 2] {
        match stage {
            Some(stage) => dsp.process_stage(input, stage),
            None => dsp.process(input),
        }
    }
    fn histories(dsp: &MixerDsp) -> Vec<[[f64; 2]; 2]> {
        [&dsp.low, &dsp.upper, &dsp.low_phase]
            .into_iter()
            .flat_map(|c| c.low.iter().chain(c.high.iter()))
            .chain(dsp.filter.iter())
            .map(|f| f.state)
            .collect()
    }
    #[test]
    fn neutral_bypasses_preserve_samples_and_freeze_histories() {
        for stage in [None, Some(1), Some(2)] {
            let mut dsp = MixerDsp::default();
            dsp.set(Settings {
                eq: [0.7, 0.2, 0.8],
                filter: -0.6,
                ..Settings::default()
            });
            for _ in 0..ramp() * 3 {
                render(&mut dsp, [0.3, -0.2], stage);
            }
            dsp.set(Settings::default());
            for _ in 0..ramp() {
                render(&mut dsp, [0.3, -0.2], stage);
            }
            assert!(!dsp.eq_running && !dsp.filter_running);
            let before = histories(&dsp);
            let coefficients = dsp.filter_position;
            for i in 0..ramp() * 3 {
                let input = [(i as f32 * 0.13).sin(), (i as f32 * 0.07).cos()];
                assert_eq!(render(&mut dsp, input, stage), input);
            }
            assert_eq!(
                histories(&dsp),
                before,
                "bypassed DSP must do no filter work"
            );
            assert_eq!(dsp.filter_position, coefficients);
        }
    }
    #[test]
    fn reactivation_discards_old_history_and_fades_from_dry() {
        for stage in [None, Some(1), Some(2)] {
            for position in [-0.8, 0.8] {
                let active = Settings {
                    eq: [0.2, 0.7, 0.9],
                    filter: position,
                    ..Settings::default()
                };
                let mut used = MixerDsp::default();
                used.set(active);
                for _ in 0..ramp() * 3 {
                    render(&mut used, [0.8, -0.7], stage);
                }
                used.set(Settings::default());
                for _ in 0..ramp() * 3 {
                    render(&mut used, [-0.4, 0.6], stage);
                }
                let mut fresh = MixerDsp::default();
                used.set(active);
                fresh.set(active);
                let input = [0.3, -0.2];
                let mut previous = input;
                for i in 0..ramp() * 3 {
                    let actual = render(&mut used, input, stage);
                    assert_eq!(actual, render(&mut fresh, input, stage));
                    if i == 0 {
                        assert_eq!(actual, input);
                    }
                    for channel in 0..2 {
                        assert!(actual[channel].is_finite());
                        assert!(
                            (actual[channel] - previous[channel]).abs() < 0.02,
                            "reactivation step: {:?} -> {:?}",
                            previous,
                            actual
                        );
                    }
                    previous = actual;
                }
            }
        }
    }

    #[test]
    fn fast_midpoint_crossings_switch_history_only_while_dry() {
        for stage in [None, Some(2)] {
            for start in [-0.71_f32, 0.67, -0.071, 0.067] {
                let extent = if start.abs() > 0.1 { 1. } else { 0.1 };
                let mut dsp = MixerDsp::default();
                dsp.set(Settings {
                    filter: start,
                    ..Settings::default()
                });
                let mut previous = [0.; 2];
                let mut switches = 0;
                for i in 0..ramp() * 24 {
                    // Unequal endpoints skip exact zero; repeated reversals
                    // also exercise a new gesture during a pending fade.
                    if [6, 9, 10, 14, 18].contains(&(i / ramp())) && i % ramp() == 0 {
                        let destination = if dsp.settings.filter < 0. {
                            0.67 * extent
                        } else {
                            -0.71 * extent
                        };
                        dsp.set(Settings {
                            filter: destination,
                            ..Settings::default()
                        });
                    }
                    let old_position = dsp.filter_position;
                    let phase =
                        std::f64::consts::TAU * 80. * i as f64 / crate::sample_rate::get() as f64;
                    let input = [(phase.sin() * 0.5) as f32, (phase.cos() * 0.3) as f32];
                    let output = render(&mut dsp, input, stage);
                    if let (Some(old), Some(new)) = (old_position, dsp.filter_position) {
                        if old.is_sign_positive() != new.is_sign_positive() {
                            switches += 1;
                            assert_eq!(output, input, "mode changes must be inaudible at dry");
                            assert_eq!(dsp.filter_blend, 0.);
                        }
                    }
                    if i > 0 {
                        for channel in 0..2 {
                            assert!(output[channel].is_finite());
                            if extent < 1. {
                                assert!(
                                    (output[channel] - previous[channel]).abs() < 0.03,
                                    "midpoint transient at sample {i}: {previous:?} -> {output:?}"
                                );
                            }
                        }
                    }
                    previous = output;
                }
                assert!(switches >= 3, "exercise both directions repeatedly");
            }
        }
    }

    #[test]
    fn cached_filter_matches_recomputed_coefficients_during_sweeps_and_resets() {
        for stage in [false, true] {
            let mut cached = MixerDsp::default();
            let mut reference = MixerDsp::default();
            for i in 0..6000 {
                if i % 1500 == 0 {
                    let settings = Settings {
                        filter: [0.7, -0.4, 0., 0.2][i / 1500],
                        ..Settings::default()
                    };
                    cached.set(settings);
                    reference.set(settings);
                }
                if i == 4100 {
                    cached.reset();
                    reference.reset();
                }
                reference.filter_position = None;
                let input = [(i as f32 * 0.17).sin(), (i as f32 * 0.03).cos()];
                let actual = if stage {
                    cached.process_stage(input, 2)
                } else {
                    cached.process(input)
                };
                let expected = if stage {
                    reference.process_stage(input, 2)
                } else {
                    reference.process(input)
                };
                assert_eq!(actual, expected);
            }
        }
    }

    fn rms(settings: Settings, hz: f64) -> f64 {
        let mut dsp = MixerDsp::default();
        dsp.set(settings);
        let mut power = 0.;
        for i in 0..48_000 {
            let x = (std::f64::consts::TAU * hz * i as f64 / crate::sample_rate::get() as f64).sin()
                as f32;
            let y = dsp.process([x, 0.]);
            assert!(y.iter().all(|s| s.is_finite()));
            assert_eq!(y[1], 0.);
            if i >= 24_000 {
                power += (y[0] as f64).powi(2);
            }
        }
        (power / 24_000.).sqrt()
    }
    #[test]
    fn unity_trim_and_full_kill() {
        let s = Settings::default();
        assert!((rms(s, 1000.) - 0.5_f64.sqrt()).abs() < 1e-5);
        assert!(
            (rms(Settings { trim: 6., ..s }, 1000.) / rms(s, 1000.) - 10_f64.powf(6. / 20.)).abs()
                < 1e-5
        );
        assert_eq!(rms(Settings { eq: [0.; 3], ..s }, 1000.), 0.);
        assert_eq!(band_amplitude(0.), 0.);
        assert!((band_amplitude(1.) - 10_f64.powf(6. / 20.)).abs() < 1e-10);
    }
    #[test]
    fn kills_are_frequency_selective_and_filter_has_correct_polarity() {
        let s = Settings::default();
        for (band, hz) in [(0, 40.), (1, 800.), (2, 12000.)] {
            let mut eq = s.eq;
            eq[band] = 0.;
            assert!(rms(Settings { eq, ..s }, hz) < rms(s, hz) * 0.1);
        }
        let lp = Settings { filter: -1., ..s };
        let hp = Settings { filter: 1., ..s };
        assert!(rms(lp, 10000.) < rms(lp, 20.) * 0.01);
        assert!(rms(hp, 50.) < rms(hp, 21000.) * 0.01);
    }
}
