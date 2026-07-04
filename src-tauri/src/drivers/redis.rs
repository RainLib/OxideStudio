use crate::core::{
    driver::DatabaseDriver,
    protocol::{ColumnDef, QueryResult},
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
    database_label: String,
}

impl RedisDriver {
    pub fn new(url: &str) -> Result<Self> {
        let client = redis::Client::open(url).context("Invalid Redis connection URL")?;
        Ok(Self {
            url: url.to_string(),
            client,
            connection: Mutex::new(None),
            database_label: redis_database_label(url),
        })
    }

    async fn connection(&self) -> Result<ConnectionManager> {
        self.connection
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("Redis connection is not established"))
    }

    async fn execute_tokens(&self, tokens: &[String]) -> Result<Value> {
        let command = tokens
            .first()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("Redis command is required"))?;
        let mut redis_command = redis::cmd(command);
        for arg in tokens.iter().skip(1) {
            redis_command.arg(arg);
        }

        let mut connection = self.connection().await?;
        let value: RedisValue = redis_command
            .query_async(&mut connection)
            .await
            .with_context(|| format!("Redis command failed: {command}"))?;
        Ok(redis_value_to_json(value))
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
            let result = self.execute_tokens(&tokens).await?;
            rows.push(vec![Value::String(command_label), result]);
        }

        Ok(vec![QueryResult::rows(columns, rows)])
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        Ok(vec![self.database_label.clone()])
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

fn split_redis_commands(input: &str) -> Result<Vec<Vec<String>>> {
    input
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| tokenize_redis_command(line.trim_end_matches(';').trim()))
        .collect()
}

fn tokenize_redis_command(input: &str) -> Result<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escape = false;

    for ch in input.chars() {
        if escape {
            current.push(match ch {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                other => other,
            });
            escape = false;
            continue;
        }

        if ch == '\\' {
            escape = true;
            continue;
        }

        match quote {
            Some(end_quote) if ch == end_quote => {
                quote = None;
            }
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
            }
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            None => current.push(ch),
        }
    }

    if escape {
        current.push('\\');
    }
    if quote.is_some() {
        return Err(anyhow!("Redis command has an unterminated quoted argument"));
    }
    if !current.is_empty() {
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
                "#
            )
            .unwrap(),
            vec![
                vec!["SET".to_string(), "user:1".to_string(), "Ada".to_string()],
                vec!["GET".to_string(), "user:1".to_string()]
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
}
