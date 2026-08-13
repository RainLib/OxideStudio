import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiService } from "@/services/tauri/ai.service";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@/services/tauri/client", () => ({
  invokeWithInterceptors: mocks.invoke,
}));

describe("AI service cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards AbortSignal cancellation to the Tauri request", async () => {
    let rejectCompletion: ((error: Error) => void) | undefined;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "ai_chat_completion") {
        return new Promise((_resolve, reject) => {
          rejectCompletion = reject;
        });
      }
      if (command === "cancel_ai_request") {
        rejectCompletion?.(new Error("AI request cancelled"));
        return Promise.resolve(true);
      }
      return Promise.reject(new Error(`Unexpected command: ${command}`));
    });

    const controller = new AbortController();
    const completion = aiService.chatCompletion(
      {
        requestId: "turn-1:chat",
        config: { baseUrl: "http://localhost:11434/v1", model: "test" },
        messages: [{ role: "user", content: "hello" }],
      },
      controller.signal
    );
    controller.abort();

    await expect(completion).rejects.toThrow("AI request cancelled");
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_ai_request", {
      requestId: "turn-1:chat",
    });
  });

  it("does not invoke Tauri when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      aiService.chatCompletion(
        {
          config: { baseUrl: "http://localhost:11434/v1", model: "test" },
          messages: [{ role: "user", content: "hello" }],
        },
        controller.signal
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("maps inline completion to its dedicated cancellable command", async () => {
    mocks.invoke.mockResolvedValueOnce({ text: " FROM users", model: "fim" });
    const result = await aiService.inlineCompletion({
      requestId: "inline-1",
      protocol: "text-completions-fim",
      config: { baseUrl: "http://localhost:11434/v1", model: "fim" },
      prefix: "SELECT *",
      suffix: ";",
      languageId: "postgres",
      dialect: "postgres",
      lspContext: { clause: "SelectContinuationClause" },
    });
    expect(result.text).toBe(" FROM users");
    expect(mocks.invoke).toHaveBeenCalledWith("ai_inline_completion", {
      request: expect.objectContaining({
        requestId: "inline-1",
        protocol: "text-completions-fim",
      }),
    });
  });

  it("publishes only an opaque CLI environment revision after a private environment changes", async () => {
    const listener = vi.fn();
    const unsubscribe = aiService.subscribeCliEnvironmentRevision(listener);
    mocks.invoke.mockResolvedValueOnce({
      keys: ["HTTPS_PROXY"],
      revision: "opaque-revision-1",
    });

    await expect(
      aiService.setCliEnvironment("codex-cli", "default", {
        HTTPS_PROXY: "http://secret.example.test",
      }),
    ).resolves.toEqual(["HTTPS_PROXY"]);

    expect(listener).toHaveBeenCalledWith("codex-cli", "default");
    expect(
      aiService.getCliEnvironmentRevision("codex-cli", "default"),
    ).toBe("opaque-revision-1");
    expect(JSON.stringify(listener.mock.calls)).not.toContain(
      "secret.example.test",
    );
    unsubscribe();
  });
});
