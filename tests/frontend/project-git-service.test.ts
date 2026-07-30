import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectGitService } from "@/services/tauri/project-git.service";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

describe("project Git service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("binds repository mutations to the expected project root", async () => {
    mocks.invoke.mockResolvedValue({ message: "ok" });

    await projectGitService.stage(
      "project-1",
      ["sql\\a.sql", "sql/a.sql"],
      "/workspace",
    );
    await projectGitService.createBranch(
      "project-1",
      "feature/report",
      true,
      "/workspace",
    );
    await projectGitService.push("project-1", true, "/workspace");

    expect(mocks.invoke.mock.calls).toEqual([
      [
        "stage_project_git_paths",
        {
          projectId: "project-1",
          expectedRoot: "/workspace",
          paths: ["sql/a.sql"],
        },
      ],
      [
        "create_project_git_branch",
        {
          projectId: "project-1",
          expectedRoot: "/workspace",
          branch: "feature/report",
          checkout: true,
        },
      ],
      [
        "push_project_git_repository",
        {
          projectId: "project-1",
          expectedRoot: "/workspace",
          setUpstream: true,
        },
      ],
    ]);
  });

  it("does not put GitHub authentication tokens into other command fields", async () => {
    mocks.invoke.mockResolvedValue({
      installed: true,
      authenticated: true,
      account: "oxide",
    });

    await projectGitService.authenticateGitHub("secret-token");

    expect(mocks.invoke).toHaveBeenCalledWith("authenticate_github_cli", {
      token: "secret-token",
    });
  });

  it("maps GitHub search and clone arguments without shell command strings", async () => {
    mocks.invoke.mockResolvedValue([]);
    await projectGitService.searchGitHub("owner database");
    await projectGitService.clone({
      source: "owner/repository",
      destination: "/workspace/repository",
      github: true,
      shallowDepth: 1,
    });

    expect(mocks.invoke.mock.calls).toEqual([
      ["search_github_repositories", { query: "owner database" }],
      [
        "clone_git_repository",
        {
          source: "owner/repository",
          destination: "/workspace/repository",
          github: true,
          shallowDepth: 1,
        },
      ],
    ]);
  });

  it("loads commit file details through a bounded project command", async () => {
    mocks.invoke.mockResolvedValue({
      revision: "a".repeat(40),
      files: [],
      truncated: false,
    });

    await projectGitService.getCommitFiles(
      "project-1",
      "a".repeat(40),
      "/workspace",
    );

    expect(mocks.invoke).toHaveBeenCalledWith("get_project_git_commit_files", {
      projectId: "project-1",
      expectedRoot: "/workspace",
      revision: "a".repeat(40),
    });
  });
});
