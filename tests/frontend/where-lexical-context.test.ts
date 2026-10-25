import {expect, it} from "vitest";
import {localWhereCompletionCandidates} from "@/lib/whereCompletion";
import {sqlCompletionRegionAtCursor} from "@/features/query-languages/sql/completionRegion";

const hidden = [
  ["postgres", "name = 'user|name'"],
  ["postgres", "name = E'user\\'|name'"],
  ["postgres", "name = $body$user|name$body$"],
  ["postgres", "name = $$user|name$$"],
  ["postgres", "id = 1 /* outer /* inner */ user| */"],
  ["postgres", "id = 1 -- user|\nAND id = 2"],
  ["mysql", "name = 'user\\'|name'"],
  ["mysql", "name = 1#user|\nAND id = 2"],
  ["mysql", "id = 1 -- user|"],
  ["sqlite", "name = 'user''|name'"],
  ["sqlserver", "name = N'user|name'"],
  ["sqlserver", "id = 1 /* outer /* inner */ user| */"],
  ["duckdb", "name = $$user|name$$"],
  ["duckdb", "id = 1 /* outer /* inner */ user| */"],
  ["clickhouse", "name = 'user\\'|name'"],
  ["hive", 'name = "user|name"'],
] as const;
it.each(hidden)("does not offer identifiers inside a %s literal or comment: %s", (driver, marked) => {
  const cursorOffset = marked.indexOf("|");
  const result = localWhereCompletionCandidates({condition: marked.replace("|", ""), cursorOffset, driver, columns: [{name: "username"}]});
  expect(result).toEqual([]);
});

it.each([
  ["postgres", "'backslash\\' OR user|"],
  ["sqlite", "'backslash\\' OR user|"],
  ["sqlserver", "'backslash\\' OR user|"],
  ["postgres", "1 /* done */ AND user|"],
  ["mysql", "1--(user|"],
  ["postgres", '"user|name"'],
  ["mysql", "`user|name`"],
  ["sqlserver", "[user|name]"],
] as const)("keeps completion available in %s SQL or quoted identifiers: %s", (driver, marked) => {
  const result = localWhereCompletionCandidates({condition: marked.replace("|", ""), cursorOffset: marked.indexOf("|"), driver, columns: [{name: "username"}]});
  expect(result.some(item => item.label === "username")).toBe(true);
});
it("keeps a T-SQL temporary identifier outside comment context",()=>{
 expect(sqlCompletionRegionAtCursor("#user",5,"sqlserver")).toBe("sql");
});
