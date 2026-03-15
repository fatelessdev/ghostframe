#[cfg(target_os = "macos")]
use tauri::LogicalPosition;
use tauri::{App, AppHandle, Emitter, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};
use tokio::time::{sleep, Duration};
use std::sync::atomic::{AtomicU8, Ordering};

use crate::shortcuts::WindowPreferencesState;

// Disguise mode constants
pub const DISGUISE_AUTO: u8 = 0;
pub const DISGUISE_TERMINAL: u8 = 1;
pub const DISGUISE_SYSTEM_SETTINGS: u8 = 2;
pub const DISGUISE_ACTIVITY_MONITOR: u8 = 3;
pub const DISGUISE_NONE: u8 = 4;

/// Tracks the active window-title disguise preset.
pub struct DisguiseModeState {
    mode: AtomicU8,
}

impl Default for DisguiseModeState {
    fn default() -> Self {
        Self {
            mode: AtomicU8::new(DISGUISE_AUTO),
        }
    }
}

impl DisguiseModeState {
    pub fn get(&self) -> u8 {
        self.mode.load(Ordering::Relaxed)
    }
    pub fn set(&self, mode: u8) {
        self.mode.store(mode, Ordering::Relaxed);
    }
}

#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE,
    HWND_NOTOPMOST, HWND_TOPMOST, SET_WINDOW_POS_FLAGS, SW_HIDE, SW_SHOW,
    SW_SHOWNOACTIVATE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOOWNERZORDER, SWP_NOZORDER, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};

// The offset from the top of the screen to the window
const TOP_OFFSET: i32 = 54;

/// Sets up the main window with custom positioning
pub fn setup_main_window(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    // Try different possible window labels
    let window = app
        .get_webview_window("main")
        .
        .or_else(|| {
            // Get the first window if specific labels don't work
            app.webview_windows().values().next().cloned()
        })
        .ok_or("No window found")?;

    position_window_top_center(&window, TOP_OFFSET)?;

    // Set window as non-focusable on Windows to prevent focus detection
    // This prevents the window from being detected as active when switching between apps
    #[cfg(target_os = "windows")]
    {
        // Attempt to set window as non-focusable using Tauri's API
        let _ = window.set_focusable(false);
    }

    sync_main_window(&app.handle()).map_err(std::io::Error::other)?;

    // Reassert topmost on blur instead of forcing the window visible again.
    let app_handle = app.handle().clone();
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        use tauri::WindowEvent;

        match event {
            WindowEvent::Focused(false) => {
                let _ = sync_window_topmost(&app_handle, &window_clone);
            }
            _ => {}
        }
    });

    Ok(())
}

pub fn sync_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let state = app.state::<WindowPreferencesState>();
    let always_on_top = state.always_on_top();
    #[cfg(not(target_os = "windows"))]
    let app_icon_visible = state.app_icon_visible();

    window
        .set_always_on_top(always_on_top)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;

    #[cfg(target_os = "windows")]
    {
        // The Windows overlay should never surface in the taskbar or Alt+Tab,
        // regardless of whether the user toggles in-app visibility with Ctrl+\.
        window
            .set_skip_taskbar(true)
            .map_err(|e| format!("Failed to keep taskbar hidden: {}", e))?;

        update_windows_alt_tab_visibility(&window, true)?;
        apply_windows_topmost(&window, always_on_top)?;
    }

    #[cfg(target_os = "linux")]
    window
        .set_skip_taskbar(!app_icon_visible)
        .map_err(|e| format!("Failed to sync taskbar visibility: {}", e))?;

    Ok(())
}

pub fn hide_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|e| format!("Failed to get HWND: {}", e))?;
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
    }

    #[cfg(not(target_os = "windows"))]
    window
        .hide()
        .map_err(|e| format!("Failed to hide main window: {}", e))?;

    #[cfg(target_os = "macos")]
    if let Some(panel) = app.get_webview_panel("main") {
        panel.hide();
    }

    Ok(())
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>, focus_input: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    // Apply taskbar / Alt+Tab stealth before making the window visible so
    // Windows does not recreate an app-switcher entry during restore.
    sync_main_window(app)?;

    #[cfg(target_os = "windows")]
    show_main_window_windows(&window, focus_input)?;

    #[cfg(not(target_os = "windows"))]
    {
        window
            .show()
            .map_err(|e| format!("Failed to show main window: {}", e))?;

        if focus_input {
            window
                .set_focus()
                .map_err(|e| format!("Failed to focus main window: {}", e))?;
        }
    }

    #[cfg(target_os = "macos")]
    if let Some(panel) = app.get_webview_panel("main") {
        panel.show();
    }

    // Re-apply after show as well because Windows may rewrite styles when a
    // hidden window becomes visible.
    sync_main_window(app)?;

    if focus_input {
        window
            .emit("focus-text-input", serde_json::json!({}))
            .map_err(|e| format!("Failed to emit focus-text-input event: {}", e))?;
    }

    Ok(())
}

