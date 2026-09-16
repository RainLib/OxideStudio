import { DEFAULT_APP_SETTINGS } from "@/features/settings/model/defaultSettings";
import {
  type AppSettings,
  type PinnableTitleToolId,
  type SideToolWindowId,
  type WorkbenchSide,
  type WorkbenchToolWindowId,
  type WorkbenchToolWindows,
} from "@/features/settings/model/settingsTypes";
import {
  boolAt,
  enumAt,
  getAt,
} from "@/features/settings/model/settingsValueReaders";

/**
 * A first/secondary side is a single shared surface. Older persisted settings
 * may still contain multiple `visibility` flags on the same side, which made
 * settings controls claim that several panes were open even though runtime
 * rendering can display only one. Pick one deterministic active pane and
 * clear every sibling before the settings ever reach the workspace store.
 */
export function normalizeSharedSidePanelVisibility(
  settings: AppSettings,
  raw: Record<string, unknown>,
): AppSettings {
  const visibility = { ...settings.workbench.layout.visibility };
  const activeSideToolWindows = {
    ...settings.workbench.layout.activeSideToolWindows,
  };

  for (const side of ["left", "right"] as const) {
    const requested = activeSideToolWindows[side];
    const candidateIds = SIDE_TOOL_WINDOW_IDS.filter(
      (id) =>
        settings.workbench.toolWindows[id].enabled &&
        settings.workbench.toolWindows[id].side === side,
    );
    const visibleCandidates = candidateIds.filter(
      (id) =>
        visibility[id] &&
        (hasExplicitPersistedVisibility(raw, id) ||
          !hasMovedFromDefaultSide(raw, settings, id)),
    );
    const active =
      requested && visibleCandidates.includes(requested)
        ? requested
        : (visibleCandidates[0] ?? null);

    for (const id of candidateIds) {
      visibility[id] = id === active;
    }
    activeSideToolWindows[side] = active;
  }

  const activeToolWindow = settings.workbench.layout.activeToolWindow;
  const activeToolStillVisible =
    activeToolWindow === "editor" ||
    activeToolWindow === "results" ||
    activeSideToolWindows.left === activeToolWindow ||
    activeSideToolWindows.right === activeToolWindow;

  return {
    ...settings,
    workbench: {
      ...settings.workbench,
      layout: {
        ...settings.workbench.layout,
        visibility,
        activeSideToolWindows,
        activeToolWindow: activeToolStillVisible ? activeToolWindow : "editor",
      },
    },
  };
}

export function hasMovedFromDefaultSide(
  raw: Record<string, unknown>,
  settings: AppSettings,
  id: SideToolWindowId,
) {
  const configuredSide = getAt(raw, ["workbench", "toolWindows", id, "side"]);
  return (
    (configuredSide === "left" || configuredSide === "right") &&
    configuredSide !== DEFAULT_APP_SETTINGS.workbench.toolWindows[id].side &&
    settings.workbench.toolWindows[id].side === configuredSide
  );
}

export function hasExplicitPersistedVisibility(
  raw: Record<string, unknown>,
  id: WorkbenchToolWindowId,
) {
  if (
    typeof getAt(raw, ["workbench", "layout", "visibility", id]) === "boolean"
  ) {
    return true;
  }
  if (id === "databaseExplorer") {
    return (
      typeof getAt(raw, ["workbench", "layout", "leftVisible"]) === "boolean"
    );
  }
  if (id === "assistant") {
    return (
      typeof getAt(raw, ["workbench", "layout", "rightVisible"]) === "boolean"
    );
  }
  return false;
}

