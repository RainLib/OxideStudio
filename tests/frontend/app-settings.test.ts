import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
} from "@/lib/appSettings";
import {
  moveSideToolWindow,
  toolWindowAtSide,
} from "@/lib/workbenchLayout";

describe("app settings workbench layout", () => {
  it("keeps UI, editor, and data grid typography aligned by default", () => {
    expect(DEFAULT_APP_SETTINGS.appearance.uiFontSize).toBe(12);
    expect(DEFAULT_APP_SETTINGS.editor.fontSize).toBe(12);
    expect(DEFAULT_APP_SETTINGS.dataGrid.fontSize).toBe(12);
  });

  it("normalizes typography and data grid zoom bounds", () => {
    const settings = normalizeAppSettings({
      appearance: { uiFontSize: 40 },
      editor: { fontSize: 4 },
      dataGrid: { fontSize: 30, rowHeight: 10, zoomPercent: 240 },
    });

    expect(settings.appearance.uiFontSize).toBe(20);
    expect(settings.editor.fontSize).toBe(10);
    expect(settings.dataGrid.fontSize).toBe(20);
    expect(settings.dataGrid.rowHeight).toBe(22);
    expect(settings.dataGrid.zoomPercent).toBe(160);
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
      assistant: true,
      results: false,
    });
  });

  it("keeps side tool windows in distinct dock positions", () => {
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
    expect(settings.workbench.toolWindows.assistant.side).toBe("left");
    expect(settings.workbench.toolWindows.results.side).toBe("bottom");
    expect(toolWindowAtSide(settings.workbench.toolWindows, "left")).toBe(
      "assistant"
    );
  });

  it("moves a side tool window by swapping the occupied dock", () => {
    const moved = moveSideToolWindow(
      DEFAULT_APP_SETTINGS.workbench,
      "databaseExplorer",
      "right"
    );

    expect(moved.toolWindows.databaseExplorer.side).toBe("right");
    expect(moved.toolWindows.assistant.side).toBe("left");
    expect(DEFAULT_APP_SETTINGS.workbench.toolWindows.databaseExplorer.side).toBe(
      "left"
    );
  });
});
