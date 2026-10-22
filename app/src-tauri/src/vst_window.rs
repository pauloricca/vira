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
async fn ui<T: Send + 'static>(
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
pub fn vst_paths(window: tauri::WebviewWindow) -> Result<Vec<PathBuf>, String> {
    main(&window)?;
    Ok(vst::paths())
}
#[tauri::command]
pub fn vst_save_paths(window: tauri::WebviewWindow, paths: Vec<PathBuf>) -> Result<(), String> {
    main(&window)?;
    vst::save_paths(paths).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn vst_rescan(window: tauri::WebviewWindow) -> Result<(), String> {
    main(&window)?;
    std::thread::spawn(vst::scan);
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
            .editor()
            .ok_or_else(|| anyhow::anyhow!("This plugin has no custom editor"))?;
        let window = tauri::WindowBuilder::new(&app, &label)
            .title(&title)
            .inner_size(800., 600.)
            .visible(false)
            .build()?;
        if let Err(e) = editor.open(WindowHandle::NSView(window.ns_view()?), 1.) {
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
                if let Some(editor) = instance.plugin.editor() {
                    editor.close();
                }
                if let Err(e) = instance.save(&save_id) {
                    vst::report_error(format!("Cannot save VST state: {e:#}"));
                    let _ = parent.emit("vst-error", format!("Cannot save VST state: {e:#}"));
                }
            }
            tauri::WindowEvent::Resized(size) => {
                let mut instance = instance.lock().unwrap();
                if let Some(editor) = instance.plugin.editor() {
                    if editor.is_resizable() {
                        let logical = size.to_logical::<u32>(
                            parent
                                .get_window(&format!("editor-{save_id}"))
                                .and_then(|w| w.scale_factor().ok())
                                .unwrap_or(1.),
                        );
                        editor.set_size(logical.width, logical.height);
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
            let editor = instance_guard.plugin.editor().ok_or("No custom editor")?;
            let window = tauri::WindowBuilder::new(app, "vst-editor-check")
                .title(format!("VIRA VST editor check · {}", descriptor.name))
                .inner_size(800., 600.)
                .visible(false)
                .build()?;
            editor.open(WindowHandle::NSView(window.ns_view()?), 1.)?;
            if let Some((width, height)) = editor.size() {
                window.set_size(tauri::LogicalSize::new(width, height))?;
                editor.set_size(width, height);
            }
            window.set_resizable(false)?;
            editor.show();
            drop(instance_guard);
            let app = app.handle().clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                    if let Some(editor) = instance.lock().unwrap().plugin.editor() {
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
