import { beforeEach, describe, expect, it } from "vitest";
import {
  resetDatabaseExplorerStoreForTests,
  useDatabaseExplorerStore,
} from "./useDatabaseExplorerStore";

describe("database explorer shared state", () => {
  beforeEach(resetDatabaseExplorerStoreForTests);

  it("keeps expansion independent between projects and permits siblings", () => {
    const { updateExpanded } = useDatabaseExplorerStore.getState();
    updateExpanded("project-a", "connections", ["one"]);
    updateExpanded("project-a", "connections", (current) => [
      ...current,
      "two",
    ]);
    updateExpanded("project-b", "connections", ["three"]);

    const { scopes } = useDatabaseExplorerStore.getState();
    expect(scopes["project-a"]!.expanded.connections).toEqual(["one", "two"]);
    expect(scopes["project-b"]!.expanded.connections).toEqual(["three"]);
  });

  it("deduplicates expansion and snapshots selection", () => {
    const store = useDatabaseExplorerStore.getState();
    store.updateExpanded("project", "schemas", ["public", "public"]);
    const selected = ["schema:public"];
    store.setSelection("project", selected);
    selected.push("table:orders");

    const scope = useDatabaseExplorerStore.getState().scopes.project!;
    expect(scope.expanded.schemas).toEqual(["public"]);
    expect(scope.selectedNodeIds).toEqual(["schema:public"]);
    expect(scope.focusedNodeId).toBe("schema:public");
  });

  it("persists connection sorting independently per project", () => {
    const store = useDatabaseExplorerStore.getState();
    store.setConnectionSortMode("project-a", "manual");
    store.setConnectionOrder("project-a", ["two", "one", "two"]);
    store.setConnectionSortMode("project-b", "desc");
    expect(
      useDatabaseExplorerStore.getState().scopes["project-a"]
        ?.connectionSortMode,
    ).toBe("manual");
    expect(
      useDatabaseExplorerStore.getState().scopes["project-a"]?.connectionOrder,
    ).toEqual(["two", "one"]);
    expect(
      useDatabaseExplorerStore.getState().scopes["project-b"]
        ?.connectionSortMode,
    ).toBe("desc");
  });

  it("persists local or global object search per project", () => {
    useDatabaseExplorerStore.getState().setSearchMode("project-a", "local");
    expect(
      useDatabaseExplorerStore.getState().scopes["project-a"]?.searchMode,
    ).toBe("local");
    expect(
      useDatabaseExplorerStore.getState().scopes["project-b"]?.searchMode,
    ).toBeUndefined();
  });

  it("persists regex search independently per project", () => {
    useDatabaseExplorerStore.getState().setRegexSearch("project-a", true);
    expect(
      useDatabaseExplorerStore.getState().scopes["project-a"]?.regexSearch,
    ).toBe(true);
    expect(
      useDatabaseExplorerStore.getState().scopes["project-b"]?.regexSearch,
    ).toBeUndefined();
  });

  it("persists parent-scoped visibility filters without mutating other scopes", () => {
    const store = useDatabaseExplorerStore.getState();
    store.hideNodes("project-a", "connections", ["one"]);
    store.showOnlyNodes("project-a", "schema:public", ["users", "orders"]);
    store.setVisibilityPatterns(
      "project-a",
      "schema:public",
      ["*_active"],
      ["tmp_*"],
    );
    expect(
      useDatabaseExplorerStore.getState().scopes["project-a"]
        ?.visibilityFilters,
    ).toMatchObject({
      connections: { hiddenNodeIds: ["one"], onlyNodeIds: [] },
      "schema:public": {
        hiddenNodeIds: [],
        onlyNodeIds: ["users", "orders"],
        includePatterns: ["*_active"],
        excludePatterns: ["tmp_*"],
      },
    });
    store.clearVisibilityFilter("project-a", "connections");
    expect(
      useDatabaseExplorerStore.getState().scopes["project-a"]?.visibilityFilters
        .connections,
    ).toBeUndefined();
    expect(
      useDatabaseExplorerStore.getState().scopes["project-b"],
    ).toBeUndefined();
  });

  it("groups connections and releases assignments when a group is removed", () => {
    const store = useDatabaseExplorerStore.getState();
    const groupId = store.createConnectionGroup("project", "Production");
    store.moveConnectionsToGroup("project", ["one", "two"], groupId);
    store.renameConnectionGroup("project", groupId, "Critical");

    let scope = useDatabaseExplorerStore.getState().scopes.project!;
    expect(scope.connectionGroups[0]?.name).toBe("Critical");
    expect(scope.connectionGroupIds).toEqual({ one: groupId, two: groupId });

    useDatabaseExplorerStore
      .getState()
      .deleteConnectionGroup("project", groupId);
    scope = useDatabaseExplorerStore.getState().scopes.project!;
    expect(scope.connectionGroups).toEqual([]);
    expect(scope.connectionGroupIds).toEqual({});
  });

  it("moves nested groups while rejecting hierarchy cycles", () => {
    const store = useDatabaseExplorerStore.getState();
    const parent = store.createConnectionGroup("project", "Parent");
    const child = store.createConnectionGroup("project", "Child", parent);
    const sibling = store.createConnectionGroup("project", "Sibling");

    store.moveConnectionGroup("project", sibling, child);
    expect(
      useDatabaseExplorerStore
        .getState()
        .scopes.project?.connectionGroups.find((group) => group.id === sibling)
        ?.parentId,
    ).toBe(child);

    useDatabaseExplorerStore
      .getState()
      .moveConnectionGroup("project", parent, sibling);
    expect(
      useDatabaseExplorerStore
        .getState()
        .scopes.project?.connectionGroups.find((group) => group.id === parent)
        ?.parentId,
    ).toBeNull();
  });

  it("reorders sibling groups and supports an explicit inside drop", () => {
    const store = useDatabaseExplorerStore.getState();
    const first = store.createConnectionGroup("project", "First");
    const second = store.createConnectionGroup("project", "Second");
    const child = store.createConnectionGroup("project", "Child", first);

    store.placeConnectionGroup("project", second, first, "before");
    let groups =
      useDatabaseExplorerStore.getState().scopes.project!.connectionGroups;
    expect(groups.map((group) => group.id)).toEqual([second, first, child]);

    useDatabaseExplorerStore
      .getState()
      .placeConnectionGroup("project", second, first, "inside");
    groups =
      useDatabaseExplorerStore.getState().scopes.project!.connectionGroups;
    expect(groups.find((group) => group.id === second)?.parentId).toBe(first);
    expect(groups.map((group) => group.id)).toEqual([first, child, second]);
  });
});
