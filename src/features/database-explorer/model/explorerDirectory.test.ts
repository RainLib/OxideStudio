import { describe, expect, it } from "vitest";
import {
  EXPLORER_DIRECTORY_GROUPS,
  explorerDirectoryGroupForObjectType,
  explorerDirectoryNodeKind,
  groupSchemaObjectDescriptors,
} from "./explorerDirectory";

describe("DBX-compatible database Explorer directory", () => {
  it("keeps the canonical relational group order", () => {
    expect(EXPLORER_DIRECTORY_GROUPS.map((group) => group.kind)).toEqual([
      "tables",
      "views",
      "materialized-views",
      "procedures",
      "functions",
      "triggers",
      "events",
      "sequences",
      "synonyms",
      "jobs",
      "packages",
      "types",
    ]);
  });

  it("normalizes driver-specific object type spellings", () => {
    expect(explorerDirectoryGroupForObjectType("MATERIALIZED VIEW")).toBe(
      "materialized-views",
    );
    expect(explorerDirectoryGroupForObjectType("scheduler-job")).toBe("jobs");
    expect(explorerDirectoryGroupForObjectType("PACKAGE_BODY")).toBe(
      "packages",
    );
  });

  it("maps directory groups to stable selection identities", () => {
    expect(explorerDirectoryNodeKind("materialized-views")).toBe(
      "materialized-view",
    );
    expect(explorerDirectoryNodeKind("procedures")).toBe("procedure");
    expect(explorerDirectoryNodeKind("jobs")).toBe("job");
  });

  it("groups and sorts non-relation schema descriptors", () => {
    const grouped = groupSchemaObjectDescriptors([
      { name: "z_seq", objectType: "SEQUENCE" },
      { name: "audit_users", objectType: "TRIGGER" },
      { name: "a_seq", objectType: "sequence" },
    ]);

    expect(grouped.get("sequences")?.map((item) => item.name)).toEqual([
      "a_seq",
      "z_seq",
    ]);
    expect(grouped.get("triggers")?.map((item) => item.name)).toEqual([
      "audit_users",
    ]);
  });
});
