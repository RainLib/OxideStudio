import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProjectFileRevisionConflictError,
  normalizeProjectRelativePath,
  projectFilesService,
  supportsProjectFilePreview,
} from "@/services/tauri/project-files.service";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

describe("project files service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps every project-files command to the camelCase IPC contract", async () => {
    mocks.invoke
      .mockResolvedValueOnce({
        id: "project-1",
        name: "Project",
        root_path: "C:\\workspace",
        created_at: 1,
        updated_at: 2,
      })
      .mockResolvedValueOnce([
        {
          relativePath: "queries\\daily.sql",
          name: "daily.sql",
          kind: "file",
          size: 10,
          modifiedAt: 20,
          isSymlink: false,
        },
      ])
      .mockResolvedValueOnce({
        relativePath: "queries\\daily.sql",
        content: "select 1",
        revision: "revision-1",
      })
      .mockResolvedValueOnce({
        relativePath: "images\\diagram.png",
        mediaType: "image/png",
        dataBase64: "iVBORw==",
        revision: "revision-image",
        size: 4,
      })
      .mockResolvedValueOnce({
        relativePath: "queries\\new.sql",
        revision: "revision-2",
      })
      .mockResolvedValueOnce({
        relativePath: "archive",
        name: "archive",
        kind: "directory",
        size: 0,
        modifiedAt: null,
        isSymlink: false,
      })
      .mockResolvedValueOnce({
        relativePath: "queries\\daily.sql",
        revision: "revision-3",
      })
      .mockResolvedValueOnce({
        relativePath: "archive\\daily.sql",
        name: "daily.sql",
        kind: "file",
        size: 12,
        modifiedAt: 30,
        isSymlink: false,
      })
      .mockResolvedValueOnce(undefined);

    await projectFilesService.setProjectRoot("project-1", "C:\\workspace");
    const entries = await projectFilesService.listProjectEntries(
      "project-1",
      "queries\\."
    );
    const read = await projectFilesService.readProjectFile(
      "project-1",
      "queries\\daily.sql"
    );
    const preview = await projectFilesService.readProjectFilePreview(
      "project-1",
      "images\\diagram.png",
      "C:\\workspace"
    );
    await projectFilesService.createProjectFile(
      "project-1",
      "queries\\new.sql",
      "select 2"
    );
    await projectFilesService.createProjectDirectory("project-1", "archive");
    await projectFilesService.writeProjectFile(
      "project-1",
      "queries/daily.sql",
      "select 3",
      "revision-1",
      "C:\\workspace"
    );
    await projectFilesService.renameProjectEntry(
      "project-1",
      "queries/daily.sql",
      "archive/daily.sql"
    );
    await projectFilesService.deleteProjectEntry(
      "project-1",
      "archive",
      true
    );

    expect(entries[0]?.relativePath).toBe("queries/daily.sql");
    expect(read.relativePath).toBe("queries/daily.sql");
    expect(preview.relativePath).toBe("images/diagram.png");
    expect(mocks.invoke.mock.calls).toEqual([
      [
        "set_project_root",
        { projectId: "project-1", rootPath: "C:\\workspace" },
      ],
      [
        "list_project_entries",
        { projectId: "project-1", relativePath: "queries" },
      ],
      [
        "read_project_file",
        { projectId: "project-1", relativePath: "queries/daily.sql" },
      ],
      [
        "read_project_file_preview",
        {
          projectId: "project-1",
          relativePath: "images/diagram.png",
          expectedRoot: "C:\\workspace",
        },
      ],
      [
        "create_project_file",
        {
          projectId: "project-1",
          relativePath: "queries/new.sql",
          content: "select 2",
        },
      ],
      [
        "create_project_directory",
        { projectId: "project-1", relativePath: "archive" },
      ],
      [
        "write_project_file",
        {
          projectId: "project-1",
          relativePath: "queries/daily.sql",
          content: "select 3",
          expectedRevision: "revision-1",
          expectedRoot: "C:\\workspace",
        },
      ],
      [
        "rename_project_entry",
        {
          projectId: "project-1",
          relativePath: "queries/daily.sql",
          newRelativePath: "archive/daily.sql",
        },
      ],
      [
        "delete_project_entry",
        {
          projectId: "project-1",
          relativePath: "archive",
          recursive: true,
        },
      ],
    ]);
  });

  it("uses null for the root listing and rejects paths outside the project", async () => {
    mocks.invoke.mockResolvedValueOnce([]);

    await projectFilesService.listProjectEntries("project-1");

    expect(mocks.invoke).toHaveBeenCalledWith("list_project_entries", {
      projectId: "project-1",
      relativePath: null,
    });
    expect(() => normalizeProjectRelativePath("../outside.sql")).toThrow(
      "cannot leave the project root"
    );
    expect(() => normalizeProjectRelativePath("C:\\outside.sql")).toThrow(
      "must be relative"
    );
    expect(() => normalizeProjectRelativePath("/outside.sql")).toThrow(
      "must be relative"
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("recognizes image formats handled by the editor preview", () => {
    expect(supportsProjectFilePreview("images/diagram.PNG")).toBe(true);
    expect(supportsProjectFilePreview("icons/logo.svg")).toBe(true);
    expect(supportsProjectFilePreview("data/archive.bin")).toBe(false);
    expect(supportsProjectFilePreview("notes/image.png.txt")).toBe(false);
  });

  it("requests bounded project completion context explicitly", async () => {
    mocks.invoke.mockResolvedValueOnce([
      { relativePath: "queries/users.sql", content: "select * from users" },
    ]);
    const result = await projectFilesService.getCompletionContext({
      projectId: "project-1",
      expectedRoot: "C:\\workspace",
      activeFile: "queries/current.sql",
      query: "select users.email",
      referencedObjects: ["users"],
    });
    expect(result).toHaveLength(1);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "get_project_completion_context",
      {
        request: {
          projectId: "project-1",
          expectedRoot: "C:\\workspace",
          activeFile: "queries/current.sql",
          query: "select users.email",
          referencedObjects: ["users"],
        },
      }
    );
  });

  it("turns revision conflict rejections into a typed error", async () => {
    mocks.invoke.mockRejectedValueOnce(
      "REVISION_CONFLICT: the file changed on disk"
    );

    const write = projectFilesService.writeProjectFile(
        "project-1",
        "query.sql",
        "select 2",
        "revision-1"
      );

    await expect(write).rejects.toBeInstanceOf(
      ProjectFileRevisionConflictError
    );
    await expect(write).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      relativePath: "query.sql",
    });
  });
});
