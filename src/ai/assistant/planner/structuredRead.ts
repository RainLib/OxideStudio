import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import type { AssistantTurnInput } from "@/ai/assistant/types";
import {
  extractInlineJsonObject,
  extractLimit,
  extractTargetName,
  isPlainRecord,
} from "@/ai/assistant/planner/inputExtraction";
import { hasCountIntent } from "@/ai/assistant/planner/intentSignals";
import type { AssistantStructuredPlan } from "@/ai/assistant/planner/types";

export function selectedStructuredReadPlan(
  input: AssistantTurnInput,
  activeDriver: string | null | undefined,
  activeNamespace: string | null | undefined,
  activeObjectName: string | null | undefined,
): AssistantStructuredPlan | null {
  const message = input.message || "";
  const text = message.toLowerCase();
  const capabilities = defaultDatabaseCapabilities(activeDriver || "postgres");
  const limit = extractLimit(message);
  const inlineJson = extractInlineJsonObject(message);

  if (capabilities.dataModel === "document") {
    const inlineCollection =
      typeof inlineJson?.collection === "string" ? inlineJson.collection : null;
    const collection =
      extractTargetName(message, [
        "collection",
        "from",
        "in",
        "集合",
        "从集合",
      ]) ||
      inlineCollection ||
      activeObjectName;
    if (!collection) return null;

    const query =
      inlineJson && isMongoReadCommand(inlineJson)
        ? boundedMongoReadCommand(inlineJson, collection, limit)
        : hasCountIntent(text)
          ? {
              collection,
              countDocuments: inlineJson ?? {},
            }
          : {
              collection,
              find: inlineJson ?? {},
              limit,
            };

    return {
      toolName: "query.runReadOnly",
      title: hasCountIntent(text)
        ? "Count MongoDB documents with read-only safeguards"
        : "Find MongoDB documents with read-only safeguards",
      input: {
        ...(activeNamespace ? { namespace: activeNamespace } : {}),
        query: JSON.stringify(query),
        limit,
      },
    };
  }

  if (capabilities.dataModel === "search") {
    const index =
      extractTargetName(message, ["index", "from", "in", "索引", "从索引"]) ||
      activeObjectName ||
      activeNamespace;
    const body = elasticsearchReadBody(inlineJson, text, limit);

    return {
      toolName: "query.runReadOnly",
      title: hasCountIntent(text)
        ? "Count Elasticsearch documents with read-only safeguards"
        : "Search Elasticsearch documents with read-only safeguards",
      input: {
        ...(index && index !== "default" ? { namespace: index } : {}),
        query: JSON.stringify(body),
        limit,
      },
    };
  }

  return null;
}

export function queryPreparationTitle(activeDriver: string | null | undefined) {
  const capabilities = defaultDatabaseCapabilities(activeDriver || "postgres");
  if (capabilities.dataModel === "document") {
    return "Prepare a bounded MongoDB read command";
  }
  if (capabilities.dataModel === "keyValue") {
    return "Prepare a bounded Redis read command";
  }
  if (capabilities.dataModel === "search") {
    return "Prepare a bounded Elasticsearch read request";
  }
  return "Prepare a bounded read-only query";
}


export function elasticsearchReadBody(
  inlineJson: Record<string, unknown> | null,
  text: string,
  limit: number,
) {
  if (inlineJson) {
    if (
      Object.keys(inlineJson).some((key) =>
        ["query", "aggs", "aggregations", "size", "sort"].includes(
          key.toLowerCase(),
        ),
      )
    ) {
      return {
        ...inlineJson,
        size:
          typeof inlineJson.size === "number"
            ? Math.min(Math.max(1, Math.floor(inlineJson.size)), 200)
            : limit,
      };
    }

    return {
      query: inlineJson,
      size: limit,
    };
  }

  if (hasCountIntent(text)) {
    return {
      size: 0,
      query: {
        match_all: {},
      },
    };
  }

  return {
    size: limit,
    query: {
      match_all: {},
    },
  };
}

export function isMongoReadCommand(value: Record<string, unknown>) {
  const keys = Object.keys(value);
  const operations = keys.filter((key) =>
    MONGO_READ_OPERATION_KEYS.has(key.toLowerCase()),
  );

  if (operations.length > 1) return false;
  if (operations.length === 1) {
    const operation = operations[0]?.toLowerCase();
    if (operation === "aggregate") {
      return Array.isArray(value.aggregate);
    }
    if (operation === "command") {
      return isPlainRecord(value.command);
    }
    return true;
  }

  return typeof value.collection === "string";
}

export function boundedMongoReadCommand(
  command: Record<string, unknown>,
  collection: string,
  limit: number,
) {
  const hasRawCommand = isPlainRecord(command.command);
  const keys = Object.keys(command).map((key) => key.toLowerCase());
  const hasOperation = keys.some((key) => MONGO_READ_OPERATION_KEYS.has(key));
  const scopedCommand =
    hasRawCommand || typeof command.collection === "string"
      ? command
      : {
          collection,
          ...command,
        };

  if (!hasOperation && !hasRawCommand) {
    return {
      ...scopedCommand,
      find: {},
      limit: normalizedReadLimit(scopedCommand.limit, limit),
    };
  }

  if ("find" in scopedCommand) {
    return {
      ...scopedCommand,
      limit: normalizedReadLimit(scopedCommand.limit, limit),
    };
  }

  if (Array.isArray(scopedCommand.aggregate)) {
    return {
      ...scopedCommand,
      aggregate: mongoPipelineHasLimit(scopedCommand.aggregate)
        ? scopedCommand.aggregate
        : [...scopedCommand.aggregate, { $limit: limit }],
    };
  }

  return scopedCommand;
}

export function normalizedReadLimit(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(value), 200));
}

export function mongoPipelineHasLimit(pipeline: unknown[]) {
  return pipeline.some((stage) => {
    if (!isPlainRecord(stage)) return false;
    return Object.keys(stage).some((key) => key.toLowerCase() === "$limit");
  });
}

const MONGO_READ_OPERATION_KEYS = new Set([
  "aggregate",
  "command",
  "countdocuments",
  "find",
]);
