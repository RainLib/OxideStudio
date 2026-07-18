import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import {
  SIDECAR_METHODS,
  agentToolManifestEntrySchema,
  modelStreamChunkSchema,
  modelResponseSchema,
  type AgentToolManifestEntry,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamChunk,
  type ModelStreamRequest,
  type RequestMetadata,
} from "@oxide/agent-contract";
import { randomUUID } from "node:crypto";
import type { JsonRpcPeer } from "./rpc.js";

type ToolLike = {
  name?: unknown;
  description?: unknown;
  schema?: unknown;
  function?: {
    name?: unknown;
    description?: unknown;
    parameters?: unknown;
  };
};

export class OxideChatModel extends BaseChatModel {
  static lc_name(): string {
    return "ChatOpenAI";
  }

  readonly modelName: string;
  private modelRequestSequence = 0;

  constructor(
    private readonly peer: JsonRpcPeer,
    private readonly requestMetadata: RequestMetadata,
    private readonly providerModel: string,
    private readonly providerProfile: {
      maxInputTokens?: number;
      maxOutputTokens?: number;
      toolCalling?: boolean;
      structuredOutput?: boolean;
      streaming?: boolean;
    } = {},
    private readonly boundTools: AgentToolManifestEntry[] = [],
    harnessModelName = providerModel,
    private readonly requestLimiter = new AsyncSemaphore(2),
  ) {
    super({});
    this.modelName = harnessModelName;
  }

  _llmType(): string {
    return "oxide-rust-model-proxy";
  }

  override get profile() {
    return this.providerProfile;
  }

