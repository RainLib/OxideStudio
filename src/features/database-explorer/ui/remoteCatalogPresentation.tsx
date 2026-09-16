import {
  explorerDirectoryDefinition,
  type ExplorerDirectoryGroupKind,
} from "@/features/database-explorer/model/explorerDirectory";
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import {
  EXPLORER_MENU_CONTENT_CLASS,
  EXPLORER_MENU_ITEM_CLASS,
} from "@/features/database-explorer/ui/explorerStyles";
import { cn } from "@/lib/utils";
import {
  Braces,
  Clock3,
  Link2,
  ListOrdered,
  Package,
  SquareFunction,
  Table,
  TableProperties,
  Zap,
} from "lucide-react";

export const menuContentClass = EXPLORER_MENU_CONTENT_CLASS;

export const menuItemClass = EXPLORER_MENU_ITEM_CLASS;

export function directoryIcon(kind: ExplorerDirectoryGroupKind) {
  const definition = explorerDirectoryDefinition(kind);
  const className = cn(
    "shrink-0",
    explorerObjectIconClass(definition.iconKind),
  );
  if (kind === "tables") return <Table size={11} className={className} />;
  if (kind === "views" || kind === "materialized-views") {
    return <TableProperties size={11} className={className} />;
  }
  if (kind === "procedures" || kind === "functions") {
    return <SquareFunction size={11} className={className} />;
  }
  if (kind === "triggers") return <Zap size={11} className={className} />;
  if (kind === "events" || kind === "jobs") {
    return <Clock3 size={11} className={className} />;
  }
  if (kind === "sequences") {
    return <ListOrdered size={11} className={className} />;
  }
  if (kind === "synonyms") return <Link2 size={11} className={className} />;
  if (kind === "packages") return <Package size={11} className={className} />;
  return <Braces size={11} className={className} />;
}
