//! Host-bound sessions stop on input EOF even while the synchronous engine is
//! executing. The Host owns cleanup; abrupt exit deliberately leaves its tree
//! intact for safe recovery after the driver lease is released by the OS.
use std::{
    fs::OpenOptions,
    io::{self, BufRead, Read},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::sync_channel,
        Arc,
    },
    time::Duration,
};

pub(super) fn run(workspace: &Path) -> io::Result<()> {
    if !workspace.is_absolute() || !workspace.is_dir() {
        return Err(io::Error::other("Host workspace is unavailable"));
    }
    let lease = OpenOptions::new()
        .read(true)
        .write(true)
        .open(workspace.join("driver.lock"))?;
    lease
        .try_lock()
        .map_err(|error| io::Error::other(error.to_string()))?;
    let completed = Arc::new(AtomicBool::new(false));
    let finished = completed.clone();
    let (sender, receiver) = sync_channel(1);
    std::thread::spawn(move || {
        let stdin = io::stdin();
        let mut input = stdin.lock();
        loop {
            let mut bytes = Vec::new();
            let read = (&mut input)
                .take(4 * 1024 * 1024 + 1)
                .read_until(b'\n', &mut bytes);
            let line = match read {
                Ok(0) => break,
                Ok(_) if bytes.len() > 4 * 1024 * 1024 => {
                    Err(io::Error::other("Driver request exceeds 4 MiB"))
                }
                Ok(_) => String::from_utf8(bytes)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error)),
                Err(error) => Err(error),
            };
            let failed = line.is_err();
            // A Host serializes work per session. A full queue is an invalid
            // protocol peer; do not block the EOF watchdog behind its query.
            if sender.try_send(line).is_err() {
                std::process::exit(2);
            }
            if failed {
                break;
            }
        }
        drop(sender);
        for _ in 0..20 {
            if finished.load(Ordering::Acquire) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        // No user SQL survives a dead Host; no arbitrary PID is signalled.
        std::process::exit(0);
    });
    super::run_requests(receiver.into_iter());
    completed.store(true, Ordering::Release);
    drop(lease);
    Ok(())
}
