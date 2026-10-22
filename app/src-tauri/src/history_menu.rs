//! macOS consumes menu accelerators before WKWebView receives keydown.
use tauri::{
    menu::{Menu, MenuItem},
    Manager,
};

pub fn menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    for item in menu.items()? {
        if let Some(edit) = item.as_submenu() {
            if edit.text()? == "Edit" {
                edit.remove_at(0)?;
                edit.remove_at(0)?;
                edit.insert_items(
                    &[
                        &MenuItem::with_id(app, "vira-undo", "Undo", true, Some("Cmd+Z"))?,
                        &MenuItem::with_id(app, "vira-redo", "Redo", true, Some("Cmd+Shift+Z"))?,
                    ],
                    0,
                )?;
            }
        }
    }
    Ok(menu)
}

pub fn handle(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let redo = match event.id().as_ref() {
        "vira-undo" => false,
        "vira-redo" => true,
        _ => return,
    };
    for window in app.webview_windows().values() {
        if window.is_focused().unwrap_or(false) {
            // Dispatch through the page's existing keyboard handlers, including
            // their focus/availability guards. Text editors retain native history.
            let _ = window.eval(format!("{}({redo})", include_str!("history_menu.js")));
            break;
        }
    }
}
