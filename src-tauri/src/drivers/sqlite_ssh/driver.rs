use crate::core::driver::{
    DatabaseDriver, LocalDatabaseBackupControl, LocalDatabaseFileReceipt, SqliteRebuildReceipt,
};
use crate::core::protocol::{
    ColumnInfo, ConstraintInfo, IndexInfo, ParameterizedStatement, QueryParameter, QueryResult,
    SchemaObjectInfo, TableInfo,
};
use crate::core::statement::StatementScanDialect;
use anyhow::{anyhow, bail, Result};
use async_trait::async_trait;
use oxide_sqlite_worker::{MetadataRequest, WorkerOperation};
use std::collections::BTreeMap;
use std::path::Path;

use super::metadata::{integer_at, normalized_schema, quote_identifier, string_at};
use super::models::RemoteSqliteDriver;
use super::response::{expect_file, expect_ok, verify_local_sqlite_file};
use super::runtime::require_transaction;

#[async_trait]
impl DatabaseDriver for RemoteSqliteDriver {
    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        None
    }

    async fn server_version(&self) -> Option<String> {
        Some(self.sqlite_version.clone())
    }

    async fn connect(&mut self) -> Result<()> {
        self.ping().await
    }

    async fn disconnect(&self) -> Result<()> {
        self.client.shutdown().await;
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        expect_ok(self.client.roundtrip(WorkerOperation::Ping).await?)
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("running a query outside its transaction session")
            .await?;
        self.run_script(None, sql).await
    }

    async fn query_tracked(&self, query_id: Option<&str>, sql: &str) -> Result<Vec<QueryResult>> {
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("running a query outside its transaction session")
            .await?;
        self.run_script(query_id, sql).await
    }

    async fn execute_parameterized(&self, sql: &str, params: &[QueryParameter]) -> Result<u64> {
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("executing a mutation outside its transaction session")
            .await?;
        Ok(self
            .run_statement(None, sql, params)
            .await?
            .rows_affected
            .unwrap_or(0))
    }

    async fn query_parameterized(
        &self,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("running a query outside its transaction session")
            .await?;
        Ok(vec![self.run_statement(None, sql, params).await?])
    }

    async fn execute_parameterized_batch(
        &self,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("a parameterized batch").await?;
        self.run_statement(None, "BEGIN", &[]).await?;
        let mut affected = Vec::with_capacity(statements.len());
        for statement in statements {
            match self
                .run_statement(None, &statement.sql, &statement.params)
                .await
            {
                Ok(result) => affected.push(result.rows_affected.unwrap_or(0)),
                Err(error) => {
                    let _ = self.run_statement(None, "ROLLBACK", &[]).await;
                    return Err(error);
                }
            }
        }
        self.run_statement(None, "COMMIT", &[]).await?;
        Ok(affected)
    }

    async fn execute_sqlite_rebuild_batch(
        &self,
        statements: &[ParameterizedStatement],
        backup_destination: &Path,
    ) -> Result<SqliteRebuildReceipt> {
        if self.read_only {
            bail!("SQLite schema rebuild is unavailable through a read-only remote connection");
        }
        super::super::sqlite::validate_sqlite_rebuild_statements(statements)?;
        let _file_operation = self.file_operation.lock().await;
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("schema rebuild").await?;
        let foreign_keys_enabled = self
            .run_statement(None, "PRAGMA foreign_keys", &[])
            .await?
            .rows
            .first()
            .and_then(|row| row.first())
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0)
            != 0;
        self.run_execute_statement(None, "PRAGMA foreign_keys = OFF", &[])
            .await?;
        let suspended = self
            .run_statement(None, "PRAGMA foreign_keys", &[])
            .await?
            .rows
            .first()
            .and_then(|row| row.first())
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(1)
            == 0;
        if !suspended {
            bail!(
                "Remote SQLite refused to suspend foreign-key enforcement for the reviewed rebuild"
            );
        }
        self.run_statement(None, "BEGIN IMMEDIATE", &[]).await?;
        let apply_result: Result<SqliteRebuildReceipt> = async {
            let backup = self
                .backup_controlled_locked(
                    backup_destination,
                    &LocalDatabaseBackupControl::default(),
                )
                .await?;
            for statement in statements {
                self.run_statement(None, &statement.sql, &statement.params)
                    .await?;
            }
            if !self
                .run_statement(None, "PRAGMA foreign_key_check", &[])
                .await?
                .rows
                .is_empty()
            {
                bail!("Remote SQLite foreign_key_check found a violation; the rebuild was rolled back");
            }
            self.run_statement(None, "COMMIT", &[]).await?;
            Ok(SqliteRebuildReceipt {
                backup,
                statements_applied: statements.len(),
            })
        }
        .await;
        if apply_result.is_err() {
            let _ = self.run_statement(None, "ROLLBACK", &[]).await;
        }
        let restore_result = if foreign_keys_enabled {
            async {
                self.run_execute_statement(None, "PRAGMA foreign_keys = ON", &[])
                    .await?;
                let restored = self
                    .run_statement(None, "PRAGMA foreign_keys", &[])
                    .await?
                    .rows
                    .first()
                    .and_then(|row| row.first())
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or(0)
                    != 0;
                if !restored {
                    bail!(
                        "Remote SQLite foreign-key enforcement could not be restored after rebuild"
                    );
                }
                Ok(())
            }
            .await
        } else {
            Ok(())
        };
        match (apply_result, restore_result) {
            (Ok(receipt), Ok(())) => Ok(receipt),
            (Err(error), Ok(())) => Err(error),
            (Ok(_), Err(error)) => Err(error),
            (Err(error), Err(restore_error)) => Err(anyhow!(
                "{error}; remote SQLite foreign-key setting restoration also failed: {restore_error}"
            )),
        }
    }

    async fn begin_transaction(&self, session_id: &str, _schema: Option<&str>) -> Result<()> {
        let _operation = self.operation_gate.lock().await;
        let mut active = self.transaction.lock().await;
        if active.is_some() {
            bail!("Remote SQLite already has an active transaction");
        }
        self.run_statement(None, "BEGIN", &[]).await?;
        *active = Some(session_id.to_string());
        Ok(())
    }

    async fn query_transaction(&self, session_id: &str, sql: &str) -> Result<Vec<QueryResult>> {
        let _operation = self.operation_gate.lock().await;
        require_transaction(&self.transaction, session_id).await?;
        self.run_script(None, sql).await
    }

    async fn query_transaction_tracked(
        &self,
        query_id: Option<&str>,
        session_id: &str,
        sql: &str,
    ) -> Result<Vec<QueryResult>> {
        let _operation = self.operation_gate.lock().await;
        require_transaction(&self.transaction, session_id).await?;
        self.run_script(query_id, sql).await
    }

    async fn execute_parameterized_transaction(
        &self,
        session_id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let _operation = self.operation_gate.lock().await;
        require_transaction(&self.transaction, session_id).await?;
        let mut affected = Vec::with_capacity(statements.len());
        for statement in statements {
            affected.push(
                self.run_statement(None, &statement.sql, &statement.params)
                    .await?
                    .rows_affected
                    .unwrap_or(0),
            );
        }
        Ok(affected)
    }

    async fn cancel_query(&self, query_id: &str) -> Result<bool> {
        self.client.cancel_tracked(query_id).await
    }

    async fn commit_transaction(&self, session_id: &str) -> Result<()> {
        let _operation = self.operation_gate.lock().await;
        require_transaction(&self.transaction, session_id).await?;
        self.run_statement(None, "COMMIT", &[]).await?;
        *self.transaction.lock().await = None;
        Ok(())
    }

    async fn rollback_transaction(&self, session_id: &str) -> Result<()> {
        let _operation = self.operation_gate.lock().await;
        require_transaction(&self.transaction, session_id).await?;
        self.run_statement(None, "ROLLBACK", &[]).await?;
        *self.transaction.lock().await = None;
        Ok(())
    }

    async fn backup_local_database(&self, destination: &Path) -> Result<LocalDatabaseFileReceipt> {
        self.backup_controlled(destination, &LocalDatabaseBackupControl::default())
            .await
    }

    async fn backup_local_database_controlled(
        &self,
        destination: &Path,
        control: &LocalDatabaseBackupControl,
    ) -> Result<LocalDatabaseFileReceipt> {
        self.backup_controlled(destination, control).await
    }

    async fn restore_local_database(&self, source: &Path) -> Result<LocalDatabaseFileReceipt> {
        if self.read_only {
            bail!("Restore is unavailable through a read-only remote SQLite connection");
        }
        let _file_operation = self.file_operation.lock().await;
        let _operation = self.operation_gate.lock().await;
        self.require_no_transaction("restore").await?;
        let integrity = verify_local_sqlite_file(source).await?;
        let byte_len = std::fs::metadata(source)?.len();
        let remote_path = self.client.remote_transfer_path("restore").await?;
        let result = async {
            let uploaded = self
                .client
                .session
                .upload_local_file_atomic(source, &remote_path)
                .await?;
            if uploaded != byte_len {
                bail!("Uploaded SQLite restore size changed in transit");
            }
            let response = self
                .client
                .roundtrip(WorkerOperation::Restore {
                    source: remote_path.clone(),
                })
                .await?;
            let (restored_bytes, restored_integrity) = expect_file(response)?;
            if restored_bytes != byte_len || !restored_integrity.eq_ignore_ascii_case(&integrity) {
                bail!("Remote SQLite restore receipt does not match the reviewed source");
            }
            Ok(LocalDatabaseFileReceipt {
                byte_len,
                integrity_check: integrity,
            })
        }
        .await;
        if let Err(error) = self.client.session.remove_file(&remote_path).await {
            tracing::warn!(
                remote_path,
                "Failed to remove remote SQLite restore transfer: {error}"
            );
        }
        result
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        let table = self.metadata(MetadataRequest::Schemas).await?;
        let name = table.column_index("name").unwrap_or(1);
        let mut schemas = table
            .rows
            .iter()
            .filter_map(|row| string_at(row, name))
            .collect::<Vec<_>>();
        schemas.sort();
        schemas.dedup();
        Ok(schemas)
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let schema = normalized_schema(schema);
        let table = self
            .metadata(MetadataRequest::Tables {
                schema: schema.to_string(),
            })
            .await?;
        let name = table.column_index("name").unwrap_or(0);
        let kind = table.column_index("type").unwrap_or(1);
        Ok(table
            .rows
            .iter()
            .filter_map(|row| {
                Some(TableInfo {
                    name: string_at(row, name)?,
                    schema: Some(schema.to_string()),
                    table_type: string_at(row, kind),
                    comment: None,
                })
            })
            .collect())
    }

    async fn get_columns(&self, schema: &str, table_name: &str) -> Result<Vec<ColumnInfo>> {
        let schema = normalized_schema(schema);
        let table = self
            .metadata(MetadataRequest::Columns {
                schema: schema.into(),
                table: table_name.into(),
            })
            .await?;
        let indexes = self.get_indexes(schema, table_name).await?;
        let name = table.required_column("name")?;
        let data_type = table.required_column("type")?;
        let not_null = table.required_column("notnull")?;
        let default = table.required_column("dflt_value")?;
        let primary = table.required_column("pk")?;
        let hidden = table.column_index("hidden");
        Ok(table
            .rows
            .iter()
            .filter_map(|row| {
                let name = string_at(row, name)?;
                let hidden = hidden.and_then(|index| integer_at(row, index)).unwrap_or(0);
                Some(ColumnInfo {
                    name: name.clone(),
                    data_type: string_at(row, data_type).unwrap_or_else(|| "TEXT".into()),
                    is_nullable: integer_at(row, not_null).unwrap_or(0) == 0,
                    is_primary_key: integer_at(row, primary).unwrap_or(0) > 0,
                    is_unique: indexes
                        .iter()
                        .any(|index| index.is_unique && index.columns.contains(&name)),
                    is_indexed: indexes.iter().any(|index| index.columns.contains(&name)),
                    is_auto_increment: false,
                    identity_generation: None,
                    is_generated: Some(hidden >= 2),
                    is_hidden: Some(hidden == 1),
                    default_value: string_at(row, default),
                    comment: None,
                })
            })
            .collect())
    }

    async fn get_generated_columns(&self, schema: &str, table_name: &str) -> Result<Vec<String>> {
        Ok(self
            .get_columns(schema, table_name)
            .await?
            .into_iter()
            .filter(|column| column.is_generated == Some(true))
            .map(|column| column.name)
            .collect())
    }

    async fn get_indexes(&self, schema: &str, table_name: &str) -> Result<Vec<IndexInfo>> {
        let schema = normalized_schema(schema);
        let list = self
            .metadata(MetadataRequest::Indexes {
                schema: schema.into(),
                table: table_name.into(),
            })
            .await?;
        let name_index = list.required_column("name")?;
        let unique_index = list.required_column("unique")?;
        let origin_index = list.column_index("origin");
        let mut indexes = Vec::new();
        for row in &list.rows {
            let Some(name) = string_at(row, name_index) else {
                continue;
            };
            let columns = self
                .run_statement(
                    None,
                    &format!(
                        "PRAGMA {}.index_info({})",
                        quote_identifier(schema)?,
                        quote_identifier(&name)?
                    ),
                    &[],
                )
                .await?;
            let name_column = columns
                .columns
                .iter()
                .position(|column| column.name == "name")
                .unwrap_or(2);
            let definition_result = self
                .run_statement(
                    None,
                    &format!(
                        "SELECT sql FROM {}.sqlite_schema WHERE type = 'index' AND name = $1 AND tbl_name = $2",
                        quote_identifier(schema)?
                    ),
                    &[
                        QueryParameter {
                            value: serde_json::Value::String(name.clone()),
                            data_type: Some("TEXT".into()),
                        },
                        QueryParameter {
                            value: serde_json::Value::String(table_name.to_string()),
                            data_type: Some("TEXT".into()),
                        },
                    ],
                )
                .await?;
            let definition = definition_result
                .rows
                .first()
                .and_then(|row| row.first())
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .filter(|sql| !sql.trim().is_empty());
            indexes.push(IndexInfo {
                name,
                columns: columns
                    .rows
                    .iter()
                    .filter_map(|row| string_at(row, name_column))
                    .collect(),
                is_unique: integer_at(row, unique_index).unwrap_or(0) != 0,
                is_primary: origin_index
                    .and_then(|index| string_at(row, index))
                    .is_some_and(|origin| origin == "pk"),
                filter: None,
                index_type: Some("BTREE".into()),
                included_columns: None,
                definition,
                comment: None,
                key_is_expression: Vec::new(),
            });
        }
        Ok(indexes)
    }

    async fn get_constraints(&self, schema: &str, table_name: &str) -> Result<Vec<ConstraintInfo>> {
        let schema = normalized_schema(schema);
        let table = self
            .metadata(MetadataRequest::ForeignKeys {
                schema: schema.into(),
                table: table_name.into(),
            })
            .await?;
        let id = table.required_column("id")?;
        let sequence = table.required_column("seq")?;
        let referenced_table = table.required_column("table")?;
        let from = table.required_column("from")?;
        let to = table.required_column("to")?;
        let on_update = table.column_index("on_update");
        let on_delete = table.column_index("on_delete");
        let mut grouped = BTreeMap::<i64, Vec<&Vec<serde_json::Value>>>::new();
        for row in &table.rows {
            grouped
                .entry(integer_at(row, id).unwrap_or_default())
                .or_default()
                .push(row);
        }
        Ok(grouped
            .into_iter()
            .map(|(id, mut rows)| {
                rows.sort_by_key(|row| integer_at(row, sequence).unwrap_or_default());
                ConstraintInfo {
                    name: format!("fk_{table_name}_{id}"),
                    constraint_type: "FOREIGN KEY".into(),
                    columns: rows.iter().filter_map(|row| string_at(row, from)).collect(),
                    referenced_schema: Some(schema.into()),
                    referenced_table: rows
                        .first()
                        .and_then(|row| string_at(row, referenced_table)),
                    referenced_columns: rows.iter().filter_map(|row| string_at(row, to)).collect(),
                    definition: None,
                    on_update: rows
                        .first()
                        .and_then(|row| on_update.and_then(|index| string_at(row, index))),
                    on_delete: rows
                        .first()
                        .and_then(|row| on_delete.and_then(|index| string_at(row, index))),
                }
            })
            .collect())
    }

    async fn get_schema_objects(&self, schema: &str) -> Result<Vec<SchemaObjectInfo>> {
        let schema = normalized_schema(schema);
        let result = self
            .run_statement(
                None,
                &format!(
                    "SELECT name, tbl_name FROM {}.sqlite_schema \
                     WHERE type = 'trigger' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name",
                    quote_identifier(schema)?
                ),
                &[],
            )
            .await?;
        let name = result
            .columns
            .iter()
            .position(|column| column.name == "name")
            .unwrap_or(0);
        let parent_name = result
            .columns
            .iter()
            .position(|column| column.name == "tbl_name")
            .unwrap_or(1);
        Ok(result
            .rows
            .iter()
            .filter_map(|row| {
                Some(SchemaObjectInfo {
                    name: string_at(row, name)?,
                    schema: Some(schema.to_string()),
                    object_type: "trigger".to_string(),
                    parent_name: Some(string_at(row, parent_name)?),
                    comment: None,
                    members_expandable: false,
                })
            })
            .collect())
    }
}
