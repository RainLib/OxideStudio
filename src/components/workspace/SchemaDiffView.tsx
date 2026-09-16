import { useSchemaMigrationSession } from "@/features/schema-diff/hooks/useSchemaMigrationSession";
import { createMigrationExecutionActions } from "@/features/schema-diff/model/createMigrationExecutionActions";
import { createMigrationNavigationActions } from "@/features/schema-diff/model/createMigrationNavigationActions";
import { createMigrationPreviewActions } from "@/features/schema-diff/model/createMigrationPreviewActions";
import { resolveMigrationReview } from "@/features/schema-diff/model/resolveMigrationReview";
import { SchemaMigrationConfirmation } from "@/features/schema-diff/ui/SchemaMigrationConfirmation";
import { SchemaMigrationHeader } from "@/features/schema-diff/ui/SchemaMigrationHeader";
import { SchemaMigrationPreview } from "@/features/schema-diff/ui/SchemaMigrationPreview";
import { SchemaMigrationRail } from "@/features/schema-diff/ui/SchemaMigrationRail";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { AlertTriangle, ShieldAlert } from "lucide-react";

export function SchemaDiffView() {
  const {
    tabs,
    activeTabId,
    createTab,
    openSchemaDiffTab,
    selectSchemaDiffChange,
  } = useTabStore();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setActiveConnection = useConnectionStore(
    (state) => state.setActiveConnection,
  );
  const setActiveToolWindow = useWorkbenchLayoutStore(
    (state) => state.setActiveToolWindow,
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const plan = activeTab?.schemaDiffPlan;
  const source = activeTab?.schemaDiffSource;
  const target = activeTab?.schemaDiffTarget;
  const {
    copied,
    setCopied,
    previewSurface,
    setPreviewSurface,
    confirmationOpen,
    setConfirmationOpen,
    confirmationTarget,
    setConfirmationTarget,
    allowReview,
    setAllowReview,
    allowDestructive,
    setAllowDestructive,
    allowNonTransactional,
    setAllowNonTransactional,
    isApplying,
    setIsApplying,
    isRecapturing,
    setIsRecapturing,
    execution,
    setExecution,
    executionError,
    setExecutionError,
    recentExecutions,
    setRecentExecutions,
    previewSql,
    sqlLines,
  } = useSchemaMigrationSession({
    plan,
    activeProjectId,
  });

  if (
    !activeTab ||
    activeTab.type !== "schema_diff" ||
    !plan ||
    !source ||
    !target
  ) {
    return null;
  }

  const {
    selectedChange,
    descriptorOnlyObjectChanges,
    catalogBackedObjectChanges,
    requiresReview,
    reviewChangeCount,
    requiresDestructive,
    destructiveChangeCount,
    conversionIssues,
    executionOwner,
    normalizedPlanDriver,
    isTargetOwnedPlan,
    isSqliteRebuildPlan,
    isNonTransactionalPlan,
    isOfflineSource,
    offlineSourceLabel,
    supportsSafeApply,
  } = resolveMigrationReview({
    plan,
    activeTab,
    source,
  });

  const currentJournal = execution || recentExecutions[0] || null;
  const requiredConfirmationTarget = [
    target.connectionName,
    plan.targetDatabaseName || null,
    plan.targetSchemaName,
  ]
    .filter(Boolean)
    .join(" / ");
  const confirmationReady =
    confirmationTarget.trim() === requiredConfirmationTarget &&
    (!requiresReview || allowReview) &&
    (!requiresDestructive || allowDestructive) &&
    (!isNonTransactionalPlan || allowNonTransactional);

  const { copySql, openInConsole } = createMigrationPreviewActions({
    previewSql,
    setCopied,
    previewSurface,
    isOfflineSource,
    isTargetOwnedPlan,
    isSqliteRebuildPlan,
    createTab,
    plan,
    setActiveToolWindow,
  });

  const { applyMigration, recaptureInterruptedMigration } =
    createMigrationExecutionActions({
      confirmationReady,
      supportsSafeApply,
      isApplying,
      setIsApplying,
      setExecutionError,
      setActiveConnection,
      plan,
      source,
      target,
      confirmationTarget,
      allowReview,
      allowDestructive,
      allowNonTransactional,
      setExecution,
      setRecentExecutions,
      setConfirmationOpen,
      setPreviewSurface,
      isRecapturing,
      setIsRecapturing,
      openSchemaDiffTab,
    });

  const { revealChange } = createMigrationNavigationActions({
    selectSchemaDiffChange,
    activeTab,
    setActiveToolWindow,
    setActiveConnection,
    plan,
    activeProjectId,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-editor))] text-[hsl(var(--wb-text))]">
      <SchemaMigrationHeader
        target={target}
        plan={plan}
        source={source}
        copySql={copySql}
        previewSql={previewSql}
        previewSurface={previewSurface}
        copied={copied}
        openInConsole={openInConsole}
        isOfflineSource={isOfflineSource}
        offlineSourceLabel={offlineSourceLabel}
        isTargetOwnedPlan={isTargetOwnedPlan}
        isSqliteRebuildPlan={isSqliteRebuildPlan}
        setExecutionError={setExecutionError}
        setConfirmationOpen={setConfirmationOpen}
        isApplying={isApplying}
        supportsSafeApply={supportsSafeApply}
        executionOwner={executionOwner}
        isNonTransactionalPlan={isNonTransactionalPlan}
        currentJournal={currentJournal}
        recaptureInterruptedMigration={recaptureInterruptedMigration}
        isRecapturing={isRecapturing}
      />

      {isOfflineSource && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-400/20 bg-amber-400/[0.045] px-4 py-2 text-[9px] text-amber-100/90">
          <AlertTriangle size={12} className="shrink-0 text-amber-300" />
          {offlineSourceLabel} baselines can be compared and reviewed, but
          cannot be applied. Capture a live baseline before creating an
          executable migration.
        </div>
      )}

      {descriptorOnlyObjectChanges.length > 0 && (
        <div
          className="flex shrink-0 items-start gap-2 border-b border-sky-400/20 bg-sky-400/[0.045] px-4 py-2 text-[9px] leading-4 text-sky-100/90"
          data-schema-object-review-summary
        >
          <ShieldAlert size={12} className="mt-0.5 shrink-0 text-sky-300" />
          <span>
            {descriptorOnlyObjectChanges.length} schema object change
            {descriptorOnlyObjectChanges.length === 1 ? " is" : "s are"}{" "}
            descriptor-only. Source DDL is not captured, so these objects are
            excluded from generated migration SQL and must be reviewed and
            applied manually.
          </span>
        </div>
      )}

      {catalogBackedObjectChanges.length > 0 && (
        <div
          className="flex shrink-0 items-start gap-2 border-b border-violet-400/20 bg-violet-400/[0.045] px-4 py-2 text-[9px] leading-4 text-violet-100/90"
          data-schema-object-catalog-ddl-summary
        >
          <ShieldAlert size={12} className="mt-0.5 shrink-0 text-violet-300" />
          <span>
            {catalogBackedObjectChanges.length} catalog-backed routine, trigger,
            event, or sequence change
            {catalogBackedObjectChanges.length === 1 ? " has" : "s have"} DDL in
            this preview. It remains review-gated and is applied only after
            target confirmation; delete operations are never generated
            automatically.
          </span>
        </div>
      )}

      {confirmationOpen && (
        <SchemaMigrationConfirmation
          isTargetOwnedPlan={isTargetOwnedPlan}
          isNonTransactionalPlan={isNonTransactionalPlan}
          plan={plan}
          setConfirmationOpen={setConfirmationOpen}
          requiredConfirmationTarget={requiredConfirmationTarget}
          confirmationTarget={confirmationTarget}
          setConfirmationTarget={setConfirmationTarget}
          isApplying={isApplying}
          requiresReview={requiresReview}
          allowReview={allowReview}
          setAllowReview={setAllowReview}
          reviewChangeCount={reviewChangeCount}
          requiresDestructive={requiresDestructive}
          allowDestructive={allowDestructive}
          setAllowDestructive={setAllowDestructive}
          destructiveChangeCount={destructiveChangeCount}
          allowNonTransactional={allowNonTransactional}
          setAllowNonTransactional={setAllowNonTransactional}
          confirmationReady={confirmationReady}
          applyMigration={applyMigration}
          executionError={executionError}
        />
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[330px_minmax(0,1fr)]">
        <SchemaMigrationRail
          plan={plan}
          selectedChange={selectedChange}
          revealChange={revealChange}
        />

        <SchemaMigrationPreview
          normalizedPlanDriver={normalizedPlanDriver}
          previewSurface={previewSurface}
          setPreviewSurface={setPreviewSurface}
          plan={plan}
          currentJournal={currentJournal}
          isTargetOwnedPlan={isTargetOwnedPlan}
          conversionIssues={conversionIssues}
          selectedChange={selectedChange}
          recentExecutions={recentExecutions}
          setExecution={setExecution}
          sqlLines={sqlLines}
        />
      </div>
    </div>
  );
}
