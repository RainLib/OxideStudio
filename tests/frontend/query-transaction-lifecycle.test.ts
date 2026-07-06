import { describe, expect, it } from "vitest";
import {
  collectStaleTransactionTabIds,
  removeTransactionStates,
  type QueryTransactionSession,
  type QueryTransactionTabContext,
} from "@/lib/queryTransactionLifecycle";

function sessions(entries: Array<[string, QueryTransactionSession]>) {
  return new Map(entries);
}

function context(
  tabId: string,
  connectionId: string | null,
  supportsTransactions = true
): QueryTransactionTabContext {
  return { tabId, connectionId, supportsTransactions };
}

describe("query transaction lifecycle", () => {
  it("keeps sessions when the tab still targets the same transaction-capable connection", () => {
    const stale = collectStaleTransactionTabIds(
      sessions([
        ["tab-1", { connectionId: "pg-1", transactionId: "pg-1:tab-1" }],
      ]),
      [context("tab-1", "pg-1")]
    );

    expect(stale).toEqual([]);
  });

  it("marks sessions stale when tabs close or move to another connection", () => {
    const stale = collectStaleTransactionTabIds(
      sessions([
        ["tab-1", { connectionId: "pg-1", transactionId: "pg-1:tab-1" }],
        ["tab-2", { connectionId: "pg-1", transactionId: "pg-1:tab-2" }],
      ]),
      [context("tab-1", "mysql-1")]
    );

    expect(stale).toEqual(["tab-1", "tab-2"]);
  });

  it("marks sessions stale when the current driver does not support transactions", () => {
    const stale = collectStaleTransactionTabIds(
      sessions([
        ["tab-1", { connectionId: "pg-1", transactionId: "pg-1:tab-1" }],
      ]),
      [context("tab-1", "pg-1", false)]
    );

    expect(stale).toEqual(["tab-1"]);
  });

  it("removes stale transaction states without mutating unchanged state", () => {
    const state = { "tab-1": "active", "tab-2": "active" };

    expect(removeTransactionStates(state, [])).toBe(state);
    expect(removeTransactionStates(state, ["tab-1"])).toEqual({
      "tab-2": "active",
    });
    expect(state).toEqual({ "tab-1": "active", "tab-2": "active" });
  });
});
