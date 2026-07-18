import type { Readable, Writable } from "node:stream";
import { ZodError } from "zod";
import {
  AGENT_HOST_MAX_FRAME_BYTES,
  jsonRpcNotificationSchema,
  jsonRpcRequestSchema,
  jsonRpcResponseSchema,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "@oxide/agent-contract";

const HEADER_TERMINATOR = Buffer.from("\r\n\r\n", "ascii");
const MAX_HEADER_BYTES = 8 * 1024;

export class ContentLengthDecoder {
  private buffer = Buffer.alloc(0);
  private expectedBytes: number | null = null;

  constructor(private readonly maxFrameBytes = AGENT_HOST_MAX_FRAME_BYTES) {}

  push(chunk: Buffer | Uint8Array | string): unknown[] {
    const bytes =
      typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    this.buffer =
      this.buffer.length === 0 ? bytes : Buffer.concat([this.buffer, bytes]);
    const messages: unknown[] = [];

    while (true) {
      if (this.expectedBytes === null) {
        const headerEnd = this.buffer.indexOf(HEADER_TERMINATOR);
        if (headerEnd < 0) {
          if (this.buffer.length > MAX_HEADER_BYTES) {
            throw new AgentProtocolError("FRAME_HEADER_TOO_LARGE");
          }
          break;
        }
        if (headerEnd > MAX_HEADER_BYTES) {
          throw new AgentProtocolError("FRAME_HEADER_TOO_LARGE");
        }
        const header = this.buffer.subarray(0, headerEnd).toString("ascii");
        this.buffer = this.buffer.subarray(headerEnd + HEADER_TERMINATOR.length);
        const lengthHeader = header
          .split("\r\n")
          .find((line) => line.toLowerCase().startsWith("content-length:"));
        const value = lengthHeader?.slice("content-length:".length).trim();
        if (!value || !/^\d+$/u.test(value)) {
          throw new AgentProtocolError("FRAME_CONTENT_LENGTH_MISSING");
        }
        const length = Number(value);
        if (!Number.isSafeInteger(length) || length <= 0) {
          throw new AgentProtocolError("FRAME_CONTENT_LENGTH_INVALID");
        }
        if (length > this.maxFrameBytes) {
          throw new AgentProtocolError("FRAME_TOO_LARGE");
        }
        this.expectedBytes = length;
      }

      if (this.buffer.length < this.expectedBytes) break;
      const payload = this.buffer.subarray(0, this.expectedBytes);
      this.buffer = this.buffer.subarray(this.expectedBytes);
      this.expectedBytes = null;
      try {
        messages.push(JSON.parse(payload.toString("utf8")) as unknown);
      } catch {
        throw new AgentProtocolError("FRAME_INVALID_JSON");
      }
    }

    return messages;
  }
}

export function encodeContentLengthFrame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  if (payload.length > AGENT_HOST_MAX_FRAME_BYTES) {
    throw new AgentProtocolError("FRAME_TOO_LARGE");
  }
  return Buffer.concat([
    Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "ascii"),
    payload,
  ]);
}

export class AgentProtocolError extends Error {
  constructor(
    public readonly code: string,
    message = code,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "AgentProtocolError";
  }
}

type RpcHandler = (params: unknown) => unknown | Promise<unknown>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  cleanup: () => void;
};

type RpcCallOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export class JsonRpcPeer {
  private readonly decoder = new ContentLengthDecoder();
  private readonly handlers = new Map<string, RpcHandler>();
  private readonly notificationHandlers = new Map<string, Set<RpcHandler>>();
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private sequence = 0;
  private writeChain = Promise.resolve();
  private closed = false;

  constructor(
    private readonly readable: Readable,
    private readonly writable: Writable,
  ) {}

  register(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler);
  }

  registerNotification(method: string, handler: RpcHandler): void {
    this.notificationHandlers.set(method, new Set([handler]));
  }

  subscribeNotification(method: string, handler: RpcHandler): () => void {
    const handlers = this.notificationHandlers.get(method) ?? new Set<RpcHandler>();
    handlers.add(handler);
    this.notificationHandlers.set(method, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.notificationHandlers.delete(method);
    };
  }

  async call<T>(
    method: string,
    params: unknown,
    timeoutOrOptions: number | RpcCallOptions = 30_000,
  ): Promise<T> {
    if (this.closed) throw new AgentProtocolError("PEER_CLOSED");
    const options =
      typeof timeoutOrOptions === "number"
        ? { timeoutMs: timeoutOrOptions }
        : timeoutOrOptions;
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (options.signal?.aborted) throw abortError();
    const id = `sidecar-${++this.sequence}`;
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        pending?.cleanup();
        this.pending.delete(id);
        void this.notify("$/cancelRequest", { id }).catch(() => undefined);
        reject(new AgentProtocolError("RPC_TIMEOUT", `${method} timed out`));
      }, timeoutMs);
      timer.unref?.();
      const onAbort = () => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(timer);
        pending.cleanup();
        this.pending.delete(id);
        void this.notify("$/cancelRequest", { id }).catch(() => undefined);
        reject(abortError());
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        cleanup: () => options.signal?.removeEventListener("abort", onAbort),
      });
    });
    try {
      await this.write({ jsonrpc: "2.0", id, method, params });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.cleanup();
        this.pending.delete(id);
      }
      throw error;
    }
    return (await response) as T;
  }

  async notify(method: string, params: unknown): Promise<void> {
    if (this.closed) throw new AgentProtocolError("PEER_CLOSED");
    await this.write({ jsonrpc: "2.0", method, params });
  }

  async run(): Promise<void> {
    try {
      for await (const chunk of this.readable) {
        for (const message of this.decoder.push(chunk as Buffer)) {
          await this.dispatch(message);
        }
      }
      this.close(new AgentProtocolError("PEER_EOF"));
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error("Agent RPC peer failed");
      this.close(normalized);
      throw normalized;
    }
  }

  close(reason: Error = new AgentProtocolError("PEER_CLOSED")): void {
    if (this.closed) return;
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.cleanup();
      request.reject(reason);
    }
    this.pending.clear();
  }

  private async dispatch(value: unknown): Promise<void> {
    if (hasMethod(value)) {
      const request = jsonRpcRequestSchema.safeParse(value);
      if (request.success) {
        await this.handleRequest(request.data);
        return;
      }

      const notification = jsonRpcNotificationSchema.safeParse(value);
      if (notification.success) {
        await this.handleNotification(notification.data);
        return;
      }
    } else {
      const response = jsonRpcResponseSchema.safeParse(value);
      if (response.success) {
        this.resolveResponse(response.data);
        return;
      }
    }

    throw new AgentProtocolError("RPC_MESSAGE_INVALID");
  }

  private resolveResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.cleanup();
    this.pending.delete(response.id);
    if (response.error) {
      pending.reject(
        new AgentProtocolError(
          `RPC_${response.error.code}`,
          response.error.message,
          response.error.data,
        ),
      );
    } else {
      pending.resolve(response.result);
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    const handler = this.handlers.get(request.method);
    if (!handler) {
      await this.write({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: "Method not found" },
      });
      return;
    }
    try {
      const result = await handler(request.params);
      await this.write({ jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      const protocolError =
        error instanceof AgentProtocolError ? error : undefined;
      const validationError = error instanceof ZodError ? error : undefined;
      await this.write({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: protocolError ? -32001 : validationError ? -32602 : -32603,
          message:
            protocolError?.message ??
            (validationError
              ? validationError.issues
                  .slice(0, 8)
                  .map(
                    (issue) =>
                      `${issue.path.join(".") || "params"}: ${issue.message}`,
                  )
                  .join("; ")
              : error instanceof Error
                ? error.message.slice(0, 1_000)
                : "Agent request failed"),
          ...(protocolError?.data === undefined
            ? {}
            : { data: protocolError.data }),
        },
      });
    }
  }

  private async handleNotification(
    notification: JsonRpcNotification,
  ): Promise<void> {
    const handlers = this.notificationHandlers.get(notification.method);
    if (!handlers) return;
    for (const handler of handlers) await handler(notification.params);
  }

  private write(value: unknown): Promise<void> {
    const frame = encodeContentLengthFrame(value);
    this.writeChain = this.writeChain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          const onDrain = () => {
            cleanup();
            resolve();
          };
          const cleanup = () => {
            this.writable.off("error", onError);
            this.writable.off("drain", onDrain);
          };
          this.writable.once("error", onError);
          if (this.writable.write(frame)) {
            cleanup();
            resolve();
          } else {
            this.writable.once("drain", onDrain);
          }
        }),
    );
    return this.writeChain;
  }
}

function hasMethod(value: unknown): value is { method: unknown } {
  return value !== null && typeof value === "object" && "method" in value;
}

function abortError(): Error {
  const error = new Error("Agent RPC request cancelled");
  error.name = "AbortError";
  return error;
}
