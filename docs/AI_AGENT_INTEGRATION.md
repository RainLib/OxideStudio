# AI Agent Integration Design

> Detailed product capabilities, page interaction protocol, safety state machine,
> DataGrip comparison, and LSP relevance requirements are defined in
> [AI_AGENT_PRODUCT_SPEC.md](AI_AGENT_PRODUCT_SPEC.md). This document describes
> the integration boundary and current implementation.

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
- LangGraph: keep it as the graph/runtime layer, not as the core capability layer. The graph should select and sequence registry tools; it should not call database services directly.
- Deep Agents TypeScript: use it only for the long-running Agent mode, loaded lazily in the desktop WebView. It is a LangGraph-based harness rather than a replacement for LangGraph. Chat, O2, and simple Plan requests should stay on the lower-latency planner path.
- Page interaction: use the separate typed `UiActionRegistry` for navigation, focus, object reveal, editor ranges, files, tabs, result selection, Explain Plan nodes, and revision-bound patch previews. The shipped actions resolve stable targets and reject stale project/document/plan context; durable task navigation remains explicitly unsupported until its surface exists. Do not let the model drive DOM selectors, and do not mix UI navigation with database mutation approval.

## Current Implementation

- `src/ai/tools` defines the shared registry, metadata/query tools, result limits, audit hooks, and permission policy.
- `src/ai/tools/families.ts` provides runtime `AiToolFamily` registration and merging, so database/provider packages can add tool families without editing the core registry.
- `src/providers` exposes `registerDatabaseProvider` to bundle driver profiles, object preview behavior, and AI tool families behind one provider registration call.
- `src/providers/providerLoader.ts` loads discovered provider modules deterministically, reports skipped/failed modules without stopping the rest, registers exported provider bundles, and can build loaders from package manifests through `discoverDatabaseProviderLoaders` / `loadDatabaseProviderPackages`.
- `provider.list` exposes registered providers, full driver capability summaries, and recommended AI tool hints so planners, MCP clients, and CLI scripts can discover backend support before choosing tools.
- `src/ai/tools/manifest.ts` exports a portable tool manifest with schemas, permissions, capabilities, and approval status for MCP, CLI, and planner hosts.
- `src/ai/tools/nativeMutationBuilders.ts` builds the exact MongoDB, Redis, and Elasticsearch native mutation requests used by workspace AI tools, keeping MCP, CLI, and planner execution paths aligned.
- `metadata.describeObject` returns relational structure metadata, sampled MongoDB collection fields and indexes, Elasticsearch mapping fields, and provider-neutral preview/delete request templates so planners can reason about objects without hard-coding driver syntax.
- `query.explain` exposes only estimated PostgreSQL/MySQL plans to AI callers. Rust validates the original single read-only statement, generates the driver-specific EXPLAIN form, executes it in a read-only transaction, and returns a normalized tree plus raw plan. AI callers cannot request Analyze; the user-facing editor action requires an explicit confirmation because it executes the source query.
- `src/lib/querySafety.ts` centralizes read/write/destructive classification for SQL, MongoDB, Redis, and Elasticsearch so planners and executors make the same safety decision. MongoDB JSON is intentionally strict: implicit find templates only allow known read fields, and destructive command names cannot pass through read-only gates.
- `tests/frontend/ai-core-tools.test.ts` locks the core AI tool contract for provider hints, read/write/destructive safety routing, approval gates, and structured MongoDB, Redis, and Elasticsearch mutation adapters.
- `tests/frontend/provider-loader.test.ts` covers dynamic provider module loading, package manifest discovery, failure isolation, and dynamically registered AI tool families.
- `tests/frontend/workspace-ai-tools.test.ts` verifies that in-app AI tools route metadata, query, table mutation, and MongoDB/Redis/Elasticsearch structured mutation calls through the workspace Tauri service adapters.
- `tests/frontend/ai-external-tool-routing.test.ts` verifies that CLI and MCP external-agent entrypoints execute metadata, read query, and approved table mutation tools through an injected database adapter instead of bypassing the shared registry.
- `src/ai/assistant` exposes an `AssistantPlanner` contract, a deterministic fallback planner, a provider-neutral model planner, and approval-aware execution for AI-proposed tool calls.
- `AssistantRuntime.runToolLoop` owns bounded multi-round execution independently of React: it emits typed step/result/summary/plan/limit events, recomputes policy for follow-ups, deduplicates repeated tool+input signatures, binds approval to an exact normalized step id, and observes the execution context's `AbortSignal`. The default budget is four summarized rounds and twelve tool attempts; caller overrides are hard-capped at eight rounds and twenty-four attempts.
- Agent mode writes a project-scoped, strongly typed task summary to the MetaStore `assistant_tasks` table and mirrors it in `TaskStatusCenter`. The checkpoint contains only plan step identity/title/tool/risk and completed step status; its schema cannot contain prompts, tool inputs, SQL, approval tokens, tool outputs, or result rows. Writes are sequenced, terminal history is capped at 100 per project, and active tasks from another application session are recovered as `interrupted`.
- Every Agent plan message includes a typed `task.reveal` attachment. The action resolves `projectId + taskId` from the in-memory task store or retained MetaStore history, then opens the status-bar Task Center at the exact safe summary. The detail surface shows bounded progress and step status only; cleared/missing tasks return `TARGET_NOT_FOUND` instead of opening an empty panel.
- `src/ai/ui-actions` defines a UI-only action contract, context-version and document-revision checks, stable failure codes, workspace executors, and tool-result attachment generation. Assistant messages render object, file, result, tab, selection, LSP diagnostic, Explain Plan, Schema Diff, and editor patch references as typed actions; object reveal, open data, open DDL, plan-node reveal, patch preview, and patch Apply remain separate actions.
- `editor.proposePatch` is a read-only artifact tool. The host captures the exact current `originalText`, one-based Monaco range, tab identity, and document revision; the model supplies only the proposed replacement and explanation. Clicking its attachment opens a bounded before/after panel but does not edit or execute SQL. Apply is a direct user gesture, revalidates both the whole-document revision and range contents in the tab store, and refuses stale or binary-preview tabs.
- `src/lib/databaseNavigation.ts` and `src/lib/editorNavigation.ts` are semantic host navigation channels. Database targets carry project, connection, database, schema, object type, and object name; editor targets carry tab id and a one-based range. Components never accept model-generated DOM selectors.
- `tests/frontend/ui-action-registry.test.ts`, `assistant-attachments.test.ts`, `assistant-conversation-attachments.test.tsx`, `workspace-ui-action-plan.test.ts`, `workspace-ui-action-patch.test.ts`, `editor-patch.test.ts`, and `editor-patch-preview-panel.test.tsx` cover stale project/revision/plan rejection, exact same-name object identity, diagnostic coordinate conversion, plan-node selection, revision-bound patch creation/apply, and primary/secondary attachment actions.
- `src/ai/assistant/langGraphPlanner.ts` provides a dependency-light LangGraph bridge plus `createAssistantPlannerGraph` for composing planner nodes over shared context, metadata, warnings, and notes. A real LangGraph graph can still plug in by returning `AssistantPlannerResult` from the shared planner contract.
- `src/ai/mcp` exposes registry tools in an MCP-compatible shape with tool annotations such as `readOnlyHint` and `destructiveHint`.
- `src/ai/mcp/protocol.ts` adds a transport-neutral JSON-RPC handler for `initialize`, `tools/list`, `tools/call`, single-tool inspection, and the Oxide manifest extension; stdio or HTTP servers should wrap this instead of reimplementing tool routing.
- `src/ai/cli` provides a dependency-light command adapter for `tools list`, `tools manifest`, `assistant plan`, and `tools call`.
- The assistant panel is an editor entry point; real model/provider integration should call the runtime APIs rather than bypassing the registry.

