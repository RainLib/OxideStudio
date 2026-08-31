import { beforeEach, describe, expect, it } from "vitest";
import {
  compareDataSources,
  suggestedDataCompareKeys,
  type DataCompareSource,
} from "@/lib/dataCompare";
import { useTabStore } from "@/store/useTabStore";

function source(
  id: string,
  rows: unknown[][],
  options: Partial<DataCompareSource> = {},
): DataCompareSource {
  return {
    id,
    tabId: id,
    label: id,
    sourceKind: "query",
    resultIndex: 0,
    columns: [
      { name: "id", dataType: "int8" },
      { name: "score", dataType: "numeric" },
      { name: "payload", dataType: "jsonb" },
    ],
    rows,
    suggestedKeyColumns: ["id"],
    truncated: false,
    capturedAt: 1,
    ...options,
  };
}

describe("data compare", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
  });

  it("classifies changed, missing, and equal rows by a stable key", () => {
    const result = compareDataSources(
      source("left", [
        [1, 10, { enabled: true }],
        [2, 20, null],
        [3, 30, "left"],
      ]),
      source("right", [
        [1, 11, { enabled: true }],
        [2, 20, null],
        [4, 40, "right"],
      ]),
      { keyColumns: ["id"] },
    );

    expect(result.counts).toEqual({
      equal: 1,
      changed: 1,
      leftOnly: 1,
      rightOnly: 1,
      duplicate: 0,
    });
    expect(result.rows.find((row) => row.status === "changed")?.fields).toEqual([
      expect.objectContaining({ column: "score", equal: false }),
      expect.objectContaining({ column: "payload", equal: true }),
    ]);
  });

  it("applies absolute and relative tolerance only to strict numeric values", () => {
    const result = compareDataSources(
      source("left", [[1, "100.0", "10x"]]),
      source("right", [[1, 101, "10"]]),
      { keyColumns: ["id"], relativeTolerance: 0.01 },
    );

    expect(result.rows[0]?.status).toBe("changed");
    expect(result.rows[0]?.fields).toEqual([
      expect.objectContaining({ column: "score", toleranceMatched: true }),
      expect.objectContaining({ column: "payload", toleranceMatched: false }),
    ]);
  });

  it("reports duplicate keys without silently pairing or overwriting rows", () => {
    const result = compareDataSources(
      source("left", [
        [1, 10, null],
        [1, 11, null],
      ]),
      source("right", [[1, 10, null]]),
      { keyColumns: ["id"] },
    );

    expect(result.counts.duplicate).toBe(1);
    expect(result.rows[0]).toMatchObject({
      status: "duplicate",
      leftMatchCount: 2,
      rightMatchCount: 1,
    });
    expect(result.warnings).toContain(
      "Duplicate keys are ambiguous and are not paired or silently overwritten.",
    );
  });

  it("surfaces truncation and asymmetric columns", () => {
    const result = compareDataSources(
      source("left", [[1, 10, null]], {
        truncated: true,
        columns: [
          { name: "id", dataType: "int8" },
          { name: "left_value", dataType: "text" },
        ],
      }),
      source("right", [[1, "right"]], {
        columns: [
          { name: "id", dataType: "int8" },
          { name: "right_value", dataType: "text" },
        ],
      }),
      { keyColumns: ["id"] },
    );

    expect(result.leftOnlyColumns).toEqual(["left_value"]);
    expect(result.rightOnlyColumns).toEqual(["right_value"]);
    expect(result.warnings).toHaveLength(2);
  });

  it("rejects ambiguous duplicate result column names", () => {
    expect(() =>
      compareDataSources(
        source("left", [[1, 2]], {
          columns: [
            { name: "id", dataType: "int8" },
            { name: "id", dataType: "int8" },
          ],
        }),
        source("right", [[1]], {
          columns: [{ name: "id", dataType: "int8" }],
        }),
        { keyColumns: ["id"] },
      ),
    ).toThrow("Alias them uniquely");
  });

  it("prefers shared primary keys, then a shared id", () => {
    expect(
      suggestedDataCompareKeys(
        source("left", []),
        source("right", []),
      ),
    ).toEqual(["id"]);
    expect(
      suggestedDataCompareKeys(
        source("left", [], { suggestedKeyColumns: ["score"] }),
        source("right", [], { suggestedKeyColumns: ["score"] }),
      ),
    ).toEqual(["score"]);
  });

  it("captures immutable loaded-result artifacts and reuses the same ordered pair", () => {
    const leftId = useTabStore.getState().createTab("table", "users left");
    const rightId = useTabStore.getState().createTab("query", "users right");
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id === leftId) {
          return {
            ...tab,
            tableColumns: [
              {
                name: "id",
                data_type: "int8",
                is_nullable: false,
                is_primary_key: true,
              },
            ],
            results: [
              {
                columns: [
                  { name: "id", data_type: "int8" },
                  { name: "payload", data_type: "jsonb" },
                ],
                rows: [[1, { value: "before" }]],
              },
            ],
          };
        }
        if (tab.id === rightId) {
          return {
            ...tab,
            results: [
              {
                columns: [
                  { name: "id", data_type: "int8" },
                  { name: "payload", data_type: "jsonb" },
                ],
                rows: [[1, { value: "right" }]],
                truncated: true,
                rowLimit: 1_000,
              },
            ],
          };
        }
        return tab;
      }),
    }));

    const artifactId = useTabStore
      .getState()
      .openDataCompareTab(leftId, rightId);
    expect(artifactId).toBeTruthy();
    const firstArtifact = useTabStore
      .getState()
      .tabs.find((tab) => tab.id === artifactId);
    expect(firstArtifact?.dataCompareLeft?.suggestedKeyColumns).toEqual(["id"]);
    expect(firstArtifact?.dataCompareRight).toMatchObject({
      truncated: true,
      rowLimit: 1_000,
    });

    const sourcePayload = useTabStore
      .getState()
      .tabs.find((tab) => tab.id === leftId)?.results?.[0]?.rows[0]?.[1] as {
      value: string;
    };
    sourcePayload.value = "after";
    expect(firstArtifact?.dataCompareLeft?.rows[0]?.[1]).toEqual({
      value: "before",
    });

    expect(
      useTabStore.getState().openDataCompareTab(leftId, rightId),
    ).toBe(artifactId);
    expect(
      useTabStore.getState().tabs.filter((tab) => tab.type === "data_compare"),
    ).toHaveLength(1);
  });

  it("compares only the reviewed value-column subset while retaining keys", () => {
    const result = compareDataSources(
      source("left", [[1, 10, { stable: true }]]),
      source("right", [[1, 99, { stable: true }]]),
      { keyColumns: ["id"], comparedColumns: ["payload"] },
    );

    expect(result.counts).toMatchObject({ equal: 1, changed: 0 });
    expect(result.comparedColumns).toEqual(["payload"]);
  });

  it("opens metadata-backed table comparisons without loaded table tabs", () => {
    const left = source("endpoint:left:public:users", [], {
      sourceKind: "table",
      connectionId: "left",
      schemaName: "public",
      objectName: "users",
    });
    const right = source("endpoint:right:public:users", [], {
      sourceKind: "table",
      connectionId: "right",
      schemaName: "public",
      objectName: "users",
    });

    const tabId = useTabStore.getState().openDataCompareSourcesTab(left, right);

    expect(tabId).toBeTruthy();
    expect(useTabStore.getState().tabs.find((tab) => tab.id === tabId)).toMatchObject({
      type: "data_compare",
      dataCompareLeft: { connectionId: "left", objectName: "users", rows: [] },
      dataCompareRight: { connectionId: "right", objectName: "users", rows: [] },
    });
    expect(useTabStore.getState().openDataCompareSourcesTab(left, right)).toBe(tabId);
  });
});
