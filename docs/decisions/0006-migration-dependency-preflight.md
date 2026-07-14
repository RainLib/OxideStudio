# ADR-0006: Dependency-ordered migration plans and read-only preflight

- Status: Accepted
- Date: 2026-07-15
- Scope: DG-P1-01 Schema migration planning, phase 2

## Context

A flat list of correct DDL statements is not necessarily a correct migration. Foreign keys must be removed before referenced relations, new foreign keys must wait for both relations, and changed indexes or constraints must be dropped before dependent column changes and recreated afterward. A generator must also avoid the dangerous partial case where it emits a drop but cannot faithfully reconstruct the object.

Risk labels alone do not validate live data. `SET NOT NULL`, required-column additions, UNIQUE constraints, foreign keys, and destructive drops need read-only checks against the actual target before a user considers execution.

## Decision

Every `SchemaChange` now has a stable phase, one-based order, stable `dependsOn` ids, and an optional `blockedReason`. Supported phases are:

1. drop dependencies;
2. drop relations;
3. create relations;
4. alter relations;
5. create dependencies;
6. manual review.

The Rust planner builds and topologically orders a dependency graph from captured table, column, index, and constraint metadata. Foreign keys are never embedded in a new `CREATE TABLE`; they are separate changes that depend on the local and referenced relation creates. Target-only foreign keys are removed before either side is dropped. Changed indexes and constraints are split into drop and recreate changes.

If a type change references an unchanged index/constraint that the planner cannot yet rebuild as an explicit pair, the type change is blocked and its SQL is removed. If a replacement definition is unavailable, the preceding drop is blocked too. Blocked state propagates to dependent changes. A graph cycle clears executable SQL for the remaining changes and requires manual ordering; the planner never resolves a cycle by silently adding `CASCADE`.

For supported risks, the planner emits a separate read-only preflight script:

- row count before relation drop;
- populated-value count before column drop;
- table emptiness before adding a required column without a default;
- NULL count before `SET NOT NULL`;
- duplicate-key sample before UNIQUE;
- orphan-row count before FOREIGN KEY.

Migration and preflight remain separate artifact surfaces. A plan with any blocked change cannot be opened as a runnable migration console; its copied script also carries a `PLAN BLOCKED` banner. Opening preflight in a console does not grant migration approval. Migration execution is still outside this workflow.

## Consequences

- Supported DDL is deterministic and dependency ordered instead of alphabetically concatenated.
- The artifact clearly distinguishes risk from executability: a destructive change can be ordered but still require review, while a blocked change has no runnable SQL.
- Referential actions missing from MySQL metadata are not guessed; affected foreign keys stay blocked until exact source capture is added.
- Preflight queries are generated from quoted stable identities and contain no mutation.
- The graph currently covers relations, columns, indexes, and constraints represented by snapshot v1. Views, routines, triggers, sequences, grants, rename inference, cross-schema mapping, server-side dry-run, apply journal, verification queries, and rollback packages remain P1 work.
