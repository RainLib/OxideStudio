import { describe, expect, it, vi } from "vitest";
import { UiActionRegistry } from "@/ai/ui-actions/registry";
import type {
  UiActionContextSnapshot,
  UiActionRequest,
} from "@/ai/ui-actions/types";

function context(overrides: Partial<UiActionContextSnapshot> = {}) {
  return {
    projectId: "project-a",
    contextVersion: 1,
    activeConnectionId: "connection-a",
    activeDriver: "postgres",
    activeDatabaseName: "app",
    activeNamespace: "public",
    activeTabId: "tab-a",
    documentRevision: "revision-a",
    selectionRevision: null,
    ...overrides,
  } satisfies UiActionContextSnapshot;
}

function request(overrides: Partial<UiActionRequest> = {}): UiActionRequest {
  return {
    id: "action-1",
    action: "workspace.openTab",
    target: { projectId: "project-a", tabId: "tab-a" },
    issuedAgainst: { projectId: "project-a", contextVersion: 1 },
    presentation: { label: "Open tab" },
    ...overrides,
  };
}

describe("UiActionRegistry", () => {
  it("resolves a stable target after unrelated context changes", async () => {
    const execute = vi.fn();
    const registry = new UiActionRegistry({
      captureContext: () => context({ contextVersion: 4, activeTabId: "tab-b" }),
    }).register({
      name: "workspace.openTab",
      description: "Open tab",
      stalePolicy: "project",
      execute,
    });

    const result = await registry.execute(request());

    expect(result).toMatchObject({ status: "success", code: "OK" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: "tab-a" }),
      expect.objectContaining({ actionId: "action-1" })
    );
  });

  it("does not execute an attachment from a different active project", async () => {
    const execute = vi.fn();
    const registry = new UiActionRegistry({
      captureContext: () => context({ projectId: "project-b" }),
    }).register({
      name: "workspace.openTab",
      description: "Open tab",
      execute,
    });

    const result = await registry.execute(request());

    expect(result).toMatchObject({
      status: "stale",
      code: "PROJECT_CONTEXT_STALE",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects revision-bound patches after the document changes", async () => {
    const execute = vi.fn();
    const registry = new UiActionRegistry({
      captureContext: () => context({ documentRevision: "revision-b" }),
      documentRevisionForTab: () => "revision-b",
    }).register({
      name: "editor.previewPatch",
      description: "Preview patch",
      stalePolicy: "document",
      execute,
    });

    const result = await registry.execute(
      request({
        action: "editor.previewPatch",
        target: { projectId: "project-a", tabId: "tab-a" },
        issuedAgainst: {
          projectId: "project-a",
          contextVersion: 1,
          documentRevision: "revision-a",
        },
      })
    );

    expect(result).toMatchObject({
      status: "stale",
      code: "DOCUMENT_REVISION_STALE",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns stable invalid-target and unsupported codes", async () => {
    const registry = new UiActionRegistry({
      captureContext: () => context(),
    }).register({
      name: "workspace.openTab",
      description: "Open tab",
      validateTarget: (target) => (target.tabId ? null : "tabId is required."),
      execute: vi.fn(),
    });

    await expect(
      registry.execute(
        request({ target: { projectId: "project-a" } })
      )
    ).resolves.toMatchObject({ status: "invalid", code: "INVALID_TARGET" });

    await expect(
      registry.execute(request({ action: "task.reveal" }))
    ).resolves.toMatchObject({
      status: "unsupported",
      code: "UNSUPPORTED_ACTION",
    });
  });
});
