import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConnectionMetadataNodeKey } from "@/features/schema-metadata/model/metadataIdentity";

const mocks = vi.hoisted(() => ({ restore: vi.fn(), nodeStates: {} as Record<string, unknown> }));
vi.mock("@/store/useConnectionStore", () => ({
  restoreConnectionSession: mocks.restore,
  useConnectionStore: { getState: vi.fn() },
}));
vi.mock("@/store/useSchemaStore", () => ({
  useSchemaStore: { getState: () => ({ metadataNodeStates: mocks.nodeStates }) },
}));
import { createExplorerRefreshActions } from "./createExplorerRefreshActions";

describe("refreshing a data source", () => {
  const connection = { id: "source-id", driver: "postgres", origin: "managed", name: "Managed" };
  const makeActions = () => {
    const loadSchemas = vi.fn().mockResolvedValue(undefined);
    const setActiveConnection = vi.fn().mockResolvedValue(null);
    const setNamespaceError = vi.fn();
    const actions = createExplorerRefreshActions({
      activeConnectionId: connection.id,
      connections: [connection],
      loadSchemas,
      setActiveConnection,
      setNamespaceError,
      setPostgresDatabaseRefreshVersion: vi.fn(),
    } as never);
    return { actions, loadSchemas, setActiveConnection, setNamespaceError };
  };
  beforeEach(() => { mocks.nodeStates = {}; mocks.restore.mockReset(); });

  it("reconnects a missing backend session before refreshing schemas", async () => {
    mocks.nodeStates[getConnectionMetadataNodeKey(connection.id, connection.driver)] = {
      status: "error", message: `Connection not found: ${connection.id}`,
    };
    mocks.restore.mockResolvedValue({ status: "ready", connection });
    const { actions, loadSchemas, setActiveConnection } = makeActions();
    await actions.handleRefreshConnection(connection.id);
    expect(mocks.restore).toHaveBeenCalledWith(connection.id);
    expect(setActiveConnection).not.toHaveBeenCalled();
    expect(loadSchemas).toHaveBeenCalledWith(connection.id, true);
  });

  it("keeps the real connection error and does not refresh after recovery fails", async () => {
    mocks.nodeStates[getConnectionMetadataNodeKey(connection.id, connection.driver)] = {
      status: "error", message: `Connection not found: ${connection.id}`,
    };
    mocks.restore.mockResolvedValue({ status: "error", message: "Gateway denied access" });
    const { actions, loadSchemas, setNamespaceError } = makeActions();
    await actions.handleRefreshConnection(connection.id);
    expect(setNamespaceError).toHaveBeenCalledWith("Gateway denied access");
    expect(loadSchemas).not.toHaveBeenCalled();
  });

  it("connects an inactive session before an ordinary refresh", async () => {
    const { actions, loadSchemas, setActiveConnection } = makeActions();
    await actions.handleRefreshConnection(connection.id);
    expect(setActiveConnection).toHaveBeenCalledWith(connection.id);
    expect(loadSchemas).toHaveBeenCalledWith(connection.id, true);
    expect(mocks.restore).not.toHaveBeenCalled();
  });
});
