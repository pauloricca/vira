//! Vira-owned content-addressed resources. All I/O, decoding and allocation is off-render.
use crate::teia::Prepared;
use anyhow::{bail, ensure, Context, Result};
use serde_json::{json, Value};
use std::{fs, path::Path};
use teia_kernel::hosted::{Buffer, CustomWave, Image, Resources, Sample, SequenceEvent, Sequencer};
const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_TOTAL: usize = 128 * 1024 * 1024;
pub const REPEAT_CAPACITY: u32 = 16;
pub const REPEAT_MEMORY: u32 = 64 * 1024 * 1024;
// The native kernel bounds Buffer capacity in samples. Reject a restore that
// would exceed it after rate conversion, rather than compressing its duration.
pub(crate) fn validate_buffer_rate(samples: usize, source_rate: f64) -> Result<()> {
    ensure!(
        source_rate.is_finite() && source_rate > 0.,
        "Invalid Buffer sample rate"
    );
    let restored = (samples as f64 * crate::sample_rate::get() as f64 / source_rate).round();
    ensure!(restored <= 960000., "Saved Buffer exceeds native capacity at this sample rate. Choose a lower output rate or shorten the Buffer.");
    Ok(())
}
fn array<'a>(value: &'a Value, key: &str) -> Result<&'a [Value]> {
    match value.get(key) {
        None => Ok(&[]),
        Some(Value::Array(v)) => Ok(v),
        _ => bail!("Invalid {key}"),
    }
}
fn number(v: &Value) -> Result<f64> {
    v.as_f64()
        .filter(|v| v.is_finite())
        .context("Invalid resource number")
}
fn size(v: &Value) -> Result<usize> {
    usize::try_from(v.as_u64().context("Invalid resource size")?).context("Resource size overflow")
}
fn digest(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}
fn asset_path(root: &Path, reference: &str) -> Result<std::path::PathBuf> {
    let id = reference
        .strip_prefix("vira-asset:")
        .context("Select this media again in Vira; external/blob references are not portable")?;
    ensure!(
        id.len() == 64
            && id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()),
        "Invalid asset reference"
    );
    Ok(root.join("assets").join(format!("{id}.asset")))
}
fn read_asset(root: &Path, reference: &str) -> Result<(Value, Vec<u8>)> {
    let path = asset_path(root, reference)?;
    ensure!(
        fs::symlink_metadata(&path)?.is_file(),
        "Asset must be a regular file"
    );
    ensure!(
        fs::metadata(&path)?.len() <= (MAX_BYTES + 4096) as u64,
        "Asset is too large"
    );
    let bytes = fs::read(path)?;
    ensure!(
        format!("vira-asset:{}", digest(&bytes)) == reference,
        "Asset checksum mismatch"
    );
    let split = bytes
        .iter()
        .take(4096)
        .position(|b| *b == b'\n')
        .context("Invalid asset header")?;
    Ok((
        serde_json::from_slice(&bytes[..split])?,
        bytes[split + 1..].to_vec(),
    ))
}
fn store(root: &Path, metadata: Value, payload: &[u8]) -> Result<String> {
    ensure!(payload.len() <= MAX_BYTES, "Decoded media exceeds 64 MiB");
    let mut bytes = serde_json::to_vec(&metadata)?;
    bytes.push(b'\n');
    bytes.extend_from_slice(payload);
    let reference = format!("vira-asset:{}", digest(&bytes));
    let path = asset_path(root, &reference)?;
    fs::create_dir_all(path.parent().unwrap())?;
    // Publish only complete immutable files. Parallel imports share the same
    // content hash without observing another writer's partial payload.
    use std::io::Write;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_nanos();
    let temporary = path.with_extension(format!("{}-{nonce}.tmp", std::process::id()));
    let result = (|| -> Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        match fs::hard_link(&temporary, &path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                read_asset(root, &reference)?;
                Ok(())
            }
            Err(e) => Err(e.into()),
        }
    })();
    let _ = fs::remove_file(temporary);
    result?;
    Ok(reference)
}
fn floats(bytes: &[u8]) -> Result<Vec<f32>> {
    ensure!(
        bytes.len() % 4 == 0 && bytes.len() <= MAX_BYTES,
        "Invalid sample data"
    );
    let data: Vec<_> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect();
    ensure!(data.iter().all(|v| v.is_finite()), "Non-finite sample data");
    Ok(data)
}
pub fn import(
    root: &Path,
    kind: &str,
    name: &str,
    bytes: &[u8],
    width: u32,
    height: u32,
) -> Result<Value> {
    ensure!(
        bytes.len() <= MAX_BYTES && !bytes.is_empty(),
        "Media must be nonempty and at most 64 MiB"
    );
    let reference = match kind {
        "image" => {
            ensure!(
                (1..=1024).contains(&width)
                    && (1..=1024).contains(&height)
                    && bytes.len() == width as usize * height as usize * 4,
                "Invalid image dimensions or RGBA payload"
            );
            store(
                root,
                json!({"kind":"image","width":width,"height":height}),
                bytes,
            )?
        }
        "sample" => {
            let (rate, samples) = decode_audio(bytes)?;
            let payload: Vec<u8> = samples.iter().flat_map(|v| v.to_le_bytes()).collect();
            store(root, json!({"kind":"sample","sampleRate":rate}), &payload)?
        }
        _ => bail!("Unknown media kind"),
    };
    Ok(json!({"name": name.chars().take(200).collect::<String>(), "url":reference}))
}
pub fn preview(root: &Path, reference: &str) -> Result<Value> {
    let (meta, bytes) = read_asset(root, reference)?;
    if meta["kind"] == "image" {
        return Ok(
            json!({"kind":"image","width":meta["width"],"height":meta["height"],"rgba":bytes}),
        );
    }
    ensure!(meta["kind"] == "sample", "Unknown asset kind");
    let samples = floats(&bytes)?;
    let stride = samples.len().div_ceil(512).max(1);
    let bins: Vec<_> = samples.chunks(stride).map(|bin| json!({"min":bin.iter().copied().fold(f32::INFINITY, f32::min), "max":bin.iter().copied().fold(f32::NEG_INFINITY, f32::max)})).collect();
    Ok(
        json!({"kind":"sample","duration":samples.len() as f64 / number(&meta["sampleRate"])? ,"bins":bins}),
    )
}
pub fn prepare(root: &Path, prepared: &Prepared) -> Result<Resources> {
    let meta = serde_json::to_value(&prepared.program.metadata)?;
    let mut result = Resources::default();
    let mut total = 0usize;
    for binding in array(&meta, "customWaveBindings")? {
        let wave = &binding["customWave"];
        let mode = [
            "loop",
            "once",
            "ping-pong",
            "sustain",
            "sustain-loop",
            "sustain-ping-pong",
        ]
        .iter()
        .position(|mode| Some(*mode) == wave["mode"].as_str())
        .context("Unknown wave mode")? as i32;
        let points = array(wave, "points")?;
        ensure!(points.len() <= 1024, "Too many wave points");
        result.custom_waves.push(CustomWave {
            mode,
            sustain_start: number(&wave["sustainStart"])?,
            sustain_end: number(&wave["sustainEnd"])?,
            points: points
                .iter()
                .map(|p| Ok((number(&p["x"])?, number(&p["y"])?)))
                .collect::<Result<_>>()?,
        });
    }
    for binding in array(&meta, "sequencerBindings")? {
        let rows = array(binding, "events")?;
        let steps = size(&binding["steps"])?;
        ensure!(
            rows.len() <= 128 && steps <= 1024 && size(&binding["rows"])? == rows.len(),
            "Sequence exceeds host bounds"
        );
        let events = rows
            .iter()
            .map(|row| {
                let row = row.as_array().context("Invalid sequence row")?;
                ensure!(row.len() == steps, "Sequence row size mismatch");
                row.iter()
                    .map(|e| {
                        Ok(SequenceEvent {
                            active: e["active"].as_bool().context("Invalid sequence event")?,
                            start: number(&e["start"])?,
                            end: number(&e["end"])?,
                            velocity: number(&e["velocity"])?,
                            note: number(&e["note"])?,
                        })
                    })
                    .collect::<Result<Vec<_>>>()
            })
            .collect::<Result<Vec<_>>>()?;
        ensure!(
            matches!(binding["mode"].as_str(), Some("gate" | "trigger")),
            "Invalid sequence mode"
        );
        result.sequencers.push(Sequencer {
            gate_mode: binding["mode"] == "gate",
            steps: steps as u32,
            rows: events,
        });
    }
    for binding in array(&meta, "sampleBindings")? {
        let reference = binding["sample"]["url"]
            .as_str()
            .context("Missing sample reference")?;
        let (asset, bytes) = read_asset(root, reference)?;
        total += bytes.len();
        ensure!(total <= MAX_TOTAL, "Media exceeds 128 MiB per instance");
        ensure!(asset["kind"] == "sample", "Asset is not audio");
        result.samples.push(Sample {
            samples: floats(&bytes)?,
            sample_rate: number(&asset["sampleRate"])?,
            release: number(&binding["release"])?,
        });
    }
    for binding in array(&meta, "imageBindings")? {
        let (asset, bytes) = read_asset(
            root,
            binding["image"]["url"]
                .as_str()
                .context("Missing image reference")?,
        )?;
        total += bytes.len();
        ensure!(total <= MAX_TOTAL, "Media exceeds 128 MiB per instance");
        ensure!(asset["kind"] == "image", "Asset is not an image");
        result.images.push(Image {
            width: size(&asset["width"])? as u32,
            height: size(&asset["height"])? as u32,
            rgba: bytes,
        });
    }
    if !array(&meta, "repeatBindings")?.is_empty() {
        let depths: Vec<usize> = prepared
            .program
            .ops
            .iter()
            .enumerate()
            .filter(|(_, op)| matches!(op.opcode, 42 | 46))
            .map(|(index, _)| {
                1 + prepared
                    .program
                    .ops
                    .iter()
                    .enumerate()
                    .filter(|(start, op)| {
                        matches!(op.opcode, 42 | 46) && *start < index && op.b as usize > index
                    })
                    .count()
            })
            .collect();
        let capacity = (1..=REPEAT_CAPACITY)
            .rev()
            .find(|capacity| {
                depths
                    .iter()
                    .map(|depth| (*capacity as u64).saturating_pow(*depth as u32))
                    .fold(0u64, u64::saturating_add)
                    <= 1024
            })
            .context("Repeat tree exceeds total capacity")?;
        result.repeat_capacity = Some(capacity);
        result.repeat_memory_budget = REPEAT_MEMORY;
    }
    if let Some(buffers) = prepared
        .requirements
        .get("buffers")
        .and_then(Value::as_object)
    {
        for (node, snapshot) in buffers {
            let state = array(&meta, "stateBindings")?
                .iter()
                .find(|b| b["id"] == format!("{node}:buffer"))
                .context("Buffer snapshot has no matching node")?;
            let id = snapshot["hash"].as_str().context("Invalid buffer hash")?;
            let path = root.join("buffers").join(format!("{id}.f32"));
            ensure!(
                id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit()),
                "Invalid buffer hash"
            );
            ensure!(
                fs::metadata(&path)?.len() <= 960000 * 4,
                "Buffer snapshot too large"
            );
            let bytes = fs::read(path)?;
            ensure!(
                digest(&bytes) == id && bytes.len() / 4 == size(&snapshot["sampleCount"])?,
                "Buffer snapshot checksum/size mismatch"
            );
            let sample_rate = number(&snapshot["sampleRate"])?;
            validate_buffer_rate(bytes.len() / 4, sample_rate)?;
            result.buffers.push(Buffer {
                state: size(&state["state"])? as u32,
                samples: floats(&bytes)?,
                sample_rate,
            });
        }
    }
    Ok(result)
}
// Decode ordinary PCM/float WAV without a service or audio engine. macOS's
// offline converter also accepts AIFF, MP3, AAC and other installed codecs.
fn wav(bytes: &[u8]) -> Result<(f64, Vec<f32>)> {
    ensure!(
        bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE",
        "Not a PCM/float WAV"
    );
    let mut fmt = None;
    let mut data = None;
    let mut offset = 12;
    while offset + 8 <= bytes.len() {
        let len = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
        let end = (offset + 8).checked_add(len).context("Invalid WAV chunk")?;
        ensure!(end <= bytes.len(), "Truncated WAV");
        match &bytes[offset..offset + 4] {
            b"fmt " => fmt = Some(&bytes[offset + 8..end]),
            b"data" => data = Some(&bytes[offset + 8..end]),
            _ => {}
        }
        offset = end + (len % 2);
    }
    let fmt = fmt.context("Missing WAV format")?;
    let data = data.context("Missing WAV samples")?;
    ensure!(fmt.len() >= 16, "Invalid WAV format");
    let u16at = |i| u16::from_le_bytes(fmt[i..i + 2].try_into().unwrap());
    let mut encoding = u16at(0);
    if encoding == 65534 && fmt.len() >= 40 {
        encoding = u16at(24);
    }
    let channels = u16at(2) as usize;
    let bits = u16at(14) as usize;
    let stride = u16at(12) as usize;
    let rate = u32::from_le_bytes(fmt[4..8].try_into().unwrap()) as f64;
    ensure!(
        channels > 0
            && channels <= 32
            && (8000.0..=384000.0).contains(&rate)
            && matches!((encoding, bits), (1, 8 | 16 | 24 | 32) | (3, 32 | 64)),
        "Unsupported WAV encoding"
    );
    ensure!(
        stride == channels * (bits / 8)
            && data.len() % stride == 0
            && data.len() / stride <= MAX_BYTES / 4,
        "Invalid WAV frame layout or excessive duration"
    );
    let mut samples = Vec::with_capacity(data.len() / stride);
    for frame in data.chunks_exact(stride) {
        let mut sum = 0.0f64;
        for sample in frame.chunks_exact(bits / 8) {
            sum += match (encoding, bits) {
                (1, 8) => (sample[0] as f64 - 128.) / 128.,
                (1, 16) => i16::from_le_bytes(sample.try_into().unwrap()) as f64 / 32768.,
                (1, 24) => {
                    ((sample[0] as i32 | (sample[1] as i32) << 8 | (sample[2] as i32) << 16) << 8
                        >> 8) as f64
                        / 8388608.
                }
                (1, 32) => i32::from_le_bytes(sample.try_into().unwrap()) as f64 / 2147483648.,
                (3, 32) => f32::from_le_bytes(sample.try_into().unwrap()) as f64,
                (3, 64) => f64::from_le_bytes(sample.try_into().unwrap()),
                _ => unreachable!(),
            };
        }
        let sample = (sum / channels as f64) as f32;
        ensure!(sample.is_finite(), "Non-finite WAV sample");
        samples.push(sample);
    }
    ensure!(!samples.is_empty(), "Empty audio");
    Ok((rate, samples))
}
fn decode_audio(bytes: &[u8]) -> Result<(f64, Vec<f32>)> {
    if let Ok(decoded) = wav(bytes) {
        return Ok(decoded);
    }
    #[cfg(target_os = "macos")]
    {
        use std::{
            process::{Command, Stdio},
            time::{Duration, Instant},
        };
        let id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("vira-media-{}-{id}", std::process::id()));
        fs::create_dir(&dir)?;
        let result = (|| {
            let input = dir.join("source");
            let output = dir.join("decoded.wav");
            fs::write(&input, bytes)?;
            let mut child = Command::new("/usr/bin/afconvert")
                .args(["-f", "WAVE", "-d", "LEF32@48000", "-c", "1"])
                .arg(&input)
                .arg(&output)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()?;
            let start = Instant::now();
            loop {
                let too_large =
                    fs::metadata(&output).is_ok_and(|m| m.len() > (MAX_BYTES + 4096) as u64);
                if too_large || start.elapsed() > Duration::from_secs(20) {
                    let _ = child.kill();
                    let _ = child.wait();
                    bail!("Audio decode exceeded time/size limit");
                }
                if let Some(status) = child.try_wait()? {
                    ensure!(status.success(), "macOS cannot decode this audio file");
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            wav(&fs::read(output)?)
        })();
        let _ = fs::remove_dir_all(dir);
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        wav(bytes)
    }
}

pub fn validate_references(root: &Path, document: &Value) -> Result<()> {
    if let Some(nodes) = document["nodes"].as_array() {
        for node in nodes {
            for key in ["sample", "image"] {
                if let Some(reference) = node[key]["url"].as_str() {
                    read_asset(root, reference)?;
                }
            }
            if node["subpatch"].is_object() {
                validate_references(root, &node["subpatch"])?;
            }
        }
    }
    if let Some(buffers) = document["buffers"].as_object() {
        for snapshot in buffers.values() {
            let id = snapshot["hash"]
                .as_str()
                .context("Invalid Buffer snapshot")?;
            ensure!(
                id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit()),
                "Invalid Buffer hash"
            );
            let path = root.join("buffers").join(format!("{id}.f32"));
            ensure!(
                fs::metadata(&path)?.len() <= 960000 * 4,
                "Buffer snapshot too large"
            );
            ensure!(
                digest(&fs::read(path)?) == id,
                "Buffer snapshot is missing or corrupt"
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "vira-resource-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
    fn wave() -> Vec<u8> {
        let mut bytes = b"RIFF".to_vec();
        bytes.extend(44u32.to_le_bytes());
        bytes.extend(b"WAVEfmt ");
        bytes.extend(16u32.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(2u16.to_le_bytes());
        bytes.extend(48000u32.to_le_bytes());
        bytes.extend(192000u32.to_le_bytes());
        bytes.extend(4u16.to_le_bytes());
        bytes.extend(16u16.to_le_bytes());
        bytes.extend(b"data");
        bytes.extend(8u32.to_le_bytes());
        for value in [16384i16, 0, -16384, 0] {
            bytes.extend(value.to_le_bytes());
        }
        bytes
    }
    #[test]
    fn sample_rate_contract_buffers_preserve_duration_or_reject_capacity() {
        let rate = crate::sample_rate::get() as f64;
        assert!(validate_buffer_rate(960000, rate).is_ok());
        assert!(validate_buffer_rate(960000, rate * 2.).is_ok());
        assert!(validate_buffer_rate(960000, rate / 2.).is_err());
        assert!(validate_buffer_rate(100, 0.).is_err());
    }
    #[test]
    fn pcm_decode_and_immutable_asset_integrity() {
        let root = root();
        let bytes = wave();
        let (rate, samples) = wav(&bytes).unwrap();
        assert_eq!(rate, 48000.);
        assert_eq!(samples, [0.25, -0.25]);
        assert!(wav(&bytes[..30]).is_err());
        let a = import(&root, "sample", "clip.wav", &bytes, 0, 0).unwrap();
        let b = import(&root, "sample", "copy.wav", &bytes, 0, 0).unwrap();
        assert_eq!(a["url"], b["url"]);
        let reference = a["url"].as_str().unwrap();
        let preview = preview(&root, reference).unwrap();
        assert_eq!(preview["bins"][0]["max"], 0.25);
        assert!(read_asset(&root, "vira-asset:../../escape").is_err());
        assert!(read_asset(&root, "https://example.com/sample").is_err());
        fs::write(asset_path(&root, reference).unwrap(), b"corrupt").unwrap();
        assert!(read_asset(&root, reference).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn prepares_owned_resources_and_rejects_missing_assets() {
        let root = root();
        let audio = import(&root, "sample", "tone.wav", &wave(), 0, 0).unwrap();
        let image = import(&root, "image", "pixel.png", &[255, 0, 0, 255], 1, 1).unwrap();
        let prepared:Prepared=serde_json::from_value(json!({"profile":"native-scalar-v1","layout":"test","parameters":[],"diagnostics":[],"program":{"version":1,"ops":[],"values":[],
            "customWaveBindings":[{"customWave":{"mode":"ping-pong","sustainStart":0.5,"sustainEnd":0.75,"points":[{"x":0,"y":0},{"x":1,"y":1}]}}],
            "sampleBindings":[{"sample":audio,"release":0.2}],"imageBindings":[{"image":image}],
            "sequencerBindings":[{"mode":"gate","steps":1,"rows":1,"events":[[{"active":true,"start":0,"end":1,"velocity":1,"note":60}]]}],
            "repeatBindings":[{"nodeId":"spawn"}]}})).unwrap();
        let resources = prepare(&root, &prepared).unwrap();
        assert_eq!(resources.custom_waves[0].mode, 2);
        assert_eq!(resources.samples[0].samples, [0.25, -0.25]);
        assert_eq!(resources.images[0].rgba, [255, 0, 0, 255]);
        assert!(resources.sequencers[0].gate_mode);
        assert_eq!(resources.repeat_capacity, Some(16));
        assert!(
            validate_references(&root, &json!({"nodes":[{"sample":{"url":"blob:gone"}}]})).is_err()
        );
        fs::remove_dir_all(root.join("assets")).unwrap();
        assert!(prepare(&root, &prepared).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

pub fn store_buffer(root: &Path, samples: &[f32], rate: f64) -> Result<Value> {
    ensure!(
        (2..=960000).contains(&samples.len())
            && samples.iter().all(|v| v.is_finite())
            && rate.is_finite()
            && rate > 0.,
        "Invalid captured Buffer"
    );
    let bytes: Vec<u8> = samples.iter().flat_map(|v| v.to_le_bytes()).collect();
    let hash = digest(&bytes);
    let dir = root.join("buffers");
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{hash}.f32"));
    if !path.exists() {
        use std::io::Write;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos();
        let tmp = dir.join(format!("{hash}-{}-{nonce}.tmp", std::process::id()));
        let result = (|| -> Result<()> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&tmp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            match fs::hard_link(&tmp, &path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
                Err(e) => Err(e.into()),
            }
        })();
        let _ = fs::remove_file(tmp);
        result?;
    }
    ensure!(
        digest(&fs::read(path)?) == hash,
        "Buffer asset checksum mismatch"
    );
    Ok(json!({"hash":hash,"sampleRate":rate,"sampleCount":samples.len()}))
}
