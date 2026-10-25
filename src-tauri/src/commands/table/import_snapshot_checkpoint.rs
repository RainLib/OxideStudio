//! Atomic normalization cursor; replay verifies the committed prefix before append.
use super::{
    import_snapshot::bind_value,
    import_snapshot_stream::{quote, SnapshotInput},
    import_types::ImportRow,
};
use crate::core::transfer_jobs::{FileImportColumn, FileImportPreparation};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Connection, Row, SqliteConnection};

const LEDGER: &str = "CREATE TABLE _oxide_preparation_checkpoint (id INTEGER PRIMARY KEY CHECK (id=1),body TEXT NOT NULL,mac TEXT NOT NULL)";
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Checkpoint {
    version: u8,
    pub ordinal: String,
    pub presence: Option<String>,
    mapping: Vec<FileImportColumn>,
    source_digest: String,
    data_sql: String,
    pub rows: u64,
}

impl Checkpoint {
    pub async fn open(
        connection: &mut SqliteConnection,
        input: &mut SnapshotInput,
        directory: &FileImportPreparation,
        digest: &str,
    ) -> Result<Self, String> {
        let tables = sqlx::query(
            "SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 3",
        )
        .fetch_all(&mut *connection)
        .await
        .map_err(|e| e.to_string())?;
        if tables.is_empty() {
            if directory
                .progress()
                .map_err(|e| e.to_string())?
                .normalized_rows
                != 0
            {
                return Err("Normalized preparation cursor is missing".into());
            }
            let mapping = input.mapping();
            let mut ordinal = format!("_oxide_import_{}", uuid::Uuid::new_v4().simple());
            while mapping
                .iter()
                .map(|c| &c.target)
                .chain(input.presence_column.iter())
                .any(|v| v.eq_ignore_ascii_case(&ordinal))
            {
                ordinal.push('_');
            }
            let schema = std::iter::once(format!("{} INTEGER PRIMARY KEY", quote(&ordinal)))
                .chain(
                    mapping
                        .iter()
                        .map(|c| &c.target)
                        .chain(input.presence_column.iter())
                        .map(|name| format!("{} BLOB", quote(name))),
                )
                .collect::<Vec<_>>()
                .join(",");
            let checkpoint = Self {
                version: 1,
                ordinal,
                presence: input.presence_column.clone(),
                mapping,
                source_digest: digest.into(),
                data_sql: format!("CREATE TABLE data ({schema})"),
                rows: 0,
            };
            let mut transaction = connection.begin().await.map_err(|e| e.to_string())?;
            sqlx::query(&checkpoint.data_sql)
                .execute(&mut *transaction)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query(LEDGER)
                .execute(&mut *transaction)
                .await
                .map_err(|e| e.to_string())?;
            checkpoint.save(&mut transaction, directory).await?;
            transaction.commit().await.map_err(|e| e.to_string())?;
            return Ok(checkpoint);
        }
        if tables.len() != 2
            || tables.iter().any(|r| {
                r.get::<&str, _>("type") != "table"
                    || match r.get::<&str, _>("name") {
                        "data" => false,
                        "_oxide_preparation_checkpoint" => r.get::<&str, _>("sql") != LEDGER,
                        _ => true,
                    }
            })
        {
            return Err("Normalized preparation schema changed".into());
        }
        // Budget actual SQLite allocations as well as Rust buffers, before
        // reading the cursor or any values from an interrupted database.
        let row = sqlx::query("SELECT body,mac FROM _oxide_preparation_checkpoint WHERE id=1 AND length(CAST(body AS BLOB))<=524288 AND length(mac)=64")
            .fetch_one(&mut *connection).await.map_err(|e| e.to_string())?;
        let checkpoint: Self = directory
            .open_checkpoint(
                row.try_get("body").map_err(|e| e.to_string())?,
                row.try_get("mac").map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        if checkpoint.version != 1
            || checkpoint.source_digest != digest
            || checkpoint.mapping != input.mapping()
            || checkpoint.presence.is_some() != input.presence_column.is_some()
            || checkpoint.rows
                < directory
                    .progress()
                    .map_err(|e| e.to_string())?
                    .normalized_rows
            || tables.len() != 2
            || tables.iter().any(|r| {
                r.get::<&str, _>("type") != "table"
                    || match r.get::<&str, _>("name") {
                        "data" => r.get::<&str, _>("sql") != checkpoint.data_sql,
                        "_oxide_preparation_checkpoint" => r.get::<&str, _>("sql") != LEDGER,
                        _ => true,
                    }
            })
        {
            return Err("Normalized preparation definition changed".into());
        }
        let (count, first, last): (i64, Option<i64>, Option<i64>) = sqlx::query_as(&format!(
            "SELECT COUNT(*),MIN({0}),MAX({0}) FROM data",
            quote(&checkpoint.ordinal)
        ))
        .fetch_one(&mut *connection)
        .await
        .map_err(|e| e.to_string())?;
        if u64::try_from(count).ok() != Some(checkpoint.rows)
            || (count > 0 && (first != Some(1) || last != Some(count)))
        {
            return Err("Normalized preparation rows do not match its committed cursor".into());
        }
        input.presence_column = checkpoint.presence.clone();
        Ok(checkpoint)
    }

    pub async fn save(
        &self,
        connection: &mut SqliteConnection,
        directory: &FileImportPreparation,
    ) -> Result<(), String> {
        let (body, mac) = directory.seal_checkpoint(self).map_err(|e| e.to_string())?;
        sqlx::query("INSERT INTO _oxide_preparation_checkpoint(id,body,mac) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,mac=excluded.mac")
            .bind(body).bind(mac).execute(connection).await.map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn verify_row(
        &self,
        connection: &mut SqliteConnection,
        row: &ImportRow,
        ordinal: u64,
    ) -> Result<(), String> {
        let mut conditions = self
            .mapping
            .iter()
            .map(|c| format!("typeof({0})=? AND {0} IS ?", quote(&c.target)))
            .collect::<Vec<_>>();
        if let Some(mask) = &self.presence {
            conditions.push(format!("typeof({0})='blob' AND {0} IS ?", quote(mask)));
        }
        let sql = format!(
            "SELECT 1 FROM data WHERE {}=? AND {}",
            quote(&self.ordinal),
            conditions.join(" AND ")
        );
        let mut query = sqlx::query(&sql).bind(i64::try_from(ordinal).map_err(|e| e.to_string())?);
        for column in &self.mapping {
            let value = row.get(&column.target);
            let kind = match value.unwrap_or(&Value::Null) {
                Value::Null => "null",
                Value::Bool(_) => "integer",
                Value::Number(v) if v.is_i64() || v.is_u64() => "integer",
                Value::Number(_) => "real",
                _ => "text",
            };
            query = bind_value(query.bind(kind), value)?;
        }
        if self.presence.is_some() {
            query = query.bind(self.mask(row));
        }
        if query
            .fetch_optional(connection)
            .await
            .map_err(|e| e.to_string())?
            .is_none()
        {
            return Err("Committed preparation row differs from the reviewed source".into());
        }
        Ok(())
    }
    pub fn mask(&self, row: &ImportRow) -> Vec<u8> {
        let mut mask = vec![0; self.mapping.len().div_ceil(8)];
        for (index, column) in self.mapping.iter().enumerate() {
            if row.contains_key(&column.target) {
                mask[index / 8] |= 1 << (index % 8);
            }
        }
        mask
    }
}
