import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectFileEntry } from "@/services/tauri/project-files.service";
import { useProjectStore } from "@/store/useProjectStore";

const mocks = vi.hoisted(() => ({
  setProjectRoot: vi.fn(),
  listProjectEntries: vi.fn(),
  readProjectFile: vi.fn(),
  createProjectFile: vi.fn(),
  createProjectDirectory: vi.fn(),
  writeProjectFile: vi.fn(),
  renameProjectEntry: vi.fn(),
  deleteProjectEntry: vi.fn(),
}));

vi.mock("@/services/tauri/project-files.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/tauri/project-files.service")
    >();
  return {
    ...actual,
    projectFilesService: mocks,
  };
});

import { ProjectFileRevisionConflictError } from "@/services/tauri/project-files.service";
import {
  selectProjectFileTree,
  useProjectFilesStore,
} from "@/store/useProjectFilesStore";

function entry(
  relativePath: string,
  kind: ProjectFileEntry["kind"],
): ProjectFileEntry {
  return {
    relativePath,
    name: relativePath.split("/").at(-1) || relativePath,
    kind,
    size: kind === "file" ? 10 : 0,
    modifiedAt: 1,
    isSymlink: false,
  };
}

function activateProject(
  id = "project-1",
  rootPath: string | null = "C:\\work",
) {
  useProjectStore.setState(
    {
      ...useProjectStore.getInitialState(),
      projects: [
        {
          id,
          name: "Project",
          root_path: rootPath,
          created_at: 1,
          updated_at: 1,
        },
      ],
      activeProjectId: id,
      activeProjectName: "Project",
      isLoading: false,
    },
    true,
  );
  useProjectFilesStore.getState().reset();
}

describe("project files store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activateProject();
  });

  it("loads the root and lazily expands a directory from the active project", async () => {
    let resolveRoot: ((entries: ProjectFileEntry[]) => void) | undefined;
    mocks.listProjectEntries
      .mockImplementationOnce(
        () =>
          new Promise<ProjectFileEntry[]>((resolve) => {
            resolveRoot = resolve;
          }),
      )
      .mockResolvedValueOnce([entry("queries/daily.sql", "file")]);

    const load = useProjectFilesStore.getState().loadTree();
    expect(useProjectFilesStore.getState()).toMatchObject({
      projectId: "project-1",
      rootPath: "C:\\work",
      isLoading: true,
      loadingDirectories: [""],
    });

    resolveRoot?.([entry("readme.sql", "file"), entry("queries", "directory")]);
    await load;
    await useProjectFilesStore.getState().expandDirectory("queries");

    const tree = selectProjectFileTree(useProjectFilesStore.getState());
    expect(mocks.listProjectEntries.mock.calls).toEqual([
      ["project-1", "", "C:\\work"],
      ["project-1", "queries", "C:\\work"],
    ]);
    expect(tree.map((node) => node.relativePath)).toEqual([
      "queries",
      "readme.sql",
    ]);
    expect(tree[0]).toMatchObject({
      isExpanded: true,
      isLoaded: true,
      children: [{ relativePath: "queries/daily.sql" }],
    });
    expect(useProjectFilesStore.getState().isLoading).toBe(false);
  });

  it("stores load failures and clears loading state", async () => {
    mocks.listProjectEntries.mockRejectedValueOnce(
      new Error("permission denied"),
    );

    await useProjectFilesStore.getState().loadTree();

    expect(useProjectFilesStore.getState()).toMatchObject({
      isLoading: false,
      loadingDirectories: [],
      error: "permission denied",
    });
  });

  it("reads and writes using the cached revision", async () => {
    mocks.readProjectFile.mockResolvedValueOnce({
      relativePath: "queries/daily.sql",
      content: "select 1",
      revision: "revision-1",
    });
    mocks.writeProjectFile.mockResolvedValueOnce({
      relativePath: "queries/daily.sql",
      revision: "revision-2",
    });

    await useProjectFilesStore.getState().readFile("queries\\daily.sql");
    const document = await useProjectFilesStore
      .getState()
      .writeFile("queries/daily.sql", "select 2");

    expect(mocks.writeProjectFile).toHaveBeenCalledWith(
      "project-1",
      "queries/daily.sql",
      "select 2",
      "revision-1",
      "C:\\work",
    );
    expect(document).toEqual({
      relativePath: "queries/daily.sql",
      content: "select 2",
      revision: "revision-2",
    });
    expect(
      useProjectFilesStore.getState().documents["queries/daily.sql"],
    ).toEqual(document);
  });

  it("preserves the cached document and exposes revision conflict details", async () => {
    useProjectFilesStore.setState({
      documents: {
        "query.sql": {
          relativePath: "query.sql",
          content: "select 1",
          revision: "revision-1",
        },
      },
    });
    mocks.writeProjectFile.mockRejectedValueOnce(
      new ProjectFileRevisionConflictError(
        "query.sql",
        "the file changed on disk",
      ),
    );

    await expect(
      useProjectFilesStore.getState().writeFile("query.sql", "select 2"),
    ).rejects.toBeInstanceOf(ProjectFileRevisionConflictError);

    expect(useProjectFilesStore.getState()).toMatchObject({
      documents: {
        "query.sql": {
          content: "select 1",
          revision: "revision-1",
        },
      },
      revisionConflict: {
        relativePath: "query.sql",
        expectedRevision: "revision-1",
        attemptedContent: "select 2",
        message: "the file changed on disk",
      },
      isLoading: false,
    });
  });

  it("updates cached paths after rename and removes descendants on delete", async () => {
    useProjectFilesStore.setState({
      entriesByDirectory: {
        "": [entry("queries", "directory")],
        queries: [entry("queries/daily.sql", "file")],
      },
      expandedDirectories: ["queries"],
      documents: {
        "queries/daily.sql": {
          relativePath: "queries/daily.sql",
          content: "select 1",
          revision: "revision-1",
        },
      },
    });
    mocks.renameProjectEntry.mockResolvedValueOnce(
      entry("archive", "directory"),
    );
    mocks.deleteProjectEntry.mockResolvedValueOnce(undefined);

    await useProjectFilesStore.getState().renameEntry("queries", "archive");

    expect(
      selectProjectFileTree(useProjectFilesStore.getState())[0],
    ).toMatchObject({
      relativePath: "archive",
      children: [{ relativePath: "archive/daily.sql" }],
    });
    expect(
      useProjectFilesStore.getState().documents["archive/daily.sql"],
    ).toMatchObject({ relativePath: "archive/daily.sql" });

    await useProjectFilesStore.getState().deleteEntry("archive", true);
    expect(selectProjectFileTree(useProjectFilesStore.getState())).toEqual([]);
    expect(useProjectFilesStore.getState().documents).toEqual({});
    expect(mocks.deleteProjectEntry).toHaveBeenCalledWith(
      "project-1",
      "archive",
      true,
      "C:\\work",
    );
  });

  it("resets cached files when the active project changes", () => {
    useProjectFilesStore.setState({
      entriesByDirectory: { "": [entry("query.sql", "file")] },
    });

    activateProject("project-2", "D:\\other");

    expect(useProjectFilesStore.getState()).toMatchObject({
      projectId: "project-2",
      rootPath: "D:\\other",
      entriesByDirectory: {},
      documents: {},
    });
  });
});
