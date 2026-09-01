/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetProjectSqlFileTargets,
  projectSqlFileTargetStorageKey,
  rememberProjectSqlFileTarget,
  renameProjectSqlFileTargets,
  resolveProjectSqlFileTarget,
} from "./projectSqlFileTarget";

describe("project SQL file targets", () => {
  beforeEach(() => localStorage.clear());

  it("persists only the database target identity", () => {
    expect(
      rememberProjectSqlFileTarget(
        "project-1",
        "queries/daily.sql",
        {
          connectionId: "connection-1",
          databaseName: "analytics",
          schemaName: "reporting",
        },
        42,
      ),
    ).toBe(true);

    expect(
      resolveProjectSqlFileTarget("project-1", "queries/daily.sql"),
    ).toEqual({
      connectionId: "connection-1",
      databaseName: "analytics",
      schemaName: "reporting",
    });
    expect(localStorage.getItem(projectSqlFileTargetStorageKey)).not.toContain(
      "SELECT",
    );
  });

  it("drops a target whose saved connection no longer exists", () => {
    rememberProjectSqlFileTarget("project-1", "query.sql", {
      connectionId: "deleted-connection",
    });

    expect(
      resolveProjectSqlFileTarget("project-1", "query.sql", () => false),
    ).toBeNull();
    expect(
      resolveProjectSqlFileTarget("project-1", "query.sql"),
    ).toBeNull();
  });

  it("rejects unsafe paths and malformed persisted records", () => {
    expect(
      rememberProjectSqlFileTarget("project-1", "../outside.sql", {
        connectionId: "connection-1",
      }),
    ).toBe(false);
    expect(
      rememberProjectSqlFileTarget("project-1", "notes.txt", {
        connectionId: "connection-1",
      }),
    ).toBe(false);

    localStorage.setItem(
      projectSqlFileTargetStorageKey,
      JSON.stringify({
        version: 1,
        records: [
          {
            projectId: "project-1",
            relativePath: "query.sql",
            connectionId: "connection-1\u0000secret",
            updatedAt: 1,
          },
        ],
      }),
    );
    expect(
      resolveProjectSqlFileTarget("project-1", "query.sql"),
    ).toBeNull();
  });

  it("moves directory descendants and removes renamed non-SQL files", () => {
    rememberProjectSqlFileTarget("project-1", "queries/a.sql", {
      connectionId: "connection-a",
    });
    rememberProjectSqlFileTarget("project-1", "queries/nested/b.sql", {
      connectionId: "connection-b",
    });
    rememberProjectSqlFileTarget("project-1", "keep.sql", {
      connectionId: "connection-keep",
    });

    expect(
      renameProjectSqlFileTargets("project-1", "queries", "archive"),
    ).toBe(2);
    expect(
      resolveProjectSqlFileTarget("project-1", "archive/nested/b.sql"),
    ).toEqual({ connectionId: "connection-b" });
    expect(
      resolveProjectSqlFileTarget("project-1", "queries/a.sql"),
    ).toBeNull();
    expect(
      renameProjectSqlFileTargets(
        "project-1",
        "archive/a.sql",
        "archive/a.txt",
      ),
    ).toBe(1);
    expect(
      resolveProjectSqlFileTarget("project-1", "archive/a.txt"),
    ).toBeNull();
    expect(resolveProjectSqlFileTarget("project-1", "keep.sql")).toEqual({
      connectionId: "connection-keep",
    });
  });

  it("forgets only the selected file or directory scope", () => {
    rememberProjectSqlFileTarget("project-1", "queries/a.sql", {
      connectionId: "connection-a",
    });
    rememberProjectSqlFileTarget("project-1", "queries/nested/b.sql", {
      connectionId: "connection-b",
    });
    rememberProjectSqlFileTarget("project-2", "queries/a.sql", {
      connectionId: "connection-c",
    });

    expect(forgetProjectSqlFileTargets("project-1", "queries")).toBe(2);
    expect(
      resolveProjectSqlFileTarget("project-2", "queries/a.sql"),
    ).toEqual({ connectionId: "connection-c" });
  });

  it("bounds persisted target count and keeps the newest records", () => {
    localStorage.setItem(
      projectSqlFileTargetStorageKey,
      JSON.stringify({
        version: 1,
        records: Array.from({ length: 201 }, (_, index) => ({
          projectId: "project-1",
          relativePath: `queries/${index}.sql`,
          connectionId: `connection-${index}`,
          updatedAt: index,
        })),
      }),
    );

    rememberProjectSqlFileTarget(
      "project-1",
      "queries/current.sql",
      { connectionId: "connection-current" },
      10_000,
    );
    const parsed = JSON.parse(
      localStorage.getItem(projectSqlFileTargetStorageKey) || "{}",
    ) as { records?: Array<{ relativePath: string }> };
    expect(parsed.records).toHaveLength(200);
    expect(parsed.records?.[0]?.relativePath).toBe("queries/current.sql");
  });
});
