import {
  createMcpToolAdapter,
  type McpToolAdapter,
  type McpToolCallOptions,
  type McpToolAdapterOptions,
} from "./adapter";

export type McpJsonRpcId = string | number;

export type McpJsonRpcRequest = {
  jsonrpc: "2.0";
  id?: McpJsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type McpJsonRpcSuccess = {
  jsonrpc: "2.0";
  id: McpJsonRpcId | null;
  result: unknown;
};

export type McpJsonRpcError = {
  jsonrpc: "2.0";
  id: McpJsonRpcId | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export type McpJsonRpcResponse = McpJsonRpcSuccess | McpJsonRpcError;

export type McpProtocolAdapterOptions = McpToolAdapterOptions & {
  adapter?: McpToolAdapter;
  serverName?: string;
  serverVersion?: string;
  protocolVersion?: string;
};

type ActiveMcpRequest = {
  controller: AbortController;
  method: string;
};

const JSON_RPC_VERSION = "2.0";
const DEFAULT_PROTOCOL_VERSION = "2025-11-25";

export class McpProtocolAdapter {
  private readonly adapter: McpToolAdapter;
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly protocolVersion: string;
  private readonly activeRequests = new Map<McpJsonRpcId, ActiveMcpRequest>();

  constructor(options: McpProtocolAdapterOptions = {}) {
    this.adapter = options.adapter ?? createMcpToolAdapter(options);
    this.serverName = options.serverName ?? "oxide-studio";
    this.serverVersion = options.serverVersion ?? "0.1.0";
    this.protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
  }

  async handleJson(input: string): Promise<string | null> {
    let message: unknown;
    try {
      message = JSON.parse(input);
    } catch (err: any) {
      return JSON.stringify(
        errorResponse(null, -32700, `Parse error: ${err?.message || String(err)}`)
      );
    }

    const response = await this.handleMessage(message);
    return response ? JSON.stringify(response) : null;
  }

  async handleMessage(message: unknown): Promise<McpJsonRpcResponse | null> {
    if (!isRequest(message)) {
      return errorResponse(null, -32600, "Invalid JSON-RPC request");
    }

    if (message.id === undefined) {
      await this.handleNotification(message);
      return null;
    }

    const controller = new AbortController();
    this.activeRequests.set(message.id, {
      controller,
      method: message.method,
    });

    try {
      const result = await this.handleRequest(message, controller.signal);
      if (controller.signal.aborted) {
        return null;
      }
      return successResponse(message.id, result);
    } catch (err: any) {
      if (controller.signal.aborted) {
        return null;
      }
      return errorResponse(
        message.id,
        err?.code || -32603,
        err?.message || String(err),
        err?.data
      );
    } finally {
      this.activeRequests.delete(message.id);
    }
  }

  private async handleNotification(request: McpJsonRpcRequest) {
    if (request.method === "notifications/initialized") {
      return;
    }
    if (request.method === "initialized") {
      return;
    }
    if (request.method === "notifications/cancelled") {
      this.cancelRequest(request.params);
      return;
    }
    throw methodNotFound(request.method);
  }

  private async handleRequest(
    request: McpJsonRpcRequest,
    abortSignal: AbortSignal
  ) {
    switch (request.method) {
      case "initialize":
        return this.initializeResult();
      case "tools/list":
        return { tools: this.adapter.listTools() };
      case "tools/call":
        return this.callTool(request.params, abortSignal);
      case "tools/inspect":
      case "oxide/tools/inspect":
        return this.inspectTool(request.params);
      case "tools/manifest":
      case "oxide/tools/manifest":
        return this.adapter.manifest();
      case "ping":
        return {};
      default:
        throw methodNotFound(request.method);
    }
  }

  private cancelRequest(params: Record<string, unknown> | undefined) {
    const requestId = params?.requestId;
    if (typeof requestId !== "string" && typeof requestId !== "number") {
      return;
    }

    const activeRequest = this.activeRequests.get(requestId);
    if (!activeRequest || activeRequest.method === "initialize") {
      return;
    }

    activeRequest.controller.abort();
  }

  private initializeResult() {
    return {
      protocolVersion: this.protocolVersion,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: this.serverName,
        version: this.serverVersion,
      },
    };
  }

  private async callTool(
    params: Record<string, unknown> | undefined,
    abortSignal: AbortSignal
  ) {
    const name = typeof params?.name === "string" ? params.name : "";
    if (!name) {
      throw invalidParams("tools/call requires params.name");
    }

    const toolInput =
      params && "arguments" in params
        ? params.arguments
        : params && "input" in params
          ? params.input
          : {};
    const options = approvalOptions(params);
    return this.adapter.callTool(name, toolInput, {
      ...options,
      abortSignal,
    });
  }

  private inspectTool(params: Record<string, unknown> | undefined) {
    const name = typeof params?.name === "string" ? params.name : "";
    if (!name) {
      throw invalidParams("tools/inspect requires params.name");
    }

    return this.adapter.inspectTool(name);
  }
}

export function createMcpProtocolAdapter(options?: McpProtocolAdapterOptions) {
  return new McpProtocolAdapter(options);
}

function approvalOptions(
  params: Record<string, unknown> | undefined
): McpToolCallOptions {
  const meta = params?._meta;
  const metadata = isObject(meta) ? meta : {};
  return {
    approved:
      params?.approved === true ||
      metadata["oxide/approved"] === true ||
      metadata.approved === true,
    contextOverrides: contextOverrides(params, metadata),
  };
}

function contextOverrides(
  params: Record<string, unknown> | undefined,
  metadata: Record<string, unknown>
): McpToolCallOptions["contextOverrides"] {
  const source =
    objectValue(params?.context) ||
    objectValue(metadata["oxide/context"]) ||
    objectValue(metadata.context);
  if (!source) return undefined;

  const activeConnectionId = nullableString(source.activeConnectionId);
  const activeDriver = nullableString(source.activeDriver);
  const activeNamespace = nullableString(source.activeNamespace);

  return {
    ...(activeConnectionId !== undefined ? { activeConnectionId } : {}),
    ...(activeDriver !== undefined ? { activeDriver } : {}),
    ...(activeNamespace !== undefined ? { activeNamespace } : {}),
  };
}

function objectValue(value: unknown) {
  return isObject(value) ? value : null;
}

function nullableString(value: unknown) {
  if (value === null) return null;
  return typeof value === "string" ? value || null : undefined;
}

function isRequest(value: unknown): value is McpJsonRpcRequest {
  if (!isObject(value)) return false;
  if (value.jsonrpc !== JSON_RPC_VERSION) return false;
  if (typeof value.method !== "string" || !value.method.trim()) return false;
  if (
    value.id !== undefined &&
    typeof value.id !== "string" &&
    typeof value.id !== "number"
  ) {
    return false;
  }
  return value.params === undefined || isObject(value.params);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function successResponse(
  id: McpJsonRpcId,
  result: unknown
): McpJsonRpcSuccess {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  };
}

function errorResponse(
  id: McpJsonRpcId | null,
  code: number,
  message: string,
  data?: unknown
): McpJsonRpcError {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function methodNotFound(method: string) {
  return Object.assign(new Error(`MCP method not found: ${method}`), {
    code: -32601,
  });
}

function invalidParams(message: string) {
  return Object.assign(new Error(message), {
    code: -32602,
  });
}
