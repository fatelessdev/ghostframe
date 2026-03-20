use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use tokio::time::{sleep, Duration};

#[cfg(target_os = "macos")]
use tauri_nspanel::ManagerExt;

use crate::window::{
    hide_main_window, show_dashboard_window, show_main_window, sync_main_window,
    toggle_click_through_state,
};

const SENSITIVE_LOCAL_STORAGE_KEYS: &[&str] = &[
    "ai_provider_config",
    "curl_custom_ai_providers",
    "curl_selected_ai_provider",
    "curl_custom_speech_providers",
    "curl_selected_stt_provider",
    "system_prompt",
    "selected_system_prompt_id",
    "system_audio_context",
];

const EMERGENCY_ERASE_ACTION_ID: &str = "emergency_erase";
const TOGGLE_CLICK_THROUGH_ACTION_ID: &str = "toggle_click_through";
const EMERGENCY_ERASE_DATABASE_FILE: &str = "ghostframe.db";
const EMERGENCY_ERASE_STORAGE_SCRIPT: &str = "(function(){try{localStorage.clear();sessionStorage.clear();}catch(e){console.error('Failed to clear web storage during emergency erase', e);}})();";

pub struct WindowPreferencesState {
    always_on_top: AtomicBool,
    app_icon_visible: AtomicBool,
    content_protected: AtomicBool,
    click_through: AtomicBool,
    main_window_visible: AtomicBool,
}

impl Default for WindowPreferencesState {
    fn default() -> Self {
        Self {
            // Matches the `alwaysOnTop: true` default in tauri.conf.json
            always_on_top: AtomicBool::new(true),
            app_icon_visible: AtomicBool::new(true),
            // Matches the `contentProtected: true` default in tauri.conf.json
            content_protected: AtomicBool::new(true),
            click_through: AtomicBool::new(false),
            main_window_visible: AtomicBool::new(true),
        }
    }
}

impl WindowPreferencesState {
    pub fn always_on_top(&self) -> bool {
        self.always_on_top.load(Ordering::Relaxed)
    }

    pub fn set_always_on_top(&self, enabled: bool) {
        self.always_on_top.store(enabled, Ordering::Relaxed);
    }

    pub fn set_app_icon_visible(&self, visible: bool) {
        self.app_icon_visible.store(visible, Ordering::Relaxed);
    }

    pub fn content_protected(&self) -> bool {
        self.content_protected.load(Ordering::Relaxed)
    }

    pub fn set_content_protected(&self, enabled: bool) {
        self.content_protected.store(enabled, Ordering::Relaxed);
    }

    pub fn click_through(&self) -> bool {
        self.click_through.load(Ordering::Relaxed)
    }

    pub fn set_click_through(&self, enabled: bool) {
        self.click_through.store(enabled, Ordering::Relaxed);
    }

    pub fn main_window_visible(&self) -> bool {
        self.main_window_visible.load(Ordering::Relaxed)
    }

    pub fn set_main_window_visible(&self, visible: bool) {
        self.main_window_visible.store(visible, Ordering::Relaxed);
    }
}

// State for registered shortcuts
pub struct RegisteredShortcuts {
    pub shortcuts: Mutex<HashMap<String, String>>, // action_id -> shortcut_key
}

impl Default for RegisteredShortcuts {
    fn default() -> Self {
        RegisteredShortcuts {
            shortcuts: Mutex::new(HashMap::new()),
        }
    }
}

pub(crate) type MoveWindowTask = Arc<AtomicBool>;

pub(crate) struct MoveWindowState {
    tasks: Mutex<HashMap<String, MoveWindowTask>>,
}

