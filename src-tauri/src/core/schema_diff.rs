#[cfg(test)]
#[allow(unused_imports)]
use crate::commands::table::{
    rewrite_sqlite_create_index_for_transfer, rewrite_sqlite_create_table_for_transfer,
    rewrite_sqlite_create_trigger_for_transfer, rewrite_sqlite_create_view_for_transfer,
};
#[cfg(test)]
#[allow(unused_imports)]
use crate::core::{
    dialect::{database_spec_for_driver, DatabaseKind},
    protocol::{
        ColumnInfo, ConstraintInfo, FunctionInfo, FunctionParameterInfo, IndexInfo,
        SchemaObjectInfo,
    },
    statement::{split_sql_statements, StatementScanDialect},
};
#[cfg(test)]
#[allow(unused_imports)]
use anyhow::{anyhow, Result};
#[cfg(test)]
#[allow(unused_imports)]
use serde::{Deserialize, Serialize};
#[cfg(test)]
#[allow(unused_imports)]
use sha2::{Digest, Sha256};
#[cfg(test)]
#[allow(unused_imports)]
use std::{
    collections::{BTreeMap, BTreeSet},
    str::FromStr,
};

mod comments;
mod compare;
mod conversion;
mod ddl;
mod metadata;
mod metadata_children;
mod objects;
mod plan_model;
mod plan_order;
mod postgres_refs;
mod preflight;
mod relations;
mod render;
mod routines;
mod snapshot;
mod sqlite;
mod types;

pub use compare::compare_schema_snapshots;
pub(crate) use ddl::{add_constraint_sql, create_index_sql};
pub use snapshot::finalize_schema_snapshot;
pub use types::{
    SchemaChange, SchemaChangeKind, SchemaChangePhase, SchemaChangeRisk,
    SchemaConversionCompatibility, SchemaConversionFeatureKind, SchemaConversionIssue,
    SchemaDiffExecutionOwner, SchemaDiffPlan, SchemaDiffSummary, SchemaObjectSnapshot,
    SchemaPreflightAssertion, SchemaPreflightCheck, SchemaRelationSnapshot, SchemaRoutineSnapshot,
    SchemaSequenceOwnerSnapshot, SchemaSnapshot, SCHEMA_SNAPSHOT_VERSION,
};

#[cfg(test)]
#[allow(unused_imports)]
use comments::*;
#[cfg(test)]
#[allow(unused_imports)]
use compare::*;
#[cfg(test)]
#[allow(unused_imports)]
use conversion::*;
#[cfg(test)]
#[allow(unused_imports)]
use ddl::*;
#[cfg(test)]
#[allow(unused_imports)]
use metadata::*;
#[cfg(test)]
#[allow(unused_imports)]
use metadata_children::*;
#[cfg(test)]
#[allow(unused_imports)]
use objects::*;
#[cfg(test)]
#[allow(unused_imports)]
use plan_model::*;
#[cfg(test)]
#[allow(unused_imports)]
use plan_order::*;
#[cfg(test)]
#[allow(unused_imports)]
use postgres_refs::*;
#[cfg(test)]
#[allow(unused_imports)]
use preflight::*;
#[cfg(test)]
#[allow(unused_imports)]
use relations::*;
#[cfg(test)]
#[allow(unused_imports)]
use render::*;
#[cfg(test)]
#[allow(unused_imports)]
use routines::*;
#[cfg(test)]
#[allow(unused_imports)]
use snapshot::*;
#[cfg(test)]
#[allow(unused_imports)]
use sqlite::*;
#[cfg(test)]
#[allow(unused_imports)]
use types::SchemaNameMapping;
#[cfg(test)]
#[allow(unused_imports)]
use types::*;

#[cfg(test)]
mod tests;
