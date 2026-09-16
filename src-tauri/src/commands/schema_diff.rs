#[cfg(test)]
#[allow(unused_imports)]
use crate::commands::database_admin::events::{
    create_event_sql, CreateDatabaseAdminEvent, DatabaseAdminEventIntervalUnit,
    DatabaseAdminEventSchedule,
};
#[cfg(test)]
#[allow(unused_imports)]
use crate::core::{
    dialect::{canonical_driver_name, database_spec_for_driver},
    manager::ConnectionManager,
    protocol::{ParameterizedStatement, QueryResult, Response},
    schema_diff::{
        compare_schema_snapshots as build_schema_diff, finalize_schema_snapshot, SchemaChange,
        SchemaChangeKind, SchemaChangePhase, SchemaChangeRisk, SchemaDiffExecutionOwner,
        SchemaDiffPlan, SchemaDiffSummary, SchemaObjectSnapshot, SchemaPreflightAssertion,
        SchemaPreflightCheck, SchemaRelationSnapshot, SchemaRoutineSnapshot,
        SchemaSequenceOwnerSnapshot, SchemaSnapshot, SCHEMA_SNAPSHOT_VERSION,
    },
    store::{MetaStore, Resource},
};
#[cfg(test)]
#[allow(unused_imports)]
use oxide_driver_protocol::{
    SchemaMigrationApplyRequest as DriverMigrationApplyRequest,
    SchemaMigrationApplyStatus as DriverMigrationApplyStatus, SchemaMigrationMode,
    SchemaMigrationPlanRequest as DriverMigrationPlanRequest,
    SchemaMigrationPlanResult as DriverMigrationPlanResult,
    SchemaMigrationPreflightRequest as DriverMigrationPreflightRequest,
    SchemaMigrationVerifyRequest as DriverMigrationVerifyRequest, SemanticSchemaSnapshot,
};
#[cfg(test)]
#[allow(unused_imports)]
use serde::{Deserialize, Serialize};
#[cfg(test)]
#[allow(unused_imports)]
use sha2::{Digest, Sha256};
#[cfg(test)]
#[allow(unused_imports)]
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime},
};
#[cfg(test)]
#[allow(unused_imports)]
use tauri::{AppHandle, Manager, State};
#[cfg(test)]
#[allow(unused_imports)]
use tokio::{sync::Semaphore, task::JoinSet};

mod capture;
mod capture_identity;
mod compare;
mod constants;
mod execute;
mod execution_model;
mod external_execute;
mod external_plan;
mod journal;
mod journal_model;
mod mysql_catalog;
mod pg_dependencies;
mod pg_routine;
mod pg_sequence;
mod preflight;
mod rollback;
mod semantic;
mod session;
mod timestamp;
mod view_capture;

pub(crate) use capture::capture_schema_snapshot_inner;
pub use capture::*;
pub use compare::*;
pub use execute::*;
pub use execution_model::{ExecuteSchemaMigrationRequest, SchemaMigrationStatus};
pub use journal::*;
pub use journal_model::{
    SchemaMigrationJournalEntry, SchemaMigrationPreflightResult, SchemaMigrationPreflightStatus,
    SchemaMigrationVerification, SchemaRollbackArtifact,
};
pub use session::ExternalSchemaMigrationSessionState;

#[cfg(test)]
#[allow(unused_imports)]
use capture::*;
#[cfg(test)]
#[allow(unused_imports)]
use capture_identity::*;
#[cfg(test)]
#[allow(unused_imports)]
use compare::*;
#[cfg(test)]
#[allow(unused_imports)]
use constants::*;
#[cfg(test)]
#[allow(unused_imports)]
use execute::*;
#[cfg(test)]
#[allow(unused_imports)]
use execution_model::*;
#[cfg(test)]
#[allow(unused_imports)]
use external_execute::*;
#[cfg(test)]
#[allow(unused_imports)]
use external_plan::*;
#[cfg(test)]
#[allow(unused_imports)]
use journal::*;
#[cfg(test)]
#[allow(unused_imports)]
use journal_model::*;
#[cfg(test)]
#[allow(unused_imports)]
use mysql_catalog::*;
#[cfg(test)]
#[allow(unused_imports)]
use pg_dependencies::*;
#[cfg(test)]
#[allow(unused_imports)]
use pg_routine::*;
#[cfg(test)]
#[allow(unused_imports)]
use pg_sequence::*;
#[cfg(test)]
#[allow(unused_imports)]
use preflight::*;
#[cfg(test)]
#[allow(unused_imports)]
use rollback::*;
#[cfg(test)]
#[allow(unused_imports)]
use semantic::*;
#[cfg(test)]
#[allow(unused_imports)]
use session::*;
#[cfg(test)]
#[allow(unused_imports)]
use timestamp::*;
#[cfg(test)]
#[allow(unused_imports)]
use view_capture::*;

#[cfg(test)]
mod tests;
