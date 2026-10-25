use super::{catalog, table, wire};
use crate::core::transfer_jobs::{models::*, store::JobStore};
use anyhow::{ensure, Context, Result};
use futures::TryStreamExt;
use sha2::{Digest, Sha256};
use sqlx::{Executor, MySqlConnection, Row};

const FIELDS:&str="CASE WHEN OCTET_LENGTH(body)<=16384 THEN body END body,CASE WHEN OCTET_LENGTH(mac)=64 THEN mac END mac";
pub(super) fn ownership(store: &JobStore, job: &StoredJob) -> Result<String> {
    Ok(format!(
        "oxide-transfer-v3:{}",
        store.authenticate(
            "mysql-journal-owner",
            &(
                job.summary.id.as_str(),
                job.request.project_id.as_str(),
                job.request.target.clone(),
                job.target_binding.as_str(),
                job.plan_digest.as_str(),
                job.snapshot_digest.as_str()
            )
        )?
    ))
}
pub(super) async fn exists(c: &mut MySqlConnection, job: &StoredJob) -> Result<bool> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?",
    )
    .bind(&job.request.target.schema)
    .bind(&job.receipt_table)
    .fetch_one(c)
    .await?;
    Ok(count == 1)
}
pub(super) async fn create(
    c: &mut MySqlConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<()> {
    if exists(c, job).await? {
        owned_shape(c, store, job).await?;
        return Ok(());
    }
    let columns = (0..job.columns.len())
        .map(|i| format!(",c{i} LONGBLOB NULL"))
        .collect::<String>();
    let sql=format!("CREATE TABLE {}(kind TINYINT UNSIGNED NOT NULL,seq BIGINT UNSIGNED NOT NULL,body MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,mac VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL{columns},PRIMARY KEY(kind,seq)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='{}'",table(job,&job.receipt_table),ownership(store,job)?);
    sqlx::query(&sql).execute(&mut *c).await?;
    owned_shape(c, store, job).await?;
    Ok(())
}
async fn require_owner(c: &mut MySqlConnection, store: &JobStore, job: &StoredJob) -> Result<()> {
    let row=sqlx::query("SELECT ENGINE,TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?").bind(&job.request.target.schema).bind(&job.receipt_table).fetch_one(&mut *c).await?;
    ensure!(
        row.try_get::<Option<&str>, _>("ENGINE")?
            .is_some_and(|engine| engine.eq_ignore_ascii_case("InnoDB"))
            && row.try_get::<&str, _>("TABLE_COMMENT")? == ownership(store, job)?,
        "MySQL journal ownership changed"
    );
    Ok(())
}
pub(super) async fn owned_shape(
    c: &mut MySqlConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<String> {
    require_owner(c, store, job).await?;
    // All journal DML callers hold a transaction. Pin the relation's metadata
    // before checking columns/triggers, so DDL cannot enter between validation
    // and the batch write. Recheck ownership after acquiring that lock.
    sqlx::query(&format!(
        "SELECT 1 FROM {} LIMIT 0",
        table(job, &job.receipt_table)
    ))
    .execute(&mut *c)
    .await?;
    require_owner(c, store, job).await?;
    let fold: i64 = sqlx::query_scalar("SELECT CAST(@@lower_case_table_names AS SIGNED)")
        .fetch_one(&mut *c)
        .await?;
    super::privileges::require_trigger_visibility(
        c,
        &job.request.target.schema,
        &job.receipt_table,
        fold != 0,
    )
    .await?;
    let fields = [
        "COLUMN_NAME",
        "COLUMN_TYPE",
        "IS_NULLABLE",
        "EXTRA",
        "CHARACTER_SET_NAME",
        "COLLATION_NAME",
    ]
    .iter()
    .map(|field| format!("CAST({field} AS CHAR CHARACTER SET utf8mb4) {field}"))
    .collect::<Vec<_>>()
    .join(",");
    let rows=sqlx::query(&format!("SELECT {fields} FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION LIMIT 517")).bind(&job.request.target.schema).bind(&job.receipt_table).fetch_all(&mut *c).await?;
    ensure!(
        rows.len() == job.columns.len() + 4,
        "MySQL journal column shape changed"
    );
    for (i, row) in rows.iter().enumerate() {
        let (name, kind, nullable) = match i {
            0 => ("kind".into(), "tinyint unsigned", "NO"),
            1 => ("seq".into(), "bigint unsigned", "NO"),
            2 => ("body".into(), "mediumtext", "YES"),
            3 => ("mac".into(), "varchar(64)", "YES"),
            _ => (format!("c{}", i - 4), "longblob", "YES"),
        };
        ensure!(
            row.try_get::<&str, _>("COLUMN_NAME")? == name
                && row.try_get::<&str, _>("COLUMN_TYPE")? == kind
                && row.try_get::<&str, _>("IS_NULLABLE")? == nullable
                && row.try_get::<&str, _>("EXTRA")?.is_empty(),
            "MySQL journal column ownership changed"
        );
        if i == 2 {
            ensure!(
                row.try_get::<Option<&str>, _>("COLLATION_NAME")? == Some("utf8mb4_bin"),
                "MySQL journal body collation changed"
            );
        }
        if i == 3 {
            ensure!(
                row.try_get::<Option<&str>, _>("COLLATION_NAME")? == Some("ascii_bin"),
                "MySQL journal signature collation changed"
            );
        }
    }
    let indexes=sqlx::query("SELECT INDEX_NAME,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX").bind(&job.request.target.schema).bind(&job.receipt_table).fetch_all(&mut *c).await?;
    ensure!(
        indexes.len() == 2
            && indexes[0].try_get::<&str, _>("INDEX_NAME")? == "PRIMARY"
            && indexes[0].try_get::<&str, _>("COLUMN_NAME")? == "kind"
            && indexes[1].try_get::<&str, _>("COLUMN_NAME")? == "seq",
        "MySQL journal index ownership changed"
    );
    let triggers:i64=sqlx::query_scalar("SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA=? AND EVENT_OBJECT_TABLE=?").bind(&job.request.target.schema).bind(&job.receipt_table).fetch_one(&mut *c).await?;
    let constraints:i64=sqlx::query_scalar("SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_TYPE<>'PRIMARY KEY'").bind(&job.request.target.schema).bind(&job.receipt_table).fetch_one(&mut *c).await?;
    ensure!(
        triggers == 0 && constraints == 0,
        "MySQL journal has unexpected triggers or constraints"
    );
    let row = c
        .fetch_one(format!("SHOW CREATE TABLE {}", table(job, &job.receipt_table)).as_str())
        .await?;
    let ddl: String = row.try_get(1)?;
    ensure!(
        ddl.len() <= 512 * 1024,
        "MySQL journal definition exceeds its budget"
    );
    Ok(format!(
        "{:x}",
        Sha256::digest(catalog::canonical_ddl(&ddl).as_bytes())
    ))
}
pub(in crate::core::transfer_jobs) async fn read_header(
    c: &mut MySqlConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Option<Header>> {
    if !exists(c, job).await? {
        return Ok(None);
    }
    let schema = owned_shape(c, store, job).await?;
    let row = sqlx::query(&format!(
        "SELECT {FIELDS} FROM {} WHERE kind=0 AND seq=0",
        table(job, &job.receipt_table)
    ))
    .fetch_optional(&mut *c)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let header: Header = store.decode(
        "mysql-header",
        // MySQL marks our known UTF-8/ascii _bin text columns BINARY.
        // Decode still validates UTF-8; only SQLx's collation flag check is bypassed.
        row.try_get_unchecked::<Option<&str>, _>("body")?
            .context("invalid MySQL header body")?,
        row.try_get_unchecked::<Option<&str>, _>("mac")?
            .context("invalid MySQL header signature")?,
    )?;
    ensure!(
        header.version == 3
            && header.job_id == job.summary.id
            && header.plan_digest == job.plan_digest
            && header.snapshot_digest == job.snapshot_digest
            && header.stage_schema_digest == schema
            && header.receipt_schema_digest == schema,
        "MySQL header authentication changed"
    );
    if header.published {
        let count: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {}",
            table(job, &job.receipt_table)
        ))
        .fetch_one(&mut *c)
        .await?;
        let cells = (0..job.columns.len())
            .map(|i| format!("c{i} IS NOT NULL"))
            .collect::<Vec<_>>()
            .join(" OR ");
        let data: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {} WHERE {cells}",
            table(job, &job.receipt_table)
        ))
        .fetch_one(c)
        .await?;
        ensure!(
            header.rows == job.summary.source_rows && count == 1 && data == 0,
            "invalid MySQL published receipt"
        );
    }
    Ok(Some(header))
}
pub(super) async fn write_header(
    c: &mut MySqlConnection,
    store: &JobStore,
    job: &StoredJob,
    header: &Header,
) -> Result<()> {
    let (body, mac) = store.encode("mysql-header", header)?;
    sqlx::query(&format!("INSERT INTO {}(kind,seq,body,mac) VALUES(0,0,?,?) AS incoming ON DUPLICATE KEY UPDATE body=incoming.body,mac=incoming.mac",table(job,&job.receipt_table))).bind(body).bind(mac).execute(c).await?;
    Ok(())
}
pub(super) async fn lock(c: &mut MySqlConnection, job: &StoredJob) -> Result<()> {
    let sql = format!(
        "SELECT kind,seq FROM {} ORDER BY kind,seq FOR UPDATE",
        table(job, &job.receipt_table)
    );
    let mut stream = sqlx::query(&sql).fetch(c);
    while stream.try_next().await?.is_some() {}
    Ok(())
}
fn budget_expression(job: &StoredJob) -> String {
    (0..job.columns.len())
        .map(|i| format!("COALESCE(OCTET_LENGTH(c{i}),0)+4"))
        .collect::<Vec<_>>()
        .join("+")
}
pub(super) async fn hash_range(
    c: &mut MySqlConnection,
    job: &StoredJob,
    after: u64,
    through: u64,
) -> Result<String> {
    let budget = budget_expression(job);
    let fields = (0..job.columns.len())
        .map(|i| format!("CASE WHEN b.bytes<={MAX_ROW_BYTES} THEN s.c{i} END c{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let sql=format!("SELECT s.seq,{fields},CAST(b.bytes>{MAX_ROW_BYTES} AS SIGNED) oversized FROM {} s JOIN LATERAL(SELECT 6+{budget} bytes LIMIT 1) b ON TRUE WHERE kind=1 AND seq>? AND seq<=? ORDER BY seq",table(job,&job.receipt_table));
    let mut stream = sqlx::query(&sql).bind(after).bind(through).fetch(c);
    let mut expected = after;
    let mut hash = wire::stage_hasher();
    while let Some(row) = stream.try_next().await? {
        ensure!(
            row.try_get::<i64, _>("oversized")? == 0,
            "MySQL staged row exceeds its budget"
        );
        expected = expected
            .checked_add(1)
            .context("MySQL staging cursor overflow")?;
        ensure!(
            row.try_get::<u64, _>("seq")? == expected,
            "MySQL staged ordinal continuity changed"
        );
        let cells = (0..job.columns.len())
            .map(|i| row.try_get::<Option<Vec<u8>>, _>(i + 1))
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let frame = wire::encode(&cells, MAX_ROW_BYTES as usize)?;
        wire::hash_row(&mut hash, expected, &frame)?;
    }
    ensure!(expected == through, "MySQL staging range has missing rows");
    Ok(format!("{:x}", hash.finalize()))
}
pub(super) async fn validate_all(
    c: &mut MySqlConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Option<BatchReceipt>> {
    let header = read_header(c, store, job)
        .await?
        .context("MySQL receipt is missing")?;
    ensure!(!header.published, "MySQL transfer is already published");
    let nulls = (0..job.columns.len())
        .map(|i| format!(" OR c{i} IS NOT NULL"))
        .collect::<String>();
    let bad:i64=sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {} WHERE kind>2 OR (kind=0 AND seq<>0) OR (kind=1 AND (seq=0 OR body IS NOT NULL OR mac IS NOT NULL)) OR (kind IN (0,2) AND (body IS NULL OR mac IS NULL{nulls})) OR (kind=2 AND seq=0)",table(job,&job.receipt_table))).fetch_one(&mut *c).await?;
    ensure!(bad == 0, "MySQL journal row shape changed");
    let mut last: Option<BatchReceipt> = None;
    loop {
        let sequence = last.as_ref().map_or(0, |r| r.sequence);
        let rows = sqlx::query(&format!(
            "SELECT seq,{FIELDS} FROM {} WHERE kind=2 AND seq>? ORDER BY seq LIMIT 32",
            table(job, &job.receipt_table)
        ))
        .bind(sequence)
        .fetch_all(&mut *c)
        .await?;
        if rows.is_empty() {
            break;
        }
        for row in rows {
            let receipt: BatchReceipt = store.decode(
                "mysql-batch",
                row.try_get_unchecked::<Option<&str>, _>("body")?
                    .context("invalid MySQL batch body")?,
                row.try_get_unchecked::<Option<&str>, _>("mac")?
                    .context("invalid MySQL batch signature")?,
            )?;
            let before = last.as_ref().map_or(0, |r| r.rows_after);
            let sequence = last.as_ref().map_or(1, |r| r.sequence + 1);
            ensure!(
                receipt.job_id == job.summary.id
                    && receipt.plan_digest == job.plan_digest
                    && receipt.sequence == sequence
                    && row.try_get::<u64, _>("seq")? == sequence
                    && receipt.rows_before == before
                    && receipt.rows_after > before
                    && receipt.rows_after <= job.summary.source_rows
                    && receipt.rows_after - before <= u64::from(job.request.batch_rows),
                "MySQL receipt continuity changed"
            );
            ensure!(
                matches!(receipt.cursor.as_slice(),[Cell::Integer(value)] if *value==i64::try_from(receipt.rows_after)?),
                "invalid MySQL checkpoint cursor"
            );
            ensure!(
                hash_range(c, job, before, receipt.rows_after).await? == receipt.data_digest,
                "MySQL staged data changed"
            );
            last = Some(receipt);
        }
    }
    let (count, min, max): (i64, Option<u64>, Option<u64>) = sqlx::query_as(&format!(
        "SELECT COUNT(*),MIN(seq),MAX(seq) FROM {} WHERE kind=1",
        table(job, &job.receipt_table)
    ))
    .fetch_one(c)
    .await?;
    let rows = last.as_ref().map_or(0, |r| r.rows_after);
    ensure!(
        u64::try_from(count)? == rows
            && if rows == 0 {
                min.is_none() && max.is_none()
            } else {
                min == Some(1) && max == Some(rows)
            },
        "MySQL journal contains unreceipted or missing staged rows"
    );
    Ok(last)
}
pub(super) async fn write_batch(
    c: &mut MySqlConnection,
    store: &JobStore,
    job: &StoredJob,
    receipt: &BatchReceipt,
) -> Result<()> {
    let (body, mac) = store.encode("mysql-batch", receipt)?;
    sqlx::query(&format!(
        "INSERT INTO {}(kind,seq,body,mac) VALUES(2,?,?,?)",
        table(job, &job.receipt_table)
    ))
    .bind(receipt.sequence)
    .bind(body)
    .bind(mac)
    .execute(c)
    .await?;
    Ok(())
}
