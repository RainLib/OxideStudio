import type { AiPlannerKind } from "@/store/useAiSettingsStore";
import {
  DEFAULT_SQL_COMMAND_SNIPPETS,
  type SqlSnippetSetting,
} from "@/features/query-editor/model/sqlCommandSnippets";

export type { SqlSnippetSetting };

export type VimMappingMode = "all" | "normal" | "insert" | "visual";

export type VimCustomMapping = {
  mode: VimMappingMode;
  lhs: string;
  rhs: string;
  recursive: boolean;
};

export type InlineCompletionSettings = {
  enabled: boolean;
  automaticSuggestions: boolean;
  includeSchemaMetadata: boolean;
  includeProjectContext: boolean;
};

export type SqlCompletionSettings = {
  triggerMode: "manual" | "require-prefix" | "positional";
  keywordCase: "upper" | "lower" | "preserve";
  functionCase: "upper" | "lower" | "preserve";
  tableAlias: "none" | "initials";
  rankByUsage: boolean;
  appendSpace: boolean;
  snippets: SqlSnippetSetting[];
};

export type SqlFormattingSettings = {
  keywordCase: "upper" | "lower" | "preserve";
  functionCase: "upper" | "lower" | "preserve";
  logicalOperatorNewline: "before" | "after" | "none";
  fromClauseLayout: "newLine" | "sameLine";
};

export type WorkbenchToolWindowId =
  | "databaseExplorer"
  | "projectFiles"
  | "assistant"
  | "commit"
  | "versionControl"
  | "results";

export type SideToolWindowId = Exclude<WorkbenchToolWindowId, "results">;

export type PinnableTitleToolId = Extract<
  SideToolWindowId,
  "commit" | "versionControl"
>;

export type WorkbenchSide = "left" | "right";

export type AppLocale = "system" | "en-US" | "zh-CN";
export type TableTabReuseMode = "always-new" | "same-table" | "active-tab";
export type AppearanceStylePreset = "oxide" | "graphite" | "violet" | "terminal";
export type AppearanceAccent = "blue" | "violet" | "teal" | "amber";
export type AppearanceFontFamily = "system" | "sans" | "mono";
export type AppearanceDensity = "compact" | "comfortable";
export type AppearanceChromeGradient = "immersive" | "subtle" | "off";

