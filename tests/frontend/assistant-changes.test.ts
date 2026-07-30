import { describe, expect, it } from "vitest";
import {
  assistantFileChangeAttributions,
  attributionPathsForFilter,
} from "@/lib/assistantFileChanges";
import { createAssistantTurn } from "@/ai/assistant/turns";
import { unifiedDiffHunkPatch, unifiedDiffLines } from "@/lib/unifiedDiff";

describe("assistant change attribution and unified diff", () => {
  it("maps unified diff hunks to stable old and new line numbers", () => {
    const lines = unifiedDiffLines(
      "diff --git a/a.sql b/a.sql\n@@ -10,3 +10,4 @@\n same\n-old\n+new\n+extra\n tail",
    );

    expect(lines.find((line) => line.content === "-old")).toEqual(
      expect.objectContaining({ kind: "remove", oldLine: 11, newLine: null }),
    );
    expect(lines.find((line) => line.content === "+new")).toEqual(
      expect.objectContaining({
        kind: "add",
        oldLine: null,
        newLine: 11,
        hunkIndex: 0,
      }),
    );
    expect(lines.find((line) => line.content === " tail")).toEqual(
      expect.objectContaining({ kind: "context", oldLine: 12, newLine: 13 }),
    );
  });

  it("extracts one complete hunk with the file-level patch headers", () => {
    const patch =
      "diff --git a/a.sql b/a.sql\n--- a/a.sql\n+++ b/a.sql\n@@ -1 +1 @@\n-old\n+new\n@@ -10 +10 @@\n-before\n+after";

    expect(unifiedDiffHunkPatch(patch, 1)).toBe(
      "diff --git a/a.sql b/a.sql\n--- a/a.sql\n+++ b/a.sql\n@@ -10 +10 @@\n-before\n+after",
    );
    expect(unifiedDiffHunkPatch(patch, 2)).toBeNull();
  });

  it("filters current Git files by trusted Agent turn attribution", () => {
    const first = {
      ...createAssistantTurn({
        id: "turn-1",
        requestId: "request-1",
        projectId: "project-1",
        requestedMode: "agent" as const,
        mode: "agent" as const,
        userMessage: "Update report",
      }),
      fileChanges: [
        {
          callId: "call-1",
          relativePath: "queries/report.sql",
          operation: "updated" as const,
          revision: "a".repeat(64),
          occurredAt: 100,
        },
      ],
    };
    const second = {
      ...createAssistantTurn({
        id: "turn-2",
        requestId: "request-2",
        projectId: "project-1",
        requestedMode: "agent" as const,
        mode: "agent" as const,
        userMessage: "Create migration",
      }),
      fileChanges: [
        {
          callId: "call-2",
          relativePath: "migrations/001.sql",
          operation: "created" as const,
          revision: "b".repeat(64),
          occurredAt: 200,
        },
      ],
    };
    const attributions = assistantFileChangeAttributions([first, second]);

    expect(attributionPathsForFilter(attributions, "agent")).toEqual(
      new Set(["queries/report.sql", "migrations/001.sql"]),
    );
    expect(attributionPathsForFilter(attributions, "turn:turn-2")).toEqual(
      new Set(["migrations/001.sql"]),
    );
    expect(attributionPathsForFilter(attributions, "all")).toBeNull();
  });
});
