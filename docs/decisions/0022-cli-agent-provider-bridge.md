# ADR-0022: Application-managed CLI Agent providers

- Status: Accepted and implemented
- Date: 2026-08-11
- Scope: Codex CLI, CodeBuddy Code CLI, private tools, approvals, interruption and database mutation

## Context

OxideStudio needs to use an end user's existing Codex CLI or CodeBuddy Code CLI login without copying an API key into the application. The public `oxide-agent mcp stdio` contract is intentionally read-only and cannot participate in a Desktop approval lease. Giving a third-party CLI a reusable write token, database credential, project working directory or public write-capable MCP server would break the Rust trust boundary.

## Decision

`AgentProviderKind` has three routes. `openai-compatible` keeps the signed Deep Agents sidecar and Rust HTTP model gateway. `codex-cli` and `codebuddy-cli` are supervised directly by Rust in a new temporary working directory. The configured executable is discovered across PATH and common platform locations; Windows npm shims and Node entry points are normalized before launch. CLI stdout is bounded JSONL, stderr is a bounded diagnostic buffer, and timeout, cancellation and drop terminate the child process tree owned by the runtime.

Each CLI turn receives one random local endpoint and token. Windows uses a named pipe and Unix uses a temporary Unix socket. The values exist only in the CLI process environment. Codex receives only the names through its documented MCP `env_vars` forwarding list; CodeBuddy's temporary MCP JSON contains only the bridge executable and arguments. The hidden `oxide-agent mcp bridge` refuses to start without both values and forwards calls to the Desktop `AgentHostManager`. The public MCP and CLI tool surfaces remain strictly read-only.

Rust freezes project, connection, database, namespace and tool manifest at turn start. The private bridge does not trust CLI claims of approval. High-risk calls create the existing Desktop approval event. A successful decision creates a single-use lease bound to turn, call, tool, canonical input digest, policy digest, target and expiry. Rejection, timeout, cancellation, target drift or process interruption invalidates the lease.

`query.executeApproved` is visible only in Agent mode. It accepts one complete operation, rejects transaction controls, redirects provably read-only SQL to the read-only path, requires an explicit phrase for destructive DDL, and is exposed only for reviewed mutation adapters. `unclassified`, `production` and protected databases cannot be mutated by AI. Audit logs contain target, operation type and digest, never SQL literals.

Codex and CodeBuddy events map to the existing `AgentHostEvent` stream. Public text, tool lifecycle, usage, bounded errors and a safe reasoning activity label are allowed; raw internal reasoning and environment values are not. Completed turns persist normally. An active CLI turn interrupted by an application restart is never automatically replayed. A user can manually retry a turn with no pending mutation receipt. If `query.executeApproved` was still running, the turn becomes failed with manual verification required and retry is disabled.

## Consequences

Users can reuse authenticated CLIs without an API key while the Desktop remains authoritative for databases and approvals. The two CLI event dialects and launch conventions become maintained compatibility surfaces. A CLI upgrade can cause a classified install, authentication, protocol or MCP startup error, but cannot silently widen database or filesystem authority.
