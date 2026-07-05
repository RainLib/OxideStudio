fn main() {
    let script_path = std::path::Path::new("build_prepare.sh");
    if script_path.exists() {
        println!("cargo:rerun-if-changed=build_prepare.sh");
        println!("cargo:rerun-if-env-changed=OXIDE_SQL_LSP_BINARY");
        println!("cargo:rerun-if-env-changed=OXIDE_PREPARE_SQL_LSP");

        if should_prepare_sql_lsp_binary() {
            let status = std::process::Command::new("bash")
                .arg("build_prepare.sh")
                .current_dir(env!("CARGO_MANIFEST_DIR"))
                .status()
                .expect("Failed to execute build_prepare.sh");

            if !status.success() {
                panic!("build_prepare.sh failed");
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
