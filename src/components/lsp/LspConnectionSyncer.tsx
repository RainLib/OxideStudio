import { useDebouncedLspTabSnapshot } from "@/features/lsp-sync/hooks/useDebouncedLspTabSnapshot";
import {useConnectionSemanticEvents} from "@/features/lsp-sync/hooks/useConnectionSemanticEvents";
import { useLspCapabilityContext } from "@/features/lsp-sync/hooks/useLspCapabilityContext";
import { useLspSchemaSync } from "@/features/lsp-sync/hooks/useLspSchemaSync";
import { useLspClient } from "@/hooks/useLspClient";
import { supportsLspCapabilities } from "@/lib/databaseDialect";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useLspSemanticStatusStore } from "@/store/useLspSemanticStatusStore";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { useMemo } from "react";

export function LspConnectionSyncer() {
  // A package activation can add a new LSP dialect/capability at runtime.
  // Subscribe so the normal sync effect publishes a fresh configuration.
  const driverCatalogStatus = useDatabaseDriverCatalogStore(
    (state) => state.status,
  );
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const connections = useConnectionStore((state) => state.connections);
  const activeConnectionRuntime = useConnectionStore((state) =>
    activeConnectionId ? state.connectionRuntimeStates[activeConnectionId] : undefined,
  );
  const schemas = useSchemaStore((state) => state.schemas);
  const executionObservation=useConnectionSemanticEvents(activeConnectionId,activeConnectionRuntime);
  const tables = useSchemaStore((state) => state.tables);
  const currentSchema = useSchemaStore((state) => state.currentSchema);
  const metadataVersion = useSchemaStore((state) => state.metadataVersion);
  const tabs = useDebouncedLspTabSnapshot();
  const activeTabId = useTabStore((state) => state.activeTabId);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProjectRoot = useProjectStore(
    (state) =>
      state.projects.find((project) => project.id === state.activeProjectId)
        ?.root_path || null,
  );
  const projectDocuments = useProjectFilesStore((state) => state.documents);
  const projectFileOperations = useProjectFilesStore(
    (state) => state.pendingOperations,
  );
  const projectDocumentRevisionKey = useMemo(
    () =>
      `${projectFileOperations}:${Object.entries(projectDocuments)
        .map(([path, document]) => `${path}:${document.revision}`)
        .sort()
        .join("|")}`,
    [projectDocuments, projectFileOperations],
  );
  const keywordCase = useSettingsStore(
    (state) => state.settings.editor.sqlFormatting.keywordCase,
  );
  const functionCase = useSettingsStore(
    (state) => state.settings.editor.sqlFormatting.functionCase,
  );
  const tableAlias = useSettingsStore(
    (state) => state.settings.editor.sqlCompletion.tableAlias,
  );
  const completionPreferences = {
    keywordCase,
    functionCase,
    tableAlias,
  } as const;
  const logicalOperatorNewline = useSettingsStore(
    (state) => state.settings.editor.sqlFormatting.logicalOperatorNewline,
  );
  const fromClauseLayout = useSettingsStore(
    (state) => state.settings.editor.sqlFormatting.fromClauseLayout,
  );
  const formattingPreferences = {
    keywordCase,
    functionCase,
    logicalOperatorNewline,
    fromClauseLayout,
  } as const;
  const setSemanticStatus = useLspSemanticStatusStore(
    (state) => state.setStatus,
  );
  const clearSemanticStatus = useLspSemanticStatusStore(
    (state) => state.clearStatus,
  );
  const recordSemanticTelemetry = useLspSemanticStatusStore(
    (state) => state.recordTelemetry,
  );
  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const { resolvedCapabilityContext, lspCapabilities } =
    useLspCapabilityContext({
      activeConnection,
      activeConnectionRuntime,
      semanticSession:executionObservation?.state?.session,
      driverCatalogStatus,
    });

  const supportsMetadataSync = Boolean(activeConnection);
  const hasConnectionLspTab = tabs.some(
    (tab) =>
      (tab.type === "query" || tab.type === "table") &&
      (tab.connectionId || activeConnectionId) === activeConnectionId,
  );
  const { isReady, client: lspClient } = useLspClient({
    connectionId: activeConnectionId,
    driver: activeConnection?.driver,
    enabled: Boolean(
      activeConnectionId &&
        activeConnection &&
        supportsMetadataSync &&
        hasConnectionLspTab &&
        supportsLspCapabilities(lspCapabilities),
    ),
    capabilities: lspCapabilities,
  });

  // Track if we've already sent config for this connection+schema
  useLspSchemaSync({
    executionObservation,
    activeConnectionId,
    metadataVersion,
    isReady,
    activeConnection,
    activeConnectionRuntime,
    activeProjectRoot,
    hasConnectionLspTab,
    lspCapabilities,
    supportsMetadataSync,
    clearSemanticStatus,
    resolvedCapabilityContext,
    setSemanticStatus,
    schemas,
    currentSchema,
    activeTabId,
    tabs,
    activeProjectId,
    lspClient,
    completionPreferences,
    formattingPreferences,
    recordSemanticTelemetry,
    connections,
    tables,
    keywordCase,
    functionCase,
    tableAlias,
    logicalOperatorNewline,
    fromClauseLayout,
    driverCatalogStatus,
    projectDocumentRevisionKey,
  });

  return null;
}
