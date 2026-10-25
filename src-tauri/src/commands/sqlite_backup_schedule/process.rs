use super::control::read_control;
use super::leadership::{ready_or_pending, register_desktop};
use super::state::{open_lease, try_exclusive, SqliteBackupScheduleState};
use std::process::{Command, Stdio};
use std::time::Duration;

pub(super) fn hide_process(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
}

pub(super) async fn ensure_worker(state: &SqliteBackupScheduleState) -> Result<(), String> {
    {
        let _data = state.lock_data().await?;
        if read_control(state.root())?.is_some_and(|control| control.installation.is_some()) {
            return Ok(());
        }
    }
    register_desktop(state).await?;
    let _startup = state.lock_startup().await?;
    {
        let _data = state.lock_data().await?;
        if read_control(state.root())?.is_some_and(|control| control.installation.is_some()) {
            return Ok(());
        }
    }
    if ready_or_pending(state).await? {
        return Ok(());
    }
    let start_lock = open_lease(&state.root().join("worker-start.lock"))?;
    if !try_exclusive(&start_lock)? {
        return Ok(());
    }
    if ready_or_pending(state).await? {
        return Ok(());
    }
    let executable =
        std::env::current_exe().map_err(|_| "Cannot locate the desktop backup worker")?;
    let mut command = Command::new(executable);
    command
        .arg("--backup-worker")
        .arg("--data-dir")
        .arg(state.root().parent().expect("data directory"))
        .arg("--config-dir")
        .arg(&state.config_dir);
    hide_process(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| "Cannot start the desktop backup worker".to_string())?;
    // Reap on Unix without tying the child's lifetime to the desktop process.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    drop(start_lock);
    for _ in 0..60 {
        if ready_or_pending(state).await? {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Err("The backup worker did not start; reopen OxideStudio and retry".to_string())
}
