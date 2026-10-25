use super::*;
use anyhow::{ensure, Context};
use sqlx::PgConnection;
use tokio::net::{TcpListener, TcpStream};
#[path = "postgres/process.rs"]
mod process;

struct PgFixture {
    root: tempfile::TempDir,
    metadata: MetaStore,
    jobs: LargeTransferJobs,
    admin: PgConnection,
    schema: String,
    proxy: Option<tokio::task::JoinHandle<()>>,
    proxy_port: u16,
    target_url: String,
}
impl PgFixture {
    async fn new(rows: u32) -> Result<Self> {
        let target_url =
            std::env::var("TEST_POSTGRES_URL").context("use the isolated native SQL fixture")?;
        let url = url::Url::parse(&target_url)?;
        ensure!(
            matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")),
            "native transfer acceptance requires an isolated loopback server"
        );
        let host = url.host_str().unwrap().trim_matches(['[', ']']).to_string();
        let port = url.port().unwrap_or(5432);
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let proxy_port = listener.local_addr()?.port();
        let proxy = tokio::spawn(async move {
            while let Ok((mut client, _)) = listener.accept().await {
                let host = host.clone();
                tokio::spawn(async move {
                    if let Ok(mut server) = TcpStream::connect((host.as_str(), port)).await {
                        let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
                    }
                });
            }
        });
        let mut source_url = url;
        source_url.set_host(Some("127.0.0.1"))?;
        source_url
            .set_port(Some(proxy_port))
            .map_err(|_| anyhow!("proxy port"))?;
        let mut admin = PgConnection::connect(&target_url).await?;
        let schema = format!("oxide_transfer_{}", uuid::Uuid::new_v4().simple());
        let q = format!("\"{schema}\"");
        let fields = format!(
            r#"precise numeric(38,18),value text,"binary" bytea,arr integer[],padded char(7),floating double precision,d date,moment timestamptz,span interval,js json,jb jsonb,uid uuid,mood {q}.mood,dom {q}.positive,pair {q}.pair,rng int8range,computed bigint GENERATED ALWAYS AS (id%7) STORED"#
        );
        sqlx::raw_sql(&format!(r#"CREATE SCHEMA {q};
            CREATE TYPE {q}.mood AS ENUM ('A','Z');
            CREATE DOMAIN {q}.positive AS numeric(38,18) CHECK (VALUE>=0);
            CREATE TYPE {q}.pair AS (amount numeric(38,18),labels text[]);
            CREATE TABLE {q}.source(id bigint PRIMARY KEY,{fields});
            CREATE TABLE {q}.target(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,{fields});
            INSERT INTO {q}.source(id,precise,value,"binary",arr,padded,floating,d,moment,span,js,jb,uid,mood,dom,pair,rng)
            SELECT i,12345678901234567890.123456789012345678,E'line\n\t\\N 文本-'||i,
                decode(lpad(to_hex(i),8,'0'),'hex')||decode('00ff','hex'),array_fill(i::int,ARRAY[2],ARRAY[-2]),'xy',
                CASE i%4 WHEN 0 THEN 'NaN'::float8 WHEN 1 THEN '-Infinity'::float8 WHEN 2 THEN '-0'::float8 ELSE 0.1::float8 END,
                'infinity'::date,'2026-10-22 05:10:11.123456+08'::timestamptz,interval '2 months 3 days 04:05:06.123456',
                '{{ "x": 1, "x": 2 }}'::json,'{{"x":2}}'::jsonb,'00000000-0000-0000-0000-000000000001'::uuid,
                'A'::{q}.mood,12345678901234567890.123456789012345678::{q}.positive,
                ROW(42.123::numeric(38,18),ARRAY[E'a\nb','comma,quote"'])::{q}.pair,int8range(i,i+2,'[)')
            FROM generate_series(1,{rows}::bigint) i;
            INSERT INTO {q}.target(id,value) OVERRIDING SYSTEM VALUE VALUES(50000,'baseline');"#)).execute(&mut admin).await?;
        let root = tempfile::tempdir()?;
        let metadata = MetaStore::open(&root.path().join("profile")).await?;
        metadata
            .save_project(&Project {
                id: "p".into(),
                name: "PostgreSQL fixture".into(),
                root_path: None,
                created_at: 1,
                updated_at: 1,
            })
            .await?;
        for (name, endpoint) in [
            ("source", source_url.as_str()),
            ("target", target_url.as_str()),
        ] {
            metadata.save_connection(&SavedConnection{id:name.into(),project_id:"p".into(),name:name.into(),driver:"postgres".into(),created_at:1,updated_at:1,config:json!({"id":name,"projectId":"p","name":name,"driver":"postgres","url":endpoint})}).await?;
        }
        let jobs = open_jobs(root.path(), metadata.clone()).await?;
        Ok(Self {
            root,
            metadata,
            jobs,
            admin,
            schema,
            proxy: Some(proxy),
            proxy_port,
            target_url,
        })
    }
    fn request(&self, mode: LargeTransferMode) -> LargeTransferRequest {
        let endpoint = |table: &str| LargeTransferEndpoint {
            connection_id: table.into(),
            driver: "postgres".into(),
            schema: self.schema.clone(),
            table: table.into(),
            database: None,
        };
        LargeTransferRequest {
            project_id: "p".into(),
            source: endpoint("source"),
            target: endpoint("target"),
            mode,
            batch_rows: 100,
        }
    }
    fn table(&self, name: &str) -> String {
        format!("\"{}\".\"{name}\"", self.schema)
    }
    async fn count(&mut self, name: &str) -> Result<i64> {
        Ok(
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {}", self.table(name)))
                .fetch_one(&mut self.admin)
                .await?,
        )
    }
    async fn ledger(&self) -> Result<SqliteConnection> {
        Ok(SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(self.root.path().join("profile/large-transfers/jobs.sqlite")),
        )
        .await?)
    }
    async fn offline(&mut self) -> Result<()> {
        if let Some(proxy) = self.proxy.take() {
            proxy.abort();
            let _ = proxy.await;
        }
        ensure!(
            TcpStream::connect(("127.0.0.1", self.proxy_port))
                .await
                .is_err(),
            "source proxy must be offline"
        );
        Ok(())
    }
    async fn wait(&self, id: &str, phase: Phase) -> Result<LargeTransferSummary> {
        let deadline = Instant::now() + Duration::from_secs(90);
        loop {
            let summary = self.jobs.get("p", id).await?;
            if summary.phase == phase {
                return Ok(summary);
            }
            ensure!(
                Instant::now() < deadline
                    && !matches!(summary.phase, Phase::Failed | Phase::Cancelled)
                    && !(summary.phase == Phase::Paused && phase != Phase::Paused),
                "unexpected PostgreSQL migration phase {:?}, {:?}, rows {}",
                summary.phase,
                summary.issue,
                summary.rows_staged
            );
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
    async fn cleanup(mut self) -> Result<()> {
        if let Some(proxy) = self.proxy.take() {
            proxy.abort();
            let _ = proxy.await;
        }
        sqlx::query(&format!(
            "DROP SCHEMA {} CASCADE",
            self.table("x").split('.').next().unwrap()
        ))
        .execute(&mut self.admin)
        .await?;
        self.admin.close().await?;
        Ok(())
    }
}

#[tokio::test]
#[ignore = "requires the isolated TEST_POSTGRES_URL server"]
async fn postgres_transfer_partitioned_upsert_keeps_absent_keys() -> Result<()> {
    let mut fixture = PgFixture::new(15).await?;
    let result=async {
        sqlx::raw_sql(&format!("DROP TABLE {target}; CREATE TABLE {target} (LIKE {source} INCLUDING ALL) PARTITION BY RANGE(id); CREATE TABLE {low} PARTITION OF {target} FOR VALUES FROM (0) TO (1000); CREATE TABLE {high} PARTITION OF {target} FOR VALUES FROM (1000) TO (MAXVALUE); INSERT INTO {target}(id,value) VALUES(1,'stale'),(50000,'retained')",target=fixture.table("target"),source=fixture.table("source"),low=fixture.table("low"),high=fixture.table("high"))).execute(&mut fixture.admin).await?;
        let preview=fixture.jobs.prepare(fixture.request(LargeTransferMode::Upsert)).await?;
        ensure!(preview.target_rows_before==2,"partitioned target review count");
        fixture.jobs.start("p",&preview.job.id,&preview.confirmation_token).await?;fixture.wait(&preview.job.id,Phase::Completed).await?;
        ensure!(fixture.count("target").await?==16,"upsert keeps target-only keys");
        let value:String=sqlx::query_scalar(&format!("SELECT value FROM {} WHERE id=1",fixture.table("target"))).fetch_one(&mut fixture.admin).await?;
        ensure!(value=="line\n\t\\N 文本-1","matching native key updated");
        let retained:String=sqlx::query_scalar(&format!("SELECT value FROM {} WHERE id=50000",fixture.table("target"))).fetch_one(&mut fixture.admin).await?;
        ensure!(retained=="retained","target-only key unchanged");Ok(())
    }.await;
    fixture.cleanup().await?;
    result
}

#[tokio::test]
#[ignore = "requires the isolated TEST_POSTGRES_URL server"]
async fn postgres_transfer_oversized_rows_and_unmapped_columns_fail_before_target_writes(
) -> Result<()> {
    let mut fixture = PgFixture::new(1).await?;
    let result = async {
        sqlx::query(&format!(
            "UPDATE {} SET value=repeat('x',2*1024*1024)",
            fixture.table("source")
        ))
        .execute(&mut fixture.admin)
        .await?;
        let error = fixture
            .jobs
            .prepare(fixture.request(LargeTransferMode::Overwrite))
            .await
            .unwrap_err();
        ensure!(
            error.to_string().contains("source row exceeds"),
            "oversized source values must be rejected before wire decoding"
        );
        ensure!(
            fixture.count("target").await? == 1,
            "oversized input must not modify the original target"
        );
        for job in fixture
            .jobs
            .list(
                oxide_studio_lib::core::transfer_jobs::LargeTransferListQuery {
                    project_id: "p".into(),
                    cursor: None,
                },
            )
            .await?
            .jobs
        {
            fixture.jobs.cancel("p", &job.id).await?;
        }
        sqlx::raw_sql(&format!(
            "UPDATE {0} SET value='small'; ALTER TABLE {0} ADD COLUMN missing_from_target text",
            fixture.table("source")
        ))
        .execute(&mut fixture.admin)
        .await?;
        let error = fixture
            .jobs
            .prepare(fixture.request(LargeTransferMode::Overwrite))
            .await
            .unwrap_err();
        ensure!(
            error.to_string().contains("source column is absent"),
            "ordinary source columns cannot be silently discarded"
        );
        ensure!(
            fixture.count("target").await? == 1,
            "mapping failures must not modify original rows"
        );
        Ok(())
    }
    .await;
    fixture.cleanup().await?;
    result
}

#[tokio::test]
#[ignore = "requires the isolated TEST_POSTGRES_URL server"]
async fn postgres_transfer_empty_overwrite_and_duplicate_source_without_keys() -> Result<()> {
    let mut fixture = PgFixture::new(0).await?;
    let result = async {
        let empty = fixture.jobs.prepare(fixture.request(LargeTransferMode::Overwrite)).await?;
        ensure!(empty.job.source_rows == 0, "empty snapshot must be represented explicitly");
        fixture.jobs.start("p", &empty.job.id, &empty.confirmation_token).await?;
        fixture.wait(&empty.job.id, Phase::Completed).await?;
        ensure!(fixture.count("target").await? == 0, "empty overwrite must remove the original target rows");
        sqlx::raw_sql(&format!("ALTER TABLE {} DROP CONSTRAINT source_pkey; ALTER TABLE {} DROP CONSTRAINT target_pkey; INSERT INTO {}(id,value) VALUES(1,'duplicate'),(1,'duplicate')", fixture.table("source"), fixture.table("target"), fixture.table("source"))).execute(&mut fixture.admin).await?;
        let duplicate = fixture.jobs.prepare(fixture.request(LargeTransferMode::Append)).await?;
        ensure!(duplicate.job.source_rows == 2, "snapshot must retain duplicate rows without a source key");
        fixture.offline().await?;
        fixture.jobs.start("p", &duplicate.job.id, &duplicate.confirmation_token).await?;
        fixture.wait(&duplicate.job.id, Phase::Completed).await?;
        let copies: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {} WHERE id=1 AND value='duplicate'", fixture.table("target"))).fetch_one(&mut fixture.admin).await?;
        ensure!(fixture.count("target").await? == 2 && copies == 2, "snapshot ordinals must preserve duplicate multiplicity");
        Ok(())
    }.await;
    fixture.cleanup().await?;
    result
}

#[tokio::test]
#[ignore = "requires the isolated TEST_POSTGRES_URL server"]
async fn postgres_transfer_preserves_native_target_session_for_defaults_and_triggers() -> Result<()>
{
    let mut fixture = PgFixture::new(3).await?;
    let result = async {
        let mut configured_url = url::Url::parse(&fixture.target_url)?;
        configured_url.query_pairs_mut().append_pair("options", &format!("-csearch_path={},pg_catalog -cDateStyle=SQL,DMY -cIntervalStyle=sql_standard -cTimeZone=Pacific/Auckland -cextra_float_digits=0 -cbytea_output=escape", fixture.schema));
        fixture.target_url = configured_url.to_string();
        fixture.metadata.save_connection(&SavedConnection{id:"target".into(),project_id:"p".into(),name:"target".into(),driver:"postgres".into(),created_at:1,updated_at:2,config:json!({"id":"target","projectId":"p","name":"target","driver":"postgres","url":fixture.target_url})}).await?;
        let context = "pg_catalog.jsonb_build_object('search_path',pg_catalog.current_setting('search_path'),'DateStyle',pg_catalog.current_setting('DateStyle'),'IntervalStyle',pg_catalog.current_setting('IntervalStyle'),'TimeZone',pg_catalog.current_setting('TimeZone'),'extra_float_digits',pg_catalog.current_setting('extra_float_digits'),'bytea_output',pg_catalog.current_setting('bytea_output'),'date_iso',pg_catalog.to_char(CURRENT_DATE,'YYYY-MM-DD'))";
        let mut native = PgConnection::connect(&fixture.target_url).await?;
        let expected: String = sqlx::query_scalar(&format!("SELECT {context}::text")).fetch_one(&mut native).await?;
        let expected_value: serde_json::Value = serde_json::from_str(&expected)?;
        ensure!(expected_value["search_path"].as_str().is_some_and(|path| path.contains(&fixture.schema)), "native URI search_path must apply");
        native.close().await?;
        sqlx::raw_sql(&format!("UPDATE {source} SET d=DATE '2026-03-04',span=INTERVAL '-2 months 3 days -04:05:06.123456'; ALTER TABLE {target} ADD COLUMN target_date date DEFAULT CURRENT_DATE; CREATE TABLE {audit}(id bigint,context jsonb); CREATE FUNCTION {function}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO audit_rows(id,context) VALUES(NEW.id,{context}); RETURN NEW; END$$; CREATE TRIGGER native_context AFTER INSERT ON {target} FOR EACH ROW EXECUTE FUNCTION {function}()", source=fixture.table("source"),target=fixture.table("target"),audit=fixture.table("audit_rows"),function=fixture.table("audit_insert"))).execute(&mut fixture.admin).await?;
        let preview = fixture.jobs.prepare(fixture.request(LargeTransferMode::Append)).await?;
        fixture.offline().await?;
        fixture.jobs.start("p", &preview.job.id, &preview.confirmation_token).await?;
        fixture.wait(&preview.job.id, Phase::Completed).await?;
        let matching_context: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {} WHERE context=$1::jsonb", fixture.table("audit_rows"))).bind(&expected).fetch_one(&mut fixture.admin).await?;
        ensure!(matching_context == 3, "trigger lookups and session settings must match a native connection");
        let values: bool = sqlx::query_scalar(&format!("SELECT bool_and(t.d=s.d AND t.span=s.span AND t.moment=s.moment AND t.precise=s.precise AND to_char(t.target_date,'YYYY-MM-DD')=$1) FROM {} s JOIN {} t USING(id)",fixture.table("source"),fixture.table("target"))).bind(expected_value["date_iso"].as_str().context("native date")?).fetch_one(&mut fixture.admin).await?;
        ensure!(values && fixture.count("target").await? == 4, "transport values and target-native defaults must both be preserved");
        Ok(())
    }.await;
    fixture.cleanup().await?;
    result
}

#[tokio::test]
#[ignore = "requires the isolated TEST_POSTGRES_URL server"]
async fn postgres_transfer_native_values_source_offline_and_owned_sequence_cache() -> Result<()> {
    let mut fixture = PgFixture::new(12_001).await?;
    let result=async {
        let mut cache=PgConnection::connect(&fixture.target_url).await?;
        sqlx::query(&format!("ALTER SEQUENCE {} CACHE 5",fixture.table("target_id_seq"))).execute(&mut fixture.admin).await?;
        let cached:i64=sqlx::query_scalar(&format!("SELECT nextval('{}')",fixture.table("target_id_seq"))).fetch_one(&mut cache).await?;ensure!(cached==1,"sequence cache fixture");
        let preview=fixture.jobs.prepare(fixture.request(LargeTransferMode::Append)).await?;
        ensure!(preview.job.source_rows==12_001 && preview.target_rows_before==1,"exact PostgreSQL review counts");
        ensure!(preview.skipped_columns.contains(&"computed".to_string()),"generated column review");
        ensure!(fixture.jobs.start("p",&preview.job.id,"wrong").await.is_err(),"exact confirmation required");
        ensure!(fixture.count("target").await?==1,"target must not change during preparation");
        fixture.offline().await?;
        fixture.jobs.start("p",&preview.job.id,&preview.confirmation_token).await?;
        let completed=fixture.wait(&preview.job.id,Phase::Completed).await?;
        ensure!(completed.rows_staged==12_001,"no 10,000-row truncation");
        let valid:bool=sqlx::query_scalar(&format!(r#"SELECT bool_and(precise=12345678901234567890.123456789012345678 AND dom=precise AND array_lower(arr,1)=-2 AND array_upper(arr,1)=-1 AND arr[-2]=id AND octet_length("binary")=6 AND encode("binary",'hex')=lpad(to_hex(id),8,'0')||'00ff' AND octet_length(padded)=7 AND padded='xy' AND d='infinity'::date AND moment='2026-10-21 21:10:11.123456+00'::timestamptz AND span=interval '2 months 3 days 04:05:06.123456' AND js::text='{{ "x": 1, "x": 2 }}' AND jb='{{"x":2}}'::jsonb AND mood='A' AND (pair).amount=42.123 AND (pair).labels[1]=E'a\nb' AND lower(rng)=id AND upper(rng)=id+2 AND computed=id%7 AND value=E'line\n\t\\N 文本-'||id AND CASE id%4 WHEN 0 THEN floating='NaN'::float8 WHEN 1 THEN floating='-Infinity'::float8 WHEN 2 THEN encode(float8send(floating),'hex')='8000000000000000' ELSE floating=0.1::float8 END) FROM {} WHERE id<50000"#,fixture.table("target"))).fetch_one(&mut fixture.admin).await?;
        ensure!(valid,"native scalar, array, composite, JSON, padding and binary values changed");
        let next:i64=sqlx::query_scalar(&format!("SELECT nextval('{}')",fixture.table("target_id_seq"))).fetch_one(&mut cache).await?;
        ensure!(next==50001,"transactional restart must invalidate old sequence caches");cache.close().await?;
        let inserted:i64=sqlx::query_scalar(&format!("INSERT INTO {} DEFAULT VALUES RETURNING id",fixture.table("target"))).fetch_one(&mut fixture.admin).await?;ensure!(inserted>50000,"next identity must not collide");
        ensure!(fixture.count("target").await?==12_003,"all source, original and new rows");
        ensure!(fixture.count(&receipt_table(&preview.job.id)).await?==1,"only final receipt remains");
        ensure!(!fixture.root.path().join(format!("profile/large-transfers/{}.snapshot.sqlite",preview.job.id)).exists(),"snapshot cleaned");
        Ok(())
    }.await;
    fixture.cleanup().await?;
    result
}

#[tokio::test]
#[ignore = "requires the isolated TEST_POSTGRES_URL server"]
async fn postgres_transfer_committed_checkpoint_recovery_and_cancel() -> Result<()> {
    let mut fixture = PgFixture::new(1203).await?;
    let result=async {
        let cancelled=fixture.jobs.prepare(fixture.request(LargeTransferMode::Overwrite)).await?;
        let resumed=fixture.jobs.prepare(fixture.request(LargeTransferMode::Overwrite)).await?;
        let mut ledger=fixture.ledger().await?;
        sqlx::query("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON jobs WHEN json_extract(NEW.body,'$.summary.rowsStaged')>0 BEGIN SELECT RAISE(FAIL,'fixture checkpoint failure'); END").execute(&mut ledger).await?;
        fixture.jobs.start("p",&cancelled.job.id,&cancelled.confirmation_token).await?;fixture.wait(&cancelled.job.id,Phase::Paused).await?;
        ensure!(fixture.count("target").await?==1,"unpublished target unchanged");
        ensure!(fixture.count(&format!("_oxide_transfer_stage_{}",cancelled.job.id.replace('-',""))).await?==100,"a target batch must be committed");
        fixture.jobs.cancel("p",&cancelled.job.id).await?;fixture.wait(&cancelled.job.id,Phase::Cancelled).await?;
        ensure!(fixture.count("target").await?==1,"cancel retains original rows");
        fixture.offline().await?;
        fixture.jobs.start("p",&resumed.job.id,&resumed.confirmation_token).await?;fixture.wait(&resumed.job.id,Phase::Paused).await?;
        sqlx::query("DROP TRIGGER fail_checkpoint").execute(&mut ledger).await?;ledger.close().await?;
        fixture.jobs=open_jobs(fixture.root.path(),fixture.metadata.clone()).await?;
        fixture.jobs.start("p",&resumed.job.id,&resumed.confirmation_token).await?;fixture.wait(&resumed.job.id,Phase::Completed).await?;
        ensure!(fixture.count("target").await?==1203,"target commits must not duplicate on Host checkpoint recovery");
        Ok(())
    }.await;
    fixture.cleanup().await?;
    result
}

#[tokio::test]
#[ignore = "requires the isolated TEST_POSTGRES_URL server"]
async fn postgres_transfer_target_changes_and_staging_tamper_block_publication() -> Result<()> {
    let mut fixture = PgFixture::new(305).await?;
    let result=async {
        let stale=fixture.jobs.prepare(fixture.request(LargeTransferMode::Overwrite)).await?;
        sqlx::query(&format!("UPDATE {} SET value='changed'",fixture.table("target"))).execute(&mut fixture.admin).await?;
        fixture.jobs.start("p",&stale.job.id,&stale.confirmation_token).await?;fixture.wait(&stale.job.id,Phase::Paused).await?;
        ensure!(fixture.count("target").await?==1,"same-count content changes must block publication");
        fixture.jobs.cancel("p",&stale.job.id).await?;
        let staged=fixture.jobs.prepare(fixture.request(LargeTransferMode::Overwrite)).await?;
        let mut ledger=fixture.ledger().await?;
        sqlx::query("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON jobs WHEN json_extract(NEW.body,'$.summary.rowsStaged')>0 BEGIN SELECT RAISE(FAIL,'fixture checkpoint failure'); END").execute(&mut ledger).await?;
        fixture.jobs.start("p",&staged.job.id,&staged.confirmation_token).await?;fixture.wait(&staged.job.id,Phase::Paused).await?;
        sqlx::query("DROP TRIGGER fail_checkpoint").execute(&mut ledger).await?;ledger.close().await?;
        sqlx::query(&format!("UPDATE {} SET value='tampered'",fixture.table(&format!("_oxide_transfer_stage_{}",staged.job.id.replace('-',""))))).execute(&mut fixture.admin).await?;
        fixture.jobs.start("p",&staged.job.id,&staged.confirmation_token).await?;fixture.wait(&staged.job.id,Phase::Paused).await?;
        ensure!(fixture.count("target").await?==1,"tampered staged data cannot be published");
        fixture.jobs.cancel("p",&staged.job.id).await?;
        Ok(())
    }.await;
    fixture.cleanup().await?;
    result
}

#[tokio::test]
#[ignore = "requires the isolated TEST_POSTGRES_URL server"]
async fn postgres_transfer_atomic_failure_and_published_recovery_uses_sealed_target() -> Result<()>
{
    let mut fixture = PgFixture::new(205).await?;
    let result=async {
        sqlx::raw_sql(&format!("CREATE FUNCTION {}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.id=2 THEN RAISE EXCEPTION 'fixture publication stop'; END IF; RETURN NEW; END$$; CREATE TRIGGER fixture_stop BEFORE INSERT ON {} FOR EACH ROW EXECUTE FUNCTION {}()",fixture.table("stop_insert"),fixture.table("target"),fixture.table("stop_insert"))).execute(&mut fixture.admin).await?;
        let failed=fixture.jobs.prepare(fixture.request(LargeTransferMode::Overwrite)).await?;
        fixture.jobs.start("p",&failed.job.id,&failed.confirmation_token).await?;fixture.wait(&failed.job.id,Phase::Paused).await?;
        ensure!(fixture.count("target").await?==1,"failed overwrite publication must roll back the delete and all inserts");
        fixture.jobs.cancel("p",&failed.job.id).await?;
        sqlx::query(&format!("CREATE OR REPLACE FUNCTION {}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.id=2 THEN RETURN NULL; END IF; RETURN NEW; END$$",fixture.table("stop_insert"))).execute(&mut fixture.admin).await?;
        let skipped=fixture.jobs.prepare(fixture.request(LargeTransferMode::Overwrite)).await?;
        fixture.jobs.start("p",&skipped.job.id,&skipped.confirmation_token).await?;
        fixture.wait(&skipped.job.id,Phase::Paused).await?;
        ensure!(fixture.count("target").await?==1,"a trigger silently skipping source rows must roll back the whole overwrite");
        fixture.jobs.cancel("p",&skipped.job.id).await?;
        sqlx::query(&format!("DROP TRIGGER fixture_stop ON {}",fixture.table("target"))).execute(&mut fixture.admin).await?;
        let recovered=fixture.jobs.prepare(fixture.request(LargeTransferMode::Overwrite)).await?;
        let mut ledger=fixture.ledger().await?;
        sqlx::query("CREATE TRIGGER fail_completion BEFORE UPDATE ON jobs WHEN json_extract(NEW.body,'$.summary.phase')='completed' BEGIN SELECT RAISE(FAIL,'fixture completion checkpoint'); END").execute(&mut ledger).await?;
        fixture.jobs.start("p",&recovered.job.id,&recovered.confirmation_token).await?;
        let deadline=Instant::now()+Duration::from_secs(60);
        loop {
            let phase:String=sqlx::query_scalar("SELECT json_extract(body,'$.summary.phase') FROM jobs WHERE id=?").bind(&recovered.job.id).fetch_one(&mut ledger).await?;
            if phase=="paused"{break;}ensure!(Instant::now()<deadline,"publication fixture did not finish");tokio::time::sleep(Duration::from_millis(25)).await;
        }
        ensure!(fixture.count("target").await?==205,"target publication must commit before the completion checkpoint fails");
        let body:String=sqlx::query_scalar("SELECT body FROM jobs WHERE id=?").bind(&recovered.job.id).fetch_one(&mut ledger).await?;
        ensure!(!body.contains(&fixture.target_url),"target credentials must not be persisted in cleartext");
        sqlx::query("DROP TRIGGER fail_completion").execute(&mut ledger).await?;ledger.close().await?;
        fixture.metadata.save_connection(&SavedConnection{id:"target".into(),project_id:"p".into(),name:"target".into(),driver:"postgres".into(),created_at:1,updated_at:2,config:json!({"id":"target","projectId":"p","name":"target","driver":"postgres","url":"postgresql://127.0.0.1:9/changed"})}).await?;
        ensure!(fixture.jobs.get("p",&recovered.job.id).await?.phase==Phase::Completed,"published receipt must use the sealed original endpoint after configuration changes");
        fixture.jobs.start("p",&recovered.job.id,&recovered.confirmation_token).await?;
        ensure!(fixture.count("target").await?==205,"completed retries cannot duplicate rows");
        Ok(())
    }.await;
    fixture.cleanup().await?;
    result
}
