/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "@/store/useProjectStore";
import { ProjectSwitcher } from "./ProjectSwitcher";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  githubStatus: vi.fn(),
  clone: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@/services/tauri/project-git.service", () => ({
  projectGitService: { getGitHubStatus: mocks.githubStatus, clone: mocks.clone },
}));
const initial = useProjectStore.getState();
const project = {
  id: "demo",
  name: "Demo",
  root_path: "/projects/demo",
  created_at: 0,
  updated_at: 0,
};

describe("Project switcher composition", () => {
  let container: HTMLDivElement;
  let root: Root;
  const createProject = vi.fn();
  const deleteProject = vi.fn();
  beforeEach(async () => {
    vi.resetAllMocks();
    useProjectStore.setState(
      {
        ...initial,
        projects: [project],
        activeProjectId: project.id,
        activeProjectName: project.name,
        createProject,
        deleteProject,
      },
      true,
    );
    mocks.open.mockResolvedValue("/projects/next");
    createProject.mockResolvedValue({ ...project, id: "next", name: "next" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<ProjectSwitcher />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useProjectStore.setState(initial, true);
  });
  async function click(button: HTMLButtonElement | null | undefined) {
    expect(button).toBeTruthy();
    await act(async () => button!.click());
  }
  function button(text: string) {
    return [...document.querySelectorAll("button")].find(
      (node) => node.textContent?.trim() === text,
    );
  }
  async function openCreate() {
    await click(container.querySelector<HTMLButtonElement>('button[title="Project"]'));
    await click(button("New Project"));
  }

  it("creates a folder-linked project using the selected directory name", async () => {
    await openCreate();
    await click(button("Browse…"));
    expect(document.body.textContent).toContain("/projects/next");
    const form = document.querySelector("form");
    expect(form).toBeTruthy();
    await act(async () =>
      form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(createProject).toHaveBeenCalledExactlyOnceWith(
      "next",
      "/projects/next",
    );
    expect(mocks.clone).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps the delete dialog and failure visible when the project cannot be removed", async () => {
    deleteProject.mockRejectedValue(new Error("Project has pending changes"));
    await click(container.querySelector<HTMLButtonElement>('button[title="Project"]'));
    await click(
      document.querySelector<HTMLButtonElement>('button[aria-label="Delete project Demo"]'),
    );
    await click(button("Delete Project"));
    expect(deleteProject).toHaveBeenCalledExactlyOnceWith("demo");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Project has pending changes",
    );
  });

  it("checks GitHub availability only after the GitHub source is selected", async () => {
    mocks.githubStatus.mockResolvedValue({
      installed: true,
      authenticated: false,
    });
    await openCreate();
    expect(mocks.githubStatus).not.toHaveBeenCalled();
    await click(button("GitHub"));
    expect(mocks.githubStatus).toHaveBeenCalledOnce();
    expect(createProject).not.toHaveBeenCalled();
  });
});
