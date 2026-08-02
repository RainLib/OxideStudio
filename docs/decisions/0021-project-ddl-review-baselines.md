# ADR-0021: Project DDL baselines are review-only

## Status

Accepted.

## Context

Projects often keep schema definitions in SQL files before a live database is
available. Those files are useful for reviewing expected structure, but a
generic parser cannot safely prove a complete dialect, include graph, template
expansion, version contract, or the source fingerprint needed for executable
migrations.

## Decision

- Parse one selected bounded project SQL document or the deterministic bounded
  eligible project SQL set, using a portable `CREATE TABLE` / `CREATE INDEX`
  subset, including columns and supported key constraints.
- Preserve unsupported syntax as explicit warnings instead of guessing.
- Store every relative source path and the `OFFLINE_PROJECT_DDL_REVIEW_ONLY`
  marker on the snapshot.
- Allow these snapshots in diagrams and schema-diff review.
- Disable Apply in the UI and reject the marker again in the Rust migration
  command before fingerprint validation or process/database execution.

## Consequences

This adds useful offline drift review without treating a convenience parser as
a migration engine. Full executable DDL support requires a dialect-owned
parser, source dependency and fingerprint contract, preflight generation, and
post-apply verification for that database family.
