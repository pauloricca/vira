//! Named, reusable hardware endpoints. Definitions never depend on canvas positions.
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::sync::{OnceLock, RwLock};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AudioPort {
    pub device: String,
    /// One based hardware channels, ordered left/right. Mono is duplicated on capture.
    pub channels: Vec<usize>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MidiPort {
    pub device: i32,
    pub channel: Option<u8>,
    #[serde(default)]
    pub send_clock: bool,
    #[serde(default)]
    pub send_transport: bool,
    #[serde(default = "default_transport_bars")]
    pub transport_bars: u8,
}
fn default_transport_bars() -> u8 {
    1
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Instrument {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub advance_ms: f64,
    pub audio_input: Option<AudioPort>,
    pub audio_output: Option<AudioPort>,
    pub midi_input: Option<MidiPort>,
    pub midi_output: Option<MidiPort>,
}
fn path() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
        .join("Library/Application Support/uk.ricca.vira/instruments.json")
}
static REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
pub fn revision() -> u64 {
    REVISION.load(std::sync::atomic::Ordering::Acquire)
}
fn definitions() -> &'static RwLock<Vec<Instrument>> {
    static ITEMS: OnceLock<RwLock<Vec<Instrument>>> = OnceLock::new();
    ITEMS.get_or_init(|| {
        RwLock::new(
            std::fs::read(path())
                .ok()
                .and_then(|b| serde_json::from_slice::<Vec<Instrument>>(&b).ok())
                .filter(|items| validate(items).is_ok())
                .unwrap_or_default(),
        )
    })
}
pub fn list() -> Vec<Instrument> {
    definitions().read().unwrap().clone()
}
pub fn named(node: &str) -> Option<Instrument> {
    let id = node.strip_prefix("instrument-")?;
    definitions()
        .read()
        .unwrap()
        .iter()
        .find(|i| i.id == id)
        .cloned()
}
pub fn audio(node: &str, input: bool) -> Result<AudioPort> {
    let prefix = if input {
        "instrument-in-"
    } else {
        "instrument-out-"
    };
    let id = node
        .strip_prefix(prefix)
        .ok_or_else(|| anyhow::anyhow!("Invalid instrument endpoint"))?;
    let item = definitions()
        .read()
        .unwrap()
        .iter()
        .find(|i| i.id == id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("Instrument no longer exists"))?;
    (if input {
        item.audio_input
    } else {
        item.audio_output
    })
    .ok_or_else(|| anyhow::anyhow!("Instrument audio connection is disabled"))
}
pub fn validate(items: &[Instrument]) -> Result<()> {
    ensure!(items.len() <= 64, "Maximum 64 instruments");
    for (index, item) in items.iter().enumerate() {
        ensure!(
            item.advance_ms.is_finite() && item.advance_ms >= 0.0,
            "Timing advance must be a finite, non-negative number of milliseconds"
        );
        ensure!(
            !item.id.is_empty()
                && item.id.len() <= 40
                && item
                    .id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !items[..index].iter().any(|i| i.id == item.id),
            "Invalid instrument identity"
        );
        ensure!(
            !item.name.trim().is_empty() && item.name.len() <= 80,
            "Instrument name must contain 1–80 characters"
        );
        for port in [&item.audio_input, &item.audio_output]
            .into_iter()
            .flatten()
        {
            ensure!(
                !port.device.is_empty() && port.device.len() <= 512,
                "Choose an audio device"
            );
            ensure!(
                (1..=2).contains(&port.channels.len())
                    && port.channels.iter().all(|c| (1..=128).contains(c))
                    && (port.channels.len() == 1 || port.channels[0] != port.channels[1]),
                "Select one mono channel or two different stereo channels"
            );
        }
        if let Some(port) = &item.midi_output {
            ensure!(
                matches!(port.transport_bars, 1 | 2 | 4 | 16 | 32),
                "Transport Play interval must be 1, 2, 4, 16 or 32 bars"
            );
        }
        for port in [&item.midi_input, &item.midi_output].into_iter().flatten() {
            ensure!(
                port.device != 0 && port.channel.is_none_or(|c| (1..=16).contains(&c)),
                "Choose a MIDI device and channel 1–16 or All"
            );
        }
    }
    Ok(())
}
pub fn save(items: Vec<Instrument>) -> Result<()> {
    validate(&items)?;
    let mut current = definitions().write().unwrap();
    let path = path();
    std::fs::create_dir_all(path.parent().unwrap())?;
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, serde_json::to_vec_pretty(&items)?)?;
    std::fs::rename(temporary, path)?;
    *current = items;
    REVISION.fetch_add(1, std::sync::atomic::Ordering::Release);
    Ok(())
}
/// Resolve references every scheduling tick, so existing cables follow edits.
pub fn resolve(bank: &crate::patterns::Bank) -> crate::patterns::Bank {
    resolve_with(bank, &list())
}
fn resolve_with(bank: &crate::patterns::Bank, items: &[Instrument]) -> crate::patterns::Bank {
    let mut bank = bank.clone();
    if let Some(graph) = &mut bank.graph {
        for node in &mut graph.nodes {
            if !node.id.starts_with("instrument-") {
                continue;
            }
            let item = items
                .iter()
                .find(|i| node.id == format!("instrument-{}", i.id))
                .cloned();
            node.advance_ms = item.as_ref().map_or(0.0, |i| i.advance_ms);
            node.label = item
                .as_ref()
                .map_or_else(|| "Missing instrument".into(), |i| i.name.clone());
            node.input = Some(
                item.as_ref()
                    .and_then(|i| i.midi_input.as_ref())
                    .map_or(0, |p| p.device),
            );
            node.destination = Some(crate::pattern_routing::Destination::Midi {
                output: item
                    .as_ref()
                    .and_then(|i| i.midi_output.as_ref())
                    .map_or(0, |p| p.device),
            });
            node.channel = item.and_then(|i| i.midi_output).and_then(|p| p.channel);
        }
    }
    bank
}
#[cfg(target_os = "macos")]
pub fn devices() -> Result<serde_json::Value> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let inputs: Vec<_> = crate::audio_inputs::devices()?
        .into_iter()
        .map(|(name, channels)| serde_json::json!({"id":name,"name":name,"channels":channels}))
        .collect();
    let outputs: Vec<_> = host
        .output_devices()?
        .filter_map(|d| {
            let name = d.name().ok()?;
            let channels = d
                .supported_output_configs()
                .ok()?
                .filter(|c| {
                    c.sample_format() == cpal::SampleFormat::F32
                        && c.min_sample_rate().0 <= crate::sample_rate::get() as u32
                        && c.max_sample_rate().0 >= crate::sample_rate::get() as u32
                })
                .map(|c| c.channels())
                .max()?;
            Some(serde_json::json!({"id":name,"name":name,"channels":channels}))
        })
        .collect();
    Ok(serde_json::json!({"inputs":inputs,"outputs":outputs}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn synth() -> Instrument {
        serde_json::from_value(json!({"id":"synth","name":"My synth","audio_input":{"device":"Interface","channels":[3,4]},"audio_output":null,"midi_input":{"device":41,"channel":2},"midi_output":{"device":42,"channel":9}})).unwrap()
    }
    #[test]
    fn transport_interval_defaults_to_one_bar_and_validates_and_roundtrips() {
        let mut item = synth();
        assert_eq!(item.midi_output.as_ref().unwrap().transport_bars, 1);
        for bars in [1, 2, 4, 16, 32] {
            item.midi_output.as_mut().unwrap().transport_bars = bars;
            validate(&[item.clone()]).unwrap();
            let restored: Instrument =
                serde_json::from_slice(&serde_json::to_vec(&item).unwrap()).unwrap();
            assert_eq!(restored, item);
        }
        for bars in [0, 3, 8, 64] {
            item.midi_output.as_mut().unwrap().transport_bars = bars;
            assert!(validate(&[item.clone()]).is_err());
        }
    }
    #[test]
    fn timing_flows_back_through_transformations_per_instrument_route() {
        let bank: crate::patterns::Bank = serde_json::from_value(json!({
            "patterns":[{"id":"p","name":"Pattern","kind":"melodic","mode":"relative","output":0,"channel":1,"bars":1,"grid":4,"key":0,"scale":0,"octave":4,"quantum":4,"compensation":90,"notes":[]}],
            "outputCompensation":{"42":80},
            "graph":{"nodes":[
                {"id":"p","kind":"pattern","label":"Pattern","x":0,"y":0,"pattern":"p"},
                {"id":"filter","kind":"transformation","label":"Filter","x":0,"y":0,"transformation":{"kind":"filter","direction":"above","note":40}},
                {"id":"instrument-synth","kind":"instrument","label":"Synth","x":0,"y":0},
                {"id":"instrument-second","kind":"instrument","label":"Second","x":0,"y":0}
            ],"wires":[
                {"id":"in","from":"p","to":"filter","kind":"midi"},
                {"id":"first","from":"filter","to":"instrument-synth","kind":"midi"},
                {"id":"second","from":"p","to":"instrument-second","kind":"midi"}
            ]}
        })).unwrap();
        let mut first = synth();
        first.advance_ms = 1250.0;
        let mut second = synth();
        second.id = "second".into();
        second.advance_ms = 61.0;
        let resolved = resolve_with(&bank, &[first, second]);
        let playback = crate::pattern_routing::resolve_active(&resolved, [None, None], 0);
        assert_eq!(
            playback
                .patterns
                .iter()
                .find(|p| p.id == "in>first")
                .unwrap()
                .compensation,
            Some(1250.0)
        );
        assert_eq!(
            playback
                .patterns
                .iter()
                .find(|p| p.id == "second")
                .unwrap()
                .compensation,
            Some(61.0)
        );
        assert_eq!(bank.patterns[0].compensation, Some(90.0));
    }
    #[test]
    fn timing_advance_has_no_upper_limit() {
        let mut item = synth();
        for advance in [0.0, 100.0, 1250.0, 1_000_000.0] {
            item.advance_ms = advance;
            assert!(validate(&[item.clone()]).is_ok());
        }
        for advance in [-1.0, f64::INFINITY, f64::NAN] {
            item.advance_ms = advance;
            assert!(validate(&[item.clone()]).is_err());
        }
    }
    #[test]
    fn validates_optional_ports_channels_and_stable_unique_identities() {
        let mut item = synth();
        assert!(validate(&[item.clone()]).is_ok());
        assert!(validate(&[item.clone(), item.clone()]).is_err());
        item.audio_input.as_mut().unwrap().channels = vec![3, 3];
        assert!(validate(&[item.clone()]).is_err());
        item.audio_input = None;
        item.midi_input.as_mut().unwrap().channel = Some(17);
        assert!(validate(&[item.clone()]).is_err());
        item.midi_input = None;
        item.midi_output = None;
        assert!(validate(&[item]).is_ok());
    }
    #[test]
    fn existing_midi_cables_follow_device_and_channel_changes_and_missing_items_disable_ports() {
        let bank: crate::patterns::Bank = serde_json::from_value(json!({"patterns":[],"outputCompensation":{},"graph":{"nodes":[{"id":"instrument-synth","kind":"instrument","label":"Old name","x":0,"y":0,"destination":{"kind":"midi","output":1}}],"wires":[]}})).unwrap();
        let item = synth();
        let resolved = resolve_with(&bank, &[item.clone()]);
        let node = &resolved.graph.as_ref().unwrap().nodes[0];
        assert_eq!(node.label, "My synth");
        assert_eq!(node.input, Some(41));
        assert_eq!(node.channel, Some(9));
        assert_eq!(
            node.destination,
            Some(crate::pattern_routing::Destination::Midi { output: 42 })
        );
        assert_eq!(item.midi_input.unwrap().channel, Some(2));
        let missing = resolve_with(&bank, &[]);
        let node = &missing.graph.as_ref().unwrap().nodes[0];
        assert_eq!(node.input, Some(0));
        assert_eq!(
            node.destination,
            Some(crate::pattern_routing::Destination::Midi { output: 0 })
        );
        assert_eq!(bank.graph.as_ref().unwrap().nodes[0].label, "Old name");
    }
}
