mod audio;
mod dsp;
mod engine;
#[cfg(all(feature = "host", target_os = "macos"))]
mod host;
mod metrics;
mod playback;
mod scheduling;
use anyhow::{bail, ensure, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::Path, time::Instant};

fn save(path: &str, value: &Value) -> Result<()> {
    std::fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}
fn metadata() -> Value {
    json!({"rubberband":"4.0.0","rust":"1.90.0","os":std::env::consts::OS,"arch":std::env::consts::ARCH,"optimized":!cfg!(debug_assertions),"dsp_mode":"real_time","threading":"never","channels":"together","pitch_mode":"high_consistency","fft":if cfg!(target_os="macos"){ "vDSP" } else { "builtin" },"resampler":"BQResampler","speed_convention":"playback speed; native duration ratio = 1 / speed; pitch = 2^(semitones/12)"})
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Audition {
    seed: u64,
    excerpts: Vec<Excerpt>,
    speeds: Vec<f64>,
    pitches: Vec<f64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Excerpt {
    label: String,
    path: String,
    start: usize,
    frames: usize,
}
fn audition(path: &str, directory: &str) -> Result<()> {
    let manifest: Audition = serde_json::from_slice(&std::fs::read(path)?)?;
    ensure!(
        !manifest.excerpts.is_empty()
            && !manifest.speeds.is_empty()
            && !manifest.pitches.is_empty(),
        "empty audition manifest"
    );
    std::fs::create_dir_all(directory)?;
    let mut random = manifest.seed.max(1);
    let mut key = Vec::new();
    let mut group = 0;
    for ex in manifest.excerpts {
        ensure!(ex.frames > 0, "empty excerpt");
        let source = audio::Audio::load(Path::new(&ex.path))?;
        for &speed in &manifest.speeds {
            for &pitch in &manifest.pitches {
                ensure!(
                    engine::valid_ratios(speed, pitch),
                    "unsupported audition ratios"
                );
                group += 1;
                let mut pair = Vec::new();
                for engine in [2, 3] {
                    let (frames, stats) =
                        audio::excerpt(&source, ex.start, ex.frames, engine, speed, pitch)?;
                    let energy = frames
                        .iter()
                        .flat_map(|f| f.iter())
                        .map(|s| (*s as f64).powi(2))
                        .sum::<f64>();
                    let rms = (energy / (frames.len() * 2) as f64).sqrt();
                    ensure!(rms > 1e-10, "cannot level-match silent excerpt");
                    let peak = frames.iter().flatten().fold(0_f32, |a, s| a.max(s.abs()));
                    pair.push((engine, frames, stats, rms, peak));
                }
                // Equal stereo RMS, with a shared target reduced as necessary to leave peak headroom.
                let target = pair
                    .iter()
                    .map(|p| 0.89 * p.3 / p.4 as f64)
                    .fold(0.1_f64, f64::min);
                random ^= random << 13;
                random ^= random >> 7;
                random ^= random << 17;
                if random & 1 != 0 {
                    pair.swap(0, 1);
                }
                for (index, (engine, mut frames, stats, rms, _)) in pair.into_iter().enumerate() {
                    let gain = target / rms;
                    for f in &mut frames {
                        f[0] *= gain as f32;
                        f[1] *= gain as f32;
                    }
                    let file =
                        format!("pair-{group:03}-{}.wav", if index == 0 { "A" } else { "B" });
                    audio::write(&Path::new(directory).join(&file), &frames)?;
                    key.push(json!({"file":file,"source":ex.path,"category":ex.label,"source_start":ex.start,"source_frames":ex.frames,"engine":engine,"speed":speed,"pitch_semitones":pitch,"gain":gain,"matched_rms":target,"stats":stats}));
                }
            }
        }
    }
    save(
        &format!("{directory}/settings-key.json"),
        &json!({"build":metadata(),"seed":manifest.seed,"comparisons":key}),
    )?;
    std::fs::write(format!("{directory}/listening.csv"),"pair,preferred_A_B_or_tie,transient_sharpness,groove,vocal_character,stereo_stability,glitches,notes\n")?;
    Ok(())
}
fn synth(dir: &str) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let n = 48000 * 8;
    for kind in ["tone", "impulses", "texture"] {
        let mut state = 17_u32;
        let frames: Vec<[f32; 2]> = (0..n)
            .map(|i| {
                let t = i as f32 / 48000.;
                state = state.wrapping_mul(1664525).wrapping_add(1013904223);
                let noise = (state as f64 / u32::MAX as f64 * 2. - 1.) as f32;
                match kind {
                    "tone" => [
                        0.15 * (std::f32::consts::TAU * 440. * t).sin(),
                        0.15 * (std::f32::consts::TAU * 660. * t).sin(),
                    ],
                    "impulses" => {
                        let v = if i % 12000 == 0 { 0.8 } else { 0. };
                        [v, v]
                    }
                    _ => {
                        let env = (-((i % 12000) as f32) / 1200.).exp();
                        [
                            0.08 * (std::f32::consts::TAU * 110. * t).sin() + noise * env * 0.2,
                            0.08 * (std::f32::consts::TAU * 165. * t).sin() + noise * env * 0.2,
                        ]
                    }
                }
            })
            .collect();
        audio::write(&Path::new(dir).join(format!("{kind}.wav")), &frames)?;
    }
    Ok(())
}
fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let usage="commands: synth DIR | audition MANIFEST OUT_DIR | bench MANIFEST REPORT [WAV] | play MANIFEST REPORT [poll|signal|realtime] | devices | probe REPORT";
    let command = args.get(1).context(usage)?;
    match command.as_str() {
        #[cfg(all(feature = "host", target_os = "macos"))]
        "host" if (4..=5).contains(&args.len()) => host::run(
            &args[2],
            &args[3],
            args.get(4).map(String::as_str).unwrap_or("idle"),
        )?,
        "synth" if args.len() == 3 => synth(&args[2])?,
        "audition" if args.len() == 4 => audition(&args[2], &args[3])?,
        "devices" if args.len() == 2 => {
            println!("{}", serde_json::to_string_pretty(&playback::devices()?)?)
        }
        "probe" if args.len() == 3 => {
            let d = dsp::Dsp::new(3, 1., 0.);
            let n = 1_000_000;
            save(
                &args[2],
                &json!({"build":metadata(),"available_calls":n,"total_ns":d.boundary_probe(n),"interpretation":"C ABI plus native available() getter; not process() overhead"}),
            )?;
        }
        "play" if (4..=5).contains(&args.len()) => {
            let m = engine::Manifest::read(Path::new(&args[2]))?;
            let mode = scheduling::Mode::parse(args.get(4).map(String::as_str).unwrap_or(
                if cfg!(target_os = "macos") {
                    "realtime"
                } else {
                    "poll"
                },
            ))?;
            let mut v = playback::play(m, mode)?;
            v["build"] = metadata();
            save(&args[3], &v)?;
        }
        "bench" if (4..=5).contains(&args.len()) => {
            let m = engine::Manifest::read(Path::new(&args[2]))?;
            let mut engine = engine::Engine::new(m.clone())?;
            let mut block = vec![[0.; 2]; m.block_frames];
            let mut writer = if let Some(p) = args.get(4) {
                Some(hound::WavWriter::create(
                    p,
                    hound::WavSpec {
                        channels: 2,
                        sample_rate: 48000,
                        bits_per_sample: 32,
                        sample_format: hound::SampleFormat::Float,
                    },
                )?)
            } else {
                None
            };
            let cpu_start = metrics::resources()["process_cpu_seconds"]
                .as_f64()
                .unwrap();
            let start = Instant::now();
            let mut misses = 0;
            while engine.frame < m.duration_frames {
                let before = Instant::now();
                let n = engine.render(&mut block)?;
                if before.elapsed().as_secs_f64() > n as f64 / 48000. {
                    misses += 1;
                }
                if let Some(w) = writer.as_mut() {
                    for f in &block[..n] {
                        w.write_sample(f[0])?;
                        w.write_sample(f[1])?;
                    }
                }
            }
            if let Some(w) = writer {
                w.finalize()?;
            }
            let elapsed = start.elapsed().as_secs_f64();
            let resource = metrics::resources();
            save(
                &args[3],
                &json!({"mode":"unpaced_offline_benchmark","build":metadata(),"wall_seconds":elapsed,"audio_seconds":m.duration_frames as f64/48000.,"wall_to_audio_ratio":elapsed/(m.duration_frames as f64/48000.),"process_cpu_seconds_during_render":resource["process_cpu_seconds"].as_f64().unwrap()-cpu_start,"producer_blocks_over_nominal_device_deadline":misses,"callback_deadline_misses":null,"buffer_starvation":null,"engine":engine.report(),"resources":resource}),
            )?;
        }
        _ => bail!(usage),
    }
    Ok(())
}
fn main() {
    if let Err(e) = run() {
        eprintln!("{e:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tone() -> audio::Audio {
        audio::Audio {
            left: (0..48000)
                .map(|i| 0.2 * (std::f32::consts::TAU * 440. * i as f32 / 48000.).sin())
                .collect(),
            right: (0..48000)
                .map(|i| 0.2 * (std::f32::consts::TAU * 440. * i as f32 / 48000.).sin())
                .collect(),
        }
    }
    #[test]
    fn realtime_render_duration_stereo_and_pitch() {
        for engine in [2, 3] {
            for speed in [0.5, 0.8, 1., 1.25, 2.] {
                for pitch in [-3., 0., 3.] {
                    let (out, _) = audio::excerpt(&tone(), 0, 48000, engine, speed, pitch).unwrap();
                    assert_eq!(out.len(), (48000. / speed).round() as usize);
                    assert!(out.iter().flatten().all(|s| s.is_finite()));
                    assert!(out.iter().all(|f| (f[0] - f[1]).abs() < 1e-5));
                    let trimmed = &out[out.len() / 4..out.len() * 3 / 4];
                    let crossings = trimmed
                        .windows(2)
                        .filter(|f| f[0][0] <= 0. && f[1][0] > 0.)
                        .count();
                    let hz = crossings as f64 / (trimmed.len() as f64 / 48000.);
                    assert!(
                        (hz - 440. * 2_f64.powf(pitch / 12.)).abs() < 6.,
                        "{engine} {speed} {pitch}: {hz}"
                    );
                }
            }
        }
    }
    #[test]
    fn impulse_alignment() {
        let mut a = audio::Audio {
            left: vec![0.; 48000],
            right: vec![0.; 48000],
        };
        a.left[12000] = 0.8;
        a.right[12000] = 0.8;
        for engine in [2, 3] {
            let (out, _) = audio::excerpt(&a, 0, 48000, engine, 1., 0.).unwrap();
            let peak = out
                .iter()
                .enumerate()
                .max_by(|a, b| a.1[0].abs().total_cmp(&b.1[0].abs()))
                .unwrap()
                .0;
            assert!(
                (peak as i64 - 12000).abs() < 16,
                "engine {engine}: peak {peak}"
            );
        }
    }
}
