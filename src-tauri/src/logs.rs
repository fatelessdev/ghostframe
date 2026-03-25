use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn resolve_logs_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        return Ok(PathBuf::from(user_profile)
            .join("Documents")
            .join("Ghostframe")
            .join("logs.txt"));
    }

    if let Ok(documents_dir) = app.path().document_dir() {
        return Ok(documents_dir.join("Ghostframe").join("logs.txt"));
    }

    Err("Unable to resolve Documents directory for logs".to_string())
}

#[tauri::command]
pub fn append_system_audio_log_line(app: AppHandle, line: String) -> Result<(), String> {
    let logs_path = resolve_logs_path(&app)?;

    if let Some(parent) = logs_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create log directory: {}", error))?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&logs_path)
        .map_err(|error| {
            format!(
                "Failed to open log file '{}': {}",
                logs_path.display(),
                error
            )
        })?;

    let trimmed = line.trim_end_matches(['\r', '\n']);
    file.write_all(trimmed.as_bytes())
        .map_err(|error| format!("Failed to write log entry: {}", error))?;
    file.write_all(b"\n")
        .map_err(|error| format!("Failed to terminate log entry: {}", error))?;

    Ok(())
}
