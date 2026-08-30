// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { previewMongoDocumentClone, executeMongoDocumentClone } = vi.hoisted(
  () => ({
    previewMongoDocumentClone: vi.fn(),
    executeMongoDocumentClone: vi.fn(),
  }),
);

vi.mock("@/services/tauri", () => ({
  schemaService: { previewMongoDocumentClone, executeMongoDocumentClone },
}));

import { MongoDocumentCloneDialog } from "./MongoDocumentCloneDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const sourceId = { $oid: "507f1f77bcf86cd799439011" };
const initialPlan = {
  database: "app",
  collection: "users",
  sourceId,
  sourceDocument: {
    _id: sourceId,
    name: "Ada",
    large: { $numberLong: "9223372036854775000" },
  },
  draftDocument: {
    name: "Ada",
    large: { $numberLong: "9223372036854775000" },
  },
  previewDocument: {
    name: "Ada",
    large: { $numberLong: "9223372036854775000" },
  },
  editedFields: [],
  sourceDigest: "1234567890abcdef",
  confirmationToken: "plan-initial",
  serverVersion: "8.0.1",
};

describe("MongoDocumentCloneDialog", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    previewMongoDocumentClone.mockReset().mockResolvedValue(initialPlan);
    executeMongoDocumentClone.mockReset().mockResolvedValue({
      insertedId: { $oid: "507f1f77bcf86cd799439012" },
      message: "Cloned one document into app.users",
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("loads the Host source, invalidates stale review, and inserts only the reviewed draft", async () => {
    const onCloned = vi.fn();
    await act(async () => {
      root.render(
        <MongoDocumentCloneDialog
          open
          connectionId="mongo-1"
          driver="mongodb"
          database="app"
          collection="users"
          sourceId={sourceId}
          onOpenChange={() => undefined}
          onCloned={onCloned}
        />,
      );
    });
    await flush();

    expect(previewMongoDocumentClone).toHaveBeenCalledWith(
      "mongo-1",
      "mongodb",
      {
        database: "app",
        collection: "users",
        sourceId,
        draftDocument: null,
      },
    );
    expect(document.body.textContent).toContain(
      "The source BSON is copied without its `_id`.",
    );

    const editor = document.body.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Clone document JSON"]',
    );
    const insertButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Insert clone"),
    );
    expect(insertButton?.disabled).toBe(false);
    const changedDraft = {
      name: "Grace",
      large: { $numberLong: "9223372036854775000" },
    };
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
        ?.set?.call(editor, JSON.stringify(changedDraft, null, 2));
      editor?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(insertButton?.disabled).toBe(true);

    previewMongoDocumentClone.mockResolvedValueOnce({
      ...initialPlan,
      draftDocument: changedDraft,
      previewDocument: changedDraft,
      editedFields: ["name"],
      confirmationToken: "plan-reviewed",
    });
    const reviewButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Review changes"),
    );
    await act(async () => reviewButton?.click());
    await flush();

    expect(previewMongoDocumentClone).toHaveBeenLastCalledWith(
      "mongo-1",
      "mongodb",
      {
        database: "app",
        collection: "users",
        sourceId,
        draftDocument: changedDraft,
      },
    );
    expect(document.body.textContent).toContain("name");
    expect(insertButton?.disabled).toBe(false);

    await act(async () => insertButton?.click());
    await flush();
    expect(executeMongoDocumentClone).toHaveBeenCalledWith(
      "mongo-1",
      "mongodb",
      {
        database: "app",
        collection: "users",
        sourceId,
        draftDocument: changedDraft,
      },
      "plan-reviewed",
    );
    expect(onCloned).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Document cloned");
  });

  it("keeps the committed receipt when the follow-up grid refresh fails", async () => {
    const onCloned = vi.fn().mockRejectedValue(new Error("refresh failed"));
    await act(async () => {
      root.render(
        <MongoDocumentCloneDialog
          open
          connectionId="mongo-1"
          driver="mongodb"
          database="app"
          collection="users"
          sourceId={sourceId}
          onOpenChange={() => undefined}
          onCloned={onCloned}
        />,
      );
    });
    await flush();

    const insertButton = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Insert clone"),
    );
    await act(async () => insertButton?.click());
    await flush();

    expect(executeMongoDocumentClone).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Document cloned");
    expect(document.body.textContent).not.toContain("refresh failed");
  });
});
