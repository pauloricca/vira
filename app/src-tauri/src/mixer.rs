//! Per-deck stereo trim, three-band kill EQ and bipolar filter at 48 kHz.
const RATE: f64 = 48_000.;
const RAMP: usize = 480; // 10 ms control ramps.

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
        let omega = std::f64::consts::TAU * hz / RATE;
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
        self.remaining = RAMP;
    }
    pub fn reset(&mut self) {
        self.low = Crossover::new(250.);
        self.upper = Crossover::new(2500.);
        self.low_phase = Crossover::new(2500.);
        for f in &mut self.filter {
            f.state = [[0.; 2]; 2];
        }
    }
    pub fn process(&mut self, input: [f32; 2]) -> [f32; 2] {
        if self.remaining > 0 {
            for i in 0..6 {
                self.current[i] += (self.target[i] - self.current[i]) / self.remaining as f64;
            }
            self.remaining -= 1;
        }
        let [trim, lo, mid, hi, position, wet] = self.current;
        // Recompute only every 16 frames, outside the native callback.
        if self.filter_tick == 0 {
            let hz = if position < 0. {
                20_000. * (30_f64 / 20_000.).powf(-position)
            } else {
                20. * (18_000_f64 / 20.).powf(position)
            };
            for f in &mut self.filter {
                f.tune(hz, position > 0.);
            }
        }
        self.filter_tick = (self.filter_tick + 1) % 16;
        std::array::from_fn(|channel| {
            let dry = input[channel] as f64 * trim;
            // Linkwitz-Riley 24 dB/oct crossovers, with phase compensation on low.
            let [low, upper] = self.low.split(dry, channel);
            let [middle, high] = self.upper.split(upper, channel);
            let low = self.low_phase.split(low, channel).iter().sum::<f64>();
            let eq = low * lo + middle * mid + high * hi;
            let x = dry * (1. - wet) + eq * wet;
            let mut filtered = x;
            for f in &mut self.filter {
                filtered = f.process(filtered, channel);
            }
            // Small center transition keeps exact bypass at zero without a jump.
            let blend = (position.abs() / 0.04).min(1.);
            (x * (1. - blend) + filtered * blend) as f32
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rms(settings: Settings, hz: f64) -> f64 {
        let mut dsp = MixerDsp::default();
        dsp.set(settings);
        let mut power = 0.;
        for i in 0..48_000 {
            let x = (std::f64::consts::TAU * hz * i as f64 / RATE).sin() as f32;
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
