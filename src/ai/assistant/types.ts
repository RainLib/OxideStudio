import type { AiToolExecutionContext, AiToolSummary } from "@/ai/tools";

export type AssistantIntent =
  | "metadata"
  | "query"
  | "explain"
  | "workspace"
  | "unknown";

export type AssistantTurnInput = {
  message: string;
  selectedText?: string | null;
};

export type AssistantPlanStep = {
  id: string;
  title: string;
  toolName?: string;
  input?: Record<string, unknown>;
  requiresApproval: boolean;
};

export type AssistantToolCall = {
  id: string;
  toolName: string;
  input?: unknown;
  approved?: boolean;
  reason?: string;
};

export type AssistantToolCallResult = {
  id: string;
  toolName: string;
  status: "success" | "requiresApproval" | "error";
  output?: unknown;
  error?: string;
};

export type AssistantPreparedTurn = {
  requestId: string;
  intent: AssistantIntent;
  context: AiToolExecutionContext;
  availableTools: AiToolSummary[];
  suggestedPlan: AssistantPlanStep[];
  warnings: string[];
};
