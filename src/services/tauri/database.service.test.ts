import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeWithInterceptors } = vi.hoisted(() => ({
  invokeWithInterceptors: vi.fn(),
}));

vi.mock("./client", () => ({ invokeWithInterceptors }));

import {
  executeDatabaseMaintenance,
  getDatabaseAdminServerIdentity,
  previewDatabaseMaintenance,
} from "./database.service";

describe("database administration service", () => {
  beforeEach(() => {
    invokeWithInterceptors.mockReset();
  });

  it("asks the host to confirm identity for the selected live connection", async () => {
    invokeWithInterceptors.mockResolvedValue({
      driver: "postgres",
      database: "warehouse",
      account: "operator",
      serverVersion: "16.4",
    });

    await expect(
      getDatabaseAdminServerIdentity("connection-1", "postgres"),
    ).resolves.toMatchObject({ database: "warehouse" });
    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "get_database_admin_server_identity",
      { connectionId: "connection-1", driver: "postgres" },
    );
  });

  it("keeps maintenance preview and execution behind typed host commands", async () => {
    const maintenance = {
      database: "warehouse",
      schema: "public",
      table: "events",
      operation: "vacuumFull" as const,
    };
    invokeWithInterceptors
      .mockResolvedValueOnce({
        target: "warehouse.public.events",
        confirmationToken: "sha256:plan",
      })
      .mockResolvedValueOnce("Maintenance completed");

    await previewDatabaseMaintenance("connection-1", "postgres", maintenance);
    await executeDatabaseMaintenance("connection-1", "postgres", {
      maintenance,
      confirmationToken: "sha256:plan",
      confirmationText: "VACUUM FULL warehouse.public.events",
    });

    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      1,
      "preview_database_maintenance",
      { connectionId: "connection-1", driver: "postgres", request: maintenance },
    );
    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      2,
      "execute_database_maintenance",
      {
        connectionId: "connection-1",
        driver: "postgres",
        request: {
          maintenance,
          confirmationToken: "sha256:plan",
          confirmationText: "VACUUM FULL warehouse.public.events",
        },
      },
    );
  });
});
