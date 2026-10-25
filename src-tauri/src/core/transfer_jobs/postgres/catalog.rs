use super::{quote, relation};
use crate::core::transfer_jobs::models::*;
use anyhow::{bail, ensure, Context, Result};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Row};

pub(super) struct Column {
    pub name: String,
    pub display_type: String,
    pub cast_type: PostgresType,
    pub output_schema: String,
    pub output_name: String,
    pub required: bool,
    pub default: bool,
    pub identity: bool,
    pub generated: bool,
    pub key_order: i64,
}
impl Column {
    pub fn output(&self) -> String {
        let name = format!("{}.{}", quote("_oxide_source"), quote(&self.name));
        format!(
            "CASE WHEN {name} IS NULL THEN NULL ELSE pg_catalog.textin({}({name})) END",
            relation(&self.output_schema, &self.output_name)
        )
    }
}
pub(super) struct Table {
    pub oid: i64,
    pub database_oid: i64,
    pub database_name: String,
    pub server: String,
    pub columns: Vec<Column>,
}

pub(super) async fn inspect(
    connection: &mut PgConnection,
    schema: &str,
    table: &str,
) -> Result<Table> {
    let row = sqlx::query("SELECT c.oid::bigint AS oid,c.relkind::text AS kind,c.relpersistence::text AS persistence,pg_catalog.row_security_active(c.oid) AS rls,d.oid::bigint AS database_oid,d.datname::text AS database_name,COALESCE(inet_server_addr()::text,'')||':'||COALESCE(inet_server_port()::text,'')||':'||pg_postmaster_start_time()::text AS server FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_catalog.pg_database d WHERE n.nspname::text=$1 AND c.relname::text=$2 AND d.datname=current_database()")
        .bind(schema).bind(table).fetch_optional(&mut *connection).await?.context("migration relation is unavailable")?;
    ensure!(
        matches!(row.try_get::<&str, _>("kind")?, "r" | "p")
            && row.try_get::<&str, _>("persistence")? == "p",
        "PostgreSQL migration requires a persistent ordinary or partitioned table"
    );
    ensure!(
        !row.try_get::<bool, _>("rls")?,
        "full transfer cannot use an active row-security policy"
    );
    let oid = row.try_get("oid")?;
    let rows = sqlx::query("SELECT a.attname::text AS name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS display_type,tn.nspname::text AS type_schema,t.typname::text AS type_name,pn.nspname::text AS output_schema,p.proname::text AS output_name,a.attnotnull AS required,ad.oid IS NOT NULL AS has_default,a.attidentity::text AS identity,a.attgenerated::text AS generated,COALESCE(array_position(pk.conkey,a.attnum)::bigint,0) AS key_order FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid JOIN pg_catalog.pg_namespace tn ON tn.oid=t.typnamespace JOIN pg_catalog.pg_proc p ON p.oid=t.typoutput JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum LEFT JOIN pg_catalog.pg_constraint pk ON pk.conrelid=a.attrelid AND pk.contype='p' WHERE a.attrelid=$1::bigint::oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT 513")
        .bind(oid).fetch_all(&mut *connection).await?;
    ensure!(
        !rows.is_empty() && rows.len() <= 512,
        "PostgreSQL migration column count exceeds its budget"
    );
    let columns = rows
        .into_iter()
        .map(|r| {
            Ok(Column {
                name: r.try_get("name")?,
                display_type: r.try_get("display_type")?,
                cast_type: PostgresType {
                    schema: r.try_get("type_schema")?,
                    name: r.try_get("type_name")?,
                },
                output_schema: r.try_get("output_schema")?,
                output_name: r.try_get("output_name")?,
                required: r.try_get("required")?,
                default: r.try_get("has_default")?,
                identity: !r.try_get::<&str, _>("identity")?.is_empty(),
                generated: !r.try_get::<&str, _>("generated")?.is_empty(),
                key_order: r.try_get("key_order")?,
            })
        })
        .collect::<Result<_>>()?;
    Ok(Table {
        oid,
        database_oid: row.try_get("database_oid")?,
        database_name: row.try_get("database_name")?,
        server: row.try_get("server")?,
        columns,
    })
}

pub(super) async fn schema_digest(connection: &mut PgConnection, oid: i64) -> Result<String> {
    let body: Option<String> = sqlx::query_scalar(include_str!("schema.sql"))
        .bind(oid)
        .fetch_one(connection)
        .await?;
    let body = body.context("PostgreSQL migration schema exceeds its metadata budget")?;
    Ok(format!("{:x}", Sha256::digest(body.as_bytes())))
}
pub(super) async fn relation_oid(
    connection: &mut PgConnection,
    schema: &str,
    name: &str,
) -> Result<Option<i64>> {
    Ok(sqlx::query_scalar("SELECT c.oid::bigint FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname::text=$1 AND c.relname::text=$2 AND c.relkind='r' AND c.relpersistence='p'")
        .bind(schema).bind(name).fetch_optional(connection).await?)
}
pub(super) async fn validate_target(connection: &mut PgConnection, job: &StoredJob) -> Result<()> {
    let target = inspect(
        connection,
        &job.request.target.schema,
        &job.request.target.table,
    )
    .await?;
    let plan = job.postgres()?;
    ensure!(
        target.database_oid == plan.database_oid
            && target.oid == plan.target_oid
            && schema_digest(connection, target.oid).await? == job.target_schema_digest,
        "PostgreSQL migration target identity or schema changed"
    );
    Ok(())
}

