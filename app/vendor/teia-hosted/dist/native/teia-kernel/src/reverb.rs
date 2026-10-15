//! Allocation-free plate and feedback delay network reverberators.
//!
//! The plate follows Jon Dattorro's figure-of-eight topology and reference
//! delays (Effect Design, Part 1, JAES 1997, at 29,761 Hz). This is an original
//! implementation, not copied library code. The FDN uses an orthonormal
//! eight-way Hadamard feedback matrix and frequency-dependent decay.

const PLATE: [f64; 12] = [
    142., 107., 379., 277., 672., 4453., 1800., 3720., 908., 4217., 2656., 3163.,
];
const FDN: [f64; 12] = [
    1499., 1601., 1867., 2053., 2251., 2399., 2647., 2909., 142., 107., 379., 277.,
];
pub(super) const STATE_COUNT: usize = 64;

struct Network<'a> {
    buffer: &'a mut [f32],
    state: &'a mut [f64],
    offsets: [usize; 12],
    lengths: [usize; 12],
    delays: [f64; 12],
}

impl Network<'_> {
    fn read(&self, line: usize, delay: f64) -> f64 {
        let length = self.lengths[line];
        let position =
            (self.state[line] - delay.clamp(1., (length - 2) as f64)).rem_euclid(length as f64);
        let index = position.floor() as usize;
        let fraction = position - index as f64;
        let offset = self.offsets[line];
        let a = self.buffer[offset + index] as f64;
        let b = self.buffer[offset + (index + 1) % length] as f64;
        a + (b - a) * fraction
    }

    fn write(&mut self, line: usize, value: f64) {
        let head = self.state[line] as usize;
        self.buffer[self.offsets[line] + head] = if value.is_finite() {
            value.clamp(-8., 8.) as f32
        } else {
            0.
        };
        self.state[line] = ((head + 1) % self.lengths[line]) as f64;
    }

    fn allpass(&mut self, line: usize, input: f64, gain: f64, modulation: f64) -> f64 {
        let delayed = self.read(line, self.delays[line] + modulation);
        let output = delayed - gain * input;
        self.write(line, input + gain * output);
        output
    }

    fn delay(&mut self, line: usize, input: f64) -> f64 {
        let output = self.read(line, self.delays[line]);
        self.write(line, input);
        output
    }

    fn lowpass(&mut self, index: usize, input: f64, coefficient: f64) -> f64 {
        self.state[index] += coefficient * (input - self.state[index]);
        self.state[index]
    }
}

