use super::{quote, relation};
use crate::core::transfer_jobs::models::MAX_ROW_BYTES;
use anyhow::{ensure, Result};
use futures::TryStreamExt;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row};

#[derive(Default)]
pub(super) struct Lines {
    tail: Vec<u8>,
}
impl Lines {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Vec<u8>>> {
        let mut result = Vec::new();
        let mut start = 0;
        for (end, byte) in chunk.iter().enumerate() {
            if *byte != b'\n' {
                continue;
            }
            ensure!(
                self.tail.len() + end - start < MAX_ROW_BYTES as usize,
                "PostgreSQL COPY row exceeds its wire budget"
            );
            self.tail.extend_from_slice(&chunk[start..=end]);
            result.push(std::mem::take(&mut self.tail));
            start = end + 1;
        }
        ensure!(
            self.tail.len() + chunk.len() - start <= MAX_ROW_BYTES as usize,
            "PostgreSQL COPY row exceeds its wire budget"
        );
        self.tail.extend_from_slice(&chunk[start..]);
        Ok(result)
    }
    pub fn finish(self) -> Result<()> {
        ensure!(self.tail.is_empty(), "PostgreSQL COPY ended inside a row");
        Ok(())
    }
}

pub(super) async fn data_digest(connection: &mut PgConnection, oid: i64) -> Result<(u64, String)> {
    let relations=sqlx::query("WITH RECURSIVE tree(oid) AS (SELECT $1::bigint::oid UNION SELECT i.inhrelid FROM pg_catalog.pg_inherits i JOIN tree t ON i.inhparent=t.oid) SELECT c.oid::bigint AS oid,n.nspname::text AS schema,c.relname::text AS name,pg_catalog.row_security_active(c.oid) AS rls FROM tree t JOIN pg_catalog.pg_class c ON c.oid=t.oid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' ORDER BY c.oid LIMIT 1025")
        .bind(oid).fetch_all(&mut *connection).await?;
    ensure!(
        relations.len() <= 1024,
        "PostgreSQL table tree exceeds its metadata budget"
    );
    let selects=relations.iter().map(|r| -> Result<_> {
        let oid:i64=r.try_get("oid")?;
        ensure!(!r.try_get::<bool,_>("rls")?,"full transfer cannot fingerprint a child with active row security");
        Ok(format!("SELECT '{oid}:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.textin(pg_catalog.record_out(t)),'UTF8')),'hex') AS hash FROM ONLY {} t",relation(r.try_get("schema")?,r.try_get("name")?)))
    }).collect::<Result<Vec<_>>>()?;
    let select = if selects.is_empty() {
        "SELECT ''::text AS hash WHERE false".into()
    } else {
        selects.join(" UNION ALL ")
    };
    let sql=format!("COPY (SELECT hash FROM ({select}) fingerprints ORDER BY hash COLLATE pg_catalog.\"C\") TO STDOUT WITH (FORMAT text,ENCODING 'UTF8')");
    super::session::native_path(connection).await?;
    let mut stream = connection.copy_out_raw(&sql).await?;
    let mut digest = Sha256::new();
    let mut rows = 0_u64;
    while let Some(chunk) = stream.try_next().await? {
        rows += chunk.iter().filter(|b| **b == b'\n').count() as u64;
        digest.update(&chunk);
    }
    drop(stream);
    super::session::normalize(connection).await?;
    Ok((rows, format!("{:x}", digest.finalize())))
}

pub(super) async fn stage_digest(
    connection: &mut PgConnection,
    job: &super::StoredJob,
    after: u64,
    through: u64,
) -> Result<String> {
    let stage = super::table(job, &job.stage_table);
    let seq = quote(&job.sequence_column);
    let size = job
        .columns
        .iter()
        .map(|c| format!("COALESCE(octet_length({}),0)::bigint*2+4", quote(&c.target)))
        .collect::<Vec<_>>()
        .join("+");
    let oversized:bool=sqlx::query_scalar(&format!("SELECT EXISTS(SELECT 1 FROM {stage} WHERE {seq}>$1 AND {seq}<=$2 AND ({size})>{MAX_ROW_BYTES})"))
        .bind(i64::try_from(after)?).bind(i64::try_from(through)?).fetch_one(&mut *connection).await?;
    ensure!(
        !oversized,
        "PostgreSQL migration staging row exceeds its budget"
    );
    let fields = std::iter::once(seq.clone())
        .chain(job.columns.iter().map(|c| quote(&c.target)))
        .collect::<Vec<_>>()
        .join(",");
    let sql=format!("COPY (SELECT {fields} FROM {stage} WHERE {seq}>{after} AND {seq}<={through} ORDER BY {seq}) TO STDOUT WITH (FORMAT text,ENCODING 'UTF8')");
    let mut stream = connection.copy_out_raw(&sql).await?;
    let mut digest = Sha256::new();
    let mut rows = 0_u64;
    while let Some(chunk) = stream.try_next().await? {
        rows += chunk.iter().filter(|b| **b == b'\n').count() as u64;
        digest.update(&chunk);
    }
    ensure!(
        rows == through - after,
        "PostgreSQL migration staging row count changed"
    );
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copy_framing_preserves_escaped_separators_nulls_and_chunk_boundaries() -> Result<()> {
        let wire = b"1\t\\N\t\\\\N\tline\\nnext\\tcolumn\n2\tempty\t\t\\\\x00ff\n";
        for width in 1..wire.len() {
            let mut lines = Lines::default();
            let mut actual = Vec::new();
            for chunk in wire.chunks(width) {
                actual.extend(lines.push(chunk)?);
            }
            lines.finish()?;
            assert_eq!(actual.concat(), wire);
            assert_eq!(actual.len(), 2);
        }
        let mut broken = Lines::default();
        broken.push(b"incomplete")?;
        assert!(broken.finish().is_err());
        let mut huge = Lines::default();
        assert!(huge.push(&vec![b'a'; MAX_ROW_BYTES as usize + 1]).is_err());
        Ok(())
    }
}
