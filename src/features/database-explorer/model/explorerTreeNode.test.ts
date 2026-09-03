import { describe, expect, it } from "vitest";
import {
  explorerNodeId,
  flattenVisibleExplorerNodes,
  type ExplorerTreeNode,
} from "./explorerTreeNode";

describe("explorer tree node identity", () => {
  it("keeps separators and empty identity parts collision free", () => {
    expect(explorerNodeId("schema", "a:b", "c")).not.toBe(
      explorerNodeId("schema", "a", "b:c"),
    );
    expect(explorerNodeId("schema", "a", "")).not.toBe(
      explorerNodeId("schema", "a"),
    );
  });

  it("flattens only descendants of expanded nodes", () => {
    const table: ExplorerTreeNode = {
      id: "table:orders",
      kind: "table",
      label: "orders",
    };
    const schema: ExplorerTreeNode = {
      id: "schema:public",
      kind: "schema",
      label: "public",
      children: [table],
    };
    const connection: ExplorerTreeNode = {
      id: "connection:local",
      kind: "connection",
      label: "Local",
      children: [schema],
    };

    expect(
      flattenVisibleExplorerNodes([connection], new Set([connection.id])).map(
        (node) => node.id,
      ),
    ).toEqual([connection.id, schema.id]);
    expect(
      flattenVisibleExplorerNodes(
        [connection],
        new Set([connection.id, schema.id]),
      ).map((node) => node.id),
    ).toEqual([connection.id, schema.id, table.id]);
  });
});
