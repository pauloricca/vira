//! Minimal ownership wrapper for the pinned Rubber Band 4.0 C ABI.
use crate::metrics::Timing;
use std::ffi::c_void;
use std::time::Instant;
type State = *mut c_void;
extern "C" {
    fn rubberband_new(rate: u32, channels: u32, options: i32, time: f64, pitch: f64) -> State;
    fn rubberband_delete(s: State);
    fn rubberband_reset(s: State);
    fn rubberband_get_engine_version(s: State) -> i32;
    fn rubberband_set_time_ratio(s: State, r: f64);
    fn rubberband_set_pitch_scale(s: State, p: f64);
    fn rubberband_get_preferred_start_pad(s: State) -> u32;
    fn rubberband_get_start_delay(s: State) -> u32;
    fn rubberband_set_max_process_size(s: State, n: u32);
    fn rubberband_process(s: State, input: *const *const f32, n: u32, last: i32);
    fn rubberband_available(s: State) -> i32;
    fn rubberband_retrieve(s: State, output: *const *mut f32, n: u32) -> u32;
}
pub const CHUNK: usize = 512;
pub struct Dsp {
    state: State,
    pub calls: Timing,
}
// Ownership may move from a preparation thread to the producer/retirement thread.
// A DSP instance is never accessed concurrently and is deliberately not Sync.
unsafe impl Send for Dsp {}
impl Dsp {
    pub fn new(engine: u32, speed: f64, semitones: f64) -> Self {
        assert!([2, 3].contains(&engine));
        // Full 15–600 target BPM range for every supported 30–300 source grid.
        assert!(speed.is_finite() && (0.05..=20.0).contains(&speed));
        assert!(semitones.is_finite() && (-12.0..=12.0).contains(&semitones));
        // Real-time, no native threading, linked stereo, consistent pitch mode.
        let options =
            1 | 0x10000 | 0x10000000 | 0x04000000 | if engine == 3 { 0x20000000 } else { 0 };
        let state = unsafe {
            rubberband_new(
                crate::sample_rate::get() as u32,
                2,
                options,
                1.0 / speed,
                2_f64.powf(semitones / 12.0),
            )
        };
        assert!(!state.is_null());
        unsafe {
            assert_eq!(rubberband_get_engine_version(state), engine as i32);
            rubberband_set_max_process_size(state, CHUNK as u32);
        }
        Self {
            state,
            calls: Timing::default(),
        }
    }
    pub fn reset(&mut self) {
        unsafe {
            rubberband_reset(self.state);
            // R2 reset clears this bound; restore it before any further process calls.
            rubberband_set_max_process_size(self.state, CHUNK as u32);
        }
    }
    pub fn ratios(&mut self, speed: f64, semitones: f64) {
        unsafe {
            rubberband_set_time_ratio(self.state, 1.0 / speed);
            rubberband_set_pitch_scale(self.state, 2_f64.powf(semitones / 12.0));
        }
    }
    pub fn padding(&self) -> usize {
        unsafe { rubberband_get_preferred_start_pad(self.state) as usize }
    }
    pub fn delay(&self) -> usize {
        unsafe { rubberband_get_start_delay(self.state) as usize }
    }
    pub fn available(&self) -> i32 {
        unsafe { rubberband_available(self.state) }
    }
    pub fn process(&mut self, l: &[f32], r: &[f32], last: bool) {
        assert_eq!(l.len(), r.len());
        assert!(l.len() <= CHUNK);
        let p = [l.as_ptr(), r.as_ptr()];
        let t = Instant::now();
        unsafe { rubberband_process(self.state, p.as_ptr(), l.len() as u32, last as i32) }
        self.calls.add(t.elapsed().as_nanos() as u64);
    }
    pub fn retrieve(&mut self, l: &mut [f32], r: &mut [f32]) -> usize {
        assert_eq!(l.len(), r.len());
        let n = l.len().min(self.available().max(0) as usize);
        let p = [l.as_mut_ptr(), r.as_mut_ptr()];
        unsafe { rubberband_retrieve(self.state, p.as_ptr(), n as u32) as usize }
    }
    pub fn boundary_probe(&self, count: u32) -> u64 {
        let t = Instant::now();
        for _ in 0..count {
            std::hint::black_box(self.available());
        }
        t.elapsed().as_nanos() as u64
    }
}
impl Drop for Dsp {
    fn drop(&mut self) {
        unsafe { rubberband_delete(self.state) }
    }
}
