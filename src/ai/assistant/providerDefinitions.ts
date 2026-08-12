import type { AssistantMode, AssistantModeOption } from "./modes";
import type { AiProviderKind } from "@/services/tauri/ai.service";

export type AssistantProviderDefinition = {
  kind: AiProviderKind;
  label: string;
  shortLabel: string;
  category: "chat" | "agent";
  badge: "API" | "CLI";
  description: string;
  setupDescription: string;
  instructionFile: string | null;
  transport:
    | "openai-compatible"
    | "codex-app-server"
    | "codebuddy-stream-json";
  capabilities: readonly string[];
  starterPrompts: readonly string[];
  modeOptions: readonly AssistantModeOption[];
};

const DEFAULT_MODES: readonly AssistantModeOption[] = [
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
];

const CODEX_MODES: readonly AssistantModeOption[] = [
  {
    id: "o2",
    label: "Auto",
    shortDescription: "Codex decides",
    description: "Lets Codex choose between a direct answer, a plan, and scoped tools.",
  },
  {
    id: "plan",
    label: "Plan",
    shortDescription: "Read-only",
    description: "Codex inspects context and returns a plan without applying changes.",
  },
  {
    id: "agent",
    label: "Agent",
    shortDescription: "Codex tools",
    description: "Uses Codex tools inside the Oxide scope; every mutation stays approval-gated.",
  },
  {
    id: "chat",
    label: "Ask",
    shortDescription: "Read-only",
    description: "Asks Codex for an answer without database or project mutations.",
  },
];

const CODEBUDDY_MODES: readonly AssistantModeOption[] = [
  {
    id: "o2",
    label: "Auto",
    shortDescription: "CodeBuddy decides",
    description: "Uses CodeBuddy's model and effort configuration for the request.",
  },
  {
    id: "plan",
    label: "Plan",
    shortDescription: "Read-only",
    description: "Builds a reviewable plan with metadata and read-only analysis tools.",
  },
  {
    id: "agent",
    label: "Agent",
    shortDescription: "CodeBuddy tools",
    description: "Runs CodeBuddy with the Oxide tool bridge and approval boundaries.",
  },
  {
    id: "chat",
    label: "Ask",
    shortDescription: "No tools",
    description: "Uses CodeBuddy as a conversational assistant without running tools.",
  },
];

export const ASSISTANT_PROVIDER_DEFINITIONS: readonly AssistantProviderDefinition[] = [
  {
    kind: "openai-compatible",
    label: "Oxide Assistant",
    shortLabel: "Oxide",
    category: "chat",
    badge: "API",
    description: "Oxide chat and database tools with your OpenAI-compatible endpoint.",
    setupDescription: "Configure an endpoint, model, and optional API credential.",
    instructionFile: null,
    transport: "openai-compatible",
    capabilities: ["Oxide tools", "Database context", "Custom endpoint"],
    starterPrompts: [
      "Explain the SQL in my active editor",
      "Inspect the current database structure",
      "Plan a safe schema change",
    ],
    modeOptions: DEFAULT_MODES,
  },
  {
    kind: "codex-cli",
    label: "Codex CLI",
    shortLabel: "Codex",
    category: "agent",
    badge: "CLI",
    description: "A native Codex agent session using your local ChatGPT/Codex sign-in.",
    setupDescription: "OxideStudio can install Codex locally, then open its secure sign-in flow.",
    instructionFile: "AGENTS.md",
    transport: "codex-app-server",
    capabilities: ["Models + effort", "AGENTS.md", "Codex tools"],
    starterPrompts: [
      "Review the active SQL for correctness and performance",
      "Investigate the current database issue with read-only tools",
      "Plan a migration and return a reviewable SQL script",
    ],
    modeOptions: CODEX_MODES,
  },
  {
    kind: "codebuddy-cli",
    label: "CodeBuddy CLI",
    shortLabel: "CodeBuddy",
    category: "agent",
    badge: "CLI",
    description: "A CodeBuddy agent session with native model and effort discovery.",
    setupDescription: "OxideStudio can install CodeBuddy locally, then hand off interactive sign-in.",
    instructionFile: "CODEBUDDY.md",
    transport: "codebuddy-stream-json",
    capabilities: ["ACP model discovery", "Models + effort", "CodeBuddy tools"],
    starterPrompts: [
      "Explain the selected SQL using the current schema",
      "Compare the current table definitions and identify risks",
      "Plan a safe data or schema migration",
    ],
    modeOptions: CODEBUDDY_MODES,
  },
] as const;

export function assistantProviderDefinition(
  kind: AiProviderKind,
): AssistantProviderDefinition {
  return (
    ASSISTANT_PROVIDER_DEFINITIONS.find((definition) => definition.kind === kind) ??
    ASSISTANT_PROVIDER_DEFINITIONS[0]!
  );
}

export function assistantProviderModeOption(
  provider: AiProviderKind,
  mode: AssistantMode,
): AssistantModeOption {
  const definition = assistantProviderDefinition(provider);
  return (
    definition.modeOptions.find((option) => option.id === mode) ??
    definition.modeOptions[0]!
  );
}
