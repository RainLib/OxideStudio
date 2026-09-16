import type { SavedSqlFile } from "@/services/tauri/saved-sql.service";
import type { SavedQueryState } from "./contracts";

export function savedQueryFiles(files: SavedSqlFile[]) {
  return { files, savedQueries: files };
}

export function requireSavedQueryProject(state: SavedQueryState) {
  if (!state.projectId) throw new Error("SQL Library has not been initialized");
  return state.projectId;
}

export function nextSavedQueryOrder(items: Array<{ orderIndex: number }>) {
  return items.reduce((maximum, item) => Math.max(maximum, item.orderIndex), -1) + 1;
}
