/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchemaStructuredDraftDialog } from "@/components/workspace/SchemaStructuredDraftDialog";
import { createSchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import type { SchemaSnapshot } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  load: vi.fn(async () => null),
  save: vi.fn(async (_snapshot: unknown, relations: unknown) => ({
    updatedAt: 100,
    relations,
  })),
  remove: vi.fn(async () => undefined),
}));

vi.mock("@/services/schemaDiagramDraftStore", () => ({
  loadSchemaDiagramDraft: mocks.load,
  saveSchemaDiagramDraft: mocks.save,
  deleteSchemaDiagramDraft: mocks.remove,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot: SchemaSnapshot = {
  version: 1,
  id: "snapshot-1",
  fingerprint: "fingerprint-1",
  projectId: "project-1",
  connectionId: "connection-1",
  connectionName: "Local",
  driver: "postgres",
  databaseName: "app",
  schemaName: "public",
  capturedAt: 1,
  warnings: [],
  relations: [{
    name: "users",
    objectType: "BASE TABLE",
    columns: [{
      name: "id",
      data_type: "bigint",
      is_nullable: false,
      is_primary_key: true,
    }],
    indexes: [],
    constraints: [],
  }],
};

function DraftHarness() {
  const [canvasHistory, setCanvasHistory] = useState(createSchemaDiagramCanvasHistory());
  return (
    <SchemaStructuredDraftDialog
      open
      snapshot={snapshot}
      canvasHistory={canvasHistory}
      onCanvasHistoryChange={setCanvasHistory}
      onClose={vi.fn()}
    />
  );
}

describe("SchemaStructuredDraftDialog", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
    document.querySelectorAll("[data-radix-focus-guard]").forEach((node) => node.remove());
  });

  it("commits an interactive draft to canvas history and queues a project autosave", async () => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<DraftHarness />);
    });
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledWith(snapshot));

    const input = document.querySelector<HTMLInputElement>(
      "input[aria-label='New draft relation name']",
    );
    expect(input).not.toBeNull();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(input, "orders");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const addRelation = [...document.querySelectorAll("button")].find((button) =>
      button.title === "Add relation",
    );
    await act(async () => addRelation?.click());

    await vi.waitFor(() => expect(document.body.textContent).toContain("orders"));
    await vi.waitFor(
      () => expect(mocks.save).toHaveBeenCalledWith(
        snapshot,
        expect.arrayContaining([expect.objectContaining({ name: "orders" })]),
      ),
      { timeout: 1_500 },
    );
  });
});
