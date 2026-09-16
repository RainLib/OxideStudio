import { supportsBoundedTableDataTransfer } from "@/features/table-transfer/model/transferPolicy";
import { tableService } from "@/services/tauri";

interface CreateTransferReviewActionsContext {
  sourceSupportsTransfer: boolean;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  source: import("@/services/tauri/types").TableDataTransferEndpoint;
  targetConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;
  targetCapabilities:
    | import("@/services/tauri/types").DatabaseCapabilities
    | null;
  isBatchTransfer: boolean;
  request: import("@/services/tauri/types").TableDataTransferRequest | null;
  batchRequest:
    | import("@/services/tauri/types").TableDataTransferBatchExecuteRequest
    | null;
  targetSchema: string;
  targetTable: string;
  targetTableMode: "existing" | "new";
  setIsSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
  setPreview: React.Dispatch<
    React.SetStateAction<
      import("@/services/tauri/types").TableDataTransferPreview | null
    >
  >;
  setPreviewRequestKey: React.Dispatch<React.SetStateAction<string>>;
  setBatchPlan: React.Dispatch<
    React.SetStateAction<
      import("@/services/tauri/types").TableDataTransferBatchPlan | null
    >
  >;
  setBatchPlanRequestKey: React.Dispatch<React.SetStateAction<string>>;
  setProgress: React.Dispatch<
    React.SetStateAction<
      import("@/services/tauri/types").TableDataTransferProgress | null
    >
  >;
  setConfirmation: React.Dispatch<React.SetStateAction<string>>;
  batchRequestKey: string;
  requestKey: string;
}

export function createTransferReviewActions({
  sourceSupportsTransfer,
  setError,
  source,
  targetConnection,
  targetCapabilities,
  isBatchTransfer,
  request,
  batchRequest,
  targetSchema,
  targetTable,
  targetTableMode,
  setIsSubmitting,
  setPreview,
  setPreviewRequestKey,
  setBatchPlan,
  setBatchPlanRequestKey,
  setProgress,
  setConfirmation,
  batchRequestKey,
  requestKey,
}: CreateTransferReviewActionsContext) {
  const handlePreview = async () => {
    if (!sourceSupportsTransfer) {
      setError(
        `${source.driver} does not have a verified bounded table-data transfer path yet.`,
      );
      return;
    }
    if (
      !targetConnection ||
      !supportsBoundedTableDataTransfer(
        targetConnection.driver,
        targetCapabilities,
      )
    ) {
      setError(
        "Choose a connection with a verified bounded table-data transfer path.",
      );
      return;
    }
    if (
      (!isBatchTransfer && !request) ||
      (isBatchTransfer && !batchRequest) ||
      !targetSchema.trim() ||
      (!isBatchTransfer && !targetTable.trim())
    ) {
      setError(
        isBatchTransfer
          ? "Choose a target connection and schema before previewing the selected tables."
          : "Choose a target connection, schema, and table before previewing.",
      );
      return;
    }
    if (targetTableMode !== "existing") {
      setError(
        "Review and create the empty target table before previewing data transfer.",
      );
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setPreview(null);
    setPreviewRequestKey("");
    setBatchPlan(null);
    setBatchPlanRequestKey("");
    setProgress(null);
    setConfirmation("");
    try {
      if (isBatchTransfer && batchRequest) {
        const nextPlan = await tableService.previewTableDataTransferBatchPlan(
          batchRequest.plan,
        );
        setBatchPlan(nextPlan);
        setBatchPlanRequestKey(batchRequestKey);
      } else if (request) {
        const nextPreview =
          await tableService.previewTableDataTransfer(request);
        setPreview(nextPreview);
        setPreviewRequestKey(requestKey);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return { handlePreview };
}
