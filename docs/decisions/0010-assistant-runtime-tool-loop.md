# ADR-0010: Assistant Runtime owns the bounded tool loop

- Status: Accepted
- Date: 2026-07-15
- Scope: AI Agent orchestration boundary

## Context

The Assistant panel previously implemented the complete multi-round algorithm inside a React component: step iteration, follow-up normalization, tool/input deduplication, call budgets, failure stopping, summaries, and cancellation checks. This made behavior depend on component lifetime and made the same loop difficult to reuse from a future Deep Agents executor, checkpoint recovery, Task Center, or headless test. It also allowed UI refactors to accidentally change safety semantics.

Moving directly to a durable framework runtime would combine too many changes at once. Oxide first needs an application-owned execution contract that keeps the existing `AiToolRegistry` policy boundary and can later be driven by LangGraph or Deep Agents without giving either framework direct database access.

## Decision

`AssistantRuntime.runToolLoop` owns sequential multi-round execution. Its input contains the prepared turn, explicit starting steps, summary input, execution context, existing results, exact approved step ids, optional bounded limits, and a typed event observer. The runtime emits `stepStarted`, `stepCompleted`, `roundSummarized`, `planExtended`, and `limitReached`; React converts those events into transient plan, conversation, attachment, and activity views.

Every model-suggested follow-up is normalized against the current tool manifest and policy. Unknown or denied tools are rejected, write/destructive tools are marked for approval regardless of model metadata, duplicate tool+input signatures are not repeated, and generated ids cannot collide with existing plan/result ids. An approval authorizes only the matching normalized step id for that invocation; approval-required follow-ups remain in the plan and are never auto-run.

The default budget is four summarized rounds and twelve tool attempts. Optional caller limits cannot exceed eight rounds or twenty-four attempts. A failed/approval-required result stops the current loop. `AbortSignal` is checked before steps, after execution, and after summarization; cancelled runs return `cancelled` rather than being reported as ordinary tool failure. Observer exceptions are isolated from execution semantics.

## Consequences

- React no longer defines agent iteration or safety behavior; the loop has direct domain tests.
- The same runtime contract can sit below the existing planner, LangGraph, or a lazily loaded Deep Agents mode.
- Tool execution remains sequential. Parallel read scheduling requires dependency metadata and connection-level concurrency budgets before it can be enabled safely.
- This is not durable execution. The Sidebar still owns the current `AbortController` and in-memory render state, so unmount cancels the run and restart cannot resume it.
- The next persistence step must serialize task/checkpoint state and approval pause tokens through a project-scoped Tauri store without storing raw result rows by default.
