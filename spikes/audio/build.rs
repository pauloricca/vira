fn main() {
    #[cfg(feature = "host")]
    tauri_build::build();
    let root =
        std::env::var("RUBBERBAND_SOURCE").expect("Use docker compose run --rm dev; see README");
    assert!(
        std::path::Path::new(&root).exists(),
        "Rubber Band source missing"
    );
    cc::Build::new()
        .cpp(true)
        .std("c++11")
        .opt_level(3)
        .flag_if_supported("-Wno-unused-parameter")
        .file(format!("{root}/single/RubberBandSingle.cpp"))
        .compile("rubberband");
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "macos" {
        println!("cargo:rustc-link-lib=framework=Accelerate");
        cc::Build::new()
            .file("native/audio_worker.c")
            .opt_level(3)
            .compile("vira_worker");
        println!("cargo:rustc-link-lib=framework=AudioToolbox");
    }
    println!("cargo:rerun-if-env-changed=RUBBERBAND_SOURCE");
    println!("cargo:rerun-if-changed=native/audio_worker.c");
    println!("cargo:rerun-if-changed=scripts/zig-wrapper.py");
    println!("cargo:rerun-if-changed={root}/single/RubberBandSingle.cpp");
}
