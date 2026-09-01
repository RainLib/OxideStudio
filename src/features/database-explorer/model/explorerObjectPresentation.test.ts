import { describe, expect, it } from "vitest";
import { explorerObjectIconClass } from "./explorerObjectPresentation";

describe("database Explorer object presentation", () => {
  it("keeps namespace, table, and view roles visually distinct", () => {
    const classes = [
      explorerObjectIconClass("schema"),
      explorerObjectIconClass("table"),
      explorerObjectIconClass("view"),
    ];

    expect(new Set(classes).size).toBe(classes.length);
    expect(classes[0]).toContain("amber");
    expect(classes[1]).toContain("emerald");
    expect(classes[2]).toContain("sky");
  });
});
