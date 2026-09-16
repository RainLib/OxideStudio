import {
  assertObject,
  isRecord,
  requireRecordArray,
} from "@/ai/tools/core/inputValidation";
import type { AiToolAdapters, AiToolDefinition } from "@/ai/tools/types";
import type { TableRowDelete, TableRowUpdate } from "@/services/tauri/types";

export function insertTableRowsTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "table.insertRows",
    description: "Insert rows into a table after explicit approval.",
    inputSchema: tableInsertRowsSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = tableMutationPayload(input);
      const inserts = requireRecordArray(assertObject(input), "inserts");
      return adapters.mutateTableRows?.(
        {
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          table: payload.table,
          inserts,
        },
        context,
      );
    },
  };
}

export function updateTableRowsTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "table.updateRows",
    description: "Update rows in a table after explicit approval.",
    inputSchema: tableUpdateRowsSchema(),
    permissions: ["write"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = tableMutationPayload(input);
      const updates = requireTableUpdates(assertObject(input));
      return adapters.mutateTableRows?.(
        {
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          table: payload.table,
          updates,
        },
        context,
      );
    },
  };
}

export function deleteTableRowsTool(
  adapters: AiToolAdapters,
): AiToolDefinition {
  return {
    name: "table.deleteRows",
    description: "Delete rows from a table after explicit approval.",
    inputSchema: tableDeleteRowsSchema(),
    permissions: ["destructive"],
    capabilities: ["query"],
    timeoutMs: 30_000,
    execute: async (input, context) => {
      const payload = tableMutationPayload(input);
      const deletes = requireTableDeletes(assertObject(input));
      return adapters.mutateTableRows?.(
        {
          connectionId: payload.connectionId,
          namespace: payload.namespace,
          table: payload.table,
          deletes,
        },
        context,
      );
    },
  };
}

function tableMutationBaseProperties() {
  return {
    connectionId: {
      type: "string",
      description: "Connection id. Defaults to the active connection.",
    },
    namespace: {
      type: "string",
      description: "Schema or database. Defaults to the active namespace.",
    },
    table: {
      type: "string",
      description: "Target table name.",
    },
  };
}

function tableInsertRowsSchema() {
  return {
    type: "object",
    properties: {
      ...tableMutationBaseProperties(),
      inserts: {
        type: "array",
        description: "Rows to insert as column/value objects.",
        items: { type: "object", additionalProperties: true },
      },
    },
    required: ["table", "inserts"],
    additionalProperties: false,
  };
}

function tableUpdateRowsSchema() {
  return {
    type: "object",
    properties: {
      ...tableMutationBaseProperties(),
      updates: {
        type: "array",
        description:
          "Rows to update. Each item must include primary-key values and changed column values.",
        items: {
          type: "object",
          properties: {
            key: {
              type: "object",
              description: "Primary-key column values identifying the row.",
              additionalProperties: true,
            },
            values: {
              type: "object",
              description: "Column values to set.",
              additionalProperties: true,
            },
          },
          required: ["key", "values"],
          additionalProperties: false,
        },
      },
    },
    required: ["table", "updates"],
    additionalProperties: false,
  };
}

function tableDeleteRowsSchema() {
  return {
    type: "object",
    properties: {
      ...tableMutationBaseProperties(),
      deletes: {
        type: "array",
        description:
          "Rows to delete. Each item must include primary-key values.",
        items: {
          type: "object",
          properties: {
            key: {
              type: "object",
              description: "Primary-key column values identifying the row.",
              additionalProperties: true,
            },
          },
          required: ["key"],
          additionalProperties: false,
        },
      },
    },
    required: ["table", "deletes"],
    additionalProperties: false,
  };
}

function tableMutationPayload(input: unknown) {
  const payload = assertObject(input);
  const table = payload.table;
  if (typeof table !== "string" || !table.trim()) {
    throw new Error("table is required");
  }

  return {
    connectionId:
      typeof payload.connectionId === "string" ? payload.connectionId : null,
    namespace: typeof payload.namespace === "string" ? payload.namespace : null,
    table,
  };
}

function requireTableUpdates(
  payload: Record<string, unknown>,
): TableRowUpdate[] {
  const updates = requireRecordArray(payload, "updates");
  return updates.map((update, index) => {
    if (!isRecord(update.key) || Object.keys(update.key).length === 0) {
      throw new Error(`updates[${index}].key is required`);
    }
    if (!isRecord(update.values) || Object.keys(update.values).length === 0) {
      throw new Error(`updates[${index}].values is required`);
    }
    return { key: update.key, values: update.values };
  });
}

function requireTableDeletes(
  payload: Record<string, unknown>,
): TableRowDelete[] {
  const deletes = requireRecordArray(payload, "deletes");
  return deletes.map((row, index) => {
    if (!isRecord(row.key) || Object.keys(row.key).length === 0) {
      throw new Error(`deletes[${index}].key is required`);
    }
    return { key: row.key };
  });
}