export type WorkbenchToolWindows = {
  databaseExplorer: {
    enabled: boolean;
    side: WorkbenchSide;
  };
  assistant: {
    enabled: boolean;
    side: WorkbenchSide;
  };
  projectFiles: {
    enabled: boolean;
    side: WorkbenchSide;
  };
  commit: {
    enabled: boolean;
    side: WorkbenchSide;
  };
  versionControl: {
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
    locale: AppLocale;
    stylePreset: AppearanceStylePreset;
    accent: AppearanceAccent;
    fontFamily: AppearanceFontFamily;
    density: AppearanceDensity;
    chromeGradient: AppearanceChromeGradient;
    reduceMotion: boolean;
  };
  workbench: {
    layout: {
      visibility: Record<WorkbenchToolWindowId, boolean>;
      leftWidth: number;
      rightWidth: number;
      bottomHeight: number;
      activeToolWindow: WorkbenchToolWindowId | "editor";
      activeSideToolWindows: Record<WorkbenchSide, SideToolWindowId | null>;
      sideHistory: Record<WorkbenchSide, SideToolWindowId[]>;
      pinnedTitleTools: PinnableTitleToolId[];
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
    executeAllOnBlankLine: boolean;
    sqlCompletion: SqlCompletionSettings;
    sqlFormatting: SqlFormattingSettings;
    inlineCompletion: InlineCompletionSettings;
    keybindingMode: "standard" | "vim";
    vim: {
      leader: string;
      relativeLineNumbers: boolean;
      mappings: VimCustomMapping[];
    };
  };
  dataGrid: {
    fontSize: number;
    rowHeight: number;
    zoomPercent: number;
    pageSize: number;
    readOnlyByDefault: boolean;
    tableTabReuseMode: TableTabReuseMode;
    copyIncludeHeaders: boolean;
    showTypeIcons: boolean;
  };
  databaseExplorer: {
    refreshMode: "manual" | "cache-first";
    showOnlySelectedSchemas: boolean;
    showCacheBadges: boolean;
    showConnectionNotes: boolean;
  };
  drivers: {
    /** HTTPS URL for the optional, signed external-driver discovery catalog. */
    catalogUrl: string;
    /** Restart-applied location of independently updateable driver packages. */
    storePath: string;
    /** HTTPS root containing signed, platform-specific SQLite SSH workers. */
    sqliteWorkerBaseUrl: string;
  };
  ai: {
    plannerKind: AiPlannerKind;
    shell: {
      commandPolicy: {
        version: 1;
        rules: Array<{
          id: string;
          action: "confirm" | "block";
          executables?: string[];
          argumentRegex?: string;
          cwdGlob?: string;
          sandboxModes?: Array<"workspace-write" | "unrestricted">;
          message?: string;
        }>;
      };
    };
  };
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appearance: {
    uiFontSize: 12,
    locale: "system",
    stylePreset: "oxide",
    accent: "blue",
    fontFamily: "system",
    density: "compact",
    chromeGradient: "immersive",
    reduceMotion: false,
  },
  workbench: {
    layout: {
      visibility: {
        databaseExplorer: true,
        projectFiles: false,
        assistant: false,
        commit: false,
        versionControl: false,
        results: false,
      },
      leftWidth: 400,
      rightWidth: 360,
      bottomHeight: 320,
      activeToolWindow: "editor",
      activeSideToolWindows: {
        left: "databaseExplorer",
        right: "assistant",
      },
      sideHistory: {
        left: [],
        right: [],
      },
      pinnedTitleTools: [],
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
      projectFiles: {
        enabled: true,
        side: "right",
      },
      commit: {
        enabled: true,
        side: "right",
      },
      versionControl: {
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
    "editor.splitRight": ["mod+\\"],
    "editor.splitDown": ["mod+shift+\\"],
    "query.newConsole": ["mod+t"],
    "query.reopenClosed": ["mod+shift+t"],
    "query.closeTab": ["mod+w"],
    "query.run": ["mod+enter"],
    "query.runCurrentStatement": ["mod+shift+enter"],
    "query.format": ["mod+l"],
    "editor.insertLineBelow": ["shift+enter"],
    "editor.inlineCompletion.trigger": ["alt+\\"],
    "editor.inlineCompletion.accept": ["tab"],
    "editor.inlineCompletion.acceptNextWord": ["mod+arrowright"],
    "editor.inlineCompletion.hide": ["escape"],
    "file.save": ["mod+s"],
    "workbench.toggleDatabaseExplorer": ["mod+1"],
    "workbench.toggleAssistant": ["mod+2"],
    "workbench.toggleResults": ["mod+3"],
    "workbench.openProjectFiles": ["mod+4"],
    "workbench.toggleCommit": ["mod+5"],
    "workbench.toggleVersionControl": ["mod+6"],
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
    executeAllOnBlankLine: false,
    sqlCompletion: {
      triggerMode: "positional",
      keywordCase: "upper",
      functionCase: "preserve",
      tableAlias: "none",
      rankByUsage: true,
      appendSpace: true,
      snippets: DEFAULT_SQL_COMMAND_SNIPPETS.map((snippet) => ({ ...snippet })),
    },
    sqlFormatting: {
      keywordCase: "upper",
      functionCase: "preserve",
      logicalOperatorNewline: "before",
      fromClauseLayout: "newLine",
    },
    inlineCompletion: {
      enabled: false,
      automaticSuggestions: true,
      includeSchemaMetadata: true,
      includeProjectContext: false,
    },
    keybindingMode: "standard",
    vim: {
      leader: "\\",
      relativeLineNumbers: true,
      mappings: [],
    },
  },
  dataGrid: {
    fontSize: 12,
    rowHeight: 28,
    zoomPercent: 100,
    pageSize: 500,
    readOnlyByDefault: false,
    tableTabReuseMode: "same-table",
    copyIncludeHeaders: true,
    showTypeIcons: true,
  },
  databaseExplorer: {
    refreshMode: "cache-first",
    showOnlySelectedSchemas: true,
    showCacheBadges: true,
    showConnectionNotes: true,
  },
  drivers: {
    catalogUrl: "",
    storePath: "",
    sqliteWorkerBaseUrl: "",
  },
  ai: {
    plannerKind: "model",
    shell: {
      commandPolicy: {
        version: 1,
        rules: [],
      },
    },
  },
};

const STARTUP_APPEARANCE_CACHE_KEY = "oxide-studio-appearance-cache-v1";

export function readStartupAppearanceCache(): AppSettings["appearance"] {
  if (typeof window === "undefined") {
    return DEFAULT_APP_SETTINGS.appearance;
  }
  try {
    const cached = window.localStorage.getItem(STARTUP_APPEARANCE_CACHE_KEY);
    if (!cached) return DEFAULT_APP_SETTINGS.appearance;
    return normalizeAppSettings({ appearance: JSON.parse(cached) }).appearance;
  } catch {
    return DEFAULT_APP_SETTINGS.appearance;
  }
}

export function writeStartupAppearanceCache(
  appearance: AppSettings["appearance"],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STARTUP_APPEARANCE_CACHE_KEY,
      JSON.stringify(appearance),
    );
  } catch {
    // This cache is an optional first-paint optimization. The persisted Tauri
    // settings document remains the source of truth.
  }
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const raw = isRecord(value) ? value : {};
  const defaults = DEFAULT_APP_SETTINGS;
  const toolWindows = normalizedToolWindows(raw, defaults);

  const normalized: AppSettings = {
    appearance: {
      uiFontSize: numberAt(
        raw,
        ["appearance", "uiFontSize"],
        defaults.appearance.uiFontSize,
        10,
        20,
      ),
      locale: enumAt(
        raw,
        ["appearance", "locale"],
        ["system", "en-US", "zh-CN"],
        defaults.appearance.locale,
      ),
      stylePreset: enumAt(
        raw,
        ["appearance", "stylePreset"],
        ["oxide", "graphite", "violet", "terminal"],
        defaults.appearance.stylePreset,
      ),
      accent: enumAt(
        raw,
        ["appearance", "accent"],
        ["blue", "violet", "teal", "amber"],
        defaults.appearance.accent,
      ),
      fontFamily: enumAt(
        raw,
        ["appearance", "fontFamily"],
        ["system", "sans", "mono"],
        defaults.appearance.fontFamily,
      ),
      density: enumAt(
        raw,
        ["appearance", "density"],
        ["compact", "comfortable"],
        defaults.appearance.density,
      ),
      chromeGradient: enumAt(
        raw,
        ["appearance", "chromeGradient"],
        ["immersive", "subtle", "off"],
        defaults.appearance.chromeGradient,
      ),
      reduceMotion: boolAt(
        raw,
        ["appearance", "reduceMotion"],
        defaults.appearance.reduceMotion,
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
              defaults.workbench.layout.visibility.databaseExplorer,
            ),
          ),
          projectFiles: boolAt(
            raw,
            ["workbench", "layout", "visibility", "projectFiles"],
            defaults.workbench.layout.visibility.projectFiles,
          ),
          assistant: boolAt(
            raw,
            ["workbench", "layout", "visibility", "assistant"],
            boolAt(
              raw,
              ["workbench", "layout", "rightVisible"],
              defaults.workbench.layout.visibility.assistant,
            ),
          ),
          commit: boolAt(
            raw,
            ["workbench", "layout", "visibility", "commit"],
            defaults.workbench.layout.visibility.commit,
          ),
          versionControl: boolAt(
            raw,
            ["workbench", "layout", "visibility", "versionControl"],
            defaults.workbench.layout.visibility.versionControl,
          ),
          results: boolAt(
            raw,
            ["workbench", "layout", "visibility", "results"],
            boolAt(
              raw,
              ["workbench", "layout", "bottomVisible"],
              defaults.workbench.layout.visibility.results,
            ),
          ),
        },
        leftWidth: numberAt(
          raw,
          ["workbench", "layout", "leftWidth"],
          defaults.workbench.layout.leftWidth,
          240,
          760,
        ),
        rightWidth: numberAt(
          raw,
          ["workbench", "layout", "rightWidth"],
          defaults.workbench.layout.rightWidth,
          260,
          640,
        ),
        bottomHeight: numberAt(
          raw,
          ["workbench", "layout", "bottomHeight"],
          defaults.workbench.layout.bottomHeight,
          140,
          720,
        ),
        activeToolWindow: enumAt(
          raw,
          ["workbench", "layout", "activeToolWindow"],
          [
            "databaseExplorer",
            "projectFiles",
            "assistant",
            "commit",
            "versionControl",
            "results",
            "editor",
          ],
          defaults.workbench.layout.activeToolWindow,
        ),
        activeSideToolWindows: {
          left: normalizedActiveSideToolWindow(raw, toolWindows, "left"),
          right: normalizedActiveSideToolWindow(raw, toolWindows, "right"),
        },
        sideHistory: {
          left: normalizedSideHistory(raw, toolWindows, "left"),
          right: normalizedSideHistory(raw, toolWindows, "right"),
        },
        pinnedTitleTools: normalizedPinnedTitleTools(raw, toolWindows),
      },
      toolWindows,
    },
    keymap: normalizeKeymap(recordAt(raw, ["keymap"]), defaults.keymap),
    editor: {
      fontSize: numberAt(
        raw,
        ["editor", "fontSize"],
        defaults.editor.fontSize,
        10,
        24,
      ),
      tabSize: numberAt(
        raw,
        ["editor", "tabSize"],
        defaults.editor.tabSize,
        2,
        8,
      ),
      wordWrap: enumAt(
        raw,
        ["editor", "wordWrap"],
        ["off", "on", "wordWrapColumn", "bounded"],
        defaults.editor.wordWrap,
      ),
      minimap: boolAt(raw, ["editor", "minimap"], defaults.editor.minimap),
      confirmDestructiveSql: boolAt(
        raw,
        ["editor", "confirmDestructiveSql"],
        defaults.editor.confirmDestructiveSql,
      ),
      executeAllOnBlankLine: boolAt(
        raw,
        ["editor", "executeAllOnBlankLine"],
        defaults.editor.executeAllOnBlankLine,
      ),
      sqlCompletion: {
        triggerMode: enumAt(
          raw,
          ["editor", "sqlCompletion", "triggerMode"],
          ["manual", "require-prefix", "positional"],
          defaults.editor.sqlCompletion.triggerMode,
        ),
        keywordCase: enumAt(
          raw,
          ["editor", "sqlCompletion", "keywordCase"],
          ["upper", "lower", "preserve"],
          defaults.editor.sqlCompletion.keywordCase,
        ),
        functionCase: enumAt(
          raw,
          ["editor", "sqlCompletion", "functionCase"],
          ["upper", "lower", "preserve"],
          defaults.editor.sqlCompletion.functionCase,
        ),
        tableAlias: enumAt(
          raw,
          ["editor", "sqlCompletion", "tableAlias"],
          ["none", "initials"],
          defaults.editor.sqlCompletion.tableAlias,
        ),
        rankByUsage: boolAt(
          raw,
          ["editor", "sqlCompletion", "rankByUsage"],
          defaults.editor.sqlCompletion.rankByUsage,
        ),
        appendSpace: boolAt(
          raw,
          ["editor", "sqlCompletion", "appendSpace"],
          defaults.editor.sqlCompletion.appendSpace,
        ),
        snippets: sqlSnippetsAt(
          raw,
          ["editor", "sqlCompletion", "snippets"],
          defaults.editor.sqlCompletion.snippets,
        ),
      },
      sqlFormatting: {
        keywordCase: enumAt(
          raw,
          ["editor", "sqlFormatting", "keywordCase"],
          ["upper", "lower", "preserve"],
          enumAt(
            raw,
            ["editor", "sqlCompletion", "keywordCase"],
            ["upper", "lower", "preserve"],
            defaults.editor.sqlFormatting.keywordCase,
          ),
        ),
        functionCase: enumAt(
          raw,
          ["editor", "sqlFormatting", "functionCase"],
          ["upper", "lower", "preserve"],
          enumAt(
            raw,
            ["editor", "sqlCompletion", "functionCase"],
            ["upper", "lower", "preserve"],
            defaults.editor.sqlFormatting.functionCase,
          ),
        ),
        logicalOperatorNewline: enumAt(
          raw,
          ["editor", "sqlFormatting", "logicalOperatorNewline"],
          ["before", "after", "none"],
          defaults.editor.sqlFormatting.logicalOperatorNewline,
        ),
        fromClauseLayout: enumAt(
          raw,
          ["editor", "sqlFormatting", "fromClauseLayout"],
          ["newLine", "sameLine"],
          defaults.editor.sqlFormatting.fromClauseLayout,
        ),
      },
      inlineCompletion: {
        enabled: boolAt(
          raw,
          ["editor", "inlineCompletion", "enabled"],
          defaults.editor.inlineCompletion.enabled,
        ),
        automaticSuggestions: boolAt(
          raw,
          ["editor", "inlineCompletion", "automaticSuggestions"],
          defaults.editor.inlineCompletion.automaticSuggestions,
        ),
        includeSchemaMetadata: boolAt(
          raw,
          ["editor", "inlineCompletion", "includeSchemaMetadata"],
          defaults.editor.inlineCompletion.includeSchemaMetadata,
        ),
        includeProjectContext: boolAt(
          raw,
          ["editor", "inlineCompletion", "includeProjectContext"],
          defaults.editor.inlineCompletion.includeProjectContext,
        ),
      },
      keybindingMode: enumAt(
        raw,
        ["editor", "keybindingMode"],
        ["standard", "vim"],
        defaults.editor.keybindingMode,
      ),
      vim: {
        leader: stringAt(
          raw,
          ["editor", "vim", "leader"],
          defaults.editor.vim.leader,
          16,
        ),
        relativeLineNumbers: boolAt(
          raw,
          ["editor", "vim", "relativeLineNumbers"],
          defaults.editor.vim.relativeLineNumbers,
        ),
        mappings: vimMappingsAt(raw, ["editor", "vim", "mappings"]),
      },
    },
    dataGrid: {
      fontSize: numberAt(
        raw,
        ["dataGrid", "fontSize"],
        defaults.dataGrid.fontSize,
        10,
        20,
      ),
      rowHeight: numberAt(
        raw,
        ["dataGrid", "rowHeight"],
        defaults.dataGrid.rowHeight,
        22,
        48,
      ),
      zoomPercent: numberAt(
        raw,
        ["dataGrid", "zoomPercent"],
        defaults.dataGrid.zoomPercent,
        70,
        160,
      ),
      pageSize: numberAt(
        raw,
        ["dataGrid", "pageSize"],
        defaults.dataGrid.pageSize,
        50,
        5000,
      ),
      readOnlyByDefault: boolAt(
        raw,
        ["dataGrid", "readOnlyByDefault"],
        defaults.dataGrid.readOnlyByDefault,
      ),
      tableTabReuseMode: enumAt(
        raw,
        ["dataGrid", "tableTabReuseMode"],
        ["always-new", "same-table", "active-tab"],
        defaults.dataGrid.tableTabReuseMode,
      ),
      copyIncludeHeaders: boolAt(
        raw,
        ["dataGrid", "copyIncludeHeaders"],
        defaults.dataGrid.copyIncludeHeaders,
      ),
      showTypeIcons: boolAt(
        raw,
        ["dataGrid", "showTypeIcons"],
        defaults.dataGrid.showTypeIcons,
      ),
    },
    databaseExplorer: {
      refreshMode: enumAt(
        raw,
        ["databaseExplorer", "refreshMode"],
        ["manual", "cache-first"],
        defaults.databaseExplorer.refreshMode,
      ),
      showOnlySelectedSchemas: boolAt(
        raw,
        ["databaseExplorer", "showOnlySelectedSchemas"],
        defaults.databaseExplorer.showOnlySelectedSchemas,
      ),
      showCacheBadges: boolAt(
        raw,
        ["databaseExplorer", "showCacheBadges"],
        defaults.databaseExplorer.showCacheBadges,
      ),
      showConnectionNotes: boolAt(
        raw,
        ["databaseExplorer", "showConnectionNotes"],
        defaults.databaseExplorer.showConnectionNotes,
      ),
    },
    drivers: {
      catalogUrl: boundedHttpsUrlAt(
        raw,
        ["drivers", "catalogUrl"],
        defaults.drivers.catalogUrl,
      ),
      storePath: stringAt(
        raw,
        ["drivers", "storePath"],
        defaults.drivers.storePath,
        4096,
      ),
      sqliteWorkerBaseUrl: boundedHttpsUrlAt(
        raw,
        ["drivers", "sqliteWorkerBaseUrl"],
        defaults.drivers.sqliteWorkerBaseUrl,
      ),
    },
    ai: {
      plannerKind: enumAt(
        raw,
        ["ai", "plannerKind"],
        ["model", "langgraph", "local"],
        defaults.ai.plannerKind,
      ),
      shell: {
        commandPolicy: normalizedCommandPolicy(raw),
      },
    },
  };

  return normalizeSharedSidePanelVisibility(normalized, raw);
}

