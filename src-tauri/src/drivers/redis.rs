use crate::core::{
    driver::DatabaseDriver,
    protocol::{CollectionInfo, ColumnDef, QueryResult},
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use redis::{aio::ConnectionManager, Value as RedisValue};
use serde_json::{json, Value};
use tokio::sync::Mutex;

pub struct RedisDriver {
    url: String,
    client: redis::Client,
    connection: Mutex<Option<ConnectionManager>>,
    active_database: Mutex<String>,
}

impl RedisDriver {
    pub fn new(url: &str) -> Result<Self> {
        let client = redis::Client::open(url).context("Invalid Redis connection URL")?;
        Ok(Self {
            url: url.to_string(),
            client,
            connection: Mutex::new(None),
            active_database: Mutex::new(redis_database_label(url)),
        })
    }

    async fn connection(&self) -> Result<ConnectionManager> {
        self.connection
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("Redis connection is not established"))
    }

    async fn execute_tokens_on(
        &self,
        connection: &mut ConnectionManager,
        tokens: &[String],
    ) -> Result<Value> {
        let command = tokens
            .first()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("Redis command is required"))?;
        let mut redis_command = redis::cmd(command);
        for arg in tokens.iter().skip(1) {
            redis_command.arg(arg);
        }

        let value: RedisValue = redis_command
            .query_async(connection)
            .await
            .with_context(|| format!("Redis command failed: {command}"))?;
        if command.eq_ignore_ascii_case("SELECT") {
            if let Some(database) = tokens.get(1) {
                *self.active_database.lock().await = validate_redis_database_label(database)?;
            }
        }
        Ok(redis_value_to_json(value))
    }

    async fn select_database_on(
        &self,
        connection: &mut ConnectionManager,
        database: &str,
    ) -> Result<String> {
        let database = validate_redis_database_label(database)?;
        redis::cmd("SELECT")
            .arg(&database)
            .query_async::<String>(connection)
            .await
            .with_context(|| format!("Redis SELECT {database} failed"))?;
        *self.active_database.lock().await = database.clone();
        Ok(database)
    }

    async fn query_on_connection(
        &self,
        connection: &mut ConnectionManager,
        sql: &str,
    ) -> Result<Vec<QueryResult>> {
        let commands = split_redis_commands(sql)?;
        if commands.is_empty() {
            return Err(anyhow!("Redis command is required"));
        }

        let columns = vec![
            ColumnDef {
                name: "command".to_string(),
                data_type: "text".to_string(),
            },
            ColumnDef {
                name: "result".to_string(),
                data_type: "json".to_string(),
            },
        ];
        let mut rows = Vec::new();

        for tokens in commands {
            let command_label = tokens.join(" ");
            let result = self.execute_tokens_on(connection, &tokens).await?;
            rows.push(vec![Value::String(command_label), result]);
        }

        Ok(vec![QueryResult::rows(columns, rows)])
    }
}

#[async_trait]
impl DatabaseDriver for RedisDriver {
    async fn connect(&mut self) -> Result<()> {
        let manager = self
            .client
            .get_connection_manager()
            .await
            .with_context(|| format!("Failed to connect to Redis at {}", self.url))?;

        let mut ping_connection = manager.clone();
        redis::cmd("PING")
            .query_async::<String>(&mut ping_connection)
            .await
            .context("Redis ping failed")?;

        *self.connection.lock().await = Some(manager);
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        *self.connection.lock().await = None;
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        let mut connection = self.connection().await?;
        redis::cmd("PING")
            .query_async::<String>(&mut connection)
            .await
            .context("Redis ping failed")?;
        Ok(())
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let mut connection = self.connection().await?;
        self.query_on_connection(&mut connection, sql).await
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        let mut connection = self.connection().await?;
        self.select_database_on(&mut connection, schema).await?;
        self.query_on_connection(&mut connection, sql).await
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        let mut connection = self.connection().await?;
        let configured_count = redis_database_count(&mut connection).await.unwrap_or(16);
        let active_database = self.active_database.lock().await.clone();
        Ok(redis_database_labels(configured_count, &active_database))
    }

