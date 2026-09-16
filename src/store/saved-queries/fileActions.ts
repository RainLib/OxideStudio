import { v4 as uuidv4 } from "uuid";
import { ensureSqlExtension, nextSavedSqlName } from "@/lib/savedSqlLibrary";
import {
  savedSqlService,
  type SavedSqlFile,
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

type FileActions = Pick<
  SavedQueryState,
  | "ensureFileContent"
  | "ensureAllFileContents"
  | "openFile"
  | "saveQuery"
  | "deleteQuery"
  | "updateQuery"
  | "moveQuery"
>;

export function createSavedQueryFileActions(
  set: SavedQuerySet,
  get: SavedQueryGet,
): FileActions {
  return {
    ensureFileContent: async (id) => {
      const state = get();
      const existing = state.files.find((file) => file.id === id);
      if (!existing) return undefined;
      if (existing.sqlLoaded) return existing;
      const projectId = requireSavedQueryProject(state);
      const loaded = await savedSqlService.loadFile(projectId, id);
      if (!loaded || get().projectId !== projectId) return undefined;
      set(savedQueryFiles(get().files.map((file) => (file.id === id ? loaded : file))));
      return loaded;
    },

    ensureAllFileContents: async () => {
      const state = get();
      const projectId = requireSavedQueryProject(state);
      if (state.files.every((file) => file.sqlLoaded)) return state.files;
      const loaded = await savedSqlService.loadFiles(projectId);
      if (get().projectId !== projectId) return [];
      set(savedQueryFiles(loaded));
      return loaded;
    },

    openFile: async (id) => {
      const file = await get().ensureFileContent(id);
      if (!file) return undefined;
      const openedAt = Date.now();
      void savedSqlService
        .recordOpened(file.projectId, file.id, openedAt)
        .catch(() => undefined);
      set(
        savedQueryFiles(
          get().files.map((candidate) =>
            candidate.id === id
              ? { ...candidate, openCount: candidate.openCount + 1, openedAt }
              : candidate,
          ),
        ),
      );
      return { ...file, openCount: file.openCount + 1, openedAt };
    },

    saveQuery: async (name, sql, target = {}) => {
      const state = get();
      const projectId = requireSavedQueryProject(state);
      const now = Date.now();
      const siblings = state.files.filter(
        (file) =>
          (file.folderId || null) === (target.folderId || null) &&
          (file.connectionId || null) === (target.connectionId || null),
      );
      const file: SavedSqlFile = {
        id: uuidv4(),
        projectId,
        connectionId: target.connectionId || null,
        folderId: target.folderId || null,
        name: nextSavedSqlName(name, siblings.map((item) => item.name)),
        databaseName: target.databaseName || null,
        schemaName: target.schemaName || null,
        sql,
        sqlLoaded: true,
        orderIndex: nextSavedQueryOrder(siblings),
        openCount: 0,
        openedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await savedSqlService.saveFile(file);
      if (get().projectId === projectId) {
        set(savedQueryFiles([...get().files, file]));
      }
      return file;
    },

    deleteQuery: async (id) => {
      const state = get();
      const projectId = requireSavedQueryProject(state);
      await savedSqlService.deleteFile(projectId, id);
      if (get().projectId === projectId) {
        set(savedQueryFiles(get().files.filter((file) => file.id !== id)));
      }
    },

    updateQuery: async (id, name, sql, target = {}) => {
      const state = get();
      const existing = await get().ensureFileContent(id);
      if (!existing) return false;
      const updated: SavedSqlFile = {
        ...existing,
        ...target,
        name: ensureSqlExtension(name),
        sql,
        sqlLoaded: true,
        updatedAt: Date.now(),
      };
      await savedSqlService.saveFile(updated);
      if (get().projectId === state.projectId) {
        set(
          savedQueryFiles(
            get().files.map((file) => (file.id === id ? updated : file)),
          ),
        );
      }
      return true;
    },

    moveQuery: async (id, folderId = null) => {
      const state = get();
      const existing = await get().ensureFileContent(id);
      if (!existing) return;
      const folder = folderId
        ? state.folders.find((candidate) => candidate.id === folderId)
        : undefined;
      if (folderId && !folder) throw new Error("Target folder not found");
      if (folder && (folder.connectionId || null) !== (existing.connectionId || null)) {
        throw new Error("Queries cannot move across connection scopes");
      }
      const updated = {
        ...existing,
        folderId: folder?.id || null,
        orderIndex: nextSavedQueryOrder(
          state.files.filter(
            (file) =>
              (file.folderId || null) === (folder?.id || null) &&
              (file.connectionId || null) === (existing.connectionId || null),
          ),
        ),
        updatedAt: Date.now(),
      };
      await savedSqlService.saveFile(updated);
      if (get().projectId === state.projectId) {
        set(
          savedQueryFiles(
            get().files.map((file) => (file.id === id ? updated : file)),
          ),
        );
      }
    },
  };
}
