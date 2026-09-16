import { v4 as uuidv4 } from "uuid";
import { savedSqlDescendantFolderIds } from "@/lib/savedSqlLibrary";
import {
  savedSqlService,
  type SavedSqlFolder,
} from "@/services/tauri/saved-sql.service";
import type {
  SavedQueryGet,
  SavedQuerySet,
  SavedQueryState,
} from "./contracts";
import {
  nextSavedQueryOrder,
  requireSavedQueryProject,
  savedQueryFiles,
} from "./state";

type FolderActions = Pick<
  SavedQueryState,
  "createFolder" | "renameFolder" | "moveFolder" | "deleteFolder"
>;

export function createSavedQueryFolderActions(
  set: SavedQuerySet,
  get: SavedQueryGet,
): FolderActions {
  return {
    createFolder: async (name, options = {}) => {
      const state = get();
      const projectId = requireSavedQueryProject(state);
      const parent = options.parentFolderId
        ? state.folders.find((folder) => folder.id === options.parentFolderId)
        : undefined;
      if (options.parentFolderId && !parent) {
        throw new Error("Parent folder not found");
      }
      const connectionId = parent?.connectionId ?? options.connectionId ?? null;
      const now = Date.now();
      const folder: SavedSqlFolder = {
        id: uuidv4(),
        projectId,
        connectionId,
        parentFolderId: parent?.id ?? null,
        name: name.trim() || "New folder",
        orderIndex: nextSavedQueryOrder(
          state.folders.filter(
            (item) =>
              (item.parentFolderId || null) === (parent?.id || null) &&
              (item.connectionId || null) === (connectionId || null),
          ),
        ),
        createdAt: now,
        updatedAt: now,
      };
      await savedSqlService.saveFolder(folder);
      if (get().projectId === projectId) {
        set({ folders: [...get().folders, folder] });
      }
      return folder;
    },

    renameFolder: async (id, name) => {
      const state = get();
      const folder = state.folders.find((item) => item.id === id);
      if (!folder) return;
      const updated = {
        ...folder,
        name: name.trim() || folder.name,
        updatedAt: Date.now(),
      };
      await savedSqlService.saveFolder(updated);
      if (get().projectId === folder.projectId) {
        set({
          folders: get().folders.map((item) => (item.id === id ? updated : item)),
        });
      }
    },

    moveFolder: async (id, parentFolderId = null) => {
      const state = get();
      const folder = state.folders.find((item) => item.id === id);
      if (!folder) return;
      const parent = parentFolderId
        ? state.folders.find((item) => item.id === parentFolderId)
        : undefined;
      if (parentFolderId && !parent) throw new Error("Target folder not found");
      if (parent && savedSqlDescendantFolderIds(state.folders, id).has(parent.id)) {
        throw new Error("A folder cannot be moved into itself or one of its children");
      }
      if (parent && (parent.connectionId || null) !== (folder.connectionId || null)) {
        throw new Error("Folders cannot move across connection scopes");
      }
      const updated = {
        ...folder,
        parentFolderId: parent?.id || null,
        orderIndex: nextSavedQueryOrder(
          state.folders.filter(
            (item) =>
              (item.parentFolderId || null) === (parent?.id || null) &&
              (item.connectionId || null) === (folder.connectionId || null),
          ),
        ),
        updatedAt: Date.now(),
      };
      await savedSqlService.saveFolder(updated);
      if (get().projectId === folder.projectId) {
        set({
          folders: get().folders.map((item) => (item.id === id ? updated : item)),
        });
      }
    },

    deleteFolder: async (id) => {
      const state = get();
      const projectId = requireSavedQueryProject(state);
      const removed = savedSqlDescendantFolderIds(state.folders, id);
      await savedSqlService.deleteFolder(projectId, id);
      if (get().projectId !== projectId) return;
      set({
        folders: get().folders.filter((folder) => !removed.has(folder.id)),
        ...savedQueryFiles(
          get().files.filter(
            (file) => !file.folderId || !removed.has(file.folderId),
          ),
        ),
      });
    },
  };
}
