#[cfg(test)]
#[allow(unused_imports)]
use crate::core::private_file::{
    create_private_directory, create_private_file, restrict_sqlite_database_permissions,
};
#[cfg(test)]
#[allow(unused_imports)]
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
#[cfg(test)]
#[allow(unused_imports)]
use anyhow::{anyhow, Context, Result};
#[cfg(test)]
#[allow(unused_imports)]
use hmac::{Hmac, Mac};
#[cfg(test)]
#[allow(unused_imports)]
use rand::{rngs::OsRng, RngCore};
#[cfg(test)]
#[allow(unused_imports)]
use serde::{Deserialize, Serialize};
#[cfg(test)]
#[allow(unused_imports)]
use sha2::Sha256;
#[cfg(test)]
#[allow(unused_imports)]
use sqlx::{sqlite::SqlitePoolOptions, Pool, Row, Sqlite};
#[cfg(test)]
#[allow(unused_imports)]
use std::path::Path;
#[cfg(all(test, feature = "desktop"))]
#[allow(unused_imports)]
use tauri::{AppHandle, Manager};
#[cfg(test)]
#[allow(unused_imports)]
use zeroize::{Zeroize, Zeroizing};

mod assistant;
mod assistant_validation;
mod cache;
mod cache_policy;
mod connections;
mod credential_crypto;
mod history;
mod migrations;
mod models;
mod projects;
mod resources;
mod saved_sql;
mod setup;
mod telemetry;

pub use credential_crypto::restore_read_only_connection_credentials;
pub use models::{
    AssistantTaskCheckpoint, AssistantTaskCompletedStep, AssistantTaskContextBinding,
    AssistantTaskExecutionReceipt, AssistantTaskPlanStep, AssistantTaskRecord,
    DriverRuntimeEventKind, DriverRuntimeTelemetryRecord, MetaStore, Project, QueryHistoryItem,
    Resource, SavedConnection, SavedSqlFile, SavedSqlFolder, SavedSqlLibrary,
};

#[cfg(test)]
#[allow(unused_imports)]
use assistant::*;
#[cfg(test)]
#[allow(unused_imports)]
use assistant_validation::*;
#[cfg(test)]
#[allow(unused_imports)]
use cache::*;
#[cfg(test)]
#[allow(unused_imports)]
use cache_policy::*;
#[cfg(test)]
#[allow(unused_imports)]
use connections::*;
#[cfg(test)]
#[allow(unused_imports)]
use credential_crypto::*;
#[cfg(test)]
#[allow(unused_imports)]
use history::*;
#[cfg(test)]
#[allow(unused_imports)]
use migrations::*;
#[cfg(test)]
#[allow(unused_imports)]
use models::*;
#[cfg(test)]
#[allow(unused_imports)]
use projects::*;
#[cfg(test)]
#[allow(unused_imports)]
use resources::*;
#[cfg(test)]
#[allow(unused_imports)]
use saved_sql::*;
#[cfg(test)]
#[allow(unused_imports)]
use setup::*;
#[cfg(test)]
#[allow(unused_imports)]
use telemetry::*;

#[cfg(test)]
mod tests;
