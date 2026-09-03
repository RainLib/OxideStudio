import { describe, expect, it } from "vitest";
import { explorerActionsForNode } from "./explorerActionRegistry";
import type { ExplorerTreeNode } from "./explorerTreeNode";

const node = (kind: ExplorerTreeNode["kind"]): ExplorerTreeNode => ({
  id: `${kind}:test`,
  kind,
  label: "test",
});

describe("explorer action registry", () => {
  it("keeps connection ordering stable and exposes no disabled placeholders", () => {
    const actions = explorerActionsForNode(node("connection"), {
      connected: true,
      supportsQuery: true,
      supportsBrowsing: true,
      supportsAdministration: true,
    });
    expect(actions.filter((item) => !item.separator).map((item) => item.action)).toEqual([
      "connection.disconnect",
      "copy.name",
      "query.new",
      "browser.open",
      "administration.open",
      "group.move",
      "refresh.children",
      "connection.properties",
      "connection.duplicate",
      "connection.delete",
    ]);
    expect(actions.some((item) => item.disabled)).toBe(false);
  });

  it("omits mutation actions for read-only relations", () => {
    const actions = explorerActionsForNode(node("table"), {
      supportsQuery: true,
      supportsBrowsing: true,
      supportsDdl: true,
      supportsTransfer: true,
      supportsCompare: true,
      readOnly: true,
    });
    expect(actions.map((item) => item.action)).not.toContain(
      "object.more-destructive",
    );
    expect(actions.map((item) => item.action)).toContain("compare.open");
  });

  it("uses the same group operations as the rendered explorer", () => {
    expect(
      explorerActionsForNode(node("folder"), {})
        .filter((item) => !item.separator)
        .map((item) => item.action),
    ).toEqual([
      "group.new-connection",
      "group.new-subgroup",
      "group.rename",
      "group.delete",
    ]);
  });
});
