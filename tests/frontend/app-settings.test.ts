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
      storePath: "/Volumes/Workspace/OxideDrivers",
    });
  });

  it("normalizes SQL completion casing, aliases, and local usage ranking", () => {
    expect(DEFAULT_APP_SETTINGS.editor.sqlCompletion).toEqual({
      keywordCase: "upper",
      tableAlias: "none",
      rankByUsage: true,
      appendSpace: true,
    });
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
    ).toEqual({
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

  it("keeps same-side tools mutually exclusive and restores recent state", () => {
    const assistant = openSideToolWindow(
      DEFAULT_APP_SETTINGS.workbench,
      "assistant",
    );
    const commit = openSideToolWindow(assistant, "commit");

    expect(toolWindowAtSide(commit, "right")).toBe("commit");
    expect(commit.layout.visibility.assistant).toBe(false);
    expect(commit.layout.visibility.commit).toBe(true);

    const restored = closeSideToolWindow(commit, "commit");
    expect(toolWindowAtSide(restored, "right")).toBe("assistant");
    expect(restored.layout.visibility.assistant).toBe(true);
  });
});
