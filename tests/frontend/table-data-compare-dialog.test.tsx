/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableDataCompareDialog } from "@/components/workspace/TableDataCompareDialog";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { databaseService, schemaService, tableService } from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TableDataCompareDialog", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("compares same-name tables and routes missing targets into transfer", async () => {
    const connections = [
      { id: "source", name: "Source", driver: "postgresql" },
      { id: "target", name: "Target", driver: "postgresql" },
    ] as never;
    useConnectionStore.setState({
      connections,
      connectedConnectionIds: ["source", "target"],
    });
    vi.spyOn(
      databaseService,
      "getConnectionDatabaseCapabilityContext",
    ).mockResolvedValue({
      capabilities: {
        ...defaultDatabaseCapabilities("postgresql"),
        supportsDatabaseCatalogs: false,
      },
      distribution: "bundled",
      packageVersion: null,
      matchedDriver: "postgresql",
    });
    vi.spyOn(schemaService, "getSchemas").mockResolvedValue(["public"]);
    vi.spyOn(schemaService, "getTables").mockResolvedValue([
      { name: "users", type: "TABLE" },
    ]);
    vi.spyOn(schemaService, "getColumns").mockResolvedValue([
      {
        name: "id",
        data_type: "bigint",
        is_nullable: false,
        is_primary_key: true,
      },
      {
        name: "name",
        data_type: "text",
        is_nullable: false,
        is_primary_key: false,
      },
    ]);
    vi.spyOn(tableService, "compareTableDataFull").mockResolvedValue({
      added: [{ key: "2", values: { id: 2, name: "Ada" } }],
      removed: [],
      modified: [],
      addedCount: 1,
      removedCount: 0,
      modifiedCount: 0,
      equalCount: 1,
      sourceRowCount: 2,
      targetRowCount: 1,
      comparedKeyCount: 2,
      batchSize: 1_000,
      detailLimitPerStatus: 1_000,
      detailsTruncated: false,
      degradationLevel: "full",
      samplingRate: 1,
      verificationMethod: "full_keyset",
      countsExact: true,
      sampledKeyCount: 2,
    });
    const transferMissing = vi.fn();

    await act(async () => {
      root.render(
        <TableDataCompareDialog
          open
          source={{
            connectionId: "source",
            driver: "postgresql",
            schema: "public",
            table: "users",
          }}
          sourceTables={["users", "audit_log"]}
          connections={connections}
          onClose={() => undefined}
          onTransferMissing={transferMissing}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const compare = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Compare matching tables"),
    );
    expect(compare?.disabled).toBe(false);
    await act(async () => {
      compare?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).toContain("usersdifferent");
    expect(document.body.textContent).toContain("audit_logmissing");
    const transfer = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Transfer missing tables"),
    );
    await act(async () => transfer?.click());
    expect(transferMissing).toHaveBeenCalledWith(
      ["audit_log"],
      expect.objectContaining({
        connectionId: "target",
        driver: "postgresql",
        schema: "public",
      }),
    );
  });
});
