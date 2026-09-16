import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useAssistantChangeStore } from "@/store/useAssistantChangeStore";
import { useAssistantCliSetupStore } from "@/store/useAssistantCliSetupStore";
import { useAssistantComposerStore } from "@/store/useAssistantComposerStore";
import {
  isManagedConnection,
  useConnectionStore,
} from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { useShallow } from "zustand/react/shallow";

/**
 * Owns global workspace-store selection for the Assistant panel. Session,
 * composer, and provider lifecycle code receive this projected state instead
 * of creating their own cross-store dependencies.
 */
export function useAssistantSidebarWorkspaceState() {
  const setToolWindowVisible = useWorkbenchLayoutStore(
    (state) => state.setToolWindowVisible,
  );
  const aiEnabled = useAiSettingsStore((state) => state.enabled);
  const aiProvider = useAiSettingsStore((state) => state.provider);
  const aiBaseUrl = useAiSettingsStore((state) => state.baseUrl);
  const aiModel = useAiSettingsStore((state) => state.model);
  const aiApiKey = useAiSettingsStore((state) => state.apiKey);
  const codexCliPath = useAiSettingsStore((state) => state.codexCliPath);
  const codexCliModel = useAiSettingsStore((state) => state.codexCliModel);
  const codexCliReasoningEffort = useAiSettingsStore(
    (state) => state.codexCliReasoningEffort,
  );
  const codexCliReasoningEffortByModel = useAiSettingsStore(
    (state) => state.codexCliReasoningEffortByModel,
  );
  const codexCliServiceTier = useAiSettingsStore(
    (state) => state.codexCliServiceTier,
  );
  const codexCliAccessMode = useAiSettingsStore(
    (state) => state.codexCliAccessMode,
  );
  const codeBuddyCliPath = useAiSettingsStore(
    (state) => state.codeBuddyCliPath,
  );
  const codeBuddyCliModel = useAiSettingsStore(
    (state) => state.codeBuddyCliModel,
  );
  const codeBuddyCliReasoningEffort = useAiSettingsStore(
    (state) => state.codeBuddyCliReasoningEffort,
  );
  const codeBuddyCliReasoningEffortByModel = useAiSettingsStore(
    (state) => state.codeBuddyCliReasoningEffortByModel,
  );
  const codexCliEnvironmentKeys = useAiSettingsStore(
    (state) => state.codexCliEnvironmentKeys,
  );
  const codeBuddyCliEnvironmentKeys = useAiSettingsStore(
    (state) => state.codeBuddyCliEnvironmentKeys,
  );
  const assistantProviderConfig = useAiSettingsStore(
    (state) => state.assistantProviderConfig,
  );
  const aiStreaming = useAiSettingsStore((state) => state.streaming);
  const aiToolCalling = useAiSettingsStore((state) => state.toolCalling);
  const aiStructuredOutput = useAiSettingsStore(
    (state) => state.structuredOutput,
  );
  const aiMaxInputTokens = useAiSettingsStore((state) => state.maxInputTokens);
  const aiMaxOutputTokens = useAiSettingsStore(
    (state) => state.maxOutputTokens,
  );
  const oxideAssistantMode = useAiSettingsStore((state) => state.assistantMode);
  const codexAssistantMode = useAiSettingsStore(
    (state) => state.codexCliAssistantMode,
  );
  const codeBuddyAssistantMode = useAiSettingsStore(
    (state) => state.codeBuddyCliAssistantMode,
  );
  const updateAiSettings = useAiSettingsStore((state) => state.updateSettings);
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setProjectTurns = useAssistantChangeStore(
    (state) => state.setProjectTurns,
  );
  const activeProjectRoot = useProjectStore(
    (state) =>
      state.projects.find((project) => project.id === state.activeProjectId)
        ?.root_path ?? null,
  );
  const activeConnectionId = useConnectionStore((state) => {
    const connection = state.connections.find(
      (candidate) => candidate.id === state.activeConnectionId,
    );
    return connection && !isManagedConnection(connection)
      ? connection.id
      : null;
  });
  const activeDriver = useConnectionStore((state) =>
    (() => {
      const connection = state.connections.find(
        (connection) => connection.id === state.activeConnectionId,
      );
      return connection && !isManagedConnection(connection)
        ? connection.driver
        : null;
    })(),
  );
  const activeConnectionDatabase = useConnectionStore((state) =>
    (() => {
      const connection = state.connections.find(
        (connection) => connection.id === state.activeConnectionId,
      );
      return connection && !isManagedConnection(connection)
        ? (connection.database ?? null)
        : null;
    })(),
  );
  const activeNamespace = useSchemaStore((state) => state.currentSchema);
  const assistantSchemaOptions = useSchemaStore((state) => state.schemas);
  const loadSchemas = useSchemaStore((state) => state.loadSchemas);
  const activeTab = useTabStore(
    useShallow((state) => {
      const tab = state.tabs.find(
        (candidate) => candidate.id === state.activeTabId,
      );
      return tab
        ? {
            title: tab.title,
            databaseName: tab.databaseName,
            editorSelection: tab.editorSelection,
          }
        : null;
    }),
  );
  const composeRequest = useAssistantComposerStore((state) => state.request);
  const consumeComposeRequest = useAssistantComposerStore(
    (state) => state.consumeRequest,
  );
  const cliSetupByProvider = useAssistantCliSetupStore(
    (state) => state.setupByProvider,
  );
  const cliDetectionRevisionByProvider = useAssistantCliSetupStore(
    (state) => state.detectionRevisionByProvider,
  );
  const cliProbeIdentityByProvider = useAssistantCliSetupStore(
    (state) => state.probeIdentityByProvider,
  );
  const updateCliSetup = useAssistantCliSetupStore(
    (state) => state.updateSetup,
  );
  const requestCliDetection = useAssistantCliSetupStore(
    (state) => state.requestDetection,
  );
  const completeCliProbe = useAssistantCliSetupStore(
    (state) => state.completeProbe,
  );

  return {
    setToolWindowVisible,
    aiEnabled,
    aiProvider,
    aiBaseUrl,
    aiModel,
    aiApiKey,
    codexCliPath,
    codexCliModel,
    codexCliReasoningEffort,
    codexCliReasoningEffortByModel,
    codexCliServiceTier,
    codexCliAccessMode,
    codeBuddyCliPath,
    codeBuddyCliModel,
    codeBuddyCliReasoningEffort,
    codeBuddyCliReasoningEffortByModel,
    codexCliEnvironmentKeys,
    codeBuddyCliEnvironmentKeys,
    assistantProviderConfig,
    aiStreaming,
    aiToolCalling,
    aiStructuredOutput,
    aiMaxInputTokens,
    aiMaxOutputTokens,
    oxideAssistantMode,
    codexAssistantMode,
    codeBuddyAssistantMode,
    updateAiSettings,
    activeProjectId,
    setProjectTurns,
    activeProjectRoot,
    activeConnectionId,
    activeDriver,
    activeConnectionDatabase,
    activeNamespace,
    assistantSchemaOptions,
    loadSchemas,
    activeTab,
    composeRequest,
    consumeComposeRequest,
    cliSetupByProvider,
    cliDetectionRevisionByProvider,
    cliProbeIdentityByProvider,
    updateCliSetup,
    requestCliDetection,
    completeCliProbe,
  };
}
