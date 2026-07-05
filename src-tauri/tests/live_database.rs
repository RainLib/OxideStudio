use anyhow::{anyhow, Context, Result};
use oxide_studio_lib::core::dialect::DatabaseKind;
use oxide_studio_lib::core::manager::ConnectionManager;
use oxide_studio_lib::core::protocol::{ParameterizedStatement, QueryParameter, QueryResult};
use oxide_studio_lib::drivers::connect_driver;
use serde_json::{json, Value};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

fn live_tests_enabled() -> bool {
    env::var("OXIDE_LIVE_DB_TESTS")
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

fn unique_name(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{prefix}_{}_{}", std::process::id(), nanos)
}

fn pg_ident(identifier: &str) -> String {
    format!(r#""{}""#, identifier.replace('"', r#""""#))
}

fn mysql_ident(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

fn param(value: Value, data_type: &str) -> QueryParameter {
    QueryParameter {
        value,
        data_type: Some(data_type.to_string()),
    }
}

fn scalar_i64(results: &[QueryResult]) -> Result<i64> {
    let value = results
        .first()
        .and_then(|result| result.rows.first())
        .and_then(|row| row.first())
        .ok_or_else(|| anyhow!("Expected a scalar result"))?;

    match value {
        Value::Number(number) => number
            .as_i64()
            .or_else(|| number.as_u64().and_then(|value| i64::try_from(value).ok()))
            .ok_or_else(|| anyhow!("Scalar number is not an i64: {number}")),
        Value::String(value) => value
            .parse::<i64>()
            .with_context(|| format!("Scalar string is not an i64: {value}")),
        other => Err(anyhow!("Scalar result is not numeric: {other}")),
    }
}

async fn manager_with_connection(
    kind: DatabaseKind,
    url: &str,
    connection_id: &str,
) -> Result<ConnectionManager> {
    manager_with_driver(kind.as_str(), url, connection_id).await
}

async fn manager_with_driver(
    driver_name: &str,
    url: &str,
    connection_id: &str,
) -> Result<ConnectionManager> {
    let manager = ConnectionManager::new();
    let driver = connect_driver(driver_name, url).await?;
    manager
        .add_connection(connection_id.to_string(), driver)
        .await;
    manager.ping(connection_id).await?;
    Ok(manager)
}

fn optional_live_url(env_name: &str, label: &str) -> Option<String> {
    env::var(env_name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            eprintln!("skipping live {label} test; set {env_name}");
            None
        })
}

fn column_index(result: &QueryResult, name: &str) -> Result<usize> {
    result
        .columns
        .iter()
        .position(|column| column.name == name)
        .ok_or_else(|| anyhow!("Expected result column {name}"))
}

#[tokio::test]
async fn postgres_live_lifecycle_metadata_crud_and_transactions() -> Result<()> {
    dotenvy::dotenv().ok();
    if !live_tests_enabled() {
        eprintln!("skipping live PostgreSQL test; set OXIDE_LIVE_DB_TESTS=1");
        return Ok(());
    }

    let url = env::var("TEST_POSTGRES_URL").context("TEST_POSTGRES_URL must be set")?;
    let connection_id = "live-postgres";
    let schema = unique_name("oxide_live_pg");
    let schema_ident = pg_ident(&schema);
    let manager = manager_with_connection(DatabaseKind::Postgres, &url, connection_id).await?;

    manager
        .query(
            connection_id,
            &format!("CREATE SCHEMA {schema_ident};"),
            None,
            None,
            None,
        )
        .await?;

    let test_result = postgres_flow(&manager, connection_id, &schema).await;

    let _ = manager
        .query(
            connection_id,
            &format!("DROP SCHEMA IF EXISTS {schema_ident} CASCADE;"),
            None,
            None,
            None,
        )
        .await;
    let _ = manager.disconnect_connection(connection_id).await;

    test_result
}

async fn postgres_flow(
    manager: &ConnectionManager,
    connection_id: &str,
    schema: &str,
) -> Result<()> {
    manager.set_current_schema(connection_id, schema).await?;

    manager
        .query(
            connection_id,
            r#"
            CREATE TABLE accounts (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                active BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            "#,
            Some(schema.to_string()),
            None,
            None,
        )
        .await?;
    manager
        .query(
            connection_id,
            "COMMENT ON TABLE accounts IS 'Live integration accounts';",
            Some(schema.to_string()),
            None,
            None,
        )
        .await?;
    manager
        .query(
            connection_id,
            "COMMENT ON COLUMN accounts.email IS 'Login email';",
            Some(schema.to_string()),
            None,
            None,
        )
        .await?;
    manager
        .query(
            connection_id,
            "CREATE INDEX accounts_active_idx ON accounts (active);",
            Some(schema.to_string()),
            None,
            None,
        )
        .await?;
    manager
        .query(
            connection_id,
            r#"
            CREATE TABLE orders (
                id SERIAL PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id),
                total NUMERIC(10, 2) NOT NULL CHECK (total >= 0)
            );
            "#,
            Some(schema.to_string()),
            None,
            None,
        )
        .await?;
    manager
        .query(
            connection_id,
            "CREATE VIEW active_accounts AS SELECT id, email FROM accounts WHERE active;",
            Some(schema.to_string()),
            None,
            None,
        )
        .await?;
    manager
        .query(
            connection_id,
            r#"
            CREATE MATERIALIZED VIEW account_order_counts AS
            SELECT account_id, count(*) AS order_count
            FROM orders
            GROUP BY account_id
            WITH NO DATA;
            "#,
            Some(schema.to_string()),
            None,
            None,
        )
        .await?;
    manager
        .query(
            connection_id,
            r#"
            CREATE FUNCTION calculate_score(user_id integer, bonus numeric DEFAULT 0)
            RETURNS integer
            LANGUAGE SQL
            AS $$
                SELECT user_id + bonus::integer
            $$;
            "#,
            Some(schema.to_string()),
            None,
            None,
        )
        .await?;

    let schemas = manager.get_schemas(connection_id).await?;
    assert!(schemas.iter().any(|name| name == schema));

    let tables = manager.get_tables(connection_id, schema).await?;
    assert!(
        tables
            .iter()
            .any(|table| table.name == "accounts"
                && table.table_type.as_deref() == Some("BASE TABLE"))
    );
    assert!(tables.iter().any(
        |table| table.name == "active_accounts" && table.table_type.as_deref() == Some("VIEW")
    ));
    assert!(tables
        .iter()
        .any(|table| table.name == "account_order_counts"
            && table.table_type.as_deref() == Some("MATERIALIZED VIEW")));

    let columns = manager
        .get_columns(connection_id, schema, "accounts")
        .await?;
    let email = columns
        .iter()
        .find(|column| column.name == "email")
        .context("email column should be present")?;
    assert!(!email.is_nullable);
    assert!(email.is_unique);
    assert_eq!(email.comment.as_deref(), Some("Login email"));

    let indexes = manager
        .get_indexes(connection_id, schema, "accounts")
        .await?;
    assert!(indexes.iter().any(|index| index.is_primary));
    assert!(indexes
        .iter()
        .any(|index| index.name == "accounts_active_idx" && index.columns == ["active"]));

    let constraints = manager
        .get_constraints(connection_id, schema, "orders")
        .await?;
    assert!(constraints
        .iter()
        .any(|constraint| constraint.constraint_type == "FOREIGN KEY"
            && constraint.referenced_table.as_deref() == Some("accounts")));
    assert!(constraints
        .iter()
        .any(|constraint| constraint.constraint_type == "CHECK"));

    let functions = manager.get_functions(connection_id, schema).await?;
    let score_function = functions
        .iter()
        .find(|function| function.name == "calculate_score")
        .context("calculate_score function should be present")?;
    assert_eq!(score_function.return_type, "integer");
    assert!(score_function
        .parameters
        .iter()
        .any(|parameter| parameter.name == "bonus" && parameter.optional));

    manager
        .execute_parameterized(
            connection_id,
            &format!(
                "INSERT INTO {}.accounts (email) VALUES ($1);",
                pg_ident(schema)
            ),
            &[param(json!("alice@example.com"), "text")],
        )
        .await?;
    let account_id = scalar_i64(
        &manager
            .query_parameterized(
                connection_id,
                &format!(
                    "SELECT id FROM {}.accounts WHERE email = $1;",
                    pg_ident(schema)
                ),
                &[param(json!("alice@example.com"), "text")],
            )
            .await?,
    )?;

    manager
        .execute_parameterized_batch(
            connection_id,
            &[
                ParameterizedStatement {
                    sql: format!(
                        "INSERT INTO {}.orders (account_id, total) VALUES ($1, $2);",
                        pg_ident(schema)
                    ),
                    params: vec![
                        param(json!(account_id), "integer"),
                        param(json!(12.5), "numeric"),
                    ],
                },
                ParameterizedStatement {
                    sql: format!(
                        "UPDATE {}.accounts SET active = $1 WHERE id = $2;",
                        pg_ident(schema)
                    ),
                    params: vec![
                        param(json!(false), "boolean"),
                        param(json!(account_id), "integer"),
                    ],
                },
            ],
        )
        .await?;
    manager
        .query(
            connection_id,
            "REFRESH MATERIALIZED VIEW account_order_counts;",
            Some(schema.to_string()),
            None,
            None,
        )
        .await?;

    let inactive_count = scalar_i64(
        &manager
            .query(
                connection_id,
                "SELECT COUNT(*) FROM accounts WHERE active = false;",
                None,
                None,
                None,
            )
            .await?,
    )?;
    assert_eq!(inactive_count, 1);

    manager
        .begin_transaction(connection_id, "pg-live-rollback", Some(schema.to_string()))
        .await?;
    manager
        .query(
            connection_id,
            "CREATE TEMP TABLE oxide_pg_tx_multi(id integer); INSERT INTO oxide_pg_tx_multi VALUES (1);",
            None,
            Some("pg-live-rollback".to_string()),
            Some("pg-live-multi-statement".to_string()),
        )
        .await?;
    manager
        .query(
            connection_id,
            "INSERT INTO accounts (email) VALUES ('rollback@example.com');",
            None,
            Some("pg-live-rollback".to_string()),
            None,
        )
        .await?;
    manager
        .rollback_transaction(connection_id, "pg-live-rollback")
        .await?;
    let rollback_count = scalar_i64(
        &manager
            .query(
                connection_id,
                "SELECT COUNT(*) FROM accounts WHERE email = 'rollback@example.com';",
                Some(schema.to_string()),
                None,
                None,
            )
            .await?,
    )?;
    assert_eq!(rollback_count, 0);

    Ok(())
}

#[tokio::test]
async fn mysql_live_lifecycle_metadata_crud_and_transactions() -> Result<()> {
    dotenvy::dotenv().ok();
    if !live_tests_enabled() {
        eprintln!("skipping live MySQL test; set OXIDE_LIVE_DB_TESTS=1");
        return Ok(());
    }

    let url = env::var("TEST_MYSQL_URL").context("TEST_MYSQL_URL must be set")?;
    let connection_id = "live-mysql";
    let database = unique_name("oxide_live_mysql");
    let database_ident = mysql_ident(&database);
    let manager = manager_with_connection(DatabaseKind::Mysql, &url, connection_id).await?;

    manager
        .query(
            connection_id,
            &format!("CREATE DATABASE {database_ident};"),
            None,
            None,
            Some("mysql-live-create-database".to_string()),
        )
        .await?;

    let test_result = mysql_flow(&manager, connection_id, &database).await;

    let _ = manager
        .query(
            connection_id,
            &format!("DROP DATABASE IF EXISTS {database_ident};"),
            None,
            None,
            None,
        )
        .await;
    let _ = manager.disconnect_connection(connection_id).await;

    test_result
}

async fn mysql_flow(
    manager: &ConnectionManager,
    connection_id: &str,
    database: &str,
) -> Result<()> {
    manager.set_current_schema(connection_id, database).await?;

    manager
        .query(
            connection_id,
            r#"
            CREATE TABLE accounts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE COMMENT 'Login email',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) COMMENT='Live integration accounts';
            "#,
            Some(database.to_string()),
            None,
            Some("mysql-live-create-table".to_string()),
        )
        .await?;
    manager
        .query(
            connection_id,
            "CREATE INDEX accounts_active_idx ON accounts (active);",
            Some(database.to_string()),
            None,
            None,
        )
        .await?;
    manager
        .query(
            connection_id,
            r#"
            CREATE TABLE orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                account_id INT NOT NULL,
                total DECIMAL(10, 2) NOT NULL,
                CONSTRAINT orders_total_check CHECK (total >= 0),
                CONSTRAINT orders_account_fk FOREIGN KEY (account_id) REFERENCES accounts(id)
            );
            "#,
            Some(database.to_string()),
            None,
            None,
        )
        .await?;
    manager
        .query(
            connection_id,
            "CREATE VIEW active_accounts AS SELECT id, email FROM accounts WHERE active = TRUE;",
            Some(database.to_string()),
            None,
            None,
        )
        .await?;
    manager
        .query(
            connection_id,
            r#"
            CREATE FUNCTION calculate_score(user_id INT, bonus INT)
            RETURNS INT
            DETERMINISTIC
            RETURN user_id + bonus;
            "#,
            Some(database.to_string()),
            None,
            None,
        )
        .await?;

    let schemas = manager.get_schemas(connection_id).await?;
    assert!(schemas.iter().any(|name| name == database));

    let tables = manager.get_tables(connection_id, database).await?;
    assert!(
        tables
            .iter()
            .any(|table| table.name == "accounts"
                && table.table_type.as_deref() == Some("BASE TABLE"))
    );
    assert!(tables.iter().any(
        |table| table.name == "active_accounts" && table.table_type.as_deref() == Some("VIEW")
    ));

    let columns = manager
        .get_columns(connection_id, database, "accounts")
        .await?;
    let id = columns
        .iter()
        .find(|column| column.name == "id")
        .context("id column should be present")?;
    assert!(id.is_primary_key);
    assert!(id.is_auto_increment);
    let email = columns
        .iter()
        .find(|column| column.name == "email")
        .context("email column should be present")?;
    assert_eq!(email.comment.as_deref(), Some("Login email"));
    assert!(email.is_unique);

    let indexes = manager
        .get_indexes(connection_id, database, "accounts")
        .await?;
    assert!(indexes.iter().any(|index| index.is_primary));
    assert!(indexes
        .iter()
        .any(|index| index.name == "accounts_active_idx" && index.columns == ["active"]));

    let constraints = manager
        .get_constraints(connection_id, database, "orders")
        .await?;
    assert!(constraints
        .iter()
        .any(|constraint| constraint.constraint_type == "FOREIGN KEY"
            && constraint.referenced_table.as_deref() == Some("accounts")));
    assert!(constraints
        .iter()
        .any(|constraint| constraint.constraint_type == "CHECK"));

    let functions = manager.get_functions(connection_id, database).await?;
    let score_function = functions
        .iter()
        .find(|function| function.name == "calculate_score")
        .context("calculate_score function should be present")?;
    assert_eq!(score_function.return_type.to_ascii_lowercase(), "int");
    assert_eq!(score_function.parameters.len(), 2);

    manager
        .execute_parameterized(
            connection_id,
            &format!(
                "INSERT INTO {}.accounts (email) VALUES (?);",
                mysql_ident(database)
            ),
            &[param(json!("alice@example.com"), "varchar")],
        )
        .await?;
    let account_id = scalar_i64(
        &manager
            .query_parameterized(
                connection_id,
                &format!(
                    "SELECT id FROM {}.accounts WHERE email = ?;",
                    mysql_ident(database)
                ),
                &[param(json!("alice@example.com"), "varchar")],
            )
            .await?,
    )?;

    manager
        .execute_parameterized_batch(
            connection_id,
            &[
                ParameterizedStatement {
                    sql: format!(
                        "INSERT INTO {}.orders (account_id, total) VALUES (?, ?);",
                        mysql_ident(database)
                    ),
                    params: vec![
                        param(json!(account_id), "int"),
                        param(json!(12.5), "decimal"),
                    ],
                },
                ParameterizedStatement {
                    sql: format!(
                        "UPDATE {}.accounts SET active = ? WHERE id = ?;",
                        mysql_ident(database)
                    ),
                    params: vec![
                        param(json!(false), "boolean"),
                        param(json!(account_id), "int"),
                    ],
                },
            ],
        )
        .await?;

    let inactive_count = scalar_i64(
        &manager
            .query(
                connection_id,
                "SELECT COUNT(*) FROM accounts WHERE active = FALSE;",
                None,
                None,
                None,
            )
            .await?,
    )?;
    assert_eq!(inactive_count, 1);

    manager
        .begin_transaction(
            connection_id,
            "mysql-live-rollback",
            Some(database.to_string()),
        )
        .await?;
    let show_tables = manager
        .query(
            connection_id,
            "SHOW TABLES;",
            None,
            Some("mysql-live-rollback".to_string()),
            Some("mysql-live-show-tables".to_string()),
        )
        .await?;
    assert!(
        !show_tables.is_empty(),
        "MySQL transaction queries should support unprepared statements"
    );
    manager
        .query(
            connection_id,
            "INSERT INTO accounts (email) VALUES ('rollback@example.com');",
            None,
            Some("mysql-live-rollback".to_string()),
            None,
        )
        .await?;
    manager
        .rollback_transaction(connection_id, "mysql-live-rollback")
        .await?;
    let rollback_count = scalar_i64(
        &manager
            .query(
                connection_id,
                "SELECT COUNT(*) FROM accounts WHERE email = 'rollback@example.com';",
                Some(database.to_string()),
                None,
                None,
            )
            .await?,
    )?;
    assert_eq!(rollback_count, 0);

    Ok(())
}

