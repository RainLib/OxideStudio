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
- Phase 7: Bounded Redis key and Elasticsearch index context synchronization through the LSP schema model
- Phase 8: Non-blocking Tauri command lifecycle; LSP requests clone the manager handle before awaiting server responses
- Phase 9: MongoDB/JSON dialect support in `lsp_sqls` with bounded collection context synchronization

⏳ **Pending:**

- Additional live integration coverage for Redis, MongoDB, and Elasticsearch LSP paths

## Setup Instructions

### 1. Initialize the LSP Submodule

The LSP server is tracked as a git submodule at `vendor/sql-lsp`:

```bash
git submodule update --init --recursive
git -C vendor/sql-lsp describe --tags --always
```

Current tracked revision is `v0.1.3-4-g4971175`.

### 2. Prepare the Binary

`src-tauri/build_prepare.sh` builds the submodule and copies `sql-lsp` into `src-tauri/binaries/` during the Tauri build:

```bash
cd src-tauri
./build_prepare.sh
```

To use a prebuilt binary instead of building the submodule:

```bash
OXIDE_SQL_LSP_BINARY=/path/to/sql-lsp ./build_prepare.sh
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

`LspConnectionSyncer` sends bounded schema snapshots when the active connection, schema, metadata version, or open query tabs change. Relational databases sync tables, columns, indexes, constraints, and functions. Redis keys and Elasticsearch indices sync as LSP table objects with lightweight synthetic columns. MongoDB collections sync as LSP table objects and use sampled top-level document fields when available, falling back to `_id` and `document`.

```typescript
await lspClient.updateConfiguration({
  defaultDialect: "postgres",
  schemas: [{ id: "public", database: "public", tables: [] }],
  fileSchemas: {},
});
```

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
