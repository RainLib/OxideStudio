import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import type { ConnectionConfig } from "@/features/connections/model/types";
import {
  objectGroupKey,
  schemaTreeKey,
} from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import type { DatabaseDriver } from "@/services/tauri/types/database";

interface CreateExplorerSchemaActivationContext {
  connections: ConnectionConfig[];
  selectExplorerNode: (
    nodeId: string,
    event?:
      | {
          currentTarget: HTMLElement;
          ctrlKey: boolean;
          metaKey: boolean;
          shiftKey: boolean;
        }
      | undefined,
  ) => void;
  activeConnectionId: string | null;
  setActiveConnection: (id: string) => Promise<string | null>;
  handleSchemaSelect: (schema: string) => Promise<void>;
  shouldAutoIntrospect: boolean;
  hydrateSchemaObjectsFromCache: (
    connectionId: string,
    schema: string,
  ) => Promise<boolean>;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  namespaceLabel: string;
  activeDriver: DatabaseDriver;
  expandedSchemaKeys: string[];
  setExpandedSchemaKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
}

export function createExplorerSchemaActivation({
  connections,
  selectExplorerNode,
  activeConnectionId,
  setActiveConnection,
  handleSchemaSelect,
  shouldAutoIntrospect,
  hydrateSchemaObjectsFromCache,
  setNamespaceError,
  namespaceLabel,
  activeDriver,
  expandedSchemaKeys,
  setExpandedSchemaKeys,
  setExpandedObjectGroupKeys,
}: CreateExplorerSchemaActivationContext) {
  const activateSchemaRow = async (
    connectionId: string,
    schema: string,
    isCurrentSchema: boolean,
    event?: {
      currentTarget: HTMLElement;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    },
  ) => {
    const connection = connections.find((item) => item.id === connectionId);
    selectExplorerNode(
      explorerNodeId(
        "schema",
        connectionId,
        connection ? connectionCatalogDatabaseName(connection) : "",
        schema,
      ),
      event,
    );
    try {
      if (connectionId !== activeConnectionId) {
        const connectionError = await setActiveConnection(connectionId);
        if (connectionError) throw new Error(connectionError);
      }

      if (connectionId !== activeConnectionId || !isCurrentSchema) {
        await handleSchemaSelect(schema);
      }
      if (!shouldAutoIntrospect) {
        await hydrateSchemaObjectsFromCache(connectionId, schema);
      }
      setNamespaceError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNamespaceError(
        `Could not open ${namespaceLabel} "${schema}": ${message}`,
      );
      throw error;
    }
  };

  const handleSchemaToggle = async (
    connectionId: string,
    schema: string,
    isCurrentSchema: boolean,
    forceExpanded?: boolean,
  ) => {
    const connection = connections.find((item) => item.id === connectionId);
    const driver = connection?.driver || activeDriver;
    const isKeyValueNamespace =
      defaultDatabaseCapabilities(driver).dataModel === "keyValue";
    const key = schemaTreeKey(connectionId, driver, schema);
    const isExpanded = expandedSchemaKeys.includes(key);
    const shouldExpand = forceExpanded ?? !isExpanded;

    setExpandedSchemaKeys((current) =>
      shouldExpand
        ? isKeyValueNamespace
          ? [key]
          : current.includes(key)
            ? current
            : [...current, key]
        : current.filter((item) => item !== key),
    );
    if (!shouldExpand) return;

    // Keep the object group warm, but do not collapse sibling schemas. This
    // mirrors DBX/DBeaver's navigator semantics and makes comparison work
    // between multiple schemas.
    const objectsKey = objectGroupKey(connectionId, driver, schema, "objects");
    setExpandedObjectGroupKeys((current) =>
      isKeyValueNamespace
        ? [objectsKey]
        : current.includes(objectsKey)
          ? current
          : [...current, objectsKey],
    );
    await activateSchemaRow(connectionId, schema, isCurrentSchema);
  };

  return { activateSchemaRow, handleSchemaToggle };
}