#[tokio::test]
async fn redis_live_key_value_metadata_and_commands() -> Result<()> {
    dotenvy::dotenv().ok();
    if !live_tests_enabled() {
        eprintln!("skipping live Redis test; set OXIDE_LIVE_DB_TESTS=1");
        return Ok(());
    }

    let Some(url) = optional_live_url("TEST_REDIS_URL", "Redis") else {
        return Ok(());
    };
    let connection_id = "live-redis";
    let key_prefix = unique_name("oxide_live_redis");
    let string_key = format!("{key_prefix}:string");
    let hash_key = format!("{key_prefix}:hash");
    let manager = manager_with_driver("redis", &url, connection_id).await?;

    let cleanup_command = format!("DEL {string_key} {hash_key}");
    let _ = manager
        .query(connection_id, &cleanup_command, None, None, None)
        .await;

    let test_result = async {
        let schemas = manager.get_schemas(connection_id).await?;
        assert!(
            schemas.iter().any(|schema| schema == "0"),
            "Redis database label should default to DB 0"
        );

        manager
            .query(
                connection_id,
                &format!(
                    "SET {string_key} ada@example.com\nHSET {hash_key} email ada@example.com active true"
                ),
                None,
                None,
                None,
            )
            .await?;

        let get_results = manager
            .query(connection_id, &format!("GET {string_key}"), None, None, None)
            .await?;
        assert_eq!(get_results[0].rows[0][1], json!("ada@example.com"));

        let collections = manager.get_collections(connection_id, "").await?;
        let string_entry = collections
            .iter()
            .find(|collection| collection.name == string_key)
            .context("Redis string key should be discoverable")?;
        assert_eq!(string_entry.collection_type.as_deref(), Some("string"));
        let hash_entry = collections
            .iter()
            .find(|collection| {
                collection.name == hash_key && collection.collection_type.as_deref() == Some("hash")
            })
            .context("Redis hash key should be discoverable")?;
        assert_eq!(hash_entry.document_count, Some(2));

        Ok(())
    }
    .await;

    let _ = manager
        .query(connection_id, &cleanup_command, None, None, None)
        .await;
    let _ = manager.disconnect_connection(connection_id).await;

    test_result
}

