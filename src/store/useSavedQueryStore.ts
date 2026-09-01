import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import {
  savedSqlService,
  type SavedSqlDirectoryEntry,
  type SavedSqlFile,
  type SavedSqlFolder,
} from "@/services/tauri/saved-sql.service";
import {
  ensureSqlExtension,
  nextSavedSqlName,
  savedSqlDescendantFolderIds,
} from "@/lib/savedSqlLibrary";

export type SavedQuery = SavedSqlFile;

export interface SavedQueryTarget {
  connectionId?: string | null;
  folderId?: string | null;
  databaseName?: string | null;
  schemaName?: string | null;
}

interface SavedQueryState {
  projectId: string | null;
  folders: SavedSqlFolder[];
  files: SavedSqlFile[];
  /** Compatibility alias used by the editor toolbar. */
  savedQueries: SavedSqlFile[];
  isLoading: boolean;
  error: string | null;
  loadProject: (projectId: string) => Promise<void>;
  ensureFileContent: (id: string) => Promise<SavedSqlFile | undefined>;
  ensureAllFileContents: () => Promise<SavedSqlFile[]>;
  openFile: (id: string) => Promise<SavedSqlFile | undefined>;
  createFolder: (
    name: string,
    options?: { connectionId?: string | null; parentFolderId?: string | null },
  ) => Promise<SavedSqlFolder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  moveFolder: (id: string, parentFolderId?: string | null) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  saveQuery: (
    name: string,
    sql: string,
    target?: SavedQueryTarget,
  ) => Promise<SavedSqlFile>;
  deleteQuery: (id: string) => Promise<void>;
  updateQuery: (
    id: string,
    name: string,
    sql: string,
    target?: SavedQueryTarget,
  ) => Promise<boolean>;
  moveQuery: (id: string, folderId?: string | null) => Promise<void>;
  importEntries: (
    entries: SavedSqlDirectoryEntry[],
    connectionId?: string | null,
  ) => Promise<{ folderCount: number; fileCount: number }>;
}

const LEGACY_STORAGE_KEY = "saved-queries";
let loadEpoch = 0;

function stateFiles(files: SavedSqlFile[]) {
  return { files, savedQueries: files };
}

function currentProjectId(state: SavedQueryState) {
  if (!state.projectId) throw new Error("SQL Library has not been initialized");
  return state.projectId;
}

function nextOrder(items: Array<{ orderIndex: number }>) {
  return items.reduce((maximum, item) => Math.max(maximum, item.orderIndex), -1) + 1;
}

