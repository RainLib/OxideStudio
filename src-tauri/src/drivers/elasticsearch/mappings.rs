use crate::core::protocol::ColumnInfo;
use serde_json::Value;

pub(super) fn elasticsearch_mapping_to_columns(
    value: &Value,
    index: &str,
    major: u8,
) -> Vec<ColumnInfo> {
    let mut columns = vec![ColumnInfo {
        name: "_id".to_string(),
        data_type: "keyword".to_string(),
        is_nullable: false,
        is_primary_key: true,
        is_unique: true,
        is_indexed: true,
        is_auto_increment: false,
        identity_generation: None,
        is_generated: Some(false),
        is_hidden: Some(false),
        default_value: None,
        comment: Some("Elasticsearch document id".to_string()),
    }];

    let mappings = value
        .get(index)
        .or_else(|| {
            value
                .as_object()
                .and_then(|indices| indices.values().next())
        })
        .and_then(|index_mapping| index_mapping.get("mappings"));

    if let Some(properties) = mappings
        .and_then(|mappings| mappings.get("properties"))
        .and_then(Value::as_object)
    {
        collect_mapping_properties("", properties, &mut columns);
    } else if major == 6 {
        // Elasticsearch 6 keeps one mapping-type wrapper around `properties`.
        // Elasticsearch 7/8 return `mappings.properties` directly.
        if let Some(mapping_types) = mappings.and_then(Value::as_object) {
            for mapping in mapping_types.values() {
                if let Some(properties) = mapping.get("properties").and_then(Value::as_object) {
                    collect_mapping_properties("", properties, &mut columns);
                }
            }
        }
    }

    columns
}

pub(super) fn collect_mapping_properties(
    prefix: &str,
    properties: &serde_json::Map<String, Value>,
    columns: &mut Vec<ColumnInfo>,
) {
    for (field, mapping) in properties {
        let name = if prefix.is_empty() {
            field.to_string()
        } else {
            format!("{prefix}.{field}")
        };
        let data_type = elasticsearch_mapping_type(mapping);
        let is_indexed = mapping
            .get("index")
            .and_then(Value::as_bool)
            .unwrap_or(true);

        if !columns.iter().any(|column| column.name == name) {
            columns.push(ColumnInfo {
                name: name.clone(),
                data_type,
                is_nullable: true,
                is_primary_key: false,
                is_unique: false,
                is_indexed,
                is_auto_increment: false,
                identity_generation: None,
                is_generated: Some(false),
                is_hidden: Some(false),
                default_value: None,
                comment: None,
            });
        }

        if let Some(nested_properties) = mapping.get("properties").and_then(Value::as_object) {
            collect_mapping_properties(&name, nested_properties, columns);
        }
    }
}

pub(super) fn elasticsearch_mapping_type(mapping: &Value) -> String {
    mapping
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| {
            mapping
                .get("properties")
                .and_then(Value::as_object)
                .map(|_| "object")
        })
        .unwrap_or("object")
        .to_string()
}
