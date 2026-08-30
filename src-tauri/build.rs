fn main() {
    // Tauri embeds the application icon into the macOS development binary.
    // Track the source assets explicitly so replacing an icon invalidates the
    // generated context instead of leaving the previous Dock icon cached.
    for icon in ["icons/icon.png", "icons/icon.icns", "icons/icon.ico"] {
        println!("cargo:rerun-if-changed={icon}");
    }
    expose_bundled_driver_versions();
    configure_windows_test_manifest();

    // Development launches the TypeScript host through the installed Node 22
    // runtime. Production builds still require and bundle the self-contained
    // external binaries declared in tauri.conf.json.
    if tauri_build::is_dev() && std::env::var_os("TAURI_CONFIG").is_none() {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"externalBin":[]}}"#);
    }

    tonic_prost_build::configure()
        .build_server(false)
        .build_client(true)
        .protoc_arg("--experimental_allow_proto3_optional")
        .compile_protos(
            &["../enterprise/gateway/proto/oxide_gateway.proto"],
            &["../enterprise/gateway/proto"],
        )
        .expect("enterprise Gateway client protocol must compile");
    println!("cargo:rerun-if-changed=../enterprise/gateway/proto/oxide_gateway.proto");

    tauri_build::build()
}

fn configure_windows_test_manifest() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows")
        || std::env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc")
    {
        return;
    }
    let source = std::path::Path::new(
        &std::env::var("CARGO_MANIFEST_DIR").expect("Cargo manifest directory is available"),
    )
    .join("windows")
    .join("unit-test-manifest.c");
    println!("cargo:rerun-if-changed={}", source.display());
    // Tauri's dialog dependency imports TaskDialogIndirect. The application
    // binary receives a Common Controls v6 manifest from tauri-build, but
    // Cargo's lib-test harness does not inherit it. Compile the linker
    // dependency without emitting Cargo link metadata; lib.rs references the
    // anchor only under cfg(test), so application and CLI manifests remain
    // owned exclusively by tauri-build.
    cc::Build::new()
        .cargo_metadata(false)
        .file(source)
        .compile("oxide_unit_test_manifest");
    let out_dir = std::env::var("OUT_DIR").expect("Cargo build output directory is available");
    println!("cargo:rustc-link-search=native={out_dir}");
}

fn expose_bundled_driver_versions() {
    let lock = std::fs::read_to_string("Cargo.lock")
        .expect("src-tauri/Cargo.lock must be readable to build the driver inventory");
    for (environment, package, prefix) in [
        ("OXIDE_DRIVER_SQLX_VERSION", "sqlx", "0.8."),
        ("OXIDE_DRIVER_MONGODB_VERSION", "mongodb", "3."),
        ("OXIDE_DRIVER_REDIS_VERSION", "redis", "1."),
        ("OXIDE_DRIVER_REQWEST_VERSION", "reqwest", "0.12."),
    ] {
        let version = locked_package_version(&lock, package, prefix).unwrap_or_else(|| {
            panic!("Cargo.lock does not contain the expected {package} {prefix}x package")
        });
        println!("cargo:rustc-env={environment}={version}");
    }
    println!("cargo:rerun-if-changed=Cargo.lock");
}

fn locked_package_version<'a>(lock: &'a str, package: &str, prefix: &str) -> Option<&'a str> {
    let mut name: Option<&str> = None;
    let mut version: Option<&str> = None;
    for line in lock.lines().chain(std::iter::once("[[package]]")) {
        if line == "[[package]]" {
            if name == Some(package) && version.is_some_and(|value| value.starts_with(prefix)) {
                return version;
            }
            name = None;
            version = None;
            continue;
        }
        if let Some(value) = line
            .strip_prefix("name = \"")
            .and_then(|value| value.strip_suffix('"'))
        {
            name = Some(value);
        } else if let Some(value) = line
            .strip_prefix("version = \"")
            .and_then(|value| value.strip_suffix('"'))
        {
            version = Some(value);
        }
    }
    None
}
