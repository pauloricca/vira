use crate::{routing::Graph, vst};
use std::path::PathBuf;
use tauri::{Emitter, Manager};
use truce_rack_core::{PluginCore, WindowHandle};
fn main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Main-window command".into())
    }
}
pub(crate) async fn ui<T: Send + 'static>(
    app: tauri::AppHandle,
    work: impl FnOnce(tauri::AppHandle) -> anyhow::Result<T> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(work(handle).map_err(|e| format!("{e:#}")));
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| e.to_string())?)
        .await
        .map_err(|e| e.to_string())?
}
pub fn restore() {
    if let Ok(bytes) = std::fs::read(crate::teia::Host::default_root().join(".vira-routing.json")) {
        vst::restore_states(&bytes);
        if let Ok(graph) = Graph::from_saved(&bytes).and_then(|g| {
            g.compile()?;
            Ok(g)
        }) {
            for node in graph.nodes {
                if let Some(v) = node.vst {
                    if let Err(e) = vst::prepare(&node.id, &v) {
                        vst::report_error(format!("Cannot restore {}: {e:#}", node.label));
                    }
                }
            }
        }
    }
}
#[tauri::command]
pub fn vst_catalog(window: tauri::WebviewWindow) -> Result<vst::Catalog, String> {
    main(&window)?;
    Ok(vst::catalog())
}
#[tauri::command]
pub fn vst_default_paths(window: tauri::WebviewWindow) -> Result<Vec<PathBuf>, String> {
    main(&window)?;
    Ok(vst::default_paths())
}
#[tauri::command]
pub fn vst_paths(window: tauri::WebviewWindow) -> Result<Vec<PathBuf>, String> {
    main(&window)?;
    Ok(vst::paths())
}
#[tauri::command]
pub async fn vst_choose_folder(window: tauri::WebviewWindow) -> Result<Option<PathBuf>, String> {
    main(&window)?;
    tauri::async_runtime::spawn_blocking(|| {
        let output = std::process::Command::new("/usr/bin/osascript")
            .args(["-e", "on run argv\ntry\nreturn POSIX path of (choose folder with prompt (item 1 of argv))\non error number -128\nreturn \"\"\nend try\nend run", "Choose VIRA's VSTs folder"])
            .output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        let path = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
        let path = path.trim_end_matches('\n');
        Ok(if path.is_empty() { None } else { Some(PathBuf::from(path)) })
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn vst_save_paths(window: tauri::WebviewWindow, paths: Vec<PathBuf>) -> Result<(), String> {
    main(&window)?;
    vst::save_paths(paths).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn vst_rescan(window: tauri::WebviewWindow, retry: Option<bool>) -> Result<(), String> {
    main(&window)?;
    std::thread::spawn(move || vst::scan_with_retry(retry.unwrap_or(false)));
    Ok(())
}
#[tauri::command]
pub async fn vst_prepare(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    descriptor: vst::Descriptor,
) -> Result<(), String> {
    main(&window)?;
    if !id.starts_with("vst-")
        || id.len() != 40
        || !id[4..].bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
    {
        return Err("Invalid VST instance ID".into());
    }
    if !vst::catalog().plugins.contains(&descriptor) {
        return Err("Plugin is unavailable; scan its folder first".into());
    }
    ui(app, move |_| vst::prepare(&id, &descriptor)).await
}
#[tauri::command]
pub async fn vst_open_editor(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    main(&window)?;
    ui(app, move |app| {
        let label = format!("editor-{id}");
        if let Some(window) = app.get_window(&label) {
            window.show()?;
            window.set_focus()?;
            return Ok(());
        }
        let instance =
            vst::instance(&id).ok_or_else(|| anyhow::anyhow!("Add the VST to routing first"))?;
        let mut guard = instance.lock().unwrap();
        let title = guard.descriptor.name.clone();
        let editor = guard
            .plugin
            .plugin_mut()
            .editor()
            .ok_or_else(|| anyhow::anyhow!("This plugin has no custom editor"))?;
        let window = tauri::WindowBuilder::new(&app, &label)
            .title(&title)
            .inner_size(800., 600.)
            .visible(false)
            .build()?;
        if let Err(e) = editor.open(
            WindowHandle::NSView(window.ns_view()?),
            window.scale_factor()?,
        ) {
            let _ = window.destroy();
            return Err(e.into());
        }
        if let Some((w, h)) = editor.size() {
            window.set_size(tauri::LogicalSize::new(w, h))?;
            editor.set_size(w, h);
        }
        window.set_resizable(editor.is_resizable())?;
        editor.show();
        drop(guard);
        let save_id = id.clone();
        let parent = app.clone();
        window.on_window_event(move |event| match event {
            tauri::WindowEvent::CloseRequested { .. } => {
                let mut instance = instance.lock().unwrap();
                if let Some(editor) = instance.plugin.plugin_mut().editor() {
                    editor.close();
                }
                if let Err(e) = instance.save(&save_id) {
                    vst::report_error(format!("Cannot save VST state: {e:#}"));
                    let _ = parent.emit("vst-error", format!("Cannot save VST state: {e:#}"));
                }
                drop(instance);
                vst::save_all();
            }
            tauri::WindowEvent::Resized(size) => {
                let mut instance = instance.lock().unwrap();
                if let Some(editor) = instance.plugin.plugin_mut().editor() {
                    if editor.is_resizable() {
                        let logical = size.to_logical::<u32>(
                            parent
                                .get_window(&format!("editor-{save_id}"))
                                .and_then(|w| w.scale_factor().ok())
                                .unwrap_or(1.),
                        );
                        if let Some((w, h)) = editor.set_size(logical.width, logical.height) {
                            if (w, h) != (logical.width, logical.height) {
                                if let Some(window) =
                                    parent.get_window(&format!("editor-{save_id}"))
                                {
                                    let _ = window.set_size(tauri::LogicalSize::new(w, h));
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        });
        window.show()?;
        window.set_focus()?;
        Ok(())
    })
    .await
}
/// Save on orderly quit as well as editor close. Main thread owns GUI teardown.
pub fn save_all() {
    vst::save_all();
}

/// Standalone editor smoke check. Does not open VIRA's session or write settings.
pub fn check_editor(path: PathBuf) {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .setup(move |app| {
            let descriptors = vst::probe(&path)?;
            let descriptor = descriptors.first().ok_or("No plugin")?;
            let id = "vst-00000000-0000-0000-0000-000000000000";
            vst::prepare(id, descriptor)?;
            let instance = vst::instance(id).unwrap();
            let mut instance_guard = instance.lock().unwrap();
            let editor = instance_guard
                .plugin
                .plugin_mut()
                .editor()
                .ok_or("No custom editor")?;
            let window = tauri::WindowBuilder::new(app, "vst-editor-check")
                .title(format!("VIRA VST editor check · {}", descriptor.name))
                .inner_size(800., 600.)
                .visible(false)
                .build()?;
            editor.open(
                WindowHandle::NSView(window.ns_view()?),
                window.scale_factor()?,
            )?;
            if let Some((width, height)) = editor.size() {
                window.set_size(tauri::LogicalSize::new(width, height))?;
                editor.set_size(width, height);
            }
            window.set_resizable(false)?;
            editor.show();
            drop(instance_guard);
            if let Ok(cycles) = std::env::var("VIRA_PLUGIN_EDITOR_CYCLES")
                .and_then(|s| s.parse::<u32>().map_err(|_| std::env::VarError::NotPresent))
            {
                let app = app.handle().clone();
                let instance = instance.clone();
                let window = window.clone();
                std::thread::spawn(move || {
                    for cycle in 0..cycles.clamp(1, 10) {
                        std::thread::sleep(std::time::Duration::from_millis(600));
                        let app2 = app.clone();
                        let instance = instance.clone();
                        let window = window.clone();
                        let (tx, rx) = std::sync::mpsc::sync_channel(1);
                        let _ = app.run_on_main_thread(move || {
                            let outcome = (|| -> anyhow::Result<()> {
                                let mut guard = instance.lock().unwrap();
                                let editor = guard
                                    .plugin
                                    .plugin_mut()
                                    .editor()
                                    .ok_or_else(|| anyhow::anyhow!("Editor disappeared"))?;
                                editor.close();
                                editor.open(
                                    WindowHandle::NSView(window.ns_view()?),
                                    window.scale_factor()?,
                                )?;
                                if let Some((w, h)) = editor.size() {
                                    window.set_size(tauri::LogicalSize::new(w, h))?;
                                    editor.set_size(w, h);
                                }
                                editor.show();
                                println!("VIRA_VST_EDITOR_CHECK:reopened:{}", cycle + 1);
                                Ok(())
                            })();
                            if let Err(e) = &outcome {
                                eprintln!("Editor cycle failed: {e:#}");
                                app2.exit(1);
                            }
                            let _ = tx.send(outcome.is_ok());
                        });
                        if rx.recv_timeout(std::time::Duration::from_secs(10)) != Ok(true) {
                            return;
                        }
                    }
                    let app2 = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Some(editor) = instance.lock().unwrap().plugin.plugin_mut().editor()
                        {
                            editor.close();
                        }
                        println!("VIRA_VST_EDITOR_CHECK:cycles-passed");
                        app2.exit(0);
                    });
                });
            }
            let app = app.handle().clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                    if let Some(editor) = instance.lock().unwrap().plugin.plugin_mut().editor() {
                        editor.close();
                    }
                    println!("VIRA_VST_EDITOR_CHECK:closed");
                    app.exit(0);
                }
            });
            window.show()?;
            println!("VIRA_VST_EDITOR_CHECK:opened");
            Ok(())
        })
        .run(context)
        .expect("VST editor check failed");
}

#[tauri::command]
pub async fn vst_retain(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<(), String> {
    main(&window)?;
    ui(app, move |app| {
        let ids: std::collections::HashSet<_> = ids.into_iter().collect();
        for (label, window) in app.windows() {
            if let Some(id) = label.strip_prefix("editor-") {
                if !ids.contains(id) {
                    let _ = window.close();
                }
            }
        }
        vst::retain(&ids);
        Ok(())
    })
    .await
}
#[derive(serde::Serialize)]
pub struct Parameter {
    id: u32,
    index: usize,
    name: String,
    unit: String,
    min: f64,
    max: f64,
    default: f64,
    steps: u32,
    value: f64,
    text: String,
    readonly: bool,
}
#[tauri::command]
pub async fn vst_parameters(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    ids: Option<Vec<u32>>,
) -> Result<Vec<Parameter>, String> {
    main(&window)?;
    ui(app, move |_| {
        let shared = vst::instance(&id).ok_or_else(|| anyhow::anyhow!("Plugin is offline"))?;
        let i = shared.lock().unwrap();
        let p = i.plugin.plugin();
        let mut result = Vec::new();
        for index in 0..p.parameter_count().min(16384) {
            let info = p.parameter_info(index)?;
            if ids.as_ref().is_some_and(|ids| !ids.contains(&info.id)) {
                continue;
            }
            if info
                .flags
                .contains(truce_rack_core::info::ParameterFlags::HIDDEN)
            {
                continue;
            }
            let value = p.parameter_value(index)?;
            if ![info.min, info.max, info.default, value]
                .iter()
                .all(|v| v.is_finite())
                || info.max < info.min
            {
                continue;
            }
            result.push(Parameter {
                id: info.id,
                index,
                name: info.name,
                unit: info.unit,
                min: info.min,
                max: info.max,
                default: info.default,
                steps: if p.info().format == "clap" && info.step_count > 0 {
                    info.step_count.saturating_sub(1).max(1)
                } else {
                    info.step_count
                },
                value,
                text: p
                    .parameter_value_string(index, value)
                    .unwrap_or_else(|_| format!("{value:.3}")),
                readonly: info
                    .flags
                    .contains(truce_rack_core::info::ParameterFlags::READ_ONLY),
            });
        }
        Ok(result)
    })
    .await
}
#[tauri::command]
pub async fn vst_set_parameter(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    parameter: u32,
    value: f64,
) -> Result<(), String> {
    main(&window)?;
    ui(app, move |_| {
        anyhow::ensure!(value.is_finite(), "Invalid parameter value");
        let shared = vst::instance(&id).ok_or_else(|| anyhow::anyhow!("Plugin is offline"))?;
        let mut i = shared.lock().unwrap();
        let p = i.plugin.plugin_mut();
        let index = (0..p.parameter_count())
            .find(|&n| {
                p.parameter_info(n)
                    .map(|i| i.id == parameter)
                    .unwrap_or(false)
            })
            .ok_or_else(|| anyhow::anyhow!("Unknown parameter"))?;
        let info = p.parameter_info(index)?;
        anyhow::ensure!(
            !info
                .flags
                .contains(truce_rack_core::info::ParameterFlags::READ_ONLY),
            "Read-only parameter"
        );
        anyhow::ensure!(
            info.min.is_finite() && info.max.is_finite() && info.max >= info.min,
            "Invalid parameter range"
        );
        p.set_parameter(index, value.clamp(info.min, info.max))?;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn vst_recover(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: String,
    descriptor: vst::Descriptor,
) -> Result<(), String> {
    main(&window)?;
    if !vst::catalog()
        .plugins
        .iter()
        .any(|p| p.format == descriptor.format && p.uid == descriptor.uid)
    {
        return Err("Scan this plugin first".into());
    }
    ui(app, move |app| {
        if let Some(window) = app.get_window(&format!("editor-{id}")) {
            if let Some(instance) = vst::instance(&id) {
                if let Some(editor) = instance.lock().unwrap().plugin.plugin_mut().editor() {
                    editor.close();
                }
            }
            window.destroy()?;
        }
        vst::prepare(&id, &descriptor)
    })
    .await
}

/// Main-thread maintenance for callbacks, editor resize requests and periodic
/// state checkpoints. It never acquires an audio-handle mutex.
pub fn maintenance(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let pending = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut ticks = 0u32;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(33));
            if pending.swap(true, std::sync::atomic::Ordering::AcqRel) {
                continue;
            }
            let completed = pending.clone();
            ticks = ticks.wrapping_add(1);
            let save = ticks % 900 == 0;
            let latency = ticks % 30 == 0;
            let app2 = app.clone();
            if app
                .run_on_main_thread(move || {
                    for (id, (w, h)) in vst::service() {
                        if let Some(window) = app2.get_window(&format!("editor-{id}")) {
                            let _ = window.set_size(tauri::LogicalSize::new(w, h));
                        }
                    }
                    if latency && vst::refresh_latencies() {
                        if let Some(engine) =
                            app2.try_state::<std::sync::Arc<crate::runtime::EngineHandle>>()
                        {
                            let engine = engine.inner().clone();
                            std::thread::spawn(move || {
                                if let Err(e) = engine.rebind_plugins() {
                                    vst::report_error(format!("Latency update failed: {e:#}"));
                                }
                            });
                        }
                    }
                    if save {
                        vst::save_all();
                    }
                    completed.store(false, std::sync::atomic::Ordering::Release);
                })
                .is_err()
            {
                break;
            }
        }
    });
}
