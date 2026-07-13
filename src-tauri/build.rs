fn main() {
    // Tauri embeds the application icon into the macOS development binary.
    // Track the source assets explicitly so replacing an icon invalidates the
    // generated context instead of leaving the previous Dock icon cached.
    for icon in ["icons/icon.png", "icons/icon.icns", "icons/icon.ico"] {
        println!("cargo:rerun-if-changed={icon}");
    }

    let script_path = std::path::Path::new("../scripts/prepare-sql-lsp.mjs");
    if script_path.exists() {
        println!("cargo:rerun-if-changed={}", script_path.display());
        println!("cargo:rerun-if-env-changed=OXIDE_SQL_LSP_BINARY");
        println!("cargo:rerun-if-env-changed=OXIDE_PREPARE_SQL_LSP");

        if should_prepare_sql_lsp_binary() {
            let status = std::process::Command::new("node")
                .arg(script_path)
                .current_dir(env!("CARGO_MANIFEST_DIR"))
                .status()
                .expect("Failed to execute prepare-sql-lsp.mjs");

            if !status.success() {
                panic!("prepare-sql-lsp.mjs failed");
            }
        }
    }

    tauri_build::build()
}

fn should_prepare_sql_lsp_binary() -> bool {
    if std::env::var_os("OXIDE_PREPARE_SQL_LSP").is_some() {
        return true;
    }

    !bundled_sql_lsp_binary().exists()
}

fn bundled_sql_lsp_binary() -> std::path::PathBuf {
    let binary_name = if cfg!(windows) {
        "sql-lsp.exe"
    } else {
        "sql-lsp"
    };

    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(binary_name)
}
