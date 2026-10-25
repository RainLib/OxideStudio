//! Internal file-session execution boundary. The Desktop Host must separately
//! authorize the source and require a signed file-query package contract.
use super::*;
use std::{fs::File, io::Read, path::Path};

const MAX_SOURCE_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_RESULT_ROWS: usize = 1_000;
// Leave envelope/escaping headroom below the Host's 4 MiB protocol frame cap.
const MAX_RESULT_BYTES: usize = 2 * 1024 * 1024;

#[cfg(test)]
pub(super) fn open(source: &str, format: &str) -> Result<SessionConnection, DriverProtocolError> {
    open_with_header(source, format, "present")
}

pub(super) fn open_with_header(
    source: &str,
    format: &str,
    csv_header: &str,
) -> Result<SessionConnection, DriverProtocolError> {
    if !matches!(csv_header, "auto" | "present" | "absent") {
        return Err(protocol_error(
            "FILE_QUERY_HEADER",
            "Invalid CSV header mode",
        ));
    }
    let reader = match format {
        "csv" => "read_csv",
        "json" | "jsonl" => "read_json",
        "parquet" => "read_parquet",
        _ => {
            return Err(protocol_error(
                "FILE_QUERY_FORMAT",
                "Unsupported file-query format",
            ))
        }
    };
    // Require a literal absolute filesystem path, not a URL or in-memory DB.
    let source = Path::new(source);
    if !source.is_absolute() {
        return Err(protocol_error(
            "FILE_QUERY_SOURCE",
            "An absolute filesystem path is required",
        ));
    }
    let source = source.canonicalize().map_err(file_error)?;
    if !source.metadata().map_err(file_error)?.is_file() {
        return Err(protocol_error(
            "FILE_QUERY_SOURCE",
            "A regular file is required",
        ));
    }
    let input = File::open(&source).map_err(file_error)?;
    let before = input.metadata().map_err(file_error)?;
    if !before.is_file() || before.len() > MAX_SOURCE_BYTES {
        return Err(protocol_error(
            "FILE_QUERY_SOURCE_LIMIT",
            "File exceeds the 1 GiB snapshot budget",
        ));
    }
    let mut builder = tempfile::Builder::new();
    builder.prefix("oxide-file-query-");
    let workspace = match std::env::var_os("OXIDE_FILE_QUERY_WORKSPACE") {
        Some(root) => builder.tempdir_in(root),
        None => builder.tempdir(),
    }
    .map_err(file_error)?;
    let snapshot = workspace.path().join(format!("input.{format}"));
    let mut output = File::create(&snapshot).map_err(file_error)?;
    let copied =
        std::io::copy(&mut (&input).take(MAX_SOURCE_BYTES + 1), &mut output).map_err(file_error)?;
    let after = input.metadata().map_err(file_error)?;
    if copied > MAX_SOURCE_BYTES
        || copied != before.len()
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err(protocol_error(
            "FILE_QUERY_SOURCE_CHANGED",
            "File changed while preparing its snapshot; reopen it",
        ));
    }
    drop(output);
    drop(input);
    let snapshot = snapshot
        .to_str()
        .ok_or_else(|| protocol_error("FILE_QUERY_SOURCE", "Snapshot path is not UTF-8"))?;
    let catalog = workspace.path().join("session.duckdb");
    {
        let writer = Connection::open_with_flags(&catalog, config(false)?).map_err(engine_error)?;
        restrict(&writer, snapshot)?;
        let options = match format {
            "csv" => match csv_header {
                "present" => ", header=true, max_line_size=1048576, sample_size=20480",
                "absent" => ", header=false, max_line_size=1048576, sample_size=20480",
                _ => ", max_line_size=1048576, sample_size=20480",
            },
            "json" | "jsonl" => ", maximum_object_size=1048576, sample_size=20480",
            _ => "",
        };
        writer
            .execute_batch(&format!(
                "CREATE VIEW data AS SELECT * FROM {reader}({}{options})",
                quote_string(snapshot),
            ))
            .map_err(engine_error)?;
    }
    let connection = Connection::open_with_flags(&catalog, config(true)?).map_err(engine_error)?;
    restrict(&connection, snapshot)?;
    Ok(SessionConnection {
        connection,
        file_workspace: Some(workspace),
    })
}

