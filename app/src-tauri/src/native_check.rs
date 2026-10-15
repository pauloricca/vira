//! Repeatable native transport/soak session using the product engine and service.
use crate::{runtime::EngineHandle, source::RATE};
use anyhow::{ensure, Result};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

fn wait(engine: &EngineHandle, deck: usize, generation: u64) -> Result<()> {
    let began = Instant::now();
    while began.elapsed() < Duration::from_secs(10) {
        let state = engine.state();
        ensure!(
            state["error"].is_null(),
            "Native engine error: {}",
            state["error"]
        );
        if state["decks"][deck]["generation"].as_u64() == Some(generation) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(20));
    }
    anyhow::bail!("Deck {deck} failed to commit prepared source")
}
fn load(engine: &EngineHandle, deck: usize, id: &str) -> Result<u64> {
    let generation = engine.begin_load(deck)?;
    engine.load(deck, generation, id, true, true)?;
    wait(engine, deck, generation)?;
    Ok(generation)
}
fn position(state: &Value, deck: usize) -> f64 {
    state["decks"][deck]["position_seconds"].as_f64().unwrap()
}

pub fn run(seconds: u64, report: &Path) -> Result<()> {
    run_mode(seconds, report, false, false)
}
pub fn run_timing(seconds: u64, report: &Path) -> Result<()> {
    run_mode(seconds, report, true, false)
}
pub fn run_routing(seconds: u64, report: &Path) -> Result<()> {
    run_mode(seconds, report, false, true)
}
fn run_mode(seconds: u64, report: &Path, timing: bool, routing: bool) -> Result<()> {
    ensure!(
        seconds >= 30,
        "Native session must last at least 30 seconds"
    );
    let library = crate::scan_library().map_err(anyhow::Error::msg)?;
    let tracks: Vec<_> = library
        .tracks
        .iter()
        .filter(|t| matches!(t.status, crate::FileStatus::Ready))
        .collect();
    ensure!(
        tracks.len() >= 2,
        "Native check requires two readable music files"
    );
    // Prefer unanalysed sources to demonstrate preparation is independent.
    let a = tracks
        .iter()
        .find(|t| t.title == "Miracle")
        .unwrap_or(&tracks[0])
        .id
        .clone();
    let b = tracks
        .iter()
        .find(|t| t.title == "Simplex City")
        .unwrap_or(&tracks[1])
        .id
        .clone();
    let analysis_id = tracks[0].id.clone();
    let engine = EngineHandle::new();
    if routing {
        let ready = Instant::now();
        while engine.state()["running"] != true {
            ensure!(
                ready.elapsed() < Duration::from_secs(10),
                "Native output failed to start"
            );
            thread::sleep(Duration::from_millis(20));
        }
        use crate::routing::{Graph, Kind, Node, Wire};
        let mut graph = Graph::default();
        graph.nodes.push(Node {
            patch_inputs: None,
            id: "compressor".into(),
            kind: Kind::Compressor,
            deck: None,
            label: "Sidechain compressor".into(),
            x: 0.,
            y: 0.,
            value: 0.1,
        });
        graph
            .wires
            .retain(|w| !(w.from == "a-eq" && w.to == "a-filter"));
        for (from, to, input, gain) in [
            ("a-eq", "compressor", "audio", 1.),
            ("b-player", "compressor", "sidechain", 1.),
            ("compressor", "a-filter", "audio", 1.),
            ("a-eq", "master", "audio", 0.05),
        ] {
            graph.wires.push(Wire {
                from: from.into(),
                output: "audio".into(),
                to: to.into(),
                input: input.into(),
                gain,
            });
        }
        engine.set_routing_graph(graph)?;
    }
    let result = if timing {
        timing_session(engine.clone(), seconds, &a, &b)
    } else {
        session(engine.clone(), seconds, &a, &b, &analysis_id, routing)
    };
    engine.shutdown();
    thread::sleep(Duration::from_millis(250));
    let final_state = engine.state();
    let clean = final_state["telemetry"]["realtime_policy_verified"].as_bool() == Some(true)
        && final_state["telemetry"]["realtime_policy_at_exit"].as_bool() == Some(true)
        && final_state["telemetry"]["callback"]["deadline_misses"].as_u64() == Some(0)
        && final_state["telemetry"]["callback"]["starved_frames"].as_u64() == Some(0)
        && final_state["telemetry"]["callback"]["device_errors"].as_u64() == Some(0)
        && final_state["telemetry"]["workgroup_interval_errors"].as_u64() == Some(0)
        && final_state["telemetry"]["wake_signal_errors"].as_u64() == Some(0);
    let mut evidence = json!({"edited_routing":routing,"timing_session":timing,"seconds_requested":seconds,"passed":result.is_ok() && clean,"error":result.as_ref().err().map(|e|format!("{e:#}")),
        "state":final_state,"position_timing_claim":"queue-aware callback position, not sample-exact physical speaker timing"});
    if let Ok(trace) = &result {
        evidence["trace"] = trace.clone();
    }
    if let Some(parent) = report.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(report, serde_json::to_string_pretty(&evidence)?)?;
    result?;
    ensure!(
        evidence["state"]["telemetry"]["callback"]["starved_frames"].as_u64() == Some(0),
        "Observed starvation; see native report"
    );
    ensure!(
        evidence["state"]["telemetry"]["callback"]["device_errors"].as_u64() == Some(0),
        "Observed device errors; see native report"
    );
    ensure!(
        clean,
        "Native scheduling/queue verification failed; see native report"
    );
    Ok(())
}

