import {expect,it} from "vitest";
import {sqlPredicateContext,sqlCompletionTypeFamily} from "./predicateContext";
import {sqlCompletionTokens} from "./completionRegion";
const columns=[{name:"status",type:"text"},{name:"age",type:"INTEGER"},{name:"active",type:"boolean"}];
const context=(condition:string,extra:Partial<Parameters<typeof sqlPredicateContext>[0]>={})=>sqlPredicateContext({condition,cursorOffset:condition.length,replacementStart:condition.length,columns,dialect:"postgres",...extra});
it.each([["INTEGER","integer"],["BOOLEAN","numeric"],["VARCHAR(8)","text"],["\"FLOATING POINT\"","integer"],["BLOB","blob"],["REAL","real"],["DATE","numeric"]])("uses SQLite CAST affinity for %s",(type,expected)=>{
 expect(context(`CAST(1 AS ${type}) = `,{dialect:"sqlite"})).toMatchObject({phase:"value",type:expected});
});
it.each([
 ["integer","number"],["bigint","number"],["UInt64","number"],["Decimal128(4)","number"],["float8","number"],
 ["Nullable(UInt32)","number"],["LowCardinality(String)","text"],["character varying(20)","text"],
 ["nvarchar(max)","text"],["FixedString(20)","text"],["TIMESTAMPTZ","temporal"],["DateTime64(3)","temporal"],
 ["datetime2","temporal"],["timestamp with time zone","temporal"],["uniqueidentifier","uuid"],["jsonb","json"],
 ["boolean","boolean"],["bit","boolean"],["INTEGER[]","other"],["Array(UInt64)","other"],["Tuple(a Int32)","other"],
 ["Map(String, Int32)","other"],["app.my_domain","other"],
])("classifies %s without treating nested containers as scalar %s",(type,family)=>expect(sqlCompletionTypeFamily(type)).toBe(family));
it.each([
 ["age > ","INTEGER"],["LOWER(status) = ","text"],["COALESCE(age, 0) >= ","numeric"],
 ["CASE WHEN active THEN age ELSE 0 END > ","numeric"],["CAST(age AS NUMERIC(20, 4)) = ","NUMERIC(20, 4)"],
 ["age::DECIMAL(20,4) >= ","DECIMAL(20,4)"],["(age + 1) > ","numeric"],
 ["COALESCE(status, NULL) = ","text"],["COALESCE(unknown_function(), status) = ",undefined],
 ["other.status = ",undefined],["(SELECT age FROM foreign_table) > ",undefined],
 ["other.lower(status) = ",undefined],["\"LOWER\"(status) = ",undefined],
])("derives only justified types for %s",(condition,type)=>expect(context(condition).type).toBe(type));
it("uses only explicit authorized qualifiers for typed fields",()=>{
 expect(context("u.status = ",{qualifiers:["u"]}).type).toBe("text");
 expect(context("q.status = ",{qualifiers:["u"]}).type).toBeUndefined();
});
it.each([
 ["CASE active ","case-when"],["CASE WHEN active = TRUE ","case-then"],
 ["CASE WHEN active THEN age ","case-result"],["CASE WHEN active THEN age ELSE 0 ","case-end"],
 ["age IN (SELECT status FROM ","relation"],["CAST(age AS ","type"],["CAST(age AS DECIMAL(","type"],
 ["age IN (SELECT status FROM users WHERE ","operand"],["status IN ","open-in"],
 ["COALESCE(age, 1 ","argument-continuation"],
])("tracks the innermost grammar slot in %s",(condition,phase)=>expect(context(condition).phase).toBe(phase));
it.each(["age = (", "age BETWEEN 0 AND (", "COALESCE(", "CASE WHEN active THEN ("])("does not append a predicate in scalar group %s",condition=>expect(context(condition).canAppendPredicate).toBe(false));
it("preserves MySQL adjacent hash comments, T-SQL names, UTF-16 offsets and opaque keyword literals",()=>{
 expect(sqlCompletionTokens("name=foo# IN (",13,"mysql").region).toBe("comment");
 const temporary=sqlCompletionTokens("SELECT #temp",12,"sqlserver").tokens;expect(temporary[temporary.length-1]?.text).toBe("#temp");
 const source="'😀 IN (' /* BETWEEN */ AND status";
 const result=sqlCompletionTokens(source,source.length,"postgres");
 expect(result.tokens.map(token=>token.text)).toEqual(["'😀 IN ('","AND","status"]);
 expect(source.slice(result.tokens[2]!.start,result.tokens[2]!.end)).toBe("status");
});
it("bounds source size, token count and nesting before building completion state",()=>{
 expect(context("(".repeat(130)).blocked).toBe(true);
 expect(context("x ".repeat(16385)).blocked).toBe(true);
 expect(context(" ".repeat(524289)).blocked).toBe(true);
});
it("handles long flat arithmetic chains without recursive stack growth or type leakage",()=>{
 expect(context(Array.from({length:3000},()=>"age").join(" + ")+" > ").type).toBe("numeric");
 expect(context("status + age > ").type).toBeUndefined();
 expect(context("status + status = ",{dialect:"sqlserver"}).type).toBe("text");
 expect(context("age::INTEGER[] = ").type).toBe("INTEGER[]");
});
