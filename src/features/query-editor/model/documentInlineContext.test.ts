import {expect,it,vi} from "vitest";
import {DEFAULT_APP_SETTINGS} from "@/lib/appSettings";
import {localInlineSuggestion} from "@/lib/inlineCompletion";
import {documentInlineContext} from "./documentInlineContext";
const load=vi.hoisted(()=>vi.fn());vi.mock("@/services/tableMetadataCache",()=>({loadTableMetadata:load}));
class Range {constructor(public startLineNumber:number,public startColumn:number,public endLineNumber:number,public endColumn:number){}}
async function resolve(marked:string,driver:Parameters<typeof documentInlineContext>[0]["driver"]="postgres",isCurrent=()=>true){
  const offset=marked.indexOf("|"),text=marked.replace("|","");
  const model={getValue:()=>text,getVersionId:()=>1,getOffsetAt:({column}:{column:number})=>column-1,getPositionAt:(offset:number)=>({lineNumber:1,column:offset+1}),getLineContent:()=>text,
    getWordUntilPosition:()=>({word:text.slice(0,offset).match(/[\w$]+$/)?.[0]||"",startColumn:offset+1-(text.slice(0,offset).match(/[\w$]+$/)?.[0].length||0),endColumn:offset+1}),getValueInRange:(r:Range)=>text.slice(r.startColumn-1,r.endColumn-1)};
  const prefix=text.slice(0,offset),result=await documentInlineContext({model,position:{lineNumber:1,column:offset+1},prefix,driver,isCurrent,token:{},
    monaco:{Range,languages:{CompletionItemKind:{Field:4,Variable:5}}},sqlCompletion:DEFAULT_APP_SETTINGS.editor.sqlCompletion,sqlFormatting:DEFAULT_APP_SETTINGS.editor.sqlFormatting});
  return {result,remainder:localInlineSuggestion(prefix,result)};
}
it.each(["postgres","mysql","sqlserver","sqlite","hive","clickhouse"] as const)("infers nested document-local CTE outputs without any catalog request: %s",async driver=>{
  load.mockClear();const f=await resolve("WITH first AS (SELECT 1 AS declared_total), second AS (SELECT a.* FROM first a) SELECT q.de| FROM second q",driver);
  expect(f.result.candidates?.map(value=>value.label)).toContain("declared_total");expect(f.remainder).toBe("clared_total");expect(load).not.toHaveBeenCalled();
});
it("keeps derived-table aliases document-local",async()=>{const f=await resolve("SELECT q.ex| FROM (SELECT 2 AS explicit_field) q");expect(f.remainder).toBe("plicit_field");});
it("does not invent fields for a physical source even when it shares a familiar name",async()=>{
  load.mockClear();const f=await resolve("SELECT q.de| FROM private_ledger q");expect(f.result.candidates||[]).toEqual([]);expect(load).not.toHaveBeenCalled();
});
it("rejects a query-local result when its source becomes stale",async()=>{let checks=0;const f=await resolve("WITH q AS (SELECT 1 AS declared_total) SELECT q.de| FROM q","postgres",()=>++checks===1);expect(f.result).toEqual({});});
