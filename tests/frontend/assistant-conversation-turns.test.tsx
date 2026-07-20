/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantTurn, type AssistantTurn } from "@/ai/assistant/turns";
import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AssistantConversation turns", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps pending and answered clarifications out of the conversation transcript", async () => {
    const turn: AssistantTurn = {
      ...createAssistantTurn({
        id: "turn-1",
        requestId: "request-1",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Inspect my database",
        now: 1,
      }),
      threadId: "thread-1",
      status: "awaiting_input",
      process: [
        {
          id: "step-1",
          sequence: 1,
          kind: "step",
          title: "Inspect saved connections",
          status: "completed",
          startedAt: 2,
          finishedAt: 3,
        },
      ],
      clarifications: [
        {
          clarificationId: "clarification-1",
          questionId: "data-source",
          question: "Which data source should I use?",
          options: [{ id: "warehouse", label: "Warehouse" }],
          allowFreeText: true,
          answer: "Warehouse",
          answeredAt: 3,
        },
        {
          clarificationId: "clarification-2",
          questionId: "region",
          question: "Which region should I inspect?",
          options: [{ id: "primary", label: "Primary region" }],
          allowFreeText: true,
        },
      ],
      final: {
        content: "I will inspect the selected source after your answer.",
        attachments: [],
        createdAt: 4,
      },
    };

    await act(async () => {
      root.render(
        <AssistantConversation
          turns={[turn]}
          isResponding={false}
          pendingLabel="Working"
          onUsePrompt={vi.fn()}
          onExecuteAttachment={vi.fn(async (request) => ({
            actionId: request.id,
            status: "success" as const,
            code: "OK" as const,
          }))}
          contextFingerprint="ctx-1"
        />,
      );
    });

    expect(container.textContent).toContain("Inspect my database");
    const process = container.querySelector<HTMLElement>(
      '[aria-label="Assistant process"]',
    );
    expect(process).not.toBeNull();
    expect(container.textContent).not.toContain("Which data source should I use?");
    expect(container.textContent).not.toContain("Which region should I inspect?");
    expect(container.textContent).not.toContain("Warehouse");
    expect(container.textContent).toContain(
      "I will inspect the selected source after your answer.",
    );
  });

  it("returns a digest-bound approval decision without exposing an approved flag", async () => {
    const onDecideApproval = vi.fn(async () => undefined);
    const turn: AssistantTurn = {
      ...createAssistantTurn({
        id: "turn-2",
        requestId: "request-2",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Update user 42",
        now: 1,
      }),
      status: "awaiting_approval",
      approvals: [
        {
          approvalId: "approval-1",
          callId: "call-1",
          title: "Update one users row",
          summary: "Update users.id = 42",
          toolName: "table.updateRows",
          risk: "write",
          inputDigest: "sha256:input",
        },
      ],
    };

    await act(async () => {
      root.render(
        <AssistantConversation
          turns={[turn]}
          isResponding={false}
          pendingLabel="Working"
          onUsePrompt={vi.fn()}
          onExecuteAttachment={vi.fn(async (request) => ({
            actionId: request.id,
            status: "success" as const,
            code: "OK" as const,
          }))}
          contextFingerprint="ctx-1"
          onDecideApproval={onDecideApproval}
        />,
      );
    });

    expect(container.textContent).toContain("Update one users row");
    expect(container.textContent).toContain("Approve once");
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Approve once"))
        ?.click();
      await Promise.resolve();
    });
    expect(onDecideApproval).toHaveBeenCalledWith(
      "turn-2",
      "approval-1",
      "approve",
      "ctx-1",
    );
  });

  it("collapses all Agent activity into one Codex-style disclosure", async () => {
    const turn: AssistantTurn = {
      ...createAssistantTurn({
        id: "turn-activity",
        requestId: "request-activity",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Inspect the selected schema",
        now: 1,
      }),
      status: "completed",
      process: [
        {
          id: "status:planning",
          sequence: 1,
          kind: "planning",
          title: "Preparing the response",
          status: "completed",
          startedAt: 1,
          finishedAt: 2,
        },
        {
          id: "plan:read",
          sequence: 2,
          kind: "step",
          title: "Read schema metadata",
          status: "completed",
          startedAt: 2,
          finishedAt: 3,
        },
        {
          id: "tool:query",
          sequence: 3,
          kind: "tool",
          title: "Ran query analysis",
          detail:
            'query.runReadOnly · 10 rows · 640 bytes\nOutput preview\n[\n  { "id": 1 }\n]',
          status: "completed",
          startedAt: 3,
          finishedAt: 4,
        },
        {
          id: "compaction:4",
          sequence: 4,
          kind: "compaction",
          title: "Compacted conversation context",
          status: "completed",
          startedAt: 4,
          finishedAt: 5,
        },
      ],
      final: {
        content: "The schema contains twelve tables.",
        attachments: [],
        createdAt: 6,
      },
    };

    await act(async () => {
      root.render(
        <AssistantConversation
          turns={[turn]}
          isResponding={false}
          pendingLabel="Working"
          onUsePrompt={vi.fn()}
          onExecuteAttachment={vi.fn(async (request) => ({
            actionId: request.id,
            status: "success" as const,
            code: "OK" as const,
          }))}
        />,
      );
    });

    const disclosure = container.querySelector<HTMLElement>(
      '[data-assistant-process-disclosure="turn-activity"]',
    );
    expect(
      container.querySelectorAll("[data-assistant-process-disclosure]"),
    ).toHaveLength(1);
    expect(disclosure?.textContent).toContain("Read schema metadata");
    expect(disclosure?.textContent).toContain("Ran query analysis");
    expect(disclosure?.textContent).toContain("1 more");
    expect(disclosure?.textContent).not.toContain("Preparing the response");
    expect(
      disclosure?.querySelectorAll("[data-assistant-process-item]"),
    ).toHaveLength(0);

    await act(async () => {
      disclosure?.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(
      disclosure?.querySelectorAll("[data-assistant-process-item]"),
    ).toHaveLength(4);
    expect(disclosure?.textContent).toContain("query.runReadOnly · 10 rows");
    expect(disclosure?.querySelector("pre")?.textContent).toContain(
      '{ "id": 1 }',
    );
  });

  it("shows an actionable error and keeps technical detail collapsed", async () => {
    const turn: AssistantTurn = {
      ...createAssistantTurn({
        id: "turn-3",
        requestId: "request-3",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Read the latest MongoDB documents",
        now: 1,
      }),
      status: "failed",
      error:
        "I couldn't translate that request into a valid read-only MongoDB query. Nothing was changed. Please retry the step.",
      errorDetail: "TOOL_ERROR: Invalid MongoDB command shape",
    };

    await act(async () => {
      root.render(
        <AssistantConversation
          turns={[turn]}
          isResponding={false}
          pendingLabel="Working"
          onUsePrompt={vi.fn()}
          onExecuteAttachment={vi.fn(async (request) => ({
            actionId: request.id,
            status: "success" as const,
            code: "OK" as const,
          }))}
        />,
      );
    });

    expect(container.textContent).toContain("Nothing was changed");
    const details = container.querySelector<HTMLDetailsElement>("details");
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("Technical details");
    expect(details?.textContent).toContain("Invalid MongoDB command shape");
  });
});
