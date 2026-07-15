# ADR-0011: Project-scoped, data-minimized Agent task summaries

- Status: Accepted for legacy task-summary compatibility; executable runtime persistence amended by ADR-0012
- Date: 2026-07-15
- Scope: `assistant_tasks` history, safe task reveal, legacy execution receipts and migration

## Context

Before the TypeScript Deep Agents host existed, the bounded tool loop lived in the application runtime and its live controller was tied to React. A process exit lost execution state. Persisting the complete runtime object would have been unsafe: prompts and tool inputs could contain SQL or mutation payloads, outputs could contain database rows, and approval state must never become reusable authorization.

The resulting `assistant_tasks` design intentionally solved a smaller problem: retain a safe, project-scoped Task Center summary and identify an uncertain mutation window. It did not claim to resume a graph.

ADR-0012 subsequently moved production Chat, Plan and Agent orchestration to a signed Node 22 Deep Agents sidecar and introduced a separate Rust-owned encrypted thread/checkpoint/artifact store. This ADR remains authoritative only for the legacy summary schema and migration behavior.

## Legacy summary decision

Store a dedicated task summary in `assistant_tasks`, keyed by `project_id + id`. It contains request/session identity, lifecycle status, generic title/detail, progress, timestamps and a versioned, bounded summary.

Version 1 permits only:

- plan step id, generic title, tool name, approval requirement and risk;
- completed step identity, tool name and terminal status;
- current step identity/title and bounded progress.

Version 2 adds a bounded receipt for an approved tool: step id, tool name, `started/succeeded/failed` and timestamps. Version 3 additionally stores a data-minimized workspace binding: bounded project/connection/driver/database/namespace/tab identity, document and selection revision hashes, a session-local context version and a stable fingerprint.

All versions exclude prompts, conversation messages, editor/selection text, SQL, tool inputs, mutation payloads, approval tokens, tool outputs, result rows, credentials and arbitrary metadata. Rust validates receipt-to-plan identity, bounded fields, at most 100 plan/completed/receipt entries and a maximum 64 KiB checkpoint.

If persistence of `started` fails, the legacy runtime blocks the approved tool. If a process exit occurs after an external effect but before the terminal receipt, the task shows `verify/uncertain`; the receipt is never an automatic replay instruction.

Writes for one task are sequenced, history is scoped to the active project, and records left `running` or `awaiting_approval` by another application session become `interrupted`. The store retains active records and at most 100 recent terminal records per project. `task.reveal` resolves only the bounded safe summary.

## Current Deep Agents persistence

Production Deep Agents state does not extend or deserialize the `assistant_tasks` checkpoint. Rust stores it separately in:

- `agent_threads`;
- `agent_checkpoints`;
- `agent_artifacts`.

Those records are project-scoped AES-256-GCM ciphertext with a unique nonce and AAD bound to record kind, project, identifier and version. The master key lives in the OS credential manager and records expire after seven days. If the keyring cannot provide a persistent key, the runtime uses an encrypted in-memory session backend instead of writing plaintext.

The sidecar uses `OxideCheckpointSaver` to persist LangGraph checkpoints and pending writes through the Rust host at graph-step boundaries, and still saves a bounded compatibility checkpoint before emitting a final answer. `ask_user` and approval pauses use LangGraph interrupts and resume with `Command`; a restarted sidecar can reload the encrypted graph state. Credentials, SSH secrets, reusable approval leases and unbounded raw rows remain excluded. Approval decisions may be checkpointed, but the one-time Rust lease is transient; losing it makes the mutation fail closed.

The new store does not convert an old task summary into executable graph state. Migration may retain `assistant_tasks` for Task Center history, but it must never infer messages, tool inputs or authorization from it.

## Recovery guarantees

The currently implemented boundary guarantees:

- encrypted project separation and seven-day expiry;
- successful-Turn checkpoint durability;
- no automatic replay of an uncertain mutation;
- one-time Rust approval leases are not persisted as reusable authority.

It does not yet claim:

- crash-resumption of a clarification or approval that was waiting inside a dead sidecar;
- a distributed exactly-once transaction between a database and local checkpoint store;
- proof that an uncertain external mutation committed;
- replay of legacy `assistant_tasks` as a Deep Agents thread.

## Consequences

Task Center history remains useful and privacy-bounded while the production agent gets a separate encrypted runtime store. Keeping the schemas separate avoids silently treating a display summary as executable or authorized state. It also creates an explicit cleanup task: once legacy runtime support is removed, retain only the user-visible summary fields still needed by Task Center and delete obsolete execution semantics through a versioned migration.
