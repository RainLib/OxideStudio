import type { SchemaLoadState } from "@/features/database-explorer/model/remoteCatalogTypes";
import {
  databaseObjectNavigationKey,
  databaseSchemaNavigationKey,
  useDatabaseNavigationStore,
} from "@/lib/databaseNavigation";
import { useEffect } from "react";

interface UseRemoteCatalogRevealContext {
  refreshRequest: { version: number; schema?: string | undefined } | undefined;
  expandedSchemas: Set<string>;
  schemas: string[];
  loadTables: (schema: string) => Promise<void>;
  connectionId: string;
  database: string;
  setExpandedSchemas: React.Dispatch<React.SetStateAction<Set<string>>>;
  schemaLoads: Record<string, SchemaLoadState>;
}

export function useRemoteCatalogReveal({
  refreshRequest,
  expandedSchemas,
  schemas,
  loadTables,
  connectionId,
  database,
  setExpandedSchemas,
  schemaLoads,
}: UseRemoteCatalogRevealContext) {
  const databaseRevealRequest = useDatabaseNavigationStore(
    (state) => state.revealRequest,
  );
  const clearDatabaseReveal = useDatabaseNavigationStore(
    (state) => state.clearReveal,
  );
  useEffect(() => {
    if (!refreshRequest?.version) return;
    const targets = refreshRequest.schema
      ? [refreshRequest.schema]
      : [...expandedSchemas];
    targets
      .filter((schema) => schemas.includes(schema))
      .forEach((schema) => void loadTables(schema));
  }, [connectionId, database, refreshRequest?.version]);

  useEffect(() => {
    const target = databaseRevealRequest?.target;
    if (
      !target ||
      target.connectionId !== connectionId ||
      target.databaseName !== database ||
      !target.schemaName ||
      !schemas.includes(target.schemaName)
    ) {
      return;
    }
    const schemaName = target.schemaName;
    setExpandedSchemas((current) =>
      current.has(schemaName) ? current : new Set([...current, schemaName]),
    );
    const loadState = schemaLoads[schemaName];
    if (
      target.objectName &&
      loadState?.status !== "loading" &&
      loadState?.status !== "success"
    ) {
      void loadTables(schemaName);
    }
  }, [databaseRevealRequest?.id, schemas]);

  useEffect(() => {
    if (!databaseRevealRequest) return;
    const { id: requestId, target } = databaseRevealRequest;
    if (
      target.connectionId !== connectionId ||
      target.databaseName !== database ||
      !target.schemaName ||
      (target.objectName &&
        schemaLoads[target.schemaName]?.status !== "success")
    ) {
      return;
    }
    window.requestAnimationFrame(() => {
      const key = target.objectName
        ? databaseObjectNavigationKey({
            ...target,
            objectName: target.objectName,
          })
        : databaseSchemaNavigationKey(target);
      const element = document.querySelector<HTMLElement>(
        target.objectName
          ? `[data-database-object-key="${key}"]`
          : `[data-database-schema-key="${key}"]`,
      );
      element?.scrollIntoView({ block: "nearest" });
      element?.focus();
      clearDatabaseReveal(requestId);
    });
  }, [
    clearDatabaseReveal,
    connectionId,
    database,
    databaseRevealRequest,
    schemaLoads,
  ]);
}