export function normalizedToolWindows(
  raw: Record<string, unknown>,
  defaults: AppSettings,
): WorkbenchToolWindows {
  return {
    databaseExplorer: {
      enabled: boolAt(
        raw,
        ["workbench", "toolWindows", "databaseExplorer", "enabled"],
        defaults.workbench.toolWindows.databaseExplorer.enabled,
      ),
      side: toolWindowSide(raw, defaults, "databaseExplorer"),
    },
    assistant: {
      enabled: boolAt(
        raw,
        ["workbench", "toolWindows", "assistant", "enabled"],
        defaults.workbench.toolWindows.assistant.enabled,
      ),
      side: toolWindowSide(raw, defaults, "assistant"),
    },
    projectFiles: {
      enabled: boolAt(
        raw,
        ["workbench", "toolWindows", "projectFiles", "enabled"],
        defaults.workbench.toolWindows.projectFiles.enabled,
      ),
      side: toolWindowSide(raw, defaults, "projectFiles"),
    },
    sqlLibrary: {
      enabled: boolAt(
        raw,
        ["workbench", "toolWindows", "sqlLibrary", "enabled"],
        defaults.workbench.toolWindows.sqlLibrary.enabled,
      ),
      side: toolWindowSide(raw, defaults, "sqlLibrary"),
    },
    commit: {
      enabled: boolAt(
        raw,
        ["workbench", "toolWindows", "commit", "enabled"],
        defaults.workbench.toolWindows.commit.enabled,
      ),
      side: toolWindowSide(raw, defaults, "commit"),
    },
    versionControl: {
      enabled: boolAt(
        raw,
        ["workbench", "toolWindows", "versionControl", "enabled"],
        defaults.workbench.toolWindows.versionControl.enabled,
      ),
      side: toolWindowSide(raw, defaults, "versionControl"),
    },
    results: {
      enabled: boolAt(
        raw,
        ["workbench", "toolWindows", "results", "enabled"],
        defaults.workbench.toolWindows.results.enabled,
      ),
      side: "bottom",
    },
  };
}

export function toolWindowSide(
  raw: Record<string, unknown>,
  defaults: AppSettings,
  id: SideToolWindowId,
): WorkbenchSide {
  return enumAt(
    raw,
    ["workbench", "toolWindows", id, "side"],
    ["left", "right"],
    defaults.workbench.toolWindows[id].side,
  );
}

export const SIDE_TOOL_WINDOW_IDS: SideToolWindowId[] = [
  "databaseExplorer",
  "projectFiles",
  "sqlLibrary",
  "assistant",
  "commit",
  "versionControl",
];

export const PINNABLE_TITLE_TOOL_IDS: PinnableTitleToolId[] = [
  "commit",
  "versionControl",
];

export function normalizedPinnedTitleTools(
  raw: Record<string, unknown>,
  toolWindows: WorkbenchToolWindows,
): PinnableTitleToolId[] {
  const value = getAt(raw, ["workbench", "layout", "pinnedTitleTools"]);
  if (!Array.isArray(value)) return [];
  return [...new Set(value)]
    .filter(
      (id): id is PinnableTitleToolId =>
        typeof id === "string" &&
        PINNABLE_TITLE_TOOL_IDS.includes(id as PinnableTitleToolId) &&
        toolWindows[id as PinnableTitleToolId].enabled,
    )
    .slice(0, PINNABLE_TITLE_TOOL_IDS.length);
}

export function normalizedActiveSideToolWindow(
  raw: Record<string, unknown>,
  toolWindows: WorkbenchToolWindows,
  side: WorkbenchSide,
): SideToolWindowId | null {
  const requested = enumAt(
    raw,
    ["workbench", "layout", "activeSideToolWindows", side],
    SIDE_TOOL_WINDOW_IDS,
    side === "left" ? "databaseExplorer" : "assistant",
  );
  if (toolWindows[requested].enabled && toolWindows[requested].side === side) {
    return requested;
  }
  return (
    SIDE_TOOL_WINDOW_IDS.find(
      (id) => toolWindows[id].enabled && toolWindows[id].side === side,
    ) ?? null
  );
}

export function normalizedSideHistory(
  raw: Record<string, unknown>,
  toolWindows: WorkbenchToolWindows,
  side: WorkbenchSide,
): SideToolWindowId[] {
  const value = getAt(raw, ["workbench", "layout", "sideHistory", side]);
  if (!Array.isArray(value)) return [];
  return [...new Set(value)]
    .filter(
      (id): id is SideToolWindowId =>
        typeof id === "string" &&
        SIDE_TOOL_WINDOW_IDS.includes(id as SideToolWindowId) &&
        toolWindows[id as SideToolWindowId].side === side,
    )
    .slice(0, SIDE_TOOL_WINDOW_IDS.length);
}