    async fn get_collections(&self, namespace: &str) -> Result<Vec<CollectionInfo>> {
        let mut connection = self.connection().await?;
        let database = if namespace.trim().is_empty() {
            self.active_database.lock().await.clone()
        } else {
            validate_redis_database_label(namespace)?
        };
        self.select_database_on(&mut connection, &database).await?;
        let mut cursor = 0_u64;
        let mut keys = Vec::new();

        loop {
            let (next_cursor, mut batch) = redis::cmd("SCAN")
                .arg(cursor)
                .arg("COUNT")
                .arg(500)
                .query_async::<(u64, Vec<String>)>(&mut connection)
                .await
                .context("Redis SCAN failed")?;

            keys.append(&mut batch);
            if next_cursor == 0 || keys.len() >= 1_000 {
                break;
            }
            cursor = next_cursor;
        }

        keys.truncate(1_000);
        keys.sort();

        let mut collections = Vec::with_capacity(keys.len());
        for key in keys {
            let key_type = redis::cmd("TYPE")
                .arg(&key)
                .query_async::<String>(&mut connection)
                .await
                .unwrap_or_else(|_| "unknown".to_string());
            let document_count = redis_key_cardinality(&mut connection, &key, &key_type).await;
            collections.push(CollectionInfo {
                name: key,
                namespace: Some(database.clone()),
                collection_type: Some(key_type),
                document_count,
            });
        }

        Ok(collections)
    }

    async fn set_current_schema(&self, schema: &str) -> Result<()> {
        let mut connection = self.connection().await?;
        self.select_database_on(&mut connection, schema).await?;
        Ok(())
    }
}

async fn redis_key_cardinality(
    connection: &mut ConnectionManager,
    key: &str,
    key_type: &str,
) -> Option<u64> {
    let command = redis_cardinality_command(key_type)?;
    redis::cmd(command)
        .arg(key)
        .query_async::<u64>(connection)
        .await
        .ok()
}

fn redis_cardinality_command(key_type: &str) -> Option<&'static str> {
    match key_type.to_ascii_lowercase().as_str() {
        "string" => Some("STRLEN"),
        "hash" => Some("HLEN"),
        "list" => Some("LLEN"),
        "set" => Some("SCARD"),
        "zset" => Some("ZCARD"),
        "stream" => Some("XLEN"),
        _ => None,
    }
}

fn redis_database_label(url: &str) -> String {
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    without_query
        .rsplit('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit()))
        .unwrap_or("0")
        .to_string()
}

fn validate_redis_database_label(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(anyhow!("Redis database index is required"));
    }
    if !value.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(anyhow!("Redis database index must be numeric: {value}"));
    }
    Ok(value.to_string())
}

fn redis_database_labels(configured_count: usize, active_database: &str) -> Vec<String> {
    let count = configured_count.clamp(1, 1024);
    let mut labels = (0..count)
        .map(|index| index.to_string())
        .collect::<Vec<_>>();
    if let Ok(active_index) = active_database.trim().parse::<usize>() {
        if active_index >= count {
            labels.push(active_index.to_string());
        }
    }
    labels
}

async fn redis_database_count(connection: &mut ConnectionManager) -> Option<usize> {
    let values = redis::cmd("CONFIG")
        .arg("GET")
        .arg("databases")
        .query_async::<Vec<String>>(connection)
        .await
        .ok()?;
    values
        .windows(2)
        .find(|window| window[0].eq_ignore_ascii_case("databases"))
        .and_then(|window| window[1].parse::<usize>().ok())
        .filter(|count| *count > 0)
}

fn split_redis_commands(input: &str) -> Result<Vec<Vec<String>>> {
    split_redis_command_segments(input)
        .into_iter()
        .map(|line| tokenize_redis_command(line.trim()))
        .collect()
}

