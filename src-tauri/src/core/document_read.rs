//! Closed, bounded document reads shared by the public agent and native drivers.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, time::Duration};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentSort {
    pub field: String,
    pub direction: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentReadQuery {
    pub filter: Value,
    pub sort: Vec<DocumentSort>,
    pub projection: Value,
    pub offset: u64,
    pub limit: usize,
}

pub struct DocumentReadRequest<'a> {
    pub database: &'a str,
    pub collection: &'a str,
    pub query: &'a DocumentReadQuery,
    pub max_rows: usize,
    pub max_bytes: usize,
    pub timeout: Duration,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReadPage {
    pub documents: Vec<Value>,
    pub has_more: bool,
    pub next_offset: Option<u64>,
    pub byte_limited: bool,
}

impl DocumentReadQuery {
    pub fn validate(&self) -> Result<()> {
        if !(1..=1_000).contains(&self.limit) || self.offset > 1_000_000 {
            return Err(anyhow!(
                "document limit or offset is outside its permitted range"
            ));
        }
        if serde_json::to_vec(self)?.len() > 32 * 1024 {
            return Err(anyhow!("document query exceeds 32 KiB"));
        }
        if !self.filter.is_object() {
            return Err(anyhow!("document filter must be an object"));
        }
        validate_filter(&self.filter, 0, &mut 0)?;
        if self.sort.len() > 8 {
            return Err(anyhow!("document sort accepts at most eight fields"));
        }
        let mut fields = HashSet::new();
        for sort in &self.sort {
            validate_field(&sort.field)?;
            if !matches!(sort.direction, -1 | 1) || !fields.insert(&sort.field) {
                return Err(anyhow!(
                    "document sort requires unique fields and directions 1 or -1"
                ));
            }
        }
        let projection = self
            .projection
            .as_object()
            .ok_or_else(|| anyhow!("document projection must be an object"))?;
        if projection.len() > 64 {
            return Err(anyhow!("document projection accepts at most 64 fields"));
        }
        let (mut includes, mut excludes) = (false, false);
        for (field, value) in projection {
            validate_field(field)?;
            let include = match value {
                Value::Bool(value) => *value,
                value if value == &json!(0) => false,
                value if value == &json!(1) => true,
                _ => {
                    return Err(anyhow!(
                        "document projection permits only inclusion/exclusion flags"
                    ))
                }
            };
            if field != "_id" {
                includes |= include;
                excludes |= !include;
            }
        }
        if includes && excludes {
            return Err(anyhow!(
                "document projection cannot mix inclusion and exclusion"
            ));
        }
        Ok(())
    }
}

pub fn validate_document_target(database: &str, collection: &str) -> Result<()> {
    if database.is_empty()
        || database.len() > 64
        || database
            .chars()
            .any(|ch| ch.is_control() || " /\\.\"$".contains(ch))
        || collection.is_empty()
        || collection.len() > 256
        || collection.chars().any(char::is_control)
        || collection.contains('$')
    {
        return Err(anyhow!("document database or collection name is invalid"));
    }
    Ok(())
}

fn validate_field(field: &str) -> Result<()> {
    if field.is_empty()
        || field.len() > 256
        || field.chars().any(char::is_control)
        || field
            .split('.')
            .any(|part| part.is_empty() || part.starts_with('$'))
    {
        return Err(anyhow!("document field path is invalid"));
    }
    Ok(())
}

