//! Transfer target types for table operations.

use super::transfer_mapping::{normalized_transfer_type, transfer_type_family};
use super::transfer_runtime::normalized_transfer_driver_id;
use super::transfer_types::TableDataTransferCompatibility;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TransferTargetTypeMapping {
    pub(super) data_type: String,
    pub(super) length: Option<String>,
    pub(super) compatibility: TableDataTransferCompatibility,
    pub(super) reason: String,
}

pub(super) fn transfer_target_mapping_profile(source_driver: &str, target_driver: &str) -> String {
    format!(
        "{}-to-{}/v1",
        normalized_transfer_driver_id(source_driver),
        normalized_transfer_driver_id(target_driver)
    )
}

pub(super) fn transfer_target_column_type(
    source_data_type: &str,
    source_driver: &str,
    target_driver: &str,
) -> TransferTargetTypeMapping {
    use TableDataTransferCompatibility::{Exact, Review, Safe, Unsupported};

    let family = transfer_type_family(source_data_type);
    let normalized = normalized_transfer_type(source_data_type);
    let source_lower = source_data_type.trim().to_ascii_lowercase();
    let source_driver = normalized_transfer_driver_id(source_driver);
    let target_driver = normalized_transfer_driver_id(target_driver);
    if source_lower.is_empty() {
        return TransferTargetTypeMapping {
            data_type: "UNMAPPED".to_string(),
            length: None,
            compatibility: Unsupported,
            reason:
                "The source column has no declared type; no executable target DDL is generated."
                    .to_string(),
        };
    }
    if source_driver == target_driver {
        let custom_or_compound = matches!(family, "other" | "unknown")
            || source_lower.contains("[]")
            || [
                "array",
                "map",
                "struct",
                "tuple",
                "nested",
                "geometry",
                "geography",
                "vector",
            ]
            .iter()
            .any(|marker| source_lower.contains(marker));
        return TransferTargetTypeMapping {
            data_type: source_data_type.trim().to_string(),
            length: None,
            compatibility: if custom_or_compound { Review } else { Exact },
            reason: if custom_or_compound {
                "The exact same-product type is preserved, but target extensions/custom types and dependencies require review."
                    .to_string()
            } else {
                "The exact same-product type declaration is preserved.".to_string()
            },
        };
    }
    if !matches!(target_driver.as_str(), "postgres" | "mysql" | "sqlite") {
        return TransferTargetTypeMapping {
            data_type: "UNMAPPED".to_string(),
            length: None,
            compatibility: Unsupported,
            reason: format!(
                "No Host-owned executable target-table mapping profile exists for {target_driver}."
            ),
        };
    }
    let compound_or_custom = matches!(family, "other" | "unknown")
        || source_lower.contains("[]")
        || [
            "array",
            "map",
            "struct",
            "tuple",
            "nested",
            "geometry",
            "geography",
            "vector",
        ]
        .iter()
        .any(|marker| source_lower.contains(marker));
    if compound_or_custom {
        return TransferTargetTypeMapping {
            data_type: "UNMAPPED".to_string(),
            length: None,
            compatibility: Unsupported,
            reason: format!(
                "The source type '{}' needs an explicit cross-product mapping; TEXT fallback is not treated as executable migration DDL.",
                source_data_type.trim()
            ),
        };
    }
    let unsigned_integer = family == "integer" && source_lower.contains("unsigned");
    let floating_numeric = family == "numeric"
        && ["float", "double", "real"]
            .iter()
            .any(|marker| source_lower.contains(marker));
    let is_sqlite = target_driver == "sqlite";
    let is_mysql = target_driver == "mysql";

    let (data_type, length) = if is_sqlite {
        match family {
            "integer" if unsigned_integer => ("NUMERIC", None),
            "integer" => ("INTEGER", None),
            "numeric" if floating_numeric => ("REAL", None),
            "numeric" => ("NUMERIC", None),
            "boolean" => ("BOOLEAN", None),
            "temporal" if normalized == "date" => ("DATE", None),
            "temporal" => ("DATETIME", None),
            "binary" => ("BLOB", None),
            "json" => ("JSON", None),
            "uuid" | "text" => ("TEXT", None),
            _ => unreachable!("unrecognized families are rejected before target mapping"),
        }
    } else if is_mysql {
        match family {
            "integer" if unsigned_integer => ("DECIMAL", Some("20,0".to_string())),
            "integer" => ("BIGINT", None),
            "numeric" if floating_numeric => ("DOUBLE", None),
            "numeric" => ("DECIMAL", Some("65,30".to_string())),
            "boolean" => ("BOOLEAN", None),
            "temporal" if normalized == "date" => ("DATE", None),
            "temporal" => ("DATETIME", None),
            "binary" => ("BLOB", None),
            "json" => ("JSON", None),
            "uuid" => ("VARCHAR", Some("36".to_string())),
            "text" => ("TEXT", None),
            _ => unreachable!("unrecognized families are rejected before target mapping"),
        }
    } else {
        match family {
            "integer" if unsigned_integer => ("DECIMAL", None),
            "integer" => ("BIGINT", None),
            "numeric" if floating_numeric => ("DOUBLE PRECISION", None),
            "numeric" => ("DECIMAL", None),
            "boolean" => ("BOOLEAN", None),
            "temporal" if normalized == "date" => ("DATE", None),
            "temporal" => ("TIMESTAMP", None),
            "binary" => ("BYTEA", None),
            "json" => ("JSONB", None),
            "uuid" => ("UUID", None),
            "text" => ("TEXT", None),
            _ => unreachable!("unrecognized families are rejected before target mapping"),
        }
    };

    let compatibility = if family == "uuid" && target_driver != "postgres"
        || family == "temporal" && normalized != "date"
        || family == "numeric" && !floating_numeric
        || family == "json" && target_driver == "sqlite"
    {
        Review
    } else {
        Safe
    };
    TransferTargetTypeMapping {
        data_type: data_type.to_string(),
        length,
        compatibility,
        reason: format!(
            "Profile {} maps source {family} to {}{}.",
            transfer_target_mapping_profile(&source_driver, &target_driver),
            data_type,
            if compatibility == Review {
                " with manual range/semantic review"
            } else {
                ""
            }
        ),
    }
}
