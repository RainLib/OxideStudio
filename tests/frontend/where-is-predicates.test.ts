import {expect,it} from "vitest";
import {localWhereCompletionCandidates,whereReplacementRange} from "@/lib/whereCompletion";
import {filterWhereRemoteCompletions} from "@/features/data-grid/model/whereRemoteCompletion";
import {whereCompletionContext} from "@/lib/whereCompletion";
import {CompletionItemKind as Kind} from "@/services/lsp/types";
const columns=[{name:"flag",type:"boolean"},{name:"amount",type:"integer"}];
const complete=(condition:string,driver:string)=>localWhereCompletionCandidates({condition,cursorOffset:condition.length,driver,columns});
it.each([
 ["postgres","flag IS ",["NULL","NOT NULL","TRUE","FALSE","UNKNOWN","NOT TRUE","NOT FALSE","NOT UNKNOWN","DISTINCT FROM","NOT DISTINCT FROM"]],
 ["postgres","flag IS NOT ",["NULL","TRUE","FALSE","UNKNOWN","DISTINCT FROM"]],
 ["postgres","amount IS ",["NULL","NOT NULL","DISTINCT FROM","NOT DISTINCT FROM"]],
 ["mysql","amount IS ",["NULL","NOT NULL","TRUE","FALSE","UNKNOWN","NOT TRUE","NOT FALSE","NOT UNKNOWN"]],
 ["hive","flag IS ",["NULL","NOT NULL","TRUE","FALSE","NOT TRUE","NOT FALSE"]],
 ["clickhouse","amount IS ",["NULL","NOT NULL"]],
 ["sqlserver","flag IS ",["NULL","NOT NULL"]],
])("offers %s IS forms appropriate to %s",(driver,condition,expected)=>{expect(complete(condition,driver).map(item=>item.label)).toEqual(expected);});
it.each(["postgres","duckdb","sqlite","sqlserver"])("preserves the RHS field inside %s IS NOT DISTINCT FROM",driver=>{
 const condition="flag IS NOT DISTINCT FROM amoSuffix",cursorOffset=condition.indexOf("amoSuffix")+3;
 const candidate=localWhereCompletionCandidates({condition,cursorOffset,driver,columns}).find(item=>item.label==="amount")!;expect(candidate).toBeDefined();
 const range=candidate.replacementRange??whereReplacementRange(condition,cursorOffset);expect(condition.slice(0,range.start)+candidate.insertText+condition.slice(range.end)).toBe("flag IS NOT DISTINCT FROM amount");
});
it.each(["postgres","duckdb","sqlite","sqlserver"])("completes the mandatory FROM after DISTINCT for %s",driver=>{
 const condition="flag IS NOT DISTINCT";const candidate=complete(condition,driver).find(item=>item.label==="FROM")!;expect(candidate).toBeDefined();const range=candidate.replacementRange??whereReplacementRange(condition,condition.length);expect(condition.slice(0,range.start)+candidate.insertText+condition.slice(range.end)).toBe("flag IS NOT DISTINCT FROM ");
});
it.each(["integer","boolean[]","bit(3)","Nullable(LowCardinality(BIT(3)))"])("rejects truth tests for PostgreSQL %s while preserving null tests",type=>{
 const condition="flag IS ";const items=localWhereCompletionCandidates({condition,cursorOffset:condition.length,driver:"postgres",columns:[{name:"flag",type}]});expect(items.map(item=>item.label)).toEqual(["NULL","NOT NULL","DISTINCT FROM","NOT DISTINCT FROM"]);
});
it.each(["flag IS ","flag IS NOT "])("retains SQLite field operands at %s",condition=>{
 expect(complete(condition,"sqlite").find(item=>item.label==="amount")?.insertText).toBe("amount");
 const context=whereCompletionContext({condition,cursorOffset:condition.length,driver:"sqlite",columns});
 const candidates=[{label:"amount",kind:Kind.Field},{label:"COALESCE",kind:Kind.Function},{label:"UNKNOWN",kind:Kind.Keyword}];
 expect(filterWhereRemoteCompletions(candidates,context,"sqlite").map(item=>item.label)).toEqual(["amount","COALESCE"]);
});
it.each(["flag IS","flag IS NOT"])("strict keyword slots discard functions and fields after %s",condition=>{
 const context=whereCompletionContext({condition,cursorOffset:condition.length,driver:"sqlserver",columns});
 expect(filterWhereRemoteCompletions([{label:"amount",kind:Kind.Field},{label:"COALESCE",kind:Kind.Function},{label:"TRUE",kind:Kind.Keyword},{label:"NULL",kind:Kind.Keyword}],context,"sqlserver")).toEqual([{label:"NULL",kind:Kind.Keyword}]);
});
it.each(["sqlserver","clickhouse"])("retains version-qualified %s null-safe operators supplied by the server",driver=>{
 const condition="flag IS ";const context=whereCompletionContext({condition,cursorOffset:condition.length,driver,columns});
 const candidates=[{label:"DISTINCT FROM",kind:Kind.Keyword},{label:"NOT DISTINCT FROM",kind:Kind.Keyword}];expect(filterWhereRemoteCompletions(candidates,context,driver)).toEqual(candidates);
});
it.each([
 ["'true'",true],["('true')",true],["CAST('true' AS TEXT)",false],
 ["COALESCE('true','false')",false],["CASE WHEN flag THEN 'true' ELSE 'false' END",false],
 ["NULLIF('true','false')",false],["TRUE",true],
])("preserves PostgreSQL literal coercion and resolved expression types for %s",(expression,truth)=>{
 expect(complete(expression+" IS ","postgres").some(item=>item.label==="TRUE")).toBe(truth);
});
it("keeps internal literal type markers out of the completion presentation",()=>{
 const items=complete("'1' = ","postgres");expect(items.length).toBeGreaterThan(0);expect(items.every(item=>!item.detail?.includes("__oxide"))).toBe(true);
});
