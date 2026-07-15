# ADR-0012: TypeScript Deep Agents desktop runtime boundary

- Status: Accepted and implemented
- Date: 2026-07-15
- Scope: Chat/Plan/Agent orchestration, process isolation, persistence, security, and packaging

## Context

OxideStudio needs resumable long-running AI turns, context compaction, subagent isolation, typed progress, clarification and approval interrupts. Keeping that loop in React tied task lifetime to the WebView and duplicated orchestration semantics between Chat, Plan and Agent.

`deepagents@1.10.8` has a browser export, but a WebView-hosted agent would still stop when the sidebar, window or WebView is reloaded. A Python runtime would add a second schema/tool implementation, native wheels, a larger signed payload and a more fragile three-platform release path. The desktop application already ships Node-based developer tooling and has a Rust trust boundary around databases and Tauri commands.

## Decision

All production Chat, Plan and Agent turns use this topology:

```text
React turn UI
   ↕ Tauri commands/events
Rust AgentHostManager / policy boundary
   ↕ JSON-RPC 2.0 + Content-Length framing over stdio
signed Node 22 TypeScript Deep Agents sidecar
```

The sidecar is built from the `agent-host` workspace with exact dependency versions, bundled by esbuild, then compiled to a target-specific executable with a pinned `@yao-pkg/pkg`. It imports `deepagents/node`; no Deep Agents code is included in the Vite/WebView bundle. Python, PyTauri and a Python sidecar are out of scope.

The production UI never silently falls back to the previous planner/tool loop. The old runtime is available for one development cycle only through `VITE_ASSISTANT_LEGACY_RUNTIME=1`.

## Trust boundary

Rust remains authoritative for:

- Provider URL validation, API credentials, model HTTP requests, cancellation and deadlines.
- Project/connection/database/schema identity and live database sessions.
- Tool availability, canonical input digests, SQL risk, result limits and audit decisions.
- One-time approval leases bound to thread, turn, call, tool, input digest and expiry.
- Encrypted thread/artifact and LangGraph checkpoint/pending-write persistence with seven-day retention.
- Starting, supervising and killing the sidecar.

The sidecar receives only a redacted workspace snapshot, model capability descriptor and portable tool manifest. It never receives database passwords, SSH secrets, connection URLs, driver handles, reusable approval tokens or a general process/filesystem capability. `FilesystemBackend`, `LocalShellBackend`, shell tools and LangSmith Sandbox are forbidden. Deep Agents filesystem tools are excluded and an explicit deny policy is retained as defence in depth.

Provider API keys are stored in Keychain/Windows Credential Manager/Linux Secret Service, keyed by a hash of the normalized provider endpoint. They are not persisted in Zustand/localStorage, serialized into checkpoints or sent to the sidecar.

## Protocol and lifecycle

`agent-contract` defines protocol version 1, a 4 MiB maximum frame and Zod-validated requests/events. Every turn-scoped request carries `requestId`, `threadId`, `turnId`, `contextVersion` and `deadline`. Required capability mismatches fail the handshake; unknown optional fields remain forward-compatible.

The WebView can call only:

- `agent_start_turn`
- `agent_resume_turn`
- `agent_cancel_turn`
- `agent_answer_clarification`
- `agent_approve_action`
- `agent_get_status`

The manager is side-effect free during Tauri setup. It lazily starts the sidecar on the first configured AI request, performs a version/capability handshake, bounds frames and request deadlines, applies backpressure through the stdio writer lock, cleans up on exit and attempts at most one transport restart. A missing, incompatible or crashed sidecar makes only the Assistant unavailable; application startup and the database workbench continue.

Stdout is protocol-only. Sidecar diagnostics use redacted stderr. The WebView has no shell/spawn permission.

## Profiles

- Chat uses Deep Agents history, checkpointing, compaction, clarification and final-answer streaming semantics, but receives no database, todo or subagent tools.
- Plan receives read-only discovery, metadata, LSP, query review and estimated EXPLAIN tools. It can create todos and use read-only schema/query subagents, but cannot receive mutation tools.
- Agent receives the Rust-filtered manifest. Read-only work may be concurrent within a bound; mutation calls are serialized and require an interrupt, a user decision, a Rust-issued one-time lease and a second Rust policy check.

The initial synchronous subagents are `schema_analyst`, `query_reviewer` and, in Agent mode, `plan_verifier`. They have isolated context, read-only tools and no filesystem. General-purpose and asynchronous subagents remain disabled.

`ask_user` is available in every profile. It asks one to three bounded questions, supports two to three options plus free text, pauses the same turn, and permits at most two consecutive clarification rounds. Connection ambiguity and safety ambiguity can also be raised deterministically by Rust rather than relying on model judgment.

## Context and checkpointing

`OxideChatModel.profile` exposes the configured provider input/output token limits so Deep Agents uses fractional rather than the unsafe 170k-token fallback. Its summarization middleware offloads old observations, preserves recent semantic turns and filters `lcSource=summarization` output from final answers. `OxideCheckpointSaver` checks Rust-backed graph state before bootstrapping; later invocations append only the new prompt, preventing duplicate history injection.

Rust saves project-scoped thread, artifact, LangGraph checkpoint and pending-write records with AES-256-GCM. Every record has an independent nonce; graph AAD binds project, thread, namespace, checkpoint and, for writes, task/index. The master key lives in the OS credential manager. Records expire after seven days and are cleaned on store initialization and subsequent access. Credentials, SSH secrets, reusable approval leases and unbounded raw rows are excluded.

A final answer is emitted only after the new checkpoint is accepted by Rust. Clarification and approval tools call LangGraph `interrupt()`; answers resume with `Command({ resume })`, including after a sidecar restart. The approval lease is never placed in the command/checkpoint and losing it fails closed. A recovered or uncertain mutation is never replayed automatically; database-level exactly-once still requires a separate receipt/idempotency design.

## UI projection

React projects sidecar events into a turn view model; it does not own retries, tool loops or approval semantics. One turn is always user question → collapsible process → coordinator final answer. Successful tool/todo/subagent stages render as compact one-line disclosures. Clarification, approval, stale context and failure expand automatically. Only the coordinator final answer is normal Assistant prose.

The conversation minimap creates one neutral-grey marker per complete question/answer turn. Tool and subagent stages do not create independent history markers. It appears only when a sufficiently wide panel actually overflows, supports keyboard navigation and respects reduced motion.

## Packaging

The release matrix is macOS arm64, macOS x86_64, Windows x86_64 and Linux x86_64. macOS universal artifacts are deliberately not produced. Each job builds and self-tests the target sidecar and SQL LSP, signs helper binaries before the app/installer, then publishes an architecture-specific Aliyun OSS updater entry. Packaging or handshake failure fails the release; it cannot be hidden by a runtime fallback.

## Consequences

The agent survives sidebar and WebView lifecycle changes, and one orchestration model now serves all three modes. The cost is a larger signed payload, a second supervised process and a strict cross-language protocol/contract-test obligation. Database safety remains testable in Rust rather than depending on model prompts or Deep Agents middleware.

Changing the sidecar to Python, moving it into the WebView, enabling arbitrary filesystem/shell access, or allowing it to hold credentials requires a superseding ADR and a new security review.
