# LSP SQL Server Integration Guide

## Overview

OxideStudio integrates with the [lsp_sqls](https://github.com/RainLib/lsp_sqls) Language Server Protocol (LSP) server to provide SQL intelligence through the bundled `sql-lsp` binary.

## Current Status

✅ **Completed Infrastructure:**

- Phase 1: LSP process management with lifecycle control
- Phase 2: Tauri commands for frontend communication
- Phase 3: TypeScript client service and React hooks
- Phase 4: Monaco Editor completion, hover, definition, references, formatting, and diagnostics integration
- Phase 5: **Bidirectional IPC with async stdio** (JSON-RPC communication)
- Phase 6: Relational schema synchronization through `LspConnectionSyncer`
- Phase 7: Bounded Redis key and Elasticsearch index context synchronization through the LSP schema model, including Elasticsearch mapping fields when available
- Phase 8: Non-blocking Tauri command lifecycle; LSP requests clone the manager handle before awaiting server responses
- Phase 9: MongoDB/JSON dialect support in `lsp_sqls` with bounded collection context synchronization
- Phase 10: Live driver coverage for PostgreSQL, MySQL, Redis, MongoDB, and Elasticsearch via `scripts/test-live-databases.sh`
- Phase 11: Schema-aware Redis, MongoDB, and Elasticsearch DSL LSP completion/hover/definition assertions in `lsp_sqls`
- Phase 12: Bundled `sql-lsp` JSON-RPC integration test for Redis, MongoDB, and Elasticsearch schema completions
- Phase 13: Frontend LSP schema config tests for Redis keys, MongoDB fields/indexes, Elasticsearch mapping fields, and server-inferable document URIs
- Phase 14: Extracted and tested frontend LSP sync planning for target schemas, file schema/dialect mappings, and duplicate-send config keys
- Phase 15: DML-aware SQL completion contexts for `INSERT INTO`, `UPDATE`, `DELETE FROM`, `TRUNCATE TABLE`, and `JOIN ... ON` table/column inference
- Phase 16: Extracted and tested frontend LSP metadata caching and configuration dispatch for stale/duplicate schema syncs
- Phase 17: Added relation-target/predicate completion regressions and disabled Monaco word suggestions so SQL editor completions stay LSP-owned
- Phase 18: Extracted and tested frontend LSP debounce scheduling, cleanup cancellation, and replacement timer behavior
- Phase 19: Added LSP client tests for `lsp_did_change_configuration` Tauri command dispatch and pre-initialization no-op behavior
- Phase 20: Bundled LSP now returns `TextEdit` ranges for schema-qualified relation/function completions so `public.us` and `test_db.calc` replace the full typed token instead of duplicating qualifiers
- Phase 21: Bundled LSP integration tests now assert schema-qualified relation completions include full-token `TextEdit` replacement ranges
- Phase 22: React render-level coverage now mounts `LspConnectionSyncer` against real Zustand store state and asserts the derived schema configuration is sent through the LSP client
- Phase 23: Docker-backed live database tests now include AI tool-equivalent metadata, read, mutation, and destructive assertions over `ConnectionManager` for PostgreSQL, MySQL, Redis, MongoDB, and Elasticsearch
- Phase 24: SQL completion now scopes referenced table inference to the cursor's current query, so subquery and CTE completions avoid leaking outer or nested table columns
- Phase 25: Alias member completion and schema selection now use scoped aliases, so same-named aliases in subqueries do not override the cursor's current query alias
- Phase 26: File-level schema inference now uses the same CTE-aware table reference extraction as completion, so CTE names do not create false schema ambiguity
- Phase 27: Completed clause keyword completions are pruned by expected target kind, so `FROM`/`JOIN` cannot surface field names and `WHERE`/`ON` cannot surface relation targets; Tauri now preserves LSP `textEdit` ranges for Monaco.
- Phase 28: PostgreSQL and MySQL predicate completions now split expression and operator phases, so `WHERE` starts with scoped fields/functions and comparison operators appear only after a left-side expression.
- Phase 29: ClickHouse and Hive now follow the same predicate completion phases, keeping fields ahead of operators at `WHERE` starts and moving operators to the left-expression position.
- Phase 30: SQL `HAVING` completions now use the same predicate phase split across PostgreSQL, MySQL, Hive, and ClickHouse; MySQL predicate completions also include symbol operators such as `=`.
- Phase 31: SQL completion now distinguishes DDL `ON` relation targets from predicate `JOIN ... ON`, so `CREATE INDEX ... ON` suggests tables and `ON table (` suggests scoped columns; DML completion regressions cover `INSERT`, `UPDATE`, `DELETE`, and `RETURNING`.
- Phase 32: SQL `JOIN ... USING (` completions now use a dedicated context across PostgreSQL, MySQL, Hive, and ClickHouse, suggesting only shared join columns and excluding relation targets or predicate operators.
- Phase 33: SQL `ALTER TABLE` completions now distinguish column and constraint targets, so `DROP/ALTER/RENAME COLUMN` suggests scoped columns and `DROP/RENAME CONSTRAINT` suggests scoped constraints instead of relation names.
- Phase 34: SQL `ALTER TABLE <table> ` completions now suggest dialect-aware structure actions such as `ADD COLUMN`, `DROP COLUMN`, and `ADD CONSTRAINT` instead of continuing to suggest relation targets.
- Phase 35: SQL `INSERT INTO <table> `, `UPDATE <table> `, and `DELETE FROM <table> ` completions now suggest dialect-aware DML actions instead of continuing to suggest relation targets or scoped fields.
- Phase 36: SQL index-target completions now use synchronized index metadata, so `DROP INDEX`, `ALTER INDEX`, and MySQL-style `ALTER TABLE ... DROP/RENAME INDEX` suggest index names instead of tables or fields.
- Phase 37: SQL column definition completions now suggest dialect-aware data types for `CREATE TABLE` and `ALTER TABLE ... ADD COLUMN` positions instead of tables, fields, or operators.
- Phase 38: SQL data type completions now cover common ALTER forms including `ADD` without `COLUMN`, PostgreSQL `ALTER COLUMN ... TYPE`, and MySQL `MODIFY/CHANGE COLUMN`.
- Phase 39: MySQL-style `ALTER TABLE ... MODIFY/CHANGE [COLUMN]` completions now suggest the target table's existing columns before switching to data type suggestions after the column name.
- Phase 40: SQL foreign-key `REFERENCES` completions now suggest relation targets and scope `REFERENCES table (...)` column lists to the referenced table.
- Phase 41: SQL foreign-key `REFERENCES table ` completions now suggest follow-up actions such as `(`, `ON DELETE`, and `ON UPDATE` instead of falling back to generic keywords.
- Phase 42: SQL foreign-key `ON DELETE` and `ON UPDATE` completions now suggest referential rules such as `CASCADE`, `RESTRICT`, `NO ACTION`, and `SET NULL`.
- Phase 43: SQL `ORDER BY <expression> ` completions now switch to sort direction suggestions and expose PostgreSQL `NULLS FIRST`/`NULLS LAST` options instead of repeating fields.
- Phase 44: SQL `ORDER BY` modifier completions now advance through direction, PostgreSQL `NULLS`, and continuation stages without repeating completed sort directions.
- Phase 45: SQL `GROUP BY <expression> ` completions now suggest follow-up clauses such as `HAVING`, `ORDER BY`, and `LIMIT` instead of columns or sort directions.
- Phase 46: SQL `FROM <relation> ` and `JOIN <relation> ` completions now switch to structural follow-ups such as joins, predicates, `ON`, and `USING` instead of repeating relation targets.
- Phase 47: SQL `SELECT <expression> ` completions now suggest `FROM`, `AS`, or `,` instead of repeating fields, while wildcard selections omit invalid alias suggestions.
- Phase 48: SQL `INSERT ... VALUES (` completions now suggest value keywords such as `DEFAULT`, `NULL`, and timestamp constants instead of columns or relation targets.
- Phase 49: SQL predicate and assignment right-hand completions now switch to value keywords after operators, so `WHERE col = ` and `SET col = ` stop repeating fields, relation targets, or operators.
- Phase 50: SQL predicate and assignment completions now advance after completed values, suggesting `AND`/`OR`/follow-up clauses or `SET` assignment continuations instead of repeating operators.
- Phase 51: SQL `IN (...)` value-list completions now keep suggesting value keywords after commas, so `WHERE col IN ('a', ` does not fall back to fields or operators.
- Phase 52: SQL `BETWEEN` completions now narrow the first-bound continuation to `AND`, avoiding invalid `OR`, query follow-ups, fields, or operators before the upper bound.
- Phase 53: SQL `CASE WHEN` condition completions now use predicate-aware fields, right-hand values, `THEN` continuation, and `BETWEEN` first-bound handling instead of falling back to `SELECT` or default suggestions.
- Phase 54: SQL `CASE THEN/ELSE` result completions now have dedicated result-expression and `WHEN`/`ELSE`/`END` continuation states, including string literal handling such as `THEN 'end' `.
- Phase 55: SQL simple `CASE expression WHEN value THEN ...` completions now distinguish match-value positions from searched `CASE WHEN` predicates, so `WHEN` values suggest expressions and completed values narrow to `THEN`.
- Phase 56: SQL `INSERT ... VALUES (...) ` completions now suggest dialect-specific continuations such as PostgreSQL `ON CONFLICT`/`RETURNING` and MySQL `ON DUPLICATE KEY UPDATE`.
- Phase 57: PostgreSQL `ON CONFLICT` completions now suggest target columns inside `ON CONFLICT (` and action choices such as `DO NOTHING` and `DO UPDATE SET` after the target.
- Phase 58: PostgreSQL `ON CONFLICT ON CONSTRAINT` completions now suggest usable target-table primary/unique/exclusion constraints and return to `DO NOTHING`/`DO UPDATE SET` after a constraint name.
- Phase 59: PostgreSQL `ON CONFLICT DO UPDATE SET` completions now behave like assignment editing: bare target columns, operators after a column, value keywords after `=`, and `WHERE`/`RETURNING` continuations after completed values.
- Phase 60: MySQL `ON DUPLICATE KEY UPDATE` completions now support assignment editing with target columns, operators, value keywords, and comma continuation for additional assignments.
- Phase 61: Hive and ClickHouse predicate completions now scope `WHERE`/`HAVING` fields to referenced tables, use bare column labels for single-table predicates, and avoid leaking unrelated table columns.
- Phase 62: MySQL `INSERT ... SET` completions now support assignment editing and continue with `,` or `ON DUPLICATE KEY UPDATE` after completed values instead of invalid `WHERE` suggestions.
- Phase 63: LSP processes are isolated by connection/language session, reference-counted across panes, health-checked and recovered after crashes, and shut down after a 30-second idle grace period.
- Phase 64: Timed-out requests send the standard `$/cancelRequest` notification; document synchronization is capped at 4 MiB and document text is no longer written to logs.
- Phase 65: Schema, table/key/index/collection, and column metadata now carry credential-free `oxide://database-object` source URIs. Definition jumps reveal the real Database Explorer object; references and safe rename cover all open documents in the same schema.
- Phase 66: Monaco now consumes signature help, range formatting, rename, code actions, document/workspace symbols, folding, selection ranges, semantic tokens, and routine-parameter inlay hints through a strict Tauri request allowlist.
- Phase 67: SQL inspections cover parser errors, mutation without `WHERE`, unconditioned joins, ambiguous unqualified columns, `SELECT *`, and obvious cross-dialect syntax risks. Quick fixes provide a non-matching mutation safety guard and schema-backed `*` expansion; `-- noinspection OXIDE###` suppresses a specific inspection.
- Phase 68: Completion models CTE output columns, derived-table aliases, current-console temporary table creation/drop lifecycle, and routine overload signatures.
- Phase 69: The bundled binary is rebuilt from the checked-out submodule worktree and accompanied by `sql-lsp.manifest.json`; startup verifies its SHA-256 and exposes the source revision/dirty state.
- Phase 70: MongoDB completion is cursor-context aware: collection-valued command properties suggest collections, filter/document objects suggest only the active collection's fields, field values stay quiet, and operator/pipeline positions suggest MongoDB operators and aggregation stages.
- Phase 71: MongoDB Monaco documents automatically open completion for key and collection positions while avoiding value-literal popups; stale and cancelled requests are discarded and didChange is deduplicated when the model text is already synchronized.
- Phase 72: Elasticsearch Console completion covers mapping-field positions inside quoted `field`, `fields`, `_source`, `docvalue_fields`, and `stored_fields` values, with current-index metadata isolation and automatic popup behavior.
- Phase 73: Elasticsearch Console and LSP completion share the detected server-version contract: ES 6 uses typed document/update/explain paths, ES 7/8 use typeless `_doc`, `_update`, and `_explain`, and DSL proposals are gated at the minor-version boundary (`runtime_mappings` 7.11+, `combined_fields` 7.13+, `knn` 8+). Driver execution keeps the same ES 6/7/8 rewrite contract.
- Phase 74: Table data tabs expose a compact DataGrip-style WHERE completion input. It builds a virtual dialect-aware `SELECT ... WHERE` document, returns current-table columns immediately, then merges authoritative LSP candidates without blocking filtering during a cold/restarting LSP session.
- Phase 75: Relational scope completion is tested consistently across PostgreSQL, MySQL, Hive, and ClickHouse: before a FROM target is bound candidates retain `table.column`, one bound table uses short column names, and multi-table JOIN/WHERE contexts use aliases to remain unambiguous. Prefix, middle, subsequence, and camel-case abbreviation matching are covered.
- Phase 76: PostgreSQL, MySQL, Hive, and ClickHouse generate relationship-aware JOIN snippets from single or composite foreign-key metadata, including aliases and dialect-specific schema qualification.
- Phase 77: SQL completion preferences are user-configurable: keyword casing and table-alias initials are applied by the LSP, while accepted candidates receive a bounded, per-project/database local usage score without crossing semantic sort groups.
- Phase 78: Predicate value completion reads bounded metadata domains such as MySQL `ENUM`/`SET` definitions, filters them as the user types, and inserts correctly escaped literals without running sampling queries.
- Phase 79: A shared large-catalog regression test measures cold relation completion across PostgreSQL, MySQL, Hive, and ClickHouse with 2,500 tables and enforces a five-second debug-build ceiling. The current local run completed each dialect in under 7 ms after construction.
- Phase 80: A signed driver contract may explicitly select `lspLanguageId: "sql"` for a SQL-shaped non-relational engine. Manticore Search and QuestDB therefore use the SQL editor and the generic metadata-completion path without changing their `dataModel`; their table workspace remains unavailable because relational Grid behavior is never inferred from editor language alone.
- Phase 81: Saved project SQL virtual documents are bound to the active connection's schema configuration and are proactively closed when that context disappears (connection/LSP disabled, final query tab closed, or project root removed). A failed or delayed metadata sync therefore cannot leave a project file attached to an old database session.
- Phase 82: Visible relation aliases are first-class LSP `Variable` completions. The parser keeps both the normalized alias and its original SQL spelling, so quoted aliases are inserted byte-for-byte, aliases stay out of relation targets/comments/strings, and the completion hot path does not run a second tree-sitter parse.
- Phase 83: LSP refactor actions align DBX identifier intentions: a column can be qualified against its unique metadata-backed row source, an existing qualifier can be removed only when the result is unambiguous, multi-source ambiguity produces explicit alternatives, and selected columns can be batch-qualified with one bounded workspace edit. Physical tables, aliases, CTE projections, PostgreSQL quotes and MySQL backticks share the same safety rules.
- Phase 84: Automatic Monaco lightbulb requests no longer format the entire SQL document. The client forwards `CodeActionContext.only`; source formatting is computed only for an explicit source-action request, while quick fixes and local rewrites remain available normally.
- Phase 85: Current-statement framing caches the backend-authoritative, ordered UTF-16 range set for the Monaco model version (bounded to 10,000 statements). Cursor movement across cached statements and intervening whitespace avoids further Tauri parsing; an exact exclusive end, edit, model/connection switch or oversize-document fallback re-resolves safely. Selection and Mongo command frames render immediately, stale requests cannot repaint a newer cursor, and an unchanged range does not churn Monaco decorations.
- Phase 86: The bundled LSP caches a bounded semantic index for synchronized project SQL documents. Table/view/routine DDL becomes a workspace/document symbol and a definition fallback; physical relation and routine usages drive cross-document references and safe rename without matching comments, literals, unrelated columns or document-local CTEs. `includeDeclaration`, schema/project isolation, quoted and UTF-16 identifier ranges, SQL Server `database..table`, deterministic result ordering and explicit document/occurrence/result limits are enforced.
- Phase 87: Signature help now prefers live routine metadata and falls back to a dialect-aware built-in catalog when servers omit built-ins from schema discovery. A 64 KiB SQL-noise-aware call scan handles nested and qualified/Unicode calls, escaped and dollar-quoted strings, comments, optional parameters, overload ranking, and ClickHouse parameter groups. Results are capped at 50 overloads and known server versions gate catalog entries with declared minimum versions.
- Phase 88: The same dialect catalog now contributes expression-scoped function completions with editable LSP snippets. Live routine metadata wins, richer catalog entries replace legacy hard-coded duplicates, raw product identity survives compatibility parsing, and relation targets, qualified columns, comments and literals stay clean. Catalog expansion is bounded to 100 items per request and the context scan reuses the 64 KiB ceiling.
- Phase 89: Predicate and assignment value completion now resolves the current metadata column type and offers editable NULL/text/numeric/boolean/date/time/timestamp/UUID/JSON snippets after operators and `IN (`. PostgreSQL, MySQL, SQLite, Hive and ClickHouse share the bounded implementation across WHERE, HAVING, JOIN ON and UPDATE SET; conflicting types degrade to NULL, ENUM/SET declarations stay capped at 64 values, and no row sampling query is issued. The server also removes duplicate keyword/operator rows without collapsing same-name routine overloads.
- Phase 90: The desktop bridge now implements optional `completionItem/resolve`. Initialization advertises only the lazy fields Monaco can apply (`documentation`, `detail`, and `additionalTextEdits`), records the server's `resolveProvider`, round-trips opaque `data`, and sends a bounded 256 KiB item only after Monaco selects a server-backed proposal. Opaque item payloads and labels are no longer dumped by the completion client. Syntax/cache fallbacks are never sent to the server; cancellation or a document/connection/session owner change keeps the original proposal and drops late enrichment.
- Phase 91: The bundled SQL LSP now advertises `completionProvider.resolveProvider` and defers completion documentation for clients that explicitly support resolving `documentation`. A bounded FIFO cache retains at most 8,192 entries and 4 MiB total, refuses individual documentation payloads above 256 KiB, preserves any pre-existing opaque item data, and leaves oversized or uncached documentation inline. Evicted or unknown resolve identities still return the original usable completion item. Unit and real subprocess protocol tests cover capability negotiation, lazy payloads, data restoration, identity stability, and cache bounds without connecting to a database.
- Phase 92: Column completion now carries both the normalized relation alias and its exact SQL spelling. Multi-source candidates keep a readable `alias.column` label and bare-column `filterText`, while insertion preserves PostgreSQL/SQLite double quotes, MySQL/Hive/ClickHouse backticks, SQL Server brackets, and case-sensitive aliases. Qualified aliases imported from correlated outer queries use the same representation, so scope isolation remains intact without rewriting `"User Source".id` into invalid unquoted SQL. This aligns DBX commit `868f7961e` without adding another parser pass.
- Phase 93: SQL Server's connection database/catalog is no longer reused as a schema preference. Explorer cache hydration, remote metadata refresh, and the LSP sync plan now preserve an explicit schema selection but otherwise prefer an actually discovered `dbo` schema, while filtering `sys` and `INFORMATION_SCHEMA` from generic fallback. This aligns the default-schema recovery added in DBX commit `868f7961e` and keeps an unscoped query document attached to the same catalog with `dbo` metadata.

The shipped editor/LSP path has no known unimplemented protocol handler that it advertises. The renderer may synchronize a bounded, allowlisted set of saved project SQL files (`.sql`, `.psql`, `.pgsql`, `.mysql`; at most 128 files, 128 KiB each and 5 MiB total) through credential-free `oxide://project` URIs. It never exposes absolute paths, non-SQL files, ignored dependency folders, or secret-like dotfiles. Those synchronized files now participate in the cached project symbol/reference graph; files outside the bounded set remain an explicit application-indexing concern rather than hidden filesystem access by the language server.

DataGrip-level parity is not the same as protocol completeness. Remaining completion gaps are indexing files outside the deliberately synchronized project set, opt-in live value-frequency sampling, and production telemetry for genuinely large remote catalogs. Static domain values, configurable casing/aliases, local usage ranking, foreign-key JOIN generation, the bounded project symbol graph, and a reproducible cold-catalog baseline are implemented. Live sampling stays out of automatic metadata sync because it can expose data values and make completion issue database queries without an explicit policy.

## Setup Instructions

### 1. Initialize the LSP Submodule

The LSP server is tracked as a git submodule at `vendor/sql-lsp`:

```bash
git submodule update --init --recursive
git -C vendor/sql-lsp describe --tags --always
```

Current tracked commit is `4341353cd701dbc1288d8eea73d762e9f9abc3f9`. The checked-in packaged binary is rebuilt only at the explicit packaging/verification stage, so its adjacent manifest remains the authoritative record of the source revision actually embedded in that binary.

### 2. Prepare the Binary

`src-tauri/build_prepare.sh` builds the submodule and copies `sql-lsp` into `src-tauri/binaries/` during the Tauri build:

```bash
bash src-tauri/build_prepare.sh
```

`make dev` runs `lsp-build` first, then starts Tauri with `OXIDE_SKIP_SQL_LSP_PREPARE=1`; the Tauri `beforeDevCommand` also sets that flag so direct `npm run tauri -- dev` does not rewrite the watched bundled binary during startup. After changing `vendor/sql-lsp`, run `make lsp-build` or the script above before starting dev mode.

The preparation script writes `src-tauri/binaries/sql-lsp.manifest.json` with the source revision, dirty flag, target platform/architecture, and SHA-256. `check_lsp_binary` rejects a binary when an adjacent manifest exists but its checksum does not match.

If Tauri dev still rebuilds repeatedly with `src-tauri/binaries/sql-lsp changed`, stop the dev process before rebuilding the LSP binary. For a stable session while iterating on the frontend or app logic, use:

```bash
make dev-no-watch
# or pass Tauri CLI args through the default target
make dev TAURI_DEV_ARGS=--no-watch
```

`dev-no-watch` disables Tauri's Rust file watcher only; Vite HMR still handles frontend changes.

To use a prebuilt binary instead of building the submodule:

```bash
OXIDE_SQL_LSP_BINARY=/path/to/sql-lsp bash src-tauri/build_prepare.sh
```

### 3. Test LSP Server

The LSP client will automatically initialize on app startup via the `useLspClient` hook.

To verify it's working, check the console logs:

```
[LSP] Initialized: LSP server initialized successfully
[LSP] Sending request: textDocument/completion
[LSP] Received response: { items: [...] }
```

## Architecture

### Backend (Rust)

**LSP Manager** (`src-tauri/src/lsp/manager.rs`):

- Spawns `sql-lsp` process with stdin/stdout pipes
- Async stdout reader task parses LSP messages
- Async stdin writer task sends JSON-RPC requests
- Request/response correlation using channels and HashMap
- Standard JSON-RPC cancellation on timeout and per-session process isolation

**Tauri Commands** (`src-tauri/src/commands/lsp.rs`):

- `lsp_initialize` - Start LSP server
- `lsp_shutdown` - Stop LSP server
- `lsp_is_running` - Health check
- `lsp_get_completions` - Get SQL completions (fully implemented)
- `lsp_did_change_configuration` - Update LSP settings and schema context
- `lsp_did_open`, `lsp_did_change`, `lsp_did_close` - Synchronize editor documents
- `lsp_request` - Strictly allowlisted bridge for advanced read/refactor LSP methods
- Commands keep the global state lock only while cloning the manager handle; slow LSP requests do not block health checks or shutdown.

### Frontend (TypeScript)

**LSP Client** (`src/services/lsp/client.ts`):

```typescript
import { lspClient } from "@/services/lsp";

// Get completions
const items = await lspClient.getCompletions(
  "file:///query.sql",
  10, // line (0-indexed)
  15 // character (0-indexed)
);
```

**React Hook** (`src/hooks/useLspClient.ts`):

```tsx
function QueryEditor() {
  const { isReady, error, client } = useLspClient();

  // LSP is automatically initialized
  // Use client.getCompletions(), etc.
}
```

## Schema Synchronization

`LspConnectionSyncer` sends bounded schema snapshots when the active connection, schema, metadata version, project SQL revision, or open query/table tabs change. Table tabs are included because their compact WHERE field owns a virtual, schema-bound query document. Saved project SQL documents use the same schema binding and are closed immediately when their active semantic context is lost. Relational databases sync tables, columns, indexes, constraints, and functions. Redis keys sync as LSP table objects with lightweight synthetic columns and type-specific length/cardinality when available. Elasticsearch indices sync mapping fields when available, falling back to `id`, `score`, and `source`. MongoDB collections sync sampled top-level document fields and collection indexes when available, falling back to `_id` and `document`.

The bundled LSP accepts both pure Elasticsearch JSON DSL and HTTP-style Elasticsearch requests such as `GET /index/_search` followed by a JSON body; diagnostics are applied to the body instead of treating request lines as JSON syntax errors. Console field completion is restricted to the request's current index and includes quoted field-list/value positions. REST operation snippets follow the connected server's ES 6 typed or ES 7/8 typeless API. MongoDB completions include collection CRUD commands plus administrative command names such as `create`, `drop`, `dropDatabase`, `dropIndexes`, `renameCollection`, and `collMod`; field suggestions are restricted to the collection named by `collection`, `find`, `aggregate`, or another collection-valued command property.

## Smart SQL completion

SQL completion has three user-selectable trigger policies: semantic SQL positions,
identifier-prefix only, and manual Ctrl/Cmd+Space. Automatic requests are rejected
before IPC when the cursor is in a comment/string or outside the selected policy;
explicit requests remain available in valid SQL text. The rejection reason is stored
in the existing content-free completion telemetry without SQL or identifier text.

Live LSP results remain authoritative, while connection-scoped cached metadata fills
missing objects and columns. Cached relation, column, and FK JOIN candidates support
Unicode identifiers plus camel/fuzzy and Chinese pinyin matching. The pinyin dictionary
is loaded as a separate lazy chunk only when an ASCII prefix is compared with Chinese
metadata, so ordinary editor startup and ASCII completion do not pay its parse cost.

The bundled LSP also provides metadata-backed `INSERT INTO table (` all-column snippets
with `VALUES` tab stops and expands single-source, multi-source, and qualified `SELECT
*` selections. Multi-source expansion qualifies columns with the existing table aliases.
Generated column lists quote reserved, case-sensitive, and non-ASCII identifiers with
the active base dialect, and LSP UTF-16 cursor positions are converted before UTF-8 slicing.
These SQL behaviors cover PostgreSQL, MySQL, SQLite/DuckDB, Hive, ClickHouse, and the
registered compatibility product aliases.

```typescript
await lspClient.updateConfiguration({
  defaultDialect: "postgres",
  schemas: [{ id: "public", database: "public", tables: [] }],
  fileSchemas: {},
});
```

## Live Database Tests

Run driver-level live integration coverage with Docker:

```bash
scripts/test-live-databases.sh
```

The script starts PostgreSQL, MySQL, Redis, MongoDB, and Elasticsearch, exports the corresponding `TEST_*_URL` variables, and runs `src-tauri/tests/live_database.rs`. To use existing services instead, set `OXIDE_LIVE_USE_EXISTING=1` plus `TEST_POSTGRES_URL`, `TEST_MYSQL_URL`, and optionally `TEST_REDIS_URL`, `TEST_MONGODB_URL`, and `TEST_ELASTICSEARCH_URL`.

## Bundled LSP Tests

Run the dialect scope and document-database unit matrices directly against the source server:

```bash
cargo test --manifest-path vendor/sql-lsp/Cargo.toml --test completion_scope_matrix_tests --test dialect_tests
```

Frontend tests cover SQL trigger policies, pinyin/camel/fuzzy completion ranking,
Unicode cached metadata, MongoDB automatic-trigger classification, Elasticsearch
quoted-field and ES 6/7/8 REST completion, WHERE virtual documents/fuzzy
ranking/keyboard acceptance, table-tab schema mappings, stale completion rejection,
and didChange deduplication.

Run the protocol-level bundled LSP test after rebuilding `src-tauri/binaries/sql-lsp`:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test lsp_integration -- --nocapture
```

This spawns the packaged binary, performs a real LSP initialize/configuration/document/completion flow, and asserts schema-aware Redis key, MongoDB collection/field, and Elasticsearch index/field completions. The submodule protocol suite additionally covers stable object URIs, cross-document references/rename, advanced editor capabilities, inspections/quick fixes, semantic tokens, parameter hints, and local relation inference.

## Troubleshooting

### LSP server not starting

Check logs for errors:

```
[LSP] Failed to spawn LSP server process: ...
```

**Solution**: Verify binary path and permissions

### No completions returned

Check if LSP initialized:

```typescript
if (lspClient.isInitialized()) {
  // LSP is ready
}
```

**Solution**: Ensure LSP server is running with `lsp_is_running` command

### Request timeout

Default timeout is 5 seconds. Long-running requests will fail.

**Solution**: Optimize schema size or increase timeout in `manager.rs`

## References

- [lsp_sqls Repository](https://github.com/RainLib/lsp_sqls)
- [LSP Specification](https://microsoft.github.io/language-server-protocol/)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/index.html)
