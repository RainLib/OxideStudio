import { normalizeColumnFormatterRecord } from "@/features/data-grid/model/columnFormatter";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/model/defaultSettings";
import {
  normalizedActiveSideToolWindow,
  normalizedPinnedTitleTools,
  normalizedSideHistory,
  normalizedToolWindows,
  normalizeSharedSidePanelVisibility,
} from "@/features/settings/model/normalizeWorkbenchSettings";
import { type AppSettings } from "@/features/settings/model/settingsTypes";
import {
  boolAt,
  boundedHttpsUrlAt,
  enumAt,
  getAt,
  isRecord,
  normalizedCommandPolicy,
  normalizeKeymap,
  numberAt,
  recordAt,
  sqlSnippetsAt,
  stringAt,
  vimMappingsAt,
} from "@/features/settings/model/settingsValueReaders";

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
          sqlLibrary: boolAt(
            raw,
            ["workbench", "layout", "visibility", "sqlLibrary"],
            defaults.workbench.layout.visibility.sqlLibrary,
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
      tabPlacement: enumAt(
        raw,
        ["editor", "tabPlacement"],
        ["top", "bottom", "left", "right"],
        defaults.editor.tabPlacement,
      ),
      tabGroupMode: enumAt(
        raw,
        ["editor", "tabGroupMode"],
        ["none", "database-type", "connection"],
        defaults.editor.tabGroupMode,
      ),
      tabSortMode: enumAt(
        raw,
        ["editor", "tabSortMode"],
        ["manual", "created-asc", "title-asc"],
        defaults.editor.tabSortMode,
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
      showTableDdlHoverPreview: boolAt(
        raw,
        ["editor", "showTableDdlHoverPreview"],
        defaults.editor.showTableDdlHoverPreview,
      ),
      refreshDdlOnOpen: boolAt(
        raw,
        ["editor", "refreshDdlOnOpen"],
        defaults.editor.refreshDdlOnOpen,
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
      showColumnTypesInHeader: boolAt(
        raw,
        ["dataGrid", "showColumnTypesInHeader"],
        defaults.dataGrid.showColumnTypesInHeader,
      ),
      showColumnCommentsInHeader: boolAt(
        raw,
        ["dataGrid", "showColumnCommentsInHeader"],
        defaults.dataGrid.showColumnCommentsInHeader,
      ),
      columnFormatters: normalizeColumnFormatterRecord(
        getAt(raw, ["dataGrid", "columnFormatters"]),
      ),
    },
    databaseExplorer: {
      activationMode: enumAt(
        raw,
        ["databaseExplorer", "activationMode"],
        ["single", "double"],
        defaults.databaseExplorer.activationMode,
      ),
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
      showHoverTooltips: boolAt(
        raw,
        ["databaseExplorer", "showHoverTooltips"],
        defaults.databaseExplorer.showHoverTooltips,
      ),
      allowHorizontalScroll: boolAt(
        raw,
        ["databaseExplorer", "allowHorizontalScroll"],
        defaults.databaseExplorer.allowHorizontalScroll,
      ),
      objectBrowserViewMode: enumAt(
        raw,
        ["databaseExplorer", "objectBrowserViewMode"],
        ["list", "grid"],
        defaults.databaseExplorer.objectBrowserViewMode,
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
