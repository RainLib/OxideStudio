import type {
  AiToolExecutionContext,
  AiToolExecutionPolicy,
  AiToolSummary,
} from "@/ai/tools/types";
import type { AssistantMode } from "./modes";

export type AssistantIntent =
  | "metadata"
  | "query"
  | "explain"
  | "workspace"
  | "unknown";

export type AssistantTurnInput = {
  message: string;
  mode?: AssistantMode;
  selectedText?: string | null;
  history?: AssistantConversationMessage[];
};

export type AssistantConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantPlanStep = {
  id: string;
  title: string;
  toolName?: string;
  input?: Record<string, unknown>;
  requiresApproval: boolean;
};

export type AssistantPlannerMode = "deterministic" | "graph" | "model";

export type AssistantPlannerInfo = {
  id: string;
  mode: AssistantPlannerMode;
  description: string;
  framework?: string;
};

export type AssistantPlannerInput = {
  turn: AssistantTurnInput;
  context: AiToolExecutionContext;
  availableTools: AiToolSummary[];
  policy: AiToolExecutionPolicy;
};

export type AssistantPlannerResult = {
  intent: AssistantIntent;
  steps: AssistantPlanStep[];
  warnings?: string[];
  notes?: string[];
};

export type AssistantPlanner = AssistantPlannerInfo & {
  plan: (
    input: AssistantPlannerInput
  ) => AssistantPlannerResult | Promise<AssistantPlannerResult>;
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

export type AssistantToolResultSummary = {
  message: string;
  warnings?: string[];
  notes?: string[];
  suggestedCalls?: AssistantToolCall[];
};

export type AssistantToolResultSummarizerInput = {
  turn: AssistantTurnInput;
  context: AiToolExecutionContext;
  availableTools: AiToolSummary[];
  policy: AiToolExecutionPolicy;
  results: AssistantToolCallResult[];
};

export type AssistantToolResultSummarizer = (
  input: AssistantToolResultSummarizerInput
) => AssistantToolResultSummary | Promise<AssistantToolResultSummary>;

export type AssistantPreparedTurn = {
  requestId: string;
  intent: AssistantIntent;
  planner: AssistantPlannerInfo;
  context: AiToolExecutionContext;
  availableTools: AiToolSummary[];
  suggestedPlan: AssistantPlanStep[];
  warnings: string[];
  notes: string[];
};

export type AssistantToolLoopLimits = {
  maxFollowUpRounds: number;
  maxToolCalls: number;
};

export type AssistantToolLoopEvent =
  | {
      type: "stepStarted";
      step: AssistantPlanStep;
      round: number;
      totalCalls: number;
    }
  | {
      type: "stepCompleted";
      step: AssistantPlanStep;
      result: AssistantToolCallResult;
      round: number;
      totalCalls: number;
    }
  | {
      type: "roundSummarized";
      summary: AssistantToolResultSummary;
      round: number;
      roundResults: AssistantToolCallResult[];
      completedResults: AssistantToolCallResult[];
    }
  | {
      type: "planExtended";
      steps: AssistantPlanStep[];
      warnings: string[];
    }
  | {
      type: "limitReached";
      warning: string;
    };

export type AssistantToolLoopOptions = {
  turn: AssistantPreparedTurn;
  summaryInput: AssistantTurnInput;
  steps: AssistantPlanStep[];
  context?: AiToolExecutionContext;
  existingResults?: Readonly<Record<string, AssistantToolCallResult>>;
  approvedStepIds?: ReadonlySet<string>;
  limits?: Partial<AssistantToolLoopLimits>;
  onEvent?: (event: AssistantToolLoopEvent) => void;
  beforeApprovedToolExecution?: (execution: {
    stepId: string;
    title: string;
    toolName: string;
    round: number;
    totalCalls: number;
  }) => Promise<void> | void;
};

export type AssistantToolLoopResult = {
  status: "completed" | "cancelled" | "failed" | "limitReached";
  results: AssistantToolCallResult[];
  followUpSteps: AssistantPlanStep[];
  warnings: string[];
  rounds: number;
  toolCalls: number;
  error?: string;
};
