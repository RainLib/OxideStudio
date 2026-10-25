use super::*;
#[cfg(target_os = "linux")]
use anyhow::Context;
use std::{
    fs::File,
    process::{Child, Command, Stdio},
};

pub(super) struct OwnedChild(pub(super) Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub(super) fn launch(root: &Path, attempt: &str) -> Result<OwnedChild> {
    let mut command = Command::new(std::env::current_exe()?);
    command
        .args([
            "--exact",
            "process::migration_process_helper",
            "--ignored",
            "--nocapture",
        ])
        .env("OXIDE_TRANSFER_FIXTURE_ROOT", root)
        .env("OXIDE_TRANSFER_FIXTURE_ATTEMPT", attempt)
        .stdin(Stdio::null())
        .stdout(File::create(root.join(format!("{attempt}.stdout.log")))?)
        .stderr(File::create(root.join(format!("{attempt}.stderr.log")))?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    Ok(OwnedChild(command.spawn()?))
}

#[cfg(windows)]
pub(super) fn memory_peak(child: &Child) -> Result<u64> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::ProcessStatus::{
        K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
    counters.cb = std::mem::size_of_val(&counters) as u32;
    if unsafe { K32GetProcessMemoryInfo(child.as_raw_handle(), &mut counters, counters.cb) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(counters.PeakWorkingSetSize as u64)
}
#[cfg(target_os = "linux")]
pub(super) fn memory_peak(child: &Child) -> Result<u64> {
    let status = std::fs::read_to_string(format!("/proc/{}/status", child.id()))?;
    let value = status
        .lines()
        .find_map(|line| line.strip_prefix("VmHWM:"))
        .context("missing process VmHWM")?;
    Ok(value
        .split_whitespace()
        .next()
        .context("missing VmHWM value")?
        .parse::<u64>()?
        * 1024)
}
#[cfg(not(any(windows, target_os = "linux")))]
pub(super) fn memory_peak(_child: &Child) -> Result<u64> {
    Ok(0)
}

#[tokio::test]
#[ignore = "helper invoked by the explicit million-row process acceptance"]
async fn migration_process_helper() -> Result<()> {
    let root = std::path::PathBuf::from(std::env::var("OXIDE_TRANSFER_FIXTURE_ROOT")?);
    let attempt = std::env::var("OXIDE_TRANSFER_FIXTURE_ATTEMPT")?;
    let meta = MetaStore::open(&root.join("profile")).await?;
    let jobs = open_jobs(&root, meta).await?;
    let preview: oxide_studio_lib::core::transfer_jobs::LargeTransferPreview =
        if attempt == "initial" {
            let request = serde_json::from_slice(&std::fs::read(root.join("request.json"))?)?;
            let preview = jobs.prepare(request).await?;
            std::fs::write(root.join("review.json"), serde_json::to_vec(&preview)?)?;
            preview
        } else {
            serde_json::from_slice(&std::fs::read(root.join("review.json"))?)?
        };
    let started = jobs
        .start("p", &preview.job.id, &preview.confirmation_token)
        .await?;
    std::fs::write(
        root.join(format!("{attempt}.started.json")),
        serde_json::to_vec(&started)?,
    )?;
    let deadline = Instant::now()
        + Duration::from_secs(
            if matches!(preview.job.source.driver.as_str(), "postgres" | "mysql") {
                900
            } else {
                180
            },
        );
    loop {
        let job = jobs.get("p", &preview.job.id).await?;
        if job.phase == Phase::Completed {
            std::fs::write(root.join("complete.json"), serde_json::to_vec(&job)?)?;
            break;
        }
        if matches!(job.phase, Phase::Paused | Phase::Failed | Phase::Cancelled) {
            return Err(anyhow!("helper stopped: {:?} {:?}", job.phase, job.issue));
        }
        if Instant::now() > deadline {
            return Err(anyhow!("migration helper timeout"));
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    // Parent captures the final OS peak while this exact process still exists.
    while !root.join("release-helper").exists() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    Ok(())
}

#[tokio::test]
#[ignore = "explicit real 1,000,000-row, forced-process-kill and memory acceptance"]
async fn million_row_transfer_survives_process_kill() -> Result<()> {
    let fixture = Fixture::new(1_000_000).await?;
    let mut request = fixture.request(LargeTransferMode::Append);
    request.batch_rows = 1000;
    std::fs::write(
        fixture.root.path().join("request.json"),
        serde_json::to_vec(&request)?,
    )?;
    let started = Instant::now();
    let mut initial = launch(fixture.root.path(), "initial")?;
    let deadline = Instant::now() + Duration::from_secs(180);
    let mut initial_peak = 0;
    let id = loop {
        assert!(
            initial.0.try_wait()?.is_none(),
            "initial helper exited; inspect {}",
            fixture.root.path().display()
        );
        initial_peak = initial_peak.max(memory_peak(&initial.0)?);
        if let Ok(bytes) = std::fs::read(fixture.root.path().join("review.json")) {
            if let Ok(preview) = serde_json::from_slice::<
                oxide_studio_lib::core::transfer_jobs::LargeTransferPreview,
            >(&bytes)
            {
                let job = fixture.jobs.get("p", &preview.job.id).await?;
                if job.rows_staged >= 2000 {
                    break preview.job.id;
                }
            }
        }
        assert!(
            Instant::now() < deadline,
            "initial helper did not stage a batch"
        );
        tokio::time::sleep(Duration::from_millis(30)).await;
    };
    initial.0.kill()?;
    initial.0.wait()?;
    let interrupted = fixture.jobs.get("p", &id).await?;
    assert_eq!(interrupted.phase, Phase::Paused);
    assert!(interrupted.rows_staged >= 2000 && interrupted.rows_staged < 1_000_000);
    let mut target = fixture.target().await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM items")
            .fetch_one(&mut target)
            .await?,
        0
    );
    std::fs::rename(
        fixture.root.path().join("source.sqlite"),
        fixture.root.path().join("offline-source.sqlite"),
    )?;
    let mut successor = launch(fixture.root.path(), "resume")?;
    let mut resumed_peak = 0;
    let completed = loop {
        assert!(
            successor.0.try_wait()?.is_none(),
            "resume helper exited; inspect {}",
            fixture.root.path().display()
        );
        resumed_peak = resumed_peak.max(memory_peak(&successor.0)?);
        if let Ok(bytes) = std::fs::read(fixture.root.path().join("complete.json")) {
            if let Ok(job) = serde_json::from_slice::<LargeTransferSummary>(&bytes) {
                break job;
            }
        }
        assert!(Instant::now() < deadline, "resumed helper did not publish");
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    assert_eq!(completed.phase, Phase::Completed);
    assert_eq!(completed.rows_staged, 1_000_000);
    assert_eq!(completed.batches, 1000);
    let actual=sqlx::query("SELECT COUNT(*) n,COUNT(DISTINCT id) distinct_ids,MIN(id) first,MAX(id) last,MIN(large_integer) large,SUM(length(bytes)) bytes FROM items").fetch_one(&mut target).await?;
    assert_eq!(actual.try_get::<i64, _>("n")?, 1_000_000);
    assert_eq!(actual.try_get::<i64, _>("distinct_ids")?, 1_000_000);
    assert_eq!(actual.try_get::<i64, _>("first")?, 1);
    assert_eq!(actual.try_get::<i64, _>("last")?, 1_000_000);
    assert_eq!(actual.try_get::<i64, _>("large")?, 9_007_199_254_740_994);
    assert_eq!(actual.try_get::<i64, _>("bytes")?, 64_000_000);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM \"{}\"", receipt_table(&id)))
            .fetch_one(&mut target)
            .await?,
        1
    );
    std::fs::write(fixture.root.path().join("release-helper"), b"done")?;
    assert!(successor.0.wait()?.success());
    assert!(!fixture
        .root
        .path()
        .join(format!("profile/large-transfers/{id}.snapshot.sqlite"))
        .exists());
    assert!(
        initial_peak < 192 * 1024 * 1024 && resumed_peak < 192 * 1024 * 1024,
        "unexpected helper memory peak"
    );
    let evidence = json!({"rows":1_000_000,"batches":completed.batches,"interruptedAfterRows":interrupted.rows_staged,
        "initialPeakWorkingSetBytes":initial_peak,"resumedPeakWorkingSetBytes":resumed_peak,
        "snapshotBytes":completed.snapshot_bytes,"elapsedMilliseconds":started.elapsed().as_millis(),
        "sourceOfflineDuringResume":true,"rowsBeforePublication":0,"duplicateIds":0,"bothOwnedHelpersExited":true});
    if let Some(path) = std::env::var_os("OXIDE_LARGE_TRANSFER_EVIDENCE") {
        std::fs::write(path, serde_json::to_vec_pretty(&evidence)?)?;
    }
    println!("{evidence}");
    Ok(())
}
