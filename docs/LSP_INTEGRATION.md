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

⏳ **Pending:**

- Full React render-level assertions for `LspConnectionSyncer` store-to-client integration
- AI tool-specific live assertions for database metadata, query, and mutation paths

## Setup Instructions

### 1. Initialize the LSP Submodule

The LSP server is tracked as a git submodule at `vendor/sql-lsp`:

```bash
git submodule update --init --recursive
git -C vendor/sql-lsp describe --tags --always
```

Current tracked revision is `v0.1.3-26-g42be20b`.

### 2. Prepare the Binary

`src-tauri/build_prepare.sh` builds the submodule and copies `sql-lsp` into `src-tauri/binaries/` during the Tauri build:

```bash
bash src-tauri/build_prepare.sh
```

`make dev` runs `lsp-build` first, then starts Tauri with `OXIDE_SKIP_SQL_LSP_PREPARE=1`; the Tauri `beforeDevCommand` also sets that flag so direct `npm run tauri -- dev` does not rewrite the watched bundled binary during startup. After changing `vendor/sql-lsp`, run `make lsp-build` or the script above before starting dev mode.

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

**Tauri Commands** (`src-tauri/src/commands/lsp.rs`):

- `lsp_initialize` - Start LSP server
- `lsp_shutdown` - Stop LSP server
- `lsp_is_running` - Health check
- `lsp_get_completions` - Get SQL completions (fully implemented)
- `lsp_did_change_configuration` - Update LSP settings and schema context
- `lsp_did_open`, `lsp_did_change`, `lsp_did_close` - Synchronize editor documents
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

`LspConnectionSyncer` sends bounded schema snapshots when the active connection, schema, metadata version, or open query tabs change. Relational databases sync tables, columns, indexes, constraints, and functions. Redis keys sync as LSP table objects with lightweight synthetic columns and type-specific length/cardinality when available. Elasticsearch indices sync mapping fields when available, falling back to `id`, `score`, and `source`. MongoDB collections sync sampled top-level document fields and collection indexes when available, falling back to `_id` and `document`.

The bundled LSP accepts both pure Elasticsearch JSON DSL and HTTP-style Elasticsearch requests such as `GET /index/_search` followed by a JSON body; diagnostics are applied to the body instead of treating request lines as JSON syntax errors. MongoDB completions include collection CRUD commands plus administrative command names such as `create`, `drop`, `dropDatabase`, `dropIndexes`, `renameCollection`, and `collMod`.

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

Run the protocol-level bundled LSP test after rebuilding `src-tauri/binaries/sql-lsp`:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test lsp_integration -- --nocapture
```

This spawns the packaged binary, performs a real LSP initialize/configuration/document/completion flow, and asserts schema-aware Redis key, MongoDB collection/field, and Elasticsearch index/field completions.

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
