/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assistantFileChangeAttributions,
  attributionPathsForFilter,
} from "@/lib/assistantFileChanges";
import { createAssistantTurn } from "@/ai/assistant/turns";
import { unifiedDiffLines } from "@/lib/unifiedDiff";

const mocks = vi.hoisted(() => ({
  getGitChanges: vi.fn(),
  getGitFileDiff: vi.fn(),
  openProjectFileInEditor: vi.fn(),
  requestEditorRangeReveal: vi.fn(),
}));

vi.mock("@/services/tauri/project-files.service", () => ({
  projectFilesService: {
    getGitChanges: mocks.getGitChanges,
    getGitFileDiff: mocks.getGitFileDiff,
  },
}));

vi.mock("@/lib/projectFileOpen", () => ({
  openProjectFileInEditor: mocks.openProjectFileInEditor,
}));

vi.mock("@/lib/editorNavigation", () => ({
  requestEditorRangeReveal: mocks.requestEditorRangeReveal,
}));

import { AssistantChangesPanel } from "@/components/workspace/assistant/AssistantChangesPanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("assistant Git changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps unified diff hunks to stable old and new line numbers", () => {
    const lines = unifiedDiffLines(
      "diff --git a/a.sql b/a.sql\n@@ -10,3 +10,4 @@\n same\n-old\n+new\n+extra\n tail",
    );

    expect(lines.find((line) => line.content === "-old")).toEqual(
      expect.objectContaining({ kind: "remove", oldLine: 11, newLine: null }),
    );
    expect(lines.find((line) => line.content === "+new")).toEqual(
      expect.objectContaining({
        kind: "add",
        oldLine: null,
        newLine: 11,
        hunkIndex: 0,
      }),
    );
    expect(lines.find((line) => line.content === " tail")).toEqual(
      expect.objectContaining({ kind: "context", oldLine: 12, newLine: 13 }),
    );
  });

  it("filters current Git files by trusted Agent turn attribution", () => {
    const first = {
      ...createAssistantTurn({
        id: "turn-1",
        requestId: "request-1",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Update report",
      }),
      fileChanges: [
        {
          callId: "call-1",
          relativePath: "queries/report.sql",
          operation: "updated" as const,
          revision: "a".repeat(64),
          occurredAt: 100,
        },
      ],
    };
    const second = {
      ...createAssistantTurn({
        id: "turn-2",
        requestId: "request-2",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Create migration",
      }),
      fileChanges: [
        {
          callId: "call-2",
          relativePath: "migrations/001.sql",
          operation: "created" as const,
          revision: "b".repeat(64),
          occurredAt: 200,
        },
      ],
    };
    const attributions = assistantFileChangeAttributions([first, second]);

    expect(attributionPathsForFilter(attributions, "agent")).toEqual(
      new Set(["queries/report.sql", "migrations/001.sql"]),
    );
    expect(attributionPathsForFilter(attributions, "turn:turn-2")).toEqual(
      new Set(["migrations/001.sql"]),
    );
    expect(attributionPathsForFilter(attributions, "all")).toBeNull();
  });

  it("offers all-Agent and per-turn filters in the Changes panel", async () => {
    mocks.openProjectFileInEditor.mockResolvedValue("file-tab-1");
    mocks.getGitChanges.mockResolvedValue({
      isRepository: true,
      branch: "feature/report",
      head: "abc1234",
      truncated: false,
      files: [
        gitChange("queries/report.sql"),
        { ...gitChange("migrations/001.sql"), staged: true },
        gitChange("notes/user.txt"),
      ],
    });
    mocks.getGitFileDiff.mockImplementation(async (_projectId, path, _root, scope) => ({
      relativePath: path,
      patch: `@@ -1 +1 @@\n-old\n+new`,
      additions: 1,
      deletions: 1,
      binary: false,
      truncated: false,
      currentSideRevision:
        scope === "staged" ? "c".repeat(64) : "a".repeat(64),
      currentSideRevisionStatus: "available",
    }));
    const turns = [
      attributedTurn("turn-1", "Update report", "queries/report.sql", 100),
      attributedTurn("turn-2", "Create migration", "migrations/001.sql", 200),
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AssistantChangesPanel
          projectId="project-1"
          expectedRoot="/tmp/project-1"
          refreshKey="1"
          turns={turns}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="assistant-project-changes"]',
        )
        ?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    const filter = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Change attribution filter"]',
    );
    expect(filter).not.toBeNull();
    expect(filter?.options).toHaveLength(4);
    await act(async () => {
      if (!filter) return;
      filter.value = "turn:turn-2";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("migrations/001.sql");
    expect(container.textContent).not.toContain("queries/report.sql");
    expect(container.textContent).not.toContain("notes/user.txt");

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });
    expect(container.textContent).toContain("AI match");
    expect(container.textContent).toContain("AI 1");
    expect(container.textContent).toContain(
      "Marked = verified Agent additions",
    );
    expect(
      container.querySelectorAll('[data-agent-attributed-line="true"]'),
    ).toHaveLength(1);
    const stagedScope = container.querySelector<HTMLButtonElement>(
      'button[title="Changes in the Git index"]',
    );
    expect(stagedScope?.disabled).toBe(false);
    await act(async () => {
      stagedScope?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });
    expect(mocks.getGitFileDiff).toHaveBeenLastCalledWith(
      "project-1",
      "migrations/001.sql",
      "/tmp/project-1",
      "staged",
    );
    expect(stagedScope?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("AI differs");

    const openChangedLine = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open line 1 in migrations/001.sql"]',
    );
    expect(openChangedLine).not.toBeNull();
    await act(async () => {
      openChangedLine?.click();
      await Promise.resolve();
      await new Promise((resolve) =>
        window.requestAnimationFrame(() => resolve(undefined)),
      );
    });
    expect(mocks.openProjectFileInEditor).toHaveBeenCalledWith(
      "migrations/001.sql",
    );
    expect(mocks.requestEditorRangeReveal).toHaveBeenCalledWith({
      tabId: "file-tab-1",
      range: {
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
      },
      focus: true,
    });

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not map deleted-file diff lines to the current editor", async () => {
    mocks.getGitChanges.mockResolvedValue({
      isRepository: true,
      branch: "feature/cleanup",
      head: "abc1234",
      truncated: false,
      files: [{ ...gitChange("queries/old.sql"), status: "deleted" }],
    });
    mocks.getGitFileDiff.mockResolvedValue({
      relativePath: "queries/old.sql",
      patch: "@@ -1 +0,0 @@\n-SELECT 1",
      additions: 0,
      deletions: 1,
      binary: false,
      truncated: false,
      currentSideRevision: null,
      currentSideRevisionStatus: "missing",
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AssistantChangesPanel
          projectId="project-1"
          expectedRoot="/tmp/project-1"
          refreshKey="1"
          turns={[
            attributedTurn(
              "turn-delete",
              "Remove old query",
              "queries/old.sql",
              300,
            ),
          ]}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="assistant-project-changes"]',
        )
        ?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });

    expect(
      container.querySelector('button[aria-label^="Open line"]'),
    ).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[title="Open file in editor"]',
      )?.disabled,
    ).toBe(true);
    expect(container.textContent).toContain("AI missing");

    await act(async () => root.unmount());
    container.remove();
  });
});

function attributedTurn(
  id: string,
  message: string,
  relativePath: string,
  occurredAt: number,
) {
  return {
    ...createAssistantTurn({
      id,
      requestId: `request-${id}`,
      projectId: "project-1",
      requestedMode: "agent" as const,
      mode: "agent" as const,
      userMessage: message,
    }),
    fileChanges: [
      {
        callId: `call-${id}`,
        relativePath,
        operation: "updated" as const,
        revision: "a".repeat(64),
        previousRevision: "d".repeat(64),
        introducedLines: [1],
        lineEvidenceTruncated: false,
        occurredAt,
      },
    ],
  };
}

function gitChange(relativePath: string) {
  return {
    relativePath,
    previousPath: null,
    status: "modified",
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
  };
}
