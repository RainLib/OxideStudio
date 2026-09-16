//! Transfer mapping for table operations.

use super::transfer_types::{
    TableDataTransferColumnMapping, TableDataTransferCompatibility, TableDataTransferConversion,
};
use crate::core::protocol::ColumnInfo;
use serde_json::Value;
use std::collections::BTreeMap;
use std::collections::HashSet;

pub(super) fn build_data_transfer_column_mapping(
    source_columns: &[ColumnInfo],
    target_columns: &[ColumnInfo],
) -> Result<(Vec<TableDataTransferColumnMapping>, Vec<String>), String> {
    let unknown_write_metadata = target_columns
        .iter()
        .filter(|column| column.is_generated.is_none() || column.is_hidden.is_none())
        .map(|column| column.name.clone())
        .take(16)
        .collect::<Vec<_>>();
    if !unknown_write_metadata.is_empty() {
        return Err(format!(
            "Target driver did not classify generated/hidden status for column(s): {}. A reviewed transfer cannot assume they are writable.",
            unknown_write_metadata.join(", ")
        ));
    }
    let mut all_target_by_name = BTreeMap::<String, Vec<&ColumnInfo>>::new();
    for target in target_columns {
        all_target_by_name
            .entry(target.name.to_ascii_lowercase())
            .or_default()
            .push(target);
    }
    let missing_target_columns = source_columns
        .iter()
        .filter(|source| !all_target_by_name.contains_key(&source.name.to_ascii_lowercase()))
        .map(|source| source.name.clone())
        .collect::<Vec<_>>();
    if !missing_target_columns.is_empty() {
        return Err(format!(
            "Target table is missing source column(s): {}. OxideStudio does not silently discard source columns; create a matching target or adjust its structure before transferring rows.",
            missing_target_columns.join(", ")
        ));
    }
    if let Some(source) = source_columns.iter().find(|source| {
        all_target_by_name
            .get(&source.name.to_ascii_lowercase())
            .is_some_and(|matches| matches.len() > 1)
    }) {
        return Err(format!(
            "Target table has ambiguous case-insensitive column matches for {}",
            source.name
        ));
    }
    let mut target_by_name = BTreeMap::<String, Vec<&ColumnInfo>>::new();
    for target in target_columns
        .iter()
        .filter(|column| column.is_generated != Some(true) && column.is_hidden != Some(true))
    {
        target_by_name
            .entry(target.name.to_ascii_lowercase())
            .or_default()
            .push(target);
    }

    let mut mappings = Vec::new();
    let mut skipped = Vec::new();
    for source in source_columns {
        let matches = target_by_name
            .get(&source.name.to_ascii_lowercase())
            .map(Vec::as_slice)
            .unwrap_or_default();
        match matches {
            [target] => {
                let (compatibility, conversion, reason) =
                    transfer_type_mapping_assessment(&source.data_type, &target.data_type);
                mappings.push(TableDataTransferColumnMapping {
                    source: source.name.clone(),
                    target: target.name.clone(),
                    data_type: target.data_type.clone(),
                    source_data_type: source.data_type.clone(),
                    target_data_type: target.data_type.clone(),
                    compatibility,
                    conversion,
                    reason,
                });
            }
            [] => skipped.push(source.name.clone()),
            _ => {
                return Err(format!(
                    "Target table has ambiguous case-insensitive column matches for {}",
                    source.name
                ));
            }
        }
    }

    if mappings.is_empty() {
        return Err("Source and target tables do not have any compatible column names".to_string());
    }

    let mapped_targets = mappings
        .iter()
        .map(|mapping| mapping.target.as_str())
        .collect::<HashSet<_>>();
    let missing_required = target_columns
        .iter()
        .filter(|column| {
            !column.is_nullable
                && !column.is_auto_increment
                && column.is_generated != Some(true)
                && column.is_hidden != Some(true)
                && column
                    .default_value
                    .as_deref()
                    .is_none_or(|value| value.trim().is_empty())
                && !mapped_targets.contains(column.name.as_str())
        })
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    if !missing_required.is_empty() {
        return Err(format!(
            "Target requires values for column(s): {}",
            missing_required.join(", ")
        ));
    }

    Ok((mappings, skipped))
}

pub(super) fn transfer_type_family(data_type: &str) -> &'static str {
    let normalized = data_type.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return "unknown";
    }
    if normalized.contains("json") {
        return "json";
    }
    if normalized.contains("bool") || normalized == "bit" {
        return "boolean";
    }
    if normalized.contains("uuid") || normalized.contains("uniqueidentifier") {
        return "uuid";
    }
    if normalized.contains("blob")
        || normalized.contains("binary")
        || normalized.contains("bytea")
        || normalized.contains("varbinary")
    {
        return "binary";
    }
    if normalized.contains("timestamp")
        || normalized.contains("datetime")
        || normalized == "date"
        || normalized == "time"
    {
        return "temporal";
    }
    if normalized.contains("int") || normalized.contains("serial") {
        return "integer";
    }
    if normalized.contains("numeric")
        || normalized.contains("decimal")
        || normalized.contains("float")
        || normalized.contains("double")
        || normalized.contains("real")
    {
        return "numeric";
    }
    if normalized.contains("char")
        || normalized.contains("text")
        || normalized.contains("string")
        || normalized.contains("clob")
        || normalized.contains("varchar")
    {
        return "text";
    }
    "other"
}

