# SQLite Backup / Restore Deferred Validation

The local workflow is implemented and covered by native in-memory/file contract tests. The following real-file matrix remains intentionally deferred until the product-wide database validation phase.

- Back up a file database in WAL mode while concurrent readers and short writes are active. Confirm the resulting file includes committed WAL content, passes `PRAGMA integrity_check`, and never exposes an `.oxide-partial-*` file as the selected destination.
- Replace an existing backup on Windows, macOS, and Linux. Interrupt before and during publication and confirm either the previous destination or the complete new backup remains available.
- Restore databases at 1 MB, 1 GB, and the supported upper-size boundary. Measure preview SHA-256 time, online-backup duration, UI responsiveness, memory growth, and disk amplification from the automatic recovery point.
- Exhaust destination disk space during backup and recovery-point creation. Confirm the live database is unchanged, the prior destination survives, partial files are removed where possible, and the error does not expose connection credentials.
- Hold an explicit editor transaction and attempt backup/restore. Confirm the operation is rejected until commit/rollback. Repeat with concurrent non-transactional reads and short writes.
- Modify the restore source after preview without changing its name. Confirm execution rejects the stale plan because the SHA-256-bound token changes.
- Restore a corrupt file, a non-SQLite file, the live database file itself, and a SQLite file with a corrupt page. Confirm all are rejected before mutation.
- Force a restore failure after the automatic recovery point is complete. Confirm automatic rollback restores the original schema/data and the recovery receipt remains available for manual inspection.
- Force both restore and rollback verification to fail. Confirm the UI reports that manual verification is required and gives the exact app-data recovery path without exposing SQL or credentials.
- Restart Oxide after a successful restore and compare schema metadata, query results, foreign keys, indexes, triggers, generated columns, page size, journal mode, and user version.
- Validate memory-only SQLite backup and restore; confirm the one-connection pool does not deadlock and that a restored schema invalidates Explorer metadata.
- Remote SQLite backup/restore now uses the D13 signed, version-pinned worker, confirmed SSH host key, bounded transfer path, cancellation and cleanup receipt. Its real-host matrix remains deferred below; this document does not claim live infrastructure validation.

## Remote SQLite-over-SSH matrix

- Exercise unknown, mismatched and valid `known_hosts` entries. Confirm unknown or changed host keys fail before authentication, upload or database access.
- Test password and private-key authentication, including encrypted keys, on Linux x86_64 and aarch64 hosts. Confirm non-Linux and unsupported architectures fail with an actionable error before upload.
- Test session, persistent and preplaced worker placement. Confirm session workers are removed on normal exit and startup failure, persistent workers are reused only after digest verification, and a mismatched preplaced worker is never replaced implicitly.
- Publish the current signed worker, upgrade to the next worker version, and test a stale active pointer, invalid signature, manifest substitution, digest mismatch, redirect, 404 and oversized archive. Confirm only the exact desktop-compatible protocol/version becomes active.
- Repeat online backup/restore with WAL mode, concurrent short writes, multi-gigabyte databases, low remote/local disk space and a broken SSH transport. Confirm partial local and remote files are not published as successful backups.
- Cancel during worker backup, SSH download and restore. Confirm one interrupt is issued, the operation reaches a terminal state, and retry cannot reuse an ambiguous mutation receipt.
- Restart the app during session and persistent worker use. Confirm scheduled backup recovery does not switch the selected editor connection and no orphaned session worker remains.
- Verify Assistant Chat/Plan stays read-only, Agent mutation still requires an Oxide approval lease, and unclassified/production targets remain write-blocked over the remote driver.

## Scheduled backup matrix

The application now owns schedule persistence, due-time revalidation, native
backup progress/cancellation and retention. Unit tests do not replace these
desktop/filesystem checks:

- Run hourly, daily and weekly schedules across local-time DST gaps and repeated
  hours. Suspend the machine across one or several due times and confirm Oxide
  runs at most one bounded catch-up per schedule after the application is visible.
- Switch projects while schedules exist in both projects. Confirm only the active
  project's due work restores a session, and that background connection recovery
  never changes the selected data source, schema or editor tab.
- Cancel during page copy, integrity verification and publication. Confirm the run
  reaches `cancelled`, no final or partial file is published, and the next run can
  start without a stale active lease.
- Terminate Oxide during a running backup. On restart, confirm the persisted run is
  marked `interrupted`, its lease is gone, and it is never replayed automatically.
- Change, remove or replace the destination directory after saving a schedule.
  Confirm the Host records a bounded failed run, advances the next due time and
  never follows a symlink or publishes outside the reviewed canonical directory.
- Set retention to 1, 2 and 100, then generate more successful runs. Confirm only
  old ordinary files with the Host prefix in the run's own canonical directory are
  deleted; renamed files, symlinks and unrelated SQLite files remain untouched.
- Delete a schedule while completed history exists, then delete an individual run.
  Confirm the run-owned destination still permits safe file cleanup without the
  deleted schedule record.
- Corrupt `sqlite-schedules.json`, restart, and confirm the original bytes are
  quarantined in app data before an empty store is initialized. Verify a persisted
  `running` run is converted to `interrupted` atomically.
- Measure a multi-gigabyte backup while editing/querying another connection. Track
  WebView frame time, Rust memory, IPC polling volume and cancellation latency.

PostgreSQL/MySQL scheduled exports remain outside this completed SQLite schedule
contract. Remote SQLite-over-SSH logic is implemented, but the real-host matrix
above remains intentionally unclaimed until the product-wide validation phase.
