import { createConnectionTreeRowRenderer } from "@/features/database-explorer/ui/connection-tree/ConnectionTreeRow";
import type { CreateConnectionTreeRendererContext } from "@/features/database-explorer/ui/connection-tree/types";

export function createConnectionTreeRenderer(
  context: CreateConnectionTreeRendererContext,
) {
  return createConnectionTreeRowRenderer(context);
}
