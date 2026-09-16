import { evaluateAiToolPolicy } from "@/ai/tools/policy";
import type { AiToolExecutionPolicy, AiToolSummary } from "@/ai/tools/types";
import { classifyAiQuerySafety } from "@/lib/querySafety";
import type { AssistantIntent, AssistantPlanStep, AssistantTurnInput } from "@/ai/assistant/types";
import { hasQueryPlanIntent } from "@/ai/assistant/planner/intentSignals";
import { selectedStructuredMutationPlan } from "@/ai/assistant/planner/structuredMutation";
import { queryPreparationTitle, selectedStructuredReadPlan } from "@/ai/assistant/planner/structuredRead";

export function buildSuggestedPlan(
  intent: AssistantIntent,
  input: AssistantTurnInput,
  tools: AiToolSummary[],
  policy: AiToolExecutionPolicy,
  activeDriver?: string | null,
  activeNamespace?: string | null,
  activeObjectName?: string | null,
  activeSql?: string | null,
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

  if (
    intent === "metadata" &&
    activeObjectName &&
    hasTool("metadata.describeObject")
  ) {
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

  const explainSql = input.selectedText?.trim() || activeSql?.trim() || "";
  if (
    intent === "explain" &&
    explainSql &&
    hasQueryPlanIntent(input.message) &&
    hasTool("query.explain")
  ) {
    steps.push({
      id: "query-explain-plan",
      title: "Generate a read-only estimated execution plan",
      toolName: "query.explain",
      input: {
        query: explainSql,
        ...(activeNamespace ? { namespace: activeNamespace } : {}),
      },
      requiresApproval: requiresApproval("query.explain"),
    });
  } else if (intent === "explain" && hasTool("lsp.explainDiagnostics")) {
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
      activeNamespace,
      activeObjectName,
      hasTool,
    );
    const structuredRead =
      !structuredMutation && !query
        ? selectedStructuredReadPlan(
            input,
            activeDriver,
            activeNamespace,
            activeObjectName,
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


function selectedMutationTool(
  query: string,
  activeDriver: string | null | undefined,
  hasTool: (name: string) => boolean,
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
