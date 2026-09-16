use super::*;
use crate::core::{
    driver::{DatabaseDriver, LocalDatabaseBackupControl},
    protocol::{ParameterizedStatement, QueryParameter, SchemaObjectInfo},
};
use serde_json::Value;

#[test]
fn table_xinfo_codes_separate_hidden_and_generated_columns() {
    assert_eq!(sqlite_column_ownership(0), (false, false));
    assert_eq!(sqlite_column_ownership(1), (false, true));
    assert_eq!(sqlite_column_ownership(2), (true, false));
    assert_eq!(sqlite_column_ownership(3), (true, false));
}

#[tokio::test]
async fn sqlite_driver_exposes_bounded_query_and_explorer_metadata() {
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver.query("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE); CREATE TABLE audit (user_id INTEGER); CREATE INDEX users_email_search_idx ON users (lower(email)) WHERE email IS NOT NULL;").await.unwrap();
    driver
            .execute_parameterized(
                "CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN INSERT INTO audit(user_id) VALUES (NEW.id); END;",
                &[],
            )
            .await
            .unwrap();
    driver
        .query("INSERT INTO users VALUES (1, 'hello@example.test');")
        .await
        .unwrap();
    let rows = driver.query("SELECT id, email FROM users").await.unwrap();
    assert_eq!(rows[0].rows.len(), 1);
    assert!(driver
        .get_tables("main")
        .await
        .unwrap()
        .iter()
        .any(|table| table.name == "users"));
    assert!(driver
        .get_columns("main", "users")
        .await
        .unwrap()
        .iter()
        .any(|column| column.is_primary_key));
    let indexes = driver.get_indexes("main", "users").await.unwrap();
    assert!(indexes.iter().any(|index| index.is_unique));
    assert_eq!(
        indexes
            .iter()
            .find(|index| index.name == "users_email_search_idx")
            .and_then(|index| index.definition.as_deref()),
        Some("CREATE INDEX users_email_search_idx ON users (lower(email)) WHERE email IS NOT NULL")
    );
    assert_eq!(
        driver.get_schema_objects("main").await.unwrap(),
        vec![SchemaObjectInfo {
            name: "users_audit".to_string(),
            schema: Some("main".to_string()),
            object_type: "trigger".to_string(),
            parent_name: Some("users".to_string()),
            comment: None,
            members_expandable: false,
        }]
    );

    // The Data Grid uses numbered bind markers on its shared relational
    // path. Verify SQLite executes that exact shape in an in-memory pool.
    assert_eq!(
        driver
            .execute_parameterized(
                "UPDATE users SET email = $1 WHERE id = $2",
                &[
                    QueryParameter {
                        value: Value::String("updated@example.test".to_string()),
                        data_type: Some("TEXT".to_string()),
                    },
                    QueryParameter {
                        value: Value::from(1),
                        data_type: Some("INTEGER".to_string()),
                    },
                ],
            )
            .await
            .unwrap(),
        1
    );
    let updated = driver
        .query("SELECT email FROM users WHERE id = 1")
        .await
        .unwrap();
    assert_eq!(
        updated[0].rows[0][0],
        Value::String("updated@example.test".to_string())
    );

    driver
            .query(
                "ATTACH DATABASE ':memory:' AS analytics; CREATE TABLE analytics.events (id INTEGER PRIMARY KEY, name TEXT);",
            )
            .await
            .unwrap();
    assert!(driver
        .get_schemas()
        .await
        .unwrap()
        .iter()
        .any(|schema| schema == "analytics"));
    assert_eq!(
        driver.get_tables("analytics").await.unwrap()[0].name,
        "events"
    );
    assert!(driver
        .get_columns("analytics", "events")
        .await
        .unwrap()
        .iter()
        .any(|column| column.name == "name"));
}

