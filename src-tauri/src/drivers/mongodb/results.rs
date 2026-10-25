use crate::core::protocol::{ColumnDef, ColumnInfo, IndexInfo, QueryResult};
use anyhow::{anyhow, Result};
use mongodb::bson::{Bson, Document};
use serde_json::Value;
use std::collections::HashMap;

pub(super) fn documents_result(documents: Vec<Document>) -> QueryResult {
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
                        .map(|value| {
                            if name == "_id" {
                                bson_identity_to_json(value)
                            } else {
                                bson_to_json(value)
                            }
                        })
                        .unwrap_or(Value::Null)
                })
                .collect::<Vec<_>>()
        })
        .collect();

    QueryResult::rows(columns, rows)
}

pub(super) fn mongodb_use_database_result(database: &str) -> QueryResult {
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
        ],
        vec![vec![
            Value::String(database.to_string()),
            Value::String("use".to_string()),
        ]],
    )
}

pub(super) fn infer_mongodb_columns(documents: &[Document]) -> Vec<ColumnInfo> {
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
            identity_generation: None,
            is_generated: Some(false),
            is_hidden: Some(false),
            character_set: None,
            collation: None,
            default_value: None,
            comment: None,
            name,
            data_type,
        })
        .collect()
}

pub(super) const MAX_MONGODB_COMPLETION_FIELD_DEPTH: usize = 4;

/// MongoDB fields are addressed with dotted paths. Include sampled nested
/// document fields (and document values inside arrays) so JSON Console
/// completion can suggest paths which the native driver can execute directly.
/// The depth cap prevents a pathological document from expanding metadata
/// without bound.
pub(super) fn collect_mongodb_document_fields(
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

pub(super) fn mongodb_indexes_to_info(indexes: Vec<Document>) -> Vec<IndexInfo> {
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
                filter: None,
                index_type,
                included_columns: None,
                definition,
                comment: None,
                key_is_expression: Vec::new(),
            })
        })
        .collect()
}

pub(super) fn mongodb_index_type(key: &Document) -> Option<String> {
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

pub(super) fn bson_type_name(value: &Bson) -> &'static str {
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

pub(super) fn merge_bson_type(current: &str, next: &str) -> String {
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

pub(super) fn command_result(
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

pub(super) fn bson_to_json(value: Bson) -> Value {
    value.into_relaxed_extjson()
}

pub(super) fn bson_identity_to_json(value: Bson) -> Value {
    match value {
        Bson::Int64(value)
            if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&value) =>
        {
            Bson::Int64(value).into_canonical_extjson()
        }
        Bson::Array(values) => {
            Value::Array(values.into_iter().map(bson_identity_to_json).collect())
        }
        Bson::Document(document) => Value::Object(
            document
                .into_iter()
                .map(|(key, value)| (key, bson_identity_to_json(value)))
                .collect(),
        ),
        value => bson_to_json(value),
    }
}

pub(super) fn mongodb_default_database(url: &str) -> String {
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

pub(super) fn mongodb_server_version(response: &Document) -> Option<String> {
    response
        .get_str("version")
        .ok()
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_string)
}

pub(super) fn validate_mongodb_database_name(value: &str) -> Result<String> {
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

pub(super) fn validate_mongodb_collection_name(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 255 || value.contains('\0') {
        return Err(anyhow!("Invalid MongoDB collection name"));
    }
    if value.starts_with("system.") {
        return Err(anyhow!("System MongoDB collections cannot be cloned"));
    }
    Ok(value.to_string())
}
