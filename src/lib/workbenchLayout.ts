import type {
  AppSettings,
  WorkbenchSide,
  WorkbenchToolWindows,
} from "@/lib/appSettings";

export type SideToolWindowId = "databaseExplorer" | "assistant";

export function toolWindowAtSide(
  toolWindows: WorkbenchToolWindows,
  side: WorkbenchSide
): SideToolWindowId {
  return toolWindows.databaseExplorer.side === side
    ? "databaseExplorer"
    : "assistant";
}

export function moveSideToolWindow(
  workbench: AppSettings["workbench"],
  id: SideToolWindowId,
  side: WorkbenchSide
): AppSettings["workbench"] {
  const currentSide = workbench.toolWindows[id].side;
  if (currentSide === side) return workbench;

  const otherId: SideToolWindowId =
    id === "databaseExplorer" ? "assistant" : "databaseExplorer";

  return {
    ...workbench,
    toolWindows: {
      ...workbench.toolWindows,
      [id]: {
        ...workbench.toolWindows[id],
        side,
      },
      [otherId]: {
        ...workbench.toolWindows[otherId],
        side: currentSide,
      },
    },
  };
}