#[tokio::test]
async fn mongodb_live_document_metadata_and_commands() -> Result<()> {
    dotenvy::dotenv().ok();
    if !live_tests_enabled() {
        eprintln!("skipping live MongoDB test; set OXIDE_LIVE_DB_TESTS=1");
        return Ok(());
    }

    let Some(url) = optional_live_url("TEST_MONGODB_URL", "MongoDB") else {
        return Ok(());
    };
    let connection_id = "live-mongodb";
    let database = unique_name("oxide_live_mongo");
    let collection = "users";
    let manager = manager_with_driver("mongodb", &url, connection_id).await?;

    let test_result = async {
        manager
            .query(
                connection_id,
                &serde_json::to_string(&json!({
                    "database": database,
                    "collection": collection,
                    "insertMany": [
                        {
                            "email": "ada@example.com",
                            "active": true,
                            "score": 7,
                            "profile": {"role": "admin"}
                        },
                        {
                            "email": "grace@example.com",
                            "active": false,
                            "tags": ["compiler"]
                        }
                    ]
                }))?,
                None,
                None,
                None,
            )
            .await?;

        manager
            .query(
                connection_id,
                &serde_json::to_string(&json!({
                    "database": database,
                    "command": {
                        "createIndexes": collection,
                        "indexes": [
                            {
                                "key": {"email": 1},
                                "name": "email_1",
                                "unique": true
                            }
                        ]
                    }
                }))?,
                None,
                None,
                None,
            )
            .await?;

        let schemas = manager.get_schemas(connection_id).await?;
        assert!(schemas.iter().any(|schema| schema == &database));

        let collections = manager.get_collections(connection_id, &database).await?;
        let users = collections
            .iter()
            .find(|item| item.name == collection)
            .context("MongoDB users collection should be discoverable")?;
        assert_eq!(users.collection_type.as_deref(), Some("collection"));
        assert!(users.document_count.unwrap_or_default() >= 2);

        let columns = manager
            .get_columns(connection_id, &database, collection)
            .await?;
        assert!(columns
            .iter()
            .any(|column| column.name == "_id" && column.is_primary_key && column.is_indexed));
        assert!(columns
            .iter()
            .any(|column| column.name == "email" && column.data_type == "string"));
        assert!(columns.iter().any(|column| column.name == "active"));
        assert!(columns.iter().any(|column| column.name == "profile"));
        assert!(columns
            .iter()
            .any(|column| column.name == "tags" && column.is_nullable));

        let indexes = manager
            .get_indexes(connection_id, &database, collection)
            .await?;
        assert!(indexes.iter().any(|index| index.name == "_id_"
            && index.is_primary
            && index.is_unique
            && index.columns == ["_id"]));
        assert!(indexes
            .iter()
            .any(|index| index.name == "email_1" && index.is_unique && index.columns == ["email"]));

        let find_results = manager
            .query(
                connection_id,
                &serde_json::to_string(&json!({
                    "database": database,
                    "collection": collection,
                    "find": {"active": true},
                    "limit": 5
                }))?,
                None,
                None,
                None,
            )
            .await?;
        let email_index = column_index(&find_results[0], "email")?;
        assert_eq!(find_results[0].rows.len(), 1);
        assert_eq!(
            find_results[0].rows[0][email_index],
            json!("ada@example.com")
        );

        Ok(())
    }
    .await;

    let _ = manager
        .query(
            connection_id,
            &serde_json::to_string(&json!({
                "database": database,
                "command": {"dropDatabase": 1}
            }))?,
            None,
            None,
            None,
        )
        .await;
    let _ = manager.disconnect_connection(connection_id).await;

    test_result
}

