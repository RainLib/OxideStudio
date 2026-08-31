/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionForm } from "@/components/connection/ConnectionForm";
import {
  defaultDatabaseCapabilities,
  resetRuntimeDatabaseCatalogForTests,
} from "@/lib/databaseDialect";
import {
  resetDatabaseDriverCatalogStoreForTests,
  useDatabaseDriverCatalogStore,
} from "@/store/useDatabaseDriverCatalogStore";
import {
  useConnectionStore,
  type ConnectionConfig,
} from "@/store/useConnectionStore";
import { useSettingsStore } from "@/store/useSettingsStore";

const mocks = vi.hoisted(() => ({
  listDatabaseCapabilities: vi.fn(),
  listDatabaseDriverInstallations: vi.fn(),
  getDatabaseCapabilities: vi.fn(),
  getExternalDatabaseDriverCatalog: vi.fn(),
  installExternalDatabaseDriverFromCatalog: vi.fn(),
  connectionService: {
    connect: vi.fn(),
    testConnection: vi.fn(),
    disconnect: vi.fn(),
    loadConnections: vi.fn(),
    saveConnections: vi.fn(),
  },
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    listDatabaseCapabilities: mocks.listDatabaseCapabilities,
    listDatabaseDriverInstallations: mocks.listDatabaseDriverInstallations,
    getDatabaseCapabilities: mocks.getDatabaseCapabilities,
    getExternalDatabaseDriverCatalog: mocks.getExternalDatabaseDriverCatalog,
    installExternalDatabaseDriverFromCatalog:
      mocks.installExternalDatabaseDriverFromCatalog,
  },
  connectionService: mocks.connectionService,
}));

const initialConnectionState = useConnectionStore.getState();
const initialSettingsState = useSettingsStore.getState();

function selectedConnection(): ConnectionConfig {
  return {
    id: "postgres-1",
    name: "Postgres",
    driver: "postgres",
    url: "",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "postgres",
    database: "postgres",
    sslMode: "disable",
    tags: [],
  };
}

function buttonWithText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  );
}

