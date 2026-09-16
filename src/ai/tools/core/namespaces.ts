import {
  assertObject,
  optionalBoolean,
  optionalString,
  requireString,
} from "@/ai/tools/core/inputValidation";
import type { AiToolAdapters, AiToolDefinition } from "@/ai/tools/types";

export function createNamespaceTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "database.createNamespace",
    description: "Create a database or schema after explicit approval.",
    inputSchema: namespaceMutationSchema(false),
    permissions: ["write"],
    capabilities: ["metadata"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = assertObject(input);
      return adapters.mutateNamespace?.(
        {
          operation: "create",
          connectionId: optionalString(payload, "connectionId"),
          namespace: requireString(payload, "namespace"),
          charset: optionalString(payload, "charset"),
          collation: optionalString(payload, "collation"),
        },
        context,
      );
    },
  };
}

export function dropNamespaceTool(adapters: AiToolAdapters): AiToolDefinition {
  return {
    name: "database.dropNamespace",
    description: "Drop a database or schema after explicit approval.",
    inputSchema: namespaceMutationSchema(true),
    permissions: ["destructive"],
    capabilities: ["metadata"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = assertObject(input);
      return adapters.mutateNamespace?.(
        {
          operation: "drop",
          connectionId: optionalString(payload, "connectionId"),
          namespace: requireString(payload, "namespace"),
          cascade: optionalBoolean(payload, "cascade") ?? false,
        },
        context,
      );
    },
  };
}

function namespaceMutationSchema(includeCascade: boolean) {
  return {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description: "Connection id. Defaults to the active connection.",
      },
      namespace: {
        type: "string",
        description: "Database or schema name.",
      },
      ...(includeCascade
        ? {
            cascade: {
              type: "boolean",
              description: "When true, drop dependent objects where supported.",
            },
          }
        : {
            charset: {
              type: "string",
              description:
                "Optional charset for database engines that support it.",
            },
            collation: {
              type: "string",
              description:
                "Optional collation for database engines that support it.",
            },
          }),
    },
    required: ["namespace"],
    additionalProperties: false,
  };
}
