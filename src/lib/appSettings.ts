import type { AiPlannerKind } from "@/store/useAiSettingsStore";

export type WorkbenchToolWindowId =
  | "databaseExplorer"
  | "assistant"
  | "results";

export type WorkbenchSide = "left" | "right";

export type WorkbenchToolWindows = {
  databaseExplorer: {
    enabled: boolean;
    side: WorkbenchSide;
  };
  assistant: {
    enabled: boolean;
    side: WorkbenchSide;
  };
  results: {
    enabled: boolean;
    side: "bottom";
  };
};

export type AppSettings = {
  appearance: {
    uiFontSize: number;
  };
  workbench: {
    layout: {
      visibility: Record<WorkbenchToolWindowId, boolean>;
      leftWidth: number;
      rightWidth: number;
      bottomHeight: number;
      activeToolWindow: WorkbenchToolWindowId | "editor";
    };
    toolWindows: WorkbenchToolWindows;
  };
  keymap: Record<string, string[]>;
  editor: {
    fontSize: number;
    tabSize: number;
    wordWrap: "off" | "on" | "wordWrapColumn" | "bounded";
    minimap: boolean;
    confirmDestructiveSql: boolean;
  };
  dataGrid: {
    fontSize: number;
    rowHeight: number;
    zoomPercent: number;
    pageSize: number;
    readOnlyByDefault: boolean;
    copyIncludeHeaders: boolean;
    showTypeIcons: boolean;
  };
  databaseExplorer: {
    refreshMode: "manual" | "cache-first";
    showOnlySelectedSchemas: boolean;
    showCacheBadges: boolean;
  };
  ai: {
    plannerKind: AiPlannerKind;
  };
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appearance: {
    uiFontSize: 12,
  },
  workbench: {
    layout: {
      visibility: {
        databaseExplorer: true,
        assistant: true,
        results: true,
      },
      leftWidth: 400,
      rightWidth: 360,
      bottomHeight: 320,
      activeToolWindow: "editor",
    },
    toolWindows: {
      databaseExplorer: {
        enabled: true,
        side: "left",
      },
      assistant: {
        enabled: true,
        side: "right",
      },
      results: {
        enabled: true,
        side: "bottom",
      },
    },
  },
  keymap: {
    "commandPalette.open": ["mod+p"],
    "settings.open": ["mod+,"],
    "window.new": ["mod+shift+n"],
    "query.newConsole": ["mod+t"],
    "query.reopenClosed": ["mod+shift+t"],
    "query.closeTab": ["mod+w"],
    "query.run": ["mod+enter"],
    "query.runCurrentStatement": ["mod+shift+enter"],
    "query.format": ["mod+l"],
    "workbench.toggleDatabaseExplorer": ["mod+1"],
    "workbench.toggleAssistant": ["mod+2"],
    "workbench.toggleResults": ["mod+3"],
    "workbench.focusEditor": ["escape"],
    "workbench.resizeActiveToolWindowLeft": ["mod+alt+arrowleft"],
    "workbench.resizeActiveToolWindowRight": ["mod+alt+arrowright"],
    "workbench.resizeActiveToolWindowUp": ["mod+alt+arrowup"],
    "workbench.resizeActiveToolWindowDown": ["mod+alt+arrowdown"],
  },
  editor: {
    fontSize: 12,
    tabSize: 4,
    wordWrap: "off",
    minimap: false,
    confirmDestructiveSql: true,
  },
  dataGrid: {
    fontSize: 12,
    rowHeight: 28,
    zoomPercent: 100,
    pageSize: 500,
    readOnlyByDefault: false,
    copyIncludeHeaders: true,
    showTypeIcons: true,
  },
  databaseExplorer: {
    refreshMode: "cache-first",
    showOnlySelectedSchemas: true,
    showCacheBadges: true,
  },
  ai: {
    plannerKind: "model",
  },
};

