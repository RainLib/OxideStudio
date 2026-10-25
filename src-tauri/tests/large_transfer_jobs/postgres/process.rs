use super::*;
use crate::process::{launch, memory_peak};

#[tokio::test]
#[ignore = "explicit PostgreSQL million-row forced-kill, offline-source and memory acceptance"]
async fn postgres_million_row_transfer_survives_process_kill() -> Result<()> {
    ensure!(
        cfg!(any(windows, target_os = "linux")),
        "actual OS memory counters are required"
    );
    let mut fixture = PgFixture::new(0).await?;
    let result = async {
        sqlx::raw_sql(&format!("DROP TABLE {source},{target}; CREATE TABLE {source}(id bigint PRIMARY KEY,text_value text,large_integer bigint,bytes bytea); CREATE TABLE {target}(LIKE {source} INCLUDING ALL); INSERT INTO {source} SELECT i,'文本-'||i,9007199254740993+i,decode(repeat('ab',64),'hex') FROM generate_series(1,1000000::bigint) i", source=fixture.table("source"), target=fixture.table("target"))).execute(&mut fixture.admin).await?;
        let mut request = fixture.request(LargeTransferMode::Append); request.batch_rows = 1000;
        std::fs::write(fixture.root.path().join("request.json"), serde_json::to_vec(&request)?)?;
        let started = Instant::now(); let deadline = started + Duration::from_secs(900);
        let mut initial = launch(fixture.root.path(), "initial")?;
        let mut initial_peak = 0; let mut next_report = Instant::now();
        let id = loop {
            ensure!(initial.0.try_wait()?.is_none(), "initial PostgreSQL helper exited; inspect {}", fixture.root.path().display());
            initial_peak = initial_peak.max(memory_peak(&initial.0)?);
            if let Ok(bytes) = std::fs::read(fixture.root.path().join("review.json")) {
                if let Ok(review) = serde_json::from_slice::<oxide_studio_lib::core::transfer_jobs::LargeTransferPreview>(&bytes) {
                    if fixture.jobs.get("p", &review.job.id).await?.rows_staged >= 2000 { break review.job.id; }
                }
            }
            if Instant::now() >= next_report {
                println!("PostgreSQL million-row helper preparing/staging; elapsed {}s", started.elapsed().as_secs()); next_report = Instant::now() + Duration::from_secs(10);
            }
            ensure!(Instant::now() < deadline, "initial PostgreSQL helper timed out"); tokio::time::sleep(Duration::from_millis(30)).await;
        };
        initial.0.kill()?; initial.0.wait()?;
        let interrupted = fixture.jobs.get("p", &id).await?;
        ensure!(interrupted.phase == Phase::Paused && interrupted.rows_staged >= 2000 && interrupted.rows_staged < 1_000_000, "interrupted checkpoint must be resumable");
        ensure!(fixture.count("target").await? == 0, "target stays unchanged before publication");
        fixture.offline().await?;
        println!("PostgreSQL helper killed after {} rows; source route is offline", interrupted.rows_staged);
        let mut successor = launch(fixture.root.path(), "resume")?; let mut resumed_peak = 0;
        let complete = loop {
            ensure!(successor.0.try_wait()?.is_none(), "resume helper exited; inspect {}", fixture.root.path().display());
            resumed_peak = resumed_peak.max(memory_peak(&successor.0)?);
            if let Ok(bytes) = std::fs::read(fixture.root.path().join("complete.json")) { if let Ok(job) = serde_json::from_slice::<LargeTransferSummary>(&bytes) { break job; } }
            if Instant::now() >= next_report {
                let job = fixture.jobs.get("p", &id).await?; println!("PostgreSQL million-row resume: {:?}, {} rows staged", job.phase, job.rows_staged); next_report = Instant::now() + Duration::from_secs(10);
            }
            ensure!(Instant::now() < deadline, "resume helper timed out"); tokio::time::sleep(Duration::from_millis(50)).await;
        };
        ensure!(complete.phase == Phase::Completed && complete.rows_staged == 1_000_000 && complete.batches == 1000, "million-row PostgreSQL counts");
        let actual = sqlx::query(&format!("SELECT COUNT(*) n,COUNT(DISTINCT id) distinct_ids,MIN(id) first,MAX(id) last,MIN(large_integer) large,SUM(octet_length(bytes)) bytes,BOOL_AND(COALESCE(large_integer=9007199254740993+id AND text_value='文本-'||id AND bytes=decode(repeat('ab',64),'hex'),false)) AS data_verified FROM {}", fixture.table("target"))).fetch_one(&mut fixture.admin).await?;
        ensure!(actual.try_get::<i64,_>("n")? == 1_000_000 && actual.try_get::<i64,_>("distinct_ids")? == 1_000_000 && actual.try_get::<i64,_>("first")? == 1 && actual.try_get::<i64,_>("last")? == 1_000_000, "no missing or duplicate keys");
        ensure!(actual.try_get::<i64,_>("large")? == 9_007_199_254_740_994 && actual.try_get::<i64,_>("bytes")? == 64_000_000, "native integer and binary totals");
        ensure!(actual.try_get::<bool,_>("data_verified")?,"all integer, UTF-8 and binary source values must match");
        ensure!(fixture.count(&receipt_table(&id)).await? == 1, "one final receipt");
        std::fs::write(fixture.root.path().join("release-helper"), b"done")?; ensure!(successor.0.wait()?.success(), "resume helper exits successfully");
        ensure!(!fixture.root.path().join(format!("profile/large-transfers/{id}.snapshot.sqlite")).exists(), "snapshot removed");
        ensure!(initial_peak > 0 && resumed_peak > 0 && initial_peak < 192*1024*1024 && resumed_peak < 192*1024*1024, "helper memory budget exceeded");
        let evidence = json!({"engine":"postgres","rows":1_000_000,"batches":complete.batches,"interruptedAfterRows":interrupted.rows_staged,"initialPeakWorkingSetBytes":initial_peak,"resumedPeakWorkingSetBytes":resumed_peak,"snapshotBytes":complete.snapshot_bytes,"elapsedMilliseconds":started.elapsed().as_millis(),"sourceOfflineDuringResume":true,"rowsBeforePublication":0,"duplicateIds":0,"allSourceValuesVerified":true,"bothOwnedHelpersExited":true});
        if let Some(path) = std::env::var_os("OXIDE_POSTGRES_TRANSFER_EVIDENCE") { std::fs::write(path, serde_json::to_vec_pretty(&evidence)?)?; }
        println!("{evidence}"); Ok(())
    }.await;
    fixture.cleanup().await?;
    result
}
