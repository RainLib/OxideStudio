use super::{catalog, quote, receipt, relation, table, wire};
use crate::core::transfer_jobs::{models::*, store::JobStore};
use anyhow::{ensure, Context, Result};
use sha2::{Digest, Sha256};
use sqlx::{Connection, PgConnection, Row, SqliteConnection};

pub(in crate::core::transfer_jobs) async fn initialize(
    connection: &mut PgConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<()> {
    let mut tx = connection.begin().await?;
    catalog::validate_target(&mut tx, job).await?;
    if let Some(header) = receipt::read_header(&mut tx, store, job).await? {
        if !header.published {
            receipt::validate_stage(&mut tx, job, &header).await?;
            validate_data(&mut tx, job).await?;
        }
        tx.commit().await?;
        return Ok(());
    }
    ensure!(
        job.summary.rows_staged == 0 && job.summary.batches == 0,
        "committed PostgreSQL migration receipt is missing"
    );
    sqlx::query(&format!(
        "LOCK TABLE {} IN SHARE MODE",
        table(job, &job.request.target.table)
    ))
    .execute(&mut *tx)
    .await?;
    catalog::validate_target(&mut tx, job).await?;
    validate_data(&mut tx, job).await?;
    let fields = std::iter::once(format!(
        "{} bigint PRIMARY KEY",
        quote(&job.sequence_column)
    ))
    .chain(
        job.columns
            .iter()
            .map(|c| format!("{} text", quote(&c.target))),
    )
    .collect::<Vec<_>>()
    .join(",");
    sqlx::query(&format!(
        "CREATE TABLE {} ({fields})",
        table(job, &job.stage_table)
    ))
    .execute(&mut *tx)
    .await?;
    sqlx::query(&format!("CREATE TABLE {} (seq bigint PRIMARY KEY CHECK(seq>=0),body text NOT NULL,mac text NOT NULL)",table(job,&job.receipt_table))).execute(&mut *tx).await?;
    let stage = catalog::relation_oid(&mut tx, &job.request.target.schema, &job.stage_table)
        .await?
        .context("new PostgreSQL staging table is missing")?;
    let receipts = catalog::relation_oid(&mut tx, &job.request.target.schema, &job.receipt_table)
        .await?
        .context("new PostgreSQL receipt table is missing")?;
    let header = Header {
        version: 2,
        job_id: job.summary.id.clone(),
        plan_digest: job.plan_digest.clone(),
        snapshot_digest: job.snapshot_digest.clone(),
        stage_schema_digest: catalog::schema_digest(&mut tx, stage).await?,
        receipt_schema_digest: catalog::schema_digest(&mut tx, receipts).await?,
        published: false,
        rows: 0,
        batches: 0,
    };
    receipt::write_header(&mut tx, store, job, &header).await?;
    tx.commit().await?;
    Ok(())
}
async fn validate_data(connection: &mut PgConnection, job: &StoredJob) -> Result<()> {
    let (rows, digest) = wire::data_digest(connection, job.postgres()?.target_oid).await?;
    ensure!(
        rows == job.target_rows_before && digest == job.target_data_digest,
        "PostgreSQL reviewed target contents changed"
    );
    Ok(())
}
pub(in crate::core::transfer_jobs) async fn reconcile(
    connection: &mut PgConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Option<BatchReceipt>> {
    let mut tx = connection
        .begin_with("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .await?;
    let last = receipt::validate_all(&mut tx, store, job).await?;
    tx.commit().await?;
    Ok(last)
}
pub(in crate::core::transfer_jobs) async fn copy_batch(
    connection: &mut PgConnection,
    snapshot: &mut SqliteConnection,
    store: &JobStore,
    job: &StoredJob,
    previous: Option<&BatchReceipt>,
) -> Result<Option<BatchReceipt>> {
    let before = previous.map_or(0, |r| r.rows_after);
    if before == job.summary.source_rows {
        return Ok(None);
    }
    let rows=sqlx::query("WITH next AS (SELECT seq,wire FROM snapshot_rows WHERE seq>? ORDER BY seq LIMIT ?), sized AS (SELECT seq,wire,SUM(octet_length(wire)+32) OVER (ORDER BY seq) AS budget FROM next) SELECT seq,CASE WHEN budget<=? AND octet_length(wire)<=? THEN wire END AS wire FROM sized ORDER BY seq")
        .bind(i64::try_from(before)?).bind(i64::from(job.request.batch_rows)).bind(i64::try_from(BATCH_BYTES)?).bind(i64::try_from(MAX_ROW_BYTES)?).fetch_all(snapshot).await?;
    let mut payload = Vec::new();
    let mut after = before;
    for row in rows {
        let Some(wire) = row.try_get::<Option<Vec<u8>>, _>("wire")? else {
            break;
        };
        after += 1;
        ensure!(
            row.try_get::<i64, _>("seq")? == i64::try_from(after)? && wire.ends_with(b"\n"),
            "PostgreSQL private snapshot cursor changed"
        );
        payload.extend_from_slice(format!("{after}\t").as_bytes());
        payload.extend_from_slice(&wire);
    }
    ensure!(
        after > before && after <= job.summary.source_rows && payload.len() <= BATCH_BYTES as usize,
        "PostgreSQL private snapshot is incomplete or exceeds its row budget"
    );
    let digest = format!("{:x}", Sha256::digest(&payload));
    let mut tx = connection.begin().await?;
    catalog::validate_target(&mut tx, job).await?;
    let header = receipt::read_header(&mut tx, store, job)
        .await?
        .context("PostgreSQL receipt is missing")?;
    ensure!(!header.published, "PostgreSQL migration already published");
    receipt::validate_stage(&mut tx, job, &header).await?;
    let fields = std::iter::once(quote(&job.sequence_column))
        .chain(job.columns.iter().map(|c| quote(&c.target)))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "COPY {} ({fields}) FROM STDIN WITH (FORMAT text,ENCODING 'UTF8')",
        table(job, &job.stage_table)
    );
    let mut copy = tx.copy_in_raw(&sql).await?;
    copy.send(payload.as_slice()).await?;
    ensure!(
        copy.finish().await? == after - before,
        "PostgreSQL COPY batch row count changed"
    );
    let receipt = BatchReceipt {
        job_id: job.summary.id.clone(),
        plan_digest: job.plan_digest.clone(),
        sequence: previous.map_or(1, |r| r.sequence + 1),
        rows_before: before,
        rows_after: after,
        cursor: vec![Cell::Integer(i64::try_from(after)?)],
        data_digest: digest,
    };
    receipt::write_batch(&mut tx, store, job, &receipt).await?;
    tx.commit().await?;
    Ok(Some(receipt))
}

async fn lock_sequences(connection: &mut PgConnection, job: &StoredJob) -> Result<()> {
    for sequence in &job.postgres()?.sequences {
        sqlx::query(&format!(
            "ALTER SEQUENCE {} INCREMENT BY {}",
            relation(&sequence.schema, &sequence.name),
            sequence.increment
        ))
        .execute(&mut *connection)
        .await?;
    }
    Ok(())
}
async fn advance_sequences(connection: &mut PgConnection, job: &StoredJob) -> Result<()> {
    for sequence in &job.postgres()?.sequences {
        let name = relation(&sequence.schema, &sequence.name);
        let (last, called): (i64, bool) =
            sqlx::query_as(&format!("SELECT last_value,is_called FROM {name}"))
                .fetch_one(&mut *connection)
                .await?;
        let extreme: Option<String> = sqlx::query_scalar(&format!(
            "SELECT {}({})::text FROM {}",
            if sequence.increment > 0 { "MAX" } else { "MIN" },
            quote(&sequence.column),
            table(job, &job.request.target.table)
        ))
        .fetch_one(&mut *connection)
        .await?;
        let increment = i128::from(sequence.increment);
        let current = i128::from(last) + if called { increment } else { 0 };
        let next = if let Some(value) = extreme {
            let edge = value
                .parse::<i128>()
                .context("owned sequence column is not integral")?
                + increment;
            if increment > 0 {
                current.max(edge)
            } else {
                current.min(edge)
            }
        } else {
            current
        };
        ensure!(
            next >= i128::from(sequence.minimum) && next <= i128::from(sequence.maximum),
            "owned PostgreSQL sequence has no safe next value"
        );
        // RESTART replaces sequence storage transactionally and invalidates old
        // backend caches. Unlike setval, rollback restores the previous state.
        sqlx::query(&format!("ALTER SEQUENCE {name} RESTART WITH {next}"))
            .execute(&mut *connection)
            .await?;
    }
    Ok(())
}
pub(in crate::core::transfer_jobs) async fn publish(
    connection: &mut PgConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Header> {
    let mut tx = connection.begin().await?;
    sqlx::query(&format!(
        "LOCK TABLE {},{},{} IN ACCESS EXCLUSIVE MODE",
        table(job, &job.request.target.table),
        table(job, &job.stage_table),
        table(job, &job.receipt_table)
    ))
    .execute(&mut *tx)
    .await?;
    catalog::validate_target(&mut tx, job).await?;
    validate_data(&mut tx, job).await?;
    let last = receipt::validate_all(&mut tx, store, job).await?;
    ensure!(
        last.as_ref().map_or(0, |r| r.rows_after) == job.summary.source_rows,
        "PostgreSQL migration is not fully staged"
    );
    lock_sequences(&mut tx, job).await?;
    let target = table(job, &job.request.target.table);
    super::session::native_write(&mut tx).await?;
    if job.request.mode == LargeTransferMode::Overwrite {
        sqlx::query(&format!("DELETE FROM {target}"))
            .execute(&mut *tx)
            .await?;
    }
    let fields = job
        .columns
        .iter()
        .map(|c| quote(&c.target))
        .collect::<Vec<_>>()
        .join(",");
    let plan = job.postgres()?;
    ensure!(
        plan.target_types.len() == job.columns.len(),
        "PostgreSQL cast mapping changed"
    );
    let values = job
        .columns
        .iter()
        .zip(&plan.target_types)
        .map(|(c, t)| {
            format!(
                "CAST({} AS {})",
                quote(&c.target),
                relation(&t.schema, &t.name)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let mut sql = format!(
        "INSERT INTO {target} ({fields}) {} SELECT {values} FROM {} ORDER BY {}",
        if plan.has_identity {
            "OVERRIDING SYSTEM VALUE"
        } else {
            ""
        },
        table(job, &job.stage_table),
        quote(&job.sequence_column)
    );
    if job.request.mode == LargeTransferMode::Upsert {
        let keys = job
            .target_keys
            .iter()
            .map(|k| quote(k))
            .collect::<Vec<_>>()
            .join(",");
        let updates = job
            .columns
            .iter()
            .filter(|c| !job.target_keys.contains(&c.target))
            .map(|c| format!("{}=excluded.{}", quote(&c.target), quote(&c.target)))
            .collect::<Vec<_>>();
        sql.push_str(&format!(
            " ON CONFLICT ({keys}) {}",
            if updates.is_empty() {
                "DO NOTHING".into()
            } else {
                format!("DO UPDATE SET {}", updates.join(","))
            }
        ));
    }
    sqlx::query(&sql).execute(&mut *tx).await?;
    super::session::normalize(&mut tx).await?;
    let expected_rows = match job.request.mode {
        LargeTransferMode::Append => Some(
            job.target_rows_before
                .checked_add(job.summary.source_rows)
                .context("PostgreSQL target row count overflow")?,
        ),
        LargeTransferMode::Overwrite => Some(job.summary.source_rows),
        LargeTransferMode::Upsert => None,
    };
    if let Some(expected) = expected_rows {
        let actual: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {target}"))
            .fetch_one(&mut *tx)
            .await?;
        ensure!(
            u64::try_from(actual)? == expected,
            "PostgreSQL target triggers changed the expected publication row count"
        );
    }
    advance_sequences(&mut tx, job).await?;
    let mut header = receipt::read_header(&mut tx, store, job)
        .await?
        .context("PostgreSQL receipt is missing")?;
    header.published = true;
    header.rows = job.summary.source_rows;
    header.batches = last.map_or(0, |r| r.sequence);
    receipt::write_header(&mut tx, store, job, &header).await?;
    sqlx::query(&format!(
        "DELETE FROM {} WHERE seq<>0",
        table(job, &job.receipt_table)
    ))
    .execute(&mut *tx)
    .await?;
    sqlx::query(&format!("DROP TABLE {}", table(job, &job.stage_table)))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(header)
}
pub(in crate::core::transfer_jobs) async fn remove_staging(
    connection: &mut PgConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<()> {
    let mut tx = connection.begin().await?;
    let Some(header) = receipt::read_header(&mut tx, store, job).await? else {
        ensure!(
            catalog::relation_oid(&mut tx, &job.request.target.schema, &job.stage_table)
                .await?
                .is_none(),
            "unauthenticated PostgreSQL staging table cannot be removed"
        );
        tx.commit().await?;
        return Ok(());
    };
    ensure!(
        !header.published,
        "published PostgreSQL receipts cannot be cancelled"
    );
    sqlx::query(&format!(
        "LOCK TABLE {},{} IN ACCESS EXCLUSIVE MODE",
        table(job, &job.stage_table),
        table(job, &job.receipt_table)
    ))
    .execute(&mut *tx)
    .await?;
    receipt::validate_stage(&mut tx, job, &header).await?;
    sqlx::query(&format!(
        "DROP TABLE {},{}",
        table(job, &job.stage_table),
        table(job, &job.receipt_table)
    ))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}
