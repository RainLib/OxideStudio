import {expect,it} from "vitest";
import {localWhereCompletionCandidates,mergeWhereCompletionCandidates,whereCompletionContext,whereReplacementRange} from "@/lib/whereCompletion";
import {CompletionItemKind} from "@/services/lsp/types";
import {filterWhereRemoteCompletions} from "@/features/data-grid/model/whereRemoteCompletion";
import {sqlIsPredicateLabels,sqlValueTemplates,sqlLogicalContinuation} from "@/features/query-languages/sql/valueTemplates";
it.each([
 ["postgres","boolean",true],["postgres","pg_catalog.int4",false],["postgres","bit(3)",false],["postgres","boolean[]",false],["postgres","app.custom",undefined],["postgres","__oxide_untyped_string__",undefined],
 ["sqlserver","bit",false],["mssql","int",false],["tsql","varchar(8)",false],
 ["sqlite","integer",true],["sqlite3","text",true],["sqlite","blob",true],
 ["mysql","int",true],["mariadb","text",true],["mysql","json",undefined],["mysql","enum('yes','no')",true],
 ["hive","boolean",true],["hql","int",false],
 ["clickhouse","Nullable(UInt8)",true],["ch","Float64",true],["clickhouse","Decimal64(2)",false],["clickhouse","String",false],["clickhouse","Array(UInt8)",false],
 ["duckdb","INTEGER",true],["duckdb","VARCHAR",true],["duckdb","BIT",true],["duckdb","DATE",false],["duckdb","JSON",undefined],["duckdb","enum('true','false')",undefined],["redshift","boolean",undefined],
] as const)("models scalar logical continuation for %s %s",(profile,type,expected)=>expect(sqlLogicalContinuation(type,profile)).toBe(expected));
it("adds a legal SQLite logical continuation with a complete UTF-16 keyword replacement",()=>{
 const condition="/*😀*/ CAST(1 AS INTEGER) ASuffix",cursorOffset=condition.indexOf("ASuffix")+1;
 const item=localWhereCompletionCandidates({condition,cursorOffset,driver:"sqlite",columns:[]}).find(item=>item.label==="AND");expect(item).toBeDefined();
 const range=item?.replacementRange??whereReplacementRange(condition,cursorOffset);expect(condition.slice(0,range.start)+item!.insertText+condition.slice(range.end)).toBe("/*😀*/ CAST(1 AS INTEGER) AND ");
});
it.each(["int4.custom","bool.custom","bit.custom",'"array".custom'])("does not classify custom type %s by its schema name",type=>{
 expect(sqlValueTemplates(type,"postgres").map(item=>item.label)).toEqual(["NULL","TRUE","FALSE","CURRENT_DATE","CURRENT_TIMESTAMP"]);
 expect(sqlIsPredicateLabels(type,"postgres",false)).toContain("TRUE");
});

it.each(["pg_catalog.int4",'"pg_catalog" . "int2"',"pg_catalog.numeric(12,-2)","pg_catalog.float8"])("uses numeric values and excludes truth tests for catalog type %s",type=>{
 expect(sqlValueTemplates(type,"postgres").map(item=>item.label)).toEqual(["0","1","NULL"]);
 expect(sqlIsPredicateLabels(type,"postgres",false)).not.toContain("TRUE");
});
it.each(["pg_catalog._bool","pg_catalog.bool [2]","pg_catalog.inet","pg_catalog.bytea"])("keeps known nonboolean catalog type %s out of scalar truth/value hints",type=>{
 expect(sqlValueTemplates(type,"postgres").map(item=>item.label)).toEqual(["NULL"]);
 expect(sqlIsPredicateLabels(type,"postgres",false)).not.toContain("TRUE");
});
it.each(["CAST(B'001' AS pg_catalog.bit(3))","B'001'::pg_catalog.bit(3)"])("preserves type modifiers when folding %s",expression=>{
 const condition=expression+" = ";
 expect(localWhereCompletionCandidates({condition,cursorOffset:condition.length,driver:"postgres",columns:[]}).map(item=>item.label)).toEqual(["B'000'","B'001'","NULL"]);
});
it.each(["CAST(1 AS pg_catalog.int4) + 2","COALESCE(CAST(1 AS pg_catalog.int2), CAST(2 AS INTEGER))","CASE WHEN TRUE THEN CAST(1 AS pg_catalog.int4) ELSE CAST(2 AS INTEGER) END"])("composes catalog identities in Where expression %s",expression=>{
 const condition=expression+" IS ";expect(localWhereCompletionCandidates({condition,cursorOffset:condition.length,driver:"postgres",columns:[]}).some(item=>item.label==="TRUE")).toBe(false);
});
it.each([
 ["postgres","bit(3)",["B'000'","B'001'","NULL"]],
 ["postgres","bit varying(8)",["B'0'","B'1'","NULL"]],
 ["mysql","BIT(3)",["B'000'","B'001'","NULL"]],
 ["sqlite","BIT",["0","1","NULL"]],
 ["sqlserver","BIT",["0","1","NULL"]],
 ["duckdb","BIT",["'0'::BIT","'1'::BIT","NULL"]],
 ["postgres","boolean[]",["NULL"]],
])("uses %s %s literal semantics in local fallback",(driver,type,expected)=>{
 const condition="flags = ";const items=localWhereCompletionCandidates({condition,cursorOffset:condition.length,driver,columns:[{name:"flags",type}]});
 expect(items.map(item=>item.label)).toEqual(expected);
});
it.each(["integer","boolean[]","bit(3)","Nullable(Array(Boolean))"])("removes incompatible remote truth keywords for %s while preserving same-named fields",type=>{
 const condition="flags = ";const context=whereCompletionContext({condition,cursorOffset:condition.length,driver:"postgres",columns:[{name:"flags",type}]});
 const result=filterWhereRemoteCompletions([{label:"TRUE",kind:CompletionItemKind.Keyword},{label:"CURRENT_DATE",kind:CompletionItemKind.Keyword},{label:"TRUE",kind:CompletionItemKind.Field}],context,"postgres");
 expect(result).toEqual([{label:"TRUE",kind:CompletionItemKind.Field}]);
});
it.each([
 ["flags BETWEEN","0","flags BETWEEN 0 "],
 ["flags IS","NULL","flags IS NULL "],
 ["flags IS NOT","NULL","flags IS NOT NULL "],
 ["flags NOT","IN","flags NOT IN ("],
 ["flags IN","(","flags IN("],
])("accepts a value after the complete keyword %s without deleting it",(condition,label,expected)=>{
 const candidate=localWhereCompletionCandidates({condition,cursorOffset:condition.length,driver:"sqlserver",columns:[{name:"flags",type:"bit"}]}).find(item=>item.label===label)!;
 expect(candidate).toBeDefined();const range=candidate.replacementRange??whereReplacementRange(condition,condition.length);
 expect(condition.slice(0,range.start)+candidate.insertText+condition.slice(range.end)).toBe(expected);
});
it("preserves the local numeric insertion action when a server literal replaces its metadata",()=>{
 const condition="flag = ",local=localWhereCompletionCandidates({condition,cursorOffset:condition.length,driver:"sqlserver",columns:[{name:"flag",type:"bit"}]});
 const merged=mergeWhereCompletionCandidates(local,[{label:"0",insertText:"0",kind:CompletionItemKind.Value}]);
 expect(merged.find(item=>item.label==="0")?.insertText).toBe("0 ");
});