#[tokio::test]
async fn sqlite_composite_foreign_keys_preserve_column_order_and_actions() {
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver
            .query(
                "CREATE TABLE parents (tenant_id INTEGER, id INTEGER, PRIMARY KEY (tenant_id, id)); CREATE TABLE children (tenant_id INTEGER, parent_id INTEGER, FOREIGN KEY (tenant_id, parent_id) REFERENCES parents (tenant_id, id) ON UPDATE CASCADE ON DELETE SET NULL);",
            )
            .await
            .unwrap();

    let constraints = driver.get_constraints("main", "children").await.unwrap();
    assert_eq!(constraints.len(), 1);
    assert_eq!(constraints[0].columns, vec!["tenant_id", "parent_id"]);
    assert_eq!(constraints[0].referenced_columns, vec!["tenant_id", "id"]);
    assert_eq!(constraints[0].on_update.as_deref(), Some("CASCADE"));
    assert_eq!(constraints[0].on_delete.as_deref(), Some("SET NULL"));
}

#[test]
fn readonly_sqlite_driver_rejects_in_memory_targets() {
    assert!(SqliteDriver::new_read_only(":memory:").is_err());
    assert!(SqliteDriver::new_read_only("sqlite://workspace.db").is_ok());
}

#[test]
fn failed_backup_publication_restores_the_previous_destination() {
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("backup.sqlite");
    let missing_temporary = directory.path().join("missing.sqlite");
    std::fs::write(&destination, b"previous backup").unwrap();

    assert!(replace_backup_file(&missing_temporary, &destination).is_err());
    assert_eq!(std::fs::read(&destination).unwrap(), b"previous backup");
}

#[tokio::test]
async fn readonly_sqlite_driver_allows_selects_but_engine_rejects_writes() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let path = file.path().to_string_lossy().into_owned();

    let mut writable = SqliteDriver::new(&path);
    writable.connect().await.unwrap();
    writable
            .query("CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO entries VALUES (1, 'safe');")
            .await
            .unwrap();
    writable.disconnect().await.unwrap();

    let mut read_only = SqliteDriver::new_read_only(&path).unwrap();
    read_only.connect().await.unwrap();
    let rows = read_only.query("SELECT value FROM entries").await.unwrap();
    assert_eq!(rows[0].rows[0][0], Value::String("safe".to_string()));
    assert!(read_only
        .query("INSERT INTO entries VALUES (2, 'blocked')")
        .await
        .is_err());
}

#[tokio::test]
async fn native_backup_captures_a_consistent_memory_database() {
    let directory = tempfile::tempdir().unwrap();
    let backup_path = directory.path().join("snapshot.sqlite");
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver
            .query(
                "CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO entries VALUES (1, 'snapshot');",
            )
            .await
            .unwrap();

    let receipt = driver.backup_local_database(&backup_path).await.unwrap();
    assert!(receipt.byte_len > 0);
    assert_eq!(receipt.integrity_check, "ok");

    let mut restored = SqliteDriver::new(backup_path.to_string_lossy().as_ref());
    restored.connect().await.unwrap();
    let rows = restored.query("SELECT value FROM entries").await.unwrap();
    assert_eq!(rows[0].rows[0][0], Value::String("snapshot".to_string()));
}

