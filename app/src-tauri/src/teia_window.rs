//! Tauri adapter; Teia itself has no window/filesystem dependencies.
use crate::{runtime::EngineHandle, teia::Prepared};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
type Engine<'a> = State<'a, Arc<EngineHandle>>;
fn editor_host(
    window: &WebviewWindow,
    engine: &EngineHandle,
) -> Result<Arc<crate::teia::Host>, String> {
    editor(window)?;
    let slot = window
        .label()
        .strip_prefix("teia-editor-")
        .and_then(|s| s.parse::<usize>().ok())
        .ok_or("Invalid editor")?;
    engine
        .patches
        .get(slot)
        .cloned()
        .ok_or("Unknown patch".into())
}
fn editor(window: &WebviewWindow) -> Result<(), String> {
    if window.label().starts_with("teia-editor-") {
        Ok(())
    } else {
        Err("Editor-only command".into())
    }
}
fn main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Main-window command".into())
    }
}
async fn task<T: Send + 'static>(
    work: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}
#[tauri::command]
pub async fn teia_library(window: WebviewWindow, engine: Engine<'_>) -> Result<Value, String> {
    main(&window)?;
    let host = engine.teia.clone();
    task(move || host.library()).await
}
#[tauri::command]
pub async fn teia_read(
    window: WebviewWindow,
    engine: Engine<'_>,
    name: String,
) -> Result<Value, String> {
    main(&window)?;
    let host = engine.teia.clone();
    task(move || host.read(&name)).await
}
#[tauri::command]
pub async fn teia_import(
    window: WebviewWindow,
    engine: Engine<'_>,
    name: String,
    document: Value,
) -> Result<(), String> {
    main(&window)?;
    let host = engine.teia.clone();
    task(move || host.import(&name, &document)).await
}
#[tauri::command]
pub async fn teia_load(
    window: WebviewWindow,
    engine: Engine<'_>,
    name: String,
    saved_hash: String,
    document: Value,
    prepared: Prepared,
) -> Result<Value, String> {
    main(&window)?;
    let host = engine.teia.clone();
    task(move || host.load(&name, &saved_hash, document, prepared)).await
}
#[tauri::command]
pub fn teia_state(window: WebviewWindow, engine: Engine<'_>) -> Result<Value, String> {
    main(&window)?;
    Ok(engine.teia.snapshot())
}
#[tauri::command]
pub async fn teia_control(
    window: WebviewWindow,
    engine: Engine<'_>,
    action: String,
    parameter: Option<String>,
    value: Option<f64>,
    generation: Option<String>,
) -> Result<Value, String> {
    main(&window)?;
    let host = engine.teia.clone();
    let expected = generation
        .map(|s| s.parse::<u64>())
        .transpose()
        .map_err(|_| "Invalid generation")?;
    task(move || host.control(&action, parameter.as_deref(), value, expected)).await
}
#[tauri::command]
pub fn teia_open_editor(
    window: WebviewWindow,
    engine: Engine<'_>,
    app: tauri::AppHandle,
    slot: Option<usize>,
) -> Result<(), String> {
    main(&window)?;
    let slot = slot.unwrap_or(0);
    let host = engine.patches.get(slot).cloned().ok_or("Unknown patch")?;
    let label = format!("teia-editor-{slot}");
    if let Some(editor) = app.get_webview_window(&label) {
        editor.show().map_err(|e| e.to_string())?;
        return editor.set_focus().map_err(|e| e.to_string());
    }
    host.open_session().map_err(|e| e.to_string())?;
    let result =
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("teia-editor.html".into()))
            .title(format!(
                "VIRA · {}",
                host.snapshot()["record"]["name"]
                    .as_str()
                    .unwrap_or("Patch")
                    .trim_end_matches(".json")
            ))
            .inner_size(1200., 850.)
            .min_inner_size(800., 600.)
            .disable_drag_drop_handler()
            .build();
    match result {
        Ok(editor) => {
            editor.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    host.end_session();
                }
            });
            Ok(())
        }
        Err(error) => {
            host.end_session();
            Err(error.to_string())
        }
    }
}
#[tauri::command]
pub fn teia_editor_init(window: WebviewWindow, engine: Engine<'_>) -> Result<Value, String> {
    editor(&window)?;
    editor_host(&window, &engine)?
        .editor_init()
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn teia_feedback(window: WebviewWindow, engine: Engine<'_>) -> Result<Value, String> {
    let host = editor_host(&window, &engine)?;
    task(move || host.feedback()).await
}
#[tauri::command]
pub async fn teia_request(
    window: WebviewWindow,
    engine: Engine<'_>,
    app: tauri::AppHandle,
    command: Value,
    save_name: Option<String>,
) -> Result<Value, String> {
    let host = editor_host(&window, &engine)?;
    let slot = window
        .label()
        .strip_prefix("teia-editor-")
        .and_then(|s| s.parse::<usize>().ok())
        .ok_or("Invalid editor")?;
    let engine = engine.inner().clone();
    let context = command.clone();
    match task(move || {
        let applying = command["type"] == "apply";
        let _transaction = if applying {
            Some(engine.patch_transaction.lock().unwrap())
        } else {
            None
        };
        if applying {
            let mut graph = engine.routing_graph();
            graph.sync_patch_inputs(
                slot,
                crate::routing::patch_audio_inputs(&command["document"]),
            );
            graph.compile()?;
        }
        let reply = host.request(command, save_name)?;
        if reply["status"] == "installed" {
            if let Some(graph) = engine.sync_patch_routing(slot)? {
                let _ = app.emit("patch-routing-changed", graph);
            }
        }
        Ok(reply)
    })
    .await
    {
        Ok(reply) => Ok(reply),
        Err(message) => Ok(
            json!({ "requestId": context["requestId"], "sessionId": context["sessionId"], "revision": context["revision"], "generation": context["generation"], "status": "failed", "diagnostics": [{ "severity": "error", "code": "vira-host", "message": message }] }),
        ),
    }
}

#[tauri::command]
pub async fn teia_import_media(
    window: WebviewWindow,
    engine: Engine<'_>,
    kind: String,
    name: String,
    bytes: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<Value, String> {
    let host = editor_host(&window, &engine)?;
    task(move || host.import_media(&kind, &name, &bytes, width, height)).await
}
#[tauri::command]
pub async fn teia_media_preview(
    window: WebviewWindow,
    engine: Engine<'_>,
    reference: String,
) -> Result<Value, String> {
    let host = editor_host(&window, &engine)?;
    task(move || host.media_preview(&reference)).await
}

#[tauri::command]
pub fn teia_midi_configure(
    window: WebviewWindow,
    engine: Engine<'_>,
    input: i32,
    output: i32,
) -> Result<Value, String> {
    main(&window)?;
    engine.teia.midi.configure(input, output);
    Ok(engine.teia.snapshot())
}

#[tauri::command]
pub async fn teia_load_draft(
    window: WebviewWindow,
    engine: Engine<'_>,
    name: String,
    saved_hash: String,
    document: Value,
    prepared: Prepared,
) -> Result<Value, String> {
    main(&window)?;
    let host = engine.teia.clone();
    task(move || host.load_draft(&name, &saved_hash, document, prepared)).await
}

#[tauri::command]
pub fn patches_state(window: WebviewWindow, engine: Engine<'_>) -> Result<Value, String> {
    main(&window)?;
    Ok(json!(engine
        .patches
        .iter()
        .enumerate()
        .map(|(slot, host)| json!({"slot":slot,"state":host.snapshot()}))
        .collect::<Vec<_>>()))
}
#[tauri::command]
pub async fn patches_add(
    window: WebviewWindow,
    engine: Engine<'_>,
    name: String,
    saved_hash: String,
    document: Value,
    prepared: Prepared,
    draft: Option<bool>,
) -> Result<Value, String> {
    main(&window)?;
    let engine = engine.inner().clone();
    task(move || {
        let _transaction = engine.patch_transaction.lock().unwrap();
        anyhow::ensure!(
            !engine
                .patches
                .iter()
                .any(|h| h.snapshot()["record"]["name"] == name),
            "This patch is already added"
        );
        let (slot, host) = engine
            .patches
            .iter()
            .enumerate()
            .find(|(_, h)| h.snapshot()["record"].is_null())
            .ok_or_else(|| anyhow::anyhow!("Patch limit reached (16)"))?;
        let mut graph = engine.routing_graph();
        let source = host.read(&name)?;
        graph.add_patch(
            slot,
            name.trim_end_matches(".json").into(),
            crate::routing::patch_audio_inputs(&source["document"]),
        );
        graph.compile()?;
        if draft.unwrap_or(false) {
            host.load_draft(&name, &saved_hash, document, prepared)?;
        } else {
            host.load(&name, &saved_hash, document, prepared)?;
        }
        if let Err(error) = engine.set_routing_graph(graph) {
            let _ = host.control("remove", None, None, None);
            return Err(error);
        }
        Ok(json!({"slot":slot,"state":host.snapshot()}))
    })
    .await
}
#[tauri::command]
pub async fn patches_control(
    window: WebviewWindow,
    engine: Engine<'_>,
    slot: usize,
    action: String,
    parameter: Option<String>,
    value: Option<f64>,
    generation: String,
) -> Result<Value, String> {
    main(&window)?;
    let host = engine.patches.get(slot).cloned().ok_or("Unknown patch")?;
    let generation = generation
        .parse::<u64>()
        .map_err(|_| "Invalid generation")?;
    task(move || host.control(&action, parameter.as_deref(), value, Some(generation))).await
}

#[tauri::command]
pub async fn patches_remove(
    window: WebviewWindow,
    engine: Engine<'_>,
    slot: usize,
    generation: String,
) -> Result<(), String> {
    main(&window)?;
    let engine = engine.inner().clone();
    let expected = generation
        .parse::<u64>()
        .map_err(|_| "Invalid generation")?;
    task(move || {
        let _transaction = engine.patch_transaction.lock().unwrap();
        let host = engine
            .patches
            .get(slot)
            .ok_or_else(|| anyhow::anyhow!("Unknown patch"))?;
        let state = host.snapshot();
        anyhow::ensure!(
            state["generation"] == expected.to_string(),
            "Patch changed; retry removal"
        );
        anyhow::ensure!(
            state["editorOpen"] == false,
            "Close the editor before removing the patch"
        );
        anyhow::ensure!(!state["record"].is_null(), "Patch is already removed");
        let previous = engine.routing_graph();
        let mut graph = previous.clone();
        graph.remove_patch(slot);
        engine.set_routing_graph(graph)?;
        if let Err(error) = host.control("remove", None, None, Some(expected)) {
            engine.set_routing_graph(previous)?;
            return Err(error);
        }
        Ok(())
    })
    .await
}
