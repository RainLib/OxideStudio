/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryHistoryPanel } from "@/components/workspace/QueryHistoryPanel";
import { useHistoryStore } from "@/store/useHistoryStore";

const mocks = vi.hoisted(() => ({
  deleteEntry: vi.fn(async () => undefined),
  clearHistory: vi.fn(async () => undefined),
}));

vi.mock("@/services/tauri/query-history.service", () => ({
  queryHistoryService: {
    getHistory: vi.fn(async () => []),
    saveEntries: vi.fn(async () => undefined),
    deleteEntry: mocks.deleteEntry,
    clearHistory: mocks.clearHistory,
  },
}));

const successEntry = {
  id: "success-1",
  projectId: "project-1",
  connectionId: "postgres-1",
  connectionName: "Local Postgres",
  driver: "postgres",
  databaseName: "app",
  schemaName: "public",
  sql: "SELECT * FROM users",
  status: "success" as const,
  durationMs: 25,
  rowCount: 12,
  errorMessage: null,
  executionMode: "console" as const,
  startedAt: 100,
  finishedAt: 125,
};

const errorEntry = {
  ...successEntry,
  id: "error-1",
  sql: "SELECT FROM",
  status: "error" as const,
  rowCount: null,
  errorMessage: "syntax error near FROM",
  startedAt: 200,
  finishedAt: 225,
};

describe("QueryHistoryPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useHistoryStore.setState({
      projectId: "project-1",
      history: [errorEntry, successEntry],
      isLoading: false,
      error: null,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows execution context and supports open, rerun, filter, and delete", async () => {
    const onOpenInEditor = vi.fn();
    const onRerun = vi.fn(async () => true);
    await act(async () =>
      root.render(
        <QueryHistoryPanel onOpenInEditor={onOpenInEditor} onRerun={onRerun} />
      )
    );

    expect(container.textContent).toContain("Local Postgres · app.public");
    expect(container.textContent).toContain("12 rows");
    expect(container.textContent).toContain("syntax error near FROM");

    const openButtons = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Open history entry in new query"]'
    );
    await act(async () => openButtons[0]?.click());
    expect(onOpenInEditor).toHaveBeenCalledWith(errorEntry);

    const runButtons = container.querySelectorAll<HTMLButtonElement>(
      '[aria-label="Run history entry again"]'
    );
    await act(async () => runButtons[1]?.click());
    expect(onRerun).toHaveBeenCalledWith(successEntry);

    const statusSelect = container.querySelector<HTMLSelectElement>(
      '[aria-label="Filter query history by status"]'
    )!;
    await act(async () => {
      statusSelect.value = "error";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("SELECT FROM");
    expect(container.textContent).not.toContain("SELECT * FROM users");

    const deleteButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Delete history entry"]'
    )!;
    await act(async () => deleteButton.click());
    expect(mocks.deleteEntry).toHaveBeenCalledWith("project-1", "error-1");
    expect(useHistoryStore.getState().history).toEqual([successEntry]);
  });
});
