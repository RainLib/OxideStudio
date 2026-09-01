import { invokeRawCommand } from "./client";

export interface SavedSqlFolder {
  id: string;
  projectId: string;
  connectionId?: string | null;
  parentFolderId?: string | null;
  name: string;
  orderIndex: number;
  createdAt: number;
  updatedAt: number;
}

export interface SavedSqlFile {
  id: string;
  projectId: string;
  connectionId?: string | null;
  folderId?: string | null;
  name: string;
  databaseName?: string | null;
  schemaName?: string | null;
  sql: string;
  sqlLoaded: boolean;
  orderIndex: number;
  openCount: number;
  openedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SavedSqlLibrary {
  folders: SavedSqlFolder[];
  files: SavedSqlFile[];
}

export interface SavedSqlDirectoryEntry {
  relativePath: string;
  sql: string;
}

export const savedSqlService = {
  loadLibrary: (projectId: string) =>
    invokeRawCommand<SavedSqlLibrary>("load_saved_sql_library", { projectId }),
  loadFile: (projectId: string, id: string) =>
    invokeRawCommand<SavedSqlFile | null>("load_saved_sql_file", {
      projectId,
      id,
    }),
  loadFiles: (projectId: string) =>
    invokeRawCommand<SavedSqlFile[]>("load_saved_sql_files", { projectId }),
  saveFolder: (folder: SavedSqlFolder) =>
    invokeRawCommand<void>("save_saved_sql_folder", { folder }),
  deleteFolder: (projectId: string, id: string) =>
    invokeRawCommand<void>("delete_saved_sql_folder", { projectId, id }),
  saveFile: (file: SavedSqlFile) =>
    invokeRawCommand<void>("save_saved_sql_file", { file }),
  saveBatch: (folders: SavedSqlFolder[], files: SavedSqlFile[]) =>
    invokeRawCommand<void>("save_saved_sql_batch", { folders, files }),
  deleteFile: (projectId: string, id: string) =>
    invokeRawCommand<void>("delete_saved_sql_file", { projectId, id }),
  recordOpened: (projectId: string, id: string, openedAt: number) =>
    invokeRawCommand<void>("record_saved_sql_file_opened", {
      projectId,
      id,
      openedAt,
    }),
  importDirectory: (sourceDir: string) =>
    invokeRawCommand<SavedSqlDirectoryEntry[]>("import_saved_sql_directory", {
      sourceDir,
    }),
  exportDirectory: (targetDir: string, entries: SavedSqlDirectoryEntry[]) =>
    invokeRawCommand<string>("export_saved_sql_directory", {
      targetDir,
      entries,
    }),
};