#[tokio::test]
async fn sqlite_rebuild_publishes_backup_and_restores_foreign_keys() {
    let directory = tempfile::tempdir().unwrap();
    let backup_path = directory.path().join("before-rebuild.sqlite");
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver
            .query(
                "PRAGMA foreign_keys = ON; CREATE TABLE parents (id INTEGER PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id)); CREATE TABLE parent_audit (parent_id INTEGER); INSERT INTO parents VALUES (1, 'before'); INSERT INTO children VALUES (1, 1);",
            )
            .await
            .unwrap();
    driver
            .execute_parameterized(
                "CREATE TRIGGER parents_audit AFTER INSERT ON parents BEGIN INSERT INTO parent_audit(parent_id) VALUES (NEW.id); UPDATE parent_audit SET parent_id = parent_id WHERE parent_id = NEW.id; END;",
                &[],
            )
            .await
            .unwrap();
    let statements = vec![
            ParameterizedStatement {
                sql: "CREATE TABLE \"__oxide_rebuild_parents\" (\"id\" INTEGER PRIMARY KEY, \"name\" TEXT NOT NULL, \"email\" TEXT)".to_string(),
                params: Vec::new(),
            },
            ParameterizedStatement {
                sql: "INSERT INTO \"__oxide_rebuild_parents\" (\"id\", \"name\") SELECT \"id\", \"name\" FROM \"parents\"".to_string(),
                params: Vec::new(),
            },
            ParameterizedStatement {
                sql: "DROP TABLE \"parents\"".to_string(),
                params: Vec::new(),
            },
            ParameterizedStatement {
                sql: "ALTER TABLE \"__oxide_rebuild_parents\" RENAME TO \"parents\"".to_string(),
                params: Vec::new(),
            },
            ParameterizedStatement {
                sql: "CREATE TRIGGER parents_audit AFTER INSERT ON parents BEGIN INSERT INTO parent_audit(parent_id) VALUES (NEW.id); UPDATE parent_audit SET parent_id = parent_id WHERE parent_id = NEW.id; END;".to_string(),
                params: Vec::new(),
            },
        ];

    let receipt = driver
        .execute_sqlite_rebuild_batch(&statements, &backup_path)
        .await
        .unwrap();

    assert_eq!(receipt.statements_applied, statements.len());
    assert_eq!(receipt.backup.integrity_check, "ok");
    assert!(backup_path.is_file());
    assert!(driver
        .get_columns("main", "parents")
        .await
        .unwrap()
        .iter()
        .any(|column| column.name == "email"));
    let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&driver.pool().await.unwrap())
        .await
        .unwrap();
    assert_eq!(foreign_keys, 1);
    driver
        .query("INSERT INTO parents (id, name) VALUES (2, 'after')")
        .await
        .unwrap();
    let audit = driver
        .query("SELECT parent_id FROM parent_audit")
        .await
        .unwrap();
    assert_eq!(audit[0].rows, vec![vec![Value::from(2)]]);

    let mut backup = SqliteDriver::new(backup_path.to_string_lossy().as_ref());
    backup.connect().await.unwrap();
    assert!(!backup
        .get_columns("main", "parents")
        .await
        .unwrap()
        .iter()
        .any(|column| column.name == "email"));
}

#[tokio::test]
async fn sqlite_guarded_batch_replaces_a_standalone_compound_trigger() {
    let directory = tempfile::tempdir().unwrap();
    let backup_path = directory.path().join("before-trigger-change.sqlite");
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver
        .query("CREATE TABLE users (id INTEGER PRIMARY KEY); CREATE TABLE audit (user_id INTEGER);")
        .await
        .unwrap();
    driver
            .execute_parameterized(
                "CREATE TRIGGER users_audit AFTER INSERT ON users BEGIN INSERT INTO audit(user_id) VALUES (NEW.id); END;",
                &[],
            )
            .await
            .unwrap();
    let statements = vec![
            ParameterizedStatement {
                sql: "DROP TRIGGER \"main\".\"users_audit\";".to_string(),
                params: Vec::new(),
            },
            ParameterizedStatement {
                sql: "CREATE TRIGGER \"main\".\"users_audit\" AFTER INSERT ON users BEGIN INSERT INTO audit(user_id) VALUES (NEW.id + 100); UPDATE audit SET user_id = user_id WHERE user_id = NEW.id + 100; END;".to_string(),
                params: Vec::new(),
            },
        ];

    let receipt = driver
        .execute_sqlite_rebuild_batch(&statements, &backup_path)
        .await
        .unwrap();
    assert_eq!(receipt.statements_applied, 2);
    driver.query("INSERT INTO users VALUES (1)").await.unwrap();
    let audit = driver.query("SELECT user_id FROM audit").await.unwrap();
    assert_eq!(audit[0].rows, vec![vec![Value::from(101)]]);

    let mut backup = SqliteDriver::new(backup_path.to_string_lossy().as_ref());
    backup.connect().await.unwrap();
    let original = backup
        .query("SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = 'users_audit'")
        .await
        .unwrap();
    assert!(original[0].rows[0][0]
        .as_str()
        .is_some_and(|sql| sql.contains("VALUES (NEW.id)")));
    assert!(!original[0].rows[0][0]
        .as_str()
        .is_some_and(|sql| sql.contains("NEW.id + 100")));
}

