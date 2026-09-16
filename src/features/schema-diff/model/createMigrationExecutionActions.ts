import { compareSnapshotToLive } from "@/services/schemaSnapshotStore";
import { schemaService } from "@/services/tauri/schema.service";
import type {
  SchemaDiffPlan,
  SchemaMigrationJournalEntry,
  SchemaSnapshot,
} from "@/services/tauri/types/schemaDiff";

interface CreateMigrationExecutionActionsContext {
  confirmationReady: boolean;
  supportsSafeApply: boolean;
  isApplying: boolean;
  setIsApplying: React.Dispatch<React.SetStateAction<boolean>>;
  setExecutionError: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveConnection: (id: string) => Promise<string | null>;
  plan: SchemaDiffPlan;
  source: SchemaSnapshot;
  target: SchemaSnapshot;
  confirmationTarget: string;
  allowReview: boolean;
  allowDestructive: boolean;
  allowNonTransactional: boolean;
  setExecution: React.Dispatch<
    React.SetStateAction<SchemaMigrationJournalEntry | null>
  >;
  setRecentExecutions: React.Dispatch<
    React.SetStateAction<SchemaMigrationJournalEntry[]>
  >;
  setConfirmationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPreviewSurface: React.Dispatch<
    React.SetStateAction<"migration" | "preflight" | "rollback" | "run">
  >;
  isRecapturing: boolean;
  setIsRecapturing: React.Dispatch<React.SetStateAction<boolean>>;
  openSchemaDiffTab: (
    plan: SchemaDiffPlan,
    source: SchemaSnapshot,
    target: SchemaSnapshot,
  ) => string;
}

export function createMigrationExecutionActions({
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
}: CreateMigrationExecutionActionsContext) {
  const applyMigration = async () => {
    if (!confirmationReady || !supportsSafeApply || isApplying) return;
    setIsApplying(true);
    setExecutionError(null);
    try {
      const connectionError = await setActiveConnection(
        plan.targetConnectionId,
      );
      if (connectionError) throw new Error(connectionError);
      const entry = await schemaService.executeSchemaMigration({
        source,
        expectedTarget: target,
        expectedPlanId: plan.id,
        expectedTargetFingerprint: target.fingerprint,
        confirmationTarget: confirmationTarget.trim(),
        allowReview,
        allowDestructive,
        allowNonTransactional,
      });
      setExecution(entry);
      setRecentExecutions((entries) =>
        [
          entry,
          ...entries.filter((candidate) => candidate.id !== entry.id),
        ].slice(0, 12),
      );
      setConfirmationOpen(false);
      setPreviewSurface("run");
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplying(false);
    }
  };

  const recaptureInterruptedMigration = async () => {
    if (isApplying || isRecapturing) return;
    setIsRecapturing(true);
    setExecutionError(null);
    try {
      const connectionError = await setActiveConnection(
        plan.targetConnectionId,
      );
      if (connectionError) throw new Error(connectionError);
      // Interrupted execution is never resumed. Read current target metadata
      // and make a brand-new fingerprint-bound plan from the immutable source.
      const refreshed = await compareSnapshotToLive(source, {
        projectId: target.projectId,
        connectionId: target.connectionId,
        connectionName: target.connectionName,
        driver: target.driver,
        databaseName: target.databaseName,
        schemaName: target.schemaName,
      });
      openSchemaDiffTab(refreshed.plan, source, refreshed.target);
    } catch (error) {
      setExecutionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRecapturing(false);
    }
  };

  return { applyMigration, recaptureInterruptedMigration };
}
