use super::*;
use crate::process::{launch, memory_peak};
use tokio::{
    net::{TcpListener, TcpStream},
    task::{JoinHandle, JoinSet},
};

struct SourceRoute {
    port: u16,
    task: Option<JoinHandle<()>>,
    url: String,
}
impl SourceRoute {
    async fn open(url: &str) -> Result<Self> {
        let mut endpoint = url::Url::parse(url)?;
        let host = endpoint
            .host_str()
            .context("missing MySQL fixture host")?
            .trim_matches(['[', ']'])
            .to_string();
        let server_port = endpoint.port().unwrap_or(3306);
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        endpoint.set_host(Some("127.0.0.1"))?;
        endpoint
            .set_port(Some(port))
            .map_err(|_| anyhow!("MySQL fixture proxy port"))?;
        let task = tokio::spawn(async move {
            let mut clients = JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((mut client, _)) = accepted else { break; };
                        let host = host.clone();
                        clients.spawn(async move {
                            if let Ok(mut server) = TcpStream::connect((host.as_str(), server_port)).await {
                                let _ = tokio::io::copy_bidirectional(&mut client, &mut server).await;
                            }
                        });
                    }
                    _ = clients.join_next(), if !clients.is_empty() => {}
                }
            }
            // Dropping JoinSet also aborts all existing routed connections.
        });
        Ok(Self {
            port,
            task: Some(task),
            url: endpoint.into(),
        })
    }
    async fn offline(&mut self) -> Result<()> {
        if let Some(task) = self.task.take() {
            task.abort();
            let _ = task.await;
        }
        ensure!(
            TcpStream::connect(("127.0.0.1", self.port)).await.is_err(),
            "MySQL source route must be offline"
        );
        Ok(())
    }
}
impl Drop for SourceRoute {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

#[tokio::test]
#[ignore = "explicit MySQL million-row forced-kill, offline-source and memory acceptance"]
async fn mysql_million_row_transfer_survives_process_kill() -> Result<()> {
    ensure!(
        cfg!(any(windows, target_os = "linux")),
        "actual OS memory counters are required"
    );
    let mut fixture = MysqlFixture::new(0).await?;
    let mut route = SourceRoute::open(&fixture.engine.url).await?;
    let result = async {
        fixture.meta.save_connection(&SavedConnection{id:"source".into(),project_id:"p".into(),name:"source".into(),driver:"mysql".into(),created_at:1,updated_at:1,config:json!({"id":"source","projectId":"p","name":"source","driver":"mysql","url":route.url})}).await?;
        let source = fixture.engine.table("source");
        let target = fixture.engine.table("target");
        for name in [&source, &target] {
            sqlx::query(&format!("DROP TABLE {name}")).execute(&mut fixture.engine.connection).await?;
            sqlx::query(&format!("CREATE TABLE {name}(id BIGINT PRIMARY KEY,text_value VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,large_integer BIGINT,bytes VARBINARY(64)) ENGINE=InnoDB")).execute(&mut fixture.engine.connection).await?;
        }
        sqlx::query(&format!("INSERT INTO {source} WITH digits AS (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9), numbers AS (SELECT 1+a.n+10*b.n+100*c.n+1000*d.n+10000*e.n+100000*f.n n FROM digits a CROSS JOIN digits b CROSS JOIN digits c CROSS JOIN digits d CROSS JOIN digits e CROSS JOIN digits f) SELECT n,CONCAT('文本-',n),9007199254740993+n,UNHEX(REPEAT('ab',64)) FROM numbers")).execute(&mut fixture.engine.connection).await?;
        ensure!(fixture.count("source").await? == 1_000_000, "MySQL million-row source fixture is incomplete");
        let mut request = fixture.request(LargeTransferMode::Append);
        request.batch_rows = 1000;
        std::fs::write(fixture.root.path().join("request.json"), serde_json::to_vec(&request)?)?;
        let started = Instant::now();
        let deadline = started + Duration::from_secs(900);
        let mut initial = launch(fixture.root.path(), "initial")?;
        let initial_pid = initial.0.id();
        let mut initial_peak = 0;
        let mut next_report = Instant::now();
        let id = loop {
            ensure!(initial.0.try_wait()?.is_none(), "initial MySQL helper exited; inspect {}", fixture.root.path().display());
            initial_peak = initial_peak.max(memory_peak(&initial.0)?);
            if fixture.root.path().join("initial.started.json").exists() {
              if let Ok(bytes) = std::fs::read(fixture.root.path().join("review.json")) {
                if let Ok(review) = serde_json::from_slice::<oxide_studio_lib::core::transfer_jobs::LargeTransferPreview>(&bytes) {
                    let job = fixture.jobs.get("p", &review.job.id).await?;
                    ensure!(job.phase != Phase::Paused, "initial MySQL helper paused: {:?}", job.issue);
                    if job.rows_staged >= 2000 { break review.job.id; }
                }
              }
            }
            if Instant::now() >= next_report {
                println!("MySQL million-row helper preparing/staging; elapsed {}s", started.elapsed().as_secs());
                next_report = Instant::now() + Duration::from_secs(10);
            }
            ensure!(Instant::now() < deadline, "initial MySQL helper timed out");
            tokio::time::sleep(Duration::from_millis(30)).await;
        };
        initial_peak = initial_peak.max(memory_peak(&initial.0)?);
        initial.0.kill()?;
        let killed = initial.0.wait()?;
        ensure!(!killed.success(), "initial MySQL helper must actually be forcibly terminated");
        let interrupted = fixture.jobs.get("p", &id).await?;
        ensure!(interrupted.phase == Phase::Paused && interrupted.rows_staged >= 2000 && interrupted.rows_staged < 1_000_000, "MySQL interrupted checkpoint is not resumable");
        ensure!(fixture.count("target").await? == 0, "MySQL target changed before publication");
        route.offline().await?;
        println!("MySQL helper killed after {} rows; source TCP route is offline", interrupted.rows_staged);
        let mut successor = launch(fixture.root.path(), "resume")?;
        next_report=Instant::now()+Duration::from_secs(10);
        let resumed_pid = successor.0.id();
        let mut resumed_peak = 0;
        let complete = loop {
            ensure!(successor.0.try_wait()?.is_none(), "resume MySQL helper exited; inspect {}", fixture.root.path().display());
            resumed_peak = resumed_peak.max(memory_peak(&successor.0)?);
            if let Ok(bytes) = std::fs::read(fixture.root.path().join("complete.json")) {
                if let Ok(job) = serde_json::from_slice::<LargeTransferSummary>(&bytes) { break job; }
            }
            if Instant::now() >= next_report {
                let job = fixture.jobs.get("p", &id).await?;
                println!("MySQL million-row resume: {:?}, {} rows staged", job.phase, job.rows_staged);
                next_report = Instant::now() + Duration::from_secs(10);
            }
            ensure!(Instant::now() < deadline, "resume MySQL helper timed out");
            tokio::time::sleep(Duration::from_millis(50)).await;
        };
        resumed_peak = resumed_peak.max(memory_peak(&successor.0)?);
        ensure!(complete.phase == Phase::Completed && complete.rows_staged == 1_000_000 && complete.batches == 1000, "MySQL million-row counts changed");
        let actual = sqlx::query(&format!("SELECT COUNT(*) n,COUNT(DISTINCT id) distinct_ids,MIN(id) first,MAX(id) last,MIN(large_integer) large,CAST(SUM(OCTET_LENGTH(bytes)) AS SIGNED) bytes,CAST(SUM(NOT COALESCE(large_integer=9007199254740993+id AND CAST(text_value AS BINARY)=CAST(CONCAT('文本-',id) AS BINARY) AND bytes=UNHEX(REPEAT('ab',64)),FALSE)) AS SIGNED) invalid_rows FROM {target}")).fetch_one(&mut fixture.engine.connection).await?;
        ensure!(actual.try_get::<i64,_>("n")? == 1_000_000 && actual.try_get::<i64,_>("distinct_ids")? == 1_000_000 && actual.try_get::<i64,_>("first")? == 1 && actual.try_get::<i64,_>("last")? == 1_000_000, "MySQL missing or duplicate primary keys");
        ensure!(actual.try_get::<i64,_>("large")? == 9_007_199_254_740_994 && actual.try_get::<i64,_>("bytes")? == 64_000_000 && actual.try_get::<i64,_>("invalid_rows")? == 0, "MySQL full native integer, UTF-8 and binary verification failed");
        ensure!(fixture.count(&format!("_oxide_transfer_receipt_{}", id.replace('-', ""))).await? == 1, "MySQL must retain one final receipt");
        ensure!(!fixture.root.path().join(format!("profile/large-transfers/{id}.snapshot.sqlite")).exists(), "MySQL source snapshot was not removed");
        ensure!(initial_peak > 0 && resumed_peak > 0 && initial_peak < 192*1024*1024 && resumed_peak < 192*1024*1024, "MySQL helper memory budget exceeded");
        std::fs::write(fixture.root.path().join("release-helper"), b"done")?;
        ensure!(successor.0.wait()?.success(), "resume MySQL helper did not exit successfully");
        let evidence = json!({"engine":"mysql","rows":1_000_000,"batches":complete.batches,"interruptedAfterRows":interrupted.rows_staged,"initialPid":initial_pid,"resumedPid":resumed_pid,"initialPeakWorkingSetBytes":initial_peak,"resumedPeakWorkingSetBytes":resumed_peak,"snapshotBytes":complete.snapshot_bytes,"elapsedMilliseconds":started.elapsed().as_millis(),"sourceOfflineDuringResume":true,"sourceRoutePort":route.port,"rowsBeforePublication":0,"duplicateIds":0,"allSourceValuesVerified":true,"finalReceiptRows":1,"snapshotRemoved":true,"initialHelperForciblyKilled":true,"bothOwnedHelpersExited":true});
        if let Some(path) = std::env::var_os("OXIDE_MYSQL_TRANSFER_EVIDENCE") { std::fs::write(path, serde_json::to_vec_pretty(&evidence)?)?; }
        println!("{evidence}");
        Ok(())
    }.await;
    let route_cleanup = route.offline().await;
    let database_cleanup = fixture.engine.close().await;
    if result.is_err() || route_cleanup.is_err() || database_cleanup.is_err() {
        eprintln!(
            "MySQL process fixture retained for diagnosis: {}",
            fixture.root.keep().display()
        );
    }
    route_cleanup?;
    database_cleanup?;
    result
}
