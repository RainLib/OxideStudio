use crate::core::{
    driver::DatabaseDriver,
    protocol::{CollectionInfo, CollectionPage, ColumnDef, QueryResult},
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use redis::{aio::ConnectionManager, Value as RedisValue};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const REDIS_SCAN_CURSOR_TTL: Duration = Duration::from_secs(60);
const REDIS_SCAN_CURSOR_LIMIT: usize = 64;
const REDIS_SCAN_PAGE_BYTE_LIMIT: usize = 256 * 1024;
const REDIS_KEY_FILTER_BYTE_LIMIT: usize = 512;

struct RedisKeyScanState {
    database: String,
    redis_cursor: u64,
    started: bool,
    pending: VecDeque<String>,
    total: Option<u64>,
    match_pattern: Option<String>,
    last_used: Instant,
}

pub struct RedisDriver {
    url: String,
    client: redis::Client,
    connection: Mutex<Option<ConnectionManager>>,
    active_database: Mutex<String>,
    operation_lock: Mutex<()>,
    scan_cursors: Mutex<HashMap<String, RedisKeyScanState>>,
    next_scan_cursor: AtomicU64,
}

impl RedisDriver {
    pub fn new(url: &str) -> Result<Self> {
        let client = redis::Client::open(url).context("Invalid Redis connection URL")?;
        Ok(Self {
            url: url.to_string(),
            client,
            connection: Mutex::new(None),
            active_database: Mutex::new(redis_database_label(url)),
            operation_lock: Mutex::new(()),
            scan_cursors: Mutex::new(HashMap::new()),
            next_scan_cursor: AtomicU64::new(1),
        })
    }

    async fn connection(&self) -> Result<ConnectionManager> {
        self.connection
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("Redis connection is not established"))
    }

    async fn take_scan_state(
        &self,
        token: Option<&str>,
        database: &str,
        match_pattern: Option<&str>,
    ) -> Result<RedisKeyScanState> {
        let Some(token) = token else {
            return Ok(RedisKeyScanState {
                database: database.to_string(),
                redis_cursor: 0,
                started: false,
                pending: VecDeque::new(),
                total: None,
                match_pattern: match_pattern.map(str::to_string),
                last_used: Instant::now(),
            });
        };

        let now = Instant::now();
        let mut cursors = self.scan_cursors.lock().await;
        cursors.retain(|_, state| now.duration_since(state.last_used) <= REDIS_SCAN_CURSOR_TTL);
        let state = cursors
            .remove(token)
            .ok_or_else(|| anyhow!("Redis key cursor expired; refresh the key list"))?;
        if state.database != database {
            return Err(anyhow!("Redis key cursor belongs to another database"));
        }
        if state.match_pattern.as_deref() != match_pattern {
            return Err(anyhow!("Redis key cursor belongs to another filter"));
        }
        Ok(state)
    }

    async fn store_scan_state(&self, mut state: RedisKeyScanState) -> String {
        state.last_used = Instant::now();
        let token = format!(
            "redis-scan-{}",
            self.next_scan_cursor.fetch_add(1, Ordering::Relaxed)
        );
        let mut cursors = self.scan_cursors.lock().await;
        let now = Instant::now();
        cursors.retain(|_, item| now.duration_since(item.last_used) <= REDIS_SCAN_CURSOR_TTL);
        if cursors.len() >= REDIS_SCAN_CURSOR_LIMIT {
            if let Some(oldest) = cursors
                .iter()
                .min_by_key(|(_, item)| item.last_used)
                .map(|(key, _)| key.clone())
            {
                cursors.remove(&oldest);
            }
        }
        cursors.insert(token.clone(), state);
        token
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
        let default_database = redis_database_label(&self.url);
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
        *self.active_database.lock().await = default_database;
        self.scan_cursors.lock().await.clear();
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        *self.connection.lock().await = None;
        *self.active_database.lock().await = redis_database_label(&self.url);
        self.scan_cursors.lock().await.clear();
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
        let _operation = self.operation_lock.lock().await;
        let mut connection = self.connection().await?;
        self.query_on_connection(&mut connection, sql).await
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        let _operation = self.operation_lock.lock().await;
        let mut connection = self.connection().await?;
        self.select_database_on(&mut connection, schema).await?;
        self.query_on_connection(&mut connection, sql).await
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        let mut connection = self.connection().await?;
        let active_database = self.active_database.lock().await.clone();
        Ok(redis_database_labels(&mut connection, &active_database).await)
    }

    async fn get_collections(&self, namespace: &str) -> Result<Vec<CollectionInfo>> {
        // Keep the legacy API bounded too. Any caller that has not migrated to
        // cursor pages must never trigger a full keyspace scan implicitly.
        Ok(self
            .get_collections_page(namespace, None, 100, None)
            .await?
            .items)
    }

    async fn get_collections_page(
        &self,
        namespace: &str,
        cursor: Option<&str>,
        limit: usize,
        filter: Option<&str>,
    ) -> Result<CollectionPage> {
        let _operation = self.operation_lock.lock().await;
        let mut connection = self.connection().await?;
        let database = if namespace.trim().is_empty() {
            self.active_database.lock().await.clone()
        } else {
            validate_redis_database_label(namespace)?
        };
        self.select_database_on(&mut connection, &database).await?;

        let limit = limit.clamp(1, 1_000);
        let match_pattern = redis_key_match_pattern(filter)?;
        let mut state = self
            .take_scan_state(cursor, &database, match_pattern.as_deref())
            .await?;
        if state.total.is_none() && match_pattern.is_none() {
            state.total = redis::cmd("DBSIZE")
                .query_async::<u64>(&mut connection)
                .await
                .ok();
        }

        // At most one SCAN round trip is admitted per page. Redis may return
        // more than COUNT; overflow remains behind an opaque backend token so
        // the IPC payload and React tree are still strictly bounded.
        if state.pending.len() < limit && (!state.started || state.redis_cursor != 0) {
            let mut scan = redis::cmd("SCAN");
            scan.arg(state.redis_cursor);
            if let Some(pattern) = &match_pattern {
                scan.arg("MATCH").arg(pattern);
            }
            let (next_cursor, batch) = scan
                .arg("COUNT")
                .arg(limit)
                .query_async::<(u64, Vec<String>)>(&mut connection)
                .await
                .context("Redis SCAN page failed")?;
            state.started = true;
            state.redis_cursor = next_cursor;
            state.pending.extend(batch);
        }

        let mut keys = drain_scan_page(&mut state.pending, limit, REDIS_SCAN_PAGE_BYTE_LIMIT);
        keys.sort();
        keys.dedup();

        let key_types = redis_key_types(&mut connection, &keys).await;
        let items = keys
            .into_iter()
            .zip(key_types)
            .map(|(name, collection_type)| CollectionInfo {
                name,
                namespace: Some(database.clone()),
                collection_type: Some(collection_type),
                document_count: None,
            })
            .collect();
        let total = state.total;
        let next_cursor = if !state.pending.is_empty() || state.redis_cursor != 0 {
            Some(self.store_scan_state(state).await)
        } else {
            None
        };

        Ok(CollectionPage {
            items,
            next_cursor,
            total,
        })
    }

    async fn set_current_schema(&self, schema: &str) -> Result<()> {
        let _operation = self.operation_lock.lock().await;
        let mut connection = self.connection().await?;
        self.select_database_on(&mut connection, schema).await?;
        Ok(())
    }
}

