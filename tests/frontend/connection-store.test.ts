import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useConnectionStore,
  type ConnectionConfig,
} from "@/store/useConnectionStore";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  deleteConnection: vi.fn(async () => undefined),
  loadConnections: vi.fn(async () => []),
  saveConnections: vi.fn(async () => undefined),
  testConnection: vi.fn(async () => undefined),
}));

vi.mock("@/services/tauri", () => ({
  connectionService: {
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    deleteConnection: mocks.deleteConnection,
    loadConnections: mocks.loadConnections,
    saveConnections: mocks.saveConnections,
    testConnection: mocks.testConnection,
  },
}));

function connection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: "postgres-1",
    name: "Postgres",
    driver: "postgres",
    url: "",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "secret",
    database: "app",
    sslMode: "disable",
    ...overrides,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createStorageMock() {
  const storage = new Map<string, string>();

  return {
    clear: vi.fn(() => storage.clear()),
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
  };
}

describe("connection store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", createStorageMock());
    useConnectionStore.setState({
      connections: [],
      activeConnectionId: null,
      connectedConnectionIds: [],
      isConnected: false,
      isLoading: false,
      selectedConnection: null,
    });
  });

  it("tests a connection without activating or saving it", async () => {
    const error = await useConnectionStore
      .getState()
      .testConnection(connection());

    expect(error).toBeNull();
    expect(mocks.testConnection).toHaveBeenCalledWith(
      "postgres",
      expect.stringContaining("localhost"),
      undefined
    );
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.saveConnections).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeConnectionId).toBeNull();
    expect(useConnectionStore.getState().isConnected).toBe(false);
  });

  it("keeps the current workspace closed when test connection fails", async () => {
    mocks.testConnection.mockRejectedValueOnce(new Error("connection refused"));

    const error = await useConnectionStore
      .getState()
      .testConnection(connection());

    expect(error).toBe("connection refused");
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeConnectionId).toBeNull();
    expect(useConnectionStore.getState().isConnected).toBe(false);
  });

  it("activates a connection only through connect", async () => {
    const config = connection();

    const error = await useConnectionStore.getState().connect(config);

    expect(error).toBeNull();
    expect(mocks.connect).toHaveBeenCalledWith(
      "postgres-1",
      "postgres",
      expect.stringContaining("localhost"),
      undefined
    );
    expect(useConnectionStore.getState().activeConnectionId).toBe("postgres-1");
    expect(useConnectionStore.getState().connectedConnectionIds).toEqual([
      "postgres-1",
    ]);
    expect(useConnectionStore.getState().isConnected).toBe(true);
  });

  it("keeps previous backend connections open after a successful switch", async () => {
    useConnectionStore.setState({
      connections: [
        connection({ id: "postgres-1", name: "Postgres" }),
        connection({
          id: "mysql-1",
          name: "MySQL",
          driver: "mysql",
          port: 3306,
        }),
      ],
      activeConnectionId: "postgres-1",
      connectedConnectionIds: ["postgres-1"],
      isConnected: true,
    });

    const error = await useConnectionStore.getState().connect(
      connection({
        id: "mysql-1",
        name: "MySQL",
        driver: "mysql",
        port: 3306,
      })
    );

    expect(error).toBeNull();
    expect(mocks.connect).toHaveBeenCalledWith(
      "mysql-1",
      "mysql",
      expect.stringContaining("localhost"),
      undefined
    );
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeConnectionId).toBe("mysql-1");
    expect(useConnectionStore.getState().connectedConnectionIds).toEqual([
      "postgres-1",
      "mysql-1",
    ]);
    expect(useConnectionStore.getState().isConnected).toBe(true);
  });

  it("supplies driver default icons when creating or editing legacy connections", () => {
    useConnectionStore.setState({
      connections: [connection({ id: "redis-1", driver: "redis", icon: undefined })],
    });

    useConnectionStore.getState().selectConnection("redis-1");
    expect(useConnectionStore.getState().selectedConnection?.icon).toBe("KeyRound");

    const created = useConnectionStore.getState().createNewConnection();
    expect(created.icon).toBe("Database");
  });

  it("passes enabled SSH tunnel settings without rewriting the saved database URL", async () => {
    const config = connection({
      connectionUrl: "postgres://postgres:secret@db.internal:5432/app",
      sshTunnel: {
        enabled: true,
        host: "bastion.example.com",
        port: 22,
        username: "deploy",
        authMethod: "privateKey",
        privateKeyPath: "C:/Users/test/.ssh/id_ed25519",
        strictHostKeyChecking: true,
      },
    });

    await expect(useConnectionStore.getState().testConnection(config)).resolves.toBeNull();

    expect(mocks.testConnection).toHaveBeenCalledWith(
      "postgres",
      "postgres://postgres:secret@db.internal:5432/app",
      config.sshTunnel
    );
    expect(config.connectionUrl).toContain("db.internal");
    expect(config.connectionUrl).not.toContain("127.0.0.1");
  });

  it("keeps the previous active connection when a switch fails", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("login failed"));
    useConnectionStore.setState({
      connections: [connection({ id: "postgres-1", name: "Postgres" })],
      activeConnectionId: "postgres-1",
      connectedConnectionIds: ["postgres-1"],
      isConnected: true,
    });

    const error = await useConnectionStore
      .getState()
      .connect(connection({ id: "mysql-1", driver: "mysql", port: 3306 }));

    expect(error).toBe("login failed");
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeConnectionId).toBe("postgres-1");
    expect(useConnectionStore.getState().connectedConnectionIds).toEqual([
      "postgres-1",
    ]);
    expect(useConnectionStore.getState().isConnected).toBe(true);
  });

  it("does not issue a frontend disconnect when reconnecting the same id", async () => {
    useConnectionStore.setState({
      connections: [connection({ id: "postgres-1", name: "Postgres" })],
      activeConnectionId: "postgres-1",
      connectedConnectionIds: ["postgres-1"],
      isConnected: true,
    });

    const error = await useConnectionStore.getState().connect(connection());

    expect(error).toBeNull();
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeConnectionId).toBe("postgres-1");
    expect(useConnectionStore.getState().connectedConnectionIds).toEqual([
      "postgres-1",
    ]);
    expect(useConnectionStore.getState().isConnected).toBe(true);
  });

  it("activates an already connected data source without reconnecting", async () => {
    useConnectionStore.setState({
      connections: [
        connection({ id: "postgres-1", name: "Postgres" }),
        connection({
          id: "mysql-1",
          name: "MySQL",
          driver: "mysql",
          port: 3306,
        }),
      ],
      activeConnectionId: "postgres-1",
      connectedConnectionIds: ["postgres-1", "mysql-1"],
      isConnected: true,
    });

    const error = await useConnectionStore
      .getState()
      .setActiveConnection("mysql-1");

    expect(error).toBeNull();
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeConnectionId).toBe("mysql-1");
  });

  it("selects an uncached source immediately while its connection is pending", async () => {
    const pending = deferred();
    mocks.connect.mockReturnValueOnce(pending.promise);
    useConnectionStore.setState({
      connections: [
        connection({ id: "postgres-1" }),
        connection({ id: "redis-1", driver: "redis", database: "0" }),
      ],
      activeConnectionId: "postgres-1",
      connectedConnectionIds: ["postgres-1"],
      isConnected: true,
    });

    const switching = useConnectionStore.getState().setActiveConnection("redis-1");
    expect(useConnectionStore.getState()).toMatchObject({
      activeConnectionId: "redis-1",
      isConnected: false,
    });

    pending.resolve();
    await expect(switching).resolves.toBeNull();
    expect(useConnectionStore.getState()).toMatchObject({
      activeConnectionId: "redis-1",
      isConnected: true,
    });
  });

  it("shares one pending connect within the same project and connection scope", async () => {
    const pending = deferred();
    localStorage.setItem("oxide-studio-active-project", "project-a");
    mocks.connect.mockReturnValueOnce(pending.promise);
    useConnectionStore.setState({
      connections: [connection({ projectId: "project-a" })],
      activeConnectionId: null,
      connectedConnectionIds: [],
      isConnected: false,
    });

    const first = useConnectionStore
      .getState()
      .setActiveConnection("postgres-1");
    const second = useConnectionStore
      .getState()
      .setActiveConnection("postgres-1");

    expect(second).toBe(first);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(useConnectionStore.getState()).toMatchObject({
      activeConnectionId: "postgres-1",
      isConnected: false,
    });

    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    pending.resolve();
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(useConnectionStore.getState()).toMatchObject({
      activeConnectionId: "postgres-1",
      connectedConnectionIds: ["postgres-1"],
      isConnected: true,
    });
  });

  it("does not share a pending connect across projects with the same connection id", async () => {
    const projectAConnect = deferred();
    const projectBConnect = deferred();
    mocks.connect
      .mockReturnValueOnce(projectAConnect.promise)
      .mockReturnValueOnce(projectBConnect.promise);

    localStorage.setItem("oxide-studio-active-project", "project-a");
    useConnectionStore.setState({
      connections: [connection({ projectId: "project-a" })],
      activeConnectionId: null,
      connectedConnectionIds: [],
      isConnected: false,
    });
    const projectA = useConnectionStore
      .getState()
      .setActiveConnection("postgres-1");

    localStorage.setItem("oxide-studio-active-project", "project-b");
    useConnectionStore.setState({
      connections: [connection({ projectId: "project-b" })],
      activeConnectionId: null,
      connectedConnectionIds: [],
      isConnected: false,
    });
    const projectB = useConnectionStore
      .getState()
      .setActiveConnection("postgres-1");

    expect(projectB).not.toBe(projectA);
    expect(mocks.connect).toHaveBeenCalledTimes(2);

    projectBConnect.resolve();
    await expect(projectB).resolves.toBeNull();
    expect(useConnectionStore.getState()).toMatchObject({
      activeConnectionId: "postgres-1",
      connectedConnectionIds: ["postgres-1"],
      isConnected: true,
    });

    projectAConnect.resolve();
    await expect(projectA).resolves.toBeNull();
    expect(useConnectionStore.getState()).toMatchObject({
      activeConnectionId: "postgres-1",
      connectedConnectionIds: ["postgres-1"],
      isConnected: true,
    });
  });

  it("loads and saves connections inside the active project scope", async () => {
    localStorage.setItem("oxide-studio-active-project", "project-a");
    mocks.loadConnections.mockResolvedValueOnce([
      connection({ id: "postgres-1", projectId: "project-a" }),
    ]);

    await useConnectionStore.getState().loadConnections();

    expect(mocks.loadConnections).toHaveBeenCalledWith("project-a");
    expect(useConnectionStore.getState().connections).toEqual([
      expect.objectContaining({ id: "postgres-1", projectId: "project-a" }),
    ]);

    await useConnectionStore
      .getState()
      .saveConnection(connection({ id: "mysql-1", driver: "mysql", port: 3306 }));

    expect(mocks.saveConnections).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "postgres-1", projectId: "project-a" }),
        expect.objectContaining({ id: "mysql-1", projectId: "project-a" }),
      ]),
      "project-a"
    );
  });

  it("removes a saved data source and disconnects it when active", async () => {
    localStorage.setItem("oxide-studio-active-project", "project-a");
    const postgres = connection({ projectId: "project-a" });
    const mysql = connection({
      id: "mysql-1",
      name: "MySQL",
      driver: "mysql",
      port: 3306,
      projectId: "project-a",
    });
    useConnectionStore.setState({
      connections: [postgres, mysql],
      activeConnectionId: postgres.id,
      connectedConnectionIds: [postgres.id, mysql.id],
      isConnected: true,
      selectedConnection: postgres,
    });

    await useConnectionStore.getState().removeConnection(postgres.id);

    expect(mocks.disconnect).toHaveBeenCalledWith(postgres.id);
    expect(mocks.deleteConnection).toHaveBeenCalledWith(
      postgres.id,
      "project-a"
    );
    expect(useConnectionStore.getState()).toEqual(
      expect.objectContaining({
        connections: [mysql],
        activeConnectionId: mysql.id,
        connectedConnectionIds: [mysql.id],
        isConnected: true,
        selectedConnection: null,
      })
    );
  });

  it("still removes a data source when disconnect cleanup fails", async () => {
    const postgres = connection();
    mocks.disconnect.mockRejectedValueOnce(new Error("already disconnected"));
    useConnectionStore.setState({
      connections: [postgres],
      activeConnectionId: postgres.id,
      connectedConnectionIds: [postgres.id],
      isConnected: true,
      selectedConnection: postgres,
    });

    await expect(
      useConnectionStore.getState().removeConnection(postgres.id)
    ).resolves.toBeUndefined();

    expect(mocks.deleteConnection).toHaveBeenCalledWith(postgres.id, "sqls");
    expect(useConnectionStore.getState()).toEqual(
      expect.objectContaining({
        connections: [],
        activeConnectionId: null,
        connectedConnectionIds: [],
        isConnected: false,
        selectedConnection: null,
      })
    );
  });

  it("removes the data source from the visible state before persistence finishes", async () => {
    const postgres = connection();
    const deletion = deferred();
    mocks.deleteConnection.mockReturnValueOnce(deletion.promise);
    useConnectionStore.setState({
      connections: [postgres],
      activeConnectionId: postgres.id,
      connectedConnectionIds: [postgres.id],
      isConnected: true,
      selectedConnection: postgres,
    });

    const removal = useConnectionStore.getState().removeConnection(postgres.id);
    expect(useConnectionStore.getState().connections).toEqual([]);

    deletion.resolve();
    await removal;
  });

  it("restores the data source when persistent deletion fails", async () => {
    const postgres = connection();
    mocks.deleteConnection.mockRejectedValueOnce(new Error("delete failed"));
    useConnectionStore.setState({
      connections: [postgres],
      activeConnectionId: postgres.id,
      connectedConnectionIds: [postgres.id],
      isConnected: true,
      selectedConnection: postgres,
    });

    await expect(
      useConnectionStore.getState().removeConnection(postgres.id)
    ).rejects.toThrow("delete failed");
    expect(useConnectionStore.getState().connections).toEqual([postgres]);
  });

  it("ignores older connection attempts that finish after a newer switch", async () => {
    const postgresConnect = deferred();
    const mysqlConnect = deferred();
    mocks.connect.mockImplementation((id: string) => {
      if (id === "postgres-1") return postgresConnect.promise;
      if (id === "mysql-1") return mysqlConnect.promise;
      return Promise.resolve();
    });

    const first = useConnectionStore.getState().connect(connection());
    const second = useConnectionStore.getState().connect(
      connection({
        id: "mysql-1",
        name: "MySQL",
        driver: "mysql",
        port: 3306,
      })
    );

    mysqlConnect.resolve();
    await expect(second).resolves.toBeNull();
    expect(useConnectionStore.getState().activeConnectionId).toBe("mysql-1");

    postgresConnect.resolve();
    await expect(first).resolves.toBeNull();

    expect(useConnectionStore.getState().activeConnectionId).toBe("mysql-1");
    expect(useConnectionStore.getState().isConnected).toBe(true);
    expect(mocks.disconnect).toHaveBeenCalledWith("postgres-1");
    expect(mocks.disconnect).not.toHaveBeenCalledWith("mysql-1");
  });
});
