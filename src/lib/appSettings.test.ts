import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "./appSettings";

describe("SQL editor settings", () => {
  it("defaults old settings to positional completion", () => {
    const completion = normalizeAppSettings({}).editor.sqlCompletion;
    expect(completion.triggerMode).toBe("positional");
    expect(completion.functionCase).toBe("preserve");
    expect(normalizeAppSettings({}).editor.sqlFormatting).toMatchObject({
      keywordCase: "upper",
      functionCase: "preserve",
    });
  });

  it("persists a supported trigger mode and rejects unknown values", () => {
    expect(
      normalizeAppSettings({
        editor: { sqlCompletion: { triggerMode: "manual" } },
      }).editor.sqlCompletion.triggerMode,
    ).toBe("manual");
    expect(
      normalizeAppSettings({
        editor: { sqlCompletion: { triggerMode: "always" } },
      }).editor.sqlCompletion.triggerMode,
    ).toBe(DEFAULT_APP_SETTINGS.editor.sqlCompletion.triggerMode);
  });

  it("persists supported function casing and rejects unknown values", () => {
    expect(
      normalizeAppSettings({
        editor: { sqlCompletion: { functionCase: "lower" } },
      }).editor.sqlCompletion.functionCase,
    ).toBe("lower");
    expect(
      normalizeAppSettings({
        editor: { sqlCompletion: { functionCase: "title" } },
      }).editor.sqlCompletion.functionCase,
    ).toBe(DEFAULT_APP_SETTINGS.editor.sqlCompletion.functionCase);
  });

  it("migrates legacy completion casing into the shared formatter settings", () => {
    expect(
      normalizeAppSettings({
        editor: {
          sqlCompletion: { keywordCase: "lower", functionCase: "upper" },
        },
      }).editor.sqlFormatting,
    ).toMatchObject({ keywordCase: "lower", functionCase: "upper" });

    expect(
      normalizeAppSettings({
        editor: {
          sqlCompletion: { keywordCase: "lower", functionCase: "upper" },
          sqlFormatting: {
            keywordCase: "preserve",
            functionCase: "lower",
          },
        },
      }).editor.sqlFormatting,
    ).toMatchObject({ keywordCase: "preserve", functionCase: "lower" });
  });
});

describe("Database Explorer settings", () => {
  it("defaults object activation to a single click", () => {
    expect(normalizeAppSettings({}).databaseExplorer.activationMode).toBe(
      "single",
    );
  });

  it("persists supported activation modes and rejects unknown values", () => {
    expect(
      normalizeAppSettings({
        databaseExplorer: { activationMode: "double" },
      }).databaseExplorer.activationMode,
    ).toBe("double");
    expect(
      normalizeAppSettings({
        databaseExplorer: { activationMode: "hover" },
      }).databaseExplorer.activationMode,
    ).toBe("single");
  });

  it("persists the shared object browser presentation", () => {
    expect(
      normalizeAppSettings({
        databaseExplorer: { objectBrowserViewMode: "grid" },
      }).databaseExplorer.objectBrowserViewMode,
    ).toBe("grid");
    expect(
      normalizeAppSettings({
        databaseExplorer: { objectBrowserViewMode: "cards" },
      }).databaseExplorer.objectBrowserViewMode,
    ).toBe("list");
  });

  it("normalizes horizontal Explorer scrolling as an explicit opt-in", () => {
    expect(
      normalizeAppSettings({
        databaseExplorer: { allowHorizontalScroll: true },
      }).databaseExplorer.allowHorizontalScroll,
    ).toBe(true);
    expect(
      normalizeAppSettings({
        databaseExplorer: { allowHorizontalScroll: "true" },
      }).databaseExplorer.allowHorizontalScroll,
    ).toBe(false);
  });
});

describe("data grid header settings", () => {
  it("shows DBX-style type and comment lines by default and preserves opt-outs", () => {
    expect(normalizeAppSettings({}).dataGrid).toMatchObject({
      showColumnTypesInHeader: true,
      showColumnCommentsInHeader: true,
    });
    expect(
      normalizeAppSettings({
        dataGrid: {
          showColumnTypesInHeader: false,
          showColumnCommentsInHeader: false,
        },
      }).dataGrid,
    ).toMatchObject({
      showColumnTypesInHeader: false,
      showColumnCommentsInHeader: false,
    });
  });
});

describe("data grid formatter settings", () => {
  it("migrates missing formatter records and retains only bounded valid configs", () => {
    expect(normalizeAppSettings({}).dataGrid.columnFormatters).toEqual({});
    expect(
      normalizeAppSettings({
        dataGrid: {
          columnFormatters: {
            "conn::app::public::users::created_at": {
              kind: "datetime",
              unit: "auto",
              pattern: "YYYY-MM-DD HH:mm:ss",
              timezone: "UTC",
            },
            broken: { kind: "mask", prefix: -1, suffix: 2 },
          },
        },
      }).dataGrid.columnFormatters,
    ).toEqual({
      "conn::app::public::users::created_at": {
        kind: "datetime",
        unit: "auto",
        pattern: "YYYY-MM-DD HH:mm:ss",
        timezone: "UTC",
      },
    });
  });
});

describe("SQL Library tool window settings", () => {
  it("defaults to a closed right-side shared panel and preserves explicit moves", () => {
    const defaults = normalizeAppSettings({}).workbench;
    expect(defaults.toolWindows.sqlLibrary).toEqual({ enabled: true, side: "right" });
    expect(defaults.layout.visibility.sqlLibrary).toBe(false);

    const moved = normalizeAppSettings({
      workbench: {
        layout: {
          visibility: { sqlLibrary: true, databaseExplorer: true },
          activeSideToolWindows: { left: "sqlLibrary", right: null },
        },
        toolWindows: { sqlLibrary: { enabled: true, side: "left" } },
      },
    }).workbench;
    expect(moved.toolWindows.sqlLibrary.side).toBe("left");
    expect(moved.layout.activeSideToolWindows.left).toBe("sqlLibrary");
    expect(moved.layout.visibility.databaseExplorer).toBe(false);
  });
});

describe("driver runtime settings", () => {
  it("migrates old settings and accepts only credential-free HTTPS worker roots", () => {
    expect(normalizeAppSettings({}).drivers.sqliteWorkerBaseUrl).toBe("");
    expect(
      normalizeAppSettings({
        drivers: {
          sqliteWorkerBaseUrl: "https://downloads.example.com/sqlite-workers",
        },
      }).drivers.sqliteWorkerBaseUrl,
    ).toBe("https://downloads.example.com/sqlite-workers");
    expect(
      normalizeAppSettings({
        drivers: {
          sqliteWorkerBaseUrl: "http://downloads.example.com/workers",
        },
      }).drivers.sqliteWorkerBaseUrl,
    ).toBe("");
    expect(
      normalizeAppSettings({
        drivers: {
          sqliteWorkerBaseUrl: "https://user:secret@example.com/workers",
        },
      }).drivers.sqliteWorkerBaseUrl,
    ).toBe("");
  });
});
