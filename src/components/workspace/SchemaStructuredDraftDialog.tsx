import { SchemaStructuredDraftDialogView } from "@/features/schema-diff/ui/SchemaStructuredDraftDialogView";
import type {
  SchemaStructuredDraftDialogProps,
  SchemaStructuredDraftForeignKeySeed,
} from "@/features/schema-diff/model/schemaStructuredDraftDialog";

export type { SchemaStructuredDraftForeignKeySeed };

export function SchemaStructuredDraftDialog(props: SchemaStructuredDraftDialogProps) {
  return <SchemaStructuredDraftDialogView {...props} />;
}
