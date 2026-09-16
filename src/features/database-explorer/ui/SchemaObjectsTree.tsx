import type { SchemaObjectsTreeContext } from "@/features/database-explorer/ui/schema-objects-tree/types";
import { SchemaObjectsTreeView } from "@/features/database-explorer/ui/schema-objects-tree/SchemaObjectsTreeView";

export function SchemaObjectsTree(context: SchemaObjectsTreeContext) {
  return <SchemaObjectsTreeView {...context} />;
}
