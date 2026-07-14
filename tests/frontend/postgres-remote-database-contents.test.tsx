/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresRemoteDatabaseContents } from "@/components/workspace/PostgresRemoteDatabaseContents";

const mocks = vi.hoisted(() => ({
  getDatabaseTables: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  schemaService: {
    getDatabaseTables: mocks.getDatabaseTables,
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("PostgresRemoteDatabaseContents", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mocks.getDatabaseTables.mockReset();
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("loads tables only after a remote schema is explicitly expanded", async () => {
    const onOpenTable = vi.fn();
    mocks.getDatabaseTables.mockResolvedValue([
      { name: "events", schema: "public", type: "BASE TABLE" },
      { name: "daily_events", schema: "public", type: "VIEW" },
    ]);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <PostgresRemoteDatabaseContents
          connectionId="pg-1"
          database="analytics"
          schemas={["public", "audit"]}
          connectionColor="#5b8dd6"
          onOpenTable={onOpenTable}
        />
      );
    });

    expect(mocks.getDatabaseTables).not.toHaveBeenCalled();
    expect(container.querySelector("[aria-expanded='true']")).toBeNull();

    const publicSchema = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("public")
    );
    await act(async () => {
      publicSchema?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.getDatabaseTables).toHaveBeenCalledWith(
      "pg-1",
      "analytics",
      "public"
    );
    expect(
      container.querySelector(
        '[data-postgres-remote-table="analytics.public.events"]'
      )
    ).not.toBeNull();
    const eventsTable = container.querySelector<HTMLButtonElement>(
      '[data-postgres-remote-table="analytics.public.events"]'
    );
    expect(eventsTable?.tagName).toBe("BUTTON");
    eventsTable?.focus();
    expect(document.activeElement).toBe(eventsTable);

    await act(async () => {
      eventsTable?.click();
    });

    expect(onOpenTable).toHaveBeenCalledOnce();
    expect(onOpenTable).toHaveBeenCalledWith(
      "analytics",
      "public",
      expect.objectContaining({
        name: "events",
        schema: "public",
        type: "BASE TABLE",
      })
    );
    expect(container.textContent).toContain("daily_events");
  });

  it("keeps same-named schemas isolated by database", async () => {
    mocks.getDatabaseTables.mockImplementation(
      async (_connectionId: string, database: string) => [
        {
          name: database === "analytics" ? "analytics_users" : "archive_users",
          schema: "public",
          type: "BASE TABLE",
        },
      ]
    );

    await act(async () => {
      root = createRoot(container);
      root.render(
        <>
          <PostgresRemoteDatabaseContents
            connectionId="pg-1"
            database="analytics"
            schemas={["public"]}
            connectionColor="#5b8dd6"
            onOpenTable={vi.fn()}
          />
          <PostgresRemoteDatabaseContents
            connectionId="pg-1"
            database="archive"
            schemas={["public"]}
            connectionColor="#5b8dd6"
            onOpenTable={vi.fn()}
          />
        </>
      );
    });

    const schemaButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent?.includes("public")
    );
    await act(async () => {
      schemaButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("analytics_users");
    expect(container.textContent).not.toContain("archive_users");
    expect(mocks.getDatabaseTables).toHaveBeenCalledTimes(1);
    expect(mocks.getDatabaseTables).toHaveBeenCalledWith(
      "pg-1",
      "analytics",
      "public"
    );
  });

  it("routes schema snapshot actions with the exact remote database identity", async () => {
    const onOpenSchemaSnapshots = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <PostgresRemoteDatabaseContents
          connectionId="pg-1"
          database="analytics"
          schemas={["public"]}
          connectionColor="#5b8dd6"
          onOpenSchemaSnapshots={onOpenSchemaSnapshots}
          onOpenTable={vi.fn()}
        />
      );
    });

    const schemaButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("public")
    );
    await act(async () => {
      schemaButton?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: 20,
          clientY: 20,
        })
      );
      await Promise.resolve();
    });

    const snapshotItem = Array.from(
      document.body.querySelectorAll<HTMLElement>("[role='menuitem']")
    ).find((item) => item.textContent?.includes("Schema Snapshots"));
    expect(snapshotItem).toBeDefined();

    await act(async () => {
      snapshotItem?.click();
    });

    expect(onOpenSchemaSnapshots).toHaveBeenCalledWith("analytics", "public");
  });
});
