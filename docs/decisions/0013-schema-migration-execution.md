# ADR-0013: Fingerprint-bound schema migration execution

- Status: Accepted
- Date: 2026-07-26
- Scope: DG-P1-01 Schema migration apply, journal, verification, and rollback artifact

## Context

A reviewed migration artifact is not safe to execute later without revalidating the live target. Another client can change the schema after capture, generated data checks can fail, and a multi-statement DDL sequence can leave a partial result unless the driver provides real transactional DDL. An execution UI must also distinguish “attempted”, “rolled back”, “committed but not verified”, and “verified” instead of treating every completed request as success.

MySQL DDL can implicitly commit, so the PostgreSQL transaction contract cannot be represented honestly on that driver.

## Decision

`execute_schema_migration` accepts the desired source snapshot, the reviewed target snapshot, the approved plan id and target fingerprint, the exact typed `connection / database / schema` target, and separate manual-review/destructive approvals. It never accepts executable SQL from the frontend.

Before any query, Rust recomputes both snapshot fingerprints and the reviewed plan. It rejects project, plan, fingerprint, target-schema, driver, approval, empty-SQL, and blocked-change mismatches. It then captures the live target again. A different live fingerprint or recomputed plan id fails closed and requires a new review.

Generated preflight checks carry a machine-readable assertion:

- advisory count for relation/column drops;
- zero-value assertion for required-column, `SET NOT NULL`, and foreign-key checks;
- empty-result assertion for UNIQUE duplicate checks.

Query errors, missing result columns, and non-numeric count values block execution. Journal records contain only status and bounded observations such as counts or row counts; duplicate key values and other returned business data are not persisted.

For PostgreSQL, the backend flattens the freshly recomputed ordered changes into the existing database-scoped parameterized batch API. That driver owns `BEGIN`, executes all statements on one connection, rolls back on the first error, and commits only after every statement succeeds. A failed batch reports zero committed statements. For MySQL, the caller must acknowledge a separate non-transactional approval. The backend executes one reviewed statement at a time and persists the journal after each successful statement. On failure it reports the exact number of statements that may already have committed; it never labels this path atomic or rolled back.

For an eligible SQLite existing-table rebuild, the Host captures exact table,
index and trigger definitions from `sqlite_schema`. Apply creates and verifies a
recovery backup, disables foreign-key enforcement only on the owned connection,
holds an immediate write transaction, creates/copies/renames the replacement,
replays exact indexes and triggers, runs `foreign_key_check`, and restores the
original pragma state. Missing catalog definitions, unsafe backfill, malformed
or additional statements, unsupported relation create/drop and views remain
review-only. Remote SQLite uses the same statement contract through the signed,
version-pinned worker.

After commit, Rust captures the live target again and compares it with the desired source. The journal distinguishes `succeeded` from `verificationFailed`; a committed migration is never relabeled as rolled back when only recapture or comparison failed.

Before apply, Rust also builds a reverse comparison from the expected post-migration structure to the fresh pre-migration target. Rollback SQL is published only when every forward change is reversible and the reverse plan has no blocked or empty-SQL changes. It remains a `ROLLBACK`-guarded review artifact and is never executed automatically.

Execution records are upserted into the project/connection-scoped MetaStore resource collection before preflight, after preflight, and at the terminal state. The Schema Diff tab exposes the current result and recent persisted journal entries.

## Consequences

- PostgreSQL now has an explicit confirm → refresh/recompute → preflight → atomic apply → post-verify lifecycle.
- MySQL has an explicit confirm → refresh/recompute → preflight → sequential, journaled apply → post-verify lifecycle, with partial commit risk visible before execution.
- Eligible SQLite existing-table changes have a backup-bound, transactional,
  catalog-exact rebuild path; incomplete changes continue to fail closed.
- Stale artifacts and tampered snapshot contents cannot reach DDL execution through this command.
- Transaction failure and post-commit verification failure are represented separately.
- A process crash can leave a durable `running` record. The next journal read now converts records that are not active in the current process to `interrupted`, with an explicit recapture-and-review requirement; it never attempts to resume them. A currently executing migration is tracked in-process so it is not falsely converted by a concurrent journal refresh.
- MySQL cannot provide PostgreSQL-style rollback. An interrupted journal reports the number of statements durably recorded before the interruption, but recovery remains a fresh snapshot/diff workflow rather than automatic replay.
- Snapshots from different drivers can now be compared as a metadata-only review plan when they share an explicit schema mapping. It shows missing/changed relations, columns, indexes and constraints, but contains no SQL and cannot pass the migration execution gate. Cross-driver type mapping, DDL generation and data copy remain separate conformance-gated workflows.
- Rename inference, complete view/routine/trigger/sequence/grant source, full cross-object dependency capture, cross-driver type mapping, and an independent server dry-run remain P1 work.