pub(super) fn map_columns(
    job: &mut StoredJob,
    source: &Table,
    target: &Table,
) -> Result<Vec<String>> {
    let mut expressions = Vec::new();
    let mut assigned = std::collections::HashSet::new();
    let mut types = Vec::new();
    job.columns.clear();
    job.skipped_columns.clear();
    for column in &target.columns {
        let matched = source
            .columns
            .iter()
            .find(|c| c.name == column.name)
            .or_else(|| {
                let candidates = source
                    .columns
                    .iter()
                    .filter(|c| c.name.eq_ignore_ascii_case(&column.name))
                    .collect::<Vec<_>>();
                (candidates.len() == 1).then(|| candidates[0])
            });
        if column.generated {
            if let Some(src) = matched {
                assigned.insert(src.name.clone());
                job.skipped_columns.push(src.name.clone());
            }
            continue;
        }
        if let Some(src) = matched {
            ensure!(
                assigned.insert(src.name.clone()),
                "source column mapping is ambiguous"
            );
            expressions.push(src.output());
            types.push(column.cast_type.clone());
            job.columns.push(LargeTransferColumn {
                source: src.name.clone(),
                target: column.name.clone(),
                source_type: src.display_type.clone(),
                target_type: column.display_type.clone(),
            });
        } else if column.required && !column.default && !column.identity {
            bail!("required PostgreSQL column has no source mapping or default");
        }
    }
    for column in &source.columns {
        if !assigned.contains(&column.name) {
            if column.generated {
                job.skipped_columns.push(column.name.clone());
            } else {
                bail!("source column is absent or ambiguous in the target mapping");
            }
        }
    }
    ensure!(
        !expressions.is_empty(),
        "migration has no writable mapped columns"
    );
    let mut keys = target
        .columns
        .iter()
        .filter(|c| c.key_order > 0)
        .collect::<Vec<_>>();
    keys.sort_by_key(|c| c.key_order);
    job.target_keys = keys.iter().map(|c| c.name.clone()).collect();
    if job.request.mode == LargeTransferMode::Upsert {
        ensure!(
            !job.target_keys.is_empty()
                && job
                    .target_keys
                    .iter()
                    .all(|k| job.columns.iter().any(|c| &c.target == k)),
            "upsert requires every primary key in the mapping"
        );
    }
    let plan = job.postgres.as_mut().context("missing PostgreSQL plan")?;
    plan.database_oid = target.database_oid;
    plan.target_oid = target.oid;
    plan.target_types = types;
    plan.has_identity = target
        .columns
        .iter()
        .any(|c| c.identity && job.columns.iter().any(|m| m.target == c.name));
    Ok(expressions)
}

pub(super) async fn sequences(
    connection: &mut PgConnection,
    job: &StoredJob,
) -> Result<Vec<PostgresSequence>> {
    let rows=sqlx::query("SELECT sn.nspname::text AS schema,s.relname::text AS name,a.attname::text AS column,q.seqincrement,q.seqmin,q.seqmax,pg_catalog.pg_has_role(current_user,s.relowner,'USAGE') AS may_alter FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_class s ON s.oid=d.objid AND s.relkind='S' JOIN pg_catalog.pg_namespace sn ON sn.oid=s.relnamespace JOIN pg_catalog.pg_sequence q ON q.seqrelid=s.oid JOIN pg_catalog.pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid WHERE d.classid='pg_catalog.pg_class'::regclass AND d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjid=$1::bigint::oid AND d.deptype IN ('a','i') ORDER BY s.oid")
        .bind(job.postgres()?.target_oid).fetch_all(connection).await?;
    let mut result = Vec::new();
    for row in rows {
        let column: String = row.try_get("column")?;
        if !job.columns.iter().any(|c| c.target == column) {
            continue;
        }
        ensure!(
            row.try_get::<bool, _>("may_alter")?,
            "preserving identity values requires permission to restart the owned target sequence"
        );
        result.push(PostgresSequence {
            schema: row.try_get("schema")?,
            name: row.try_get("name")?,
            column,
            increment: row.try_get("seqincrement")?,
            minimum: row.try_get("seqmin")?,
            maximum: row.try_get("seqmax")?,
        });
    }
    Ok(result)
}
