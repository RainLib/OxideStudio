/// Window management commands
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub async fn create_new_window(app: AppHandle) -> Result<String, String> {
    println!("[create_new_window] Command invoked!");

    use std::time::{SystemTime, UNIX_EPOCH};

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();

    let window_label = format!("window_{}", timestamp);
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
    .title("OxideStudio")
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
