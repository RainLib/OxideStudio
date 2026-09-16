// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useExplorerCatalogVisibility } from "@/features/database-explorer/hooks/useExplorerCatalogVisibility";

let root: Root;
let container: HTMLDivElement;
let visibility: ReturnType<typeof useExplorerCatalogVisibility>;
type Options = Parameters<typeof useExplorerCatalogVisibility>[0];
function Harness(props: Options) {
  visibility = useExplorerCatalogVisibility(props);
  return null;
}
function options(overrides: Partial<Options> = {}): Options {
  return {
    activeConnectionId: "first",
    activeProjectId: "project",
    activeDriver: "mysql",
    activeConnection: {
      id: "first",
      name: "First",
      url: "",
      driver: "mysql",
      database: "app",
    },
    canBrowseDatabaseCatalogs: false,
    postgresDatabaseDiscovery: {
      connectionId: "first",
      databases: [],
      status: "idle",
      error: null,
      source: null,
      isRefreshing: false,
      cacheLoaded: true,
    },
    currentSchema: "app",
    defaultSchema: "app",
    schemas: ["app", "audit", "warehouse"],
    shouldLimitVisibleSchemas: true,
    ...overrides,
  };
}
beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
});

it("starts with the preferred schema and persists normalized selection", async () => {
  await act(async () => root.render(<Harness {...options()} />));
  expect(visibility.schemaRows).toEqual(["app"]);
  act(() => visibility.handleToggleSchemaVisibility("audit", true));
  act(() => visibility.handleToggleSchemaVisibility("audit", true));
  act(() => visibility.handleToggleSchemaVisibility("missing", true));
  expect(visibility.schemaRows).toEqual(["app", "audit"]);
  expect(
    JSON.parse(
      localStorage.getItem("oxide-studio-visible-schemas:project:first:mysql")!,
    ),
  ).toEqual({ all: false, schemas: ["app", "audit"] });
});

it("keeps the current schema visible even when its preference is unchecked", async () => {
  await act(async () => root.render(<Harness {...options()} />));
  act(() => visibility.handleToggleAllSchemas(true));
  act(() => visibility.handleToggleSchemaVisibility("app", false));
  expect(visibility.showAllSchemas).toBe(false);
  expect(visibility.visibleSchemaSet.has("app")).toBe(false);
  expect(visibility.schemaRows).toEqual(["app", "audit", "warehouse"]);
});

it("restores separate schema selections across both connection and project changes", async () => {
  localStorage.setItem(
    "oxide-studio-visible-schemas:project:second:mysql",
    JSON.stringify({ all: false, schemas: ["warehouse"] }),
  );
  localStorage.setItem(
    "oxide-studio-visible-schemas:other:first:mysql",
    JSON.stringify({ all: true, schemas: ["audit"] }),
  );
  const first = options();
  await act(async () => root.render(<Harness {...first} />));
  act(() => visibility.handleToggleSchemaVisibility("audit", true));
  await act(async () =>
    root.render(<Harness {...first} activeConnectionId="second" />),
  );
  expect([...visibility.visibleSchemaSet]).toEqual(["warehouse"]);
  expect(visibility.schemaRows).toEqual(["app", "warehouse"]);
  await act(async () =>
    root.render(<Harness {...first} activeProjectId="other" />),
  );
  expect(visibility.showAllSchemas).toBe(true);
  expect([...visibility.visibleSchemaSet]).toEqual(["audit"]);
  await act(async () => root.render(<Harness {...first} />));
  expect(visibility.showAllSchemas).toBe(false);
  expect([...visibility.visibleSchemaSet]).toEqual(["app", "audit"]);
});

it("filters catalog databases independently and rejects another connection's discovery results", async () => {
  const props = options({
    activeDriver: "postgres",
    activeConnection: {
      id: "first",
      name: "First",
      url: "",
      driver: "postgres",
      database: "app",
    },
    canBrowseDatabaseCatalogs: true,
    postgresDatabaseDiscovery: {
      connectionId: "first",
      databases: ["app", "archive", "archive", ""],
      status: "success",
      error: null,
      source: null,
      isRefreshing: false,
      cacheLoaded: true,
    },
  });
  await act(async () => root.render(<Harness {...props} />));
  expect(visibility.postgresDatabaseRows).toEqual(["app", "archive"]);
  expect(visibility.schemaRows).toEqual(props.schemas);
  act(() =>
    visibility.handleTogglePostgresDatabaseVisibility("archive", false),
  );
  expect(visibility.visiblePostgresDatabases).toEqual(["app"]);
  expect(
    JSON.parse(
      localStorage.getItem("oxide-studio-visible-databases:project:first")!,
    ),
  ).toEqual({ all: false, databases: ["app"] });
  await act(async () =>
    root.render(
      <Harness
        {...props}
        postgresDatabaseDiscovery={{
          connectionId: "old",
          databases: ["stale"],
          status: "success",
          error: null,
          source: null,
          isRefreshing: false,
          cacheLoaded: true,
        }}
      />,
    ),
  );
  expect(visibility.postgresDatabaseRows).toEqual(["app"]);
  expect(visibility.postgresDatabaseCountLabel).toBe("1 of 1 db");
});

it("restores database visibility and clears it when the active connection is removed", async () => {
  localStorage.setItem(
    "oxide-studio-visible-databases:project:first",
    JSON.stringify({ all: false, databases: ["archive", 1] }),
  );
  const props = options({
    canBrowseDatabaseCatalogs: true,
    postgresDatabaseDiscovery: {
      connectionId: "first",
      databases: ["archive"],
      status: "success",
      error: null,
      source: null,
      isRefreshing: false,
      cacheLoaded: true,
    },
  });
  await act(async () => root.render(<Harness {...props} />));
  expect(visibility.showAllPostgresDatabases).toBe(false);
  expect([...visibility.visiblePostgresDatabaseSet]).toEqual(["archive"]);
  await act(async () =>
    root.render(
      <Harness
        {...props}
        activeConnectionId={null}
        activeConnection={undefined}
      />,
    ),
  );
  expect(visibility.showAllPostgresDatabases).toBe(true);
  expect(visibility.visiblePostgresDatabaseSet.size).toBe(0);
  expect(visibility.visibleSchemaSet.size).toBe(0);
});
