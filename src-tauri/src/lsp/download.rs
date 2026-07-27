use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
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
    pub source_revision: Option<String>,
    pub source_dirty: Option<bool>,
    pub sha256: Option<String>,
    pub integrity_verified: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LspBinaryManifest {
    source_revision: String,
    source_dirty: Option<bool>,
    sha256: String,
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
        let (manifest, integrity_verified) = binary_manifest_info(&binary_path);
        return Ok(LspBinaryInfo {
            version: manifest
                .as_ref()
                .map(lsp_manifest_version)
                .unwrap_or_else(|| LSP_VERSION.to_string()),
            path: binary_path,
            exists: exists && integrity_verified != Some(false),
            size_bytes,
            modified_unix_ms,
            source_revision: manifest
                .as_ref()
                .map(|manifest| manifest.source_revision.clone()),
            source_dirty: manifest.as_ref().and_then(|manifest| manifest.source_dirty),
            sha256: manifest.as_ref().map(|manifest| manifest.sha256.clone()),
            integrity_verified,
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
    let (manifest, integrity_verified) = binary_manifest_info(&binary_path);

    if !exists {
        tracing::error!("❌ [LSP] Binary not found at: {:?}", binary_path);
    } else if integrity_verified == Some(false) {
        tracing::error!(
            "❌ [LSP] Binary checksum does not match its provenance manifest: {:?}",
            binary_path
        );
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
        version: manifest
            .as_ref()
            .map(lsp_manifest_version)
            .unwrap_or_else(|| LSP_VERSION.to_string()),
        path: binary_path,
        exists: exists && integrity_verified != Some(false),
        size_bytes,
        modified_unix_ms,
        source_revision: manifest
            .as_ref()
            .map(|manifest| manifest.source_revision.clone()),
        source_dirty: manifest.as_ref().and_then(|manifest| manifest.source_dirty),
        sha256: manifest.as_ref().map(|manifest| manifest.sha256.clone()),
        integrity_verified,
    })
}

fn lsp_manifest_version(manifest: &LspBinaryManifest) -> String {
    let short_revision = manifest
        .source_revision
        .get(..12)
        .unwrap_or(&manifest.source_revision);
    if manifest.source_dirty == Some(true) {
        format!("{short_revision}-dirty")
    } else {
        short_revision.to_string()
    }
}

fn binary_manifest_info(binary_path: &Path) -> (Option<LspBinaryManifest>, Option<bool>) {
    let manifest_path = binary_path.with_file_name("sql-lsp.manifest.json");
    let manifest = std::fs::read_to_string(manifest_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<LspBinaryManifest>(&contents).ok());
    let integrity_verified = manifest.as_ref().and_then(|manifest| {
        binary_sha256(binary_path)
            .ok()
            .map(|digest| digest.eq_ignore_ascii_case(&manifest.sha256))
    });
    (manifest, integrity_verified)
}

fn binary_sha256(path: &Path) -> Result<String, std::io::Error> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
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

    #[test]
    fn verifies_binary_against_an_adjacent_manifest() {
        let directory =
            std::env::temp_dir().join(format!("oxide-lsp-manifest-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).expect("create test directory");
        let binary_path = directory.join("sql-lsp");
        let manifest_path = directory.join("sql-lsp.manifest.json");
        std::fs::write(&binary_path, b"sql-lsp").expect("write binary");
        std::fs::write(
            &manifest_path,
            r#"{"sourceRevision":"0123456789abcdef","sourceDirty":false,"sha256":"c2b1e5ee1a9094729b20f4c801d7024e678d2cbcd0e989e56ebcff0c0c0ae430"}"#,
        )
        .expect("write manifest");

        let (manifest, verified) = binary_manifest_info(&binary_path);
        assert_eq!(verified, Some(true));
        assert_eq!(
            manifest.as_ref().map(lsp_manifest_version).as_deref(),
            Some("0123456789ab")
        );

        std::fs::write(&binary_path, b"changed").expect("change binary");
        assert_eq!(binary_manifest_info(&binary_path).1, Some(false));
        let _ = std::fs::remove_dir_all(directory);
    }
}
