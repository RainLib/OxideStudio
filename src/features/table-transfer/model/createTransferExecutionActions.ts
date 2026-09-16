import { tableService } from "@/services/tauri";
import type { TableDataTransferPostCommitReceipt } from "@/services/tauri/types";

interface CreateTransferExecutionActionsContext {
  isBatchTransfer: boolean;
  batchRequest:
    | import("@/services/tauri/types").TableDataTransferBatchExecuteRequest
    | null;
  batchPlan: import("@/services/tauri/types").TableDataTransferBatchPlan | null;
  batchPlanRequestKey: string;
  batchRequestKey: string;
  confirmation: string;
  request: import("@/services/tauri/types").TableDataTransferRequest | null;
  preview: import("@/services/tauri/types").TableDataTransferPreview | null;
  previewRequestKey: string;
  requestKey: string;
  setIsSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
  setIsExecuting: React.Dispatch<React.SetStateAction<boolean>>;
  setIsCancelling: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  onTransferred: () => void;
  onClose: () => void;
  isExecuting: boolean;
  isCancelling: boolean;
  transferId: string;
}

export function createTransferExecutionActions({
  isBatchTransfer,
  batchRequest,
  batchPlan,
  batchPlanRequestKey,
  batchRequestKey,
  confirmation,
  request,
  preview,
  previewRequestKey,
  requestKey,
  setIsSubmitting,
  setIsExecuting,
  setIsCancelling,
  setError,
  onTransferred,
  onClose,
  isExecuting,
  isCancelling,
  transferId,
}: CreateTransferExecutionActionsContext) {
  const handleTransfer = async () => {
    if (isBatchTransfer) {
      if (
        !batchRequest ||
        !batchPlan ||
        batchPlanRequestKey !== batchRequestKey ||
        !batchPlan.canExecute ||
        confirmation.trim() !== batchPlan.confirmationToken
      )
        return;
    } else if (!request || !preview || previewRequestKey !== requestKey) {
      return;
    }
    setIsSubmitting(true);
    setIsExecuting(true);
    setIsCancelling(false);
    setError(null);
    try {
      let postCommitReceipt: TableDataTransferPostCommitReceipt | null = null;
      if (isBatchTransfer && batchRequest) {
        const result = await tableService.executeTableDataTransferBatch(
          batchRequest,
          confirmation,
        );
        postCommitReceipt = result.postCommitReceipt || null;
      } else if (request) {
        const result = await tableService.executeTableDataTransfer(
          request,
          confirmation,
        );
        postCommitReceipt = result.postCommitReceipt || null;
      }
      onTransferred();
      if (postCommitReceipt?.status === "needsManualReview") {
        setError(postCommitReceipt.message);
        return;
      }
      onClose();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setIsSubmitting(false);
      setIsExecuting(false);
      setIsCancelling(false);
    }
  };

  const handleCancelTransfer = async () => {
    if (!isExecuting || isCancelling) return;
    setIsCancelling(true);
    setError(null);
    try {
      await tableService.cancelTableDataTransfer(transferId);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
      setIsCancelling(false);
    }
  };

  return { handleTransfer, handleCancelTransfer };
}