pub fn sync_window_topmost<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    let enabled = app.state::<WindowPreferencesState>().always_on_top();

    window
        .set_always_on_top(enabled)
        .map_err(|e| format!("Failed to sync always on top: {}", e))?;

    #[cfg(target_os = "windows")]
    apply_windows_topmost(window, enabled)?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn show_main_window_windows<R: Runtime>(
    window: &WebviewWindow<R>,
    focus_input: bool,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| format!("Failed to get HWND: {}", e))?;

    unsafe {
        let _ = ShowWindow(hwnd, if focus_input { SW_SHOW } else { SW_SHOWNOACTIVATE });
    }

    if focus_input {
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus main window: {}", e))?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_windows_topmost<R: Runtime>(window: &WebviewWindow<R>, enabled: bool) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| format!("Failed to get HWND: {}", e))?;
    let flags: SET_WINDOW_POS_FLAGS =
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER;

    unsafe {
        SetWindowPos(
            hwnd,
            if enabled {
                Some(HWND_TOPMOST)
            } else {
                Some(HWND_NOTOPMOST)
            },
            0,
            0,
            0,
            0,
            flags,
        )
        .map_err(|e| format!("Failed to update topmost state: {}", e))?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn update_windows_alt_tab_visibility<R: Runtime>(
    window: &WebviewWindow<R>,
    hide_from_switcher: bool,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| format!("Failed to get HWND: {}", e))?;

    unsafe {
        let current_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let mut updated_style = current_style;

        if hide_from_switcher {
            updated_style = (updated_style | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0;
        } else {
            updated_style = (updated_style | WS_EX_APPWINDOW.0) & !WS_EX_TOOLWINDOW.0;
        }

        if updated_style != current_style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, updated_style as isize);
        }

        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .map_err(|e| format!("Failed to update window switcher visibility: {}", e))?;
    }

    Ok(())
}

/// Positions a window at the top center of the screen with a specified Y offset
pub fn position_window_top_center(
    window: &WebviewWindow,
    y_offset: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    // Get the primary monitor
    if let Some(monitor) = window.primary_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        // Calculate center X position
        let center_x = (monitor_size.width as i32 - window_size.width as i32) / 2;

        // Set the window position
        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: center_x,
            y: y_offset,
        }))?;
    }

    Ok(())
}

/// Future function for centering window completely (both X and Y)
#[allow(dead_code)]
pub fn center_window_completely(window: &WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(monitor) = window.primary_monitor()? {
        let monitor_size = monitor.size();
        let window_size = window.outer_size()?;

        let center_x = (monitor_size.width as i32 - window_size.width as i32) / 2;
        let center_y = (monitor_size.height as i32 - window_size.height as i32) / 2;

        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: center_x,
            y: center_y,
        }))?;
    }

    Ok(())
}

#[tauri::command]
pub fn set_window_height(
    window: tauri::WebviewWindow,
    height: u32,
    width: Option<u32>,
) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize, Position, Size};

    let mut target_width = width.unwrap_or(600) as f64;
    let mut target_height = height as f64;

    if let Some(monitor) = window
        .current_monitor()
        .map_err(|e| format!("Failed to get current monitor: {}", e))?
        .or(
            window
                .primary_monitor()
                .map_err(|e| format!("Failed to get primary monitor: {}", e))?,
        )
    {
        let scale_factor = monitor.scale_factor();
        let monitor_size = monitor.size().to_logical::<f64>(scale_factor);

        // Keep a small margin so the panel never touches the screen edges.
        target_width = target_width.min((monitor_size.width - 16.0).max(320.0));
        target_height = target_height.min((monitor_size.height - 16.0).max(200.0));
    }

    let new_size = LogicalSize::new(target_width, target_height);
    window
        .set_size(Size::Logical(new_size))
        .map_err(|e| format!("Failed to resize window: {}", e))?;

    if let Some(monitor) = window
        .current_monitor()
        .map_err(|e| format!("Failed to get current monitor: {}", e))?
        .or(
            window
                .primary_monitor()
                .map_err(|e| format!("Failed to get primary monitor: {}", e))?,
        )
    {
        let scale_factor = monitor.scale_factor();
        let monitor_size = monitor.size().to_logical::<f64>(scale_factor);
        let current_position = window
            .outer_position()
            .map_err(|e| format!("Failed to get window position: {}", e))?
            .to_logical::<f64>(scale_factor);

        let centered_x = ((monitor_size.width - target_width) / 2.0).max(0.0);
        let max_y = (monitor_size.height - target_height).max(0.0);
        let clamped_y = current_position.y.clamp(0.0, max_y);

        window
            .set_position(Position::Logical(LogicalPosition::new(
                centered_x,
                clamped_y,
            )))
            .map_err(|e| format!("Failed to reposition window: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    show_dashboard_window(&app)
}

#[tauri::command]
pub fn toggle_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        match dashboard_window.is_visible() {
            Ok(true) => {
                // Window is visible, hide it
                dashboard_window
                    .hide()
                    .map_err(|e| format!("Failed to hide dashboard window: {}", e))?;
            }
            Ok(false) => {
                show_dashboard_window(&app)?;
            }
            Err(e) => {
                return Err(format!("Failed to check dashboard visibility: {}", e));
            }
        }
    } else {
        // Window doesn't exist, create and show it
        show_dashboard_window(&app)?;
    }

    Ok(())
}

