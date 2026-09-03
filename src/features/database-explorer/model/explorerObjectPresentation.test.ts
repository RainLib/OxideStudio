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
    expect(classes[2]).toContain("violet");
  });

  it("matches the DBX semantic palette for specialized objects", () => {
    expect(explorerObjectIconClass("procedure")).toContain("sky");
    expect(explorerObjectIconClass("function")).toContain("amber");
    expect(explorerObjectIconClass("sequence")).toContain("emerald");
    expect(explorerObjectIconClass("trigger")).toContain("orange");
    expect(explorerObjectIconClass("key")).toContain("red");
    expect(explorerObjectIconClass("package")).toContain("cyan");
  });
});
