use super::{quote, relation};
use crate::core::transfer_jobs::models::*;
use anyhow::{bail, ensure, Context, Result};
use sha2::{Digest, Sha256};
use sqlx::{Executor, MySqlConnection, Row};

pub(super) struct Column {
    pub name: String,
    pub display: String,
    pub definition: String,
    pub codec: MySqlCodec,
    pub generated: bool,
    pub required: bool,
    pub default: bool,
    pub identity: bool,
    pub key: u32,
}
pub(super) struct Table {
    pub schema: String,
    pub name: String,
    pub uuid: String,
    pub created: Option<String>,
    pub columns: Vec<Column>,
    pub fold: bool,
}
pub(super) fn codec(kind: &str) -> Result<MySqlCodec> {
    Ok(match kind.to_ascii_lowercase().as_str() {
        "float" | "double" | "real" => MySqlCodec::Float,
        "binary" | "varbinary" | "tinyblob" | "blob" | "mediumblob" | "longblob" => {
            MySqlCodec::Binary
        }
        "bit" => MySqlCodec::Bit,
        "timestamp" => MySqlCodec::Timestamp,
        "geometry" | "point" | "linestring" | "polygon" | "multipoint" | "multilinestring"
        | "multipolygon" | "geometrycollection" => MySqlCodec::Geometry,
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint" | "decimal"
        | "numeric" | "char" | "varchar" | "tinytext" | "text" | "mediumtext" | "longtext"
        | "enum" | "set" | "json" | "date" | "datetime" | "time" | "year" => MySqlCodec::Text,
        _ => bail!("MySQL column type requires a dedicated transfer codec"),
    })
}
pub(super) async fn inspect(c: &mut MySqlConnection, schema: &str, name: &str) -> Result<Table> {
    let schema = if schema.is_empty() {
        sqlx::query_scalar::<_, Option<String>>("SELECT DATABASE()")
            .fetch_one(&mut *c)
            .await?
            .context("MySQL transfer requires a database")?
    } else {
        schema.into()
    };
    ensure!(
        ![
            "mysql",
            "sys",
            "information_schema",
            "performance_schema",
            "ndbinfo"
        ]
        .contains(&schema.to_ascii_lowercase().as_str()),
        "MySQL system schemas cannot be transferred"
    );
    ensure!(
        schema.chars().count() <= 64
            && !schema.chars().any(char::is_control)
            && !name.is_empty()
            && name.chars().count() <= 64
            && !name.chars().any(char::is_control),
        "invalid MySQL transfer identifier"
    );
    let fold: i64 = sqlx::query_scalar("SELECT CAST(@@lower_case_table_names AS SIGNED)")
        .fetch_one(&mut *c)
        .await?;
    let comparison = if fold == 0 {
        "BINARY TABLE_SCHEMA=BINARY ? AND BINARY TABLE_NAME=BINARY ?"
    } else {
        "TABLE_SCHEMA=? AND TABLE_NAME=?"
    };
    let row=sqlx::query(&format!("SELECT TABLE_SCHEMA,TABLE_NAME,ENGINE,CAST(TABLE_TYPE AS CHAR CHARACTER SET utf8mb4) TABLE_TYPE,DATE_FORMAT(CREATE_TIME,'%Y-%m-%dT%H:%i:%s.%f') created FROM information_schema.TABLES WHERE {comparison}")) .bind(&schema).bind(name).fetch_optional(&mut *c).await?.context("MySQL transfer table is unavailable")?;
    ensure!(
        row.try_get::<&str, _>("TABLE_TYPE")? == "BASE TABLE"
            && row
                .try_get::<Option<&str>, _>("ENGINE")?
                .is_some_and(|engine| engine.eq_ignore_ascii_case("InnoDB")),
        "durable MySQL transfer requires an InnoDB base or partitioned table"
    );
    let schema: String = row.try_get("TABLE_SCHEMA")?;
    let name: String = row.try_get("TABLE_NAME")?;
    let (count,bytes):(i64,Option<i64>)=sqlx::query_as("SELECT COUNT(*),CAST(SUM(OCTET_LENGTH(COLUMN_TYPE)+OCTET_LENGTH(COLUMN_COMMENT)+OCTET_LENGTH(GENERATION_EXPRESSION)+COALESCE(OCTET_LENGTH(COLUMN_DEFAULT),0)+256) AS SIGNED) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?").bind(&schema).bind(&name).fetch_one(&mut *c).await?;
    ensure!(
        count > 0 && count <= 512 && bytes.unwrap_or(0) <= 512 * 1024,
        "MySQL column metadata exceeds its budget"
    );
    // Dictionary views can expose textual enum/blob expressions with binary
    // protocol metadata. Request an explicit UTF-8 text result for each field.
    let fields = [
        "COLUMN_NAME",
        "COLUMN_TYPE",
        "DATA_TYPE",
        "IS_NULLABLE",
        "COLUMN_DEFAULT",
        "EXTRA",
        "CHARACTER_SET_NAME",
        "COLLATION_NAME",
    ]
    .iter()
    .map(|field| format!("CAST(c.{field} AS CHAR CHARACTER SET utf8mb4) {field}"))
    .collect::<Vec<_>>()
    .join(",");
    let rows=sqlx::query(&format!("SELECT {fields},CAST(c.SRS_ID AS SIGNED) srid,CAST(COALESCE(s.SEQ_IN_INDEX,0) AS SIGNED) key_order FROM information_schema.COLUMNS c LEFT JOIN information_schema.STATISTICS s ON s.TABLE_SCHEMA=c.TABLE_SCHEMA AND s.TABLE_NAME=c.TABLE_NAME AND s.INDEX_NAME='PRIMARY' AND s.COLUMN_NAME=c.COLUMN_NAME WHERE c.TABLE_SCHEMA=? AND c.TABLE_NAME=? ORDER BY c.ORDINAL_POSITION")).bind(&schema).bind(&name).fetch_all(&mut *c).await?;
    let mut columns = Vec::new();
    for r in rows {
        let display: String = r.try_get("COLUMN_TYPE")?;
        let mut definition = display.clone();
        for (field, prefix) in [
            ("CHARACTER_SET_NAME", " CHARACTER SET "),
            ("COLLATION_NAME", " COLLATE "),
        ] {
            if let Some(value) = r.try_get::<Option<String>, _>(field)? {
                ensure!(
                    value
                        .bytes()
                        .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_'),
                    "invalid MySQL character metadata"
                );
                definition.push_str(prefix);
                definition.push_str(&quote(&value));
            }
        }
        if let Some(srid) = r.try_get::<Option<i64>, _>("srid")? {
            definition.push_str(&format!(" SRID {}", u32::try_from(srid)?));
        }
        let display = definition.clone();
        let required = r.try_get::<&str, _>("IS_NULLABLE")? == "NO";
        definition.push_str(if required { " NOT NULL" } else { " NULL" });
        let extra: String = r.try_get("EXTRA")?;
        columns.push(Column {
            name: r.try_get("COLUMN_NAME")?,
            display,
            definition,
            codec: codec(r.try_get("DATA_TYPE")?)?,
            generated: extra.contains("VIRTUAL GENERATED") || extra.contains("STORED GENERATED"),
            required,
            default: r.try_get::<Option<String>, _>("COLUMN_DEFAULT")?.is_some(),
            identity: extra.contains("auto_increment"),
            key: u32::try_from(r.try_get::<i64, _>("key_order")?)?,
        });
    }
    Ok(Table {
        schema,
        name,
        uuid: sqlx::query_scalar("SELECT @@server_uuid")
            .fetch_one(c)
            .await?,
        created: row.try_get("created")?,
        columns,
        fold: fold != 0,
    })
}