function readLegacyQueries(): Array<{
  id: string;
  name: string;
  sql: string;
  timestamp: number;
}> {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      state?: { savedQueries?: unknown[] };
      savedQueries?: unknown[];
    };
    const candidates = parsed.state?.savedQueries || parsed.savedQueries || [];
    return candidates.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const value = candidate as Record<string, unknown>;
      if (
        typeof value.id !== "string" ||
        typeof value.name !== "string" ||
        typeof value.sql !== "string"
      ) {
        return [];
      }
      return [{
        id: value.id,
        name: value.name,
        sql: value.sql,
        timestamp:
          typeof value.timestamp === "number" ? value.timestamp : Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

async function migrateLegacyQueries(
  projectId: string,
  libraryFiles: readonly SavedSqlFile[],
) {
  if (projectId !== "sqls") return false;
  const legacy = readLegacyQueries();
  if (legacy.length === 0) return false;
  const existingIds = new Set(libraryFiles.map((file) => file.id));
  const names = new Set(
    libraryFiles
      .filter((file) => !file.folderId && !file.connectionId)
      .map((file) => file.name),
  );
  const files = legacy
    .filter((query) => !existingIds.has(query.id))
    .map((query) => {
      const file: SavedSqlFile = {
        id: query.id,
        projectId,
        connectionId: null,
        folderId: null,
        name: nextSavedSqlName(query.name, names),
        databaseName: null,
        schemaName: null,
        sql: query.sql,
        sqlLoaded: true,
        orderIndex: names.size,
        openCount: 0,
        openedAt: null,
        createdAt: query.timestamp,
        updatedAt: query.timestamp,
      };
      names.add(file.name);
      return file;
    });
  if (files.length > 0) await savedSqlService.saveBatch([], files);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  return true;
}

export const useSavedQueryStore = create<SavedQueryState>((set, get) => ({
  projectId: null,
  folders: [],
  files: [],
  savedQueries: [],
  isLoading: false,
  error: null,

  loadProject: async (projectId) => {
    const epoch = ++loadEpoch;
    set({ projectId, folders: [], ...stateFiles([]), isLoading: true, error: null });
    try {
      let library = await savedSqlService.loadLibrary(projectId);
      if (await migrateLegacyQueries(projectId, library.files)) {
        library = await savedSqlService.loadLibrary(projectId);
      }
      if (epoch !== loadEpoch || get().projectId !== projectId) return;
      set({ folders: library.folders, ...stateFiles(library.files), isLoading: false });
    } catch (error) {
      if (epoch !== loadEpoch || get().projectId !== projectId) return;
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  ensureFileContent: async (id) => {
    const state = get();
    const existing = state.files.find((file) => file.id === id);
    if (!existing) return undefined;
    if (existing.sqlLoaded) return existing;
    const projectId = currentProjectId(state);
    const loaded = await savedSqlService.loadFile(projectId, id);
    if (!loaded || get().projectId !== projectId) return undefined;
    const files = get().files.map((file) => (file.id === id ? loaded : file));
    set(stateFiles(files));
    return loaded;
  },

  ensureAllFileContents: async () => {
    const state = get();
    const projectId = currentProjectId(state);
    if (state.files.every((file) => file.sqlLoaded)) return state.files;
    const loaded = await savedSqlService.loadFiles(projectId);
    if (get().projectId !== projectId) return [];
    set(stateFiles(loaded));
    return loaded;
  },

  openFile: async (id) => {
    const file = await get().ensureFileContent(id);
    if (!file) return undefined;
    const openedAt = Date.now();
    void savedSqlService.recordOpened(file.projectId, file.id, openedAt).catch(() => undefined);
    const files = get().files.map((candidate) =>
      candidate.id === id
        ? { ...candidate, openCount: candidate.openCount + 1, openedAt }
        : candidate,
    );
    set(stateFiles(files));
    return { ...file, openCount: file.openCount + 1, openedAt };
  },

  createFolder: async (name, options = {}) => {
    const state = get();
    const projectId = currentProjectId(state);
    const parent = options.parentFolderId
      ? state.folders.find((folder) => folder.id === options.parentFolderId)
      : undefined;
    if (options.parentFolderId && !parent) throw new Error("Parent folder not found");
    const connectionId = parent?.connectionId ?? options.connectionId ?? null;
    const now = Date.now();
    const folder: SavedSqlFolder = {
      id: uuidv4(),
      projectId,
      connectionId,
      parentFolderId: parent?.id ?? null,
      name: name.trim() || "New folder",
      orderIndex: nextOrder(
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
    if (get().projectId === projectId) set({ folders: [...get().folders, folder] });
    return folder;
  },

  renameFolder: async (id, name) => {
    const state = get();
    const folder = state.folders.find((item) => item.id === id);
    if (!folder) return;
    const updated = { ...folder, name: name.trim() || folder.name, updatedAt: Date.now() };
    await savedSqlService.saveFolder(updated);
    if (get().projectId === folder.projectId) {
      set({ folders: get().folders.map((item) => (item.id === id ? updated : item)) });
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
      orderIndex: nextOrder(
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
      set({ folders: get().folders.map((item) => (item.id === id ? updated : item)) });
    }
  },

  deleteFolder: async (id) => {
    const state = get();
    const projectId = currentProjectId(state);
    const removed = savedSqlDescendantFolderIds(state.folders, id);
    await savedSqlService.deleteFolder(projectId, id);
    if (get().projectId !== projectId) return;
    set({
      folders: get().folders.filter((folder) => !removed.has(folder.id)),
      ...stateFiles(get().files.filter((file) => !file.folderId || !removed.has(file.folderId))),
    });
  },

  saveQuery: async (name, sql, target = {}) => {
    const state = get();
    const projectId = currentProjectId(state);
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
      orderIndex: nextOrder(siblings),
      openCount: 0,
      openedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await savedSqlService.saveFile(file);
    if (get().projectId === projectId) set(stateFiles([...get().files, file]));
    return file;
  },

  deleteQuery: async (id) => {
    const state = get();
    const projectId = currentProjectId(state);
    await savedSqlService.deleteFile(projectId, id);
    if (get().projectId === projectId) {
      set(stateFiles(get().files.filter((file) => file.id !== id)));
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
      set(stateFiles(get().files.map((file) => (file.id === id ? updated : file))));
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
      orderIndex: nextOrder(
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
      set(stateFiles(get().files.map((file) => (file.id === id ? updated : file))));
    }
  },

  importEntries: async (entries, connectionId = null) => {
    const state = get();
    const projectId = currentProjectId(state);
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
      folderByLocation.set(folderKey(folder.parentFolderId || null, folder.name), folder);
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
        ...stateFiles([...get().files, ...addedFiles]),
      });
    }
    return { folderCount: addedFolders.length, fileCount: addedFiles.length };
  },
}));
