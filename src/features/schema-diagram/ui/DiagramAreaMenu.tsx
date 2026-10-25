import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { TabData } from "@/features/workspace-tabs/model/types";
import type { SchemaDiagramAreaBounds } from "@/lib/schemaDiagramAreas";
import { LayoutGrid, Pencil, X } from "lucide-react";

interface DiagramAreaMenuContext {
  selectSchemaDiagramArea: (tabId: string, areaId: string | null) => void;
  activeTab: Pick<TabData, "id">;
  area: SchemaDiagramAreaBounds;
  beginRenameArea: (areaId: string) => void;
  autoArrangeArea: (areaId: string) => void;
  removeArea: (areaId: string) => void;
}

export function DiagramAreaMenu({
  selectSchemaDiagramArea,
  activeTab,
  area,
  beginRenameArea,
  autoArrangeArea,
  removeArea,
}: DiagramAreaMenuContext) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className="pointer-events-auto absolute left-2 top-1 rounded px-1 py-0.5 text-[9px] font-medium text-violet-200/85 outline-none hover:bg-violet-300/10 focus-visible:ring-1 focus-visible:ring-violet-300/60"
          onContextMenu={(event) => event.stopPropagation()}
          onClick={() => selectSchemaDiagramArea(activeTab.id, area.id)}
        >
          {area.name} · {area.visibleRelationCount}/{area.relationNames.length}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem
          className="gap-2 text-[10px]"
          onClick={() => beginRenameArea(area.id)}
        >
          <Pencil size={11} /> Rename area
        </ContextMenuItem>
        <ContextMenuItem
          className="gap-2 text-[10px]"
          disabled={area.relationNames.length < 2}
          onClick={() => autoArrangeArea(area.id)}
        >
          <LayoutGrid size={11} /> Auto-arrange area
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="gap-2 text-[10px] text-red-300 focus:text-red-200"
          onClick={() => removeArea(area.id)}
        >
          <X size={11} /> Remove area
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
