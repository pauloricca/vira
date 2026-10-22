//! VIRA's format boundary. Native control objects stay on the main thread;
//! independent audio handles are exclusively accessed by the producer.
use anyhow::Result;
use truce_rack_core::{
    AudioBuffer, EventList, Plugin, PluginInfo, PluginScanner, ProcessContext, ProcessStatus,
};
pub enum Audio {
    Vst3(truce_rack_vst3::Vst3Processor),
    Clap(truce_rack_clap::ClapProcessor),
    #[cfg(target_os = "macos")]
    Au(truce_rack_au::AuProcessor),
}
impl Audio {
    pub fn stop(&mut self) {
        match self {
            Self::Vst3(p) => p.stop(),
            Self::Clap(p) => p.stop(),
            #[cfg(target_os = "macos")]
            Self::Au(_) => {}
        }
    }

    pub fn process(
        &mut self,
        buffer: &mut AudioBuffer<'_, f32>,
        events: &EventList,
        context: &mut ProcessContext<'_>,
    ) -> truce_rack_core::Result<ProcessStatus> {
        match self {
            Self::Vst3(p) => p.process(buffer, events, context),
            Self::Clap(p) => p.process(buffer, events, context),
            #[cfg(target_os = "macos")]
            Self::Au(p) => p.process(buffer, events, context),
        }
    }
}
pub enum Control {
    Vst3(truce_rack_vst3::Vst3Plugin),
    Clap(truce_rack_clap::ClapPlugin),
    #[cfg(target_os = "macos")]
    Au(truce_rack_au::AuPlugin),
}
impl Control {
    pub fn load(info: &PluginInfo) -> Result<Self> {
        Ok(match info.format {
            "vst3" => Self::Vst3(truce_rack_vst3::Vst3Scanner.load(info)?),
            "clap" => Self::Clap(truce_rack_clap::ClapScanner.load(info)?),
            #[cfg(target_os = "macos")]
            "au" => Self::Au(truce_rack_au::AuScanner.load(info)?),
            _ => anyhow::bail!("Unsupported plugin format"),
        })
    }
    pub fn plugin(&self) -> &dyn Plugin<f32> {
        match self {
            Self::Vst3(p) => p,
            Self::Clap(p) => p,
            #[cfg(target_os = "macos")]
            Self::Au(p) => p,
        }
    }
    pub fn plugin_mut(&mut self) -> &mut dyn Plugin<f32> {
        match self {
            Self::Vst3(p) => p,
            Self::Clap(p) => p,
            #[cfg(target_os = "macos")]
            Self::Au(p) => p,
        }
    }
    pub fn split_processor(&mut self) -> Audio {
        match self {
            Self::Vst3(p) => Audio::Vst3(p.split_processor()),
            Self::Clap(p) => Audio::Clap(p.split_processor()),
            #[cfg(target_os = "macos")]
            Self::Au(p) => Audio::Au(p.split_processor()),
        }
    }
    pub fn service(&mut self) -> Option<(u32, u32)> {
        match self {
            Self::Vst3(p) => p.service(),
            Self::Clap(p) => p.service(),
            #[cfg(target_os = "macos")]
            Self::Au(_) => None,
        }
    }
    pub fn latency_samples(&self) -> u32 {
        match self {
            Self::Vst3(p) => p.latency_samples(),
            Self::Clap(p) => p.latency_samples(),
            #[cfg(target_os = "macos")]
            Self::Au(p) => p.latency_samples(),
        }
    }
    pub fn midi_output(&self) -> bool {
        match self {
            Self::Vst3(p) => p.midi_output(),
            Self::Clap(p) => p.midi_output(),
            #[cfg(target_os = "macos")]
            Self::Au(p) => p.midi_output(),
        }
    }
}
