import { AIMessage, HumanMessage } from "@langchain/core/messages";
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

  it("omits empty assistant tool calls from provider history", async () => {
    let capturedRequest: Record<string, unknown> | undefined;
    const peer = {
      async call(method: string, params: unknown) {
        expect(method).toBe(SIDECAR_METHODS.modelComplete);
        capturedRequest = params as Record<string, unknown>;
        return {
          content: "There are three connections.",
          model: "test-model",
          finishReason: "stop",
          usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
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
      { streaming: false, toolCalling: true },
    );

    await model._generate(
      [
        new HumanMessage("你好"),
        new AIMessage({ content: "你好，有什么可以帮你的吗？", tool_calls: [] }),
        new HumanMessage("现在连接了多少个数据库？"),
      ],
      {},
    );

    const messages = capturedRequest?.messages as Array<
      Record<string, unknown>
    >;
    expect(messages[1]).toEqual({
      role: "assistant",
      content: "你好，有什么可以帮你的吗？",
    });
    expect(messages[1]).not.toHaveProperty("toolCalls");
  });

  it("serializes LangChain tool calls as OpenAI function calls", async () => {
    let capturedRequest: Record<string, unknown> | undefined;
    const peer = {
      async call(method: string, params: unknown) {
        expect(method).toBe(SIDECAR_METHODS.modelComplete);
        capturedRequest = params as Record<string, unknown>;
        return {
          content: "You have three saved connections.",
          model: "test-model",
          finishReason: "stop",
          usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
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
      { streaming: false, toolCalling: true },
    );

    await model._generate(
      [
        new HumanMessage("How many databases are configured?"),
        new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "call-1",
              name: "connection_list",
              args: { projectId: "project-1" },
              type: "tool_call",
            },
          ],
        }),
      ],
      {},
    );

    const messages = capturedRequest?.messages as Array<
      Record<string, unknown>
    >;
    expect(messages[1]?.toolCalls).toEqual([
      {
        id: "call-1",
        type: "function",
        function: {
          name: "connection_list",
          arguments: '{"projectId":"project-1"}',
        },
      },
    ]);
  });
});