fn drain_scan_page(pending: &mut VecDeque<String>, limit: usize, byte_limit: usize) -> Vec<String> {
    let limit = limit.max(1);
    let mut keys = Vec::with_capacity(limit.min(pending.len()));
    let mut bytes = 0_usize;
    while keys.len() < limit {
        let Some(key) = pending.pop_front() else {
            break;
        };
        if key.len() > byte_limit {
            continue;
        }
        if !keys.is_empty() && bytes.saturating_add(key.len()) > byte_limit {
            pending.push_front(key);
            break;
        }
        bytes = bytes.saturating_add(key.len());
        keys.push(key);
    }
    keys
}

async fn redis_key_types(connection: &mut ConnectionManager, keys: &[String]) -> Vec<String> {
    let mut types = Vec::with_capacity(keys.len());
    for chunk in keys.chunks(500) {
        let mut pipeline = redis::pipe();
        for key in chunk {
            pipeline.cmd("TYPE").arg(key);
        }
        match pipeline.query_async::<Vec<String>>(connection).await {
            Ok(chunk_types) if chunk_types.len() == chunk.len() => types.extend(chunk_types),
            _ => types.extend((0..chunk.len()).map(|_| "unknown".to_string())),
        }
    }
    types
}

fn redis_key_match_pattern(filter: Option<&str>) -> Result<Option<String>> {
    let Some(filter) = filter.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if filter.len() > REDIS_KEY_FILTER_BYTE_LIMIT {
        return Err(anyhow!(
            "Redis key filter exceeds {} UTF-8 bytes",
            REDIS_KEY_FILTER_BYTE_LIMIT
        ));
    }

    let mut pattern = String::with_capacity(filter.len() + 2);
    pattern.push('*');
    for character in filter.chars() {
        if matches!(character, '*' | '?' | '[' | ']' | '\\') {
            pattern.push('\\');
        }
        pattern.push(character);
    }
    pattern.push('*');
    Ok(Some(pattern))
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

fn parse_redis_keyspace_databases(info: &str, active_database: &str) -> Vec<String> {
    let mut indexes = BTreeSet::new();
    for line in info.lines().map(str::trim) {
        let Some((database, statistics)) = line.split_once(':') else {
            continue;
        };
        let Some(index) = database
            .strip_prefix("db")
            .and_then(|value| value.parse().ok())
        else {
            continue;
        };
        let has_keys = statistics
            .split(',')
            .find_map(|item| item.strip_prefix("keys="))
            .and_then(|value| value.parse::<u64>().ok())
            .is_some_and(|count| count > 0);
        if has_keys {
            indexes.insert(index);
        }
    }
    if let Ok(active_index) = active_database.trim().parse::<usize>() {
        indexes.insert(active_index);
    }
    if indexes.is_empty() {
        indexes.insert(0);
    }
    indexes.into_iter().map(|index| index.to_string()).collect()
}

fn configured_redis_database_labels(
    database_count: Option<usize>,
    discovered: Vec<String>,
    active_database: &str,
) -> Vec<String> {
    let Some(database_count) = database_count.filter(|count| (1..=1_024).contains(count)) else {
        return discovered;
    };

    let mut indexes = (0..database_count).collect::<BTreeSet<_>>();
    if let Ok(active_index) = active_database.trim().parse::<usize>() {
        indexes.insert(active_index);
    }
    indexes.into_iter().map(|index| index.to_string()).collect()
}

async fn redis_database_labels(
    connection: &mut ConnectionManager,
    active_database: &str,
) -> Vec<String> {
    let info = redis::cmd("INFO")
        .arg("keyspace")
        .query_async::<String>(connection)
        .await
        .unwrap_or_default();
    let discovered = parse_redis_keyspace_databases(&info, active_database);

    // Standalone Redis normally exposes the logical DB count through CONFIG.
    // Managed/cluster deployments may deny CONFIG; in that case retain the
    // non-empty INFO keyspace list plus the explicitly selected DB.
    let database_count = redis::cmd("CONFIG")
        .arg("GET")
        .arg("databases")
        .query_async::<Vec<String>>(connection)
        .await
        .ok()
        .and_then(|values| {
            values
                .iter()
                .rev()
                .find_map(|value| value.trim().parse::<usize>().ok())
        });

    configured_redis_database_labels(database_count, discovered, active_database)
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

        let info =
            "# Keyspace\r\ndb0:keys=2,expires=0,avg_ttl=0\r\ndb3:keys=1,expires=0,avg_ttl=0\r\n";
        assert_eq!(
            parse_redis_keyspace_databases(info, "3"),
            vec!["0".to_string(), "3".to_string()]
        );
        assert_eq!(
            parse_redis_keyspace_databases(info, "8"),
            vec!["0".to_string(), "3".to_string(), "8".to_string()]
        );
        assert_eq!(
            parse_redis_keyspace_databases("# Keyspace\r\n", "0"),
            vec!["0".to_string()]
        );
        assert_eq!(
            configured_redis_database_labels(Some(4), vec!["0".to_string(), "3".to_string()], "2",),
            vec![
                "0".to_string(),
                "1".to_string(),
                "2".to_string(),
                "3".to_string(),
            ]
        );
        assert_eq!(
            configured_redis_database_labels(None, vec!["0".to_string(), "3".to_string()], "0",),
            vec!["0".to_string(), "3".to_string()]
        );
    }

    #[test]
    fn scan_overflow_is_drained_in_hard_bounded_pages_without_loss() {
        let expected = (0..1_005)
            .map(|index| format!("key:{index}"))
            .collect::<Vec<_>>();
        let mut pending = VecDeque::from(expected.clone());
        let mut actual = Vec::new();

        while !pending.is_empty() {
            let page = drain_scan_page(&mut pending, 100, REDIS_SCAN_PAGE_BYTE_LIMIT);
            assert!(page.len() <= 100);
            actual.extend(page);
        }

        assert_eq!(actual, expected);
    }

    #[test]
    fn scan_page_respects_serialized_key_byte_budget() {
        let mut pending = VecDeque::from(vec![
            "a".repeat(120_000),
            "b".repeat(120_000),
            "c".repeat(120_000),
        ]);

        let page = drain_scan_page(&mut pending, 100, REDIS_SCAN_PAGE_BYTE_LIMIT);

        assert_eq!(page.len(), 2);
        assert!(page.iter().map(String::len).sum::<usize>() <= REDIS_SCAN_PAGE_BYTE_LIMIT);
        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn redis_key_filters_use_escaped_literal_substring_patterns() {
        assert_eq!(redis_key_match_pattern(None).unwrap(), None);
        assert_eq!(redis_key_match_pattern(Some("   ")).unwrap(), None);
        assert_eq!(
            redis_key_match_pattern(Some(r" user:*?[x]\ ")).unwrap(),
            Some(r"*user:\*\?\[x\]\\*".to_string())
        );
        assert!(redis_key_match_pattern(Some(&"x".repeat(513))).is_err());
    }

    #[tokio::test]
    async fn disconnect_clears_connection_and_resets_active_database() {
        let driver = RedisDriver::new("redis://localhost:6379/2").unwrap();
        *driver.active_database.lock().await = "8".to_string();

        driver.disconnect().await.unwrap();

        assert!(driver.connection.lock().await.is_none());
        assert_eq!(driver.active_database.lock().await.as_str(), "2");
        assert!(driver.ping().await.is_err());
    }
}
