import { useEditColumnsDialogController } from "@/features/table-data/hooks/useEditColumnsDialogController";
import type { EditColumnsDialogProps } from "@/features/table-data/model/editColumnsDialog";
import { EditColumnsDialogView } from "@/features/table-data/ui/EditColumnsDialogView";

export type { EditColumnsDialogProps };

export function EditColumnsDialog(props: EditColumnsDialogProps) {
  const controller = useEditColumnsDialogController(props);
  return <EditColumnsDialogView controller={controller} />;
}
