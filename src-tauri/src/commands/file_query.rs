use crate::core::{
    file_query::{AuthorizedFile, CsvHeader, FileQueryOwner, FileQuerySession, FileQuerySessions},
    protocol::QueryResult,
    store::MetaStore,
};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

pub struct FileQueryState(pub Result<FileQuerySessions, String>);

impl FileQueryState {
    fn service(&self) -> Result<&FileQuerySessions, String> {
        self.0.as_ref().map_err(Clone::clone)
    }
}

fn owner(window: &WebviewWindow, project_id: String) -> FileQueryOwner {
    FileQueryOwner {
        project_id,
        window: window.label().into(),
    }
}

async fn require_project(meta: &MetaStore, project_id: &str) -> Result<(), String> {
    meta.get_project(project_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "File-query project no longer exists".to_string())
        .map(|_| ())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickFileQueryRequest {
    project_id: String,
    driver_id: String,
    package_version: Option<String>,
    request_id: Option<String>,
    #[serde(default)]
    csv_header: CsvHeader,
}

#[tauri::command]
pub async fn pick_file_query(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileQueryState>,
    meta: State<'_, MetaStore>,
    request: PickFileQueryRequest,
) -> Result<Option<FileQuerySession>, String> {
    let PickFileQueryRequest {
        project_id,
        driver_id,
        package_version,
        csv_header,
        request_id,
    } = request;
    require_project(&meta, &project_id).await?;
    let service = state.service()?;
    let owner = owner(&window, project_id.clone());
    let ticket = match request_id {
        Some(id) => service.begin_open_request(owner, &id),
        None => service.begin_open(owner),
    }
    .map_err(|error| error.to_string())?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Queryable data", &["csv", "json", "jsonl", "parquet"])
        .set_title("Open data file for read-only SQL")
        .pick_file(move |selection| {
            let _ = sender.send(selection);
        });
    let Some(selection) = receiver
        .await
        .map_err(|_| "File selection was interrupted".to_string())?
    else {
        return Ok(None);
    };
    require_project(&meta, &project_id).await?;
    let path = selection
        .into_path()
        .map_err(|_| "Select a filesystem file".to_string())?;
    let file = AuthorizedFile::new(&path)
        .map_err(|error| error.to_string())?
        .with_csv_header(csv_header);
    service
        .open(ticket, file, &driver_id, package_version.as_deref())
        .await
        .map(Some)
        .map_err(|error| error.to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectFileQueryRequest {
    project_id: String,
    relative_path: String,
    expected_root: String,
    driver_id: String,
    package_version: Option<String>,
    #[serde(default)]
    csv_header: CsvHeader,
    request_id: Option<String>,
}

#[tauri::command]
pub async fn open_project_file_query(
    window: WebviewWindow,
    state: State<'_, FileQueryState>,
    meta: State<'_, MetaStore>,
    request: OpenProjectFileQueryRequest,
) -> Result<FileQuerySession, String> {
    let OpenProjectFileQueryRequest {
        project_id,
        relative_path,
        expected_root,
        driver_id,
        package_version,
        csv_header,
        request_id,
    } = request;
    let service = state.service()?;
    let owner = owner(&window, project_id.clone());
    let ticket = match request_id {
        Some(id) => service.begin_open_request(owner, &id),
        None => service.begin_open(owner),
    }
    .map_err(|error| error.to_string())?;
    let file =
        super::project_files::file_query_source(&meta, &project_id, &relative_path, &expected_root)
            .await?;
    service
        .open(
            ticket,
            file.with_csv_header(csv_header),
            &driver_id,
            package_version.as_deref(),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn run_file_query(
    window: WebviewWindow,
    state: State<'_, FileQueryState>,
    meta: State<'_, MetaStore>,
    project_id: String,
    session_id: String,
    sql: String,
) -> Result<Vec<QueryResult>, String> {
    let service = state.service()?;
    let owner = owner(&window, project_id);
    let project = meta
        .get_project(&owner.project_id)
        .await
        .map_err(|error| error.to_string())?;
    let bound = service
        .project_root(&owner, &session_id)
        .map_err(|error| error.to_string())?;
    let valid = project.is_some_and(|project| {
        bound.as_ref().is_none_or(|bound| {
            project
                .root_path
                .and_then(|root| std::path::PathBuf::from(root).canonicalize().ok())
                .as_ref()
                == Some(bound)
        })
    });
    if !valid {
        service
            .close(&owner, &session_id)
            .await
            .map_err(|error| error.to_string())?;
        return Err("Project root changed or project was removed; reopen the file".into());
    }
    service
        .query(&owner, &session_id, &sql)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn close_file_query(
    window: WebviewWindow,
    state: State<'_, FileQueryState>,
    project_id: String,
    session_id: String,
) -> Result<(), String> {
    state
        .service()?
        .close(&owner(&window, project_id), &session_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resolve_file_query_statement(
    window: WebviewWindow,
    state: State<'_, FileQueryState>,
    project_id: String,
    session_id: String,
    sql: String,
    cursor_offset: usize,
) -> Result<Option<crate::commands::query::SqlStatementSelection>, String> {
    if sql.len() > 64 * 1024 {
        return Err("file queries are limited to 64 KiB SQL".into());
    }
    let session = state
        .service()?
        .list(&owner(&window, project_id))
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|session| session.id == session_id)
        .ok_or("File-query session has ended")?;
    let dialect = crate::drivers::external::external_statement_scan_dialect(
        &session.driver_id,
        Some(&session.language_id),
    )
    .ok_or("Statement resolution is unavailable for this file provider")?;
    Ok(crate::commands::query::sql_statement_at_cursor(
        &sql,
        dialect,
        cursor_offset,
    ))
}

#[tauri::command]
pub async fn close_project_file_queries(
    window: WebviewWindow,
    state: State<'_, FileQueryState>,
    project_id: String,
) -> Result<(), String> {
    state
        .service()?
        .close_owner(&owner(&window, project_id))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn cancel_file_query_open(
    window: WebviewWindow,
    state: State<'_, FileQueryState>,
    project_id: String,
    request_id: String,
) -> Result<(), String> {
    state
        .service()?
        .cancel_open(&owner(&window, project_id), &request_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_file_query_session(
    window: WebviewWindow,
    state: State<'_, FileQueryState>,
    project_id: String,
    session_id: String,
) -> Result<Option<FileQuerySession>, String> {
    Ok(state
        .service()?
        .list(&owner(&window, project_id))
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|session| session.id == session_id))
}
