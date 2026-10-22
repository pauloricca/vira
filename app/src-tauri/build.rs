fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        tauri_build::build();
        cc::Build::new()
            .file("native/audio_worker.c")
            .file("native/teia_midi.c")
            .file("native/keep_awake.c")
            .opt_level(3)
            .compile("vira_worker");
        println!("cargo:rustc-link-lib=framework=AudioToolbox");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=CoreMIDI");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
        println!("cargo:rustc-link-lib=framework=IOKit");
        println!("cargo:rustc-link-lib=framework=Accelerate");
    }
    let root =
        std::env::var("RUBBERBAND_SOURCE").expect("Build and test in Docker; see app/README.md");
    cc::Build::new()
        .cpp(true)
        .std("c++11")
        .opt_level(3)
        .file(format!("{root}/single/RubberBandSingle.cpp"))
        .compile("rubberband");
    println!("cargo:rerun-if-env-changed=RUBBERBAND_SOURCE");
    println!("cargo:rerun-if-changed=native/audio_worker.c");
    println!("cargo:rerun-if-changed=native/teia_midi.c");
    println!("cargo:rerun-if-changed=native/keep_awake.c");
}