impl Default for MoveWindowState {
    fn default() -> Self {
        MoveWindowState {
            tasks: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutBinding {
    pub action: String,
    pub key: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutsConfig {
    pub bindings: HashMap<String, ShortcutBinding>,
}

/// Initialize global shortcuts for the application
pub fn setup_global_shortcuts<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Let the frontend initialize from localStorage
    let state = app.state::<RegisteredShortcuts>();
    let mut registered = match state.shortcuts.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("Mutex poisoned in setup, recovering...");
            poisoned.into_inner()
        }
    };

    #[cfg(target_os = "macos")]
    let emergency_shortcut = "Cmd+Shift+E";
    #[cfg(not(target_os = "macos"))]
    let emergency_shortcut = "Ctrl+Shift+E";

    match emergency_shortcut.parse::<Shortcut>() {
        Ok(shortcut) => {
            if let Err(error) = app.global_shortcut().register(shortcut) {
                eprintln!("Failed to register emergency erase shortcut: {}", error);
            } else {
                registered.insert(
                    EMERGENCY_ERASE_ACTION_ID.to_string(),
                    emergency_shortcut.to_string(),
                );
            }
        }
        Err(error) => {
            eprintln!(
                "Failed to parse emergency erase shortcut '{}': {}",
                emergency_shortcut, error
            );
        }
    }

    #[cfg(target_os = "macos")]
    let click_through_shortcut = "Cmd+Shift+C";
    #[cfg(not(target_os = "macos"))]
    let click_through_shortcut = "Ctrl+Shift+C";

    match click_through_shortcut.parse::<Shortcut>() {
        Ok(shortcut) => {
            if let Err(error) = app.global_shortcut().register(shortcut) {
                eprintln!(
                    "Failed to register click-through shortcut '{}': {}",
                    click_through_shortcut, error
                );
            } else {
                registered.insert(
                    TOGGLE_CLICK_THROUGH_ACTION_ID.to_string(),
                    click_through_shortcut.to_string(),
                );
            }
        }
        Err(error) => {
            eprintln!(
                "Failed to parse click-through shortcut '{}': {}",
                click_through_shortcut, error
            );
        }
    }

    eprintln!("Global shortcuts state initialized, waiting for frontend config");

    Ok(())
}

pub fn scrub_sensitive_data_on_quit<R: Runtime>(app: &AppHandle<R>) {
    let mut script = String::from("(function(){try{");
    for key in SENSITIVE_LOCAL_STORAGE_KEYS {
        script.push_str(&format!("localStorage.removeItem({});", json!(key)));
    }
    script.push_str(
        "}catch(e){console.error('Failed to scrub sensitive localStorage keys', e);}})();",
    );

    for (label, window) in app.webview_windows() {
        if let Err(error) = window.eval(&script) {
            eprintln!(
                "Failed to scrub sensitive localStorage keys in '{}' window: {}",
                label, error
            );
        }
    }
}

fn clear_web_storage<R: Runtime>(app: &AppHandle<R>) {
    for (label, window) in app.webview_windows() {
        if let Err(error) = window.eval(EMERGENCY_ERASE_STORAGE_SCRIPT) {
            eprintln!(
                "Failed to clear web storage in '{}' window: {}",
                label, error
            );
        }
    }
}

fn clear_sqlite_database_files<R: Runtime>(app: &AppHandle<R>) {
    let mut candidate_dirs = Vec::new();

    if let Ok(dir) = app.path().app_data_dir() {
        candidate_dirs.push(dir.clone());
        candidate_dirs.push(dir.join("sqlite"));
    }

    if let Ok(dir) = app.path().app_local_data_dir() {
        candidate_dirs.push(dir.clone());
        candidate_dirs.push(dir.join("sqlite"));
    }

    if let Ok(dir) = app.path().app_cache_dir() {
        candidate_dirs.push(dir.clone());
        candidate_dirs.push(dir.join("sqlite"));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidate_dirs.push(current_dir.clone());
        candidate_dirs.push(current_dir.join("src-tauri"));
    }

    for dir in candidate_dirs {
        for suffix in ["", "-wal", "-shm"] {
            let path = dir.join(format!("{}{}", EMERGENCY_ERASE_DATABASE_FILE, suffix));
            if !path.exists() {
                continue;
            }

            if let Err(error) = fs::remove_file(&path) {
                eprintln!("Failed to remove database file '{}': {}", path.display(), error);
            }
        }
    }
}

fn perform_emergency_erase<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = hide_main_window(app) {
        eprintln!("Failed to hide main window during emergency erase: {}", error);
    }

    scrub_sensitive_data_on_quit(app);
    clear_web_storage(app);
    clear_sqlite_database_files(app);

    std::thread::sleep(std::time::Duration::from_millis(300));
    std::process::exit(0);
}