// Only the unquoted table option is volatile. A quoted comment/default containing
// AUTO_INCREMENT must remain part of the authenticated schema.
pub(super) fn canonical_ddl(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = Vec::new();
    let mut i = 0;
    let mut quote_byte = None;
    while i < bytes.len() {
        let ch = bytes[i];
        if let Some(q) = quote_byte {
            output.push(ch);
            i += 1;
            if ch == b'\\' && q != b'`' && i < bytes.len() {
                output.push(bytes[i]);
                i += 1;
            } else if ch == q {
                if bytes.get(i) == Some(&q) {
                    output.push(q);
                    i += 1;
                } else {
                    quote_byte = None;
                }
            }
            continue;
        }
        if matches!(ch, b'`' | b'\'' | b'"') {
            quote_byte = Some(ch);
            output.push(ch);
            i += 1;
            continue;
        }
        const OPTION: &[u8] = b"AUTO_INCREMENT=";
        if bytes.get(i..i + OPTION.len()) == Some(OPTION)
            && i > 0
            && bytes[i - 1].is_ascii_whitespace()
        {
            let mut end = i + OPTION.len();
            while bytes.get(end).is_some_and(u8::is_ascii_digit) {
                end += 1;
            }
            if end > i + OPTION.len() {
                if bytes.get(end) == Some(&b' ') {
                    end += 1;
                }
                i = end;
                continue;
            }
        }
        output.push(ch);
        i += 1;
    }
    String::from_utf8(output).expect("DDL input was UTF-8")
}
pub(super) async fn schema_digest(c: &mut MySqlConnection, table: &Table) -> Result<String> {
    super::privileges::require_trigger_visibility(c, &table.schema, &table.name, table.fold)
        .await?;
    let row = c
        .fetch_one(format!("SHOW CREATE TABLE {}", relation(&table.schema, &table.name)).as_str())
        .await?;
    let ddl: String = row.try_get(1)?;
    ensure!(
        ddl.len() <= 512 * 1024,
        "MySQL table definition exceeds its budget"
    );
    let (count,bytes):(i64,Option<i64>)=sqlx::query_as("SELECT COUNT(*),CAST(SUM(OCTET_LENGTH(ACTION_STATEMENT)+OCTET_LENGTH(SQL_MODE)+1024) AS SIGNED) FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA=? AND EVENT_OBJECT_TABLE=?").bind(&table.schema).bind(&table.name).fetch_one(&mut *c).await?;
    ensure!(
        count <= 512 && bytes.unwrap_or(0) + i64::try_from(ddl.len())? <= 512 * 1024,
        "MySQL trigger definitions exceed their budget"
    );
    let fields = [
        "TRIGGER_NAME",
        "EVENT_MANIPULATION",
        "ACTION_TIMING",
        "ACTION_ORDER",
        "ACTION_STATEMENT",
        "SQL_MODE",
        "DEFINER",
        "CHARACTER_SET_CLIENT",
        "COLLATION_CONNECTION",
        "DATABASE_COLLATION",
    ]
    .iter()
    .map(|field| format!("CAST({field} AS CHAR CHARACTER SET utf8mb4)"))
    .collect::<Vec<_>>()
    .join(",");
    let rows=sqlx::query(&format!("SELECT {fields} FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA=? AND EVENT_OBJECT_TABLE=? ORDER BY CAST(TRIGGER_NAME AS BINARY)")).bind(&table.schema).bind(&table.name).fetch_all(c).await?;
    let mut triggers = Vec::new();
    for row in rows {
        let mut fields = Vec::new();
        for i in 0..10 {
            fields.push(row.try_get::<Option<String>, _>(i)?);
        }
        triggers.push(fields);
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(canonical_ddl(&ddl), triggers))?)
    ))
}
pub(super) async fn validate_target(c: &mut MySqlConnection, job: &StoredJob) -> Result<()> {
    let target = inspect(c, &job.request.target.schema, &job.request.target.table).await?;
    let plan = job.mysql()?;
    ensure!(
        target.uuid == plan.server_uuid
            && target.created == plan.created
            && schema_digest(c, &target).await? == job.target_schema_digest,
        "MySQL target identity or schema changed"
    );
    Ok(())
}
pub(super) fn map_columns(
    job: &mut StoredJob,
    source: &Table,
    target: &Table,
) -> Result<Vec<usize>> {
    let mut indices = Vec::new();
    let mut assigned = std::collections::HashSet::new();
    let mut plans = Vec::new();
    job.columns.clear();
    job.skipped_columns.clear();
    for dest in &target.columns {
        let exact = source.columns.iter().position(|s| s.name == dest.name);
        let matching = source
            .columns
            .iter()
            .enumerate()
            .filter(|(_, s)| s.name.eq_ignore_ascii_case(&dest.name))
            .map(|(i, _)| i)
            .collect::<Vec<_>>();
        let index = exact.or_else(|| (matching.len() == 1).then(|| matching[0]));
        if dest.generated {
            if let Some(i) = index {
                assigned.insert(i);
                job.skipped_columns.push(source.columns[i].name.clone());
            }
            continue;
        }
        if let Some(i) = index {
            ensure!(assigned.insert(i), "ambiguous MySQL column mapping");
            let src = &source.columns[i];
            indices.push(i);
            job.columns.push(LargeTransferColumn {
                source: src.name.clone(),
                target: dest.name.clone(),
                source_type: src.display.clone(),
                target_type: dest.display.clone(),
            });
            plans.push(MySqlColumnPlan {
                definition: dest.definition.clone(),
                source_codec: src.codec,
                target_codec: dest.codec,
            });
        } else {
            ensure!(
                !dest.required || dest.default || dest.identity,
                "required MySQL target column has no mapping or default"
            );
        }
    }
    for (i, col) in source.columns.iter().enumerate() {
        if !assigned.contains(&i) {
            ensure!(
                col.generated,
                "ordinary MySQL source column is absent or ambiguous in target"
            );
            job.skipped_columns.push(col.name.clone());
        }
    }
    ensure!(
        !indices.is_empty(),
        "MySQL migration has no writable mapped columns"
    );
    let mut keys = target
        .columns
        .iter()
        .filter(|c| c.key > 0)
        .collect::<Vec<_>>();
    keys.sort_by_key(|c| c.key);
    job.target_keys = keys.iter().map(|c| c.name.clone()).collect();
    if job.request.mode == LargeTransferMode::Upsert {
        ensure!(
            !job.target_keys.is_empty()
                && job
                    .target_keys
                    .iter()
                    .all(|k| job.columns.iter().any(|c| &c.target == k)),
            "MySQL upsert requires every target primary-key column"
        );
    }
    let plan = job.mysql.as_mut().context("missing MySQL plan")?;
    plan.server_uuid = target.uuid.clone();
    plan.created = target.created.clone();
    plan.columns = plans;
    Ok(indices)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ddl_counter_normalization_preserves_quoted_data() {
        let ddl="CREATE TABLE `AUTO_INCREMENT=4` (`x` int COMMENT 'AUTO_INCREMENT=7') ENGINE=InnoDB AUTO_INCREMENT=42 COMMENT='AUTO_INCREMENT=9'";
        let cleaned = canonical_ddl(ddl);
        assert!(cleaned.contains("`AUTO_INCREMENT=4`"));
        assert!(cleaned.contains("'AUTO_INCREMENT=7'"));
        assert!(cleaned.contains("'AUTO_INCREMENT=9'"));
        assert!(!cleaned.contains("AUTO_INCREMENT=42"));
    }
}
