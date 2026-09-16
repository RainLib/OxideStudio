import { useEditorDiagnostics } from "@/features/query-editor/hooks/useEditorDiagnostics";
import { useInlineCompletionProvider } from "@/features/query-editor/hooks/useInlineCompletionProvider";
import { useLspCoreProviderCoordinator } from "@/features/query-editor/hooks/useLspCoreProviderCoordinator";
import { useLspHoverProviderCoordinator } from "@/features/query-editor/hooks/useLspHoverProviderCoordinator";
import { useMysqlRoutineAnalysis } from "@/features/query-editor/hooks/useMysqlRoutineAnalysis";
import type { ElasticsearchServerVersion } from "@/features/query-languages/elasticsearch/types";
import type { AppSettings } from "@/features/settings/model/settingsTypes";
import type { TabData } from "@/features/workspace-tabs/model/types";
import {
  InlineCompletionCache,
  type InlineCompletionStatus,
} from "@/lib/inlineCompletion";
import type { LspClient } from "@/services/lsp/client";
import type { Diagnostic } from "@/services/lsp/types";
import type {
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types/database";
import type { TableInfo } from "@/services/tauri/types/schemaCatalog";
import { useAiSettingsStore } from "@/store/useAiSettingsStore";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useRef, useState } from "react";

interface EditorLanguageServicesOptions {
  activeProjectId: string;
  canUseLsp: boolean;
  documentUri: string;
  editorLanguageId: string;
  isActivePane: boolean;
  lspClient: LspClient;
  monaco: typeof import("monaco-editor") | null;
  currentSchema: string | null;
  activeTab: TabData | undefined;
  documentLanguageId: string;
  documentTextsRef: React.RefObject<Map<string, string>>;
  documentVersionsRef: React.RefObject<Map<string, number>>;
  driver: DatabaseDriver;
  effectiveConnectionId: string | null;
  mountedEditor: any;
  editorSettings: AppSettings["editor"];
  capabilities: DatabaseCapabilities;
  metadataVersion: number;
  openedDocumentsRef: React.RefObject<Set<string>>;
  schemaTables: TableInfo[];
  isElasticsearchConsole: boolean;
  preferredElasticsearchIndex: string | undefined;
  elasticsearchServerVersion: ElasticsearchServerVersion | undefined;
  lspReady: boolean;
  usageScope: string;
  lspSessionKey: string;
  setLspDiagnostics: (id: string, diagnostics: Diagnostic[]) => void;
}

export function useEditorLanguageServices({
  activeProjectId,
  canUseLsp,
  documentUri,
  editorLanguageId,
  isActivePane,
  lspClient,
  monaco,
  currentSchema,
  activeTab,
  documentLanguageId,
  documentTextsRef,
  documentVersionsRef,
  driver,
  effectiveConnectionId,
  mountedEditor,
  editorSettings,
  capabilities,
  metadataVersion,
  openedDocumentsRef,
  schemaTables,
  isElasticsearchConsole,
  preferredElasticsearchIndex,
  elasticsearchServerVersion,
  lspReady,
  usageScope,
  lspSessionKey,
  setLspDiagnostics,
}: EditorLanguageServicesOptions) {
  const rankByUsage = editorSettings.sqlCompletion.rankByUsage;
  const inlineProviderConfig = useAiSettingsStore(
    (state) => state.inlineProviderConfig,
  );
  const inlineBaseUrl = useAiSettingsStore((state) => state.inlineBaseUrl);
  const inlineApiKey = useAiSettingsStore((state) => state.inlineApiKey);
  const inlineTimeoutMs = useAiSettingsStore((state) => state.inlineTimeoutMs);
  const inlineCompletionProtocol = useAiSettingsStore(
    (state) => state.inlineCompletionProtocol,
  );
  const inlineCompletionModel = useAiSettingsStore(
    (state) => state.inlineCompletionModel,
  );
  const projectId = useProjectFilesStore((state) => state.projectId);
  const projectRootPath = useProjectFilesStore((state) => state.rootPath);
  const [inlineCompletionStatus, setInlineCompletionStatus] =
    useState<InlineCompletionStatus>("off");
  const inlineCompletionCacheRef = useRef(new InlineCompletionCache());
  const inlineCompletionAbortRef = useRef<AbortController | null>(null);
  const inlineCompletionListenersRef = useRef(new Set<() => void>());
  const { mysqlRoutineAnalysisForModel } = useMysqlRoutineAnalysis({
    driver,
  });

  useLspCoreProviderCoordinator({
    activeProjectId,
    canUseLsp,
    documentUri,
    editorLanguageId,
    isActivePane,
    lspClient,
    monaco,
  });

  useLspHoverProviderCoordinator({
    activeProjectId,
    canUseLsp,
    currentSchema,
    databaseName: activeTab?.databaseName,
    documentLanguageId,
    documentUri,
    documentTextsRef,
    documentVersionsRef,
    driver,
    editorLanguageId,
    effectiveConnectionId,
    editor: mountedEditor,
    interactiveTableHover: Boolean(
      mountedEditor &&
        editorSettings.showTableDdlHoverPreview &&
        capabilities.supportsTableBrowsing,
    ),
    isActivePane,
    lspClient,
    metadataRevision: metadataVersion,
    monaco,
    openedDocumentsRef,
    schemaTables,
    showTableDdlHoverPreview: editorSettings.showTableDdlHoverPreview,
    supportsTableBrowsing: capabilities.supportsTableBrowsing,
    targetSchema: activeTab?.targetSchema,
  });

  useInlineCompletionProvider({
    editorSettings,
    isActivePane,
    monaco,
    inlineCompletionAbortRef,
    setInlineCompletionStatus,
    inlineCompletionCacheRef,
    inlineProviderConfig,
    editorLanguageId,
    inlineCompletionListenersRef,
    documentUri,
    mountedEditor,
    isElasticsearchConsole,
    preferredElasticsearchIndex,
    elasticsearchServerVersion,
    driver,
    capabilities,
    lspReady,
    canUseLsp,
    documentLanguageId,
    lspClient,
    openedDocumentsRef,
    documentVersionsRef,
    documentTextsRef,
    usageScope,
    inlineCompletionProtocol,
    inlineCompletionModel,
    activeTab,
    projectId,
    projectRootPath,
    inlineBaseUrl,
    inlineApiKey,
    inlineTimeoutMs,
    rankByUsage,
  });

  useEditorDiagnostics({
    monaco,
    lspReady,
    lspSessionKey,
    documentVersionsRef,
    documentTextsRef,
    mysqlRoutineAnalysisForModel,
    setLspDiagnostics,
    mountedEditor,
    activeTab,
    driver,
  });

  return { inlineCompletionStatus };
}
