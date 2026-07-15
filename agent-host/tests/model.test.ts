import { HumanMessage } from "@langchain/core/messages";
import { SIDECAR_METHODS, type ModelStreamChunk } from "@oxide/agent-contract";
import { describe, expect, it } from "vitest";
import { OxideChatModel } from "../src/model.js";
import type { JsonRpcPeer } from "../src/rpc.js";

describe("OxideChatModel streaming proxy", () => {
  it("forwards Rust model chunks without exposing provider credentials", async () => {
    let notification: ((value: unknown) => unknown) | undefined;
    let capturedRequest: Record<string, unknown> | undefined;
    const peer = {
      subscribeNotification(method: string, handler: (value: unknown) => unknown) {
        expect(method).toBe(SIDECAR_METHODS.modelChunk);
        notification = handler;
        return () => {
          notification = undefined;
        };
      },
      async call(method: string, params: unknown) {
        expect(method).toBe(SIDECAR_METHODS.modelStream);
        capturedRequest = params as Record<string, unknown>;
        const base = params as ModelStreamChunk;
        await notification?.({
          ...base,
          sequence: 0,
          delta: "Oxide ",
          toolCalls: [],
          done: false,
        });
        await notification?.({
          ...base,
          sequence: 1,
          delta: "ready",
          toolCalls: [],
          finishReason: "stop",
          usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
          done: true,
        });
        return {
          content: "Oxide ready",
          model: "test-model",
          finishReason: "stop",
          usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
          toolCalls: [],
        };
      },
    };
    const model = new OxideChatModel(
      peer as unknown as JsonRpcPeer,
      {
        requestId: "request",
        threadId: "thread",
        turnId: "turn",
        contextVersion: "context-v1",
        deadline: Date.now() + 5_000,
      },
      "test-model",
      { streaming: true, toolCalling: true },
    );

    const chunks = [];
    for await (const chunk of model._streamResponseChunks(
      [new HumanMessage("Hello")],
      {},
    )) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.text).join("")).toBe("Oxide ready");
    expect(capturedRequest).toMatchObject({
      threadId: "thread",
      turnId: "turn",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(capturedRequest).not.toHaveProperty("apiKey");
  });
});
