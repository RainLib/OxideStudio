import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS } from "./appSettings";
import { closeSideToolWindow, openSideToolWindow, toolWindowAtSide } from "./workbenchLayout";

describe("shared SQL Library side panel", () => {
  it("replaces the active tool on the same side", () => {
    const assistant = openSideToolWindow(DEFAULT_APP_SETTINGS.workbench, "assistant");
    const library = openSideToolWindow(assistant, "sqlLibrary");
    expect(toolWindowAtSide(library, "right")).toBe("sqlLibrary");
    expect(library.layout.visibility.assistant).toBe(false);
    expect(library.layout.visibility.sqlLibrary).toBe(true);
  });

  it("closes the shared side instead of revealing the previous tool", () => {
    const library = openSideToolWindow(
      openSideToolWindow(DEFAULT_APP_SETTINGS.workbench, "assistant"),
      "sqlLibrary",
    );
    const closed = closeSideToolWindow(library, "sqlLibrary");
    expect(toolWindowAtSide(closed, "right")).toBeNull();
    expect(closed.layout.visibility.assistant).toBe(false);
    expect(closed.layout.visibility.sqlLibrary).toBe(false);
  });
});
