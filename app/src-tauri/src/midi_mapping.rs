//! UI control input shares the routing worker; never touches the audio callback.
use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, sync::Mutex};

#[derive(Clone, Serialize, Deserialize)]
pub struct Device {
    pub id: i32,
    pub name: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Signal {
    Cc { cc: u8 },
    Note { note: u8 },
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Message {
    pub device: i32,
    pub channel: u8,
    #[serde(flatten)]
    pub signal: Signal,
    pub value: u8,
}
#[derive(Default)]
pub struct State {
    pub devices: Vec<Device>,
    pub enabled: Vec<i32>,
    pub messages: VecDeque<Message>,
}
pub static STATE: Mutex<State> = Mutex::new(State {
    devices: Vec::new(),
    enabled: Vec::new(),
    messages: VecDeque::new(),
});

pub fn receive(device: i32, bytes: &[u8]) {
    if bytes.len() != 3 || bytes[1] > 127 || bytes[2] > 127 {
        return;
    }
    let (signal, value) = match bytes[0] & 0xf0 {
        0xb0 => (Signal::Cc { cc: bytes[1] }, bytes[2]),
        0x90 => (Signal::Note { note: bytes[1] }, bytes[2]),
        // Release velocity must never be interpreted as another press.
        0x80 => (Signal::Note { note: bytes[1] }, 0),
        _ => return,
    };
    if let Ok(mut s) = STATE.lock() {
        if !s.enabled.contains(&device) {
            return;
        }
        if s.messages.len() >= 2048 {
            s.messages.pop_front();
        }
        s.messages.push_back(Message {
            device,
            channel: (bytes[0] & 15) + 1,
            signal,
            value,
        });
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn get_midi_devices(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Main-window command".into());
    }
    let inventory = crate::midi_live::devices();
    let devices = serde_json::from_value(inventory["inputs"].clone()).map_err(|e| e.to_string())?;
    // Keep the next mapping poll from replacing a manual scan with its older inventory.
    STATE.lock().map_err(|e| e.to_string())?.devices = devices;
    Ok(inventory)
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn midi_mapping_poll(
    window: tauri::WebviewWindow,
    enabled: Vec<i32>,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Main-window command".into());
    }
    // Controller discovery must work before the Patterns page has been visited.
    crate::patterns::start();
    let mut s = STATE.lock().map_err(|e| e.to_string())?;
    // Purge messages from a controller as soon as it is disabled.
    s.messages.retain(|m| enabled.contains(&m.device));
    s.enabled = enabled;
    let messages: Vec<_> = s.messages.drain(..).collect();
    Ok(serde_json::json!({ "devices": s.devices, "messages": messages }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn enabled_cc_and_notes_preserve_identity_and_normalize_releases() {
        {
            let mut s = STATE.lock().unwrap();
            s.enabled = vec![42];
            s.messages.clear();
        }
        receive(1, &[0xb0, 7, 99]);
        receive(1, &[0x90, 7, 99]);
        receive(42, &[0xe0, 7, 99]);
        receive(42, &[0x90, 7, 99]);
        receive(42, &[0xb2, 7, 99]);
        receive(42, &[0x80, 7, 100]);
        receive(42, &[0x90, 7, 0]);
        receive(42, &[0x91, 60, 1]);
        let mut s = STATE.lock().unwrap();
        assert_eq!(s.messages.len(), 5);
        let note = s.messages.pop_front().unwrap();
        assert_eq!(note.signal, Signal::Note { note: 7 });
        let cc = s.messages.pop_front().unwrap();
        assert_eq!((cc.device, cc.channel, cc.value), (42, 3, 99));
        assert_eq!(cc.signal, Signal::Cc { cc: 7 });
        assert_eq!(serde_json::to_value(cc).unwrap()["type"], "cc");
        assert_eq!(s.messages.pop_front().unwrap().value, 0);
        assert_eq!(s.messages.pop_front().unwrap().value, 0);
        let soft_note = s.messages.pop_front().unwrap();
        assert_eq!((soft_note.channel, soft_note.value), (2, 1));
    }
}
