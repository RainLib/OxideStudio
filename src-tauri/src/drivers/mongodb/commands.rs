use anyhow::{anyhow, Context, Result};
use mongodb::bson::{doc, Bson, Document};
use serde_json::Value;

use super::super::mongodb_shell;
use super::models::{MongoCommandInput, MongoUpdateInput};
use super::results::validate_mongodb_database_name;

impl MongoCommandInput {
    pub(super) fn operation_count(&self) -> usize {
        [
            self.command.is_some(),
            self.use_database.is_some(),
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

    pub(super) fn has_no_operation(&self) -> bool {
        self.operation_count() == 0
    }

    pub(super) fn validate(&self) -> Result<()> {
        let operation_count = self.operation_count();
        if operation_count > 1 {
            return Err(anyhow!(
                "MongoDB command must contain exactly one operation"
            ));
        }
        if self.use_database.is_some() {
            if operation_count != 1
                || self.collection.is_some()
                || self.aggregate_options.is_some()
                || self.limit.is_some()
                || self.skip.is_some()
                || self.sort.is_some()
                || self.projection.is_some()
                || self.collation.is_some()
                || self.find_options.is_some()
            {
                return Err(anyhow!(
                    "MongoDB useDatabase cannot be combined with another operation or options"
                ));
            }
            validate_mongodb_database_name(self.use_database.as_deref().unwrap_or_default())?;
            return Ok(());
        }
        if self.command.is_none() && self.collection.is_none() {
            return Err(anyhow!("MongoDB collection is required"));
        }
        if self.aggregate_options.is_some() && self.aggregate.is_none() {
            return Err(anyhow!(
                "MongoDB aggregateOptions requires an aggregate operation"
            ));
        }
        let has_find_options = self.limit.is_some()
            || self.skip.is_some()
            || self.sort.is_some()
            || self.projection.is_some()
            || self.collation.is_some()
            || self.find_options.is_some();
        if has_find_options && self.find.is_none() && operation_count != 0 {
            return Err(anyhow!("MongoDB find options require a find operation"));
        }
        Ok(())
    }
}

pub(super) fn parse_mongodb_commands(input: &str) -> Result<Vec<MongoCommandInput>> {
    let input = input.trim();
    if input.is_empty() {
        return Ok(Vec::new());
    }

    let parsed_values = serde_json::Deserializer::from_str(input)
        .into_iter::<Value>()
        .collect::<std::result::Result<Vec<_>, _>>();
    let parsed_values = match parsed_values {
        Ok(values) => values,
        Err(_error) if mongodb_shell::looks_like_shell_command(input) => {
            mongodb_shell::parse_commands(input).map_err(|shell_error| anyhow!(shell_error))?
        }
        Err(error) => {
            return Err(error).context("MongoDB commands must be JSON or a supported shell command")
        }
    };
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

pub(super) fn normalize_mongodb_command_shape(value: Value) -> Result<Value> {
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

pub(super) fn set_native_mongodb_collection(
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

pub(super) fn build_find_command(collection: &str, input: &MongoCommandInput) -> Result<Document> {
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
    if let Some(collation) = input.collation.as_ref() {
        command.insert("collation", json_to_document(collation, "collation")?);
    }
    append_mongodb_options(
        &mut command,
        input.find_options.as_ref(),
        "findOptions",
        &[
            "allowPartialResults",
            "collation",
            "comment",
            "hint",
            "maxTimeMS",
            "noCursorTimeout",
            "returnKey",
            "showRecordId",
        ],
    )?;

    Ok(command)
}

pub(super) fn build_aggregate_command(
    collection: &str,
    pipeline: &[Value],
    options: Option<&Value>,
) -> Result<Document> {
    let pipeline = pipeline
        .iter()
        .map(|value| json_to_bson(value, "aggregate pipeline stage"))
        .collect::<Result<Vec<_>>>()?;
    let cursor = Document::new();
    let mut command = doc! {
        "aggregate": collection,
        "pipeline": pipeline,
        "cursor": cursor,
    };
    append_mongodb_options(
        &mut command,
        options,
        "aggregateOptions",
        &[
            "allowDiskUse",
            "bypassDocumentValidation",
            "collation",
            "comment",
            "hint",
            "let",
            "maxTimeMS",
        ],
    )?;
    Ok(command)
}

pub(super) fn append_mongodb_options(
    command: &mut Document,
    options: Option<&Value>,
    label: &str,
    allowed: &[&str],
) -> Result<()> {
    let Some(options) = options else {
        return Ok(());
    };
    let options = options
        .as_object()
        .ok_or_else(|| anyhow!("MongoDB {label} must be a JSON object"))?;
    for (key, value) in options {
        if !allowed.iter().any(|allowed| allowed == &key.as_str()) {
            return Err(anyhow!("Unsupported MongoDB {label} field: {key}"));
        }
        if command.contains_key(key) {
            return Err(anyhow!("MongoDB {label} conflicts with {key}"));
        }
        command.insert(key, json_to_bson(value, label)?);
    }
    Ok(())
}

pub(super) fn build_update_command(
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

pub(super) fn build_delete_command(
    collection: &str,
    filter: &Value,
    limit: i32,
) -> Result<Document> {
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

pub(super) fn json_to_bson(value: &Value, label: &str) -> Result<Bson> {
    // The editor and result grid exchange MongoDB values as canonical or
    // relaxed Extended JSON. Use BSON's dedicated decoder so cloning a value
    // such as {"$date": ...} or {"$oid": ...} restores its native type
    // instead of persisting the wrapper as an ordinary embedded document.
    Bson::try_from(value.clone())
        .with_context(|| format!("{label} is not valid MongoDB Extended JSON"))
}

pub(super) fn json_to_document(value: &Value, label: &str) -> Result<Document> {
    match json_to_bson(value, label)? {
        Bson::Document(document) => Ok(document),
        _ => Err(anyhow!("{label} must be a JSON object")),
    }
}
