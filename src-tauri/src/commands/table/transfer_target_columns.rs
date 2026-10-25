//! Transfer target columns for table operations.

use super::ddl_columns::{normalize_data_type, validate_default_expression};
use super::ddl_types::CreateTableColumn;
use super::transfer_mapping::transfer_type_family;
use super::transfer_runtime::normalized_transfer_driver_id;
use super::transfer_target_types::transfer_target_column_type;
use super::transfer_types::{TableDataTransferCompatibility, TableDataTransferTargetColumn};
use crate::core::dialect::DatabaseKind;
use crate::core::mysql_character::{is_mysql_character_type, render_mysql_character_clause};
use crate::core::protocol::ColumnInfo;
use std::collections::BTreeMap;

#[derive(Debug)]
pub(super) struct TransferTargetColumnsPlan {
    pub(super) columns: Vec<TableDataTransferTargetColumn>,
    pub(super) create_columns: Vec<CreateTableColumn>,
    pub(super) default_expressions: BTreeMap<String, String>,
    pub(super) identity_generations: BTreeMap<String, String>,
    pub(super) character_metadata: BTreeMap<String, (Option<String>, Option<String>)>,
    pub(super) warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TransferTargetDefaultMapping {
    pub(super) expression: Option<String>,
    pub(super) reason: String,
}

pub(super) fn is_portable_numeric_default(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    let mut index = usize::from(matches!(bytes[0], b'+' | b'-'));
    let integer_start = index;
    while bytes.get(index).is_some_and(u8::is_ascii_digit) {
        index += 1;
    }
    let mut has_digits = index > integer_start;
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let fraction_start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        has_digits |= index > fraction_start;
    }
    if !has_digits {
        return false;
    }
    if matches!(bytes.get(index), Some(b'e' | b'E')) {
        index += 1;
        if matches!(bytes.get(index), Some(b'+' | b'-')) {
            index += 1;
        }
        let exponent_start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index += 1;
        }
        if index == exponent_start {
            return false;
        }
    }
    index == bytes.len()
}

pub(super) fn is_portable_single_quoted_default(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 2 || bytes[0] != b'\'' || bytes[bytes.len() - 1] != b'\'' {
        return false;
    }
    let mut index = 1usize;
    while index + 1 < bytes.len() {
        match bytes[index] {
            b'\'' if bytes.get(index + 1) == Some(&b'\'') => index += 2,
            b'\'' | b'\\' => return false,
            byte if byte.is_ascii_control() => return false,
            _ => index += 1,
        }
    }
    index == bytes.len() - 1
}

pub(super) fn portable_transfer_default_expression(value: &str, family: &str) -> Option<String> {
    let value = value.trim();
    if value.eq_ignore_ascii_case("null") {
        return Some("NULL".to_string());
    }
    if family == "boolean" {
        if value.eq_ignore_ascii_case("true") || value == "1" {
            return Some("TRUE".to_string());
        }
        if value.eq_ignore_ascii_case("false") || value == "0" {
            return Some("FALSE".to_string());
        }
    }
    if matches!(family, "integer" | "numeric") && is_portable_numeric_default(value) {
        return Some(value.to_string());
    }
    if matches!(family, "text" | "uuid" | "temporal") && is_portable_single_quoted_default(value) {
        return Some(value.to_string());
    }
    if family == "temporal" {
        for keyword in ["CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP"] {
            if value.eq_ignore_ascii_case(keyword)
                || value.eq_ignore_ascii_case(&format!("{keyword}()"))
            {
                return Some(keyword.to_string());
            }
        }
    }
    None
}

