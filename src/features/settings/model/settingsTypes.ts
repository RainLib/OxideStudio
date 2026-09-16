import { type ColumnFormatterConfig } from "@/features/data-grid/model/columnFormatter";
import { type SqlSnippetSetting } from "@/features/query-editor/model/sqlCommandSnippets";
import type { AiPlannerKind } from "@/store/useAiSettingsStore";

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
  | "sqlLibrary"
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

export type ExplorerActivationMode = "single" | "double";

export type TabPlacement = "top" | "bottom" | "left" | "right";

export type TabGroupMode = "none" | "database-type" | "connection";

export type TabSortMode = "manual" | "created-asc" | "title-asc";

export type AppearanceStylePreset =
  | "oxide"
  | "graphite"
  | "violet"
  | "terminal";

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
  sqlLibrary: {
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
    tabPlacement: TabPlacement;
    tabGroupMode: TabGroupMode;
    tabSortMode: TabSortMode;
    wordWrap: "off" | "on" | "wordWrapColumn" | "bounded";
    minimap: boolean;
    confirmDestructiveSql: boolean;
    executeAllOnBlankLine: boolean;
    showTableDdlHoverPreview: boolean;
    refreshDdlOnOpen: boolean;
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
    showColumnTypesInHeader: boolean;
    showColumnCommentsInHeader: boolean;
    columnFormatters: Record<string, ColumnFormatterConfig>;
  };
  databaseExplorer: {
    activationMode: ExplorerActivationMode;
    refreshMode: "manual" | "cache-first";
    showOnlySelectedSchemas: boolean;
    showCacheBadges: boolean;
    showConnectionNotes: boolean;
    /** Disable object-detail hover popups without removing keyboard labels. */
    showHoverTooltips: boolean;
    /** Let long tree labels use their natural width and expose horizontal scrolling. */
    allowHorizontalScroll: boolean;
    /** Shared presentation for database and schema object browser tabs. */
    objectBrowserViewMode: "list" | "grid";
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
