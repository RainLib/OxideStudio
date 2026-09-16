import { create } from "zustand";
import type { EditorGroupState } from "./contracts";
import { createEditorGroupActions } from "./actions";
import { createInitialEditorGroupLayout } from "./layoutTree";

export function createEditorGroupStore() {
  return create<EditorGroupState>((set) => ({
    ...createInitialEditorGroupLayout(),
    ...createEditorGroupActions(set),
  }));
}
