// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findTableDdlHoverSearchMatches,
  registerTableDdlHoverSearchWidget,
  renderTableDdlHoverSearchMatches,
  type TableDdlHoverSearchRuntime,
} from "./useTableDdlHoverSearchWidget";

const metadataMocks = vi.hoisted(() => ({
  loadTableMetadata: vi.fn(),
  loadTableDdl: vi.fn(),
}));

vi.mock("@/services/tableMetadataCache", () => metadataMocks);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fixture() {
  const listeners: Record<string, (event?: any) => void> = {};
  const host = document.createElement("div");
  document.body.append(host);
  const uri = "oxide://query/active.postgres.sql";
  const model = {
    uri: { toString: () => uri },
    getLineContent: () => "SELECT * FROM users",
  };
  const subscribe = (name: string, listener: (event?: any) => void) => {
    listeners[name] = listener;
    return { dispose: vi.fn() };
  };
  const editor = {
    getModel: () => model,
    getDomNode: () => host,
    onMouseMove: (listener: (event: any) => void) => subscribe("mouseMove", listener),
    onMouseLeave: (listener: (event: any) => void) => subscribe("mouseLeave", listener),
    onDidChangeModelContent: (listener: () => void) => subscribe("content", listener),
    onDidChangeModel: (listener: () => void) => subscribe("model", listener),
    onDidScrollChange: (listener: () => void) => subscribe("scroll", listener),
    addContentWidget: vi.fn((widget: any) => host.append(widget.getDomNode())),
    removeContentWidget: vi.fn((widget: any) => widget.getDomNode().remove()),
    layoutContentWidget: vi.fn(),
    focus: vi.fn(),
  };
  let runtime: TableDdlHoverSearchRuntime = {
    activeProjectId: "project-1",
    currentSchema: "public",
    databaseName: "app",
    documentUri: uri,
    driver: "postgres",
    effectiveConnectionId: "connection-1",
    metadataRevision: 1,
    schemaTables: [{ name: "users", type: "BASE TABLE" } as any],
    showTableDdlHoverPreview: true,
    supportsTableBrowsing: true,
    targetSchema: "public",
  };
  const controller = registerTableDdlHoverSearchWidget({
    editor,
    monaco: {
      editor: {
        ContentWidgetPositionPreference: { BELOW: 2, ABOVE: 1 },
      },
    },
    getRuntime: () => runtime,
  });
  return {
    controller,
    editor,
    host,
    listeners,
    runtime: () => runtime,
    setRuntime: (next: TableDdlHoverSearchRuntime) => {
      runtime = next;
    },
  };
}

describe("table DDL hover search", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    metadataMocks.loadTableMetadata.mockReset().mockResolvedValue({
      columns: [
        {
          name: "id",
          data_type: "bigint",
          is_primary_key: true,
          is_nullable: false,
          is_auto_increment: false,
        },
      ],
      indexes: [],
      constraints: [],
      ddl: null,
      viewDefinition: null,
      source: "cache",
      updatedAt: 1,
    });
    metadataMocks.loadTableDdl.mockReset().mockResolvedValue(
      "CREATE TABLE users (\n  id bigint PRIMARY KEY,\n  display_name text\n);",
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("matches literal text case-insensitively without regex semantics", () => {
    expect(findTableDdlHoverSearchMatches("ID id (id)", "id")).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 7, end: 9 },
    ]);
    expect(findTableDdlHoverSearchMatches("a[b a.b", "a[b")).toEqual([
      { start: 0, end: 3 },
    ]);
    expect(findTableDdlHoverSearchMatches("anything", "   ")).toEqual([]);
  });

  it("renders matches as text nodes without interpreting database HTML", () => {
    const container = document.createElement("pre");
    const text = "<script> id </script>";
    renderTableDdlHoverSearchMatches(
      container,
      text,
      findTableDdlHoverSearchMatches(text, "id"),
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toBe(text);
    expect(container.querySelectorAll("mark")).toHaveLength(1);
  });

  it("opens one bounded widget and searches the cached DDL in place", async () => {
    const state = fixture();
    state.listeners.mouseMove!({
      target: { position: { lineNumber: 1, column: 16 } },
    });
    await vi.advanceTimersByTimeAsync(320);

    expect(metadataMocks.loadTableDdl).toHaveBeenCalledOnce();
    expect(state.editor.addContentWidget).toHaveBeenCalledOnce();
    const widget = state.host.querySelector<HTMLElement>(
      "[data-table-ddl-hover-search]",
    );
    expect(widget?.textContent).toContain("CREATE TABLE users");

    const input = widget!.querySelector<HTMLInputElement>("input")!;
    input.value = "id";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(widget!.querySelectorAll("mark")).toHaveLength(1);
    expect(widget?.textContent).toContain("1 match");

    state.listeners.mouseMove!({
      target: { position: { lineNumber: 1, column: 18 } },
    });
    expect(state.editor.layoutContentWidget).toHaveBeenCalledOnce();
    expect(metadataMocks.loadTableDdl).toHaveBeenCalledOnce();
    state.controller.dispose();
  });

  it("drops a delayed result after the connection owner changes", async () => {
    const pending = deferred<string>();
    metadataMocks.loadTableDdl.mockReturnValue(pending.promise);
    const state = fixture();
    state.listeners.mouseMove!({
      target: { position: { lineNumber: 1, column: 16 } },
    });
    await vi.advanceTimersByTimeAsync(320);
    state.setRuntime({
      ...state.runtime(),
      effectiveConnectionId: "connection-2",
    });
    pending.resolve("CREATE TABLE users (id bigint)");
    await Promise.resolve();
    await Promise.resolve();

    expect(state.editor.addContentWidget).not.toHaveBeenCalled();
    state.controller.dispose();
  });
});
