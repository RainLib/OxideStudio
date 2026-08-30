import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeWithInterceptors } = vi.hoisted(() => ({
  invokeWithInterceptors: vi.fn(),
}));

vi.mock("./client", () => ({ invokeWithInterceptors }));

import { getDatabaseAdminServerIdentity } from "./database.service";

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
});
