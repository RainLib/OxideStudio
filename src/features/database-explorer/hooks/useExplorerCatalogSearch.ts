import type { ConnectionConfig } from "@/features/connections/model/types";
import { type PostgresRemoteDatabaseState } from "@/features/database-explorer/model/explorerSidebarTypes";
import {
  collapsedDatabaseSchemaTargets,
  collapsedSchemaMetadataTargets,
  runSidebarSearchTasks,
} from "@/features/database-explorer/model/sidebarSearchTasks";
import type { SchemaObjectSnapshot } from "@/features/schema-metadata/model/types";
import { schemaService } from "@/services/tauri";
import type {
  DatabaseCapabilities,
  SchemaObjectInfo,
  TableInfo,
} from "@/services/tauri/types";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import { useConnectionStore } from "@/store/useConnectionStore";
import type {
  ExplorerFilterScope,
  ExplorerSearchMode,
} from "@/store/useDatabaseExplorerStore";
import { getSchemaObjectMetadataSnapshotKey } from "@/store/useSchemaStore";
import { useEffect, useRef } from "react";

interface UseExplorerCatalogSearchContext {
  deferredFilterText: string;
  activeConnection: ConnectionConfig | undefined;
  explorerFilterMatches: (...values: unknown[]) => boolean;
  explorerRegexSearch: boolean;
  explorerSearchMode: ExplorerSearchMode;
  explorerFilterScope: ExplorerFilterScope;
  activeConnectionId: string | null;
  isActiveConnectionReady: boolean;
  activeCapabilities: DatabaseCapabilities;
  schemas: string[];
  currentSchema: string | null;
  objectSnapshots: Record<string, SchemaObjectSnapshot>;
  activeDriver: DatabaseDriver;
  loadSchemaObjectsForSearch: (
    connectionId: string,
    schema: string,
  ) => Promise<boolean>;
  canBrowseDatabaseCatalogs: boolean;
  postgresRemoteContextVersion: React.RefObject<number>;
  visiblePostgresDatabases: string[];
  activePostgresDatabase: string;
  postgresRemoteDatabases: PostgresRemoteDatabaseState;
  setPostgresRemoteDatabases: React.Dispatch<
    React.SetStateAction<PostgresRemoteDatabaseState>
  >;
  filterText: string;
}

