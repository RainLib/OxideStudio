import { EditorPatchPreviewPanel } from "@/components/workspace/EditorPatchPreviewPanel";
import type { TabData } from "@/features/workspace-tabs/model/types";
import {
  lspLanguageIdForCapabilities,
  lspServerDialectForCapabilities,
} from "@/lib/databaseDialect";
import { documentTextRevision } from "@/lib/documentRevision";
import { requestEditorRangeReveal } from "@/lib/editorNavigation";
import type { EditorPatchApplyResult } from "@/lib/editorPatch";
import { applyEditorTextPatch } from "@/lib/editorPatch";
import {
  analyzePatchExplainPlan,
  comparePatchExplainPlans,
  completePatchSqlDocuments,
  reviewRuntimeExplainPlan,
} from "@/lib/explainPlanComparison";
import { queryService, type DatabaseCapabilities } from "@/services/tauri";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import { querySchemaContextForTab } from "@/store/useTabStore";

interface QueryEditorPatchReviewProps {
  activeTab: TabData;
  capabilities: DatabaseCapabilities;
  driver: DatabaseDriver;
  effectiveConnectionId: string | null;
  connectedConnectionIds: string[];
  currentSchema: string | null;
  dismissEditorPatch: (tabId: string, patchId?: string | undefined) => void;
  applyEditorPatchPreview: (
    tabId: string,
    patchId: string,
  ) => EditorPatchApplyResult;
}

export function QueryEditorPatchReview({
  activeTab,
  capabilities,
  driver,
  effectiveConnectionId,
  connectedConnectionIds,
  currentSchema,
  dismissEditorPatch,
  applyEditorPatchPreview,
}: QueryEditorPatchReviewProps) {
  if (!activeTab.editorPatchPreview) return null;
  return (
    <EditorPatchPreviewPanel
      key={activeTab.editorPatchPreview.id}
      patch={activeTab.editorPatchPreview}
      stale={
        documentTextRevision(activeTab.fileRevision, activeTab.sql) !==
        activeTab.editorPatchPreview.expectedRevision
      }
      onValidate={
        capabilities.supportsSqlQuery
          ? async () => {
              const patch = activeTab.editorPatchPreview!;
              const virtualDocument = applyEditorTextPatch(
                activeTab.sql,
                patch.range,
                patch.originalText,
                patch.replacement,
              );
              if (virtualDocument.status !== "success") {
                throw new Error(virtualDocument.message);
              }
              return queryService.validateSqlSyntax(
                driver,
                virtualDocument.text,
                lspLanguageIdForCapabilities(capabilities),
                lspServerDialectForCapabilities(capabilities),
              );
            }
          : undefined
      }
      onComparePlans={
        capabilities.supportsExplainPlan &&
        effectiveConnectionId &&
        connectedConnectionIds.includes(effectiveConnectionId)
          ? (signal) => {
              const patch = activeTab.editorPatchPreview!;
              const documents = completePatchSqlDocuments(activeTab.sql, patch);
              const schemaContext = querySchemaContextForTab(
                activeTab,
                currentSchema,
                driver,
              );
              return comparePatchExplainPlans({
                connectionId: effectiveConnectionId,
                beforeSql: documents.beforeSql,
                afterSql: documents.afterSql,
                schema: activeTab.databaseName
                  ? undefined
                  : schemaContext || undefined,
                database: activeTab.databaseName || undefined,
                signal,
                explainQuery: queryService.explainQuery,
                cancelQuery: queryService.cancelQuery,
              });
            }
          : undefined
      }
      onAnalyzeAfterPlan={
        capabilities.supportsExplainPlan &&
        effectiveConnectionId &&
        connectedConnectionIds.includes(effectiveConnectionId)
          ? async (signal) => {
              const patch = activeTab.editorPatchPreview!;
              const documents = completePatchSqlDocuments(activeTab.sql, patch);
              const schemaContext = querySchemaContextForTab(
                activeTab,
                currentSchema,
                driver,
              );
              const plan = await analyzePatchExplainPlan({
                connectionId: effectiveConnectionId,
                sql: documents.afterSql,
                schema: activeTab.databaseName
                  ? undefined
                  : schemaContext || undefined,
                database: activeTab.databaseName || undefined,
                signal,
                explainQuery: queryService.explainQuery,
                cancelQuery: queryService.cancelQuery,
              });
              return reviewRuntimeExplainPlan(plan);
            }
          : undefined
      }
      onDismiss={() =>
        dismissEditorPatch(activeTab.id, activeTab.editorPatchPreview!.id)
      }
      onApply={() => {
        const result = applyEditorPatchPreview(
          activeTab.id,
          activeTab.editorPatchPreview!.id,
        );
        if (result.status === "success") {
          window.requestAnimationFrame(() =>
            requestEditorRangeReveal({
              tabId: activeTab.id,
              range: result.appliedRange,
              focus: true,
            }),
          );
        }
        return result;
      }}
    />
  );
}
