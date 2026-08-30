// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  previewMongoDocumentEdit: vi.fn(),
  executeMongoDocumentEdit: vi.fn(),
  previewMongoDocumentDelete: vi.fn(),
  executeMongoDocumentDelete: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({ schemaService: services }));

import { MongoDocumentMutationDialog } from "./MongoDocumentMutationDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const sourceId = { $numberLong: "9007199254740993" };
const sourceDocument = {
  _id: sourceId,
  name: "Ada",
  large: { $numberLong: "9223372036854775000" },
};
const editPlan = {
  database: "app",
  collection: "users",
  sourceId,
  sourceDocument,
  draftDocument: { name: "Ada", large: sourceDocument.large },
  previewDocument: sourceDocument,
  editedFields: [],
  sourceDigest: "1234567890abcdef",
  confirmationToken: "edit-initial",
  serverVersion: "8.0.1",
};
const deletePlan = {
  database: "app",
  collection: "users",
  sourceId,
  sourceDocument,
  sourceDigest: "1234567890abcdef",
  confirmationToken: "delete-reviewed",
  confirmationPhrase: "DELETE users",
  serverVersion: "8.0.1",
};

describe("MongoDocumentMutationDialog", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    services.previewMongoDocumentEdit.mockReset().mockResolvedValue(editPlan);
    services.executeMongoDocumentEdit.mockReset().mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
      message: "Saved one document in app.users",
    });
    services.previewMongoDocumentDelete.mockReset().mockResolvedValue(deletePlan);
    services.executeMongoDocumentDelete.mockReset().mockResolvedValue({
      deletedCount: 1,
      message: "Deleted one document from app.users",
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("invalidates an edited draft and saves only its reviewed version", async () => {
    const onMutated = vi.fn();
    await act(async () => {
      root.render(
        <MongoDocumentMutationDialog
          open
          mode="edit"
          connectionId="mongo-1"
          driver="mongodb"
          database="app"
          collection="users"
          sourceId={sourceId}
          onOpenChange={() => undefined}
          onMutated={onMutated}
        />,
      );
    });
    await flush();

    const editor = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="MongoDB document fields"]',
    );
    const saveButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save document"),
    );
    expect(saveButton?.disabled).toBe(true);

    const changedDraft = { name: "Grace", large: sourceDocument.large };
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
        ?.set?.call(editor, JSON.stringify(changedDraft, null, 2));
      editor?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    services.previewMongoDocumentEdit.mockResolvedValueOnce({
      ...editPlan,
      draftDocument: changedDraft,
      previewDocument: { ...sourceDocument, name: "Grace" },
      editedFields: ["name"],
      confirmationToken: "edit-reviewed",
    });
    const reviewButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Review changes"),
    );
    await act(async () => reviewButton?.click());
    await flush();

    expect(saveButton?.disabled).toBe(false);
    await act(async () => saveButton?.click());
    await flush();
    expect(services.executeMongoDocumentEdit).toHaveBeenCalledWith(
      "mongo-1",
      "mongodb",
      {
        database: "app",
        collection: "users",
        sourceId,
        draftDocument: changedDraft,
      },
      "edit-reviewed",
    );
    expect(onMutated).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Document saved");
  });

  it("requires the exact Host-provided phrase before deleting", async () => {
    await act(async () => {
      root.render(
        <MongoDocumentMutationDialog
          open
          mode="delete"
          connectionId="mongo-1"
          driver="mongodb"
          database="app"
          collection="users"
          sourceId={sourceId}
          onOpenChange={() => undefined}
        />,
      );
    });
    await flush();

    const input = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Delete confirmation phrase"]',
    );
    const deleteButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Delete document"),
    );
    expect(deleteButton?.disabled).toBe(true);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(input, "DELETE users");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(deleteButton?.disabled).toBe(false);

    await act(async () => deleteButton?.click());
    await flush();
    expect(services.executeMongoDocumentDelete).toHaveBeenCalledWith(
      "mongo-1",
      "mongodb",
      { database: "app", collection: "users", sourceId },
      "delete-reviewed",
      "DELETE users",
    );
    expect(document.body.textContent).toContain("Document deleted");
  });
});
