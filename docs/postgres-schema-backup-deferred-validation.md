# PostgreSQL Schema Backup Deferred Validation

## Phase 128 -- Views and materialized views

- Restore a schema containing a base table, a view that depends on it, a second view that depends on the first, and a materialized view. Confirm the emitted file restores all relations in dependency order and the materialized view has the expected rows.
- Repeat with non-default view options, an unpopulated materialized view, and indexes on a materialized view. Confirm the materialized-view indexes are emitted only after their relation is created and unpopulated views use `WITH NO DATA`. View options remain explicitly out of scope and must remain listed in the export result rather than silently degrading during restore.
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

## Phase 135 -- Domains

- Restore domains with parameterized base types, defaults, NOT NULL, and multiple named CHECK constraints, including quoted identifiers. Confirm domains are created before dependent table columns and retain their validation behavior.
- Verify multirange types remain an explicit backup boundary. Composite types and simple range types are emitted before dependent relations; ranges whose canonical or subtype-diff function is outside `pg_catalog` fail conservatively until their restore ordering is reviewed.
- `cargo check --manifest-path src-tauri/Cargo.toml` completed successfully. No database was opened.

## Phase 136 -- Range types

- Restore a range type with a built-in subtype, subtype opclass, collation, canonical function, and subtype-diff function. Confirm it is emitted before a dependent table and retains range operators and constraints after restore.
- Verify a range whose canonical or subtype-diff function is user-defined is rejected before a backup is finalized. Multirange types remain an explicit backup boundary until PostgreSQL-version capability handling is reviewed.
- `cargo check --manifest-path src-tauri/Cargo.toml` completed successfully. The focused Rust test binary compilation exceeded the local 60-second command limit; no database was opened.

## Phase 134 -- Enum types

- Restore enum-backed columns whose labels contain quotes, commas, Unicode, and a non-alphabetical declared order. Confirm `CREATE TYPE ... AS ENUM` runs before dependent tables and preserves ordering.
- Verify extensions that supply types are restored before user enum types. Domain, composite, and multirange type definitions remain explicit conservative-export boundaries; range types use the separately documented conservative restore contract.
- `cargo check --manifest-path src-tauri/Cargo.toml` completed successfully. No database was opened.

## Phase 133 -- Triggers

- Restore row-level and statement-level triggers that call SQL and PL/pgSQL routines. Confirm trigger DDL follows routine DDL and fires with the original timing, event, condition, and target relation.
- Verify internal constraint triggers are not emitted and an unavailable trigger function makes the restore transaction fail atomically.
- `cargo check --manifest-path src-tauri/Cargo.toml` completed successfully. No database was opened.

## Phase 132 -- Sequence ownership

- Restore serial and identity-backed tables, including a sequence owned by a non-primary-key column. Confirm each `ALTER SEQUENCE ... OWNED BY` follows table creation and that next-value behavior remains correct after restore.
- Verify an independently owned sequence remains unowned, and a missing owner relation produces an atomic restore failure rather than a finalized partial schema.
- `cargo check --manifest-path src-tauri/Cargo.toml` completed successfully. No database was opened.
