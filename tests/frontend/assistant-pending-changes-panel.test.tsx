/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantTurn, type AssistantTurn } from "@/ai/assistant/turns";
import { AssistantPendingChangesPanel } from "@/components/workspace/assistant/AssistantPendingChangesPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Assistant pending changes review", () => {
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

  it("summarizes changed files above the composer and expands the file list", async () => {
    const turn: AssistantTurn = {
      ...createAssistantTurn({
        id: "turn-1",
        requestId: "request-1",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Update files",
      }),
      fileProposals: [
        {
          callId: "write-1",
          relativePath: "sql/report.sql",
          operation: "updated",
          proposedRevision: "a".repeat(64),
          baseRevision: "b".repeat(64),
          originalContent: "old\n",
          proposedContent: "new\nextra\n",
          additions: 2,
          deletions: 1,
          status: "pending",
          occurredAt: 1,
        },
      ],
    };
    const onOpen = vi.fn();
    const onKeep = vi.fn();
    const onUndo = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <AssistantPendingChangesPanel
          turns={[turn]}
          onOpen={onOpen}
          onKeep={onKeep}
          onUndo={onUndo}
        />,
      );
    });

    expect(container.textContent).toContain("1 changed file");
    expect(container.textContent).toContain("+2");
    expect(container.textContent).toContain("−1");
    expect(container.textContent).not.toContain("sql/report.sql");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
        ?.click();
    });
    const fileButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "sql/report.sql",
    );
    expect(fileButton).toBeTruthy();

    await act(async () => fileButton?.click());
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "turn-1",
        proposal: expect.objectContaining({ callId: "write-1" }),
      }),
    );

    const keepAll = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Keep all"),
    );
    await act(async () => {
      keepAll?.click();
      await Promise.resolve();
    });
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});
