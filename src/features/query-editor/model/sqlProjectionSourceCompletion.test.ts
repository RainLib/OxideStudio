import {describe,expect,it} from "vitest";
import {projectionSourceContext,sqlProjectionSourceCompletions} from "./sqlProjectionSourceCompletion";
import type {DatabaseDriver} from "@/services/tauri/types";
class Range{constructor(public startLineNumber:number,public startColumn:number,public endLineNumber:number,public endColumn:number){}}
function fixture(marked:string){
  const offset=marked.indexOf("|"),sql=marked.replace("|","");
  const positionAt=(at:number)=>{const lines=sql.slice(0,at).split("\n");return {lineNumber:lines.length,column:lines[lines.length-1]!.length+1}};
  const position=positionAt(offset),model={getValue:()=>sql,getOffsetAt:()=>offset,getLineContent:(line:number)=>sql.split("\n")[line-1]!,getWordUntilPosition:()=>({startColumn:position.column-(sql.slice(0,offset).match(/[A-Za-z_]+$/u)?.[0].length||0)})};
  return {model,position,prefix:sql.slice(0,offset)};
}
describe("unbound SELECT source picker",()=>{
  it("keeps same-name tables in different schemas distinct with long catalog names",()=>{
    const f=fixture("SELECT |"),items=sqlProjectionSourceCompletions({...f,driver:"postgres",database:"a_very_long_catalog_name",tables:[{name:"adapter",schema:"east"},{name:"adapter",schema:"west"}],keywordCase:"upper",monaco:{Range,languages:{CompletionItemKind:{Struct:22},CompletionItemInsertTextRule:{InsertAsSnippet:4}}}});
    expect(items.map(item=>item.label)).toEqual([{label:"adapter",description:"a_very_long_catalog_name.east"},{label:"adapter",description:"a_very_long_catalog_name.west"}]);
    expect(items.map(item=>item.insertText)).toEqual(["${1} FROM east.adapter$0","${1} FROM west.adapter$0"]);
  });
  it.each(["SELECT |","SELECT|","SELECT DISTINCT |","WITH q AS (SELECT 1) SELECT |","SELECT 1 UNION ALL SELECT |","SELECT (SELECT |) FROM parent"])("offers only within the unbound projection: %s",sql=>{
    const f=fixture(sql);expect(projectionSourceContext(f.model,f.position,f.prefix)).not.toBeNull();
  });
  it.each(["SELECT | FROM adapter","SELECT | FROM","SELECT a.|","SELECT 1 + |","SELECT 12|","SELECT * FROM adapter WHERE |","SELECT | FROM a JOIN b ON true","SELECT 'literal |'","SELECT |; SELECT * FROM adapter"])("retains query ownership: %s",sql=>{
    const f=fixture(sql);const context=projectionSourceContext(f.model,f.position,f.prefix);
    if(sql.includes(";"))expect(context).not.toBeNull();else expect(context).toBeNull();
  });
  it.each(["postgres","mysql","sqlserver"] as DatabaseDriver[])("shows database context and inserts an escaped source for %s",driver=>{
    const f=fixture("SELECT |"),items=sqlProjectionSourceCompletions({...f,driver,database:"db",schema:"app",tables:[{name:"Order Details",schema:"app"}],keywordCase:"upper",monaco:{Range,languages:{CompletionItemKind:{Struct:22},CompletionItemInsertTextRule:{InsertAsSnippet:4}}}});
    expect(items[0]?.label).toEqual({label:"Order Details",description:"db.app"});expect(items[0]?.insertText).toContain("${1} FROM app.");expect(items[0]?.insertText).not.toContain("FROM db.app");
  });
  it("replaces the complete identifier suffix and bounds a large catalog",()=>{
    const f=fixture("SELECT ad|apter"),items=sqlProjectionSourceCompletions({...f,driver:"postgres",database:"db",schema:"app",tables:Array.from({length:200},(_,i)=>({name:`adapter_${i}`,schema:"app"})),keywordCase:"lower",monaco:{Range,languages:{CompletionItemKind:{Struct:22},CompletionItemInsertTextRule:{InsertAsSnippet:4}}}});
    expect(items).toHaveLength(128);expect(items[0]?.range.endColumn).toBe(15);expect(items[0]?.insertText).toContain(" from app.");
  });
});
