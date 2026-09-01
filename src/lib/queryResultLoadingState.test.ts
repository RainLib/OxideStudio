import { describe, expect, it } from "vitest";
import { isActiveQueryResultLoading } from "./queryResultLoadingState";

describe("isActiveQueryResultLoading", () => {
  it("only masks the query result that initiated the execution", () => {
    expect(
      isActiveQueryResultLoading({
        isExecuting: true,
        tabType: "query",
        activeResultIndex: 0,
        executingResultIndex: 0,
      }),
    ).toBe(true);
    expect(
      isActiveQueryResultLoading({
        isExecuting: true,
        tabType: "query",
        activeResultIndex: 1,
        executingResultIndex: 0,
      }),
    ).toBe(false);
  });

  it("keeps table reloads and legacy execution state conservative", () => {
    expect(
      isActiveQueryResultLoading({
        isExecuting: true,
        tabType: "table",
        activeResultIndex: 1,
        executingResultIndex: 0,
      }),
    ).toBe(true);
    expect(
      isActiveQueryResultLoading({ isExecuting: true, tabType: "query" }),
    ).toBe(true);
    expect(
      isActiveQueryResultLoading({
        isExecuting: false,
        tabType: "query",
        executingResultIndex: 0,
      }),
    ).toBe(false);
  });
});
