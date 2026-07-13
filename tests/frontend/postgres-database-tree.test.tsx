/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PostgresDatabaseTree,
  postgresConnectionDatabaseName,
} from "@/components/workspace/PostgresDatabaseTree";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("PostgresDatabaseTree", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("renders every database collapsed and toggles the current database children", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PostgresDatabaseTree
          databases={["analytics", "app", "warehouse"]}
          currentDatabase="app"
          status="success"
          schemaCount="2"
          connectionColor="#5b8dd6"
        >
          <div data-schema="public">public</div>
          <div data-schema="audit">audit</div>
        </PostgresDatabaseTree>
      );
    });

    expect(container.textContent).toContain("Databases");
    expect(container.textContent).toContain("default");
    expect(container.textContent).not.toContain("connected");
    expect(container.textContent).toContain("analytics");
    expect(container.textContent).toContain("warehouse");
    expect(container.querySelectorAll("[data-schema]")).toHaveLength(0);

    const currentDatabase = container.querySelector(
      '[data-postgres-database="app"]'
    );
    const otherDatabase = container.querySelector(
      '[data-postgres-database="analytics"]'
    );
    expect(currentDatabase?.getAttribute("data-connected")).toBe("true");
    expect(currentDatabase?.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "false"
    );
    expect(otherDatabase?.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "false"
    );

    await act(async () => {
      currentDatabase
        ?.querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelectorAll("[data-schema]")).toHaveLength(2);
    expect(container.textContent).toContain("Schemas");
    expect(currentDatabase?.querySelector("button")?.getAttribute("aria-expanded")).toBe(
      "true"
    );

    await act(async () => {
      currentDatabase
        ?.querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelectorAll("[data-schema]")).toHaveLength(0);
  });

  it("filters database names without expanding matching rows", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PostgresDatabaseTree
          databases={["analytics", "app", "warehouse"]}
          currentDatabase="app"
          status="success"
          schemaCount="2"
          connectionColor="#5b8dd6"
          filterText="WARE"
        >
          <div data-schema="public">public</div>
        </PostgresDatabaseTree>
      );
    });

    expect(
      container.querySelector('[data-postgres-database="warehouse"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-postgres-database="analytics"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-postgres-database="app"]')
    ).toBeNull();
    expect(container.querySelector("[aria-expanded='true']")).toBeNull();
    expect(container.querySelector("[data-schema]")).toBeNull();
  });

  it("keeps known descendant matches without treating expansion as a match", async () => {
    const renderTree = async (filterText: string) => {
      await act(async () => {
        if (!root) root = createRoot(container);
        root.render(
          <PostgresDatabaseTree
            databases={["analytics", "app", "warehouse"]}
            currentDatabase="app"
            status="success"
            schemaCount="1"
            connectionColor="#5b8dd6"
            filterText={filterText}
            databaseMatchesFilter={(database, filter) =>
              database === "app" && filter === "users"
            }
          >
            <div>users</div>
          </PostgresDatabaseTree>
        );
      });
    };

    await renderTree("");
    await act(async () => {
      container
        .querySelector('[data-postgres-database="analytics"] button')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await renderTree("users");

    expect(
      container.querySelector('[data-postgres-database="app"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-postgres-database="analytics"]')
    ).toBeNull();
    expect(container.querySelector("[aria-expanded='true']")).toBeNull();
  });

  it("honors an exact visible database set without forcing the current database", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PostgresDatabaseTree
          databases={["analytics", "app", "warehouse"]}
          visibleDatabases={["warehouse"]}
          currentDatabase="app"
          status="success"
          schemaCount="2"
          connectionColor="#5b8dd6"
        >
          <div data-schema="public">public</div>
        </PostgresDatabaseTree>
      );
    });

    expect(
      container.querySelector('[data-postgres-database="warehouse"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-postgres-database="app"]')
    ).toBeNull();
    expect(container.querySelector("[aria-expanded='true']")).toBeNull();
  });

  it("shows database loading and errors, then retries the async load", async () => {
    let rejectFirstLoad: ((error: Error) => void) | undefined;
    const onLoadDatabase = vi
      .fn<(database: string) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirstLoad = reject;
          })
      )
      .mockResolvedValueOnce(undefined);
    const renderDatabaseChildren = vi.fn((database: string) => (
      <div data-database-children={database}>{database} schemas</div>
    ));

    await act(async () => {
      root = createRoot(container);
      root.render(
        <PostgresDatabaseTree
          databases={["analytics", "app"]}
          currentDatabase="app"
          status="success"
          schemaCount="1"
          connectionColor="#5b8dd6"
          onLoadDatabase={onLoadDatabase}
          renderDatabaseChildren={renderDatabaseChildren}
        >
          <div data-schema="public">public</div>
        </PostgresDatabaseTree>
      );
    });

    expect(renderDatabaseChildren).not.toHaveBeenCalled();

    const analytics = container.querySelector(
      '[data-postgres-database="analytics"]'
    );
    act(() => {
      analytics
        ?.querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('[aria-label="Loading database analytics"]')
    ).not.toBeNull();
    expect(onLoadDatabase).toHaveBeenCalledWith("analytics");
    expect(renderDatabaseChildren).not.toHaveBeenCalled();

    await act(async () => {
      rejectFirstLoad?.(new Error("permission denied"));
      await Promise.resolve();
    });

    expect(container.querySelector("[role='alert']")?.textContent).toContain(
      "permission denied"
    );
    expect(
      container.querySelector('[data-database-children="analytics"]')
    ).toBeNull();

    await act(async () => {
      container
        .querySelector('[aria-label="Retry loading database analytics"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onLoadDatabase).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(
      container.querySelector('[data-database-children="analytics"]')
    ).not.toBeNull();
    expect(renderDatabaseChildren).toHaveBeenCalledWith("analytics");
  });

  it("coalesces repeated expands while a database load is in flight", async () => {
    let resolveLoad: (() => void) | undefined;
    const onLoadDatabase = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        })
    );

    await act(async () => {
      root = createRoot(container);
      root.render(
        <PostgresDatabaseTree
          databases={["analytics", "app"]}
          currentDatabase="app"
          status="success"
          schemaCount="1"
          connectionColor="#5b8dd6"
          onLoadDatabase={onLoadDatabase}
        >
          <div>public</div>
        </PostgresDatabaseTree>
      );
    });

    const button = container.querySelector(
      '[data-postgres-database="analytics"] button'
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onLoadDatabase).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveLoad?.();
      await Promise.resolve();
    });
  });

  it("resolves the connected database without confusing it with a schema", () => {
    expect(
      postgresConnectionDatabaseName({
        database: "configured_db",
        connectionUrl: "postgres://localhost/url_db",
      })
    ).toBe("url_db");
    expect(
      postgresConnectionDatabaseName({
        connectionUrl: "postgres://localhost/customer%20data",
      })
    ).toBe("customer data");
    expect(
      postgresConnectionDatabaseName({ database: "configured_db" })
    ).toBe("configured_db");
    expect(postgresConnectionDatabaseName({})).toBe("postgres");
  });
});
