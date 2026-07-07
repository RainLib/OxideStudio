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
    let postgres_uri = "file:///oxide/postgres.sql";
    let postgres_where_uri = "file:///oxide/postgres-where.sql";
    let postgres_where_operator_uri = "file:///oxide/postgres-where-operator.sql";
    let postgres_having_uri = "file:///oxide/postgres-having.sql";
    let postgres_having_operator_uri = "file:///oxide/postgres-having-operator.sql";
    let postgres_qualified_uri = "file:///oxide/postgres-qualified.sql";
    let postgres_create_index_uri = "file:///oxide/postgres-create-index.sql";
    let postgres_create_index_columns_uri = "file:///oxide/postgres-create-index-columns.sql";
    let postgres_join_using_uri = "file:///oxide/postgres-join-using.sql";

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
        postgres_uri.to_string(),
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
        postgres_having_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_having_operator_uri.to_string(),
        json!("44444444-4444-4444-8444-444444444444"),
    );
    file_schemas.insert(
        postgres_qualified_uri.to_string(),
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

    let mut file_dialects = Map::new();
    file_dialects.insert(redis_uri.to_string(), json!("redis"));
    file_dialects.insert(mongodb_uri.to_string(), json!("mongodb"));
    file_dialects.insert(elasticsearch_uri.to_string(), json!("elasticsearch-dsl"));
    file_dialects.insert(postgres_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_where_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_where_operator_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_having_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_having_operator_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_qualified_uri.to_string(), json!("postgres"));
    file_dialects.insert(postgres_create_index_uri.to_string(), json!("postgres"));
    file_dialects.insert(
        postgres_create_index_columns_uri.to_string(),
        json!("postgres"),
    );
    file_dialects.insert(postgres_join_using_uri.to_string(), json!("postgres"));

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
                            table(
                                "webhook",
                                "table",
                                vec![
                                    column("owner", "varchar"),
                                    column("name", "varchar")
                                ]
                            ),
                            table(
                                "form",
                                "table",
                                vec![
                                    column("owner", "varchar"),
                                    column("form_background_url", "varchar"),
                                    column("form_css", "text")
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
    open_document(&mut lsp, postgres_uri, "postgres", "SELECT * from").await?;
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
        postgres_qualified_uri,
        "postgres",
        "SELECT * from public.fo",
    )
    .await?;
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

    assert_completion_contains(&mut lsp, redis_uri, &["GET", "user:1"]).await?;
    assert_completion_contains(&mut lsp, mongodb_uri, &["find", "users", "email"]).await?;
    assert_completion_contains(&mut lsp, elasticsearch_uri, &["match", "users", "email"]).await?;
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
    json!({
        "name": name,
        "object_type": object_type,
        "columns": columns,
        "indexes": [],
        "constraints": [],
        "comment": null
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
