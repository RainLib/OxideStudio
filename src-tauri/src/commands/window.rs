/// Window management commands
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

static NEXT_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

fn new_window_title(target_os: &str) -> &'static str {
    if target_os == "macos" {
        // macOS uses an overlay title bar. A native title would be painted on
        // top of the project selector rendered by the webview.
        ""
    } else {
        "OxideStudio"
    }
}

#[tauri::command]
pub async fn create_new_window(app: AppHandle) -> Result<String, String> {
    println!("[create_new_window] Command invoked!");

    use std::time::{SystemTime, UNIX_EPOCH};

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();

    let window_id = NEXT_WINDOW_ID.fetch_add(1, Ordering::Relaxed);
    let window_label = format!("window_{timestamp}_{window_id}");
    println!("[create_new_window] Window label: {}", window_label);

    // Calculate position offset based on current focused window
    // If no focused window, use default position (None will center the window)
    let position = if let Some(current_window) = app
        .webview_windows()
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
    {
        println!("[create_new_window] Found focused window");
        // Get current window position and add offset (30, 30) for cascade effect
        if let Ok(pos) = current_window.outer_position() {
            println!(
                "[create_new_window] Current position: ({}, {})",
                pos.x, pos.y
            );
            println!(
                "[create_new_window] New position: ({}, {})",
                pos.x + 30,
                pos.y + 30
            );
            Some(PhysicalPosition::new(pos.x + 30, pos.y + 30))
        } else {
            println!("[create_new_window] Could not get window position, using default");
            None
        }
    } else {
        println!("[create_new_window] No focused window found, using default position");
        None
    };

    // Build window with platform-specific configuration
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(
        &app,
        window_label.clone(),
        WebviewUrl::App("index.html".into()),
    )
    .title(new_window_title(std::env::consts::OS))
    .inner_size(1200.0, 800.0)
    .min_inner_size(1200.0, 800.0)
    .focused(true);

    // Set position if we calculated one
    if let Some(pos) = position {
        builder = builder.position(pos.x as f64, pos.y as f64);
    }

    // Apply platform-specific settings before building
    #[cfg(target_os = "windows")]
    {
        builder = builder.decorations(false);
    }

    println!("[create_new_window] Building window...");
    let window = builder.build().map_err(|e| {
        println!("[create_new_window] Failed to build window: {}", e);
        e.to_string()
    })?;

    #[cfg(target_os = "macos")]
    {
        use tauri::TitleBarStyle;
        let _ = window.set_title_bar_style(TitleBarStyle::Overlay);
    }

    Ok(window_label)
}

#[tauri::command]
pub fn close_current_window(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::new_window_title;

    #[test]
    fn macos_overlay_window_has_no_native_title() {
        assert_eq!(new_window_title("macos"), "");
        assert_eq!(new_window_title("linux"), "OxideStudio");
        assert_eq!(new_window_title("windows"), "OxideStudio");
    }

    #[test]
    fn desktop_capability_allows_guarded_window_destroy() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../../capabilities/default.json"))
                .expect("default desktop capability must be valid JSON");
        let permissions = capability["permissions"]
            .as_array()
            .expect("default desktop capability must list permissions");

        assert!(permissions.contains(&serde_json::Value::String(
            "core:window:allow-destroy".to_string()
        )));
    }
}