fn split_redis_command_segments(input: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escape = false;
    let mut line_comment = false;

    let push_current = |segments: &mut Vec<String>, current: &mut String| {
        let trimmed = current.trim();
        if !trimmed.is_empty() {
            segments.push(trimmed.to_string());
        }
        current.clear();
    };

    for ch in input.chars() {
        if line_comment {
            if ch == '\n' || ch == '\r' {
                line_comment = false;
                push_current(&mut segments, &mut current);
            }
            continue;
        }

        if escape {
            current.push(ch);
            escape = false;
            continue;
        }

        if quote.is_some() && ch == '\\' {
            current.push(ch);
            escape = true;
            continue;
        }

        match quote {
            Some(end_quote) if ch == end_quote => {
                quote = None;
                current.push(ch);
            }
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
                current.push(ch);
            }
            None if ch == '#' && current.trim().is_empty() => {
                line_comment = true;
            }
            None if ch == ';' || ch == '\n' || ch == '\r' => {
                push_current(&mut segments, &mut current);
            }
            None => current.push(ch),
        }
    }

    push_current(&mut segments, &mut current);
    segments
}

fn tokenize_redis_command(input: &str) -> Result<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escape = false;
    let mut token_started = false;

    for ch in input.chars() {
        if escape {
            current.push(match ch {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                other => other,
            });
            escape = false;
            token_started = true;
            continue;
        }

        if ch == '\\' {
            escape = true;
            token_started = true;
            continue;
        }

        match quote {
            Some(end_quote) if ch == end_quote => {
                quote = None;
                token_started = true;
            }
            Some(_) => {
                current.push(ch);
                token_started = true;
            }
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
                token_started = true;
            }
            None if ch.is_whitespace() => {
                if token_started {
                    tokens.push(std::mem::take(&mut current));
                    token_started = false;
                }
            }
            None => {
                current.push(ch);
                token_started = true;
            }
        }
    }

    if escape {
        current.push('\\');
    }
    if quote.is_some() {
        return Err(anyhow!("Redis command has an unterminated quoted argument"));
    }
    if token_started {
        tokens.push(current);
    }

    Ok(tokens)
}

