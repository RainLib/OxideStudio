import {expect,it} from "vitest";
import {filterWhereRemoteCompletions} from "./whereRemoteCompletion";
import {whereCompletionContext} from "@/lib/whereCompletion";
import {CompletionItemKind as Kind,type CompletionItem} from "@/services/lsp/types";
const items:CompletionItem[]=[{label:"AND",kind:Kind.Keyword},{label:"OR",kind:Kind.Keyword},{label:"=",kind:Kind.Operator},{label:"status",kind:Kind.Field},{label:"COALESCE",kind:Kind.Function}];
const context=(condition:string)=>whereCompletionContext({condition,cursorOffset:condition.length,driver:"postgres",columns:[{name:"status",type:"text"}]});
it.each([["sqlite","integer"],["sqlite","text"],["mysql","integer"],["mariadb","text"],["clickhouse","UInt8"]])("keeps legal scalar logical operators for %s %s",(profile,type)=>{
 const condition="value ",syntax=whereCompletionContext({condition,cursorOffset:condition.length,driver:"postgres",dialect:profile,columns:[{name:"value",type}]});
 expect(filterWhereRemoteCompletions(items,syntax,profile).map(item=>item.label)).toEqual(["AND","OR","="]);
});
it("does not treat SQL Server BIT as a standalone predicate",()=>{
 const condition="value ",syntax=whereCompletionContext({condition,cursorOffset:condition.length,driver:"postgres",dialect:"sqlserver",columns:[{name:"value",type:"bit"}]});
 expect(filterWhereRemoteCompletions(items,syntax,"sqlserver").map(item=>item.label)).toEqual(["="]);
});
it("rejects server fields, functions and logical continuations after a known text expression",()=>{
 expect(filterWhereRemoteCompletions(items,context("LOWER(status) "),"postgres").map(item=>item.label)).toEqual(["="]);
});
it("keeps logical continuations for unknown or boolean return types",()=>{
 expect(filterWhereRemoteCompletions(items,context("unknown_function() "),"postgres").map(item=>item.label)).toEqual(["AND","OR","="]);
});
it.each(["pg_catalog.int4",'"pg_catalog"."int2"',"pg_catalog.numeric(12,2)"])("uses the explicit PostgreSQL profile when filtering logical continuations for %s",type=>{
 const condition="value ";const syntax=whereCompletionContext({condition,cursorOffset:condition.length,driver:"postgres",columns:[{name:"value",type}]});
 expect(filterWhereRemoteCompletions(items,syntax,"postgres").map(item=>item.label)).toEqual(["="]);
});
it.each(["age BETWEEN COALESCE(1,0) ","status BETWEEN 'a' "])("requires only the range separator in %s",condition=>{
 expect(filterWhereRemoteCompletions(items,context(condition),"postgres").map(item=>item.label)).toEqual(["AND"]);
});
it("preserves document-local fields and functions in an operand slot",()=>{
 expect(filterWhereRemoteCompletions(items,context("EXISTS (SELECT 1 WHERE "),"postgres")).toEqual(items);
});
it("withdraws only invalid T-SQL truth keywords while retaining quoted fields and numeric values",()=>{
 const values:CompletionItem[]=[{label:"TRUE",kind:Kind.Keyword},{label:"FALSE",kind:Kind.Keyword},{label:"TRUE",kind:Kind.Field,insertText:"[TRUE]"},{label:"0",kind:Kind.Snippet},{label:"NULL",kind:Kind.Keyword}];
 expect(filterWhereRemoteCompletions(values,context("status = "),"sqlserver").map(item=>item.insertText??item.label)).toEqual(["[TRUE]","0","NULL"]);
});
it("does not mutate authoritative replacement edits while filtering",()=>{
 const item:CompletionItem={label:"AND",kind:Kind.Keyword,textEdit:{range:{start:{line:0,character:10},end:{line:0,character:10}},newText:" AND "}};
 expect(filterWhereRemoteCompletions([item],context("status='x' "),"postgres")[0]).toBe(item);
});
