// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorDocumentContent } from "@/features/query-editor/hooks/useEditorDocumentContent";
import { useEditorServerVersion } from "@/features/query-editor/hooks/useEditorServerVersion";
import { useEditorConnectionCatalog } from "@/features/query-editor/hooks/useEditorConnectionCatalog";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";

const services = vi.hoisted(() => ({
  getServerVersion: vi.fn(),
  getConnectionDatabaseCapabilityContext: vi.fn(),
  getDatabaseCapabilities: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  connectionService: { getServerVersion: services.getServerVersion },
  databaseService: {
    getConnectionDatabaseCapabilityContext:
      services.getConnectionDatabaseCapabilityContext,
    getDatabaseCapabilities: services.getDatabaseCapabilities,
  },
}));
vi.mock("@/hooks/usePostgresDatabaseDiscovery", () => ({
  usePostgresDatabaseDiscovery: ({
    connectionId,
  }: {
    connectionId: string;
  }) => ({
    connectionId,
    databases: [],
    isRefreshing: false,
    status: "success",
    error: null,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let root: Root;
let container: HTMLDivElement;
let documentController: ReturnType<typeof useEditorDocumentContent>;
let versionController: ReturnType<typeof useEditorServerVersion>;
let catalogController: ReturnType<typeof useEditorConnectionCatalog>;

function DocumentHarness(
  props: Parameters<typeof useEditorDocumentContent>[0],
) {
  documentController = useEditorDocumentContent(props);
  return null;
}
function VersionHarness(props: Parameters<typeof useEditorServerVersion>[0]) {
  versionController = useEditorServerVersion(props);
  return null;
}
function CatalogHarness(
  props: Parameters<typeof useEditorConnectionCatalog>[0],
) {
  catalogController = useEditorConnectionCatalog(props);
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("query editor document ownership", () => {
  it("coalesces Elasticsearch typing while keeping ordinary SQL updates immediate", async () => {
    const updateTabSql = vi.fn();
    const props = {
      updateTabSql,
      effectiveTabId: "console",
      isElasticsearchConsole: true,
    };
    await act(async () => root.render(<DocumentHarness {...props} />));
    act(() => {
      documentController.handleEditorContentChange("GET /first");
      vi.advanceTimersByTime(60);
      documentController.handleEditorContentChange("GET /latest");
      vi.advanceTimersByTime(119);
    });
    expect(updateTabSql).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(updateTabSql.mock.calls).toEqual([["console", "GET /latest"]]);

    await act(async () =>
      root.render(
        <DocumentHarness
          {...props}
          effectiveTabId="sql"
          isElasticsearchConsole={false}
        />,
      ),
    );
    act(() => documentController.handleEditorContentChange("SELECT 1"));
    expect(updateTabSql).toHaveBeenLastCalledWith("sql", "SELECT 1");
  });

  it("flushes the previous tab before accepting edits for the next tab", async () => {
    const updateTabSql = vi.fn();
    const props = {
      updateTabSql,
      effectiveTabId: "first",
      isElasticsearchConsole: true,
    };
    await act(async () => root.render(<DocumentHarness {...props} />));
    act(() => documentController.handleEditorContentChange("GET /first"));
    await act(async () =>
      root.render(<DocumentHarness {...props} effectiveTabId="second" />),
    );
    expect(updateTabSql.mock.calls).toEqual([["first", "GET /first"]]);
    act(() => {
      documentController.handleEditorContentChange("GET /second");
      vi.advanceTimersByTime(120);
    });
    expect(updateTabSql.mock.calls).toEqual([
      ["first", "GET /first"],
      ["second", "GET /second"],
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves the final pending edit on unmount without a duplicate timer write", async () => {
    const updateTabSql = vi.fn();
    await act(async () =>
      root.render(
        <DocumentHarness
          updateTabSql={updateTabSql}
          effectiveTabId="closing"
          isElasticsearchConsole
        />,
      ),
    );
    act(() => documentController.handleEditorContentChange("GET /final"));
    await act(async () => root.render(null));
    act(() => vi.runAllTimers());
    expect(updateTabSql.mock.calls).toEqual([["closing", "GET /final"]]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("query editor connection request ownership", () => {
  it("ignores a late server version from a previous connection and clears the model on language exit", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    services.getServerVersion.mockImplementation((id: string) =>
      id === "first" ? first.promise : second.promise,
    );
    const model: {
      __oxideElasticsearchServerVersion?: { major: number; minor: number };
    } = {};
    const props = {
      isElasticsearchConsole: true,
      effectiveConnectionId: "first",
      connectedConnectionIds: ["first", "second"],
      mountedEditor: { getModel: () => model },
    };
    await act(async () => root.render(<VersionHarness {...props} />));
    await act(async () =>
      root.render(<VersionHarness {...props} effectiveConnectionId="second" />),
    );
    await act(async () => second.resolve("8.15.0"));
    await act(async () => first.resolve("7.17.0"));
    expect(versionController.elasticsearchServerVersion).toEqual({
      major: 8,
      minor: 15,
    });
    expect(model.__oxideElasticsearchServerVersion).toEqual({
      major: 8,
      minor: 15,
    });
    await act(async () =>
      root.render(<VersionHarness {...props} isElasticsearchConsole={false} />),
    );
    expect(model.__oxideElasticsearchServerVersion).toBeUndefined();
  });

  it("does not publish a server version after the editor unmounts", async () => {
    const pending = deferred<string>();
    services.getServerVersion.mockReturnValue(pending.promise);
    const model: { __oxideElasticsearchServerVersion?: unknown } = {};
    await act(async () =>
      root.render(
        <VersionHarness
          isElasticsearchConsole
          effectiveConnectionId="closing"
          connectedConnectionIds={["closing"]}
          mountedEditor={{ getModel: () => model }}
        />,
      ),
    );
    await act(async () => root.render(null));
    await act(async () => pending.resolve("8.15.0"));
    expect(model.__oxideElasticsearchServerVersion).toBeUndefined();
  });

  it("retains the current connection capabilities when the previous request finishes last", async () => {
    const first = deferred<{
      capabilities: ReturnType<typeof defaultDatabaseCapabilities>;
    }>();
    const second = deferred<{
      capabilities: ReturnType<typeof defaultDatabaseCapabilities>;
    }>();
    services.getConnectionDatabaseCapabilityContext.mockImplementation(
      (id: string) => (id === "first" ? first.promise : second.promise),
    );
    const connection = (id: string) => ({
      id,
      name: id,
      driver: "postgres" as const,
      url: "",
      database: "main",
    });
    const props: Parameters<typeof useEditorConnectionCatalog>[0] = {
      activeConnection: connection("first"),
      effectiveConnectionId: "first",
      driver: "postgres",
      driverCatalogStatus: "ready",
      activeProjectId: "project",
      connectedConnectionIds: ["first", "second"],
      metadataVersion: 0,
    };
    await act(async () => root.render(<CatalogHarness {...props} />));
    await act(async () =>
      root.render(
        <CatalogHarness
          {...props}
          activeConnection={connection("second")}
          effectiveConnectionId="second"
        />,
      ),
    );
    const capabilities = {
      ...defaultDatabaseCapabilities("postgres"),
      supportsExplainPlan: false,
    };
    await act(async () => second.resolve({ capabilities }));
    await act(async () =>
      first.resolve({ capabilities: defaultDatabaseCapabilities("postgres") }),
    );
    expect(catalogController.capabilities).toBe(capabilities);
    expect(services.getDatabaseCapabilities).not.toHaveBeenCalled();
  });
});