fn session(
    engine: Arc<EngineHandle>,
    seconds: u64,
    a: &str,
    b: &str,
    analysis_id: &str,
    routing: bool,
) -> Result<Value> {
    let ready_at = Instant::now();
    while !engine.state()["running"].as_bool().unwrap_or(false) {
        ensure!(
            ready_at.elapsed() < Duration::from_secs(10),
            "Native output did not start"
        );
        thread::sleep(Duration::from_millis(20));
    }
    load(&engine, 0, a)?;
    load(&engine, 1, b)?;
    for d in 0..2 {
        engine.control(d, "gain", Some(0.2))?;
        engine.control(d, "play", None)?;
    }
    let began = Instant::now();
    let mut trace = Vec::new();
    let mut elapsed = 0_u64;
    let mut handled = std::collections::HashSet::new();
    while elapsed < seconds {
        let event = [2, 3, 4, 6, 8, 10, 13, 15, 60]
            .into_iter()
            .find(|event| elapsed >= *event && !handled.contains(event))
            .unwrap_or(0);
        if event != 0 {
            handled.insert(event);
        }
        if routing && matches!(event, 3 | 6 | 13) {
            let mut graph = engine.routing_graph();
            let send = graph
                .wires
                .iter_mut()
                .find(|w| w.from == "a-eq" && w.to == "master")
                .unwrap();
            send.gain = if event == 6 { 0.075 } else { 0.05 };
            engine.set_routing_graph(graph)?;
            let accepted = engine.routing_graph();
            let mut invalid = accepted.clone();
            invalid.wires.push(crate::routing::Wire {
                from: "a-filter".into(),
                output: "audio".into(),
                to: "a-eq".into(),
                input: "audio".into(),
                gain: 1.,
            });
            ensure!(
                engine.set_routing_graph(invalid).is_err(),
                "Feedback graph accepted"
            );
            ensure!(
                engine.routing_graph() == accepted,
                "Rejected edit changed the graph"
            );
            trace.push(json!({"elapsed":elapsed,"check":"live graph swap and rejected-feedback isolation","passed":true}));
        }
        match event {
            2 => {
                engine.control(0, "pause", None)?;
                thread::sleep(Duration::from_millis(80));
                let before = engine.state();
                thread::sleep(Duration::from_millis(200));
                let after = engine.state();
                ensure!(
                    (position(&after, 0) - position(&before, 0)).abs() < 0.001,
                    "Pause did not hold A"
                );
                ensure!(
                    position(&after, 1) > position(&before, 1) + 0.15,
                    "Pausing A interrupted B"
                );
                trace.push(json!({"elapsed":elapsed,"check":"pause isolation","passed":true}));
            }
            3 => engine.control(0, "play", None)?,
            4 => engine.control(0, "seek", Some(10.))?,
            6 => {
                let before = engine.state();
                let gen = engine.begin_load(0)?;
                ensure!(
                    engine.load(0, gen, &"0".repeat(64), true, true).is_err(),
                    "Invalid loading unexpectedly succeeded"
                );
                let after = engine.state();
                ensure!(
                    before["decks"][0]["generation"] == after["decks"][0]["generation"]
                        && after["decks"][0]["playing"] == true,
                    "Failed loading replaced/stopped A"
                );
                trace.push(json!({"elapsed":elapsed,"check":"failed replacement preserves active deck","passed":true}));
            }
            8 => {
                let before = engine.state();
                load(&engine, 1, a)?;
                let after = engine.state();
                ensure!(
                    after["decks"][1]["playing"] == false && position(&after, 1) == 0.,
                    "Loading must start paused at zero"
                );
                ensure!(
                    after["decks"][0]["generation"] == before["decks"][0]["generation"]
                        && after["decks"][0]["playing"] == true,
                    "Replacing B interrupted A"
                );
                thread::sleep(Duration::from_millis(100));
                let shared = engine.state();
                let frames = shared["decks"][0]["track"]["frames"].as_u64().unwrap();
                ensure!(
                    shared["telemetry"]["live_source_pcm_bytes"].as_u64() == Some(frames * 8),
                    "Same source was not shared or retired source was retained"
                );
                engine.control(1, "play", None)?;
                trace.push(json!({"elapsed":elapsed,"check":"same-source sharing and independent replacement","passed":true,"state":shared}));
            }
            10 => {
                let old = engine.begin_load(0)?;
                let older = engine.clone();
                let id = b.to_owned();
                let pending = thread::spawn(move || older.load(0, old, &id, true, true));
                thread::sleep(Duration::from_millis(30));
                let latest = load(&engine, 0, a)?;
                let _ = pending.join();
                wait(&engine, 0, latest)?;
                ensure!(
                    engine.state()["decks"][0]["generation"].as_u64() == Some(latest),
                    "Late source overrode newest load"
                );
                engine.control(0, "play", None)?;
                trace.push(json!({"elapsed":elapsed,"check":"latest request wins","passed":true}));
            }
            13 => {
                engine.control(1, "stop", None)?;
                thread::sleep(Duration::from_millis(100));
                ensure!(
                    position(&engine.state(), 1) == 0.,
                    "Stop did not return B to zero"
                );
            }
            15 => {
                let duration = engine.state()["decks"][1]["track"]["duration_seconds"]
                    .as_f64()
                    .unwrap();
                engine.control(1, "seek", Some(duration - 0.2))?;
                engine.control(1, "play", None)?;
                thread::sleep(Duration::from_millis(600));
                let state = engine.state();
                ensure!(
                    state["decks"][1]["playing"] == false
                        && (position(&state, 1) - duration).abs() < 1. / RATE as f64,
                    "End of track looped or stopped early"
                );
                engine.control(1, "stop", None)?;
                engine.control(1, "play", None)?;
                trace.push(
                    json!({"elapsed":elapsed,"check":"finite end, seek and stop","passed":true}),
                );
            }
            60 => {
                crate::request_analysis(analysis_id).map_err(anyhow::Error::msg)?;
                trace.push(
                    json!({"elapsed":elapsed,"check":"analysis requested during native playback"}),
                );
            }
            _ => {}
        }
        if elapsed > 15 && elapsed % 30 == 0 {
            let d = (elapsed / 30 % 2) as usize;
            engine.control(d, "pause", None)?;
            thread::sleep(Duration::from_millis(150));
            engine.control(d, "play", None)?;
            engine.control(d, "seek", Some((elapsed / 30 % 4 * 25) as f64))?;
        }
        if elapsed > 15 && elapsed % 120 == 0 {
            let d = (elapsed / 120 % 2) as usize;
            let other = 1 - d;
            let before = engine.state();
            load(&engine, d, if elapsed % 240 == 0 { a } else { b })?;
            let after = engine.state();
            ensure!(
                before["decks"][other]["generation"] == after["decks"][other]["generation"]
                    && after["decks"][other]["playing"] == true,
                "Replacement disturbed the other deck"
            );
            engine.control(d, "play", None)?;
            trace.push(
                json!({"elapsed":elapsed,"check":"replacement during playback","passed":true}),
            );
        }
        let state = engine.state();
        ensure!(
            state["error"].is_null() && state["running"] == true,
            "Native output failed: {}",
            state["error"]
        );
        if elapsed % 30 == 0 {
            println!(
                "native session {elapsed}/{seconds}s · starvation={} · device_errors={}",
                state["telemetry"]["callback"]["starved_frames"],
                state["telemetry"]["callback"]["device_errors"]
            );
            trace.push(json!({"elapsed":elapsed,"telemetry":state["telemetry"]}));
        }
        let next = Duration::from_secs(elapsed + 1);
        if let Some(delay) = next.checked_sub(began.elapsed()) {
            thread::sleep(delay.min(Duration::from_secs(1)));
        }
        elapsed = began.elapsed().as_secs();
    }
    let library = crate::library_state().map_err(anyhow::Error::msg)?;
    ensure!(
        [2, 3, 4, 6, 8, 10, 13, 15]
            .iter()
            .all(|event| handled.contains(event)),
        "Session skipped a required transport check"
    );
    if seconds > 90 {
        ensure!(
            library
                .tracks
                .iter()
                .find(|t| t.id == analysis_id)
                .is_some_and(|t| matches!(
                    t.analysis.state,
                    crate::AnalysisState::Analysed | crate::AnalysisState::NeedsReview
                )),
            "Concurrent analysis did not complete"
        );
    }
    Ok(json!({"wall_seconds":began.elapsed().as_secs_f64(),"events":trace}))
}

