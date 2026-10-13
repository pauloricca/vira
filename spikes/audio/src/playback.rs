use crate::{
    engine::{Engine, Manifest},
    metrics::{self, CallbackStats},
    scheduling::{Mode, Realtime, Wake},
};
use anyhow::{ensure, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering::Relaxed},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime},
};

#[derive(Clone, Copy, Serialize)]
struct Gap {
    first_output_frame: u64,
    frames: u64,
}
#[derive(Serialize)]
struct SlowBlock {
    first_render_frame: u64,
    elapsed_us: f64,
    queue_before_frames: usize,
}

pub fn devices() -> Result<Value> {
    let host = cpal::default_host();
    let mut found = Vec::new();
    for d in host.output_devices()? {
        found.push(json!({"name":d.name()?,"configs":d.supported_output_configs()?.map(|c|format!("{c:?}")).collect::<Vec<_>>()}));
    }
    Ok(
        json!({"host":format!("{:?}",host.id()),"default":host.default_output_device().and_then(|d|d.name().ok()),"devices":found}),
    )
}
pub fn play(manifest: Manifest, mode: Mode) -> Result<Value> {
    play_controlled(manifest, mode, Arc::new(AtomicBool::new(false)), false)
}

fn device_fingerprint() -> Option<(String, u32)> {
    let d = cpal::default_host().default_output_device()?;
    Some((
        d.name().ok()?,
        d.default_output_config().ok()?.sample_rate().0,
    ))
}

