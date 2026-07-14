import { describe, expect, it } from "vitest";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";

describe("database dialect capabilities", () => {
  it("enables Explain Plan only for supported relational drivers", () => {
    expect(defaultDatabaseCapabilities("postgres").supportsExplainPlan).toBe(
      true,
    );
    expect(defaultDatabaseCapabilities("mysql").supportsExplainPlan).toBe(true);
    expect(defaultDatabaseCapabilities("redis").supportsExplainPlan).toBe(
      false,
    );
    expect(defaultDatabaseCapabilities("mongodb").supportsExplainPlan).toBe(
      false,
    );
    expect(
      defaultDatabaseCapabilities("elasticsearch").supportsExplainPlan,
    ).toBe(false);
  });
});
