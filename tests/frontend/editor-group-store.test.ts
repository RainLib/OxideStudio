import { beforeEach, describe, expect, it } from "vitest";
import {
  adjacentEditorGroup,
  editorGroupInDirection,
  editorGroups,
  useEditorGroupStore,
} from "@/store/useEditorGroupStore";

describe("editor group store", () => {
  beforeEach(() => useEditorGroupStore.getState().reset());

  it.each(["left", "right", "up", "down"] as const)(
    "creates a %s split and activates the new group",
    (direction) => {
      useEditorGroupStore.getState().split(direction, "tab-1");
      const state = useEditorGroupStore.getState();
      expect(state).toMatchObject({
        splitDirection: direction,
      });
      expect(editorGroups(state.root).map((group) => group.tabId)).toEqual([
        "tab-1",
        "tab-1",
      ]);
    }
  );

  it("keeps the remaining tab when an editor group is closed", () => {
    const store = useEditorGroupStore.getState();
    store.split("right", "tab-1");
    const splitState = useEditorGroupStore.getState();
    const groups = editorGroups(splitState.root);
    useEditorGroupStore.getState().setGroupTab(groups[1]!.id, "tab-2");
    useEditorGroupStore.getState().closeGroup(groups[0]!.id);

    const state = useEditorGroupStore.getState();
    expect(state).toMatchObject({
      splitDirection: null,
    });
    expect(editorGroups(state.root)).toHaveLength(1);
    expect(editorGroups(state.root)[0]?.tabId).toBe("tab-2");
  });

  it("supports repeatedly splitting the active editor group", () => {
    const store = useEditorGroupStore.getState();
    store.split("right", "tab-1");
    for (let index = 0; index < 3; index += 1) {
      useEditorGroupStore
        .getState()
        .split(index % 2 === 0 ? "down" : "left", `tab-${index + 2}`);
    }

    const state = useEditorGroupStore.getState();
    expect(editorGroups(state.root)).toHaveLength(5);
    expect(editorGroups(state.root).some((group) => group.id === state.activeGroup)).toBe(true);
  });

  it("finds spatial and cyclic Vim window targets", () => {
    useEditorGroupStore.getState().split("right", "tab-right");
    let state = useEditorGroupStore.getState();
    const [left, right] = editorGroups(state.root);
    expect(editorGroupInDirection(state.root, right!.id, "left")?.id).toBe(
      left!.id,
    );
    expect(editorGroupInDirection(state.root, left!.id, "right")?.id).toBe(
      right!.id,
    );

    useEditorGroupStore.getState().split("down", "tab-bottom");
    state = useEditorGroupStore.getState();
    const bottom = editorGroups(state.root).find(
      (group) => group.id === state.activeGroup,
    )!;
    expect(editorGroupInDirection(state.root, bottom.id, "up")?.id).toBe(
      right!.id,
    );
    expect(adjacentEditorGroup(state.root, bottom.id)?.id).toBe(left!.id);
    expect(adjacentEditorGroup(state.root, left!.id, true)?.id).toBe(bottom.id);
  });
});
