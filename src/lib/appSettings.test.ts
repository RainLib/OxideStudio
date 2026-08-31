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
