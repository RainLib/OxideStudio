import { type ExplorerDirectoryGroupKind } from "@/features/database-explorer/model/explorerDirectory";
import { loadErrorMessage } from "@/features/database-explorer/model/remoteCatalogErrors";
import {
  type ObjectMemberLoadState,
  type SchemaLoadState,
} from "@/features/database-explorer/model/remoteCatalogTypes";
import { schemaService } from "@/services/tauri";
import type { SchemaObjectInfo } from "@/services/tauri/types";
import type { TableInfo } from "@/services/tauri/types/schemaCatalog";
import { useEffect, useRef, useState } from "react";

interface UseRemoteCatalogLoadingContext {
  connectionId: string;
  database: string;
  onTablesLoaded: ((schema: string, tables: TableInfo[]) => void) | undefined;
  expandedSchemas: Set<string>;
  setExpandedSchemas: React.Dispatch<React.SetStateAction<Set<string>>>;
  setExpandedGroups: React.Dispatch<React.SetStateAction<Set<string>>>;
  setExpandedTables: React.Dispatch<React.SetStateAction<Set<string>>>;
  expandedObjectKeys: Set<string>;
  setExpandedObjectKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useRemoteCatalogLoading({
  connectionId,
  database,
  onTablesLoaded,
  expandedSchemas,
  setExpandedSchemas,
  setExpandedGroups,
  setExpandedTables,
  expandedObjectKeys,
  setExpandedObjectKeys,
}: UseRemoteCatalogLoadingContext) {
  const [objectMemberLoads, setObjectMemberLoads] = useState<
    Record<string, ObjectMemberLoadState>
  >({});
  const [schemaLoads, setSchemaLoads] = useState<
    Record<string, SchemaLoadState>
  >({});
  const mountedRef = useRef(true);
  const requestVersionsRef = useRef<Record<string, number>>({});
  const memberRequestVersionsRef = useRef<Record<string, number>>({});
  const inFlightSchemasRef = useRef<Set<string>>(new Set());
  const contextVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    contextVersionRef.current += 1;
    setObjectMemberLoads({});
    setSchemaLoads({});
    requestVersionsRef.current = {};
    memberRequestVersionsRef.current = {};
    inFlightSchemasRef.current.clear();
  }, [connectionId, database]);

  const loadTables = async (schema: string) => {
    if (inFlightSchemasRef.current.has(schema)) return;
    inFlightSchemasRef.current.add(schema);
    const requestVersion = (requestVersionsRef.current[schema] || 0) + 1;
    const contextVersion = contextVersionRef.current;
    requestVersionsRef.current[schema] = requestVersion;
    setSchemaLoads((current) => ({
      ...current,
      [schema]: {
        status: "loading",
        tables: current[schema]?.tables || [],
        objects: current[schema]?.objects || [],
        objectError: null,
        error: null,
      },
    }));

    try {
      const schemaObjectRequest =
        typeof schemaService.getDatabaseSchemaObjects === "function"
          ? schemaService
              .getDatabaseSchemaObjects(connectionId, database, schema)
              .then((objects) => ({ objects, error: null }))
              .catch(() => ({
                objects: [] as SchemaObjectInfo[],
                error:
                  "Schema object metadata is unavailable for this server role",
              }))
          : Promise.resolve({
              objects: [] as SchemaObjectInfo[],
              error:
                "Schema object metadata is unavailable in this application build",
            });
      const [tables, objectResult] = await Promise.all([
        schemaService.getDatabaseTables(connectionId, database, schema),
        schemaObjectRequest,
      ]);
      if (
        !mountedRef.current ||
        contextVersionRef.current !== contextVersion ||
        requestVersionsRef.current[schema] !== requestVersion
      ) {
        return;
      }
      setSchemaLoads((current) => ({
        ...current,
        [schema]: {
          status: "success",
          tables,
          objects: objectResult.objects,
          objectError: objectResult.error,
          error: null,
        },
      }));
      onTablesLoaded?.(schema, tables);
    } catch (error) {
      if (
        !mountedRef.current ||
        contextVersionRef.current !== contextVersion ||
        requestVersionsRef.current[schema] !== requestVersion
      ) {
        return;
      }
      setSchemaLoads((current) => ({
        ...current,
        [schema]: {
          status: "error",
          tables: current[schema]?.tables || [],
          objects: current[schema]?.objects || [],
          objectError: current[schema]?.objectError || null,
          error: loadErrorMessage(error),
        },
      }));
    } finally {
      if (
        contextVersionRef.current === contextVersion &&
        requestVersionsRef.current[schema] === requestVersion
      ) {
        inFlightSchemasRef.current.delete(schema);
      }
    }
  };

  const toggleSchema = (schema: string) => {
    const willExpand = !expandedSchemas.has(schema);
    setExpandedSchemas((current) => {
      const next = new Set(current);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });

    const loadState = schemaLoads[schema];
    if (
      willExpand &&
      loadState?.status !== "loading" &&
      loadState?.status !== "success"
    ) {
      setExpandedGroups((current) => {
        const next = new Set(current);
        next.add(`${schema}:tables`);
        next.add(`${schema}:views`);
        return next;
      });
      void loadTables(schema);
    }
  };

  const toggleGroup = (schema: string, kind: ExplorerDirectoryGroupKind) => {
    const key = `${schema}:${kind}`;
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTable = (schema: string, table: string) => {
    const key = `${schema}:${table}`;
    setExpandedTables((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleObjectMembers = (schema: string, object: SchemaObjectInfo) => {
    if (!object.membersExpandable) return;
    const key = `${schema}:${object.objectType}:${object.name}`;
    const isExpanded = expandedObjectKeys.has(key);
    const isRetry = isExpanded && objectMemberLoads[key]?.status === "error";
    const willExpand = isRetry || !isExpanded;
    if (!isRetry) {
      setExpandedObjectKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }
    if (!willExpand || objectMemberLoads[key]?.status === "success") return;
    setObjectMemberLoads((current) => ({
      ...current,
      [key]: { status: "loading", members: [] },
    }));
    if (typeof schemaService.getDatabaseSchemaObjectMembers !== "function") {
      setObjectMemberLoads((current) => ({
        ...current,
        [key]: { status: "error", members: [] },
      }));
      return;
    }
    const contextVersion = contextVersionRef.current;
    const requestVersion = (memberRequestVersionsRef.current[key] || 0) + 1;
    memberRequestVersionsRef.current[key] = requestVersion;
    const isCurrentRequest = () =>
      mountedRef.current &&
      contextVersionRef.current === contextVersion &&
      memberRequestVersionsRef.current[key] === requestVersion;
    void schemaService
      .getDatabaseSchemaObjectMembers(
        connectionId,
        database,
        schema,
        object.name,
        object.objectType,
      )
      .then((members) => {
        if (!isCurrentRequest()) return;
        setObjectMemberLoads((current) => ({
          ...current,
          [key]: { status: "success", members },
        }));
      })
      .catch(() => {
        if (!isCurrentRequest()) return;
        setObjectMemberLoads((current) => ({
          ...current,
          [key]: { status: "error", members: [] },
        }));
      });
  };

  return {
    objectMemberLoads,
    schemaLoads,
    loadTables,
    toggleSchema,
    toggleGroup,
    toggleTable,
    toggleObjectMembers,
  };
}
