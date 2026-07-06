import { describe, expect, it, vi } from "vitest";
import {
  dispatchLspConfiguration,
  type LspConfigurationPayload,
} from "@/services/lsp/configDispatch";
import { createLspConfigKey } from "@/services/lsp/syncPlan";

function config(): LspConfigurationPayload {
  return {
    defaultDialect: "postgres",
    fileSchemas: {
      "oxide://query/q.postgres.postgres": "schema-public",
    },
    fileDialects: {
      "oxide://query/q.postgres.postgres": "postgres",
    },
    schemas: [
      {
        id: "schema-public",
        database: "public",
        source_uri: null,
        tables: [
          {
            name: "users",
            object_type: "BASE TABLE",
            comment: null,
            source_location: null,
            indexes: [],
            constraints: [],
            columns: [
              {
                name: "id",
                data_type: "integer",
                nullable: false,
                primary_key: true,
                unique: true,
                indexed: true,
                comment: null,
                source_location: null,
              },
            ],
          },
        ],
        functions: [],
      },
    ],
  };
}

describe("LSP configuration dispatch", () => {
  it("skips stale sync generations before sending", async () => {
    const updateConfiguration = vi.fn();

    await expect(
      dispatchLspConfiguration({
        connectionId: "conn-1",
        driver: "postgres",
        lspDialect: "postgres",
        config: config(),
        lastConfigKey: "previous",
        syncGeneration: 1,
        getCurrentGeneration: () => 2,
        updateConfiguration,
      })
    ).resolves.toEqual({
      status: "stale",
      lastConfigKey: "previous",
    });
    expect(updateConfiguration).not.toHaveBeenCalled();
  });

  it("skips duplicate configurations", async () => {
    const payload = config();
    const lastConfigKey = createLspConfigKey({
      connectionId: "conn-1",
      driver: "postgres",
      lspDialect: "postgres",
      fileSchemas: payload.fileSchemas,
      fileDialects: payload.fileDialects,
      schemaDefinitions: payload.schemas,
    });
    const updateConfiguration = vi.fn();

    const result = await dispatchLspConfiguration({
      connectionId: "conn-1",
      driver: "postgres",
      lspDialect: "postgres",
      config: payload,
      lastConfigKey,
      syncGeneration: 1,
      getCurrentGeneration: () => 1,
      updateConfiguration,
    });

    expect(result).toEqual({
      status: "duplicate",
      configKey: lastConfigKey,
      lastConfigKey,
    });
    expect(updateConfiguration).not.toHaveBeenCalled();
  });

  it("sends new configurations and returns the next cache key", async () => {
    const payload = config();
    const updateConfiguration = vi.fn().mockResolvedValue(undefined);

    const result = await dispatchLspConfiguration({
      connectionId: "conn-1",
      driver: "postgres",
      lspDialect: "postgres",
      config: payload,
      lastConfigKey: null,
      syncGeneration: 1,
      getCurrentGeneration: () => 1,
      updateConfiguration,
    });

    expect(updateConfiguration).toHaveBeenCalledWith(payload);
    expect(result.status).toBe("sent");
    expect(result.configKey).toBeTruthy();
    expect(result.lastConfigKey).toBe(result.configKey);
  });

  it("does not cache a configuration that becomes stale while sending", async () => {
    let currentGeneration = 1;
    const updateConfiguration = vi.fn().mockImplementation(async () => {
      currentGeneration = 2;
    });

    const result = await dispatchLspConfiguration({
      connectionId: "conn-1",
      driver: "postgres",
      lspDialect: "postgres",
      config: config(),
      lastConfigKey: null,
      syncGeneration: 1,
      getCurrentGeneration: () => currentGeneration,
      updateConfiguration,
    });

    expect(updateConfiguration).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("sent-stale");
    expect(result.lastConfigKey).toBeNull();
  });
});
