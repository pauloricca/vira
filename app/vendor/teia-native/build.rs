use std::{env, fs, path::PathBuf};
fn replace(source: &mut String, from: &str, to: &str) {
    assert!(source.contains(from), "Teia native input overlay no longer matches: {from}");
    *source = source.replacen(from, to, 1);
}
fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../teia-kernel/src");
    let output = PathBuf::from(env::var("OUT_DIR").unwrap()).join("kernel");
    fs::create_dir_all(&output).unwrap();
    println!("cargo:rerun-if-changed=build.rs");
    for file in fs::read_dir(root).unwrap() {
        let file = file.unwrap();
        println!("cargo:rerun-if-changed={}", file.path().display());
        fs::copy(file.path(), output.join(file.file_name())).unwrap();
    }
    let mut lib = fs::read_to_string(output.join("lib.rs")).unwrap();
    replace(&mut lib, "#![cfg_attr(\n    all(feature = \"parallel\", target_arch = \"wasm32\"),\n    feature(thread_local)\n)]", "// Native-only VIRA input overlay.");
    replace(&mut lib, "            let input = match selector {", "            let slot = kernel_global!(VIRA_INPUT_SLOTS)[op.out as usize];\n            let routed = kernel_global!(VIRA_ROUTED_INPUTS_ENABLED) && slot >= 0 && slot < 32;\n            let input = if routed {\n                let stereo = &kernel_global!(VIRA_ROUTED_INPUTS)[slot as usize];\n                match selector { 0 => stereo[0][frame.min(127)], 1 => stereo[1][frame.min(127)], _ => (stereo[0][frame.min(127)] + stereo[1][frame.min(127)]) * 0.5 }\n            } else { match selector {");
    replace(&mut lib, "                _ => kernel_global!(INPUT)[frame],\n            } as f64;", "                _ => kernel_global!(INPUT)[frame],\n            } } as f64;");
    fs::write(output.join("lib.rs"), lib).unwrap();
    let mut fields = fs::read_to_string(output.join("state_fields.rs")).unwrap();
    replace(&mut fields, "        DSP_STEREO_INPUT_ENABLED:", "        VIRA_INPUT_SLOTS: [i32; MAX_DSP_REGS] = [-1; MAX_DSP_REGS];\n        VIRA_ROUTED_INPUTS_ENABLED: bool = false;\n        VIRA_ROUTED_INPUTS: [[[f32; 128]; 2]; 32] = [[[0.; 128]; 2]; 32];\n        DSP_STEREO_INPUT_ENABLED:");
    fs::write(output.join("state_fields.rs"), fields).unwrap();
    let mut hosted = fs::read_to_string(output.join("hosted.rs")).unwrap();
    replace(&mut hosted, "    fn validate_control(", r#"    pub fn set_audio_input_routes(&mut self, bindings: &[(usize, usize)]) -> Result<(), Error> {
        if bindings.iter().any(|(register, slot)| *register >= MAX_DSP_REGS || *slot >= 32) { return Err(Error::InvalidValues); }
        self.state.VIRA_INPUT_SLOTS.fill(-1);
        for &(register, slot) in bindings { self.state.VIRA_INPUT_SLOTS[register] = slot as i32; }
        Ok(())
    }
    /// VIRA's bounded, per-AudioInput stereo buses. Legacy callers stay unchanged.
    pub fn process_host_routed(&mut self, input: [&[f32]; 2], routed: &[[[f32; 128]; 2]], output: [&mut [f32]; 2], events: &[Event], timeline: &[TimelineSegment], midi_output: &mut [MidiOutput]) -> Result<usize, Error> {
        if routed.len() > 32 || output[0].len() > 128 || routed.iter().flatten().flatten().any(|v| !v.is_finite()) { return Err(Error::InvalidBlock); }
        self.state.VIRA_ROUTED_INPUTS.fill([[0.; 128]; 2]);
        self.state.VIRA_ROUTED_INPUTS[..routed.len()].copy_from_slice(routed);
        self.state.VIRA_ROUTED_INPUTS_ENABLED = true;
        let result = self.process_host(input, output, events, timeline, midi_output);
        self.state.VIRA_ROUTED_INPUTS_ENABLED = false;
        result
    }
    fn validate_control("#);
    fs::write(output.join("hosted.rs"), hosted).unwrap();
}
