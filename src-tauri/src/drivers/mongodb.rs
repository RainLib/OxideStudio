use crate::core::{
    driver::DatabaseDriver,
    protocol::{CollectionInfo, ColumnDef, ColumnInfo, IndexInfo, QueryResult},
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use mongodb::{
    bson::{self, doc, Bson, Document},
    Client,
};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::Mutex;

pub struct MongoDbDriver {
    url: String,
    default_database: String,
    active_database: Mutex<String>,
    client: Mutex<Option<Client>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MongoCommandInput {
    database: Option<String>,
    collection: Option<String>,
    command: Option<Value>,
    find: Option<Value>,
    aggregate: Option<Vec<Value>>,
    count_documents: Option<Value>,
    insert_one: Option<Value>,
    insert_many: Option<Vec<Value>>,
    update_one: Option<MongoUpdateInput>,
    update_many: Option<MongoUpdateInput>,
    delete_one: Option<Value>,
    delete_many: Option<Value>,
    limit: Option<i64>,
    skip: Option<i64>,
    sort: Option<Value>,
    projection: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MongoUpdateInput {
    filter: Value,
    update: Value,
    upsert: Option<bool>,
}

impl MongoDbDriver {
    pub fn new(url: &str) -> Self {
        Self {
            url: url.to_string(),
            default_database: mongodb_default_database(url),
            active_database: Mutex::new(mongodb_default_database(url)),
            client: Mutex::new(None),
        }
    }

    async fn client(&self) -> Result<Client> {
        self.client
            .lock()
            .await
            .clone()
            .ok_or_else(|| anyhow!("MongoDB connection is not established"))
    }

    async fn active_database_name(&self) -> String {
        let active = self.active_database.lock().await.clone();
        if active.trim().is_empty() {
            self.default_database.clone()
        } else {
            active
        }
    }

    async fn database_name_for(&self, value: Option<&str>) -> Result<String> {
        if let Some(database) = value.map(str::trim).filter(|value| !value.is_empty()) {
            return validate_mongodb_database_name(database);
        }
        Ok(self.active_database_name().await)
    }

    async fn execute_commands(&self, commands: Vec<MongoCommandInput>) -> Result<Vec<QueryResult>> {
        if commands.is_empty() {
            return Err(anyhow!("MongoDB command is required"));
        }

        let mut results = Vec::with_capacity(commands.len());
        for command in commands {
            results.push(self.execute_command(command).await?);
        }
        Ok(results)
    }

    async fn execute_command(&self, input: MongoCommandInput) -> Result<QueryResult> {
        let client = self.client().await?;
        let database_name = self.database_name_for(input.database.as_deref()).await?;
        let database = client.database(&database_name);

        if let Some(command) = input.command.as_ref() {
            let result = database
                .run_command(json_to_document(command, "command")?)
                .await
                .context("MongoDB command failed")?;
            return Ok(command_result(&database_name, "command", None, result));
        }

        let collection = input
            .collection
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("MongoDB collection is required"))?;

        if input.find.is_some() || input.has_no_operation() {
            let result = database
                .run_command(build_find_command(collection, &input)?)
                .await
                .context("MongoDB find command failed")?;
            return Ok(documents_result(extract_cursor_batch(result)?));
        }

        if let Some(pipeline) = input.aggregate.as_ref() {
            let result = database
                .run_command(build_aggregate_command(collection, pipeline)?)
                .await
                .context("MongoDB aggregate command failed")?;
            return Ok(documents_result(extract_cursor_batch(result)?));
        }

        if let Some(filter) = input.count_documents.as_ref() {
            let result = database
                .run_command(doc! {
                    "count": collection,
                    "query": json_to_document(filter, "countDocuments")?,
                })
                .await
                .context("MongoDB count command failed")?;
            return Ok(command_result(
                &database_name,
                "countDocuments",
                Some(collection),
                result,
            ));
        }

        if let Some(document) = input.insert_one.as_ref() {
            let document = json_to_document(document, "insertOne")?;
            let result = database
                .run_command(doc! {
                    "insert": collection,
                    "documents": [document],
                })
                .await
                .context("MongoDB insertOne command failed")?;
            return Ok(command_result(
                &database_name,
                "insertOne",
                Some(collection),
                result,
            ));
        }

        if let Some(documents) = input.insert_many.as_ref() {
            let documents = documents
                .iter()
                .map(|value| json_to_document(value, "insertMany document"))
                .collect::<Result<Vec<_>>>()?;
            let result = database
                .run_command(doc! {
                    "insert": collection,
                    "documents": documents,
                })
                .await
                .context("MongoDB insertMany command failed")?;
            return Ok(command_result(
                &database_name,
                "insertMany",
                Some(collection),
                result,
            ));
        }

        if let Some(update) = input.update_one.as_ref() {
            let result = database
                .run_command(build_update_command(collection, update, false)?)
                .await
                .context("MongoDB updateOne command failed")?;
            return Ok(command_result(
                &database_name,
                "updateOne",
                Some(collection),
                result,
            ));
        }

        if let Some(update) = input.update_many.as_ref() {
            let result = database
                .run_command(build_update_command(collection, update, true)?)
                .await
                .context("MongoDB updateMany command failed")?;
            return Ok(command_result(
                &database_name,
                "updateMany",
                Some(collection),
                result,
            ));
        }

        if let Some(filter) = input.delete_one.as_ref() {
            let result = database
                .run_command(build_delete_command(collection, filter, 1)?)
                .await
                .context("MongoDB deleteOne command failed")?;
            return Ok(command_result(
                &database_name,
                "deleteOne",
                Some(collection),
                result,
            ));
        }

        if let Some(filter) = input.delete_many.as_ref() {
            let result = database
                .run_command(build_delete_command(collection, filter, 0)?)
                .await
                .context("MongoDB deleteMany command failed")?;
            return Ok(command_result(
                &database_name,
                "deleteMany",
                Some(collection),
                result,
            ));
        }

        Err(anyhow!("Unsupported MongoDB command"))
    }
}

#[async_trait]
impl DatabaseDriver for MongoDbDriver {
    async fn connect(&mut self) -> Result<()> {
        let default_database = self.default_database.clone();
        let client = Client::with_uri_str(&self.url)
            .await
            .with_context(|| format!("Failed to connect to MongoDB at {}", self.url))?;
        client
            .database("admin")
            .run_command(doc! { "ping": 1 })
            .await
            .context("MongoDB ping failed")?;

        *self.client.lock().await = Some(client);
        *self.active_database.lock().await = default_database;
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        *self.client.lock().await = None;
        *self.active_database.lock().await = self.default_database.clone();
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        self.client()
            .await?
            .database("admin")
            .run_command(doc! { "ping": 1 })
            .await
            .context("MongoDB ping failed")?;
        Ok(())
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let commands = parse_mongodb_commands(sql)?;
        self.execute_commands(commands).await
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        let database = validate_mongodb_database_name(schema)?;
        *self.active_database.lock().await = database.clone();
        let commands = parse_mongodb_commands(sql)?
            .into_iter()
            .map(|mut command| {
                if command.database.is_none() {
                    command.database = Some(database.clone());
                }
                command
            })
            .collect();
        self.execute_commands(commands).await
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        let names = self
            .client()
            .await?
            .list_database_names()
            .await
            .context("Failed to list MongoDB databases")?;
        Ok(names)
    }

    async fn get_collections(&self, namespace: &str) -> Result<Vec<CollectionInfo>> {
        let namespace = namespace.trim();
        let database_name = if namespace.is_empty() {
            self.active_database_name().await
        } else {
            validate_mongodb_database_name(namespace)?
        };
        *self.active_database.lock().await = database_name.clone();
        let database = self.client().await?.database(&database_name);
        let names = database
            .list_collection_names()
            .await
            .with_context(|| format!("Failed to list MongoDB collections for {database_name}"))?;

        let mut collections = Vec::with_capacity(names.len());
        for name in names {
            let document_count = database
                .collection::<Document>(&name)
                .estimated_document_count()
                .await
                .ok();
            collections.push(mongodb_collection_info(
                &database_name,
                name,
                document_count,
            ));
        }

        Ok(collections)
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        let schema = schema.trim();
        let database_name = if schema.is_empty() {
            self.active_database_name().await
        } else {
            validate_mongodb_database_name(schema)?
        };
        let collection = table.trim();
        if collection.is_empty() {
            return Ok(Vec::new());
        }

        let result = self
            .client()
            .await?
            .database(&database_name)
            .run_command(doc! {
                "find": collection,
                "filter": {},
                "limit": 20_i32,
            })
            .await
            .with_context(|| {
                format!("Failed to sample MongoDB documents for {database_name}.{collection}")
            })?;
        let documents = extract_cursor_batch(result)?;
        Ok(infer_mongodb_columns(&documents))
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
        let schema = schema.trim();
        let database_name = if schema.is_empty() {
            self.active_database_name().await
        } else {
            validate_mongodb_database_name(schema)?
        };
        let collection = table.trim();
        if collection.is_empty() {
            return Ok(Vec::new());
        }

        let result = self
            .client()
            .await?
            .database(&database_name)
            .run_command(doc! {
                "listIndexes": collection,
            })
            .await
            .with_context(|| {
                format!("Failed to list MongoDB indexes for {database_name}.{collection}")
            })?;
        Ok(mongodb_indexes_to_info(extract_cursor_batch(result)?))
    }

    async fn set_current_schema(&self, schema: &str) -> Result<()> {
        let database = validate_mongodb_database_name(schema)?;
        *self.active_database.lock().await = database;
        Ok(())
    }
}

fn mongodb_collection_info(
    database_name: &str,
    name: String,
    document_count: Option<u64>,
) -> CollectionInfo {
    CollectionInfo {
        name,
        namespace: Some(database_name.to_string()),
        collection_type: Some("collection".to_string()),
        document_count,
    }
}

impl MongoCommandInput {
    fn operation_count(&self) -> usize {
        [
            self.command.is_some(),
            self.find.is_some(),
            self.aggregate.is_some(),
            self.count_documents.is_some(),
            self.insert_one.is_some(),
            self.insert_many.is_some(),
            self.update_one.is_some(),
            self.update_many.is_some(),
            self.delete_one.is_some(),
            self.delete_many.is_some(),
        ]
        .into_iter()
        .filter(|value| *value)
        .count()
    }

    fn has_no_operation(&self) -> bool {
        self.operation_count() == 0
    }

    fn validate(&self) -> Result<()> {
        let operation_count = self.operation_count();
        if operation_count > 1 {
            return Err(anyhow!(
                "MongoDB command must contain exactly one operation"
            ));
        }
        if self.command.is_none() && self.collection.is_none() {
            return Err(anyhow!("MongoDB collection is required"));
        }
        Ok(())
    }
}

fn parse_mongodb_commands(input: &str) -> Result<Vec<MongoCommandInput>> {
    let input = input.trim();
    if input.is_empty() {
        return Ok(Vec::new());
    }

    let value: Value = serde_json::from_str(input).context("MongoDB commands must be JSON")?;
    let values = match value {
        Value::Array(values) => values,
        value => vec![value],
    };

    values
        .into_iter()
        .map(|value| {
            let command: MongoCommandInput =
                serde_json::from_value(value).context("Invalid MongoDB command shape")?;
            command.validate()?;
            Ok(command)
        })
        .collect()
}

fn build_find_command(collection: &str, input: &MongoCommandInput) -> Result<Document> {
    let filter = input
        .find
        .as_ref()
        .map(|value| json_to_document(value, "find"))
        .transpose()?
        .unwrap_or_default();
    let mut command = doc! {
        "find": collection,
        "filter": filter,
    };

    if let Some(limit) = input.limit {
        command.insert("limit", limit);
    }
    if let Some(skip) = input.skip {
        command.insert("skip", skip);
    }
    if let Some(sort) = input.sort.as_ref() {
        command.insert("sort", json_to_document(sort, "sort")?);
    }
    if let Some(projection) = input.projection.as_ref() {
        command.insert("projection", json_to_document(projection, "projection")?);
    }

    Ok(command)
}

fn build_aggregate_command(collection: &str, pipeline: &[Value]) -> Result<Document> {
    let pipeline = pipeline
        .iter()
        .map(|value| json_to_bson(value, "aggregate pipeline stage"))
        .collect::<Result<Vec<_>>>()?;
    let cursor = Document::new();
    Ok(doc! {
        "aggregate": collection,
        "pipeline": pipeline,
        "cursor": cursor,
    })
}

fn build_update_command(
    collection: &str,
    update: &MongoUpdateInput,
    multi: bool,
) -> Result<Document> {
    let filter = json_to_document(&update.filter, "update filter")?;
    let update_document = json_to_document(&update.update, "update document")?;
    let update_spec = doc! {
        "q": filter,
        "u": update_document,
        "multi": multi,
        "upsert": update.upsert.unwrap_or(false),
    };

    Ok(doc! {
        "update": collection,
        "updates": [update_spec],
    })
}

fn build_delete_command(collection: &str, filter: &Value, limit: i32) -> Result<Document> {
    let filter = json_to_document(filter, "delete filter")?;
    let delete_spec = doc! {
        "q": filter,
        "limit": limit,
    };

    Ok(doc! {
        "delete": collection,
        "deletes": [delete_spec],
    })
}

fn json_to_bson(value: &Value, label: &str) -> Result<Bson> {
    bson::to_bson(value).with_context(|| format!("{label} is not valid BSON"))
}

fn json_to_document(value: &Value, label: &str) -> Result<Document> {
    match json_to_bson(value, label)? {
        Bson::Document(document) => Ok(document),
        _ => Err(anyhow!("{label} must be a JSON object")),
    }
}

fn extract_cursor_batch(result: Document) -> Result<Vec<Document>> {
    let cursor = result
        .get_document("cursor")
        .context("MongoDB response did not include a cursor")?;
    let batch = cursor
        .get_array("firstBatch")
        .or_else(|_| cursor.get_array("nextBatch"))
        .context("MongoDB cursor response did not include a batch")?;

    batch
        .iter()
        .map(|value| match value {
            Bson::Document(document) => Ok(document.clone()),
            _ => Err(anyhow!(
                "MongoDB cursor batch contained a non-document value"
            )),
        })
        .collect()
}

fn documents_result(documents: Vec<Document>) -> QueryResult {
    let mut column_names = Vec::<String>::new();
    for document in &documents {
        for (name, _) in document {
            if !column_names.contains(name) {
                column_names.push(name.to_string());
            }
        }
    }
    if let Some(position) = column_names.iter().position(|name| name == "_id") {
        let id = column_names.remove(position);
        column_names.insert(0, id);
    }

    let columns = column_names
        .iter()
        .map(|name| ColumnDef {
            name: name.to_string(),
            data_type: "json".to_string(),
        })
        .collect::<Vec<_>>();
    let rows = documents
        .into_iter()
        .map(|document| {
            column_names
                .iter()
                .map(|name| {
                    document
                        .get(name)
                        .cloned()
                        .map(bson_to_json)
                        .unwrap_or(Value::Null)
                })
                .collect::<Vec<_>>()
        })
        .collect();

    QueryResult::rows(columns, rows)
}

fn infer_mongodb_columns(documents: &[Document]) -> Vec<ColumnInfo> {
    let mut fields = Vec::<(String, String, usize)>::new();
    for document in documents {
        for (name, value) in document {
            if let Some((_, data_type, seen_count)) =
                fields.iter_mut().find(|(field, _, _)| field == name)
            {
                *seen_count += 1;
                *data_type = merge_bson_type(data_type, bson_type_name(value));
            } else {
                fields.push((name.to_string(), bson_type_name(value).to_string(), 1));
            }
        }
    }

    if let Some(position) = fields.iter().position(|(name, _, _)| name == "_id") {
        let id = fields.remove(position);
        fields.insert(0, id);
    }

    fields
        .into_iter()
        .map(|(name, data_type, seen_count)| ColumnInfo {
            is_nullable: seen_count < documents.len(),
            is_primary_key: name == "_id",
            is_unique: name == "_id",
            is_indexed: name == "_id",
            is_auto_increment: false,
            default_value: None,
            comment: None,
            name,
            data_type,
        })
        .collect()
}

fn mongodb_indexes_to_info(indexes: Vec<Document>) -> Vec<IndexInfo> {
    indexes
        .into_iter()
        .filter_map(|index| {
            let name = index.get_str("name").ok()?.to_string();
            let key = index.get_document("key").ok();
            let columns = key
                .map(|key| key.keys().map(ToString::to_string).collect())
                .unwrap_or_default();
            let is_primary = name == "_id_" || columns == ["_id"];
            let is_unique = is_primary || index.get_bool("unique").unwrap_or(false);
            let index_type = key.and_then(mongodb_index_type);
            let definition = serde_json::to_string(&bson_to_json(Bson::Document(index))).ok();

            Some(IndexInfo {
                name,
                columns,
                is_unique,
                is_primary,
                index_type,
                definition,
            })
        })
        .collect()
}

fn mongodb_index_type(key: &Document) -> Option<String> {
    let mut special_types = Vec::<String>::new();
    let mut has_btree = false;

    for (_, value) in key {
        match value {
            Bson::String(index_type) => special_types.push(index_type.to_string()),
            Bson::Int32(_) | Bson::Int64(_) => has_btree = true,
            _ => {}
        }
    }

    if !special_types.is_empty() {
        special_types.sort();
        special_types.dedup();
        Some(special_types.join(","))
    } else if has_btree {
        Some("btree".to_string())
    } else {
        None
    }
}

fn bson_type_name(value: &Bson) -> &'static str {
    match value {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Boolean(_) => "bool",
        Bson::Null => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::JavaScriptCode(_) | Bson::JavaScriptCodeWithScope(_) => "javascript",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::Timestamp(_) => "timestamp",
        Bson::Binary(_) => "binary",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Symbol(_) => "symbol",
        Bson::Decimal128(_) => "decimal",
        Bson::Undefined => "undefined",
        Bson::MinKey => "minKey",
        Bson::MaxKey => "maxKey",
        Bson::DbPointer(_) => "dbPointer",
    }
}

fn merge_bson_type(current: &str, next: &str) -> String {
    if current == next {
        current.to_string()
    } else if current == "null" {
        next.to_string()
    } else if next == "null" {
        current.to_string()
    } else {
        "mixed".to_string()
    }
}

fn command_result(
    database: &str,
    operation: &str,
    collection: Option<&str>,
    result: Document,
) -> QueryResult {
    QueryResult::rows(
        vec![
            ColumnDef {
                name: "database".to_string(),
                data_type: "text".to_string(),
            },
            ColumnDef {
                name: "operation".to_string(),
                data_type: "text".to_string(),
            },
            ColumnDef {
                name: "collection".to_string(),
                data_type: "text".to_string(),
            },
            ColumnDef {
                name: "result".to_string(),
                data_type: "json".to_string(),
            },
        ],
        vec![vec![
            Value::String(database.to_string()),
            Value::String(operation.to_string()),
            collection
                .map(|value| Value::String(value.to_string()))
                .unwrap_or(Value::Null),
            bson_to_json(Bson::Document(result)),
        ]],
    )
}

fn bson_to_json(value: Bson) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

fn mongodb_default_database(url: &str) -> String {
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    without_query
        .split_once("://")
        .and_then(|(_, rest)| rest.split_once('/').map(|(_, path)| path))
        .and_then(|path| path.split('/').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("admin")
        .to_string()
}

fn validate_mongodb_database_name(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(anyhow!("MongoDB database name is required"));
    }
    if value
        .chars()
        .any(|ch| matches!(ch, '/' | '\\' | '.' | '"' | '$' | '\0'))
    {
        return Err(anyhow!("Invalid MongoDB database name: {value}"));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_default_database_from_url() {
        assert_eq!(
            mongodb_default_database("mongodb://user:pw@localhost:27017/app?retryWrites=true"),
            "app"
        );
        assert_eq!(
            mongodb_default_database("mongodb://localhost:27017"),
            "admin"
        );
    }

    #[test]
    fn validates_mongodb_database_names() {
        assert_eq!(validate_mongodb_database_name(" app ").unwrap(), "app");
        assert!(validate_mongodb_database_name("").is_err());
        assert!(validate_mongodb_database_name("app.users").is_err());
        assert!(validate_mongodb_database_name("app/users").is_err());
        assert!(validate_mongodb_database_name("$admin").is_err());
    }

    #[tokio::test]
    async fn tracks_active_database_context() {
        let driver = MongoDbDriver::new("mongodb://localhost:27017/default_db");

        assert_eq!(driver.active_database_name().await, "default_db");
        driver.set_current_schema(" reporting ").await.unwrap();
        assert_eq!(driver.active_database_name().await, "reporting");
        assert_eq!(driver.database_name_for(None).await.unwrap(), "reporting");
        assert_eq!(
            driver.database_name_for(Some("explicit")).await.unwrap(),
            "explicit"
        );
    }

    #[test]
    fn parses_single_find_command() {
        let commands = parse_mongodb_commands(
            r#"{"database":"app","collection":"users","find":{"active":true},"limit":10}"#,
        )
        .unwrap();

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].database.as_deref(), Some("app"));
        assert_eq!(commands[0].collection.as_deref(), Some("users"));
        assert_eq!(commands[0].limit, Some(10));
    }

    #[test]
    fn parses_multiple_json_commands() {
        let commands = parse_mongodb_commands(
            r#"[
                {"collection":"users","find":{}},
                {"collection":"users","countDocuments":{"active":true}}
            ]"#,
        )
        .unwrap();

        assert_eq!(commands.len(), 2);
        assert!(commands[0].find.is_some());
        assert!(commands[1].count_documents.is_some());
    }

    #[test]
    fn rejects_ambiguous_or_collectionless_commands() {
        assert!(parse_mongodb_commands(r#"{"find":{}}"#).is_err());
        assert!(
            parse_mongodb_commands(r#"{"collection":"users","find":{},"deleteMany":{}}"#).is_err()
        );
        assert!(parse_mongodb_commands(r#"{"collection":"users","drop":true}"#).is_err());
        assert!(parse_mongodb_commands(
            r#"{"collection":"users","updateOne":{"filter":{},"update":{},"unknown":true}}"#
        )
        .is_err());
    }

    #[test]
    fn builds_find_command_with_options() {
        let input = parse_mongodb_commands(
            r#"{
                "collection":"users",
                "find":{"active":true},
                "sort":{"createdAt":-1},
                "projection":{"email":1},
                "skip":5,
                "limit":20
            }"#,
        )
        .unwrap()
        .remove(0);

        let command = build_find_command("users", &input).unwrap();
        assert_eq!(command.get_str("find").unwrap(), "users");
        assert_eq!(command.get_i64("limit").unwrap(), 20);
        assert_eq!(command.get_i64("skip").unwrap(), 5);
        assert!(command
            .get_document("filter")
            .unwrap()
            .contains_key("active"));
        assert!(command
            .get_document("sort")
            .unwrap()
            .contains_key("createdAt"));
        assert!(command
            .get_document("projection")
            .unwrap()
            .contains_key("email"));
    }

    #[test]
    fn converts_documents_to_tabular_result() {
        let result = documents_result(vec![
            doc! {"name": "Ada", "_id": 1, "active": true},
            doc! {"_id": 2, "name": "Grace"},
        ]);

        assert_eq!(result.columns[0].name, "_id");
        assert_eq!(result.columns[1].name, "name");
        assert_eq!(result.columns[2].name, "active");
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[1][2], Value::Null);
    }

    #[test]
    fn infers_columns_from_sampled_documents() {
        let columns = infer_mongodb_columns(&[
            doc! {"name": "Ada", "_id": 1, "active": true, "profile": {"role": "admin"}},
            doc! {"_id": 2, "name": "Grace", "active": "yes", "tags": ["db"]},
        ]);

        assert_eq!(columns[0].name, "_id");
        assert_eq!(columns[0].data_type, "int");
        assert!(columns[0].is_primary_key);
        assert!(columns[0].is_indexed);

        let active = columns
            .iter()
            .find(|column| column.name == "active")
            .unwrap();
        assert_eq!(active.data_type, "mixed");
        assert!(!active.is_nullable);

        let profile = columns
            .iter()
            .find(|column| column.name == "profile")
            .unwrap();
        assert_eq!(profile.data_type, "object");
        assert!(profile.is_nullable);

        let tags = columns.iter().find(|column| column.name == "tags").unwrap();
        assert_eq!(tags.data_type, "array");
        assert!(tags.is_nullable);
    }

    #[test]
    fn maps_mongodb_indexes_to_index_info() {
        let indexes = mongodb_indexes_to_info(vec![
            doc! {"name": "_id_", "key": {"_id": 1}},
            doc! {"name": "email_1", "key": {"email": 1}, "unique": true},
            doc! {"name": "profile_text", "key": {"profile.bio": "text"}},
        ]);

        let id = indexes.iter().find(|index| index.name == "_id_").unwrap();
        assert_eq!(id.columns, ["_id"]);
        assert!(id.is_primary);
        assert!(id.is_unique);
        assert_eq!(id.index_type.as_deref(), Some("btree"));

        let email = indexes
            .iter()
            .find(|index| index.name == "email_1")
            .unwrap();
        assert_eq!(email.columns, ["email"]);
        assert!(email.is_unique);
        assert!(!email.is_primary);

        let text = indexes
            .iter()
            .find(|index| index.name == "profile_text")
            .unwrap();
        assert_eq!(text.columns, ["profile.bio"]);
        assert_eq!(text.index_type.as_deref(), Some("text"));
        assert!(text.definition.as_deref().unwrap().contains("profile.bio"));
    }

    #[test]
    fn builds_collection_info_with_estimated_count() {
        let collection = mongodb_collection_info("app", "users".to_string(), Some(42));

        assert_eq!(collection.name, "users");
        assert_eq!(collection.namespace.as_deref(), Some("app"));
        assert_eq!(collection.collection_type.as_deref(), Some("collection"));
        assert_eq!(collection.document_count, Some(42));
    }

    #[tokio::test]
    async fn disconnect_clears_client_and_resets_active_database() {
        let driver = MongoDbDriver::new("mongodb://localhost:27017/app");
        *driver.active_database.lock().await = "analytics".to_string();

        driver.disconnect().await.unwrap();

        assert!(driver.client.lock().await.is_none());
        assert_eq!(driver.active_database.lock().await.as_str(), "app");
        assert!(driver.ping().await.is_err());
    }
}
