# DBX alignment: deferred validation queue

## Phase 127 -- completion merge race

- In a real Monaco WebView, delay metadata and foreign-key requests while typing, switching tabs/connections, cancelling completion, and accepting a snippet. Verify stale merged suggestions never reopen or replace the active list; test slow remote catalog refreshes, IME and inline/popup coexistence.

## Phase 126 -- Monaco metadata hover

- In a real WebView, inspect table hovers for wide composite indexes, multi-kilobyte defaults, quoted identifiers containing Markdown delimiters, pointer/trackpad scrolling, zoom and light/dark themes. Confirm Monaco retains its own accessible tooltip focus/scroll behavior while the bounded metadata payload stays readable.

## Phase 125 -- full table data compare

- Exercise `compare_table_data_full` against PostgreSQL, MySQL, SQLite/DuckDB and every explicitly opted-in external table-data-transfer package. Verify the count query, deterministic key ordering, null/composite keys, duplicate-key rejection, empty schema handling and independent source/target databases.
- Confirm the 100,000-row ceiling rejects rather than degrades to an incomplete diff. Add sampled/checksum degradation only after a result contract can surface method, confidence and coverage exactly as DBX does.
- Verify a full comparison does not block the workbench, that cancellation/progress is added before raising the cap, and that comparison results never expose source values through durable reports or logs.

Implementation work is intentionally being completed before these checks run.
Do not mark a capability as production-ready or count it toward the 70+
database target until its relevant queue entries pass.

## Completed non-database checks (2026-08-10)

- `npm test`: 231 test files and 1,185 tests passed. PostgreSQL remote-content,
  CSV import, cross-database table view, export progress and generated
  operation-ID mocks now follow the current frontend contract.
- `npm run build`: strict TypeScript, Vite production build and frontend bundle
  verification passed; the verifier found one startup module and no static
  import cycles.
- `cargo test --manifest-path src-tauri/Cargo.toml core::schema_diff::tests --lib`:
  25 schema diff and migration-planning unit tests passed.
