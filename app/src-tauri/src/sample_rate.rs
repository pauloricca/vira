//! One engine rate per process. A rate change restarts VIRA, so PCM, DSP state,
//! frame clocks and prepared instruments can never span different timebases.
use std::sync::OnceLock;
static RATE: OnceLock<usize> = OnceLock::new();
pub fn get() -> usize {
    *RATE.get_or_init(|| {
        #[cfg(target_os = "macos")]
        {
            let host = cpal::default_host();
            let routes = crate::audio_devices::Routes::load();
            routes
                .working_rate
                .map(|rate| rate as usize)
                .unwrap_or_else(|| {
                    crate::audio_devices::resolve(&host, routes.master.as_deref())
                        .and_then(|device| crate::audio_devices::config(&device))
                        .map(|config| config.sample_rate.0 as usize)
                        .unwrap_or(48000)
                })
        }
        #[cfg(not(target_os = "macos"))]
        {
            // Separate test processes exercise complete engine paths at each rate.
            std::env::var("VIRA_TEST_SAMPLE_RATE")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(48000)
        }
    })
}
pub fn fine_frames() -> usize {
    (get() as f64 * 0.005).round() as usize
}
