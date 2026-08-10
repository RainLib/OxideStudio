# ADR-0021: Project DDL baselines are review-only

## Status

Accepted.

## Context

Projects often keep schema definitions in SQL files before a live database is
available, and users may also import a standalone database dump. Those files
are useful for reviewing expected structure, but a bounded parser cannot safely
prove a complete dialect, include graph, template expansion, version contract,
or the source fingerprint needed for executable migrations.

## Decision

- Parse one selected bounded project SQL document, the deterministic bounded
  eligible project SQL set, or one standalone SQL file capped at 8 MiB.
- Detect PostgreSQL, MySQL, SQL Server, SQLite and Oracle markers. When a source
  is portable, use the target connection driver only as a parsing preference.
- Parse a bounded `CREATE TABLE` / `CREATE INDEX` subset, including common
  multiword and precision types, standalone and inline indexes, columns,
  primary/unique keys and supported table-level or inline foreign keys.
- Represent `VIEW` and `MATERIALIZED VIEW` as review-only relations. Infer only
  explicit column lists or conservative top-level `SELECT` names, use an
  `UNKNOWN` type, and never retain or execute the view body.
- Represent `CREATE TYPE ... AS ENUM` and `CREATE SEQUENCE` as descriptor-only
  schema objects. Include them in the offline fingerprint, but force their
  diff entries into manual review because source DDL is intentionally absent.
- Detect generated expressions and emit an explicit omission warning. Do not
  put generated SQL into `default_value` or any executable migration field.
- Preserve unsupported syntax as explicit warnings instead of guessing.
- Store every relative source path and the `OFFLINE_PROJECT_DDL_REVIEW_ONLY`
  marker on the snapshot.
- Allow these snapshots in diagrams and schema-diff review.
- Disable Apply in the UI and reject the marker again in the Rust migration
  command before fingerprint validation or process/database execution.

## Consequences

This adds useful offline drift review and editable structured drafts without
treating a convenience parser as a migration engine. Full executable DDL
support requires a dialect-owned parser, source dependency and fingerprint
contract, preflight generation, and post-apply verification for that database
family. Partitioning, complete dialect grammars, lossless generated
expressions, dependency ordering and executable object source remain explicit
review gaps.
