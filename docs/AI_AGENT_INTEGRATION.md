# AI Agent Integration Design

## Goal

OxideStudio should expose database, metadata, LSP, and workspace actions to an AI assistant without coupling the assistant to UI components or a single database type. The core design should support the in-app assistant first, then reuse the same capability surface for MCP and CLI adapters.

## Recommended Architecture

Use a TypeScript `AiToolRegistry` as the stable boundary for all AI-callable capabilities. The registry should describe every tool with a name, JSON schema, capability flags, permission level, timeout, result limits, and executor.

```text
Assistant UI / LangGraph
        |
        v
AiToolRegistry  ---->  Tauri service clients  ---->  Rust commands/drivers
        |
        +---- MCP adapter
        |
        +---- CLI adapter
```

This keeps the editor integration direct and state-aware while allowing external agents to call the same tools through MCP. The CLI should be an automation/debug adapter, not the primary editor integration path.

## Current Implementation

- `src/ai/tools` defines the shared registry, metadata/query tools, result limits, audit hooks, and permission policy.
- `src/ai/tools/families.ts` provides the tool family extension point used by core database, table, document, key-value, and search tools.
- `src/ai/assistant` prepares editor-aware plans and can execute AI-proposed tool calls with approval-aware results, including approved mutation/destructive steps.
- `src/ai/mcp` exposes registry tools in an MCP-compatible shape with tool annotations such as `readOnlyHint` and `destructiveHint`.
- `src/ai/cli` provides a dependency-light command adapter for `tools list` and `tools call`.
- The assistant panel is an editor entry point; real model/provider integration should call the runtime APIs rather than bypassing the registry.

## LangGraph Usage

Use TypeScript LangGraph for the in-app assistant orchestration because the editor state, connection metadata, tabs, and approval UI already live in the frontend. Recommended graph nodes:

- `classify_intent`: detect explain/query/debug/schema/edit/export tasks.
- `collect_context`: gather active connection, selected text, schema, tab, and driver capabilities.
- `plan_tools`: choose tools from `AiToolRegistry`.
- `safety_review`: require user approval for writes, destructive operations, exports, and cross-database actions.
- `execute_tools`: run bounded tool calls through Tauri services.
- `summarize_result`: return concise answers with queries, row limits, and caveats.

## Tool Categories

Read-only tools:

- `connection.list`, `connection.capabilities`
- `metadata.listObjects`, `metadata.listCollections`, `metadata.describeObject`
- `query.runReadOnly` with row/time limits and driver-aware syntax
- `workspace.getActiveTab`

Write tools behind explicit approvals:

- `query.runMutation`
- `query.runDestructive`
- `table.insertRows`
- `table.updateRows`
- `table.deleteRows`
- `document.insertDocuments`
- `document.updateDocuments`
- `document.deleteDocuments`
- `key.setValue`
- `key.deleteKeys`
- `search.indexDocument`
- `search.updateDocument`
- `search.deleteDocument`
- `lsp.getCompletions`

Future tool families:

- `database.createNamespace`, `database.dropNamespace`
- `lsp.explainDiagnostics`
- `workspace.getSelection`

## MCP vs CLI

MCP is the better external integration because it gives other AI clients a structured tool protocol with schemas, permissions, and discoverability. Implement MCP as an adapter over `AiToolRegistry`; do not duplicate tool logic in the MCP server.

CLI is useful for local automation, tests, and scripting. It can share the same registry by running commands such as:

```bash
oxide tools list
oxide tools call query.runReadOnly --json payload.json
oxide tools call key.setValue --approve --json '{"key":"demo","value":"ok"}'
```

For the editor itself, prefer direct TypeScript orchestration over MCP. The editor already owns state, selection, tabs, connection ids, and approval UI; routing those through an external protocol would add latency and lose context. External MCP hosts should use tool annotations plus an explicit approval handoff before calling mutating tools.

## Safety Requirements

- Never expose raw credentials or connection URLs to model context.
- Default all result sets to bounded row, byte, and time limits.
- Require approval for mutations, exports, drops, and external network access.
- Do not auto-approve writes in MCP or CLI adapters; external callers must pass an explicit approval signal such as CLI `--approve`.
- Store an audit entry for request id, tool name, permissions, status, duration, and failure reason without persisting raw query text by default.
- Prefer capability checks over driver name checks so new backends do not require broad rewrites.

## Implementation Phases

1. Add `src/ai/tools` with registry types, schemas, and read-only database tools. Done.
2. Add an assistant panel backed by the registry executor. Done.
3. Add MCP and CLI adapters over the same registry. Done.
4. Add write tools with approval gates and audit logging. Done for query-level mutation/destructive tools, structured table row mutations, and structured document/key/search mutations.
5. Add a LangGraph-backed planner that chooses tool calls, pauses for approval, and feeds results back into the model.
6. Add provider/plugin hooks so new databases register tool families by capability, not by UI rewrites. Foundation done with `AiToolFamily`; external provider loading is still pending.
7. Add live integration coverage for MongoDB, Redis, Elasticsearch, MySQL, and PostgreSQL tool paths.
