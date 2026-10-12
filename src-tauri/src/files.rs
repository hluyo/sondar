//! Files written by the app: session logs and plot exports.
//!
//! Everything goes under `Documents/Sonda Serial/<kind>/`, so the user always knows
//! where to look and no save dialog is needed.

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

const APP_FOLDER: &str = "Sonda Serial";

#[derive(Default)]
pub struct LogState(Mutex<Option<BufWriter<File>>>);

/// `Documents/Sonda Serial/<kind>`, created if missing. `kind` is "logs" or "exports".
fn folder(app: &AppHandle, kind: &str) -> Result<PathBuf, String> {
    if kind != "logs" && kind != "exports" {
        return Err(format!("Unknown folder: {kind}"));
    }
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join(APP_FOLDER)
        .join(kind);
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir)
}

/// Keeps file names portable: letters, digits, `-`, `_` and `.` only.
fn safe_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "-_.".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Starts a new log file and returns its full path.
#[tauri::command]
pub fn log_start(
    app: AppHandle,
    state: State<'_, LogState>,
    name: String,
) -> Result<String, String> {
    let path = folder(&app, "logs")?.join(safe_name(&name));
    let file = File::create(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(BufWriter::new(file));
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn log_write(state: State<'_, LogState>, text: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let writer = guard.as_mut().ok_or("Logging is not active")?;
    writer
        .write_all(text.as_bytes())
        .map_err(|e| e.to_string())?;
    // Flush every batch so the file is complete even if the app is closed abruptly.
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn log_stop(state: State<'_, LogState>) -> Result<(), String> {
    if let Some(mut writer) = state.0.lock().map_err(|e| e.to_string())?.take() {
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Writes a whole export file (e.g. plot CSV) and returns its full path.
#[tauri::command]
pub fn save_export(app: AppHandle, name: String, contents: String) -> Result<String, String> {
    let path = folder(&app, "exports")?.join(safe_name(&name));
    fs::write(&path, contents).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.display().to_string())
}

/// Opens the logs or exports folder in the system file manager.
#[tauri::command]
pub fn open_folder(app: AppHandle, kind: String) -> Result<(), String> {
    let dir = folder(&app, &kind)?;
    let program = if cfg!(target_os = "windows") {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    std::process::Command::new(program)
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