/// Handle shortcut action based on action_id
pub fn handle_shortcut_action<R: Runtime>(app: &AppHandle<R>, action_id: &str) {
    match action_id {
        "toggle_dashboard" => handle_toggle_dashboard(app),
        "toggle_window" => handle_toggle_window(app),
        "focus_input" => handle_focus_input(app),
        "move_window_up" => handle_move_window(app, "up"),
        "move_window_down" => handle_move_window(app, "down"),
        "move_window_left" => handle_move_window(app, "left"),
        "move_window_right" => handle_move_window(app, "right"),
        "toggle_click_through" => handle_toggle_click_through(app),
        "audio_recording" => handle_audio_shortcut(app),
        "screenshot" => handle_screenshot_shortcut(app),
        "system_audio" => handle_system_audio_shortcut(app),
        EMERGENCY_ERASE_ACTION_ID => perform_emergency_erase(app),
        custom_action => {
            // Emit custom action event for frontend to handle
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = window.emit(
                    "custom-shortcut-triggered",
                    json!({ "action": custom_action }),
                ) {
                    eprintln!("Failed to emit custom shortcut event: {}", e);
                }
            }
        }
    }
}

pub fn start_move_window<R: Runtime>(app: &AppHandle<R>, direction: &str) {
    let state = app.state::<MoveWindowState>();
    let mut tasks = match state.tasks.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if tasks.contains_key(direction) {
        return;
    }

    let stop_flag: MoveWindowTask = Arc::new(AtomicBool::new(false));
    let flag_clone = stop_flag.clone();
    let dir = direction.to_string();
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        let interval = Duration::from_millis(16);
        while !flag_clone.load(Ordering::Relaxed) {
            handle_move_window(&app_handle, &dir);
            sleep(interval).await;
        }
    });

    tasks.insert(direction.to_string(), stop_flag);
}

pub fn stop_move_window<R: Runtime>(app: &AppHandle<R>, direction: &str) {
    let state = app.state::<MoveWindowState>();
    let mut tasks = match state.tasks.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if let Some(flag) = tasks.remove(direction) {
        flag.store(true, Ordering::Relaxed);
    }
}

pub fn stop_all_move_windows<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<MoveWindowState>();
    let mut tasks = match state.tasks.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    for (_direction, flag) in tasks.drain() {
        flag.store(true, Ordering::Relaxed);
    }
}

/// Handle app toggle (hide/show) with input focus and app icon management
fn handle_toggle_window<R: Runtime>(app: &AppHandle<R>) {
    if app.state::<WindowPreferencesState>().main_window_visible() {
        if let Err(e) = hide_main_window(app) {
            eprintln!("Failed to hide window: {}", e);
        }
    } else if let Err(e) = show_main_window(app, false) {
        eprintln!("Failed to show window: {}", e);
    }
}

fn ensure_main_window_visible<R: Runtime>(app: &AppHandle<R>, focus_input: bool) -> bool {
    if app.state::<WindowPreferencesState>().main_window_visible() {
        return true;
    }

    if let Err(e) = show_main_window(app, focus_input) {
        eprintln!("Failed to show window: {}", e);
        return false;
    }

    true
}

/// Handle audio shortcut
fn handle_audio_shortcut<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if !app.state::<WindowPreferencesState>().main_window_visible()
            && !ensure_main_window_visible(app, true)
        {
            return;
        }

        if let Err(e) = window.emit("start-audio-recording", json!({})) {
            eprintln!("Failed to emit audio recording event: {}", e);
        }
    }
}

/// Handle screenshot shortcut
fn handle_screenshot_shortcut<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.emit("trigger-screenshot", json!({})) {
            eprintln!("Failed to emit screenshot event: {}", e);
        }
    }
}

/// Handle system audio shortcut
fn handle_system_audio_shortcut<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if !app.state::<WindowPreferencesState>().main_window_visible()
            && !ensure_main_window_visible(app, true)
        {
            return;
        }

        if let Err(e) = window.emit("toggle-system-audio", json!({})) {
            eprintln!("Failed to emit system audio event: {}", e);
        }
    }
}

/// Tauri command to get all registered shortcuts
#[tauri::command]
pub fn get_registered_shortcuts<R: Runtime>(
    app: AppHandle<R>,
) -> Result<HashMap<String, String>, String> {
    let state = app.state::<RegisteredShortcuts>();
    let registered = match state.shortcuts.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("Mutex poisoned in get_registered_shortcuts, recovering...");
            poisoned.into_inner()
        }
    };
    Ok(registered.clone())
}

