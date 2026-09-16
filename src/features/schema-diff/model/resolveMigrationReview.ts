import { isChartDbMetadataSnapshot } from "@/features/schema-diff/model/chartDbMetadataImport";
import { isProjectDdlSnapshot } from "@/features/schema-diff/model/projectDdlSnapshot";
import {
  isCatalogBackedObjectChange,
  isDescriptorOnlySchemaObjectChange,
} from "@/features/schema-diff/model/schemaChangePolicy";
import { isSchemaDbmlSnapshot } from "@/features/schema-diff/model/schemaDbmlImport";
import { isSchemaDiagramDraftSnapshot } from "@/features/schema-diff/model/schemaDiagramDraft";
import type { TabData } from "@/features/workspace-tabs/model/types";
import { normalizeDatabaseDriverName } from "@/lib/databaseDialect";
import type {
  SchemaDiffPlan,
  SchemaSnapshot,
} from "@/services/tauri/types/schemaDiff";

interface ResolveMigrationReviewContext {
  plan: SchemaDiffPlan;
  activeTab: Pick<TabData, "selectedSchemaChangeId">;
  source: SchemaSnapshot;
}

export function resolveMigrationReview({
  plan,
  activeTab,
  source,
}: ResolveMigrationReviewContext) {
  const selectedChange = plan.changes.find(
    (change) => change.id === activeTab.selectedSchemaChangeId,
  );
  const descriptorOnlyObjectChanges = plan.changes.filter(
    isDescriptorOnlySchemaObjectChange,
  );
  const catalogBackedObjectChanges = plan.changes.filter(
    isCatalogBackedObjectChange,
  );
  const requiresReview =
    plan.requiresReviewApproval ??
    plan.changes.some(
      (change) => change.manualReview || change.risk === "review",
    );
  const reviewChangeCount = Math.max(
    plan.summary.review,
    plan.changes.filter(
      (change) => change.manualReview || change.risk === "review",
    ).length,
  );
  const requiresDestructive =
    plan.requiresDestructiveApproval ??
    plan.changes.some(
      (change) => change.risk === "destructive" || !change.reversible,
    );
  const destructiveChangeCount = Math.max(
    plan.summary.destructive,
    plan.changes.filter(
      (change) => change.risk === "destructive" || !change.reversible,
    ).length,
  );
  const conversionIssues = plan.conversionIssues || [];
  // The backend resolves aliases (for example `mariadb`) through the dialect
  // registry before it executes a migration. Mirror that decision here so the
  // confirmation surface cannot hide a reviewed, executable family plan.
  const normalizedPlanDriver = normalizeDatabaseDriverName(plan.driver);
  const executionOwner = plan.executionOwner || "hostSql";
  const isTargetOwnedPlan = executionOwner === "externalDriver";
  const isSqliteRebuildPlan =
    executionOwner === "hostSql" &&
    normalizedPlanDriver === "sqlite" &&
    plan.transactional;
  const isNonTransactionalPlan =
    !plan.transactional &&
    (isTargetOwnedPlan || normalizedPlanDriver === "mysql");
  const isOfflineProjectDdlSource = isProjectDdlSnapshot(source);
  const isOfflineDbmlSource = isSchemaDbmlSnapshot(source);
  const isOfflineMetadataSource = isChartDbMetadataSnapshot(source);
  const isOfflineDiagramDraftSource = isSchemaDiagramDraftSnapshot(source);
  const isOfflineSource =
    isOfflineProjectDdlSource ||
    isOfflineDbmlSource ||
    isOfflineMetadataSource ||
    isOfflineDiagramDraftSource;
  const offlineSourceLabel = isOfflineDiagramDraftSource
    ? "Diagram draft"
    : isOfflineDbmlSource
      ? "DBML"
      : isOfflineMetadataSource
        ? "Metadata JSON"
        : "Project DDL";
  const supportsSafeApply =
    !isOfflineSource &&
    executionOwner !== "reviewOnly" &&
    (isTargetOwnedPlan ||
      (executionOwner === "hostSql" &&
        ((normalizedPlanDriver === "postgres" && plan.transactional) ||
          isSqliteRebuildPlan ||
          isNonTransactionalPlan)));

  return {
    normalizedPlanDriver,
    selectedChange,
    descriptorOnlyObjectChanges,
    catalogBackedObjectChanges,
    requiresReview,
    reviewChangeCount,
    requiresDestructive,
    destructiveChangeCount,
    conversionIssues,
    executionOwner,
    isTargetOwnedPlan,
    isSqliteRebuildPlan,
    isNonTransactionalPlan,
    isOfflineSource,
    offlineSourceLabel,
    supportsSafeApply,
  };
}
