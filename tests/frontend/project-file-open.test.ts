/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openProjectFileInEditor } from "@/lib/projectFileOpen";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useTabStore } from "@/store/useTabStore";

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
});
