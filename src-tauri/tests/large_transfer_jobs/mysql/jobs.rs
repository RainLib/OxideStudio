use super::Engine;
use crate::*;
use anyhow::{ensure, Context};
#[path = "permissions.rs"]
mod permissions;
#[path = "process.rs"]
mod process;
#[path = "types.rs"]
mod types;

struct MysqlFixture {
    engine: Engine,
    root: tempfile::TempDir,
    meta: MetaStore,
    jobs: LargeTransferJobs,
}
impl MysqlFixture {
    async fn new(rows: u32) -> Result<Self> {
        Self::with_engine(rows, Engine::open().await?).await
    }
    async fn with_engine(rows: u32, mut engine: Engine) -> Result<Self> {
        for name in ["source", "target"] {
            sqlx::query(&format!("CREATE TABLE {}(id BIGINT PRIMARY KEY,label VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,precise_value DECIMAL(65,30),unsigned_value BIGINT UNSIGNED,bytes VARBINARY(32),floating DOUBLE,flags BIT(64),moment TIMESTAMP(6),dt DATETIME(6),span TIME(6),js JSON,`generated` BIGINT GENERATED ALWAYS AS(id%7) STORED) ENGINE=InnoDB", engine.table(name))).execute(&mut engine.connection).await?;
        }
        for first in (0..rows).step_by(500) {
            let mut query = sqlx::QueryBuilder::<sqlx::MySql>::new(format!("INSERT INTO {}(id,label,precise_value,unsigned_value,bytes,floating,flags,moment,dt,span,js) ", engine.table("source")));
            query.push_values(first..(first + 500).min(rows), |mut row, i| {
                row.push_bind(i64::from(i) + 1)
                    .push_bind(format!("文本-\n\0-{i}"))
                    .push("12345678901234567890123456789012345.123456789012345678901234567890")
                    .push_bind(u64::MAX)
                    .push_bind(vec![0, 255, (i % 255) as u8])
                    .push_bind(match i % 5 {
                        0 => f64::MAX,
                        1 => f64::MIN_POSITIVE,
                        2 => f64::from_bits(1),
                        3 => -0.0,
                        _ => 0.1,
                    })
                    .push_bind(u64::MAX)
                    .push("'2026-10-22 12:34:56.123456+00:00'")
                    .push("'1900-01-01 03:04:05.123456'")
                    .push("'-838:12:34.123456'")
                    .push("JSON_OBJECT('u',18446744073709551615)");
            });
            query
                .build()
                .persistent(false)
                .execute(&mut engine.connection)
                .await?;
        }
        let root = tempfile::tempdir()?;
        let meta = MetaStore::open(&root.path().join("profile")).await?;
        meta.save_project(&Project {
            id: "p".into(),
            name: "MySQL fixture".into(),
            root_path: None,
            created_at: 1,
            updated_at: 1,
        })
        .await?;
        for name in ["source", "target"] {
            meta.save_connection(&SavedConnection{id:name.into(),project_id:"p".into(),name:name.into(),driver:"mysql".into(),created_at:1,updated_at:1,config:json!({"id":name,"projectId":"p","name":name,"driver":"mysql","url":engine.url})}).await?;
        }
        let jobs = open_jobs(root.path(), meta.clone()).await?;
        Ok(Self {
            engine,
            root,
            meta,
            jobs,
        })
    }
    fn request(&self, mode: LargeTransferMode) -> LargeTransferRequest {
        let endpoint = |name: &str| LargeTransferEndpoint {
            connection_id: name.into(),
            driver: "mysql".into(),
            schema: self.engine.schema.clone(),
            table: name.into(),
            database: Some(self.engine.schema.clone()),
        };
        LargeTransferRequest {
            project_id: "p".into(),
            source: endpoint("source"),
            target: endpoint("target"),
            mode,
            batch_rows: 100,
        }
    }
    async fn wait(&self, id: &str, phase: Phase) -> Result<LargeTransferSummary> {
        let deadline = Instant::now() + Duration::from_secs(90);
        loop {
            let summary = self.jobs.get("p", id).await?;
            if summary.phase == phase {
                return Ok(summary);
            }
            ensure!(
                summary.phase != Phase::Paused
                    && summary.phase != Phase::Failed
                    && Instant::now() < deadline,
                "MySQL unexpected phase {:?}, rows {}, issue {:?}",
                summary.phase,
                summary.rows_staged,
                summary.issue
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
    async fn count(&mut self, name: &str) -> Result<i64> {
        Ok(
            sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {}", self.engine.table(name)))
                .fetch_one(&mut self.engine.connection)
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
    async fn checkpoint(&self, id: &str) -> Result<(String, String)> {
        let mut ledger = self.ledger().await?;
        let record = sqlx::query_as("SELECT body,mac FROM jobs WHERE id=?")
            .bind(id)
            .fetch_one(&mut ledger)
            .await?;
        ledger.close().await?;
        Ok(record)
    }
    async fn rewind(&self, id: &str, record: &(String, String)) -> Result<()> {
        let mut ledger = self.ledger().await?;
        sqlx::query("UPDATE jobs SET body=?,mac=? WHERE id=?")
            .bind(&record.0)
            .bind(&record.1)
            .bind(id)
            .execute(&mut ledger)
            .await?;
        ledger.close().await?;
        Ok(())
    }
}

#[tokio::test]
#[ignore = "isolated native MySQL resumable transfer"]
async fn mysql_transfer_rich_values_and_source_offline() -> Result<()> {
    let mut f = MysqlFixture::new(1201).await?;
    let result=async{
        let preview=f.jobs.prepare(f.request(LargeTransferMode::Append)).await.context("prepare MySQL native transfer")?;
        let initial=f.checkpoint(&preview.job.id).await?;
        let mut snapshot=SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(f.root.path().join(format!("profile/large-transfers/{}.snapshot.sqlite",preview.job.id))).read_only(true)).await?;
        let first:Vec<u8>=sqlx::query_scalar("SELECT wire FROM snapshot_rows WHERE seq=1").fetch_one(&mut snapshot).await?;
        let cells=super::wire::decode(&first,11,1024*1024)?;
        ensure!(cells[7].as_deref().is_some_and(|value|value.ends_with(b".123456")),"MySQL source snapshot lost timestamp fractions: {:?}",cells[7]);
        snapshot.close().await?;
        ensure!(preview.job.source_rows==1201 && preview.mapped_columns.len()==11 && preview.skipped_columns==["generated"],"MySQL mapping changed");
        // Disconnecting the source is enforced by changing its endpoint to a
        // closed port in a separately owned saved source would invalidate the
        // reviewed binding. Instead drop the actual source relation: recovery
        // must not query it after its immutable private snapshot was reviewed.
        let source=f.engine.table("source");
        sqlx::query(&format!("RENAME TABLE {source} TO {}",f.engine.table("expected"))).execute(&mut f.engine.connection).await?;
        f.jobs.start("p",&preview.job.id,&preview.confirmation_token).await?;
        let done=f.wait(&preview.job.id,Phase::Completed).await?;
        ensure!(done.rows_staged==1201 && done.batches==13 && f.count("target").await?==1201,"MySQL completed counts changed");
        let differences:i64=sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {} s JOIN {} t ON s.id=t.id WHERE NOT(s.label<=>t.label) OR NOT(s.precise_value<=>t.precise_value) OR NOT(s.unsigned_value<=>t.unsigned_value) OR NOT(s.bytes<=>t.bytes) OR NOT(s.floating<=>t.floating) OR NOT(s.flags<=>t.flags) OR NOT(s.moment<=>t.moment) OR NOT(s.dt<=>t.dt) OR NOT(s.span<=>t.span) OR NOT(s.js<=>t.js) OR NOT(s.`generated`<=>t.`generated`)",f.engine.table("expected"),f.engine.table("target"))).fetch_one(&mut f.engine.connection).await?;
        if differences!=0 {
            let names=["label","precise_value","unsigned_value","bytes","floating","flags","moment","dt","span","js","generated"];
            let checks=names.iter().map(|name|format!("CAST(SUM(NOT(s.`{name}`<=>t.`{name}`)) AS SIGNED)")).collect::<Vec<_>>().join(",");
            let row=sqlx::query(&format!("SELECT {checks} FROM {} s JOIN {} t ON s.id=t.id",f.engine.table("expected"),f.engine.table("target"))).fetch_one(&mut f.engine.connection).await?;
            let counts=names.iter().enumerate().map(|(index,name)|Ok(format!("{name}:{}",row.try_get::<i64,_>(index)?))).collect::<Result<Vec<_>>>()?;
            let times:(String,String,i64)=sqlx::query_as(&format!("SELECT CAST(s.moment AS CHAR),CAST(t.moment AS CHAR),TIMESTAMPDIFF(MICROSECOND,s.moment,t.moment) FROM {} s JOIN {} t ON s.id=t.id LIMIT 1",f.engine.table("expected"),f.engine.table("target"))).fetch_one(&mut f.engine.connection).await?;
            anyhow::bail!("MySQL exact native values changed: {}; timestamps {:?}",counts.join(","),times);
        }
        let journal=format!("_oxide_transfer_receipt_{}",preview.job.id.replace('-',""));
        ensure!(f.count(&journal).await?==1,"MySQL publication must retain only its receipt");
        let floats=sqlx::query(&format!("SELECT s.floating original,t.floating copied FROM {} s JOIN {} t ON s.id=t.id",f.engine.table("expected"),f.engine.table("target"))).fetch_all(&mut f.engine.connection).await?;
        ensure!(floats.iter().all(|row|row.get::<f64,_>("original").to_bits()==row.get::<f64,_>("copied").to_bits()),"MySQL floating-point bits changed");
        // Restore the valid pre-execution local record after the target commit,
        // then point the saved target elsewhere. Only the sealed original
        // target's authenticated published receipt may establish completion.
        f.rewind(&preview.job.id,&initial).await?;
        f.meta.save_connection(&SavedConnection{id:"target".into(),project_id:"p".into(),name:"edited target".into(),driver:"mysql".into(),created_at:1,updated_at:2,config:json!({"id":"target","projectId":"p","name":"edited target","driver":"mysql","url":"mysql://127.0.0.1:1/unavailable"})}).await?;
        f.jobs=open_jobs(f.root.path(),f.meta.clone()).await?;
        f.wait(&preview.job.id,Phase::Completed).await?;
        ensure!(f.count("target").await?==1201,"MySQL completion recovery repeated publication");
        ensure!(!f.root.path().join(format!("profile/large-transfers/{}.snapshot.sqlite",preview.job.id)).exists(),"MySQL snapshot cleanup failed");
        Ok(())
    }.await;
    f.engine.close().await?;
    result
}

#[tokio::test]
#[ignore = "isolated native MySQL resumable transfer"]
async fn mysql_transfer_pause_resume_and_cancel() -> Result<()> {
    let mut f = MysqlFixture::new(5001).await?;
    let result = async {
        let preview = f.jobs.prepare(f.request(LargeTransferMode::Append)).await?;
        let initial = f.checkpoint(&preview.job.id).await?;
        f.jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?;
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let summary = f.jobs.get("p", &preview.job.id).await?;
            ensure!(
                summary.phase == Phase::Copying && Instant::now() < deadline,
                "MySQL failed before pause {:?}",
                summary
            );
            if summary.rows_staged >= 100 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        f.jobs.request_pause("p", &preview.job.id).await?;
        let paused = f.wait(&preview.job.id, Phase::Paused).await?;
        ensure!(
            paused.rows_staged >= 100 && paused.rows_staged < 5001 && f.count("target").await? == 0,
            "MySQL pause touched target or lost progress"
        );
        f.rewind(&preview.job.id, &initial).await?;
        f.jobs = open_jobs(f.root.path(), f.meta.clone()).await?;
        f.jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?;
        f.wait(&preview.job.id, Phase::Completed).await?;
        ensure!(
            f.count("target").await? == 5001,
            "MySQL resume duplicated or lost rows"
        );
        let cancellation = f
            .jobs
            .prepare(f.request(LargeTransferMode::Overwrite))
            .await?;
        f.jobs
            .start("p", &cancellation.job.id, &cancellation.confirmation_token)
            .await?;
        f.jobs.request_pause("p", &cancellation.job.id).await?;
        f.wait(&cancellation.job.id, Phase::Paused).await?;
        f.jobs.cancel("p", &cancellation.job.id).await?;
        f.wait(&cancellation.job.id, Phase::Cancelled).await?;
        ensure!(
            f.count("target").await? == 5001,
            "MySQL cancellation changed original data"
        );
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?",
        )
        .bind(&f.engine.schema)
        .bind(format!(
            "_oxide_transfer_receipt_{}",
            cancellation.job.id.replace('-', "")
        ))
        .fetch_one(&mut f.engine.connection)
        .await?;
        ensure!(count == 0, "MySQL cancellation leaked journal");
        Ok(())
    }
    .await;
    f.engine.close().await?;
    result
}

#[tokio::test]
#[ignore = "isolated native MySQL resumable transfer"]
async fn mysql_transfer_secondary_unique_conflict_rolls_back() -> Result<()> {
    let mut f = MysqlFixture::new(2).await?;
    let result = async {
        let source = f.engine.table("source");
        let target = f.engine.table("target");
        sqlx::query(&format!("UPDATE {source} SET label=IF(id=1,'A','B')"))
            .execute(&mut f.engine.connection)
            .await?;
        sqlx::query(&format!("ALTER TABLE {target} ADD UNIQUE(label)"))
            .execute(&mut f.engine.connection)
            .await?;
        sqlx::query(&format!(
            "INSERT INTO {target}(id,label,precise_value) VALUES(1,'A',7),(99,'B',8)"
        ))
        .execute(&mut f.engine.connection)
        .await?;
        let preview = f.jobs.prepare(f.request(LargeTransferMode::Upsert)).await?;
        f.jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?;
        let paused = f.wait(&preview.job.id, Phase::Paused).await?;
        ensure!(
            paused.rows_staged == 2 && f.count("target").await? == 2,
            "MySQL conflict staging changed"
        );
        let value: String = sqlx::query_scalar(&format!(
            "SELECT CAST(precise_value AS CHAR) FROM {target} WHERE id=1"
        ))
        .fetch_one(&mut f.engine.connection)
        .await?;
        ensure!(
            value.starts_with("7."),
            "secondary unique conflict committed the preceding primary-key update"
        );
        f.jobs.cancel("p", &preview.job.id).await?;
        f.wait(&preview.job.id, Phase::Cancelled).await?;
        Ok(())
    }
    .await;
    f.engine.close().await?;
    result
}

#[tokio::test]
#[ignore = "isolated native MySQL resumable transfer"]
async fn mysql_transfer_target_and_journal_tamper_rejected() -> Result<()> {
    let mut f = MysqlFixture::new(501).await?;
    let result = async {
        let preview = f.jobs.prepare(f.request(LargeTransferMode::Append)).await?;
        sqlx::query(&format!(
            "INSERT INTO {}(id,label) VALUES(999,'concurrent')",
            f.engine.table("target")
        ))
        .execute(&mut f.engine.connection)
        .await?;
        f.jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?;
        f.wait(&preview.job.id, Phase::Paused).await?;
        ensure!(
            f.count("target").await? == 1,
            "changed target was overwritten"
        );
        f.jobs.cancel("p", &preview.job.id).await?;
        let preview = f.jobs.prepare(f.request(LargeTransferMode::Append)).await?;
        f.jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?;
        f.jobs.request_pause("p", &preview.job.id).await?;
        f.wait(&preview.job.id, Phase::Paused).await?;
        let journal = f.engine.table(&format!(
            "_oxide_transfer_receipt_{}",
            preview.job.id.replace('-', "")
        ));
        sqlx::query(&format!(
            "UPDATE {journal} SET body='tampered' WHERE kind=0"
        ))
        .execute(&mut f.engine.connection)
        .await?;
        f.jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?;
        f.wait(&preview.job.id, Phase::Paused).await?;
        ensure!(
            f.count("target").await? == 1,
            "tampered journal touched target"
        );
        Ok(())
    }
    .await;
    f.engine.close().await?;
    result
}

#[tokio::test]
#[ignore = "isolated native MySQL resumable transfer"]
async fn mysql_transfer_upsert_and_empty_overwrite() -> Result<()> {
    let mut f = MysqlFixture::new(3).await?;
    let result = async {
        let target = f.engine.table("target");
        sqlx::query(&format!(
            "INSERT INTO {target}(id,label) VALUES(1,'old'),(99,'retained')"
        ))
        .execute(&mut f.engine.connection)
        .await?;
        let preview = f.jobs.prepare(f.request(LargeTransferMode::Upsert)).await?;
        f.jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?;
        f.wait(&preview.job.id, Phase::Completed).await?;
        ensure!(
            f.count("target").await? == 4,
            "MySQL primary-key upsert changed row count"
        );
        let value: String = sqlx::query_scalar(&format!(
            "SELECT CAST(label AS CHAR) FROM {target} WHERE id=1"
        ))
        .fetch_one(&mut f.engine.connection)
        .await?;
        ensure!(
            value == "文本-\n\0-0",
            "MySQL existing primary-key row was not updated"
        );
        sqlx::query(&format!("DELETE FROM {}", f.engine.table("source")))
            .execute(&mut f.engine.connection)
            .await?;
        let preview = f
            .jobs
            .prepare(f.request(LargeTransferMode::Overwrite))
            .await?;
        f.jobs
            .start("p", &preview.job.id, &preview.confirmation_token)
            .await?;
        let completed = f.wait(&preview.job.id, Phase::Completed).await?;
        ensure!(
            completed.rows_staged == 0 && completed.batches == 0 && f.count("target").await? == 0,
            "MySQL empty overwrite did not delete original rows atomically"
        );
        Ok(())
    }
    .await;
    f.engine.close().await?;
    result
}

#[tokio::test]
#[ignore = "isolated native MySQL resumable transfer"]
async fn mysql_transfer_budget_and_unmapped_columns_rejected() -> Result<()> {
    let mut f = MysqlFixture::new(1).await?;
    let result = async {
        let source = f.engine.table("source");
        sqlx::query(&format!(
            "ALTER TABLE {source} ADD missing_column INT DEFAULT 7"
        ))
        .execute(&mut f.engine.connection)
        .await?;
        let issue = f
            .jobs
            .prepare(f.request(LargeTransferMode::Append))
            .await
            .err()
            .context("unmapped MySQL column must fail")?;
        ensure!(
            issue.to_string().contains("source column"),
            "unexpected unmapped error: {issue:#}"
        );
        sqlx::query(&format!(
            "ALTER TABLE {source} DROP COLUMN missing_column, MODIFY label LONGTEXT"
        ))
        .execute(&mut f.engine.connection)
        .await?;
        sqlx::query(&format!("UPDATE {source} SET label=REPEAT('x',2097152)"))
            .execute(&mut f.engine.connection)
            .await?;
        let issue = f
            .jobs
            .prepare(f.request(LargeTransferMode::Append))
            .await
            .err()
            .context("oversized MySQL row must fail")?;
        ensure!(
            issue.to_string().contains("budget"),
            "unexpected oversized row error: {issue:#}"
        );
        ensure!(
            f.count("target").await? == 0,
            "MySQL preparation touched target"
        );
        Ok(())
    }
    .await;
    f.engine.close().await?;
    result
}
