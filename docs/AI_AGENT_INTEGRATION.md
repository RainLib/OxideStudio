# AI Agent Integration Design

## Goal

OxideStudio should expose database, metadata, LSP, and workspace actions to an AI assistant without coupling the assistant to UI components or a single database type. The core design should support the in-app assistant first, then reuse the same capability surface for MCP and CLI adapters.

## Recommended Architecture

Use a TypeScript `AiToolRegistry` as the stable boundary for all AI-callable capabilities. The registry should describe every tool with a name, JSON schema, capability flags, permission level, timeout, result limits, and executor.

```text
Assistant UI / AssistantPlanner / LangGraph
        |
        v
AiToolRegistry  ---->  Tauri service clients  ---->  Rust commands/drivers
        |
        +---- MCP adapter
        |
        +---- CLI adapter
```

This keeps the editor integration direct and state-aware while allowing external agents to call the same tools through MCP. The CLI should be an automation/debug adapter, not the primary editor integration path.

Decision summary:

- Editor assistant: call `AssistantRuntime` directly in TypeScript. This is the best editor integration because it preserves active tab, selection, connection id, schema state, approval UI, and LSP diagnostics without protocol round-trips.
- External AI clients: expose MCP over the same `AiToolRegistry`. MCP is the best integration for other agents because it provides tool discovery, schemas, and safety annotations.
- CLI: keep it as a smoke-test, scripting, and local automation adapter. A standalone CLI binary should inject its own registry/context instead of using browser/Tauri defaults.
- LangGraph: use it as an optional planner implementation, not as the core capability layer. The graph should select and sequence registry tools; it should not call database services directly.

## Current Implementation

- `src/ai/tools` defines the shared registry, metadata/query tools, result limits, audit hooks, and permission policy.
- `src/ai/tools/families.ts` provides runtime `AiToolFamily` registration and merging, so database/provider packages can add tool families without editing the core registry.
- `src/providers` exposes `registerDatabaseProvider` to bundle driver profiles, object preview behavior, and AI tool families behind one provider registration call.
- `provider.list` exposes registered providers, full driver capability summaries, and recommended AI tool hints so planners, MCP clients, and CLI scripts can discover backend support before choosing tools.
- `src/ai/tools/manifest.ts` exports a portable tool manifest with schemas, permissions, capabilities, and approval status for MCP, CLI, and planner hosts.
- `metadata.describeObject` returns relational structure metadata, sampled MongoDB collection fields and indexes, Elasticsearch mapping fields, and provider-neutral preview/delete request templates so planners can reason about objects without hard-coding driver syntax.
- `src/lib/querySafety.ts` centralizes read/write/destructive classification for SQL, MongoDB, Redis, and Elasticsearch so planners and executors make the same safety decision.
- `src/ai/assistant` exposes an `AssistantPlanner` contract, a deterministic fallback planner, a provider-neutral model planner, and approval-aware execution for AI-proposed tool calls.
- `src/ai/assistant/langGraphPlanner.ts` provides a dependency-light LangGraph bridge. A real LangGraph graph can plug in by returning `AssistantPlannerResult` from the shared planner contract.
- `src/ai/mcp` exposes registry tools in an MCP-compatible shape with tool annotations such as `readOnlyHint` and `destructiveHint`.
- `src/ai/mcp/protocol.ts` adds a transport-neutral JSON-RPC handler for `initialize`, `tools/list`, `tools/call`, and the Oxide manifest extension; stdio or HTTP servers should wrap this instead of reimplementing tool routing.
- `src/ai/cli` provides a dependency-light command adapter for `tools list`, `tools manifest`, `assistant plan`, and `tools call`.
- The assistant panel is an editor entry point; real model/provider integration should call the runtime APIs rather than bypassing the registry.

## LangGraph Usage

Use TypeScript LangGraph as an optional implementation of `AssistantPlanner` for the in-app assistant orchestration. The editor should not call itself through MCP because editor state, connection metadata, tabs, and approval UI already live in the frontend. `createLangGraphAssistantPlanner({ invoke })` is the bridge point; the `invoke` function can run a compiled LangGraph graph and return the same `AssistantPlannerResult` used by the default and model planners.

Recommended graph nodes:

- `classify_intent`: detect explain/query/debug/schema/edit/export tasks.
- `collect_context`: gather active connection, selected text, schema, tab, and driver capabilities.
- `plan_tools`: choose tools from `AiToolRegistry`.
- `safety_review`: require user approval for writes, destructive operations, exports, and cross-database actions.
- `execute_tools`: run bounded tool calls through Tauri services.
- `summarize_result`: return concise answers with queries, row limits, and caveats.