pub(super) fn process(
    buffer: &mut [f32],
    state: &mut [f64],
    mode: usize,
    sample: f64,
    size: f64,
    decay: f64,
    sample_rate: f64,
) -> (f64, f64) {
    let rate = sample_rate.max(1.);
    let reference = if mode == 1 { &PLATE } else { &FDN };
    if state[31] != mode as f64 + 1. || state[29] != rate {
        // The topologies share a resource, so a mode switch starts a fresh tail.
        buffer.fill(0.);
        state.fill(0.);
        state[24] = size;
        state[29] = rate;
        state[31] = mode as f64 + 1.;
        let reference_rate = if mode == 1 { 29761. } else { 44100. };
        // Reserve maximum size, modulation and interpolation. At unusually high
        // sample rates, scale all lines together to fit the effect budget.
        let budget = (buffer.len() - 12 * 8) as f64;
        let tuning = (rate / reference_rate).min(budget / (reference.iter().sum::<f64>() * 1.35));
        state[25] = 1. - (-std::f64::consts::TAU * 6000. / rate).exp();
        state[26] = 1. - (-std::f64::consts::TAU * 12000. / rate).exp();
        state[27] = tuning;
        state[28] = std::f64::consts::TAU * 0.37 / rate;
        let mut offset = 0;
        for i in 0..12 {
            let length = (reference[i] * tuning * 1.35).ceil() as usize + 6;
            state[40 + i] = offset as f64;
            state[52 + i] = length as f64;
            offset += length;
        }
    }
    // Smoothed delay modulation, with expensive decay gains updated at control
    // rate rather than doing logarithms/powers for every line on every sample.
    state[24] += (size - state[24]) / (0.02 * rate).max(1.);
    let scale = 0.45 + state[24] * 0.9;
    let tuning = state[27];
    let mut lengths = [0; 12];
    let mut offsets = [0; 12];
    let mut delays = [0.; 12];
    for i in 0..12 {
        offsets[i] = state[40 + i] as usize;
        lengths[i] = state[52 + i] as usize;
        delays[i] = reference[i] * tuning * scale;
    }
    if state[30] == 0. {
        let rt60 = 0.2 + 18. * decay * decay;
        if mode == 1 {
            state[32] = 10_f64.powf(-3. * (delays[4..8].iter().sum::<f64>() / rate) / rt60);
            state[33] = 10_f64.powf(-3. * (delays[8..12].iter().sum::<f64>() / rate) / rt60);
        } else {
            for i in 0..8 {
                state[32 + i] = 10_f64.powf(-3. * (delays[i] / rate) / rt60);
            }
        }
    }
    state[30] = (state[30] + 1.) % 32.;
    let phase = state[23];
    state[23] = (phase + state[28]).rem_euclid(std::f64::consts::TAU);
    let damping = state[25];
    let bandwidth = state[26];
    let mut n = Network {
        buffer,
        state,
        offsets,
        lengths,
        delays,
    };
    let mut input = n.lowpass(22, sample * 0.5, bandwidth);
    if mode == 1 {
        for (line, gain) in [-0.75, -0.75, -0.625, -0.625].iter().enumerate() {
            input = n.allpass(line, input, *gain, 0.);
        }
        let feedback_left = n.state[20];
        let feedback_right = n.state[21];
        let gain_left = n.state[32];
        let gain_right = n.state[33];
        let modulation = (tuning * 8.).min(4.);
        let mut left = n.allpass(4, input + feedback_right, 0.7, phase.sin() * modulation);
        left = n.delay(5, left);
        left = n.lowpass(12, left, damping) * gain_left;
        left = n.allpass(6, left, -0.5, 0.);
        left = n.delay(7, left);
        let mut right = n.allpass(
            8,
            input + feedback_left,
            0.7,
            (phase + 1.7).sin() * modulation,
        );
        right = n.delay(9, right);
        right = n.lowpass(13, right, damping) * gain_right;
        right = n.allpass(10, right, -0.5, 0.);
        right = n.delay(11, right);
        n.state[20] = left;
        n.state[21] = right;
        // Signed, asymmetric taps decorrelate the two sides of the tank.
        let tap = |line, time| n.read(line, time * tuning * scale + 1.);
        let wet_left = tap(9, 266.) + tap(9, 2974.) - tap(10, 1913.) + tap(11, 1996.)
            - tap(5, 1990.)
            - tap(6, 187.)
            - tap(7, 1066.);
        let wet_right = tap(5, 353.) + tap(5, 3627.) - tap(6, 1228.) + tap(7, 2673.)
            - tap(9, 2111.)
            - tap(10, 335.)
            - tap(11, 121.);
        (wet_left * 0.35, wet_right * 0.35)
    } else {
        for line in 8..12 {
            input = n.allpass(line, input, 0.625, 0.);
        }
        let mut delayed = [0.; 8];
        for (i, value) in delayed.iter_mut().enumerate() {
            let modulation = (phase + i as f64).sin() * (tuning * 3.).min(2.);
            let read = n.read(i, n.delays[i] + modulation);
            *value = n.lowpass(12 + i, read, damping);
        }
        let left = (delayed[0] + delayed[1] - delayed[2] - delayed[3] + delayed[4] + delayed[5]
            - delayed[6]
            - delayed[7])
            * 0.3535533905932738;
        let right = (delayed[0] - delayed[1] + delayed[2] - delayed[3] - delayed[4] + delayed[5]
            - delayed[6]
            + delayed[7])
            * 0.3535533905932738;
        // Fast Walsh-Hadamard transform: normalized, energy-preserving mixing.
        for stride in [1, 2, 4] {
            for base in (0..8).step_by(stride * 2) {
                for j in 0..stride {
                    let a = delayed[base + j];
                    let b = delayed[base + j + stride];
                    delayed[base + j] = a + b;
                    delayed[base + j + stride] = a - b;
                }
            }
        }
        for (i, value) in delayed.iter().enumerate() {
            let gain = n.state[32 + i];
            n.write(
                i,
                input * 0.3535533905932738 + value * 0.3535533905932738 * gain,
            );
        }
        (left, right)
    }
}
