#![cfg(feature = "desktop")]

use oxide_studio_lib::commands::sqlite_backup_schedule::{
    install_prepared, SaveSqliteBackupScheduleRequest, SqliteBackupCompression,
    SqliteBackupScheduleFrequency, SqliteBackupScheduleState, UpdatePreparation,
};
use serde_json::Value;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection, SqliteConnection};
use std::fs::{OpenOptions, TryLockError};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct Profile {
    directory: tempfile::TempDir,
    data: PathBuf,
    config: PathBuf,
    state: SqliteBackupScheduleState,
}

impl Profile {
    async fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let config = directory.path().join("config");
        let backups = directory.path().join("backups");
        for path in [&data, &config, &backups] {
            std::fs::create_dir(path).unwrap();
        }
        let source = directory.path().join("source.sqlite");
        let mut db = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(&source)
                .create_if_missing(true)
                .disable_statement_logging(),
        )
        .await
        .unwrap();
        sqlx::query("CREATE TABLE sample (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO sample VALUES (42, 'worker process')").execute(&mut db).await.unwrap();
        db.close().await.unwrap();
        let mut db = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(config.join("metadata.db"))
                .create_if_missing(true)
                .disable_statement_logging(),
        )
        .await
        .unwrap();
        sqlx::query("CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('project-1'), ('project-2'); CREATE TABLE connections (id TEXT PRIMARY KEY, project_id TEXT, driver TEXT, config TEXT)").execute(&mut db).await.unwrap();
        for index in 1..=2 {
            sqlx::query("INSERT INTO connections VALUES (?, ?, 'sqlite', ?)")
                .bind(format!("sqlite-{index}"))
                .bind(format!("project-{index}"))
                .bind(serde_json::json!({"database":source}).to_string())
                .execute(&mut db)
                .await
                .unwrap();
        }
        db.close().await.unwrap();
        let state = SqliteBackupScheduleState::open_existing_profile(&data, &config).unwrap();
        for index in 1..=2 {
            state
                .save_schedule(SaveSqliteBackupScheduleRequest {
                    id: None,
                    name: format!("Project {index}"),
                    project_id: format!("project-{index}"),
                    connection_id: format!("sqlite-{index}"),
                    destination_directory: backups.to_string_lossy().into_owned(),
                    frequency: SqliteBackupScheduleFrequency::Hourly,
                    interval_hours: 1,
                    time_of_day: "02:00".to_string(),
                    time_zone: Some("Asia/Shanghai".to_string()),
                    weekday: 1,
                    retention_count: 2,
                    compression: SqliteBackupCompression::None,
                    enabled: false,
                })
                .await
                .unwrap();
        }
        Self {
            directory,
            data,
            config,
            state,
        }
    }

    fn store_path(&self) -> PathBuf {
        self.data.join("database-backups/sqlite-schedules.json")
    }
    fn snapshot(&self) -> Value {
        serde_json::from_slice(&std::fs::read(self.store_path()).unwrap()).unwrap()
    }
    fn edit(&self, apply: impl FnOnce(&mut Value)) {
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(self.data.join("database-backups/store.lock"))
            .unwrap();
        lock.lock().unwrap();
        let mut value = self.snapshot();
        apply(&mut value);
        std::fs::write(
            self.store_path(),
            serde_json::to_vec_pretty(&value).unwrap(),
        )
        .unwrap();
    }
    async fn queue_first(&self) {
        let id = self.snapshot()["schedules"][0]["id"]
            .as_str()
            .unwrap()
            .to_string();
        self.state.queue_backup(&id).await.unwrap();
    }
    fn command(&self, once: bool) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_oxide-studio"));
        command
            .arg("--backup-worker")
            .arg("--data-dir")
            .arg(&self.data)
            .arg("--config-dir")
            .arg(&self.config);
        if once {
            command.arg("--once");
        }
        hide(&mut command);
        command
    }
    fn worker_running(&self) -> bool {
        locked(&self.data.join("database-backups/worker.lock"))
    }
    async fn wait_for(&self, condition: impl Fn(&Self) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(15);
        while !condition(self) {
            assert!(
                Instant::now() < deadline,
                "worker condition timed out: {}",
                self.snapshot()
            );
            tokio::time::sleep(Duration::from_millis(40)).await;
        }
    }
    fn launch_parent(&self) -> Child {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--ignored",
                "--exact",
                "desktop_lifetime_fixture",
                "--nocapture",
            ])
            .env("OXIDE_BACKUP_TEST_DATA", &self.data)
            .env("OXIDE_BACKUP_TEST_CONFIG", &self.config);
        hide(&mut command);
        command.spawn().unwrap()
    }
}

