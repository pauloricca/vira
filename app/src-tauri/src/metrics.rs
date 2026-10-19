use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
// 10 us histogram bins through 100 ms, plus overflow. No callback allocations.
const BINS: usize = 10001;
pub struct Timing {
    bins: Vec<u64>,
    pub count: u64,
    pub sum: u64,
    pub max: u64,
}
impl Default for Timing {
    fn default() -> Self {
        Self {
            bins: vec![0; BINS],
            count: 0,
            sum: 0,
            max: 0,
        }
    }
}
impl Timing {
    pub fn add(&mut self, ns: u64) {
        self.bins[((ns / 10000) as usize).min(BINS - 1)] += 1;
        self.count += 1;
        self.sum += ns;
        self.max = self.max.max(ns);
    }
    pub fn report(&self) -> Value {
        report(&self.bins, self.count, self.sum, self.max)
    }
}
fn report(bins: &[u64], count: u64, sum: u64, max: u64) -> Value {
    if count == 0 {
        return json!({"count":0,"mean_us":null,"p50_upper_us":null,"p95_upper_us":null,"p99_upper_us":null,"max_us":null});
    }
    let percentile = |p: f64| {
        let target = (count as f64 * p).ceil() as u64;
        let mut n = 0;
        for (i, b) in bins.iter().enumerate() {
            n += b;
            if n >= target {
                return ((i + 1) * 10) as u64;
            }
        }
        0
    };
    json!({"count":count,"mean_us":if count > 0 {sum as f64/count as f64/1000.0} else {0.0},"p50_upper_us":percentile(0.5),"p95_upper_us":percentile(0.95),"p99_upper_us":percentile(0.99),"max_us":max as f64/1000.0,"histogram_bin_us":10,"histogram_overflow_at_us":100000})
}
pub struct CallbackStats {
    bins: Vec<AtomicU64>,
    count: AtomicU64,
    sum: AtomicU64,
    max: AtomicU64,
    pub overruns: AtomicU64,
    pub starved_frames: AtomicU64,
    pub device_errors: AtomicU64,
    pub frames: AtomicU64,
    pub min_frames: AtomicU64,
    pub max_frames: AtomicU64,
}
impl Default for CallbackStats {
    fn default() -> Self {
        Self {
            bins: (0..BINS).map(|_| AtomicU64::new(0)).collect(),
            count: 0.into(),
            sum: 0.into(),
            max: 0.into(),
            overruns: 0.into(),
            starved_frames: 0.into(),
            device_errors: 0.into(),
            frames: 0.into(),
            min_frames: u64::MAX.into(),
            max_frames: 0.into(),
        }
    }
}
impl CallbackStats {
    pub fn record(&self, ns: u64, frames: u64) {
        self.bins[((ns / 10000) as usize).min(BINS - 1)].fetch_add(1, Relaxed);
        self.count.fetch_add(1, Relaxed);
        self.sum.fetch_add(ns, Relaxed);
        self.max.fetch_max(ns, Relaxed);
        self.min_frames.fetch_min(frames, Relaxed);
        self.max_frames.fetch_max(frames, Relaxed);
        if ns > frames * 1_000_000_000 / crate::sample_rate::get() as u64 {
            self.overruns.fetch_add(1, Relaxed);
        }
    }
    pub fn report(&self) -> Value {
        json!({"execution":report(&self.bins.iter().map(|v|v.load(Relaxed)).collect::<Vec<_>>(),self.count.load(Relaxed),self.sum.load(Relaxed),self.max.load(Relaxed)),"deadline_misses":self.overruns.load(Relaxed),"starved_frames":self.starved_frames.load(Relaxed),"device_errors":self.device_errors.load(Relaxed),"delivered_frames":self.frames.load(Relaxed),"actual_callback_frames_min":self.min_frames.load(Relaxed),"actual_callback_frames_max":self.max_frames.load(Relaxed)})
    }
}
pub fn resources() -> Value {
    let mut r = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    unsafe {
        libc::getrusage(libc::RUSAGE_SELF, r.as_mut_ptr());
        let r = r.assume_init();
        json!({"process_cpu_seconds":r.ru_utime.tv_sec as f64+r.ru_utime.tv_usec as f64/1e6+r.ru_stime.tv_sec as f64+r.ru_stime.tv_usec as f64/1e6,"peak_rss_bytes":r.ru_maxrss * if cfg!(target_os="macos") {1} else {1024}})
    }
}
