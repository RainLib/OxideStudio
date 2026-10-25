use anyhow::{ensure, Context, Result};
use sqlx::{mysql::MySqlDatabaseError, Connection, Executor, MySqlConnection, Row};
#[path = "mysql/jobs.rs"]
mod jobs;
#[path = "../../src/core/transfer_jobs/mysql/wire.rs"]
mod wire;

struct Engine {
    connection: MySqlConnection,
    url: String,
    schema: String,
}
impl Engine {
    async fn open() -> Result<Self> {
        Self::open_with_prefix("oxide_transfer_").await
    }
    async fn open_with_prefix(prefix: &str) -> Result<Self> {
        let url = std::env::var("TEST_MYSQL_URL").context("use the isolated native SQL fixture")?;
        let parsed = url::Url::parse(&url)?;
        ensure!(
            matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")),
            "isolated loopback MySQL is required"
        );
        let mut connection = MySqlConnection::connect(&url).await?;
        let schema = format!("{prefix}{}", uuid::Uuid::new_v4().simple());
        sqlx::query(&format!(
            "CREATE DATABASE `{schema}` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"
        ))
        .execute(&mut connection)
        .await?;
        Ok(Self {
            connection,
            url,
            schema,
        })
    }
    fn table(&self, name: &str) -> String {
        format!("`{}`.`{name}`", self.schema)
    }
    async fn close(mut self) -> Result<()> {
        sqlx::query(&format!("DROP DATABASE `{}`", self.schema))
            .execute(&mut self.connection)
            .await?;
        self.connection.close().await?;
        Ok(())
    }
}

#[tokio::test]
#[ignore = "explicit isolated MySQL engine contract; independent of durable job acceptance"]
async fn mysql_transfer_engine_contract() -> Result<()> {
    let mut engine = Engine::open().await?;
    let result = async {
        journal_and_lock_contract(&mut engine).await.context("MySQL journal/locking contract")?;
        native_transport_contract(&mut engine).await.context("MySQL native value transport contract")?;
        println!("MySQL engine contract: implicit DDL, atomic DML/receipt, gap locks, primary-key conflicts, exact values, timestamp offsets and source row budget passed");
        Ok(())
    }.await;
    engine.close().await?;
    result
}

