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
        input.context.activeTab?.tableName
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

  if (
    /\b(create|delete|drop|insert|remove|replace|set|truncate|update|upsert|write)\b/.test(
      text
    )
  ) {
    return "query";
  }
  if (/\b(schema|table|collection|index|key|metadata|database|list)\b/.test(text)) {
    return "metadata";
  }
  if (/\b(query|select|find|search|run|execute|count|aggregate)\b/.test(text)) {
    return "query";
  }
  if (/\b(explain|diagnostic|error|fix|why|optimi[sz]e)\b/.test(text)) {
    return "explain";
  }
  if (/\b(tab|selection|editor|workspace|current)\b/.test(text)) {
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
  activeObjectName?: string | null
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
    const query = input.selectedText?.trim() || "";
    const structuredMutation = selectedStructuredMutationPlan(
      input,
      activeDriver,
      hasTool
    );
    const writeTool = selectedMutationTool(query, activeDriver, hasTool);
    const toolName =
      structuredMutation?.toolName ||
      (query ? writeTool || "query.runReadOnly" : undefined);
    steps.push({
      id: "query-execution",
      title:
        structuredMutation?.title ||
        (writeTool
          ? "Run the selected mutation with approval"
          : query
            ? "Run the selected query with read-only safeguards"
            : queryPreparationTitle(activeDriver)),
      toolName,
      input: structuredMutation?.input || (query ? { query } : undefined),
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
  if (!selectedText) return null;

  const capabilities = defaultDatabaseCapabilities(activeDriver || "postgres");
  const text = message.toLowerCase();
  const records = parseSelectedRecordArray(selectedText);

  if (
    capabilities.dataModel === "relational" &&
    hasTool("table.insertRows") &&
    records?.length &&
    /\b(add|create|insert|new|write)\b/.test(text)
  ) {
    const table = extractTargetName(message, ["table", "into"]);
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
    /\b(add|create|insert|new|write)\b/.test(text)
  ) {
    const collection = extractTargetName(message, ["collection", "into"]);
    if (collection) {
      return {
        toolName: "document.insertDocuments",
        title: "Insert selected JSON documents with approval",
        input: { collection, documents: records },
      };
    }
  }

  if (capabilities.dataModel === "keyValue") {
    const key = extractTargetName(message, ["key"]);
    if (
      key &&
      hasTool("key.setValue") &&
      /\b(add|create|set|write)\b/.test(text)
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

    if (
      key &&
      hasTool("key.deleteKeys") &&
      /\b(delete|remove|unset)\b/.test(text)
    ) {
      return {
        toolName: "key.deleteKeys",
        title: "Delete Redis keys with approval",
        input: { keys: [key] },
      };
    }
  }

  if (
    capabilities.dataModel === "search" &&
    hasTool("search.indexDocument") &&
    records?.length === 1 &&
    /\b(add|create|index|replace|upsert|write)\b/.test(text)
  ) {
    const index = extractTargetName(message, ["index", "into"]);
    if (index) {
      return {
        toolName: "search.indexDocument",
        title: "Index selected JSON document with approval",
        input: {
          index,
          id: extractTargetName(message, ["id"]) ?? undefined,
          document: records[0],
        },
      };
    }
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
    const match = message.match(
      new RegExp(`\\b${escaped}\\b\\s+(?:named\\s+)?["'\`]?([\\w.:-]+)`, "i")
    );
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
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