fn validate_filter(value: &Value, depth: usize, nodes: &mut usize) -> Result<()> {
    *nodes += 1;
    if depth > 16 || *nodes > 2_048 {
        return Err(anyhow!(
            "document filter exceeds its nesting or node budget"
        ));
    }
    match value {
        Value::Object(values) => {
            for (key, value) in values {
                if key.starts_with('$') {
                    // This is a find predicate, never an aggregation pipeline,
                    // server-side script, command, or caller-selected options.
                    if !matches!(
                        key.as_str(),
                        "$and"
                            | "$or"
                            | "$nor"
                            | "$not"
                            | "$eq"
                            | "$ne"
                            | "$gt"
                            | "$gte"
                            | "$lt"
                            | "$lte"
                            | "$in"
                            | "$nin"
                            | "$exists"
                            | "$type"
                            | "$all"
                            | "$elemMatch"
                            | "$size"
                            | "$regex"
                            | "$options"
                            | "$oid"
                            | "$numberInt"
                            | "$numberLong"
                            | "$numberDouble"
                            | "$numberDecimal"
                            | "$date"
                            | "$binary"
                            | "$regularExpression"
                            | "$timestamp"
                            | "$minKey"
                            | "$maxKey"
                    ) {
                        return Err(anyhow!("document filter operator {key} is not permitted"));
                    }
                } else {
                    validate_field(key)?;
                }
                validate_filter(value, depth + 1, nodes)?;
            }
        }
        Value::Array(values) => {
            if values.len() > 100 {
                return Err(anyhow!("document filter arrays accept at most 100 entries"));
            }
            for value in values {
                validate_filter(value, depth + 1, nodes)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(filter: Value) -> DocumentReadQuery {
        DocumentReadQuery {
            filter,
            sort: vec![],
            projection: json!({}),
            offset: 0,
            limit: 50,
        }
    }

    #[test]
    fn ordinary_predicates_and_extended_json_remain_typed() {
        query(json!({"$and":[{"age":{"$gte":18}}, {"_id":{"$oid":"507f1f77bcf86cd799439011"}}], "created":{"$date":{"$numberLong":"0"}}})).validate().unwrap();
    }

    #[test]
    fn scripts_expressions_and_write_operators_are_rejected_at_any_depth() {
        for operator in [
            "$where",
            "$function",
            "$accumulator",
            "$expr",
            "$out",
            "$merge",
            "$set",
            "$db",
            "$code",
            "$jsonSchema",
        ] {
            for filter in [
                json!({operator: "payload"}),
                json!({"$or":[{"nested":{operator:"payload"}}]}),
            ] {
                assert!(query(filter).validate().is_err(), "{operator}");
            }
        }
    }

    #[test]
    fn query_structure_and_payload_have_independent_budgets() {
        assert!(query(json!([])).validate().is_err());
        assert!(query(json!({"field": "x".repeat(33 * 1024)}))
            .validate()
            .is_err());
        assert!(query(json!({"field":{"$in":vec![1;101]}}))
            .validate()
            .is_err());
        let mut deep = json!(1);
        for _ in 0..18 {
            deep = json!({"field":deep});
        }
        assert!(query(deep).validate().is_err());
        let mut invalid = query(json!({}));
        invalid.limit = 0;
        assert!(invalid.validate().is_err());
        invalid.limit = 1;
        invalid.offset = 1_000_001;
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn sort_and_projection_cannot_become_expressions() {
        let mut input = query(json!({}));
        input.projection = json!({"_id":0, "age":1});
        input.validate().unwrap();
        for projection in [
            json!({"age":{"$function":{}}}),
            json!({"age":1, "name":0}),
            json!({"$where":1}),
        ] {
            input.projection = projection;
            assert!(input.validate().is_err());
        }
        input.projection = json!({});
        input.sort = vec![DocumentSort {
            field: "age".into(),
            direction: 0,
        }];
        assert!(input.validate().is_err());
        input.sort[0].direction = 1;
        input.sort.push(input.sort[0].clone());
        assert!(input.validate().is_err());
    }

    #[test]
    fn database_and_collection_are_bound_names() {
        validate_document_target("app", "events.archive").unwrap();
        for (database, collection) in [
            ("outside.app", "items"),
            ("app", "$cmd"),
            ("app", "items\0"),
            ("", "items"),
        ] {
            assert!(validate_document_target(database, collection).is_err());
        }
    }
}
