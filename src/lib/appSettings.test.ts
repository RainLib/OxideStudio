import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "./appSettings";

describe("SQL completion settings", () => {
  it("defaults old settings to positional completion", () => {
    expect(normalizeAppSettings({}).editor.sqlCompletion.triggerMode).toBe(
      "positional",
    );
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
});