pub(super) fn default_expression_invokes_function(value: &str, function_name: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0usize;
    let mut quote: Option<u8> = None;
    let mut bracket_identifier = false;
    while index < bytes.len() {
        let current = bytes[index];
        let next = bytes.get(index + 1).copied();
        if bracket_identifier {
            if current == b']' {
                if next == Some(b']') {
                    index += 2;
                    continue;
                }
                bracket_identifier = false;
            }
            index += 1;
            continue;
        }
        if let Some(delimiter) = quote {
            if current == delimiter {
                if next == Some(delimiter) {
                    index += 2;
                    continue;
                }
                quote = None;
            }
            index += 1;
            continue;
        }
        match current {
            b'\'' | b'"' | b'`' => {
                quote = Some(current);
                index += 1;
            }
            b'[' => {
                bracket_identifier = true;
                index += 1;
            }
            byte if byte.is_ascii_alphabetic() || byte == b'_' => {
                let start = index;
                index += 1;
                while bytes
                    .get(index)
                    .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$'))
                {
                    index += 1;
                }
                let token = &value[start..index];
                let mut next_index = index;
                while bytes
                    .get(next_index)
                    .is_some_and(|byte| byte.is_ascii_whitespace())
                {
                    next_index += 1;
                }
                if token.eq_ignore_ascii_case(function_name) && bytes.get(next_index) == Some(&b'(')
                {
                    return true;
                }
            }
            _ => index += 1,
        }
    }
    false
}

pub(super) fn normalized_identity_generation(
    value: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let normalized = value
        .chars()
        .filter(|ch| !matches!(ch, '_' | '-' | ' '))
        .collect::<String>()
        .to_ascii_lowercase();
    match normalized.as_str() {
        "always" => Ok(Some("always".to_string())),
        "bydefault" => Ok(Some("byDefault".to_string())),
        _ => Err(format!(
            "Unsupported source identity generation mode: {value}"
        )),
    }
}

pub(super) fn transfer_target_default_expression(
    source: &ColumnInfo,
    source_driver: &str,
    target_driver: &str,
    identity_retained: bool,
) -> Option<TransferTargetDefaultMapping> {
    let value = source
        .default_value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if identity_retained {
        return Some(TransferTargetDefaultMapping {
            expression: None,
            reason: "The source default belongs to its source generator; the new target-owned identity supplies its own default."
                .to_string(),
        });
    }
    if source.is_generated == Some(true) {
        return Some(TransferTargetDefaultMapping {
            expression: None,
            reason: "Generated-column expressions are not copied as target defaults.".to_string(),
        });
    }
    if let Err(error) = validate_default_expression(value) {
        return Some(TransferTargetDefaultMapping {
            expression: None,
            reason: format!("The source default is not a bounded single SQL expression: {error}."),
        });
    }
    if default_expression_invokes_function(value, "nextval") {
        return Some(TransferTargetDefaultMapping {
            expression: None,
            reason:
                "The source sequence reference is not portable to a newly created target table."
                    .to_string(),
        });
    }

    let source_driver = normalized_transfer_driver_id(source_driver);
    let target_driver = normalized_transfer_driver_id(target_driver);
    if source_driver == target_driver {
        return Some(TransferTargetDefaultMapping {
            expression: Some(value.to_string()),
            reason: "The exact same-product default expression is retained for explicit review."
                .to_string(),
        });
    }
    let family = transfer_type_family(&source.data_type);
    if let Some(expression) = portable_transfer_default_expression(value, family) {
        return Some(TransferTargetDefaultMapping {
            expression: Some(expression),
            reason: format!(
                "A portable {family} default literal/system value is retained across the reviewed product mapping."
            ),
        });
    }
    Some(TransferTargetDefaultMapping {
        expression: None,
        reason:
            "The source default is product-specific and has no reviewed target-dialect mapping."
                .to_string(),
    })
}

pub(super) fn review_transfer_compatibility(
    compatibility: TableDataTransferCompatibility,
) -> TableDataTransferCompatibility {
    match compatibility {
        TableDataTransferCompatibility::Unsupported => compatibility,
        _ => TableDataTransferCompatibility::Review,
    }
}

pub(super) fn transfer_identity_can_be_retained(
    source: &ColumnInfo,
    source_driver: &str,
    target_driver: &str,
    target_data_type: &str,
    visible_primary_key_count: usize,
    source_identity_generation: Option<&str>,
) -> bool {
    if !source.is_auto_increment
        || source.is_generated == Some(true)
        || normalized_transfer_driver_id(source_driver)
            != normalized_transfer_driver_id(target_driver)
    {
        return false;
    }
    match normalized_transfer_driver_id(target_driver).as_str() {
        "postgres" => {
            let is_proven_identity = source_identity_generation.is_some()
                || source
                    .default_value
                    .as_deref()
                    .is_some_and(|value| default_expression_invokes_function(value, "nextval"));
            is_proven_identity
                && DatabaseKind::Postgres
                    .auto_increment_clause_for_type(target_data_type)
                    .is_ok()
        }
        "mysql" => DatabaseKind::Mysql
            .auto_increment_clause_for_type(target_data_type)
            .is_ok(),
        "sqlite" => {
            source.is_primary_key
                && visible_primary_key_count == 1
                && normalize_data_type(target_data_type) == "INTEGER"
        }
        _ => false,
    }
}