async fn journal_and_lock_contract(engine: &mut Engine) -> Result<()> {
    let target = engine.table("target");
    let journal = engine.table("journal");
    sqlx::raw_sql(&format!("CREATE TABLE {target}(id bigint PRIMARY KEY,label varchar(32) UNIQUE,v varbinary(64)) ENGINE=InnoDB; INSERT INTO {target} VALUES(1,'A','baseline')")).execute(&mut engine.connection).await?;
    let mut tx = engine.connection.begin().await?;
    sqlx::query(&format!("UPDATE {target} SET v='implicit' WHERE id=1"))
        .execute(&mut *tx)
        .await?;
    sqlx::query(&format!("CREATE TABLE {journal}(kind tinyint unsigned,seq bigint unsigned,payload longblob,PRIMARY KEY(kind,seq)) ENGINE=InnoDB COMMENT='engine-contract-owned'")).execute(&mut *tx).await?;
    tx.rollback().await?;
    let value: Vec<u8> = sqlx::query_scalar(&format!("SELECT v FROM {target} WHERE id=1"))
        .fetch_one(&mut engine.connection)
        .await?;
    ensure!(value == b"implicit", "DDL must demonstrate its implicit commit before a production publication strategy is selected");
    let tag: String = sqlx::query_scalar("SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='journal'").bind(&engine.schema).fetch_one(&mut engine.connection).await?;
    ensure!(
        tag == "engine-contract-owned",
        "journal ownership marker is part of the single CREATE statement"
    );
    sqlx::raw_sql(&format!("UPDATE {target} SET v='baseline'; INSERT INTO {journal} VALUES(0,0,'prepared'),(1,1,'staged')")).execute(&mut engine.connection).await?;
    for commit in [false, true] {
        let mut tx = engine.connection.begin().await?;
        sqlx::query(&format!("UPDATE {target} SET v='published' WHERE id=1"))
            .execute(&mut *tx)
            .await?;
        sqlx::query(&format!(
            "UPDATE {journal} SET payload='published' WHERE kind=0 AND seq=0"
        ))
        .execute(&mut *tx)
        .await?;
        sqlx::query(&format!("DELETE FROM {journal} WHERE kind=1"))
            .execute(&mut *tx)
            .await?;
        if commit {
            tx.commit().await?;
        } else {
            tx.rollback().await?;
        }
        let value: Vec<u8> = sqlx::query_scalar(&format!("SELECT v FROM {target} WHERE id=1"))
            .fetch_one(&mut engine.connection)
            .await?;
        let header: Vec<u8> = sqlx::query_scalar(&format!(
            "SELECT payload FROM {journal} WHERE kind=0 AND seq=0"
        ))
        .fetch_one(&mut engine.connection)
        .await?;
        let staged: i64 =
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {journal} WHERE kind=1"))
                .fetch_one(&mut engine.connection)
                .await?;
        ensure!(
            if commit {
                value == b"published" && header == b"published" && staged == 0
            } else {
                value == b"baseline" && header == b"prepared" && staged == 1
            },
            "target, receipt and staged-row pruning must share one atomic transaction"
        );
    }
    let mut tx = engine.connection.begin().await?;
    sqlx::query(&format!("INSERT INTO {target} VALUES(2,'A','secondary-conflict') ON DUPLICATE KEY UPDATE v='wrong-primary-key'")).execute(&mut *tx).await?;
    let wrong_key: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM {target} WHERE id=1 AND v='wrong-primary-key'"
    ))
    .fetch_one(&mut *tx)
    .await?;
    ensure!(
        wrong_key == 1,
        "ON DUPLICATE KEY must be recognized as broader than primary-key upsert"
    );
    tx.rollback().await?;
    // A typed, session-private table validates source-key multiplicity with the
    // destination's actual types/collations before any original row is changed.
    let typed = engine.table("typed_incoming");
    sqlx::query(&format!("CREATE TEMPORARY TABLE {typed}(id bigint PRIMARY KEY,label varchar(32),v varbinary(64)) ENGINE=InnoDB")).execute(&mut engine.connection).await?;
    sqlx::query(&format!(
        "INSERT INTO {typed} VALUES(1,'A','matched-update'),(2,'A','secondary-conflict')"
    ))
    .execute(&mut engine.connection)
    .await?;
    let mut tx = engine.connection.begin().await?;
    sqlx::query(&format!(
        "UPDATE {target} t JOIN {typed} s ON t.id=s.id SET t.v=s.v"
    ))
    .execute(&mut *tx)
    .await?;
    let error = sqlx::query(&format!("INSERT INTO {target}(id,label,v) SELECT s.id,s.label,s.v FROM {typed} s LEFT JOIN {target} t ON t.id=s.id WHERE t.id IS NULL")).execute(&mut *tx).await.expect_err("secondary unique conflict must reject a new primary key");
    ensure!(
        error
            .as_database_error()
            .map(|error| error.downcast_ref::<MySqlDatabaseError>().number())
            == Some(1062),
        "primary-key publication must use actual uniqueness checks"
    );
    tx.rollback().await?;
    let original: Vec<u8> = sqlx::query_scalar(&format!("SELECT v FROM {target} WHERE id=1"))
        .fetch_one(&mut engine.connection)
        .await?;
    ensure!(
        original == b"published",
        "failed insert must roll back preceding primary-key updates"
    );
    let temporary_ddl = engine.table("temporary_ddl");
    let mut tx = engine.connection.begin().await?;
    sqlx::query(&format!("UPDATE {target} SET v='must-rollback' WHERE id=1"))
        .execute(&mut *tx)
        .await?;
    sqlx::query(&format!(
        "CREATE TEMPORARY TABLE {temporary_ddl}(id bigint) ENGINE=InnoDB"
    ))
    .execute(&mut *tx)
    .await?;
    tx.rollback().await?;
    let original: Vec<u8> = sqlx::query_scalar(&format!("SELECT v FROM {target} WHERE id=1"))
        .fetch_one(&mut engine.connection)
        .await?;
    ensure!(
        original == b"published",
        "temporary CREATE must not commit the publication transaction"
    );
    let mut peer = MySqlConnection::connect(&engine.url).await?;
    sqlx::query("SET SESSION innodb_lock_wait_timeout=1")
        .execute(&mut peer)
        .await?;
    sqlx::query("SET SESSION transaction_isolation='REPEATABLE-READ'")
        .execute(&mut engine.connection)
        .await?;
    sqlx::query("SET SESSION lock_wait_timeout=1")
        .execute(&mut peer)
        .await?;
    let mut metadata_tx = engine.connection.begin().await?;
    sqlx::query(&format!("SELECT 1 FROM {journal} LIMIT 0"))
        .execute(&mut *metadata_tx)
        .await?;
    let alteration = format!("ALTER TABLE {journal} ADD metadata_lock_probe INT NULL");
    let error = sqlx::query(&alteration)
        .execute(&mut peer)
        .await
        .expect_err("metadata lock must outlive a zero-row read until transaction completion");
    ensure!(
        error
            .as_database_error()
            .map(|error| error.downcast_ref::<MySqlDatabaseError>().number())
            == Some(1205),
        "expected metadata lock wait timeout before any journal DDL"
    );
    metadata_tx.rollback().await?;
    sqlx::query(&alteration).execute(&mut peer).await?;
    sqlx::query(&format!(
        "ALTER TABLE {journal} DROP COLUMN metadata_lock_probe"
    ))
    .execute(&mut peer)
    .await?;
    for table in [&target, &engine.table("empty_target")] {
        if table != &target {
            sqlx::query(&format!("CREATE TABLE {table}(v longblob) ENGINE=InnoDB"))
                .execute(&mut engine.connection)
                .await?;
        }
        let mut tx = engine.connection.begin().await?;
        sqlx::query(&format!(
            "SELECT SHA2(v,256) AS digest FROM {table} ORDER BY BINARY digest FOR UPDATE"
        ))
        .fetch_all(&mut *tx)
        .await?;
        let statement = if table == &target {
            format!("INSERT INTO {table} VALUES(3,'C','concurrent')")
        } else {
            format!("INSERT INTO {table} VALUES('concurrent')")
        };
        let error = sqlx::query(&statement)
            .execute(&mut peer)
            .await
            .expect_err("full-range locking must block concurrent insertions");
        ensure!(
            error
                .as_database_error()
                .map(|error| error.downcast_ref::<MySqlDatabaseError>().number())
                == Some(1205),
            "expected an actual InnoDB gap-lock wait timeout"
        );
        tx.rollback().await?;
        sqlx::query(&statement).execute(&mut peer).await?;
    }
    peer.close().await?;
    Ok(())
}

