import { createCommitEditsAction } from "./row-mutations/commitEdits";
import { createDeleteRowsAction } from "./row-mutations/deleteRows";
import type { TabSlice } from "./types";

/** Composes independent insert/update and delete mutation lifecycles. */
export const createRowMutationsSlice: TabSlice<"commitEdits" | "deleteRows"> = (
  set,
  get,
) => ({
  ...createCommitEditsAction(set, get),
  ...createDeleteRowsAction(set, get),
});
