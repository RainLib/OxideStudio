import { evaluateAiToolPolicy } from "@/ai/tools/policy";
import { classifyAiQuerySafety } from "@/lib/querySafety";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import type {
  AiToolExecutionPolicy,
  AiToolSummary,
} from "@/ai/tools/types";
import type {
  AssistantIntent,
  AssistantPlanner,
  AssistantPlannerInput,
  AssistantPlanStep,
  AssistantTurnInput,
} from "./types";

export class DefaultAssistantPlanner implements AssistantPlanner {
  readonly id = "default-rule-planner";
  readonly mode = "deterministic" as const;
  readonly description =
    "Dependency-light planner for editor context, metadata, query, LSP, and approved mutation tools.";

  plan(input: AssistantPlannerInput) {
    const intent = classifyAssistantIntent(input.turn);
    return {
      intent,
      steps: buildSuggestedPlan(
        intent,
        input.turn,
        input.availableTools,
        input.policy,
        input.context.activeDriver,
        input.context.activeNamespace,
        input.context.activeTab?.tableName,
        input.context.activeTab?.sql
      ),
      notes: [
        "Use this planner as the local fallback; a LangGraph or model planner can implement the same AssistantPlanner contract.",
      ],
    };
  }
}

export function createDefaultAssistantPlanner() {
  return new DefaultAssistantPlanner();
}

export function classifyAssistantIntent(
  input: AssistantTurnInput
): AssistantIntent {
  const text = `${input.message} ${input.selectedText || ""}`.toLowerCase();
  if (!text.trim()) return "unknown";

  if (hasWriteIntent(text)) {
    return "query";
  }
  if (hasKeyReadIntent(text)) {
    return "query";
  }
  if (hasQueryIntent(text)) {
    return "query";
  }
  if (hasMetadataIntent(text)) {
    return "metadata";
  }
  if (hasExplainIntent(text)) {
    return "explain";
  }
  if (hasWorkspaceIntent(text)) {
    return "workspace";
  }

  return "unknown";
}

function buildSuggestedPlan(
  intent: AssistantIntent,
  input: AssistantTurnInput,
  tools: AiToolSummary[],
  policy: AiToolExecutionPolicy,
  activeDriver?: string | null,
  activeNamespace?: string | null,
  activeObjectName?: string | null,
  activeSql?: string | null
): AssistantPlanStep[] {
  const hasTool = (name: string) => tools.some((tool) => tool.name === name);
  const requiresApproval = (name: string) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) return false;
    return evaluateAiToolPolicy(tool, policy).requiresApproval;
  };
  const steps: AssistantPlanStep[] = [];

  if (hasTool("workspace.getActiveTab")) {
    steps.push({
      id: "workspace-context",
      title: "Read the active editor context",
      toolName: "workspace.getActiveTab",
      input: {},
      requiresApproval: requiresApproval("workspace.getActiveTab"),
    });
  }

  if (hasTool("workspace.getSelection")) {
    steps.push({
      id: "workspace-selection",
      title: "Read the current editor selection",
      toolName: "workspace.getSelection",
      input: {},
      requiresApproval: requiresApproval("workspace.getSelection"),
    });
  }

  if (hasTool("connection.list")) {
    steps.push({
      id: "connections",
      title: "Inspect available database connections",
      toolName: "connection.list",
      input: {},
      requiresApproval: requiresApproval("connection.list"),
    });
  }

  if (hasTool("provider.list")) {
    steps.push({
      id: "provider-capabilities",
      title: "Inspect supported database providers and driver capabilities",
      toolName: "provider.list",
      input: {},
      requiresApproval: requiresApproval("provider.list"),
    });
  }

  if (intent === "metadata" && activeObjectName && hasTool("metadata.describeObject")) {
    steps.push({
      id: "metadata-active-object",
      title: "Describe metadata for the active object",
      toolName: "metadata.describeObject",
      input: {
        name: activeObjectName,
        ...(activeNamespace ? { namespace: activeNamespace } : {}),
      },
      requiresApproval: requiresApproval("metadata.describeObject"),
    });
  }

  if (intent === "metadata" && hasTool("metadata.listObjects")) {
    steps.push({
      id: "metadata-objects",
      title: "List objects for the active namespace",
      toolName: "metadata.listObjects",
      input: activeNamespace ? { namespace: activeNamespace } : {},
      requiresApproval: requiresApproval("metadata.listObjects"),
    });
  } else if (intent === "metadata" && hasTool("metadata.listCollections")) {
    steps.push({
      id: "metadata-collections",
      title: "List collections, keys, or indexes for the active namespace",
      toolName: "metadata.listCollections",
      input: activeNamespace ? { namespace: activeNamespace } : {},
      requiresApproval: requiresApproval("metadata.listCollections"),
    });
  }

  if (intent === "explain" && hasTool("lsp.explainDiagnostics")) {
    steps.push({
      id: "lsp-diagnostics",
      title: "Explain current LSP diagnostics",
      toolName: "lsp.explainDiagnostics",
      input: { onlySelection: Boolean(input.selectedText?.trim()) },
      requiresApproval: requiresApproval("lsp.explainDiagnostics"),
    });
  }

  if (intent === "query" && hasTool("query.runReadOnly")) {
    const query = input.selectedText?.trim() || activeSql?.trim() || "";
    const structuredMutation = selectedStructuredMutationPlan(
      input,
      activeDriver,
      hasTool
    );
    const structuredRead = !structuredMutation && !query
      ? selectedStructuredReadPlan(
          input,
          activeDriver,
          activeNamespace,
          activeObjectName
        )
      : null;
    const writeTool = selectedMutationTool(query, activeDriver, hasTool);
    const toolName =
      structuredMutation?.toolName ||
      structuredRead?.toolName ||
      (query ? writeTool || "query.runReadOnly" : undefined);
    steps.push({
      id: "query-execution",
      title:
        structuredMutation?.title ||
        structuredRead?.title ||
        (writeTool
          ? "Run the selected mutation with approval"
          : query
            ? "Run the selected query with read-only safeguards"
            : queryPreparationTitle(activeDriver)),
      toolName,
      input:
        structuredMutation?.input ||
        structuredRead?.input ||
        (query ? { query } : undefined),
      requiresApproval: toolName ? requiresApproval(toolName) : false,
    });
  }

  return steps;
}

