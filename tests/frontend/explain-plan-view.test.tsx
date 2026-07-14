/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExplainPlanView } from "@/components/workspace/ExplainPlanView";
import { requestExplainPlanNodeReveal } from "@/lib/explainPlanNavigation";
import type { ExplainPlan } from "@/services/tauri/types";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const plan: ExplainPlan = {
  id: "tab-1:plan:1",
  driver: "postgres",
  mode: "analyze",
  format: "json",
  generatedInMs: 5.4,
  planningTimeMs: 0.4,
  executionTimeMs: 1.1,
  totalCost: 42.5,
  estimatedRows: 12,
  warnings: [],
  rawPlan: [{ Plan: { "Node Type": "Hash Join" } }],
  root: {
    id: "node-0",
    nodeType: "Hash Join",
    joinType: "Inner",
    totalCost: 42.5,
    estimatedRows: 12,
    actualTotalTimeMs: 0.8,
    children: [
      {
        id: "node-1",
        nodeType: "Seq Scan",
        relation: "users",
        totalCost: 12,
        estimatedRows: 10,
        children: [],
      },
    ],
  },
};

describe("ExplainPlanView", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  const writeText = vi.fn(async () => undefined);

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("shows normalized metrics and reveals a stable node from a UI action", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<ExplainPlanView tabId="tab-1" plan={plan} />);
    });

    expect(document.body.textContent).toContain("42.5");
    expect(document.body.textContent).toContain("Execution time");
    expect(document.body.textContent).toContain("Seq Scan · users");

    await act(async () => {
      requestExplainPlanNodeReveal({
        tabId: "tab-1",
        planId: plan.id,
        nodeId: "node-1",
      });
    });

    expect(document.body.textContent).toContain("Selected node");
    expect(document.body.textContent).toContain("Relationusers");
  });

  it("keeps the original vendor plan available as raw JSON", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<ExplainPlanView tabId="tab-1" plan={plan} />);
    });

    await act(async () => button("Raw JSON").click());
    expect(document.body.textContent).toContain('"Node Type": "Hash Join"');

    await act(async () => button("Copy").click());
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('"Hash Join"'),
    );
  });
});

function button(label: string) {
  const match = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim().startsWith(label),
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`button not found: ${label}`);
  }
  return match;
}
