export type AssistantMode = "o2" | "plan" | "agent" | "chat";

export type ResolvedAssistantMode = Exclude<AssistantMode, "o2">;

export type AssistantModeOption = {
  id: AssistantMode;
  label: string;
  shortDescription: string;
  description: string;
};

export const ASSISTANT_MODE_OPTIONS: readonly AssistantModeOption[] = [
  {
    id: "o2",
    label: "O2",
    shortDescription: "Adaptive",
    description: "Chooses conversation, planning, or safe tools for the request.",
  },
  {
    id: "plan",
    label: "Plan",
    shortDescription: "Review first",
    description: "Uses read-only metadata and analysis tools to build a reviewable plan.",
  },
  {
    id: "agent",
    label: "Agent",
    shortDescription: "Use tools",
    description: "Runs read-only tools automatically and gates every mutation.",
  },
  {
    id: "chat",
    label: "Chat",
    shortDescription: "No tools",
    description: "Answers directly without running database tools.",
  },
] as const;

export function assistantModeOption(mode: AssistantMode) {
  return (
    ASSISTANT_MODE_OPTIONS.find((option) => option.id === mode) ??
    ASSISTANT_MODE_OPTIONS[0]!
  );
}

export function resolveAssistantMode(
  mode: AssistantMode,
  message: string
): ResolvedAssistantMode {
  if (mode !== "o2") return mode;

  const normalized = message.trim().toLowerCase();
  if (PLAN_CUES.test(normalized)) return "plan";
  if (TOOL_CUES.test(normalized)) return "agent";
  return "chat";
}

const PLAN_CUES =
  /\b(plan|outline|roadmap|strategy|steps?|design)\b|计划|规划|方案|步骤|设计/iu;

const TOOL_CUES =
  /\b(run|execute|inspect|list|show|find|query|select|check|analy[sz]e|create|alter|update|delete|drop|truncate|insert|apply|fix|change|rename|export|import)\b|执行|运行|检查|查看|查询|分析|创建|修改|更新|删除|清空|写入|应用|重命名|导出|导入/iu;
