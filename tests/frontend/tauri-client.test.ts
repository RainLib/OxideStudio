import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeCommand } from "@/services/tauri/client";
import { ApiError } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

describe("tauri api client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves structured backend errors and merges safe context", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: false,
      error: {
        code: "CONNECTION_ERROR",
        message: "login failed",
        retryable: true,
        category: "connection",
        context: { driver: "postgres" },
      },
    });

    await expect(
      invokeCommand("connect_db", {
        connectionId: "connection-1",
        url: "postgres://secret@localhost/database",
      }),
    ).rejects.toMatchObject({
      name: "ApiError",
      code: "CONNECTION_ERROR",
      message: "login failed",
      retryable: true,
      category: "connection",
      context: {
        connectionId: "connection-1",
        driver: "postgres",
      },
    });
  });

  it("assigns command-family codes to unstructured invoke failures", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("ipc channel closed"));

    await expect(
      invokeCommand("get_schemas", { connectionId: "connection-1" }),
    ).rejects.toMatchObject({
      name: "ApiError",
      code: "SCHEMA_COMMAND_FAILED",
      message: "ipc channel closed",
      retryable: true,
      category: "schema",
      context: { connectionId: "connection-1" },
    });
  });

  it("preserves structured command rejections", async () => {
    mocks.invoke.mockRejectedValueOnce({
      code: "REVISION_CONFLICT",
      message: "the file changed on disk",
      retryable: false,
      category: "projectFile",
      context: { relativePath: "query.sql" },
    });

    try {
      await invokeCommand("write_project_file", {
        projectId: "project-1",
        relativePath: "query.sql",
        content: "select secret",
      });
      throw new Error("expected invokeCommand to reject");
    } catch (error) {
      expect(error).toMatchObject({
        code: "REVISION_CONFLICT",
        retryable: false,
        category: "projectFile",
        context: {
          projectId: "project-1",
          relativePath: "query.sql",
        },
      });
      expect((error as ApiError).context).not.toHaveProperty("content");
    }
  });

  it("returns response data when the command succeeds", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: true,
      data: ["public"],
    });

    await expect(invokeCommand<string[]>("get_schemas")).resolves.toEqual([
      "public",
    ]);
  });

  it("throws ApiError instances for typed backend failures", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: false,
      error: {
        code: "QUERY_CANCELLED",
        message: "Query cancelled",
      },
    });

    try {
      await invokeCommand("execute_query");
      throw new Error("expected invokeCommand to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("QUERY_CANCELLED");
    }
  });
});
