import { beforeEach, describe, expect, it, vi } from "vitest";
import { completionRelationCatalog, type RelationCatalogCache } from "./relationCatalog";
const service=vi.hoisted(()=>({getDatabaseTables:vi.fn(),getTables:vi.fn()}));
vi.mock("@/services/tauri",()=>({schemaService:service}));
beforeEach(()=>{vi.resetAllMocks();service.getDatabaseTables.mockResolvedValue([{name:"adapter",schema:"validation"}]);});
describe("completion catalog without expanded Explorer nodes",()=>{
  const options=()=>({tables:[],connectionId:"managed",database:"fixture",schema:"validation",cache:new Map() as RelationCatalogCache,allowed:()=>true});
  it("loads only the selected database/schema and reuses concurrent discovery",async()=>{
    const scope=options();const [left,right]=await Promise.all([completionRelationCatalog(scope),completionRelationCatalog(scope)]);
    expect(left).toEqual([{name:"adapter",schema:"validation"}]);expect(right).toEqual(left);
    expect(service.getDatabaseTables).toHaveBeenCalledExactlyOnceWith("managed","fixture","validation");
  });
  it("uses existing current metadata without discovery",async()=>{
    const tables=[{name:"existing"}];expect(await completionRelationCatalog({...options(),tables})).toBe(tables);
    expect(service.getDatabaseTables).not.toHaveBeenCalled();
  });
  it("does not read or return physical objects after authority is withdrawn",async()=>{
    const scope=options();let allowed=true;let release!:(value:any)=>void;
    service.getDatabaseTables.mockReturnValue(new Promise(resolve=>release=resolve));
    const pending=completionRelationCatalog({...scope,allowed:()=>allowed});allowed=false;release([{name:"private"}]);
    expect(await pending).toEqual([]);
    expect(await completionRelationCatalog({...scope,allowed:()=>false})).toEqual([]);
    expect(service.getDatabaseTables).toHaveBeenCalledTimes(1);
  });
  it("separates database and schema identities in the same cache",async()=>{
    const scope=options();await completionRelationCatalog(scope);await completionRelationCatalog({...scope,database:"other"});
    expect(service.getDatabaseTables).toHaveBeenCalledTimes(2);
  });
});