pub(super) fn build_transfer_target_columns(
    source_columns: &[ColumnInfo],
    source_driver: &str,
    target_driver: &str,
) -> Result<TransferTargetColumnsPlan, String> {
    if source_columns.is_empty() {
        return Err("Source table has no column metadata".to_string());
    }
    let unknown_ownership = source_columns
        .iter()
        .filter(|column| column.is_generated.is_none() || column.is_hidden.is_none())
        .map(|column| column.name.clone())
        .take(16)
        .collect::<Vec<_>>();
    if !unknown_ownership.is_empty() {
        return Err(format!(
            "Source driver did not classify generated/hidden status for column(s): {}. Target DDL cannot safely decide which values are materialized.",
            unknown_ownership.join(", ")
        ));
    }

    let hidden_columns = source_columns
        .iter()
        .filter(|column| column.is_hidden == Some(true))
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    let generated_columns = source_columns
        .iter()
        .filter(|column| column.is_generated == Some(true) && column.is_hidden != Some(true))
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    let visible_primary_key_count = source_columns
        .iter()
        .filter(|column| column.is_hidden != Some(true) && column.is_primary_key)
        .count();

    let mut planned = Vec::with_capacity(source_columns.len());
    let mut create_columns = Vec::with_capacity(source_columns.len());
    let mut default_expressions = BTreeMap::new();
    let mut identity_generations = BTreeMap::new();
    let mut character_metadata = BTreeMap::new();
    let same_mysql = normalized_transfer_driver_id(source_driver) == "mysql"
        && normalized_transfer_driver_id(target_driver) == "mysql";
    let mut retained_identity_columns = Vec::new();
    let mut omitted_identity_columns = Vec::new();
    let mut retained_default_columns = Vec::new();
    let mut omitted_default_columns = Vec::new();
    for source in source_columns
        .iter()
        .filter(|column| column.is_hidden != Some(true))
    {
        let source_identity_generation =
            normalized_identity_generation(source.identity_generation.as_deref())?;
        if source_identity_generation.is_some() && !source.is_auto_increment {
            return Err(format!(
                "Source column {} declares an identity generation mode without identity semantics",
                source.name
            ));
        }
        let mapping = transfer_target_column_type(&source.data_type, source_driver, target_driver);
        let identity_retained = transfer_identity_can_be_retained(
            source,
            source_driver,
            target_driver,
            &mapping.data_type,
            visible_primary_key_count,
            source_identity_generation.as_deref(),
        );
        let target_identity_generation =
            if identity_retained && normalized_transfer_driver_id(target_driver) == "postgres" {
                source_identity_generation.clone().or_else(|| {
                    source.default_value.as_deref().and_then(|value| {
                        default_expression_invokes_function(value, "nextval")
                            .then(|| "byDefault".to_string())
                    })
                })
            } else {
                None
            };
        let default_mapping = transfer_target_default_expression(
            source,
            source_driver,
            target_driver,
            identity_retained,
        );
        let has_source_default = default_mapping.is_some();
        let default_retained = default_mapping
            .as_ref()
            .and_then(|mapping| mapping.expression.as_ref())
            .is_some();
        let mut compatibility = mapping.compatibility;
        let mut reasons = vec![mapping.reason];
        if source.is_auto_increment {
            if identity_retained {
                retained_identity_columns.push(source.name.clone());
                reasons.push(
                    "Same-product auto-increment semantics are recreated with a target-owned generator; the source generator name and current value are not copied."
                        .to_string(),
                );
                if let Some(identity_generation) = target_identity_generation.as_deref() {
                    reasons.push(format!(
                        "The reviewed PostgreSQL identity generation mode {identity_generation} is retained."
                    ));
                    identity_generations
                        .insert(source.name.clone(), identity_generation.to_string());
                }
                compatibility = review_transfer_compatibility(compatibility);
            } else {
                omitted_identity_columns.push(source.name.clone());
                reasons.push(
                    "Source auto-increment semantics are not synthesized for this target; values are materialized as an ordinary column."
                        .to_string(),
                );
                compatibility = review_transfer_compatibility(compatibility);
            }
        }
        if let Some(default_mapping) = default_mapping {
            reasons.push(default_mapping.reason);
            if let Some(expression) = default_mapping.expression {
                retained_default_columns.push(source.name.clone());
                default_expressions.insert(source.name.clone(), expression);
            } else {
                omitted_default_columns.push(source.name.clone());
            }
            compatibility = review_transfer_compatibility(compatibility);
        }
        if same_mysql && is_mysql_character_type(&mapping.data_type) {
            match render_mysql_character_clause(
                &mapping.data_type,
                source.character_set.as_deref(),
                source.collation.as_deref(),
            ) {
                Ok(clause) if !clause.is_empty() => {
                    character_metadata.insert(
                        source.name.clone(),
                        (source.character_set.clone(), source.collation.clone()),
                    );
                    reasons.push("Captured character set and collation are retained; verify that the target server supports them.".to_string());
                    compatibility = review_transfer_compatibility(compatibility);
                }
                Ok(_) => {
                    reasons.push("Source character metadata is unavailable; review the target database defaults.".to_string());
                    compatibility = review_transfer_compatibility(compatibility);
                }
                Err(reason) => {
                    reasons.push(reason);
                    compatibility = TableDataTransferCompatibility::Unsupported;
                }
            }
        } else if source.character_set.is_some() || source.collation.is_some() {
            reasons.push("Source character semantics require a product-specific mapping; target defaults are not a lossless translation.".to_string());
            compatibility = review_transfer_compatibility(compatibility);
        }
        planned.push(TableDataTransferTargetColumn {
            name: source.name.clone(),
            source_data_type: source.data_type.clone(),
            target_data_type: mapping.data_type.clone(),
            target_length: mapping.length.clone(),
            is_primary_key: source.is_primary_key,
            is_not_null: !source.is_nullable,
            source_auto_increment: source.is_auto_increment,
            source_identity_generation,
            identity_retained,
            target_identity_generation,
            has_source_default,
            default_retained,
            compatibility,
            reason: reasons.join(" "),
        });
        create_columns.push(CreateTableColumn {
            name: source.name.clone(),
            data_type: mapping.data_type,
            length: mapping.length,
            is_primary_key: source.is_primary_key,
            is_not_null: !source.is_nullable,
            is_auto_increment: identity_retained,
            comment: None,
        });
    }
    let mut warnings = Vec::new();
    if !hidden_columns.is_empty() {
        warnings.push(format!(
            "Hidden/invisible source column(s) are omitted from the target: {}.",
            hidden_columns.join(", ")
        ));
    }
    if !generated_columns.is_empty() {
        warnings.push(format!(
            "Generated source column(s) are materialized as ordinary target values; generation expressions are not retained: {}.",
            generated_columns.join(", ")
        ));
    }
    if !retained_identity_columns.is_empty() {
        warnings.push(format!(
            "Same-product auto-increment column(s) are recreated with new target-owned generators; source generator names/current values are not copied: {}.",
            retained_identity_columns.join(", ")
        ));
    }
    if !omitted_identity_columns.is_empty() {
        warnings.push(format!(
            "Auto-increment semantics cannot be retained by this mapping and the values become ordinary target columns: {}.",
            omitted_identity_columns.join(", ")
        ));
    }
    if !retained_default_columns.is_empty() {
        warnings.push(format!(
            "Reviewed source default expression(s) are retained in the target CREATE TABLE plan: {}.",
            retained_default_columns.join(", ")
        ));
    }
    if !omitted_default_columns.is_empty() {
        warnings.push(format!(
            "Source default expressions without a reviewed target-dialect mapping are omitted: {}.",
            omitted_default_columns.join(", ")
        ));
    }
    Ok(TransferTargetColumnsPlan {
        columns: planned,
        create_columns,
        default_expressions,
        identity_generations,
        character_metadata,
        warnings,
    })
}
