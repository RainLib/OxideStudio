import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeWithInterceptors } = vi.hoisted(() => ({
  invokeWithInterceptors: vi.fn(),
}));

vi.mock("./client", () => ({ invokeWithInterceptors }));

import {
  executeMongoDocumentClone,
  previewMongoDocumentClone,
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