impl Drop for Profile {
    fn drop(&mut self) {
        // No real user startup registration is installed by these tests.
        // Also stop an orphaned fixture worker if an assertion failed.
        if self.store_path().exists() {
            self.edit(|value| value["backgroundEnabled"] = false.into());
        }
    }
}

fn hide(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
}

fn locked(path: &Path) -> bool {
    let Ok(file) = OpenOptions::new().read(true).write(true).open(path) else {
        return false;
    };
    match file.try_lock() {
        Ok(()) => false,
        Err(TryLockError::WouldBlock) => true,
        Err(error) => panic!("Cannot inspect fixture process lease: {error}"),
    }
}

fn wait_child(child: &mut Child) {
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            assert!(status.success(), "worker exited with {status}");
            return;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            panic!("backup worker did not exit");
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

struct Parent(Child);
impl Drop for Parent {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
#[ignore = "subprocess fixture, invoked explicitly by the lifecycle test"]
fn desktop_lifetime_fixture() {
    let data =
        PathBuf::from(std::env::var_os("OXIDE_BACKUP_TEST_DATA").expect("fixture data directory"));
    let config = PathBuf::from(
        std::env::var_os("OXIDE_BACKUP_TEST_CONFIG").expect("fixture config directory"),
    );
    let desktop = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(data.join("database-backups/desktop.lock"))
        .unwrap();
    desktop.lock_shared().unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_oxide-studio"));
    command
        .arg("--backup-worker")
        .arg("--data-dir")
        .arg(&data)
        .arg("--config-dir")
        .arg(config);
    hide(&mut command);
    let mut worker = command.spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(40);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = worker.kill();
    let _ = worker.wait();
}

#[tokio::test]
async fn real_worker_process_executes_both_projects_and_serializes_competing_leaders() {
    let profile = Profile::new().await;
    profile.edit(|value| {
        value["backgroundEnabled"] = true.into();
        for plan in value["schedules"].as_array_mut().unwrap() {
            plan["frequency"] = "daily".into();
            plan["timeOfDay"] = "02:17".into();
            plan["timeZone"] = "Asia/Kathmandu".into();
        }
    });
    for schedule in profile.snapshot()["schedules"].as_array().unwrap() {
        profile
            .state
            .queue_backup(schedule["id"].as_str().unwrap())
            .await
            .unwrap();
    }
    let metadata_before = std::fs::read(profile.config.join("metadata.db")).unwrap();
    let source_before = std::fs::read(profile.directory.path().join("source.sqlite")).unwrap();
    let mut first = profile.command(true).env("TZ", "UTC").spawn().unwrap();
    let mut second = profile
        .command(true)
        .env("TZ", "America/New_York")
        .spawn()
        .unwrap();
    wait_child(&mut first);
    wait_child(&mut second);
    let value = profile.snapshot();
    for plan in value["schedules"].as_array().unwrap() {
        use chrono::Timelike;
        assert_eq!(plan["timeZone"], "Asia/Kathmandu");
        let local = chrono::DateTime::parse_from_rfc3339(plan["nextRunAt"].as_str().unwrap())
            .unwrap()
            .with_timezone(&chrono::FixedOffset::east_opt(5 * 3600 + 45 * 60).unwrap());
        assert_eq!((local.hour(), local.minute(), local.second()), (2, 17, 0));
    }
    assert_eq!(value["runs"].as_array().unwrap().len(), 2);
    for run in value["runs"].as_array().unwrap() {
        assert_eq!(run["status"], "success", "{run}");
        assert_eq!(run["integrityCheck"], "ok");
        let mut backup = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(run["filePath"].as_str().unwrap())
                .read_only(true),
        )
        .await
        .unwrap();
        let id: i64 = sqlx::query_scalar("SELECT id FROM sample")
            .fetch_one(&mut backup)
            .await
            .unwrap();
        assert_eq!(id, 42);
        backup.close().await.unwrap();
    }
    let mut again = profile.command(true).spawn().unwrap();
    wait_child(&mut again);
    assert_eq!(profile.snapshot()["runs"].as_array().unwrap().len(), 2);
    assert_eq!(
        metadata_before,
        std::fs::read(profile.config.join("metadata.db")).unwrap()
    );
    assert_eq!(
        source_before,
        std::fs::read(profile.directory.path().join("source.sqlite")).unwrap()
    );
    // Simulate a process stopping after the independent ledger commit and
    // before the JSON completion checkpoint. A new OS process must recover
    // the receipt without reconnecting to the now unavailable source file.
    profile.edit(|value| {
        value["runs"][0]["status"] = "running".into();
        value["runs"][0]["completedAt"] = Value::Null;
    });
    std::fs::remove_file(profile.directory.path().join("source.sqlite")).unwrap();
    let mut recovered = profile.command(true).spawn().unwrap();
    wait_child(&mut recovered);
    assert!(profile.snapshot()["runs"]
        .as_array()
        .unwrap()
        .iter()
        .all(|run| run["status"] == "success"));
    profile.edit(|value| value["runs"] = serde_json::json!([]));
    let page = profile
        .state
        .list_artifacts(Default::default())
        .await
        .unwrap();
    assert_eq!(page.items.len(), 2);
    let archived = &page.items[0];
    let preview = profile
        .state
        .preview_delete_backup(&archived.id)
        .await
        .unwrap();
    assert!(!preview.review_required);
    assert!(profile
        .state
        .delete_backup_confirmed(&archived.id, preview.confirmation_token.as_deref())
        .await
        .unwrap());
    assert!(!std::path::Path::new(archived.file_path.as_deref().unwrap()).exists());
    assert_eq!(
        profile
            .state
            .list_artifacts(Default::default())
            .await
            .unwrap()
            .items
            .len(),
        1
    );
}

#[tokio::test]
async fn worker_survives_desktop_process_exit_only_when_enabled_and_resumes_queued_work_on_reopen()
{
    for enabled in [false, true] {
        let profile = Profile::new().await;
        profile.edit(|value| value["backgroundEnabled"] = enabled.into());
        let mut parent = Parent(profile.launch_parent());
        profile
            .wait_for(|profile| {
                profile.worker_running()
                    && locked(&profile.data.join("database-backups/desktop.lock"))
            })
            .await;
        parent.0.kill().unwrap();
        parent.0.wait().unwrap();
        if enabled {
            tokio::time::sleep(Duration::from_millis(1300)).await;
            assert!(
                profile.worker_running(),
                "opted-in worker exited with its desktop parent"
            );
            profile.queue_first().await;
            profile
                .wait_for(|profile| profile.snapshot()["runs"][0]["status"] == "success")
                .await;
            profile.edit(|value| value["backgroundEnabled"] = false.into());
            profile.wait_for(|profile| !profile.worker_running()).await;
        } else {
            profile.wait_for(|profile| !profile.worker_running()).await;
            profile.queue_first().await;
            assert_eq!(profile.snapshot()["runs"][0]["status"], "queued");
            let mut reopened = Parent(profile.launch_parent());
            profile
                .wait_for(|profile| profile.snapshot()["runs"][0]["status"] == "success")
                .await;
            reopened.0.kill().unwrap();
            reopened.0.wait().unwrap();
            profile.wait_for(|profile| !profile.worker_running()).await;
            assert_eq!(profile.snapshot()["runs"].as_array().unwrap().len(), 1);
        }
    }
}

#[tokio::test]
async fn abandoned_running_occurrence_is_recorded_without_duplicate_backup_on_process_restart() {
    let profile = Profile::new().await;
    profile.queue_first().await;
    profile.edit(|value| {
        value["backgroundEnabled"] = true.into();
        value["runs"][0]["status"] = "running".into();
    });
    for _ in 0..2 {
        let mut worker = profile.command(true).spawn().unwrap();
        wait_child(&mut worker);
    }
    let value = profile.snapshot();
    assert_eq!(value["runs"].as_array().unwrap().len(), 1);
    assert_eq!(value["runs"][0]["status"], "interrupted");
    assert_eq!(
        std::fs::read_dir(profile.directory.path().join("backups"))
            .unwrap()
            .count(),
        0
    );
}

fn previous_worker(variable: &str) -> PathBuf {
    let path =
        PathBuf::from(std::env::var_os(variable).unwrap_or_else(|| {
            panic!("Set {variable} to an actual previously built desktop worker")
        }));
    assert!(
        path.is_absolute() && path.is_file(),
        "{variable} must name an existing absolute executable"
    );
    path
}

fn previous_command(profile: &Profile, executable: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .arg("--backup-worker")
        .arg("--data-dir")
        .arg(&profile.data)
        .arg("--config-dir")
        .arg(&profile.config);
    hide(&mut command);
    command
}

struct PreparedUpdate {
    profile: Profile,
    _worker: Parent,
    _desktop: std::fs::File,
    preparation: UpdatePreparation,
    download: String,
}

async fn prepared_update() -> PreparedUpdate {
    let profile = Profile::new().await;
    let desktop = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(profile.data.join("database-backups/desktop.lock"))
        .unwrap();
    desktop.lock_shared().unwrap();
    for plan in profile.snapshot()["schedules"].as_array().unwrap() {
        profile
            .state
            .queue_backup(plan["id"].as_str().unwrap())
            .await
            .unwrap();
    }
    let executable = profile.directory.path().join(if cfg!(windows) {
        "update-fixture-worker.exe"
    } else {
        "update-fixture-worker"
    });
    let source = if std::env::var_os("OXIDE_BACKUP_PREVIOUS_WORKER").is_some() {
        previous_worker("OXIDE_BACKUP_PREVIOUS_WORKER")
    } else {
        PathBuf::from(env!("CARGO_BIN_EXE_oxide-studio"))
    };
    std::fs::copy(source, &executable).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let mut blocker = SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(profile.directory.path().join("source.sqlite")),
    )
    .await
    .unwrap();
    sqlx::query("BEGIN EXCLUSIVE")
        .execute(&mut blocker)
        .await
        .unwrap();
    let mut worker = Parent(previous_command(&profile, &executable).spawn().unwrap());
    profile
        .wait_for(|p| {
            p.snapshot()["runs"]
                .as_array()
                .unwrap()
                .iter()
                .any(|run| run["status"] == "running")
        })
        .await;
    let mut version = semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
    version.patch += 1;
    let download = uuid::Uuid::new_v4().to_string();
    let mut preparation = profile
        .state
        .prepare_update(&version.to_string(), "integration", &download)
        .await
        .unwrap();
    assert!(!preparation.ready);
    assert!(worker.0.try_wait().unwrap().is_none());
    assert_eq!(
        profile.snapshot()["runs"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|run| run["status"] == "queued")
            .count(),
        1
    );
    let refused = install_prepared(
        &profile.state,
        &preparation.token,
        "integration",
        &download,
        || panic!("installer must never start while the copy is active"),
    )
    .await
    .unwrap_err();
    assert!(refused.contains("Wait"));
    preparation = profile
        .state
        .prepare_update(&version.to_string(), "integration", &download)
        .await
        .unwrap();
    assert!(!preparation.ready);
    sqlx::query("COMMIT").execute(&mut blocker).await.unwrap();
    blocker.close().await.unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    while !preparation.ready {
        assert!(
            Instant::now() < deadline,
            "update preparation did not observe worker exit"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
        preparation = profile
            .state
            .poll_update_preparation(&preparation.token, "integration", &download)
            .await
            .unwrap();
    }
    assert!(
        worker.0.try_wait().unwrap().is_some(),
        "worker.lock alone must not allow installation"
    );
    assert!(!profile.snapshot()["backgroundEnabled"].as_bool().unwrap());
    assert_eq!(
        profile.snapshot()["runs"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|run| run["status"] == "success")
            .count(),
        1
    );
    assert_eq!(
        profile.snapshot()["runs"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|run| run["status"] == "queued")
            .count(),
        1
    );
    PreparedUpdate {
        profile,
        _worker: worker,
        _desktop: desktop,
        preparation,
        download,
    }
}

#[tokio::test]
#[ignore = "run in isolation: observes all application processes mapped to the fixture executable"]
async fn update_preparation_waits_for_process_exit_and_failed_installer_resumes_queue() {
    let prepared = prepared_update().await;
    let before = prepared.profile.snapshot();
    let error = install_prepared(
        &prepared.profile.state,
        &prepared.preparation.token,
        "integration",
        &prepared.download,
        || Err("fixture installer launch failed".to_string()),
    )
    .await
    .unwrap_err();
    assert!(error.contains("scheduling has resumed"));
    assert_eq!(prepared.profile.snapshot(), before);
    assert_eq!(
        prepared
            .profile
            .state
            .update_installation_status()
            .await
            .unwrap()
            .phase,
        "idle"
    );
    let mut resumed = Parent(
        prepared
            .profile
            .command(true)
            .arg("--activate")
            .spawn()
            .unwrap(),
    );
    wait_child(&mut resumed.0);
    assert_eq!(
        prepared.profile.snapshot()["runs"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    for run in prepared.profile.snapshot()["runs"].as_array().unwrap() {
        assert_eq!(run["status"], "success");
        let mut db = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(run["filePath"].as_str().unwrap())
                .read_only(true),
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT id FROM sample")
                .fetch_one(&mut db)
                .await
                .unwrap(),
            42
        );
        db.close().await.unwrap();
    }
}

#[tokio::test]
#[ignore = "cross-version native installer adapter fixture; invoked by test-backup-worker-upgrade.mjs"]
async fn update_installer_commit_fixture() {
    let marker = PathBuf::from(
        std::env::var_os("OXIDE_UPDATE_INSTALL_FIXTURE").expect("private update fixture marker"),
    );
    assert!(marker.is_absolute());
    let prepared = prepared_update().await;
    install_prepared(
        &prepared.profile.state,
        &prepared.preparation.token,
        "integration",
        &prepared.download,
        || Ok(()),
    )
    .await
    .unwrap();
    let status = prepared
        .profile
        .state
        .update_installation_status()
        .await
        .unwrap();
    assert_eq!(status.phase, "restartRequired");
    assert!(!status.recovery_required);
    assert!(prepared
        .profile
        .state
        .cancel_update_preparation(
            &prepared.preparation.token,
            "integration",
            &prepared.download
        )
        .await
        .is_err());
    let control: Value = serde_json::from_slice(
        &std::fs::read(
            prepared
                .profile
                .data
                .join("database-backups/worker-control.json"),
        )
        .unwrap(),
    )
    .unwrap();
    std::fs::write(&marker, serde_json::to_vec_pretty(&serde_json::json!({
        "data": prepared.profile.data, "config": prepared.profile.config,
        "targetVersion": control["installation"]["targetVersion"], "installationId": prepared.preparation.token,
    })).unwrap()).unwrap();
    // The isolated test process exits next. Keep its profile and persisted
    // installation barrier for the genuinely newer process built by the helper.
    std::mem::forget(prepared);
}

#[tokio::test]
#[ignore = "requires a committed profile from the actual previous package version"]
async fn updated_worker_resumes_committed_installation_only_after_actual_version_changes() {
    let marker = PathBuf::from(
        std::env::var_os("OXIDE_UPDATE_INSTALL_FIXTURE").expect("private update fixture marker"),
    );
    let fixture: Value = serde_json::from_slice(&std::fs::read(marker).unwrap()).unwrap();
    assert_eq!(fixture["targetVersion"], env!("CARGO_PKG_VERSION"));
    let data = PathBuf::from(fixture["data"].as_str().unwrap());
    let config = PathBuf::from(fixture["config"].as_str().unwrap());
    let state = SqliteBackupScheduleState::open_existing_profile(&data, &config).unwrap();
    assert!(
        state
            .update_installation_status()
            .await
            .unwrap()
            .recovery_required
    );
    let desktop = OpenOptions::new()
        .read(true)
        .write(true)
        .open(data.join("database-backups/desktop.lock"))
        .unwrap();
    desktop.lock_shared().unwrap();
    let mut current = Command::new(env!("CARGO_BIN_EXE_oxide-studio"));
    current
        .args(["--backup-worker", "--activate", "--once", "--data-dir"])
        .arg(&data)
        .arg("--config-dir")
        .arg(&config);
    hide(&mut current);
    let mut child = Parent(current.spawn().unwrap());
    wait_child(&mut child.0);
    assert_eq!(
        state.update_installation_status().await.unwrap().phase,
        "idle"
    );
    let snapshot: Value = serde_json::from_slice(
        &std::fs::read(data.join("database-backups/sqlite-schedules.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(snapshot["runs"].as_array().unwrap().len(), 2);
    assert!(snapshot["runs"]
        .as_array()
        .unwrap()
        .iter()
        .all(|run| run["status"] == "success"));
    assert_eq!(snapshot["backgroundEnabled"], false);
}

#[tokio::test]
#[ignore = "requires a real previous cooperative worker; CI builds two package versions explicitly"]
async fn cooperative_worker_upgrade_finishes_current_copy_before_successor_claims_queue() {
    let previous = previous_worker("OXIDE_BACKUP_PREVIOUS_WORKER");
    let profile = Profile::new().await;
    profile.edit(|value| value["backgroundEnabled"] = true.into());
    for plan in profile.snapshot()["schedules"].as_array().unwrap() {
        profile
            .state
            .queue_backup(plan["id"].as_str().unwrap())
            .await
            .unwrap();
    }
    let source = profile.directory.path().join("source.sqlite");
    let mut blocker =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&source))
            .await
            .unwrap();
    sqlx::query("BEGIN EXCLUSIVE")
        .execute(&mut blocker)
        .await
        .unwrap();
    let mut old = Parent(previous_command(&profile, &previous).spawn().unwrap());
    profile
        .wait_for(|p| {
            p.snapshot()["runs"]
                .as_array()
                .unwrap()
                .iter()
                .any(|run| run["status"] == "running")
        })
        .await;
    let old_control: Value = serde_json::from_slice(
        &std::fs::read(profile.data.join("database-backups/worker-control.json")).unwrap(),
    )
    .unwrap();
    let old_build = old_control["active"]["image"]["buildId"]
        .as_str()
        .unwrap()
        .to_string();
    let old_instance = old_control["active"]["instanceId"].clone();
    let initial = profile.snapshot();
    let active_id = initial["runs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|run| run["status"] == "running")
        .unwrap()["id"]
        .clone();
    let queued_id = initial["runs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|run| run["status"] == "queued")
        .unwrap()["id"]
        .clone();
    let mut successor = Parent(profile.command(true).arg("--activate").spawn().unwrap());
    profile
        .wait_for(|p| {
            let Ok(bytes) = std::fs::read(p.data.join("database-backups/worker-control.json"))
            else {
                return false;
            };
            let Ok(control) = serde_json::from_slice::<Value>(&bytes) else {
                return false;
            };
            control["pending"]["image"]["buildId"]
                .as_str()
                .is_some_and(|build| build != old_build)
        })
        .await;
    let upgrading = profile.snapshot();
    assert_eq!(
        upgrading["runs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|run| run["id"] == active_id)
            .unwrap()["status"],
        "running"
    );
    assert_eq!(
        upgrading["runs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|run| run["id"] == queued_id)
            .unwrap()["status"],
        "queued"
    );
    assert!(
        old.0.try_wait().unwrap().is_none(),
        "the old process was terminated during its active copy"
    );
    let active_control: Value = serde_json::from_slice(
        &std::fs::read(profile.data.join("database-backups/worker-control.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(active_control["active"]["instanceId"], old_instance);
    sqlx::query("COMMIT").execute(&mut blocker).await.unwrap();
    blocker.close().await.unwrap();
    wait_child(&mut old.0);
    wait_child(&mut successor.0);
    let final_state = profile.snapshot();
    assert_eq!(final_state["runs"].as_array().unwrap().len(), 2);
    for run in final_state["runs"].as_array().unwrap() {
        assert_eq!(run["status"], "success", "{run}");
        let mut db = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(run["filePath"].as_str().unwrap())
                .read_only(true),
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT id FROM sample")
                .fetch_one(&mut db)
                .await
                .unwrap(),
            42
        );
        db.close().await.unwrap();
    }
    let final_control: Value = serde_json::from_slice(
        &std::fs::read(profile.data.join("database-backups/worker-control.json")).unwrap(),
    )
    .unwrap();
    assert_ne!(final_control["active"]["image"]["buildId"], old_build);
    assert_eq!(
        final_control["active"]["image"],
        final_control["target"]["image"]
    );
    let rejected = previous_command(&profile, &previous)
        .args(["--activate", "--once"])
        .status()
        .unwrap();
    assert!(!rejected.success(), "a retired build took the worker back");
    let mut again = profile.command(true).spawn().unwrap();
    wait_child(&mut again);
    assert_eq!(profile.snapshot()["runs"].as_array().unwrap().len(), 2);
}

#[tokio::test]
#[ignore = "requires an actual worker from before the handoff protocol"]
async fn legacy_worker_is_left_running_and_new_writes_wait_for_its_shutdown() {
    let previous = previous_worker("OXIDE_BACKUP_LEGACY_WORKER");
    let profile = Profile::new().await;
    profile.edit(|value| value["backgroundEnabled"] = true.into());
    profile.queue_first().await;
    let mut old = Parent(previous_command(&profile, &previous).spawn().unwrap());
    profile
        .wait_for(|p| p.snapshot()["runs"][0]["status"] == "success")
        .await;
    let original_schedules = profile.snapshot()["schedules"].clone();
    let original = profile.snapshot()["schedules"][0].clone();
    let request: SaveSqliteBackupScheduleRequest = serde_json::from_value(original).unwrap();
    assert!(profile
        .state
        .save_schedule(request)
        .await
        .unwrap_err()
        .contains("previous OxideStudio"));
    let attempt = profile.command(true).arg("--activate").status().unwrap();
    assert!(!attempt.success());
    assert!(
        old.0.try_wait().unwrap().is_none(),
        "a legacy worker was killed by the new build"
    );
    assert_eq!(profile.snapshot()["schedules"], original_schedules);
    profile.edit(|value| value["backgroundEnabled"] = false.into());
    wait_child(&mut old.0);
    profile.edit(|value| value["backgroundEnabled"] = true.into());
    let mut current = profile.command(true).arg("--activate").spawn().unwrap();
    wait_child(&mut current);
    assert_eq!(profile.snapshot()["runs"].as_array().unwrap().len(), 1);
}
