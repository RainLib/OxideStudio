import { describe, expect, it } from "vitest";
import {
  approvalSummary,
  canonicalInputDigest,
  citationCandidatesFromObservation,
  projectToolRelativePath,
} from "../src/tools.js";
import { resolveCitedAnswer } from "../src/runtime.js";

describe("canonicalInputDigest", () => {
  it("is stable across insertion order and non-ASCII keys", () => {
    const left = {
      "\u{1f600}": 4,
      z: 1,
      "私": { beta: true, alpha: false },
      "\ue000": 3,
    };
    const right = {
      "\ue000": 3,
      "私": { alpha: false, beta: true },
      z: 1,
      "\u{1f600}": 4,
    };

    expect(canonicalInputDigest(left)).toBe(canonicalInputDigest(right));
    expect(canonicalInputDigest(left)).toBe(
      "ade0aa354115444ab93a17956cefbf7d9bf9fa7ed7f65fb4373741e3aa29d2f4",
    );
  });
});

describe("approvalSummary", () => {
  it("identifies a project file write without echoing its contents", () => {
    const summary = approvalSummary("project.writeFile", {
      path: "queries/report.sql",
      content: "SELECT secret FROM credentials;",
      create: false,
    });

    expect(summary).toContain("Replace queries/report.sql");
    expect(summary).toContain("31 characters");
    expect(summary).not.toContain("SELECT secret");
  });
});

describe("projectToolRelativePath", () => {
  it("publishes only normalized project file paths for file tool activity", () => {
    expect(
      projectToolRelativePath("project.readFile", {
        path: "sql\\reports\\daily.sql",
      }),
    ).toBe("sql/reports/daily.sql");
    expect(
      projectToolRelativePath("project.writeFile", {
        path: "../outside.sql",
      }),
    ).toBeUndefined();
    expect(
      projectToolRelativePath("query.runReadOnly", {
        path: "sql/report.sql",
      }),
    ).toBeUndefined();
  });
});

describe("trusted answer citations", () => {
  const workspace = {
    projectId: "project-1",
    connectionId: "postgres-1",
    database: "app",
    namespace: "public",
    activeTabId: "query-1",
  };

  it("derives stable object evidence from metadata observations", () => {
    const citations = citationCandidatesFromObservation(
      "metadata.describeObject",
      { name: "users" },
      {
        summary: "users metadata",
        data: {
          connectionId: "postgres-1",
          namespace: "public",
          name: "users",
          kind: "relation",
        },
        byteCount: 120,
        truncated: false,
        artifactRef: null,
      },
      workspace,
    );

    expect(citations).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^cite-object-[a-f0-9]{20}$/),
        kind: "databaseObject",
        label: "users",
        detail: "app.public.users",
        connectionId: "postgres-1",
        schemaName: "public",
        objectName: "users",
      }),
    ]);
  });

  it("derives a navigable citation from a user-approved analyzed plan", () => {
    const citations = citationCandidatesFromObservation(
      "workspace.getActiveTab",
      {},
      {
        summary: "active tab",
        data: {
          id: "query-1",
          title: "Revenue query",
          explainPlan: {
            id: "plan-runtime-1",
            driver: "postgres",
            mode: "analyze",
            rootNodeId: "node-0",
            executionTimeMs: 18.5,
            nodes: [
              {
                id: "node-0",
                nodeType: "Index Scan",
                relation: "revenue",
                actualRows: 42,
              },
            ],
          },
        },
        byteCount: 320,
        truncated: false,
        artifactRef: null,
      },
      workspace,
    );

    expect(citations).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^cite-plan-[a-f0-9]{20}$/),
        kind: "planNode",
        label: "Analyzed plan · Index Scan",
        detail: "postgres · analyze · 18.5 ms actual",
        tabId: "query-1",
        planId: "plan-runtime-1",
        nodeId: "node-0",
      }),
    ]);
  });

  it("publishes only citations explicitly referenced by the final answer", () => {
    const candidates = citationCandidatesFromObservation(
      "metadata.listObjects",
      {},
      {
        summary: "2 objects",
        data: [
          { name: "users", namespace: "public", kind: "relation" },
          { name: "audit_log", namespace: "public", kind: "relation" },
        ],
        rowCount: 2,
        byteCount: 180,
        truncated: false,
        artifactRef: null,
      },
      workspace,
    );
    expect(candidates[0]).toMatchObject({
      kind: "databaseSchema",
      label: "public",
      detail: "app.public",
      connectionId: "postgres-1",
      schemaName: "public",
    });
    const users = candidates.find(
      (citation) => citation.kind === "databaseObject",
    );
    if (!users) throw new Error("users citation was not created");

    const result = resolveCitedAnswer(
      `users exists [[cite:${users.id}]], and remains the source [[cite:${users.id}]]. Unknown [[cite:not-observed]].`,
      [users],
    );

    expect(result.content).toBe(
      "users exists [1], and remains the source [1]. Unknown .",
    );
    expect(result.citations).toEqual([users]);
  });
});
