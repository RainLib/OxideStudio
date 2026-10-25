/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@/components/workspace/CommandPalette";
import { APP_EVENT_OPEN_COMMAND_PALETTE } from "@/lib/actions";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";

describe("CommandPalette", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    useConnectionStore.setState({
      connections: [
        {
          id: "connection-1",
          name: "Local Postgres",
          driver: "postgres",
          url: "",
        },
      ],
      activeConnectionId: null,
      connectedConnectionIds: [],
      setActiveConnection: vi.fn(async () => null),
    });
    useSchemaStore.setState({
      schemas: ["public"],
      currentSchema: "public",
      tables: [{ name: "users", schema: "public", type: "table" }],
    });
    useProjectFilesStore.setState({
      rootPath: "/workspace/project",
      entriesByDirectory: {
        queries: [
          {
            relativePath: "queries/report.sql",
            name: "report.sql",
            kind: "file",
            size: 10,
            modifiedAt: null,
            isSymlink: false,
          },
        ],
      },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("indexes active objects and project files and activates a data source", async () => {
    await act(async () => root.render(<CommandPalette />));
    await act(async () => {
      window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_COMMAND_PALETTE));
    });

    expect(document.body.textContent).toContain("Active data source");
    expect(document.body.textContent).toContain("users");
    expect(document.body.textContent).toContain("Project files");
    expect(document.body.textContent).toContain("report.sql");

    const connectionOption = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="option"]')
    ).find((option) => option.textContent?.includes("Local Postgres"));
    expect(connectionOption).toBeDefined();

    await act(async () => connectionOption?.click());
    expect(
      useConnectionStore.getState().setActiveConnection
    ).toHaveBeenCalledWith("connection-1");
  });
});