/**
 * A first/secondary side is a single shared surface. Older persisted settings
 * may still contain multiple `visibility` flags on the same side, which made
 * settings controls claim that several panes were open even though runtime
 * rendering can display only one. Pick one deterministic active pane and
 * clear every sibling before the settings ever reach the workspace store.
 */
function normalizeSharedSidePanelVisibility(
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
      requested &&
      visibleCandidates.includes(requested)
        ? requested
        : visibleCandidates[0] ?? null;

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

function hasMovedFromDefaultSide(
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

function hasExplicitPersistedVisibility(
  raw: Record<string, unknown>,
  id: WorkbenchToolWindowId,
) {
  if (typeof getAt(raw, ["workbench", "layout", "visibility", id]) === "boolean") {
    return true;
  }
  if (id === "databaseExplorer") {
    return typeof getAt(raw, ["workbench", "layout", "leftVisible"]) === "boolean";
  }
  if (id === "assistant") {
    return typeof getAt(raw, ["workbench", "layout", "rightVisible"]) === "boolean";
  }
  return false;
}

function normalizedToolWindows(
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

function toolWindowSide(
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

const SIDE_TOOL_WINDOW_IDS: SideToolWindowId[] = [
  "databaseExplorer",
  "projectFiles",
  "assistant",
  "commit",
  "versionControl",
];

const PINNABLE_TITLE_TOOL_IDS: PinnableTitleToolId[] = [
  "commit",
  "versionControl",
];

function normalizedPinnedTitleTools(
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

function normalizedActiveSideToolWindow(
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

function normalizedSideHistory(
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

function normalizedCommandPolicy(
  raw: Record<string, unknown>,
): AppSettings["ai"]["shell"]["commandPolicy"] {
  const policy = recordAt(raw, ["ai", "shell", "commandPolicy"]);
  const sourceRules = Array.isArray(policy.rules) ? policy.rules : [];
  const rules = sourceRules
    .filter(isRecord)
    .slice(0, 100)
    .flatMap((rule) => {
      const id = typeof rule.id === "string" ? rule.id.trim().slice(0, 120) : "";
      const action: "confirm" | "block" | null = rule.action === "block" || rule.action === "confirm"
        ? rule.action
        : null;
      if (!id || !action) return [];
      const executables = Array.isArray(rule.executables)
        ? rule.executables
            .filter((value): value is string => typeof value === "string")
            .slice(0, 100)
            .map((value) => value.trim().slice(0, 512))
            .filter(Boolean)
        : undefined;
      const sandboxModes = Array.isArray(rule.sandboxModes)
        ? rule.sandboxModes.filter(
            (value): value is "workspace-write" | "unrestricted" =>
              value === "workspace-write" || value === "unrestricted",
          )
        : undefined;
      return [{
        id,
        action,
        ...(executables?.length ? { executables } : {}),
        ...(typeof rule.argumentRegex === "string"
          ? { argumentRegex: rule.argumentRegex.slice(0, 512) }
          : {}),
        ...(typeof rule.cwdGlob === "string"
          ? { cwdGlob: rule.cwdGlob.slice(0, 512) }
          : {}),
        ...(sandboxModes?.length ? { sandboxModes } : {}),
        ...(typeof rule.message === "string"
          ? { message: rule.message.slice(0, 500) }
          : {}),
      }];
    });
  return { version: 1, rules };
}

function normalizeKeymap(
  raw: Record<string, unknown>,
  defaults: Record<string, string[]>,
) {
  const keymap: Record<string, string[]> = { ...defaults };
  Object.entries(raw).forEach(([actionId, value]) => {
    if (Array.isArray(value)) {
      keymap[actionId] = value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim() !== "",
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

function boolAt(
  value: Record<string, unknown>,
  path: string[],
  fallback: boolean,
) {
  const item = getAt(value, path);
  return typeof item === "boolean" ? item : fallback;
}

function numberAt(
  value: Record<string, unknown>,
  path: string[],
  fallback: number,
  min: number,
  max: number,
) {
  const item = getAt(value, path);
  if (typeof item !== "number" || !Number.isFinite(item)) return fallback;
  return Math.min(max, Math.max(min, Math.round(item)));
}

function stringAt(
  value: Record<string, unknown>,
  path: string[],
  fallback: string,
  maxLength: number,
) {
  const item = getAt(value, path);
  if (typeof item !== "string") return fallback;
  const normalized = item.trim();
  return normalized && normalized.length <= maxLength ? normalized : fallback;
}

function boundedHttpsUrlAt(
  value: Record<string, unknown>,
  path: string[],
  fallback: string,
) {
  const item = getAt(value, path);
  if (typeof item !== "string") return fallback;
  const normalized = item.trim();
  if (!normalized) return "";
  if (normalized.length > 512) return fallback;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

function vimMappingsAt(
  value: Record<string, unknown>,
  path: string[],
): VimCustomMapping[] {
  const mappings = getAt(value, path);
  if (!Array.isArray(mappings)) return [];

  return mappings.flatMap((item): VimCustomMapping[] => {
    if (!isRecord(item)) return [];
    const mode = item.mode;
    const lhs = item.lhs;
    const rhs = item.rhs;
    if (
      !["all", "normal", "insert", "visual"].includes(String(mode)) ||
      typeof lhs !== "string" ||
      !lhs.trim() ||
      lhs.length > 128 ||
      typeof rhs !== "string" ||
      !rhs.trim() ||
      rhs.length > 512
    ) {
      return [];
    }

    return [
      {
        mode: mode as VimMappingMode,
        lhs: lhs.trim(),
        rhs: rhs.trim(),
        recursive: item.recursive !== false,
      },
    ];
  });
}

function sqlSnippetsAt(
  value: Record<string, unknown>,
  path: string[],
  fallback: SqlSnippetSetting[],
): SqlSnippetSetting[] {
  const snippets = getAt(value, path);
  if (!Array.isArray(snippets)) {
    return fallback.map((snippet) => ({ ...snippet }));
  }

  const ids = new Set<string>();
  const prefixes = new Set<string>();
  return snippets.slice(0, 100).flatMap((item): SqlSnippetSetting[] => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === "string" ? item.id.trim().slice(0, 120) : "";
    const prefix =
      typeof item.prefix === "string" ? item.prefix.trim().toLowerCase() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const detail = typeof item.detail === "string" ? item.detail.trim() : "";
    const body = typeof item.body === "string" ? item.body : "";
    if (
      !id ||
      ids.has(id) ||
      !/^[a-z_][a-z0-9_-]{0,31}$/u.test(prefix) ||
      prefixes.has(prefix) ||
      !label ||
      label.length > 120 ||
      detail.length > 240 ||
      !body.trim() ||
      body.length > 65_536
    ) {
      return [];
    }
    ids.add(id);
    prefixes.add(prefix);
    return [
      {
        id,
        prefix,
        label,
        detail: detail || "Custom SQL snippet",
        body,
        enabled: item.enabled !== false,
      },
    ];
  });
}

function enumAt<T extends string>(
  value: Record<string, unknown>,
  path: string[],
  options: readonly T[],
  fallback: T,
) {
  const item = getAt(value, path);
  return typeof item === "string" && options.includes(item as T)
    ? (item as T)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
