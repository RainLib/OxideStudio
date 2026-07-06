import { describe, expect, it } from "vitest";
import { registerCoreAiTools } from "@/ai/tools/coreTools";
import { createAiToolRegistry } from "@/ai/tools/registry";
import {
  databaseDriverProfile,
  defaultDatabaseCapabilities,
  type DatabaseDriverProfile,
} from "@/lib/databaseDialect";
import {
  createDatabaseProviderLoaders,
  discoverDatabaseProviderLoaders,
  loadDatabaseProviderPackages,
  loadDatabaseProviders,
  type DatabaseProviderModule,
} from "@/providers";
import type { AiToolAdapters } from "@/ai/tools/types";
import type { DatabaseDriver } from "@/services/tauri/types";

function profile(driver: DatabaseDriver, displayName: string): DatabaseDriverProfile {
  const base = defaultDatabaseCapabilities("postgres");
  return {
    driver,
    menuLabel: displayName,
    defaultDatabase: "main",
    urlScheme: String(driver),
    protocolAliases: [String(driver)],
    sslModeParamName: "ssl",
    sslModeParamAliases: ["ssl"],
    defaultIcon: "Database",
    iconClassName: "text-muted-foreground",
    defaultAccentClassName: "bg-muted text-muted-foreground",
    capabilities: {
      ...base,
      displayName,
      lspLanguageId: "postgres",
      namespaceLabel: "schema",
      defaultPort: 18000,
    },
  };
}

function adapters(): AiToolAdapters {
  return {
    listConnections: () => [],
    getConnectionCapabilities: (driver) => defaultDatabaseCapabilities(driver),
  };
}

describe("database provider loader", () => {
  it("loads provider modules from deterministic module loaders", async () => {
    const primaryDriver = "loader_primary" as DatabaseDriver;
    const secondaryDriver = "loader_secondary" as DatabaseDriver;
    const modules: Record<string, () => Promise<DatabaseProviderModule>> = {
      "20-secondary": async () => ({
        providers: {
          id: "test.loader.secondary",
          displayName: "Loader Secondary",
          driverProfiles: [profile(secondaryDriver, "Loader Secondary")],
        },
      }),
      "10-primary": async () => ({
        default: {
          id: "test.loader.primary",
          displayName: "Loader Primary",
          driverProfiles: [profile(primaryDriver, "Loader Primary")],
        },
      }),
    };

    const result = await loadDatabaseProviders(
      createDatabaseProviderLoaders(modules)
    );

    expect(result).toEqual([
      {
        id: "10-primary",
        status: "loaded",
        providerIds: ["test.loader.primary"],
      },
      {
        id: "20-secondary",
        status: "loaded",
        providerIds: ["test.loader.secondary"],
      },
    ]);
    expect(databaseDriverProfile(primaryDriver).menuLabel).toBe("Loader Primary");
    expect(databaseDriverProfile(secondaryDriver).menuLabel).toBe(
      "Loader Secondary"
    );
  });

  it("continues loading providers when one module fails or exports no provider", async () => {
    const driver = "loader_after_failure" as DatabaseDriver;

    const result = await loadDatabaseProviders([
      {
        id: "empty",
        load: () => ({}) as DatabaseProviderModule,
      },
      {
        id: "broken",
        load: () => {
          throw new Error("module unavailable");
        },
      },
      {
        id: "working",
        load: () => ({
          default: {
            id: "test.loader.working",
            displayName: "Loader Working",
            driverProfiles: [profile(driver, "Loader Working")],
          },
        }),
      },
    ]);

    expect(result).toEqual([
      { id: "empty", status: "skipped", providerIds: [] },
      {
        id: "broken",
        status: "failed",
        providerIds: [],
        error: "module unavailable",
      },
      {
        id: "working",
        status: "loaded",
        providerIds: ["test.loader.working"],
      },
    ]);
    expect(databaseDriverProfile(driver).menuLabel).toBe("Loader Working");
  });

  it("includes dynamically loaded AI tool families in the shared registry", async () => {
    await loadDatabaseProviders([
      {
        id: "ai-tools",
        load: () => ({
          default: {
            id: "test.loader.ai-tools",
            displayName: "Loader AI Tools",
            aiToolFamilies: [
              {
                name: "test.loader.ai-tools",
                tools: [
                  () => ({
                    name: "loader.echo",
                    description: "Echo provider loader input.",
                    inputSchema: {
                      type: "object",
                      properties: {
                        value: { type: "string" },
                      },
                      required: ["value"],
                      additionalProperties: false,
                    },
                    permissions: ["read"],
                    capabilities: ["provider"],
                    execute: async (input) => input,
                  }),
                ],
              },
            ],
          },
        }),
      },
    ]);

    const registry = registerCoreAiTools(createAiToolRegistry(), adapters());

    expect(registry.list().map((tool) => tool.name)).toContain("loader.echo");
    await expect(
      registry.execute("loader.echo", { value: "ok" }, { requestId: "loader" })
    ).resolves.toEqual({ value: "ok" });
  });

  it("discovers package manifests with priority ordering and failure isolation", () => {
    const modules: Record<string, () => Promise<DatabaseProviderModule>> = {
      "./alpha": async () => ({
        default: {
          id: "test.package.alpha",
          displayName: "Alpha",
        },
      }),
      "./beta": async () => ({
        default: {
          id: "test.package.beta",
          displayName: "Beta",
        },
      }),
    };

    const discovery = discoverDatabaseProviderLoaders(
      [
        { id: "disabled", module: "./alpha", enabled: false },
        { id: "missing", module: "./missing" },
        { id: "beta", module: "./beta", priority: 20 },
        { id: "alpha", module: "./alpha", priority: 10 },
      ],
      modules
    );

    expect(discovery.statuses).toEqual([
      { id: "disabled", status: "skipped", providerIds: [] },
      {
        id: "missing",
        status: "failed",
        providerIds: [],
        error: "Database provider module not found: ./missing",
      },
    ]);
    expect(discovery.loaders.map((loader) => loader.id)).toEqual([
      "beta",
      "alpha",
    ]);
  });

  it("loads provider packages from manifests and reports discovery statuses", async () => {
    const packageDriver = "loader_package" as DatabaseDriver;
    const statuses = await loadDatabaseProviderPackages(
      [
        { id: "disabled-package", module: "./disabled", enabled: false },
        { id: "invalid-package", module: "./missing" },
        { id: "package-provider", module: "./provider", priority: 100 },
      ],
      {
        "./provider": async () => ({
          default: {
            id: "test.loader.package",
            displayName: "Loader Package",
            driverProfiles: [profile(packageDriver, "Loader Package")],
          },
        }),
      }
    );

    expect(statuses).toEqual([
      { id: "disabled-package", status: "skipped", providerIds: [] },
      {
        id: "invalid-package",
        status: "failed",
        providerIds: [],
        error: "Database provider module not found: ./missing",
      },
      {
        id: "package-provider",
        status: "loaded",
        providerIds: ["test.loader.package"],
      },
    ]);
    expect(databaseDriverProfile(packageDriver).menuLabel).toBe(
      "Loader Package"
    );
  });
});
