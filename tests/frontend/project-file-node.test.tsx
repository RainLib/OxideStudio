/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectFileNode } from "@/features/projects/ui/ProjectFileNode";

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const directory = {
  relativePath: "queries",
  name: "queries",
  kind: "directory" as const,
  size: 0,
  modifiedAt: null,
  isSymlink: false,
  isExpanded: true,
  isLoaded: true,
  isLoading: false,
  children: [{
    relativePath: "queries/daily.sql",
    name: "daily.sql",
    kind: "file" as const,
    size: 12,
    modifiedAt: null,
    isSymlink: false,
    isExpanded: false,
    isLoaded: true,
    isLoading: false,
  }],
};

describe("ProjectFileNode", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
  });

  it("renders expanded children and forwards selection/open actions", async () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ProjectFileNode
          node={directory}
          depth={0}
          selectedPath={null}
          onSelect={onSelect}
          onOpen={onOpen}
          onRename={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });

    const child = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("daily.sql"),
    );
    expect(child).toBeDefined();
    await act(async () => child?.click());

    expect(onSelect).toHaveBeenCalledWith(directory.children[0]);
    expect(onOpen).toHaveBeenCalledWith(directory.children[0]);
  });

  it("forwards rename and delete to the root state-machine callbacks", async () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <ProjectFileNode
          node={directory}
          depth={0}
          selectedPath="queries"
          onSelect={vi.fn()}
          onOpen={vi.fn()}
          onRename={onRename}
          onDelete={onDelete}
        />,
      );
    });

    const actions = [...container.querySelectorAll("button")];
    const rename = actions.find((button) => button.textContent === "Rename");
    const remove = actions.find((button) => button.textContent?.includes("Delete"));
    await act(async () => rename?.click());
    await act(async () => remove?.click());

    expect(onRename).toHaveBeenCalledWith(directory);
    expect(onDelete).toHaveBeenCalledWith(directory);
  });
});
