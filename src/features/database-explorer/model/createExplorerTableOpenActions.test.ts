import { describe, expect, it, vi } from "vitest";
import { createExplorerTableOpenActions } from "./createExplorerTableOpenActions";
import { useSchemaStore } from "@/store/useSchemaStore";
import type { ConnectionConfig } from "@/features/connections/model/types";

describe("managed table activation", () => {
  it("binds a clicked table to the real catalog even with a legacy cached resource path", async () => {
    const connection: ConnectionConfig = {
      id: "source", name: "Fixture", driver: "postgres", url: "", origin: "managed", database: "app/public",
      managedDescriptor: { organizationId: "org", projectId: "project", dataSourceId: "source", gatewayId: "gateway",
        driver: "postgres", displayName: "Fixture", capabilities: [], allowedResourceSummary: ["app/public"], policyRevision: "1" },
    };
    useSchemaStore.setState({ currentSchema: "public" });
    const findOrCreateTableTab = vi.fn(() => "tab"), loadTablePage = vi.fn(async () => true);
    const actions = createExplorerTableOpenActions({ selectTable: vi.fn(), currentSchema: "public",
      activeConnectionId: "source", connectedConnectionIds: ["source"], setActiveConnection: vi.fn(async () => null),
      setNamespaceError: vi.fn(), handleSchemaSelect: vi.fn(async () => {}), connections: [connection],
      findOrCreateTableTab, tableTabReuseMode: "same-table", loadTablePage });
    await actions.handleTableDoubleClick({ name: "adapter", schema: "public" });
    expect(findOrCreateTableTab).toHaveBeenCalledWith("source", "public", "adapter", undefined, "app", { reuseMode: "same-table" });
    expect(loadTablePage).toHaveBeenCalledWith("tab", 0);
  });
});
