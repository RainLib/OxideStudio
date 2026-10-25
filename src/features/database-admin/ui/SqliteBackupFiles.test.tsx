import { confirmAction } from "@/lib/appDialogs";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteBackupArtifactPage, SqliteBackupRun } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), remove: vi.fn(), onDeleted: vi.fn() }));
vi.mock("@/services/tauri/database.service", () => ({ databaseService: {
  listSqliteBackupArtifacts: mocks.list,
  previewSqliteBackupFileDelete: mocks.preview,
  deleteSqliteBackupRun: mocks.remove,
} }));
vi.mock("@/store/useProjectStore", () => ({ useProjectStore: (selector: (state: unknown) => unknown) => selector({ projects: [
  { id: "project-1", name: "App project" }, { id: "project-2", name: "Warehouse" },
] }) }));

import { SqliteBackupFiles } from "./SqliteBackupFiles";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function run(id: string, overrides: Partial<SqliteBackupRun> = {}): SqliteBackupRun {
  return { id, scheduleId: "plan-1", scheduleName: id, projectId: "project-1", connectionId: "sqlite-1",
    destinationDirectory: "C:/backups", compression: "none", trigger: "scheduled", status: "success",
    startedAt: "2026-10-20T02:00:00Z", completedAt: "2026-10-20T02:00:03Z", filePath: `C:/backups/${id}.sqlite`, byteLen: 8192,
    progressPercent: 100, ...overrides };
}
function button(label: string): HTMLButtonElement {
  const element = [...document.body.querySelectorAll("button")].find((item) => item.textContent?.includes(label) || item.getAttribute("aria-label") === label);
  if (!element) throw new Error(`Button missing: ${label}`);
  return element;
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

describe("SqliteBackupFiles", () => {
  let root: Root;
  beforeEach(() => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    mocks.list.mockReset().mockResolvedValue({ items: [], nextCursor: null });
    mocks.preview.mockReset().mockImplementation(async (id: string) => ({ id, filePath: `C:/backups/${id}.sqlite`, byteLen: 8192, reviewRequired: false, confirmationToken: `token-${id}` }));
    mocks.remove.mockReset().mockResolvedValue(true);
    mocks.onDeleted.mockReset().mockResolvedValue(undefined);
    vi.mocked(confirmAction).mockReset().mockResolvedValue(true);
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  async function render(projectId = "project-1") { await act(async () => root.render(<SqliteBackupFiles projectId={projectId} refreshKey="" onDeleted={mocks.onDeleted} />)); await flush(); }

  it("browses archived files with Host continuation tokens and returns to the previous page", async () => {
    mocks.list.mockImplementation(async (request: { cursor?: string }) => request.cursor
      ? { items: [run("older-than-recent-history")], nextCursor: null }
      : { items: [run("latest-file")], nextCursor: "opaque-next" });
    await render();
    expect(button("Previous files").disabled).toBe(true);
    await act(async () => button("Next files").click()); await flush();
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "project-1", cursor: "opaque-next", limit: 50 }));
    expect(document.body.textContent).toContain("older-than-recent-history");
    expect(button("Next files").disabled).toBe(true);
    await act(async () => button("Previous files").click()); await flush();
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: undefined }));
    expect(document.body.textContent).toContain("latest-file");
  });

  it("resets pagination when project scope or debounced search changes", async () => {
    vi.useFakeTimers();
    mocks.list.mockResolvedValue({ items: [run("file")], nextCursor: "next" });
    await render();
    await act(async () => button("Next files").click()); await flush();
    const all = document.body.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => all?.click()); await flush();
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: undefined, cursor: undefined }));
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="Search retained backup files"]');
    await act(async () => {
      if (!input) throw new Error("search input missing");
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(input, "%_literal");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(200)); await flush();
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ search: "%_literal", cursor: undefined }));
    expect(button("Previous files").disabled).toBe(true);
  });

  it("ignores an old native response after switching projects", async () => {
    let first: ((page: SqliteBackupArtifactPage) => void) | undefined;
    mocks.list.mockImplementation((request: { projectId: string }) => request.projectId === "project-1"
      ? new Promise<SqliteBackupArtifactPage>((resolve) => { first = resolve; })
      : Promise.resolve({ items: [run("warehouse-file", { projectId: "project-2" })], nextCursor: null }));
    await render(); await render("project-2");
    await act(async () => first?.({ items: [run("stale-project-file")], nextCursor: null })); await flush();
    expect(document.body.textContent).toContain("warehouse-file");
    expect(document.body.textContent).toContain("Warehouse");
    expect(document.body.textContent).not.toContain("stale-project-file");
  });

  it("reviews the actual file path and uses the Host confirmation for an unverified archived file", async () => {
    mocks.list.mockResolvedValueOnce({ items: [run("interrupted-file", { status: "interrupted" })], nextCursor: null }).mockResolvedValue({ items: [], nextCursor: null });
    mocks.preview.mockResolvedValue({ id: "interrupted-file", filePath: "C:/backups/interrupted-file.sqlite", byteLen: 8192, reviewRequired: true, confirmationToken: "current-file-token" });
    await render();
    expect(document.body.textContent).toContain("Needs review");
    await act(async () => button("Delete retained backup interrupted-file").click()); await flush();
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("C:/backups/interrupted-file.sqlite"));
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("no verified completion receipt"));
    expect(mocks.remove).toHaveBeenCalledWith("interrupted-file", "current-file-token");
    expect(mocks.onDeleted).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("interrupted-file");
  });

  it("keeps a file visible when deletion detects that it changed after review", async () => {
    mocks.list.mockResolvedValue({ items: [run("changed-file")], nextCursor: null });
    mocks.remove.mockRejectedValue(new Error("The backup file changed since it was reviewed"));
    await render();
    await act(async () => button("Delete retained backup changed-file").click()); await flush();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("changed since it was reviewed");
    expect(document.body.textContent).toContain("changed-file");
    expect(mocks.onDeleted).not.toHaveBeenCalled();
    expect(button("Delete retained backup changed-file").disabled).toBe(false);
  });

  it("refreshes files from other projects without waiting for current-project activity", async () => {
    vi.useFakeTimers();
    mocks.list.mockResolvedValue({ items: [run("current-file")], nextCursor: null });
    await render();
    await act(async () => document.body.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    await flush();
    mocks.list.mockResolvedValue({ items: [run("current-file"), run("new-warehouse-file", { projectId: "project-2" })], nextCursor: null });
    await act(async () => vi.advanceTimersByTime(10_000)); await flush();
    expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: undefined }));
    expect(document.body.textContent).toContain("new-warehouse-file");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

vi.mock("@/lib/appDialogs", () => ({ confirmAction: vi.fn(async () => true) }));
