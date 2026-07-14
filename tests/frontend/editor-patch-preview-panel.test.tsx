/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorPatchPreviewPanel } from "@/components/workspace/EditorPatchPreviewPanel";
import type { EditorPatchPreview } from "@/lib/editorPatch";

const patch: EditorPatchPreview = {
  id: "patch-1",
  title: "Select explicit columns",
  rationale: "Avoid SELECT *",
  range: { startLine: 1, startColumn: 8, endLine: 1, endColumn: 9 },
  originalText: "*",
  replacement: "id, email",
  expectedRevision: "revision-1",
};

describe("EditorPatchPreviewPanel", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("shows before and after text and applies only after a click", () => {
    const onApply = vi.fn(() => ({
      status: "success" as const,
      appliedRange: patch.range,
    }));
    const onDismiss = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <EditorPatchPreviewPanel
          patch={patch}
          stale={false}
          onApply={onApply}
          onDismiss={onDismiss}
        />,
      );
    });

    expect(container.textContent).toContain("Before");
    expect(container.textContent).toContain("After");
    expect(container.textContent).toContain("id, email");
    expect(onApply).not.toHaveBeenCalled();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('button[title="Apply this patch"]')
        ?.click();
    });
    expect(onApply).toHaveBeenCalledOnce();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('button[title="Dismiss patch"]')
        ?.click();
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("disables apply when the document revision is stale", () => {
    const onApply = vi.fn(() => ({
      status: "success" as const,
      appliedRange: patch.range,
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <EditorPatchPreviewPanel
          patch={patch}
          stale
          onApply={onApply}
          onDismiss={() => undefined}
        />,
      );
    });

    const apply = container.querySelector<HTMLButtonElement>(
      'button[title="Refresh the proposal against the current document"]',
    );
    expect(apply?.disabled).toBe(true);
    expect(container.textContent).toContain("Document changed");
    apply?.click();
    expect(onApply).not.toHaveBeenCalled();
  });
});
