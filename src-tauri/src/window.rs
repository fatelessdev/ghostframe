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

/// Sets up the main window with custom positioning
pub fn setup_main_window(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    // Try different possible window labels
    let window = app
        .get_webview_window("main")
        .or_else(|| {
            // Get the first window if specific labels don't work
            app.webview_windows().values().next().cloned()
        })
        .ok_or("No window found")?;

    size_main_window_to_overlay_bounds(&window).map_err(std::io::Error::other)?;

    sync_main_window(&app.handle()).map_err(std::io::Error::other)?;

    // Reassert topmost and visibility on blur so the overlay stays on screen
    // even when the user switches apps, clicks the desktop, or presses Win+D.
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
    let click_through = state.click_through();
    #[cfg(not(target_os = "windows"))]
    let app_icon_visible = state.app_icon_visible();

    window
        .set_always_on_top(always_on_top)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;

    window
        .set_ignore_cursor_events(click_through)
        .map_err(|e| format!("Failed to sync click-through state: {}", e))?;

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

    app.state::<WindowPreferencesState>()
        .set_main_window_visible(false);

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

    size_main_window_to_overlay_bounds(&window)?;

    app.state::<WindowPreferencesState>()
        .set_main_window_visible(true);

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
    size_main_window_to_overlay_bounds(&window)?;
    sync_main_window(app)?;

    if focus_input {
        window
            .emit("focus-text-input", serde_json::json!({}))
            .map_err(|e| format!("Failed to emit focus-text-input event: {}", e))?;
    }

    Ok(())
}

fn size_main_window_to_overlay_bounds<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    use tauri::{PhysicalPosition, Position, Size};

    if let Some(monitor) = window
        .current_monitor()
        .map_err(|e| format!("Failed to get current monitor: {}", e))?
        .or(
            window
                .primary_monitor()
                .map_err(|e| format!("Failed to get primary monitor: {}", e))?,
        )
    {
        window
            .set_size(Size::Physical(*monitor.size()))
            .map_err(|e| format!("Failed to set overlay size: {}", e))?;
        window
            .set_position(Position::Physical(PhysicalPosition { x: 0, y: 0 }))
            .map_err(|e| format!("Failed to set overlay position: {}", e))?;
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
pub async fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    show_dashboard_window(&app)
}

#[tauri::command]
pub async fn open_dashboard_settings(app: tauri::AppHandle) -> Result<(), String> {
    show_dashboard_window(&app)?;

    if let Some(window) = app.get_webview_window("dashboard") {
        window
            .eval(
                r#"window.history.pushState({}, '', '/settings'); window.dispatchEvent(new PopStateEvent('popstate'));"#,
            )
            .map_err(|e| format!("Failed to navigate dashboard to settings: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn toggle_dashboard(app: tauri::AppHandle) -> Result<(), String> {
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
        .visible(false);

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let base_builder = base_builder
        .title("Ghostframe")
        .center()
        .decorations(true)
        .inner_size(800.0, 600.0)
        .min_inner_size(800.0, 600.0)
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
        // Dashboard should be visible in taskbar and Alt+Tab so users can find it
        window
            .set_skip_taskbar(false)
            .map_err(|e| format!("Failed to set dashboard taskbar visibility: {}", e))?;

        update_windows_alt_tab_visibility(window, false)?;
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

    tauri::async_runtime::spawn(async move {
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

/// Toggles content protection on the main window at runtime.
/// Returns the new protection state (`true` = protected).
#[tauri::command]
pub fn toggle_content_protection(app: tauri::AppHandle) -> Result<bool, String> {
    let state = app.state::<WindowPreferencesState>();
    let new_state = !state.content_protected();
    state.set_content_protected(new_state);

    if let Some(window) = app.get_webview_window("main") {
        window
            .set_content_protected(new_state)
            .map_err(|e| format!("Failed to set content protection on main window: {}", e))?;
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

/// Toggles click-through mode for the main window and emits the new state.
#[tauri::command]
pub fn toggle_click_through(app: tauri::AppHandle) -> Result<bool, String> {
    toggle_click_through_state(&app)
}

/// Returns the current click-through state without modifying it.
#[tauri::command]
pub fn get_click_through(app: tauri::AppHandle) -> bool {
    app.state::<WindowPreferencesState>().click_through()
}

/// Internal helper used by command and global shortcut.
pub fn toggle_click_through_state<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    let state = app.state::<WindowPreferencesState>();
    let new_state = true;
    state.set_click_through(new_state);

    if let Some(window) = app.get_webview_window("main") {
        #[cfg(target_os = "windows")]
        {
            if !new_state {
                let _ = window.set_focus();
            }
        }

        window
            .set_ignore_cursor_events(new_state)
            .map_err(|e| format!("Failed to set click-through mode: {}", e))?;
    }

    if let Err(error) = app.emit("click-through-changed", new_state) {
        eprintln!("Failed to emit click-through-changed: {}", error);
    }

    Ok(new_state)
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DOMRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl DOMRect {
    pub fn contains_logical(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= (self.x + self.width) &&
        y >= self.y && y <= (self.y + self.height)
    }
}

pub struct CursorEventState {
    pub clickable_rects: std::sync::Arc<std::sync::Mutex<Vec<DOMRect>>>,
    pub is_currently_ignoring: std::sync::Arc<std::sync::Mutex<bool>>,
}

impl Default for CursorEventState {
    fn default() -> Self {
        Self {
            clickable_rects: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
            is_currently_ignoring: std::sync::Arc::new(std::sync::Mutex::new(false)),
        }
    }
}

#[tauri::command]
pub fn set_clickable_rects(
    app: tauri::AppHandle,
    rects: Vec<DOMRect>,
) -> Result<(), String> {
    let state = app.state::<CursorEventState>();
    if let Ok(mut lock) = state.clickable_rects.lock() {
        *lock = rects;
    }
    Ok(())
}

pub fn start_cursor_event_monitor<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(16)).await;
            let state = app_handle.state::<CursorEventState>();

            let click_through = app_handle.state::<crate::shortcuts::WindowPreferencesState>().click_through();

            if let Some(window) = app_handle.get_webview_window("main") {
                if click_through {
                    let mut is_hovering = false;
                    #[cfg(target_os = "windows")]
                    {
                        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
                        use windows::Win32::Foundation::POINT;
                        let mut cursor_pos = POINT::default();
                        unsafe {
                            let _ = GetCursorPos(&mut cursor_pos);
                        }
                        
                        let scale = window.scale_factor().unwrap_or(1.0);
                        if let Ok(pos) = window.outer_position() {
                            let rel_x = cursor_pos.x - pos.x;
                            let rel_y = cursor_pos.y - pos.y;
                            
                            let logic_x = rel_x as f64 / scale;
                            let logic_y = rel_y as f64 / scale;
                            
                            
                            if let Ok(rects) = state.clickable_rects.lock() {
                                for rect in rects.iter() {
                                    if rect.contains_logical(logic_x, logic_y) {
                                        is_hovering = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    let should_ignore = !is_hovering;
                    
                    if let Ok(mut lock) = state.is_currently_ignoring.lock() {
                        if *lock != should_ignore {
                            *lock = should_ignore;
                            let _ = window.set_ignore_cursor_events(should_ignore);
                        }
                    }
                } else {
                    
                    if let Ok(mut lock) = state.is_currently_ignoring.lock() {
                        if *lock {
                            *lock = false;
                            let _ = window.set_ignore_cursor_events(false);
                        }
                    }
                }
            }
        }
    });
}

