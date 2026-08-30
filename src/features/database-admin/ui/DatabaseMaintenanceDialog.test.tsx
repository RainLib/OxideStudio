// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { previewDatabaseMaintenance, executeDatabaseMaintenance } = vi.hoisted(
  () => ({
    previewDatabaseMaintenance: vi.fn(),
    executeDatabaseMaintenance: vi.fn(),
  }),
);

vi.mock("@/services/tauri", () => ({
  databaseService: {
    previewDatabaseMaintenance,
    executeDatabaseMaintenance,
  },
}));

import { DatabaseMaintenanceDialog } from "./DatabaseMaintenanceDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("DatabaseMaintenanceDialog", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    previewDatabaseMaintenance.mockReset().mockResolvedValue({
      operation: "analyze",
      target: "warehouse.public.events",
      summary: "Refresh planner statistics",
      lockImpact: "Allows normal reads and writes.",
      risk: "low",
      requiresMaintenanceWindow: false,
      sqlPreview: 'ANALYZE "public"."events";',
      confirmationText: "ANALYZE warehouse.public.events",
      confirmationToken: "sha256:reviewed",
      connectedDriver: "postgres",
      serverVersion: "16.4",
    });
    executeDatabaseMaintenance.mockReset().mockResolvedValue(
      "Maintenance completed for warehouse.public.events",
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("requires the reviewed phrase before executing the exact host plan", async () => {
    await act(async () => {
      root.render(
        <DatabaseMaintenanceDialog
          open
          onOpenChange={() => undefined}
          target={{
            connectionId: "connection-1",
            connectionName: "Warehouse",
            driver: "postgres",
            database: "warehouse",
            schema: "public",
            table: "events",
          }}
        />,
      );
    });
    await flush();

    expect(previewDatabaseMaintenance).toHaveBeenCalledWith(
      "connection-1",
      "postgres",
      {
        database: "warehouse",
        schema: "public",
        table: "events",
        operation: "analyze",
      },
    );
    const runButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Run maintenance"),
    );
    expect(runButton).toBeTruthy();
    expect(runButton?.disabled).toBe(true);

    const confirmationInput = document.body.querySelector<HTMLInputElement>(
      'input[autocomplete="off"]',
    );
    expect(confirmationInput).toBeTruthy();
    await act(async () => {
      if (!confirmationInput) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        confirmationInput,
        "ANALYZE warehouse.public.events",
      );
      confirmationInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(runButton?.disabled).toBe(false);

    await act(async () => runButton?.click());
    await flush();
    expect(executeDatabaseMaintenance).toHaveBeenCalledWith(
      "connection-1",
      "postgres",
      {
        maintenance: {
          database: "warehouse",
          schema: "public",
          table: "events",
          operation: "analyze",
        },
        confirmationToken: "sha256:reviewed",
        confirmationText: "ANALYZE warehouse.public.events",
      },
    );
    expect(document.body.textContent).toContain(
      "Maintenance completed for warehouse.public.events",
    );
  });
});
