import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultDatabaseCapabilities,
  registerRuntimeDatabaseCatalog,
  resetRuntimeDatabaseCatalogForTests,
  supportedDatabaseDrivers,
} from "@/lib/databaseDialect";
import {
  resetDatabaseDriverCatalogStoreForTests,
  useDatabaseDriverCatalogStore,
} from "@/store/useDatabaseDriverCatalogStore";

const mocks = vi.hoisted(() => ({
  listDatabaseCapabilities: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  databaseService: {
    listDatabaseCapabilities: mocks.listDatabaseCapabilities,
  },
}));

function resetCatalog() {
  resetRuntimeDatabaseCatalogForTests();
  resetDatabaseDriverCatalogStoreForTests();
}

describe("runtime database driver catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCatalog();
  });

  it("uses the backend list as the authoritative create/AI driver catalog", () => {
    registerRuntimeDatabaseCatalog([
      defaultDatabaseCapabilities("postgres"),
      defaultDatabaseCapabilities("redis"),
    ]);

    expect(supportedDatabaseDrivers()).toEqual(["postgres", "redis"]);
    expect(defaultDatabaseCapabilities("mysql").displayName).toBe("MySQL");
  });

  it("exposes a backend-advertised driver even before a custom UI profile exists", () => {
    registerRuntimeDatabaseCatalog([
      {
        ...defaultDatabaseCapabilities("postgres"),
        driver: "analyticsdb",
        displayName: "AnalyticsDB",
        defaultPort: 19000,
      },
    ]);

    expect(supportedDatabaseDrivers()).toEqual(["analyticsdb"]);
  });

  it("hydrates shared UI profiles without gating the application shell", async () => {
    mocks.listDatabaseCapabilities.mockResolvedValue([
      defaultDatabaseCapabilities("mysql"),
      defaultDatabaseCapabilities("mongodb"),
    ]);

    await useDatabaseDriverCatalogStore.getState().load();

    expect(useDatabaseDriverCatalogStore.getState()).toMatchObject({
      status: "ready",
      error: null,
    });
    expect(
      useDatabaseDriverCatalogStore
        .getState()
        .profiles.map((profile) => profile.driver),
    ).toEqual(["mysql", "mongodb"]);
  });

  it("keeps bundled profiles available when runtime discovery fails", async () => {
    mocks.listDatabaseCapabilities.mockRejectedValue(
      new Error("command unavailable"),
    );

    await useDatabaseDriverCatalogStore.getState().load();

    const state = useDatabaseDriverCatalogStore.getState();
    expect(state.status).toBe("fallback");
    expect(state.error).toBe("command unavailable");
    expect(state.profiles.map((profile) => profile.driver)).toEqual(
      expect.arrayContaining([
        "postgres",
        "mysql",
        "redis",
        "mongodb",
        "elasticsearch",
      ]),
    );
  });
});
