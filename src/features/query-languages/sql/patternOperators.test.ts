import {expect,it} from "vitest";
import {localWhereCompletionCandidates,whereCompletionContext,whereReplacementRange} from "@/lib/whereCompletion";
import {filterWhereRemoteCompletions} from "@/features/data-grid/model/whereRemoteCompletion";
import {CompletionItemKind as Kind} from "@/services/lsp/types";
const options=(condition:string,profile:string,cursorOffset=condition.length)=>({condition,cursorOffset,driver:"postgres" as const,dialect:profile,columns:[{name:"value",type:"integer"}]});
it.each([["postgres","ILIKE","text"],["postgresql","SIMILAR TO","text"],["mysql","REGEXP","varchar"],["mariadb","RLIKE","varchar"],["sqlite","GLOB","text"],["sqlite3","NOT GLOB","text"],["duckdb","SIMILAR TO","varchar"],["duckdb","GLOB","varchar"],["hive","RLIKE","string"],["hql","NOT REGEXP","string"],["clickhouse","ILIKE","String"],["ch","REGEXP","String"]])("uses a pattern value slot for %s %s",(profile,operator,type)=>{
 const condition=`value ${operator} `,context=whereCompletionContext(options(condition,profile));expect(context).toMatchObject({phase:"value",type});
 const labels=localWhereCompletionCandidates(options(condition,profile)).map(item=>item.label);expect(labels).toContain("''");expect(labels).not.toContain("0");expect(labels).not.toContain("TRUE");
});
it.each(["value SIMILAR ","value NOT SIMILAR "])("offers only the required TO transition for %s",condition=>{
 const selected=localWhereCompletionCandidates(options(condition,"duckdb"));expect(selected.map(item=>item.label)).toEqual(["TO"]);
 const remote=filterWhereRemoteCompletions([{label:"TO",kind:Kind.Keyword},{label:"TO",kind:Kind.Field},{label:"TO",kind:Kind.Function},{label:"AND",kind:Kind.Keyword},{label:"value",kind:Kind.Field}],whereCompletionContext(options(condition,"duckdb")),"duckdb");expect(remote.map(item=>item.label)).toEqual(["TO"]);
});
it("accepts mandatory TO across a full suffix after Unicode without overwriting SIMILAR",()=>{
 const condition="/*😀*/ value SIMILAR TSuffix",cursor=condition.indexOf("TSuffix")+1;
 const item=localWhereCompletionCandidates(options(condition,"duckdb",cursor)).find(item=>item.label==="TO");expect(item).toBeDefined();const range=item!.replacementRange??whereReplacementRange(condition,cursor);
 expect(condition.slice(0,range.start)+item!.insertText+condition.slice(range.end)).toBe("/*😀*/ value SIMILAR TO ");
});
it.each([["mysql","REGEXP"],["hive","RLIKE"],["sqlite","GLOB"],["duckdb","SIMILAR TO"],["clickhouse","ILIKE"]])("preserves a completed %s %s keyword when accepting a pattern",(profile,operator)=>{
 const condition=`value ${operator}`,item=localWhereCompletionCandidates(options(condition,profile)).find(item=>item.label==="''");expect(item).toBeDefined();const range=item!.replacementRange??whereReplacementRange(condition,condition.length);expect(condition.slice(0,range.start)+item!.insertText+condition.slice(range.end)).toBe(condition+" '' ");
});
it.each([["sqlite","REGEXP"],["hive","ILIKE"],["sqlserver","ILIKE"],["clickhouse","SIMILAR TO"]])("does not advertise %s %s in the operator list",(profile,operator)=>expect(localWhereCompletionCandidates(options("value ",profile)).map(item=>item.label)).not.toContain(operator));
it.each([
 ["postgres",["IN","BETWEEN","LIKE","ILIKE","SIMILAR TO"]],
 ["mysql",["IN","BETWEEN","LIKE","REGEXP","RLIKE"]],
 ["sqlite",["IN","BETWEEN","LIKE","GLOB"]],
 ["duckdb",["IN","BETWEEN","LIKE","ILIKE","SIMILAR TO"]],
 ["hive",["IN","BETWEEN","LIKE","REGEXP","RLIKE"]],
 ["clickhouse",["IN","BETWEEN","LIKE","ILIKE"]],
] as const)("keeps local and remote %s NOT predicates in the same dialect",(profile,expected)=>{
 const request=options("value NOT ",profile),context=whereCompletionContext(request);
 expect(localWhereCompletionCandidates(request).map(item=>item.label)).toEqual(expected);
 const remote=filterWhereRemoteCompletions([...expected.map(label=>({label,kind:Kind.Keyword})),{label:"value",kind:Kind.Field},{label:"SUM",kind:Kind.Function},{label:"~",kind:Kind.Operator},{label:profile==="sqlite"?"REGEXP":profile==="duckdb"?"GLOB":"EXISTS",kind:Kind.Keyword}],context,profile);
 expect(remote.map(item=>item.label)).toEqual(expected);
});
it.each(["GLOB","REGEXP","SIMILAR","TO"])("quotes metadata named %s so accepted fields remain operands",name=>{
 const condition=name.slice(0,1)+"Suffix",request={...options(condition,"postgres",1),columns:[{name,type:"text"}]};
 const item=localWhereCompletionCandidates(request).find(candidate=>candidate.label===name)!;expect(item).toBeDefined();
 const range=item.replacementRange??whereReplacementRange(condition,1),accepted=condition.slice(0,range.start)+item.insertText+condition.slice(range.end);
 expect(accepted).toBe('"'+name+'" = ');expect(whereCompletionContext({...request,condition:accepted,cursorOffset:accepted.length})).toMatchObject({phase:"value",type:"text"});
});
it.each([["duckdb","NOT GLOB"],["sqlite","REGEXP"],["clickhouse","NOT REGEXP"]])("does not infer a numeric or text pattern slot for unsupported %s %s",(profile,operator)=>expect(whereCompletionContext(options(`value ${operator} `,profile))).toMatchObject({phase:"value",type:undefined}));
it("accepts ClickHouse NOT ILIKE across a complete suffix after Unicode",()=>{
 const condition="/*😀*/ value NOT ISuffix",cursor=condition.indexOf("ISuffix")+1;
 const request={...options(condition,"clickhouse",cursor),columns:[{name:"value",type:"String"}]};
 const item=localWhereCompletionCandidates(request).find(candidate=>candidate.label==="ILIKE")!;expect(item).toBeDefined();
 const range=item.replacementRange??whereReplacementRange(condition,cursor);expect(condition.slice(0,range.start)+item.insertText+condition.slice(range.end)).toBe("/*😀*/ value NOT ILIKE ");
});