fn redis_value_to_json(value: RedisValue) -> Value {
    match value {
        RedisValue::Nil => Value::Null,
        RedisValue::Int(value) => json!(value),
        RedisValue::BulkString(value) => Value::String(String::from_utf8_lossy(&value).to_string()),
        RedisValue::Array(values) => {
            Value::Array(values.into_iter().map(redis_value_to_json).collect())
        }
        RedisValue::SimpleString(value) => Value::String(value),
        RedisValue::Okay => Value::String("OK".to_string()),
        RedisValue::Map(entries) => Value::Array(
            entries
                .into_iter()
                .map(|(key, value)| {
                    json!({
                        "key": redis_value_to_json(key),
                        "value": redis_value_to_json(value),
                    })
                })
                .collect(),
        ),
        RedisValue::Attribute { data, attributes } => json!({
            "data": redis_value_to_json(*data),
            "attributes": attributes
                .into_iter()
                .map(|(key, value)| {
                    json!({
                        "key": redis_value_to_json(key),
                        "value": redis_value_to_json(value),
                    })
                })
                .collect::<Vec<_>>(),
        }),
        RedisValue::Set(values) => {
            Value::Array(values.into_iter().map(redis_value_to_json).collect())
        }
        RedisValue::Double(value) => json!(value),
        RedisValue::Boolean(value) => json!(value),
        RedisValue::VerbatimString { format, text } => json!({
            "format": format!("{format:?}"),
            "text": text,
        }),
        RedisValue::BigNumber(value) => Value::String(value.to_string()),
        RedisValue::Push { kind, data } => json!({
            "kind": format!("{kind:?}"),
            "data": data.into_iter().map(redis_value_to_json).collect::<Vec<_>>(),
        }),
        RedisValue::ServerError(error) => json!({
            "error": error.to_string(),
        }),
        other => json!({
            "type": format!("{other:?}"),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizes_redis_commands_with_quotes_and_escapes() {
        assert_eq!(
            tokenize_redis_command(r#"SET user:1 "Ada Lovelace""#).unwrap(),
            vec!["SET", "user:1", "Ada Lovelace"]
        );
        assert_eq!(
            tokenize_redis_command(r#"SET note 'line\nbreak'"#).unwrap(),
            vec!["SET", "note", "line\nbreak"]
        );
        assert_eq!(
            tokenize_redis_command(r#"SET "empty:string" """#).unwrap(),
            vec!["SET", "empty:string", ""]
        );
        assert!(tokenize_redis_command(r#"SET note "unterminated"#).is_err());
    }

    #[test]
    fn splits_line_oriented_redis_commands() {
        assert_eq!(
            split_redis_commands(
                r#"
                # comment
                SET user:1 Ada;
                GET user:1
                SET note "a;b"; TYPE note; DEL old
                "#
            )
            .unwrap(),
            vec![
                vec!["SET".to_string(), "user:1".to_string(), "Ada".to_string()],
                vec!["GET".to_string(), "user:1".to_string()],
                vec!["SET".to_string(), "note".to_string(), "a;b".to_string()],
                vec!["TYPE".to_string(), "note".to_string()],
                vec!["DEL".to_string(), "old".to_string()]
            ]
        );
    }

    #[test]
    fn converts_redis_values_to_json() {
        assert_eq!(redis_value_to_json(RedisValue::Nil), Value::Null);
        assert_eq!(redis_value_to_json(RedisValue::Int(7)), json!(7));
        assert_eq!(
            redis_value_to_json(RedisValue::BulkString(b"Ada".to_vec())),
            json!("Ada")
        );
        assert_eq!(
            redis_value_to_json(RedisValue::Array(vec![
                RedisValue::BulkString(b"id".to_vec()),
                RedisValue::Int(1),
            ])),
            json!(["id", 1])
        );
    }

    #[test]
    fn extracts_database_label_from_url() {
        assert_eq!(redis_database_label("redis://localhost:6379"), "0");
        assert_eq!(redis_database_label("redis://localhost:6379/2"), "2");
        assert_eq!(
            redis_database_label("redis://localhost:6379/3?protocol=resp3"),
            "3"
        );
    }

    #[test]
    fn validates_and_lists_redis_database_labels() {
        assert_eq!(validate_redis_database_label(" 12 ").unwrap(), "12");
        assert!(validate_redis_database_label("").is_err());
        assert!(validate_redis_database_label("app").is_err());
        assert!(validate_redis_database_label("1;FLUSHDB").is_err());

        assert_eq!(
            redis_database_labels(4, "2"),
            vec![
                "0".to_string(),
                "1".to_string(),
                "2".to_string(),
                "3".to_string()
            ]
        );
        assert_eq!(
            redis_database_labels(4, "8"),
            vec![
                "0".to_string(),
                "1".to_string(),
                "2".to_string(),
                "3".to_string(),
                "8".to_string()
            ]
        );
    }

    #[test]
    fn maps_key_types_to_cardinality_commands() {
        assert_eq!(redis_cardinality_command("string"), Some("STRLEN"));
        assert_eq!(redis_cardinality_command("hash"), Some("HLEN"));
        assert_eq!(redis_cardinality_command("list"), Some("LLEN"));
        assert_eq!(redis_cardinality_command("set"), Some("SCARD"));
        assert_eq!(redis_cardinality_command("zset"), Some("ZCARD"));
        assert_eq!(redis_cardinality_command("stream"), Some("XLEN"));
        assert_eq!(redis_cardinality_command("none"), None);
    }
}
