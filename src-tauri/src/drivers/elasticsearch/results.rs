use super::models::ElasticsearchRequest;
use crate::core::protocol::{ColumnDef, QueryResult, DEFAULT_QUERY_RESULT_ROW_LIMIT};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub(super) fn normalize_elasticsearch_response(value: Value) -> Value {
    let Some(hits_container) = value.get("hits") else {
        return value;
    };
    let direct_hits = hits_container
        .get("hits")
        .or_else(|| hits_container.get("events"))
        .and_then(Value::as_array);
    let hits = direct_hits
        .map(|items| items.iter().collect::<Vec<_>>())
        .or_else(|| {
            hits_container
                .get("sequences")
                .and_then(Value::as_array)
                .map(|sequences| {
                    sequences
                        .iter()
                        .filter_map(|sequence| sequence.get("events").and_then(Value::as_array))
                        .flat_map(|events| events.iter())
                        .collect::<Vec<_>>()
                })
        });
    let Some(hits) = hits else {
        return value;
    };

    // A `size: 0` aggregation response still has the `hits.hits` envelope,
    // but its empty array must not erase the sibling `aggregations` payload.
    // Keep that response intact so the execution path can render aggregation
    // buckets and metric values as a bounded table instead of an empty grid.
    if hits.is_empty() && (value.get("aggregations").is_some() || value.get("aggs").is_some()) {
        return value;
    }

    Value::Array(
        hits.into_iter()
            .map(|hit| {
                let mut document = serde_json::Map::new();
                document.insert(
                    "_index".to_string(),
                    hit.get("_index").cloned().unwrap_or(Value::Null),
                );
                document.insert(
                    "_id".to_string(),
                    hit.get("_id").cloned().unwrap_or(Value::Null),
                );
                document.insert(
                    "_score".to_string(),
                    hit.get("_score").cloned().unwrap_or(Value::Null),
                );
                if let Some(source) = hit.get("_source") {
                    flatten_elasticsearch_source("", source, &mut document);
                }
                Value::Object(document)
            })
            .collect(),
    )
}

pub(super) fn flatten_elasticsearch_source(
    prefix: &str,
    value: &Value,
    output: &mut serde_json::Map<String, Value>,
) {
    let Some(object) = value.as_object() else {
        if !prefix.is_empty() {
            output.insert(prefix.to_string(), value.clone());
        }
        return;
    };

    if object.is_empty() && !prefix.is_empty() {
        output.insert(prefix.to_string(), value.clone());
        return;
    }

    for (name, field_value) in object {
        let source_name = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{prefix}.{name}")
        };
        let column_name = if matches!(source_name.as_str(), "_index" | "_id" | "_score") {
            format!("_source.{source_name}")
        } else {
            source_name
        };
        if field_value.is_object() {
            flatten_elasticsearch_source(&column_name, field_value, output);
        } else {
            output.insert(column_name, field_value.clone());
        }
    }
}

pub(super) fn elasticsearch_request_result(
    request: &ElasticsearchRequest,
    status: u16,
    body: Value,
) -> QueryResult {
    QueryResult::rows(
        vec![
            ColumnDef {
                name: "method".to_string(),
                data_type: "text".to_string(),
            },
            ColumnDef {
                name: "path".to_string(),
                data_type: "text".to_string(),
            },
            ColumnDef {
                name: "status".to_string(),
                data_type: "integer".to_string(),
            },
            ColumnDef {
                name: "result".to_string(),
                data_type: "json".to_string(),
            },
        ],
        vec![vec![
            Value::String(request.method.as_str().to_string()),
            Value::String(request.path.clone()),
            json!(status),
            body,
        ]],
    )
}

