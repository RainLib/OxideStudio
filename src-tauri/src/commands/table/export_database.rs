//! Export database for table operations.

use super::export_files::{export_file_path, ExportTemporaryFile};
use super::export_sql::{
    filter_sql_export_batch, sql_export_insert_batch_rows, sql_insert_statements, SqlExportDialect,
    SqlInsertExportOptions,
};
use super::export_types::{
    select_database_sql_export_tables, DatabaseSqlExportResult, SqlInsertConflictPolicy,
    TableExportCancellationState, TableExportFormat, TableExportProgress,
};
use super::limits::{
    DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, TABLE_EXPORT_CANCELLED, TABLE_EXPORT_PROGRESS_EVENT,
};
use super::policy::{object_type_is_materialized_view, object_type_is_view};
use super::postgres_catalog::{
    generate_postgres_materialized_view_ddl_with_data, generate_postgres_table_ddl,
    generate_postgres_view_ddl, is_postgres_foreign_key_constraint, order_postgres_views,
    postgres_backup_index_definitions, postgres_backup_routine_definitions,
    postgres_backup_routine_definitions_query, postgres_composite_type_ddls,
    postgres_composite_type_query, postgres_constraint_definition, postgres_domain_ddls,
    postgres_domain_definitions_query, postgres_enum_ddls, postgres_enum_definitions_query,
    postgres_extension_ddls, postgres_extension_query, postgres_materialized_view_populated_query,
    postgres_multirange_type_names, postgres_multirange_type_query, postgres_range_type_ddls,
    postgres_range_type_query, postgres_sequence_ddl, postgres_sequence_from_row,
    postgres_sequence_metadata_query, postgres_sequence_owner_sql, postgres_sequence_setval_sql,
    postgres_trigger_definitions, postgres_trigger_definitions_query,
    postgres_view_definition_query, postgres_view_dependency_query,
};
use super::values::value_to_string;
use crate::core::dialect::canonical_driver_name;
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ConstraintInfo;
use crate::core::protocol::QueryResult;
use crate::core::protocol::Response;
use std::collections::HashSet;
use std::fs::File;
use std::io::BufWriter;
use std::io::Write;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::State;

