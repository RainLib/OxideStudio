import type { WorkbenchToolWindowId } from "@/features/settings/model/settingsTypes";
import type { TabData, TabType } from "@/features/workspace-tabs/model/types";
import type { SchemaDiffPlan } from "@/services/tauri/types/schemaDiff";

interface CreateMigrationPreviewActionsContext {
  previewSql: string;
  setCopied: React.Dispatch<React.SetStateAction<boolean>>;
  previewSurface: "migration" | "preflight" | "rollback" | "run";
  isOfflineSource: boolean;
  isTargetOwnedPlan: boolean;
  isSqliteRebuildPlan: boolean;
  createTab: (
    type?: TabType | undefined,
    title?: string | undefined,
    initialSql?: string | undefined,
    metadata?:
      | Partial<
          Pick<
            TabData,
            | "connectionId"
            | "databaseName"
            | "tableName"
            | "schemaName"
            | "objectType"
            | "queryLanguage"
            | "elasticsearchVariables"
            | "filters"
            | "fileProjectId"
            | "savedSqlProjectId"
            | "savedSqlFileId"
            | "fileRootPath"
            | "fileRelativePath"
            | "fileRevision"
            | "filePreview"
            | "isDirty"
            | "targetSchema"
            | "agentFileDiffPreview"
            | "gitFileDiffPreview"
          >
        >
      | undefined,
  ) => string;
  plan: SchemaDiffPlan;
  setActiveToolWindow: (id: WorkbenchToolWindowId | "editor") => void;
}

export function createMigrationPreviewActions({
  previewSql,
  setCopied,
  previewSurface,
  isOfflineSource,
  isTargetOwnedPlan,
  isSqliteRebuildPlan,
  createTab,
  plan,
  setActiveToolWindow,
}: CreateMigrationPreviewActionsContext) {
  const copySql = async () => {
    if (!previewSql) return;
    await navigator.clipboard.writeText(previewSql);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const openInConsole = () => {
    if (
      !previewSql ||
      previewSurface === "run" ||
      isOfflineSource ||
      isTargetOwnedPlan ||
      isSqliteRebuildPlan
    )
      return;
    const surfaceName =
      previewSurface === "migration"
        ? "migration"
        : previewSurface === "preflight"
          ? "preflight"
          : "rollback";
    createTab(
      "query",
      `${surfaceName} [${plan.targetSchemaName}]`,
      previewSql,
      {
        connectionId: plan.targetConnectionId,
        databaseName: plan.targetDatabaseName || undefined,
        schemaName: plan.targetSchemaName,
      },
    );
    setActiveToolWindow("editor");
  };

  return { copySql, openInConsole };
}
