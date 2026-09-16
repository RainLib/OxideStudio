use crate::core::protocol::CollectionInfo;
use regex::Regex;
use reqwest::Url;
use serde_json::Value;
use std::collections::BTreeMap;

pub(super) fn elasticsearch_indices_to_collections(value: Value) -> Vec<CollectionInfo> {
    let mut collections: Vec<CollectionInfo> = value
        .as_array()
        .map(|indices| {
            indices
                .iter()
                .filter_map(|index| {
                    let name = normalize_elasticsearch_collection_name(
                        index.get("index").and_then(Value::as_str)?.to_string(),
                    )?;
                    let document_count = index
                        .get("docs.count")
                        .and_then(Value::as_str)
                        .and_then(|value| value.parse::<u64>().ok());
                    Some(CollectionInfo {
                        name,
                        namespace: Some("default".to_string()),
                        collection_type: Some("index".to_string()),
                        document_count,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    collections.sort_by(|left: &CollectionInfo, right| left.name.cmp(&right.name));
    collections.dedup_by(|left, right| left.name == right.name);
    collections
}

pub(super) fn elasticsearch_index_grouping_pattern(url: &Url) -> Option<Regex> {
    let pattern = url
        .query_pairs()
        .find(|(key, _)| key.eq_ignore_ascii_case("indexGroupingPattern"))
        .map(|(_, value)| value.trim().to_string())?;
    if pattern.is_empty()
        || pattern.eq_ignore_ascii_case("off")
        || pattern.eq_ignore_ascii_case("none")
        || pattern.eq_ignore_ascii_case("false")
    {
        return None;
    }
    Regex::new(&pattern).ok()
}

pub(super) fn normalize_elasticsearch_collection_name(name: String) -> Option<String> {
    let name = name.trim().to_string();
    (!name.is_empty() && !name.starts_with('.')).then_some(name)
}

pub(super) fn elasticsearch_resolve_to_collections(value: &Value) -> Vec<CollectionInfo> {
    let mut collections = Vec::new();
    for (field, collection_type) in [
        ("indices", "index"),
        ("aliases", "alias"),
        ("data_streams", "data_stream"),
    ] {
        let names = value
            .get(field)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| item.get("name").and_then(Value::as_str))
            .map(str::to_string);
        collections.extend(elasticsearch_collection_names(names, collection_type));
    }
    sort_and_deduplicate_elasticsearch_collections(collections)
}

pub(super) fn elasticsearch_alias_to_collections(value: &Value) -> Vec<CollectionInfo> {
    elasticsearch_collection_names(
        value
            .as_object()
            .into_iter()
            .flat_map(|objects| objects.keys().cloned()),
        "alias",
    )
}

pub(super) fn elasticsearch_collection_names(
    names: impl IntoIterator<Item = String>,
    collection_type: &str,
) -> Vec<CollectionInfo> {
    let mut names = names
        .into_iter()
        .filter_map(normalize_elasticsearch_collection_name)
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
        .into_iter()
        .map(|name| CollectionInfo {
            name,
            namespace: Some("default".to_string()),
            collection_type: Some(collection_type.to_string()),
            document_count: None,
        })
        .collect()
}

pub(super) fn merge_elasticsearch_collections(
    collections: Vec<CollectionInfo>,
    additional: Vec<CollectionInfo>,
) -> Vec<CollectionInfo> {
    sort_and_deduplicate_elasticsearch_collections(
        collections.into_iter().chain(additional).collect(),
    )
}

pub(super) fn sort_and_deduplicate_elasticsearch_collections(
    mut collections: Vec<CollectionInfo>,
) -> Vec<CollectionInfo> {
    collections.sort_by(|left, right| {
        (left.name.as_str(), left.collection_type.as_deref())
            .cmp(&(right.name.as_str(), right.collection_type.as_deref()))
    });
    collections.dedup_by(|left, right| {
        if left.name != right.name || left.collection_type != right.collection_type {
            return false;
        }
        if left.document_count.is_none() {
            left.document_count = right.document_count;
        }
        true
    });
    collections
}

pub(super) fn group_elasticsearch_collections(
    collections: Vec<CollectionInfo>,
    pattern: Option<&Regex>,
) -> Vec<CollectionInfo> {
    let Some(pattern) = pattern else {
        return collections;
    };
    let mut groups = BTreeMap::<(String, Option<String>), CollectionInfo>::new();
    for mut collection in collections {
        if collection.collection_type.as_deref() != Some("index") {
            groups.insert(
                (collection.name.clone(), collection.collection_type.clone()),
                collection,
            );
            continue;
        }
        let grouped_name = pattern.replace(&collection.name, "${1}*").into_owned();
        collection.name = grouped_name.clone();
        groups
            .entry((grouped_name, collection.collection_type.clone()))
            .and_modify(|existing| {
                existing.document_count = match (existing.document_count, collection.document_count)
                {
                    (Some(left), Some(right)) => Some(left.saturating_add(right)),
                    _ => None,
                };
            })
            .or_insert(collection);
    }
    groups.into_values().collect()
}
