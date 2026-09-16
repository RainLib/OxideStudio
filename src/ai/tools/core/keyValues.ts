import {
  assertObject,
  optionalPositiveInteger,
  optionalString,
  requirePresent,
  requireString,
  requireStringArray,
} from "@/ai/tools/core/inputValidation";
import { resolveQueryDriver } from "@/ai/tools/core/queries";
import { buildRedisGetCommand } from "@/ai/tools/nativeMutationBuilders";
import type { AiToolAdapters, AiToolDefinition } from "@/ai/tools/types";

export function getKeyValueTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "key.getValue",
    description: "Read a Redis key value from a key-value connection.",
    inputSchema: keyGetSchema(),
    permissions: ["read"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    resultLimit: {
      maxRows: 1,
      maxBytes: 100_000,
    },
    execute: async (input, context) => {
      const raw = assertObject(input);
      const connectionId =
        optionalString(raw, "connectionId") ??
        context.activeConnectionId ??
        null;
      const driver = await resolveQueryDriver(
        adapters,
        connectionId,
        context.activeDriver,
      );
      if (!driver) {
        throw new Error("Connection driver is required for key.getValue");
      }
      const capabilities = await adapters.getConnectionCapabilities(
        driver,
        connectionId,
      );
      if (capabilities.dataModel !== "keyValue") {
        throw new Error(
          `${capabilities.displayName} does not support key-value reads`,
        );
      }
      const namespace = optionalString(raw, "namespace");
      return adapters.runReadOnlyQuery?.(
        {
          connectionId,
          ...(namespace ? { namespace } : {}),
          query: buildRedisGetCommand(requireString(raw, "key")),
          limit: 1,
        },
        context,
      );
    },
  };
}

export function setKeyValueTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "key.setValue",
    description: "Set a key-value entry after explicit approval.",
    inputSchema: keySetSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const raw = assertObject(input);
      return adapters.mutateKeyValues?.(
        {
          operation: "set",
          connectionId: optionalString(raw, "connectionId"),
          namespace: optionalString(raw, "namespace"),
          key: requireString(raw, "key"),
          value: requirePresent(raw, "value"),
          ttlSeconds: optionalPositiveInteger(raw, "ttlSeconds"),
        },
        context,
      );
    },
  };
}

export function deleteKeysTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "key.deleteKeys",
    description: "Delete one or more keys after explicit approval.",
    inputSchema: keyDeleteSchema(),
    permissions: ["destructive"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const raw = assertObject(input);
      return adapters.mutateKeyValues?.(
        {
          operation: "delete",
          connectionId: optionalString(raw, "connectionId"),
          namespace: optionalString(raw, "namespace"),
          keys: requireStringArray(raw, "keys"),
        },
        context,
      );
    },
  };
}

function keyGetSchema() {
  return {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description: "Connection id. Defaults to the active connection.",
      },
      namespace: {
        type: "string",
        description: "Redis database index. Defaults to the active namespace.",
      },
      key: {
        type: "string",
        description: "Redis key.",
      },
    },
    required: ["key"],
    additionalProperties: false,
  };
}

function keySetSchema() {
  return {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description: "Connection id. Defaults to the active connection.",
      },
      namespace: {
        type: "string",
        description: "Redis database index. Defaults to the active namespace.",
      },
      key: {
        type: "string",
        description: "Redis key.",
      },
      value: {
        description:
          "Value to store. Objects and arrays are serialized as JSON.",
      },
      ttlSeconds: {
        type: "number",
        description: "Optional positive TTL in seconds.",
      },
    },
    required: ["key", "value"],
    additionalProperties: false,
  };
}

function keyDeleteSchema() {
  return {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description: "Connection id. Defaults to the active connection.",
      },
      namespace: {
        type: "string",
        description: "Redis database index. Defaults to the active namespace.",
      },
      keys: {
        type: "array",
        description: "Redis keys to delete.",
        items: { type: "string" },
      },
    },
    required: ["keys"],
    additionalProperties: false,
  };
}
