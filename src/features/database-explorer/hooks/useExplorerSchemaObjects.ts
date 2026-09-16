import { routineMatchesFilter } from "@/features/database-explorer/model/explorerSidebarPresentation";
import type { PostgresRemoteDatabaseState } from "@/features/database-explorer/model/explorerSidebarTypes";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import type { ExplorerVisibilityFilter } from "@/features/database-explorer/model/explorerVisibilityFilter";
import { explorerNodePassesVisibilityFilter } from "@/features/database-explorer/model/explorerVisibilityFilter";
import { routineSignature } from "@/features/database-explorer/model/routinePresentation";
import type { SchemaObjectSnapshot } from "@/features/schema-metadata/model/types";
import { isMaterializedViewObject, isViewObject } from "@/lib/databaseDialect";
import { collectionDisplayLabelForCapabilities } from "@/lib/databaseObjectPreview";
import type { DatabaseCapabilities } from "@/services/tauri/types/database";
import type {
  CollectionInfo,
  FunctionInfo,
  TableInfo,
} from "@/services/tauri/types/schemaCatalog";
import { getSchemaObjectMetadataSnapshotKey } from "@/store/useSchemaStore";
import { useMemo } from "react";

interface UseExplorerSchemaObjectsContext {
  activeCapabilities: DatabaseCapabilities;
  activeConnectionId: string | null;
  canBrowseCollections: boolean;
  canBrowseTables: boolean;
  collections: CollectionInfo[];
  currentSchema: string | null;
  deferredFilterText: string;
  explorerFilterMatches: (...values: unknown[]) => boolean;
  explorerVisibilityFilters: Record<string, ExplorerVisibilityFilter>;
  functions: FunctionInfo[];
  objectSnapshots: Record<string, SchemaObjectSnapshot>;
  pinnedTables: string[];
  tables: TableInfo[];
  schemas: string[];
  postgresRemoteDatabases: PostgresRemoteDatabaseState;
}

