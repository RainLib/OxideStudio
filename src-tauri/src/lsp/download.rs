use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::Manager;

const LSP_VERSION: &str = "submodule";

#[derive(Debug, Serialize, Deserialize)]
pub struct LspBinaryInfo {
    pub version: String,
    pub path: PathBuf,
    pub exists: bool,
    pub size_bytes: Option<u64>,
    pub modified_unix_ms: Option<u64>,
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

    if let Ok(path) = std::env::var("OXIDE_SQL_LSP_BINARY") {
        let binary_path = PathBuf::from(path);
        let exists = binary_path.exists();
        let size_bytes = binary_size_bytes(&binary_path);
        let modified_unix_ms = binary_modified_unix_ms(&binary_path);
        return Ok(LspBinaryInfo {
            version: LSP_VERSION.to_string(),
            path: binary_path,
            exists,
            size_bytes,
            modified_unix_ms,
        });
    }

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
    let size_bytes = binary_size_bytes(&binary_path);
    let modified_unix_ms = binary_modified_unix_ms(&binary_path);

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
        size_bytes,
        modified_unix_ms,
    })
}

fn binary_size_bytes(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().map(|metadata| metadata.len())
}

fn binary_modified_unix_ms(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let millis = modified.duration_since(UNIX_EPOCH).ok()?.as_millis();
    Some(millis.min(u64::MAX as u128) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reports_binary_file_metadata_when_present() {
        let path = std::env::temp_dir().join(format!("oxide-lsp-info-test-{}", std::process::id()));
        let mut file = std::fs::File::create(&path).expect("create temp binary");
        file.write_all(b"sql-lsp").expect("write temp binary");
        drop(file);

        assert_eq!(binary_size_bytes(&path), Some(7));
        assert!(binary_modified_unix_ms(&path).is_some());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn omits_binary_file_metadata_when_missing() {
        let path =
            std::env::temp_dir().join(format!("oxide-lsp-info-missing-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);

        assert_eq!(binary_size_bytes(&path), None);
        assert_eq!(binary_modified_unix_ms(&path), None);
    }
}
