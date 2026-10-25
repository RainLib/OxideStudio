import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmAction } from "@/lib/appDialogs";
import { runAfterDiscardConfirmation } from "./confirmTabAction";
import type { TabData } from "./types";
vi.mock("@/lib/appDialogs", () => ({ confirmAction: vi.fn() }));

describe("asynchronous discard decisions", () => {
  beforeEach(() => { vi.mocked(confirmAction).mockReset(); });
  const dirtyTab = () => ({ id: "file", type: "query", fileRelativePath: "test.sql", isDirty: true, sql: "SELECT 2;" }) as TabData;
  it("does not close a tab before approval and preserves cancellation", async () => {
    let decide!: (approved: boolean) => void;
    vi.mocked(confirmAction).mockImplementation(() => new Promise((resolve) => { decide = resolve; }));
    const tabs = [dirtyTab()]; const apply = vi.fn();
    const result = runAfterDiscardConfirmation(tabs, "close", () => tabs, apply);
    expect(apply).not.toHaveBeenCalled();
    decide(false); await result;
    expect(apply).not.toHaveBeenCalled();
  });
  it("does not discard content changed while its confirmation was open", async () => {
    let decide!: (approved: boolean) => void;
    vi.mocked(confirmAction).mockImplementation(() => new Promise((resolve) => { decide = resolve; }));
    let tabs = [dirtyTab()]; const apply = vi.fn();
    const result = runAfterDiscardConfirmation(tabs, "close", () => tabs, apply);
    tabs = [{ ...tabs[0]!, sql: "SELECT 3;" }];
    decide(true); await result;
    expect(apply).not.toHaveBeenCalled();
  });
  it("keeps the clean tab close path immediate", async () => {
    const apply = vi.fn();
    const result = runAfterDiscardConfirmation([], "close", () => [], apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(confirmAction).not.toHaveBeenCalled();
    await result;
  });
});
