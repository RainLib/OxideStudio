# ADR-0012: Deep Agents desktop runtime boundary

- Status: Accepted
- Date: 2026-07-15
- Scope: Deep Agents TypeScript adoption, Tauri WebView compatibility, process boundary, and fallback

## Context

Deep Agents supplies useful long-task primitives on top of LangGraph: todo planning, context offload, subagents, middleware, checkpointers, streaming, and human-in-the-loop interrupts. Official HITL requires a checkpointer and a stable thread id, which matches OxideStudio's need to pause at approval boundaries.

However, “TypeScript” does not mean “browser/WebView compatible.” The audited `deepagents@1.10.2` npm package exposes one JavaScript entry whose top-level imports include `node:fs`, `node:fs/promises`, `node:child_process`, `node:os`, `node:path`, `path`, and `fast-glob`. A Tauri WebView has no Node runtime. Polyfilling paths and buffers cannot safely implement process spawning, and bundling those shims would enlarge and weaken the application startup boundary.

## Decision

Keep `AssistantRuntime`, `AssistantPlanner`, `AiToolRegistry`, and the typed UI action layer as application-owned contracts. Continue using the browser-compatible `@langchain/langgraph` planner bridge in-process. Do not install or import the current `deepagents` package from frontend code, and do not add Node builtin polyfills to make it bundle.

Deep Agents may be adopted only through one of these gates:

1. an official browser-safe export with no top-level Node builtin dependency; or
2. a separately built, signed, version-matched sidecar/service started lazily for Agent mode.

A sidecar/service is an orchestration host, not a privileged database client. It receives bounded/redacted context and portable tool schemas, and returns tool proposals, interrupts, todo state, and typed progress events over a versioned protocol. All database, file, LSP, UI, approval, and audit operations remain in OxideStudio's registries and Tauri boundary. The host never receives database credentials, reusable approval tokens, unrestricted filesystem access, or direct driver handles.

Startup, protocol negotiation, cancellation, memory/CPU limits, binary signing, per-platform packaging, and crash recovery are release gates. Missing/incompatible host binaries, provider configuration, offline state, or host crashes must fall back to the current local planner/runtime without blocking application startup or Chat/Plan modes.

## Consequences

OxideStudio can adopt Deep Agents' stronger long-task orchestration without coupling the React UI or database safety model to a Node-only package. The current application remains buildable and functional without an additional runtime.

This defers built-in Deep Agents todo/subagent/context-offload features until the host gate is implemented or the package ships a browser-safe entry. A sidecar increases cross-platform build, update, signing, observability, and IPC work, so it must demonstrate a material quality gain over the existing Runtime before becoming the default Agent path.
