//! Publish variable-shape file rows without evaluating defaults in a snapshot.
//! The caller holds the publication transaction and has authenticated receipts.
use super::quote;
use crate::core::transfer_jobs::models::{StoredJob, BATCH_BYTES, MAX_ROW_BYTES};
use anyhow::{bail, Context, Result};
use sqlx::{
    sqlite::{SqliteArguments, SqliteRow},
    Arguments, Row, SqliteConnection, TypeInfo, ValueRef,
};

fn add_value(arguments: &mut SqliteArguments<'_>, row: &SqliteRow, index: usize) -> Result<()> {
    let raw = row.try_get_raw(index)?;
    if raw.is_null() {
        arguments.add(Option::<String>::None)
    } else {
        match raw.type_info().name().to_ascii_uppercase().as_str() {
            "INTEGER" | "BOOLEAN" => arguments.add(row.try_get_unchecked::<i64, _>(index)?),
            "REAL" | "FLOAT" | "DOUBLE" => arguments.add(row.try_get_unchecked::<f64, _>(index)?),
            "BLOB" => arguments.add(row.try_get_unchecked::<Vec<u8>, _>(index)?),
            _ => arguments.add(row.try_get_unchecked::<String, _>(index)?),
        }
    }
    .map_err(|_| anyhow::anyhow!("invalid file publication parameter"))
}

pub(super) async fn publish_rows(connection: &mut SqliteConnection, job: &StoredJob) -> Result<()> {
    let plan = job
        .file_import
        .as_ref()
        .context("missing file import plan")?;
    let mask_name = plan
        .presence_column
        .as_deref()
        .context("missing presence column")?;
    let mask_index = job
        .columns
        .iter()
        .position(|c| c.target == mask_name)
        .context("missing staged presence column")?
        + 1;
    let indices = plan
        .columns
        .iter()
        .map(|column| {
            job.columns
                .iter()
                .position(|c| c.target.eq_ignore_ascii_case(&column.target))
                .map(|i| i + 1)
                .context("file mapping is not staged")
        })
        .collect::<Result<Vec<_>>>()?;
    let fields = std::iter::once(quote(&job.sequence_column))
        .chain(job.columns.iter().map(|c| quote(&c.target)))
        .collect::<Vec<_>>()
        .join(",");
    let size = job
        .columns
        .iter()
        .map(|c| format!("COALESCE(octet_length({}),0)+32", quote(&c.target)))
        .collect::<Vec<_>>()
        .join("+");
    let metadata_sql = format!(
        "SELECT {},({size}) FROM {} WHERE {}>? ORDER BY {} LIMIT 500",
        quote(&job.sequence_column),
        quote(&job.stage_table),
        quote(&job.sequence_column),
        quote(&job.sequence_column)
    );
    let rows_sql = format!(
        "SELECT {fields} FROM {} WHERE {}>? AND {}<=? ORDER BY {}",
        quote(&job.stage_table),
        quote(&job.sequence_column),
        quote(&job.sequence_column),
        quote(&job.sequence_column)
    );
    let mut previous = 0_i64;
    let mut published = 0_u64;
    // Keep only the last shape. Many unique field subsets cannot grow a cache.
    let mut cached = None::<(Vec<u8>, String, Vec<usize>)>;
    loop {
        let metadata: Vec<(i64, i64)> = sqlx::query_as(&metadata_sql)
            .bind(previous)
            .fetch_all(&mut *connection)
            .await?;
        if metadata.is_empty() {
            break;
        }
        let mut bytes = 0_u64;
        let mut end = previous;
        for (sequence, length) in metadata {
            let length = u64::try_from(length)?;
            if length > MAX_ROW_BYTES {
                bail!("file publication row exceeds its byte budget");
            }
            if end != previous && bytes + length > BATCH_BYTES {
                break;
            }
            if sequence <= end {
                bail!("file publication order is invalid");
            }
            bytes += length;
            end = sequence;
        }
        let rows = sqlx::query(&rows_sql)
            .bind(previous)
            .bind(end)
            .fetch_all(&mut *connection)
            .await?;
        for row in rows {
            let sequence: i64 = row.try_get_unchecked(0)?;
            if sequence != i64::try_from(published + 1)? {
                bail!("file publication sequence has a gap");
            }
            let raw = row.try_get_raw(mask_index)?;
            if raw.is_null() || raw.type_info().name() != "BLOB" {
                bail!("file presence bitmap is not binary");
            }
            let mask: Vec<u8> = row.try_get_unchecked(mask_index)?;
            if mask.len() != plan.presence_bytes()
                || plan.columns.len() % 8 != 0
                    && mask
                        .last()
                        .is_some_and(|last| last >> (plan.columns.len() % 8) != 0)
            {
                bail!("file presence bitmap is invalid");
            }
            for (index, staged) in indices.iter().enumerate() {
                if mask[index / 8] & (1 << (index % 8)) == 0 && !row.try_get_raw(*staged)?.is_null()
                {
                    bail!("omitted file field contains an unexpected value");
                }
            }
            if cached.as_ref().is_none_or(|(last, _, _)| last != &mask) {
                let selected = indices
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| mask[*i / 8] & (1 << (*i % 8)) != 0)
                    .map(|(i, staged)| (i, *staged))
                    .collect::<Vec<_>>();
                let sql = if selected.is_empty() {
                    format!(
                        "INSERT INTO {} DEFAULT VALUES",
                        quote(&job.request.target.table)
                    )
                } else {
                    format!(
                        "INSERT INTO {} ({}) VALUES ({})",
                        quote(&job.request.target.table),
                        selected
                            .iter()
                            .map(|(i, _)| quote(&plan.columns[*i].target))
                            .collect::<Vec<_>>()
                            .join(","),
                        vec!["?"; selected.len()].join(",")
                    )
                };
                cached = Some((
                    mask,
                    sql,
                    selected.into_iter().map(|(_, staged)| staged).collect(),
                ));
            }
            let (_, sql, selected) = cached.as_ref().context("missing file publication shape")?;
            let mut arguments = SqliteArguments::default();
            for index in selected {
                add_value(&mut arguments, &row, *index)?;
            }
            sqlx::query_with(sql, arguments)
                .persistent(false)
                .execute(&mut *connection)
                .await?;
            published += 1;
        }
        previous = end;
    }
    if published != job.summary.source_rows {
        bail!("file publication row count is inconsistent");
    }
    Ok(())
}
