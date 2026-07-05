import { describe, expect, it } from "vitest";
import { registerCoreAiTools } from "@/ai/tools/coreTools";
import { createAiToolRegistry } from "@/ai/tools/registry";
import type { AiToolAdapters } from "@/ai/tools/types";
import {
  databaseDriverProfile,
  defaultDatabaseCapabilities,
  type DatabaseDriverProfile,
} from "@/lib/databaseDialect";
import {
  collectionPreviewQueryTemplateForCapabilities,
  databaseObjectPreviewProvider,
} from "@/lib/databaseObjectPreview";
import {
  listRegisteredDatabaseProviders,
  registerDatabaseProvider,
} from "@/providers";
import type {
  CollectionInfo,
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types";

const VECTOR_DRIVER = "vectorx" as DatabaseDriver;

function vectorCapabilities(): DatabaseCapabilities {
  return {
    ...defaultDatabaseCapabilities("elasticsearch"),
    driver: VECTOR_DRIVER,
    displayName: "VectorX",
    lspLanguageId: "json",
    namespaceLabel: "catalog",
    defaultPort: 19100,
  };
}

function vectorProfile(): DatabaseDriverProfile {
  const { driver, ...capabilities } = vectorCapabilities();
  return {
    driver,
    menuLabel: "VectorX",
    defaultDatabase: "default",
    urlScheme: "vectorx",
    protocolAliases: ["vectorx", "vx"],
    sslModeParamName: "ssl",
    sslModeParamAliases: ["ssl", "tls"],
    defaultIcon: "Search",
    iconClassName: "text-cyan-400",
    defaultAccentClassName: "bg-cyan-500/10 text-cyan-600",
    capabilities,
  };
}

function adapters(): AiToolAdapters {
  return {
    listConnections: () => [
      { id: "vectorx-1", name: "VectorX local", driver: VECTOR_DRIVER },
    ],
    getConnectionCapabilities: (driver) => defaultDatabaseCapabilities(driver),
  };
}

describe("database provider registration", () => {
  it("registers driver profiles, preview providers, and AI tool families together", async () => {
    registerDatabaseProvider({
      id: "test.vectorx",
      displayName: "VectorX Provider",
      priority: 900,
      driverProfiles: [vectorProfile()],
      objectPreviewProviders: [
        {
          id: "test.vectorx.preview",
          priority: 900,
          matches: (capabilities) => capabilities.driver === VECTOR_DRIVER,
          objectLabel: "Vector Index",
          queryTemplate: ({ namespace, collection }) =>
            `VECTOR SEARCH ${namespace || "default"}.${collection.name} LIMIT 100`,
        },
      ],
      aiToolFamilies: [
        {
          name: "test.vectorx.tools",
          priority: 900,
          tools: [
            () => ({
              name: "vectorx.inspectIndex",
              description: "Inspect a VectorX index.",
              inputSchema: {
                type: "object",
                properties: {
                  index: { type: "string" },
                },
                required: ["index"],
                additionalProperties: false,
              },
              permissions: ["read"],
              capabilities: ["metadata"],
              execute: async (input) => input,
            }),
          ],
        },
      ],
    });

    const capabilities = defaultDatabaseCapabilities(VECTOR_DRIVER);
    const previewCollection: CollectionInfo = {
      name: "embeddings",
      namespace: "main",
      type: "vector",
      documentCount: 10,
    };
    const registry = registerCoreAiTools(createAiToolRegistry(), adapters());
    const providerList = await registry.execute<{
      providers: Array<{
        id: string;
        driverProfiles: DatabaseDriver[];
        aiToolFamilies: string[];
      }>;
      driverProfiles: Array<{
        driver: DatabaseDriver;
        displayName: string;
        namespaceLabel: string;
      }>;
    }>("provider.list", {}, { requestId: "provider-test" });

    expect(databaseDriverProfile(VECTOR_DRIVER)).toMatchObject({
      menuLabel: "VectorX",
      urlScheme: "vectorx",
    });
    expect(capabilities).toMatchObject({
      driver: VECTOR_DRIVER,
      displayName: "VectorX",
      dataModel: "search",
      namespaceLabel: "catalog",
    });
    expect(databaseObjectPreviewProvider(capabilities)).toMatchObject({
      id: "test.vectorx.preview",
      objectLabel: "Vector Index",
    });
    expect(
      collectionPreviewQueryTemplateForCapabilities(
        capabilities,
        "main",
        previewCollection
      )
    ).toBe("VECTOR SEARCH main.embeddings LIMIT 100");
    expect(
      listRegisteredDatabaseProviders().find(
        (provider) => provider.id === "test.vectorx"
      )
    ).toMatchObject({
      displayName: "VectorX Provider",
      driverProfiles: [expect.objectContaining({ driver: VECTOR_DRIVER })],
      aiToolFamilies: [expect.objectContaining({ name: "test.vectorx.tools" })],
    });
    expect(providerList.driverProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          driver: VECTOR_DRIVER,
          displayName: "VectorX",
          namespaceLabel: "catalog",
        }),
      ])
    );
    expect(providerList.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "test.vectorx",
          driverProfiles: [VECTOR_DRIVER],
          aiToolFamilies: ["test.vectorx.tools"],
        }),
      ])
    );
    expect(registry.list().map((tool) => tool.name)).toContain(
      "vectorx.inspectIndex"
    );
    await expect(
      registry.execute("vectorx.inspectIndex", { index: "embeddings" }, {
        requestId: "provider-test",
      })
    ).resolves.toEqual({ index: "embeddings" });
  });
});
