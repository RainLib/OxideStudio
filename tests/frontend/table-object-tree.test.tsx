/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableObjectTree } from "@/features/database-explorer/ui/TableObjectTree";

const mocks = vi.hoisted(() => ({
  loadTableMetadata: vi.fn(async () => ({
    columns: [
      {
        name: "id",
        data_type: "bigint",
        is_nullable: false,
        is_primary_key: true,
      },
    ],
    indexes: [
      {
        name: "users_pkey",
        columns: ["id"],
        is_unique: true,
        is_primary: true,
      },
    ],
    constraints: [
      {
        name: "orders_customer_id_fkey",
        constraint_type: "FOREIGN KEY",
        columns: ["customer_id"],
        referenced_schema: "public",
        referenced_table: "customers",
        referenced_columns: ["id"],
      },
      {
        name: "orders_total_check",
        constraint_type: "CHECK",
        columns: ["total"],
        referenced_columns: [],
        definition: "total >= 0",
      },
    ],
    ddl: null,
    viewDefinition: null,
    source: "cache" as const,
    updatedAt: 1,
  })),
}));

vi.mock("@/services/tableMetadataCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/tableMetadataCache")>()),
  loadTableMetadata: mocks.loadTableMetadata,
}));

describe("table object metadata tree", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  it("loads cached metadata with database scope and exposes indexes and constraints", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TableObjectTree
          identity={{
            projectId: "project-1",
            connectionId: "postgres-1",
            driver: "postgres",
            databaseName: "app",
            schema: "public",
            table: "users",
          }}
          includeIndexes
          includeConstraints
        />,
      );
      await Promise.resolve();
    });

    expect(mocks.loadTableMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseName: "app",
        schema: "public",
        table: "users",
        includeIndexes: true,
        includeConstraints: true,
      }),
    );
    expect(container.textContent).toContain("Columns");
    expect(container.textContent).toContain("id");
    expect(container.textContent).toContain("Indexes");
    expect(container.textContent).toContain("Constraints");
    expect(
      container.querySelector('[data-metadata-source="cache"]'),
    ).not.toBeNull();
  });

  it("keeps cached metadata visible and can explicitly refresh it from the data source", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TableObjectTree
          identity={{
            connectionId: "postgres-1",
            driver: "postgres",
            schema: "public",
            table: "users",
          }}
          includeIndexes
          includeConstraints
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("cached");
    const refresh = container.querySelector<HTMLButtonElement>(
      '[aria-label="Refresh table metadata"]',
    );
    expect(refresh).not.toBeNull();

    await act(async () => {
      refresh?.click();
      await Promise.resolve();
    });

    expect(mocks.loadTableMetadata).toHaveBeenLastCalledWith(
      expect.objectContaining({ force: true }),
    );
  });

  it("keeps a complete cached tree visible when an explicit remote refresh fails", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TableObjectTree
          identity={{
            connectionId: "postgres-1",
            driver: "postgres",
            schema: "public",
            table: "users",
          }}
          includeIndexes
          includeConstraints
        />,
      );
      await Promise.resolve();
    });

    mocks.loadTableMetadata.mockRejectedValueOnce(
      new Error("Connection timed out"),
    );
    const refresh = container.querySelector<HTMLButtonElement>(
      '[aria-label="Refresh table metadata"]',
    );

    await act(async () => {
      refresh?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Columns");
    expect(
      container.querySelector(
        '[aria-label="Showing cached metadata after refresh failure"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Metadata unavailable");
  });

  it("separates foreign keys from other constraints and opens their target", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onReferenceSelect = vi.fn();

    await act(async () => {
      root?.render(
        <TableObjectTree
          identity={{
            connectionId: "postgres-1",
            driver: "postgres",
            schema: "public",
            table: "orders",
          }}
          includeIndexes
          includeConstraints
          onReferenceSelect={onReferenceSelect}
        />,
      );
      await Promise.resolve();
    });

    const foreignKeys = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Foreign Keys"),
    );
    await act(async () => foreignKeys?.click());

    expect(container.textContent).toContain("public.customers");
    expect(container.textContent).not.toContain("orders_total_check");
    expect(
      container.querySelector('[title*="references public.customers"]'),
    ).not.toBeNull();

    const reference = container.querySelector<HTMLButtonElement>(
      '[title*="Open referenced relation"]',
    );
    await act(async () => reference?.click());
    expect(onReferenceSelect).toHaveBeenCalledWith({
      schema: "public",
      table: "customers",
    });

    const constraints = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Constraints"),
    );
    await act(async () => constraints?.click());
    expect(container.textContent).toContain("orders_total_check");
  });

  it("shows table-scoped triggers as a dedicated child directory", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const onTriggerOpen = vi.fn();

    await act(async () => {
      root?.render(
        <TableObjectTree
          identity={{
            connectionId: "postgres-1",
            driver: "postgres",
            schema: "public",
            table: "orders",
          }}
          includeIndexes
          includeConstraints
          triggers={[
            {
              name: "orders_audit_trigger",
              objectType: "TRIGGER",
              parentName: "orders",
            },
          ]}
          onTriggerOpen={onTriggerOpen}
        />,
      );
      await Promise.resolve();
    });

    const triggers = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Triggers"),
    );
    expect(triggers).toBeDefined();
    await act(async () => triggers?.click());

    const trigger = container.querySelector<HTMLButtonElement>(
      '[title="Trigger on orders"]',
    );
    expect(trigger).toBeDefined();
    await act(async () =>
      trigger?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    expect(onTriggerOpen).toHaveBeenCalledWith(
      expect.objectContaining({ name: "orders_audit_trigger" }),
    );
  });
});
