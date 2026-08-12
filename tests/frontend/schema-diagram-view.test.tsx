/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SchemaDiagramView } from "@/components/workspace/SchemaDiagramView";
import type { SchemaSnapshot } from "@/services/tauri/types";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot: SchemaSnapshot = {
  version: 1,
  id: "diagram-snapshot",
  fingerprint: "diagram-fingerprint",
  projectId: "project-1",
  connectionId: "connection-1",
  connectionName: "Local",
  driver: "postgres",
  databaseName: "app",
  schemaName: "public",
  capturedAt: 1,
  relations: [
    {
      name: "users",
      objectType: "BASE TABLE",
      columns: [
        {
          name: "id",
          data_type: "int8",
          is_nullable: false,
          is_primary_key: true,
          is_unique: true,
          is_indexed: true,
        },
        {
          name: "email",
          data_type: "text",
          is_nullable: false,
          is_primary_key: false,
          is_unique: true,
          is_indexed: true,
        },
      ],
      indexes: [],
      constraints: [],
    },
    {
      name: "orders",
      objectType: "BASE TABLE",
      columns: [
        {
          name: "id",
          data_type: "int8",
          is_nullable: false,
          is_primary_key: true,
          is_unique: true,
          is_indexed: true,
        },
        {
          name: "user_id",
          data_type: "int8",
          is_nullable: false,
          is_primary_key: false,
          is_unique: false,
          is_indexed: true,
        },
        {
          name: "notes",
          data_type: "text",
          is_nullable: true,
          is_primary_key: false,
          is_unique: false,
          is_indexed: false,
        },
      ],
      indexes: [],
      constraints: [
        {
          name: "orders_user_fk",
          constraint_type: "FOREIGN KEY",
          columns: ["user_id"],
          referenced_schema: "public",
          referenced_table: "users",
          referenced_columns: ["id"],
        },
      ],
    },
  ],
  warnings: [],
};

describe("SchemaDiagramView", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useProjectStore.setState({
      activeProjectId: "project-1",
      activeProjectName: "Project",
    });
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    useTabStore.getState().openSchemaDiagramTab(snapshot);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders relationships and persists relation selection in the artifact tab", async () => {
    await act(async () => {
      root.render(<SchemaDiagramView />);
    });

    expect(container.textContent).toContain("2 relations");
    expect(container.textContent).toContain("1 foreign keys");
    expect(
      container.querySelectorAll("[data-schema-diagram-relation]"),
    ).toHaveLength(2);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-schema-diagram-relation="orders"]',
        )
        ?.click();
    });

    expect(container.textContent).toContain("orders_user_fk");
    expect(useTabStore.getState().tabs[0]?.selectedDiagramRelationName).toBe(
      "orders",
    );
  });

  it("keeps a partial diagram usable and surfaces capture warnings", async () => {
    const partialSnapshot: SchemaSnapshot = {
      ...snapshot,
      id: "partial-diagram-snapshot",
      fingerprint: "partial-diagram-fingerprint",
      relations: [
        ...snapshot.relations,
        {
          name: "restricted_view",
          objectType: "VIEW",
          columns: [],
          indexes: [],
          constraints: [],
        },
      ],
      warnings: [
        "Diagram metadata for public.restricted_view is incomplete: permission denied",
      ],
    };
    useTabStore.getState().openSchemaDiagramTab(partialSnapshot);

    await act(async () => {
      root.render(<SchemaDiagramView />);
    });

    expect(container.textContent).toContain("3 relations");
    expect(container.textContent).toContain(
      "Diagram opened with 1 metadata warning",
    );
    expect(
      container.querySelector('[data-schema-diagram-relation="restricted_view"]'),
    ).not.toBeNull();
  });

  it("filters by column and switches to a keys-only projection", async () => {
    await act(async () => {
      root.render(<SchemaDiagramView />);
    });
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Find relation or column"]',
    );
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "notes",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      container.querySelectorAll("[data-schema-diagram-relation]"),
    ).toHaveLength(1);
    expect(container.textContent).toContain("orders");

    const keysOnly = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Keys only"),
    );
    await act(async () => keysOnly?.click());
    expect(
      container.querySelector(
        '[data-schema-diagram-relation="orders"]',
      )?.textContent,
    ).not.toContain("notes");
    expect(container.textContent).toContain("+1 hidden column");
  });

  it("exposes the current multi-selection from the canvas context menu", async () => {
    await act(async () => {
      root.render(<SchemaDiagramView />);
    });
    const users = container.querySelector<HTMLButtonElement>(
      '[data-schema-diagram-relation="users"]',
    );
    const orders = container.querySelector<HTMLButtonElement>(
      '[data-schema-diagram-relation="orders"]',
    );
    await act(async () => {
      users?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      orders?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true }),
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLElement>("[data-schema-diagram-canvas]")
        ?.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            button: 2,
            clientX: 120,
            clientY: 120,
          }),
        );
    });

    expect(document.body.textContent).toContain(
      "Move 2 selected relations to area",
    );
    expect(document.body.textContent).toContain("Auto-arrange diagram areas");
  });
});
