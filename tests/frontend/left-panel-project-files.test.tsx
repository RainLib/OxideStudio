/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeftPanel } from "@/components/workspace/LeftPanel";
import { ToolWindowPanel } from "@/components/workspace/ToolWindowPanel";

vi.mock("@/components/workspace/SchemaSidebar", () => ({
  SchemaSidebar: () => <div>database-content</div>,
}));

vi.mock("@/components/workspace/ProjectFilesSidebar", () => ({
  ProjectFilesSidebar: () => <div>files-content</div>,
}));

vi.mock("@/components/workspace/AssistantSidebar", () => ({
  AssistantSidebar: () => <div>assistant-content</div>,
}));

vi.mock("@/components/workspace/SideToolWindow", () => ({
  SideToolWindow: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

const props = {
  isDrawerOpen: true,
  sidebarWidth: 260,
  onDragStart: vi.fn(),
};

describe("independent project and assistant tool windows", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
  });

  it("keeps the database explorer focused on database objects", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(<LeftPanel {...props} />);
    });
    expect(container.textContent).toContain("database-content");
    expect(container.textContent).not.toContain("files-content");
    expect(container.querySelector('[role="tab"]')).toBeFalsy();
  });

  it("renders the workspace-selected content without an internal tab row", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(<ToolWindowPanel id="assistant" />);
    });

    expect(container.querySelector('[role="tablist"]')).toBeFalsy();
    expect(
      container
        .querySelector("[data-tool-window-content='assistant']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-tool-window-content='projectFiles']"),
    ).toBeNull();

    await act(async () => {
      root?.render(<ToolWindowPanel id="projectFiles" />);
    });
    expect(
      container
        .querySelector("[data-tool-window-content='projectFiles']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-tool-window-content='assistant']"),
    ).toBeNull();
  });
});
