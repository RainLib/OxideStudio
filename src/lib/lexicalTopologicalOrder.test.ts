import { describe, expect, it } from "vitest";
import { lexicalTopologicalOrder } from "./lexicalTopologicalOrder";

describe("lexicalTopologicalOrder", () => {
  it("keeps roots and newly available children in lexical order", () => {
    const result = lexicalTopologicalOrder(
      ["delta", "charlie", "bravo", "alpha"],
      [
        ["alpha", "delta"],
        ["bravo", "charlie"],
      ],
    );
    expect(result.order).toEqual(["alpha", "bravo", "charlie", "delta"]);
    expect(result.ranks.get("delta")).toBe(1);
    expect(result.ranks.get("charlie")).toBe(1);
  });

  it("deduplicates edges and appends cycles deterministically", () => {
    const result = lexicalTopologicalOrder(
      ["zeta", "beta", "alpha"],
      [
        ["alpha", "beta"],
        ["alpha", "beta"],
        ["beta", "alpha"],
      ],
    );
    expect(result.order).toEqual(["zeta", "alpha", "beta"]);
  });

  it("handles a ten-thousand-node chain without recursion", () => {
    const names = Array.from(
      { length: 10_000 },
      (_, index) => `relation_${String(index).padStart(5, "0")}`,
    );
    const edges = names.slice(1).map(
      (name, index) => [names[index]!, name] as const,
    );
    const result = lexicalTopologicalOrder(names, edges);
    expect(result.order).toHaveLength(10_000);
    expect(result.order[0]).toBe("relation_00000");
    expect(result.order[result.order.length - 1]).toBe("relation_09999");
    expect(result.ranks.get("relation_09999")).toBe(9_999);
  });
});
