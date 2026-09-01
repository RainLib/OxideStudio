use crate::core::{
    database_search::{
        build_database_search_sql as build_sql, build_search_result_where as build_where,
        validate_database_search_options, validate_search_result_batch_options,
        validate_search_result_where_options, DatabaseSearchDialect, DatabaseSearchSql,
        DatabaseSearchSqlOptions, SearchResultWhereBatchOptions, SearchResultWhereOptions,
    },
    dialect::database_capabilities_for_driver,
    manager::ConnectionManager,
    protocol::{QueryResult, Response},
};
use serde::Serialize;
use tauri::State;

use super::query::{execute_query_with_cancellation, QueryCancellationState};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSearchExecution {
    pub searchable_columns: Vec<String>,
    pub results: Vec<QueryResult>,
}

fn database_query_scope(
    database: Option<String>,
    supports_database_catalogs: bool,
) -> Option<String> {
    database.filter(|_| supports_database_catalogs)
}

async fn connection_search_dialect(
    manager: &ConnectionManager,
    connection_id: &str,
) -> Result<DatabaseSearchDialect, String> {
    connection_search_context(manager, connection_id)
        .await
        .map(|(dialect, _)| dialect)
}

async fn connection_search_context(
    manager: &ConnectionManager,
    connection_id: &str,
) -> Result<(DatabaseSearchDialect, bool), String> {
    let driver = manager
        .connection_driver_id(connection_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The live connection has no verified driver identity".to_string())?;
    let capabilities = match manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?
    {
        Some(capabilities) => capabilities,
        None => database_capabilities_for_driver(&driver).map_err(|error| error.to_string())?,
    };
    let supports_database_catalogs = capabilities.supports_database_catalogs;
    Ok((
        DatabaseSearchDialect::from_connection(&driver, &capabilities)?,
        supports_database_catalogs,
    ))
}

#[tauri::command]
pub async fn build_database_search_sql(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    options: DatabaseSearchSqlOptions,
) -> Result<Response<Option<DatabaseSearchSql>>, String> {
    if let Err(error) = validate_database_search_options(&options) {
        return Ok(Response::err("DATABASE_SEARCH_INVALID_OPTIONS", &error));
    }
    match connection_search_dialect(&manager, &connection_id).await {
        Ok(dialect) => Ok(Response::ok(build_sql(&dialect, options))),
        Err(error) => Ok(Response::err("DATABASE_SEARCH_UNAVAILABLE", &error)),
    }
}

#[tauri::command]
pub async fn build_search_result_where(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    options: SearchResultWhereOptions,
) -> Result<Response<String>, String> {
    if let Err(error) = validate_search_result_where_options(&options) {
        return Ok(Response::err("DATABASE_SEARCH_INVALID_RESULT", &error));
    }
    match connection_search_dialect(&manager, &connection_id).await {
        Ok(dialect) => Ok(Response::ok(build_where(&dialect, options))),
        Err(error) => Ok(Response::err("DATABASE_SEARCH_UNAVAILABLE", &error)),
    }
}

#[tauri::command]
pub async fn build_search_result_wheres(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    options: SearchResultWhereBatchOptions,
) -> Result<Response<Vec<String>>, String> {
    if let Err(error) = validate_search_result_batch_options(&options) {
        return Ok(Response::err(
            "DATABASE_SEARCH_INVALID_RESULT_BATCH",
            &error,
        ));
    }
    match connection_search_dialect(&manager, &connection_id).await {
        Ok(dialect) => Ok(Response::ok(
            options
                .rows
                .into_iter()
                .zip(options.matched_columns)
                .map(|(row, matched_columns)| {
                    build_where(
                        &dialect,
                        SearchResultWhereOptions {
                            columns: options.columns.clone(),
                            result_columns: options.result_columns.clone(),
                            row,
                            matched_columns,
                        },
                    )
                })
                .collect(),
        )),
        Err(error) => Ok(Response::err("DATABASE_SEARCH_UNAVAILABLE", &error)),
    }
}

/// Execute one Host-generated, bounded SELECT for database search. The
/// renderer supplies structured table metadata, never executable SQL. This
/// keeps search available to reviewed SQL driver packages whose dialect does
/// not support the generic PostgreSQL/MySQL read-only transaction wrapper.
#[tauri::command]
pub async fn execute_database_search(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, QueryCancellationState>,
    connection_id: String,
    database: Option<String>,
    query_id: String,
    options: DatabaseSearchSqlOptions,
) -> Result<Response<DatabaseSearchExecution>, String> {
    if let Err(error) = validate_database_search_options(&options) {
        return Ok(Response::err("DATABASE_SEARCH_INVALID_OPTIONS", &error));
    }
    let (dialect, supports_database_catalogs) =
        match connection_search_context(&manager, &connection_id).await {
            Ok(context) => context,
            Err(error) => return Ok(Response::err("DATABASE_SEARCH_UNAVAILABLE", &error)),
        };
    let schema = options.schema.clone();
    let Some(search) = build_sql(&dialect, options) else {
        return Ok(Response::ok(DatabaseSearchExecution {
            searchable_columns: Vec::new(),
            results: Vec::new(),
        }));
    };
    let response = execute_query_with_cancellation(
        &manager,
        &cancellation,
        connection_id,
        search.sql,
        schema,
        None,
        Some(query_id),
        database_query_scope(database, supports_database_catalogs),
    )
    .await?;
    if response.success {
        return Ok(Response::ok(DatabaseSearchExecution {
            searchable_columns: search.searchable_columns,
            results: response.data.unwrap_or_default(),
        }));
    }
    Ok(Response {
        success: false,
        data: None,
        error: response.error,
    })
}

#[cfg(test)]
mod tests {
    use super::database_query_scope;

    #[test]
    fn database_query_routing_requires_a_verified_catalog_capability() {
        assert_eq!(
            database_query_scope(Some("analytics".into()), true),
            Some("analytics".into())
        );
        assert_eq!(database_query_scope(Some("analytics".into()), false), None);
        assert_eq!(database_query_scope(None, true), None);
    }
}