async fn native_transport_contract(engine: &mut Engine) -> Result<()> {
    let source = engine.table("typed_source");
    let target = engine.table("typed_target");
    sqlx::raw_sql(&format!("CREATE TABLE {source}(id int PRIMARY KEY,u bigint unsigned,d decimal(65,30),f double,b bit(64),raw varbinary(64),ts timestamp(6),dt datetime(6),tm time(6),latin varchar(32) CHARACTER SET latin1 COLLATE latin1_bin,utf varchar(32) CHARACTER SET utf8mb4,js json,g geometry SRID 4326) ENGINE=InnoDB; CREATE TABLE {target} LIKE {source}")).execute(&mut engine.connection).await?;
    sqlx::query("SET SESSION time_zone='+00:00'")
        .execute(&mut engine.connection)
        .await?;
    let decimal = "12345678901234567890123456789012345.123456789012345678901234567890";
    sqlx::query(&format!("INSERT INTO {source} VALUES(1,18446744073709551615,?,?,CAST(18446744073709551615 AS UNSIGNED),UNHEX('00ff010203'),'2026-11-01 08:30:00.123456','2026-10-22 03:04:05.123456','-838:58:59.123456',?,?,CAST(? AS JSON),ST_GeomFromText('POINT(30 10)',4326))"))
        .bind(decimal).bind(0.10000000000000002_f64).bind("café").bind("line\n\t\0中文").bind("{\"n\":18446744073709551615,\"s\":\"é\"}").execute(&mut engine.connection).await?;
    let row = sqlx::query(&format!("SELECT CAST(u AS CHAR) u,CAST(d AS CHAR) d,CAST(f AS DOUBLE) f,CAST(b AS UNSIGNED) b,raw,CAST(ts AS CHAR) ts,CAST(dt AS CHAR) dt,CAST(tm AS CHAR) tm,CONVERT(latin USING utf8mb4) latin,CONVERT(utf USING utf8mb4) utf,CAST(js AS CHAR CHARACTER SET utf8mb4) js,CONCAT(UNHEX(LPAD(HEX(ST_SRID(g)),8,'0')),ST_AsWKB(g)) g FROM {source}" )).fetch_one(&mut engine.connection).await?;
    let float: f64 = row.try_get("f")?;
    let mut cells = Vec::new();
    for field in [
        "u", "d", "f", "b", "raw", "ts", "dt", "tm", "latin", "utf", "js", "g",
    ] {
        cells.push(Some(match field {
            "f" => wire::float_bytes(float)?,
            "b" => row.try_get::<u64, _>(field)?.to_string().into_bytes(),
            "raw" | "g" => row.try_get::<Vec<u8>, _>(field)?,
            _ => row.try_get::<String, _>(field)?.into_bytes(),
        }));
    }
    let packet = wire::encode(&cells, 1024 * 1024)?;
    let cells = wire::decode(&packet, 12, 1024 * 1024)?;
    let mut content = wire::stage_hasher();
    wire::hash_row(&mut content, 1, &packet)?;
    let bytes = |index: usize| -> Result<&[u8]> {
        cells[index]
            .as_deref()
            .context("missing engine-contract cell")
    };
    let text = |index: usize| -> Result<&str> { Ok(std::str::from_utf8(bytes(index)?)?) };
    let geometry = bytes(11)?;
    ensure!(geometry.len() > 4, "geometry SRID/WKB framing");
    let srid = u32::from_be_bytes(geometry[..4].try_into()?);
    sqlx::query("SET SESSION time_zone='-07:00'")
        .execute(&mut engine.connection)
        .await?;
    sqlx::query(&format!("INSERT INTO {target} VALUES(1,?,?,?,CAST(? AS UNSIGNED),?,CONCAT(?,'+00:00'),?,?,?,?,CAST(? AS JSON),ST_GeomFromWKB(?,?))"))
        .bind(text(0)?).bind(text(1)?).bind(wire::float_value(bytes(2)?)?).bind(text(3)?).bind(bytes(4)?).bind(text(5)?).bind(text(6)?).bind(text(7)?).bind(text(8)?).bind(text(9)?).bind(text(10)?).bind(&geometry[4..]).bind(srid).execute(&mut engine.connection).await?;
    let warnings = engine.connection.fetch_all("SHOW WARNINGS").await?;
    ensure!(
        warnings.is_empty(),
        "native values must not require lossy conversion warnings"
    );
    sqlx::query("SET SESSION time_zone='+00:00'")
        .execute(&mut engine.connection)
        .await?;
    let equal: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {source} s JOIN {target} t USING(id) WHERE s.u=t.u AND s.d=t.d AND s.f=t.f AND s.b=t.b AND s.raw=t.raw AND s.ts=t.ts AND s.dt=t.dt AND s.tm=t.tm AND BINARY s.latin=BINARY t.latin AND BINARY s.utf=BINARY t.utf AND s.js=t.js AND ST_SRID(s.g)=ST_SRID(t.g) AND ST_AsWKB(s.g)=ST_AsWKB(t.g)")).fetch_one(&mut engine.connection).await?;
    let copied_float: f64 = sqlx::query_scalar(&format!("SELECT f FROM {target}"))
        .fetch_one(&mut engine.connection)
        .await?;
    ensure!(equal == 1 && copied_float.to_bits() == float.to_bits(), "integer/decimal/float bits, binary, temporal, charset, JSON and spatial values must round trip");
    for (index, value) in [-0.0, f64::MIN_POSITIVE, f64::from_bits(1), f64::MAX]
        .into_iter()
        .enumerate()
    {
        let id = 100 + index as i32;
        sqlx::query(&format!("INSERT INTO {source}(id,f) VALUES(?,?)"))
            .bind(id)
            .bind(value)
            .execute(&mut engine.connection)
            .await?;
        let original: f64 = sqlx::query_scalar(&format!("SELECT f FROM {source} WHERE id=?"))
            .bind(id)
            .fetch_one(&mut engine.connection)
            .await?;
        let frame = wire::encode(&[Some(wire::float_bytes(original)?)], 1024)?;
        let decoded = wire::decode(&frame, 1, 1024)?;
        let decoded = wire::float_value(decoded[0].as_deref().context("float edge cell")?)?;
        sqlx::query(&format!("INSERT INTO {target}(id,f) VALUES(?,?)"))
            .bind(id)
            .bind(decoded)
            .execute(&mut engine.connection)
            .await?;
        let copy: f64 = sqlx::query_scalar(&format!("SELECT f FROM {target} WHERE id=?"))
            .bind(id)
            .fetch_one(&mut engine.connection)
            .await?;
        ensure!(
            copy.to_bits() == original.to_bits(),
            "native float bits must survive extremes and subnormal values"
        );
    }
    let huge = engine.table("huge");
    sqlx::raw_sql(&format!("CREATE TABLE {huge}(v longblob) ENGINE=InnoDB; INSERT INTO {huge} VALUES(REPEAT('x',2097152))")).execute(&mut engine.connection).await?;
    let guarded = sqlx::query(&format!("SELECT CASE WHEN b.bytes<=1048576 THEN v.data ELSE NULL END AS data,b.bytes>1048576 AS oversized FROM {huge} s JOIN LATERAL(SELECT s.v AS data LIMIT 1) v ON TRUE JOIN LATERAL(SELECT OCTET_LENGTH(v.data) AS bytes LIMIT 1) b ON TRUE")).fetch_one(&mut engine.connection).await?;
    ensure!(
        guarded.try_get::<Option<Vec<u8>>, _>("data")?.is_none()
            && guarded.try_get::<i64, _>("oversized")? == 1,
        "LATERAL row guard must reject large values before transport"
    );
    Ok(())
}
