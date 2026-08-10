import { describe, expect, it, vi } from "vitest";
import {
  dispatchLspConfiguration,
  type LspConfigurationPayload,
} from "@/services/lsp/configDispatch";
import { createLspConfigKey } from "@/services/lsp/syncPlan";

function config(): LspConfigurationPayload {
  return {
    defaultDialect: "postgres",
    completionPreferences: {
      keywordCase: "upper",
      tableAlias: "none",
    },
    formattingPreferences: {
      logicalOperatorNewline: "before",
      fromClauseLayout: "newLine",
    },
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

function metadataRichConfig(): LspConfigurationPayload {
  const payload = config();
  const table = payload.schemas[0]!.tables[0]!;
  table.columns.push({
    name: "email",
    data_type: "text",
    nullable: false,
    primary_key: false,
    unique: true,
    indexed: true,
    default_value: null,
    comment: "Login email",
    source_location: null,
  });
  table.indexes.push(
    {
      name: "users_pkey",
      columns: ["id"],
      is_unique: true,
      is_primary: true,
      index_type: "btree",
      definition: "CREATE UNIQUE INDEX users_pkey ON users (id)",
    },
    {
      name: "users_email_key",
      columns: ["email"],
      is_unique: true,
      is_primary: false,
      index_type: "btree",
      definition: "CREATE UNIQUE INDEX users_email_key ON users (email)",
    }
  );
  table.constraints.push(
    {
      name: "users_team_fk",
      constraint_type: "FOREIGN KEY",
      columns: ["team_id"],
      referenced_schema: "public",
      referenced_table: "teams",
      referenced_columns: ["id"],
      definition: "ON DELETE CASCADE",
    },
    {
      name: "users_email_check",
      constraint_type: "CHECK",
      columns: ["email"],
      referenced_schema: null,
      referenced_table: null,
      referenced_columns: [],
      definition: "CHECK (email <> '')",
    }
  );
  payload.schemas[0]!.functions.push(
    {
      name: "find_user",
      routine_type: "function",
      parameters: [{ name: "id", data_type: "integer", optional: false, mode: "IN" }],
      return_type: "users",
      description: "Find user",
    },
    {
      name: "list_users",
      routine_type: "function",
      parameters: [],
      return_type: "setof users",
      description: null,
    }
  );
  return payload;
}

describe("LSP configuration dispatch", () => {
  it("sends formatter-only preference changes", async () => {
    const previous = config();
    const changed = config();
    changed.formattingPreferences = {
      logicalOperatorNewline: "none",
      fromClauseLayout: "sameLine",
    };
    const lastConfigKey = createLspConfigKey({
      connectionId: "conn-1",
      driver: "postgres",
      lspDialect: "postgres",
      completionPreferences: previous.completionPreferences,
      formattingPreferences: previous.formattingPreferences,
      fileSchemas: previous.fileSchemas,
      fileDialects: previous.fileDialects,
      schemaDefinitions: previous.schemas,
    });
    const updateConfiguration = vi.fn().mockResolvedValue(undefined);

    const result = await dispatchLspConfiguration({
      connectionId: "conn-1",
      driver: "postgres",
      lspDialect: "postgres",
      config: changed,
      lastConfigKey,
      syncGeneration: 1,
      getCurrentGeneration: () => 1,
      updateConfiguration,
    });

    expect(result.status).toBe("sent");
    expect(result.configKey).not.toBe(lastConfigKey);
    expect(updateConfiguration).toHaveBeenCalledWith(changed);
  });

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

  it("sends same-count metadata changes instead of treating them as duplicates", async () => {
    const previous = metadataRichConfig();
    const changed = metadataRichConfig();
    changed.schemas[0]!.tables[0]!.columns[0]!.unique = false;
    changed.schemas[0]!.tables[0]!.columns[0]!.comment = "Changed";
    changed.schemas[0]!.tables[0]!.indexes[0]!.name = "renamed_pkey";
    changed.schemas[0]!.tables[0]!.constraints[0]!.definition = "ON DELETE RESTRICT";
    changed.schemas[0]!.functions[0]!.parameters[0]!.data_type = "bigint";
    const lastConfigKey = createLspConfigKey({
      connectionId: "conn-1",
      driver: "postgres",
      lspDialect: "postgres",
      fileSchemas: previous.fileSchemas,
      fileDialects: previous.fileDialects,
      schemaDefinitions: previous.schemas,
    });
    const updateConfiguration = vi.fn().mockResolvedValue(undefined);

    const result = await dispatchLspConfiguration({
      connectionId: "conn-1",
      driver: "postgres",
      lspDialect: "postgres",
      config: changed,
      lastConfigKey,
      syncGeneration: 1,
      getCurrentGeneration: () => 1,
      updateConfiguration,
    });

    expect(result.status).toBe("sent");
    expect(result.configKey).not.toBe(lastConfigKey);
    expect(updateConfiguration).toHaveBeenCalledWith(changed);
  });

  it("skips configurations whose metadata collections only changed order", async () => {
    const previous = metadataRichConfig();
    const reordered = metadataRichConfig();
    const table = reordered.schemas[0]!.tables[0]!;
    table.columns.reverse();
    table.indexes.reverse();
    table.constraints.reverse();
    reordered.schemas[0]!.functions.reverse();
    const lastConfigKey = createLspConfigKey({
      connectionId: "conn-1",
      driver: "postgres",
      lspDialect: "postgres",
      fileSchemas: previous.fileSchemas,
      fileDialects: previous.fileDialects,
      schemaDefinitions: previous.schemas,
    });
    const updateConfiguration = vi.fn();

    const result = await dispatchLspConfiguration({
      connectionId: "conn-1",
      driver: "postgres",
      lspDialect: "postgres",
      config: reordered,
      lastConfigKey,
      syncGeneration: 1,
      getCurrentGeneration: () => 1,
      updateConfiguration,
    });

    expect(result.status).toBe("duplicate");
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
