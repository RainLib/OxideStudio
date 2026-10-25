use super::{catalog, journal, projection, table, wire};
use crate::core::transfer_jobs::{models::*, store::JobStore};
use anyhow::{ensure, Context, Result};
use sha2::Digest;
use sqlx::{Connection, MySql, MySqlConnection, QueryBuilder, Row, SqliteConnection};

pub(super) async fn baseline(c: &mut MySqlConnection, job: &StoredJob, lock: bool) -> Result<()> {
    let target = catalog::inspect(c, &job.request.target.schema, &job.request.target.table).await?;
    // Read/lock the relation before checking metadata, so DDL cannot pass a stale check.
    let (rows, digest) = projection::data_digest(c, &target, lock).await?;
    catalog::validate_target(c, job).await?;
    ensure!(
        rows == job.target_rows_before && digest == job.target_data_digest,
        "MySQL reviewed target contents changed"
    );
    Ok(())
}

pub(in crate::core::transfer_jobs) async fn initialize(
    c: &mut MySqlConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<()> {
    // Persistent MySQL DDL commits implicitly. Create only our authenticated
    // journal here; all original-table DML happens in a later transaction.
    journal::create(c, store, job).await?;
    let mut tx = c.begin().await?;
    baseline(&mut tx, job, true).await?;
    journal::lock(&mut tx, job).await?;
    if journal::read_header(&mut tx, store, job).await?.is_none() {
        let count: i64 = sqlx::query_scalar(&format!(
            "SELECT COUNT(*) FROM {}",
            table(job, &job.receipt_table)
        ))
        .fetch_one(&mut *tx)
        .await?;
        ensure!(
            count == 0 && job.summary.rows_staged == 0 && job.summary.batches == 0,
            "MySQL journal header is missing after progress"
        );
        let shape = journal::owned_shape(&mut tx, store, job).await?;
        let header = Header {
            version: 3,
            job_id: job.summary.id.clone(),
            plan_digest: job.plan_digest.clone(),
            snapshot_digest: job.snapshot_digest.clone(),
            stage_schema_digest: shape.clone(),
            receipt_schema_digest: shape,
            published: false,
            rows: 0,
            batches: 0,
        };
        journal::write_header(&mut tx, store, job, &header).await?;
    }
    tx.commit().await?;
    Ok(())
}

pub(in crate::core::transfer_jobs) async fn reconcile(
    c: &mut MySqlConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Option<BatchReceipt>> {
    let mut tx = c
        .begin_with("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY")
        .await?;
    baseline(&mut tx, job, false).await?;
    let last = journal::validate_all(&mut tx, store, job).await?;
    tx.commit().await?;
    Ok(last)
}

pub(in crate::core::transfer_jobs) async fn copy_batch(
    c: &mut MySqlConnection,
    snapshot: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
    previous: Option<&BatchReceipt>,
) -> Result<Option<BatchReceipt>> {
    let before = previous.map_or(0, |r| r.rows_after);
    if before == job.summary.source_rows {
        return Ok(None);
    }
    let budget = super::packet_budget(c).await?;
    let limit = u32::try_from(60_000 / (job.columns.len() + 1))?.min(job.request.batch_rows);
    let rows = sqlx::query("WITH next AS (SELECT seq,wire FROM snapshot_rows WHERE seq>? ORDER BY seq LIMIT ?), sized AS (SELECT seq,wire,SUM(length(wire)+64) OVER(ORDER BY seq) budget FROM next) SELECT seq,CASE WHEN budget<=? AND length(wire)<=? THEN wire END wire FROM sized ORDER BY seq")
        .bind(i64::try_from(before)?).bind(i64::from(limit)).bind(i64::try_from(budget)?).bind(i64::try_from(MAX_ROW_BYTES)?).fetch_all(snapshot).await?;
    let mut after = before;
    let mut payload = Vec::new();
    let mut hash = wire::stage_hasher();
    for row in rows {
        let Some(frame) = row.try_get::<Option<Vec<u8>>, _>("wire")? else {
            break;
        };
        after += 1;
        ensure!(
            row.try_get::<i64, _>("seq")? == i64::try_from(after)?,
            "MySQL private snapshot cursor changed"
        );
        let cells = wire::decode(&frame, job.columns.len(), MAX_ROW_BYTES as usize)?;
        wire::hash_row(&mut hash, after, &frame)?;
        payload.push((after, cells));
    }
    ensure!(
        after > before && after <= job.summary.source_rows,
        "MySQL private snapshot is incomplete or exceeds its packet budget"
    );
    let mut tx = c.begin().await?;
    let header = journal::read_header(&mut tx, store, job)
        .await?
        .context("MySQL journal header missing")?;
    ensure!(!header.published, "MySQL transfer is already published");
    let last: Option<u64> = sqlx::query_scalar(&format!(
        "SELECT MAX(seq) FROM {} WHERE kind=2",
        table(job, &job.receipt_table)
    ))
    .fetch_one(&mut *tx)
    .await?;
    ensure!(
        last.unwrap_or(0) == previous.map_or(0, |r| r.sequence),
        "MySQL checkpoint advanced on another connection"
    );
    let columns = (0..job.columns.len())
        .map(|i| format!(",c{i}"))
        .collect::<String>();
    let mut query = QueryBuilder::<MySql>::new(format!(
        "INSERT INTO {}(kind,seq{columns}) ",
        table(job, &job.receipt_table)
    ));
    query.push_values(&payload, |mut row, (seq, cells)| {
        row.push("1").push_bind(*seq);
        for cell in cells {
            row.push_bind(cell.as_deref());
        }
    });
    query.build().persistent(false).execute(&mut *tx).await?;
    let receipt = BatchReceipt {
        job_id: job.summary.id.clone(),
        plan_digest: job.plan_digest.clone(),
        sequence: previous.map_or(1, |r| r.sequence + 1),
        rows_before: before,
        rows_after: after,
        cursor: vec![Cell::Integer(i64::try_from(after)?)],
        data_digest: format!("{:x}", hash.finalize()),
    };
    journal::write_batch(&mut tx, store, job, &receipt).await?;
    tx.commit().await?;
    Ok(Some(receipt))
}
