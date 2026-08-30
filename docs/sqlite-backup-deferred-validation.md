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
- Remote SQLite backup/restore is excluded until D13 provides the signed, version-pinned worker, confirmed SSH host key, bounded remote transfer path, and cleanup receipt.
