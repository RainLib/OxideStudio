import { useDatabaseSearchDialogController } from "@/features/database-search/hooks/useDatabaseSearchDialogController";
import type { DatabaseSearchDialogProps } from "@/features/database-search/model/databaseSearchDialog";
import { DatabaseSearchDialogView } from "@/features/database-search/ui/DatabaseSearchDialogView";

export type { DatabaseSearchDialogProps };

export function DatabaseSearchDialog(props: DatabaseSearchDialogProps) {
  const controller = useDatabaseSearchDialogController(props);
  return <DatabaseSearchDialogView controller={controller} />;
}
