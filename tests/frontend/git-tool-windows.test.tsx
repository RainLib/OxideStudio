/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRepository: vi.fn(),
  getCommitFiles: vi.fn(),
  stage: vi.fn(),
  unstage: vi.fn(),
  commit: vi.fn(),
  fetch: vi.fn(),
  openProjectGitDiffInEditor: vi.fn(),
}));

vi.mock("@/services/tauri/project-git.service", () => ({
  projectGitService: {
    getRepository: mocks.getRepository,
    getCommitFiles: mocks.getCommitFiles,
    stage: mocks.stage,
    unstage: mocks.unstage,
    commit: mocks.commit,
    fetch: mocks.fetch,
    pull: vi.fn(),
    push: vi.fn(),
    createBranch: vi.fn(),
    checkoutBranch: vi.fn(),
    setRemote: vi.fn(),
    getPatch: vi.fn(),
    applyPatch: vi.fn(),
    initialize: vi.fn(),
  },
}));

vi.mock("@/lib/projectFileOpen", () => ({
  openProjectGitDiffInEditor: mocks.openProjectGitDiffInEditor,
}));

import { CommitPanel } from "@/components/workspace/git/CommitPanel";
import { VersionControlPanel } from "@/components/workspace/git/VersionControlPanel";
import { useProjectGitStore } from "@/store/useProjectGitStore";
import { useProjectStore } from "@/store/useProjectStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const repository = {
  isRepository: true,
  branch: "feature/lsp",
  head: "abc1234",
  upstream: "origin/feature/lsp",
  ahead: 2,
  behind: 1,
  files: [
    {
      relativePath: "sql/report.sql",
      status: "modified" as const,
      staged: false,
      unstaged: true,
      untracked: false,
      conflicted: false,
      additions: 4,
      deletions: 2,
    },
    {
      relativePath: "sql/staged.sql",
      status: "added" as const,
      staged: true,
      unstaged: false,
      untracked: false,
      conflicted: false,
      additions: 3,
      deletions: 1,
    },
  ],
  branches: [
    {
      name: "feature/lsp",
      current: true,
      remote: false,
      upstream: "origin/feature/lsp",
    },
  ],
  remotes: [
    {
      name: "origin",
      fetchUrl: "git@github.com:oxide/reports.git",
      pushUrl: "git@github.com:oxide/reports.git",
    },
  ],
  commits: [
    {
      hash: "a".repeat(40),
      shortHash: "abc1234",
      authorName: "Oxide",
      authorEmail: "oxide@example.test",
      timestamp: 1_720_000_000,
      message: "feat: improve SQL completion",
    },
  ],
  truncated: false,
};

describe("independent Git tool windows", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useProjectStore.setState({
      activeProjectId: "project-1",
      projects: [
        {
          id: "project-1",
          name: "Reports",
          root_path: "/workspace",
          origin: "local",
          created_at: 1,
          updated_at: 1,
        },
      ],
    });
    useProjectGitStore.setState({ sessions: {} });
    mocks.getRepository.mockResolvedValue(repository);
    mocks.getCommitFiles.mockResolvedValue({
      revision: "a".repeat(40),
      files: [
        { relativePath: "src/completion.ts", additions: 12, deletions: 3 },
      ],
      truncated: false,
    });
    mocks.stage.mockResolvedValue({ message: "Selected paths staged." });
    mocks.unstage.mockResolvedValue({ message: "Selected paths unstaged." });
    mocks.commit.mockResolvedValue({ message: "Changes committed." });
    mocks.fetch.mockResolvedValue({ message: "Repository fetched." });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("groups changes, shows line counts, stages selections, and opens the diff editor", async () => {
    await act(async () => {
      root.render(<CommitPanel />);
      await flush();
    });

    expect(container.textContent).toContain("Staged changes");
    expect(container.textContent).toContain("Changes");
    expect(container.textContent).toContain("sql/report.sql");
    expect(container.textContent).toContain("+4");
    expect(container.textContent).toContain("-2");
    expect(container.textContent).toContain("1 staged");

    const commitButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Commit",
    ) as HTMLButtonElement;
    expect(commitButton.disabled).toBe(true);
    const message = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Commit message"]',
    );
    const textareaSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      if (message) {
        textareaSetter?.call(message, "feat: update report");
        message.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(commitButton.disabled).toBe(false);

    const file = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "sql/report.sql",
    );
    await act(async () => file?.click());
    expect(mocks.openProjectGitDiffInEditor).toHaveBeenCalledWith(
      "project-1",
      "sql/report.sql",
      "/workspace",
      "working",
    );

    const checkbox = container.querySelector<HTMLButtonElement>(
      '[aria-label="Select sql/report.sql"]',
    );
    await act(async () => checkbox?.click());
    const stage = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Stage selected",
    );
    await act(async () => {
      stage?.click();
      await flush();
    });
    expect(mocks.stage).toHaveBeenCalledWith(
      "project-1",
      ["sql/report.sql"],
      "/workspace",
    );
  });

  it("prevents commits while merge conflicts exist", async () => {
    mocks.getRepository.mockResolvedValue({
      ...repository,
      files: [
        {
          ...repository.files[1],
          relativePath: "sql/conflicted.sql",
          status: "conflicted",
          conflicted: true,
        },
      ],
    });
    await act(async () => {
      root.render(<CommitPanel />);
      await flush();
    });
    const message = container.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Commit message"]',
    );
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      if (message) {
        setter?.call(message, "resolve merge");
        message.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    expect(container.textContent).toContain("Conflicts");
    expect(container.textContent).toContain("Resolve conflicts before committing");
    const commit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Commit",
    ) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
  });

  it("shows repository tracking and separates log, branches, remotes, and patches", async () => {
    await act(async () => {
      root.render(<VersionControlPanel />);
      await flush();
    });

    expect(container.textContent).toContain("feature/lsp");
    expect(container.textContent).toContain("↑2");
    expect(container.textContent).toContain("↓1");
    expect(container.textContent).toContain("feat: improve SQL completion");
    for (const label of ["Log", "Branches", "Remotes", "Patches"]) {
      expect(container.textContent).toContain(label);
    }

    const commit = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("feat: improve SQL completion"),
    );
    await act(async () => {
      commit?.click();
      await flush();
    });
    expect(mocks.getCommitFiles).toHaveBeenCalledWith(
      "project-1",
      "a".repeat(40),
      "/workspace",
    );
    expect(container.textContent).toContain("src/completion.ts");
    expect(container.textContent).toContain("+12");
    expect(container.textContent).toContain("-3");

    const fetch = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Fetch",
    );
    await act(async () => {
      fetch?.click();
      await flush();
    });
    expect(mocks.fetch).toHaveBeenCalledWith("project-1", "/workspace");
  });
});

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
