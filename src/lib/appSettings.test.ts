import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "./appSettings";

describe("SQL completion settings", () => {
  it("defaults old settings to positional completion", () => {
    const completion = normalizeAppSettings({}).editor.sqlCompletion;
    expect(completion.triggerMode).toBe("positional");
    expect(completion.functionCase).toBe("preserve");
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
});