#[tauri::command]
pub fn move_window(app: tauri::AppHandle, direction: String, step: i32) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let current_pos = window
            .outer_position()
            .map_err(|e| format!("Failed to get window position: {}", e))?;

        let (new_x, new_y) = match direction.as_str() {
            "up" => (current_pos.x, current_pos.y - step),
            "down" => (current_pos.x, current_pos.y + step),
            "left" => (current_pos.x - step, current_pos.y),
            "right" => (current_pos.x + step, current_pos.y),
            _ => return Err(format!("Invalid direction: {}", direction)),
        };

        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: new_x,
                y: new_y,
            }))
            .map_err(|e| format!("Failed to set window position: {}", e))?;
    } else {
        return Err("Main window not found".to_string());
    }

    Ok(())
}

pub fn create_dashboard_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, tauri::Error> {
    let base_builder =
        WebviewWindowBuilder::new(app, "dashboard", tauri::WebviewUrl::App("/chats".into()));

    #[cfg(target_os = "macos")]
    let base_builder = base_builder
        .title("Ghostframe")
        .center()
        .decorations(true)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .hidden_title(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .content_protected(true)
        .visible(true)
        .traffic_light_position(LogicalPosition::new(14.0, 18.0));

    #[cfg(target_os = "windows")]
    let base_builder = base_builder
        .title("Ghostframe")
        .center()
        .decorations(true)
        .inner_size(800.0, 600.0)
        .min_inner_size(800.0, 600.0)
        .content_protected(true)
        .skip_taskbar(true)
        .visible(false);

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let base_builder = base_builder
        .title("Ghostframe")
        .center()
        .decorations(true)
        .inner_size(800.0, 600.0)
        .min_inner_size(800.0, 600.0)
        .content_protected(true)
        .visible(false);

    let window = base_builder.build()?;

    if let Err(error) = sync_dashboard_window(&window) {
        eprintln!("Failed to apply dashboard stealth state: {}", error);
    }

    // Set up close event handler - hide window instead of destroying it
    setup_dashboard_close_handler(&window);

    Ok(window)
}

/// Sets up the close event handler for the dashboard window
fn setup_dashboard_close_handler<R: Runtime>(window: &WebviewWindow<R>) {
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Prevent the window from being destroyed
            api.prevent_close();
            // Hide the window instead
            if let Err(e) = window_clone.hide() {
                eprintln!("Failed to hide dashboard window on close: {}", e);
            }
        }
    });
}

/// Shows the dashboard window and brings it to focus
pub fn show_dashboard_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(dashboard_window) = app.get_webview_window("dashboard") {
        sync_dashboard_window(&dashboard_window)?;
        dashboard_window
            .show()
            .map_err(|e| format!("Failed to show dashboard window: {}", e))?;
        sync_dashboard_window(&dashboard_window)?;
        dashboard_window
            .set_focus()
            .map_err(|e| format!("Failed to focus dashboard window: {}", e))?;
    } else {
        let window = create_dashboard_window(app)
            .map_err(|e| format!("Failed to create dashboard window: {}", e))?;
        sync_dashboard_window(&window)?;
        window
            .show()
            .map_err(|e| format!("Failed to show new dashboard window: {}", e))?;
        sync_dashboard_window(&window)?;
        window
            .set_focus()
            .map_err(|e| format!("Failed to focus new dashboard window: {}", e))?;
    }
    Ok(())
}

fn sync_dashboard_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        window
            .set_skip_taskbar(true)
            .map_err(|e| format!("Failed to keep dashboard hidden from taskbar: {}", e))?;

        update_windows_alt_tab_visibility(window, true)?;
    }

    Ok(())
}

