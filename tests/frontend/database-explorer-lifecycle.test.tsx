// @vitest-environment happy-dom
import { useExplorerCapabilities } from "@/features/database-explorer/hooks/useExplorerCapabilities";
import { useExplorerExpandedMetadata } from "@/features/database-explorer/hooks/useExplorerExpandedMetadata";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import type { SchemaObjectInfo } from "@/services/tauri/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  getDatabaseCapabilities: vi.fn(),
  getSchemaObjects: vi.fn(),
}));
vi.mock("@/services/tauri", () => ({
  databaseService: {
    getDatabaseCapabilities: services.getDatabaseCapabilities,
  },
  schemaService: { getSchemaObjects: services.getSchemaObjects },
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
let capabilities: ReturnType<typeof useExplorerCapabilities>;
let metadata: ReturnType<typeof useExplorerExpandedMetadata>;
function Capabilities(props: Parameters<typeof useExplorerCapabilities>[0]) {
  capabilities = useExplorerCapabilities(props);
  return null;
}
function Metadata(props: Parameters<typeof useExplorerExpandedMetadata>[0]) {
  metadata = useExplorerExpandedMetadata(props);
  return null;
}
function connection(id: string) {
  return { id, name: id, url: "", driver: "postgres" as const };
}
function metadataProps(): Parameters<typeof useExplorerExpandedMetadata>[0] {
  return {
    shouldAutoIntrospect: true,
    isActiveConnectionReady: true,
    isLoading: false,
    activeConnectionId: "first",
    currentSchema: "public",
    isActiveNamespaceExpanded: true,
    canBrowseTables: true,
    loadTables: vi.fn(async () => {}),
    activeCapabilities: defaultDatabaseCapabilities("postgres"),
    activeDriver: "postgres",
    hydrateSchemaObjectsFromCache: vi.fn(async () => true),
    canBrowseCollections: false,
    loadCollections: vi.fn(async () => {}),
    collectionNamespace: "public",
    explorerRegexSearch: false,
    filterText: "",
    loadFunctions: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  services.getSchemaObjects.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("keeps the current connection capability result when an old request resolves late", async () => {
  const first = deferred<ReturnType<typeof defaultDatabaseCapabilities>>();
  const second = deferred<ReturnType<typeof defaultDatabaseCapabilities>>();
  services.getDatabaseCapabilities
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  await act(async () =>
    root.render(
      <Capabilities
        activeDriver="postgres"
        activeConnection={connection("first")}
      />,
    ),
  );
  await act(async () =>
    root.render(
      <Capabilities
        activeDriver="postgres"
        activeConnection={connection("second")}
      />,
    ),
  );
  const current = {
    ...defaultDatabaseCapabilities("postgres"),
    supportsFunctions: false,
  };
  await act(async () => second.resolve(current));
  await act(async () => first.resolve(defaultDatabaseCapabilities("postgres")));
  expect(capabilities.connectionCapabilities).toEqual({
    connectionId: "second",
    connection: connection("second"),
    capabilities: current,
  });
});

it("clears connection capabilities on deselection and ignores the outstanding request", async () => {
  const request = deferred<ReturnType<typeof defaultDatabaseCapabilities>>();
  services.getDatabaseCapabilities.mockReturnValue(request.promise);
  await act(async () =>
    root.render(
      <Capabilities
        activeDriver="postgres"
        activeConnection={connection("first")}
      />,
    ),
  );
  await act(async () =>
    root.render(
      <Capabilities activeDriver="postgres" activeConnection={undefined} />,
    ),
  );
  await act(async () =>
    request.resolve(defaultDatabaseCapabilities("postgres")),
  );
  expect(capabilities.connectionCapabilities).toBeNull();
  expect(services.getDatabaseCapabilities).toHaveBeenCalledTimes(1);
});

it("does not start metadata requests for a collapsed namespace", async () => {
  const props = { ...metadataProps(), isActiveNamespaceExpanded: false };
  await act(async () => root.render(<Metadata {...props} />));
  expect(services.getSchemaObjects).not.toHaveBeenCalled();
  expect(props.loadTables).not.toHaveBeenCalled();
  expect(props.loadFunctions).not.toHaveBeenCalled();
  expect(metadata.isSchemaObjectDescriptorsLoading).toBe(false);
});

it("ignores a previous schema's descriptors while the next schema is still loading", async () => {
  const first = deferred<SchemaObjectInfo[]>();
  const second = deferred<SchemaObjectInfo[]>();
  services.getSchemaObjects
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const props = metadataProps();
  await act(async () => root.render(<Metadata {...props} />));
  await act(async () =>
    root.render(<Metadata {...props} currentSchema="reporting" />),
  );
  await act(async () => first.resolve([]));
  expect(metadata.isSchemaObjectDescriptorsLoading).toBe(true);
  expect(metadata.schemaObjectDescriptorScope).toBeNull();
  await act(async () => second.resolve([]));
  expect(metadata.schemaObjectDescriptorScope).toBe("first:reporting");
  expect(metadata.isSchemaObjectDescriptorsLoading).toBe(false);
});

it("clears descriptors when the namespace collapses and ignores its pending result", async () => {
  const request = deferred<SchemaObjectInfo[]>();
  services.getSchemaObjects.mockReturnValue(request.promise);
  const props = metadataProps();
  await act(async () => root.render(<Metadata {...props} />));
  await act(async () =>
    root.render(<Metadata {...props} isActiveNamespaceExpanded={false} />),
  );
  await act(async () => request.resolve([]));
  expect(metadata.schemaObjectDescriptorScope).toBeNull();
  expect(metadata.schemaObjectDescriptors).toEqual([]);
  expect(metadata.isSchemaObjectDescriptorsLoading).toBe(false);
});

it("uses cached metadata without introspection when automatic loading is disabled", async () => {
  const props = { ...metadataProps(), shouldAutoIntrospect: false };
  await act(async () => root.render(<Metadata {...props} />));
  expect(props.hydrateSchemaObjectsFromCache).toHaveBeenCalledWith(
    "first",
    "public",
  );
  expect(services.getSchemaObjects).not.toHaveBeenCalled();
  expect(props.loadTables).not.toHaveBeenCalled();
});
