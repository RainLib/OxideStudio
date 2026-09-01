import { describe, expect, it } from "vitest";
import {
  canManuallyReorderTabs,
  organizeEditorTabs,
  tabPlacementFlexDirection,
  type OrganizableTab,
} from "./tabOrganization";

const connections = [
  { id: "pg-2", name: "Warehouse", driver: "postgres" },
  { id: "mysql-1", name: "Orders", driver: "mysql" },
  { id: "pg-1", name: "Application", driver: "postgres" },
];

function tab(
  id: string,
  title: string,
  connectionId: string | undefined,
  createdAt: number,
  isPinned = false,
): OrganizableTab {
  return { id, title, connectionId, createdAt, isPinned };
}

describe("editor tab organization", () => {
  it("keeps pinned tabs ahead of regular tabs for every sort mode", () => {
    const organized = organizeEditorTabs(
      [
        tab("regular", "A query", "pg-1", 1),
        tab("pinned", "Z query", "mysql-1", 2, true),
      ],
      "none",
      "title-asc",
      connections,
    );

    expect(organized.map(({ tab: item }) => item.id)).toEqual([
      "pinned",
      "regular",
    ]);
    expect(organized[1]?.startsRegularRegion).toBe(true);
  });

  it("groups by database type and sorts titles naturally inside a group", () => {
    const organized = organizeEditorTabs(
      [
        tab("pg-10", "Query 10", "pg-1", 3),
        tab("mysql", "Orders", "mysql-1", 2),
        tab("pg-2", "Query 2", "pg-2", 1),
      ],
      "database-type",
      "title-asc",
      connections,
    );

    expect(organized.map(({ tab: item }) => item.id)).toEqual([
      "mysql",
      "pg-2",
      "pg-10",
    ]);
    expect(
      organized.filter((item) => item.startsGroup).map((item) => item.groupLabel),
    ).toEqual(["mysql", "postgres"]);
  });

  it("groups by connection while preserving manual order within each group", () => {
    const organized = organizeEditorTabs(
      [
        tab("warehouse-2", "Second", "pg-2", 3),
        tab("app", "App", "pg-1", 2),
        tab("warehouse-1", "First", "pg-2", 1),
      ],
      "connection",
      "manual",
      connections,
    );

    expect(organized.map(({ tab: item }) => item.id)).toEqual([
      "app",
      "warehouse-2",
      "warehouse-1",
    ]);
    expect(organized[0]?.groupLabel).toBe("Application");
    expect(organized[1]?.groupLabel).toBe("Warehouse");
    expect(organized.some((item) => item.startsRegularRegion)).toBe(false);
  });

  it("uses stable source order when legacy tabs have no creation time", () => {
    const organized = organizeEditorTabs(
      [
        { id: "first", title: "First", isPinned: false },
        { id: "second", title: "Second", isPinned: false },
      ],
      "none",
      "created-asc",
      [],
    );

    expect(organized.map(({ tab: item }) => item.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("places migrated legacy tabs before newly timestamped tabs", () => {
    const organized = organizeEditorTabs(
      [
        { id: "legacy", title: "Legacy", isPinned: false },
        tab("new", "New", undefined, Date.now()),
      ],
      "none",
      "created-asc",
      [],
    );

    expect(organized.map(({ tab: item }) => item.id)).toEqual([
      "legacy",
      "new",
    ]);
  });

  it("enables drag ordering only in manual mode", () => {
    expect(canManuallyReorderTabs("manual")).toBe(true);
    expect(canManuallyReorderTabs("created-asc")).toBe(false);
    expect(canManuallyReorderTabs("title-asc")).toBe(false);
  });

  it("maps every persisted edge to the work-surface flex direction", () => {
    expect(tabPlacementFlexDirection("top")).toBe("flex-col");
    expect(tabPlacementFlexDirection("bottom")).toBe("flex-col-reverse");
    expect(tabPlacementFlexDirection("left")).toBe("flex-row");
    expect(tabPlacementFlexDirection("right")).toBe("flex-row-reverse");
  });
});
