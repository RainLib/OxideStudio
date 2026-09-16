import { assertObject } from "@/ai/tools/core/inputValidation";
import type { AiToolAdapters, AiToolDefinition } from "@/ai/tools/types";

export function listCollectionsTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "metadata.listCollections",
    description:
      "List document collections, search indexes, or analogous objects.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        namespace: {
          type: "string",
          description:
            "Database, schema, or namespace. Defaults to the active namespace.",
        },
      },
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["metadata"],
    timeoutMs: 10_000,
    execute: async (input, context) => {
      const payload = assertObject(input);
      return adapters.listCollections?.(
        {
          connectionId:
            typeof payload.connectionId === "string"
              ? payload.connectionId
              : null,
          namespace:
            typeof payload.namespace === "string" ? payload.namespace : null,
        },
        context,
      );
    },
  };
}

export function listObjectsTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "metadata.listObjects",
    description:
      "List tables, collections, indexes, keys, or analogous objects.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        namespace: {
          type: "string",
          description:
            "Database, schema, or namespace. Defaults to the active namespace.",
        },
      },
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["metadata"],
    timeoutMs: 10_000,
    execute: async (input, context) => {
      const payload = assertObject(input);
      return adapters.listObjects?.(
        {
          connectionId:
            typeof payload.connectionId === "string"
              ? payload.connectionId
              : null,
          namespace:
            typeof payload.namespace === "string" ? payload.namespace : null,
        },
        context,
      );
    },
  };
}

export function describeObjectTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "metadata.describeObject",
    description:
      "Describe a table, collection, index, or key in the current workspace.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: {
          type: "string",
          description: "Connection id. Defaults to the active connection.",
        },
        namespace: {
          type: "string",
          description:
            "Database, schema, or namespace. Defaults to the active namespace.",
        },
        name: {
          type: "string",
          description:
            "Object name, for example a table, collection, index, or key.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["metadata"],
    timeoutMs: 10_000,
    execute: async (input, context) => {
      const payload = assertObject(input);
      const name = payload.name;
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("name is required");
      }

      return adapters.describeObject?.(
        {
          connectionId:
            typeof payload.connectionId === "string"
              ? payload.connectionId
              : null,
          namespace:
            typeof payload.namespace === "string" ? payload.namespace : null,
          name,
        },
        context,
      );
    },
  };
}
