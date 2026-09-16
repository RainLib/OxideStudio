use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

pub(super) const SNAPSHOT_METADATA_CONCURRENCY: usize = 6;
pub(super) const MIGRATION_JOURNAL_PARENT_ID: &str = "schema-migration-journal-v1";
pub(super) const MIGRATION_JOURNAL_KIND: &str = "SCHEMA_MIGRATION_JOURNAL";
pub(super) const OFFLINE_PROJECT_DDL_REVIEW_WARNING: &str = "OFFLINE_PROJECT_DDL_REVIEW_ONLY";
pub(super) const OFFLINE_DBML_REVIEW_WARNING: &str = "OFFLINE_DBML_REVIEW_ONLY";
pub(super) const OFFLINE_METADATA_REVIEW_WARNING: &str = "OFFLINE_METADATA_JSON_REVIEW_ONLY";
pub(super) const OFFLINE_DIAGRAM_DRAFT_REVIEW_WARNING: &str = "OFFLINE_DIAGRAM_DRAFT_REVIEW_ONLY";
pub(super) const OFFLINE_REVIEW_WARNINGS: [&str; 4] = [
    OFFLINE_PROJECT_DDL_REVIEW_WARNING,
    OFFLINE_DBML_REVIEW_WARNING,
    OFFLINE_METADATA_REVIEW_WARNING,
    OFFLINE_DIAGRAM_DRAFT_REVIEW_WARNING,
];
pub(super) const EXTERNAL_MIGRATION_SESSION_TTL: Duration = Duration::from_secs(15 * 60);
pub(super) const MAX_EXTERNAL_MIGRATION_SESSIONS: usize = 64;
pub(super) static ACTIVE_MIGRATION_JOURNALS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
