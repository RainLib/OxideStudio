# DBX alignment: deferred validation queue

Implementation work is intentionally being completed before these checks run.
Do not mark a capability as production-ready or count it toward the 70+
database target until its relevant queue entries pass.

## Multi-table data transfer

- Exercise parent-to-child FK ordering against PostgreSQL, MySQL/MariaDB, and
  SQLite with empty tables, non-empty tables, and a selected subset that omits
  a referenced parent.
- Prove that one target transaction spans all selected tables: inject a write
  failure and a cancellation in a later table, then verify no earlier table
  has committed rows or overwrite deletes.
- Verify confirmation rejection after changes to FK metadata, source/target
  column mapping, target overwrite row count, row limit, or batch size.
- Verify that FK cycles are rejected until a driver explicitly supplies a
  reviewed defer/disable-constraints capability.
- Verify per-table terminal reports contain only endpoint identifiers,
  counts, status, and plan digests; they must never persist credentials, URLs,
  SQL, bound parameters, or row values.
- Verify progress totals, cancellation propagation to the source query, and
  Explorer batch-selection behavior (including a target schema with one
  missing same-named table and a selection changed after preview).

## Existing transfer and migration work

- Verify PostgreSQL serial and identity reseed previews against empty/non-empty
  targets, a target without owned generators, rollback after a reseed failure,
  and stale-token rejection when the reseed option changes. Confirm reseed SQL
  runs before the copy transaction commits.
- Run append baseline and overwrite post-commit verification tests under
  concurrent target writers; append must remain `needs review` until a stable
  baseline is implemented.
- Test identity/sequence reseed planning and schema-object transfer only after
  a product-specific capability contract and source-DDL conformance fixture
  exist.

## Connection configuration import

- Validate DataGrip, DBeaver, and Navicat XML/NCX fixtures containing quoted
  attribute values, IPv6 endpoints, unsupported products, duplicate names,
  encrypted/opaque password fields, folder/group metadata, and sensitive URL
  parameters. Imported objects must contain no credential, token, SSH-key, or
  local-driver-path material.
- Define and verify an explicit duplicate-connection merge policy before
  enabling overwrite/field merge. Current policy preserves an existing local
  connection and excludes an incoming candidate with the same non-secret
  driver/host/port/database/user identity; verify unknown/incomplete endpoint
  metadata stays selectable and imported names remain deterministic.

## Table export atomic finalization

- Inject write, flush, and rename failures for CSV, JSON, and SQL exports.
  The final destination must not appear before finalization; any generated
  sibling `.partial` file must be removed on every error path.
- Verify a completed export is visible at the returned final path and its
  content is complete for each supported format. Cancellation, progress,
  backpressure, encoding/BOM, and durable report behavior are verified in the
  separate cases below.

## Table export cancellation and progress

- Start CSV, JSON, and SQL exports large enough to span multiple pages. Verify
  each progress event is scoped by the stable export ID, rows and batches are
  monotonic, and exactly one terminal `done` event matches the command result.
- Cancel an unparameterized export while its tracked database query is active.
  Verify backend cancellation is requested, the command returns
  `TABLE_EXPORT_CANCELLED`, the task becomes cancelled, and no final or sibling
  `.partial` file remains.
- Repeat cancellation with structured filters so the parameterized query path
  exits through the cooperative watch channel. Verify cancellation during a
  query and between pages both preserve the last reported row/batch counts.
- Exercise invalid, duplicate, already-completed, and replayed export IDs.
  Verify they cannot cancel or receive progress for another export or
  connection.
- Verify a successful, cancelled, and failed export each create exactly one
  project-and-connection-scoped report with the expected ID, object identity,
  format, counts and terminal status. Confirm the report excludes file paths,
  SQL, filters, parameters, row values, URLs, credentials, and raw driver
  errors; a report-store failure must not turn an already-finalized export into
  a failed export.
- Verify CSV exports with and without UTF-8 BOM; the BOM must be exactly the
  leading three bytes and must not appear in JSON or SQL exports. Verify
  cancellation from both the table-data toolbar and the Explorer table
  context menu reaches the same export ID and produces one cancelled terminal
  report. Backpressure and resume semantics remain implementation gaps and
  therefore cannot yet be validated as supported behavior.

## Reviewed table-import file binding

- For CSV, JSON, JSONL/NDJSON, and XLSX, preview a file, mutate or replace it,
  then submit the original digest. Execution must reject it before opening the
  write transaction. A matching digest must allow the existing transaction
  flow unchanged.
- Verify malformed and mixed-case digest inputs, maximum-size streaming CSV
  files, and that the hash token is returned only to the requesting UI and is
  neither logged nor persisted with imported row data.

## External driver runtime telemetry

- Verify launch and observed-exit counters with a controlled sidecar crash,
  reconnect, connection replacement, and normal disconnect. Counters must be
  package/version scoped, deduplicate repeated polling of the same exited
  sidecar, and never expose connection identifiers, stderr, SQL, or secrets.

## Driver, LSP, and SQL-editor alignment

- Run driver conformance for every signed package/server-version pair,
  including connect, metadata, query, parameter binding, cancellation, and
  normalized error mapping. The catalog must remain candidate-only without
  evidence.
- With a live external sidecar, verify the Driver Manager refreshes its
  process-health summary after an unexpected sidecar exit without exposing
  connection names, URLs, stderr, SQL, or credentials.
