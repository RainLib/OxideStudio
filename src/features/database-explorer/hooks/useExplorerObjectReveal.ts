import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import type { ConnectionConfig } from "@/features/connections/model/types";
import {
  objectGroupKey,
  schemaTreeKey,
  supportsDatabaseCatalogTree,
} from "@/features/database-explorer/model/explorerSidebarPresentation";
import {
  databaseObjectNavigationKey,
  databaseSchemaNavigationKey,
  useDatabaseNavigationStore,
} from "@/lib/databaseNavigation";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useEffect } from "react";

interface UseExplorerObjectRevealContext {
  databaseRevealRequest: ReturnType<
    typeof useDatabaseNavigationStore.getState
  >["revealRequest"];
  activeProjectId: string;
  connections: ConnectionConfig[];
  clearDatabaseReveal: (requestId: string) => void;
  setActiveConnection: (id: string) => Promise<string | null>;
  setExpandedConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  loadPostgresRemoteDatabase: (
    connectionId: string,
    database: string,
  ) => Promise<void>;
  setFilterText: React.Dispatch<React.SetStateAction<string>>;
  handleSchemaSelect: (schema: string) => Promise<void>;
  shouldAutoIntrospect: boolean;
  hydrateSchemaObjectsFromCache: (
    connectionId: string,
    schema: string,
  ) => Promise<boolean>;
  setExpandedSchemaKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  selectTable: (table: string | null) => void;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useExplorerObjectReveal({
  databaseRevealRequest,
  activeProjectId,
  connections,
  clearDatabaseReveal,
  setActiveConnection,
  setExpandedConnectionIds,
  loadPostgresRemoteDatabase,
  setFilterText,
  handleSchemaSelect,
  shouldAutoIntrospect,
  hydrateSchemaObjectsFromCache,
  setExpandedSchemaKeys,
  setExpandedObjectGroupKeys,
  selectTable,
  setNamespaceError,
}: UseExplorerObjectRevealContext) {
  useEffect(() => {
    if (!databaseRevealRequest) return;
    const { id: requestId, target } = databaseRevealRequest;
    if (target.projectId !== activeProjectId) return;
    const connection = connections.find(
      (item) => item.id === target.connectionId,
    );
    if (!connection) {
      clearDatabaseReveal(requestId);
      return;
    }

    let cancelled = false;
    void (async () => {
      if (useConnectionStore.getState().activeConnectionId !== connection.id) {
        const connectionError = await setActiveConnection(connection.id);
        if (connectionError || cancelled) return;
      }
      setExpandedConnectionIds((current) =>
        current.includes(connection.id) ? current : [...current, connection.id],
      );

      const currentDatabase = supportsDatabaseCatalogTree(connection.driver)
        ? connectionCatalogDatabaseName(connection)
        : connection.database || "";
      if (
        supportsDatabaseCatalogTree(connection.driver) &&
        target.databaseName &&
        target.databaseName !== currentDatabase
      ) {
        await loadPostgresRemoteDatabase(connection.id, target.databaseName);
        if (!target.schemaName) {
          setFilterText("");
          window.requestAnimationFrame(() => {
            const databaseRow = Array.from(
              document.querySelectorAll<HTMLElement>(
                "[data-postgres-database]",
              ),
            ).find(
              (element) =>
                element.dataset.postgresDatabase === target.databaseName,
            );
            databaseRow?.querySelector<HTMLElement>("button")?.focus();
            clearDatabaseReveal(requestId);
          });
        }
        return;
      }

      if (!target.schemaName) {
        setFilterText("");
        window.requestAnimationFrame(() => {
          const databaseRow = Array.from(
            document.querySelectorAll<HTMLElement>("[data-postgres-database]"),
          ).find(
            (element) =>
              element.dataset.postgresDatabase === target.databaseName,
          );
          databaseRow?.querySelector<HTMLElement>("button")?.focus();
          clearDatabaseReveal(requestId);
        });
        return;
      }

      await handleSchemaSelect(target.schemaName);
      if (target.objectName && !shouldAutoIntrospect) {
        await hydrateSchemaObjectsFromCache(connection.id, target.schemaName);
      }
      if (cancelled) return;
      const schemaKey = schemaTreeKey(
        connection.id,
        connection.driver,
        target.schemaName,
      );
      setExpandedSchemaKeys((current) =>
        current.includes(schemaKey) ? current : [...current, schemaKey],
      );
      setFilterText("");
      window.requestAnimationFrame(() => {
        const databaseName =
          target.databaseName ||
          (supportsDatabaseCatalogTree(connection.driver)
            ? currentDatabase || undefined
            : undefined);
        const key = target.objectName
          ? databaseObjectNavigationKey({
              ...target,
              objectName: target.objectName,
              databaseName,
            })
          : databaseSchemaNavigationKey({
              ...target,
              databaseName,
            });
        const element = document.querySelector<HTMLElement>(
          target.objectName
            ? `[data-database-object-key="${key}"]`
            : `[data-database-schema-key="${key}"]`,
        );
        element?.scrollIntoView({ block: "nearest" });
        element?.focus();
        clearDatabaseReveal(requestId);
      });
      if (target.objectName) {
        const objectsKey = objectGroupKey(
          connection.id,
          connection.driver,
          target.schemaName,
          "objects",
        );
        setExpandedObjectGroupKeys((current) =>
          current.includes(objectsKey) ? current : [...current, objectsKey],
        );
        selectTable(target.objectName);
      }
    })().catch((error) => {
      if (!cancelled) {
        setNamespaceError(
          error instanceof Error ? error.message : String(error),
        );
        clearDatabaseReveal(requestId);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [databaseRevealRequest?.id]);
}
