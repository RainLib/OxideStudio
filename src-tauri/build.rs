fn main() {
    // Run build preparation script to prepare the bundled SQL LSP binary.
    let script_path = std::path::Path::new("build_prepare.sh");
    if script_path.exists() {
        println!("cargo:rerun-if-changed=build_prepare.sh");
        println!("cargo:rerun-if-env-changed=OXIDE_SQL_LSP_BINARY");
        println!("cargo:rerun-if-changed=../vendor/sql-lsp/Cargo.toml");
        println!("cargo:rerun-if-changed=../vendor/sql-lsp/src");

        let status = std::process::Command::new("bash")
            .arg("build_prepare.sh")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .status()
            .expect("Failed to execute build_prepare.sh");

        if !status.success() {
            panic!("build_prepare.sh failed");
        }
    }

    tauri_build::build()
}
