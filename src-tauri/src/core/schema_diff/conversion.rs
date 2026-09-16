use super::types::{
    SchemaConversionCompatibility, SchemaConversionFeatureKind, SchemaConversionIssue,
    SchemaDiffPlan, SchemaSnapshot,
};
use crate::core::protocol::IndexInfo;

pub(super) fn normalized_driver_family(driver: &str) -> String {
    let normalized = driver.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "postgresql" | "pgsql" => "postgres".to_string(),
        "mariadb" => "mysql".to_string(),
        "mssql" | "sql_server" => "sqlserver".to_string(),
        _ => normalized,
    }
}

pub(super) fn normalized_type_base(data_type: &str) -> String {
    data_type
        .trim()
        .trim_end_matches("[]")
        .split('(')
        .next()
        .unwrap_or(data_type)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

pub(super) fn postgres_conversion_note(
    data_type: &str,
    target_driver: &str,
) -> Option<(String, bool)> {
    let normalized = data_type.trim().to_ascii_lowercase();
    let is_array = normalized.ends_with("[]") || normalized.starts_with("array<");
    let base = normalized_type_base(&normalized);
    if is_array {
        let mapping = if target_driver == "mysql" {
            "JSON; array operators and indexes require manual redesign"
        } else {
            "NVARCHAR(MAX); store as a JSON array and redesign array operators and indexes"
        };
        return Some((format!("{data_type} -> {mapping}"), true));
    }
    let mapping = match target_driver {
        "mysql" => match base.as_str() {
            "uuid" => ("CHAR(36); validate UUID format and indexes", false),
            "jsonb" => ("JSON; GIN/operator semantics are not preserved", true),
            "bytea" => ("LONGBLOB", false),
            "boolean" | "bool" => ("BOOLEAN/TINYINT(1)", false),
            "money" => (
                "DECIMAL(19,4); verify currency, locale, range, and rounding semantics",
                true,
            ),
            "time with time zone" | "timetz" => ("TIME; timezone offset is not preserved", true),
            "timestamp with time zone" | "timestamptz" => (
                "DATETIME(6); normalize timezone values before transfer",
                true,
            ),
            "inet" | "cidr" | "macaddr" | "macaddr8" => (
                "VARCHAR; network validation/operators are not preserved",
                true,
            ),
            "interval" => ("VARCHAR; interval arithmetic is not preserved", true),
            "varbit" | "bit varying" => (
                "BIT(64); verify maximum length and bit-string behavior",
                true,
            ),
            "line" => (
                "LINESTRING; PostgreSQL infinite-line semantics are not preserved",
                true,
            ),
            "circle" => ("POLYGON; circle geometry is approximated", true),
            "tsvector" | "tsquery" => ("TEXT; redesign with MySQL full-text search", true),
            "int4range" | "int8range" | "numrange" | "tsrange" | "tstzrange" | "daterange" => (
                "JSON; range operators, bounds, and indexes are not preserved",
                true,
            ),
            "xml" => (
                "TEXT; XML validation and query semantics are not preserved",
                true,
            ),
            "smallserial" => ("SMALLINT AUTO_INCREMENT; review sequence ownership", true),
            "serial" => ("INTEGER AUTO_INCREMENT; review sequence ownership", true),
            "bigserial" => ("BIGINT AUTO_INCREMENT; review sequence ownership", true),
            _ => return None,
        },
        "sqlserver" => match base.as_str() {
            "uuid" => ("UNIQUEIDENTIFIER", false),
            "json" | "jsonb" => (
                "NVARCHAR(MAX); add ISJSON validation and redesign JSON indexes",
                true,
            ),
            "bytea" => ("VARBINARY(MAX)", false),
            "boolean" | "bool" => ("BIT", false),
            "time with time zone" | "timetz" => ("TIME; timezone offset is not preserved", true),
            "timestamp with time zone" | "timestamptz" => ("DATETIMEOFFSET", false),
            "timestamp without time zone" | "timestamp" => ("DATETIME2", false),
            "inet" | "cidr" | "macaddr" | "macaddr8" => (
                "NVARCHAR; network validation/operators are not preserved",
                true,
            ),
            "interval" => ("NVARCHAR; interval arithmetic is not preserved", true),
            "varbit" | "bit varying" => (
                "VARBINARY(64); verify bit length and ordering semantics",
                true,
            ),
            "circle" => (
                "GEOMETRY; represent and validate the radius explicitly",
                true,
            ),
            "tsvector" | "tsquery" => (
                "NVARCHAR(MAX); redesign with SQL Server Full-Text Search",
                true,
            ),
            "int4range" | "int8range" | "numrange" | "tsrange" | "tstzrange" | "daterange" => (
                "NVARCHAR(MAX); prefer explicit lower/upper bound columns",
                true,
            ),
            "smallserial" => ("SMALLINT IDENTITY; review sequence ownership", true),
            "serial" => ("INT IDENTITY; review sequence ownership", true),
            "bigserial" => ("BIGINT IDENTITY; review sequence ownership", true),
            _ => return None,
        },
        _ => return None,
    };
    Some((format!("{data_type} -> {}", mapping.0), mapping.1))
}

pub(super) fn postgres_default_conversion_note(
    default_value: &str,
    target_driver: &str,
) -> Option<(Option<String>, String, bool)> {
    let normalized = default_value.trim().to_ascii_lowercase();
    if normalized.contains("nextval(") {
        return Some((
            Some(if target_driver == "mysql" {
                "AUTO_INCREMENT".to_string()
            } else {
                "IDENTITY(1,1)".to_string()
            }),
            "Sequence ownership, start value, increment, and current value require explicit target review."
                .to_string(),
            true,
        ));
    }
    if normalized.contains("gen_random_uuid(") || normalized.contains("uuid_generate_") {
        return Some((
            Some(if target_driver == "mysql" {
                "UUID()".to_string()
            } else {
                "NEWID()".to_string()
            }),
            "Use the target-native UUID generator and verify ordering/index expectations."
                .to_string(),
            false,
        ));
    }
    if normalized.contains("array[") || normalized == "'{}'" || normalized == "'{}'::text[]" {
        return Some((
            Some(if target_driver == "mysql" {
                "JSON_ARRAY()".to_string()
            } else {
                "N'[]'".to_string()
            }),
            "Array defaults require a target JSON representation and value-shape validation."
                .to_string(),
            true,
        ));
    }
    if normalized.contains("currval(")
        || normalized.contains("setval(")
        || normalized.contains("current_setting(")
    {
        return Some((
            None,
            "PostgreSQL session or sequence state has no context-free target default.".to_string(),
            true,
        ));
    }
    if normalized.contains("::") {
        return Some((
            None,
            "PostgreSQL cast syntax must be removed or replaced with a target-owned expression."
                .to_string(),
            true,
        ));
    }
    None
}

pub(super) fn postgres_index_conversion_note(
    index: &IndexInfo,
    target_driver: &str,
) -> Option<(Option<String>, String, bool)> {
    let index_type = index
        .index_type
        .as_deref()
        .unwrap_or("btree")
        .trim()
        .to_ascii_lowercase();
    let definition = index
        .definition
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let special_method = !index_type.is_empty() && index_type != "btree";
    let partial = definition.contains(" where ");
    let expression = index.columns.iter().any(|column| {
        column.contains('(')
            || column.contains(')')
            || column.contains("::")
            || column.contains(' ')
    });
    if partial || expression {
        return Some((
            None,
            "Partial or expression index predicates require a target-owned equivalent.".to_string(),
            true,
        ));
    }
    if !special_method {
        return None;
    }
    let (target_type, reason, blocks): (Option<&str>, String, bool) = match (
        target_driver,
        index_type.as_str(),
    ) {
        ("mysql", "hash") => (
            Some("HASH"),
            "HASH availability depends on the target storage engine.".to_string(),
            true,
        ),
        ("mysql", "gin" | "gist" | "spgist" | "sp-gist" | "brin") => (
            Some("BTREE"),
            "PostgreSQL operator-class and access-method semantics are not preserved."
                .to_string(),
            true,
        ),
        ("sqlserver", "gist") => (
            None,
            "Choose SPATIAL for geometry-compatible data or NONCLUSTERED for scalar data."
                .to_string(),
            true,
        ),
        ("sqlserver", "hash" | "gin" | "spgist" | "sp-gist" | "brin") => (
            Some("NONCLUSTERED"),
            "PostgreSQL access-method semantics are not preserved; full-text or specialized indexes may be required."
                .to_string(),
            true,
        ),
        (_, unknown) => (
            None,
            if unknown.is_empty() {
                "The source index access method is missing.".to_string()
            } else {
                format!("No deterministic target mapping exists for {unknown} indexes.")
            },
            true,
        ),
    };
    Some((target_type.map(str::to_string), reason, blocks))
}

pub(super) fn postgres_type_looks_custom(data_type: &str) -> bool {
    let normalized = data_type.trim().to_ascii_lowercase();
    normalized == "user-defined"
        || normalized.starts_with("user-defined ")
        || normalized.starts_with("enum ")
        || normalized.starts_with("domain ")
        || normalized.contains('"')
        || normalized_type_base(&normalized).contains('.')
}

pub(super) fn cross_driver_conversion_issues(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
) -> Vec<SchemaConversionIssue> {
    let source_driver = normalized_driver_family(&source.driver);
    let target_driver = normalized_driver_family(&target.driver);
    if source_driver != "postgres" || !matches!(target_driver.as_str(), "mysql" | "sqlserver") {
        return vec![SchemaConversionIssue {
            feature_kind: SchemaConversionFeatureKind::Schema,
            relation_name: "*".to_string(),
            column_name: "*".to_string(),
            source_data_type: "*".to_string(),
            target_data_type: None,
            compatibility: SchemaConversionCompatibility::Unsupported,
            reason: format!(
                "No deterministic type-mapping profile is installed for {} -> {}; every column type requires manual review.",
                source.driver, target.driver
            ),
            remediation: "Install a signed target-owned semantic migration profile or define and review every target type mapping.".to_string(),
            blocks_automatic_conversion: true,
        }];
    }

    let mut issues = Vec::new();
    for relation in &source.relations {
        for column in &relation.columns {
            if let Some((mapping, lossy)) =
                postgres_conversion_note(&column.data_type, &target_driver)
            {
                let mapped = mapping
                    .strip_prefix(&format!("{} -> ", column.data_type))
                    .unwrap_or(mapping.as_str());
                let mut mapping_parts = mapped.splitn(2, ';');
                let target_data_type = mapping_parts.next().unwrap_or(mapped).trim();
                let mapping_reason = mapping_parts.next().map(str::trim).unwrap_or("");
                let reason = match (mapping_reason.is_empty(), lossy) {
                    (true, true) => "Target-side validation is required.".to_string(),
                    (true, false) => "Deterministic target type mapping.".to_string(),
                    (false, true) => {
                        format!("{mapping_reason}; target-side validation is required")
                    }
                    (false, false) => mapping_reason.to_string(),
                };
                issues.push(SchemaConversionIssue {
                    feature_kind: if column.data_type.trim().ends_with("[]")
                        || column.data_type.trim().to_ascii_lowercase().starts_with("array<")
                    {
                        SchemaConversionFeatureKind::Array
                    } else {
                        SchemaConversionFeatureKind::Type
                    },
                    relation_name: relation.name.clone(),
                    column_name: column.name.clone(),
                    source_data_type: column.data_type.clone(),
                    target_data_type: Some(target_data_type.to_string()),
                    compatibility: if lossy {
                        SchemaConversionCompatibility::Review
                    } else {
                        SchemaConversionCompatibility::Safe
                    },
                    reason,
                    remediation: if lossy {
                        format!(
                            "Confirm the {} representation, value range, null/default behavior, and round-trip expectations.",
                            target.driver
                        )
                    } else {
                        format!(
                            "Verify the deterministic mapping against the installed {} driver capability profile.",
                            target.driver
                        )
                    },
                    blocks_automatic_conversion: lossy,
                });
            } else if postgres_type_looks_custom(&column.data_type) {
                issues.push(SchemaConversionIssue {
                    feature_kind: SchemaConversionFeatureKind::CustomType,
                    relation_name: relation.name.clone(),
                    column_name: column.name.clone(),
                    source_data_type: column.data_type.clone(),
                    target_data_type: None,
                    compatibility: SchemaConversionCompatibility::Unsupported,
                    reason: format!(
                        "Custom PostgreSQL type requires an explicit {} type and value-conversion policy.",
                        target.driver
                    ),
                    remediation: format!(
                        "Define a target-owned {} type plus a deterministic value conversion before generating DDL.",
                        target.driver
                    ),
                    blocks_automatic_conversion: true,
                });
            }
            if let Some(default_value) = column.default_value.as_deref() {
                if let Some((target_default, reason, blocks_automatic_conversion)) =
                    postgres_default_conversion_note(default_value, &target_driver)
                {
                    issues.push(SchemaConversionIssue {
                        feature_kind: SchemaConversionFeatureKind::Default,
                        relation_name: relation.name.clone(),
                        column_name: column.name.clone(),
                        source_data_type: format!("DEFAULT {default_value}"),
                        target_data_type: target_default.map(|value| format!("DEFAULT {value}")),
                        compatibility: SchemaConversionCompatibility::Review,
                        reason,
                        remediation: format!(
                            "Confirm the target-owned {} default and verify generated values before enabling DDL.",
                            target.driver
                        ),
                        blocks_automatic_conversion,
                    });
                }
            }
        }
        for index in &relation.indexes {
            if let Some((target_index_type, reason, blocks_automatic_conversion)) =
                postgres_index_conversion_note(index, &target_driver)
            {
                let index_type = index.index_type.as_deref().unwrap_or("btree");
                issues.push(SchemaConversionIssue {
                    feature_kind: SchemaConversionFeatureKind::Index,
                    relation_name: relation.name.clone(),
                    column_name: format!("index:{}", index.name),
                    source_data_type: format!("{} INDEX", index_type.to_ascii_uppercase()),
                    target_data_type: target_index_type
                        .map(|value| format!("{} INDEX", value.to_ascii_uppercase())),
                    compatibility: SchemaConversionCompatibility::Review,
                    reason,
                    remediation: format!(
                        "Choose an equivalent {} index strategy, or explicitly accept the indexing behavior loss.",
                        target.driver
                    ),
                    blocks_automatic_conversion,
                });
            }
        }
    }
    issues.sort_by(|left, right| {
        (
            &left.relation_name,
            &left.column_name,
            &left.source_data_type,
        )
            .cmp(&(
                &right.relation_name,
                &right.column_name,
                &right.source_data_type,
            ))
    });
    issues.dedup();
    issues
}

pub(super) fn cross_driver_conversion_note(issue: &SchemaConversionIssue) -> String {
    if issue.relation_name == "*" && issue.column_name == "*" {
        return issue.reason.clone();
    }
    let prefix = match issue.compatibility {
        SchemaConversionCompatibility::Safe => "",
        SchemaConversionCompatibility::Review => "LOSSY ",
        SchemaConversionCompatibility::Unsupported => "UNSUPPORTED ",
    };
    format!(
        "{}{}.{}: {} -> {}{}",
        prefix,
        issue.relation_name,
        issue.column_name,
        issue.source_data_type,
        issue.target_data_type.as_deref().unwrap_or("unmapped"),
        if issue.reason.is_empty() {
            String::new()
        } else {
            format!("; {}", issue.reason)
        }
    )
}

pub(super) fn annotate_cross_driver_review(
    plan: &mut SchemaDiffPlan,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
) {
    let issues = cross_driver_conversion_issues(source, target);
    let notes = issues
        .iter()
        .map(cross_driver_conversion_note)
        .collect::<Vec<_>>();
    plan.conversion_issues = issues;
    plan.warnings.push(format!(
        "Cross-driver comparison {} -> {} is review-only. Automatic DDL generation and apply are disabled.",
        source.driver, target.driver
    ));
    plan.warnings.extend(notes.iter().cloned());
    plan.warnings.sort();
    plan.warnings.dedup();

    let mut artifact = vec![
        format!(
            "-- Cross-driver metadata comparison: {} -> {}.",
            source.driver, target.driver
        ),
        "-- No migration commands were generated or executed.".to_string(),
        "-- Deterministic conversion review notes:".to_string(),
    ];
    if notes.is_empty() {
        artifact.push("--   No special mappings detected in captured columns.".to_string());
    } else {
        artifact.extend(notes.iter().map(|note| format!("--   {note}")));
    }
    artifact.push("-- Build and revalidate a target-driver plan before any execution.".to_string());
    artifact.push(String::new());
    plan.migration_sql = artifact.join("\n");
}
