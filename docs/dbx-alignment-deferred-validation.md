# DBX alignment: deferred validation queue

Implementation work is intentionally being completed before these checks run.
Do not mark a capability as production-ready or count it toward the 70+
database target until its relevant queue entries pass.

## Completed non-database checks (2026-08-10)

- `npm test`: 204 test files and 1,042 tests passed. PostgreSQL remote-content,
  CSV import, cross-database table view, export progress and generated
  operation-ID mocks now follow the current frontend contract.
- `npm run build`: strict TypeScript, Vite production build and frontend bundle
  verification passed; the verifier found one startup module and no static
  import cycles.
- `cargo test --manifest-path src-tauri/Cargo.toml core::schema_diff::tests --lib`:
  25 schema diff and migration-planning unit tests passed.
- Targeted Rust SQL/TSV export and type-conversion review tests passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml` and `git diff --check` passed.
- The ChartDB metadata-query catalog unit suite passed for PostgreSQL,
  CockroachDB, MySQL, MariaDB, SQLite, SQL Server, ClickHouse and Oracle query
  contracts; no query was executed against a live database.
- The streaming XLSX writer unit suite passed, including a generated workbook
  reopened through `calamine`, XML escaping, boolean cells, Excel column limits
  and precision-safe integers above 15 digits.
- Structured diagram draft model tests passed for relation/column/index/FK
  editing, reference-safe renames, dependent cleanup, structural-sharing
  undo/redo and the offline snapshot marker. A Rust unit test confirms every
  Project DDL, DBML, metadata JSON and diagram-draft sentinel is rejected by
  the migration execution boundary.

Rust database integration targets (including `live_database`) remain outside
tag-release gating until runnable database fixtures are supplied. They are an
explicit deferred validation task rather than an implicit release check.

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

## LSP completion protocol and SQL snippets

- Verify all three SQL completion modes against PostgreSQL, MySQL, SQLite/DuckDB,
  SQL Server and Oracle connections: semantic-position mode must avoid comments,
  strings and non-SQL positions; prefix mode must wait for a name or qualifier;
  manual mode must issue no automatic LSP request while Ctrl/Cmd+Space still works.
- Use real schemas containing Chinese table/column names and ASCII names on each
  supported driver family. Verify pinyin initials, camel and fuzzy matching,
  deterministic ordering, live-LSP/cache deduplication, and no pinyin dictionary
  download or parse on editor startup and ordinary ASCII-only completion.
- Verify `INSERT INTO table (` all-column completion with quoted/non-ASCII names,
  identity/generated/default columns and placeholder navigation. Validate the
  intended include/exclude policy per database before declaring this aligned.
- Verify `SELECT *` and `alias.*` expansion for one and multiple sources, duplicate
  column names, quoted aliases, joins, views and schema-qualified objects. Multi-source
  output must remain unambiguous and preserve the typed alias where applicable.
- Verify PostgreSQL, MySQL, SQL Server, Oracle and ClickHouse completion items
  that use plain `TextEdit`, LSP `InsertReplaceEdit`, `additionalTextEdits`,
  commit characters, Markdown documentation and deprecated tags. Server edits
  must remain authoritative and an older request must never overwrite a newer
  model revision.
- Verify built-in `sel`, `upd`, `at` and transaction snippets use the active
  product syntax; custom edits to a built-in must remain byte-for-byte custom
  and must not be silently dialect-rewritten.
- Verify custom snippet add/edit/enable/disable/delete/default restoration,
  duplicate trigger rejection, persistence across restart, and Monaco
  placeholder navigation with Tab/Shift+Tab.
- Verify function completions with zero, one, nested-type and multiple
  parameters. A server-provided snippet/text edit or an existing opening
  parenthesis must not receive a second argument list.
- Verify same-name function overloads with distinct signatures remain separate
  Monaco rows after semantic, JOIN and syntax fallback merges.
- Observe the content-free 256-event telemetry window on real LSPs: latency,
  P95, fallback, empty, discarded and error reasons must update without storing
  SQL, identifiers, labels or completion payloads.

## Query transaction controller

- On transactional PostgreSQL/MySQL connections, verify manual Begin, query
  execution with the named transaction ID, Commit, Rollback and switching back
  to auto mode. Repeated toolbar clicks while an operation is pending must issue
  exactly one backend request and expose a visible busy state.
- Force Commit failure and confirm the editor remains in manual/active state.
  Force only the post-commit metadata refresh to fail and confirm the transaction
  is still shown as committed rather than retryable.
- Close a tab, change its connection, revoke its transaction capability and close
  the editor while a manual session exists. Each stale session must receive one
  best-effort rollback without leaking its transaction ID to another tab.

## Query execution controller

- On SQL, Elasticsearch Console and MongoDB connections, verify that selection
  wins over cursor scope, Run Current resolves one complete statement/request/
  command, and Run All keeps the whole document. Database error offsets must
  still point to the original Monaco document after range execution.
- Double-click Run and Explain while backend target resolution is pending. Only
  one parser request and one execution may be dispatched for a tab. Switch tab
  or connection before statement resolution returns and confirm the stale result
  is discarded without starting a query.
- Open SQL parameters inside and outside a manual transaction. Changing tab,
  connection or transaction context must close the stale parameter request;
  compiled SQL must retain the reviewed transaction ID and destructive-query
  confirmation policy.

## SQL script and Console file controllers

- On two live connections with different current database/schema targets, open
  a SQL script review, change the selected target before approval, and confirm
  the stale review is cancelled. Repeated clicks during native file selection,
  preview and import must not create duplicate tasks or backend calls.
- Replace the SQL file after review and confirm the digest check rejects it.
  Force only the post-import metadata refresh to fail and confirm the original
  import task remains successful while a separate introspection task reports
  the refresh failure; retry must not execute the script a second time.
- In an Elasticsearch Console tab, import a request file and switch tabs before
  the native read finishes. The stale result must not overwrite either tab.
  Verify export uses the content snapshot taken at dispatch and duplicate
  import/export actions remain disabled until the active operation settles.

## Cross-driver migration review notes

- Compare PostgreSQL snapshots against MySQL/MariaDB and SQL Server targets
  containing UUID, JSON/JSONB, arrays, bytea, timezone timestamps, network
  types, intervals and serial/bigserial columns. Confirm deterministic mapping
  notes identify lossy conversions and appear in both warnings and the review
  artifact.
- Confirm every cross-driver change remains metadata-only: no change may carry
  executable SQL, no preflight may imply apply support, and
  `execute_schema_migration` must continue rejecting the plan.
- Verify unsupported source/target pairs receive an explicit “no deterministic
  profile” warning rather than a guessed compatible dialect.
- Verify each structured issue carries stable remediation text and that
  `blocksAutomaticConversion` is true for lossy/custom/default/index decisions
  requiring target-owned input, while safe deterministic mappings remain false.

## Result and table export formats

- Verify query-result CSV, UTF-8 BOM CSV, JSON, JSONL, TSV and SQL template
  downloads with duplicate column names, quotes/newlines, NULL, booleans,
  finite/non-finite numbers, nested JSON, binary values and empty results.
- Verify table-mode CSV/CSV BOM/JSON/JSONL/TSV/SQL/XLSX still use the Rust streaming task,
  progress/cancellation/report path after the toolbar entry is consolidated.
  Large tables must not be materialized in the webview.
- XLSX logic is implemented but still needs its large-file, cancellation,
  NULL/date/binary/nested-JSON, 1,048,576-row boundary, Excel/LibreOffice and
  atomic-finalization validation matrix. Parquet/Arrow and
  resumable/backpressured exports remain implementation gaps.

## FK-aware JOIN completion and completion hot path

- Verify outgoing and incoming foreign-key JOIN proposals for single and
  composite keys, multiple FKs to the same target, self references, quoted
  identifiers, cross-schema references and aliases that collide with the
  generated target alias.
- Confirm the relationship index is replaced on connection/schema metadata
  refresh, never mixes databases or connections, and reuses completed LSP
  metadata without issuing an all-table scan from the editor.
- Exercise SQL documents larger than 128 KiB. Semantic LSP completion must
  remain authoritative, while the bounded fallback must not reuse a relation
  from outside its retained context or regress cancellation/version checks.
- Confirm only the active Monaco model language owns completion, hover,
  navigation, formatting, semantic-token and inline-completion providers after
  language/tab changes; no disposed background provider may answer a request.

## Structured cross-driver conversion issues

- Verify PostgreSQL to MySQL/MariaDB and SQL Server comparisons return stable
  `conversionIssues` for arrays, UUID, JSON/JSONB, bytea, timezone timestamps,
  network types, interval, serial types, cast/sequence defaults,
  partial/expression/specialized indexes and explicit custom types, with the
  expected target type and safe/review/unsupported classification.
- Verify an unsupported driver pair emits one explicit unsupported profile
  issue, remains review-only, and still produces no executable migration or
  automatic preflight path. Old stored payloads without `conversionIssues`
  must continue rendering with an empty list.

## Schema diagram SVG and viewport culling

- Export filtered and keys-only diagrams containing XML-sensitive relation,
  column and constraint names. The SVG must open independently, preserve node
  and edge geometry, and contain no unescaped source text.
- Benchmark scroll, zoom, search, selected-edge highlighting and inspector
  collapse with 1k/5k/10k relations. Viewport buckets and overscan must not
  leave blank nodes after programmatic focus, resize or zoom changes.
- Export PNG/JPG with dark, light and transparent backgrounds and both filtered
  and full scopes. Confirm JPEG converts transparent to white, light exports
  retain readable contrast, and canvases above 24 MP down-scale without changing
  aspect ratio or exhausting the WebView.
- Exercise Ctrl/Cmd/Shift multi-select, exclusive move-to-area, parent-first
  auto-arrange, area removal and the 100-step undo/redo boundary. Area culling,
  related-table focus and full export coordinates must remain consistent.
- Verify selected+related and selected-area scope filters compose with text and
  keys-only filters. A hidden selection must surface the recovery action, which
  clears scope/search and centers the same relation without losing inspector state.

## DBML review artifact import/export

- Export tables with quoted names, composite primary/foreign keys, defaults,
  expression indexes, views, checks, routine signatures and non-relation
  schema descriptors. Validate the generated DBML with the ChartDB compiler
  and confirm every unsupported/lossy object is retained as an in-file warning.
- Round-trip the portable exported subset through the bounded importer,
  including array types, defaults, named/composite indexes and composite FKs.
  Malformed settings, duplicate tables/columns, missing FK sources and
  cross-schema tables must produce diagnostics rather than guessed metadata.
- Confirm the 8 MiB browser limit, saved-source label and offline sentinel.
  Imported DBML must enter snapshot diff and must never enable Apply or become
  direct executable migration input.
- In the Diagram DBML Draft dialog, verify 250 ms diagnostics, native text
  undo/redo, warning bounds and desired-draft → captured-snapshot diff direction.
  Offline plans must disable both Apply and Open in console while retaining a
  readable/copyable review artifact.

## Structured diagram draft

- Exercise relation create/rename/drop, column create/edit/drop, index, FK and
  CHECK editing with quoted/non-ASCII identifiers, composite relationships,
  self references, name collisions and more than 100 undo/redo operations.
- Confirm relation and column renames update every source/index/constraint and
  inbound reference, while removals never leave dangling metadata in the
  review snapshot.
- Compare a structured draft against its captured snapshot and verify the
  source is visibly review-only. Apply and Open in console must stay disabled,
  and a direct backend execution request carrying any registered offline
  sentinel must fail before fingerprint, preflight or database access.
- Profile opening/searching the lazily loaded editor with 1k/5k/10k relations.
  The relation list is capped at 500 visible rows and edit history must retain
  structural sharing rather than deep-copying the entire schema.

## ChartDB metadata JSON import

- Copy each target-scoped query from the Snapshot dialog and execute it on the
  supported server/version matrix. The query must be read-only, return exactly
  one `metadata_json_to_import` cell, scope catalogs to the requested schema,
  and keep literal escaping intact for quoted schema names.
- Validate PostgreSQL/MySQL/MariaDB/SQLite/SQL Server/Oracle/ClickHouse and
  CockroachDB metadata-query output against the strict importer, including the
  valid `metadata_json_to_import` wrapper, composite PK/FK/index ordering,
  arrays, precision/scale, identity, views, checks and custom-type warnings.
- Confirm the 16 MiB browser bound, schema filtering, duplicate handling and
  missing-table inference. Malformed JSON/wrappers must fail without permissive
  quote rewriting or partial persistence.
- Saved metadata imports must remain offline/review-only: diagram and live diff
  are allowed, while Apply and direct DDL generation remain disabled.
