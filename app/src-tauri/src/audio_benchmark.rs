//! Identical steady-state workload usable with both the pre-routing and new engine.
//! Latency is command submission to consumed callback telemetry, not speaker timing.
use crate::runtime::EngineHandle;
use anyhow::{ensure, Result};
use serde_json::json;
use std::{
    path::Path,
    thread,
    time::{Duration, Instant},
};

pub fn run(seconds: u64, report: &Path) -> Result<()> {
    ensure!(seconds >= 30, "Benchmark requires at least 30 seconds");
    let library = crate::scan_library().map_err(anyhow::Error::msg)?;
    let tracks: Vec<_> = library
        .tracks
        .iter()
        .filter(|t| matches!(t.status, crate::FileStatus::Ready))
        .collect();
    ensure!(tracks.len() >= 2, "Two readable tracks required");
    let ids = [
        tracks
            .iter()
            .find(|t| t.title == "Miracle")
            .unwrap_or(&tracks[0])
            .id
            .clone(),
        tracks
            .iter()
            .find(|t| t.title == "Simplex City")
            .unwrap_or(&tracks[1])
            .id
            .clone(),
    ];
    let engine = EngineHandle::new();
    let ready = Instant::now();
    while engine.state()["running"] != true {
        ensure!(
            ready.elapsed() < Duration::from_secs(10),
            "Output failed to start"
        );
        thread::sleep(Duration::from_millis(20));
    }
    for d in 0..2 {
        let generation = engine.begin_load(d)?;
        engine.load(d, generation, &ids[d], true, true)?;
        let start = Instant::now();
        while engine.state()["decks"][d]["generation"].as_u64() != Some(generation) {
            ensure!(
                start.elapsed() < Duration::from_secs(10),
                "Loading timed out"
            );
            thread::sleep(Duration::from_millis(20));
        }
        for (action, value) in [
            ("gain", 0.1),
            ("eq_low", 0.6),
            ("eq_mid", 0.4),
            ("filter", 0.2),
        ] {
            engine.control(d, action, Some(value))?;
        }
        engine.control(d, "play", None)?;
    }
    // Exclude initialization/preparation and let R3 + mixer state settle.
    thread::sleep(Duration::from_secs(3));
    let before = engine.state();
    let resources = crate::metrics::resources();
    let began = Instant::now();
    let mut latencies = Vec::new();
    for probe in 0..seconds {
        let gain = if probe % 2 == 0 { 0.12_f32 } else { 0.1_f32 };
        let submitted = Instant::now();
        engine.control(0, "gain", Some(gain as f64))?;
        while engine.benchmark_gains()[0] != gain {
            ensure!(
                submitted.elapsed() < Duration::from_secs(1),
                "Control failed to reach output callback"
            );
            thread::sleep(Duration::from_millis(1));
        }
        latencies.push(submitted.elapsed().as_secs_f64() * 1000.);
        let next = Duration::from_secs(probe + 1);
        if let Some(wait) = next.checked_sub(began.elapsed()) {
            thread::sleep(wait);
        }
    }
    let wall = began.elapsed().as_secs_f64();
    let cpu = crate::metrics::resources()["process_cpu_seconds"]
        .as_f64()
        .unwrap()
        - resources["process_cpu_seconds"].as_f64().unwrap();
    let after = engine.state();
    engine.shutdown();
    thread::sleep(Duration::from_millis(250));
    let cb0 = &before["telemetry"]["callback"];
    let cb1 = &after["telemetry"]["callback"];
    let count0 = cb0["execution"]["count"].as_f64().unwrap();
    let count1 = cb1["execution"]["count"].as_f64().unwrap();
    let mean = (cb1["execution"]["mean_us"].as_f64().unwrap() * count1
        - cb0["execution"]["mean_us"].as_f64().unwrap() * count0)
        / (count1 - count0);
    let delta = |key: &str| cb1[key].as_u64().unwrap() - cb0[key].as_u64().unwrap();
    latencies.sort_by(f64::total_cmp);
    let clean = delta("starved_frames") == 0
        && delta("deadline_misses") == 0
        && delta("device_errors") == 0;
    let evidence = json!({"passed":clean,"seconds":seconds,"tracks":ids,"workload":"two unity-speed decks; EQ low .6 / mid .4, filter .2; gain .1; A gain .12/.1 once per second; 3s warmup","wall_seconds":wall,"cpu_seconds":cpu,"cpu_percent_one_core":cpu/wall*100.,"callback_mean_us_steady_state":mean,"callback_full_run":cb1,"starved_frames_steady_state":delta("starved_frames"),"deadline_misses_steady_state":delta("deadline_misses"),"device_errors_steady_state":delta("device_errors"),"control_to_callback_latency_ms":{"p50":latencies[latencies.len()/2],"p95":latencies[((latencies.len() as f64*0.95).ceil() as usize-1).min(latencies.len()-1)],"max":latencies.last(),"poll_resolution_ms":1},"queue_capacity_ms":after["telemetry"]["queue_capacity_ms"],"actual_callback_frames":cb1["actual_callback_frames_max"],"physical_end_to_end_latency_ms":null,"latency_scope":"measured control-to-consumed-callback acknowledgement, includes control queue + audio queue; physical speaker latency needs loopback hardware","telemetry":after["telemetry"]});
    if let Some(parent) = report.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(report, serde_json::to_vec_pretty(&evidence)?)?;
    ensure!(
        clean,
        "Audio benchmark observed dropouts/errors; inspect report"
    );
    Ok(())
}
