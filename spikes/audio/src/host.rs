//! Minimal in-process Tauri host. The existing engine remains UI-independent.
use crate::{engine::Manifest, playback, scheduling::Mode};
use anyhow::{ensure, Result};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering::Relaxed},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

struct Session {
    manifest: Manifest,
    report_path: String,
    load: bool,
    started: AtomicBool,
    closing: AtomicBool,
    stop: Arc<AtomicBool>,
    restart: AtomicBool,
    ui_frames: AtomicU64,
    ui_max_gap_us: AtomicU64,
    status: Mutex<Value>,
}
#[tauri::command]
fn status(state: tauri::State<'_, Arc<Session>>, frames: u64, max_gap_us: u64) -> Value {
    state.ui_frames.store(frames, Relaxed);
    state.ui_max_gap_us.fetch_max(max_gap_us, Relaxed);
    state.status.lock().unwrap().clone()
}
#[tauri::command]
fn restart(state: tauri::State<'_, Arc<Session>>) {
    state.restart.store(true, Relaxed);
    state.stop.store(true, Relaxed);
}
#[tauri::command]
fn ready(app: tauri::AppHandle, state: tauri::State<'_, Arc<Session>>) -> bool {
    let load = state.load;
    if !state.started.swap(true, Relaxed) {
        if let Some(ms) = std::env::var("VIRA_HOST_RESTART_AFTER_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
        {
            let probe = state.inner().clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(ms));
                probe.restart.store(true, Relaxed);
                probe.stop.store(true, Relaxed);
            });
        }
        let session = state.inner().clone();
        thread::spawn(move || {
            let result = measure(&session);
            let report = match result {
                Ok(v) => v,
                Err(e) => json!({"error":format!("{e:#}")}),
            };
            if let Err(e) = crate::save(&session.report_path, &report) {
                eprintln!("Could not save host report: {e:#}");
                app.exit(1);
                return;
            }
            *session.status.lock().unwrap() = report;
            // Keep a manual session visible; automated comparisons opt in to exit.
            if std::env::var_os("VIRA_HOST_AUTO_EXIT").is_some() || session.closing.load(Relaxed) {
                app.exit(0);
            }
        });
    }
    load
}
fn measure(s: &Session) -> Result<Value> {
    // Give the webview time to enter its requested rendering load before audio starts.
    thread::sleep(Duration::from_millis(500));
    let finish = Arc::new(AtomicBool::new(false));
    let mut workers = Vec::new();
    if s.load {
        for _ in 0..2 {
            let done = finish.clone();
            let sources = s.manifest.sources.clone();
            workers.push(thread::spawn(move || -> Result<u64> {
                let mut passes = 0;
                while !done.load(Relaxed) {
                    // Representative background work: WAV decoding and waveform peak extraction.
                    for source in &sources {
                        let pcm = crate::audio::Audio::load(Path::new(source))?;
                        let peaks: Vec<f32> = pcm
                            .left
                            .chunks(256)
                            .map(|chunk| chunk.iter().fold(0.0_f32, |p, v| p.max(v.abs())))
                            .collect();
                        std::hint::black_box(peaks);
                    }
                    passes += 1;
                    thread::sleep(Duration::from_millis(5));
                }
                Ok(passes)
            }));
        }
    }
    let began = Instant::now();
    let mut attempts = Vec::new();
    for attempt in 0..4 {
        let started_at = began.elapsed().as_secs_f64();
        s.stop.store(false, Relaxed);
        *s.status.lock().unwrap() = json!({"state":"playing", "attempt":attempt+1,"busy":s.load});
        let result =
            playback::play_controlled(s.manifest.clone(), Mode::Realtime, s.stop.clone(), true);
        let elapsed = began.elapsed().as_secs_f64();
        let (value, completed) = match result {
            Ok(v) => {
                let completed = v["completed"] == true;
                (v, completed)
            }
            Err(e) => (json!({"error":format!("{e:#}")}), false),
        };
        attempts.push(
            json!({"started_at_seconds":started_at,"finished_at_seconds":elapsed,"playback":value}),
        );
        let requested = s.restart.swap(false, Relaxed);
        if s.closing.load(Relaxed) || (completed && !requested) {
            break;
        }
        *s.status.lock().unwrap() = json!({"state":"reopening device", "attempt":attempt+1});
        thread::sleep(Duration::from_millis(500));
    }
    finish.store(true, Relaxed);
    let background: Vec<Value> = workers
        .into_iter()
        .map(|w| match w.join() {
            Ok(Ok(n)) => json!({"decode_waveform_passes":n}),
            Ok(Err(e)) => json!({"error":format!("{e:#}")}),
            Err(_) => json!({"error":"background worker panicked"}),
        })
        .collect();
    Ok(
        json!({"mode":"tauri_in_process", "build":crate::metadata(), "busy":s.load,
        "wall_seconds":began.elapsed().as_secs_f64(),"attempts":attempts,"background":background,
        "ui_animation_frames":s.ui_frames.load(Relaxed),"ui_max_frame_gap_us":s.ui_max_gap_us.load(Relaxed),
        "recovery":"up to 3 reopens, 500 ms apart; restarts manifest from zero; no seamless resume",
        "resources":crate::metrics::resources()}),
    )
}
pub fn run(manifest: &str, report: &str, load: &str) -> Result<()> {
    ensure!(
        matches!(load, "idle" | "busy"),
        "host mode must be idle or busy"
    );
    let state = Arc::new(Session {
        manifest: Manifest::read(Path::new(manifest))?,
        report_path: report.into(),
        load: load == "busy",
        started: AtomicBool::new(false),
        closing: AtomicBool::new(false),
        stop: Arc::new(AtomicBool::new(false)),
        restart: AtomicBool::new(false),
        ui_frames: AtomicU64::new(0),
        ui_max_gap_us: AtomicU64::new(0),
        status: Mutex::new(json!({"state":"waiting for webview"})),
    });
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![ready, status, restart])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let session = window.state::<Arc<Session>>();
                if session.status.lock().unwrap().get("state").is_some()
                    && session.started.load(Relaxed)
                {
                    api.prevent_close();
                    session.closing.store(true, Relaxed);
                    session.stop.store(true, Relaxed);
                }
            }
        })
        .run(tauri::generate_context!())?;
    Ok(())
}
