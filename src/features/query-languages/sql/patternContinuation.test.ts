import {expect,it}from"vitest";
import {localWhereCompletionCandidates,whereCompletionContext,whereReplacementRange}from"@/lib/whereCompletion";
import {filterWhereRemoteCompletions}from"@/features/data-grid/model/whereRemoteCompletion";
import {CompletionItemKind as Kind}from"@/services/lsp/types";
const options=(condition:string,dialect="clickhouse",patternEscape?:boolean,cursorOffset=condition.length)=>({condition,cursorOffset,dialect,patternEscape,driver:"mysql" as const,columns:[]});
it.each(["LIKE","ILIKE","SIMILAR TO"])("uses a bound version capability for completed %s",operator=>{
 const request=options(`LOWER('x') ${operator} 'x' `,"clickhouse",true);
 expect(localWhereCompletionCandidates(request).map(item=>item.label)).toContain("ESCAPE");
 expect(filterWhereRemoteCompletions([{label:"ESCAPE",kind:Kind.Keyword}],whereCompletionContext(request),"clickhouse").map(item=>item.label)).toEqual(["ESCAPE"]);
});
it("keeps an unknown version separate from explicit support",()=>{
 expect(localWhereCompletionCandidates(options("'x' LIKE 'x' ")).map(item=>item.label)).not.toContain("ESCAPE");
 expect(localWhereCompletionCandidates(options("'x' LIKE 'x' ","postgres")).map(item=>item.label)).toContain("ESCAPE");
});
it("does not mistake an untyped legacy ESCAPE item for version knowledge",()=>{
 const context=whereCompletionContext(options("'x' LIKE 'x' "));
 expect(filterWhereRemoteCompletions([{label:"ESCAPE"}],context,"clickhouse")).toEqual([]);
});
it("lets an explicit bound denial override a local keyword assumption",()=>{
 expect(localWhereCompletionCandidates(options("'x' LIKE 'x' ","postgres",false)).map(item=>item.label)).not.toContain("ESCAPE");
});
it("accepts the versioned keyword over a complete Unicode suffix",()=>{
 const condition="/*😀*/ LOWER('x') LIKE 'x' ESuffix尾",cursor=condition.indexOf("ESuffix")+1,request=options(condition,"clickhouse",true,cursor);
 const item=localWhereCompletionCandidates(request).find(value=>value.label==="ESCAPE");expect(item).toBeDefined();const range=item!.replacementRange??whereReplacementRange(condition,cursor);
 expect(condition.slice(0,range.start)+item!.insertText+condition.slice(range.end)).toBe("/*😀*/ LOWER('x') LIKE 'x' ESCAPE ");
});
it.each(["'x' GLOB 'x' ","'x' REGEXP 'x' ","'x' LIKE 'x' ESCAPE '#' ","('x' LIKE 'x') ","LOWER('x') ","'x' LIKE ","'x' IS "])("does not grant a keyword outside its syntactic pattern slot: %s",condition=>{
 expect(localWhereCompletionCandidates(options(condition,"clickhouse",true)).map(item=>item.label)).not.toContain("ESCAPE");
});
