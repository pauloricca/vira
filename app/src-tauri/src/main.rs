fn main() {
    // Native, UI-independent metadata smoke test; no media tools run on the Mac.
    let args: Vec<String> = std::env::args().collect();
    if let Some(position) = args
        .iter()
        .position(|arg| arg == "--native-check" || arg == "--native-timing-check")
    {
        let seconds = args
            .get(position + 1)
            .and_then(|v| v.parse().ok())
            .unwrap_or(600);
        let report = args
            .get(position + 2)
            .map(String::as_str)
            .unwrap_or("app/output/native-session.json");
        let result = if args[position] == "--native-timing-check" {
            vira::native_check::run_timing(seconds, std::path::Path::new(report))
        } else {
            vira::native_check::run(seconds, std::path::Path::new(report))
        };
        if let Err(error) = result {
            eprintln!("{error:#}");
            std::process::exit(1);
        }
        return;
    }
    let request = if args.iter().any(|arg| arg == "--scan-library") {
        Some(vira::scan_library())
    } else if args.iter().any(|arg| arg == "--library-state") {
        Some(vira::library_state())
    } else if let Some(position) = args.iter().position(|arg| arg == "--analyse-track") {
        Some(vira::request_analysis(
            args.get(position + 1).map(String::as_str).unwrap_or(""),
        ))
    } else {
        None
    };
    if let Some(request) = request {
        match request {
            Ok(library) => println!("{}", serde_json::to_string_pretty(&library).unwrap()),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    #[cfg(target_os = "macos")]
    vira::run();
    #[cfg(not(target_os = "macos"))]
    eprintln!("The VIRA window runs on macOS. Use --scan-library for a headless scan.");
}
