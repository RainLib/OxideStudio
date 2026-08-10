# PostgreSQL Schema Backup Deferred Validation

## Phase 128 -- Views and materialized views

- Restore a schema containing a base table, a view that depends on it, a second view that depends on the first, and a materialized view. Confirm the emitted file restores all relations in dependency order and the materialized view has the expected rows.
- Repeat with non-default view options, an unpopulated materialized view, and indexes on a materialized view. These attributes remain explicitly out of scope and must remain listed in the export result rather than silently degrading during restore.
- Exercise cancellation while the exporter is reading view definitions and confirm that the partial file is removed and no final file is published.

## Static validation completed

- `cargo check --manifest-path src-tauri/Cargo.toml` completed successfully.
- The focused Rust test binary compilation was started with `cargo test ... --no-run` but exceeded the local 60-second command limit. Neither that test nor a real PostgreSQL restore is recorded as passed.