/// Tauri command to update shortcuts dynamically
#[tauri::command]
pub fn update_shortcuts<R: Runtime>(
    app: AppHandle<R>,
    config: ShortcutsConfig,
) -> Result<(), String> {
    eprintln!("Updating shortcuts with {} bindings", config.bindings.len());

    let mut shortcuts_to_register = Vec::new();

    for (action_id, binding) in &config.bindings {
        if action_id == EMERGENCY_ERASE_ACTION_ID {
            continue;
        }

        if binding.enabled && !binding.key.is_empty() {
            if action_id == "move_window" {
                let modifiers = binding.key.trim();
                if modifiers.is_empty() {
                    continue;
                }

                let arrow_keys = vec!["up", "down", "left", "right"];
                for arrow in arrow_keys {
                    let full_key = format!("{}+{}", modifiers, arrow);
                    match full_key.parse::<Shortcut>() {
                        Ok(shortcut) => {
                            let direction_action_id = format!("move_window_{}", arrow);
                            shortcuts_to_register.push((direction_action_id, full_key, shortcut));
                        }
                        Err(e) => {
                            eprintln!("Invalid shortcut '{}' for move_window: {}", full_key, e);
                            return Err(format!(
                                "Invalid shortcut '{}' for move_window: {}",
                                full_key, e
                            ));
                        }
                    }
                }

                continue;
            }

            match binding.key.parse::<Shortcut>() {
                Ok(shortcut) => {
                    shortcuts_to_register.push((action_id.clone(), binding.key.clone(), shortcut));
                }
                Err(e) => {
                    eprintln!(
                        "Invalid shortcut '{}' for action '{}': {}",
                        binding.key, action_id, e
                    );
                    return Err(format!(
                        "Invalid shortcut '{}' for action '{}': {}",
                        binding.key, action_id, e
                    ));
                }
            }
        }
    }

    stop_all_move_windows(&app);
    unregister_all_shortcuts(&app)?;

    let mut successfully_registered = HashMap::new();
    let mut registration_failures: Vec<(String, String, String)> = Vec::new();

    for (action_id, shortcut_str, shortcut) in shortcuts_to_register {
        match app.global_shortcut().register(shortcut) {
            Ok(_) => {
                eprintln!("Registered shortcut: {} -> {}", action_id, shortcut_str);
                successfully_registered.insert(action_id, shortcut_str);
            }
            Err(e) => {
                eprintln!("Failed to register {} shortcut: {}", action_id, e);
                registration_failures.push((action_id, shortcut_str, e.to_string()));
            }
        }
    }

    {
        let state = app.state::<RegisteredShortcuts>();
        let mut registered = match state.shortcuts.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("Mutex poisoned in update_shortcuts, recovering...");
                poisoned.into_inner()
            }
        };

        let emergency_shortcut = registered
            .get(EMERGENCY_ERASE_ACTION_ID)
            .cloned();

        registered.clear();

        if let Some(shortcut) = emergency_shortcut {
            registered.insert(EMERGENCY_ERASE_ACTION_ID.to_string(), shortcut);
        }

        registered.extend(successfully_registered);
    }

    if !registration_failures.is_empty() {
        if let Some(window) = app.get_webview_window("main") {
            if let Err(e) = window.emit("shortcut-registration-error", &registration_failures) {
                eprintln!("Failed to emit shortcut registration error event: {}", e);
            }
        }

        let error_messages: Vec<String> = registration_failures
            .into_iter()
            .map(|(action, key, error)| format!("{} ({}) - {}", action, key, error))
            .collect();

        return Err(format!(
            "Some shortcuts could not be registered: {}",
            error_messages.join("; ")
        ));
    }

    Ok(())
}

/// Unregister all currently registered shortcuts
fn unregister_all_shortcuts<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<RegisteredShortcuts>();
    let registered = match state.shortcuts.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("Mutex poisoned in unregister_all_shortcuts, recovering...");
            poisoned.into_inner()
        }
    };

    for (action_id, shortcut_str) in registered.iter() {
        if action_id == EMERGENCY_ERASE_ACTION_ID {
            continue;
        }

        if let Ok(shortcut) = shortcut_str.parse::<Shortcut>() {
            match app.global_shortcut().unregister(shortcut) {
                Ok(_) => {
                    eprintln!("Unregistered shortcut: {} -> {}", action_id, shortcut_str);
                }
                Err(e) => {
                    eprintln!("Failed to unregister shortcut {}: {}", shortcut_str, e);
                }
            }
        }
    }

    Ok(())
}

/// Tauri command to check if shortcuts are registered
#[tauri::command]
pub fn check_shortcuts_registered<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    let state = app.state::<RegisteredShortcuts>();
    let registered = match state.shortcuts.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("Mutex poisoned in check_shortcuts_registered, recovering...");
            poisoned.into_inner()
        }
    };
    Ok(!registered.is_empty())
}

