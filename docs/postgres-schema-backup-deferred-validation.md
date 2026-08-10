# PostgreSQL Schema Backup Deferred Validation

## Phase 128 -- Views and materialized views

- Restore a schema containing a base table, a view that depends on it, a second view that depends on the first, and a materialized view. Confirm the emitted file restores all relations in dependency order and the materialized view has the expected rows.
- Repeat with non-default view options, an unpopulated materialized view, and indexes on a materialized view. These attributes remain explicitly out of scope and must remain listed in the export result rather than silently degrading during restore.
- Exercise cancellation while the exporter is reading view definitions and confirm that the partial file is removed and no final file is published.

## Static validation completed

- `cargo check --manifest-path src-tauri/Cargo.toml` completed successfully.
- The focused Rust test binary compilation was started with `cargo test ... --no-run` but exceeded the local 60-second command limit. Neither that test nor a real PostgreSQL restore is recorded as passed.

## Phase 129 -- Functions and procedures

- Restore a schema containing overloaded SQL and PL/pgSQL functions, a procedure, and routines that refer to base relations and views. Confirm `pg_get_functiondef` output restores with the intended owner-independent behavior.
- Verify the explicit routine count and source-size limits fail before finalizing a file, and cancellation during routine discovery or write removes the partial output.
- `cargo check --manifest-path src-tauri/Cargo.toml` completed successfully. Real PostgreSQL restore and the focused Windows Rust test binary remain deferred.

## Phase 131 -- Extensions

- Restore a schema using an extension-provided type, operator, default, and function. Confirm extension DDL is emitted before dependent relation DDL and the target's compatible installed extension version is selected.
- Verify a target without the required extension fails atomically and leaves no finalized backup restore; extension version pinning, grants, and ownership remain outside the conservative export contract.
- `cargo check --manifest-path src-tauri/Cargo.toml` completed successfully. No database was opened.