fn timing_session(engine: Arc<EngineHandle>, seconds: u64, a: &str, b: &str) -> Result<Value> {
    let ready = Instant::now();
    while engine.state()["running"] != true {
        ensure!(
            ready.elapsed() < Duration::from_secs(10),
            "Native output unavailable"
        );
        thread::sleep(Duration::from_millis(20));
    }
    let generations = [load(&engine, 0, a)?, load(&engine, 1, b)?];
    // Test-only grid fixtures exercise clock alignment. These are never saved
    // and do not assert that a supplied song has been musically reviewed.
    for d in 0..2 {
        engine.apply_grid(
            d,
            generations[d],
            crate::timing::Grid {
                bpm: if d == 0 { 120. } else { 110. },
                downbeat_seconds: 0.1,
                reviewed: true,
            },
        )?;
        engine.control(d, "gain", Some(0.08))?;
    }
    thread::sleep(Duration::from_millis(100));
    let idle_beat = engine.state()["global_beat"].as_f64().unwrap();
    thread::sleep(Duration::from_millis(120));
    ensure!(
        engine.state()["global_beat"].as_f64() == Some(idle_beat),
        "Master clock advanced while both decks were stopped"
    );
    engine.control(0, "sync", Some(1.))?;
    engine.control(0, "play", None)?;
    engine.control(1, "play", None)?;
    engine.control(1, "tempo", Some(115.))?;
    let began = Instant::now();
    let mut events = Vec::new();
    let mut last = 0;
    let mut max_phase_ms: f64 = 0.;
    while began.elapsed().as_secs() < seconds {
        let elapsed = began.elapsed().as_secs();
        if elapsed >= last + 5 {
            last = elapsed;
            engine.control(1, "drift", None)?;
            thread::sleep(Duration::from_millis(150));
            let state = engine.state();
            ensure!(state["error"].is_null(), "Native engine failure");
            ensure!(
                state["decks"][0]["synced"] == true,
                "Master lock did not persist"
            );
            ensure!(
                state["decks"][1]["synced"] == false,
                "Drift changed source lock"
            );
            ensure!(
                state["decks"][0]["timing_error"].is_null(),
                "Locked deck tempo error"
            );
            if state["decks"][0]["playing"] == true {
                let grid: crate::timing::Grid =
                    serde_json::from_value(state["decks"][0]["grid"].clone())?;
                let delta = (grid.beat(position(&state, 0))
                    - state["global_beat"].as_f64().unwrap())
                .rem_euclid(4.);
                let phase_ms =
                    delta.min(4. - delta) * 60000. / state["master_bpm"].as_f64().unwrap();
                max_phase_ms = max_phase_ms.max(phase_ms);
                ensure!(
                    phase_ms <= 10.,
                    "Native master phase exceeded 10 ms: {phase_ms}"
                );
            }
            events.push(json!({"elapsed":elapsed,"state":state}));
        }
        thread::sleep(Duration::from_millis(100));
    }
    engine.control(0, "pause", None)?;
    engine.control(1, "pause", None)?;
    thread::sleep(Duration::from_millis(150));
    let frozen_beat = engine.state()["global_beat"].as_f64().unwrap();
    thread::sleep(Duration::from_millis(150));
    ensure!(
        engine.state()["global_beat"].as_f64() == Some(frozen_beat),
        "Master clock advanced after both decks paused"
    );
    Ok(
        json!({"events":events,"max_master_phase_ms":max_phase_ms,"idle_clock_frozen":true,"grid_basis":"temporary test-only assertions on real PCM, never saved; supplied-song musical alignment/listening still requires user review"}),
    )
}
