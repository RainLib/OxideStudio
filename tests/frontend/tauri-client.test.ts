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

  it("preserves backend error codes from Response::err", async () => {
    mocks.invoke.mockResolvedValueOnce({
      success: false,
      error: {
        code: "CONNECTION_ERROR",
        message: "login failed",
      },
    });

    await expect(invokeCommand("connect_db")).rejects.toMatchObject({
      name: "ApiError",
      code: "CONNECTION_ERROR",
      message: "login failed",
    });
  });

  it("wraps low-level invoke failures with INVOKE_ERROR", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("ipc channel closed"));

    await expect(invokeCommand("get_schemas")).rejects.toMatchObject({
      name: "ApiError",
      code: "INVOKE_ERROR",
      message: "ipc channel closed",
    });
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
