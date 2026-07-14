# ADR-0004: CSV import preflight and transaction boundary

- Status: Accepted
- Date: 2026-07-15
- Scope: DG-P0-07 CSV Import Mapping

## Context

The original table import path read a browser `File` as UTF-8, assumed comma delimiters and a header row, matched headers implicitly, then wrote immediately. Users could not inspect mappings or type failures before the database mutation. Moving parsing directly into every database driver would duplicate UX policy and type diagnostics, while sending one mutation per row would lose atomicity and create unnecessary IPC overhead.

## Decision

The P0 import path is a two-phase workflow:

1. The frontend decodes and parses a bounded file, shows a 50-row bounded preview, and builds an explicit source-to-target column map.
2. The frontend validates NULL semantics and typed values with the same value model used by the data editor.
3. Only an error-free, user-confirmed plan is sent once through `mutate_table_rows`.
4. PostgreSQL and MySQL execute the generated parameterized statements inside their existing explicit `BEGIN` / `COMMIT` batch. Any statement failure triggers `ROLLBACK`.

Automatic decoding recognizes UTF-8 and UTF-16 BOMs; users may explicitly select UTF-8, UTF-16 LE/BE, or GB18030. Delimiter inference considers comma, semicolon, tab, and pipe, while retaining an explicit single-character override. Header matching is case-insensitive only when it resolves to one canonical target column. Files without headers map by position.

The browser path has hard safety limits of 32 MiB and 100,000 data rows. It renders at most 50 preview rows and reports at most 200 detailed validation errors while retaining the total count. Oversized imports are rejected before mutation rather than risking UI or memory exhaustion.

## Consequences

- Selecting a file never writes to the database; import requires a separate confirmation.
- Mapping and type errors are deterministic and visible before the transaction starts.
- Existing backend relation gates, parameter casts, and rollback behavior remain authoritative.
- The bounded frontend parser is appropriate for interactive imports, but not bulk ingestion.
- P1 will add a native Rust streaming importer with incremental decoding/parsing, prepared batch execution inside one transaction, progress, and cancellation. The P0 limits stay in place until that path exists.
