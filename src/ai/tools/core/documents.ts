import {
  assertObject,
  optionalBoolean,
  optionalString,
  requireRecordArray,
  requireRecordField,
  requireString,
} from "@/ai/tools/core/inputValidation";
import type { AiToolAdapters, AiToolDefinition } from "@/ai/tools/types";

export function insertDocumentsTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "document.insertDocuments",
    description:
      "Insert documents into a document collection after explicit approval.",
    inputSchema: documentInsertSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = documentMutationPayload(input);
      return adapters.mutateDocuments?.(
        {
          operation: "insert",
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          collection: payload.collection,
          documents: requireRecordArray(assertObject(input), "documents"),
        },
        context,
      );
    },
  };
}

export function updateDocumentsTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "document.updateDocuments",
    description: "Update matching documents after explicit approval.",
    inputSchema: documentUpdateSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = documentMutationPayload(input);
      const raw = assertObject(input);
      return adapters.mutateDocuments?.(
        {
          operation: "update",
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          collection: payload.collection,
          filter: requireRecordField(raw, "filter"),
          update: requireRecordField(raw, "update"),
          many: optionalBoolean(raw, "many") ?? false,
          upsert: optionalBoolean(raw, "upsert") ?? false,
        },
        context,
      );
    },
  };
}

export function deleteDocumentsTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "document.deleteDocuments",
    description: "Delete matching documents after explicit approval.",
    inputSchema: documentDeleteSchema(),
    permissions: ["destructive"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = documentMutationPayload(input);
      const raw = assertObject(input);
      return adapters.mutateDocuments?.(
        {
          operation: "delete",
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          collection: payload.collection,
          filter: requireRecordField(raw, "filter"),
          many: optionalBoolean(raw, "many") ?? false,
        },
        context,
      );
    },
  };
}

function documentBaseProperties() {
  return {
    connectionId: {
      type: "string",
      description: "Connection id. Defaults to the active connection.",
    },
    namespace: {
      type: "string",
      description: "MongoDB database. Defaults to the active namespace.",
    },
    collection: {
      type: "string",
      description: "Target collection name.",
    },
  };
}

function documentInsertSchema() {
  return {
    type: "object",
    properties: {
      ...documentBaseProperties(),
      documents: {
        type: "array",
        description: "Documents to insert.",
        items: { type: "object", additionalProperties: true },
      },
    },
    required: ["collection", "documents"],
    additionalProperties: false,
  };
}

function documentUpdateSchema() {
  return {
    type: "object",
    properties: {
      ...documentBaseProperties(),
      filter: {
        type: "object",
        description: "MongoDB filter selecting documents to update.",
        additionalProperties: true,
      },
      update: {
        type: "object",
        description: "MongoDB update document, for example {$set:{...}}.",
        additionalProperties: true,
      },
      many: {
        type: "boolean",
        description: "When true, update all matching documents.",
      },
      upsert: {
        type: "boolean",
        description: "When true, insert when no document matches.",
      },
    },
    required: ["collection", "filter", "update"],
    additionalProperties: false,
  };
}

function documentDeleteSchema() {
  return {
    type: "object",
    properties: {
      ...documentBaseProperties(),
      filter: {
        type: "object",
        description: "MongoDB filter selecting documents to delete.",
        additionalProperties: true,
      },
      many: {
        type: "boolean",
        description: "When true, delete all matching documents.",
      },
    },
    required: ["collection", "filter"],
    additionalProperties: false,
  };
}

function documentMutationPayload(input: unknown) {
  const payload = assertObject(input);
  return {
    connectionId: optionalString(payload, "connectionId"),
    namespace: optionalString(payload, "namespace"),
    collection: requireString(payload, "collection"),
  };
}
