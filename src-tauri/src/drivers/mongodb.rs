use crate::core::{
    driver::DatabaseDriver,
    protocol::{
        CollectionInfo, ColumnDef, ColumnInfo, DatabaseCreateRequest, IndexInfo, QueryResult,
    },
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use mongodb::{
    bson::{doc, Bson, Document},
    Client,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use tokio::sync::Mutex;

const MONGODB_DATABASE_INITIALIZATION_COLLECTION: &str = "oxide_init";

pub struct MongoDbDriver {
    url: String,
    default_database: String,
    active_database: Mutex<String>,
    client: Mutex<Option<Client>>,
    // `buildInfo` is sampled during connection setup and deliberately kept
    // separate from query execution. The LSP schema configuration can then
    // apply MongoDB's version-gated aggregation completions without issuing
    // another privileged command whenever an editor tab is opened.
    server_version: Mutex<Option<String>>,
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
            server_version: Mutex::new(None),
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

        // `buildInfo` is available on supported MongoDB server versions, but
        // a narrowly scoped account may not have permission to read it. A
        // missing version must never make an otherwise valid connection fail:
        // the language server will use its conservative compatibility set.
        let server_version = client
            .database("admin")
            .run_command(doc! { "buildInfo": 1 })
            .await
            .ok()
            .and_then(|response| mongodb_server_version(&response));

        *self.client.lock().await = Some(client);
        *self.active_database.lock().await = default_database;
        *self.server_version.lock().await = server_version;
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        *self.client.lock().await = None;
        *self.active_database.lock().await = self.default_database.clone();
        *self.server_version.lock().await = None;
        Ok(())
    }

    async fn server_version(&self) -> Option<String> {
        self.server_version.lock().await.clone()
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

    async fn create_database(&self, request: DatabaseCreateRequest) -> Result<()> {
        let database_name = validate_mongodb_database_name(&request.name)?;
        if request
            .namespace_kind
            .as_deref()
            .is_some_and(|kind| kind != "database")
        {
            return Err(anyhow!("MongoDB can only create database namespaces"));
        }
        if request.charset.is_some() || request.collation.is_some() || request.owner.is_some() {
            return Err(anyhow!(
                "MongoDB database creation does not support charset, collation, or owner options"
            ));
        }

        // MongoDB materializes a database only after its first collection or
        // document is created. Keep this operation semantic and bounded: the
        // renderer cannot replace the initialization command with arbitrary
        // database input.
        self.client()
            .await?
            .database(&database_name)
            .run_command(doc! { "create": MONGODB_DATABASE_INITIALIZATION_COLLECTION })
            .await
            .with_context(|| format!("Failed to create MongoDB database {database_name}"))?;
        *self.active_database.lock().await = database_name;
        Ok(())
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

    let parsed_values = serde_json::Deserializer::from_str(input)
        .into_iter::<Value>()
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("MongoDB commands must be JSON")?;
    let values = parsed_values
        .into_iter()
        .flat_map(|value| match value {
            Value::Array(values) => values,
            value => vec![value],
        })
        .collect::<Vec<_>>();

    values
        .into_iter()
        .map(|value| {
            let value = normalize_mongodb_command_shape(value)?;
            let command: MongoCommandInput =
                serde_json::from_value(value).context("Invalid MongoDB command shape")?;
            command.validate()?;
            Ok(command)
        })
        .collect()
}

fn normalize_mongodb_command_shape(value: Value) -> Result<Value> {
    let Value::Object(mut command) = value else {
        return Err(anyhow!("MongoDB command must be a JSON object"));
    };

    if let Some(Value::String(collection)) = command.get("find").cloned() {
        set_native_mongodb_collection(&mut command, &collection, "find")?;
        let filter = command
            .remove("filter")
            .unwrap_or_else(|| Value::Object(Default::default()));
        if !filter.is_object() {
            return Err(anyhow!("MongoDB find filter must be a JSON object"));
        }
        command.insert("find".to_string(), filter);
    }

    if let Some(Value::String(collection)) = command.get("aggregate").cloned() {
        set_native_mongodb_collection(&mut command, &collection, "aggregate")?;
        let pipeline = command
            .remove("pipeline")
            .ok_or_else(|| anyhow!("MongoDB aggregate pipeline is required"))?;
        if !pipeline.is_array() {
            return Err(anyhow!("MongoDB aggregate pipeline must be a JSON array"));
        }
        command.insert("aggregate".to_string(), pipeline);
        if let Some(cursor) = command.remove("cursor") {
            if !cursor.as_object().is_some_and(serde_json::Map::is_empty) {
                return Err(anyhow!(
                    "MongoDB aggregate cursor options are not supported"
                ));
            }
        }
    }

    if let Some(Value::String(collection)) = command.remove("count") {
        set_native_mongodb_collection(&mut command, &collection, "count")?;
        let query = command
            .remove("query")
            .unwrap_or_else(|| Value::Object(Default::default()));
        if !query.is_object() {
            return Err(anyhow!("MongoDB count query must be a JSON object"));
        }
        command.insert("countDocuments".to_string(), query);
    }

    Ok(Value::Object(command))
}

fn set_native_mongodb_collection(
    command: &mut serde_json::Map<String, Value>,
    collection: &str,
    operation: &str,
) -> Result<()> {
    let collection = collection.trim();
    if collection.is_empty() {
        return Err(anyhow!("MongoDB {operation} collection is required"));
    }
    if let Some(existing) = command.get("collection") {
        if existing.as_str().map(str::trim) != Some(collection) {
            return Err(anyhow!(
                "MongoDB {operation} collection conflicts with collection"
            ));
        }
    } else {
        command.insert(
            "collection".to_string(),
            Value::String(collection.to_string()),
        );
    }
    Ok(())
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
    // The editor and result grid exchange MongoDB values as canonical or
    // relaxed Extended JSON. Use BSON's dedicated decoder so cloning a value
    // such as {"$date": ...} or {"$oid": ...} restores its native type
    // instead of persisting the wrapper as an ordinary embedded document.
    Bson::try_from(value.clone())
        .with_context(|| format!("{label} is not valid MongoDB Extended JSON"))
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
    let mut field_positions = HashMap::<String, usize>::new();
    for document in documents {
        let mut sampled_fields = HashMap::<String, String>::new();
        collect_mongodb_document_fields(document, "", 0, &mut sampled_fields);
        for (name, data_type) in sampled_fields {
            if let Some(position) = field_positions.get(&name).copied() {
                let (_, existing_type, seen_count) = &mut fields[position];
                *seen_count += 1;
                *existing_type = merge_bson_type(existing_type, &data_type);
            } else {
                field_positions.insert(name.clone(), fields.len());
                fields.push((name, data_type, 1));
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
            is_generated: Some(false),
            is_hidden: Some(false),
            default_value: None,
            comment: None,
            name,
            data_type,
        })
        .collect()
}

const MAX_MONGODB_COMPLETION_FIELD_DEPTH: usize = 4;

/// MongoDB fields are addressed with dotted paths. Include sampled nested
/// document fields (and document values inside arrays) so JSON Console
/// completion can suggest paths which the native driver can execute directly.
/// The depth cap prevents a pathological document from expanding metadata
/// without bound.
fn collect_mongodb_document_fields(
    document: &Document,
    prefix: &str,
    depth: usize,
    fields: &mut HashMap<String, String>,
) {
    for (name, value) in document {
        let field_name = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{prefix}.{name}")
        };
        let data_type = bson_type_name(value).to_string();
        fields
            .entry(field_name.clone())
            .and_modify(|existing| *existing = merge_bson_type(existing, &data_type))
            .or_insert(data_type);
        if depth >= MAX_MONGODB_COMPLETION_FIELD_DEPTH {
            continue;
        }
        match value {
            Bson::Document(nested) => {
                collect_mongodb_document_fields(nested, &field_name, depth + 1, fields);
            }
            Bson::Array(values) => {
                for value in values {
                    if let Bson::Document(nested) = value {
                        collect_mongodb_document_fields(nested, &field_name, depth + 1, fields);
                    }
                }
            }
            _ => {}
        }
    }
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
                comment: None,
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
    value.into_relaxed_extjson()
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

fn mongodb_server_version(response: &Document) -> Option<String> {
    response
        .get_str("version")
        .ok()
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_string)
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
    fn extracts_server_version_from_build_info_response() {
        assert_eq!(
            mongodb_server_version(&doc! { "version": "5.3.2-enterprise" }),
            Some("5.3.2-enterprise".to_string())
        );
        assert_eq!(mongodb_server_version(&doc! { "version": "  " }), None);
        assert_eq!(mongodb_server_version(&doc! { "ok": 1 }), None);
    }

    #[test]
    fn extended_json_round_trip_preserves_native_bson_types() {
        let source = serde_json::json!({
            "_id": { "$oid": "507f1f77bcf86cd799439011" },
            "createdAt": { "$date": { "$numberLong": "1786291200000" } },
            "counter": { "$numberLong": "9223372036854775807" },
            "amount": { "$numberDecimal": "1234567890.0123456789" },
            "payload": { "$binary": { "base64": "AQID", "subType": "00" } },
            "nested": [{ "$oid": "507f191e810c19729de860ea" }]
        });

        let document = json_to_document(&source, "document").unwrap();
        assert!(matches!(document.get("_id"), Some(Bson::ObjectId(_))));
        assert!(matches!(document.get("createdAt"), Some(Bson::DateTime(_))));
        assert!(matches!(
            document.get("counter"),
            Some(Bson::Int64(i64::MAX))
        ));
        assert!(matches!(document.get("amount"), Some(Bson::Decimal128(_))));
        assert!(matches!(document.get("payload"), Some(Bson::Binary(_))));
        assert!(matches!(
            document.get_array("nested").unwrap().first(),
            Some(Bson::ObjectId(_))
        ));

        let encoded = bson_to_json(Bson::Document(document.clone()));
        assert_eq!(
            json_to_document(&encoded, "round-trip document").unwrap(),
            document
        );
    }

    #[test]
    fn extended_json_keeps_mongo_shell_like_strings_literal() {
        let source = serde_json::json!({
            "dateText": "ISODate(\"2026-08-10T00:00:00.000Z\")",
            "objectIdText": "ObjectId(\"507f1f77bcf86cd799439011\")",
            "actualDate": { "$date": "2026-08-10T00:00:00.000Z" }
        });

        let document = json_to_document(&source, "document").unwrap();
        assert!(matches!(
            document.get("dateText"),
            Some(Bson::String(value)) if value == "ISODate(\"2026-08-10T00:00:00.000Z\")"
        ));
        assert!(matches!(
            document.get("objectIdText"),
            Some(Bson::String(value)) if value == "ObjectId(\"507f1f77bcf86cd799439011\")"
        ));
        assert!(matches!(
            document.get("actualDate"),
            Some(Bson::DateTime(_))
        ));
    }

    #[test]
    fn validates_mongodb_database_names() {
        assert_eq!(validate_mongodb_database_name(" app ").unwrap(), "app");
        assert!(validate_mongodb_database_name("").is_err());
        assert!(validate_mongodb_database_name("app.users").is_err());
        assert!(validate_mongodb_database_name("app/users").is_err());
        assert!(validate_mongodb_database_name("$admin").is_err());
    }

    #[test]
    fn database_initialization_collection_is_stable_and_non_system() {
        assert_eq!(MONGODB_DATABASE_INITIALIZATION_COLLECTION, "oxide_init");
        assert!(!MONGODB_DATABASE_INITIALIZATION_COLLECTION.starts_with("system."));
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
    fn normalizes_native_find_command() {
        let command = parse_mongodb_commands(
            r#"{"database":"app","find":"file","filter":{"active":true},"limit":10}"#,
        )
        .unwrap()
        .remove(0);

        assert_eq!(command.database.as_deref(), Some("app"));
        assert_eq!(command.collection.as_deref(), Some("file"));
        assert_eq!(command.find, Some(serde_json::json!({"active": true})));
        assert_eq!(command.limit, Some(10));
    }

    #[test]
    fn normalizes_native_aggregate_and_count_commands() {
        let commands = parse_mongodb_commands(
            r#"[
                {
                    "aggregate":"file",
                    "pipeline":[{"$match":{"active":true}}],
                    "cursor":{}
                },
                {"count":"file","query":{"active":true}}
            ]"#,
        )
        .unwrap();

        assert_eq!(commands[0].collection.as_deref(), Some("file"));
        assert_eq!(
            commands[0].aggregate,
            Some(vec![serde_json::json!({"$match": {"active": true}})])
        );
        assert_eq!(commands[1].collection.as_deref(), Some("file"));
        assert_eq!(
            commands[1].count_documents,
            Some(serde_json::json!({"active": true}))
        );
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
    fn parses_whitespace_separated_json_commands() {
        let commands = parse_mongodb_commands(
            r#"{"collection":"users","find":{}}

               {"collection":"users","countDocuments":{"active":true}}"#,
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
        assert!(parse_mongodb_commands(r#"{"find":"users","filter":[]}"#).is_err());
        assert!(
            parse_mongodb_commands(r#"{"collection":"admins","find":"users","filter":{}}"#)
                .is_err()
        );
        assert!(
            parse_mongodb_commands(r#"{"aggregate":"users","pipeline":{},"cursor":{}}"#).is_err()
        );
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

        let profile_role = columns
            .iter()
            .find(|column| column.name == "profile.role")
            .unwrap();
        assert_eq!(profile_role.data_type, "string");
        assert!(profile_role.is_nullable);

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
        *driver.server_version.lock().await = Some("7.0.8".to_string());

        driver.disconnect().await.unwrap();

        assert!(driver.client.lock().await.is_none());
        assert_eq!(driver.active_database.lock().await.as_str(), "app");
        assert_eq!(driver.server_version().await, None);
        assert!(driver.ping().await.is_err());
    }
}
