/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriverManagementSettings } from "./DriverManagementSettings";

const service = vi.hoisted(() => ({
  listDatabaseDriverInstallations: vi.fn(),
  listManagedJavaRuntimes: vi.fn(),
  getDatabaseDriverStoreInfo: vi.fn(),
  listExternalDatabaseDriverRuntimes: vi.fn(),
  reconnectExternalDatabaseDriverRuntimes: vi.fn(),
}));
vi.mock("@/services/tauri/database.service", () => ({
  databaseService: service,
}));

describe("Driver Management settings composition", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  beforeEach(() => {
    vi.resetAllMocks();
    service.listDatabaseDriverInstallations.mockResolvedValue([]);
    service.listManagedJavaRuntimes.mockResolvedValue([]);
    service.getDatabaseDriverStoreInfo.mockResolvedValue({
      activePath: "/drivers",
    });
    service.listExternalDatabaseDriverRuntimes.mockResolvedValue([]);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  async function render() {
    await act(async () => {
      root!.render(<DriverManagementSettings />);
    });
  }

  it("renders inventory errors without hiding runtime health", async () => {
    service.listDatabaseDriverInstallations.mockRejectedValue(
      new Error("Inventory unavailable"),
    );
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Inventory unavailable",
    );
    expect(service.listExternalDatabaseDriverRuntimes).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[aria-label="Loading database drivers"]'),
    ).toBeNull();
  });

  it("reconnects the selected exited runtime and renders the refreshed result", async () => {
    service.listExternalDatabaseDriverRuntimes.mockResolvedValue([
      {
        driver: "oracle",
        packageVersion: "23.3.0",
        connectionCount: 1,
        processIds: [],
        unavailableProcessCount: 0,
        unhealthyConnectionCount: 1,
        observedExitCount: 1,
        reconnectAttemptCount: 0,
        reconnectAvailable: true,
      },
    ]);
    service.reconnectExternalDatabaseDriverRuntimes.mockResolvedValue({
      reconnectedCount: 1,
    });
    await render();
    const reconnect = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Reconnect exited",
    );
    expect(reconnect).toBeDefined();
    service.listExternalDatabaseDriverRuntimes.mockResolvedValue([]);
    await act(async () => reconnect!.click());
    expect(
      service.reconnectExternalDatabaseDriverRuntimes,
    ).toHaveBeenCalledExactlyOnceWith("oracle", "23.3.0");
    expect(service.listExternalDatabaseDriverRuntimes).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain(
      "Reconnected 1 exited driver runtime.",
    );
    expect(container.textContent).not.toContain("Reconnect exited");
  });

  it("releases the runtime health poll when the settings panel unmounts", async () => {
    const interval = vi.spyOn(window, "setInterval");
    const clear = vi.spyOn(window, "clearInterval");
    await render();
    const index = interval.mock.calls.findIndex(
      ([, delay]) => delay === 15_000,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const id = interval.mock.results[index]?.value;
    await act(async () => root!.unmount());
    root = null;
    expect(clear).toHaveBeenCalledWith(id);
  });
});
