fn main() {
    // Tauri embeds the application icon into the macOS development binary.
    // Track the source assets explicitly so replacing an icon invalidates the
    // generated context instead of leaving the previous Dock icon cached.
    for icon in ["icons/icon.png", "icons/icon.icns", "icons/icon.ico"] {
        println!("cargo:rerun-if-changed={icon}");
    }

    // Development launches the TypeScript host through the installed Node 22
    // runtime. Production builds still require and bundle the self-contained
    // external binaries declared in tauri.conf.json.
    if tauri_build::is_dev() && std::env::var_os("TAURI_CONFIG").is_none() {
        std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"externalBin":[]}}"#);
    }

    tonic_prost_build::configure()
        .build_server(false)
        .build_client(true)
        .compile_protos(
            &["../enterprise/gateway/proto/oxide_gateway.proto"],
            &["../enterprise/gateway/proto"],
        )
        .expect("enterprise Gateway client protocol must compile");
    println!("cargo:rerun-if-changed=../enterprise/gateway/proto/oxide_gateway.proto");

    tauri_build::build()
}
