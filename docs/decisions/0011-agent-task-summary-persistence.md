# ADR-0011: Project-scoped, data-minimized Agent task summaries

- Status: Accepted
- Date: 2026-07-15
- Scope: Agent task history, application-session recovery, retention, and privacy boundary

## Context

`AssistantRuntime` owns the bounded tool loop, but the running controller and transient execution state still live in React. A process exit therefore loses the live task. Persisting the complete runtime object would be unsafe: tool inputs may contain SQL, mutation payloads or credentials; tool outputs may contain database rows; approval state must never become a reusable authorization token.

The existing metadata resource table is also the wrong ownership boundary because it requires a database connection. An Agent task belongs to a project even when it only inspects project files or fails before a connection is selected.

## Decision

Store a dedicated, project-scoped task summary in `assistant_tasks`, keyed by `project_id + id`. The record contains request/session identity, lifecycle status, generic title/detail, progress, timestamps, and a versioned summary checkpoint.

The version 1 checkpoint is deliberately non-executable. Its schema permits only:

- plan step `id`, generic `title`, tool name, approval requirement and risk;
- completed step identity, tool name and terminal status;
- current step identity/title and bounded progress.

It cannot represent prompts, conversation messages, tool inputs, SQL, mutation payloads, approval tokens, tool outputs, result rows, credentials, or arbitrary metadata. Frontend serialization tests assert this exclusion. The Rust boundary independently validates field sizes, at most 100 plan/completed steps, and a maximum serialized checkpoint size of 64 KiB.

Frontend writes for a task are sequenced so an older event cannot overwrite a newer lifecycle state. Task history is hydrated only for the active project; delayed hydration preserves an active same-project task created after the read began. Switching projects aborts the old controller, persists a cancelled summary, and clears conversation and approval state.

Each application process has a random session id. When task history is read, `running` or `awaiting_approval` records from a different session are converted to `interrupted`; execution is not resumed. Clearing history removes terminal records only. The store retains all active records and at most 100 most-recent terminal records per project.

## Consequences

Task status and bounded plan history survive a restart without placing database content or reusable authorization on disk. The Task Status Center can distinguish waiting, interrupted, completed, failed and cancelled work.

This is a durable summary, not a durable Agent runtime. It cannot replay a tool, resume a graph, reveal the original conversation, or prove whether an external mutation committed. True checkpoint/resume still requires versioned runtime state, idempotency receipts, non-replayable approval pause tokens, an explicit thread-retention/encryption policy, and a `task.reveal` surface.
