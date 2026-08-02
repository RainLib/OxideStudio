import { describe, expect, it } from "vitest";
import {
  queryTransactionExecutionId,
  selectedOrFullEditorText,
} from "@/features/query-editor";

describe("query editor execution target", () => {
  it("runs a non-empty selection exactly as written", () => {
    const selection = { start: 7, end: 22 };
    const model = {
      getValue: () => "SELECT * FROM users;",
      getValueInRange: (range: unknown) =>
        range === selection ? "FROM users" : "",
    };

    expect(selectedOrFullEditorText(model, selection, "fallback")).toBe(
      "FROM users",
    );
  });

  it("uses the full live model for an empty selection and store text as fallback", () => {
    const model = {
      getValue: () => "SELECT live_model",
      getValueInRange: () => "  \n",
    };

    expect(selectedOrFullEditorText(model, {}, "SELECT stored")).toBe(
      "SELECT live_model",
    );
    expect(selectedOrFullEditorText(null, null, "SELECT stored")).toBe(
      "SELECT stored",
    );
  });

  it("binds execution only to an active manual transaction", () => {
    const base = {
      supportsTransactions: true,
      transactionMode: "manual" as const,
      transactionState: "active" as const,
      connectionId: "connection-1",
      tabId: "query-7",
    };

    expect(queryTransactionExecutionId(base)).toBe("connection-1:query-7");
    expect(
      queryTransactionExecutionId({ ...base, transactionMode: "auto" }),
    ).toBeUndefined();
    expect(
      queryTransactionExecutionId({ ...base, transactionState: "idle" }),
    ).toBeUndefined();
    expect(
      queryTransactionExecutionId({ ...base, supportsTransactions: false }),
    ).toBeUndefined();
    expect(
      queryTransactionExecutionId({ ...base, connectionId: null }),
    ).toBeUndefined();
  });
});
