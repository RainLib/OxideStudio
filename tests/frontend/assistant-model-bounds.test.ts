import { describe, expect, it } from "vitest";
import { boundedModelToolResults } from "@/ai/assistant/modelPlanner";

describe("assistant model result bounds", () => {
  it("bounds tool result count, each payload, and aggregate prompt size", () => {
    const results = Array.from({ length: 30 }, (_, index) => ({
      id: `step-${index}`,
      toolName: "database.query",
      status: "success" as const,
      output: { rows: ["x".repeat(20_000)] },
    }));

    const bounded = boundedModelToolResults(results);
    expect(bounded).toHaveLength(24);
    expect(String(bounded[0]?.output)).toContain("[truncated]");
    expect(
      bounded.reduce((total, result) => total + String(result.output || "").length, 0)
    ).toBeLessThanOrEqual(32_100);
  });

  it("handles non-serializable tool output without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      boundedModelToolResults([
        {
          id: "step-1",
          toolName: "test.tool",
          status: "success",
          output: circular,
        },
      ])
    ).not.toThrow();
  });
});
