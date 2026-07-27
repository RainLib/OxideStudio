/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorPatchPreviewPanel } from "@/components/workspace/EditorPatchPreviewPanel";
import type { EditorPatchPreview } from "@/lib/editorPatch";
import type {
  ExplainPlanComparison,
  RuntimePlanReview,
} from "@/lib/explainPlanComparison";

const patch: EditorPatchPreview = {
  id: "patch-1",
  title: "Select explicit columns",
  rationale: "Avoid SELECT *",
  range: { startLine: 1, startColumn: 8, endLine: 1, endColumn: 9 },
  originalText: "*",
  replacement: "id, email",
  expectedRevision: "revision-1",
};

const planComparison: ExplainPlanComparison = {
  driver: "postgres",
  totalCost: { before: 100, after: 60, delta: -40, percentChange: -40 },
  estimatedRows: { before: 200, after: 20, delta: -180, percentChange: -90 },
  nodeCount: { before: 1, after: 1, delta: 0, percentChange: 0 },
  facts: [
    {
      label: "users",
      before: "Seq Scan",
      after: "Index Scan · users_active_idx",
    },
  ],
  hotspots: [
    {
      id: "large-full-scan:after:root",
      severity: "warning",
      title: "Large full scan on users",
      evidence: "Seq Scan · users · 25,000 estimated rows · 1,200 cost",
    },
  ],
};

const runtimePlanReview: RuntimePlanReview = {
  driver: "postgres",
  executionTimeMs: 18.4,
  planningTimeMs: 1.2,
  actualRows: 250,
  loops: 1,
  slowestNodes: [
    {
      id: "node-1",
      label: "Index Scan",
      relation: "users",
      actualTotalTimeMs: 15.2,
      actualRows: 5,
      loops: 50,
    },
  ],
  signals: [
    {
      id: "row-misestimate:node-1",
      severity: "warning",
      title: "Row estimate differs at Index Scan",
      evidence: "5 estimated · 250 actual · 50×",
    },
  ],
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

  it("validates the virtual patched SQL only after an explicit click", async () => {
    const onValidate = vi.fn(async () => ({
      valid: true,
      driver: "postgres" as const,
      statementCount: 1,
      diagnostics: [],
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <EditorPatchPreviewPanel
          patch={patch}
          stale={false}
          onValidate={onValidate}
          onApply={() => ({
            status: "success",
            text: "SELECT id, email FROM users",
            appliedRange: patch.range,
          })}
          onDismiss={() => undefined}
        />,
      );
    });

    expect(onValidate).not.toHaveBeenCalled();
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>(
          'button[title="Validate patched SQL syntax without executing it"]',
        )
        ?.click();
    });

    expect(onValidate).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Syntax valid for postgres");
    expect(container.textContent).toContain("nothing executed");
  });

  it("shows parser diagnostics without applying the patch", async () => {
    const onApply = vi.fn(() => ({
      status: "success" as const,
      text: "SELECT FROM users",
      appliedRange: patch.range,
    }));
    const onComparePlans = vi.fn(async (_signal: AbortSignal) => planComparison);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <EditorPatchPreviewPanel
          patch={patch}
          stale={false}
          onValidate={async () => ({
            valid: false,
            driver: "postgres",
            statementCount: 0,
            diagnostics: [
              {
                severity: "error",
                message: "Expected an expression",
                line: 1,
                column: 8,
              },
            ],
          })}
          onComparePlans={onComparePlans}
          onApply={onApply}
          onDismiss={() => undefined}
        />,
      );
    });

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>(
          'button[title="Validate patched SQL syntax without executing it"]',
        )
        ?.click();
    });

    expect(container.textContent).toContain("Line 1, column 8");
    expect(container.textContent).toContain("Expected an expression");
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[title="Fix syntax issues before comparing plans"]',
      )?.disabled,
    ).toBe(true);
    expect(onComparePlans).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("compares plans only after a click and explains the database contact", async () => {
    const onComparePlans = vi.fn(async (_signal: AbortSignal) => planComparison);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <EditorPatchPreviewPanel
          patch={patch}
          stale={false}
          onComparePlans={onComparePlans}
          onApply={() => ({
            status: "success",
            text: "SELECT id, email FROM users",
            appliedRange: patch.range,
          })}
          onDismiss={() => undefined}
        />,
      );
    });

    expect(onComparePlans).not.toHaveBeenCalled();
    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>(
          'button[title="Compare estimated plans for the complete before and after SQL"]',
        )
        ?.click();
    });

    expect(onComparePlans).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Estimated cost");
    expect(container.textContent).toContain("100");
    expect(container.textContent).toContain("60");
    expect(container.textContent).toContain("-40.0%");
    expect(container.textContent).toContain("Plan changes");
    expect(container.textContent).toContain("users_active_idx");
    expect(container.textContent).toContain("Review signals");
    expect(container.textContent).toContain("Large full scan on users");
    expect(container.textContent).toContain("database contacted");
    expect(container.textContent).toContain("neither query executed");
  });

  it("requires inline confirmation before collecting the proposed runtime plan", async () => {
    const onAnalyzeAfterPlan = vi.fn(
      async (_signal: AbortSignal) => runtimePlanReview,
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <EditorPatchPreviewPanel
          patch={patch}
          stale={false}
          onAnalyzeAfterPlan={onAnalyzeAfterPlan}
          onApply={() => ({
            status: "success",
            text: "SELECT id, email FROM users",
            appliedRange: patch.range,
          })}
          onDismiss={() => undefined}
        />,
      );
    });

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>(
          'button[title="Collect actual timing and rows for the proposed SQL"]',
        )
        ?.click();
    });

    expect(onAnalyzeAfterPlan).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Runs the complete proposed read-only query once",
    );

    await act(async () => {
      Array.from(container?.querySelectorAll("button") || [])
        .find((button) => button.textContent?.includes("Run actual"))
        ?.click();
    });

    expect(onAnalyzeAfterPlan).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Execution time");
    expect(container.textContent).toContain("18.4 ms");
    expect(container.textContent).toContain("Slowest reported nodes");
    expect(container.textContent).toContain("Index Scan");
    expect(container.textContent).toContain("Runtime signals");
    expect(container.textContent).toContain("50×");
    expect(container.textContent).toContain(
      "backend-enforced read-only transaction",
    );
    expect(container.textContent).toContain(
      "Timing can vary with cache and load",
    );
  });

  it("can cancel runtime confirmation without contacting the database", () => {
    const onAnalyzeAfterPlan = vi.fn(
      async (_signal: AbortSignal) => runtimePlanReview,
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <EditorPatchPreviewPanel
          patch={patch}
          stale={false}
          onAnalyzeAfterPlan={onAnalyzeAfterPlan}
          onApply={() => ({
            status: "success",
            text: "SELECT id, email FROM users",
            appliedRange: patch.range,
          })}
          onDismiss={() => undefined}
        />,
      );
    });
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>(
          'button[title="Collect actual timing and rows for the proposed SQL"]',
        )
        ?.click();
    });
    act(() => {
      Array.from(container?.querySelectorAll("button") || [])
        .find((button) => button.textContent === "Cancel")
        ?.click();
    });

    expect(onAnalyzeAfterPlan).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(
      "Runs the complete proposed read-only query once",
    );
  });
});