## LangGraph Usage

Use TypeScript LangGraph as an optional implementation of `AssistantPlanner` for the in-app assistant orchestration. The editor should not call itself through MCP because editor state, connection metadata, tabs, and approval UI already live in the frontend. `createLangGraphAssistantPlanner({ invoke })` is the bridge point; the `invoke` function can run a compiled LangGraph graph and return the same `AssistantPlannerResult` used by the default and model planners. For simple in-process orchestration, `createAssistantPlannerGraph({ nodes })` runs ordered planner nodes with shared metadata and merges warnings/notes before returning the final plan.

The current official LangGraph integration is intentionally small: the compiled graph runs `plan -> policy`. The bounded multi-round tool loop has moved into `AssistantRuntime`, while React still creates the abort controller, mirrors transient state, and owns the component lifetime. This is a framework-neutral execution boundary, not a complete durable agent runtime. The target migration is:

1. Keep `AssistantRuntime`, `AssistantPlanner`, and `AiToolRegistry` as application-owned contracts.
2. Wrap registry tools for a lazily loaded Deep Agents TypeScript runtime in Agent mode.
3. Keep iteration, policy normalization, cancellation checks, and observation events in `AssistantRuntime`; next add explicit approval pause tokens, verification nodes, and checkpoint serialization without moving policy into the UI.
4. Extend the shipped project-scoped safe task-summary store into a resumable checkpoint: add runtime state/version, thread messages under an explicit retention policy, and idempotency receipts. Continue excluding raw result rows and never persist reusable approval tokens.
5. Keep database mutation policy and backend read-only enforcement outside Deep Agents. Its built-in filesystem permissions do not govern custom database or MCP tools.
6. Disable arbitrary code execution and unrestricted filesystem/network tools initially. Subagents are read-only and budgeted by default.