/// Export every base relation in one PostgreSQL schema into a single replayable
/// SQL file.  The output is written to a sibling partial file and published
/// only after every relation has completed.  It is deliberately not a generic
/// `pg_dump` replacement: non-relation objects remain excluded until their
/// source/ownership semantics have a reviewed per-product contract.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_database_sql(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, TableExportCancellationState>,
    connection_id: String,
    export_id: String,
    driver: String,
    schema: String,
    include_structure: Option<bool>,
    include_data: Option<bool>,
    table_names: Option<Vec<String>>,
    page_size: Option<u32>,
    sql_insert_batch_size: Option<usize>,
) -> Result<Response<DatabaseSqlExportResult>, String> {
    let cancel_rx = cancellation.register(&export_id, &connection_id).await?;
    let include_structure = include_structure.unwrap_or(true);
    let include_data = include_data.unwrap_or(true);
    let progress_rows = Arc::new(AtomicU64::new(0));
    let progress_batches = Arc::new(AtomicU64::new(0));
    let result: Result<DatabaseSqlExportResult, String> = async {
        if !include_structure && !include_data {
            return Err("Select structure, data, or both for database SQL export".to_string());
        }
        if table_names.is_some() && include_structure {
            return Err(
                "Selected-table SQL export is data-only; use whole-schema export when structure is required"
                    .to_string(),
            );
        }
        // A package may reuse the postgres name while changing catalog or DDL
        // semantics.  Do not widen it into this host-owned backup path.
        if manager
            .package_capabilities(&connection_id)
            .await
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Err("Whole-schema SQL export requires a signed product-owned backup contract for external drivers".to_string());
        }
        if canonical_driver_name(&driver) != Some("postgres") {
            return Err("Whole-schema SQL export is currently available for the built-in PostgreSQL driver only".to_string());
        }
        let schema = schema.trim();
        if schema.is_empty() {
            return Err("A PostgreSQL schema is required for database SQL export".to_string());
        }
        let page_size = page_size.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
        let insert_batch_size = sql_export_insert_batch_rows(sql_insert_batch_size)?;
        let has_explicit_table_selection = table_names.is_some();
        let relations = manager
            .get_tables(&connection_id, schema)
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .collect::<Vec<_>>();
        let tables = select_database_sql_export_tables(&relations, table_names.as_deref())?;
        let selected_table_names = tables
            .iter()
            .map(|table| table.name.as_str())
            .collect::<HashSet<_>>();
        let discovered_views = relations
            .iter()
            .filter(|table| object_type_is_view(table.table_type.as_deref()))
            .cloned()
            .collect::<Vec<_>>();
        let views = if include_structure && !discovered_views.is_empty() {
            let dependency_results = manager
                .query(
                    &connection_id,
                    &postgres_view_dependency_query(schema),
                    None,
                    None,
                    Some(export_id.clone()),
                )
                .await
                .map_err(|error| error.to_string())?;
            let dependencies = dependency_results
                .iter()
                .flat_map(|result| result.rows.iter())
                .filter_map(|row| {
                    Some((
                        row.first()?.as_str()?.trim().to_string(),
                        row.get(1)?.as_str()?.trim().to_string(),
                    ))
                })
                .filter(|(view, dependency)| !view.is_empty() && !dependency.is_empty())
                .collect::<Vec<_>>();
            order_postgres_views(discovered_views, &dependencies)?
        } else {
            discovered_views
        };
        let extensions = if include_structure {
            let extension_results = manager
                .query(
                    &connection_id,
                    &postgres_extension_query(schema),
                    None,
                    None,
                    Some(export_id.clone()),
                )
                .await
                .map_err(|error| error.to_string())?;
            postgres_extension_ddls(&extension_results)?
        } else {
            Vec::new()
        };
        let enum_types = if include_structure {
            let enum_results = manager.query(&connection_id, &postgres_enum_definitions_query(schema), None, None, Some(export_id.clone()))
                .await.map_err(|error| error.to_string())?;
            postgres_enum_ddls(schema, &enum_results)?
        } else { Vec::new() };
        let domains = if include_structure {
            let domain_results = manager.query(&connection_id, &postgres_domain_definitions_query(schema), None, None, Some(export_id.clone()))
                .await.map_err(|error| error.to_string())?;
            postgres_domain_ddls(schema, &domain_results)?
        } else { Vec::new() };
        let composite_types = if include_structure {
            let results = manager.query(&connection_id, &postgres_composite_type_query(schema), None, None, Some(export_id.clone()))
                .await.map_err(|error| error.to_string())?;
            postgres_composite_type_ddls(schema, &results)?
        } else { Vec::new() };
        let range_types = if include_structure {
            let results = manager.query(&connection_id, &postgres_range_type_query(schema), None, None, Some(export_id.clone()))
                .await.map_err(|error| error.to_string())?;
            postgres_range_type_ddls(schema, &results)?
        } else { Vec::new() };
        if include_structure {
            let results = manager.query(&connection_id, &postgres_multirange_type_query(schema), None, None, Some(export_id.clone()))
                .await.map_err(|error| error.to_string())?;
            let multirange_types = postgres_multirange_type_names(&results)?;
            if !multirange_types.is_empty() {
                return Err(format!(
                    "PostgreSQL multirange type(s) are not yet supported by schema backup: {}",
                    multirange_types.join(", "),
                ));
            }
        }
        // `serial` and `nextval(...)` defaults require the referenced sequence
        // to exist before CREATE TABLE is replayed.  Read the bounded catalog
        // metadata once and use it for DDL before relations plus state after
        // data, rather than inferring sequences from column default text.
        let sequence_metadata_sql = postgres_sequence_metadata_query(schema);
        let sequence_results = manager
            .query(
                &connection_id,
                &sequence_metadata_sql,
                None,
                None,
                Some(export_id.clone()),
            )
            .await
            .map_err(|error| error.to_string())?;
        let mut sequences = sequence_results
            .into_iter()
            .next()
            .map(|result| {
                result
                    .rows
                    .iter()
                    .map(|row| postgres_sequence_from_row(row))
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?
            .unwrap_or_default();
        if has_explicit_table_selection {
            sequences.retain(|sequence| {
                sequence
                    .owner_table
                    .as_deref()
                    .is_some_and(|owner| selected_table_names.contains(owner))
            });
        }
        let routines = if include_structure {
            let routine_results = manager
                .query(
                    &connection_id,
                    &postgres_backup_routine_definitions_query(schema),
                    None,
                    None,
                    Some(export_id.clone()),
                )
                .await
                .map_err(|error| error.to_string())?;
            postgres_backup_routine_definitions(&routine_results)?
        } else {
            Vec::new()
        };
        let triggers = if include_structure {
            let trigger_results = manager
                .query(
                    &connection_id,
                    &postgres_trigger_definitions_query(schema),
                    None,
                    None,
                    Some(export_id.clone()),
                )
                .await
                .map_err(|error| error.to_string())?;
            postgres_trigger_definitions(&trigger_results)?
        } else {
            Vec::new()
        };
        let final_path = export_file_path(&app, schema, "database_backup", TableExportFormat::Sql)?;
        let mut temporary_file = ExportTemporaryFile::create(&final_path)?;
        let file = File::create(&temporary_file.path).map_err(|error| error.to_string())?;
        let mut writer = BufWriter::new(file);
        writeln!(writer, "-- OxideStudio PostgreSQL schema backup for {}", schema)
            .map_err(|error| error.to_string())?;
        writeln!(writer, "-- Relation structure: {}; relation data: {}", include_structure, include_data)
            .map_err(|error| error.to_string())?;
        if has_explicit_table_selection {
            writeln!(
                writer,
                "-- Selected base tables: {}",
                tables
                    .iter()
                    .map(|table| DatabaseKind::Postgres.qualified_table(Some(schema), &table.name))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
            .map_err(|error| error.to_string())?;
        }
        // PostgreSQL DDL and the generated INSERT statements are transactional.
        // Keep the backup atomic on restore: a failed relation, row or deferred
        // FK must not leave a partly restored schema behind.
        writeln!(writer, "BEGIN;").map_err(|error| error.to_string())?;
        if include_structure && !extensions.is_empty() {
            writeln!(writer, "\n-- Extensions (created before dependent relation types and defaults)")
                .map_err(|error| error.to_string())?;
            for ddl in &extensions {
                writeln!(writer, "{ddl}").map_err(|error| error.to_string())?;
            }
        }
        if include_structure && !enum_types.is_empty() {
            writeln!(writer, "\n-- Enum types (created before dependent relations)")
                .map_err(|error| error.to_string())?;
            for ddl in &enum_types {
                writeln!(writer, "{ddl}").map_err(|error| error.to_string())?;
            }
        }
        if include_structure && !domains.is_empty() {
            writeln!(writer, "\n-- Domains (created before dependent relations)")
                .map_err(|error| error.to_string())?;
            for ddl in &domains {
                writeln!(writer, "{ddl}").map_err(|error| error.to_string())?;
            }
        }
        if include_structure && !composite_types.is_empty() {
            writeln!(writer, "\n-- Composite types (created before dependent relations)")
                .map_err(|error| error.to_string())?;
            for ddl in &composite_types {
                writeln!(writer, "{ddl}").map_err(|error| error.to_string())?;
            }
        }
        if include_structure && !range_types.is_empty() {
            writeln!(writer, "\n-- Range types (created before dependent relations)")
                .map_err(|error| error.to_string())?;
            for ddl in &range_types {
                writeln!(writer, "{ddl}").map_err(|error| error.to_string())?;
            }
        }
        if include_structure && !sequences.is_empty() {
            writeln!(writer, "\n-- Sequences (created before relation defaults)")
                .map_err(|error| error.to_string())?;
            for sequence in &sequences {
                writeln!(writer, "{}", postgres_sequence_ddl(schema, sequence))
                    .map_err(|error| error.to_string())?;
            }
        }
        let mut rows_exported = 0_u64;
        let mut batches = 0_u64;
        // PostgreSQL requires a referenced relation to exist when creating a
        // FK. Emit FKs after every relation and its data are present so schema
        // enumeration order cannot make an otherwise valid dump fail.
        let mut foreign_key_constraints = Vec::<(String, Vec<ConstraintInfo>)>::new();
        for table_info in &tables {
            if *cancel_rx.borrow() {
                return Err(format!("{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"));
            }
            let table = table_info.name.trim();
            if table.is_empty() {
                return Err("Schema metadata contains a relation with no name".to_string());
            }
            if include_structure {
                let columns = manager.get_columns(&connection_id, schema, table).await
                    .map_err(|error| error.to_string())?;
                let all_constraints = manager.get_constraints(&connection_id, schema, table).await
                    .unwrap_or_default();
                let constraints = all_constraints
                    .iter()
                    .filter(|constraint| !is_postgres_foreign_key_constraint(constraint))
                    .cloned()
                    .collect::<Vec<_>>();
                let foreign_keys = all_constraints
                    .into_iter()
                    .filter(is_postgres_foreign_key_constraint)
                    .collect::<Vec<_>>();
                if !foreign_keys.is_empty() {
                    foreign_key_constraints.push((table.to_string(), foreign_keys));
                }
                let indexes = manager.get_indexes(&connection_id, schema, table).await
                    .unwrap_or_default();
                writeln!(writer, "\n-- Structure for {}", DatabaseKind::Postgres.qualified_table(Some(schema), table))
                    .map_err(|error| error.to_string())?;
                writeln!(writer, "{}", generate_postgres_table_ddl(schema, table, &columns, &constraints, &indexes))
                    .map_err(|error| error.to_string())?;
            }
            if include_data {
                let excluded_columns = manager.get_generated_columns(&connection_id, schema, table).await
                    .map_err(|error| error.to_string())?
                    .into_iter()
                    .collect::<HashSet<_>>();
                let override_system_value = manager
                    .sql_export_requires_identity_override(&connection_id, schema, table)
                    .await
                    .map_err(|error| error.to_string())?;
                let mut offset = 0_u64;
                loop {
                    if *cancel_rx.borrow() {
                        return Err(format!("{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"));
                    }
                    let sql = DatabaseKind::Postgres.paged_table_query_with_order(
                        Some(schema), table, None, None, page_size, offset,
                    );
                    let mut result = manager.query(&connection_id, &sql, None, None, Some(export_id.clone()))
                        .await.map_err(|error| error.to_string())?;
                    let result = result.drain(..).next().unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));
                    let page_rows = result.rows.len() as u64;
                    let (columns, rows) = filter_sql_export_batch(result.columns, result.rows, &excluded_columns)?;
                    for statement in sql_insert_statements(
                        SqlInsertExportOptions {
                            kind: DatabaseKind::Postgres,
                            dialect: SqlExportDialect::Postgres,
                            override_system_value,
                            batch_rows: insert_batch_size,
                            conflict_policy: SqlInsertConflictPolicy::Strict,
                            conflict_key_columns: &[],
                            schema,
                            table,
                        },
                        &columns,
                        &rows,
                    )? {
                        writeln!(writer, "{statement}").map_err(|error| error.to_string())?;
                    }
                    rows_exported += page_rows;
                    batches += u64::from(page_rows > 0);
                    progress_rows.store(rows_exported, Ordering::Relaxed);
                    progress_batches.store(batches, Ordering::Relaxed);
                    if page_rows == 0 || page_rows < page_size as u64 {
                        break;
                    }
                    offset += page_rows;
                }
            }
        }
        if include_structure {
            let sequence_ownership = sequences
                .iter()
                .filter_map(|sequence| postgres_sequence_owner_sql(schema, sequence))
                .collect::<Vec<_>>();
            if !sequence_ownership.is_empty() {
                writeln!(writer, "\n-- Sequence ownership (applied after relation creation)")
                    .map_err(|error| error.to_string())?;
                for statement in sequence_ownership {
                    writeln!(writer, "{statement}").map_err(|error| error.to_string())?;
                }
            }
        }
        if include_data {
            let sequence_state = sequences
                .iter()
                .filter_map(|sequence| postgres_sequence_setval_sql(schema, sequence))
                .collect::<Vec<_>>();
            if !sequence_state.is_empty() {
                writeln!(writer, "\n-- Sequence state (restored after relation data and ownership)")
                    .map_err(|error| error.to_string())?;
                for statement in sequence_state {
                    writeln!(writer, "{statement}").map_err(|error| error.to_string())?;
                }
            }
        }
        if include_structure && !foreign_key_constraints.is_empty() {
            writeln!(writer, "\n-- Foreign-key constraints (applied after relation data)")
                .map_err(|error| error.to_string())?;
            for (table, constraints) in foreign_key_constraints {
                for constraint in constraints {
                    if let Some(definition) = postgres_constraint_definition(
                        DatabaseKind::Postgres,
                        &constraint,
                    ) {
                        writeln!(
                            writer,
                            "ALTER TABLE {} ADD {};",
                            DatabaseKind::Postgres.qualified_table(Some(schema), &table),
                            definition.trim(),
                        )
                        .map_err(|error| error.to_string())?;
                    }
                }
            }
        }
        if include_structure && !views.is_empty() {
            writeln!(writer, "\n-- Views (created after base relations and data)")
                .map_err(|error| error.to_string())?;
            for view_info in &views {
                if *cancel_rx.borrow() {
                    return Err(format!("{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"));
                }
                let view = view_info.name.trim();
                if view.is_empty() {
                    return Err("Schema metadata contains a view with no name".to_string());
                }
                let definition_results = manager
                    .query(
                        &connection_id,
                        &postgres_view_definition_query(DatabaseKind::Postgres, schema, view),
                        None,
                        None,
                        Some(export_id.clone()),
                    )
                    .await
                    .map_err(|error| error.to_string())?;
                let definition = definition_results
                    .first()
                    .and_then(|result| result.rows.first())
                    .and_then(|row| row.first())
                    .and_then(value_to_string)
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        format!("PostgreSQL view {view} has no definition available for backup")
                    })?;
                let is_materialized_view =
                    object_type_is_materialized_view(view_info.table_type.as_deref());
                let ddl = if is_materialized_view {
                    let populated_results = manager
                        .query(
                            &connection_id,
                            &postgres_materialized_view_populated_query(
                                DatabaseKind::Postgres,
                                schema,
                                view,
                            ),
                            None,
                            None,
                            Some(export_id.clone()),
                        )
                        .await
                        .map_err(|error| error.to_string())?;
                    let populated = populated_results
                        .first()
                        .and_then(|result| result.rows.first())
                        .and_then(|row| row.first())
                        .and_then(value_to_string)
                        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "true" | "t" | "1"))
                        .ok_or_else(|| {
                            format!(
                                "PostgreSQL materialized view {view} has no populated state available for backup"
                            )
                        })?;
                    generate_postgres_materialized_view_ddl_with_data(
                        DatabaseKind::Postgres,
                        schema,
                        view,
                        &definition,
                        populated,
                    )
                } else {
                    generate_postgres_view_ddl(DatabaseKind::Postgres, schema, view, &definition)
                };
                writeln!(writer, "{ddl}").map_err(|error| error.to_string())?;
                if is_materialized_view {
                    let indexes = manager
                        .get_indexes(&connection_id, schema, view)
                        .await
                        .map_err(|error| error.to_string())?;
                    let definitions = postgres_backup_index_definitions(view, &indexes)?;
                    if !definitions.is_empty() {
                        writeln!(writer, "-- Indexes for materialized view {}", DatabaseKind::Postgres.qualified_table(Some(schema), view))
                            .map_err(|error| error.to_string())?;
                        for definition in definitions {
                            writeln!(writer, "{definition};").map_err(|error| error.to_string())?;
                        }
                    }
                }
            }
        }
        if include_structure && !routines.is_empty() {
            writeln!(writer, "\n-- Functions and procedures (created after relations and views)")
                .map_err(|error| error.to_string())?;
            for definition in &routines {
                if *cancel_rx.borrow() {
                    return Err(format!("{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"));
                }
                writeln!(writer, "{definition}").map_err(|error| error.to_string())?;
            }
        }
        if include_structure && !triggers.is_empty() {
            writeln!(writer, "\n-- Triggers (created after their routines)")
                .map_err(|error| error.to_string())?;
            for definition in &triggers {
                if *cancel_rx.borrow() {
                    return Err(format!("{TABLE_EXPORT_CANCELLED}: Export cancelled by the user"));
                }
                writeln!(writer, "{definition}").map_err(|error| error.to_string())?;
            }
        }
        writeln!(writer, "COMMIT;").map_err(|error| error.to_string())?;
        writer.flush().map_err(|error| error.to_string())?;
        writer.get_ref().sync_all().map_err(|error| error.to_string())?;
        temporary_file.finalize(&final_path)?;
        Ok(DatabaseSqlExportResult {
            export_id: export_id.clone(),
            file_path: final_path.to_string_lossy().to_string(),
            tables_exported: tables.len() as u64,
            rows_exported,
            batches,
            omitted_object_kinds: vec![
                "grants".to_string(), "view options".to_string(),
            ],
        })
    }.await;
    let cancellation_requested = *cancel_rx.borrow();
    cancellation.take(&export_id).await;
    let (status, message) = match &result {
        Ok(_) => ("done", Some("Database SQL export completed".to_string())),
        Err(error) if cancellation_requested || error.contains(TABLE_EXPORT_CANCELLED) => (
            "cancelled",
            Some("Database SQL export cancelled; partial file removed".to_string()),
        ),
        Err(_) => (
            "error",
            Some("Database SQL export failed; partial file removed".to_string()),
        ),
    };
    let _ = app.emit(
        TABLE_EXPORT_PROGRESS_EVENT,
        TableExportProgress {
            export_id: export_id.clone(),
            rows_exported: progress_rows.load(Ordering::Relaxed),
            batches: progress_batches.load(Ordering::Relaxed),
            terminal: true,
            status: status.to_string(),
            message,
        },
    );
    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) if cancellation_requested || error.contains(TABLE_EXPORT_CANCELLED) => {
            Ok(Response::err(
                TABLE_EXPORT_CANCELLED,
                "Database SQL export cancelled and the partial file was removed.",
            ))
        }
        Err(error) => Ok(Response::err("EXPORT_DATABASE_SQL_ERROR", &error)),
    }
}
