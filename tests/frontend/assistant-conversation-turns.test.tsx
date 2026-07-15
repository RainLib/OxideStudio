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

  it("renders user, collapsed process, inline clarification and one final answer", async () => {
    const onAnswerClarification = vi.fn(async () => undefined);
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
          onAnswerClarification={onAnswerClarification}
        />,
      );
    });

    expect(container.textContent).toContain("Inspect my database");
    const process = container.querySelector<HTMLDetailsElement>(
      'details[aria-label="Assistant process"]',
    );
    expect(process?.open).toBe(false);
    expect(container.textContent).toContain("Which data source should I use?");
    expect(container.textContent).toContain(
      "I will inspect the selected source after your answer.",
    );

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Warehouse")
        ?.click();
      await Promise.resolve();
    });
    expect(onAnswerClarification).toHaveBeenCalledWith(
      "turn-1",
      "clarification-1",
      "data-source",
      "Warehouse",
      "ctx-1",
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
});
