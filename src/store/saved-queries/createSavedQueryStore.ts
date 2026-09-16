import { create } from "zustand";
import type { SavedQueryState } from "./contracts";
import { createSavedQueryFileActions } from "./fileActions";
import { createSavedQueryFolderActions } from "./folderActions";
import { createSavedQueryImportActions } from "./importActions";
import { createSavedQueryLoadingActions } from "./loadingActions";

export function createSavedQueryStore() {
  return create<SavedQueryState>((set, get) => ({
    projectId: null,
    folders: [],
    files: [],
    savedQueries: [],
    isLoading: false,
    error: null,
    ...createSavedQueryLoadingActions(set, get),
    ...createSavedQueryFileActions(set, get),
    ...createSavedQueryFolderActions(set, get),
    ...createSavedQueryImportActions(set, get),
  }));
}