#[tokio::test]
async fn sqlite_guarded_batch_creates_and_drops_catalog_backed_tables() {
    let directory = tempfile::tempdir().unwrap();
    let create_backup = directory.path().join("before-table-create.sqlite");
    let drop_backup = directory.path().join("before-table-drop.sqlite");
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver
        .query("CREATE TABLE audit (user_id INTEGER)")
        .await
        .unwrap();
    let create = vec![
            ParameterizedStatement {
                sql: "CREATE TABLE \"main\".\"users\" (id INTEGER PRIMARY KEY, email TEXT CHECK (length(email) > 0)) STRICT;".to_string(),
                params: Vec::new(),
            },
            ParameterizedStatement {
                sql: "CREATE INDEX \"main\".\"users_email_idx\" ON \"users\" (lower(email)) WHERE email IS NOT NULL;".to_string(),
                params: Vec::new(),
            },
            ParameterizedStatement {
                sql: "CREATE TRIGGER \"main\".\"users_audit\" AFTER INSERT ON users BEGIN INSERT INTO audit(user_id) VALUES (NEW.id); END;".to_string(),
                params: Vec::new(),
            },
        ];
    driver
        .execute_sqlite_rebuild_batch(&create, &create_backup)
        .await
        .unwrap();
    driver
        .query("INSERT INTO users(id, email) VALUES (1, 'one@example.test')")
        .await
        .unwrap();
    assert_eq!(
        driver.query("SELECT user_id FROM audit").await.unwrap()[0].rows,
        vec![vec![Value::from(1)]]
    );
    assert!(driver
        .get_indexes("main", "users")
        .await
        .unwrap()
        .iter()
        .any(|index| index.name == "users_email_idx"));

    driver
        .execute_sqlite_rebuild_batch(
            &[ParameterizedStatement {
                sql: "DROP TABLE \"main\".\"users\";".to_string(),
                params: Vec::new(),
            }],
            &drop_backup,
        )
        .await
        .unwrap();
    assert!(!driver
        .get_tables("main")
        .await
        .unwrap()
        .iter()
        .any(|table| table.name == "users"));
    assert!(driver.get_schema_objects("main").await.unwrap().is_empty());

    let mut backup = SqliteDriver::new(drop_backup.to_string_lossy().as_ref());
    backup.connect().await.unwrap();
    assert!(backup
        .get_tables("main")
        .await
        .unwrap()
        .iter()
        .any(|table| table.name == "users"));
}

#[tokio::test]
async fn sqlite_guarded_batch_creates_replaces_and_drops_views() {
    let directory = tempfile::tempdir().unwrap();
    let create_backup = directory.path().join("before-view-create.sqlite");
    let replace_backup = directory.path().join("before-view-replace.sqlite");
    let drop_backup = directory.path().join("before-view-drop.sqlite");
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver
            .query("CREATE TABLE users (id INTEGER PRIMARY KEY, active INTEGER); INSERT INTO users VALUES (1, 1); INSERT INTO users VALUES (2, 0);")
            .await
            .unwrap();

    driver
            .execute_sqlite_rebuild_batch(
                &[ParameterizedStatement {
                    sql: "CREATE VIEW \"main\".\"active_users\" AS SELECT id FROM users WHERE active = 1;".to_string(),
                    params: Vec::new(),
                }],
                &create_backup,
            )
            .await
            .unwrap();
    assert_eq!(
        driver.query("SELECT id FROM active_users").await.unwrap()[0].rows,
        vec![vec![Value::from(1)]]
    );

    driver
            .execute_sqlite_rebuild_batch(
                &[
                    ParameterizedStatement {
                        sql: "DROP VIEW \"main\".\"active_users\";".to_string(),
                        params: Vec::new(),
                    },
                    ParameterizedStatement {
                        sql: "CREATE VIEW \"main\".\"active_users\" AS SELECT id FROM users WHERE active = 0;".to_string(),
                        params: Vec::new(),
                    },
                ],
                &replace_backup,
            )
            .await
            .unwrap();
    assert_eq!(
        driver.query("SELECT id FROM active_users").await.unwrap()[0].rows,
        vec![vec![Value::from(2)]]
    );

    driver
        .execute_sqlite_rebuild_batch(
            &[ParameterizedStatement {
                sql: "DROP VIEW \"main\".\"active_users\";".to_string(),
                params: Vec::new(),
            }],
            &drop_backup,
        )
        .await
        .unwrap();
    assert!(!driver
        .get_tables("main")
        .await
        .unwrap()
        .iter()
        .any(|table| table.name == "active_users"));

    let mut backup = SqliteDriver::new(replace_backup.to_string_lossy().as_ref());
    backup.connect().await.unwrap();
    let definition = backup
        .query("SELECT sql FROM sqlite_schema WHERE type = 'view' AND name = 'active_users'")
        .await
        .unwrap();
    assert!(definition[0].rows[0][0]
        .as_str()
        .is_some_and(|sql| sql.contains("active = 1")));
}