/// Tauri command to validate shortcut key
#[tauri::command]
pub fn validate_shortcut_key(key: String) -> Result<bool, String> {
    match key.parse::<Shortcut>() {
        Ok(_) => Ok(true),
        Err(e) => {
            eprintln!("Invalid shortcut '{}': {}", key, e);
            Ok(false)
        }
    }
}

/// Tauri command to set app icon visibility in dock/taskbar
#[tauri::command]
pub fn set_app_icon_visibility<R: Runtime>(app: AppHandle<R>, visible: bool) -> Result<(), String> {
    app.state::<WindowPreferencesState>().set_app_icon_visible(visible);

    #[cfg(target_os = "macos")]
    {
        let policy = if visible {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };

        app.set_activation_policy(policy).map_err(|e| {
            eprintln!("Failed to set activation policy: {}", e);
            format!("Failed to set activation policy: {}", e)
        })?;
    }

    #[cfg(target_os = "windows")]
    {
        sync_main_window(&app)?;
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(window) = app.get_webview_window("main") {
            window
                .set_skip_taskbar(!visible)
                .map_err(|e| format!("Failed to set panel visibility: {}", e))?;
        } else {
            eprintln!("Main window not found on Linux");
        }
    }

    Ok(())
}

/// Tauri command to set always on top state
#[tauri::command]
pub fn set_always_on_top<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    app.state::<WindowPreferencesState>().set_always_on_top(enabled);

    if let Some(window) = app.get_webview_window("main") {
        window
            .set_always_on_top(enabled)
            .map_err(|e| format!("Failed to set always on top: {}", e))?;
    } else {
        return Err("Main window not found".to_string());
    }

    sync_main_window(&app)?;

    Ok(())
}

/// Handle toggle dashboard shortcut
fn handle_toggle_dashboard<R: Runtime>(app: &AppHandle<R>) {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        match dashboard_window.is_visible() {
            Ok(true) => {
                if let Err(e) = dashboard_window.hide() {
                    eprintln!("Failed to hide dashboard window: {}", e);
                }
            }
            Ok(false) => {
                if let Err(e) = show_dashboard_window(app) {
                    eprintln!("Failed to show dashboard window: {}", e);
                }
            }
            Err(e) => {
                eprintln!("Failed to check dashboard visibility: {}", e);
            }
        }
    } else {
        match show_dashboard_window(app) {
            Ok(_) => eprintln!("Dashboard window created and shown successfully"),
            Err(e) => eprintln!("Failed to create/show dashboard window: {}", e),
        }
    }
}

/// Handle focus input shortcut
fn handle_focus_input<R: Runtime>(app: &AppHandle<R>) {
    if let Err(e) = show_main_window(app, true) {
        eprintln!("Failed to focus input: {}", e);
    }
}

fn handle_move_window<R: Runtime>(app: &AppHandle<R>, direction: &str) {
    if let Some(window) = app.get_webview_window("main") {
        match window.outer_position() {
            Ok(current_pos) => {
                let step = 12;
                let (new_x, new_y) = match direction {
                    "up" => (current_pos.x, current_pos.y - step),
                    "down" => (current_pos.x, current_pos.y + step),
                    "left" => (current_pos.x - step, current_pos.y),
                    "right" => (current_pos.x + step, current_pos.y),
                    _ => {
                        eprintln!("Invalid direction: {}", direction);
                        return;
                    }
                };

                if let Err(e) =
                    window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: new_x,
                        y: new_y,
                    }))
                {
                    eprintln!("Failed to set window position: {}", e);
                }
            }
            Err(e) => {
                eprintln!("Failed to get window position: {}", e);
            }
        }
    } else {
        eprintln!("Main window not found");
    }
}

fn handle_toggle_click_through<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = toggle_click_through_state(app) {
        eprintln!("Failed to toggle click-through mode: {}", error);
    }
}

/// Tauri command to trigger emergency erase and immediate exit
#[tauri::command]
pub fn emergency_erase(app_handle: tauri::AppHandle) {
    perform_emergency_erase(&app_handle);
}

/// Tauri command to exit the application
#[tauri::command]
pub fn exit_app(app_handle: tauri::AppHandle) {
    scrub_sensitive_data_on_quit(&app_handle);
    app_handle.exit(0);
}
