import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useConnectionStore,
  type ConnectionConfig,
} from "@/store/useConnectionStore";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  loadConnections: vi.fn(async () => []),
  saveConnections: vi.fn(async () => undefined),
  testConnection: vi.fn(async () => undefined),
}));

vi.mock("@/services/tauri", () => ({
  connectionService: {
    connect: mocks.connect,
    disconnect: mocks.disconnect,
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

describe("connection store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      connections: [],
      activeConnectionId: null,
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
      expect.stringContaining("localhost")
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
      expect.stringContaining("localhost")
    );
    expect(useConnectionStore.getState().activeConnectionId).toBe("postgres-1");
    expect(useConnectionStore.getState().isConnected).toBe(true);
  });

  it("disconnects the previous active backend connection after a successful switch", async () => {
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
      expect.stringContaining("localhost")
    );
    expect(mocks.disconnect).toHaveBeenCalledWith("postgres-1");
    expect(useConnectionStore.getState().activeConnectionId).toBe("mysql-1");
    expect(useConnectionStore.getState().isConnected).toBe(true);
  });

  it("keeps the previous active connection when a switch fails", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("login failed"));
    useConnectionStore.setState({
      connections: [connection({ id: "postgres-1", name: "Postgres" })],
      activeConnectionId: "postgres-1",
      isConnected: true,
    });

    const error = await useConnectionStore
      .getState()
      .connect(connection({ id: "mysql-1", driver: "mysql", port: 3306 }));

    expect(error).toBe("login failed");
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeConnectionId).toBe("postgres-1");
    expect(useConnectionStore.getState().isConnected).toBe(true);
  });

  it("does not issue a frontend disconnect when reconnecting the same id", async () => {
    useConnectionStore.setState({
      connections: [connection({ id: "postgres-1", name: "Postgres" })],
      activeConnectionId: "postgres-1",
      isConnected: true,
    });

    const error = await useConnectionStore.getState().connect(connection());

    expect(error).toBeNull();
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().activeConnectionId).toBe("postgres-1");
    expect(useConnectionStore.getState().isConnected).toBe(true);
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
