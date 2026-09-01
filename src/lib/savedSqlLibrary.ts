import type {
  SavedSqlFile,
  SavedSqlFolder,
} from "@/services/tauri/saved-sql.service";

export type SavedSqlTreeRow =
  | { kind: "folder"; folder: SavedSqlFolder; depth: number }
  | { kind: "file"; file: SavedSqlFile; depth: number };

export function ensureSqlExtension(name: string): string {
  const trimmed = name.trim() || "untitled";
  return trimmed.toLocaleLowerCase().endsWith(".sql")
    ? trimmed
    : `${trimmed}.sql`;
}

export function stripSqlExtension(name: string): string {
  return name.toLocaleLowerCase().endsWith(".sql") ? name.slice(0, -4) : name;
}

export function compareSavedSqlOrder(
  left: { orderIndex: number; name: string; id: string },
  right: { orderIndex: number; name: string; id: string },
): number {
  return (
    left.orderIndex - right.orderIndex ||
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    left.id.localeCompare(right.id)
  );
}

export function savedSqlDescendantFolderIds(
  folders: readonly SavedSqlFolder[],
  rootId: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    const parent = folder.parentFolderId || "";
    const values = children.get(parent) || [];
    values.push(folder.id);
    children.set(parent, values);
  }
  const result = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    pending.push(...(children.get(id) || []));
  }
  return result;
}

export function savedSqlTreeRows(options: {
  folders: readonly SavedSqlFolder[];
  files: readonly SavedSqlFile[];
  collapsedFolderIds: ReadonlySet<string>;
  query?: string;
}): SavedSqlTreeRow[] {
  const query = options.query?.trim().toLocaleLowerCase() || "";
  const folderById = new Map(options.folders.map((folder) => [folder.id, folder]));
  const matchingFiles = new Set(
    options.files
      .filter((file) =>
        query
          ? [file.name, file.databaseName, file.schemaName, file.sqlLoaded ? file.sql : ""]
              .filter(Boolean)
              .some((value) => String(value).toLocaleLowerCase().includes(query))
          : true,
      )
      .map((file) => file.id),
  );
  const visibleFolders = new Set<string>();
  for (const folder of options.folders) {
    if (query && folder.name.toLocaleLowerCase().includes(query)) {
      visibleFolders.add(folder.id);
    }
  }
  for (const file of options.files) {
    if (!matchingFiles.has(file.id)) continue;
    let folderId = file.folderId || null;
    const seen = new Set<string>();
    while (folderId && !seen.has(folderId)) {
      seen.add(folderId);
      visibleFolders.add(folderId);
      folderId = folderById.get(folderId)?.parentFolderId || null;
    }
  }
  for (const folderId of [...visibleFolders]) {
    let parentId = folderById.get(folderId)?.parentFolderId || null;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      visibleFolders.add(parentId);
      parentId = folderById.get(parentId)?.parentFolderId || null;
    }
  }

  const foldersByParent = new Map<string, SavedSqlFolder[]>();
  for (const folder of options.folders) {
    const parent = folder.parentFolderId || "";
    const values = foldersByParent.get(parent) || [];
    values.push(folder);
    foldersByParent.set(parent, values);
  }
  for (const values of foldersByParent.values()) values.sort(compareSavedSqlOrder);
  const filesByFolder = new Map<string, SavedSqlFile[]>();
  for (const file of options.files) {
    const folder = file.folderId || "";
    const values = filesByFolder.get(folder) || [];
    values.push(file);
    filesByFolder.set(folder, values);
  }
  for (const values of filesByFolder.values()) values.sort(compareSavedSqlOrder);

  const rows: SavedSqlTreeRow[] = [];
  const appendFolder = (folder: SavedSqlFolder, depth: number) => {
    if (query && !visibleFolders.has(folder.id)) return;
    rows.push({ kind: "folder", folder, depth });
    if (!query && options.collapsedFolderIds.has(folder.id)) return;
    for (const child of foldersByParent.get(folder.id) || []) {
      appendFolder(child, depth + 1);
    }
    for (const file of filesByFolder.get(folder.id) || []) {
      if (!query || matchingFiles.has(file.id) || visibleFolders.has(folder.id)) {
        rows.push({ kind: "file", file, depth: depth + 1 });
      }
    }
  };
  for (const folder of foldersByParent.get("") || []) appendFolder(folder, 0);
  for (const file of filesByFolder.get("") || []) {
    if (!query || matchingFiles.has(file.id)) rows.push({ kind: "file", file, depth: 0 });
  }
  return rows;
}

export function nextSavedSqlName(
  requested: string,
  takenNames: Iterable<string>,
): string {
  const normalized = ensureSqlExtension(requested);
  const taken = new Set(
    [...takenNames].map((name) => ensureSqlExtension(name).toLocaleLowerCase()),
  );
  if (!taken.has(normalized.toLocaleLowerCase())) return normalized;
  const base = stripSqlExtension(normalized);
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base} (${suffix}).sql`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `${base}-${Date.now()}.sql`;
}
