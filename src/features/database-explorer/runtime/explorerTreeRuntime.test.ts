import { describe, expect, it, vi } from "vitest";
import type { ExplorerTreeNode } from "../model/explorerTreeNode";
import { createExplorerTreeRuntime } from "./explorerTreeRuntime";

describe("explorer tree runtime", () => {
  const node: ExplorerTreeNode = {
    id: "schema:public",
    kind: "schema",
    label: "public",
  };

  it("shares one host across rows and forwards interaction phases", () => {
    const runtime = createExplorerTreeRuntime();
    const host = {
      buildContextMenu: vi.fn(() => []),
      handleRowClick: vi.fn(),
      handleRowDoubleClick: vi.fn(),
      handleRowKeydown: vi.fn(),
      toggleNode: vi.fn(),
    };
    runtime.bindHost(host);
    const click = { detail: 1 } as MouseEvent;
    const doubleClick = { detail: 2 } as MouseEvent;
    const keydown = { key: "Enter" } as KeyboardEvent;

    runtime.handleRowClick(node, click);
    runtime.handleRowDoubleClick(node, doubleClick);
    runtime.handleRowKeydown(node, keydown);
    runtime.toggleNode(node, true);
    runtime.buildContextMenu(node);

    expect(host.handleRowClick).toHaveBeenCalledWith(node, click);
    expect(host.handleRowDoubleClick).toHaveBeenCalledWith(node, doubleClick);
    expect(host.handleRowKeydown).toHaveBeenCalledWith(node, keydown);
    expect(host.toggleNode).toHaveBeenCalledWith(node, true);
    expect(runtime.diagnostics).toEqual({ hostBindings: 1, menuBuilds: 1 });
  });

  it("invalidates superseded and disposed async actions", () => {
    const runtime = createExplorerTreeRuntime();
    const first = runtime.beginAction();
    const second = runtime.beginAction();
    expect(runtime.isCurrent(first)).toBe(false);
    expect(runtime.isCurrent(second)).toBe(true);
    runtime.dispose();
    expect(runtime.isCurrent(second)).toBe(false);
  });
});
