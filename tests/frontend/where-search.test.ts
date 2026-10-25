import { expect, it } from "vitest";
import { localWhereCompletionCandidates, searchWhereCompletionCandidates } from "@/lib/whereCompletion";
import { ensurePinyinCompletionSupport } from "@/features/query-editor/model/completionMatch";

it("loads pinyin for a cold asynchronous comment search and preserves qualified suffix edits", async () => {
  const condition = "t.yhmcSuffix > 0";
  const result = await searchWhereCompletionCandidates({condition, cursorOffset: 6, driver: "postgres", columns: [{name: "customer_name", comment: "用户名称", type: "text"}]});
  expect(result[0]?.label).toBe("customer_name");
  expect(result[0]?.replacementRange).toEqual({start: 2, end: 12});
  expect(result[0]?.insertText).toBe("customer_name");
});

it("matches Chinese field names by pinyin initials in the Where fallback", async () => {
  await ensurePinyinCompletionSupport();
  const result = localWhereCompletionCandidates({ condition: "yhmc", cursorOffset: 4, driver: "sqlite", columns: [{ name: "用户名称", type: "text" }] });
  expect(result.find(item => item.label === "用户名称")?.insertText).toBe('"用户名称" = ');
});

it("searches column comments and ranks identifier matches before comment-only matches", () => {
  const columns = [{ name: "account_id", type: "uuid", comment: "customer reference" }, { name: "customer_name", type: "text" }];
  const result = localWhereCompletionCandidates({ condition: "customer", cursorOffset: 8, driver: "postgres", columns });
  expect(result.map(item => item.label)).toEqual(["customer_name", "account_id"]);
  expect(result[1]?.detail).toContain("customer reference");
});

it("ranks all fields before applying the completion bound", () => {
  const columns = Array.from({ length: 2000 }, (_, index) => ({ name: `field_${index}`, comment: index === 1999 ? "目标业务字段" : "" }));
  const result = localWhereCompletionCandidates({ condition: "目标业务", cursorOffset: 4, driver: "mysql", columns });
  expect(result.map(item => item.label)).toEqual(["field_1999"]);
});

it("bounds auxiliary comments without splitting Unicode or truncating field names", async () => {
  const name = "very_long_" + "x".repeat(300);
  const result = await searchWhereCompletionCandidates({condition: "业务", cursorOffset: 2, driver: "sqlite", columns: [{name, comment: "业务" + "😀".repeat(2000)}]});
  expect(result[0]?.label).toBe(name);
  expect(new TextEncoder().encode(result[0]?.detail?.split(" · ").pop())).toHaveLength(2046);
  expect(result[0]?.detail).not.toMatch(/[\uD800-\uDBFF]$/u);
});

it("rejects cancellation before and after the asynchronous dictionary boundary", async () => {
  const options = {condition: "yhmc", cursorOffset: 4, driver: "sqlite", columns: [{name: "用户名称"}]};
  expect(await searchWhereCompletionCandidates(options, {isCancellationRequested: true})).toEqual([]);
  let cancelled = false;
  const work = searchWhereCompletionCandidates(options, {get isCancellationRequested(){return cancelled;}});
  cancelled = true;
  expect(await work).toEqual([]);
});

it("caps empty results and retains exact name priority over many comment hits", async () => {
  const columns = Array.from({length: 1200}, (_, i) => ({name: `column_${i}`, comment: "用户名称"}));
  columns.push({name: "yhmc", comment: ""});
  const result = await searchWhereCompletionCandidates({condition: "yhmc", cursorOffset: 4, driver: "mysql", columns});
  expect(result).toHaveLength(256);
  expect(result[0]?.label).toBe("yhmc");
  expect(localWhereCompletionCandidates({condition: "", cursorOffset: 0, driver: "sqlite", columns}).filter(item => item.kind === 5)).toHaveLength(256);
});
