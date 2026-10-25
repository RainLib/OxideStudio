import { beforeEach, expect, it, vi } from "vitest";
const {
  schemaService,
  projectFilesService
} = vi.hoisted(() => ({
  schemaService: {
    getSqlLookupContext: vi.fn(),
    getDatabaseTables: vi.fn(),
    getTables: vi.fn(),
    getDatabaseFunctions: vi.fn(),
    getFunctions: vi.fn()
  },
  projectFilesService: {
    getLspDocuments: vi.fn()
  }
}));
vi.mock("@/services/tauri", () => ({
  schemaService,
  projectFilesService
}));
import { createLspSyncJob } from "./createLspSyncJob";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { emptyLspTableDetails } from "@/services/lsp/schemaConfig";
import type { LspConfigurationPayload } from "@/services/lsp/configDispatch";
const finalConfig = (input: Options): LspConfigurationPayload => vi.mocked(input.lspClient.updateConfiguration).mock.calls.slice(-1)[0]![0];
type Options = Parameters<typeof createLspSyncJob>[0];
function options(): Options {
  return {
    capabilitiesPromise: Promise.resolve({
      ...defaultDatabaseCapabilities("postgres"),
      driver: "sqlserver",
      lspLanguageId: "sqlserver",
      lspServerDialect: "sqlserver",
      supportsFunctions: false
    }),
    serverVersionPromise: Promise.resolve("16.0"),
    isCancelled: () => false,
    syncGenerationRef: {
      current: 1
    },
    syncGeneration: 1,
    setSemanticStatus: vi.fn(),
    activeConnectionId: "connection",
    connection: {
      id: "connection",
      name: "SQL Server",
      driver: "sqlserver"
    } as Options["connection"],
    activeProjectRoot: null,
    activeProjectId: "project",
    queryTabs: [{
      id: "query",
      type: "query",
      sql: "SELECT * FROM db..ledger"
    }],
    schemaByTabId: {
      query: "selected"
    },
    catalogByTabId: {
      query: {
        catalogName: null,
        databaseName: null,
        schemaName: "selected"
      }
    },
    defaultSchema: "selected",
    defaultCatalog: {
      catalogName: null,
      databaseName: null,
      schemaName: "selected"
    },
    targetCatalogs: [{
      catalogName: null,
      databaseName: null,
      schemaName: "selected"
    }],
    preferredTablesByCatalog: new Map(),
    getSchemaId: (schema, catalog) => `${catalog || "unknown"}/${schema}`,
    metadataVersion: 1,
    objectSourceUri: c => `oxide://metadata/${c.catalogName}/${c.schemaName}`,
    assignSourceLocations: (_c, definition) => definition,
    getCachedTableDefinition: async (c, table) => ({
      name: table.name,
      object_type: null,
      comment: null,
      ...emptyLspTableDetails(null),
      columns: [{
        name: c.schemaName === "sales" ? "sales_value" : "selected_value",
        data_type: "int",
        nullable: false,
        primary_key: false,
        unique: false,
        indexed: false,
        comment: null,
        source_location: null
      }]
    }),
    completionPreferences: {
      keywordCase: "upper",
      functionCase: "upper",
      tableAlias: "none"
    },
    formattingPreferences: {
      keywordCase: "upper",
      functionCase: "upper",
      logicalOperatorNewline: "before",
      fromClauseLayout: "newLine"
    },
    lastConfigRef: {
      current: null
    },
    lspClient: {
      confirmAnalysisConfiguration: vi.fn().mockResolvedValue(true),
      updateConfiguration: vi.fn().mockResolvedValue(undefined)
    } as unknown as Options["lspClient"],
    synchronizeProjectDocuments: vi.fn().mockResolvedValue(undefined),
    recordSemanticTelemetry: vi.fn(),
    metadataStats: {
      cacheHits: 0,
      cacheMisses: 0,
      failedObjects: 0
    }
  };
}
beforeEach(() => {
  vi.restoreAllMocks();
  for (const mock of Object.values(schemaService)) mock.mockReset();
  schemaService.getSqlLookupContext.mockResolvedValue({
    database: "db",
    defaultSchema: "sales"
  });
  schemaService.getDatabaseTables.mockResolvedValue([{
    name: "ledger",
    type: "BASE TABLE"
  }]);
  schemaService.getTables.mockResolvedValue([{
    name: "ledger",
    type: "BASE TABLE"
  }]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
it("sends driver-confirmed namespace and default-table fields through the production sync job", async () => {
  const input = options();
  await createLspSyncJob(input).buildTableDefinitions();
  const config = finalConfig(input);
  expect(config.schemas.map(s => [s.id, s.namespace, s.tables[0]?.columns[0]?.name])).toEqual([["db/selected", {
    default_schema: "sales",
    tables_complete: false
  }, "selected_value"], ["db/sales", {
    default_schema: "sales",
    tables_complete: false
  }, "sales_value"]]);
  expect(Object.values(config.fileSchemas)).toEqual(["db/selected"]);
  expect(schemaService.getDatabaseTables.mock.calls).toEqual([["connection", "db", "selected"], ["connection", "db", "sales"]]);
});
it("preserves legacy bindings when the driver has no lookup context", async () => {
  schemaService.getSqlLookupContext.mockResolvedValue(null);
  const input = options();
  await createLspSyncJob(input).buildTableDefinitions();
  const config = finalConfig(input);
  expect(config.schemas).toHaveLength(1);
  expect(config.schemas[0]!.namespace).toBeUndefined();
  expect(Object.values(config.fileSchemas)).toEqual(["unknown/selected"]);
});
it("does not publish or load tables when a delayed context belongs to an obsolete sync", async () => {
  let release!: (value: {
    database: string;
    defaultSchema: string;
  }) => void;
  schemaService.getSqlLookupContext.mockReturnValue(new Promise(resolve => {
    release = resolve;
  }));
  const input = options(),
    run = createLspSyncJob(input).buildTableDefinitions();
  await vi.waitFor(() => expect(schemaService.getSqlLookupContext).toHaveBeenCalled());
  input.syncGenerationRef.current = 2;
  release({
    database: "db",
    defaultSchema: "sales"
  });
  await run;
  expect(input.lspClient.updateConfiguration).not.toHaveBeenCalled();
  expect(schemaService.getDatabaseTables).not.toHaveBeenCalled();
});
it("reports a failed context lookup as limited and does not guess a namespace", async () => {
  schemaService.getSqlLookupContext.mockRejectedValue(new Error("lookup failed"));
  const input = options();
  await createLspSyncJob(input).buildTableDefinitions();
  const config = finalConfig(input);
  expect(config.schemas[0]!.namespace).toBeUndefined();
  expect(input.setSemanticStatus).toHaveBeenLastCalledWith("connection", expect.objectContaining({
    state: "limited",
    failedObjects: 1
  }));
});
it("does not introspect when the host revision cannot be verified before loading",async()=>{
  const input=options();input.verifyContext=vi.fn().mockResolvedValue(false);
  await createLspSyncJob(input).buildTableDefinitions();
  expect(schemaService.getSqlLookupContext).not.toHaveBeenCalled();expect(input.lspClient.updateConfiguration).not.toHaveBeenCalled();
});
it("does not grant completion authority when revision changes during configuration transport",async()=>{
  const input=options();input.verifyContext=vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
  input.onConfigurationPublished=vi.fn();await createLspSyncJob(input).buildTableDefinitions();
  expect(input.lspClient.updateConfiguration).toHaveBeenCalledOnce();expect(input.onConfigurationPublished).not.toHaveBeenCalled();
  expect(input.lastConfigRef.current).toBeNull();expect(vi.mocked(input.setSemanticStatus).mock.calls.some(([,status])=>status.state==="full")).toBe(false);
});
it("stops progressive enrichment when its first names-only publication loses the host revision",async()=>{
  schemaService.getDatabaseTables.mockResolvedValue(Array.from({length:40},(_,i)=>({name:`t${i}`,type:"BASE TABLE"})));
  const input=options();input.getCachedTableDefinition=vi.fn(input.getCachedTableDefinition);
  input.verifyContext=vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
  input.onConfigurationPublished=vi.fn();await createLspSyncJob(input).buildTableDefinitions();
  expect(input.lspClient.updateConfiguration).toHaveBeenCalledOnce();expect(input.getCachedTableDefinition).not.toHaveBeenCalled();
  expect(input.onConfigurationPublished).not.toHaveBeenCalled();
});

it("grants only the analysis token sent through the verified configuration transport",async()=>{
  const input=options();input.lastAnalysisTokenRef={current:null};input.onConfigurationPublished=vi.fn();
  await createLspSyncJob(input).buildTableDefinitions();
  const token=finalConfig(input).oxideAnalysisToken;expect(token).toBeTypeOf("string");
  expect(input.lastAnalysisTokenRef.current).toBe(token);expect(input.onConfigurationPublished).toHaveBeenLastCalledWith(expect.any(Number),token);
  await createLspSyncJob(input).buildTableDefinitions();
  expect(input.lspClient.updateConfiguration).toHaveBeenCalledOnce();expect(input.onConfigurationPublished).toHaveBeenLastCalledWith(expect.any(Number),token);
});

it("publishes main-editor metadata only after server confirmation",async()=>{
  const input=options();let resolve!:(value:boolean)=>void;const confirmation=new Promise<boolean>(done=>{resolve=done;});
  vi.mocked(input.lspClient.confirmAnalysisConfiguration).mockReturnValue(confirmation);input.onConfigurationPublished=vi.fn();input.lastAnalysisTokenRef={current:null};
  const pending=createLspSyncJob(input).buildTableDefinitions();for(let i=0;i<80;i++)await Promise.resolve();
  expect(input.lspClient.updateConfiguration).toHaveBeenCalled();expect(input.lspClient.confirmAnalysisConfiguration).toHaveBeenCalled();
  expect(input.onConfigurationPublished).not.toHaveBeenCalled();expect(input.lastAnalysisTokenRef.current).toBeNull();
  resolve(true);await pending;expect(input.onConfigurationPublished).toHaveBeenCalled();expect(input.lastAnalysisTokenRef.current).toBeTruthy();
});
it("does not publish a configuration the server cannot confirm",async()=>{
  const input=options();vi.mocked(input.lspClient.confirmAnalysisConfiguration).mockResolvedValue(false);input.onConfigurationPublished=vi.fn();input.lastAnalysisTokenRef={current:null};
  await createLspSyncJob(input).buildTableDefinitions();expect(input.onConfigurationPublished).not.toHaveBeenCalled();expect(input.lastAnalysisTokenRef.current).toBeNull();expect(input.lastConfigRef.current).toBeNull();
});