  bindTools(tools: unknown[]): Runnable {
    const manifests = tools.map(toolManifestFromLangChainTool);
    const model = new OxideChatModel(
      this.peer,
      this.requestMetadata,
      this.providerModel,
      this.providerProfile,
      manifests,
      this.modelName,
      this.requestLimiter,
    );
    return model;
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): Promise<ChatResult> {
    if (options.signal?.aborted) throw abortError();
    const request: ModelRequest = {
      ...this.requestMetadata,
      requestId: `${this.requestMetadata.requestId}:model:${++this.modelRequestSequence}`,
      messages: messages.map(serializeMessage),
      tools: this.boundTools,
    };
    const remaining = Math.max(1, this.requestMetadata.deadline - Date.now());
    const release = await this.requestLimiter.acquire(options.signal);
    let raw: unknown;
    try {
      raw = await this.peer.call<unknown>(SIDECAR_METHODS.modelComplete, request, {
        timeoutMs: remaining,
        signal: options.signal,
      });
    } finally {
      release();
    }
    const response = modelResponseSchema.parse(raw);
    const toolCalls = response.toolCalls.map(normalizeToolCall);
    const message = new AIMessage({
      content: response.content,
      tool_calls: toolCalls,
      response_metadata: {
        finish_reason: response.finishReason,
        model_name: response.model ?? undefined,
      },
      usage_metadata: response.usage
        ? {
            input_tokens: response.usage.inputTokens,
            output_tokens: response.usage.outputTokens,
            total_tokens: response.usage.totalTokens,
          }
        : undefined,
    });
    return {
      generations: [
        {
          text: response.content,
          message,
          generationInfo: {
            finishReason: response.finishReason,
            model: response.model,
          },
        },
      ],
      llmOutput: response.usage ? { tokenUsage: response.usage } : undefined,
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
  ): AsyncGenerator<ChatGenerationChunk> {
    if (!this.providerProfile.streaming) {
      const result = await this._generate(messages, options);
      const generation = result.generations[0];
      if (!generation) return;
      const message = generation.message as AIMessage;
      yield new ChatGenerationChunk({
        text: generation.text,
        message: new AIMessageChunk({
          content: message.content,
          tool_calls: message.tool_calls,
          usage_metadata: message.usage_metadata,
          response_metadata: message.response_metadata,
        }),
      });
      return;
    }

    const streamId = randomUUID();
    const release = await this.requestLimiter.acquire(options.signal);
    const requestId = `${this.requestMetadata.requestId}:model:${++this.modelRequestSequence}`;
    const request: ModelStreamRequest = {
      ...this.requestMetadata,
      requestId,
      streamId,
      messages: messages.map(serializeMessage),
      tools: this.boundTools,
    };
    const queue = new AsyncNotificationQueue<ModelStreamChunk>();
    let emittedText = false;
    let emittedToolCall = false;
    let lastSequence = -1;
    const unsubscribe = this.peer.subscribeNotification(
      SIDECAR_METHODS.modelChunk,
      (raw) => {
        const parsed = modelStreamChunkSchema.safeParse(raw);
        if (
          parsed.success &&
          parsed.data.streamId === streamId &&
          parsed.data.requestId === requestId &&
          parsed.data.sequence > lastSequence
        ) {
          lastSequence = parsed.data.sequence;
          queue.push(parsed.data);
        }
      },
    );
    const remaining = Math.max(1, this.requestMetadata.deadline - Date.now());
    const responsePromise = this.peer
      .call<unknown>(SIDECAR_METHODS.modelStream, request, {
        timeoutMs: remaining,
        signal: options.signal,
      })
      .then((raw) => {
        const response = modelResponseSchema.parse(raw);
        queue.close();
        return { response, error: null };
      })
      .catch((error: unknown) => {
        queue.fail(error);
        return { response: null, error };
      });

    try {
      for await (const chunk of queue) {
        emittedText ||= chunk.delta.length > 0;
        emittedToolCall ||= chunk.toolCalls.length > 0;
        yield generationChunk(chunk);
      }
      const outcome = await responsePromise;
      if (outcome.error) throw outcome.error;
      const finalResponse = outcome.response;
      if (!finalResponse) throw new Error("Model stream ended without a response");
      if (
        (!emittedText && finalResponse.content.length > 0) ||
        (!emittedToolCall && finalResponse.toolCalls.length > 0)
      ) {
        yield generationChunk({
          ...this.requestMetadata,
          requestId,
          streamId,
          sequence: lastSequence + 1,
          delta: emittedText ? "" : finalResponse.content,
          toolCalls: emittedToolCall ? [] : finalResponse.toolCalls,
          finishReason: finalResponse.finishReason,
          usage: finalResponse.usage,
          done: true,
        });
      }
    } finally {
      unsubscribe();
      release();
    }
  }
}

function generationChunk(chunk: ModelStreamChunk): ChatGenerationChunk {
  const usage = chunk.usage ?? undefined;
  const message = new AIMessageChunk({
    content: chunk.delta,
    tool_call_chunks: normalizeToolCallChunks(chunk.toolCalls),
    response_metadata: chunk.finishReason
      ? { finish_reason: chunk.finishReason }
      : {},
    usage_metadata: usage
      ? {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          total_tokens: usage.totalTokens,
        }
      : undefined,
  });
  return new ChatGenerationChunk({ text: chunk.delta, message });
}

function normalizeToolCallChunks(values: Array<Record<string, unknown>>) {
  return values.map((value, position) => {
    const functionValue = isRecord(value.function) ? value.function : undefined;
    const rawArguments = value.args ?? functionValue?.arguments;
    return {
      type: "tool_call_chunk" as const,
      id: typeof value.id === "string" ? value.id : undefined,
      name:
        typeof value.name === "string"
          ? value.name
          : typeof functionValue?.name === "string"
            ? functionValue.name
            : undefined,
      args:
        typeof rawArguments === "string"
          ? rawArguments
          : rawArguments === undefined
            ? undefined
            : JSON.stringify(rawArguments),
      index: typeof value.index === "number" ? value.index : position,
    };
  });
}

class AsyncNotificationQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private closed = false;
  private error: unknown;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  fail(error: unknown): void {
    if (this.closed) return;
    this.error = error;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { value, done: false };
        if (this.error) throw this.error;
        if (this.closed) return { value: undefined, done: true };
        return await new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        });
      },
    };
  }
}

