import { useTableDataController } from "@/features/table-data/hooks/useTableDataController";
import { TableDataViewContent } from "@/features/table-data/ui/TableDataViewContent";

export function TableDataView() {
  const controller = useTableDataController();
  return controller ? <TableDataViewContent {...controller} /> : null;
}
