import { describe, expect, it } from "vitest";
import {
  configureExplorerVisibilityPatterns,
  explorerNodePassesVisibilityFilter,
  hideExplorerNodes,
  showOnlyExplorerNodes,
} from "./explorerVisibilityFilter";

describe("Explorer visibility filters", () => {
  it("hides selected nodes without affecting siblings", () => {
    const filter = hideExplorerNodes(undefined, ["users", "logs"]);
    expect(explorerNodePassesVisibilityFilter(filter, "users")).toBe(false);
    expect(explorerNodePassesVisibilityFilter(filter, "orders")).toBe(true);
  });

  it("shows only the frozen selection", () => {
    const filter = showOnlyExplorerNodes(["users", "orders", "users"]);
    expect(filter.onlyNodeIds).toEqual(["users", "orders"]);
    expect(explorerNodePassesVisibilityFilter(filter, "orders")).toBe(true);
    expect(explorerNodePassesVisibilityFilter(filter, "logs")).toBe(false);
  });

  it("removes a newly hidden item from an existing only list", () => {
    const filter = hideExplorerNodes(showOnlyExplorerNodes(["a", "b"]), ["a"]);
    expect(filter.onlyNodeIds).toEqual(["b"]);
    expect(explorerNodePassesVisibilityFilter(filter, "a")).toBe(false);
  });

  it("applies case-insensitive include and exclude wildcard patterns", () => {
    const filter = configureExplorerVisibilityPatterns(
      undefined,
      ["audit_*", "orders?"],
      ["*_archive"],
    );
    expect(explorerNodePassesVisibilityFilter(filter, "1", "AUDIT_LOG")).toBe(
      true,
    );
    expect(explorerNodePassesVisibilityFilter(filter, "2", "orders1")).toBe(
      true,
    );
    expect(
      explorerNodePassesVisibilityFilter(filter, "3", "audit_archive"),
    ).toBe(false);
    expect(explorerNodePassesVisibilityFilter(filter, "4", "users")).toBe(
      false,
    );
  });

  it("preserves wildcard rules when exact visibility changes", () => {
    const configured = configureExplorerVisibilityPatterns(
      undefined,
      ["prod_*"],
      ["*_old"],
    );
    const only = showOnlyExplorerNodes(["primary"], configured);
    const hidden = hideExplorerNodes(only, ["primary"]);
    expect(hidden.includePatterns).toEqual(["prod_*"]);
    expect(hidden.excludePatterns).toEqual(["*_old"]);
  });
});
