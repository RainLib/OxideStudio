import type { ConnectionConfig } from "@/features/connections/model/types";
import { managedCapabilitiesFallback } from "@/features/connections/model/managedCapabilities";
import { useExplorerCapabilities } from "@/features/database-explorer/hooks/useExplorerCapabilities";
import {
  objectGroupKey,
  schemaTreeKey,
} from "@/features/database-explorer/model/explorerSidebarPresentation";
import { usePostgresDatabaseDiscovery } from "@/hooks/usePostgresDatabaseDiscovery";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  pluralizeNamespaceLabel,
  supportsTableWorkspace,
} from "@/lib/databaseDialect";
import { databaseObjectPreviewProvider } from "@/lib/databaseObjectPreview";
import { invalidateRoutineSourceCache } from "@/services/routineSourceCache";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useEffect, useRef } from "react";
interface ExplorerSourceContextOptions {
  metadataVersion: number;
  connections: ConnectionConfig[];
  activeConnectionId: string | null;
  connectedConnectionIds: string[];
  activeProjectId: string;
  postgresDatabaseRefreshVersion: number;
  currentSchema: string | null;
  expandedObjectGroupKeys: string[];
  expandedSchemaKeys: string[];
}
export function useExplorerSourceContext({
  metadataVersion,
  connections,
  activeConnectionId,
  connectedConnectionIds,
  activeProjectId,
  postgresDatabaseRefreshVersion,
  currentSchema,
  expandedObjectGroupKeys,
  expandedSchemaKeys,
}: ExplorerSourceContextOptions) {
  const routineSourceMetadataVersionRef = useRef(metadataVersion);

  const databaseExplorerSettings = useSettingsStore(
    (store) => store.settings.databaseExplorer,
  );

  const tableTabReuseMode = useSettingsStore(
    (store) => store.settings.dataGrid.tableTabReuseMode,
  );

  const shouldAutoIntrospect =
    databaseExplorerSettings.refreshMode === "cache-first";

  const shouldLimitVisibleSchemas =
    databaseExplorerSettings.showOnlySelectedSchemas;

  const explorerActivationMode = databaseExplorerSettings.activationMode;

  const showExplorerHoverTooltips = databaseExplorerSettings.showHoverTooltips;

  const allowExplorerHorizontalScroll =
    databaseExplorerSettings.allowHorizontalScroll;

  const activeConnection = connections.find((c) => c.id === activeConnectionId);

  const isActiveConnectionReady = Boolean(
    activeConnectionId && connectedConnectionIds.includes(activeConnectionId),
  );

  const activeDriver = activeConnection?.driver || DEFAULT_DATABASE_DRIVER;

  useEffect(() => {
    if (routineSourceMetadataVersionRef.current === metadataVersion) return;
    routineSourceMetadataVersionRef.current = metadataVersion;
    if (!activeConnectionId || !activeConnection) return;
    invalidateRoutineSourceCache({
      projectId: activeProjectId || "local",
      connectionId: activeConnectionId,
      driver: activeConnection.driver,
      driverPackageVersion: activeConnection.driverPackageVersion,
      connectionDatabaseName: activeConnection.database,
    });
  }, [activeConnection, activeConnectionId, activeProjectId, metadataVersion]);

  const { connectionCapabilities } = useExplorerCapabilities({
    activeDriver,
    activeConnection,
  });

  const activeCapabilities =
    connectionCapabilities &&
    connectionCapabilities.connectionId === activeConnectionId &&
    connectionCapabilities.capabilities.driver === activeDriver
      ? connectionCapabilities.capabilities
      : activeConnection?.origin === "managed" ? managedCapabilitiesFallback(defaultDatabaseCapabilities(activeDriver)) : defaultDatabaseCapabilities(activeDriver);

  const canBrowseDatabaseCatalogs = Boolean(
    activeCapabilities.supportsDatabaseCatalogs,
  );

  const postgresDatabaseDiscovery = usePostgresDatabaseDiscovery({
    projectId: activeProjectId,
    connectionId: activeConnectionId,
    driver: activeConnection?.driver,
    driverPackageVersion: activeConnection?.driverPackageVersion,
    connectionDatabaseName: activeConnection?.database,
    canBrowseDatabaseCatalogs,
    isConnectionReady: isActiveConnectionReady,
    refreshVersion: postgresDatabaseRefreshVersion,
  });

  const canBrowseTables = supportsTableWorkspace(activeCapabilities);

  const canBrowseCollections =
    activeCapabilities.supportsCollectionBrowsing ||
    activeCapabilities.supportsKeyValueBrowsing;

  const isActiveNamespaceExpanded = Boolean(
    activeConnectionId &&
      currentSchema &&
      (activeCapabilities.dataModel === "keyValue"
        ? expandedObjectGroupKeys.includes(
            objectGroupKey(
              activeConnectionId,
              activeDriver,
              currentSchema,
              "objects",
            ),
          )
        : expandedSchemaKeys.includes(
            schemaTreeKey(activeConnectionId, activeDriver, currentSchema),
          )),
  );

  const collectionNamespace = currentSchema || "";

  const collectionNamespaceForTemplate = collectionNamespace || null;

  const collectionPreviewProvider =
    databaseObjectPreviewProvider(activeCapabilities);

  const collectionLabel = collectionPreviewProvider.objectLabel;

  const collectionLabelPlural =
    collectionPreviewProvider.objectPluralLabel ||
    `${collectionPreviewProvider.objectLabel}s`;

  const namespaceLabel = activeCapabilities.namespaceLabel || "database";

  const namespaceLabelPlural = pluralizeNamespaceLabel(namespaceLabel);
  return {
    databaseExplorerSettings,
    tableTabReuseMode,
    shouldAutoIntrospect,
    shouldLimitVisibleSchemas,
    explorerActivationMode,
    showExplorerHoverTooltips,
    allowExplorerHorizontalScroll,
    activeConnection,
    isActiveConnectionReady,
    activeDriver,
    activeCapabilities,
    canBrowseDatabaseCatalogs,
    postgresDatabaseDiscovery,
    canBrowseTables,
    canBrowseCollections,
    isActiveNamespaceExpanded,
    collectionNamespace,
    collectionNamespaceForTemplate,
    collectionLabel,
    collectionLabelPlural,
    namespaceLabel,
    namespaceLabelPlural,
  };
}