#[tokio::test]
async fn file_sqlite_rebuild_backs_up_through_a_separate_snapshot_connection() {
    let directory = tempfile::tempdir().unwrap();
    let database_path = directory.path().join("live.sqlite");
    let backup_path = directory.path().join("before-rebuild.sqlite");
    let mut driver = SqliteDriver::new(database_path.to_string_lossy().as_ref());
    driver.connect().await.unwrap();
    driver
            .query(
                "CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO entries VALUES (1, 'before');",
            )
            .await
            .unwrap();
    let statements = vec![
            ParameterizedStatement {
                sql: "CREATE TABLE \"__oxide_rebuild_entries\" (\"id\" INTEGER PRIMARY KEY, \"value\" TEXT NOT NULL, \"note\" TEXT)".to_string(),
                params: Vec::new(),
            },
            ParameterizedStatement {
                sql: "INSERT INTO \"__oxide_rebuild_entries\" (\"id\", \"value\") SELECT \"id\", \"value\" FROM \"entries\"".to_string(),
                params: Vec::new(),
            },
            ParameterizedStatement {
                sql: "DROP TABLE \"entries\"".to_string(),
                params: Vec::new(),
            },
            ParameterizedStatement {
                sql: "ALTER TABLE \"__oxide_rebuild_entries\" RENAME TO \"entries\"".to_string(),
                params: Vec::new(),
            },
        ];

    driver
        .execute_sqlite_rebuild_batch(&statements, &backup_path)
        .await
        .unwrap();

    assert!(driver
        .get_columns("main", "entries")
        .await
        .unwrap()
        .iter()
        .any(|column| column.name == "note"));
    let mut backup = SqliteDriver::new(backup_path.to_string_lossy().as_ref());
    backup.connect().await.unwrap();
    assert!(!backup
        .get_columns("main", "entries")
        .await
        .unwrap()
        .iter()
        .any(|column| column.name == "note"));
    assert_eq!(
        backup.query("SELECT value FROM entries").await.unwrap()[0].rows,
        vec![vec![Value::String("before".to_string())]]
    );
}

