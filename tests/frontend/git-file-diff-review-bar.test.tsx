import { confirmAction } from "@/lib/appDialogs";
/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGitFileDiff: vi.fn(),
  updateIndexPatch: vi.fn(),
  applyPatch: vi.fn(),
  refresh: vi.fn(),
  openProjectGitDiffInEditor: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  projectFilesService: { getGitFileDiff: mocks.getGitFileDiff },
  projectGitService: {
    updateIndexPatch: mocks.updateIndexPatch,
    applyPatch: mocks.applyPatch,
  },
}));

vi.mock("@/store/useProjectGitStore", () => ({
  useProjectGitStore: (selector: (state: { refresh: typeof mocks.refresh }) => unknown) =>
    selector({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/projectFileOpen", () => ({
  openProjectGitDiffInEditor: mocks.openProjectGitDiffInEditor,
}));

import { GitFileDiffReviewBar } from "@/components/workspace/GitFileDiffReviewBar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const patch =
  "diff --git a/sql/report.sql b/sql/report.sql\n--- a/sql/report.sql\n+++ b/sql/report.sql\n@@ -1 +1 @@\n-old\n+new\n@@ -10 +10 @@\n-before\n+after";

describe("Git diff editor review controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.getGitFileDiff.mockResolvedValue({
      relativePath: "sql/report.sql",
      patch,
      additions: 2,
      deletions: 2,
      binary: false,
      truncated: false,
      currentSideRevision: "a".repeat(64),
      currentSideRevisionStatus: "available",
    });
    mocks.updateIndexPatch.mockResolvedValue({ message: "Index updated." });
    mocks.applyPatch.mockResolvedValue({ message: "Patch applied." });
    mocks.refresh.mockResolvedValue(undefined);
    mocks.openProjectGitDiffInEditor.mockResolvedValue("git-diff-tab");
    vi.mocked(confirmAction).mockReset().mockResolvedValue(true);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("stages and rejects the active hunk without applying the whole file", async () => {
    await act(async () => {
      root.render(
        <GitFileDiffReviewBar
          preview={{
            projectId: "project-1",
            expectedRoot: "/workspace",
            relativePath: "sql/report.sql",
            scope: "working",
            originalContent: "old",
            modifiedContent: "new",
            additions: 2,
            deletions: 2,
            originalMissing: false,
            modifiedMissing: false,
          }}
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain("Hunk 1/2");
    await act(async () => {
      button(container, "Stage hunk").click();
      await flush();
    });
    expect(mocks.updateIndexPatch).toHaveBeenCalledWith(
      "project-1",
      expect.stringContaining("@@ -1 +1 @@"),
      false,
      "/workspace",
    );
    expect(mocks.updateIndexPatch.mock.calls[0]?.[1]).not.toContain(
      "@@ -10 +10 @@",
    );
    expect(mocks.refresh).toHaveBeenCalledWith("project-1", "/workspace");

    await act(async () => {
      button(container, "Discard hunk").click();
      await flush();
    });
    expect(confirmAction).toHaveBeenCalled();
    expect(mocks.applyPatch).toHaveBeenCalledWith(
      "project-1",
      expect.stringContaining("@@ -1 +1 @@"),
      true,
      "/workspace",
    );
  });

  it("unstages a hunk when the editor is showing the index", async () => {
    await act(async () => {
      root.render(
        <GitFileDiffReviewBar
          preview={{
            projectId: "project-1",
            expectedRoot: "/workspace",
            relativePath: "sql/report.sql",
            scope: "staged",
            originalContent: "old",
            modifiedContent: "new",
            additions: 2,
            deletions: 2,
            originalMissing: false,
            modifiedMissing: false,
          }}
        />,
      );
      await flush();
    });

    await act(async () => {
      button(container, "Unstage hunk").click();
      await flush();
    });
    expect(mocks.updateIndexPatch).toHaveBeenCalledWith(
      "project-1",
      expect.any(String),
      true,
      "/workspace",
    );
    expect(container.textContent).not.toContain("Discard hunk");
  });
});

function button(container: HTMLElement, label: string) {
  const element = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim().includes(label),
  );
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return element;
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

vi.mock("@/lib/appDialogs", () => ({ confirmAction: vi.fn(async () => true) }));
