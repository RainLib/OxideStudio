// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schemaService } from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import { ObjectBrowser } from "./ObjectBrowser";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("ObjectBrowser", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    useConnectionStore.setState({
      connections: [
        {
          id: "connection-1",
          name: "Warehouse",
          driver: "postgres",
          database: "postgres",
        },
      ] as never,
      activeConnectionId: "connection-1",
    });
    useTabStore.setState({ tabs: [], activeTabId: null });
    useTabStore.getState().createTab("object_browser", "analytics", "", {
      connectionId: "connection-1",
      databaseName: "analytics",
      schemaName: "public",
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders DBX-style object headers and filters object kinds", async () => {
    vi.spyOn(schemaService, "getDatabaseSchemas").mockResolvedValue([
      "public",
      "audit",
    ]);
    vi.spyOn(schemaService, "getDatabaseTables").mockResolvedValue([
      { name: "users", schema: "public", type: "TABLE", comment: "App users" },
      { name: "active_users", schema: "public", type: "VIEW", comment: "Active accounts" },
    ]);
    vi.spyOn(schemaService, "getDatabaseSchemaObjects").mockResolvedValue([
      {
        name: "refresh_users",
        schema: "public",
        objectType: "FUNCTION",
        comment: "Refresh user data",
      },
    ]);

    await act(async () => {
      root.render(<ObjectBrowser />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(host.textContent).toContain("Name");
    expect(host.textContent).toContain("Type");
    expect(host.textContent).toContain("Comment");
    expect(host.textContent).toContain("users");
    expect(host.textContent).toContain("active_users");
    expect(host.textContent).toContain("refresh_users");

    const views = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.startsWith("Views"),
    );
    await act(async () => views?.click());
    expect(host.textContent).toContain("active_users");
    expect(host.textContent).not.toContain("refresh_users");
    expect(host.textContent).not.toContain("App users");
  });
});
