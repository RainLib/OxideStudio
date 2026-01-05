use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

const LSP_VERSION: &str = "0.1.1";
const LSP_REPO: &str = "LikeRainDay/lsp_sqls";

#[derive(Debug, Serialize, Deserialize)]
pub struct LspBinaryInfo {
    pub version: String,
    pub path: PathBuf,
    pub exists: bool,
    pub download_url: Option<String>,
}

/// Get platform-specific binary name
fn get_binary_name() -> String {
    if cfg!(target_os = "windows") {
        "sql-lsp.exe".to_string()
    } else {
        "sql-lsp".to_string()
    }
}

/// Get platform-specific download URL
fn get_download_url() -> String {
    let platform = if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else {
        "unknown"
    };

    format!(
        "https://github.com/{}/releases/download/v{}/sql-lsp-{}-v{}.tar.gz",
        LSP_REPO, LSP_VERSION, platform, LSP_VERSION
    )
}

/// Check if LSP binary exists
#[tauri::command]
pub async fn check_lsp_binary(app: tauri::AppHandle) -> Result<LspBinaryInfo, String> {
    let binary_name = get_binary_name();

    // Try to find binary in resources
    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?
        .join("binaries")
        .join(&binary_name);

    let exists = resource_path.exists();
    let download_url = if !exists {
        Some(get_download_url())
    } else {
        None
    };

    Ok(LspBinaryInfo {
        version: LSP_VERSION.to_string(),
        path: resource_path,
        exists,
        download_url,
    })
}

/// Download LSP binary from GitHub releases
#[tauri::command]
pub async fn download_lsp_binary(app: tauri::AppHandle) -> Result<String, String> {
    let download_url = get_download_url();
    let binary_name = get_binary_name();

    tracing::info!("Downloading LSP binary from: {}", download_url);

    // Get target directory
    let binaries_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?
        .join("binaries");

    // Create directory if it doesn't exist
    std::fs::create_dir_all(&binaries_dir)
        .map_err(|e| format!("Failed to create binaries directory: {}", e))?;

    // Download archive
    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Save to temp file
    let temp_archive = binaries_dir.join(format!("sql-lsp-{}.tar.gz", LSP_VERSION));
    std::fs::write(&temp_archive, &bytes).map_err(|e| format!("Failed to write archive: {}", e))?;

    // Extract archive
    extract_archive(&temp_archive, &binaries_dir, &binary_name)?;

    // Clean up
    let _ = std::fs::remove_file(&temp_archive);

    tracing::info!("LSP binary downloaded successfully");

    Ok(format!("Downloaded LSP binary v{}", LSP_VERSION))
}

/// Extract tar.gz archive
fn extract_archive(
    archive_path: &PathBuf,
    target_dir: &PathBuf,
    binary_name: &str,
) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let tar_gz =
        std::fs::File::open(archive_path).map_err(|e| format!("Failed to open archive: {}", e))?;
    let tar = GzDecoder::new(tar_gz);
    let mut archive = Archive::new(tar);

    // Extract all files
    archive
        .unpack(target_dir)
        .map_err(|e| format!("Failed to extract archive: {}", e))?;

    // Set executable permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let binary_path = target_dir.join(binary_name);
        let mut perms = std::fs::metadata(&binary_path)
            .map_err(|e| format!("Failed to get file metadata: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&binary_path, perms)
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    Ok(())
}

/// Check for LSP updates
#[tauri::command]
pub async fn check_lsp_updates() -> Result<Option<String>, String> {
    // Fetch latest release from GitHub API
    let url = format!("https://api.github.com/repos/{}/releases/latest", LSP_REPO);

    let client = reqwest::Client::builder()
        .user_agent("OxideStudio")
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases: {}", e))?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let release: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let latest_version = release["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v');

    // Compare versions
    if latest_version != LSP_VERSION {
        Ok(Some(latest_version.to_string()))
    } else {
        Ok(None)
    }
}