#[tokio::test]
async fn elasticsearch_live_index_metadata_and_search() -> Result<()> {
    dotenvy::dotenv().ok();
    if !live_tests_enabled() {
        eprintln!("skipping live Elasticsearch test; set OXIDE_LIVE_DB_TESTS=1");
        return Ok(());
    }

    let Some(url) = optional_live_url("TEST_ELASTICSEARCH_URL", "Elasticsearch") else {
        return Ok(());
    };
    let connection_id = "live-elasticsearch";
    let index = unique_name("oxide_live_es").to_ascii_lowercase();
    let manager = manager_with_driver("elasticsearch", &url, connection_id).await?;

    let test_result = async {
        manager
            .query(
                connection_id,
                &format!(
                    r#"
                    PUT /{index}
                    {{"mappings":{{"properties":{{"email":{{"type":"keyword"}},"active":{{"type":"boolean"}},"score":{{"type":"integer"}}}}}}}}
                    PUT /{index}/_doc/1
                    {{"email":"ada@example.com","active":true,"score":7}}
                    POST /{index}/_refresh
                    "#,
                ),
                None,
                None,
                None,
            )
            .await?;

        let collections = manager.get_collections(connection_id, "").await?;
        let index_info = collections
            .iter()
            .find(|collection| collection.name == index)
            .context("Elasticsearch index should be discoverable")?;
        assert_eq!(index_info.collection_type.as_deref(), Some("index"));
        assert!(index_info.document_count.unwrap_or_default() >= 1);

        let columns = manager.get_columns(connection_id, "default", &index).await?;
        assert!(columns.iter().any(|column| column.name == "_id"
            && column.is_primary_key
            && column.is_indexed));
        assert!(columns.iter().any(|column| column.name == "email"
            && column.data_type == "keyword"));
        assert!(columns.iter().any(|column| column.name == "active"
            && column.data_type == "boolean"));
        assert!(columns.iter().any(|column| column.name == "score"
            && column.data_type == "integer"));

        let search_results = manager
            .query(
                connection_id,
                &format!(
                    r#"
                    POST /{index}/_search
                    {{"query":{{"match_all":{{}}}},"sort":[{{"email":"asc"}}]}}
                    "#,
                ),
                None,
                None,
                None,
            )
            .await?;
        let source_index = column_index(&search_results[0], "source")?;
        assert_eq!(search_results[0].rows.len(), 1);
        assert_eq!(
            search_results[0].rows[0][source_index]
                .get("email")
                .and_then(Value::as_str),
            Some("ada@example.com")
        );

        Ok(())
    }
    .await;

    let _ = manager
        .query(connection_id, &format!("DELETE /{index}"), None, None, None)
        .await;
    let _ = manager.disconnect_connection(connection_id).await;

    test_result
}
