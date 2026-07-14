use crate::core::{
    dialect::DatabaseKind,
    manager::ConnectionManager,
    protocol::Response,
    schema_diff::{
        compare_schema_snapshots as build_schema_diff, finalize_schema_snapshot, SchemaDiffPlan,
        SchemaRelationSnapshot, SchemaSnapshot, SCHEMA_SNAPSHOT_VERSION,
    },
};
use std::{str::FromStr, sync::Arc, time::SystemTime};
use tauri::State;
use tokio::{sync::Semaphore, task::JoinSet};

const SNAPSHOT_METADATA_CONCURRENCY: usize = 6;

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn capture_schema_snapshot(
    manager: State<'_, ConnectionManager>,
    project_id: String,
    connection_id: String,
    connection_name: String,
    driver: String,
    database: Option<String>,
    schema: String,
) -> Result<Response<SchemaSnapshot>, String> {
    let context = serde_json::json!({
        "projectId": project_id,
        "connectionId": connection_id,
        "driver": driver,
        "database": database,
        "schema": schema,
    });
    let result: Result<SchemaSnapshot, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|error| error.to_string())?;
        if !kind.capabilities().supports_table_browsing {
            return Err(format!(
                "{} does not expose relational schema snapshots",
                kind.display_name()
            ));
        }
        let schema = schema.trim();
        if schema.is_empty() {
            return Err("Schema name is required".to_string());
        }
        let database = database.as_deref();
        let tables = match database {
            Some(database) => {
                manager
                    .get_database_tables(&connection_id, database, schema)
                    .await
            }
            None => manager.get_tables(&connection_id, schema).await,
        }
        .map_err(|error| error.to_string())?;

        let manager = manager.inner().clone();
        let concurrency = Arc::new(Semaphore::new(SNAPSHOT_METADATA_CONCURRENCY));
        let mut captures = JoinSet::new();
        for table in tables {
            let manager = manager.clone();
            let concurrency = Arc::clone(&concurrency);
            let connection_id = connection_id.clone();
            let database = database.map(ToString::to_string);
            let schema = schema.to_string();
            let relation_name = table.name;
            let object_type = table.table_type;
            captures.spawn(async move {
                let _permit = concurrency
                    .acquire_owned()
                    .await
                    .map_err(|_| "Schema snapshot concurrency gate closed".to_string())?;
                let metadata = match database.as_deref() {
                    Some(database) => tokio::try_join!(
                        manager.get_database_columns(
                            &connection_id,
                            database,
                            &schema,
                            &relation_name
                        ),
                        manager.get_database_indexes(
                            &connection_id,
                            database,
                            &schema,
                            &relation_name
                        ),
                        manager.get_database_constraints(
                            &connection_id,
                            database,
                            &schema,
                            &relation_name
                        ),
                    ),
                    None => tokio::try_join!(
                        manager.get_columns(&connection_id, &schema, &relation_name),
                        manager.get_indexes(&connection_id, &schema, &relation_name),
                        manager.get_constraints(&connection_id, &schema, &relation_name),
                    ),
                }
                .map_err(|error| {
                    format!("Failed to capture metadata for {schema}.{relation_name}: {error}")
                })?;

                Ok::<_, String>(SchemaRelationSnapshot {
                    name: relation_name,
                    object_type,
                    columns: metadata.0,
                    indexes: metadata.1,
                    constraints: metadata.2,
                })
            });
        }

        let mut relations = Vec::with_capacity(captures.len());
        while let Some(capture) = captures.join_next().await {
            match capture {
                Ok(Ok(relation)) => relations.push(relation),
                Ok(Err(error)) => {
                    captures.abort_all();
                    return Err(error);
                }
                Err(error) => {
                    captures.abort_all();
                    return Err(format!("Schema snapshot task failed: {error}"));
                }
            }
        }

        finalize_schema_snapshot(SchemaSnapshot {
            version: SCHEMA_SNAPSHOT_VERSION,
            id: String::new(),
            fingerprint: String::new(),
            project_id,
            connection_id,
            connection_name,
            driver: kind.as_str().to_string(),
            database_name: database.map(ToString::to_string),
            schema_name: schema.to_string(),
            captured_at: current_timestamp_millis(),
            relations,
            warnings: Vec::new(),
        })
        .map_err(|error| error.to_string())
    }
    .await;

    match result {
        Ok(snapshot) => Ok(Response::ok(snapshot)),
        Err(error) => Ok(Response::err_with_details(
            "SCHEMA_SNAPSHOT_CAPTURE_FAILED",
            &error,
            true,
            Some(context),
        )),
    }
}

#[tauri::command]
pub async fn compare_schema_snapshots(
    source: SchemaSnapshot,
    target: SchemaSnapshot,
) -> Result<Response<SchemaDiffPlan>, String> {
    let context = serde_json::json!({
        "sourceSnapshotId": source.id,
        "targetSnapshotId": target.id,
        "targetConnectionId": target.connection_id,
        "targetDatabase": target.database_name,
        "targetSchema": target.schema_name,
    });
    match build_schema_diff(&source, &target, current_timestamp_millis()) {
        Ok(plan) => Ok(Response::ok(plan)),
        Err(error) => Ok(Response::err_with_details(
            "SCHEMA_SNAPSHOT_COMPARE_FAILED",
            &error.to_string(),
            false,
            Some(context),
        )),
    }
}

fn current_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
