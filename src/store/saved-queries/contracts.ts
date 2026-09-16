import type {
  SavedSqlDirectoryEntry,
  SavedSqlFile,
  SavedSqlFolder,
} from "@/services/tauri/saved-sql.service";
import type { StoreApi } from "zustand";

export type SavedQuery = SavedSqlFile;

export interface SavedQueryTarget {
  connectionId?: string | null;
  folderId?: string | null;
  databaseName?: string | null;
  schemaName?: string | null;
}

export interface SavedQueryState {
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

export type SavedQuerySet = StoreApi<SavedQueryState>["setState"];
export type SavedQueryGet = StoreApi<SavedQueryState>["getState"];
