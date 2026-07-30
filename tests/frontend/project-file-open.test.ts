/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  openProjectFileInEditor,
  openProjectGitDiffInEditor,
} from "@/lib/projectFileOpen";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useTabStore } from "@/store/useTabStore";
import { projectGitService } from "@/services/tauri/project-git.service";
import { projectFilesService } from "@/services/tauri/project-files.service";

describe("openProjectFileInEditor", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    useProjectFilesStore.setState({
      projectId: "project-1",
      rootPath: "/workspace/project",
      syncActiveProject: vi.fn(),
      readFile: vi.fn(async (relativePath: string) => ({
        relativePath,
        content: "select 1;",
        revision: "text-revision",
      })),
      readPreview: vi.fn(async (relativePath: string) => ({
        relativePath,
        mediaType: "image/png",
        dataBase64: "aW1hZ2U=",
        revision: "image-revision",
        size: 5,
      })),
    });
  });

  it("opens text files in an editable project tab", async () => {
    const tabId = await openProjectFileInEditor("queries/report.sql");

    expect(useProjectFilesStore.getState().readFile).toHaveBeenCalledWith(
      "queries/report.sql"
    );
    expect(useTabStore.getState().tabs).toContainEqual(
      expect.objectContaining({
        id: tabId,
        fileRelativePath: "queries/report.sql",
        sql: "select 1;",
        fileRevision: "text-revision",
      })
    );
  });

  it("opens image files in a read-only preview tab", async () => {
    const tabId = await openProjectFileInEditor("images/schema.png");

    expect(useProjectFilesStore.getState().readPreview).toHaveBeenCalledWith(
      "images/schema.png"
    );
    expect(useTabStore.getState().tabs).toContainEqual(
      expect.objectContaining({
        id: tabId,
        fileRelativePath: "images/schema.png",
        filePreview: expect.objectContaining({
          kind: "image",
          dataUrl: "data:image/png;base64,aW1hZ2U=",
        }),
        isDirty: false,
      })
    );
  });

  it("opens working tree changes in a dedicated Git diff editor tab", async () => {
    vi.spyOn(projectGitService, "getFileVersions").mockResolvedValue({
      relativePath: "queries/report.sql",
      scope: "working",
      originalContent: "select 1;",
      modifiedContent: "select 2;",
      originalMissing: false,
      modifiedMissing: false,
      binary: false,
    });
    vi.spyOn(projectFilesService, "getGitFileDiff").mockResolvedValue({
      relativePath: "queries/report.sql",
      patch: "@@ -1 +1 @@\n-select 1;\n+select 2;",
      additions: 1,
      deletions: 1,
      binary: false,
      truncated: false,
      currentSideRevision: null,
      currentSideRevisionStatus: "available",
    });

    const tabId = await openProjectGitDiffInEditor(
      "project-1",
      "queries/report.sql",
      "/workspace/project",
      "working",
    );

    expect(useTabStore.getState().tabs).toContainEqual(
      expect.objectContaining({
        id: tabId,
        title: "report.sql (Git Diff)",
        gitFileDiffPreview: expect.objectContaining({
          originalContent: "select 1;",
          modifiedContent: "select 2;",
          additions: 1,
          deletions: 1,
        }),
      }),
    );
  });
});
