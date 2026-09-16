import { nextSavedSqlName } from "@/lib/savedSqlLibrary";
import {
  savedSqlService,
  type SavedSqlFile,
} from "@/services/tauri/saved-sql.service";

const LEGACY_STORAGE_KEY = "saved-queries";

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

export async function migrateLegacySavedQueries(
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
