/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderMocks = vi.hoisted(() => ({
  messageContent: vi.fn(),
}));

vi.mock(
  "@/components/workspace/assistant/AssistantMessageContent",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@/components/workspace/assistant/AssistantMessageContent")
      >();
    return {
      ...original,
      AssistantMessageContent: (
        props: Parameters<typeof original.AssistantMessageContent>[0],
      ) => {
        renderMocks.messageContent(props.content);
        return <original.AssistantMessageContent {...props} />;
      },
    };
  },
);

import { createAssistantTurn, type AssistantTurn } from "@/ai/assistant/turns";
import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AssistantConversation turns", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    renderMocks.messageContent.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("does not rerender unchanged completed turns when the composer changes or a turn is appended", async () => {
    const completedTurn: AssistantTurn = {
      ...createAssistantTurn({
        id: "turn-completed",
        requestId: "request-completed",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Explain the active SQL",
        now: 1,
      }),
      status: "completed",
      final: {
        content: "The query reads one indexed row.",
        attachments: [],
        createdAt: 2,
      },
    };
    const onUsePrompt = vi.fn();
    const onExecuteAttachment = vi.fn(async (request) => ({
      actionId: request.id,
      status: "success" as const,
      code: "OK" as const,
    }));
    const renderConversation = (
      turns: AssistantTurn[],
      composerDraft: string,
      usePrompt: (prompt: string) => void,
    ) => (
      <div data-composer-draft={composerDraft}>
        <AssistantConversation
          turns={turns}
          isResponding={false}
          pendingLabel="Working"
          onUsePrompt={usePrompt}
          onExecuteAttachment={onExecuteAttachment}
        />
      </div>
    );

    await act(async () => {
      root.render(renderConversation([completedTurn], "", onUsePrompt));
    });
    expect(renderMocks.messageContent).toHaveBeenCalledTimes(1);

    const latestUsePrompt = vi.fn();
    await act(async () => {
      root.render(
        renderConversation([completedTurn], "typed draft", latestUsePrompt),
      );
    });
    expect(renderMocks.messageContent).toHaveBeenCalledTimes(1);

    const appendedTurn = createAssistantTurn({
      id: "turn-appended",
      requestId: "request-appended",
      projectId: "project-1",
      requestedMode: "agent",
      mode: "agent",
      userMessage: "Inspect the next query",
      now: 3,
    });
    await act(async () => {
      root.render(
        renderConversation(
          [completedTurn, appendedTurn],
          "typed draft",
          latestUsePrompt,
        ),
      );
    });
    expect(renderMocks.messageContent).toHaveBeenCalledTimes(1);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-assistant-turn-id="turn-completed"] [aria-label="Use prompt again"]',
        )
        ?.click();
    });
    expect(onUsePrompt).not.toHaveBeenCalled();
    expect(latestUsePrompt).toHaveBeenCalledWith("Explain the active SQL");
  });

  it("windows completed history while keeping older active turns mounted", async () => {
    const turns = Array.from({ length: 45 }, (_, index) => ({
      ...createAssistantTurn({
        id: `turn-${index}`,
        requestId: `request-${index}`,
        projectId: "project-1",
        requestedMode: "agent" as const,
        mode: "agent" as const,
        userMessage: `Prompt ${index}`,
        now: index + 1,
      }),
      status: "completed" as const,
      final: {
        content: `Answer ${index}`,
        attachments: [],
        createdAt: index + 2,
      },
    }));
    turns[2] = { ...turns[2], status: "awaiting_approval", final: undefined };

    await act(async () => {
      root.render(
        <AssistantConversation
          turns={turns}
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

    expect(container.querySelectorAll("[data-assistant-turn-id]")).toHaveLength(
      31,
    );
    expect(
      container.querySelector('[data-assistant-turn-id="turn-2"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-assistant-turn-id="turn-1"]'),
    ).toBeNull();

    const showEarlier = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show 14 earlier assistant turns"]',
    );
    expect(showEarlier).not.toBeNull();
    await act(async () => showEarlier?.click());

    expect(container.querySelectorAll("[data-assistant-turn-id]")).toHaveLength(
      45,
    );
    expect(container.querySelector("[data-assistant-history-window]")).toBeNull();
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
    expect(container.textContent).not.toContain(
      "Which data source should I use?",
    );
    expect(container.textContent).not.toContain(
      "Which region should I inspect?",
    );
    expect(container.textContent).not.toContain("Warehouse");
    expect(container.textContent).not.toContain(
      "I will inspect the selected source after your answer.",
    );
  });

  it("returns a digest-bound approval decision without exposing an approved flag", async () => {
    let resolveDecision: (() => void) | undefined;
    const onDecideApproval = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDecision = resolve;
        }),
    );
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
      undefined,
    );
    const approvalPrompt = container.querySelector<HTMLElement>(
      'section[aria-busy="true"]',
    );
    expect(approvalPrompt?.textContent).toContain("Approving…");
    expect(
      Array.from(approvalPrompt?.querySelectorAll("button") ?? []).every(
        (button) => button.disabled,
      ),
    ).toBe(true);

    await act(async () => {
      resolveDecision?.();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Approve once");
  });

  it("requires the exact dynamic phrase before approving a high-risk shell command", async () => {
    const onDecideApproval = vi.fn(async () => undefined);
    const turn: AssistantTurn = {
      ...createAssistantTurn({
        id: "turn-shell-confirm",
        requestId: "request-shell-confirm",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Reset the repository",
        now: 1,
      }),
      status: "awaiting_approval",
      approvals: [
        {
          approvalId: "approval-shell",
          callId: "call-shell",
          title: "Approve shell.execute",
          summary: "Run once: git reset --hard",
          toolName: "shell.execute",
          risk: "destructive",
          inputDigest: "sha256:shell",
          policyDigest: "sha256:policy",
          findings: [
            {
              ruleId: "builtin.git-hard-reset",
              decision: "confirm",
              title: "Destructive Git operation",
              detail: "This discards uncommitted working tree changes.",
            },
          ],
          confirmation: {
            kind: "phrase",
            phrase: "RUN A13F9C",
            prompt: "Type the confirmation phrase",
          },
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
          contextFingerprint="ctx-shell"
          onDecideApproval={onDecideApproval}
        />,
      );
    });

    expect(container.textContent).toContain("Destructive Git operation");
    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="High-risk command confirmation phrase"]',
    );
    const approve = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Approve once"),
    ) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      if (input) {
        valueSetter?.call(input, "RUN A13F9C ");
        input.dispatchEvent(
          new InputEvent("input", { bubbles: true, data: "RUN A13F9C " }),
        );
      }
    });
    expect(approve.disabled).toBe(true);

    await act(async () => {
      if (input) {
        valueSetter?.call(input, "RUN A13F9C");
        input.dispatchEvent(
          new InputEvent("input", { bubbles: true, data: "RUN A13F9C" }),
        );
      }
    });
    expect(approve.disabled).toBe(false);
    await act(async () => {
      input?.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      input?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          isComposing: true,
        }),
      );
    });
    expect(onDecideApproval).not.toHaveBeenCalled();
    await act(async () => {
      input?.dispatchEvent(new Event("compositionend", { bubbles: true }));
    });
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(onDecideApproval).toHaveBeenCalledWith(
      "turn-shell-confirm",
      "approval-shell",
      "approve",
      "ctx-shell",
      "RUN A13F9C",
    );
  });

  it("links only trusted Agent file changes to the project editor", async () => {
    const onOpenProjectFile = vi.fn(async () => "project-file-tab");
    const turn: AssistantTurn = {
      ...createAssistantTurn({
        id: "turn-file-link",
        requestId: "request-file-link",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Create a reusable SQL file",
        now: 1,
      }),
      status: "completed",
      fileChanges: [
        {
          callId: "call-write-1",
          relativePath: "sql/ai_model_select.sql",
          operation: "created",
          revision: "a".repeat(64),
          occurredAt: 2,
        },
      ],
      final: {
        content:
          "已为你创建文件：**sql/ai_model_select.sql**\n\n未验证路径：sql/not_created.sql",
        attachments: [],
        createdAt: 3,
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
          onOpenProjectFile={onOpenProjectFile}
        />,
      );
    });

    const fileLink = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open sql/ai_model_select.sql in editor"]',
    );
    expect(fileLink).not.toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="Open sql/not_created.sql in editor"]',
      ),
    ).toBeNull();

    await act(async () => {
      fileLink?.click();
      await Promise.resolve();
    });
    expect(onOpenProjectFile).toHaveBeenCalledWith("sql/ai_model_select.sql");
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
      updatedAt: 65_001,
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
    expect(disclosure?.textContent).toContain("Worked for 1m 5s");
    expect(disclosure?.textContent).not.toContain("Read schema metadata");
    expect(disclosure?.textContent).not.toContain("Ran query analysis");
    expect(
      disclosure?.querySelectorAll("[data-assistant-process-item]"),
    ).toHaveLength(0);
    expect(
      disclosure
        ?.querySelector("[data-assistant-process-chevron]")
        ?.getAttribute("class"),
    ).toContain("opacity-0");

    await act(async () => {
      disclosure?.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(
      disclosure?.querySelectorAll("[data-assistant-process-item]"),
    ).toHaveLength(4);
    expect(disclosure?.textContent).toContain("Read schema metadata");
    expect(disclosure?.textContent).toContain("Ran query analysis");
    const toolActivity = disclosure?.querySelector<HTMLElement>(
      '[data-assistant-process-item="tool:query"]',
    );
    const toolToggle = toolActivity?.querySelector<HTMLButtonElement>(
      '[data-assistant-process-item-toggle="tool:query"]',
    );
    expect(toolToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(
      toolToggle
        ?.querySelector("[data-assistant-process-chevron]")
        ?.getAttribute("class"),
    ).toContain("opacity-0");
    expect(toolActivity?.textContent).not.toContain(
      "query.runReadOnly · 10 rows",
    );
    expect(toolActivity?.querySelector("pre")).toBeNull();

    await act(async () => {
      toolToggle?.click();
    });

    expect(toolToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(toolActivity?.textContent).toContain("query.runReadOnly · 10 rows");
    const outputPreview = toolActivity?.querySelector("pre");
    expect(outputPreview?.textContent).toContain('{ "id": 1 }');
    expect(outputPreview?.className).toContain("overflow-x-hidden");
    expect(outputPreview?.className).toContain("whitespace-pre-wrap");
    expect(outputPreview?.className).not.toContain("custom-scrollbar");
  });

  it("shows a flat live timeline and withholds draft answer text until completion", async () => {
    const turn: AssistantTurn = {
      ...createAssistantTurn({
        id: "turn-live-process",
        requestId: "request-live-process",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Inspect and update the SQL file",
        now: Date.now() - 2_000,
      }),
      status: "running",
      process: [
        {
          id: "commentary:1",
          sequence: 1,
          kind: "commentary",
          title: "I’ll inspect the existing query before changing it.",
          status: "completed",
          startedAt: Date.now() - 1_500,
          finishedAt: Date.now() - 1_400,
        },
      ],
      draft: "Next I’ll verify the generated file against the request.",
    };

    await act(async () => {
      root.render(
        <AssistantConversation
          turns={[turn]}
          isResponding
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

    const timeline = container.querySelector<HTMLElement>(
      '[data-assistant-live-process="turn-live-process"]',
    );
    expect(timeline?.textContent).not.toContain("Working for");
    expect(timeline?.textContent).toContain(
      "I’ll inspect the existing query before changing it.",
    );
    expect(timeline?.textContent).toContain("Writing the answer");
    expect(timeline?.textContent).not.toContain("verify the generated file");
    expect(
      container.querySelector(
        '[data-assistant-process-disclosure="turn-live-process"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector("[data-assistant-final-response]"),
    ).toBeNull();
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
