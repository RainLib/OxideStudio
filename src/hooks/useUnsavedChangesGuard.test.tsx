// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), destroy: vi.fn(), unlisten: vi.fn(), listen: vi.fn(), tabs: [{ isDirty: true }] }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.listen, destroy: mocks.destroy }) }));
vi.mock("@/store/useTabStore", () => ({ confirmDiscardAllTabChanges: mocks.confirm, hasUnsavedTabChanges: (tab: { isDirty: boolean }) => tab.isDirty, useTabStore: { getState: () => ({ tabs: mocks.tabs }) } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Harness() { useUnsavedChangesGuard(); return null; }

describe("desktop close confirmation", () => {
  let root: Root;
  let close: (event: { preventDefault: () => void }) => Promise<void>;
  beforeEach(async () => {
    vi.clearAllMocks(); mocks.tabs = [{ isDirty: true }]; mocks.destroy.mockResolvedValue(undefined);
    mocks.listen.mockImplementation(async (handler) => { close = handler; return mocks.unlisten; });
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<Harness/>));
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce());
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });
  it("keeps a clean window on the normal native close path", async () => {
    mocks.tabs = [];
    const preventDefault = vi.fn(); await close({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("prevents closing synchronously, deduplicates requests and preserves Cancel", async () => {
    let decide!: (approved: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise((resolve) => { decide = resolve; }));
    const preventDefault = vi.fn(); const pending = close({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce(); expect(mocks.destroy).not.toHaveBeenCalled();
    await close({ preventDefault }); expect(mocks.confirm).toHaveBeenCalledOnce();
    decide(false); await pending; expect(mocks.destroy).not.toHaveBeenCalled();
  });
  it("destroys the window only after explicit approval", async () => {
    mocks.confirm.mockResolvedValue(true);
    await close({ preventDefault: vi.fn() }); expect(mocks.destroy).toHaveBeenCalledOnce();
  });
  it("does not act on an approval after its owner unmounts", async () => {
    let decide!: (approved: boolean) => void;
    mocks.confirm.mockImplementation(() => new Promise((resolve) => { decide = resolve; }));
    const pending = close({ preventDefault: vi.fn() });
    await act(async () => root.unmount());
    decide(true); await pending;
    expect(mocks.destroy).not.toHaveBeenCalled(); expect(mocks.unlisten).toHaveBeenCalledOnce();
    root = createRoot(document.createElement("div"));
  });
});
