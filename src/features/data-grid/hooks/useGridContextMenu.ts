import { useState } from "react";
import type { DataGridHoverTooltipState } from "../ui/DataGridHoverTooltip";

import { useGridContextActions } from "./useGridContextActions";
import { useGridContextMenuItems } from "./useGridContextMenuItems";

type GridContextMenuOptions = Omit<
  Parameters<typeof useGridContextActions>[0],
  "contextMenu" | "setContextMenu" | "setHoverTooltip"
> &
  Pick<
    Parameters<typeof useGridContextMenuItems>[0],
    | "gridState"
    | "hiddenColumns"
    | "onCopy"
    | "gridSelection"
    | "onEditDocument"
    | "onCloneDocument"
    | "onDeleteDocument"
  >;

/** Compose menu commands once; the grid receives only its event handlers. */
export function useGridContextMenu(options: GridContextMenuOptions) {
  const [contextMenu, setContextMenu] = useState<{
    type: "cell" | "header" | null;
    x: number;
    y: number;
    col?: number;
    row?: number;
    columnId?: string;
    columnName?: string;
  }>({ type: null, x: 0, y: 0 });
  const [hoverTooltip, setHoverTooltip] =
    useState<DataGridHoverTooltipState | null>(null);
  const context = { ...options, contextMenu, setContextMenu, setHoverTooltip };
  const actions = useGridContextActions(context);
  const { contextMenuItems } = useGridContextMenuItems({
    ...context,
    ...actions,
  });
  return {
    contextMenu,
    setContextMenu,
    hoverTooltip,
    setHoverTooltip,
    contextMenuItems,
    onHeaderContextMenu: actions.onHeaderContextMenu,
    onCellContextMenu: actions.onCellContextMenu,
    onItemHovered: actions.onItemHovered,
    closeContextMenu: actions.closeContextMenu,
    handleDeleteSelectedRows: actions.handleDeleteSelectedRows,
  };
}
