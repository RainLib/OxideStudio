import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeWithInterceptors } = vi.hoisted(() => ({
  invokeWithInterceptors: vi.fn(),
}));

vi.mock("./client", () => ({ invokeWithInterceptors }));

import {
  executeMongoDocumentClone,
  executeMongoDocumentDelete,
  executeMongoDocumentEdit,
  previewMongoDocumentClone,
  previewMongoDocumentDelete,
  previewMongoDocumentEdit,
} from "./schema.service";

describe("MongoDB document clone service", () => {
  beforeEach(() => invokeWithInterceptors.mockReset());

  it("keeps initial source identity separate from the optional draft", async () => {
    invokeWithInterceptors.mockResolvedValue({ confirmationToken: "plan-1" });
    const sourceId = { $oid: "507f1f77bcf86cd799439011" };

    await previewMongoDocumentClone("connection-1", "mongodb", {
      database: "app",
      collection: "users",
      sourceId,
      draftDocument: null,
    });

    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "preview_mongodb_document_clone",
      {
        connectionId: "connection-1",
        driver: "mongodb",
        request: {
          database: "app",
          collection: "users",
          sourceId,
          draftDocument: null,
        },
      },
    );
  });

  it("executes only the exact reviewed draft and plan token", async () => {
    invokeWithInterceptors.mockResolvedValue({
      insertedId: { $oid: "507f1f77bcf86cd799439012" },
      message: "Cloned one document",
    });
    const clone = {
      database: "app",
      collection: "users",
      sourceId: 7,
      draftDocument: { name: "Grace" },
    };

    await executeMongoDocumentClone(
      "connection-1",
      "mongodb",
      clone,
      "plan-1",
    );

    expect(invokeWithInterceptors).toHaveBeenCalledWith(
      "execute_mongodb_document_clone",
      {
        connectionId: "connection-1",
        driver: "mongodb",
        request: { clone, confirmationToken: "plan-1" },
      },
    );
  });
});

describe("MongoDB reviewed document mutation service", () => {
  beforeEach(() => invokeWithInterceptors.mockReset());

  it("previews and executes an edit with the exact draft and token", async () => {
    invokeWithInterceptors.mockResolvedValue({ confirmationToken: "edit-1" });
    const edit = {
      database: "app",
      collection: "users",
      sourceId: { $numberLong: "9007199254740993" },
      draftDocument: { name: "Grace" },
    };

    await previewMongoDocumentEdit("connection-1", "mongodb", edit);
    await executeMongoDocumentEdit("connection-1", "mongodb", edit, "edit-1");

    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      1,
      "preview_mongodb_document_edit",
      { connectionId: "connection-1", driver: "mongodb", request: edit },
    );
    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      2,
      "execute_mongodb_document_edit",
      {
        connectionId: "connection-1",
        driver: "mongodb",
        request: { edit, confirmationToken: "edit-1" },
      },
    );
  });

  it("passes the reviewed delete phrase separately from source identity", async () => {
    invokeWithInterceptors.mockResolvedValue({ confirmationToken: "delete-1" });
    const request = {
      database: "app",
      collection: "users",
      sourceId: { $oid: "507f1f77bcf86cd799439011" },
    };

    await previewMongoDocumentDelete("connection-1", "mongodb", request);
    await executeMongoDocumentDelete(
      "connection-1",
      "mongodb",
      request,
      "delete-1",
      "DELETE users",
    );

    expect(invokeWithInterceptors).toHaveBeenNthCalledWith(
      2,
      "execute_mongodb_document_delete",
      {
        connectionId: "connection-1",
        driver: "mongodb",
        request: {
          delete: request,
          confirmationToken: "delete-1",
          confirmationPhrase: "DELETE users",
        },
      },
    );
  });
});