class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<{
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];

  constructor(private readonly limit: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw abortError();
    if (this.active < this.limit) {
      this.active += 1;
      return this.releaseHandle();
    }
    return await new Promise<() => void>((resolve, reject) => {
      const waiter: (typeof this.waiters)[number] = { resolve, reject, signal };
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(abortError());
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private releaseHandle(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.waiters.shift();
      if (waiter) {
        if (waiter.onAbort) {
          waiter.signal?.removeEventListener("abort", waiter.onAbort);
        }
        waiter.resolve(this.releaseHandle());
      } else {
        this.active = Math.max(0, this.active - 1);
      }
    };
  }
}

function serializeMessage(message: BaseMessage): ModelRequest["messages"][number] {
  const type = message._getType();
  const role =
    type === "human"
      ? "user"
      : type === "ai"
        ? "assistant"
        : type === "tool"
          ? "tool"
          : "system";
  const value = message as BaseMessage & {
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<Record<string, unknown>>;
  };
  const serialized: ModelRequest["messages"][number] = {
    role,
    content: message.content,
  };
  if (typeof value.name === "string" && value.name.trim()) {
    serialized.name = value.name;
  }
  if (role === "tool" && typeof value.tool_call_id === "string") {
    const toolCallId = value.tool_call_id.trim();
    if (toolCallId) serialized.toolCallId = toolCallId;
  }
  if (
    role === "assistant" &&
    Array.isArray(value.tool_calls) &&
    value.tool_calls.length > 0
  ) {
    serialized.toolCalls = value.tool_calls.map(serializeToolCallForProvider);
  }
  return serialized;
}

function serializeToolCallForProvider(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const functionValue = isRecord(value.function) ? value.function : undefined;
  const name =
    typeof value.name === "string"
      ? value.name
      : typeof functionValue?.name === "string"
        ? functionValue.name
        : "unknown_tool";
  const rawArguments = value.args ?? functionValue?.arguments ?? {};
  const argumentsValue =
    typeof rawArguments === "string"
      ? rawArguments
      : JSON.stringify(rawArguments);

  return {
    ...(typeof value.id === "string" && value.id.trim()
      ? { id: value.id.trim() }
      : {}),
    type: "function",
    function: {
      name,
      arguments: argumentsValue,
    },
  };
}

function toolManifestFromLangChainTool(tool: unknown): AgentToolManifestEntry {
  const value = tool as ToolLike;
  const functionValue = value.function;
  const name =
    typeof value.name === "string"
      ? value.name
      : typeof functionValue?.name === "string"
        ? functionValue.name
        : "unknown_tool";
  const description =
    typeof value.description === "string"
      ? value.description
      : typeof functionValue?.description === "string"
        ? functionValue.description
        : "";
  let inputSchema: Record<string, unknown> = { type: "object" };
  if (functionValue?.parameters && isRecord(functionValue.parameters)) {
    inputSchema = functionValue.parameters;
  } else if (value.schema) {
    const converted = toJsonSchema(value.schema as Parameters<typeof toJsonSchema>[0]);
    if (isRecord(converted)) inputSchema = converted;
  }
  return agentToolManifestEntrySchema.parse({
    name,
    description,
    inputSchema,
    permissions: ["read"],
  });
}

function normalizeToolCall(value: Record<string, unknown>) {
  const functionValue = isRecord(value.function) ? value.function : undefined;
  const name =
    typeof value.name === "string"
      ? value.name
      : typeof functionValue?.name === "string"
        ? functionValue.name
        : "unknown_tool";
  const id = typeof value.id === "string" ? value.id : undefined;
  const rawArgs = value.args ?? functionValue?.arguments ?? {};
  let args: Record<string, unknown>;
  if (typeof rawArgs === "string") {
    try {
      const parsed = JSON.parse(rawArgs) as unknown;
      args = isRecord(parsed) ? parsed : {};
    } catch {
      args = {};
    }
  } else {
    args = isRecord(rawArgs) ? rawArgs : {};
  }
  return { id, name, args, type: "tool_call" as const };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function abortError(): Error {
  const error = new Error("Agent model request cancelled");
  error.name = "AbortError";
  return error;
}
