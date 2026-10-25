use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub fn expose() {
    let mut files = Vec::new();
    for directory in ["src", "crates", "build", "../enterprise/contracts/src"] {
        collect(Path::new(directory), &mut files);
    }
    for file in [
        "build.rs",
        "Cargo.toml",
        "Cargo.lock",
        "../enterprise/contracts/Cargo.toml",
    ] {
        println!("cargo:rerun-if-changed={file}");
        files.push(PathBuf::from(file));
    }
    files.sort();
    let mut hash = Sha256::new();
    for path in files {
        // Track individual inputs so another crate's target/ directory does
        // not force a complete desktop rebuild. New modules are referenced
        // from an already tracked Rust file or manifest.
        println!("cargo:rerun-if-changed={}", path.display());
        let name = path.to_string_lossy().replace('\\', "/");
        let bytes = std::fs::read(&path).expect("worker build identity input is readable");
        hash.update((name.len() as u64).to_le_bytes());
        hash.update(name.as_bytes());
        hash.update((bytes.len() as u64).to_le_bytes());
        hash.update(bytes);
    }
    let mut settings = std::env::vars()
        .filter(|(name, _)| {
            [
                "TARGET",
                "PROFILE",
                "OPT_LEVEL",
                "DEBUG",
                "CARGO_PKG_VERSION",
                "CARGO_ENCODED_RUSTFLAGS",
            ]
            .contains(&name.as_str())
                || name.starts_with("CARGO_FEATURE_")
        })
        .collect::<Vec<_>>();
    settings.sort();
    for (name, value) in settings {
        hash.update(name.as_bytes());
        hash.update([0]);
        hash.update(value.as_bytes());
        hash.update([0]);
    }
    let compiler =
        std::process::Command::new(std::env::var_os("RUSTC").expect("Cargo provides rustc"))
            .args(["--version", "--verbose"])
            .output()
            .expect("rustc version is available");
    assert!(compiler.status.success(), "rustc version must be available");
    hash.update(compiler.stdout);
    println!(
        "cargo:rustc-env=OXIDE_BACKUP_WORKER_BUILD_ID={:x}",
        hash.finalize()
    );
}

fn collect(directory: &Path, files: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(directory).expect("worker source directory is readable") {
        let entry = entry.expect("worker source entry is readable");
        let kind = entry.file_type().expect("worker source type is readable");
        if kind.is_dir() && entry.file_name() != "target" {
            collect(&entry.path(), files);
        } else if kind.is_file()
            && matches!(
                entry.path().extension().and_then(|value| value.to_str()),
                Some("rs" | "toml" | "lock" | "c" | "h")
            )
        {
            files.push(entry.path());
        }
    }
}