pub(super) fn normalized_transfer_type(data_type: &str) -> String {
    data_type
        .trim()
        .to_ascii_lowercase()
        .split('(')
        .next()
        .unwrap_or_default()
        .split_whitespace()
        .filter(|part| !matches!(*part, "unsigned" | "zerofill"))
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn transfer_type_mapping_assessment(
    source_data_type: &str,
    target_data_type: &str,
) -> (
    TableDataTransferCompatibility,
    TableDataTransferConversion,
    String,
) {
    use TableDataTransferCompatibility::{Exact, Review, Safe, Unsupported};
    use TableDataTransferConversion::{None, StringifyJson, StringifyScalar, TargetBinding};

    let source_normalized = normalized_transfer_type(source_data_type);
    let target_normalized = normalized_transfer_type(target_data_type);
    let source_family = transfer_type_family(source_data_type);
    let target_family = transfer_type_family(target_data_type);

    if !source_normalized.is_empty() && source_normalized == target_normalized {
        return (Exact, None, "Source and target types match.".to_string());
    }
    if target_family == "text" {
        let conversion = match source_family {
            "json" => StringifyJson,
            "text" => TargetBinding,
            _ => StringifyScalar,
        };
        return (
            Safe,
            conversion,
            "The source value is serialized through the target text binding.".to_string(),
        );
    }
    if source_family == target_family && source_family != "other" {
        return (
            Safe,
            TargetBinding,
            format!("Both types belong to the {source_family} family."),
        );
    }
    if source_family == "integer" && target_family == "numeric" {
        return (
            Safe,
            TargetBinding,
            "Integer values widen through the target numeric binding.".to_string(),
        );
    }
    if source_family == "numeric" && target_family == "integer" {
        return (
            Review,
            TargetBinding,
            "Numeric-to-integer conversion can lose fractional values or overflow.".to_string(),
        );
    }
    if source_family == "text" {
        return (
            Review,
            TargetBinding,
            format!(
                "Text values must be parsed by the target {target_family} binding; sample rows are validated during preview."
            ),
        );
    }
    if matches!(source_family, "unknown" | "other") || matches!(target_family, "unknown" | "other")
    {
        return (
            Review,
            TargetBinding,
            "The type family is not recognized; the target driver must validate each parameter."
                .to_string(),
        );
    }

    let unsupported = matches!(
        (source_family, target_family),
        (
            "binary",
            "boolean" | "integer" | "numeric" | "temporal" | "uuid" | "json"
        ) | (
            "json",
            "boolean" | "integer" | "numeric" | "temporal" | "uuid" | "binary"
        ) | ("temporal", "boolean" | "binary" | "json")
            | (
                "uuid",
                "boolean" | "integer" | "numeric" | "temporal" | "binary" | "json"
            )
            | ("boolean", "temporal" | "binary" | "json" | "uuid")
            | (
                "integer" | "numeric",
                "temporal" | "binary" | "json" | "uuid"
            )
    );
    if unsupported {
        return (
            Unsupported,
            None,
            format!("No reviewed {source_family}-to-{target_family} conversion is available."),
        );
    }

    (
        Review,
        TargetBinding,
        format!(
            "The target driver must convert {source_family} values to {target_family}; review representative rows."
        ),
    )
}

pub(super) fn transfer_type_mapping_warnings(
    mappings: &[TableDataTransferColumnMapping],
) -> Vec<String> {
    mappings
        .iter()
        .filter_map(|mapping| match mapping.compatibility {
            TableDataTransferCompatibility::Exact | TableDataTransferCompatibility::Safe => None,
            TableDataTransferCompatibility::Review => Some(format!(
                "Type review: {} ({}) → {} ({}). {}",
                mapping.source,
                mapping.source_data_type,
                mapping.target,
                mapping.target_data_type,
                mapping.reason,
            )),
            TableDataTransferCompatibility::Unsupported => Some(format!(
                "Blocked mapping: {} ({}) → {} ({}). {}",
                mapping.source,
                mapping.source_data_type,
                mapping.target,
                mapping.target_data_type,
                mapping.reason,
            )),
        })
        .collect()
}

pub(super) fn transfer_plan_can_execute(mappings: &[TableDataTransferColumnMapping]) -> bool {
    mappings
        .iter()
        .all(|mapping| mapping.compatibility != TableDataTransferCompatibility::Unsupported)
}

pub(super) fn apply_transfer_conversion(
    mapping: &TableDataTransferColumnMapping,
    value: &Value,
) -> Result<Value, String> {
    use TableDataTransferConversion::{None, StringifyJson, StringifyScalar, TargetBinding};

    if mapping.compatibility == TableDataTransferCompatibility::Unsupported {
        return Err(format!(
            "Unsupported transfer mapping {} ({}) → {} ({}): {}",
            mapping.source,
            mapping.source_data_type,
            mapping.target,
            mapping.target_data_type,
            mapping.reason,
        ));
    }
    match mapping.conversion {
        None | TargetBinding => Ok(value.clone()),
        StringifyJson => {
            if value.is_null() {
                Ok(Value::Null)
            } else if let Value::String(value) = value {
                Ok(Value::String(value.clone()))
            } else {
                serde_json::to_string(value)
                    .map(Value::String)
                    .map_err(|error| {
                        format!(
                            "Could not serialize {} as JSON text: {error}",
                            mapping.source
                        )
                    })
            }
        }
        StringifyScalar => match value {
            Value::Null => Ok(Value::Null),
            Value::String(value) => Ok(Value::String(value.clone())),
            Value::Bool(value) => Ok(Value::String(value.to_string())),
            Value::Number(value) => Ok(Value::String(value.to_string())),
            Value::Array(_) | Value::Object(_) => serde_json::to_string(value)
                .map(Value::String)
                .map_err(|error| {
                    format!(
                        "Could not serialize {} as target text: {error}",
                        mapping.source
                    )
                }),
        },
    }
}
