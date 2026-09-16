import { canRetryTableDataTransferReport } from "@/features/database-explorer/model/tableDataTransferRetry";
import { useTableDataTransferDialogController } from "@/features/table-transfer/hooks/useTableDataTransferDialogController";
import type { TableDataTransferDialogProps } from "@/features/table-transfer/model/tableDataTransferDialogTypes";
import { TableDataTransferDialogView } from "@/features/table-transfer/ui/TableDataTransferDialogView";

export { canRetryTableDataTransferReport };
export type { TableDataTransferDialogProps };

export function TableDataTransferDialog(props: TableDataTransferDialogProps) {
  const controller = useTableDataTransferDialogController(props);
  return <TableDataTransferDialogView controller={controller} />;
}

export {
  buildTransferObjectInventory,
  canExecuteTableDataTransfer,
  supportsBoundedTableDataTransfer,
  supportsTableDataTransferUpsert,
} from "@/features/table-transfer/model/transferPolicy";
