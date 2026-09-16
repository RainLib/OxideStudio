import { schemaService, tableService } from "@/services/tauri";

interface CreateTransferTargetActionsContext {
  targetPlanRequest:
    | import("@/services/tauri/types").TableDataTransferTargetPlanRequest
    | null;
  targetSchema: string;
  targetTable: string;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setIsSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
  setTargetPlan: React.Dispatch<
    React.SetStateAction<
      import("@/services/tauri/types").TableDataTransferTargetPlan | null
    >
  >;
  setTargetPlanPreviewKey: React.Dispatch<React.SetStateAction<string>>;
  setTargetPlanConfirmation: React.Dispatch<React.SetStateAction<string>>;
  targetPlanRequestKey: string;
  targetPlan:
    | import("@/services/tauri/types").TableDataTransferTargetPlan
    | null;
  targetPlanPreviewKey: string;
  targetPlanConfirmation: string;
  setIsCreatingTarget: React.Dispatch<React.SetStateAction<boolean>>;
  targetSupportsCatalogs: boolean;
  targetConnectionId: string;
  targetDatabase: string;
  setTables: React.Dispatch<React.SetStateAction<string[]>>;
  setTargetTableMode: React.Dispatch<React.SetStateAction<"existing" | "new">>;
  setTargetTable: React.Dispatch<React.SetStateAction<string>>;
  setRestoreSourceSchemaObjects: React.Dispatch<React.SetStateAction<boolean>>;
  resetTransferReview: () => void;
}

export function createTransferTargetActions({
  targetPlanRequest,
  targetSchema,
  targetTable,
  setError,
  setIsSubmitting,
  setTargetPlan,
  setTargetPlanPreviewKey,
  setTargetPlanConfirmation,
  targetPlanRequestKey,
  targetPlan,
  targetPlanPreviewKey,
  targetPlanConfirmation,
  setIsCreatingTarget,
  targetSupportsCatalogs,
  targetConnectionId,
  targetDatabase,
  setTables,
  setTargetTableMode,
  setTargetTable,
  setRestoreSourceSchemaObjects,
  resetTransferReview,
}: CreateTransferTargetActionsContext) {
  const handlePreviewTarget = async () => {
    if (!targetPlanRequest || !targetSchema.trim() || !targetTable.trim()) {
      setError(
        "Choose a target connection and schema, then enter a new table name.",
      );
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setTargetPlan(null);
    setTargetPlanPreviewKey("");
    setTargetPlanConfirmation("");
    try {
      const nextPlan =
        await tableService.previewTableDataTransferTarget(targetPlanRequest);
      setTargetPlan(nextPlan);
      setTargetPlanPreviewKey(targetPlanRequestKey);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTarget = async () => {
    if (
      !targetPlanRequest ||
      !targetPlan ||
      !targetPlan.canExecute ||
      targetPlanPreviewKey !== targetPlanRequestKey ||
      targetPlanConfirmation.trim() !== targetPlan.confirmationToken
    ) {
      return;
    }
    setIsSubmitting(true);
    setIsCreatingTarget(true);
    setError(null);
    try {
      const created = await tableService.createTableDataTransferTarget(
        targetPlanRequest,
        targetPlanConfirmation,
      );
      const nextTables = targetSupportsCatalogs
        ? await schemaService.getDatabaseTables(
            targetConnectionId,
            targetDatabase,
            targetSchema,
          )
        : await schemaService.getTables(targetConnectionId, targetSchema);
      const names = nextTables
        .filter((item) => !item.type?.toUpperCase().includes("VIEW"))
        .map((item) => item.name)
        .sort((left, right) => left.localeCompare(right));
      setTables(names);
      setTargetTableMode("existing");
      setTargetTable(created.table);
      setRestoreSourceSchemaObjects(true);
      setTargetPlan(null);
      setTargetPlanPreviewKey("");
      setTargetPlanConfirmation("");
      resetTransferReview();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setIsCreatingTarget(false);
      setIsSubmitting(false);
    }
  };

  return { handlePreviewTarget, handleCreateTarget };
}
