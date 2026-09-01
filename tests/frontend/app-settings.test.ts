import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "@/lib/appSettings";
import {
  closeSideToolWindow,
  moveSideToolWindow,
  openSideToolWindow,
  toolWindowAtSide,
} from "@/lib/workbenchLayout";

describe("app settings workbench layout", () => {
  it("keeps UI, editor, and data grid typography aligned by default", () => {
    expect(DEFAULT_APP_SETTINGS.appearance.uiFontSize).toBe(12);
    expect(DEFAULT_APP_SETTINGS.appearance.locale).toBe("system");
    expect(DEFAULT_APP_SETTINGS.appearance.stylePreset).toBe("oxide");
    expect(DEFAULT_APP_SETTINGS.appearance.accent).toBe("blue");
    expect(DEFAULT_APP_SETTINGS.editor.fontSize).toBe(12);
    expect(DEFAULT_APP_SETTINGS.dataGrid.fontSize).toBe(12);
  });

  it("opens only Database Explorer in the default workspace", () => {
    expect(DEFAULT_APP_SETTINGS.workbench.layout.visibility).toEqual({
      databaseExplorer: true,
      projectFiles: false,
      assistant: false,
      commit: false,
      versionControl: false,
      results: false,
    });
    expect(DEFAULT_APP_SETTINGS.workbench.layout.pinnedTitleTools).toEqual([]);
  });

  it("assigns discoverable shortcuts to every title-bar tool", () => {
    expect(DEFAULT_APP_SETTINGS.keymap).toMatchObject({
      "workbench.toggleDatabaseExplorer": ["mod+1"],
      "workbench.toggleAssistant": ["mod+2"],
      "workbench.openProjectFiles": ["mod+4"],
      "workbench.toggleCommit": ["mod+5"],
      "workbench.toggleVersionControl": ["mod+6"],
      "editor.insertLineBelow": ["shift+enter"],
    });
  });

  it("normalizes pinned title tools and drops unsupported or disabled entries", () => {
    const settings = normalizeAppSettings({
      workbench: {
        layout: {
          pinnedTitleTools: [
            "commit",
            "commit",
            "assistant",
            "versionControl",
          ],
        },
        toolWindows: {
          versionControl: { enabled: false, side: "right" },
        },
      },
    });

    expect(settings.workbench.layout.pinnedTitleTools).toEqual(["commit"]);
  });

  it("normalizes typography and data grid zoom bounds", () => {
    const settings = normalizeAppSettings({
      appearance: { uiFontSize: 40, locale: "unsupported" },
      editor: { fontSize: 4 },
      dataGrid: { fontSize: 30, rowHeight: 10, zoomPercent: 240 },
    });

    expect(settings.appearance.uiFontSize).toBe(20);
    expect(settings.appearance.locale).toBe("system");
    expect(settings.appearance.stylePreset).toBe("oxide");
    expect(settings.appearance.fontFamily).toBe("system");
    expect(settings.editor.fontSize).toBe(10);
    expect(settings.dataGrid.fontSize).toBe(20);
    expect(settings.dataGrid.rowHeight).toBe(22);
    expect(settings.dataGrid.zoomPercent).toBe(160);
  });

  it("keeps supported appearance customization and safely rejects invalid values", () => {
    const settings = normalizeAppSettings({
      appearance: {
        stylePreset: "terminal",
        accent: "teal",
        fontFamily: "mono",
        density: "comfortable",
        chromeGradient: "subtle",
        reduceMotion: true,
      },
    });

    expect(settings.appearance).toMatchObject({
      stylePreset: "terminal",
      accent: "teal",
      fontFamily: "mono",
      density: "comfortable",
      chromeGradient: "subtle",
      reduceMotion: true,
    });
    expect(
      normalizeAppSettings({ appearance: { accent: "neon", density: "large" } })
        .appearance,
    ).toMatchObject({ accent: "blue", density: "compact" });
  });

  it("keeps supported explicit application locales", () => {
    expect(
      normalizeAppSettings({ appearance: { locale: "zh-CN" } }).appearance
        .locale,
    ).toBe("zh-CN");
    expect(
      normalizeAppSettings({ appearance: { locale: "en-US" } }).appearance
        .locale,
    ).toBe("en-US");
  });

  it("normalizes Vim editor settings and drops invalid mappings", () => {
    const settings = normalizeAppSettings({
      editor: {
        keybindingMode: "vim",
        vim: {
          leader: "<Space>",
          relativeLineNumbers: false,
          mappings: [
            {
              mode: "normal",
              lhs: "<leader>f",
              rhs: "/FROM<Enter>",
              recursive: false,
            },
            { mode: "invalid", lhs: "x", rhs: "dd" },
          ],
        },
      },
    });

    expect(settings.editor.keybindingMode).toBe("vim");
    expect(settings.editor.vim).toEqual({
      leader: "<Space>",
      relativeLineNumbers: false,
      mappings: [
        {
          mode: "normal",
          lhs: "<leader>f",
          rhs: "/FROM<Enter>",
          recursive: false,
        },
      ],
    });
  });

  it("keeps inline completion opt-in while preserving safe context defaults", () => {
    expect(DEFAULT_APP_SETTINGS.editor.inlineCompletion).toEqual({
      enabled: false,
      automaticSuggestions: true,
      includeSchemaMetadata: true,
      includeProjectContext: false,
    });
    const settings = normalizeAppSettings({
      editor: {
        inlineCompletion: {
          enabled: true,
          automaticSuggestions: false,
          includeSchemaMetadata: false,
          includeProjectContext: true,
        },
      },
    });
    expect(settings.editor.inlineCompletion).toEqual({
      enabled: true,
      automaticSuggestions: false,
      includeSchemaMetadata: false,
      includeProjectContext: true,
    });
  });

  it("normalizes editor tab placement, grouping, and sorting", () => {
    expect(DEFAULT_APP_SETTINGS.editor).toMatchObject({
      tabPlacement: "top",
      tabGroupMode: "none",
      tabSortMode: "manual",
    });
    expect(
      normalizeAppSettings({
        editor: {
          tabPlacement: "right",
          tabGroupMode: "connection",
          tabSortMode: "title-asc",
        },
      }).editor,
    ).toMatchObject({
      tabPlacement: "right",
      tabGroupMode: "connection",
      tabSortMode: "title-asc",
    });
    expect(
      normalizeAppSettings({
        editor: {
          tabPlacement: "center",
          tabGroupMode: "schema",
          tabSortMode: "updated-desc",
        },
      }).editor,
    ).toMatchObject({
      tabPlacement: "top",
      tabGroupMode: "none",
      tabSortMode: "manual",
    });
  });

  it("keeps connection notes visible by default and persists an explicit opt-out", () => {
    expect(DEFAULT_APP_SETTINGS.databaseExplorer.showConnectionNotes).toBe(true);
    expect(
      normalizeAppSettings({
        databaseExplorer: { showConnectionNotes: false },
      }).databaseExplorer.showConnectionNotes,
    ).toBe(false);
    expect(
      normalizeAppSettings({
        databaseExplorer: { showConnectionNotes: "no" },
      }).databaseExplorer.showConnectionNotes,
    ).toBe(true);
  });

  it("keeps blank-line full-document execution explicitly opt-in", () => {
    expect(DEFAULT_APP_SETTINGS.editor.executeAllOnBlankLine).toBe(false);
    expect(
      normalizeAppSettings({
        editor: { executeAllOnBlankLine: true },
      }).editor.executeAllOnBlankLine,
    ).toBe(true);
    expect(
      normalizeAppSettings({
        editor: { executeAllOnBlankLine: "yes" },
      }).editor.executeAllOnBlankLine,
    ).toBe(false);
  });

  it("keeps table DDL hover enabled while avoiding automatic refresh requests", () => {
    expect(DEFAULT_APP_SETTINGS.editor.showTableDdlHoverPreview).toBe(true);
    expect(DEFAULT_APP_SETTINGS.editor.refreshDdlOnOpen).toBe(false);
    expect(
      normalizeAppSettings({
        editor: {
          showTableDdlHoverPreview: false,
          refreshDdlOnOpen: true,
        },
      }).editor,
    ).toMatchObject({
      showTableDdlHoverPreview: false,
      refreshDdlOnOpen: true,
    });
    expect(
      normalizeAppSettings({
        editor: {
          showTableDdlHoverPreview: "yes",
          refreshDdlOnOpen: "yes",
        },
      }).editor,
    ).toMatchObject({
      showTableDdlHoverPreview: true,
      refreshDdlOnOpen: false,
    });
  });

  it("normalizes SQL formatter layout preferences", () => {
    expect(DEFAULT_APP_SETTINGS.editor.sqlFormatting).toEqual({
      keywordCase: "upper",
      functionCase: "preserve",
      logicalOperatorNewline: "before",
      fromClauseLayout: "newLine",
    });
    expect(
      normalizeAppSettings({
        editor: {
          sqlFormatting: {
            logicalOperatorNewline: "none",
            fromClauseLayout: "sameLine",
          },
        },
      }).editor.sqlFormatting,
    ).toEqual({
      keywordCase: "upper",
      functionCase: "preserve",
      logicalOperatorNewline: "none",
      fromClauseLayout: "sameLine",
    });
    expect(
      normalizeAppSettings({
        editor: {
          sqlFormatting: {
            logicalOperatorNewline: "around",
            fromClauseLayout: "compact",
          },
        },
      }).editor.sqlFormatting,
    ).toEqual(DEFAULT_APP_SETTINGS.editor.sqlFormatting);
  });

  it("persists only an HTTPS credential-free driver catalog location", () => {
    expect(
      normalizeAppSettings({
        drivers: { catalogUrl: "https://drivers.example.com/catalog.json" },
      }).drivers.catalogUrl,
    ).toBe("https://drivers.example.com/catalog.json");
    expect(
      normalizeAppSettings({
        drivers: { catalogUrl: "http://drivers.example.com/catalog.json" },
      }).drivers.catalogUrl,
    ).toBe("");
    expect(
      normalizeAppSettings({
        drivers: {
          catalogUrl: "https://user:password@drivers.example.com/catalog.json",
        },
      }).drivers.catalogUrl,
    ).toBe("");
  });

  it("preserves the restart-applied Driver Store location", () => {
    expect(
      normalizeAppSettings({
        drivers: {
          catalogUrl: "https://drivers.example.com/catalog.json",
          storePath: "/Volumes/Workspace/OxideDrivers",
        },
      }).drivers,
    ).toEqual({
      catalogUrl: "https://drivers.example.com/catalog.json",
      sqliteWorkerBaseUrl: "",
      storePath: "/Volumes/Workspace/OxideDrivers",
    });
  });

  it("normalizes SQL completion casing, aliases, and local usage ranking", () => {
    expect(DEFAULT_APP_SETTINGS.editor.sqlCompletion).toMatchObject({
      keywordCase: "upper",
      tableAlias: "none",
      rankByUsage: true,
      appendSpace: true,
    });
    expect(DEFAULT_APP_SETTINGS.editor.sqlCompletion.snippets.length).toBeGreaterThan(0);
    expect(
      normalizeAppSettings({
        editor: {
          sqlCompletion: {
            keywordCase: "lower",
            tableAlias: "initials",
            rankByUsage: false,
            appendSpace: false,
          },
        },
      }).editor.sqlCompletion,
    ).toMatchObject({
      keywordCase: "lower",
      tableAlias: "initials",
      rankByUsage: false,
      appendSpace: false,
    });
    expect(
      normalizeAppSettings({
        editor: {
          sqlCompletion: {
            keywordCase: "invalid",
            tableAlias: "verbose",
            rankByUsage: "yes",
            appendSpace: "yes",
          },
        },
      }).editor.sqlCompletion,
    ).toEqual(DEFAULT_APP_SETTINGS.editor.sqlCompletion);
  });

  it("migrates legacy side visibility into tool window visibility", () => {
    const settings = normalizeAppSettings({
      workbench: {
        layout: {
          leftVisible: false,
          rightVisible: true,
          bottomVisible: false,
        },
      },
    });

    expect(settings.workbench.layout.visibility).toEqual({
      databaseExplorer: false,
      projectFiles: false,
      assistant: true,
      commit: false,
      versionControl: false,
      results: false,
    });
  });

  it("allows side tool windows to share a dock and keeps one active", () => {
    const settings = normalizeAppSettings({
      workbench: {
        toolWindows: {
          databaseExplorer: { enabled: true, side: "right" },
          assistant: { enabled: true, side: "right" },
          results: { enabled: true, side: "left" },
        },
      },
    });

    expect(settings.workbench.toolWindows.databaseExplorer.side).toBe("right");
    expect(settings.workbench.toolWindows.assistant.side).toBe("right");
    expect(settings.workbench.toolWindows.results.side).toBe("bottom");
    expect(toolWindowAtSide(settings.workbench, "right")).toBeNull();
  });

  it("normalizes stale persisted visibility so each shared side restores at most one panel", () => {
    const settings = normalizeAppSettings({
      workbench: {
        layout: {
          activeToolWindow: "commit",
          activeSideToolWindows: {
            left: "databaseExplorer",
            right: "commit",
          },
          visibility: {
            databaseExplorer: true,
            projectFiles: true,
            assistant: true,
            commit: true,
            versionControl: true,
            results: false,
          },
        },
        toolWindows: {
          projectFiles: { enabled: true, side: "left" },
        },
      },
    });

    expect(settings.workbench.layout.activeSideToolWindows).toEqual({
      left: "databaseExplorer",
      right: "commit",
    });
    expect(settings.workbench.layout.visibility).toMatchObject({
      databaseExplorer: true,
      projectFiles: false,
      assistant: false,
      commit: true,
      versionControl: false,
    });
    expect(settings.workbench.layout.activeToolWindow).toBe("commit");
  });

  it("honors the persisted active pane when old settings mark a shared side stale", () => {
    const settings = normalizeAppSettings({
      workbench: {
        toolWindows: {
          databaseExplorer: { enabled: true, side: "right" },
          assistant: { enabled: true, side: "right" },
        },
        layout: {
          activeSideToolWindows: { left: null, right: "assistant" },
          visibility: {
            databaseExplorer: true,
            assistant: true,
          },
        },
      },
    });

    expect(settings.workbench.layout.activeSideToolWindows.right).toBe("assistant");
    expect(settings.workbench.layout.visibility.databaseExplorer).toBe(false);
    expect(settings.workbench.layout.visibility.assistant).toBe(true);
  });

  it("moves a side tool window without moving other windows on that dock", () => {
    const moved = moveSideToolWindow(
      DEFAULT_APP_SETTINGS.workbench,
      "databaseExplorer",
      "right",
    );

    expect(moved.toolWindows.databaseExplorer.side).toBe("right");
    expect(moved.toolWindows.assistant.side).toBe("right");
    expect(toolWindowAtSide(moved, "right")).toBe("databaseExplorer");
    expect(moved.layout.visibility.assistant).toBe(false);
    expect(
      DEFAULT_APP_SETTINGS.workbench.toolWindows.databaseExplorer.side,
    ).toBe("left");
  });

  it("keeps same-side tools mutually exclusive and closes the shared panel", () => {
    const assistant = openSideToolWindow(
      DEFAULT_APP_SETTINGS.workbench,
      "assistant",
    );
    const commit = openSideToolWindow(assistant, "commit");

    expect(toolWindowAtSide(commit, "right")).toBe("commit");
    expect(commit.layout.visibility.assistant).toBe(false);
    expect(commit.layout.visibility.commit).toBe(true);

    const closed = closeSideToolWindow(commit, "commit");
    expect(toolWindowAtSide(closed, "right")).toBeNull();
    expect(closed.layout.visibility.assistant).toBe(false);
    expect(closed.layout.visibility.commit).toBe(false);
    expect(closed.layout.activeSideToolWindows.right).toBeNull();
    expect(closed.layout.sideHistory.right).toEqual([]);
  });

  it("clears stale visibility flags when closing a shared panel", () => {
    const assistant = openSideToolWindow(
      DEFAULT_APP_SETTINGS.workbench,
      "assistant",
    );
    const stale = {
      ...assistant,
      layout: {
        ...assistant.layout,
        visibility: {
          ...assistant.layout.visibility,
          projectFiles: true,
          commit: true,
        },
      },
    };

    const closed = closeSideToolWindow(stale, "assistant");
    expect(toolWindowAtSide(closed, "right")).toBeNull();
    expect(closed.layout.visibility.assistant).toBe(false);
    expect(closed.layout.visibility.projectFiles).toBe(false);
    expect(closed.layout.visibility.commit).toBe(false);
    expect(closed.layout.visibility.versionControl).toBe(false);
    expect(closed.layout.visibility.databaseExplorer).toBe(true);
  });

  it("uses the same close semantics for the shared first panel", () => {
    const firstPanelSettings = moveSideToolWindow(
      DEFAULT_APP_SETTINGS.workbench,
      "projectFiles",
      "left",
    );
    const database = openSideToolWindow(
      firstPanelSettings,
      "databaseExplorer",
    );
    const files = openSideToolWindow(database, "projectFiles");

    expect(toolWindowAtSide(files, "left")).toBe("projectFiles");
    expect(files.layout.visibility.databaseExplorer).toBe(false);

    const closed = closeSideToolWindow(files, "projectFiles");
    expect(toolWindowAtSide(closed, "left")).toBeNull();
    expect(closed.layout.visibility.databaseExplorer).toBe(false);
    expect(closed.layout.visibility.projectFiles).toBe(false);
    expect(closed.layout.activeSideToolWindows.left).toBeNull();
    expect(closed.layout.sideHistory.left).toEqual([]);
  });
});
