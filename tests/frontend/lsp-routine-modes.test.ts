import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadLspCatalogs } from "@/features/lsp-sync/runtime/loadLspCatalogs";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { lspSchemaSignature } from "@/services/lsp/schemaConfig";
import { schemaService } from "@/services/tauri";

vi.mock("@/services/tauri", () => ({ schemaService: {
  getTables: vi.fn(), getFunctions: vi.fn(), getDatabaseTables: vi.fn(), getDatabaseFunctions: vi.fn(),
} }));

beforeEach(() => { vi.mocked(schemaService.getTables).mockResolvedValue([]); vi.mocked(schemaService.getDatabaseTables).mockResolvedValue([]); });

describe("LSP routine parameter modes", () => {
  it.each([false,true])("preserves modes in catalog loading (database scoped: %s)", async databaseScoped => {
    const functions=[{name:"calc",return_type:"integer",parameters:[{name:"result",data_type:"int",optional:false,mode:"OUT"},{name:"items",data_type:"int[]",optional:false,mode:"VARIADIC"}]}];
    vi.mocked(schemaService.getFunctions).mockResolvedValue(functions);vi.mocked(schemaService.getDatabaseFunctions).mockResolvedValue(functions);
    const result=await loadLspCatalogs({targetCatalogs:[{catalogName:"db",databaseName:databaseScoped?"db":null,schemaName:"app"}],canSyncTableMetadata:true,activeConnectionId:"test",canSyncCollectionMetadata:false,capabilities:{...defaultDatabaseCapabilities(),supportsFunctions:true},preferredTablesByCatalog:new Map(),useOnDemandColumnMetadata:false});
    const parameters=result.catalogs[0].functions[0].parameters;
    expect(parameters.map(parameter=>parameter.mode)).toEqual(["OUT","VARIADIC"]);
  });
  it("changes the schema signature when only a parameter mode changes", () => {
    const schema={id:"id",database:"app",source_uri:null,tables:[],functions:[{name:"calc",routine_type:null,return_type:"int",description:null,parameters:[{name:"x",data_type:"int",optional:false,mode:"IN"}]}]};
    const before=lspSchemaSignature([schema]);schema.functions[0].parameters[0].mode="OUT";
    expect(lspSchemaSignature([schema])).not.toBe(before);
  });
});