- Targeted Rust SQL/TSV export and type-conversion review tests passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml` and `git diff --check` passed.
- SQL Server default-schema selection passed focused frontend unit coverage:
  the saved catalog is not treated as a schema, an explicit schema still wins,
  and an unscoped LSP document binds to a discovered case-preserving `dbo`.
  No SQL Server connection was opened.
- SQL formatter layout passed the complete bundled LSP suite, Clippy, focused
  settings/config tests, the strict frontend build, and a real packaged-binary
  JSON-RPC formatting test. Both document and range formatting share the same
  linear parser-mask pass; live Monaco selection/undo and large-WebView timing
  remain deferred and no database was opened.
- Insert Line Below passed its action/event/native-Monaco-command unit contract
  and strict frontend build. Defer real WebView checks for indentation,
  multi-cursor undo, Vim mode, IME and an open completion widget; no database
  is required for those checks.
- INSERT value inlay hints passed 152 bundled-LSP unit tests plus the complete
  integration suite, five focused parser tests, the real packaged-binary
  JSON-RPC test, seven focused Monaco/provider tests, Clippy and the strict
  frontend build. Coverage includes implicit metadata order, generated/hidden
  ownership, SQL Server catalog/dbo, bounded large-document UTF-16 positions
  and multi-row nested values; real product metadata and WebView interaction
  remain deferred below.
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
- Diagram canvas persistence tests passed for project/schema scoping, stale Area
  member cleanup, Note retention, duplicate/corrupt payload rejection and
  bounded content. SVG tests cover XML-safe Note export and expanded bounds.
- The complete bundled LSP Rust suite passed after adding DBX semantic row
  source and catalog coverage: 105 library tests plus all integration/doc targets. The
  end-to-end process test now covers table functions, `WITH ORDINALITY`,
  positional correlation-column merging, comma-separated sources after JOIN,
  SQL Server table hints, LATERAL/APPLY row sources, qualified outer aliases
  inside correlated subqueries, four-part SQL Server names, `database..table`
  and cross-catalog isolation. No live metadata source was used.
- The extracted stable Monaco/LSP provider coordinator passed registration,
  disposal and stale-document isolation tests together with the existing
  document/execution/transaction/file controllers (20 focused tests total),
  followed by a strict frontend production build. Live provider/metadata
  combinations remain deferred below.
- The extracted metadata + LSP hover coordinator passed registration,
  disposal, active response and stale connection-owner tests. It now reads
  refreshed schema metadata without provider re-registration and rejects late
  results after metadata revision, owner or model-version changes. A strict
  frontend production build and bundle-cycle verification passed afterward.
- The completion provider and usage-command lifecycle is now independently
  registered and reads the latest metadata/settings callback through a runtime
  ref. Focused tests cover disposal, live usage-ranking changes and stale owner
  rejection; a strict production build confirms metadata or snippet refreshes
  no longer require global Monaco provider re-registration.
- The optional completion-item resolve path passed 14 focused frontend tests:
  only server-backed items retain opaque resolve state through context object
  spreads, resolved Markdown/detail/additional edits enrich the existing Monaco
  proposal, and cancellation or owner changes discard late enrichment. Rust
  resolve parsing, data round-trip and capability tests compile; execution of
  the parent Rust test binary remains deferred by this Windows runtime's known
  `STATUS_ENTRYPOINT_NOT_FOUND` startup failure.
- The bundled SQL LSP lazy-documentation implementation passed all 135 library
  tests, all 13 real subprocess protocol tests, the remaining integration
  suites, and strict Clippy without database access. Capable clients now receive
  lightweight completion lists and resolve selected table/column/function/
  constraint/index documentation from a bounded 8,192-entry/4-MiB FIFO cache;
  individual payloads above 256 KiB remain inline, original opaque data is
  restored, and an evicted identity cannot invalidate the proposal itself.
- The FK-aware missing-JOIN-condition quick fix passed all 146 bundled LSP
  library tests, all 14 real subprocess protocol tests, the remaining
  integration/doc suites and strict Clippy without database access. A protocol
  fixture proves SQL Server product identity produces bracket-quoted composite
  edits; the rebuilt packaged binary passed all three application-level JSON-RPC
  integration tests. Real Monaco lightbulb/edit-preview behavior remains
  deferred below.
- The DBX `868f7961e` alias-column regression is covered without database
  access: all 173 LSP library tests and the relational scope matrix pass for
  PostgreSQL, MySQL, SQLite, Hive, ClickHouse and SQL Server-compatible bracket
  syntax. Display labels and bare-column filtering remain stable while inserted
  identifiers preserve exact double quotes, backticks, brackets and case,
  including a requested alias from a correlated outer query.
- The latest ChartDB metadata-import CSV/embedded-quote behavior (`3442936`)
  passed seven focused frontend tests. Strict JSON is authoritative; JSON-string
  transport, single-field CSV doubled quotes and the known invalid wrapper are
  accepted without changing embedded quotes, while unrelated malformed input
  still fails and the snapshot stays offline/review-only.
- The signature-help and built-in function completion alignment suite passed
  without database access: 131 LSP
  library tests, 12 process-protocol tests and 9 schema contract tests. It
  covers SQL-noise-safe nested calls, qualified Unicode routines, optional
  labels, stable overload ranking, dialect fallback, server-version catalog
  gates, ClickHouse parameter groups, expression-only function suggestions,
  live-metadata precedence and editable snippet insertion.
- The unified diagram transaction-history suite passed without database access:
  19 focused tests cover Area/Note/draft operation ordering, the 100-step bound,
  persisted-draft hydration, stale fingerprint rebasing without no-op undo
  entries, draft structural sharing and scoped canvas/draft persistence. Strict
  TypeScript, the production bundle and startup-cycle verification passed after
  the integration.
- Cached SQL metadata completion is now isolated behind a stable request
  factory. Nine focused tests cover bounded context, relation-position gating,
  declared CTE/derived fields and the existing SQL source parser; strict
  TypeScript passed without loading Monaco or a database. Live metadata cache,
  FK JOIN and provider combinations remain deferred below.
- Monaco editor view state now has an isolated lifecycle matching the DBX tab
  behavior. Two focused tests cover bounded selection restoration, directional
  offsets and rAF-batched viewport updates; strict TypeScript passed. Manual
  WebView checks for focus, split panes and delayed layout restoration remain
  deferred below.
- Current-statement decoration now has an isolated lifecycle. Five focused
  tests cover backend-authoritative range reuse, exact-end invalidation,
  model-version invalidation and decoration reuse; strict TypeScript passed.
  Live parser IPC/decorations counts remain deferred below.
- Elasticsearch and MongoDB Console auto-suggest now share an isolated
  lifecycle. A focused fake-timer test covers the 45 ms debounce and rejects a
  completion trigger after the Monaco model version changes; strict TypeScript
  passed. Live WebView focus, model replacement and real provider composition
  remain deferred below.
- External drivers now have a descriptor-only semantic schema-migration wire
  contract for plan, preflight, token-bound apply and verify. Protocol tests
  prove apply requests contain no Host SQL/statements; package tests enforce
  the signed manifest + runtime handshake gate; the privacy-bounded
  conformance runner records migration evidence only after the complete state
  machine succeeds. No migration fixture was executed against a real database.

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
- Run the same append/overwrite/upsert, cancellation, write-failure and
  PostgreSQL identity-reseed fixtures through both the single-table and
  multi-table entrypoints. The shared executor must emit equivalent per-table
  row/batch totals and rollback semantics; only aggregation/report ownership
  may differ.

## Existing transfer and migration work

- Exercise target-table creation profiles for PostgreSQL, MySQL/MariaDB and
  SQLite in every source/target direction. Confirm scalar exact/safe/review
  mappings produce the reviewed DDL, while unknown, array, spatial, vector and
  custom cross-product types return `unsupported`, an empty statement list and
  no confirmation token; they must never fall back to executable `TEXT`.
- Repeat same-product target creation with native/custom types and confirm the
  exact declaration is preserved, custom/extension dependencies remain visibly
  `review`, stale plan tokens are rejected, and the UI exposes the normalized
  mapping profile while hiding the create action for blocked plans.
- Verify PostgreSQL serial and identity reseed previews against empty/non-empty
  targets, a target without owned generators, rollback after a reseed failure,
  and stale-token rejection when the reseed option changes. Confirm reseed SQL
  runs before the copy transaction commits. After commit, confirm the read-only
  generator-vs-table-maximum comparison reports verified/needs-review without
  persisting either numeric value; unavailable catalog functions or privileges
  must degrade to review rather than relabeling a committed transfer as failed.
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
  report. The bounded two-page producer/writer channel and blocking writer are
  implemented; verify with an injected slow writer that no third page can be
  buffered and that progress counts only pages fully written. Resume remains
  deliberately unsupported until a driver supplies a stable cursor/keyset and
  snapshot contract.

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

- Exercise driver archive download through a real CDN and an intercepting
  proxy: exact 206 continuation, ignored Range with 200 full fallback, valid
  and invalid 416, missing/mismatched Content-Range, mid-stream disconnect,
  digest mismatch, and retry after process restart. Only a complete
  catalog-bound SHA-256 may be atomically published; interrupted bytes must
  remain in the digest-bound `.partial` file and must never be extracted.
- Populate the catalog cache with active, previous rollback, saved-connection
  pinned, live-sidecar, unused, malformed and symlink entries. Cleanup must
  retain the first four sets, remove only regular 64-hex digest archives and
  partials from unused versions, report unknown entries, and never recurse
  through or delete a symlink. Repeat while an install is queued and with a
  Windows file handle open to verify serialization and visible failure.
- Run driver conformance for every signed package/server-version pair,
  including connect, metadata, query, parameter binding, cancellation, and
  normalized error mapping. The catalog must remain candidate-only without
  evidence.
- Run native PostgreSQL queries against PostgreSQL-compatible fixtures whose
  `pg_backend_pid()` is exposed as native int4, int8/numeric-compatible text,
  malformed text, missing function, and an out-of-range value. Normal queries
  must succeed in every non-query-error case; cancellation may be advertised
  only when the normalized value is a positive `i32`, and an unavailable PID
  must not fail connection setup or execution.
- Run native MySQL queries against MySQL/MariaDB/TiDB/OceanBase-compatible
  fixtures that append columns to scalar metadata and expose
  `CONNECTION_ID()` as integer-compatible text, malformed text, a missing
  function, and zero. Only column zero may be decoded; normal queries must not
  fail when cancellation tracking is unavailable, and `KILL QUERY` evidence
  requires a successfully normalized positive `u64` connection id.
- Run the Headless Agent Host against a controlled MySQL-compatible routing
  proxy with leading `/*+`, `/*@`, and `/*&` hints. Its server-side row-limit
  wrapper must keep the hint before the outer SELECT, preserve ordinary comments
  inside the wrapped statement, and retain read-only transaction/row limits.
  Repeat with multibyte whitespace/comment text; no database product may infer
  hint support merely from a compatible SQL parser.
- For each external driver that claims migration, run a descriptor-only
  migration fixture and publish hash-bound `migration` evidence. Verify stale
  target fingerprints, plan/preflight/apply token swaps, blocked preflight,
  missing review/destructive/non-transactional approval, partial-apply reports
  sidecar restart/session expiry/single-use rejection, Host recapture failure,
  and post-apply drift. Confirm no renderer payload or persisted journal
  contains sidecar plan ids, tokens, DDL, raw preflight observations or row
  values. Until then that exact product/server pair remains review-only.
- Re-run the Host-side semantic migration boundary tests on a Windows runner
  with the complete native test runtime. The current workstation compiled the
  test binary successfully, but Windows exited before the test harness started
  with `STATUS_ENTRYPOINT_NOT_FOUND`; this does not qualify as passed evidence.
- With a live external sidecar, verify the Driver Manager refreshes its
  process-health summary after an unexpected sidecar exit without exposing
  connection names, URLs, stderr, SQL, or credentials.
- Run the remaining SQL semantic corpus across the bundled LSP and Monaco
  fallback for alias/name collisions, dialect quoting, and INSERT value
  hints. The bundled process contract already covers CTE/derived shadowing,
  table functions, `WITH ORDINALITY`, positional correlation columns, JOIN
  followed by comma sources, and SQL Server `(NOLOCK)`; repeat those cases
  against real versioned metadata before marking driver families conformant.
- In each completion trigger mode, type inside MySQL/MariaDB `#` comments,
  MySQL backslash-escaped strings and PostgreSQL `E'...'` strings; automatic
  and explicit completion must remain suppressed. SQL Server `#temp` and
  `##global_temp` prefixes must still produce relation completion.
- Against real PostgreSQL/MySQL/SQLite/SQL Server/ClickHouse versions, verify
  signature help preserves database-reported overload order, default/optional
  arguments, variadic routines, quoted routine names and procedures. Confirm
  live metadata always overrides the static fallback, SQL Server JSON gates
  match supported server versions, and ClickHouse ordinary/parametric calls
  select the correct parameter group. Profile the 64 KiB scan and 50-overload
  limits on large consoles; crossing either bound must fail quietly without
  blocking completion.
- Include external LSP routines whose parameter lists contain quoted commas,
  escaped quoted identifiers, string defaults with commas, numeric array
  bounds, nested decimal types and STRUCT/ROW generic types. Bare-name
  completion must create one Monaco field per real parameter and must leave
  oversized or malformed signatures untouched.
- Exercise a real LSP 3.17 provider that returns `CompletionList.itemDefaults`
  with list-level `data` and per-item overrides. `completionItem/resolve` must
  receive the inherited or overridden opaque identity unchanged, while a
  provider that does not advertise resolve must never receive the request.
- Use a controlled provider to return 2,001 completion items, one item larger
  than 256 KiB, and inbound/outbound frames around the 32 MiB transport bound.
  The bridge must cap renderer work, mark truncated completion incomplete,
  reject oversized frames without allocating their declared body, and leave
  pending requests in a terminal error state rather than hanging.
- Repeat framing with lowercase `content-length`, an optional `Content-Type`
  before and after it, duplicate matching lengths, and conflicting lengths.
  Legal header blocks must parse; malformed or conflicting blocks must close
  the session without reading a misaligned response body.
- Export tables containing PostgreSQL stored generated/`tsvector`, MySQL
  virtual/stored generated, and SQLite virtual/stored generated columns to
  SQL. Confirm INSERT columns and row values stay aligned, computed columns
  are absent, and a table with no writable columns fails without publishing a
  partial file.
- Export explicit values from PostgreSQL 10+ `GENERATED ALWAYS AS IDENTITY`
  and `BY DEFAULT` tables. Only the former must use `OVERRIDING SYSTEM VALUE`;
  pre-10 servers and non-PostgreSQL drivers must never receive that clause.
- Exercise every SQL export batch choice (25/100/250/500/1,000) with narrow
  and wide rows. Row limits must split at the selected size, the 512 KiB byte
  cap must still split earlier, and invalid IPC values must publish no file.
- Replay strict and conflict-skip exports against versioned PostgreSQL, MySQL,
  MariaDB, and SQLite fixtures with duplicate primary/unique keys. Strict must
  stop on the conflict; skip must use only the reviewed dialect form and retain
  every non-conflicting row. External packages, DuckDB, and unknown dialects
  must reject skip before creating a partial file.
- Use a provider that initiates `workspace/configuration`,
  `workspace/workspaceFolders`, progress, message, workspace-edit and unknown
  requests. Confirm every request receives a matching numeric or string id,
  unsupported edits never mutate files, and unknown methods receive -32601.
- In Monaco, accept zero-, fixed-, optional-, variadic- and ClickHouse
  multi-group built-in function candidates with each keyword/function casing
  preference. Confirm tab stops, closing parentheses, retriggered signature
  help and undo form one coherent edit, and that FROM/JOIN targets, comments,
  literals and `alias.` completion never display the built-in catalog. Repeat
  with more than 100 available routines to confirm the bounded fallback does
  not displace live metadata or block the typing thread.
- On large real SQL consoles, verify CTE/derived projection completion stops
  local-relation discovery beyond the documented 512 KiB budget without
  blocking ordinary metadata completion. Comments, string/dollar literals and
  quoted identifiers containing `WITH`, `FROM` or `JOIN` must not create local
  relations. Include many table-function/correlation sources to confirm the
  single masked structural buffer prevents per-source whole-document rescans.
- Exercise Monaco command-palette SQL intentions for quoted identifiers,
  escaped identifiers, malformed selections, clipboard permission denial, and
  IN-list values containing quotes, NULLs, numbers, and a 1,000-value bound.
- Repeat those intention cases with multiple selections, including one invalid
  selection; the all-or-nothing edit must leave the entire document unchanged.
- Exercise LSP qualify/unqualify intentions against real PostgreSQL/MySQL
  metadata with duplicate column names, self joins, CTE projections, quoted
  aliases and schema-qualified tables. Unqualify must disappear when another
  visible source exposes the same column; batch qualify must skip ambiguous
  fields and remain bounded to 256 KiB of selected SQL.
- Profile automatic Monaco lightbulb requests on a large real console. Moving
  the caret or requesting quick fixes/refactor rewrites must not invoke full
  document formatting; an explicit source action and normal Format Document
  must still produce the dialect formatter edit.
- Instrument current-statement framing in a large SQL console. The first cache
  miss must issue one backend request returning the bounded document range set;
  moving inside or between cached statements, including intervening whitespace,
  must issue no further request or duplicate decoration update. Moving to an
  exact exclusive end, editing the model, swapping the model, or changing the
  connection must re-resolve, and a late old response must not repaint the newer
  cursor. A document above 10,000 statements must omit the range set, retain a
  correct current range, and never create an unbounded IPC payload.
- Verify a non-empty selection and Mongo command frame appear without the SQL
  debounce delay, including rapid drag/cursor changes and empty-command gaps.
  Frame geometry must stay correct at CRLF, wrapped-line and final-line edges.
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
- At a fresh statement, type `in`, `ins` and `insert` against schemas containing
  views, identity/generated/default/nullable columns, quoted names, more than 32
  tables and a table wider than 64 writable columns. Verify table-specific
  required/all INSERT blocks remain bounded, use the active keyword case, replace
  only the typed prefix, and preserve Tab/Shift+Tab value navigation. After
  `INSERT `, ordinary relation completion must remain authoritative instead.
- Verify `SELECT *` and `alias.*` expansion for one and multiple sources, duplicate
  column names, quoted aliases, joins, views and schema-qualified objects. Multi-source
  output must remain unambiguous and preserve the typed alias where applicable.
- Verify PostgreSQL, MySQL, SQL Server, Oracle and ClickHouse completion items
  that use plain `TextEdit`, LSP `InsertReplaceEdit`, `additionalTextEdits`,
  commit characters, Markdown documentation and deprecated tags. Server edits
  must remain authoritative even when “append space after completion” is
  enabled; only plain insertText/label proposals may receive client whitespace.
  An older request must never overwrite a newer model revision.
- Verify Markdown completion documentation renders emphasis, code and links
  without enabling embedded HTML or trusted command links. Plaintext containing
  `*`, backticks or brackets must remain literal rather than being rendered as
  Markdown.
- Verify a server `CompletionList` with `isIncomplete: true` is returned to
  Monaco so the next typing event uses trigger kind 3, and becomes complete
  when the server returns `false`.
- Verify shared `itemDefaults` for commit characters, edit range, insert text
  format and insert text mode apply only when an item has no overriding value.
  Exercise both range and insert/replace default edit shapes plus
  `textEditText`.
- Against a server that advertises `completionProvider.resolveProvider`, verify
  selecting an unresolved item issues one `completionItem/resolve`, round-trips
  opaque `data`, and lazily fills documentation, detail and additional edits.
  A server without the capability, a syntax/cache fallback, an item above 256
  KiB, a cancelled request, and a tab/connection/session switch must issue no
  unsafe enrichment or apply a late response. Restart the provider between list
  and resolve and confirm the original usable suggestion remains intact.
- With a controlled provider that delays completion and resolve, type rapidly
  enough to supersede both calls. Confirm the desktop sends one standard
  `$/cancelRequest` per superseded JSON-RPC id, releases the pending response,
  does not starve the newest request, and keeps tokens isolated across LSP
  sessions and provider restarts. This test does not require a database.
- The bundled-server documentation-only resolve path is covered by a real local
  subprocess test. Deferred coverage here now means the packaged desktop Monaco
  interaction with a genuinely large remote catalog, including cache eviction,
  process restart between list and resolve, and visible Markdown rendering.
- Accept the same proposal while typing inside and at the end of an identifier.
  Monaco must use the LSP insert boundary for insertion and the wider replace
  boundary for overwrite without deleting adjacent SQL.
- Verify `insertTextMode` 1 preserves server whitespace in multiline code
  blocks while mode 2 adjusts indentation, and that `labelDetails` displays
  signature/trigger context without replacing the searchable label.
- Verify built-in `sel`, `upd`, `at` and transaction snippets use the active
  product syntax; custom edits to a built-in must remain byte-for-byte custom
  and must not be silently dialect-rewritten.
- Verify common snippets show their trigger and “SQL snippet” in Monaco's
  native suggestion row, and that descriptive initials/fuzzy input does not
  hide an otherwise matched proposal during Monaco's second-stage filtering.
- Verify custom snippet add/edit/enable/disable/delete/default restoration,
  duplicate trigger rejection, persistence across restart, and Monaco
  placeholder navigation with Tab/Shift+Tab.
- Verify function completions with zero, one, nested-type and multiple
  parameters. A server-provided snippet/text edit or an existing opening
  parenthesis must not receive a second argument list.
- Verify same-name function overloads with distinct signatures remain separate
  Monaco rows after semantic, JOIN and syntax fallback merges.
- With real PostgreSQL/MySQL/SQLite/Hive/ClickHouse metadata, verify comparison
  value completion after WHERE, HAVING, JOIN ON and UPDATE SET. Text, numeric,
  boolean, date/time/timestamp, UUID and JSON columns must receive the matching
  snippet with working Tab/Shift+Tab stops; ENUM/SET values must remain bounded
  to metadata declarations and quote embedded apostrophes safely.
- Use joins where the same column name has conflicting types, quoted aliases and
  custom/vendor types. Ambiguous or unknown types may offer NULL but must not
  guess a typed literal, query distinct values, retain row samples or send data
  content to the renderer/LSP telemetry path.
- Verify a visible table alias is offered as its own completion in SELECT,
  WHERE, JOIN predicates and nested query scopes. Quoted aliases such as
  `"User Alias"` must retain their original SQL spelling, accepting the alias
  must not append a space before `.`, and aliases must stay suppressed inside
  FROM/JOIN targets, comments and string literals.
- Accept a schema proposal whose inserted text ends in `.` and a SQL Server
  `USE ` keyword proposal. The next completion level must open after the edit
  in smart, prefix and manual modes, retain focus in the same editor/model,
  and never execute a stale command after switching tab, connection or scope.
- Observe the content-free 256-event telemetry window on real LSPs: latency,
  P95, fallback, empty, discarded and error reasons must update without storing
  SQL, identifiers, labels or completion payloads.
- Delay a real LSP `didOpen`, then switch tab, connection, dialect package and
  session before it returns. The late document must receive `didClose`, must
  not reappear in the local version/text shadow, and a later document in the
  new session must remain open. Closing a tab must also clear its diagnostics.

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

- Verify query-result CSV, UTF-8 BOM CSV, JSON, JSONL, Markdown, TSV and SQL template
  downloads with duplicate column names, quotes/newlines, NULL, booleans,
  finite/non-finite numbers, nested JSON, binary values and empty results.
- Verify table-mode CSV/CSV BOM/JSON/JSONL/Markdown/TSV/SQL/XLSX still use the Rust streaming task,
  progress/cancellation/report path after the toolbar entry is consolidated.
  Large tables must not be materialized in the webview.
- For both Markdown paths, verify pipes and backslashes remain literal table
  content, CR/LF becomes `<br>`, NULL remains distinguishable from an empty
  string, and a cancelled native export never publishes its `.partial` file.
- XLSX logic is implemented but still needs its large-file, cancellation,
  NULL/date/binary/nested-JSON, 1,048,576-row boundary, Excel/LibreOffice and
  atomic-finalization validation matrix. The bounded backpressure pipeline has
  compile-time coverage and local writer lifecycle tests, but the Windows test
  binary currently exits with `STATUS_ENTRYPOINT_NOT_FOUND` before the Rust
  harness starts; rerun those tests in CI. Verify each signed
  `tableExportFormats` combination is intersected with the encoders compiled
  into the application and that an IPC caller cannot bypass the backend gate.
  Arrow IPC and Snappy Parquet encoders now have compile-time coverage and
  writer lifecycle tests. Validate native PostgreSQL/MySQL/SQLite and signed
  DuckDB round trips for NULL, signed/unsigned large integers, non-finite
  floats, date/timestamp/timezone, binary, DECIMAL, JSON, arrays, custom types,
  empty tables, cancellation, footer integrity, source-type field metadata,
  coercion notices, 50,000-row/64-MiB Parquet row-group bounds and atomic
  finalization. Generic JDBC/RQLite must remain without Parquet/Arrow until a
  canonical value-encoding conformance contract exists. Stable-snapshot
  resumable export remains an implementation gap.

## FK-aware JOIN completion and completion hot path

- Trigger the `OXIDE002` lightbulb after a missing `ON`/`USING` condition and
  verify a unique incoming/outgoing FK is preferred, composite columns retain
  ordinal pairing, and multiple FKs remain separate choices. The edit must land
  before WHERE/GROUP/ORDER/another JOIN or the terminating semicolon and preserve
  PostgreSQL double quotes, MySQL backticks and SQL Server brackets.
- Repeat with self joins, repeated aliases, absent/stale constraints,
  cross-schema names and incomplete composite metadata. No guessed equality may
  be offered; only the non-matching `ON 1 = 0` safety guard is allowed when the
  exact relation occurrence or full column pairing cannot be proven.
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

## Structured array value preview

- Open JSON arrays and PostgreSQL array literals containing quoted commas,
  escaped quotes/backslashes, NULL versus quoted `"NULL"`, nested dimensions,
  explicit dimension bounds and empty arrays. Confirm PostgreSQL literal leaves
  stay strings (except unquoted NULL) and toggling the tree never rewrites the draft.
- Confirm malformed, deeper-than-64, larger-than-100,000-item and larger-than-
  1,000,000-character arrays stay in text mode with a bounded diagnostic.
- Exercise the preview with PostgreSQL array columns and JSON-array values from
  the other reviewed drivers; database writes remain deferred until the full
  logic-alignment pass is complete.

## Schema diagram SVG and viewport culling

- Export filtered and keys-only diagrams containing XML-sensitive relation,
  column and constraint names. The SVG must open independently, preserve node
  and edge geometry, and contain no unescaped source text.
- Benchmark scroll, zoom, search, selected-edge highlighting and inspector
  collapse with 1k/5k/10k relations. Viewport buckets and overscan must not
  leave blank nodes after programmatic focus, resize or zoom changes. Profile
  traces should confirm scroll queries inspect intersecting spatial buckets and
  visible-relation edge adjacency rather than scanning every node and edge.
- Export PNG/JPG with dark, light and transparent backgrounds and both filtered
  and full scopes. Confirm JPEG converts transparent to white, light exports
  retain readable contrast, and canvases above 24 MP down-scale without changing
  aspect ratio or exhausting the WebView.
- Exercise Ctrl/Cmd/Shift multi-select, exclusive move-to-area, parent-first
  auto-arrange, area removal and the 100-step undo/redo boundary. Area culling,
  related-table focus and full export coordinates must remain consistent. Repeat
  move/new/no-area from a relation context menu and auto-arrange/remove from an
  area-title context menu; right-clicking outside the current multi-selection
  must target only that relation, while right-clicking inside it preserves the
  entire selection. From blank canvas space, repeat move/new/no-area for the
  preserved selection and auto-arrange all areas; nested relation/area menus
  must not also open the canvas menu. Rename areas from the toolbar and context menu; empty and
  case-equivalent duplicate names must remain blocked, and switching diagrams
  must dismiss a stale rename dialog.
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
- Round-trip same-schema Enum blocks with bare/quoted values, spaces, embedded
  quotes, duplicate values and enum-typed columns. Enum descriptors must affect
  the offline fingerprint and appear only as Manual Review schema-object drift;
  cross-schema enum blocks must be rejected. Value notes/settings must remain a
  visible lossy warning until the snapshot model can represent them directly.
- Import TablePartial fixtures with fields, defaults, inline refs and indexes.
  Confirm local table definitions override all partials, the last injected
  partial overrides earlier partials, and an overridden inline ref does not
  survive its field. Exercise missing partials, nested cycles, more than 32
  levels/256 injections, oversized expansion and Unicode before index blocks;
  each must remain bounded and diagnostic without changing review-only safety.
- Confirm the 8 MiB browser limit, saved-source label and offline sentinel.
  Imported DBML must enter snapshot diff and must never enable Apply or become
  direct executable migration input.
- In the Diagram DBML Draft dialog, verify 250 ms diagnostics, native text
  undo/redo, warning bounds and desired-draft → captured-snapshot diff direction.
  Offline plans must disable both Apply and Open in console while retaining a
  readable/copyable review artifact.

## Project SQL semantic index

- Rebuild the bundled SQL LSP from the tracked submodule before application-level
  testing and confirm `sql-lsp.manifest.json` records the same source revision
  and checksum as the packaged executable.
- Open a project at the renderer limits (128 allowlisted SQL files, 128 KiB per
  file and 5 MiB total) and record cold-index and cache-hit latency for
  `workspace/symbol`, references, definition and rename. Editing one document
  must invalidate only that URI's cached index.
- Verify table/view/function/procedure definitions and usages across
  PostgreSQL, MySQL, Hive, ClickHouse and SQL Server-style qualified names.
  Comments, literals, unrelated same-named columns, aliases and CTEs in another
  statement or document must not leak into physical-object results.
- Confirm `includeDeclaration: false`, quoted/non-ASCII UTF-16 rename ranges,
  schema/project isolation, duplicate migration definitions and deterministic
  result ordering. A document above 512 KiB, more than 256 open documents,
  more than 10,000 occurrences or 2,000 results must degrade at the documented
  boundary without hidden filesystem access.
- Exercise CTE rename in one document and physical-object rename previews over
  synchronized project files. No rename may be offered for an unknown routine
  or relation without metadata or a project DDL definition.

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
- Close and reopen a dirty draft, restart the application, and switch projects,
  connections, databases and schemas. Only the exact project scope with the
  same base snapshot fingerprint may restore. A stale fingerprint must remain
  visible but unapplied; rapid edits must persist in order, closing/reviewing
  must flush the newest version, and confirmed discard must remove the resource.
- Drag a base-table source column onto a base-table target column across visible
  viewport buckets. The draft must open on the source relation with a unique FK
  name and exact endpoints, while malformed/oversized drag payloads, missing
  columns, views and foreign tables do nothing. Keyboard-only FK creation must
  remain available through the same form and neither path may execute DDL.
- Create, edit, recolor, move, resize and delete diagram notes at several zoom
  levels, interleaved with Area and Structured Draft operations. Undo/redo from
  the toolbar and draft dialog must follow one operation-ordered 100-step
  timeline; closing/reopening the draft must hydrate its persisted baseline
  without adding an undo step, and snapshot refresh must remove only stale
  fingerprint draft states without erasing valid Area/Note history. Pointer
  movement/resize must remain
  local until release, one undo must reverse one completed gesture, keyboard
  repeats must commit on key-up, and native text undo inside dialogs must not be
  intercepted. Confirmed deletion must be required, tab switching/closing must
  flush the latest canvas, and a project/schema switch must restore only its own
  bounded resource. Snapshot refresh must remove stale Area members while
  preserving notes. Export SVG/PNG/JPG with XML-sensitive and multiline note
  content; resized note bounds must expand the artifact without bypassing the
  24 MP raster limit.

## DBML index comments

- Capture PostgreSQL indexes with `COMMENT ON INDEX` and MySQL/MariaDB indexes
  with `INDEX_COMMENT`, then confirm Explorer metadata, saved snapshot,
  fingerprint and DBML `note` preserve the exact Unicode text. Include empty,
  single-quote, backslash and multiline comments; empty server comments must
  normalize to absent rather than creating a perpetual diff.
- Import/export the same comments through DBML and confirm only the portable
  text round-trips. A comment-only live difference must remain a blocked
  review-only `IndexModify`; it must never emit `DROP INDEX`/`CREATE INDEX`.
  Product-specific semantic comment apply requires separate version evidence.

## DBML table comments and mixed-dialect types

- Capture PostgreSQL and MySQL/MariaDB tables with absent, Unicode,
  single-quote, backslash and multiline comments. Confirm the table-list
  comment enters the saved snapshot, fingerprint and DBML `Note`, then
  round-trips without being confused with review warnings for views.
- Compare comment-only live snapshots and verify PostgreSQL emits `COMMENT ON
  TABLE ... IS ...` (or `NULL` for removal) while MySQL emits `ALTER TABLE ...
  COMMENT = ...` (or an empty string for removal). Re-capture must converge
  without rebuilding the table.
- Import/export a deliberately mixed DBML fixture containing MySQL
  `longtext`/`tinyint` and PostgreSQL arrays or schema-qualified custom types.
  Oxide must preserve the exact declared type for review rather than silently
  normalizing it. Product-owned execution remains gated by target dialect
  preflight and the offline DBML sentinel.
- Round-trip DBML defaults covering escaped strings, bare enum/string values,
  signed decimal numbers, booleans, NULL, temporal keywords and backtick
  expressions. PostgreSQL review SQL must retain string quotes while function
  calls and keywords remain expressions.

## ChartDB metadata JSON import

- Copy each target-scoped query from the Snapshot dialog and execute it on the
  supported server/version matrix. The query must be read-only, return exactly
  one `metadata_json_to_import` cell, scope catalogs to the requested schema,
  and keep literal escaping intact for quoted schema names.
- Validate PostgreSQL/MySQL/MariaDB/SQLite/SQL Server/Oracle/ClickHouse and
  CockroachDB metadata-query output against the strict importer, including the
  valid and known unescaped `metadata_json_to_import` wrappers, single-field CSV
  doubled-quote output, embedded quoted identifiers, composite PK/FK/index
  ordering, arrays, precision/scale, identity, views, checks and custom-type
  warnings.
- Confirm the 16 MiB browser bound, schema filtering, duplicate handling and
  missing-table inference. Inputs outside the explicit strict JSON, JSON-string,
  CSV and documented-wrapper shapes must fail without broad quote rewriting or
  partial persistence.
- Saved metadata imports must remain offline/review-only: diagram and live diff
  are allowed, while Apply and direct DDL generation remain disabled.

## SQL Server default schema and completion metadata

- Connect with a login whose default schema is `dbo`, leave the Query Editor
  schema unset, and confirm Explorer plus LSP table/column completion both use
  the discovered `dbo` entry while retaining the selected database catalog.
- Repeat with an explicit non-`dbo` schema, a login with a custom default
  schema, and a principal that cannot enumerate `dbo`; explicit user state must
  win and system schemas must not become the silent generic fallback.
- Exercise two catalogs containing the same schema/table names and refresh
  metadata while completion is open. Late metadata from the old catalog or
  schema must not overwrite the current document mapping.

## Typed SQL table export

- Replay exports containing 101+ rows and individual rows larger than 512 KiB
  against PostgreSQL, MySQL and SQLite. Confirm statements split at both the
  100-row and 512 KiB boundaries without losing or duplicating a row.
- Replay explicit conflict-update exports for single and composite primary keys.
  Confirm PostgreSQL and SQLite target the full key with `ON CONFLICT`, MySQL
  uses its native duplicate-key form, non-key columns update, and strict export
  remains the default. Tables without a complete writable primary key must be
  rejected before any file is published.
- Round-trip PostgreSQL arrays (including empty and nested arrays) and `bytea`,
  MySQL binary values plus NUL/newline/backslash text, and SQLite BLOB values.
  Repeat under non-default string/escape modes where the server exposes them.
- For signed external SQLite and DuckDB packages, confirm the SQL literal
  dialect follows the declared driver rather than the PostgreSQL-compatible
  paging/identifier profile. Add product-specific temporal, spatial, vector,
  identity/generated-column and custom-type fixtures before advertising those
  cases as conformant.
- The Rust unit-test binary compiled successfully on 2026-08-10, but execution
  remains deferred because this Windows environment exits before test startup
  with `STATUS_ENTRYPOINT_NOT_FOUND`. Re-run the focused SQL export tests in a
  clean CI/runtime environment before release.

## Offline DDL views and schema objects

- Import PostgreSQL, MySQL, SQL Server and Oracle fixtures containing ordinary
  views, materialized views where supported, explicit view column lists,
  expression aliases, wildcard projections and quoted identifiers. Compare the
  review snapshot with live metadata: inferred names must remain stable,
  `UNKNOWN` types must never become executable DDL, and missing inference must
  stay visible as a warning rather than inventing columns.
- Import PostgreSQL enum types and sequences with quoted/schema-qualified names,
  escaped enum values and non-default sequence options. Confirm they appear as
  descriptor-only Manual Review changes, affect the offline fingerprint, and
  never enable Apply or Open in console.
- Exercise generated/virtual/stored columns for each supported family.
  Expressions must be reported as omitted, must not leak into `default_value`,
  and must keep the offline snapshot on the review-only path until a
  dialect-owned lossless expression model is available.
- Validate the structured generated/hidden contract against PostgreSQL 9.6/12+
  (including stored generated and identity), MySQL 5.7/8 plus MariaDB
  (`DEFAULT_GENERATED`, virtual/stored generated and invisible), and SQLite
  versions that expose `PRAGMA table_xinfo`. Confirm LSP INSERT snippets and SQL
  export omit only database-owned columns, hidden columns remain discoverable
  but do not enter wildcard expansion, and ordinary defaults remain writable.
- Install an older signed external driver package that omits both ownership
  fields. Confirm SELECT completion still exposes its columns while INSERT
  snippets, table transfer and generated target DDL fail closed with a review
  message. Repeat with a new package that explicitly sends `false` for both
  fields to prove that backward compatibility does not become implicit trust.
- Run the JDBC Agent fixture with drivers that implement and omit
  `IS_GENERATEDCOLUMN`, plus ClickHouse `DEFAULT`/`MATERIALIZED`/`ALIAS`/
  `EPHEMERAL` and rqlite `table_xinfo` fixtures. The local Java harness was
  skipped on 2026-08-10 because this runner had no JDK fixture; do not treat the
  successful Rust sidecar suites as JDBC product conformance evidence.

## INSERT value inlay hints

- In a real Monaco/WebView session, open large PostgreSQL, MySQL, SQLite and
  SQL Server scripts and verify explicit plus implicit `INSERT ... VALUES`
  hints while scrolling, editing, undoing and switching connections. Confirm a
  stale schema response cannot repaint hints for the new owner.
- Cover multi-row values, nested function/JSON expressions, quoted Unicode
  identifiers, SQL Server target aliases/table hints, PostgreSQL overriding
  clauses, comments and dollar-quoted strings. Hint positions must remain
  UTF-16 correct and INSERT-SELECT/default-values statements must stay quiet.
- Against real metadata, verify omitted-column order for identity,
  auto-increment, generated/computed, hidden/temporal and ordinary-default
  combinations. The phase's unit and subprocess tests do not replace these
  provider/product checks, and no database was opened during implementation.

## Target-table identity and default review

- For PostgreSQL, MySQL/MariaDB and SQLite, preview a missing transfer target
  with same-product and cross-product sources. Confirm supported same-product
  auto-increment columns create a new target-owned generator, while cross-product
  identities, generated columns and SQLite composite/non-integer primary keys
  are materialized as ordinary columns and remain Review-only.
- Verify every source default expression is shown as `default omitted`, changes
  the per-column compatibility to Review, participates in the confirmation
  digest, and never appears in generated target DDL. Verify generator names,
  identity ALWAYS/BY DEFAULT mode, sequence ownership and current values are not
  claimed as retained.
- Run generated PostgreSQL/MySQL/SQLite DDL against empty fixtures only in the
  consolidated database-validation phase. The Windows Rust test binary compiled
  on 2026-08-10 but exited before the harness with
  `STATUS_ENTRYPOINT_NOT_FOUND`; Clippy and the strict frontend production build
  passed, but they are not database conformance evidence.

## Oracle system values and product code blocks

- In a real Monaco/WebView session bound to Oracle and OceanBase Oracle, type
  prefixes for `SYSDATE`, `SYSTIMESTAMP`, `SESSIONTIMEZONE`, `DBTIMEZONE`,
  `CURRENT_DATE`, `CURRENT_TIMESTAMP`, `LOCALTIMESTAMP`, `USER` and `UID` in
  SELECT, predicate, CASE and INSERT-value expressions. Accepting an item must
  insert the bare value with no `()` and preserve undo/cursor behavior.
- Confirm the same values stay absent from PostgreSQL, generic JDBC and other
  compatibility profiles, and stay absent in relation targets, comments,
  literals and qualified-column completion. A live same-name routine must keep
  metadata precedence.
- Accept the Oracle-family `merge` and `plsql` snippets with upper/lower keyword
  settings and tab through every placeholder. Confirm Oracle aliases contain no
  `AS`, a same-id user snippet overrides the built-in, and other products never
  receive these blocks. No database was opened during Phase 101 implementation.

## Db2 special registers and Dameng functions

- In real Monaco/WebView sessions bound separately to Db2 and Dameng, accept
  `SYSDATE`, current date/time/timestamp and local timestamp candidates in
  SELECT, predicate, CASE and INSERT-value expressions. Db2 special registers
  must remain bare (including spaced and underscore forms); Dameng date/time
  functions must retain `()` and signature help.
- Verify Db2 `ADD_DAYS`/`ADD_MONTHS`/formatting functions and Dameng
  `TO_DATE`/`DATEADD`/`DATEDIFF`/`REGEXP_SUBSTR` against supported server-version
  fixtures. Live routine metadata must continue to outrank static entries, and
  generic JDBC or unrelated compatibility products must receive neither
  catalog.
- Accept the Db2 `regs` and Dameng `dmdt` command blocks with upper/lower keyword
  settings, user override/disable behavior and undo. Confirm product switching
  immediately removes the previous product's block. No database was opened
  during Phase 102 implementation.

## Blank-line execution and native editor clipboard actions

- In a real Tauri/Monaco session, place the cursor on leading, inter-statement
  and trailing physically blank lines, including CRLF and whitespace-only
  lines around UTF-16 text. With the preference disabled, Run Current must not
  execute an adjacent statement and the current-statement frame must clear;
  the status bar should announce the no-op once without stealing focus.
- Enable `Run all SQL from a blank line` and repeat with parameterized and
  destructive multi-statement documents. The exact full document must still
  pass parameter input, confirmation, transaction binding and duplicate-run
  gates. A non-empty selection and a cursor on an indented SQL line must keep
  priority over the fallback.
- Verify Monaco's native Cut/Copy/Paste menu on Windows, macOS and Linux with
  ordinary, multi-cursor, Vim visual and read-only selections. Undo must restore
  a cut/paste as one editor operation and clipboard denial must leave the model
  unchanged. The Rust test compiled during Phase 103 but this Windows runtime
  still exited before the harness with `STATUS_ENTRYPOINT_NOT_FOUND`; no
  database was opened.

## Manticore, SQLite and Cloudflare D1 static signature boundaries

- In real Monaco/WebView sessions, bind separate documents to Manticore Search,
  SQLite and Cloudflare D1. Confirm Manticore exposes all 31 DBX product
  signatures, including `POLY2D`, `TO_STRING`, `CRC32`, `DATE_FORMAT` and the
  date-part functions, with editable variadic placeholders and signature help.
- Confirm SQLite offers the DBX convenience `NOW()` completion while Cloudflare
  D1 does not expose `NOW` through either completion or signature help. D1 must
  retain `JSON_EXTRACT`, `JSON_SET`, `STRFTIME`, `IFNULL` and portable common
  functions without inheriting other MySQL-baseline functions.
- Repeat with live routines that collide with static names and verify live
  metadata, overloads and documentation remain authoritative. Exercise supported
  Manticore, SQLite and D1 server versions only during the consolidated database
  validation phase; no database was opened during Phase 104 implementation.

## MySQL and MariaDB existing-view save semantics

- In supported MySQL and MariaDB fixtures, create views with explicit
  `ALGORITHM`, `DEFINER`, `SQL SECURITY`, comments and dependent objects, then
  open them through Edit View and save a changed SELECT body. Confirm the Host
  sends `ALTER VIEW`, keeps the same qualified object, and preserves every
  server-owned property that ALTER is documented to retain.
- Confirm Create View still sends `CREATE VIEW`, the explicit Replace Existing
  action uses `ALTER VIEW`, PostgreSQL keeps `CREATE OR REPLACE VIEW`, and
  SQLite continues to reject replace instead of guessing a drop/recreate flow.
- Verify syntax/error mapping, metadata-cache invalidation, refreshed definition
  text and undoable editor state against supported server versions during the
  consolidated database-validation phase. Phase 105 compiled the offline Rust
  tests but the Windows unit-test process exited before its harness with the
  known `STATUS_ENTRYPOINT_NOT_FOUND`; no database was opened.

## ClickHouse complete function registry and table-function completion

- Against supported ClickHouse 23.x, 24.x and 25.x fixtures, compare
  `system.functions` and `system.table_functions` with the bundled DBX-derived
  snapshot. Record additions, removals, aliases, experimental/deprecated
  changes and server-version boundaries without silently mutating the shipped
  static catalog at runtime.
- In a real Monaco/WebView session, test canonical and alias prefixes, zero- and
  fixed-argument calls, overloads, optional/variadic parameters, parametric
  aggregate groups, window functions and generated `Array`/`Map`/`ForEach`/
  `Distinct`/`If`/`Resample`/state combinator sequences. Confirm signature help
  selects the active parameter group and live routine metadata remains
  authoritative for collisions.
- In `FROM` and `JOIN` relation positions, accept representative entries from
  all 90 table functions, including `numbers`, `file`, `s3`, `mysql`,
  `postgresql`, `remote` and `url`. Confirm these candidates remain absent from
  expression positions and ordinary scalar/aggregate functions remain absent
  from relation positions.
- Measure cold and warm completion latency for empty, broad, alias-only,
  combinator and no-match prefixes in the packaged desktop process. Verify the
  100-item and 64 KiB bounds, cancellation, stale-response rejection, undo and
  product switching. Phase 106 performed no real ClickHouse or other database
  connection; all live/version/Monaco checks remain in this consolidated queue.

## Portable window-function completion blocks

- In real Monaco/WebView sessions for PostgreSQL, MySQL/MariaDB, SQLite,
  SQL Server, Oracle, Db2, Dameng and representative compatibility profiles,
  accept `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `LAG`, `LEAD`, `FIRST_VALUE`,
  `LAST_VALUE` and `NTILE`. Tab through function arguments, partition and order
  expressions; verify undo, casing preferences and completion cancellation.
- Verify each supported server version accepts the generated call shape and
  document product/version exceptions. Confirm live same-name routine metadata
  wins, relation targets/comments/literals receive no window blocks, and
  ClickHouse keeps its product-registry `row_number()` shape without an injected
  portable `OVER` block.
- Phase 107 added source and packaged LSP protocol coverage only. No database
  was opened; server-version syntax and real Monaco interaction remain deferred.

## Oracle table-function relation sources

- Against supported Oracle and OceanBase Oracle versions, verify `TABLE`,
  `THE`, `XMLTABLE` and `JSON_TABLE` suggestions in `FROM` and `JOIN`, including
  valid collection-returning routines, package/schema qualification, overloads
  and quoted identifiers. Confirm procedures and scalar-only routines do not
  appear inside `TABLE(...)`, and document any server-version syntax boundary.
- In a real Monaco/WebView session, accept each static block and a synchronized
  packaged routine, then tab through arguments and the generated table alias.
  Confirm tab stops remain unique, the full typed qualifier is replaced once,
  undo is atomic, cancellation/stale-response guards hold, and switching away
  from an Oracle-family product removes these candidates immediately.
- Phase 108 added source and packaged subprocess coverage only. No Oracle,
  OceanBase or other database was opened; provider metadata accuracy, actual
  collection return types, product-version syntax and Monaco interaction remain
  in the consolidated validation queue.

## Grid predicate completion and typed local sorting

- In a real Monaco/WebView session, exercise the table WHERE input with keyboard,
  mouse, IME and screen-reader navigation. Cover quoted/non-ASCII columns,
  prefix `NOT`, column `NOT`, `IS NOT`, nested predicates, `BETWEEN`, numeric and
  quoted `IN` lists, typed values, cancellation, history and stale LSP results.
  Confirm zero-width continuation acceptance preserves the preceding literal
  and keeps undo atomic.
- Against supported PostgreSQL, MySQL/MariaDB, SQLite, SQL Server and Oracle
  fixtures, compare database-side filter/sort results with local loaded-result
  sorting for signed/exponent/large decimal values, dates, booleans, natural
  text, duplicate values and NULL in both directions. Record collation,
  timezone, NaN and product-specific NULL-order differences explicitly rather
  than presenting local ordering as a server-wide guarantee.
- Phase 109 added pure model and component coverage only. No database was
  opened; real provider/Monaco interaction and server ordering conformance stay
  deferred.

## High-frequency SQL keyword ranking

- In real Monaco/WebView sessions, type overlapping prefixes across supported
  relational profiles and confirm DBX's common-keyword preference is visible
  without crossing the server's column/table/function semantic groups.
- Build connection-scoped usage history for both common and less-common
  candidates, then confirm the numeric personal usage rank remains stronger
  than the static alphabetic frequency tier. Cover upper/lower/preserve casing,
  cancellation, inline suggestions, keyboard acceptance and undo.
- Phase 110 added source and packaged LSP protocol coverage only. No database
  was opened; real Monaco ordering and provider/version interaction remain in
  the consolidated validation queue.

## Shared popup and inline completion enrichment

- In a real Monaco/WebView session, compare popup and ghost-text results for
  qualified members, completed clause keywords, product functions, portable
  window blocks, ClickHouse/Oracle relation functions and table-aware INSERT
  snippets. Verify Tab acceptance, next-word acceptance, undo, multi-cursor,
  Vim, IME and casing preferences do not duplicate or replace existing text.
- With a controlled slow AI provider, verify local enriched candidates still
  win deterministically, the 32-item context limit remains bounded, cache keys
  change with enriched schema context, and cancellation/stale model guards
  prevent an older response from replacing a newer local continuation.
- Phase 111 adds source, frontend and packaged subprocess coverage only. No
  database was opened; live provider timing and real Monaco interaction remain
  in the consolidated validation queue.

## Configured command blocks across popup and inline completion

- In a real Monaco/WebView session, accept built-in, user-edited and user-disabled
  command blocks from both popup and ghost text. Cover upper/lower/preserve
  keyword casing, exact and fuzzy prefixes, personal usage history, undo,
  next-word acceptance, IME, Vim and multi-cursor behavior.
- Switch between Oracle/OceanBase Oracle, Manticore Search, Db2, Dameng, a
  generic relational package and native non-SQL products. Confirm product-only
  blocks disappear immediately, custom bodies remain authoritative, and no SQL
  command block leaks into MongoDB, Redis or Elasticsearch editors.
- Stop/restart the bundled LSP while typing a command trigger and confirm the
  deterministic local block remains available, no stale server candidate
  replaces it, insertion-level deduplication holds, and the combined context
  never exceeds 32 candidates.
- Phase 112 adds pure frontend coverage and a production build only. No database
  was opened; real Monaco, AI-provider timing and product/package interaction
  remain in this consolidated queue.

## Independent SQL function casing across all dialect routes

- In real Monaco/WebView sessions, exercise `preserve`, `upper` and `lower`
  function casing independently from keyword casing. Cover built-in scalar and
  aggregate functions, portable window blocks, system values, ClickHouse table
  functions, and Oracle `TABLE`/`THE` versus `XMLTABLE`/`JSON_TABLE` semantics.
- Repeat the matrix for Oracle/OceanBase Oracle, PostgreSQL, MySQL/MariaDB,
  SQLite, ClickHouse, Hive, Db2, Dameng and representative generic JDBC
  profiles. Confirm a settings change invalidates popup and inline providers
  once, without stale candidates or duplicate registration.
- Synchronize mixed-case live routines and accept user-edited command blocks.
  Confirm metadata/user text keeps its original spelling while only generated
  catalog candidates follow `functionCase`; verify Tab, undo, IME, Vim,
  cancellation and LSP restart behavior.
- Phase 114 adds settings/config contracts, source and packaged LSP coverage,
  and frontend logic coverage only. No database was opened; server-version
  acceptance and real Monaco/product-package interaction remain deferred.

## Formatter casing as the completion and formatting source of truth

- In a real Monaco/WebView session, apply full-document and range formatting
  with every independent `keywordCase`/`functionCase` combination. Verify
  selection, cursor, scroll position and undo restoration, and confirm popup,
  inline and local command-block casing changes exactly once after a setting
  update without stale provider output.
- Cover quoted and schema-qualified functions, mixed-case live/user routines,
  relation and CTE names, data types, bind/template placeholders, comments,
  strings, malformed interactive SQL and very large documents. Only unquoted
  invocation names may follow `functionCase`; protected text must remain exact.
- Repeat formatter output checks for PostgreSQL, MySQL/MariaDB, SQLite,
  ClickHouse, Hive and representative compatibility/JDBC packages. Confirm
  MongoDB, Redis and Elasticsearch formatters remain isolated from SQL casing
  preferences, and record unsupported dialect differences rather than claiming
  universal formatter conformance.
- Phase 115 adds source LSP tests, Clippy, frontend settings/cache tests, a
  production frontend build and bundled subprocess coverage only. No database
  was opened; real Monaco interaction, performance and product conformance stay
  deferred.

## Oracle Agent execution error ranges in Monaco

- Against real Oracle and OceanBase Oracle packages, trigger ORA-00904 and
  generic Agent failures at offset zero, across multiple lines, after non-ASCII
  text and inside a selected statement in a multi-statement document. Confirm
  the package's reported offset convention matches the zero-based execution
  contract before claiming product conformance.
- Cover unquoted, quoted, schema-qualified and repeated identifiers. Monaco
  must underline the nearest complete invalid token, preserve quoted case,
  expose the original error on hover, and clear the marker after editing,
  successful rerun, tab/connection switch or stale execution completion.
- Repeat representative messages through JDBC/ODBC packages and verify a
  malformed or out-of-range position creates no guessed marker. Structured
  native PostgreSQL positions must continue using their one-based character
  contract without regression.
- Phase 116 adds pure error-model coverage, a green 237-file/1,261-test frontend
  suite and a production frontend build only. No database was opened; real
  Agent offsets and Monaco interaction remain in the consolidated validation
  queue.

## MongoDB Extended JSON clone and mutation fidelity

- Against MongoDB 4.4, 5, 6, 7 and 8 fixtures, read and write ObjectId, date,
  int32/int64, Decimal128, binary subtypes, timestamp, regex, JavaScript/code,
  MinKey/MaxKey and deeply nested mixed arrays through find, aggregate, insert
  and update. Compare BSON type tags on the server, not only rendered JSON.
- When a visual DocumentBrowser/Grid clone surface is introduced, preserve the
  source document identity and explicit edited-field set. Unedited fields must
  reuse their canonical Extended JSON values, `_id` handling must be explicit,
  and preview must distinguish literal strings such as `ISODate(...)` from
  actual `$date` wrappers.
- Exercise malformed wrappers, unsupported binary subtype, out-of-range numeric
  values, timezone offsets, duplicate keys, payload limits, cancellation and
  error redaction. No shell-like string may be evaluated or silently coerced.
- Phase 117 passes `cargo clippy --lib -- -D warnings` and a locked-dependency
  minimal Rust round-trip executable. The formal `oxide_studio_lib` unit test
  target compiles, but this Windows environment exits before tests with
  `STATUS_ENTRYPOINT_NOT_FOUND`; rerun those committed tests in CI/a repaired
  host. No database was opened.

## Pending SQL completion acceptance on Tab

- In a real Monaco/WebView session backed by a deliberately slow completion
  provider, type a valid prefix and press Tab before the provider resolves.
  Verify one applicable suggestion is accepted atomically, an empty/cancelled
  result performs exactly one normal Tab edit, and a stale result after further
  typing or a model/connection switch performs no edit.
- Repeat inside INSERT/function/custom-command snippets. Existing tab stops
  must advance immediately and must not be stolen by a pending popup. Cover an
  inline ghost and popup appearing together, IME composition, Vim insert and
  normal modes, multi-cursor, read-only documents, undo and configured tab size.
- Confirm `manual` completion mode never starts completion from Tab, while
  `positional` and `require-prefix` keep their existing semantic trigger gates.
  Phase 118 adds option-contract tests only; no database was opened and real
  Monaco/provider timing remains in the consolidated validation queue.

## Relation alias matching, quoting, and case semantics

- Against PostgreSQL, MySQL, SQL Server, Hive, and ClickHouse fixtures, create
  normal aliases with mixed case and quoted aliases which collide after case
  folding. Verify that ordinary aliases resolve case-insensitively for
  `alias.` column completion, while double-quoted, backtick, and bracketed
  candidate insertions retain their exact source spelling and remain separate
  selectable items.
- Repeat with Unicode/Chinese relation and alias names, schema-qualified and
  cross-schema sources, CTE/derived scopes, and correlated outer aliases. Check
  exact, prefix, abbreviation, and subsequence ranking; no lookup may select a
  different physical relation merely because quoted and unquoted names share a
  normalized spelling.
- In a packaged Monaco/WebView session, accept each candidate and confirm the
  following `.` trigger, filtering, undo, IME, Vim, multi-cursor, cancellation,
  and slow metadata behavior. Phase 119 covers LSP library and dialect contracts
  only; no database was opened.

## Elasticsearch index grouping and least-privilege discovery

- Run Elasticsearch 6.8, 7.17, and 8.x fixtures with `_cat/indices` available,
  denied with 401/403 while `_resolve/index/*` remains available, and denied
  until `_alias` is the final available route. Verify that only visible indices
  and data streams appear; hidden `.` indices must not leak through any path.
- Configure valid, empty, `off`, and invalid grouping patterns. Check that
  grouped rolling collections use a safe `*` name, aggregate only known counts,
  preserve ordinary index names, and continue to map fields/query requests
  correctly. Exercise Kibana proxy and direct HTTP(S) connection URLs.
- Re-run the focused Rust test executable after repairing the Windows incremental
  target/DLL entry-point environment. Phase 120 source checks and frontend URL
  contract tests pass; no live Elasticsearch cluster was opened.

## Object-browser table tab reuse policy

- In a packaged WebView, open tables/views/materialized views from the Explorer,
  remote PostgreSQL database tree, command palette, and import actions under
  `same-table`, `always-new`, and `active-tab`. Verify tab identity, focus,
  query cancellation, row loading and persisted setting behavior after restart.
- Keep staged edits, active execution, failed results, different connection IDs,
  and different PostgreSQL databases as non-reusable boundaries. Confirm that a
  switch never flashes previous relation rows, filters, metadata, or selection,
  and that undoable table edits are never discarded.

## LSP alias metadata-schema convergence

- With PostgreSQL, MySQL, SQL Server, Hive, and ClickHouse metadata fixtures,
  use ordinary mixed-case aliases in `SELECT`, `WHERE`, `JOIN`, nested CTEs,
  derived sources, and correlated queries. Popup, inline completion, hover,
  code action, and schema inference must resolve the same physical relation.
- Repeat with double quotes, backticks, SQL Server brackets, aliases differing
  only by case, non-ASCII identifiers, stale metadata and live schema refresh.
  Quoted collisions must remain explicit rather than silently selecting a
  different relation. Phase 122 adds no database connection.

## LSP quoted-alias code actions

- In a real Monaco menu, verify qualify/unqualify and batch-qualify actions for
  ordinary aliases beside double quotes, backticks and SQL Server brackets,
  including `u`/`"U"` collisions, escaped identifier characters and Unicode.
  The action must preserve the selected source's original SQL spelling and
  never remove a qualifier when its unqualified column would be ambiguous.
- Repeat after a schema refresh and with metadata from PostgreSQL, MySQL and
  SQL Server. Phase 123 is library-only and makes no database connection.

## Grid SQL-expression cell mutation

- With PostgreSQL and MySQL fixtures, stage `CURRENT_TIMESTAMP`, arithmetic,
  casts and column-aware functions from the value editor; verify preview,
  undo/cancel, parameter ordering and resulting server values. Confirm that
  aggregates, context filters and FK navigation do not treat an uncommitted
  expression as an observed database value.
- Verify driver error mapping, generated/identity/read-only columns, SQL Server
  and SQLite dialect contracts, multiline editor behavior, IME and screen-reader
  focus. Phase 124 performs no database connection.
# Phase 128 — whole-schema SQL export

- Run PostgreSQL fixtures that cover empty schemas, generated/identity columns, foreign-key ordering, large relations, cancellation during metadata and data pages, and restore into a clean target.
- Validate the exported structure/data against `pg_dump`/DBX for foreign-key ordering, sequences, views, materialized views, routines, extensions, grants, comments, ownership, RLS policies, partitioning, and privilege-sensitive objects. These are deliberately omitted by the initial relation-only path.
- Add a signed, product-owned backup contract before enabling this command for an external driver or a non-PostgreSQL built-in dialect.