pub fn play_controlled(
    manifest: Manifest,
    mode: Mode,
    stop: Arc<AtomicBool>,
    monitor_device: bool,
) -> Result<Value> {
    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .context("no default audio output device")?;
    let name = device.name()?;
    ensure!(
        device.supported_output_configs()?.any(|c| c.channels() == 2
            && c.sample_format() == cpal::SampleFormat::F32
            && c.min_sample_rate().0 <= 48000
            && c.max_sample_rate().0 >= 48000),
        "device has no stereo float32 48 kHz configuration"
    );
    let config = cpal::StreamConfig {
        channels: 2,
        sample_rate: cpal::SampleRate(48000),
        buffer_size: cpal::BufferSize::Fixed(manifest.block_frames as u32),
    };
    let duration = manifest.duration_frames;
    let (mut producer, mut consumer) = rtrb::RingBuffer::<[f32; 2]>::new(manifest.queue_frames);
    let (mut gap_tx, mut gap_rx) = rtrb::RingBuffer::<Gap>::new(2048);
    let gap_dropped = Arc::new(AtomicU64::new(0));
    let cb_gap_dropped = gap_dropped.clone();
    let stats = Arc::new(CallbackStats::default());
    let cb = stats.clone();
    let max_callback_interval_us = Arc::new(AtomicU64::new(0));
    let cb_interval = max_callback_interval_us.clone();
    let err = stats.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    let worker_cancel = cancel.clone();
    let wake = if mode == Mode::Poll {
        None
    } else {
        Some(Arc::new(Wake::new()?))
    };
    let worker_wake = wake.clone();
    let cb_wake = wake.clone();
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<()>(1);
    let m = manifest.clone();
    let worker = thread::spawn(move || -> Result<Value> {
        // All construction, decoding and memory reservation precede priority promotion.
        let mut engine = Engine::new(m.clone())?;
        let mut block = vec![[0.; 2]; m.block_frames];
        let mut slow_blocks = Vec::with_capacity(4096);
        let mut slow_dropped = 0_u64;
        let rt = if mode.is_realtime() {
            Some(Realtime::new(m.block_frames as u32)?)
        } else {
            None
        };
        let mut ready = false;
        let mut interval_errors = 0_u64;
        let mut wait_errors = 0_u64;
        while engine.frame < m.duration_frames && !worker_cancel.load(Relaxed) {
            if producer.slots() < block.len() {
                if !ready {
                    if let Some(r) = &rt {
                        r.activate()?;
                    }
                    let _ = ready_tx.send(());
                    ready = true;
                }
                if let Some(w) = &worker_wake {
                    w.arm();
                    // Recheck after arming: callback may have freed space before it saw us armed.
                    if producer.slots() >= block.len() || worker_cancel.load(Relaxed) {
                        w.disarm();
                        continue;
                    }
                    if w.wait() != 0 {
                        wait_errors += 1;
                    }
                    w.disarm();
                } else {
                    thread::sleep(Duration::from_micros(100));
                }
                continue;
            }
            let queued = m.queue_frames - producer.slots();
            if ready {
                if let Some(r) = &rt {
                    interval_errors += (r.begin(queued as u32) != 0) as u64;
                }
            }
            let first = engine.frame;
            let t = Instant::now();
            let rendered = engine.render(&mut block);
            let elapsed = t.elapsed();
            if ready {
                if let Some(r) = &rt {
                    interval_errors += (r.finish() != 0) as u64;
                }
            }
            let n = rendered?;
            if elapsed.as_secs_f64() > n as f64 / 48000. {
                if slow_blocks.len() < slow_blocks.capacity() {
                    slow_blocks.push(SlowBlock {
                        first_render_frame: first,
                        elapsed_us: elapsed.as_secs_f64() * 1e6,
                        queue_before_frames: queued,
                    });
                } else {
                    slow_dropped += 1;
                }
            }
            for f in &block[..n] {
                producer
                    .push(*f)
                    .map_err(|_| anyhow::anyhow!("queue accounting error"))?;
            }
        }
        // Leave the workgroup and restore standard policy before constructing reports/dropping DSP.
        let policy_at_end = rt.as_ref().map(Realtime::is_realtime);
        drop(rt);
        if !ready {
            let _ = ready_tx.send(());
        }
        let mut report = engine.report();
        report["worker"] = json!({"mode":mode.name(),"realtime_policy_verified_at_activation":mode.is_realtime() && ready,"realtime_policy_at_end":policy_at_end,"workgroup":if mode.is_realtime() {Some("custom asynchronous AudioWorkInterval")} else {None},"workgroup_interval_errors":interval_errors,"wake_wait_nonzero_returns":wait_errors,"slow_blocks":slow_blocks,"slow_block_trace_dropped":slow_dropped});
        Ok(report)
    });
    if ready_rx.recv_timeout(Duration::from_secs(120)).is_err() {
        cancel.store(true, Relaxed);
        if let Some(w) = &wake {
            w.notify();
        }
        return match worker.join() {
            Ok(Err(e)) => Err(e),
            _ => Err(anyhow::anyhow!("producer did not prebuffer")),
        };
    }
    let mut gap_start = None;
    let mut previous_callback = None;
    let build = device.build_output_stream(
        &config,
        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
            let t = Instant::now();
            if let Some(previous) = previous_callback.replace(t) {
                cb_interval.fetch_max(t.duration_since(previous).as_micros() as u64, Relaxed);
            }
            let mut missing = 0;
            let mut delivered = cb.frames.load(Relaxed);
            for f in data.chunks_exact_mut(2) {
                if delivered >= duration {
                    f.fill(0.);
                    continue;
                }
                let value = match consumer.pop() {
                    Ok(v) => {
                        if let Some(first) = gap_start.take() {
                            if gap_tx
                                .push(Gap {
                                    first_output_frame: first,
                                    frames: delivered - first,
                                })
                                .is_err()
                            {
                                cb_gap_dropped.fetch_add(1, Relaxed);
                            }
                        }
                        v
                    }
                    Err(_) => {
                        if gap_start.is_none() {
                            gap_start = Some(delivered);
                        }
                        missing += 1;
                        [0.; 2]
                    }
                };
                f.copy_from_slice(&value);
                delivered += 1;
            }
            if delivered >= duration {
                if let Some(first) = gap_start.take() {
                    if gap_tx
                        .push(Gap {
                            first_output_frame: first,
                            frames: delivered - first,
                        })
                        .is_err()
                    {
                        cb_gap_dropped.fetch_add(1, Relaxed);
                    }
                }
            }
            cb.frames.store(delivered, Relaxed);
            cb.starved_frames.fetch_add(missing, Relaxed);
            // Nonblocking kernel signal, only when the producer has armed its wait.
            if let Some(w) = &cb_wake {
                w.notify();
            }
            cb.record(t.elapsed().as_nanos() as u64, (data.len() / 2) as u64);
        },
        move |_| {
            err.device_errors.fetch_add(1, Relaxed);
        },
        None,
    );
    let stream = match build {
        Ok(s) => s,
        Err(e) => {
            cancel.store(true, Relaxed);
            if let Some(w) = &wake {
                w.notify();
            }
            let _ = worker.join();
            return Err(e.into());
        }
    };
    if let Err(e) = stream.play() {
        cancel.store(true, Relaxed);
        if let Some(w) = &wake {
            w.notify();
        }
        let _ = worker.join();
        return Err(e.into());
    }
    let began = Instant::now();
    let initial_device = device_fingerprint();
    let mut device_check_at = Instant::now();
    let mut progress_at = Instant::now();
    let mut previous_frames = 0;
    let mut reason = "completed";
    let mut supervisor_at = SystemTime::now();
    let mut gaps = Vec::new();
    let mut peak_cpu: Option<f64> = None;
    let mut cpu_at = metrics::resources()["process_cpu_seconds"]
        .as_f64()
        .unwrap();
    let mut wall_at = Instant::now();
    while stats.frames.load(Relaxed) < duration
        && began.elapsed().as_secs_f64() < duration as f64 / 48000. + 10.
    {
        let now = SystemTime::now();
        if monitor_device
            && now.duration_since(supervisor_at).unwrap_or_default() > Duration::from_secs(2)
        {
            reason = "supervisor_pause_or_wake";
            break;
        }
        supervisor_at = now;
        if stop.load(Relaxed) {
            reason = "requested_stop";
            break;
        }
        let frames = stats.frames.load(Relaxed);
        if frames != previous_frames {
            previous_frames = frames;
            progress_at = Instant::now();
        }
        if stats.device_errors.load(Relaxed) > 0 {
            reason = "device_error";
            break;
        }
        if monitor_device && device_check_at.elapsed() >= Duration::from_millis(200) {
            if device_fingerprint() != initial_device {
                reason = "default_device_or_rate_changed";
                break;
            }
            device_check_at = Instant::now();
        }
        if progress_at.elapsed() > Duration::from_secs(1) {
            reason = "callback_stalled";
            break;
        }
        while let Ok(g) = gap_rx.pop() {
            gaps.push(g);
        }
        // Resource sampling/JSON allocation belongs to the ordinary supervisor, not the DSP worker.
        if wall_at.elapsed() >= Duration::from_secs(1) {
            let now = metrics::resources()["process_cpu_seconds"]
                .as_f64()
                .unwrap();
            peak_cpu = Some(
                peak_cpu
                    .unwrap_or(0.)
                    .max((now - cpu_at) / wall_at.elapsed().as_secs_f64() * 100.),
            );
            cpu_at = now;
            wall_at = Instant::now();
        }
        if worker.is_finished() && stats.device_errors.load(Relaxed) > 0 {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    if reason == "completed" && stats.frames.load(Relaxed) < duration {
        reason = "timeout";
    }
    drop(stream);
    cancel.store(true, Relaxed);
    if let Some(w) = &wake {
        w.notify();
    }
    while let Ok(g) = gap_rx.pop() {
        gaps.push(g);
    }
    let mut engine = worker
        .join()
        .map_err(|_| anyhow::anyhow!("producer panicked"))??;
    engine["peak_process_cpu_percent_one_second_windows"] = json!(peak_cpu);
    let mut report = json!({"mode":"device_playback","worker_mode":mode.name(),"device":name,"sample_rate":48000,"requested_buffer_frames":manifest.block_frames,"requested_buffer_ms":manifest.block_frames as f64/48.,"queue_capacity_frames":manifest.queue_frames,"queue_capacity_ms":manifest.queue_frames as f64/48.,"wall_seconds":began.elapsed().as_secs_f64(),"completed":stats.frames.load(Relaxed)>=duration,"callback":stats.report(),"gaps":gaps,"gap_trace_dropped":gap_dropped.load(Relaxed),"wake_signal_errors":wake.as_ref().map(|w|w.signal_errors.load(Relaxed)),"engine":engine,"resources":metrics::resources(),"end_to_end_latency_ms":null,"device_observability":"CPAL stream errors only; no hardware xrun counter or loopback measurement"});
    report["stop_reason"] = json!(reason);
    report["max_callback_interval_us"] = json!(max_callback_interval_us.load(Relaxed));
    Ok(report)
}