export function normalizeAppSettings(value: unknown): AppSettings {
  const raw = isRecord(value) ? value : {};
  const defaults = DEFAULT_APP_SETTINGS;
  const toolWindows = normalizedToolWindows(raw, defaults);

  return {
    appearance: {
      uiFontSize: numberAt(
        raw,
        ["appearance", "uiFontSize"],
        defaults.appearance.uiFontSize,
        10,
        20
      ),
    },
    workbench: {
      layout: {
        visibility: {
          databaseExplorer: boolAt(
            raw,
            ["workbench", "layout", "visibility", "databaseExplorer"],
            boolAt(
              raw,
              ["workbench", "layout", "leftVisible"],
              defaults.workbench.layout.visibility.databaseExplorer
            )
          ),
          assistant: boolAt(
            raw,
            ["workbench", "layout", "visibility", "assistant"],
            boolAt(
              raw,
              ["workbench", "layout", "rightVisible"],
              defaults.workbench.layout.visibility.assistant
            )
          ),
          results: boolAt(
            raw,
            ["workbench", "layout", "visibility", "results"],
            boolAt(
              raw,
              ["workbench", "layout", "bottomVisible"],
              defaults.workbench.layout.visibility.results
            )
          ),
        },
        leftWidth: numberAt(raw, ["workbench", "layout", "leftWidth"], defaults.workbench.layout.leftWidth, 240, 760),
        rightWidth: numberAt(raw, ["workbench", "layout", "rightWidth"], defaults.workbench.layout.rightWidth, 260, 640),
        bottomHeight: numberAt(raw, ["workbench", "layout", "bottomHeight"], defaults.workbench.layout.bottomHeight, 140, 720),
        activeToolWindow: enumAt(raw, ["workbench", "layout", "activeToolWindow"], ["databaseExplorer", "assistant", "results", "editor"], defaults.workbench.layout.activeToolWindow),
      },
      toolWindows,
    },
    keymap: normalizeKeymap(recordAt(raw, ["keymap"]), defaults.keymap),
    editor: {
      fontSize: numberAt(raw, ["editor", "fontSize"], defaults.editor.fontSize, 10, 24),
      tabSize: numberAt(raw, ["editor", "tabSize"], defaults.editor.tabSize, 2, 8),
      wordWrap: enumAt(raw, ["editor", "wordWrap"], ["off", "on", "wordWrapColumn", "bounded"], defaults.editor.wordWrap),
      minimap: boolAt(raw, ["editor", "minimap"], defaults.editor.minimap),
      confirmDestructiveSql: boolAt(raw, ["editor", "confirmDestructiveSql"], defaults.editor.confirmDestructiveSql),
    },
    dataGrid: {
      fontSize: numberAt(raw, ["dataGrid", "fontSize"], defaults.dataGrid.fontSize, 10, 20),
      rowHeight: numberAt(raw, ["dataGrid", "rowHeight"], defaults.dataGrid.rowHeight, 22, 48),
      zoomPercent: numberAt(raw, ["dataGrid", "zoomPercent"], defaults.dataGrid.zoomPercent, 70, 160),
      pageSize: numberAt(raw, ["dataGrid", "pageSize"], defaults.dataGrid.pageSize, 50, 5000),
      readOnlyByDefault: boolAt(raw, ["dataGrid", "readOnlyByDefault"], defaults.dataGrid.readOnlyByDefault),
      copyIncludeHeaders: boolAt(raw, ["dataGrid", "copyIncludeHeaders"], defaults.dataGrid.copyIncludeHeaders),
      showTypeIcons: boolAt(raw, ["dataGrid", "showTypeIcons"], defaults.dataGrid.showTypeIcons),
    },
    databaseExplorer: {
      refreshMode: enumAt(raw, ["databaseExplorer", "refreshMode"], ["manual", "cache-first"], defaults.databaseExplorer.refreshMode),
      showOnlySelectedSchemas: boolAt(raw, ["databaseExplorer", "showOnlySelectedSchemas"], defaults.databaseExplorer.showOnlySelectedSchemas),
      showCacheBadges: boolAt(raw, ["databaseExplorer", "showCacheBadges"], defaults.databaseExplorer.showCacheBadges),
    },
    ai: {
      plannerKind: enumAt(raw, ["ai", "plannerKind"], ["model", "langgraph", "local"], defaults.ai.plannerKind),
    },
  };
}

function normalizedToolWindows(
  raw: Record<string, unknown>,
  defaults: AppSettings
): WorkbenchToolWindows {
  const databaseExplorerSide = enumAt(
    raw,
    ["workbench", "toolWindows", "databaseExplorer", "side"],
    ["left", "right"],
    defaults.workbench.toolWindows.databaseExplorer.side
  );
  const requestedAssistantSide = enumAt(
    raw,
    ["workbench", "toolWindows", "assistant", "side"],
    ["left", "right"],
    defaults.workbench.toolWindows.assistant.side
  );
  const assistantSide =
    requestedAssistantSide === databaseExplorerSide
      ? oppositeSide(databaseExplorerSide)
      : requestedAssistantSide;

  return {
    databaseExplorer: {
      enabled: boolAt(
        raw,
        ["workbench", "toolWindows", "databaseExplorer", "enabled"],
        defaults.workbench.toolWindows.databaseExplorer.enabled
      ),
      side: databaseExplorerSide,
    },
    assistant: {
      enabled: boolAt(
        raw,
        ["workbench", "toolWindows", "assistant", "enabled"],
        defaults.workbench.toolWindows.assistant.enabled
      ),
      side: assistantSide,
    },
    results: {
      enabled: boolAt(
        raw,
        ["workbench", "toolWindows", "results", "enabled"],
        defaults.workbench.toolWindows.results.enabled
      ),
      side: "bottom",
    },
  };
}

function oppositeSide(side: WorkbenchSide): WorkbenchSide {
  return side === "left" ? "right" : "left";
}

function normalizeKeymap(
  raw: Record<string, unknown>,
  defaults: Record<string, string[]>
) {
  const keymap: Record<string, string[]> = { ...defaults };
  Object.entries(raw).forEach(([actionId, value]) => {
    if (Array.isArray(value)) {
      keymap[actionId] = value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== ""
      );
    } else if (typeof value === "string" && value.trim()) {
      keymap[actionId] = [value.trim()];
    }
  });
  return keymap;
}

function getAt(value: Record<string, unknown>, path: string[]) {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function recordAt(value: Record<string, unknown>, path: string[]) {
  const record = getAt(value, path);
  return isRecord(record) ? record : {};
}

function boolAt(value: Record<string, unknown>, path: string[], fallback: boolean) {
  const item = getAt(value, path);
  return typeof item === "boolean" ? item : fallback;
}

function numberAt(
  value: Record<string, unknown>,
  path: string[],
  fallback: number,
  min: number,
  max: number
) {
  const item = getAt(value, path);
  if (typeof item !== "number" || !Number.isFinite(item)) return fallback;
  return Math.min(max, Math.max(min, Math.round(item)));
}

function enumAt<T extends string>(
  value: Record<string, unknown>,
  path: string[],
  options: readonly T[],
  fallback: T
) {
  const item = getAt(value, path);
  return typeof item === "string" && options.includes(item as T)
    ? (item as T)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