async function flushAsyncWork() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe("ConnectionForm", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let testConnection: ReturnType<typeof vi.fn>;
  let saveConnection: ReturnType<typeof vi.fn>;
  let connect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeDatabaseCatalogForTests();
    resetDatabaseDriverCatalogStoreForTests();
    mocks.listDatabaseCapabilities.mockResolvedValue([
      defaultDatabaseCapabilities("postgres"),
    ]);
    mocks.listDatabaseDriverInstallations.mockResolvedValue([]);
    mocks.getDatabaseCapabilities.mockResolvedValue(
      defaultDatabaseCapabilities("postgres"),
    );
    testConnection = vi.fn(async () => null);
    saveConnection = vi.fn(async () => undefined);
    connect = vi.fn(async () => null);
    container = document.createElement("div");
    document.body.appendChild(container);

    useConnectionStore.setState({
      ...initialConnectionState,
      connections: [selectedConnection()],
      selectedConnection: selectedConnection(),
      activeConnectionId: null,
      isConnected: false,
      isLoading: false,
      testConnection,
      saveConnection,
      connect,
      updateConnectionConfig: vi.fn(),
    });
    useSettingsStore.setState({
      ...initialSettingsState,
      settings: {
        ...initialSettingsState.settings,
        drivers: {
          ...initialSettingsState.settings.drivers,
          catalogUrl: "",
        },
      },
      updateSettings: vi.fn(async () => undefined),
    });
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
    useConnectionStore.setState(initialConnectionState, true);
    useSettingsStore.setState(initialSettingsState, true);
  });

  it("keeps testing as a non-submit action without saving or connecting", async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const form = document.createElement("form");
    form.addEventListener("submit", onSubmit);
    container.appendChild(form);
    root = createRoot(form);

    await act(async () => {
      root?.render(<ConnectionForm />);
      await flushAsyncWork();
    });

    const testButton = buttonWithText(form, "Test Connection");
    expect(testButton).toBeTruthy();
    expect(testButton?.getAttribute("type")).toBe("button");

    await act(async () => {
      testButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "postgres-1" }),
    );
    expect(saveConnection).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("renders connection test errors without saving or connecting", async () => {
    testConnection.mockResolvedValueOnce("connection refused");
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const form = document.createElement("form");
    form.addEventListener("submit", onSubmit);
    container.appendChild(form);
    root = createRoot(form);

    await act(async () => {
      root?.render(<ConnectionForm />);
      await flushAsyncWork();
    });

    const testButton = buttonWithText(form, "Test Connection");

    await act(async () => {
      testButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
    });

    expect(form.textContent).toContain("connection refused");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(saveConnection).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("uses the connection-pinned package capability while keeping credentials for drivers without a database URL segment", async () => {
    const connection = selectedConnection();
    connection.driverPackageVersion = "2.4.0";
    useConnectionStore.setState({ selectedConnection: connection });
    mocks.getDatabaseCapabilities.mockResolvedValueOnce({
      ...defaultDatabaseCapabilities("postgres"),
      supportsConnectionDatabase: false,
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<ConnectionForm />);
      await flushAsyncWork();
    });

    expect(mocks.getDatabaseCapabilities).toHaveBeenCalledWith(
      "postgres",
      "2.4.0",
    );
    expect(container.querySelector("#connection-database")).toBeNull();
    expect(container.querySelector("#connection-user")).not.toBeNull();
    expect(container.querySelector("#connection-password")).not.toBeNull();
  });

  it("does not offer a JDBC package that has no verified managed runtime", async () => {
    mocks.listDatabaseDriverInstallations.mockResolvedValue([
      {
        driver: "postgres",
        displayName: "PostgreSQL JDBC",
        clientLibrary: "pgjdbc",
        clientVersion: "42.7",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: "declared-by-package",
        implementation: "isolated JDBC driver sidecar",
        packageVersion: "42.7.0",
        protocolVersion: "1.0",
        active: true,
        status: "ready",
        runtimeReady: false,
      },
    ]);

    await act(async () => {
      root = createRoot(container);
      root.render(<ConnectionForm />);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("needs a signed Java runtime");
    expect(container.textContent).not.toContain("Active package (recommended)");
  });

  it("keeps an uninstalled catalogue product discoverable but blocks connection actions", async () => {
    useConnectionStore.setState({
      connections: [],
      selectedConnection: {
        ...selectedConnection(),
        driver: "oracle",
        name: "Oracle",
        port: 1521,
      },
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<ConnectionForm />);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Oracle Database needs a signed driver package");
    expect(buttonWithText(container, "Test Connection")?.disabled).toBe(true);
    expect(buttonWithText(container, "Install package…")).toBeTruthy();
    expect(buttonWithText(container, "Download from catalog…")).toBeTruthy();

    await act(async () => {
      buttonWithText(container, "Download from catalog…")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(
      container.querySelector("#connection-driver-catalog-url"),
    ).not.toBeNull();
    expect(buttonWithText(container, "Download & install")).toBeTruthy();
  });

  it("downloads a missing signed driver from the connection page", async () => {
    useConnectionStore.setState({
      connections: [],
      selectedConnection: {
        ...selectedConnection(),
        driver: "oracle",
        name: "Oracle",
        port: 1521,
      },
    });
    mocks.getExternalDatabaseDriverCatalog.mockResolvedValue({
      sourceUrl: "https://drivers.example.com/catalog.json",
      catalog: {
        packages: [
          {
            driverId: "oracle",
            packageVersion: "23.0.0",
            archiveSha256: "a".repeat(64),
          },
        ],
      },
    });
    mocks.installExternalDatabaseDriverFromCatalog.mockResolvedValue({
      displayName: "Oracle Database",
      packageVersion: "23.0.0",
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<ConnectionForm />);
      await flushAsyncWork();
    });
    await act(async () => {
      buttonWithText(container, "Download from catalog…")?.click();
    });
    const input = container.querySelector<HTMLInputElement>(
      "#connection-driver-catalog-url",
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "https://drivers.example.com/catalog.json");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      buttonWithText(container, "Download & install")?.click();
      await flushAsyncWork();
    });

    expect(mocks.getExternalDatabaseDriverCatalog).toHaveBeenCalledWith(
      "https://drivers.example.com/catalog.json",
    );
    expect(mocks.installExternalDatabaseDriverFromCatalog).toHaveBeenCalledWith(
      "https://drivers.example.com/catalog.json",
      "oracle",
      "23.0.0",
      true,
    );
    expect(useSettingsStore.getState().updateSettings).toHaveBeenCalledWith({
      drivers: {
        catalogUrl: "https://drivers.example.com/catalog.json",
        sqliteWorkerBaseUrl: "",
        storePath: initialSettingsState.settings.drivers.storePath,
      },
    });
  });

  it("refreshes selectable package pins after the driver catalog refreshes", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<ConnectionForm />);
      await flushAsyncWork();
    });
    const callsBeforeRefresh = mocks.listDatabaseDriverInstallations.mock.calls.length;

    await act(async () => {
      useDatabaseDriverCatalogStore.setState({ status: "loading" });
      await flushAsyncWork();
      useDatabaseDriverCatalogStore.setState({ status: "ready" });
      await flushAsyncWork();
    });

    expect(mocks.listDatabaseDriverInstallations.mock.calls.length).toBeGreaterThan(
      callsBeforeRefresh,
    );
  });

  it("invalidates an imported URL when a connection field changes", async () => {
    const updateConnectionConfig = vi.fn();
    useConnectionStore.setState({ updateConnectionConfig });

    await act(async () => {
      root = createRoot(container);
      root?.render(<ConnectionForm />);
      await flushAsyncWork();
    });

    const hostInput =
      container.querySelector<HTMLInputElement>("#connection-host");
    expect(hostInput).toBeTruthy();

    await act(async () => {
      if (!hostInput) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(hostInput, "database.internal");
      hostInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(updateConnectionConfig).toHaveBeenCalledWith({
      host: "database.internal",
      connectionUrl: "",
    });
  });

  it("renders and updates SSH tunnel settings without invalidating the database URL", async () => {
    const updateConnectionConfig = vi.fn();
    const connection = selectedConnection();
    connection.connectionUrl = "postgres://postgres:postgres@db.internal/app";
    connection.sshTunnel = {
      enabled: true,
      host: "bastion.example.com",
      port: 22,
      username: "deploy",
      authMethod: "password",
      password: "ssh-secret",
      strictHostKeyChecking: true,
    };
    useConnectionStore.setState({
      selectedConnection: connection,
      updateConnectionConfig,
    });

    await act(async () => {
      root = createRoot(container);
      root?.render(<ConnectionForm />);
      await flushAsyncWork();
    });

    await act(async () => {
      buttonWithText(container, "SSH/SSL")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    const sshHost = container.querySelector<HTMLInputElement>("#ssh-host");
    const sshPassword =
      container.querySelector<HTMLInputElement>("#ssh-password");
    expect(sshHost?.value).toBe("bastion.example.com");
    expect(sshPassword?.type).toBe("password");

    await act(async () => {
      if (!sshHost) return;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(sshHost, "jump.internal");
      sshHost.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(updateConnectionConfig).toHaveBeenCalledWith({
      sshTunnel: expect.objectContaining({
        enabled: true,
        host: "jump.internal",
        username: "deploy",
      }),
    });
    expect(updateConnectionConfig).not.toHaveBeenCalledWith(
      expect.objectContaining({ connectionUrl: "" }),
    );

    await act(async () => {
      buttonWithText(container, "Add jump host")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await flushAsyncWork();
    });

    expect(updateConnectionConfig).toHaveBeenCalledWith({
      sshTunnel: expect.objectContaining({
        jumpHosts: [
          expect.objectContaining({
            host: "",
            port: 22,
            username: "",
            authMethod: "password",
            strictHostKeyChecking: true,
          }),
        ],
      }),
    });
  });

  it("shows the database brand by default and edits appearance from General", async () => {
    const updateConnectionConfig = vi.fn();
    useConnectionStore.setState({ updateConnectionConfig });

    await act(async () => {
      root = createRoot(container);
      root.render(<ConnectionForm />);
      await flushAsyncWork();
    });

    expect(
      container.querySelectorAll('[data-database-brand="postgres"]').length,
    ).toBeGreaterThanOrEqual(2);

    await act(async () => {
      buttonWithText(container, "Appearance")?.click();
      await flushAsyncWork();
    });
    expect(
      document.body
        .querySelector('button[title="Database default"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('button[title="KeyRound"]')
        ?.click();
      document.body
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Connection color #d95b5b"]',
        )
        ?.click();
    });

    expect(updateConnectionConfig).toHaveBeenCalledWith({ icon: "KeyRound" });
    expect(updateConnectionConfig).toHaveBeenCalledWith({ color: "#d95b5b" });
  });

  it("keeps connection backgrounds unset by default and can clear a chosen color", async () => {
    const updateConnectionConfig = vi.fn();
    useConnectionStore.setState({ updateConnectionConfig });

    await act(async () => {
      root = createRoot(container);
      root.render(<ConnectionForm />);
      await flushAsyncWork();
    });

    await act(async () => {
      buttonWithText(container, "Appearance")?.click();
      await flushAsyncWork();
    });

    const noColor = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="No connection background color"]',
    );
    expect(noColor?.getAttribute("aria-checked")).toBe("true");

    await act(async () => noColor?.click());
    expect(updateConnectionConfig).toHaveBeenCalledWith({ color: undefined });
  });
});
