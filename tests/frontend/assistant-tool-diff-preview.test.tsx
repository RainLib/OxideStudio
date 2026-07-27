/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantTurn, type AssistantTurn } from "@/ai/assistant/turns";

const mocks = vi.hoisted(() => ({
  getGitFileDiff: vi.fn(),
  readProjectFile: vi.fn(),
}));

vi.mock("@/services/tauri/project-files.service", () => ({
  projectFilesService: {
    getGitFileDiff: mocks.getGitFileDiff,
    readProjectFile: mocks.readProjectFile,
  },
}));

import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";
import { AssistantToolDiffPreview } from "@/components/workspace/assistant/AssistantToolDiffPreview";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Assistant write-tool diff preview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows only file names and opens pending writes in the main diff editor", async () => {
    const revision = "a".repeat(64);
    mocks.getGitFileDiff.mockResolvedValue({
      relativePath: "sql/report.sql",
      patch:
        "diff --git a/sql/report.sql b/sql/report.sql\n@@ -1,2 +1,2 @@\n-select 1;\n+select 2;\n keep",
      additions: 1,
      deletions: 1,
      binary: false,
      truncated: false,
      currentSideRevision: revision,
      currentSideRevisionStatus: "available",
    });
    const onOpenProjectFile = vi.fn(async () => "project-file-tab");
    const onOpenProjectFileProposal = vi.fn();
    const turn: AssistantTurn = {
      ...createAssistantTurn({
        id: "turn-write-diff",
        requestId: "request-write-diff",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Update the report query",
        now: 1,
      }),
      status: "completed",
      updatedAt: 21_001,
      process: [
        {
          id: "tool:call-read-1",
          sequence: 1,
          kind: "tool",
          title: "Read project file",
          toolName: "project.readFile",
          detail:
            'project.readFile · returned a bounded result\nOutput preview\n{\n  "relativePath": "sql/source.sql",\n  "content": "SELECT secret FROM credentials"\n}',
          status: "completed",
          startedAt: 2,
          finishedAt: 3,
        },
        {
          id: "tool:call-write-1",
          sequence: 2,
          kind: "tool",
          title: "Write project file",
          toolName: "project.writeFile",
          relativePath: "sql/report.sql",
          detail:
            `project.writeFile · returned a bounded result\nOutput preview\n{\n  \"revision\": \"${revision}\"\n}`,
          status: "completed",
          startedAt: 2,
          finishedAt: 3,
        },
      ],
      fileProposals: [
        {
          callId: "call-write-1",
          relativePath: "sql/report.sql",
          operation: "updated",
          proposedRevision: revision,
          baseRevision: "b".repeat(64),
          originalContent: "select 1;\n",
          proposedContent: "select 2;\n",
          additions: 1,
          deletions: 1,
          status: "pending",
          occurredAt: 3,
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
          onOpenProjectFile={onOpenProjectFile}
          onOpenProjectFileProposal={onOpenProjectFileProposal}
          expectedProjectRoot="/tmp/project-1"
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="assistant-process-details-turn-write-diff"]',
        )
        ?.click();
    });

    const readFileButton = container.querySelector<HTMLButtonElement>(
      'button[title="Open sql/source.sql"]',
    );
    const writeFileButton = container.querySelector<HTMLButtonElement>(
      'button[title="Review changes for sql/report.sql"]',
    );
    expect(readFileButton?.textContent).toBe("source.sql");
    expect(writeFileButton?.textContent).toBe("report.sql");
    expect(container.textContent).not.toContain("Read project file");
    expect(container.textContent).not.toContain("Write project file");
    expect(container.textContent).not.toContain("sql/source.sql");
    expect(container.textContent).not.toContain("SELECT secret");
    expect(container.textContent).not.toContain("returned a bounded result");
    expect(
      container.querySelector(
        '[data-assistant-process-item-toggle="tool:call-read-1"]',
      ),
    ).toBeNull();
    expect(container.querySelector("pre")).toBeNull();

    await act(async () => {
      readFileButton?.click();
      await Promise.resolve();
    });
    expect(onOpenProjectFile).toHaveBeenCalledWith("sql/source.sql");

    await act(async () => {
      writeFileButton?.click();
      await Promise.resolve();
    });
    expect(onOpenProjectFileProposal).toHaveBeenCalledWith(
      "turn-write-diff",
      "call-write-1",
    );
    expect(mocks.getGitFileDiff).not.toHaveBeenCalled();
  });

  it("does not attribute a later file version to the recorded Agent write", async () => {
    mocks.getGitFileDiff.mockResolvedValue({
      relativePath: "sql/report.sql",
      patch: "@@ -1 +1 @@\n-old\n+later edit",
      additions: 1,
      deletions: 1,
      binary: false,
      truncated: false,
      currentSideRevision: "b".repeat(64),
      currentSideRevisionStatus: "available",
    });

    await act(async () => {
      root.render(
        <AssistantToolDiffPreview
          projectId="project-1"
          change={{
            callId: "call-1",
            relativePath: "sql/report.sql",
            operation: "updated",
            revision: "a".repeat(64),
            occurredAt: 1,
          }}
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      "The file changed after this Agent write",
    );
    expect(container.textContent).not.toContain("later edit");
  });

  it("renders a created file as additions when the project has no Git diff", async () => {
    const revision = "c".repeat(64);
    mocks.getGitFileDiff.mockRejectedValue(new Error("Not a Git repository"));
    mocks.readProjectFile.mockResolvedValue({
      relativePath: "sql/new.sql",
      content: "select 1;\nselect 2;\n",
      revision,
    });

    await act(async () => {
      root.render(
        <AssistantToolDiffPreview
          projectId="project-1"
          expectedRoot="/tmp/project-1"
          change={{
            callId: "call-1",
            relativePath: "sql/new.sql",
            operation: "created",
            revision,
            occurredAt: 1,
          }}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.readProjectFile).toHaveBeenCalledWith(
      "project-1",
      "sql/new.sql",
      "/tmp/project-1",
    );
    expect(container.textContent).toContain("+2-0");
    expect(container.textContent).toContain("+select 1;");
    expect(
      container.querySelectorAll('[data-diff-line-kind="add"]'),
    ).toHaveLength(2);
  });
});
