use super::{copy, journal, quote, session, table, wire};
use crate::core::transfer_jobs::{models::*, store::JobStore};
use anyhow::{ensure, Context, Result};
use sqlx::{Connection, MySql, MySqlConnection, QueryBuilder, Row};

fn typed(job: &StoredJob) -> String {
    quote(&format!("_oxide_typed_{}", job.summary.id.replace('-', "")))
}

pub(super) async fn create_typed(c: &mut MySqlConnection, job: &StoredJob) -> Result<()> {
    let plan = job.mysql()?;
    ensure!(
        plan.columns.len() == job.columns.len() && !job.columns.is_empty(),
        "MySQL type mapping is incomplete"
    );
    let mut definitions = job
        .columns
        .iter()
        .zip(&plan.columns)
        .map(|(column, info)| format!("{} {}", quote(&column.target), info.definition))
        .collect::<Vec<_>>();
    if job.request.mode == LargeTransferMode::Upsert {
        definitions.push(format!(
            "PRIMARY KEY({})",
            job.target_keys
                .iter()
                .map(|key| quote(key))
                .collect::<Vec<_>>()
                .join(",")
        ));
    }
    // A connection owns this temporary relation; it never carries defaults,
    // generated columns, auto-increment or target triggers.
    sqlx::query(&format!(
        "CREATE TEMPORARY TABLE {}({}) ENGINE=InnoDB ROW_FORMAT=DYNAMIC",
        typed(job),
        definitions.join(",")
    ))
    .execute(&mut *c)
    .await?;
    session::require_clean_diagnostics(c).await?;
    Ok(())
}