fn config(read_only: bool) -> Result<Config, DriverProtocolError> {
    // A single file exception to disabled external access; no directories,
    // globbing, HTTP extensions, auto-installation or disk spill are enabled.
    Config::default()
        .access_mode(if read_only {
            AccessMode::ReadOnly
        } else {
            AccessMode::ReadWrite
        })
        .and_then(|config| config.enable_autoload_extension(false))
        .and_then(|config| config.with("autoinstall_known_extensions", "false"))
        .and_then(|config| config.max_memory("128MiB"))
        .and_then(|config| config.threads(2))
        .and_then(|config| config.with("temp_directory", ""))
        .map_err(engine_error)
}

fn restrict(connection: &Connection, snapshot: &str) -> Result<(), DriverProtocolError> {
    // DuckDB requires a started database with external access still enabled
    // to assign allowed_paths. Only Host-owned setup SQL runs in this phase;
    // no source SQL or user statements are executed before the final lock.
    connection.execute_batch(&format!(
        "LOAD json; LOAD parquet; SET allowed_paths=[{}]; SET enable_external_access=false; SET lock_configuration=true;",
        quote_string(snapshot),
    )).map_err(engine_error)
}

pub(super) fn query(
    connection: &Connection,
    sql: &str,
    parameters: &[oxide_driver_protocol::DriverQueryParameter],
) -> Result<Vec<DriverQueryResult>, DriverProtocolError> {
    // Parse before prepare: prepare may execute intermediate statements.
    if sql.len() > 64 * 1024 || parameters.len() > 128 {
        return Err(protocol_error(
            "FILE_QUERY_SQL_LIMIT",
            "File queries are limited to 64 KiB SQL and 128 parameters",
        ));
    }
    super::file_query_sql::validate(connection, sql)?;
    query_bounded(
        connection,
        sql,
        parameters,
        Some((MAX_RESULT_ROWS, MAX_RESULT_BYTES)),
    )
}

fn file_error(error: std::io::Error) -> DriverProtocolError {
    protocol_error("FILE_QUERY_IO", error.to_string())
}

