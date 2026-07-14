import { describe, expect, it } from "vitest";
import {
  rankSearchEverywhereItems,
  searchableDatabaseObjects,
  searchableProjectFilePaths,
} from "@/lib/searchEverywhere";

describe("Search Everywhere indexes", () => {
  it("indexes schemas and deduplicated relations from the active namespace", () => {
    expect(
      searchableDatabaseObjects(
        ["public", "audit", "public"],
        [
          { name: "users", schema: "public", type: "table" },
          { name: "users", schema: "public", type: "table" },
          { name: "active_users", schema: "public", type: "view" },
        ],
        "public"
      )
    ).toEqual([
      { kind: "schema", name: "audit", schema: "audit" },
      { kind: "schema", name: "public", schema: "public" },
      {
        kind: "relation",
        name: "active_users",
        schema: "public",
        objectType: "view",
      },
      {
        kind: "relation",
        name: "users",
        schema: "public",
        objectType: "table",
      },
    ]);
  });

  it("indexes loaded project files once and excludes directories and symlinks", () => {
    expect(
      searchableProjectFilePaths({
        "": [
          {
            relativePath: "queries",
            name: "queries",
            kind: "directory",
            size: 0,
            modifiedAt: null,
            isSymlink: false,
          },
          {
            relativePath: "README.md",
            name: "README.md",
            kind: "file",
            size: 10,
            modifiedAt: null,
            isSymlink: false,
          },
        ],
        queries: [
          {
            relativePath: "queries/report.sql",
            name: "report.sql",
            kind: "file",
            size: 20,
            modifiedAt: null,
            isSymlink: false,
          },
          {
            relativePath: "queries/report.sql",
            name: "report.sql",
            kind: "file",
            size: 20,
            modifiedAt: null,
            isSymlink: false,
          },
          {
            relativePath: "queries/external.sql",
            name: "external.sql",
            kind: "file",
            size: 20,
            modifiedAt: null,
            isSymlink: true,
          },
        ],
      })
    ).toEqual(["queries/report.sql", "README.md"]);
  });

  it("ranks prefix and abbreviation matches and bounds rendered results", () => {
    const items = [
      "audit.completed_jobs",
      "public.account_customer",
      "public.active_connections",
      "public.active_customers",
      "public.users",
    ];

    expect(
      rankSearchEverywhereItems(items, "public active", (item) => item, {
        limit: 2,
      })
    ).toEqual(["public.active_connections", "public.active_customers"]);
    expect(
      rankSearchEverywhereItems(items, "pac", (item) => item, { limit: 2 })
    ).toEqual(["public.account_customer", "public.active_connections"]);
    expect(
      rankSearchEverywhereItems(items, "", (item) => item, { emptyLimit: 2 })
    ).toHaveLength(2);
  });
});
