import { describe, expect, it } from "vitest";
import {
  createWorkspaceContextBinding,
  workspaceContextStaleReason,
} from "@/ai/workspaceContext";
import type { UiActionContextSnapshot } from "@/ai/ui-actions/types";

const snapshot: UiActionContextSnapshot = {
  projectId: "project-a",
  contextVersion: 4,
  activeConnectionId: "postgres-1",
  activeDriver: "postgres",
  activeDatabaseName: "analytics",
  activeNamespace: "public",
  activeTabId: "query-1",
  documentRevision: "memory:document-a",
  selectionRevision: "selection-a",
};

describe("workspace context binding", () => {
  it("creates a stable data-minimized fingerprint", () => {
    const first = createWorkspaceContextBinding(snapshot);
    const second = createWorkspaceContextBinding({ ...snapshot });

    expect(second).toEqual(first);
    expect(first.fingerprint).toMatch(/^ctx-/u);
    expect(JSON.stringify(first)).not.toContain("SELECT");
  });

  it("invalidates a plan after database, document, selection, or version changes", () => {
    const expected = createWorkspaceContextBinding(snapshot);
    expect(
      workspaceContextStaleReason(
        expected,
        createWorkspaceContextBinding({
          ...snapshot,
          contextVersion: 5,
          activeDatabaseName: "warehouse",
        }),
      ),
    ).toBe("The active database changed.");
    expect(
      workspaceContextStaleReason(
        expected,
        createWorkspaceContextBinding({
          ...snapshot,
          contextVersion: 5,
          documentRevision: "memory:document-b",
        }),
      ),
    ).toBe("The active document changed.");
    expect(
      workspaceContextStaleReason(
        expected,
        createWorkspaceContextBinding({
          ...snapshot,
          contextVersion: 5,
          selectionRevision: "selection-b",
        }),
      ),
    ).toBe("The editor selection changed.");
    expect(
      workspaceContextStaleReason(
        expected,
        createWorkspaceContextBinding({ ...snapshot, contextVersion: 5 }),
      ),
    ).toBe("The workspace context changed.");
  });
});
