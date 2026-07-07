use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

struct LspProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl LspProcess {
    async fn spawn_bundled() -> Result<Option<Self>> {
        let binary = bundled_lsp_binary();
        if !binary.exists() {
            eprintln!("skipping bundled LSP test; binary not found at {binary:?}");
            return Ok(None);
        }

        let mut child = match Command::new(&binary)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(error) if error.raw_os_error() == Some(8) => {
                eprintln!("skipping bundled LSP test; binary is not executable on this platform");
                return Ok(None);
            }
            Err(error) => return Err(error).with_context(|| format!("spawn {binary:?}")),
        };

        let stdin = child.stdin.take().context("missing LSP stdin")?;
        let stdout = child.stdout.take().context("missing LSP stdout")?;

        Ok(Some(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
        }))
    }

    async fn initialize(&mut self) -> Result<()> {
        self.request(
            "initialize",
            json!({
                "processId": null,
                "rootUri": null,
                "capabilities": {
                    "textDocument": {
                        "completion": {
                            "completionItem": {
                                "snippetSupport": true
                            }
                        },
                        "hover": {
                            "contentFormat": ["markdown", "plaintext"]
                        },
                        "definition": {},
                        "references": {},
                        "formatting": {},
                        "publishDiagnostics": {},
                        "synchronization": {
                            "didSave": true,
                            "didChange": true,
                            "didOpen": true,
                            "didClose": true
                        }
                    },
                    "workspace": {
                        "configuration": true
                    }
                }
            }),
        )
        .await?;
        self.notify("initialized", json!({})).await
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;

        self.write_message(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        }))
        .await?;

        loop {
            let message = self.read_message().await?;
            if message.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }

            if let Some(error) = message.get("error") {
                bail!("LSP request {method} failed: {error}");
            }

            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<()> {
        self.write_message(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }))
        .await
    }

    async fn shutdown(mut self) -> Result<()> {
        let _ = self.request("shutdown", Value::Null).await;
        let _ = self.notify("exit", Value::Null).await;

        tokio::select! {
            status = self.child.wait() => {
                status.context("wait for LSP shutdown")?;
            }
            _ = tokio::time::sleep(Duration::from_secs(2)) => {
                let _ = self.child.kill().await;
            }
        }

        Ok(())
    }

    async fn write_message(&mut self, message: &Value) -> Result<()> {
        let body = serde_json::to_vec(message)?;
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        self.stdin.write_all(header.as_bytes()).await?;
        self.stdin.write_all(&body).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    async fn read_message(&mut self) -> Result<Value> {
        let mut content_length = None;

        loop {
            let mut line = String::new();
            let read =
                tokio::time::timeout(Duration::from_secs(5), self.stdout.read_line(&mut line))
                    .await
                    .context("timed out reading LSP header")??;

            if read == 0 {
                bail!("LSP stdout closed");
            }

            let header = line.trim_end_matches(['\r', '\n']);
            if header.is_empty() {
                break;
            }

            if let Some(value) = header.strip_prefix("Content-Length:") {
                content_length = Some(value.trim().parse::<usize>()?);
            }
        }

        let length = content_length.ok_or_else(|| anyhow!("missing Content-Length header"))?;
        let mut body = vec![0u8; length];
        tokio::time::timeout(Duration::from_secs(5), self.stdout.read_exact(&mut body))
            .await
            .context("timed out reading LSP body")??;

        Ok(serde_json::from_slice(&body)?)
    }
}

