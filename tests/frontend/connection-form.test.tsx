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
import { resetDatabaseDriverCatalogStoreForTests } from "@/store/useDatabaseDriverCatalogStore";
import {
  useConnectionStore,
  type ConnectionConfig,
} from "@/store/useConnectionStore";

const mocks = vi.hoisted(() => ({
  listDatabaseCapabilities: vi.fn(),
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
  },
  connectionService: mocks.connectionService,
}));

const initialConnectionState = useConnectionStore.getState();

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
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
    useConnectionStore.setState(initialConnectionState, true);
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