export function useExplorerSchemaObjects({
  activeCapabilities,
  activeConnectionId,
  canBrowseCollections,
  canBrowseTables,
  collections,
  currentSchema,
  deferredFilterText,
  explorerFilterMatches,
  explorerVisibilityFilters,
  functions,
  objectSnapshots,
  pinnedTables,
  tables,
  schemas,
  postgresRemoteDatabases,
}: UseExplorerSchemaObjectsContext) {
  const schemaObjectsRenderCache = useMemo(
    () =>
      new Map<
        string,
        {
          tables: TableInfo[];
          collections: CollectionInfo[];
          functions: FunctionInfo[];
          pinnedTables: string[];
          hasSnapshot: boolean;
        }
      >(),
    [
      activeCapabilities,
      activeConnectionId,
      canBrowseCollections,
      canBrowseTables,
      collections,
      currentSchema,
      deferredFilterText,
      explorerFilterMatches,
      explorerVisibilityFilters,
      functions,
      objectSnapshots,
      pinnedTables,
      tables,
    ],
  );

  const schemaObjectsFor = (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
    databaseName = "",
  ) => {
    const cacheKey = `${connectionId}\u0000${driver || "unknown"}\u0000${databaseName}\u0000${schema}`;
    const cached = schemaObjectsRenderCache.get(cacheKey);
    if (cached) return cached;
    const isActiveSchema =
      connectionId === activeConnectionId && schema === currentSchema;
    const snapshot = isActiveSchema
      ? null
      : objectSnapshots[
          getSchemaObjectMetadataSnapshotKey(connectionId, driver, schema)
        ];
    const schemaTables = canBrowseTables
      ? (snapshot?.tables ?? (isActiveSchema ? tables : []))
      : [];
    const schemaCollections = canBrowseCollections
      ? (snapshot?.collections ?? (isActiveSchema ? collections : []))
      : [];
    const schemaFunctions =
      snapshot?.functions ?? (isActiveSchema ? functions : []);
    const schemaPinnedTables =
      snapshot?.pinnedTables ?? (isActiveSchema ? pinnedTables : []);
    const objectVisibilityParentId = explorerNodeId(
      "folder",
      "schema-objects",
      connectionId,
      databaseName,
      schema,
    );
    const objectVisibilityFilter =
      explorerVisibilityFilters[objectVisibilityParentId];

    const sortedTables = schemaTables
      .filter((table) => {
        const kind = isMaterializedViewObject(table.type)
          ? "materialized-view"
          : isViewObject(table.type)
            ? "view"
            : "table";
        return explorerNodePassesVisibilityFilter(
          objectVisibilityFilter,
          explorerNodeId(kind, connectionId, databaseName, schema, table.name),
          table.name,
        );
      })
      .sort((a, b) => {
        const aPinned = schemaPinnedTables.includes(a.name);
        const bPinned = schemaPinnedTables.includes(b.name);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return a.name.localeCompare(b.name);
      });

    const result = {
      tables: sortedTables.filter((table) =>
        explorerFilterMatches(table.name, table.comment),
      ),
      collections: [...schemaCollections]
        .filter((collection) =>
          explorerNodePassesVisibilityFilter(
            objectVisibilityFilter,
            explorerNodeId(
              activeCapabilities.dataModel === "search"
                ? "search-index"
                : activeCapabilities.dataModel === "keyValue"
                  ? "key"
                  : "collection",
              connectionId,
              databaseName,
              schema,
              collection.name,
            ),
            collection.name,
          ),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((collection) =>
          explorerFilterMatches(
            collection.name,
            collectionDisplayLabelForCapabilities(
              activeCapabilities,
              collection,
            ),
          ),
        ),
      functions: schemaFunctions
        .filter((routine) =>
          explorerNodePassesVisibilityFilter(
            objectVisibilityFilter,
            explorerNodeId(
              routine.routine_type?.toLocaleLowerCase() === "procedure"
                ? "procedure"
                : "function",
              connectionId,
              databaseName,
              schema,
              routine.name,
              routineSignature(routine),
            ),
            routine.name,
          ),
        )
        .filter((routine) =>
          routineMatchesFilter(routine, explorerFilterMatches),
        ),
      pinnedTables: schemaPinnedTables,
      hasSnapshot: Boolean(snapshot),
    };
    schemaObjectsRenderCache.set(cacheKey, result);
    return result;
  };

  const postgresDatabaseMatchesFilter = (
    connectionId: string,
    database: string,
    currentDatabase: string,
    filter: string,
  ) => {
    if (!filter.trim()) return true;
    if (database === currentDatabase) {
      return schemas.some((schema) => {
        if (explorerFilterMatches(schema)) return true;
        const isActiveSchema = schema === currentSchema;
        const snapshot = isActiveSchema
          ? null
          : objectSnapshots[
              getSchemaObjectMetadataSnapshotKey(
                connectionId,
                "postgres",
                schema,
              )
            ];
        const schemaTables = isActiveSchema ? tables : snapshot?.tables || [];
        const schemaFunctions = isActiveSchema
          ? functions
          : snapshot?.functions || [];
        return (
          schemaTables.some((table) =>
            explorerFilterMatches(table.name, table.comment),
          ) ||
          schemaFunctions.some((routine) =>
            routineMatchesFilter(routine, explorerFilterMatches),
          )
        );
      });
    }

    if (postgresRemoteDatabases.connectionId !== connectionId) return false;
    return (
      (postgresRemoteDatabases.schemas[database] || []).some((schema) =>
        explorerFilterMatches(schema),
      ) ||
      Object.values(postgresRemoteDatabases.tables[database] || {}).some(
        (databaseTables) =>
          databaseTables.some((table) =>
            explorerFilterMatches(table.name, table.comment),
          ),
      ) ||
      Object.values(postgresRemoteDatabases.objects[database] || {}).some(
        (databaseObjects) =>
          databaseObjects.some((object) =>
            explorerFilterMatches(
              object.name,
              object.objectType,
              object.parentName,
            ),
          ),
      )
    );
  };

  return { schemaObjectsFor, postgresDatabaseMatchesFilter };
}