async fn materialize(c: &mut MySqlConnection, job: &StoredJob) -> Result<()> {
    let budget = super::packet_budget(c).await?;
    let limit = (60_000 / (2 * job.columns.len())).min(job.request.batch_rows as usize);
    let mut after = 0_u64;
    let fields = (0..job.columns.len())
        .map(|i| format!("c{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let sizes = (0..job.columns.len())
        .map(|i| format!("COALESCE(OCTET_LENGTH(c{i}),0)+4"))
        .collect::<Vec<_>>()
        .join("+");
    let projected = (0..job.columns.len())
        .map(|i| format!("CASE WHEN budget<={budget} THEN c{i} END c{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let names = job
        .columns
        .iter()
        .map(|column| quote(&column.target))
        .collect::<Vec<_>>()
        .join(",");
    while after < job.summary.source_rows {
        let sql = format!("SELECT seq,{projected},CAST(budget>{budget} AS SIGNED) over_budget FROM (SELECT seq,{fields},SUM(70+{sizes}) OVER(ORDER BY seq) budget FROM (SELECT seq,{fields} FROM {} WHERE kind=1 AND seq>? ORDER BY seq LIMIT {limit}) next_rows) sized ORDER BY seq", table(job, &job.receipt_table));
        let rows = sqlx::query(&sql).bind(after).fetch_all(&mut *c).await?;
        let mut payload = Vec::new();
        for row in rows {
            if row.try_get::<i64, _>("over_budget")? != 0 {
                break;
            }
            // The first cell can legitimately be NULL; the budget flag is
            // read separately below rather than interpreting NULL as a stop.
            let cells = (0..job.columns.len())
                .map(|i| row.try_get::<Option<Vec<u8>>, _>(i + 1))
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let seq: u64 = row.try_get("seq")?;
            payload.push((seq, cells));
        }
        // Fetching is bounded independently below using the real encoded size.
        // The SQL fence also prevents an altered oversized cell reaching us.
        let mut bytes = 0;
        let mut selected = Vec::new();
        for (seq, cells) in payload {
            let frame = wire::encode(&cells, MAX_ROW_BYTES as usize)?;
            if bytes + frame.len() + 64 > budget {
                break;
            }
            ensure!(
                seq == after + 1,
                "MySQL publication ordinal continuity changed"
            );
            bytes += frame.len() + 64;
            after = seq;
            selected.push(cells);
        }
        ensure!(
            !selected.is_empty(),
            "MySQL staged row exceeds publication packet budget"
        );
        let mut query =
            QueryBuilder::<MySql>::new(format!("INSERT INTO {}({names}) VALUES ", typed(job)));
        for (index, cells) in selected.iter().enumerate() {
            if index != 0 {
                query.push(",");
            }
            query.push("(");
            for (i, (cell, plan)) in cells.iter().zip(&job.mysql()?.columns).enumerate() {
                if i != 0 {
                    query.push(",");
                }
                let Some(value) = cell else {
                    query.push("NULL");
                    continue;
                };
                match plan.source_codec {
                    MySqlCodec::Float => {
                        query.push_bind(wire::float_value(value)?);
                    }
                    MySqlCodec::Bit => {
                        query.push_bind(std::str::from_utf8(value)?.parse::<u64>()?);
                    }
                    MySqlCodec::Binary => {
                        query.push_bind(value.as_slice());
                    }
                    MySqlCodec::Geometry => {
                        ensure!(value.len() >= 9, "invalid MySQL geometry frame");
                        let srid = u32::from_be_bytes(value[..4].try_into()?);
                        query
                            .push("ST_GeomFromWKB(")
                            .push_bind(&value[4..])
                            .push(",")
                            .push_bind(srid)
                            .push(")");
                    }
                    MySqlCodec::Timestamp => {
                        let text = std::str::from_utf8(value)?;
                        if text.starts_with("0000-") {
                            query.push_bind(text);
                        } else {
                            query.push("CONCAT(").push_bind(text).push(",'+00:00')");
                        }
                    }
                    MySqlCodec::Text => {
                        query.push_bind(std::str::from_utf8(value)?);
                    }
                }
            }
            query.push(")");
        }
        query.build().persistent(false).execute(&mut *c).await?;
        session::require_clean_diagnostics(c).await?;
    }
    Ok(())
}

// Preserve the timestamp instant while original-session defaults and triggers
// still see their native time zone, including ambiguous DST wall times.
fn expression(job: &StoredJob, index: usize) -> String {
    let name = format!("s.{}", quote(&job.columns[index].target));
    if job
        .mysql
        .as_ref()
        .is_some_and(|plan| plan.columns[index].target_codec == MySqlCodec::Timestamp)
    {
        // Obtain UTC calendar seconds and stored fractions separately, and
        // keep every non-NULL CASE branch textual until target assignment.
        format!("CASE WHEN {name} IS NULL THEN NULL WHEN CAST({name} AS CHAR) LIKE '0000-%' THEN CAST({name} AS CHAR) ELSE CONCAT(DATE_FORMAT(CAST({name} AT TIME ZONE '+00:00' AS DATETIME),'%Y-%m-%d %H:%i:%s'),'.',LPAD(MICROSECOND({name}),6,'0'),'+00:00') END")
    } else {
        name
    }
}

pub(in crate::core::transfer_jobs) async fn publish(
    c: &mut MySqlConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<Header> {
    create_typed(c, job).await?;
    let mut tx = c.begin().await?;
    copy::baseline(&mut tx, job, true).await?;
    journal::lock(&mut tx, job).await?;
    let last = journal::validate_all(&mut tx, store, job).await?;
    ensure!(
        last.as_ref().map_or(0, |r| r.rows_after) == job.summary.source_rows,
        "MySQL transfer is not fully staged"
    );
    session::native_write(&mut tx).await?;
    materialize(&mut tx, job).await?;
    let target = table(job, &job.request.target.table);
    if job.request.mode == LargeTransferMode::Overwrite {
        sqlx::query(&format!("DELETE FROM {target}"))
            .execute(&mut *tx)
            .await?;
        session::require_clean_diagnostics(&mut tx).await?;
    }
    let names = job
        .columns
        .iter()
        .map(|column| quote(&column.target))
        .collect::<Vec<_>>()
        .join(",");
    let values = (0..job.columns.len())
        .map(|i| expression(job, i))
        .collect::<Vec<_>>()
        .join(",");
    let mut insert = format!(
        "INSERT INTO {target}({names}) SELECT {values} FROM {} s",
        typed(job)
    );
    if job.request.mode == LargeTransferMode::Upsert {
        let join = job
            .target_keys
            .iter()
            .map(|key| format!("t.{}=s.{}", quote(key), quote(key)))
            .collect::<Vec<_>>()
            .join(" AND ");
        let updates = job
            .columns
            .iter()
            .enumerate()
            .filter(|(_, column)| !job.target_keys.contains(&column.target))
            .map(|(i, column)| format!("t.{}={}", quote(&column.target), expression(job, i)))
            .collect::<Vec<_>>();
        if !updates.is_empty() {
            sqlx::query(&format!(
                "UPDATE {target} t JOIN {} s ON {join} SET {}",
                typed(job),
                updates.join(",")
            ))
            .execute(&mut *tx)
            .await?;
            session::require_clean_diagnostics(&mut tx).await?;
        }
        insert.push_str(&format!(
            " LEFT JOIN {target} t ON {join} WHERE t.{} IS NULL",
            quote(&job.target_keys[0])
        ));
    }
    sqlx::query(&insert).execute(&mut *tx).await?;
    session::require_clean_diagnostics(&mut tx).await?;
    session::normalize(&mut tx).await?;
    let expected = match job.request.mode {
        LargeTransferMode::Append => Some(
            job.target_rows_before
                .checked_add(job.summary.source_rows)
                .context("MySQL target row count overflow")?,
        ),
        LargeTransferMode::Overwrite => Some(job.summary.source_rows),
        LargeTransferMode::Upsert => None,
    };
    if let Some(expected) = expected {
        let actual: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {target}"))
            .fetch_one(&mut *tx)
            .await?;
        ensure!(
            u64::try_from(actual)? == expected,
            "MySQL publication row count changed"
        );
    }
    let mut header = journal::read_header(&mut tx, store, job)
        .await?
        .context("MySQL journal header missing")?;
    header.published = true;
    header.rows = job.summary.source_rows;
    header.batches = last.map_or(0, |r| r.sequence);
    journal::write_header(&mut tx, store, job, &header).await?;
    // DML cleanup and the final receipt commit together with the original data.
    sqlx::query(&format!(
        "DELETE FROM {} WHERE kind<>0",
        table(job, &job.receipt_table)
    ))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(header)
}

pub(in crate::core::transfer_jobs) async fn remove_staging(
    c: &mut MySqlConnection,
    store: &JobStore,
    job: &StoredJob,
) -> Result<()> {
    if !journal::exists(c, job).await? {
        return Ok(());
    }
    journal::owned_shape(c, store, job).await?;
    if let Some(header) = journal::read_header(c, store, job).await? {
        ensure!(
            !header.published,
            "published MySQL receipts cannot be cancelled"
        );
    }
    sqlx::query(&format!("DROP TABLE {}", table(job, &job.receipt_table)))
        .execute(c)
        .await?;
    Ok(())
}
