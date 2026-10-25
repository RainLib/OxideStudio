//! Opt-in real WebView + production client/commands + bundled LSP acceptance.
use anyhow::{ensure, Result};
use oxide_studio_lib::commands::lsp;
use serde_json::{json, Value};
use std::io::Write;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::State;
#[path = "lookupFixture.rs"]
mod lookup_fixture;

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
    finished: Arc<AtomicBool>,
}
#[tauri::command]
fn acceptance_progress(
    state: State<'_, Acceptance>,
    name: String,
    phase: String,
) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(state.root.join("progress.jsonl"))
        .map_err(|error| error.to_string())?;
    writeln!(file, "{}", json!({"name":name,"phase":phase})).map_err(|error| error.to_string())
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
    receipt["realWebviewIpc"] = json!(true);
    std::fs::write(
        state.root.join("receipt.json"),
        serde_json::to_vec_pretty(&receipt).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    app.exit(if success { 0 } else { 1 });
    Ok(())
}
fn run() -> Result<()> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.first().and_then(|value| value.to_str()) != Some("--run-native-ipc") {
        println!("desktop_lsp_ipc: opt-in only; node scripts/test-desktop-lsp-ipc.mjs");
        return Ok(());
    }
    ensure!(args.len() == 2, "expected --run-native-ipc <isolated root>");
    ensure!(
        std::env::var_os("OXIDE_SQL_LSP_BINARY").is_none(),
        "acceptance must resolve the actual bundled binary"
    );
    let root = PathBuf::from(&args[1]);
    ensure!(root.is_absolute());
    let root = root.canonicalize()?;
    ensure!(root.parent() == Some(std::env::temp_dir().canonicalize()?.as_path()));
    ensure!(root
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.starts_with("oxide-desktop-lsp-ipc-")));
    ensure!(root.join("scenario.js").is_file());
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.houshuai.oxide-lsp-acceptance".into();
    let finished = Arc::new(AtomicBool::new(false));
    let sessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let assets = root.clone();
    let webview_data = root.join("webview");
    let receipt = root.join("receipt.json");
    let metadata = oxide_studio_lib::core::manager::ConnectionManager::new();
    tauri::async_runtime::block_on(metadata.add_connection(
        "lookup-fixture".into(),
        Box::new(lookup_fixture::LookupFixture),
    ));
    tauri::async_runtime::block_on(async {
        use oxide_studio_lib::core::driver::DatabaseDriver;
        let mut sqlite = oxide_studio_lib::drivers::sqlite::SqliteDriver::new("sqlite::memory:");
        sqlite.connect().await?;
        metadata
            .add_connection("semantic-sqlite".into(), Box::new(sqlite))
            .await;
        Ok::<(), anyhow::Error>(())
    })?;
    let app=tauri::Builder::default()
        .manage(metadata)
        .manage(oxide_studio_lib::commands::query::QueryCancellationState::default())
        .manage(lsp::LspState(sessions.clone()))
        .manage(Acceptance{root:root.clone(),finished:finished.clone()})
        .register_uri_scheme_protocol("lsp-acceptance",move |_,request| {
            let name=request.uri().path().trim_start_matches('/');
            let (body,content_type)=if name.is_empty() {
                (b"<!doctype html><meta charset='utf-8'><title>Isolated LSP acceptance</title><link rel='stylesheet' href='/scenario.css'><div id='editor' style='width:800px;height:400px'></div><script src='/scenario.js'></script>".to_vec(),"text/html; charset=utf-8")
            } else if matches!(name,"scenario.js"|"scenario.css"|"file-query-fixture.json") || (name.starts_with("codicon-")&&name.ends_with(".ttf")&&!name.contains(['/', '\\'])) {
                (std::fs::read(assets.join(name)).unwrap_or_default(),if name.ends_with(".json") {"application/json"} else if name.ends_with(".js") {"application/javascript"} else if name.ends_with(".css") {"text/css"} else {"font/ttf"})
            } else {(Vec::new(),"text/plain")};
            tauri::http::Response::builder().header("Content-Type",content_type).body(body).unwrap()
        })
        .invoke_handler(tauri::generate_handler![oxide_studio_lib::lsp::download::check_lsp_binary,lsp::lsp_initialize,lsp::lsp_shutdown,lsp::lsp_is_running,lsp::lsp_cancel_request,lsp::lsp_did_change_configuration,lsp::lsp_did_open,lsp::lsp_did_change,lsp::lsp_did_close,lsp::lsp_get_completions,lsp::lsp_resolve_completion,lsp::lsp_hover,lsp::lsp_formatting,lsp::lsp_request,lsp::lsp_inline_completion_context,lsp::lsp_validate_inline_completion,oxide_studio_lib::commands::schema::get_sql_lookup_context,oxide_studio_lib::commands::schema::get_columns,oxide_studio_lib::commands::schema::get_generated_columns,oxide_studio_lib::commands::schema::get_tables,oxide_studio_lib::commands::schema::get_database_tables,oxide_studio_lib::commands::schema::get_database_columns,oxide_studio_lib::commands::semantic_context::get_connection_semantic_state,oxide_studio_lib::commands::query::execution::execute_query,oxide_studio_lib::commands::transaction::begin_transaction,oxide_studio_lib::commands::transaction::rollback_transaction,acceptance_progress,acceptance_finish])
        .setup(move |app| {oxide_studio_lib::commands::semantic_context::install_semantic_state_events(app.handle());tauri::WebviewWindowBuilder::new(app,"lsp-acceptance",tauri::WebviewUrl::External("lsp-acceptance://localhost/".parse()?)).visible(false).data_directory(webview_data).build()?;Ok(())})
        .build(context)?;
    let handle = app.handle().clone();
    let watchdog = finished.clone();
    std::thread::spawn(move || {
        for _ in 0..1200 {
            if watchdog.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        handle.exit(2);
    });
    let code = app.run_return(|_, _| {});
    let report: Value = serde_json::from_slice(&std::fs::read(receipt)?)?;
    ensure!(
        code == 0 && finished.load(Ordering::SeqCst) && report["success"] == true,
        "IPC acceptance exited {code}: {report}"
    );
    ensure!(
        tauri::async_runtime::block_on(sessions.lock()).is_empty(),
        "LSP sessions were not shut down"
    );
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("desktop_lsp_ipc: {error:#}");
        std::process::exit(1);
    }
}
