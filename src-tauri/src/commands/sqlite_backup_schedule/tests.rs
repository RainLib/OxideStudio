use super::*;
use crate::core::driver::LocalDatabaseBackupControl;
use chrono::{DateTime, Utc};
use std::io::Read;
use std::path::{Path, PathBuf};

fn schedule(directory: &Path) -> SqliteBackupSchedule {
    SqliteBackupSchedule {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Nightly / app".to_string(),
        project_id: "project-1".to_string(),
        connection_id: "sqlite-1".to_string(),
        destination_directory: directory.to_string_lossy().into_owned(),
        destination_identity: destination_identity_for_path(directory),
        frequency: SqliteBackupScheduleFrequency::Hourly,
        interval_hours: 6,
        time_of_day: "02:00".to_string(),
        weekday: 1,
        retention_count: 2,
        compression: SqliteBackupCompression::None,
        enabled: true,
        created_at: "2026-08-31T00:00:00Z".to_string(),
        updated_at: "2026-08-31T00:00:00Z".to_string(),
        next_run_at: "2026-08-31T06:00:00Z".to_string(),
        last_run_at: None,
        last_run_status: None,
    }
}

#[test]
fn validates_schedule_bounds_and_local_time() {
    assert_eq!(validate_time_of_day("23:59").unwrap(), "23:59");
    assert!(validate_time_of_day("24:00").is_err());
    assert!(validate_time_of_day("2:00").is_err());
    assert!(validate_schedule_name("").is_err());
    assert!(validate_identity("bad\nvalue", "identity").is_err());
}

#[test]
fn legacy_schedule_requests_default_to_uncompressed() {
    let request: SaveSqliteBackupScheduleRequest = serde_json::from_value(serde_json::json!({
        "name": "Legacy",
        "projectId": "project-1",
        "connectionId": "sqlite-1",
        "destinationDirectory": "C:/backups",
        "frequency": "daily",
        "intervalHours": 24,
        "timeOfDay": "02:00",
        "weekday": 1,
        "retentionCount": 7,
        "enabled": true
    }))
    .unwrap();

    assert_eq!(request.compression, SqliteBackupCompression::None);
}

#[test]
fn destination_identity_is_host_recorded_and_legacy_state_requires_review() {
    let directory = tempfile::tempdir().unwrap();
    let current = require_destination_identity(directory.path()).unwrap();
    assert!(verify_destination_identity(Some(&current), Some(&current)).is_ok());

    let different = match current.clone() {
        SqliteBackupDestinationIdentity::Device(value) => {
            SqliteBackupDestinationIdentity::Device(value.wrapping_add(1))
        }
        SqliteBackupDestinationIdentity::PersistentVolumeUuid(mut value) => {
            value[0] ^= 0xff;
            SqliteBackupDestinationIdentity::PersistentVolumeUuid(value)
        }
    };
    assert!(verify_destination_identity(Some(&current), Some(&different)).is_err());
    assert!(verify_destination_identity(Some(&current), None).is_err());
    assert!(verify_destination_identity(None, Some(&current))
        .unwrap_err()
        .contains("older Oxide"));

    let persisted = serde_json::to_value(schedule(directory.path())).unwrap();
    assert!(persisted.get("destinationIdentity").is_some());

    let mut legacy = persisted;
    legacy
        .as_object_mut()
        .unwrap()
        .remove("destinationIdentity");
    let legacy: SqliteBackupSchedule = serde_json::from_value(legacy).unwrap();
    assert!(legacy.destination_identity.is_none());
}

#[cfg(any(unix, windows))]
#[test]
fn destination_path_and_open_file_report_the_same_filesystem() {
    let directory = tempfile::tempdir().unwrap();
    let path_identity = require_destination_identity(directory.path()).unwrap();
    let file_path = directory.path().join("identity-probe");
    let file = std::fs::File::create(&file_path).unwrap();
    let file_identity = destination_identity_for_file(&file).unwrap();
    assert_eq!(path_identity, file_identity);
}

