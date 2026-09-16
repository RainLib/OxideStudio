import type {
  SavedSqlFile,
  SavedSqlFolder,
} from "@/services/tauri/saved-sql.service";

export type SqlLibrarySortMode = "folder" | "recent";

export type SqlLibraryEditDialog =
  | { mode: "folder"; parentFolderId?: string | null; connectionId?: string | null }
  | { mode: "query"; folderId?: string | null; connectionId?: string | null }
  | { mode: "rename-folder"; folder: SavedSqlFolder }
  | { mode: "rename-file"; file: SavedSqlFile };

export type SqlLibraryDeleteTarget =
  | { kind: "folder"; item: SavedSqlFolder }
  | { kind: "file"; item: SavedSqlFile };
