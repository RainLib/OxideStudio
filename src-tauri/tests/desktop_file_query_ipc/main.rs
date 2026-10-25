//! Explicit isolated WebView using production file UI, commands and signed Host.
mod fixture;
use anyhow::{ensure, Result};
use oxide_studio_lib::{
    commands::{file_query, lsp},
    core::manager::ConnectionManager,
};
use serde_json::{json, Value};
use std::{
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{Manager, State};
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
fn acceptance_progress(state: State<'_, Acceptance>, name: String) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(state.root.join("progress.jsonl"))
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", json!({"name":name})).map_err(|e| e.to_string())
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
    std::fs::write(
        state.root.join("receipt.json"),
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    app.exit(if success { 0 } else { 1 });
    Ok(())
}
fn run() -> Result<()> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.first().and_then(|v| v.to_str()) != Some("--run-native-ipc") {
        println!(
            "desktop_file_query_ipc: opt-in only; node scripts/test-desktop-file-query-ipc.mjs"
        );
        return Ok(());
    }
    ensure!(args.len() == 2);
    let root = PathBuf::from(&args[1]);
    ensure!(root.is_absolute());
    let resolved = root.canonicalize()?;
    ensure!(resolved.parent() == Some(std::env::temp_dir().canonicalize()?.as_path()));
    ensure!(resolved
        .file_name()
        .and_then(|v| v.to_str())
        .is_some_and(|v| v.starts_with("oxide-desktop-file-query-")));
    ensure!(root.join("scenario.js").is_file());
    let fixture = tauri::async_runtime::block_on(fixture::Fixture::open(&root))?;
    let service = fixture.service.clone();
    let sessions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.houshuai.oxide-file-query-acceptance".into();
    let assets = root.clone();
    let finished = Arc::new(AtomicBool::new(false));
    let webview = root.join("webview");
    let app=tauri::Builder::default().plugin(tauri_plugin_dialog::init())
        .manage(ConnectionManager::new()).manage(fixture.metadata.clone()).manage(fixture.registry.clone()).manage(file_query::FileQueryState(Ok(service.clone()))).manage(lsp::LspState(sessions.clone())).manage(Acceptance{root:root.clone(),finished:finished.clone()})
        .register_uri_scheme_protocol("file-acceptance",move|_,request|{let name=request.uri().path().trim_start_matches('/');let(body,kind)=if name.is_empty(){(b"<!doctype html><meta charset='utf-8'><link rel='stylesheet' href='/app.css'><link rel='stylesheet' href='/scenario.css'><div id='root'></div><script src='/scenario.js'></script>".to_vec(),"text/html; charset=utf-8")}else if matches!(name,"scenario.js"|"scenario.css"|"app.css"|"fixture.json")||(name.starts_with("codicon-")&&name.ends_with(".ttf")&&!name.contains(['/', '\\'])){(std::fs::read(assets.join(name)).unwrap_or_default(),if name.ends_with(".json"){"application/json"}else if name.ends_with(".js"){"application/javascript"}else if name.ends_with(".css"){"text/css"}else{"font/ttf"})}else{(Vec::new(),"text/plain")};tauri::http::Response::builder().header("Content-Type",kind).body(body).unwrap()})
        .invoke_handler(tauri::generate_handler![oxide_studio_lib::commands::database::packages::list_database_driver_installations,oxide_studio_lib::commands::project_files::list_project_entries,oxide_studio_lib::commands::store::get_projects,oxide_studio_lib::commands::store::save_project,
            file_query::open_project_file_query,file_query::pick_file_query,file_query::run_file_query,file_query::close_file_query,file_query::close_project_file_queries,file_query::cancel_file_query_open,file_query::get_file_query_session,file_query::resolve_file_query_statement,
            oxide_studio_lib::lsp::download::check_lsp_binary,lsp::lsp_initialize,lsp::lsp_shutdown,lsp::lsp_is_running,lsp::lsp_cancel_request,lsp::lsp_did_change_configuration,lsp::lsp_did_open,lsp::lsp_did_change,lsp::lsp_did_close,lsp::lsp_get_completions,lsp::lsp_resolve_completion,lsp::lsp_hover,lsp::lsp_formatting,lsp::lsp_request,lsp::lsp_inline_completion_context,lsp::lsp_validate_inline_completion,acceptance_progress,acceptance_finish])
        .on_window_event(|window,event|{if matches!(event,tauri::WindowEvent::Destroyed){if let Some(state)=window.try_state::<file_query::FileQueryState>(){if let Ok(service)=&state.0{let(service,label)=(service.clone(),window.label().to_string());tauri::async_runtime::spawn(async move{let _=service.close_window(&label).await;});}}}})
        .setup(move|app|{tauri::WebviewWindowBuilder::new(app,"file-acceptance",tauri::WebviewUrl::External("file-acceptance://localhost/".parse()?)).visible(false).inner_size(1200.0,800.0).data_directory(webview).build()?;Ok(())}).build(context)?;
    let handle = app.handle().clone();
    let watchdog = finished.clone();
    std::thread::spawn(move || {
        for _ in 0..1800 {
            if watchdog.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        handle.exit(2);
    });
    let code = app.run_return(|_, _| {});
    tauri::async_runtime::block_on(service.close_window("file-acceptance"))?;
    tauri::async_runtime::block_on(async {
        let managers = sessions
            .lock()
            .await
            .drain()
            .map(|(_, manager)| manager)
            .collect::<Vec<_>>();
        for manager in managers {
            let _ = manager.stop().await;
        }
    });
    fixture.verify_sources()?;
    let receipt: Value = serde_json::from_slice(&std::fs::read(root.join("receipt.json"))?)?;
    ensure!(
        code == 0 && receipt["success"] == true,
        "file IPC exited {code}: {receipt}"
    );
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("desktop_file_query_ipc: {error:#}");
        std::process::exit(1);
    }
}
