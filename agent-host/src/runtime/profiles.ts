import { type StartTurnParams } from "@oxide/agent-contract";
import { registerHarnessProfile, type SubAgent } from "deepagents/node";
import { OxideChatModel } from "../model.js";
import { createProxyTools } from "../tools/proxy.js";

export const FILESYSTEM_TOOLS = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
] as const;

registerHarnessProfile("openai:oxide-chat", {
  generalPurposeSubagent: { enabled: false },
  excludedTools: [...FILESYSTEM_TOOLS, "task", "write_todos"],
});

registerHarnessProfile("openai:oxide-plan", {
  generalPurposeSubagent: { enabled: false },
  excludedTools: [...FILESYSTEM_TOOLS],
});

registerHarnessProfile("openai:oxide-agent", {
  generalPurposeSubagent: { enabled: false },
  excludedTools: [...FILESYSTEM_TOOLS],
});

export function createSubagents(
  profile: StartTurnParams["profile"],
  model: OxideChatModel,
  tools: ReturnType<typeof createProxyTools>,
): SubAgent[] {
  if (profile === "chat") return [];
  const candidates: SubAgent[] = [
    {
      name: "schema_analyst",
      description: "Inspect database metadata and identify relevant objects.",
      systemPrompt:
        "Analyze only the supplied database metadata. Stay read-only and return concise evidence to the coordinator.",
      model,
      tools,
      permissions: [
        { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
      ],
    },
    {
      name: "query_reviewer",
      description:
        "Review SQL or provider-native queries for correctness and risk.",
      systemPrompt:
        "Review queries without executing mutations. Identify dialect, safety, performance, and correctness issues.",
      model,
      tools,
      permissions: [
        { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
      ],
    },
  ];
  if (profile === "agent") {
    candidates.push({
      name: "plan_verifier",
      description: "Verify an execution plan before risky steps.",
      systemPrompt:
        "Verify the proposed plan against the observed context. Never mutate data and flag stale or missing evidence.",
      model,
      tools,
      permissions: [
        { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
      ],
    });
  }
  return candidates;
}

export function systemPrompt(profile: StartTurnParams["profile"]): string {
  const shared = [
    "You are the OxideStudio database assistant.",
    "Never claim a tool succeeded unless its returned observation says it succeeded.",
    "Do not reveal hidden reasoning. Show only concise user-visible process descriptions and the final answer.",
    "Use ask_user only for material ambiguity; at most two clarification rounds are available.",
    "For ask_user, provide 1-3 questions with 2-3 concrete options each. Never add an Other, Custom, or free-text option because the UI always provides a separate free-text answer.",
    "Filesystem and shell access are forbidden. Database access is only through the supplied tools.",
    "project.writeFile atomically updates the project on disk immediately and records a Git-style review item. Describe successful results as created or updated, and tell the user the change can be kept or undone in the OxideStudio review UI.",
    "query.runReadOnly is driver-aware: use SQL SELECT for relational databases, MongoDB read-command JSON for MongoDB, Redis read commands for Redis, and Elasticsearch DSL as JSON or Kibana syntax such as POST index/_search followed by the JSON body. Never send SQL to a non-SQL connection.",
    "When a tool observation contains artifactRef, use context_search_artifact to find relevant JSON ranges and context_read_artifact to read only those ranges. Do not guess omitted data.",
    "Metadata and Explain Plan observations may include trusted citations. Append the exact token [[cite:citation-id]] to each factual sentence that relies on that evidence. Use a databaseSchema citation for aggregate/list claims and a databaseObject citation for object details. Use only citation ids present in the observation, never invent or alter one. Do not cite claims that are only suggestions or inference.",
    "Use workspace.getActiveTab to inspect a plan already opened by the user. Only an analyzed plan is runtime evidence; query.explain and estimate-mode plans are optimizer estimates and must not be described as measured performance.",
  ];
  if (profile === "chat") {
    shared.push(
      "This is Chat mode. Do not inspect or modify a database. Answer directly from the supplied context.",
    );
  } else if (profile === "plan") {
    shared.push(
      "This is Plan mode. You may inspect with read-only tools and produce an executable plan, but never perform a write or destructive action.",
      "Before each distinct tool phase, write one concise user-visible sentence describing what you will inspect and why, then call the tools. Keep these stage updates factual and never reveal hidden reasoning.",
    );
  } else {
    shared.push(
      "This is Agent mode. Prefer bounded read-only discovery. Risky database and external tools require exact one-time approval; reviewable project.writeFile changes apply immediately without a pre-approval prompt. Keep mutations serial and verify context immediately before use.",
      "Before each distinct work phase, write one concise user-visible sentence describing what you will inspect or change and why, then perform that phase's tool calls. Add a new update when the objective changes, avoid narrating trivial calls, and never reveal hidden reasoning.",
      "Use no more than two subagents at a time.",
    );
  }
  return shared.join("\n");
}
