# LSP SQL Server Integration Guide

## Overview

OxideStudio now includes infrastructure for integrating with the [lsp_sqls](https://github.com/LikeRainDay/lsp_sqls) Language Server Protocol (LSP) server to provide advanced SQL intelligence features.

## Current Status

✅ **Completed Infrastructure:**

- Phase 1: LSP process management with lifecycle control
- Phase 2: Tauri commands for frontend communication
- Phase 3: TypeScript client service and React hooks
- Phase 5: **Bidirectional IPC with async stdio** (JSON-RPC communication)

⏳ **Pending:**

- Phase 4: Monaco Editor integration (awaiting LSP binary)
- Phase 6: Database schema synchronization

## Setup Instructions

### 1. Download LSP Binary

Download the appropriate `sql-lsp` binary for your platform from the [lsp_sqls releases](https://github.com/LikeRainDay/lsp_sqls/releases/tag/v0.1.1):

**Linux:**

- x86_64: `sql-lsp-x86_64-unknown-linux-gnu-v0.1.1.tar.gz`
- ARM64: `sql-lsp-aarch64-unknown-linux-gnu-v0.1.1.tar.gz`

**macOS:**

- Intel: `sql-lsp-x86_64-apple-darwin-v0.1.1.tar.gz`
- Apple Silicon: `sql-lsp-aarch64-apple-darwin-v0.1.1.tar.gz`

**Windows:**

- x86_64: `sql-lsp-x86_64-pc-windows-msvc-v0.1.1.tar.gz`

### 2. Extract Binary

```bash
# Extract the archive
tar -xzf sql-lsp-*.tar.gz

# Create binaries directory if it doesn't exist
mkdir -p src-tauri/binaries

# Copy binary to project
cp sql-lsp src-tauri/binaries/
# Windows: cp sql-lsp.exe src-tauri/binaries/
```

### 3. Configure Tauri

Update `src-tauri/tauri.conf.json` to bundle the binary:

```json
{
  "bundle": {
    "resources": ["binaries/sql-lsp*"],
    "externalBin": ["binaries/sql-lsp"]
  }
}
```

### 4. Test LSP Server

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
- `lsp_update_schema` - Update database schema

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

## Next Steps

### Monaco Editor Integration

Once the LSP binary is configured, integrate with Monaco Editor:

1. Import LSP client in `QueryEditor.tsx`
2. Replace tree-sitter completion provider
3. Register LSP completion provider:

```typescript
monaco.languages.registerCompletionItemProvider("sql", {
  async provideCompletionItems(model, position) {
    const items = await lspClient.getCompletions(
      model.uri.toString(),
      position.lineNumber - 1,
      position.column - 1
    );

    return {
      suggestions: items.map((item) => ({
        label: item.label,
        kind: monaco.languages.CompletionItemKind.Field,
        detail: item.detail,
        insertText: item.label,
      })),
    };
  },
});
```

### Schema Synchronization

Implement schema updates when database connection changes:

```typescript
// On connection change
const schema = await fetchDatabaseSchema();
const schemaJson = JSON.stringify(schema);
await lspClient.updateSchema(schemaJson);
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

- [lsp_sqls Repository](https://github.com/LikeRainDay/lsp_sqls)
- [LSP Specification](https://microsoft.github.io/language-server-protocol/)
- [Monaco Editor API](https://microsoft.github.io/monaco-editor/api/index.html)
