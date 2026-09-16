import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import type { AssistantTurnInput } from "@/ai/assistant/types";
import type { AssistantStructuredPlan } from "@/ai/assistant/planner/types";
import {
  booleanField,
  extractInlineJsonObject,
  extractTargetName,
  inferMongoUpdateDocument,
  parseSelectedJsonValue,
  parseSelectedRecord,
  parseSelectedRecordArray,
  recordField,
} from "@/ai/assistant/planner/inputExtraction";
import {
  hasCreateOrWriteIntent,
  hasCreateSetOrWriteIntent,
  hasDeleteIntent,
  hasIndexWriteIntent,
  hasManyIntent,
  hasReadIntent,
  hasUpdateIntent,
  hasUpsertIntent,
} from "@/ai/assistant/planner/intentSignals";

export function selectedStructuredMutationPlan(
  input: AssistantTurnInput,
  activeDriver: string | null | undefined,
  activeNamespace: string | null | undefined,
  activeObjectName: string | null | undefined,
  hasTool: (name: string) => boolean,
): AssistantStructuredPlan | null {
  const message = input.message || "";
  const selectedText = input.selectedText?.trim() || "";
  const capabilities = defaultDatabaseCapabilities(activeDriver || "postgres");
  const text = message.toLowerCase();
  const inlineJson = extractInlineJsonObject(message);

  if (capabilities.dataModel === "keyValue") {
    const key = extractTargetName(message, ["key", "键"]);
    if (key && hasTool("key.getValue") && hasReadIntent(text)) {
      return {
        toolName: "key.getValue",
        title: "Read a Redis key value",
        input: { key },
      };
    }

    if (key && hasTool("key.deleteKeys") && hasDeleteIntent(text)) {
      return {
        toolName: "key.deleteKeys",
        title: "Delete Redis keys with approval",
        input: { keys: [key] },
      };
    }
  }

  const selectedRecord = selectedText
    ? parseSelectedRecord(selectedText)
    : null;
  const records = selectedText ? parseSelectedRecordArray(selectedText) : null;

  if (
    capabilities.dataModel === "relational" &&
    hasTool("table.insertRows") &&
    records?.length &&
    hasCreateOrWriteIntent(text)
  ) {
    const table = extractTargetName(message, ["table", "into", "表", "到表"]);
    if (table) {
      return {
        toolName: "table.insertRows",
        title: "Insert selected JSON rows into a table with approval",
        input: { table, inserts: records },
      };
    }
  }

  if (capabilities.dataModel === "document") {
    const collection =
      extractTargetName(message, [
        "collection",
        "into",
        "from",
        "in",
        "集合",
        "到集合",
        "从集合",
      ]) || activeObjectName;
    if (
      collection &&
      hasTool("document.updateDocuments") &&
      hasUpdateIntent(text)
    ) {
      const filter = recordField(selectedRecord, "filter") ?? inlineJson;
      const update =
        recordField(selectedRecord, "update") ??
        inferMongoUpdateDocument(selectedRecord);
      if (filter && update) {
        return {
          toolName: "document.updateDocuments",
          title: "Update MongoDB documents with approval",
          input: {
            ...(activeNamespace ? { namespace: activeNamespace } : {}),
            collection,
            filter,
            update,
            many: booleanField(selectedRecord, "many") ?? hasManyIntent(text),
            upsert:
              booleanField(selectedRecord, "upsert") ?? hasUpsertIntent(text),
          },
        };
      }
    }

    if (
      collection &&
      hasTool("document.deleteDocuments") &&
      hasDeleteIntent(text)
    ) {
      const filter =
        recordField(selectedRecord, "filter") ?? selectedRecord ?? inlineJson;
      if (filter) {
        return {
          toolName: "document.deleteDocuments",
          title: "Delete MongoDB documents with approval",
          input: {
            ...(activeNamespace ? { namespace: activeNamespace } : {}),
            collection,
            filter,
            many: booleanField(selectedRecord, "many") ?? hasManyIntent(text),
          },
        };
      }
    }
  }

  if (
    capabilities.dataModel === "document" &&
    hasTool("document.insertDocuments") &&
    records?.length &&
    hasCreateOrWriteIntent(text)
  ) {
    const collection = extractTargetName(message, [
      "collection",
      "into",
      "集合",
      "到集合",
    ]);
    if (collection) {
      return {
        toolName: "document.insertDocuments",
        title: "Insert selected JSON documents with approval",
        input: { collection, documents: records },
      };
    }
  }

  if (capabilities.dataModel === "keyValue") {
    const key = extractTargetName(message, ["key", "键"]);
    if (key && hasTool("key.setValue") && hasCreateSetOrWriteIntent(text)) {
      return {
        toolName: "key.setValue",
        title: "Set a Redis key with approval",
        input: {
          key,
          value: parseSelectedJsonValue(selectedText),
        },
      };
    }
  }

  if (capabilities.dataModel === "search") {
    const index =
      extractTargetName(message, [
        "index",
        "into",
        "from",
        "in",
        "索引",
        "到索引",
        "从索引",
      ]) || activeObjectName;
    const id = extractTargetName(message, ["id", "编号"]);

    if (
      index &&
      id &&
      hasTool("search.updateDocument") &&
      hasUpdateIntent(text) &&
      selectedRecord
    ) {
      return {
        toolName: "search.updateDocument",
        title: "Update Elasticsearch document with approval",
        input: {
          index,
          id,
          document: recordField(selectedRecord, "document") ?? selectedRecord,
          upsert:
            booleanField(selectedRecord, "upsert") ?? hasUpsertIntent(text),
        },
      };
    }

    if (
      index &&
      id &&
      hasTool("search.deleteDocument") &&
      hasDeleteIntent(text)
    ) {
      return {
        toolName: "search.deleteDocument",
        title: "Delete Elasticsearch document with approval",
        input: {
          index,
          id,
        },
      };
    }
  }

  if (
    capabilities.dataModel === "search" &&
    hasTool("search.indexDocument") &&
    records?.length === 1 &&
    hasIndexWriteIntent(text)
  ) {
    const index =
      extractTargetName(message, ["index", "into", "索引", "到索引"]) ||
      activeObjectName;
    if (index) {
      return {
        toolName: "search.indexDocument",
        title: "Index selected JSON document with approval",
        input: {
          index,
          id: extractTargetName(message, ["id", "编号"]) ?? undefined,
          document: records[0],
        },
      };
    }
  }

  return null;
}
