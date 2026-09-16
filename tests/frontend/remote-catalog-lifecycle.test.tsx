// @vitest-environment happy-dom
import { useRemoteCatalogLoading } from "@/features/database-explorer/hooks/useRemoteCatalogLoading";
import type {
  SchemaObjectInfo,
  TableInfo,
} from "@/services/tauri/types/schemaCatalog";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  tables: vi.fn(),
  objects: vi.fn(),
  members: vi.fn(),
}));
vi.mock("@/services/tauri", () => ({
  schemaService: {
    getDatabaseTables: services.tables,
    getDatabaseSchemaObjects: services.objects,
    getDatabaseSchemaObjectMembers: services.members,
  },
}));
type Options = Parameters<typeof useRemoteCatalogLoading>[0];
let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof useRemoteCatalogLoading>;
function Harness(props: Options) {
  controller = useRemoteCatalogLoading(props);
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { resolve, reject, promise };
}
function options(database = "first"): Options {
  return {
    connectionId: "pg",
    database,
    onTablesLoaded: vi.fn(),
    expandedSchemas: new Set(),
    setExpandedSchemas: vi.fn(),
    setExpandedGroups: vi.fn(),
    setExpandedTables: vi.fn(),
    expandedObjectKeys: new Set(),
    setExpandedObjectKeys: vi.fn(),
  };
}
const object: SchemaObjectInfo = {
  name: "api",
  objectType: "PACKAGE",
  membersExpandable: true,
};
const memberKey = "public:PACKAGE:api";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  services.tables.mockResolvedValue([]);
  services.objects.mockResolvedValue([]);
  services.members.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("deduplicates concurrent table loads for the same schema", async () => {
  const request = deferred<TableInfo[]>();
  services.tables.mockReturnValue(request.promise);
  await act(async () => root.render(<Harness {...options()} />));
  await act(async () => {
    void controller.loadTables("public");
    void controller.loadTables("public");
  });
  expect(services.tables).toHaveBeenCalledTimes(1);
  await act(async () => request.resolve([{ name: "orders" }]));
  expect(controller.schemaLoads.public?.tables).toEqual([{ name: "orders" }]);
});
it("ignores a previous database's tables and keeps the current load in flight", async () => {
  const old = deferred<TableInfo[]>(),
    current = deferred<TableInfo[]>();
  services.tables
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  const first = options(),
    second = options("second");
  await act(async () => root.render(<Harness {...first} />));
  await act(async () => {
    void controller.loadTables("public");
  });
  await act(async () => root.render(<Harness {...second} />));
  await act(async () => {
    void controller.loadTables("public");
  });
  await act(async () => old.resolve([{ name: "old" }]));
  expect(controller.schemaLoads.public?.status).toBe("loading");
  await act(async () => {
    void controller.loadTables("public");
  });
  expect(services.tables).toHaveBeenCalledTimes(2);
  await act(async () => current.resolve([{ name: "current" }]));
  expect(first.onTablesLoaded).not.toHaveBeenCalled();
  expect(second.onTablesLoaded).toHaveBeenCalledWith("public", [
    { name: "current" },
  ]);
});
it("does not let old members replace the next database's same-named object", async () => {
  const old = deferred<SchemaObjectInfo[]>(),
    current = deferred<SchemaObjectInfo[]>();
  services.members
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  await act(async () => root.render(<Harness {...options()} />));
  await act(async () => controller.toggleObjectMembers("public", object));
  await act(async () => root.render(<Harness {...options("second")} />));
  await act(async () => controller.toggleObjectMembers("public", object));
  await act(async () =>
    current.resolve([{ name: "current", objectType: "FUNCTION" }]),
  );
  await act(async () => old.resolve([{ name: "old", objectType: "FUNCTION" }]));
  expect(controller.objectMemberLoads[memberKey]?.members).toEqual([
    { name: "current", objectType: "FUNCTION" },
  ]);
});
it("ignores a previous connection's member error after changing context", async () => {
  const old = deferred<SchemaObjectInfo[]>();
  services.members.mockReturnValueOnce(old.promise);
  await act(async () => root.render(<Harness {...options()} />));
  await act(async () => controller.toggleObjectMembers("public", object));
  await act(async () =>
    root.render(<Harness {...options()} connectionId="next" />),
  );
  await act(async () => old.reject(new Error("old connection failed")));
  expect(controller.objectMemberLoads).toEqual({});
});
it("keeps the latest member request when same-object responses arrive out of order", async () => {
  const old = deferred<SchemaObjectInfo[]>(),
    current = deferred<SchemaObjectInfo[]>();
  services.members
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  await act(async () => root.render(<Harness {...options()} />));
  await act(async () => {
    controller.toggleObjectMembers("public", object);
    controller.toggleObjectMembers("public", object);
  });
  await act(async () =>
    current.resolve([{ name: "current", objectType: "FUNCTION" }]),
  );
  await act(async () => old.reject(new Error("superseded request")));
  expect(controller.objectMemberLoads[memberKey]?.status).toBe("success");
  expect(controller.objectMemberLoads[memberKey]?.members[0]?.name).toBe(
    "current",
  );
});
it("does not notify the host when a table request finishes after unmount", async () => {
  const request = deferred<TableInfo[]>();
  services.tables.mockReturnValue(request.promise);
  const props = options();
  await act(async () => root.render(<Harness {...props} />));
  await act(async () => {
    void controller.loadTables("public");
  });
  await act(async () => root.render(null));
  await act(async () => request.resolve([{ name: "old" }]));
  expect(props.onTablesLoaded).not.toHaveBeenCalled();
});
