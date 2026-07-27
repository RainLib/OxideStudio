# ADR-0013: Fingerprint-bound PostgreSQL migration execution

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

For PostgreSQL, the backend flattens the freshly recomputed ordered changes into the existing database-scoped parameterized batch API. That driver owns `BEGIN`, executes all statements on one connection, rolls back on the first error, and commits only after every statement succeeds. A failed batch reports zero committed statements. Automatic apply is rejected for MySQL because its DDL auto-commit behavior cannot provide the same atomic contract.

After commit, Rust captures the live target again and compares it with the desired source. The journal distinguishes `succeeded` from `verificationFailed`; a committed migration is never relabeled as rolled back when only recapture or comparison failed.

Before apply, Rust also builds a reverse comparison from the expected post-migration structure to the fresh pre-migration target. Rollback SQL is published only when every forward change is reversible and the reverse plan has no blocked or empty-SQL changes. It remains a `ROLLBACK`-guarded review artifact and is never executed automatically.

Execution records are upserted into the project/connection-scoped MetaStore resource collection before preflight, after preflight, and at the terminal state. The Schema Diff tab exposes the current result and recent persisted journal entries.

## Consequences

- PostgreSQL now has an explicit confirm → refresh/recompute → preflight → atomic apply → post-verify lifecycle.
- Stale artifacts and tampered snapshot contents cannot reach DDL execution through this command.
- Transaction failure and post-commit verification failure are represented separately.
- A process crash can leave a durable `running` record. PostgreSQL rolls back an interrupted open transaction, but automatic startup reconciliation of interrupted journals is not yet implemented.
- MySQL keeps review/preflight/open-in-console only; automatic apply remains blocked until an equally honest execution and recovery contract exists.
- Rename inference, schema mapping, complete view/routine/trigger/sequence/grant source, full cross-object dependency capture, and an independent server dry-run remain P1 work.