export function useExplorerCatalogSearch({
  deferredFilterText,
  activeConnection,
  explorerFilterMatches,
  explorerRegexSearch,
  explorerSearchMode,
  explorerFilterScope,
  activeConnectionId,
  isActiveConnectionReady,
  activeCapabilities,
  schemas,
  currentSchema,
  objectSnapshots,
  activeDriver,
  loadSchemaObjectsForSearch,
  canBrowseDatabaseCatalogs,
  postgresRemoteContextVersion,
  visiblePostgresDatabases,
  activePostgresDatabase,
  postgresRemoteDatabases,
  setPostgresRemoteDatabases,
  filterText,
}: UseExplorerCatalogSearchContext) {
  const postgresGlobalSearchGenerationRef = useRef(0);

  // DBX searches collapsed catalog containers too. Keep Oxide's equivalent
  // bounded and cancellation-safe: wait briefly for typing to settle, load
  // only metadata that is absent from the local cache, and discard results
  // once the filter, connection, or catalog context changes.
  useEffect(() => {
    const normalizedFilter = deferredFilterText.trim().toLocaleLowerCase();
    const activeConnectionMatches = Boolean(
      activeConnection &&
        explorerFilterMatches(
          activeConnection.name,
          activeConnection.driver,
          activeConnection.database,
        ),
    );
    if (
      !normalizedFilter ||
      explorerRegexSearch ||
      explorerSearchMode !== "global" ||
      explorerFilterScope === "connections" ||
      (explorerFilterScope === "all" && activeConnectionMatches) ||
      !activeConnectionId ||
      !isActiveConnectionReady ||
      activeCapabilities.dataModel === "keyValue"
    ) {
      return;
    }
    const connectionId = activeConnectionId;
    const collapsedSchemas = schemas.filter(
      (schema) =>
        schema !== currentSchema &&
        !Object.prototype.hasOwnProperty.call(
          objectSnapshots,
          getSchemaObjectMetadataSnapshotKey(
            connectionId,
            activeDriver,
            schema,
          ),
        ),
    );
    if (collapsedSchemas.length === 0) return;

    const timeout = window.setTimeout(() => {
      void runSidebarSearchTasks(
        collapsedSchemas.map(
          (schema) => () => loadSchemaObjectsForSearch(connectionId, schema),
        ),
      );
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [
    activeCapabilities.dataModel,
    activeConnection,
    activeConnectionId,
    activeDriver,
    currentSchema,
    deferredFilterText,
    explorerFilterScope,
    explorerFilterMatches,
    explorerRegexSearch,
    explorerSearchMode,
    isActiveConnectionReady,
    loadSchemaObjectsForSearch,
    objectSnapshots,
    schemas,
  ]);

  useEffect(() => {
    const normalizedFilter = deferredFilterText.trim().toLocaleLowerCase();
    const generation = postgresGlobalSearchGenerationRef.current + 1;
    postgresGlobalSearchGenerationRef.current = generation;
    if (
      !normalizedFilter ||
      explorerRegexSearch ||
      explorerSearchMode !== "global" ||
      !activeConnectionId ||
      !canBrowseDatabaseCatalogs ||
      !isActiveConnectionReady
    ) {
      return;
    }

    const connectionId = activeConnectionId;
    const contextVersion = postgresRemoteContextVersion.current;
    const databases = visiblePostgresDatabases.filter(
      (database) => database !== activePostgresDatabase,
    );
    const cachedRemote =
      postgresRemoteDatabases.connectionId === connectionId
        ? postgresRemoteDatabases
        : { connectionId, schemas: {}, tables: {}, objects: {} };
    const timeout = window.setTimeout(() => {
      void (async () => {
        const schemaResults = await runSidebarSearchTasks(
          collapsedDatabaseSchemaTargets(
            databases,
            activePostgresDatabase,
            cachedRemote,
          ).map((database) => async () => ({
            database,
            schemas: await schemaService.getDatabaseSchemas(
              connectionId,
              database,
            ),
          })),
        );
        if (
          postgresGlobalSearchGenerationRef.current !== generation ||
          postgresRemoteContextVersion.current !== contextVersion ||
          useConnectionStore.getState().activeConnectionId !== connectionId
        ) {
          return;
        }

        const discoveredSchemas = new Map<string, string[]>();
        for (const result of schemaResults) {
          if (result?.status === "fulfilled") {
            discoveredSchemas.set(
              result.value.database,
              Array.from(new Set(result.value.schemas)),
            );
          }
        }
        const schemaByDatabase = new Map<string, string[]>();
        for (const database of databases) {
          schemaByDatabase.set(
            database,
            discoveredSchemas.get(database) ||
              cachedRemote.schemas[database] ||
              [],
          );
        }
        if (discoveredSchemas.size > 0) {
          setPostgresRemoteDatabases((current) => {
            if (current.connectionId !== connectionId) return current;
            return {
              ...current,
              schemas: {
                ...current.schemas,
                ...Object.fromEntries(discoveredSchemas),
              },
            };
          });
        }

        const metadataResults = await runSidebarSearchTasks(
          collapsedSchemaMetadataTargets(schemaByDatabase, cachedRemote).map(
            ({ database, schema }) =>
              async () => {
                const objectRequest =
                  typeof schemaService.getDatabaseSchemaObjects === "function"
                    ? schemaService
                        .getDatabaseSchemaObjects(
                          connectionId,
                          database,
                          schema,
                        )
                        .catch(() => [] as SchemaObjectInfo[])
                    : Promise.resolve([] as SchemaObjectInfo[]);
                const [tables, objects] = await Promise.all([
                  schemaService.getDatabaseTables(
                    connectionId,
                    database,
                    schema,
                  ),
                  objectRequest,
                ]);
                return { database, schema, tables, objects };
              },
          ),
        );
        if (
          postgresGlobalSearchGenerationRef.current !== generation ||
          postgresRemoteContextVersion.current !== contextVersion ||
          useConnectionStore.getState().activeConnectionId !== connectionId
        ) {
          return;
        }
        const tablePatches: Record<string, Record<string, TableInfo[]>> = {};
        const objectPatches: Record<
          string,
          Record<string, SchemaObjectInfo[]>
        > = {};
        for (const result of metadataResults) {
          if (result?.status !== "fulfilled") continue;
          const { database, schema, tables, objects } = result.value;
          tablePatches[database] = {
            ...(tablePatches[database] || {}),
            [schema]: tables,
          };
          objectPatches[database] = {
            ...(objectPatches[database] || {}),
            [schema]: objects,
          };
        }
        if (Object.keys(tablePatches).length === 0) return;
        setPostgresRemoteDatabases((current) => {
          if (current.connectionId !== connectionId) return current;
          return {
            ...current,
            tables: {
              ...current.tables,
              ...Object.fromEntries(
                Object.entries(tablePatches).map(([database, tables]) => [
                  database,
                  { ...(current.tables[database] || {}), ...tables },
                ]),
              ),
            },
            objects: {
              ...current.objects,
              ...Object.fromEntries(
                Object.entries(objectPatches).map(([database, objects]) => [
                  database,
                  { ...(current.objects[database] || {}), ...objects },
                ]),
              ),
            },
          };
        });
      })();
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [
    activeConnectionId,
    activePostgresDatabase,
    canBrowseDatabaseCatalogs,
    explorerRegexSearch,
    explorerSearchMode,
    filterText,
    isActiveConnectionReady,
    postgresRemoteDatabases,
    visiblePostgresDatabases,
  ]);
}
