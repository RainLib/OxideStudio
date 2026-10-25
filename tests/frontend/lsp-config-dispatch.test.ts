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
      functionCase: "preserve",
      tableAlias: "none",
    },
    formattingPreferences: {
      keywordCase: "upper",
      functionCase: "preserve",
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
      keywordCase: "upper",
      functionCase: "preserve",
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
      lastAnalysisToken: "previous-token",
      syncGeneration: 1,
      getCurrentGeneration: () => 1,
      confirmConfiguration: vi.fn().mockResolvedValue(true),
      updateConfiguration,
    });

    expect(result.status).toBe("sent");
    expect(result.configKey).not.toBe(lastConfigKey);
    expect(updateConfiguration).toHaveBeenCalledWith(expect.objectContaining({...changed,oxideAnalysisToken:result.analysisToken}));
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
        confirmConfiguration: vi.fn().mockResolvedValue(true),
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
      completionPreferences: payload.completionPreferences,
      formattingPreferences: payload.formattingPreferences,
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
      lastAnalysisToken: "previous-token",
      syncGeneration: 1,
      getCurrentGeneration: () => 1,
      confirmConfiguration: vi.fn().mockResolvedValue(true),
      updateConfiguration,
    });

    expect(result).toEqual({
      analysisToken: "previous-token",
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
      lastAnalysisToken: "previous-token",
      syncGeneration: 1,
      getCurrentGeneration: () => 1,
      confirmConfiguration: vi.fn().mockResolvedValue(true),
      updateConfiguration,
    });

    expect(result.status).toBe("sent");
    expect(result.configKey).not.toBe(lastConfigKey);
    expect(updateConfiguration).toHaveBeenCalledWith(expect.objectContaining({...changed,oxideAnalysisToken:result.analysisToken}));
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
      completionPreferences: previous.completionPreferences,
      formattingPreferences: previous.formattingPreferences,
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
      lastAnalysisToken: "previous-token",
      syncGeneration: 1,
      getCurrentGeneration: () => 1,
      confirmConfiguration: vi.fn().mockResolvedValue(true),
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
      confirmConfiguration: vi.fn().mockResolvedValue(true),
      updateConfiguration,
    });

    expect(updateConfiguration).toHaveBeenCalledWith(expect.objectContaining({...payload,oxideAnalysisToken:result.analysisToken}));
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
      confirmConfiguration: vi.fn().mockResolvedValue(true),
      updateConfiguration,
    });

    expect(updateConfiguration).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("sent-stale");
    expect(result.lastConfigKey).toBeNull();
    expect(result.analysisToken).toBeUndefined();
  });
});

describe("analysis configuration provenance",()=>{
  const send=(overrides:Partial<Parameters<typeof dispatchLspConfiguration>[0]>={})=>dispatchLspConfiguration({
    connectionId:"conn",driver:"postgres",lspDialect:"postgres",config:config(),lastConfigKey:null,
    syncGeneration:1,getCurrentGeneration:()=>1,confirmConfiguration:vi.fn().mockResolvedValue(true),updateConfiguration:vi.fn(),...overrides});
  it("sends a fresh opaque token and grants the exact acknowledged value without mutating input",async()=>{
    const payload={...config(),oxideAnalysisToken:"caller-value"},updateConfiguration=vi.fn();
    const result=await send({config:payload,updateConfiguration});
    expect(result.analysisToken).toMatch(/^[A-Za-z0-9_-]{1,128}$/);expect(result.analysisToken).not.toBe("caller-value");
    expect(updateConfiguration.mock.calls[0]![0].oxideAnalysisToken).toBe(result.analysisToken);expect(payload.oxideAnalysisToken).toBe("caller-value");
  });
  it("minted tokens do not change the semantic duplicate key",async()=>{
    const first=await send(),second=await send();expect(first.analysisToken).not.toBe(second.analysisToken);expect(first.configKey).toBe(second.configKey);
  });
  it("retains an acknowledged token when an identical configuration is skipped",async()=>{
    const updateConfiguration=vi.fn(),first=await send({updateConfiguration});
    const second=await send({confirmConfiguration: vi.fn().mockResolvedValue(true),
      updateConfiguration,lastConfigKey:first.lastConfigKey,lastAnalysisToken:first.analysisToken});
    expect(second.status).toBe("duplicate");expect(second.analysisToken).toBe(first.analysisToken);expect(updateConfiguration).toHaveBeenCalledOnce();
  });
});


