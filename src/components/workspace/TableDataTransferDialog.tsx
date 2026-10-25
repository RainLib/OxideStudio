import { canRetryTableDataTransferReport } from "@/features/database-explorer/model/tableDataTransferRetry";
import { useTableDataTransferDialogController } from "@/features/table-transfer/hooks/useTableDataTransferDialogController";
import type { TableDataTransferDialogProps } from "@/features/table-transfer/model/tableDataTransferDialogTypes";
import { TableDataTransferDialogView } from "@/features/table-transfer/ui/TableDataTransferDialogView";
import { ResumableTransferDialog } from "@/features/table-transfer/ui/ResumableTransferDialog";

export { canRetryTableDataTransferReport };
export type { TableDataTransferDialogProps };

export function TableDataTransferDialog(props: TableDataTransferDialogProps) {
  const controller = useTableDataTransferDialogController(props);
  if (controller.resumableOpen && controller.projectId) {
    return (
      <ResumableTransferDialog
        open={props.open}
        projectId={controller.projectId}
        request={controller.largeTransferRequest}
        onClose={props.onClose}
        onBack={() => controller.setResumableOpen(false)}
        onTransferred={props.onTransferred}
        connectionNames={Object.fromEntries(
          props.connections.map((connection) => [connection.id, connection.name]),
        )}
      />
    );
  }
  return <TableDataTransferDialogView controller={controller} />;
}

export {
  buildTransferObjectInventory,
  canExecuteTableDataTransfer,
  supportsBoundedTableDataTransfer,
  supportsTableDataTransferUpsert,
} from "@/features/table-transfer/model/transferPolicy";