#[tokio::test]
async fn sqlite_rebuild_rolls_back_when_foreign_key_check_fails() {
    let directory = tempfile::tempdir().unwrap();
    let backup_path = directory.path().join("failed-rebuild.sqlite");
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver
            .query(
                "PRAGMA foreign_keys = ON; CREATE TABLE parents (id INTEGER PRIMARY KEY); CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id)); INSERT INTO parents VALUES (1); INSERT INTO children VALUES (1, 1);",
            )
            .await
            .unwrap();
    let statements = vec![
        ParameterizedStatement {
            sql: "CREATE TABLE \"__oxide_rebuild_parents\" (\"id\" INTEGER PRIMARY KEY)"
                .to_string(),
            params: Vec::new(),
        },
        ParameterizedStatement {
            sql: "DROP TABLE \"parents\"".to_string(),
            params: Vec::new(),
        },
        ParameterizedStatement {
            sql: "ALTER TABLE \"__oxide_rebuild_parents\" RENAME TO \"parents\"".to_string(),
            params: Vec::new(),
        },
    ];

    let error = driver
        .execute_sqlite_rebuild_batch(&statements, &backup_path)
        .await
        .unwrap_err();

    assert!(error.to_string().contains("foreign_key_check"));
    assert!(backup_path.is_file());
    assert_eq!(
        driver.query("SELECT id FROM parents").await.unwrap()[0].rows,
        vec![vec![Value::from(1)]]
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys")
            .fetch_one(&driver.pool().await.unwrap())
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn cancelled_native_backup_never_publishes_a_destination() {
    let directory = tempfile::tempdir().unwrap();
    let backup_path = directory.path().join("cancelled.sqlite");
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver
        .query("CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT)")
        .await
        .unwrap();
    let control = LocalDatabaseBackupControl::default();
    control.cancel();

    let error = driver
        .backup_local_database_controlled(&backup_path, &control)
        .await
        .unwrap_err();

    assert!(error.to_string().to_ascii_lowercase().contains("cancelled"));
    assert!(!backup_path.exists());
    assert_eq!(control.progress_percent(), 0);
}

#[tokio::test]
async fn native_restore_replaces_the_live_database_without_copying_open_files() {
    let directory = tempfile::tempdir().unwrap();
    let restore_path = directory.path().join("restore.sqlite");
    let live_path = directory.path().join("live.sqlite");
    let mut source = SqliteDriver::new(":memory:");
    source.connect().await.unwrap();
    source
            .query(
                "CREATE TABLE restored_entries (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO restored_entries VALUES (1, 'restored');",
            )
            .await
            .unwrap();
    source.backup_local_database(&restore_path).await.unwrap();

    let mut destination = SqliteDriver::new(live_path.to_string_lossy().as_ref());
    destination.connect().await.unwrap();
    destination
        .query("CREATE TABLE stale_entries (id INTEGER PRIMARY KEY)")
        .await
        .unwrap();
    let receipt = destination
        .restore_local_database(&restore_path)
        .await
        .unwrap();
    assert_eq!(receipt.integrity_check, "ok");
    let rows = destination
        .query("SELECT value FROM restored_entries")
        .await
        .unwrap();
    assert_eq!(rows[0].rows[0][0], Value::String("restored".to_string()));
    assert!(destination
        .query("SELECT * FROM stale_entries")
        .await
        .is_err());
}

#[tokio::test]
async fn parameterized_batches_share_the_explicit_transaction_boundary() {
    let mut driver = SqliteDriver::new(":memory:");
    driver.connect().await.unwrap();
    driver
        .query("CREATE TABLE imports (id INTEGER PRIMARY KEY, label TEXT NOT NULL)")
        .await
        .unwrap();

    driver.begin_transaction("csv-import", None).await.unwrap();
    let affected = driver
        .execute_parameterized_transaction(
            "csv-import",
            &[
                ParameterizedStatement {
                    sql: "INSERT INTO imports (id, label) VALUES ($1, $2)".to_string(),
                    params: vec![
                        QueryParameter {
                            value: Value::from(1),
                            data_type: Some("INTEGER".to_string()),
                        },
                        QueryParameter {
                            value: Value::String("first".to_string()),
                            data_type: Some("TEXT".to_string()),
                        },
                    ],
                },
                ParameterizedStatement {
                    sql: "INSERT INTO imports (id, label) VALUES ($1, $2)".to_string(),
                    params: vec![
                        QueryParameter {
                            value: Value::from(2),
                            data_type: Some("INTEGER".to_string()),
                        },
                        QueryParameter {
                            value: Value::String("second".to_string()),
                            data_type: Some("TEXT".to_string()),
                        },
                    ],
                },
            ],
        )
        .await
        .unwrap();
    assert_eq!(affected, vec![1, 1]);
    driver.rollback_transaction("csv-import").await.unwrap();

    let rows = driver.query("SELECT * FROM imports").await.unwrap();
    assert!(rows[0].rows.is_empty());
}
