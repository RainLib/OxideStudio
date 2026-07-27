import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

describe("LSP session registry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    mocks.invoke.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps shared sessions alive until the final consumer idle grace expires", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "check_lsp_binary") {
        return {
          version: "test",
          path: "/tmp/sql-lsp",
          exists: true,
        };
      }
      if (command === "lsp_initialize") return "initialized";
      if (command === "lsp_shutdown") return "shutdown";
      if (command === "lsp_is_running") return true;
      return null;
    });
    const registry = await import("@/services/lsp/sessionRegistry");
    const descriptor = await registry.ensureLspSession({
      connectionId: "connection-session-test",
      driver: "postgres",
    });
    expect(descriptor).not.toBeNull();

    const releaseFirst = registry.retainLspSession(descriptor!.key);
    const releaseSecond = registry.retainLspSession(descriptor!.key);
    releaseFirst();
    await vi.advanceTimersByTimeAsync(
      registry.LSP_SESSION_IDLE_SHUTDOWN_MS + 1
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "lsp_shutdown",
      expect.anything()
    );

    releaseSecond();
    await vi.advanceTimersByTimeAsync(
      registry.LSP_SESSION_IDLE_SHUTDOWN_MS - 1
    );
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "lsp_shutdown",
      expect.anything()
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.invoke).toHaveBeenCalledWith("lsp_shutdown", {
      sessionKey: descriptor!.key,
    });
  });
});
