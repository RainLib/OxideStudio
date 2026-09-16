import { v4 as uuidv4 } from "uuid";
import { nextSavedSqlName } from "@/lib/savedSqlLibrary";
import {
  savedSqlService,
  type SavedSqlFile,
  type SavedSqlFolder,
} from "@/services/tauri/saved-sql.service";
import type {
  SavedQueryGet,
  SavedQuerySet,
  SavedQueryState,
} from "./contracts";
import { requireSavedQueryProject, savedQueryFiles } from "./state";

type ImportActions = Pick<SavedQueryState, "importEntries">;

export function createSavedQueryImportActions(
  set: SavedQuerySet,
  get: SavedQueryGet,
): ImportActions {
  return {
    importEntries: async (entries, connectionId = null) => {
      const state = get();
      const projectId = requireSavedQueryProject(state);
      if (entries.length === 0) return { folderCount: 0, fileCount: 0 };
      const now = Date.now();
      const addedFolders: SavedSqlFolder[] = [];
      const addedFiles: SavedSqlFile[] = [];
      const folderByLocation = new Map<string, SavedSqlFolder>();
      const nextFolderOrder = new Map<string, number>();
      const fileNamesByLocation = new Map<string, Set<string>>();
      const nextFileOrder = new Map<string, number>();
      const scopeKey = (parentId: string | null) =>
        `${connectionId || ""}\u0000${parentId || ""}`;
      const folderKey = (parentId: string | null, name: string) =>
        `${scopeKey(parentId)}\u0000${name.toLocaleLowerCase()}`;
      for (const folder of state.folders) {
        if ((folder.connectionId || null) !== (connectionId || null)) continue;
        const location = scopeKey(folder.parentFolderId || null);
        folderByLocation.set(
          folderKey(folder.parentFolderId || null, folder.name),
          folder,
        );
        nextFolderOrder.set(
          location,
          Math.max(nextFolderOrder.get(location) || 0, folder.orderIndex + 1),
        );
      }
      for (const file of state.files) {
        if ((file.connectionId || null) !== (connectionId || null)) continue;
        const location = scopeKey(file.folderId || null);
        const names = fileNamesByLocation.get(location) || new Set<string>();
        names.add(file.name);
        fileNamesByLocation.set(location, names);
        nextFileOrder.set(
          location,
          Math.max(nextFileOrder.get(location) || 0, file.orderIndex + 1),
        );
      }

      for (const entry of entries) {
        const segments = entry.relativePath.split("/").filter(Boolean);
        const fileName = segments.pop() || "untitled.sql";
        let parentFolderId: string | null = null;
        for (const segment of segments) {
          const location = scopeKey(parentFolderId);
          const key = folderKey(parentFolderId, segment);
          let folder = folderByLocation.get(key);
          if (!folder) {
            folder = {
              id: uuidv4(),
              projectId,
              connectionId,
              parentFolderId,
              name: segment,
              orderIndex: nextFolderOrder.get(location) || 0,
              createdAt: now,
              updatedAt: now,
            };
            addedFolders.push(folder);
            folderByLocation.set(key, folder);
            nextFolderOrder.set(location, folder.orderIndex + 1);
          }
          parentFolderId = folder.id;
        }

        const location = scopeKey(parentFolderId);
        const names = fileNamesByLocation.get(location) || new Set<string>();
        const file: SavedSqlFile = {
          id: uuidv4(),
          projectId,
          connectionId,
          folderId: parentFolderId,
          name: nextSavedSqlName(fileName, names),
          databaseName: null,
          schemaName: null,
          sql: entry.sql,
          sqlLoaded: true,
          orderIndex: nextFileOrder.get(location) || 0,
          openCount: 0,
          openedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        addedFiles.push(file);
        names.add(file.name);
        fileNamesByLocation.set(location, names);
        nextFileOrder.set(location, file.orderIndex + 1);
      }

      await savedSqlService.saveBatch(addedFolders, addedFiles);
      if (get().projectId === projectId) {
        set({
          folders: [...get().folders, ...addedFolders],
          ...savedQueryFiles([...get().files, ...addedFiles]),
        });
      }
      return { folderCount: addedFolders.length, fileCount: addedFiles.length };
    },
  };
}
