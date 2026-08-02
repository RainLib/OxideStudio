# ADR-0005: Versioned schema snapshots and review-only migration artifacts

- Status: Accepted
- Date: 2026-07-15
- Scope: DG-P1-01 Schema snapshot + diff + migration preview

## Context

Comparing the mutable Database Explorer tree would make results depend on which nodes happen to be expanded, whether cache data is stale, and which PostgreSQL database is active. Generating and executing DDL in one action would also hide destructive changes and make MySQL auto-commit behavior unsafe.

DataGrip-class schema engineering needs a durable baseline, deterministic comparison direction, object-level risk, and a review surface that is independent from execution. It must remain responsive on schemas with hundreds of relations without saturating the connection pool.

## Decision

OxideStudio stores an immutable, versioned `SchemaSnapshot` scoped by:

`projectId + connectionId + driver + databaseName + schemaName`

Each snapshot contains normalized relation, column, index, and constraint metadata, a capture timestamp, and a SHA-256 structural fingerprint. It is persisted in the existing project-scoped MetaStore resource collection; malformed or unsupported snapshot versions are ignored rather than partially interpreted.

Live capture lists relations once, then fetches columns, indexes, and constraints concurrently per relation. Relation captures run through a six-permit concurrency gate so latency is bounded without issuing an unbounded number of database requests. Any relation failure aborts the capture; a partial structure is never saved as a valid baseline.

Comparison direction is explicit:

- source snapshot = desired structure;
- fresh target snapshot = actual live structure;
- generated plan = operations that would make target match source.

The Rust domain layer performs deterministic comparison and emits stable `SchemaChange` identities, risk (`safe`, `review`, `destructive`), reversibility, manual-review state, and dialect-aware SQL. PostgreSQL previews use `BEGIN` and end in `ROLLBACK` as a guard. MySQL previews warn that DDL may auto-commit. The artifact never executes SQL; users may copy it or open it in a query console, where normal execution safety applies.

Missing view/materialized-view/foreign-table definitions, empty captured structures, identity changes, destructive type changes, and foreign-key creation ordering are not guessed. They become explicit warnings or manual-review changes. Snapshots from different drivers may be compared only after an explicit schema mapping, and then produce a metadata-only, manual-review plan: no type mapping, migration SQL, or automatic apply is generated. Different schema names still require that explicit mapping instead of implicit identifier rewriting. Drivers without a host-owned DDL planner follow the same metadata-only path.

The frontend opens one reusable Schema Diff artifact tab per plan. Its migration rail separates safe, review, and destructive changes. `schemaDiff.revealChange` uses `tabId + schemaDiffId + schemaChangeId`; it validates the exact artifact and never relies on DOM selectors. Changes for objects that already exist can reveal the target in Database Explorer; relation-create changes stay in the artifact because the target object does not exist yet.

## Consequences

- Snapshot/diff results are reproducible and do not depend on Explorer expansion or cache state.
- Capture performs bounded parallel I/O and atomically rejects incomplete metadata.
- Migration SQL is reviewable but cannot bypass the existing query execution gate.
- The first version covers PostgreSQL/MySQL tables, columns, indexes, and constraints using currently captured metadata. SQLite, document/search backends, external packages without a host-owned DDL planner, and cross-driver comparisons remain review-only metadata diffs.
- Supported relation/column/index/constraint ordering and read-only preflight were added in [ADR-0006](0006-migration-dependency-preflight.md). Fingerprint-bound PostgreSQL apply, journal, post-verification, and conditional rollback generation were added in [ADR-0013](0013-schema-migration-execution.md). Full object source/dependency capture, rename detection, schema mapping, an independent server dry-run, and MySQL-safe apply remain P1 work.
- Snapshot deletion rewrites only the matching scoped resource collection; snapshots never cross project, connection, database, or schema boundaries.
