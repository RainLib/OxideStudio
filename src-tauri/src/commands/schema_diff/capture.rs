use super::capture_identity::schema_object_definition_key;
use super::constants::SNAPSHOT_METADATA_CONCURRENCY;
use super::mysql_catalog::{capture_mysql_event_definitions, capture_mysql_trigger_definitions};
use super::pg_dependencies::{
    capture_postgres_trigger_definitions, capture_postgres_trigger_routine_dependencies,
    capture_postgres_view_dependencies,
};
use super::pg_routine::capture_postgres_routine_definitions;
use super::pg_sequence::{
    capture_postgres_relation_sequence_dependencies, capture_postgres_sequence_definitions,
    capture_postgres_sequence_state,
};
use super::timestamp::current_timestamp_millis;
use super::view_capture::{
    capture_native_view_definition, capture_sqlite_table_definition,
    capture_sqlite_trigger_definitions, object_type_is_view,
};
use crate::core::dialect::{canonical_driver_name, database_spec_for_driver};
use crate::core::manager::ConnectionManager;
use crate::core::protocol::Response;
use crate::core::schema_diff::{
    finalize_schema_snapshot, SchemaObjectSnapshot, SchemaRelationSnapshot, SchemaRoutineSnapshot,
    SchemaSnapshot, SCHEMA_SNAPSHOT_VERSION,
};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tauri::State;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

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
    allow_partial: Option<bool>,
) -> Result<Response<SchemaSnapshot>, String> {
    let context = serde_json::json!({
        "projectId": project_id,
        "connectionId": connection_id,
        "driver": driver,
        "database": database,
        "schema": schema,
    });
    let result = capture_schema_snapshot_inner(
        manager.inner(),
        project_id,
        connection_id,
        connection_name,
        driver,
        database,
        schema,
        allow_partial.unwrap_or(false),
    )
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

#[allow(clippy::too_many_arguments)]
pub(crate) async fn capture_schema_snapshot_inner(
    manager: &ConnectionManager,
    project_id: String,
    connection_id: String,
    connection_name: String,
    driver: String,
    database: Option<String>,
    schema: String,
    allow_partial: bool,
) -> Result<SchemaSnapshot, String> {
    let capabilities = manager
        .package_capabilities(&connection_id)
        .await
        .map_err(|error| error.to_string())?
        .or_else(|| database_spec_for_driver(&driver).map(|spec| spec.capabilities()))
        .ok_or_else(|| {
            format!(
                "{} does not declare a signed schema snapshot capability contract",
                driver.trim()
            )
        })?;
    if !capabilities.supports_table_browsing && !capabilities.supports_collection_browsing {
        return Err(format!(
            "{} does not expose schema or collection snapshots",
            capabilities.display_name
        ));
    }
    let schema = schema.trim();
    if schema.is_empty() {
        return Err("Schema name is required".to_string());
    }
    let database = database.as_deref();
    let objects: Vec<(String, Option<String>, Option<String>)> =
        if capabilities.supports_table_browsing {
            match database {
                Some(database) => {
                    manager
                        .get_database_tables(&connection_id, database, schema)
                        .await
                }
                None => manager.get_tables(&connection_id, schema).await,
            }
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|table| (table.name, table.table_type, table.comment))
            .collect()
        } else {
            manager
                .get_collections(&connection_id, schema)
                .await
                .map_err(|error| error.to_string())?
                .into_iter()
                .map(|collection| (collection.name, collection.collection_type, None))
                .collect()
        };

    let mut warnings = Vec::new();
    let view_dependencies = if capabilities.supports_table_browsing {
        match capture_postgres_view_dependencies(
            manager,
            &connection_id,
            database,
            &capabilities.driver,
            schema,
        )
        .await
        {
            Ok(dependencies) => dependencies,
            Err(error) => {
                warnings.push(format!(
                    "PostgreSQL view dependency metadata was unavailable; view DDL remains reviewable but uses the conservative default order: {error}"
                ));
                HashMap::new()
            }
        }
    } else {
        HashMap::new()
    };
    let relation_sequence_dependencies = if capabilities.supports_table_browsing {
        match capture_postgres_relation_sequence_dependencies(
            manager,
            &connection_id,
            database,
            &capabilities.driver,
            schema,
        )
        .await
        {
            Ok(dependencies) => dependencies,
            Err(error) => {
                warnings.push(format!(
                    "PostgreSQL sequence dependency metadata was unavailable; sequence DDL remains reviewable but relation ordering uses the conservative default: {error}"
                ));
                HashMap::new()
            }
        }
    } else {
        HashMap::new()
    };
    let manager = manager.clone();
    let concurrency = Arc::new(Semaphore::new(SNAPSHOT_METADATA_CONCURRENCY));
    let mut captures = JoinSet::new();
    let snapshot_driver = capabilities.driver.clone();
    for (relation_name, object_type, comment) in objects {
        let manager = manager.clone();
        let concurrency = Arc::clone(&concurrency);
        let connection_id = connection_id.clone();
        let database = database.map(ToString::to_string);
        let schema = schema.to_string();
        let driver = snapshot_driver.clone();
        let view_dependencies = view_dependencies
            .get(&relation_name)
            .cloned()
            .unwrap_or_default();
        let dependencies = view_dependencies.same_schema;
        let external_dependencies = view_dependencies.external;
        let sequence_dependencies = relation_sequence_dependencies
            .get(&relation_name)
            .cloned()
            .unwrap_or_default();
        let supports_indexes = capabilities.supports_table_indexes;
        let supports_constraints = capabilities.supports_table_constraints;
        let database_scoped = capabilities.supports_table_browsing && database.is_some();
        captures.spawn(async move {
            let _permit = concurrency
                .acquire_owned()
                .await
                .map_err(|_| "Schema snapshot concurrency gate closed".to_string())?;
            let (definition, materialized_view_populated, view_warning) = if object_type_is_view(object_type.as_deref()) {
                match capture_native_view_definition(
                    &manager,
                    &connection_id,
                    database.as_deref(),
                    &driver,
                    &schema,
                    &relation_name,
                )
                .await
                {
                    Ok(definition) => match definition {
                        Some((definition, materialized_view_populated)) => {
                            (Some(definition), materialized_view_populated, None)
                        }
                        None => (None, None, None),
                    },
                    Err(error) => (
                        None,
                        None,
                        Some(format!(
                            "View source for {schema}.{relation_name} was unavailable; this view remains review-only: {error}"
                        )),
                    ),
                }
            } else if canonical_driver_name(&driver) == Some("sqlite") {
                match capture_sqlite_table_definition(
                    &manager,
                    &connection_id,
                    &driver,
                    &schema,
                    &relation_name,
                )
                .await
                {
                    Ok(Some(definition)) => (Some(definition), None, None),
                    Ok(None) => (
                        None,
                        None,
                        Some(format!(
                            "SQLite catalog definition for {schema}.{relation_name} was unavailable; rebuild execution remains blocked."
                        )),
                    ),
                    Err(error) => (
                        None,
                        None,
                        Some(format!(
                            "SQLite catalog definition for {schema}.{relation_name} was unavailable; rebuild execution remains blocked: {error}"
                        )),
                    ),
                }
            } else {
                (None, None, None)
            };
            let columns = async {
                match (database_scoped, database.as_deref()) {
                    (true, Some(database)) => {
                        manager
                            .get_database_columns(&connection_id, database, &schema, &relation_name)
                            .await
                    }
                    _ => {
                        manager
                            .get_columns(&connection_id, &schema, &relation_name)
                            .await
                    }
                }
            };
            let indexes = async {
                if !supports_indexes {
                    return Ok(Vec::new());
                }
                match (database_scoped, database.as_deref()) {
                    (true, Some(database)) => {
                        manager
                            .get_database_indexes(&connection_id, database, &schema, &relation_name)
                            .await
                    }
                    _ => {
                        manager
                            .get_indexes(&connection_id, &schema, &relation_name)
                            .await
                    }
                }
            };
            let constraints = async {
                if !supports_constraints {
                    return Ok(Vec::new());
                }
                match (database_scoped, database.as_deref()) {
                    (true, Some(database)) => {
                        manager
                            .get_database_constraints(
                                &connection_id,
                                database,
                                &schema,
                                &relation_name,
                            )
                            .await
                    }
                    _ => {
                        manager
                            .get_constraints(&connection_id, &schema, &relation_name)
                            .await
                    }
                }
            };
            match tokio::try_join!(columns, indexes, constraints) {
                Ok(metadata) => Ok::<_, String>((
                    SchemaRelationSnapshot {
                        name: relation_name,
                        object_type,
                        comment,
                        definition,
                        materialized_view_populated,
                        dependencies,
                        external_dependencies,
                        sequence_dependencies,
                        columns: metadata.0,
                        indexes: metadata.1,
                        constraints: metadata.2,
                    },
                    view_warning.into_iter().collect::<Vec<_>>(),
                )),
                Err(error) if allow_partial => Ok((
                    SchemaRelationSnapshot {
                        name: relation_name.clone(),
                        object_type,
                        comment,
                        definition,
                        materialized_view_populated,
                        dependencies,
                        external_dependencies,
                        sequence_dependencies,
                        columns: Vec::new(),
                        indexes: Vec::new(),
                        constraints: Vec::new(),
                    },
                    view_warning
                        .into_iter()
                        .chain(std::iter::once(format!(
                            "Diagram metadata for {schema}.{relation_name} is incomplete: {error}"
                        )))
                        .collect::<Vec<_>>(),
                )),
                Err(error) => Err(format!(
                    "Failed to capture metadata for {schema}.{relation_name}: {error}"
                )),
            }
        });
    }

    let mut relations = Vec::with_capacity(captures.len());
    while let Some(capture) = captures.join_next().await {
        match capture {
            Ok(Ok((relation, relation_warnings))) => {
                relations.push(relation);
                warnings.extend(relation_warnings);
            }
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

    // Routine metadata is available across many drivers. PostgreSQL additionally
    // exposes exact catalog-owned create-or-replace source; only that narrow
    // contract is carried into a review-gated native migration plan.
    let mut routines = if capabilities.supports_functions {
        let functions = match (capabilities.supports_table_browsing, database) {
            (true, Some(database)) => {
                manager
                    .get_database_functions(&connection_id, database, schema)
                    .await
            }
            _ => manager.get_functions(&connection_id, schema).await,
        }
        .map_err(|error| format!("Failed to capture routines for {schema}: {error}"))?;
        functions
            .into_iter()
            .map(SchemaRoutineSnapshot::from)
            .collect()
    } else {
        Vec::new()
    };

    if !routines.is_empty() {
        match capture_postgres_routine_definitions(
            &manager,
            &connection_id,
            database,
            &capabilities.driver,
            schema,
        )
        .await
        {
            Ok(definitions) => {
                let mut by_identity = HashMap::<(String, String), VecDeque<String>>::new();
                for definition in definitions {
                    by_identity
                        .entry((definition.name, definition.routine_type))
                        .or_default()
                        .push_back(definition.definition);
                }
                for routine in &mut routines {
                    let routine_type = routine
                        .routine_type
                        .as_deref()
                        .unwrap_or("function")
                        .to_ascii_lowercase();
                    if let Some(definition) = by_identity
                        .get_mut(&(routine.name.clone(), routine_type))
                        .and_then(VecDeque::pop_front)
                    {
                        routine.definition = Some(definition);
                    }
                }
                if by_identity.values().any(|values| !values.is_empty()) {
                    warnings.push(
                        "Some PostgreSQL routine definitions could not be paired with their metadata signatures; those routines remain review-only."
                            .to_string(),
                    );
                }
            }
            Err(error) => warnings.push(format!(
                "PostgreSQL routine source was unavailable; routine drift remains review-only: {error}"
            )),
        }
    }

    // Descriptor discovery is deliberately best-effort. A role that can read
    // relations may still lack catalog visibility for extensions, triggers or
    // types; that must not make an otherwise usable snapshot fail. The warning
    // binds this incomplete coverage to the snapshot review record.
    let mut schema_objects = if capabilities.supports_table_browsing {
        let result = match database {
            Some(database) => {
                manager
                    .get_database_schema_objects(&connection_id, database, schema)
                    .await
            }
            None => manager.get_schema_objects(&connection_id, schema).await,
        };
        match result {
            Ok(objects) => objects
                .into_iter()
                .map(SchemaObjectSnapshot::from)
                .collect(),
            Err(_) => {
                warnings.push(
                    "Schema object descriptors were unavailable for this server role; snapshot comparison excludes those objects."
                        .to_string(),
                );
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };

    if !schema_objects.is_empty() {
        match capture_postgres_trigger_definitions(
            &manager,
            &connection_id,
            database,
            &capabilities.driver,
            schema,
        )
        .await
        {
            Ok(definitions) => {
                for object in &mut schema_objects {
                    if object.object_type.eq_ignore_ascii_case("trigger") {
                        object.definition = definitions
                            .get(&schema_object_definition_key(
                                object.parent_name.as_deref(),
                                &object.name,
                            ))
                            .cloned();
                    }
                }
            }
            Err(error) => warnings.push(format!(
                "PostgreSQL trigger source was unavailable; trigger drift remains review-only: {error}"
            )),
        }
    }

    if !schema_objects.is_empty() {
        match capture_mysql_trigger_definitions(
            &manager,
            &connection_id,
            database,
            &capabilities.driver,
            schema,
        )
        .await
        {
            Ok(definitions) => {
                for object in &mut schema_objects {
                    if object.object_type.eq_ignore_ascii_case("trigger") {
                        if let Some(definition) = definitions.get(&schema_object_definition_key(
                            object.parent_name.as_deref(),
                            &object.name,
                        )) {
                            object.definition = Some(definition.clone());
                        }
                    }
                }
            }
            Err(error) => warnings.push(format!(
                "MySQL trigger source was unavailable; trigger drift remains review-only: {error}"
            )),
        }
    }

    if !schema_objects.is_empty() {
        match capture_sqlite_trigger_definitions(
            &manager,
            &connection_id,
            &capabilities.driver,
            schema,
        )
        .await
        {
            Ok(definitions) => {
                for object in &mut schema_objects {
                    if object.object_type.eq_ignore_ascii_case("trigger") {
                        if let Some(definition) = definitions.get(&schema_object_definition_key(
                            object.parent_name.as_deref(),
                            &object.name,
                        )) {
                            object.definition = Some(definition.clone());
                        }
                    }
                }
            }
            Err(error) => warnings.push(format!(
                "SQLite trigger source was unavailable; affected rebuilds remain review-only: {error}"
            )),
        }
    }

    if !schema_objects.is_empty() {
        match capture_mysql_event_definitions(
            &manager,
            &connection_id,
            database,
            &capabilities.driver,
            schema,
        )
        .await
        {
            Ok(definitions) => {
                for object in &mut schema_objects {
                    if object.object_type.eq_ignore_ascii_case("event") {
                        if let Some(definition) =
                            definitions.get(&schema_object_definition_key(None, &object.name))
                        {
                            object.definition = Some(definition.clone());
                        }
                    }
                }
            }
            Err(error) => warnings.push(format!(
                "MySQL event source was unavailable; event drift remains review-only: {error}"
            )),
        }
    }

    if !schema_objects.is_empty() {
        match capture_postgres_trigger_routine_dependencies(
            &manager,
            &connection_id,
            database,
            &capabilities.driver,
            schema,
        )
        .await
        {
            Ok(dependencies) => {
                for object in &mut schema_objects {
                    if object.object_type.eq_ignore_ascii_case("trigger") {
                        object.dependencies = dependencies
                            .get(&schema_object_definition_key(
                                object.parent_name.as_deref(),
                                &object.name,
                            ))
                            .cloned()
                            .unwrap_or_default();
                    }
                }
            }
            Err(error) => warnings.push(format!(
                "PostgreSQL trigger routine dependency metadata was unavailable; trigger DDL retains conservative ordering: {error}"
            )),
        }
    }

    if !schema_objects.is_empty() {
        match capture_postgres_sequence_definitions(
            &manager,
            &connection_id,
            database,
            &capabilities.driver,
            schema,
        )
        .await
        {
            Ok(definitions) => {
                for object in &mut schema_objects {
                    if object.object_type.eq_ignore_ascii_case("sequence") {
                        object.definition = definitions.get(&object.name).cloned();
                    }
                }
            }
            Err(error) => warnings.push(format!(
                "PostgreSQL sequence source was unavailable; sequence drift remains review-only: {error}"
            )),
        }
    }

    if !schema_objects.is_empty() {
        match capture_postgres_sequence_state(
            &manager,
            &connection_id,
            database,
            &capabilities.driver,
            schema,
        )
        .await
        {
            Ok(states) => {
                for object in &mut schema_objects {
                    if object.object_type.eq_ignore_ascii_case("sequence") {
                        if let Some(state) = states.get(&object.name) {
                            object.sequence_owner = state.owner.clone();
                            object.sequence_last_value = state.last_value.clone();
                            object.sequence_is_called = state.is_called;
                        }
                    }
                }
            }
            Err(error) => warnings.push(format!(
                "PostgreSQL sequence ownership/state source was unavailable; sequence migration keeps only its structural definition: {error}"
            )),
        }
    }

    finalize_schema_snapshot(SchemaSnapshot {
        version: SCHEMA_SNAPSHOT_VERSION,
        id: String::new(),
        fingerprint: String::new(),
        project_id,
        connection_id,
        connection_name,
        driver: capabilities.driver,
        database_name: database.map(ToString::to_string),
        schema_name: schema.to_string(),
        captured_at: current_timestamp_millis(),
        relations,
        routines,
        schema_objects,
        warnings,
    })
    .map_err(|error| error.to_string())
}
