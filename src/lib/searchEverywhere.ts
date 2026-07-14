import type { ProjectFileEntry } from "@/services/tauri/project-files.service";
import type { TableInfo } from "@/services/tauri/types";

export type SearchableDatabaseObject =
  | {
      kind: "schema";
      name: string;
      schema: string;
    }
  | {
      kind: "relation";
      name: string;
      schema: string;
      objectType: string | null;
    };

export function searchableDatabaseObjects(
  schemas: string[],
  tables: TableInfo[],
  currentSchema: string | null
): SearchableDatabaseObject[] {
  const schemaObjects: SearchableDatabaseObject[] = Array.from(new Set(schemas))
    .sort((left, right) => left.localeCompare(right))
    .map((schema) => ({ kind: "schema", name: schema, schema }));

  if (!currentSchema) return schemaObjects;

  const seenRelations = new Set<string>();
  const relations = tables
    .filter((table) => {
      const key = `${table.schema || currentSchema}\0${table.name}\0${
        table.type || ""
      }`;
      if (seenRelations.has(key)) return false;
      seenRelations.add(key);
      return true;
    })
    .map<SearchableDatabaseObject>((table) => ({
      kind: "relation",
      name: table.name,
      schema: table.schema || currentSchema,
      objectType: table.type || null,
    }))
    .sort(
      (left, right) =>
        left.schema.localeCompare(right.schema) ||
        left.name.localeCompare(right.name)
    );

  return [...schemaObjects, ...relations];
}

export function searchableProjectFilePaths(
  entriesByDirectory: Record<string, ProjectFileEntry[]>
): string[] {
  return Array.from(
    new Set(
      Object.values(entriesByDirectory)
        .flat()
        .filter((entry) => entry.kind === "file" && !entry.isSymlink)
        .map((entry) => entry.relativePath)
    )
  ).sort((left, right) => left.localeCompare(right));
}

export function rankSearchEverywhereItems<T>(
  items: T[],
  query: string,
  searchableText: (item: T) => string,
  options: { limit?: number; emptyLimit?: number } = {}
): T[] {
  const limit = Math.max(1, options.limit ?? 50);
  const emptyLimit = Math.min(limit, Math.max(1, options.emptyLimit ?? 12));
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return items.slice(0, emptyLimit);

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const normalizedAbbreviation = normalizedQuery.replace(/[^a-z0-9]/gi, "");
  return items
    .map((item, index) => {
      const text = searchableText(item).toLowerCase();
      const initials = text
        .split(/[^a-z0-9]+/i)
        .filter(Boolean)
        .map((part) => part[0])
        .join("");
      const exact = text === normalizedQuery;
      const prefix = text.startsWith(normalizedQuery);
      const phraseIndex = text.indexOf(normalizedQuery);
      const tokenIndexes = queryTokens.map((token) => text.indexOf(token));
      const tokensMatch = tokenIndexes.every((position) => position >= 0);
      const abbreviationMatch =
        normalizedAbbreviation.length > 0 &&
        initials.startsWith(normalizedAbbreviation);
      if (!tokensMatch && !abbreviationMatch) return null;

      const score = exact
        ? 0
        : prefix
        ? 10
        : phraseIndex >= 0
        ? 20 + phraseIndex
        : abbreviationMatch
        ? 40
        : 60 + tokenIndexes.reduce((total, position) => total + position, 0);
      return { item, index, score };
    })
    .filter(
      (entry): entry is { item: T; index: number; score: number } =>
        entry !== null
    )
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}