function selectedStructuredMutationPlan(
  input: AssistantTurnInput,
  activeDriver: string | null | undefined,
  hasTool: (name: string) => boolean
): { toolName: string; title: string; input: Record<string, unknown> } | null {
  const message = input.message || "";
  const selectedText = input.selectedText?.trim() || "";
  const capabilities = defaultDatabaseCapabilities(activeDriver || "postgres");
  const text = message.toLowerCase();

  if (capabilities.dataModel === "keyValue") {
    const key = extractTargetName(message, ["key", "键"]);
    if (
      key &&
      hasTool("key.getValue") &&
      hasReadIntent(text)
    ) {
      return {
        toolName: "key.getValue",
        title: "Read a Redis key value",
        input: { key },
      };
    }

    if (
      key &&
      hasTool("key.deleteKeys") &&
      hasDeleteIntent(text)
    ) {
      return {
        toolName: "key.deleteKeys",
        title: "Delete Redis keys with approval",
        input: { keys: [key] },
      };
    }
  }

  if (!selectedText) return null;

  const records = parseSelectedRecordArray(selectedText);

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
    if (
      key &&
      hasTool("key.setValue") &&
      hasCreateSetOrWriteIntent(text)
    ) {
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

  if (
    capabilities.dataModel === "search" &&
    hasTool("search.indexDocument") &&
    records?.length === 1 &&
    hasIndexWriteIntent(text)
  ) {
    const index = extractTargetName(message, ["index", "into", "索引", "到索引"]);
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

function selectedStructuredReadPlan(
  input: AssistantTurnInput,
  activeDriver: string | null | undefined,
  activeNamespace: string | null | undefined,
  activeObjectName: string | null | undefined
): { toolName: string; title: string; input: Record<string, unknown> } | null {
  const message = input.message || "";
  const text = message.toLowerCase();
  const capabilities = defaultDatabaseCapabilities(activeDriver || "postgres");
  const limit = extractLimit(message);
  const inlineJson = extractInlineJsonObject(message);

  if (capabilities.dataModel === "document") {
    const collection =
      extractTargetName(message, ["collection", "from", "in", "集合", "从集合"]) ||
      activeObjectName;
    if (!collection) return null;

    const query = hasCountIntent(text)
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

function queryPreparationTitle(activeDriver: string | null | undefined) {
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

function parseSelectedRecordArray(
  text: string
): Array<Record<string, unknown>> | null {
  const value = parseSelectedJsonValue(text);
  if (Array.isArray(value) && value.every(isPlainRecord)) {
    return value;
  }
  if (isPlainRecord(value)) {
    return [value];
  }
  return null;
}

function parseSelectedJsonValue(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function extractTargetName(message: string, labels: string[]) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const isAsciiLabel = /^[a-z0-9_-]+$/i.test(label);
    const match = message.match(
      new RegExp(
        isAsciiLabel
          ? `\\b${escaped}\\b\\s+(?:named\\s+)?["'\`]?([\\w.:-]+)`
          : `${escaped}\\s*(?:名为|叫|named\\s+)?["'\`]?([\\w.:-]+)`,
        "i"
      )
    );
    const candidate = match?.[1]?.replace(/[,.，。;；:：]+$/, "");
    if (candidate && !TARGET_NAME_STOP_WORDS.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return null;
}

const TARGET_NAME_STOP_WORDS = new Set([
  "active",
  "current",
  "selected",
  "this",
  "that",
  "limit",
  "where",
  "with",
  "by",
]);

function extractLimit(message: string, fallback = 50) {
  const match =
    message.match(/\blimit\s+(\d{1,4})\b/i) ||
    message.match(/\btop\s+(\d{1,4})\b/i) ||
    message.match(/前\s*(\d{1,4})\s*(?:条|个)?/);
  const value = match?.[1] ? Number.parseInt(match[1], 10) : fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(value, 200));
}

function extractInlineJsonObject(message: string): Record<string, unknown> | null {
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const value = JSON.parse(message.slice(start, end + 1));
    return isPlainRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function elasticsearchReadBody(
  inlineJson: Record<string, unknown> | null,
  text: string,
  limit: number
) {
  if (inlineJson) {
    if (
      Object.keys(inlineJson).some((key) =>
        ["query", "aggs", "aggregations", "size", "sort"].includes(
          key.toLowerCase()
        )
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

function hasWriteIntent(text: string) {
  return (
    /\b(create|delete|drop|insert|remove|replace|set|truncate|update|upsert|write)\b/.test(
      text
    ) || /创建|删除|移除|插入|新增|替换|设置|写入|更新|清空|截断|保存/.test(text)
  );
}

function hasReadIntent(text: string) {
  return /\b(get|read|show|fetch|inspect)\b/.test(text) ||
    /读取|查看|获取|查询|显示/.test(text);
}

function hasKeyReadIntent(text: string) {
  return (
    (/\bkey\b/.test(text) || /键/.test(text)) &&
    hasReadIntent(text)
  );
}

function hasMetadataIntent(text: string) {
  return (
    /\b(schema|table|collection|index|key|metadata|database|list)\b/.test(text) ||
    /架构|模式|表|集合|索引|键|元数据|数据库|列出|列表/.test(text)
  );
}

function hasQueryIntent(text: string) {
  return (
    /\b(query|select|find|search|run|execute|count|aggregate)\b/.test(text) ||
    /查询|搜索|运行|执行|计数|统计|聚合/.test(text)
  );
}

function hasCountIntent(text: string) {
  return /\b(count|total)\b/.test(text) || /计数|统计|总数|数量/.test(text);
}

function hasExplainIntent(text: string) {
  return /\b(explain|diagnostic|error|fix|why|optimi[sz]e)\b/.test(text) ||
    /解释|诊断|错误|修复|为什么|优化/.test(text);
}

function hasWorkspaceIntent(text: string) {
  return /\b(tab|selection|editor|workspace|current)\b/.test(text) ||
    /标签|选区|编辑器|工作区|当前/.test(text);
}

function hasDeleteIntent(text: string) {
  return /\b(delete|remove|unset)\b/.test(text) || /删除|移除|清除/.test(text);
}

function hasCreateOrWriteIntent(text: string) {
  return /\b(add|create|insert|new|write)\b/.test(text) ||
    /新增|创建|插入|写入|添加/.test(text);
}

function hasCreateSetOrWriteIntent(text: string) {
  return /\b(add|create|set|write)\b/.test(text) ||
    /新增|创建|设置|写入|添加/.test(text);
}

function hasIndexWriteIntent(text: string) {
  return /\b(add|create|index|replace|upsert|write)\b/.test(text) ||
    /新增|创建|索引|替换|写入|添加/.test(text);
}

function selectedMutationTool(
  query: string,
  activeDriver: string | null | undefined,
  hasTool: (name: string) => boolean
) {
  if (!query) return null;
  const safety = classifyAiQuerySafety(query, activeDriver);
  if (safety === "destructive") {
    return hasTool("query.runDestructive") ? "query.runDestructive" : null;
  }
  if (safety === "write") {
    return hasTool("query.runMutation") ? "query.runMutation" : null;
  }
  return null;
}