describe("server-applied configuration receipts",()=>{
  const fixture=()=>{
    const updateConfiguration=vi.fn().mockResolvedValue(undefined),confirmConfiguration=vi.fn().mockResolvedValue(true);
    let generation=1;
    const send=(overrides:Partial<Parameters<typeof dispatchLspConfiguration>[0]>={})=>dispatchLspConfiguration({
      connectionId:"receipt",driver:"postgres",lspDialect:"postgres",config:config(),lastConfigKey:null,syncGeneration:1,
      getCurrentGeneration:()=>generation,updateConfiguration,confirmConfiguration,...overrides});
    return {send,updateConfiguration,confirmConfiguration,invalidate:()=>{generation++;}};
  };
  it("waits for server confirmation after the notification write",async()=>{
    const f=fixture();let resolve!:(value:boolean)=>void;f.confirmConfiguration.mockReturnValue(new Promise<boolean>(done=>{resolve=done;}));
    let settled=false;const pending=f.send().then(value=>{settled=true;return value;});await Promise.resolve();await Promise.resolve();
    expect(f.updateConfiguration).toHaveBeenCalledOnce();expect(f.confirmConfiguration).toHaveBeenCalledOnce();expect(settled).toBe(false);
    resolve(true);expect((await pending).analysisToken).toBe(f.confirmConfiguration.mock.calls[0]![0]);
  });
  it("does not grant or cache an unconfirmed configuration",async()=>{
    const f=fixture();f.confirmConfiguration.mockResolvedValue(false);await expect(f.send()).rejects.toThrow("not been confirmed");
  });
  it("drops a confirmation that arrives after its source generation changes",async()=>{
    const f=fixture();f.confirmConfiguration.mockImplementation(async()=>{f.invalidate();return true;});
    const result=await f.send();expect(result.status).toBe("sent-stale");expect(result.analysisToken).toBeUndefined();expect(result.lastConfigKey).toBeNull();
  });
  it("rechecks duplicate configuration receipts without rewriting a healthy server",async()=>{
    const f=fixture(),first=await f.send();const second=await f.send({lastConfigKey:first.lastConfigKey,lastAnalysisToken:first.analysisToken});
    expect(second.status).toBe("duplicate");expect(f.confirmConfiguration).toHaveBeenLastCalledWith(first.analysisToken);expect(f.updateConfiguration).toHaveBeenCalledOnce();
  });
  it("resends a duplicate with a fresh token after restart or overwrite",async()=>{
    const f=fixture(),first=await f.send();f.confirmConfiguration.mockResolvedValueOnce(false);
    const second=await f.send({lastConfigKey:first.lastConfigKey,lastAnalysisToken:first.analysisToken});expect(second.status).toBe("sent");
    expect(second.analysisToken).not.toBe(first.analysisToken);expect(f.updateConfiguration).toHaveBeenCalledTimes(2);expect(f.confirmConfiguration).toHaveBeenCalledTimes(3);
  });
  it("resends a semantic duplicate with no prior receipt",async()=>{
    const f=fixture(),first=await f.send();const second=await f.send({lastConfigKey:first.lastConfigKey});expect(second.status).toBe("sent");expect(f.updateConfiguration).toHaveBeenCalledTimes(2);
  });
  it("does not resend or grant a duplicate after invalidation during readback",async()=>{
    const f=fixture(),first=await f.send();f.confirmConfiguration.mockImplementation(async()=>{f.invalidate();return false;});
    const result=await f.send({lastConfigKey:first.lastConfigKey,lastAnalysisToken:first.analysisToken});expect(result.status).toBe("stale");expect(result.analysisToken).toBeUndefined();expect(f.updateConfiguration).toHaveBeenCalledOnce();
  });
  it("propagates confirmation failures without issuing a second configuration",async()=>{
    const f=fixture();f.confirmConfiguration.mockRejectedValue(new Error("IPC failed"));await expect(f.send()).rejects.toThrow("IPC failed");expect(f.updateConfiguration).toHaveBeenCalledOnce();
  });
});
