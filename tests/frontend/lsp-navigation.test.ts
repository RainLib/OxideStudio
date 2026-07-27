import { beforeEach, describe, expect, it, vi } from "vitest";
import { revealLspDatabaseDefinition } from "@/lib/lspNavigation";
import { getLspDatabaseObjectUri } from "@/services/lsp/objectUri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useDatabaseNavigationStore } from "@/lib/databaseNavigation";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { useSettingsStore } from "@/store/useSettingsStore";

vi.mock("@/services/tauri/settings.service", () => ({
  settingsService: {
    saveAppSettings: vi.fn().mockResolvedValue(undefined),
    getAppSettings: vi.fn(),
    resetAppSettings: vi.fn(),
  },
}));

describe("LSP database definition navigation", () => {
  beforeEach(() => {
    useConnectionStore.setState({
      connections: [
        {
          id: "postgres-1",
          name: "Postgres",
          driver: "postgres",
          url: "postgres://localhost/app",
          database: "app",
        },
      ],
      activeConnectionId: "postgres-1",
    });
    useDatabaseNavigationStore.setState({ revealRequest: null });
    useWorkbenchLayoutStore
      .getState()
      .setActiveToolWindow("editor");
  });

  it("routes object definitions into Database Explorer", async () => {
    const uri = getLspDatabaseObjectUri({
      connectionId: "postgres-1",
      databaseName: "analytics",
      schemaName: "public",
      objectName: "orders",
      objectType: "BASE TABLE",
      columnName: "id",
    });

    await expect(
      revealLspDatabaseDefinition(uri, "project-1")
    ).resolves.toBe(true);
    expect(
      useSettingsStore.getState().settings.workbench.layout.activeToolWindow
    ).toBe("databaseExplorer");
    expect(useDatabaseNavigationStore.getState().revealRequest?.target).toEqual({
      projectId: "project-1",
      connectionId: "postgres-1",
      databaseName: "analytics",
      schemaName: "public",
      objectType: "BASE TABLE",
      objectName: "orders",
    });
  });

  it("ignores ordinary file locations", async () => {
    await expect(
      revealLspDatabaseDefinition("file:///schema.sql", "project-1")
    ).resolves.toBe(false);
    expect(useDatabaseNavigationStore.getState().revealRequest).toBeNull();
  });
});
