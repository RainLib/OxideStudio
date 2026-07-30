import type {
  AppSettings,
  SideToolWindowId,
  WorkbenchSide,
} from "@/lib/appSettings";

export type { SideToolWindowId } from "@/lib/appSettings";

export const SIDE_TOOL_WINDOW_IDS: readonly SideToolWindowId[] = [
  "databaseExplorer",
  "projectFiles",
  "assistant",
  "commit",
  "versionControl",
] as const;

type WorkbenchSettings = AppSettings["workbench"];

export function toolWindowAtSide(
  workbench: WorkbenchSettings,
  side: WorkbenchSide,
): SideToolWindowId | null {
  const active = workbench.layout.activeSideToolWindows[side];
  if (
    active &&
    workbench.toolWindows[active].enabled &&
    workbench.toolWindows[active].side === side &&
    workbench.layout.visibility[active]
  ) {
    return active;
  }
  return null;
}

export function openSideToolWindow(
  workbench: WorkbenchSettings,
  id: SideToolWindowId,
): WorkbenchSettings {
  if (!workbench.toolWindows[id].enabled) return workbench;
  const side = workbench.toolWindows[id].side;
  const previous = toolWindowAtSide(workbench, side);
  const history = workbench.layout.sideHistory[side].filter(
    (candidate) => candidate !== id && candidate !== previous,
  );
  if (previous && previous !== id) history.unshift(previous);
  return {
    ...workbench,
    layout: {
      ...workbench.layout,
      visibility: {
        ...workbench.layout.visibility,
        ...(previous && previous !== id ? { [previous]: false } : {}),
        [id]: true,
      },
      activeToolWindow: id,
      activeSideToolWindows: {
        ...workbench.layout.activeSideToolWindows,
        [side]: id,
      },
      sideHistory: {
        ...workbench.layout.sideHistory,
        [side]: history.slice(0, SIDE_TOOL_WINDOW_IDS.length),
      },
    },
  };
}

export function closeSideToolWindow(
  workbench: WorkbenchSettings,
  id: SideToolWindowId,
): WorkbenchSettings {
  const side = workbench.toolWindows[id].side;
  const isActive = toolWindowAtSide(workbench, side) === id;
  if (!isActive) {
    return {
      ...workbench,
      layout: {
        ...workbench.layout,
        visibility: { ...workbench.layout.visibility, [id]: false },
      },
    };
  }
  const history = workbench.layout.sideHistory[side].filter(
    (candidate) =>
      candidate !== id &&
      workbench.toolWindows[candidate].enabled &&
      workbench.toolWindows[candidate].side === side,
  );
  const restore = history.shift() ?? null;
  return {
    ...workbench,
    layout: {
      ...workbench.layout,
      visibility: {
        ...workbench.layout.visibility,
        [id]: false,
        ...(restore ? { [restore]: true } : {}),
      },
      activeToolWindow: restore ?? "editor",
      activeSideToolWindows: {
        ...workbench.layout.activeSideToolWindows,
        [side]: restore,
      },
      sideHistory: {
        ...workbench.layout.sideHistory,
        [side]: history,
      },
    },
  };
}

export function toggleSideToolWindow(
  workbench: WorkbenchSettings,
  id: SideToolWindowId,
): WorkbenchSettings {
  const side = workbench.toolWindows[id].side;
  return toolWindowAtSide(workbench, side) === id
    ? closeSideToolWindow(workbench, id)
    : openSideToolWindow(workbench, id);
}

export function moveSideToolWindow(
  workbench: WorkbenchSettings,
  id: SideToolWindowId,
  side: WorkbenchSide,
): WorkbenchSettings {
  const currentSide = workbench.toolWindows[id].side;
  if (currentSide === side) return openSideToolWindow(workbench, id);

  const withoutCurrent = closeSideToolWindow(workbench, id);
  const moved: WorkbenchSettings = {
    ...withoutCurrent,
    toolWindows: {
      ...withoutCurrent.toolWindows,
      [id]: { ...withoutCurrent.toolWindows[id], side },
    },
    layout: {
      ...withoutCurrent.layout,
      sideHistory: {
        left: withoutCurrent.layout.sideHistory.left.filter(
          (candidate) => candidate !== id,
        ),
        right: withoutCurrent.layout.sideHistory.right.filter(
          (candidate) => candidate !== id,
        ),
      },
    },
  };
  return openSideToolWindow(moved, id);
}

export function visibleSideToolWindow(
  workbench: WorkbenchSettings,
  id: SideToolWindowId,
): boolean {
  return toolWindowAtSide(workbench, workbench.toolWindows[id].side) === id;
}
