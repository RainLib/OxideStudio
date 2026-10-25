import {expect,it} from "vitest";
import {localWhereCompletionCandidates,whereCompletionContext,whereReplacementRange} from "@/lib/whereCompletion";
import {filterWhereRemoteCompletions} from "@/features/data-grid/model/whereRemoteCompletion";
import {CompletionItemKind as Kind} from "@/services/lsp/types";
const options=(condition:string,dialect:string,cursorOffset=condition.length)=>({condition,cursorOffset,dialect,driver:"postgres" as const,columns:[{name:"label",type:"text"}]});
it.each([["postgres","LIKE","text"],["postgresql","NOT ILIKE","text"],["postgres","SIMILAR TO","text"],["duckdb","ILIKE","varchar"],["mysql","LIKE","varchar"],["mariadb","NOT LIKE","varchar"],["sqlite","LIKE","text"],["sqlserver","LIKE","nvarchar"]])("infers the %s %s escape-character slot",(profile,operator,type)=>{
 const request=options(`LOWER('oxide_1') ${operator} 'oxide#_1' ESCAPE `,profile);
 expect(whereCompletionContext(request)).toMatchObject({phase:"value",type,valueRole:"pattern-escape"});
 const labels=localWhereCompletionCandidates(request).map(item=>item.label);expect(labels).toContain("'#'");expect(labels).toContain("'!'");expect(labels).not.toContain("''");expect(labels).not.toContain("TRUE");expect(labels).not.toContain("0");
});
it("accepts a single escape character over the full suffix after Unicode without changing the keyword",()=>{
 const condition="/*😀*/ label LIKE 'oxide#_1' ESCAPE Suffix",cursor=condition.indexOf("Suffix"),request=options(condition,"sqlite",cursor);
 const item=localWhereCompletionCandidates(request).find(value=>value.label==="'#'")!;expect(item).toBeDefined();const range=item.replacementRange??whereReplacementRange(condition,cursor);
 expect(condition.slice(0,range.start)+item.insertText+condition.slice(range.end)).toBe("/*😀*/ label LIKE 'oxide#_1' ESCAPE '#' ");
});
it.each([["hive","LIKE"],["duckdb","SIMILAR TO"],["sqlite","GLOB"],["postgres","~"],["clickhouse","LIKE"]])("does not invent unsupported or unversioned %s %s escape hints",(profile,operator)=>expect(localWhereCompletionCandidates(options(`label ${operator} 'x' ESCAPE `,profile)).map(item=>item.label)).not.toContain("'#'"));
it("lets a bound server role supply versioned escape hints and filters stale generic literals",()=>{
 const request={...options("label LIKE 'x' ESCAPE ","clickhouse"),valueType:"String",valueRole:"pattern-escape" as const};
 expect(localWhereCompletionCandidates(request).map(item=>item.label)).toContain("'#'");
 const remote=filterWhereRemoteCompletions([{label:"'#'",kind:Kind.Value},{label:"''",kind:Kind.Snippet},{label:"0",kind:Kind.Value},{label:"TRUE",kind:Kind.Keyword},{label:"label",kind:Kind.Field}],whereCompletionContext(request),"clickhouse");
 expect(remote.map(item=>item.label)).toEqual(["'#'","label"]);
});
it("offers and accepts optional ESCAPE over a typed suffix while preserving the completed pattern",()=>{
 const condition="/*😀*/ label LIKE 'oxide#_1' ESuffix",cursor=condition.indexOf("ESuffix")+1,request=options(condition,"postgres",cursor);
 const item=localWhereCompletionCandidates(request).find(value=>value.label==="ESCAPE")!;expect(item).toBeDefined();const range=item.replacementRange??whereReplacementRange(condition,cursor);
 expect(condition.slice(0,range.start)+item.insertText+condition.slice(range.end)).toBe("/*😀*/ label LIKE 'oxide#_1' ESCAPE ");
});
it("preserves a completed ESCAPE keyword when accepting the character without a trailing space",()=>{
 const condition="label LIKE 'x' ESCAPE",request=options(condition,"sqlite"),item=localWhereCompletionCandidates(request).find(value=>value.label==="'#'")!;expect(item).toBeDefined();const range=item.replacementRange??whereReplacementRange(condition,condition.length);
 expect(condition.slice(0,range.start)+item.insertText+condition.slice(range.end)).toBe(condition+" '#' ");
});
