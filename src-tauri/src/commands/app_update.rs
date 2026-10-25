//! Only checked updater resources cross this boundary. Downloaded bytes and the
//! selected version stay together in the originating webview's resource table.
use super::sqlite_backup_schedule::{
    install_prepared, SqliteBackupScheduleState, UpdateInstallationStatus, UpdatePreparation,
};
use serde::Serialize;
use tauri::{ipc::Channel, Manager, Resource, ResourceId, State, Webview};
use tauri_plugin_updater::Update;

struct DownloadedUpdate {
    id: String,
    update: Update,
    bytes: Vec<u8>,
}
impl Resource for DownloadedUpdate {}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum AppUpdateDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

fn validate_update(update: &Update) -> Result<(), String> {
    let actual = semver::Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|_| "Invalid application version")?;
    let current = semver::Version::parse(&update.current_version)
        .map_err(|_| "Invalid checked application version")?;
    let target = semver::Version::parse(&update.version)
        .map_err(|_| "Invalid application update version")?;
    if current != actual || target <= actual {
        return Err(
            "Check for an update newer than the running application before downloading".to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn download_app_update(
    webview: Webview,
    update_rid: ResourceId,
    on_event: Channel<AppUpdateDownloadEvent>,
) -> Result<ResourceId, String> {
    let update = webview
        .resources_table()
        .get::<Update>(update_rid)
        .map_err(|error| error.to_string())?;
    validate_update(&update)?;
    let mut update = (*update).clone();
    update.timeout = Some(std::time::Duration::from_secs(120));
    let mut first = true;
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if first {
                    first = false;
                    let _ = on_event.send(AppUpdateDownloadEvent::Started { content_length });
                }
                let _ = on_event.send(AppUpdateDownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(AppUpdateDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(webview.resources_table().add(DownloadedUpdate {
        id: uuid::Uuid::new_v4().to_string(),
        update,
        bytes,
    }))
}

#[tauri::command]
pub async fn prepare_app_update(
    webview: Webview,
    state: State<'_, SqliteBackupScheduleState>,
    bytes_rid: ResourceId,
) -> Result<UpdatePreparation, String> {
    let download = webview
        .resources_table()
        .get::<DownloadedUpdate>(bytes_rid)
        .map_err(|error| error.to_string())?;
    validate_update(&download.update)?;
    state
        .prepare_update(&download.update.version, webview.label(), &download.id)
        .await
}

#[tauri::command]
pub async fn poll_app_update_preparation(
    webview: Webview,
    state: State<'_, SqliteBackupScheduleState>,
    bytes_rid: ResourceId,
    token: String,
) -> Result<UpdatePreparation, String> {
    let download = webview
        .resources_table()
        .get::<DownloadedUpdate>(bytes_rid)
        .map_err(|error| error.to_string())?;
    state
        .poll_update_preparation(&token, webview.label(), &download.id)
        .await
}

#[tauri::command]
pub async fn cancel_app_update_preparation(
    webview: Webview,
    state: State<'_, SqliteBackupScheduleState>,
    bytes_rid: ResourceId,
    token: String,
) -> Result<(), String> {
    let download = webview
        .resources_table()
        .get::<DownloadedUpdate>(bytes_rid)
        .map_err(|error| error.to_string())?;
    state
        .cancel_update_preparation(&token, webview.label(), &download.id)
        .await
}

#[tauri::command]
pub async fn install_app_update(
    webview: Webview,
    state: State<'_, SqliteBackupScheduleState>,
    bytes_rid: ResourceId,
    token: String,
) -> Result<(), String> {
    let download = webview
        .resources_table()
        .get::<DownloadedUpdate>(bytes_rid)
        .map_err(|error| error.to_string())?;
    validate_update(&download.update)?;
    let state = state.inner().clone();
    let owner = webview.label().to_string();
    // The native task owns rollback even if its renderer reloads or disappears.
    tauri::async_runtime::spawn(async move {
        let download_id = download.id.clone();
        install_prepared(&state, &token, &owner, &download_id, move || {
            download
                .update
                .install(&download.bytes)
                .map_err(|error| error.to_string())
        })
        .await
    })
    .await
    .map_err(|_| {
        "The update task stopped unexpectedly; check backup recovery status".to_string()
    })??;
    let _ = webview.resources_table().close(bytes_rid);
    Ok(())
}

#[tauri::command]
pub async fn get_app_update_installation_status(
    state: State<'_, SqliteBackupScheduleState>,
) -> Result<UpdateInstallationStatus, String> {
    state.update_installation_status().await
}

#[tauri::command]
pub async fn recover_app_update_backups(
    state: State<'_, SqliteBackupScheduleState>,
    installation_id: String,
) -> Result<(), String> {
    state.recover_update_backups(&installation_id).await
}