#[test]
fn hourly_next_run_and_filename_are_deterministic_and_bounded() {
    let directory = tempfile::tempdir().unwrap();
    let schedule = schedule(directory.path());
    let now = DateTime::parse_from_rfc3339("2026-08-31T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    assert_eq!(
        schedule_next_run(&schedule, now).to_rfc3339(),
        "2026-08-31T06:00:00+00:00"
    );
    assert!(!schedule_is_due(&schedule, now));
    assert!(schedule_is_due(
        &schedule,
        DateTime::parse_from_rfc3339("2026-08-31T06:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    ));
    let mut disabled = schedule.clone();
    disabled.enabled = false;
    assert!(!schedule_is_due(
        &disabled,
        DateTime::parse_from_rfc3339("2026-09-01T06:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    ));
    let path = backup_file_path(&schedule, "12345678-1234-1234-1234-123456789abc", now);
    assert_eq!(
        path.file_name().and_then(|name| name.to_str()),
        Some("oxide-sqlite-backup__Nightly _ app__20260831-000000__12345678.sqlite")
    );
}

#[test]
fn retention_file_guard_rejects_other_directories_and_symlinks_by_name() {
    let directory = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let schedule = schedule(directory.path());
    let mut run = SqliteBackupRun {
        id: "run-1".to_string(),
        schedule_id: schedule.id.clone(),
        schedule_name: schedule.name.clone(),
        project_id: schedule.project_id.clone(),
        connection_id: schedule.connection_id.clone(),
        destination_directory: schedule.destination_directory.clone(),
        compression: SqliteBackupCompression::None,
        trigger: SqliteBackupRunTrigger::Manual,
        status: SqliteBackupRunStatus::Success,
        started_at: "2026-08-31T00:00:00Z".to_string(),
        completed_at: Some("2026-08-31T00:01:00Z".to_string()),
        file_path: Some(
            directory
                .path()
                .join("oxide-sqlite-backup__safe.sqlite")
                .to_string_lossy()
                .into_owned(),
        ),
        byte_len: Some(1),
        integrity_check: Some("ok".to_string()),
        progress_percent: 100,
        error: None,
    };
    assert_eq!(
        safe_run_file(&run),
        run.file_path.as_deref().map(PathBuf::from)
    );
    run.file_path = Some(
        other
            .path()
            .join("oxide-sqlite-backup__safe.sqlite")
            .to_string_lossy()
            .into_owned(),
    );
    assert!(safe_run_file(&run).is_none());
    run.file_path = Some(
        directory
            .path()
            .join("personal.sqlite")
            .to_string_lossy()
            .into_owned(),
    );
    assert!(safe_run_file(&run).is_none());
}

#[test]
fn gzip_backup_is_published_with_round_trip_content_and_safe_retention_path() {
    use flate2::read::GzDecoder;

    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("oxide-sqlite-backup__safe.sqlite");
    let payload = b"SQLite format 3\0fixture payload".repeat(4_096);
    std::fs::write(&source, &payload).unwrap();
    let control = LocalDatabaseBackupControl::default();
    let receipt = compress_backup_file(&source, &control, "ok").unwrap();
    let compressed = compressed_backup_file_path(&source);

    assert!(!source.exists());
    assert!(compressed.is_file());
    assert_eq!(
        receipt.byte_len,
        std::fs::metadata(&compressed).unwrap().len()
    );
    assert!(receipt.integrity_check.contains("gzip stream finalized"));
    assert_eq!(control.progress_percent(), 100);

    let mut decoded = Vec::new();
    GzDecoder::new(std::fs::File::open(&compressed).unwrap())
        .read_to_end(&mut decoded)
        .unwrap();
    assert_eq!(decoded, payload);

    let schedule = schedule(directory.path());
    let run = SqliteBackupRun {
        id: "run-gzip".to_string(),
        schedule_id: schedule.id,
        schedule_name: schedule.name,
        project_id: schedule.project_id,
        connection_id: schedule.connection_id,
        destination_directory: schedule.destination_directory,
        compression: SqliteBackupCompression::Gzip,
        trigger: SqliteBackupRunTrigger::Manual,
        status: SqliteBackupRunStatus::Success,
        started_at: "2026-08-31T00:00:00Z".to_string(),
        completed_at: Some("2026-08-31T00:01:00Z".to_string()),
        file_path: Some(compressed.to_string_lossy().into_owned()),
        byte_len: Some(receipt.byte_len),
        integrity_check: Some(receipt.integrity_check),
        progress_percent: 100,
        error: None,
    };
    assert_eq!(safe_run_file(&run), Some(compressed.clone()));
    delete_safe_run_file(&run).unwrap();
    assert!(!compressed.exists());
}

#[test]
fn control_is_bounded_and_cancellable() {
    let control = LocalDatabaseBackupControl::default();
    control.set_progress_percent(250);
    assert_eq!(control.progress_percent(), 100);
    assert!(!control.is_cancelled());
    control.cancel();
    assert!(control.is_cancelled());
}