/// Spawns a background task that manages the main (and dashboard) window title.
/// When mode is DISGUISE_AUTO the title is randomly rotated from a list of benign
/// system-app names every 30-60 seconds. When a fixed preset is selected the same
/// title is re-applied every 60 seconds (to counteract any OS reset).
pub fn start_window_title_disguise<R: Runtime>(app: &AppHandle<R>) {
    const DISGUISE_TITLES: &[&str] = &[
        "System Monitor",
        "Audio System Helper",
        "Performance Monitor",
        "System Audio Service",
        "Resource Monitor",
        "System Preferences",
        "Audio Device Manager",
        "System Configuration",
        "Network Monitor",
        "Activity Monitor",
        "Background Services",
        "System Audio",
    ];

    let app_handle = app.clone();

    tokio::spawn(async move {
        // Seed with current time for pseudo-randomness (no external rand crate needed)
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        let mut state = seed;

        // Linear congruential generator step
        let lcg = |s: u64| -> u64 {
            s.wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407)
        };

        loop {
            let mode = app_handle.state::<DisguiseModeState>().get();

            let title: &str = match mode {
                DISGUISE_TERMINAL => "Terminal",
                DISGUISE_SYSTEM_SETTINGS => "System Settings",
                DISGUISE_ACTIVITY_MONITOR => "Activity Monitor",
                DISGUISE_NONE => "Ghostframe - AI Assistant",
                _ => {
                    // auto: pick a random benign system-app name
                    state = lcg(state);
                    DISGUISE_TITLES[(state >> 33) as usize % DISGUISE_TITLES.len()]
                }
            };

            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.set_title(title);
            }
            if let Some(window) = app_handle.get_webview_window("dashboard") {
                let _ = window.set_title(title);
            }

            // Auto: random 30-60s; fixed preset: 60s (re-asserts title in case OS resets it)
            state = lcg(state);
            let delay_secs = if mode == DISGUISE_AUTO {
                30 + (state >> 33) % 31
            } else {
                60
            };
            sleep(Duration::from_secs(delay_secs)).await;
        }
    });
}

/// Toggles content protection on the main (and dashboard) window at runtime.
/// Returns the new protection state (`true` = protected).
#[tauri::command]
pub fn toggle_content_protection(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<WindowPreferencesState>();
    let new_state = !state.content_protected();
    state.set_content_protected(new_state);

    if let Some(window) = app.get_webview_window("main") {
        window
            .set_content_protection(new_state)
            .map_err(|e| format!("Failed to set content protection on main window: {}", e))?;
    }
    if let Some(window) = app.get_webview_window("dashboard") {
        let _ = window.set_content_protection(new_state);
    }

    app.emit("content-protection-changed", new_state)
        .map_err(|e| format!("Failed to emit content-protection-changed: {}", e))?;

    Ok(new_state)
}

/// Returns the current content-protection state without modifying it.
#[tauri::command]
pub fn get_content_protection(app: tauri::AppHandle) -> bool {
    app.state::<WindowPreferencesState>().content_protected()
}

/// Sets the active disguise preset for the window title rotation.
/// Accepted mode strings: "auto", "terminal", "system_settings", "activity_monitor", "none".
/// Fixed presets are applied immediately to both windows and re-asserted every 60 s.
#[tauri::command]
pub fn set_disguise_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    let mode_u8 = match mode.as_str() {
        "auto" => DISGUISE_AUTO,
        "terminal" => DISGUISE_TERMINAL,
        "system_settings" => DISGUISE_SYSTEM_SETTINGS,
        "activity_monitor" => DISGUISE_ACTIVITY_MONITOR,
        "none" => DISGUISE_NONE,
        other => return Err(format!("Unknown disguise mode: {}", other)),
    };

    app.state::<DisguiseModeState>().set(mode_u8);

    // Immediately apply fixed-title modes so the change is visible right away
    if mode_u8 != DISGUISE_AUTO {
        let title = match mode_u8 {
            DISGUISE_TERMINAL => "Terminal",
            DISGUISE_SYSTEM_SETTINGS => "System Settings",
            DISGUISE_ACTIVITY_MONITOR => "Activity Monitor",
            _ => "Ghostframe - AI Assistant", // DISGUISE_NONE
        };
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_title(title);
        }
        if let Some(window) = app.get_webview_window("dashboard") {
            let _ = window.set_title(title);
        }
    }

    Ok(())
}

/// Returns the current disguise mode as a string.
#[tauri::command]
pub fn get_disguise_mode(app: tauri::AppHandle) -> String {
    match app.state::<DisguiseModeState>().get() {
        DISGUISE_TERMINAL => "terminal".to_string(),
        DISGUISE_SYSTEM_SETTINGS => "system_settings".to_string(),
        DISGUISE_ACTIVITY_MONITOR => "activity_monitor".to_string(),
        DISGUISE_NONE => "none".to_string(),
        _ => "auto".to_string(),
    }
}