pub(super) fn elasticsearch_table_result(value: &Value) -> Option<QueryResult> {
    let documents = value.as_array()?;
    if !documents
        .iter()
        .all(|document| document.as_object().is_some())
    {
        return None;
    }

    let mut column_names = Vec::<String>::new();
    for document in documents {
        for name in document.as_object()?.keys() {
            if !column_names.contains(name) {
                column_names.push(name.to_string());
            }
        }
    }

    for preferred in ["_index", "_id", "_score"].iter().rev() {
        if let Some(position) = column_names.iter().position(|name| name == preferred) {
            let value = column_names.remove(position);
            column_names.insert(0, value);
        }
    }

    let columns = column_names
        .iter()
        .map(|name| ColumnDef {
            name: name.to_string(),
            data_type: "json".to_string(),
        })
        .collect::<Vec<_>>();
    let rows = documents
        .iter()
        .map(|document| {
            let object = document.as_object().expect("validated document object");
            column_names
                .iter()
                .map(|name| object.get(name).cloned().unwrap_or(Value::Null))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    Some(QueryResult::rows(columns, rows))
}

/// Converts Elasticsearch aggregations to grid rows without treating the raw
/// response as a string blob. Bucket rows preserve `key`/`doc_count`, direct
/// metric sub-aggregations become columns, and standalone scalar metrics share
/// one row. The common result row limit still applies because a terms or range
/// aggregation can otherwise materialize an unbounded response in the desktop
/// process.
pub(super) fn elasticsearch_aggregation_table_result(value: &Value) -> Option<QueryResult> {
    let aggregations = value
        .get("aggregations")
        .or_else(|| value.get("aggs"))
        .and_then(Value::as_object)?;

    let mut aggregation_names = aggregations.keys().cloned().collect::<Vec<_>>();
    aggregation_names.sort();

    let bucket_aggregation_count = aggregation_names
        .iter()
        .filter(|name| elasticsearch_aggregation_buckets(&aggregations[*name]).is_some())
        .count();
    let mut scalar_metrics = BTreeMap::<String, Value>::new();
    let mut row_maps = Vec::<BTreeMap<String, Value>>::new();

    for name in aggregation_names {
        let aggregation = &aggregations[&name];
        if let Some(buckets) = elasticsearch_aggregation_buckets(aggregation) {
            for (fallback_key, bucket) in buckets {
                let Some(bucket) = bucket.as_object() else {
                    continue;
                };
                let mut row = elasticsearch_aggregation_bucket_row(bucket);
                if let Some(fallback_key) = fallback_key {
                    row.entry("key".to_string())
                        .or_insert_with(|| Value::String(fallback_key.to_string()));
                }
                if bucket_aggregation_count > 1 {
                    row.insert("aggregation".to_string(), Value::String(name.clone()));
                }
                row_maps.push(row);
            }
        } else if let Some(metric) = aggregation.get("value") {
            scalar_metrics.insert(name, metric.clone());
        }
    }

    if row_maps.is_empty() {
        if scalar_metrics.is_empty() {
            return None;
        }
        row_maps.push(scalar_metrics);
    } else if !scalar_metrics.is_empty() {
        for row in &mut row_maps {
            for (name, metric) in &scalar_metrics {
                row.entry(name.clone()).or_insert_with(|| metric.clone());
            }
        }
    }

    let mut column_names = Vec::<String>::new();
    for preferred in ["aggregation", "key", "key_as_string", "doc_count"] {
        if row_maps.iter().any(|row| row.contains_key(preferred)) {
            column_names.push(preferred.to_string());
        }
    }
    for row in &row_maps {
        for name in row.keys() {
            if !column_names.contains(name) {
                column_names.push(name.clone());
            }
        }
    }
    if column_names.is_empty() {
        return None;
    }

    let columns = column_names
        .iter()
        .map(|name| ColumnDef {
            name: name.clone(),
            data_type: "json".to_string(),
        })
        .collect::<Vec<_>>();
    let rows = row_maps
        .into_iter()
        .map(|row| {
            column_names
                .iter()
                .map(|name| row.get(name).cloned().unwrap_or(Value::Null))
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    Some(QueryResult::rows_limited(
        columns,
        rows,
        DEFAULT_QUERY_RESULT_ROW_LIMIT,
    ))
}

/// Returns array buckets as `(None, value)` and keyed/filter buckets as
/// `(Some(key), value)`. This covers terms/date/range/composite and filters
/// aggregations without guessing server-specific response shapes.
pub(super) fn elasticsearch_aggregation_buckets(
    value: &Value,
) -> Option<Vec<(Option<&str>, &Value)>> {
    let buckets = value.get("buckets")?;
    match buckets {
        Value::Array(items) => Some(items.iter().map(|item| (None, item)).collect()),
        Value::Object(items) => Some(
            items
                .iter()
                .map(|(key, item)| (Some(key.as_str()), item))
                .collect(),
        ),
        _ => None,
    }
}

pub(super) fn elasticsearch_aggregation_bucket_row(
    bucket: &serde_json::Map<String, Value>,
) -> BTreeMap<String, Value> {
    let mut row = BTreeMap::new();
    for (name, value) in bucket {
        if let Some(metric) = value.get("value") {
            row.insert(name.clone(), metric.clone());
        } else {
            row.insert(name.clone(), value.clone());
        }
    }
    row
}
