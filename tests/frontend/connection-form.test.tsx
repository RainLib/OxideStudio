/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionForm } from "@/components/connection/ConnectionForm";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { useConnectionStore, type ConnectionConfig } from "@/store/useConnectionStore";

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
    button.textContent?.includes(text)
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
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      await flushAsyncWork();
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "postgres-1" })
    );
    expect(saveConnection).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });
});
