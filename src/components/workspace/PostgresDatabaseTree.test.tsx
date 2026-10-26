// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresDatabaseTree } from "./PostgresDatabaseTree";
import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("managed database tree", () => {
  it("renders one database level, with schemas only beneath it", async () => {
    const currentDatabase = connectionCatalogDatabaseName({ origin: "managed", driver: "postgres", database: "app/public",
      managedDescriptor: { organizationId: "org", projectId: "project", dataSourceId: "source", gatewayId: "gateway",
        driver: "postgres", displayName: "Fixture", capabilities: [], allowedResourceSummary: ["app/public"], policyRevision: "1" } });
    await act(async () => root.render(<PostgresDatabaseTree connectionId="managed-tree-regression" databases={["app", "app"]}
      currentDatabase={currentDatabase} status="success" schemaCount="1" connectionColor="currentColor">
      <div data-test-schema="public">public</div>
    </PostgresDatabaseTree>));
    expect(container.querySelectorAll("[data-postgres-database]")).toHaveLength(1);
    expect(container.querySelector("[data-postgres-database]")?.getAttribute("data-postgres-database")).toBe("app");
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Expand database app"]')!;
    await act(async () => button.click());
    expect(container.querySelector('[data-test-schema="public"]')?.closest("[data-postgres-database]")?.getAttribute("data-postgres-database")).toBe("app");
    expect(container.textContent).not.toContain("app/public");
  });
  it("does not fabricate a default catalog for an unselected managed connection", async () => {
    await act(async () => root.render(<PostgresDatabaseTree connectionId="managed-empty-regression" databases={[]}
      currentDatabase={connectionCatalogDatabaseName({origin:"managed",driver:"postgres"})} status="success" schemaCount="0" connectionColor="currentColor">
      <div>unbound schemas</div>
    </PostgresDatabaseTree>));
    expect(container.querySelectorAll("[data-postgres-database]")).toHaveLength(0);
    expect(container.textContent).not.toContain("unbound schemas");
  });
});
