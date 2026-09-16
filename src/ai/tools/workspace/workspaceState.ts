import type {
  AiToolAdapters,
  AiWorkspaceSelection,
  AiWorkspaceTabSummary,
} from "@/ai/tools/types";
import { proposeEditorPatch } from "@/ai/tools/workspace/editorPatch";
import { boundedAiExplainPlanSummary } from "@/ai/tools/workspace/explainPlanSummary";
import type { ExplainPlan } from "@/services/tauri/types";
import { useTabStore } from "@/store/useTabStore";

function workspaceSelectionFromTab(tab: {
  id: string;
  title: string;
  connectionId?: string | null;
  databaseName?: string | null;
  editorSelection?: {
    text: string;
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}): AiWorkspaceSelection | null {
  if (!tab.editorSelection?.text.trim()) return null;
  return {
    tabId: tab.id,
    tabTitle: tab.title,
    text: tab.editorSelection.text,
    startLineNumber: tab.editorSelection.startLineNumber,
    startColumn: tab.editorSelection.startColumn,
    endLineNumber: tab.editorSelection.endLineNumber,
    endColumn: tab.editorSelection.endColumn,
    connectionId: tab.connectionId ?? null,
    databaseName: tab.databaseName ?? null,
  };
}

export function workspaceTabSummaryFromTab(tab: {
  id: string;
  type: string;
  title: string;
  sql?: string;
  connectionId?: string | null;
  databaseName?: string | null;
  targetSchema?: string | null;
  schemaName?: string | null;
  tableName?: string | null;
  objectType?: string | null;
  fileProjectId?: string | null;
  fileRelativePath?: string | null;
  results?: unknown[] | null;
  activeResultIndex?: number;
  queryError?:
    | import("@/lib/queryErrorPresentation").QueryExecutionErrorDetail
    | null;
  explainPlan?: ExplainPlan | null;
  schemaDiffPlan?: {
    id: string;
    summary: {
      total: number;
      safe: number;
      review: number;
      destructive: number;
      blocked: number;
    };
    changes: Array<{
      id: string;
      summary: string;
      risk: string;
      relationName: string;
      childName?: string | null;
      phase: string;
      order: number;
      blockedReason?: string | null;
    }>;
    preflightChecks: Array<unknown>;
  };
  selectedSchemaChangeId?: string | null;
  editorSelection?: {
    text: string;
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}): AiWorkspaceTabSummary {
  return {
    id: tab.id,
    type: tab.type,
    title: tab.title,
    sql: tab.sql,
    connectionId: tab.connectionId ?? null,
    databaseName: tab.databaseName ?? null,
    targetSchema: tab.targetSchema ?? null,
    schemaName: tab.schemaName ?? null,
    tableName: tab.tableName ?? null,
    objectType: tab.objectType ?? null,
    fileProjectId: tab.fileProjectId ?? null,
    fileRelativePath: tab.fileRelativePath ?? null,
    resultSetCount: tab.results?.length ?? 0,
    activeResultIndex: tab.activeResultIndex ?? 0,
    queryError: tab.queryError ?? null,
    explainPlan: tab.explainPlan
      ? boundedAiExplainPlanSummary(tab.explainPlan)
      : null,
    schemaDiffId: tab.schemaDiffPlan?.id ?? null,
    schemaDiffSummary: tab.schemaDiffPlan?.summary ?? null,
    schemaPreflightCheckCount: tab.schemaDiffPlan?.preflightChecks.length ?? 0,
    selectedSchemaChange:
      tab.schemaDiffPlan?.changes.find(
        (change) => change.id === tab.selectedSchemaChangeId,
      ) ?? null,
    selection: workspaceSelectionFromTab(tab),
  };
}

export function createWorkspaceStateAdapters(): Pick<
  AiToolAdapters,
  "getActiveTab" | "getWorkspaceSelection" | "proposeEditorPatch"
> {
  return {
    getActiveTab: () => {
      const tabState = useTabStore.getState();
      const activeTab = tabState.tabs.find(
        (tab) => tab.id === tabState.activeTabId,
      );
      return activeTab ? workspaceTabSummaryFromTab(activeTab) : null;
    },

    getWorkspaceSelection: () => {
      const tabState = useTabStore.getState();
      const activeTab = tabState.tabs.find(
        (tab) => tab.id === tabState.activeTabId,
      );
      return activeTab ? workspaceSelectionFromTab(activeTab) : null;
    },

    proposeEditorPatch: (input) => proposeEditorPatch(input),
  };
}