Recommended graph nodes:

- `classify_intent`: detect explain/query/debug/schema/edit/export tasks.
- `collect_context`: gather active connection, selected text, schema, tab, and driver capabilities.
- `plan_tools`: choose tools from `AiToolRegistry`.
- `safety_review`: require user approval for writes, destructive operations, exports, and cross-database actions.
- `execute_tools`: run bounded tool calls through Tauri services.
- `summarize_result`: return concise answers with queries, row limits, and caveats.

The shipped default planner stays dependency-light and deterministic. It reads workspace, connection, and provider capability context before suggesting metadata, LSP, or query steps. When selected JSON plus the user message clearly identify a table, collection, key, or index, it can suggest structured mutation tools such as `table.insertRows`, `document.insertDocuments`, `key.setValue`, or `search.indexDocument`; approval policy still controls execution. A LangGraph planner can replace it by implementing `AssistantPlanner.plan`, returning the same `AssistantPlanStep[]`, and pausing before any step whose tool policy requires approval.

For query execution requests, selected SQL is preferred. If there is no selection, the default planner can execute the active query tab SQL through the same guarded `query.runReadOnly`, `query.runMutation`, or `query.runDestructive` tools.

Example LangGraph bridge:

```typescript
const planner = createLangGraphAssistantPlanner({
  invoke: async (input) => graph.invoke(input),
});

const runtime = createAssistantRuntime({ planner });
```

For model-provider integration without taking a LangGraph dependency, use `createModelAssistantPlanner({ invoke })`. The runtime sends the model a redacted and bounded workspace context plus the AI tool manifest; the model returns candidate tool steps; the planner validates tool names and marks write/destructive tools as requiring approval according to policy. Active tab SQL, selected text, and editor selection text are truncated before provider invocation so large scripts cannot dominate model requests. Use `createModelToolResultSummarizer(invoke)` to feed tool results back to the provider for a final answer or follow-up suggestions.

## Tool Categories

Read-only tools:

- `connection.list`, `connection.capabilities`
- `provider.list`
- `metadata.listObjects`, `metadata.listCollections`, `metadata.describeObject`
- `query.runReadOnly` with row/time limits and driver-aware syntax
- `key.getValue`
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

MCP callers that need workspace-like context can pass `_meta: { "oxide/context": { "activeConnectionId": "...", "activeDriver": "redis", "activeNamespace": "2" } }` on `tools/call`. The adapter merges those fields into the execution context before policy and tool execution.

MCP callers that already know a candidate tool name can inspect only that tool's schema and approval policy:

```json
{"jsonrpc":"2.0","id":1,"method":"oxide/tools/inspect","params":{"name":"provider.list"}}
```

CLI is useful for local automation, tests, and scripting. It can share the same registry by running commands such as:

```bash
npm run ai -- tools list
npm run ai -- tools manifest
npm run ai -- tools inspect provider.list
npm run ai -- assistant plan --message "list tables in the active database"
npm run ai -- assistant plan --message "run selected query" --selected-text-file selection.sql
npm run ai -- tools call query.runReadOnly --json-file payload.json
npm run ai -- tools call key.getValue --active-driver redis --active-namespace 2 --json '{"key":"session:1"}'
npm run ai -- tools call key.setValue --approve --json '{"key":"demo","value":"ok"}'
npm run ai -- mcp request --json '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The Makefile exposes the same entry points:

```bash
make ai-tools
make ai-manifest
make ai-inspect AI_TOOL=provider.list
make ai-plan AI_MESSAGE="inspect this workspace"
make ai-mcp-smoke
make ai-mcp-stdio
```

Use `tools inspect <toolName>` or MCP `oxide/tools/inspect` when an agent already has a candidate tool name and needs only that tool's schema, permission set, capabilities, and approval policy. Use `npm run ai -- mcp request` or `make ai-mcp-smoke` for local MCP JSON-RPC smoke tests or scripts that need to match an external MCP host exactly. Use `tools call` for simpler one-off automation.

Current limitation: `scripts/oxide-ai.ts` runs in a headless Node process, so it does not have the in-app Tauri connection manager, active editor tab, selected schema, or approval UI. Its default adapter intentionally exposes provider and capability discovery only. Database query, metadata, LSP, and mutation tools are fully available through the in-app workspace adapter; a standalone MCP server that can query databases must inject its own connection/query adapter instead of relying on browser/Tauri state.

The CLI/MCP manifest includes `environment.enabledToolFamilies` and `environment.disabledToolFamilies` with missing adapter names. Agents should use this to distinguish an unavailable headless adapter from an unsupported database capability before planning tool calls.

For injected standalone adapters, both `assistant plan` and `tools call` accept `--active-connection-id`, `--active-driver`, and `--active-namespace` so external agents can pass the same context shape used by the in-app assistant before choosing or executing tools. `assistant plan` also accepts `--selected-text` or `--selected-text-file` so editor scripts can pass the active selection without embedding large SQL or JSON directly in the shell command.

For the editor itself, prefer direct TypeScript orchestration over MCP. The editor already owns state, selection, tabs, connection ids, and approval UI; routing those through an external protocol would add latency and lose context. External MCP hosts should use tool annotations plus an explicit approval handoff before calling mutating tools.

Recommended usage:

- In-app assistant: `AssistantRuntime` with the default planner, then LangGraph/model planner when provider integration is ready.
- External AI clients: MCP adapter over the same `AiToolRegistry`.
- Local automation and tests: CLI adapter.

## Safety Requirements

- Never expose raw credentials or connection URLs to model context.
- Default all result sets to bounded row, byte, and time limits.
- Treat multi-statement SQL conservatively; read-only gates must reject any statement with write or destructive operations.
- Treat driver-native requests conservatively. MongoDB command JSON should reject unknown fields instead of silently degrading to collection reads; Redis and Elasticsearch requests should be classified by native command or HTTP method/path before execution.
- Require approval for mutations, exports, drops, and external network access.
- Do not auto-approve writes in MCP or CLI adapters; external callers must pass an explicit approval signal such as CLI `--approve`.
- Store an audit entry for request id, tool name, permissions, status, duration, and failure reason without persisting raw query text by default.
- Prefer capability checks and `provider.list.aiToolHints` over driver name checks so new backends do not require broad rewrites.

## Implementation Phases

1. Add `src/ai/tools` with registry types, schemas, and read-only database tools. Done.
2. Add an assistant panel backed by the registry executor. Done.
3. Add MCP and CLI adapters over the same registry. Done.
4. Add write tools with approval gates and audit logging. Done for query-level mutation/destructive tools, structured table row mutations, and structured document/key/search mutations.
5. Add a planner layer that chooses tool calls, pauses for approval, and feeds results back into the model. Foundation done with `AssistantPlanner`, `createModelAssistantPlanner`, `createModelToolResultSummarizer`, `createLangGraphAssistantPlanner`, and `createAssistantPlannerGraph`; package-specific compiled LangGraph graphs can plug into the same bridge.
6. Add provider/plugin hooks so new databases register tool families by capability, not by UI rewrites. Runtime provider registration is done with `registerDatabaseProvider`; dynamic module loading is done with `loadDatabaseProviders`; package manifest discovery/loading is done with `discoverDatabaseProviderLoaders` and `loadDatabaseProviderPackages`. Done.
7. Add live integration coverage for MongoDB, Redis, Elasticsearch, MySQL, and PostgreSQL tool paths. Driver-level connection, metadata, query, and mutation coverage is available through `scripts/test-live-databases.sh`; backend-equivalent AI tool assertions now cover metadata, read, mutation, and destructive paths in `src-tauri/tests/live_database.rs`; CLI/MCP adapter-level AI tool routing is covered by `tests/frontend/ai-external-tool-routing.test.ts`; full in-app TypeScript/Tauri AI registry live E2E coverage is still pending.
8. Add safety regression tests for SQL, MongoDB, Redis, and Elasticsearch request classification, and reject unknown MongoDB driver command fields before execution. Done.
9. Extract and test native AI mutation request builders for MongoDB, Redis, and Elasticsearch. Done.
10. Add core AI tool contract tests for provider hints, approval gates, safety routing, and structured MongoDB, Redis, and Elasticsearch mutation adapters. Done.
11. Add workspace adapter tests for metadata, query, table mutation, and MongoDB/Redis/Elasticsearch structured mutation service routing. Done.
12. Add CLI context overrides for direct tool calls so injected standalone adapters can execute tools with active connection, driver, and namespace context. Done.
13. Add MCP `tools/call` context overrides via `_meta["oxide/context"]` or `params.context` so external agents can execute tools with active connection, driver, and namespace context. Done.
14. Add CLI/MCP external-agent routing tests for injected database metadata, read query, and approved mutation adapters. Done.
15. Add CLI/MCP manifest environment metadata so external agents can see enabled tool families and missing headless adapters before selecting tools. Done.
16. Let the in-app default planner execute active query tab SQL when no editor selection is present, while still preferring selected SQL. Done.
17. Bound model planner turn and workspace text context before provider invocation, covering selected text, active tab SQL, and editor selection text. Done.
