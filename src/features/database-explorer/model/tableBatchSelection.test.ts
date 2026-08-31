import { describe, expect, it } from "vitest";
import {
  composeTableBatchDdl,
  formatTableBatchNamesForClipboard,
  pruneTableBatchSelection,
  settleTableBatchWork,
  summarizeTableBatchFailures,
  toggleAllVisibleTableBatchSelection,
  toggleTableBatchSelection,
} from "./tableBatchSelection";

describe("Explorer table batch selection", () => {
  const visible = ["accounts", "orders", "payments", "users"];

  it("formats selected names and only successful non-empty DDL results", () => {
    expect(formatTableBatchNamesForClipboard(["accounts", "orders"])).toBe(
      "accounts, orders",
    );
    expect(
      composeTableBatchDdl("public", ["accounts", "orders", "payments"], [
        { status: "fulfilled", value: "CREATE TABLE accounts ();\n" },
        { status: "rejected", reason: new Error("offline") },
        { status: "fulfilled", value: "  " },
      ]),
    ).toBe("-- public.accounts\nCREATE TABLE accounts ();");
  });

  it("toggles one table while preserving metadata order", () => {
    let selection = { names: [] as string[], anchor: null as string | null };
    selection = toggleTableBatchSelection(selection, "users", visible);
    selection = toggleTableBatchSelection(selection, "accounts", visible);
    expect(selection.names).toEqual(["accounts", "users"]);
    selection = toggleTableBatchSelection(selection, "accounts", visible);
    expect(selection.names).toEqual(["users"]);
  });

  it("adds an inclusive Shift range from the latest anchor", () => {
    const anchored = toggleTableBatchSelection(
      { names: [], anchor: null },
      "orders",
      visible,
    );
    const ranged = toggleTableBatchSelection(anchored, "users", visible, {
      range: true,
    });
    expect(ranged.names).toEqual(["orders", "payments", "users"]);
  });

  it("selects and deselects only visible names", () => {
    const hidden = { names: ["archived"], anchor: "archived" };
    const selected = toggleAllVisibleTableBatchSelection(hidden, visible);
    expect(selected.names).toEqual([...visible, "archived"]);
    const deselected = toggleAllVisibleTableBatchSelection(selected, visible);
    expect(deselected.names).toEqual(["archived"]);
  });

  it("enforces the operation ceiling before creating work", () => {
    const selected = toggleAllVisibleTableBatchSelection(
      { names: [], anchor: null },
      visible,
      2,
    );
    expect(selected.names).toEqual(["accounts", "orders"]);
  });

  it("prunes objects removed by a metadata refresh", () => {
    expect(
      pruneTableBatchSelection(
        { names: ["orders", "users"], anchor: "users" },
        ["orders"],
      ),
    ).toEqual({ names: ["orders"], anchor: null });
  });

  it("bounds parallel batch work and preserves result order", async () => {
    let running = 0;
    let peak = 0;
    const results = await settleTableBatchWork(
      visible,
      async (name) => {
        running += 1;
        peak = Math.max(peak, running);
        await Promise.resolve();
        running -= 1;
        if (name === "payments") throw new Error("metadata unavailable");
        return name.toUpperCase();
      },
      2,
    );

    expect(peak).toBe(2);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
      "fulfilled",
    ]);
    expect(results[3]).toEqual({ status: "fulfilled", value: "USERS" });
  });

  it("keeps bounded ordered failure details without control characters", () => {
    const results: PromiseSettledResult<string>[] = [
      { status: "fulfilled", value: "ok" },
      {
        status: "rejected",
        reason: new Error(`permission\n denied ${"x".repeat(300)}`),
      },
      { status: "rejected", reason: "\u0000catalog unavailable" },
    ];

    const summary = summarizeTableBatchFailures(visible, results, 1);

    expect(summary.total).toBe(2);
    expect(summary.omitted).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]?.name).toBe("orders");
    expect(summary.failures[0]?.message).toMatch(/^permission denied/);
    expect(summary.failures[0]?.message.length).toBeLessThanOrEqual(240);
  });
});