- Run the SQL semantic corpus across the bundled LSP and Monaco fallback for
  CTE shadowing, correlated subqueries, table functions, dialect quoting, and
  INSERT value hints.
- Exercise Monaco command-palette SQL intentions for quoted identifiers,
  escaped identifiers, malformed selections, clipboard permission denial, and
  IN-list values containing quotes, NULLs, numbers, and a 1,000-value bound.
- Repeat those intention cases with multiple selections, including one invalid
  selection; the all-or-nothing edit must leave the entire document unchanged.
- Validate the generic JDBC agent against H2 plus vendor packages after a JDK
  and signed vendor jars are available; record results as conformance evidence
  rather than local claims.

## Explorer schema object descriptors

- Verify PostgreSQL sequence, non-internal trigger, domain, enum type,
  composite/range/multirange type, extension and partition discovery across schemas, quoted names, comments,
  trigger/partition parents, empty schemas, permission errors,
  connection/schema switches, and refreshes. Descriptors must remain read-only
  and must not enable table data editing, generated DDL, or migration actions.

## Schema snapshot descriptor drift

- Capture two PostgreSQL snapshots containing sequence, non-internal trigger,
  domain, enum type, composite/range/multirange type, extension and partition descriptors. Verify additions,
  removals, parent/comment changes, deterministic fingerprints, and old
  snapshots without `schemaObjects` remain readable.
- Verify descriptor catalog permission failure is retained as a snapshot
  warning while relation/routine capture continues. Descriptor drift must
  always be manual-review, contain no SQL/preflight commands, and block
  automatic migration execution.

## Database administration metrics

- Verify the fixed read-only PostgreSQL metric query against ordinary and
  restricted roles: connections, active queries, shared-buffer hit rate,
  commit/rollback counters, and current-database size must either be accurate
  or fail as a visible permission/capability error; no missing counter may be
  presented as zero.
- Verify MySQL/MariaDB connections, active non-idle queries, and current
  schema allocated bytes across supported server versions. Explicitly record
  that cache and transaction counters remain unavailable until a
  product-specific, privilege-safe semantic metrics protocol is introduced.
- Confirm that metrics are only available for native PostgreSQL/MySQL/MariaDB
  connections, refresh without retaining historical server values, and never
  expose SQL text, credentials, connection URLs, or process stderr.

## Database lock waits

- Create a controlled blocking transaction and verify each visible wait edge
  correctly links waiting and blocking backend IDs, users, database, wait
  event, and elapsed time without returning either query's SQL text.
- Verify PostgreSQL no-edge, multiple blockers, permission-restricted roles,
  reconnects, and refreshes.
- Create controlled InnoDB blocking transactions for MySQL 8 and a supported
  MariaDB/legacy MySQL version. Verify the modern `performance_schema`
  protocol is preferred, the legacy `information_schema` fallback is used only
  when needed, each edge has stable waiting/blocking IDs, and neither path
  returns SQL text or lock payloads. Verify missing privilege/system views are
  surfaced as capability errors rather than an empty result.

## Database role memberships

- Validate PostgreSQL `pg_auth_members`, MySQL 8 `mysql.role_edges`, and a
  supported MariaDB/legacy MySQL `mysql.roles_mapping` fixture. Confirm role
  and member names retain account host qualifiers where applicable, no SQL or
  grants are returned, and a missing metadata privilege is surfaced visibly.

## Visible table privileges

- Verify the bounded PostgreSQL and MySQL/MariaDB table-privilege views with
  ordinary and privilege-restricted roles. Ensure grantee, schema, table, and
  privilege remain visible, while no grant mutation is offered by the UI.

## PostgreSQL routine source

- Verify overloaded functions and procedures, quoted schema/routine names,
  permission-restricted routines, source values above the per-definition
  bound, and absence of source access for external driver packages. The menu
  must copy source only and never expose migration or mutation actions.

## Table import mapping audit

- For CSV imports with explicit mappings and defaults, verify one terminal
  project-and-connection-scoped report contains the expected import ID,
  object, format, mapping digest, counts, and status. Repeat for JSON, JSONL,
  and XLSX, whose digest represents implicit mapping mode.
- Verify successful and failed imports never persist source paths, source-file
  digests, SQL, row values, URLs, credentials, or raw driver errors. A local
  report-store failure must not turn an already-committed import into failure.
- Reject-row artifacts, per-row error isolation, resume tokens, and reports
  for browser-only non-UTF-8 CSV fallback remain implementation gaps.
- Verify UTF-8 native CSV confirmation performs the full-file preflight before
  opening a transaction. A rejected row must stop strict import, expose only
  bounded row numbers/error codes, and leave no target rows committed.

## SQLite rebuild review plans

- Validate generated rebuild artifacts against copies of SQLite databases with
  quoted identifiers, primary/unique/foreign/check constraints, compatible
  indexes, added nullable columns, dropped columns, and affinity-changing
  columns. The plan must retain only same-name source columns and recreate
  compatible indexes after the rename.
- Confirm each plan remains blocked from automatic execution and that the UI
  labels it as a rebuild review. Before any future apply capability, require a
  verified backup/restore path, pre/post `PRAGMA foreign_key_check`, failure
  recovery, and an explicit policy for required-column backfills, type
  conversions, expression/partial indexes, triggers, virtual tables, and
  views.
