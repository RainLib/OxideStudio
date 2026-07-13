/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { useTabStore } from "@/store/useTabStore";

const mocks = vi.hoisted(() => ({
  onCloseRequested: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: mocks.onCloseRequested,
  }),
}));

function GuardHarness() {
  useUnsavedChangesGuard();
  return null;
}

describe("desktop unsaved changes guard", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  let closeHandler: ((event: { preventDefault: () => void }) => void) | null;

  beforeEach(() => {
    closeHandler = null;
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    mocks.onCloseRequested.mockImplementation(
      async (handler: (event: { preventDefault: () => void }) => void) => {
      closeHandler = handler;
      return vi.fn();
      }
    );
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
    vi.unstubAllGlobals();
  });

  it("prevents a window close when discarding a dirty file is declined", async () => {
    const tabId = useTabStore
      .getState()
      .openProjectFileTab("project-1", "query.sql", "SELECT 1;", "revision-1");
    useTabStore.getState().updateTabSql(tabId, "SELECT 2;");
    vi.stubGlobal("confirm", vi.fn(() => false));

    await act(async () => {
      root = createRoot(container);
      root.render(<GuardHarness />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const preventDefault = vi.fn();
    closeHandler?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
