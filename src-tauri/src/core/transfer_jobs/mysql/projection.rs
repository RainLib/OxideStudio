use super::{catalog::Table, quote, relation, wire};
use crate::core::transfer_jobs::models::*;
use anyhow::{ensure, Context, Result};
use futures::TryStreamExt;
use sha2::{Digest, Sha256};
use sqlx::{mysql::MySqlRow, MySqlConnection, Row};

pub(super) fn source_query(table: &Table, indices: &[usize], budget: usize) -> String {
    let expressions = indices
        .iter()
        .enumerate()
        .map(|(i, index)| {
            let column = &table.columns[*index];
            let name = format!("s.{}", quote(&column.name));
            let value = match column.codec {
                MySqlCodec::Float => format!("CAST({name} AS DOUBLE)"),
                MySqlCodec::Bit => format!("CAST({name} AS UNSIGNED)"),
                MySqlCodec::Binary => format!("CAST({name} AS BINARY)"),
                MySqlCodec::Geometry => {
                    format!("CONCAT(UNHEX(LPAD(HEX(ST_SRID({name})),8,'0')),ST_AsWKB({name}))")
                }
                _ => format!("CAST(CAST({name} AS CHAR CHARACTER SET utf8mb4) AS BINARY)"),
            };
            format!("{value} AS c{i}")
        })
        .collect::<Vec<_>>()
        .join(",");
    let sizes = indices
        .iter()
        .enumerate()
        .map(|(i, index)| match table.columns[*index].codec {
            MySqlCodec::Float => "12".into(),
            MySqlCodec::Bit => "24".into(),
            _ => format!("COALESCE(OCTET_LENGTH(v.c{i}),0)+4"),
        })
        .collect::<Vec<String>>()
        .join("+");
    let fields = (0..indices.len())
        .map(|i| format!("CASE WHEN b.bytes<={budget} THEN v.c{i} ELSE NULL END AS c{i}"))
        .collect::<Vec<_>>()
        .join(",");
    format!("SELECT {fields},CAST(b.bytes>{budget} AS SIGNED) oversized FROM {} s JOIN LATERAL(SELECT {expressions} LIMIT 1) v ON TRUE JOIN LATERAL(SELECT 6+{sizes} AS bytes LIMIT 1) b ON TRUE",relation(&table.schema,&table.name))
}
pub(super) fn source_cells(row: &MySqlRow, codecs: &[MySqlCodec]) -> Result<Vec<Option<Vec<u8>>>> {
    ensure!(
        row.try_get::<i64, _>("oversized")? == 0,
        "MySQL source row exceeds the transfer budget"
    );
    codecs
        .iter()
        .enumerate()
        .map(|(i, codec)| {
            Ok(match codec {
                MySqlCodec::Float => row
                    .try_get::<Option<f64>, _>(i)?
                    .map(wire::float_bytes)
                    .transpose()?,
                MySqlCodec::Bit => row
                    .try_get::<Option<u64>, _>(i)?
                    .map(|v| v.to_string().into_bytes()),
                _ => row.try_get::<Option<Vec<u8>>, _>(i)?,
            })
        })
        .collect()
}
pub(super) async fn data_digest(
    c: &mut MySqlConnection,
    table: &Table,
    lock: bool,
) -> Result<(u64, String)> {
    let columns = table
        .columns
        .iter()
        .map(|column| {
            let name = format!("s.{}", quote(&column.name));
            format!("IF({name} IS NULL,'N',CONCAT('V',SHA2(CAST({name} AS BINARY),256)))")
        })
        .collect::<Vec<_>>()
        .join(",");
    let floats = table
        .columns
        .iter()
        .filter(|column| column.codec == MySqlCodec::Float)
        .map(|column| format!("CAST(s.{} AS DOUBLE)", quote(&column.name)))
        .collect::<Vec<_>>();
    let extra = if floats.is_empty() {
        String::new()
    } else {
        format!(",{}", floats.join(","))
    };
    let sql=format!("SELECT SHA2(CONCAT({columns}),256) digest{extra} FROM {} s ORDER BY CAST(digest AS BINARY){extra}{}",relation(&table.schema,&table.name),if lock{" FOR UPDATE"}else{""});
    let mut stream = sqlx::query(&sql).fetch(c);
    let mut count = 0_u64;
    let mut digest = Sha256::new();
    while let Some(row) = stream.try_next().await? {
        let hash: Option<String> = row.try_get("digest")?;
        let hash = hash.context("MySQL target fingerprint could not be computed")?;
        ensure!(hash.len() == 64, "invalid MySQL row fingerprint");
        count = count.checked_add(1).context("MySQL row count overflow")?;
        digest.update(hash.as_bytes());
        for i in 0..floats.len() {
            match row.try_get::<Option<f64>, _>(i + 1)? {
                None => digest.update(b"N"),
                Some(value) => {
                    digest.update(b"V");
                    digest.update(wire::float_bytes(value)?);
                }
            }
        }
        digest.update(b"\n");
    }
    Ok((count, format!("{:x}", digest.finalize())))
}
