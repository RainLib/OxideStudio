//! Real WebView -> Tauri command -> SQLite acceptance, never a shipping hook.
//! Run through scripts/test-desktop-import-ipc.mjs on an interactive desktop.
mod fixture;

use anyhow::{ensure, Result};
use fixture::{verify_target, Fixture};
use oxide_studio_lib::commands::{large_transfer, table};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::State;

#[cfg(all(target_os = "windows", target_env = "msvc"))]
#[link(name = "oxide_unit_test_manifest", kind = "static")]
unsafe extern "C" {
    fn oxide_unit_test_manifest_anchor();
}
#[cfg(all(target_os = "windows", target_env = "msvc"))]
#[used]
static MANIFEST_ANCHOR: unsafe extern "C" fn() = oxide_unit_test_manifest_anchor;

struct Acceptance {
    root: PathBuf,
    stage: String,
    finished: Arc<AtomicBool>,
}

#[tauri::command]
async fn acceptance_target(state: State<'_, Acceptance>, published: bool) -> Result<Value, String> {
    verify_target(&state.root, published)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn acceptance_finish(
    app: tauri::AppHandle,
    state: State<'_, Acceptance>,
    report: Value,
) -> Result<(), String> {
    if state.finished.swap(true, Ordering::SeqCst) {
        return Err("duplicate receipt".into());
    }
    let success = report["success"] == true;
    let mut receipt = report;
    receipt["stage"] = json!(state.stage);
    receipt["realWebviewIpc"] = json!(true);
    std::fs::write(
        state.root.join(format!("{}-receipt.json", state.stage)),
        serde_json::to_vec_pretty(&receipt).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    app.exit(if success { 0 } else { 1 });
    Ok(())
}

fn run() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.first().and_then(|arg| arg.to_str()) != Some("--run-native-ipc") {
        println!("desktop_import_ipc: opt-in only; node scripts/test-desktop-import-ipc.mjs");
        return Ok(());
    }
    ensure!(
        args.len() == 3,
        "expected --run-native-ipc <isolated root> prepare|resume"
    );
    // Resolve only for the ownership guard. Passing canonicalize()'s Windows
    // verbatim prefix to a string-based SQLite URL invents a '?' query part.
    let root = PathBuf::from(&args[1]);
    ensure!(root.is_absolute());
    let resolved = root.canonicalize()?;
    ensure!(resolved.parent() == Some(std::env::temp_dir().canonicalize()?.as_path()));
    ensure!(resolved
        .file_name()
        .and_then(|v| v.to_str())
        .is_some_and(|v| v.starts_with("oxide-desktop-import-ipc-")));
    let stage = args[2]
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("stage"))?
        .to_owned();
    ensure!(matches!(stage.as_str(), "prepare" | "resume"));
    let fixture = tauri::async_runtime::block_on(Fixture::open(root.clone(), stage.clone()))?;
    tauri::async_runtime::block_on(verify_target(&root, false))?;
    let config = fixture.script_config()?;
    let receipt_path = root.join(format!("{stage}-receipt.json"));
    let finished = Arc::new(AtomicBool::new(false));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.houshuai.oxide-ipc-acceptance".into();
    let script = format!(
        "globalThis.__OXIDE_IMPORT_FIXTURE__={config};\n{}",
        include_str!("scenario.js")
    );
    let webview_data = root.join(format!("webview-{stage}"));
    let app = tauri::Builder::default()
        .manage(fixture.manager)
        .manage(large_transfer::LargeTransferJobState(Ok(fixture.jobs)))
        .manage(table::TableImportCancellationState::default())
        .manage(Acceptance {
            root: root.clone(),
            stage,
            finished: finished.clone(),
        })
        .register_uri_scheme_protocol("acceptance", |_, _| {
            tauri::http::Response::builder()
                .header("Content-Type", "text/html; charset=utf-8")
                .body(b"<!doctype html><title>Isolated IPC acceptance</title>".to_vec())
                .unwrap()
        })
        .invoke_handler(tauri::generate_handler![
            table::preview_table_json_import,
            table::prepare_table_import_job,
            table::resume_table_import_preparation,
            table::list_table_import_preparations,
            table::list_table_import_jobs,
            large_transfer::get_large_transfer,
            large_transfer::preview_large_transfer,
            large_transfer::start_large_transfer,
            large_transfer::pause_large_transfer,
            large_transfer::cancel_large_transfer,
            acceptance_target,
            acceptance_finish
        ])
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "ipc-acceptance",
                tauri::WebviewUrl::External("acceptance://localhost/".parse()?),
            )
            .visible(false)
            .data_directory(webview_data)
            .initialization_script(script.clone())
            .build()?;
            Ok(())
        })
        .build(context)?;
    let handle = app.handle().clone();
    let watchdog_finished = finished.clone();
    std::thread::spawn(move || {
        // This process owns the window. A hung bridge fails instead of leaving
        // an unattended runtime; the outer runner has a separate hard deadline.
        for _ in 0..1200 {
            if watchdog_finished.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        handle.exit(2);
    });
    let code = app.run_return(|_, _| {});
    let receipt: Value = serde_json::from_slice(&std::fs::read(receipt_path)?)?;
    ensure!(
        code == 0 && finished.load(Ordering::SeqCst) && receipt["success"] == true,
        "IPC acceptance exited {code} without a successful receipt"
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("desktop_import_ipc: {error:#}");
        std::process::exit(1);
    }
}
