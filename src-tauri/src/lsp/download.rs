use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

const LSP_VERSION: &str = "0.1.3";

#[derive(Debug, Serialize, Deserialize)]
pub struct LspBinaryInfo {
    pub version: String,
    pub path: PathBuf,
    pub exists: bool,
}

/// Get platform-specific binary name
fn get_binary_name() -> String {
    if cfg!(target_os = "windows") {
        "sql-lsp.exe".to_string()
    } else {
        "sql-lsp".to_string()
    }
}

/// Check if bundled LSP binary exists
#[tauri::command]
pub async fn check_lsp_binary(app: tauri::AppHandle) -> Result<LspBinaryInfo, String> {
    let binary_name = get_binary_name();

    // In development mode, look in binaries/ relative to current dir (src-tauri)
    // In production mode, look in bundled resources
    let binary_path = if cfg!(debug_assertions) {
        // Development mode: cargo runs from src-tauri directory
        let dev_path = std::env::current_dir()
            .map_err(|e| format!("Failed to get current dir: {}", e))?
            .join("binaries") // Just binaries/, not src-tauri/binaries/
            .join(&binary_name);

        tracing::info!("🔍 [LSP] Dev mode - checking binary at: {:?}", dev_path);
        dev_path
    } else {
        // Production mode - bundled with app
        let resource_path = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?
            .join(&binary_name);

        tracing::info!(
            "🔍 [LSP] Production mode - checking binary at: {:?}",
            resource_path
        );
        resource_path
    };

    let exists = binary_path.exists();

    if !exists {
        tracing::error!("❌ [LSP] Binary not found at: {:?}", binary_path);
    } else {
        tracing::info!("✅ [LSP] Binary found at: {:?}", binary_path);

        // Check if binary is executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(&binary_path) {
                let perms = metadata.permissions();
                let mode = perms.mode();
                tracing::info!("📋 [LSP] Binary permissions: {:o}", mode);
                if mode & 0o111 == 0 {
                    tracing::warn!("⚠️  [LSP] Binary is not executable!");
                }
            }
        }
    }

    Ok(LspBinaryInfo {
        version: LSP_VERSION.to_string(),
        path: binary_path,
        exists,
    })
}