The shipped default planner stays dependency-light and deterministic. It reads workspace, connection, and provider capability context before suggesting metadata, LSP, or query steps. When selected JSON plus the user message clearly identify a table, collection, key, or index, it can suggest structured mutation tools such as `table.insertRows`, `document.insertDocuments`, `key.setValue`, or `search.indexDocument`; approval policy still controls execution. A LangGraph planner can replace it by implementing `AssistantPlanner.plan`, returning the same `AssistantPlanStep[]`, and pausing before any step whose tool policy requires approval.

Example LangGraph bridge:

```typescript
const planner = createLangGraphAssistantPlanner({
  invoke: async (input) => graph.invoke(input),
});

const runtime = createAssistantRuntime({ planner });
```

For model-provider integration without taking a LangGraph dependency, use `createModelAssistantPlanner({ invoke })`. The runtime sends the model a redacted workspace context plus the AI tool manifest; the model returns candidate tool steps; the planner validates tool names and marks write/destructive tools as requiring approval according to policy. Use `createModelToolResultSummarizer(invoke)` to feed tool results back to the provider for a final answer or follow-up suggestions.

## Tool Categories

Read-only tools:

- `connection.list`, `connection.capabilities`
- `provider.list`
- `metadata.listObjects`, `metadata.listCollections`, `metadata.describeObject`
- `query.runReadOnly` with row/time limits and driver-aware syntax
- `workspace.getActiveTab`
- `workspace.getSelection`
- `lsp.getCompletions`, `lsp.explainDiagnostics`

Write tools behind explicit approvals:

- `query.runMutation`
- `query.runDestructive`
- `database.createNamespace`
- `database.dropNamespace`
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

Future tool families:

- provider-loaded database-specific tool packs

## MCP vs CLI

MCP is the better external integration because it gives other AI clients a structured tool protocol with schemas, permissions, and discoverability. Implement MCP as an adapter over `AiToolRegistry`; do not duplicate tool logic in the MCP server.

The protocol adapter is transport-neutral:

```typescript
const protocol = createMcpProtocolAdapter();
await protocol.handleMessage({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
});
```

Mutating calls still require an explicit approval signal, for example `_meta: { "oxide/approved": true }`; do not grant that automatically from an external host.

CLI is useful for local automation, tests, and scripting. It can share the same registry by running commands such as:

```bash
oxide tools list
oxide tools manifest
oxide assistant plan --message "list tables in the active database"
oxide tools call query.runReadOnly --json payload.json
oxide tools call key.setValue --approve --json '{"key":"demo","value":"ok"}'
oxide mcp request --json '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Use `oxide mcp request` for local MCP JSON-RPC smoke tests or scripts that need to match an external MCP host exactly. Use `tools call` for simpler one-off automation.

For the editor itself, prefer direct TypeScript orchestration over MCP. The editor already owns state, selection, tabs, connection ids, and approval UI; routing those through an external protocol would add latency and lose context. External MCP hosts should use tool annotations plus an explicit approval handoff before calling mutating tools.

Recommended usage:

- In-app assistant: `AssistantRuntime` with the default planner, then LangGraph/model planner when provider integration is ready.
- External AI clients: MCP adapter over the same `AiToolRegistry`.
- Local automation and tests: CLI adapter.

## Safety Requirements

- Never expose raw credentials or connection URLs to model context.
- Default all result sets to bounded row, byte, and time limits.
- Treat multi-statement SQL conservatively; read-only gates must reject any statement with write or destructive operations.
- Require approval for mutations, exports, drops, and external network access.
- Do not auto-approve writes in MCP or CLI adapters; external callers must pass an explicit approval signal such as CLI `--approve`.
- Store an audit entry for request id, tool name, permissions, status, duration, and failure reason without persisting raw query text by default.
- Prefer capability checks and `provider.list.aiToolHints` over driver name checks so new backends do not require broad rewrites.

## Implementation Phases

1. Add `src/ai/tools` with registry types, schemas, and read-only database tools. Done.
2. Add an assistant panel backed by the registry executor. Done.
3. Add MCP and CLI adapters over the same registry. Done.
4. Add write tools with approval gates and audit logging. Done for query-level mutation/destructive tools, structured table row mutations, and structured document/key/search mutations.
5. Add a planner layer that chooses tool calls, pauses for approval, and feeds results back into the model. Foundation done with `AssistantPlanner`, `createModelAssistantPlanner`, and `createModelToolResultSummarizer`; full LangGraph graph wiring is still pending.
6. Add provider/plugin hooks so new databases register tool families by capability, not by UI rewrites. Runtime provider registration is done with `registerDatabaseProvider`; dynamic package discovery/loading is still pending.
7. Add live integration coverage for MongoDB, Redis, Elasticsearch, MySQL, and PostgreSQL tool paths. Driver-level connection, metadata, query, and mutation coverage is available through `scripts/test-live-databases.sh`; AI tool-specific live assertions are still pending.
