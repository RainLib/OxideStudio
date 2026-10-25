import {expect, it} from "vitest";
import {localWhereCompletionCandidates,whereReplacementRange} from "@/lib/whereCompletion";
const columns=[{name:"status",type:"text"},{name:"age",type:"integer"},{name:"active",type:"boolean"}];
const complete=(marked:string,driver="postgres")=>{
 const cursorOffset=marked.includes("|")?marked.indexOf("|"):marked.length;
 return localWhereCompletionCandidates({condition:marked.replace("|",""),cursorOffset,driver,columns});
};
it.each([
 "COALESCE(status, '') ","LOWER(status) ","(status) ",
 "CASE WHEN active THEN age ELSE 0 END ",
 "CAST(age AS DECIMAL(12, 2)) ",
 "(SELECT MAX(age) FROM users) ",
])("offers operators after a completed scalar expression: %s",condition=>{
 const labels=complete(condition).map(item=>item.label);
 expect(labels).toContain("=");expect(labels).toContain("IN");expect(labels).not.toContain("AND");
});
it.each([
 "status = 'IN (' ","status = 'BETWEEN 1' ",
 "status = 'x' /* BETWEEN 1 */ ","status = 'x' -- IN (\n",
 "(active = TRUE) ","EXISTS (SELECT 1 FROM other_table WHERE id = 1) ",
])("continues a complete predicate without reading literal/comment keywords: %s",condition=>{
 expect(complete(condition).map(item=>item.label)).toEqual(["AND","OR"]);
});
it.each([
 "age BETWEEN COALESCE(1, 0) ",
 "age BETWEEN (1 + 2) ",
 "age BETWEEN CASE WHEN active THEN 1 ELSE 2 END ",
])("offers only the range separator after a complete lower expression: %s",condition=>{
 expect(complete(condition).map(item=>item.label)).toEqual(["AND"]);
});
it.each([
 "age IN (1, COALESCE(2, 3) ","age IN ((1 + 2) ",
 "status IN (CASE WHEN active THEN 'a' ELSE 'b' END ",
])("continues only the innermost IN list after a complete item: %s",condition=>{
 expect(complete(condition).map(item=>item.label)).toEqual([",",")"]);
});
it.each([
 "LOWER(status) = ","COALESCE(status, '') LIKE ",
 "CASE WHEN active THEN status ELSE '' END LIKE ",
])("infers text value hints from a scalar expression: %s",condition=>{
 expect(complete(condition).map(item=>item.label)).toEqual(expect.arrayContaining(["''","'%…%'","NULL"]));
 expect(complete(condition).map(item=>item.label)).not.toContain("CURRENT_TIMESTAMP");
});
it.each(["postgres","mysql","sqlserver","sqlite","duckdb","clickhouse","hive"])("keeps %s nested function and CASE operands available",driver=>{
 for(const marked of ["COALESCE(status, sta|Suffix)","age IN (COALESCE(1, sta|Suffix))","CASE WHEN active THEN sta|Suffix ELSE '' END = 'x'","age BETWEEN 1 AND (age + sta|Suffix)"]){
  const item=complete(marked,driver).find(value=>value.label==="status");
  expect(item,marked).toBeDefined();expect(item?.insertText,marked).toBe("status");
 }
});
it.each([
 ["CASE 1|","WHEN","CASE 1 WHEN "],
 ["CASE WHEN active = TRUE|","THEN","CASE WHEN active = TRUE THEN "],
 ["CASE WHEN active THEN 1|","ELSE","CASE WHEN active THEN 1 ELSE "],
 ["CASE WHEN active THEN 1 ELSE 0|END","END","CASE WHEN active THEN 1 ELSE 0 END "],
 ["COALESCE(1|)",",","COALESCE(1, )"],
 ["COALESCE(1|)",")","COALESCE(1)"],
 ["age = (sta|","status","age = (status"],
])("accepts %s → %s without consuming a value or repeating its closer",(marked,label,expected)=>{
 const condition=marked.replace("|",""),cursor=marked.indexOf("|"),item=complete(marked).find(value=>value.label===label)!;
 expect(item).toBeDefined();const range=item.replacementRange??whereReplacementRange(condition,cursor);
 expect(condition.slice(0,range.start)+item.insertText+condition.slice(range.end)).toBe(expected);
});
it.each(["INTEGER","BIGINT","UInt64","Nullable(UInt32)","float8"])("offers numeric literals for %s and innermost IN operands",type=>{
 for(const condition of ["age = ","status IN ('a') AND age IN ("]){
  const items=localWhereCompletionCandidates({condition,cursorOffset:condition.length,driver:"postgres",columns:[{name:"age",type},{name:"status",type:"text"}]});
  expect(items.map(item=>item.label)).toEqual(["0","1","NULL"]);
 }
});
it("uses T-SQL truth/value forms and retains the explicit profile over a mysql driver",()=>{
 for(const [condition,labels] of [["active = ",["0","1","NULL"]],["active IS ",["NULL","NOT NULL"]],["active IS NOT ",["NULL"]]] as const){
  expect(localWhereCompletionCandidates({condition,cursorOffset:condition.length,driver:"mysql",dialect:"sqlserver",columns:[{name:"active",type:"bit"}]}).map(item=>item.label)).toEqual(labels);
 }
});
it.each([
 ["age + 1 > 0 AND (sta|","status = "],
 ["age + 1 > 0 OR (sta|","status = "],
 ["age > 0 AND ((sta|","status = "],
 ["age + (sta|","status"],
 ["age::INTEGER = (sta|","status"],
 ["age::INTEGER + 1 > 0 AND (sta|","status = "],
])("uses the current predicate segment to complete %s",(marked,insert)=>{
 expect(complete(marked).find(item=>item.label==="status")?.insertText).toBe(insert);
});
it("delegates an unfinished PostgreSQL cast type without offering fields or IN punctuation",()=>{
 expect(complete("age::IN|Suffix")).toEqual([]);
 expect(complete("CAST(age AS INT|Suffix)")).toEqual([]);
});
