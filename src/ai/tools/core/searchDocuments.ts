import {
  assertObject,
  optionalBoolean,
  optionalString,
  requireRecordField,
  requireString,
} from "@/ai/tools/core/inputValidation";
import type { AiToolAdapters, AiToolDefinition } from "@/ai/tools/types";

export function indexSearchDocumentTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "search.indexDocument",
    description:
      "Index or replace an Elasticsearch document after explicit approval.",
    inputSchema: searchIndexSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const raw = assertObject(input);
      return adapters.mutateSearchDocuments?.(
        {
          operation: "index",
          connectionId: optionalString(raw, "connectionId"),
          index: requireString(raw, "index"),
          id: optionalString(raw, "id"),
          document: requireRecordField(raw, "document"),
        },
        context,
      );
    },
  };
}

export function updateSearchDocumentTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "search.updateDocument",
    description:
      "Partially update an Elasticsearch document after explicit approval.",
    inputSchema: searchUpdateSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const raw = assertObject(input);
      return adapters.mutateSearchDocuments?.(
        {
          operation: "update",
          connectionId: optionalString(raw, "connectionId"),
          index: requireString(raw, "index"),
          id: requireString(raw, "id"),
          document: requireRecordField(raw, "document"),
          upsert: optionalBoolean(raw, "upsert") ?? false,
        },
        context,
      );
    },
  };
}

export function deleteSearchDocumentTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "search.deleteDocument",
    description: "Delete an Elasticsearch document after explicit approval.",
    inputSchema: searchDeleteSchema(),
    permissions: ["destructive"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const raw = assertObject(input);
      return adapters.mutateSearchDocuments?.(
        {
          operation: "delete",
          connectionId: optionalString(raw, "connectionId"),
          index: requireString(raw, "index"),
          id: requireString(raw, "id"),
        },
        context,
      );
    },
  };
}

function searchBaseProperties() {
  return {
    connectionId: {
      type: "string",
      description: "Connection id. Defaults to the active connection.",
    },
    index: {
      type: "string",
      description: "Elasticsearch index name.",
    },
  };
}

function searchIndexSchema() {
  return {
    type: "object",
    properties: {
      ...searchBaseProperties(),
      id: {
        type: "string",
        description:
          "Optional document id. Omit to let Elasticsearch generate one.",
      },
      document: {
        type: "object",
        description: "Document body to index.",
        additionalProperties: true,
      },
    },
    required: ["index", "document"],
    additionalProperties: false,
  };
}

function searchUpdateSchema() {
  return {
    type: "object",
    properties: {
      ...searchBaseProperties(),
      id: {
        type: "string",
        description: "Document id.",
      },
      document: {
        type: "object",
        description: "Partial document fields to update.",
        additionalProperties: true,
      },
      upsert: {
        type: "boolean",
        description: "When true, create the document if it does not exist.",
      },
    },
    required: ["index", "id", "document"],
    additionalProperties: false,
  };
}

function searchDeleteSchema() {
  return {
    type: "object",
    properties: {
      ...searchBaseProperties(),
      id: {
        type: "string",
        description: "Document id.",
      },
    },
    required: ["index", "id"],
    additionalProperties: false,
  };
}