fn engine_error(error: duckdb::Error) -> DriverProtocolError {
    protocol_error("FILE_QUERY_ENGINE", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connect(
        path: &Path,
        format: &str,
        connections: &mut HashMap<String, SessionConnection>,
    ) -> Result<DriverResult, DriverProtocolError> {
        handle_request(
            DriverRequest::Connect {
                connection_id: "file".into(),
                config: oxide_driver_protocol::SecretConnectionConfig {
                    url: path.to_str().unwrap().into(),
                    options: [
                        ("readOnly".into(), "true".into()),
                        ("fileQueryFormat".into(), format.into()),
                    ]
                    .into_iter()
                    .collect(),
                },
            },
            connections,
        )
    }

    fn execute_query(
        sql: &str,
        connections: &mut HashMap<String, SessionConnection>,
    ) -> Result<Vec<DriverQueryResult>, DriverProtocolError> {
        // Deliberately omit the per-query read-only flag: the session owns it.
        match handle_request(
            DriverRequest::Query {
                connection_id: "file".into(),
                statement: sql.into(),
                parameters: vec![],
                context: Default::default(),
                query_id: None,
            },
            connections,
        )? {
            DriverResult::Query(results) => Ok(results),
            _ => panic!("expected query results"),
        }
    }

    #[test]
    fn file_query_csv_snapshot_is_read_only_scoped_and_cleaned_on_disconnect() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("untrusted ' 名称.csv");
        let content = b"id,name\n1,alpha\n2,beta\n";
        std::fs::write(&source, content).unwrap();
        let other = directory.path().join("secret.csv");
        std::fs::write(&other, b"secret\nprivate\n").unwrap();
        let mut connections = HashMap::new();
        connect(&source, "csv", &mut connections).unwrap();
        let workspace = connections["file"]
            .file_workspace
            .as_ref()
            .unwrap()
            .path()
            .to_owned();
        assert_eq!(
            execute_query("SELECT id, name FROM data ORDER BY id", &mut connections).unwrap()[0]
                .rows,
            vec![
                vec![json!(1), json!("alpha")],
                vec![json!(2), json!("beta")]
            ]
        );
        // The original can change or disappear without changing the session.
        std::fs::write(&source, b"changed\n99\n").unwrap();
        assert_eq!(
            execute_query("SELECT count(*) FROM data", &mut connections).unwrap()[0].rows,
            vec![vec![json!(2)]]
        );
        assert_eq!(
            execute_query(
                "/* preview */\n-- selected input\n SELECT count(*) FROM data",
                &mut connections
            )
            .unwrap()[0]
                .rows,
            vec![vec![json!(2)]]
        );
        for sql in [
            "CREATE TABLE forbidden(id INT)",
            "INSERT INTO data VALUES (3, 'bad')",
            "SET enable_external_access=true",
            "SELECT * FROM query('SELECT 1')",
            "SELECT * FROM \"query\"('SELECT 1')",
            "SELECT 1; SELECT 2",
        ] {
            assert!(
                execute_query(sql, &mut connections).is_err(),
                "accepted {sql}"
            );
        }
        assert!(connections["file"]
            .execute_batch("CREATE TABLE engine_forbidden(id INT)")
            .is_err());
        assert!(connections["file"]
            .execute_batch("SET enable_external_access=true")
            .is_err());
        for path in [&source, &other] {
            assert!(execute_query(
                &format!(
                    "SELECT * FROM read_csv({})",
                    quote_string(path.to_str().unwrap())
                ),
                &mut connections
            )
            .is_err());
        }
        assert!(execute_query(
            "SELECT * FROM read_csv('https://example.invalid/private.csv')",
            &mut connections
        )
        .is_err());
        handle_request(
            DriverRequest::Disconnect {
                connection_id: "file".into(),
            },
            &mut connections,
        )
        .unwrap();
        assert!(
            !workspace.exists(),
            "Disconnect must release the catalog and snapshot"
        );
        assert_eq!(std::fs::read(&source).unwrap(), b"changed\n99\n");
        assert_eq!(std::fs::read(&other).unwrap(), b"secret\nprivate\n");
    }

    #[test]
    fn file_query_json_and_parquet_use_real_file_readers_without_importing_rows() {
        let directory = tempfile::tempdir().unwrap();
        let json = directory.path().join("items.json");
        let jsonl = directory.path().join("items.jsonl");
        let parquet = directory.path().join("items.parquet");
        std::fs::write(&json, r#"[{"id":1,"label":"雪"},{"id":2,"label":null}]"#).unwrap();
        std::fs::write(
            &jsonl,
            "{\"id\":1,\"label\":\"雪\"}\n{\"id\":2,\"label\":null}\n",
        )
        .unwrap();
        Connection::open_in_memory().unwrap().execute_batch(&format!("COPY (SELECT 1 AS id, '雪' AS label UNION ALL SELECT 2, NULL) TO {} (FORMAT PARQUET)", quote_string(parquet.to_str().unwrap()))).unwrap();
        for (path, format) in [(&json, "json"), (&jsonl, "jsonl"), (&parquet, "parquet")] {
            let before = std::fs::read(path).unwrap();
            let mut connections = HashMap::new();
            connect(path, format, &mut connections).unwrap();
            assert_eq!(
                execute_query("SELECT * FROM data ORDER BY id", &mut connections).unwrap()[0].rows,
                vec![vec![json!(1), json!("雪")], vec![json!(2), Value::Null]]
            );
            let workspace = connections["file"]
                .file_workspace
                .as_ref()
                .unwrap()
                .path()
                .to_owned();
            drop(connections);
            assert!(!workspace.exists());
            assert_eq!(std::fs::read(path).unwrap(), before);
        }
    }

    #[test]
    fn file_query_source_and_result_budgets_are_enforced() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("sample.csv");
        std::fs::write(&source, "id\n1\n").unwrap();
        let mut connections = HashMap::new();
        connect(&source, "csv", &mut connections).unwrap();
        let result = execute_query("SELECT range FROM range(1001)", &mut connections).unwrap();
        assert_eq!(result[0].rows.len(), 1000);
        assert!(result[0].truncated);
        assert_eq!(result[0].row_limit, Some(1000));
        assert!(
            !execute_query("SELECT range FROM range(1000)", &mut connections).unwrap()[0].truncated
        );
        assert_eq!(
            execute_query("SELECT repeat('x', 4194305)", &mut connections)
                .unwrap_err()
                .code,
            "FILE_QUERY_RESULT_LIMIT"
        );
        let wide = format!(
            "SELECT {}",
            (0..257)
                .map(|index| format!("{index} AS c{index}"))
                .collect::<Vec<_>>()
                .join(",")
        );
        assert_eq!(
            execute_query(&wide, &mut connections).unwrap_err().code,
            "FILE_QUERY_RESULT_LIMIT"
        );
        assert!(execute_query(
            &format!("SELECT 1 --{}", "x".repeat(65536)),
            &mut connections
        )
        .is_err());
        drop(connections);
        let oversized = directory.path().join("large.csv");
        File::create(&oversized)
            .unwrap()
            .set_len(MAX_SOURCE_BYTES + 1)
            .unwrap();
        assert_eq!(
            open(oversized.to_str().unwrap(), "csv").err().unwrap().code,
            "FILE_QUERY_SOURCE_LIMIT"
        );
        assert!(open(source.to_str().unwrap(), "sqlite").is_err());
        assert!(open("relative.csv", "csv").is_err());
        assert!(open(directory.path().to_str().unwrap(), "csv").is_err());
    }

    #[test]
    fn file_query_mode_does_not_relax_ordinary_read_only_connections() {
        let directory = tempfile::tempdir().unwrap();
        let catalog = directory.path().join("original.duckdb");
        Connection::open(&catalog)
            .unwrap()
            .execute_batch("CREATE TABLE items(id INT)")
            .unwrap();
        let csv = directory.path().join("unbound.csv");
        std::fs::write(&csv, "id\n1\n").unwrap();
        let mut connections = HashMap::new();
        handle_request(
            DriverRequest::Connect {
                connection_id: "file".into(),
                config: oxide_driver_protocol::SecretConnectionConfig {
                    url: catalog.to_str().unwrap().into(),
                    options: [("readOnly".into(), "true".into())].into_iter().collect(),
                },
            },
            &mut connections,
        )
        .unwrap();
        assert!(execute_query(
            &format!(
                "SELECT * FROM read_csv({})",
                quote_string(csv.to_str().unwrap())
            ),
            &mut connections
        )
        .is_err());
        drop(connections);
        connect(&csv, "csv", &mut HashMap::new()).unwrap();
        let mut connections = HashMap::new();
        assert!(handle_request(
            DriverRequest::Connect {
                connection_id: "file".into(),
                config: oxide_driver_protocol::SecretConnectionConfig {
                    url: csv.to_str().unwrap().into(),
                    options: [("fileQueryFormat".into(), "csv".into())]
                        .into_iter()
                        .collect(),
                }
            },
            &mut connections
        )
        .is_err());
        assert!(connections.is_empty());
    }

    #[test]
    fn file_query_ast_checks_calls_and_statement_count_without_rejecting_column_names() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("names.csv");
        std::fs::write(&source, "query,query_table\n1,2\n").unwrap();
        let session = open(source.to_str().unwrap(), "csv").unwrap();
        assert_eq!(
            query(&session, "SELECT query, \"query_table\" FROM data", &[]).unwrap()[0].rows,
            vec![vec![json!(1), json!(2)]]
        );
        query(&session, "SELECT $$'query(; COPY$$ AS text", &[]).unwrap();
        query(&session, "DESCRIBE data", &[]).unwrap();
        query(&session, "SHOW TABLES", &[]).unwrap();
        query(&session, "EXPLAIN ANALYZE SELECT * FROM data", &[]).unwrap();
        for sql in [
            "SELECT 1; SELECT 2",
            "SELECT $$'$$; CREATE TABLE forbidden(id INT)",
            "SELECT * FROM \"query\" /*comment*/ ('SELECT 1')",
            "EXPLAIN SELECT * FROM query('SELECT 1')",
        ] {
            assert_eq!(
                query(&session, sql, &[]).unwrap_err().code,
                "READ_ONLY_REJECTED",
                "{sql}"
            );
        }
        assert_eq!(
            query(&session, "SELECT count(*) FROM data", &[]).unwrap()[0].rows,
            vec![vec![json!(1)]]
        );
    }

    #[test]
    fn file_query_csv_header_mode_preserves_headerless_rows() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("rows.csv");
        std::fs::write(&source, "1,alpha\n2,beta\n").unwrap();
        for header in ["auto", "absent"] {
            let session = open_with_header(source.to_str().unwrap(), "csv", header).unwrap();
            assert_eq!(
                query(&session, "SELECT count(*) FROM data", &[]).unwrap()[0].rows,
                vec![vec![json!(2)]]
            );
        }
        let session = open_with_header(source.to_str().unwrap(), "csv", "present").unwrap();
        assert_eq!(
            query(&session, "SELECT count(*) FROM data", &[]).unwrap()[0].rows,
            vec![vec![json!(1)]]
        );
        assert!(open_with_header(source.to_str().unwrap(), "csv", "invalid").is_err());
    }
}
