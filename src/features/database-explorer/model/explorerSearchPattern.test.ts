import { describe, expect, it } from "vitest";
import { compileExplorerSearchPattern } from "./explorerSearchPattern";

describe("database explorer search patterns", () => {
  it("matches ordinary text case-insensitively across candidate fields", () => {
    const pattern = compileExplorerSearchPattern("Order", false);
    expect(pattern.matches("public", "order_items")).toBe(true);
    expect(pattern.matches("users")).toBe(false);
  });

  it("compiles a case-insensitive regex once for local projection", () => {
    const pattern = compileExplorerSearchPattern("^(users|orders)$", true);
    expect(pattern.matches("Users")).toBe(true);
    expect(pattern.matches("order_items")).toBe(false);
  });

  it("reports invalid regex input without throwing during tree rendering", () => {
    const pattern = compileExplorerSearchPattern("[", true);
    expect(pattern.invalid).toBe(true);
    expect(pattern.error).toBeTruthy();
    expect(pattern.matches("anything")).toBe(false);
  });
});