#[tokio::test]
async fn bundled_sql_lsp_serves_schema_aware_completions() -> Result<()> {
    let Some(mut lsp) = LspProcess::spawn_bundled().await? else {
        return Ok(());
    };

    lsp.initialize().await?;

    let redis_uri = "file:///oxide/redis.redis";
    let mongodb_uri = "file:///oxide/mongodb.mongodb";
    let elasticsearch_uri = "file:///oxide/elasticsearch.es.dsl";
    let hive_where_uri = "file:///oxide/hive-where.sql";
    let hive_having_uri = "file:///oxide/hive-having.sql";
    let clickhouse_where_uri = "file:///oxide/clickhouse-where.sql";
    let clickhouse_having_uri = "file:///oxide/clickhouse-having.sql";
    let postgres_uri = "file:///oxide/postgres.sql";
    let postgres_select_continuation_uri = "file:///oxide/postgres-select-continuation.sql";
    let postgres_select_wildcard_uri = "file:///oxide/postgres-select-wildcard.sql";
    let postgres_from_continuation_uri = "file:///oxide/postgres-from-continuation.sql";
    let postgres_join_condition_uri = "file:///oxide/postgres-join-condition.sql";
    let postgres_where_uri = "file:///oxide/postgres-where.sql";
    let postgres_where_operator_uri = "file:///oxide/postgres-where-operator.sql";
    let postgres_where_value_uri = "file:///oxide/postgres-where-value.sql";
    let postgres_where_in_value_uri = "file:///oxide/postgres-where-in-value.sql";
    let postgres_where_between_uri = "file:///oxide/postgres-where-between.sql";
    let postgres_where_continuation_uri = "file:///oxide/postgres-where-continuation.sql";
    let postgres_case_when_uri = "file:///oxide/postgres-case-when.sql";
    let postgres_case_then_uri = "file:///oxide/postgres-case-then.sql";
    let postgres_case_then_continuation_uri = "file:///oxide/postgres-case-then-continuation.sql";
    let postgres_simple_case_uri = "file:///oxide/postgres-simple-case.sql";
    let postgres_simple_case_continuation_uri =
        "file:///oxide/postgres-simple-case-continuation.sql";
    let postgres_having_uri = "file:///oxide/postgres-having.sql";
    let postgres_having_operator_uri = "file:///oxide/postgres-having-operator.sql";
    let postgres_group_continuation_uri = "file:///oxide/postgres-group-continuation.sql";
    let postgres_order_direction_uri = "file:///oxide/postgres-order-direction.sql";
    let postgres_order_after_direction_uri = "file:///oxide/postgres-order-after-direction.sql";
    let postgres_qualified_uri = "file:///oxide/postgres-qualified.sql";
    let postgres_insert_action_uri = "file:///oxide/postgres-insert-action.sql";
    let postgres_insert_value_uri = "file:///oxide/postgres-insert-value.sql";
    let postgres_insert_continuation_uri = "file:///oxide/postgres-insert-continuation.sql";
    let postgres_insert_conflict_target_uri = "file:///oxide/postgres-insert-conflict-target.sql";
    let postgres_insert_conflict_action_uri = "file:///oxide/postgres-insert-conflict-action.sql";
    let postgres_insert_conflict_constraint_uri =
        "file:///oxide/postgres-insert-conflict-constraint.sql";
    let postgres_insert_conflict_constraint_action_uri =
        "file:///oxide/postgres-insert-conflict-constraint-action.sql";
    let postgres_insert_conflict_update_set_uri =
        "file:///oxide/postgres-insert-conflict-update-set.sql";
    let postgres_insert_conflict_update_operator_uri =
        "file:///oxide/postgres-insert-conflict-update-operator.sql";
    let postgres_insert_conflict_update_value_uri =
        "file:///oxide/postgres-insert-conflict-update-value.sql";
    let postgres_insert_conflict_update_continuation_uri =
        "file:///oxide/postgres-insert-conflict-update-continuation.sql";
    let postgres_update_action_uri = "file:///oxide/postgres-update-action.sql";
    let postgres_update_value_uri = "file:///oxide/postgres-update-value.sql";
    let postgres_update_continuation_uri = "file:///oxide/postgres-update-continuation.sql";
    let postgres_delete_action_uri = "file:///oxide/postgres-delete-action.sql";
    let postgres_drop_index_uri = "file:///oxide/postgres-drop-index.sql";
    let postgres_create_index_uri = "file:///oxide/postgres-create-index.sql";
    let postgres_create_index_columns_uri = "file:///oxide/postgres-create-index-columns.sql";
    let postgres_join_using_uri = "file:///oxide/postgres-join-using.sql";
    let postgres_alter_action_uri = "file:///oxide/postgres-alter-action.sql";
    let postgres_alter_column_uri = "file:///oxide/postgres-alter-column.sql";
    let postgres_alter_constraint_uri = "file:///oxide/postgres-alter-constraint.sql";
    let postgres_create_table_type_uri = "file:///oxide/postgres-create-table-type.sql";
    let postgres_alter_column_type_uri = "file:///oxide/postgres-alter-column-type.sql";
    let postgres_references_table_uri = "file:///oxide/postgres-references-table.sql";
    let postgres_references_columns_uri = "file:///oxide/postgres-references-columns.sql";
    let postgres_references_action_uri = "file:///oxide/postgres-references-action.sql";
    let postgres_references_rule_uri = "file:///oxide/postgres-references-rule.sql";
    let mysql_modify_column_uri = "file:///oxide/mysql-modify-column.sql";
    let mysql_insert_duplicate_set_uri = "file:///oxide/mysql-insert-duplicate-set.sql";
    let mysql_insert_duplicate_operator_uri = "file:///oxide/mysql-insert-duplicate-operator.sql";
    let mysql_insert_duplicate_value_uri = "file:///oxide/mysql-insert-duplicate-value.sql";
    let mysql_insert_duplicate_continuation_uri =
        "file:///oxide/mysql-insert-duplicate-continuation.sql";

    let mut file_schemas = Map::new();
    file_schemas.insert(
        redis_uri.to_string(),
        json!("11111111-1111-4111-8111-111111111111"),
    );
    file_schemas.insert(
        mongodb_uri.to_string(),
        json!("22222222-2222-4222-8222-222222222222"),
    );
    file_schemas.insert(
        elasticsearch_uri.to_string(),
        json!("33333333-3333-4333-8333-333333333333"),
    );
    file_schemas.insert(
        hive_where_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        hive_having_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        clickhouse_where_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        clickhouse_having_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_select_continuation_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_select_wildcard_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_from_continuation_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_join_condition_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_where_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_where_operator_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_where_value_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_where_in_value_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_where_between_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_where_continuation_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_case_when_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_case_then_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_case_then_continuation_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_simple_case_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_simple_case_continuation_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_having_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_having_operator_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_group_continuation_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_order_direction_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_order_after_direction_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_qualified_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_insert_action_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_insert_value_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_insert_continuation_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_insert_conflict_target_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_insert_conflict_action_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_insert_conflict_constraint_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_insert_conflict_constraint_action_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_insert_conflict_update_set_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_insert_conflict_update_operator_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_insert_conflict_update_value_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_insert_conflict_update_continuation_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_update_action_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_update_value_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_update_continuation_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_delete_action_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_drop_index_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_create_index_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_create_index_columns_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_join_using_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_alter_action_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_alter_column_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_alter_constraint_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_create_table_type_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_alter_column_type_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_references_table_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_references_columns_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_references_action_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_references_rule_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        mysql_modify_column_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        mysql_insert_duplicate_set_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        mysql_insert_duplicate_operator_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        mysql_insert_duplicate_value_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        mysql_insert_duplicate_continuation_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );

    let mut file_dialects = Map::new();
    file_dialects.insert(redis_uri.to_string(), json!("redis"));
    file_dialects.insert(mongodb_uri.to_string(), json!("mongodb"));
    file_dialects.insert(elasticsearch_uri.to_string(), json!("elasticsearch-dsl"));
    file_dialects.insert(hive_where_uri.to_string(), json!("hive"));
    file_dialects.insert(hive_having_uri.to_string(), json!("hive"));
    file_dialects.insert(clickhouse_where_uri.to_string(), json!("clickhouse"));
    file_dialects.insert(clickhouse_having_uri.to_string(), json!("clickhouse"));
    file_dialects.insert(postgres_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_select_continuation_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_select_wildcard_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_from_continuation_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_join_condition_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_where_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_where_operator_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_where_value_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_where_in_value_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_where_between_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_where_continuation_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_case_when_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_case_then_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_case_then_continuation_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_simple_case_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_simple_case_continuation_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_having_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_having_operator_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_group_continuation_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_order_direction_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_order_after_direction_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_qualified_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_insert_action_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_insert_value_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_insert_continuation_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(
        postgres_insert_conflict_target_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(
        postgres_insert_conflict_action_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(
        postgres_insert_conflict_constraint_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(
        postgres_insert_conflict_constraint_action_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(
        postgres_insert_conflict_update_set_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(
        postgres_insert_conflict_update_operator_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(
        postgres_insert_conflict_update_value_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(
        postgres_insert_conflict_update_continuation_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_update_action_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_update_value_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_update_continuation_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_delete_action_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_drop_index_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_create_index_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_create_index_columns_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_join_using_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_alter_action_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_alter_column_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_alter_constraint_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_create_table_type_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(
        postgres_alter_column_type_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_references_table_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_references_columns_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(
        postgres_references_action_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_references_rule_uri.to_string(), json!("postgres"));
    file_dialects.insert(mysql_modify_column_uri.to_string(), json!("mysql"));
    file_dialects.insert(mysql_insert_duplicate_set_uri.to_string(), json!("mysql"));
    file_dialects.insert(
        mysql_insert_duplicate_operator_uri.to_string(),
        json!("mysql"),
    );
    file_dialects.insert(mysql_insert_duplicate_value_uri.to_string(), json!("mysql"));
    file_dialects.insert(
        mysql_insert_duplicate_continuation_uri.to_string(),
        json!("mysql"),
    );

    lsp.notify(
        "workspace/didChangeConfiguration",
        json!({
            "settings": {
                "defaultDialect": "postgres",
                "schemas": [
                    schema(
                        "11111111-1111-4111-8111-111111111111",
                        "redis",
                        "user:1",
                        "hash",
                        vec![
                            column("name", "string"),
                            column("email", "string")
                        ]
                    ),
                    schema(
                        "22222222-2222-4222-8222-222222222222",
                        "app",
                        "users",
                        "collection",
                        vec![
                            column("_id", "objectId"),
                            column("email", "string")
                        ]
                    ),
                    schema(
                        "33333333-3333-4333-8333-333333333333",
                        "search",
                        "users",
                        "index",
                        vec![
                            column("_id", "keyword"),
                            column("email", "keyword")
                        ]
                    ),
                    schema_with_tables(
                        "44444444-4444-4444-8444-444444444444",
                        "public",
                        vec![
                            table_with_metadata(
                                "webhook",
                                "table",
                                vec![
                                    column("owner", "varchar"),
                                    column("name", "varchar")
                                ],
                                vec![
                                    index("webhook_owner_idx", vec!["owner"], false, false),
                                    index("webhook_name_unique_idx", vec!["name"], true, false)
                                ],
                                vec![
                                    constraint("webhook_pkey", "PRIMARY KEY", vec!["owner", "name"]),
                                    constraint("webhook_owner_check", "CHECK", vec!["owner"])
                                ]
                            ),
                            table_with_metadata(
                                "form",
                                "table",
                                vec![
                                    column("owner", "varchar"),
                                    column("form_background_url", "varchar"),
                                    column("form_css", "text")
                                ],
                                vec![
                                    index("form_css_idx", vec!["form_css"], false, false)
                                ],
                                vec![
                                    constraint("form_pkey", "PRIMARY KEY", vec!["owner"])
                                ]
                            )
                        ]
                    )
                ],
                "fileSchemas": file_schemas,
                "fileDialects": file_dialects
            }
        }),
    )
    .await?;

    open_document(&mut lsp, redis_uri, "redis", "").await?;
    open_document(&mut lsp, mongodb_uri, "mongodb", "").await?;
    open_document(&mut lsp, elasticsearch_uri, "elasticsearch-dsl", "").await?;
    open_document(
        &mut lsp,
        hive_where_uri,
        "hive",
        "SELECT * FROM public.webhook WHERE ",
    )
    .await?;
    open_document(
        &mut lsp,
        hive_having_uri,
        "hive",
        "SELECT owner, COUNT(*) FROM public.webhook GROUP BY owner HAVING ",
    )
    .await?;
    open_document(
        &mut lsp,
        clickhouse_where_uri,
        "clickhouse",
        "SELECT * FROM public.webhook WHERE ",
    )
    .await?;
    open_document(
        &mut lsp,
        clickhouse_having_uri,
        "clickhouse",
        "SELECT owner, COUNT(*) FROM public.webhook GROUP BY owner HAVING ",
    )
    .await?;
    open_document(&mut lsp, postgres_uri, "postgres", "SELECT * from").await?;
    open_document(
        &mut lsp,
        postgres_select_continuation_uri,
        "postgres",
        "SELECT owner ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_select_wildcard_uri,
        "postgres",
        "SELECT * ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_from_continuation_uri,
        "postgres",
        "SELECT * from public.webhook ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_join_condition_uri,
        "postgres",
        "SELECT * from public.webhook JOIN public.form ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_where_uri,
        "postgres",
        "SELECT * from public.webhook where ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_where_operator_uri,
        "postgres",
        "SELECT * from public.webhook where owner ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_where_value_uri,
        "postgres",
        "SELECT * from public.webhook where owner = ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_where_in_value_uri,
        "postgres",
        "SELECT * from public.webhook where owner IN ('app', ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_where_between_uri,
        "postgres",
        "SELECT * from public.webhook where owner BETWEEN 1 ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_where_continuation_uri,
        "postgres",
        "SELECT * from public.webhook where owner = 'app' ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_case_when_uri,
        "postgres",
        "SELECT CASE WHEN owner = 'app' ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_case_then_uri,
        "postgres",
        "SELECT CASE WHEN owner = 'app' THEN ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_case_then_continuation_uri,
        "postgres",
        "SELECT CASE WHEN owner = 'app' THEN 'end' ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_simple_case_uri,
        "postgres",
        "SELECT CASE owner WHEN ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_simple_case_continuation_uri,
        "postgres",
        "SELECT CASE owner WHEN 'app' ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_having_uri,
        "postgres",
        "SELECT owner, count(*) from public.webhook group by owner having ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_having_operator_uri,
        "postgres",
        "SELECT owner, count(*) from public.webhook group by owner having count(*) ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_group_continuation_uri,
        "postgres",
        "SELECT owner, count(*) from public.webhook GROUP BY owner ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_order_direction_uri,
        "postgres",
        "SELECT * from public.webhook ORDER BY owner ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_order_after_direction_uri,
        "postgres",
        "SELECT * from public.webhook ORDER BY owner DESC ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_qualified_uri,
        "postgres",
        "SELECT * from public.fo",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_insert_action_uri,
        "postgres",
        "INSERT INTO public.webhook ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_insert_value_uri,
        "postgres",
        "INSERT INTO public.webhook (owner, name) VALUES (",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_insert_continuation_uri,
        "postgres",
        "INSERT INTO public.webhook (owner) VALUES ('app') ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_insert_conflict_target_uri,
        "postgres",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_insert_conflict_action_uri,
        "postgres",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_insert_conflict_constraint_uri,
        "postgres",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT ON CONSTRAINT ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_insert_conflict_constraint_action_uri,
        "postgres",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT ON CONSTRAINT webhook_pkey ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_insert_conflict_update_set_uri,
        "postgres",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_insert_conflict_update_operator_uri,
        "postgres",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET owner ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_insert_conflict_update_value_uri,
        "postgres",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET owner = ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_insert_conflict_update_continuation_uri,
        "postgres",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET owner = 'app' ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_update_action_uri,
        "postgres",
        "UPDATE public.webhook ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_update_value_uri,
        "postgres",
        "UPDATE public.webhook SET owner = ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_update_continuation_uri,
        "postgres",
        "UPDATE public.webhook SET owner = 'app' ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_delete_action_uri,
        "postgres",
        "DELETE FROM public.webhook ",
    )
    .await?;
    open_document(&mut lsp, postgres_drop_index_uri, "postgres", "DROP INDEX ").await?;
    open_document(
        &mut lsp,
        postgres_create_index_uri,
        "postgres",
        "CREATE INDEX webhook_owner_idx ON",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_create_index_columns_uri,
        "postgres",
        "CREATE INDEX webhook_owner_idx ON public.webhook (",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_join_using_uri,
        "postgres",
        "SELECT * from public.webhook w JOIN public.form f USING (",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_alter_action_uri,
        "postgres",
        "ALTER TABLE public.webhook ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_alter_column_uri,
        "postgres",
        "ALTER TABLE public.webhook DROP COLUMN ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_alter_constraint_uri,
        "postgres",
        "ALTER TABLE public.webhook DROP CONSTRAINT ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_create_table_type_uri,
        "postgres",
        "CREATE TABLE public.audit_log (owner ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_alter_column_type_uri,
        "postgres",
        "ALTER TABLE public.webhook ALTER COLUMN owner TYPE ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_references_table_uri,
        "postgres",
        "CREATE TABLE public.audit_log (owner varchar REFERENCES ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_references_columns_uri,
        "postgres",
        "CREATE TABLE public.audit_log (owner varchar REFERENCES public.webhook (",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_references_action_uri,
        "postgres",
        "CREATE TABLE public.audit_log (owner varchar REFERENCES public.webhook ",
    )
    .await?;
    open_document(
        &mut lsp,
        postgres_references_rule_uri,
        "postgres",
        "CREATE TABLE public.audit_log (owner varchar REFERENCES public.webhook ON DELETE ",
    )
    .await?;
    open_document(
        &mut lsp,
        mysql_modify_column_uri,
        "mysql",
        "ALTER TABLE public.webhook MODIFY COLUMN ",
    )
    .await?;
    open_document(
        &mut lsp,
        mysql_insert_duplicate_set_uri,
        "mysql",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE ",
    )
    .await?;
    open_document(
        &mut lsp,
        mysql_insert_duplicate_operator_uri,
        "mysql",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE owner ",
    )
    .await?;
    open_document(
        &mut lsp,
        mysql_insert_duplicate_value_uri,
        "mysql",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE owner = ",
    )
    .await?;
    open_document(
        &mut lsp,
        mysql_insert_duplicate_continuation_uri,
        "mysql",
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE owner = 'app' ",
    )
    .await?;

    assert_completion_contains(&mut lsp, redis_uri, &["GET", "user:1"]).await?;
    assert_completion_contains(&mut lsp, mongodb_uri, &["find", "users", "email"]).await?;
    assert_completion_contains(&mut lsp, elasticsearch_uri, &["match", "users", "email"]).await?;
    assert_completion_at_contains(
        &mut lsp,
        hive_where_uri,
        0,
        "SELECT * FROM public.webhook WHERE ".len() as u32,
        &["owner", "name"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        hive_where_uri,
        0,
        "SELECT * FROM public.webhook WHERE ".len() as u32,
        &["form_background_url", "public.form", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        hive_having_uri,
        0,
        "SELECT owner, COUNT(*) FROM public.webhook GROUP BY owner HAVING ".len() as u32,
        &["owner", "COUNT"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        hive_having_uri,
        0,
        "SELECT owner, COUNT(*) FROM public.webhook GROUP BY owner HAVING ".len() as u32,
        &["form_background_url", "public.form", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        clickhouse_where_uri,
        0,
        "SELECT * FROM public.webhook WHERE ".len() as u32,
        &["owner", "name"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        clickhouse_where_uri,
        0,
        "SELECT * FROM public.webhook WHERE ".len() as u32,
        &["form_background_url", "public.form", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        clickhouse_having_uri,
        0,
        "SELECT owner, COUNT(*) FROM public.webhook GROUP BY owner HAVING ".len() as u32,
        &["owner", "COUNT"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        clickhouse_having_uri,
        0,
        "SELECT owner, COUNT(*) FROM public.webhook GROUP BY owner HAVING ".len() as u32,
        &["form_background_url", "public.form", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_uri,
        0,
        "SELECT * from".len() as u32,
        &["public.webhook", "public.form"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_uri,
        0,
        "SELECT * from".len() as u32,
        &["owner", "name", "form_background_url"],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_select_continuation_uri,
        0,
        "SELECT owner ".len() as u32,
        &[",", "AS", "FROM"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_select_continuation_uri,
        0,
        "SELECT owner ".len() as u32,
        &["owner", "name", "public.webhook", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_select_wildcard_uri,
        0,
        "SELECT * ".len() as u32,
        &[",", "FROM"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_select_wildcard_uri,
        0,
        "SELECT * ".len() as u32,
        &["AS", "owner", "public.webhook", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_from_continuation_uri,
        0,
        "SELECT * from public.webhook ".len() as u32,
        &["JOIN", "WHERE", "GROUP BY", "ORDER BY", "LIMIT"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_from_continuation_uri,
        0,
        "SELECT * from public.webhook ".len() as u32,
        &["public.webhook", "public.form", "owner", "name", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_join_condition_uri,
        0,
        "SELECT * from public.webhook JOIN public.form ".len() as u32,
        &["ON", "USING"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_join_condition_uri,
        0,
        "SELECT * from public.webhook JOIN public.form ".len() as u32,
        &[
            "public.webhook",
            "public.form",
            "owner",
            "form_css",
            "WHERE",
        ],
    )
    .await?;
    let postgres_from_labels =
        sorted_completion_labels_at(&mut lsp, postgres_uri, 0, "SELECT * from".len() as u32)
            .await?;
    let first_two_from_labels = postgres_from_labels.iter().take(2).collect::<Vec<_>>();
    if !first_two_from_labels
        .iter()
        .any(|label| label.as_str() == "public.form")
        || !first_two_from_labels
            .iter()
            .any(|label| label.as_str() == "public.webhook")
    {
        bail!(
            "FROM completion should prioritize relation targets; labels: {:?}",
            postgres_from_labels
        );
    }
    assert_completion_at_contains(
        &mut lsp,
        postgres_where_uri,
        0,
        "SELECT * from public.webhook where ".len() as u32,
        &["owner", "name"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_where_uri,
        0,
        "SELECT * from public.webhook where ".len() as u32,
        &["!=", "=", "form_background_url", "form_css"],
    )
    .await?;
    let postgres_where_labels = sorted_completion_labels_at(
        &mut lsp,
        postgres_where_uri,
        0,
        "SELECT * from public.webhook where ".len() as u32,
    )
    .await?;
    let first_two_where_labels = postgres_where_labels.iter().take(2).collect::<Vec<_>>();
    if !first_two_where_labels
        .iter()
        .any(|label| label.as_str() == "owner")
        || !first_two_where_labels
            .iter()
            .any(|label| label.as_str() == "name")
    {
        bail!(
            "WHERE completion should prioritize current table columns; labels: {:?}",
            postgres_where_labels
        );
    }
    assert_completion_at_contains(
        &mut lsp,
        postgres_where_operator_uri,
        0,
        "SELECT * from public.webhook where owner ".len() as u32,
        &["!=", "="],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_where_operator_uri,
        0,
        "SELECT * from public.webhook where owner ".len() as u32,
        &["owner", "name", "form_background_url"],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_where_value_uri,
        0,
        "SELECT * from public.webhook where owner = ".len() as u32,
        &["NULL", "TRUE", "CURRENT_TIMESTAMP"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_where_value_uri,
        0,
        "SELECT * from public.webhook where owner = ".len() as u32,
        &["DEFAULT", "owner", "name", "public.webhook", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_where_in_value_uri,
        0,
        "SELECT * from public.webhook where owner IN ('app', ".len() as u32,
        &["NULL", "TRUE", "CURRENT_TIMESTAMP"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_where_in_value_uri,
        0,
        "SELECT * from public.webhook where owner IN ('app', ".len() as u32,
        &["DEFAULT", "owner", "name", "public.webhook", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_where_between_uri,
        0,
        "SELECT * from public.webhook where owner BETWEEN 1 ".len() as u32,
        &["AND"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_where_between_uri,
        0,
        "SELECT * from public.webhook where owner BETWEEN 1 ".len() as u32,
        &[
            "OR",
            "ORDER BY",
            "owner",
            "name",
            "public.webhook",
            "=",
            "!=",
        ],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_where_continuation_uri,
        0,
        "SELECT * from public.webhook where owner = 'app' ".len() as u32,
        &["AND", "OR", "ORDER BY"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_where_continuation_uri,
        0,
        "SELECT * from public.webhook where owner = 'app' ".len() as u32,
        &["owner", "name", "public.webhook", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_case_when_uri,
        0,
        "SELECT CASE WHEN owner = 'app' ".len() as u32,
        &["THEN", "AND", "OR"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_case_when_uri,
        0,
        "SELECT CASE WHEN owner = 'app' ".len() as u32,
        &["ORDER BY", "owner", "name", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_case_then_uri,
        0,
        "SELECT CASE WHEN owner = 'app' THEN ".len() as u32,
        &["NULL", "TRUE", "owner"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_case_then_uri,
        0,
        "SELECT CASE WHEN owner = 'app' THEN ".len() as u32,
        &["FROM", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_case_then_continuation_uri,
        0,
        "SELECT CASE WHEN owner = 'app' THEN 'end' ".len() as u32,
        &["WHEN", "ELSE", "END"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_case_then_continuation_uri,
        0,
        "SELECT CASE WHEN owner = 'app' THEN 'end' ".len() as u32,
        &["FROM", "owner", "name", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_simple_case_uri,
        0,
        "SELECT CASE owner WHEN ".len() as u32,
        &["NULL", "TRUE", "owner"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_simple_case_uri,
        0,
        "SELECT CASE owner WHEN ".len() as u32,
        &["FROM", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_simple_case_continuation_uri,
        0,
        "SELECT CASE owner WHEN 'app' ".len() as u32,
        &["THEN"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_simple_case_continuation_uri,
        0,
        "SELECT CASE owner WHEN 'app' ".len() as u32,
        &["AND", "OR", "owner", "name", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_order_direction_uri,
        0,
        "SELECT * from public.webhook ORDER BY owner ".len() as u32,
        &["ASC", "DESC", "NULLS FIRST", "NULLS LAST"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_order_direction_uri,
        0,
        "SELECT * from public.webhook ORDER BY owner ".len() as u32,
        &["owner", "name", "public.form", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_order_after_direction_uri,
        0,
        "SELECT * from public.webhook ORDER BY owner DESC ".len() as u32,
        &["NULLS FIRST", "NULLS LAST", "LIMIT"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_order_after_direction_uri,
        0,
        "SELECT * from public.webhook ORDER BY owner DESC ".len() as u32,
        &["ASC", "DESC", "owner", "name", "public.form", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_having_uri,
        0,
        "SELECT owner, count(*) from public.webhook group by owner having ".len() as u32,
        &["owner", "name", "COUNT"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_having_uri,
        0,
        "SELECT owner, count(*) from public.webhook group by owner having ".len() as u32,
        &["!=", "=", "form_background_url", "form_css"],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_having_operator_uri,
        0,
        "SELECT owner, count(*) from public.webhook group by owner having count(*) ".len() as u32,
        &["!=", "="],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_having_operator_uri,
        0,
        "SELECT owner, count(*) from public.webhook group by owner having count(*) ".len() as u32,
        &["owner", "name", "form_background_url"],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_group_continuation_uri,
        0,
        "SELECT owner, count(*) from public.webhook GROUP BY owner ".len() as u32,
        &["HAVING", "ORDER BY", "LIMIT"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_group_continuation_uri,
        0,
        "SELECT owner, count(*) from public.webhook GROUP BY owner ".len() as u32,
        &["ASC", "DESC", "owner", "name", "public.form", "="],
    )
    .await?;
    assert_completion_text_edit(
        &mut lsp,
        postgres_qualified_uri,
        0,
        "SELECT * from public.fo".len() as u32,
        "public.form",
        "SELECT * from ".len() as u32,
        "SELECT * from public.fo".len() as u32,
        "public.form",
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_insert_action_uri,
        0,
        "INSERT INTO public.webhook ".len() as u32,
        &["VALUES", "SELECT"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_insert_action_uri,
        0,
        "INSERT INTO public.webhook ".len() as u32,
        &["owner", "name", "public.form", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_insert_value_uri,
        0,
        "INSERT INTO public.webhook (owner, name) VALUES (".len() as u32,
        &["DEFAULT", "NULL", "CURRENT_TIMESTAMP"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_insert_value_uri,
        0,
        "INSERT INTO public.webhook (owner, name) VALUES (".len() as u32,
        &["owner", "name", "public.webhook", "public.form", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_insert_continuation_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ".len() as u32,
        &["ON CONFLICT", "RETURNING"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_insert_continuation_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ".len() as u32,
        &["owner", "name", "public.webhook", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_insert_conflict_target_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (".len() as u32,
        &["owner", "name"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_insert_conflict_target_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (".len() as u32,
        &["DO NOTHING", "DO UPDATE SET", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_insert_conflict_action_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) ".len() as u32,
        &["DO NOTHING", "DO UPDATE SET"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_insert_conflict_action_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) ".len() as u32,
        &["owner", "name", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_insert_conflict_constraint_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT ON CONSTRAINT ".len() as u32,
        &["webhook_pkey"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_insert_conflict_constraint_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT ON CONSTRAINT ".len() as u32,
        &[
            "webhook_owner_check",
            "form_pkey",
            "owner",
            "name",
            "DO NOTHING",
            "=",
            "!=",
        ],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_insert_conflict_constraint_action_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT ON CONSTRAINT webhook_pkey "
            .len() as u32,
        &["DO NOTHING", "DO UPDATE SET"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_insert_conflict_constraint_action_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT ON CONSTRAINT webhook_pkey "
            .len() as u32,
        &["webhook_pkey", "owner", "name", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_insert_conflict_update_set_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET ".len()
            as u32,
        &["owner", "name"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_insert_conflict_update_set_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET ".len()
            as u32,
        &["public.form", "webhook.owner", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_insert_conflict_update_operator_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET owner "
            .len() as u32,
        &["=", "!="],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_insert_conflict_update_operator_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET owner "
            .len() as u32,
        &["owner", "name", "public.form"],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_insert_conflict_update_value_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET owner = "
            .len() as u32,
        &["DEFAULT", "NULL", "CURRENT_TIMESTAMP"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_insert_conflict_update_value_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET owner = "
            .len() as u32,
        &["owner", "name", "public.webhook", "public.form", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_insert_conflict_update_continuation_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET owner = 'app' "
            .len() as u32,
        &[",", "WHERE", "RETURNING"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_insert_conflict_update_continuation_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON CONFLICT (owner) DO UPDATE SET owner = 'app' "
            .len() as u32,
        &["owner", "name", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_update_action_uri,
        0,
        "UPDATE public.webhook ".len() as u32,
        &["SET"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_update_action_uri,
        0,
        "UPDATE public.webhook ".len() as u32,
        &["owner", "name", "public.form", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_update_value_uri,
        0,
        "UPDATE public.webhook SET owner = ".len() as u32,
        &["DEFAULT", "NULL", "CURRENT_TIMESTAMP"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_update_value_uri,
        0,
        "UPDATE public.webhook SET owner = ".len() as u32,
        &["owner", "name", "public.webhook", "public.form", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_update_continuation_uri,
        0,
        "UPDATE public.webhook SET owner = 'app' ".len() as u32,
        &[",", "WHERE", "RETURNING"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_update_continuation_uri,
        0,
        "UPDATE public.webhook SET owner = 'app' ".len() as u32,
        &["owner", "name", "public.webhook", "public.form", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_delete_action_uri,
        0,
        "DELETE FROM public.webhook ".len() as u32,
        &["WHERE", "USING", "RETURNING"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_delete_action_uri,
        0,
        "DELETE FROM public.webhook ".len() as u32,
        &["owner", "name", "public.form", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_drop_index_uri,
        0,
        "DROP INDEX ".len() as u32,
        &["public.webhook_owner_idx", "public.form_css_idx"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_drop_index_uri,
        0,
        "DROP INDEX ".len() as u32,
        &["owner", "name", "public.form", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_create_index_uri,
        0,
        "CREATE INDEX webhook_owner_idx ON".len() as u32,
        &["public.webhook", "public.form"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_create_index_uri,
        0,
        "CREATE INDEX webhook_owner_idx ON".len() as u32,
        &["owner", "name", "form_background_url"],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_create_index_columns_uri,
        0,
        "CREATE INDEX webhook_owner_idx ON public.webhook (".len() as u32,
        &["owner", "name"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_create_index_columns_uri,
        0,
        "CREATE INDEX webhook_owner_idx ON public.webhook (".len() as u32,
        &["form_background_url", "form_css"],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_join_using_uri,
        0,
        "SELECT * from public.webhook w JOIN public.form f USING (".len() as u32,
        &["owner"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_join_using_uri,
        0,
        "SELECT * from public.webhook w JOIN public.form f USING (".len() as u32,
        &[
            "name",
            "form_background_url",
            "form_css",
            "=",
            "public.form",
        ],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_alter_action_uri,
        0,
        "ALTER TABLE public.webhook ".len() as u32,
        &["ADD COLUMN", "DROP COLUMN", "ADD CONSTRAINT"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_alter_action_uri,
        0,
        "ALTER TABLE public.webhook ".len() as u32,
        &["owner", "name", "public.form", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_alter_column_uri,
        0,
        "ALTER TABLE public.webhook DROP COLUMN ".len() as u32,
        &["owner", "name"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_alter_column_uri,
        0,
        "ALTER TABLE public.webhook DROP COLUMN ".len() as u32,
        &["form_background_url", "public.form", "=", "webhook_pkey"],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_alter_constraint_uri,
        0,
        "ALTER TABLE public.webhook DROP CONSTRAINT ".len() as u32,
        &["webhook_pkey", "webhook_owner_check"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_alter_constraint_uri,
        0,
        "ALTER TABLE public.webhook DROP CONSTRAINT ".len() as u32,
        &["owner", "name", "form_pkey", "public.form", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_create_table_type_uri,
        0,
        "CREATE TABLE public.audit_log (owner ".len() as u32,
        &["VARCHAR", "TEXT", "JSONB"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_create_table_type_uri,
        0,
        "CREATE TABLE public.audit_log (owner ".len() as u32,
        &["public.webhook", "owner", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_alter_column_type_uri,
        0,
        "ALTER TABLE public.webhook ALTER COLUMN owner TYPE ".len() as u32,
        &["VARCHAR", "TEXT", "JSONB"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_alter_column_type_uri,
        0,
        "ALTER TABLE public.webhook ALTER COLUMN owner TYPE ".len() as u32,
        &["public.webhook", "owner", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_references_table_uri,
        0,
        "CREATE TABLE public.audit_log (owner varchar REFERENCES ".len() as u32,
        &["public.webhook", "public.form"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_references_table_uri,
        0,
        "CREATE TABLE public.audit_log (owner varchar REFERENCES ".len() as u32,
        &["owner", "name", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_references_columns_uri,
        0,
        "CREATE TABLE public.audit_log (owner varchar REFERENCES public.webhook (".len() as u32,
        &["owner", "name"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_references_columns_uri,
        0,
        "CREATE TABLE public.audit_log (owner varchar REFERENCES public.webhook (".len() as u32,
        &["public.form", "form_css", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_references_action_uri,
        0,
        "CREATE TABLE public.audit_log (owner varchar REFERENCES public.webhook ".len() as u32,
        &["(", "ON DELETE", "ON UPDATE"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_references_action_uri,
        0,
        "CREATE TABLE public.audit_log (owner varchar REFERENCES public.webhook ".len() as u32,
        &["public.form", "owner", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        postgres_references_rule_uri,
        0,
        "CREATE TABLE public.audit_log (owner varchar REFERENCES public.webhook ON DELETE ".len()
            as u32,
        &["CASCADE", "RESTRICT", "NO ACTION", "SET NULL"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        postgres_references_rule_uri,
        0,
        "CREATE TABLE public.audit_log (owner varchar REFERENCES public.webhook ON DELETE ".len()
            as u32,
        &["public.form", "owner", "ON UPDATE"],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        mysql_modify_column_uri,
        0,
        "ALTER TABLE public.webhook MODIFY COLUMN ".len() as u32,
        &["owner", "name"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        mysql_modify_column_uri,
        0,
        "ALTER TABLE public.webhook MODIFY COLUMN ".len() as u32,
        &["public.form", "form_css", "="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        mysql_insert_duplicate_set_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE ".len() as u32,
        &["owner", "name"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        mysql_insert_duplicate_set_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE ".len() as u32,
        &["public.form", "webhook.owner", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        mysql_insert_duplicate_operator_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE owner ".len()
            as u32,
        &["=", "!="],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        mysql_insert_duplicate_operator_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE owner ".len()
            as u32,
        &["owner", "name", "public.form"],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        mysql_insert_duplicate_value_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE owner = ".len()
            as u32,
        &["DEFAULT", "NULL", "CURRENT_TIMESTAMP"],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        mysql_insert_duplicate_value_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE owner = ".len()
            as u32,
        &["owner", "name", "public.webhook", "public.form", "=", "!="],
    )
    .await?;
    assert_completion_at_contains(
        &mut lsp,
        mysql_insert_duplicate_continuation_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE owner = 'app' "
            .len() as u32,
        &[","],
    )
    .await?;
    assert_completion_at_excludes(
        &mut lsp,
        mysql_insert_duplicate_continuation_uri,
        0,
        "INSERT INTO public.webhook (owner) VALUES ('app') ON DUPLICATE KEY UPDATE owner = 'app' "
            .len() as u32,
        &["WHERE", "owner", "name", "=", "!="],
    )
    .await?;

    lsp.shutdown().await
}

async fn open_document(
    lsp: &mut LspProcess,
    uri: &str,
    language_id: &str,
    text: &str,
) -> Result<()> {
    lsp.notify(
        "textDocument/didOpen",
        json!({
            "textDocument": {
                "uri": uri,
                "languageId": language_id,
                "version": 1,
                "text": text
            }
        }),
    )
    .await
}

async fn assert_completion_contains(
    lsp: &mut LspProcess,
    uri: &str,
    expected_labels: &[&str],
) -> Result<()> {
    assert_completion_at_contains(lsp, uri, 0, 0, expected_labels).await
}

async fn assert_completion_at_contains(
    lsp: &mut LspProcess,
    uri: &str,
    line: u32,
    character: u32,
    expected_labels: &[&str],
) -> Result<()> {
    let mut labels = completion_labels_at(lsp, uri, line, character).await?;
    labels.sort();

    for expected in expected_labels {
        if !labels.iter().any(|label| label == expected) {
            bail!("missing completion label {expected:?} for {uri}; labels: {labels:?}");
        }
    }

    Ok(())
}

async fn assert_completion_at_excludes(
    lsp: &mut LspProcess,
    uri: &str,
    line: u32,
    character: u32,
    excluded_labels: &[&str],
) -> Result<()> {
    let labels = completion_labels_at(lsp, uri, line, character).await?;

    for excluded in excluded_labels {
        if labels.iter().any(|label| label == excluded) {
            bail!("unexpected completion label {excluded:?} for {uri}; labels: {labels:?}");
        }
    }

    Ok(())
}

async fn completion_labels_at(
    lsp: &mut LspProcess,
    uri: &str,
    line: u32,
    character: u32,
) -> Result<Vec<String>> {
    let result = completion_items_at(lsp, uri, line, character).await?;
    Ok(completion_labels(&result))
}

async fn sorted_completion_labels_at(
    lsp: &mut LspProcess,
    uri: &str,
    line: u32,
    character: u32,
) -> Result<Vec<String>> {
    let result = completion_items_at(lsp, uri, line, character).await?;
    Ok(sorted_completion_labels(&result))
}

async fn completion_items_at(
    lsp: &mut LspProcess,
    uri: &str,
    line: u32,
    character: u32,
) -> Result<Value> {
    let result = lsp
        .request(
            "textDocument/completion",
            json!({
                "textDocument": {
                    "uri": uri
                },
                "position": {
                    "line": line,
                    "character": character
                },
                "context": {
                    "triggerKind": 1
                }
            }),
        )
        .await?;

    Ok(result)
}

async fn assert_completion_text_edit(
    lsp: &mut LspProcess,
    uri: &str,
    line: u32,
    character: u32,
    label: &str,
    expected_start_character: u32,
    expected_end_character: u32,
    expected_new_text: &str,
) -> Result<()> {
    let result = completion_items_at(lsp, uri, line, character).await?;
    let items = result
        .as_array()
        .or_else(|| result.get("items").and_then(Value::as_array))
        .ok_or_else(|| anyhow!("completion response did not contain an item array"))?;
    let item = items
        .iter()
        .find(|item| item.get("label").and_then(Value::as_str) == Some(label))
        .ok_or_else(|| anyhow!("missing completion label {label:?} for {uri}; items: {items:?}"))?;
    let text_edit = item
        .get("textEdit")
        .ok_or_else(|| anyhow!("completion {label:?} missing textEdit: {item:?}"))?;

    assert_eq!(
        text_edit
            .pointer("/range/start/line")
            .and_then(Value::as_u64),
        Some(line as u64)
    );
    assert_eq!(
        text_edit
            .pointer("/range/start/character")
            .and_then(Value::as_u64),
        Some(expected_start_character as u64)
    );
    assert_eq!(
        text_edit.pointer("/range/end/line").and_then(Value::as_u64),
        Some(line as u64)
    );
    assert_eq!(
        text_edit
            .pointer("/range/end/character")
            .and_then(Value::as_u64),
        Some(expected_end_character as u64)
    );
    assert_eq!(
        text_edit.get("newText").and_then(Value::as_str),
        Some(expected_new_text)
    );

    Ok(())
}

fn completion_labels(result: &Value) -> Vec<String> {
    let items = result
        .as_array()
        .or_else(|| result.get("items").and_then(Value::as_array));

    items
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("label").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect()
}

fn sorted_completion_labels(result: &Value) -> Vec<String> {
    let items = result
        .as_array()
        .or_else(|| result.get("items").and_then(Value::as_array));

    let mut labels = items
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let label = item.get("label").and_then(Value::as_str)?.to_string();
            let sort_text = item
                .get("sortText")
                .and_then(Value::as_str)
                .map(ToString::to_string)
                .unwrap_or_else(|| label.clone());
            Some((sort_text, label))
        })
        .collect::<Vec<_>>();

    labels.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
    labels.into_iter().map(|(_, label)| label).collect()
}

fn schema(
    id: &str,
    database: &str,
    table_name: &str,
    object_type: &str,
    columns: Vec<Value>,
) -> Value {
    schema_with_tables(id, database, vec![table(table_name, object_type, columns)])
}

fn schema_with_tables(id: &str, database: &str, tables: Vec<Value>) -> Value {
    json!({
        "id": id,
        "database": database,
        "tables": tables,
        "functions": [],
        "source_uri": null
    })
}

fn table(name: &str, object_type: &str, columns: Vec<Value>) -> Value {
    table_with_constraints(name, object_type, columns, Vec::new())
}

fn table_with_constraints(
    name: &str,
    object_type: &str,
    columns: Vec<Value>,
    constraints: Vec<Value>,
) -> Value {
    table_with_metadata(name, object_type, columns, Vec::new(), constraints)
}

fn table_with_metadata(
    name: &str,
    object_type: &str,
    columns: Vec<Value>,
    indexes: Vec<Value>,
    constraints: Vec<Value>,
) -> Value {
    json!({
        "name": name,
        "object_type": object_type,
        "columns": columns,
        "indexes": indexes,
        "constraints": constraints,
        "comment": null
    })
}

fn index(name: &str, columns: Vec<&str>, is_unique: bool, is_primary: bool) -> Value {
    json!({
        "name": name,
        "columns": columns,
        "is_unique": is_unique,
        "is_primary": is_primary,
        "index_type": null,
        "definition": null
    })
}

fn constraint(name: &str, constraint_type: &str, columns: Vec<&str>) -> Value {
    json!({
        "name": name,
        "constraint_type": constraint_type,
        "columns": columns,
        "referenced_schema": null,
        "referenced_table": null,
        "referenced_columns": [],
        "definition": null
    })
}

fn column(name: &str, data_type: &str) -> Value {
    json!({
        "name": name,
        "data_type": data_type,
        "nullable": true,
        "primary_key": false,
        "unique": false,
        "indexed": false,
        "comment": null,
        "source_location": null
    })
}

fn bundled_lsp_binary() -> PathBuf {
    let name = if cfg!(windows) {
        "sql-lsp.exe"
    } else {
        "sql-lsp"
    };

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(name)
}
