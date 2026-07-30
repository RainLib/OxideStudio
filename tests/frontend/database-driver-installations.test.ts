import { beforeEach, describe, expect, it, vi } from "vitest";
import { databaseService } from "@/services/tauri/database.service";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/services/tauri/client", () => ({
  invokeWithInterceptors: mocks.invoke,
}));

describe("database driver installation inventory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the backend-reported client versions and update boundary", async () => {
    mocks.invoke.mockResolvedValue([
      {
        driver: "postgres",
        displayName: "PostgreSQL",
        clientLibrary: "sqlx-postgres",
        clientVersion: "0.8.6",
        distribution: "bundled",
        updatePolicy: "application-update",
        independentlyUpdatable: false,
        serverVersionPolicy: "detected-at-connection",
        implementation: "native Rust client",
      },
    ]);

    const installations =
      await databaseService.listDatabaseDriverInstallations();

    expect(mocks.invoke).toHaveBeenCalledWith(
      "list_database_driver_installations",
    );
    expect(installations[0]).toMatchObject({
      driver: "postgres",
      clientVersion: "0.8.6",
      independentlyUpdatable: false,
    });
  });
});
