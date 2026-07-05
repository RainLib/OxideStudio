import type {
  AiToolCapability,
  AiToolExecutionPolicy,
  AiToolPermission,
  AiToolPolicyDecision,
  AiToolSummary,
} from "./types";
import { evaluateAiToolPolicy } from "./policy";

export type AiToolManifestTool = AiToolSummary & {
  policy: AiToolPolicyDecision;
};

export type AiToolManifest = {
  schemaVersion: 1;
  generatedAt: string;
  toolCount: number;
  permissions: Record<AiToolPermission, number>;
  capabilities: Record<AiToolCapability, number>;
  tools: AiToolManifestTool[];
};

export function createAiToolManifest(
  tools: AiToolSummary[],
  policy?: AiToolExecutionPolicy
): AiToolManifest {
  const sortedTools = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const manifestTools = sortedTools.map((tool) => ({
    ...tool,
    policy: evaluateAiToolPolicy(tool, policy),
  }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    toolCount: manifestTools.length,
    permissions: countToolValues(manifestTools, "permissions"),
    capabilities: countToolValues(manifestTools, "capabilities"),
    tools: manifestTools,
  };
}

function countToolValues<
  TKey extends "permissions" | "capabilities",
  TValue extends AiToolManifestTool[TKey][number],
>(tools: AiToolManifestTool[], field: TKey): Record<TValue, number> {
  return tools.reduce<Record<TValue, number>>((acc, tool) => {
    for (const value of tool[field] as TValue[]) {
      acc[value] = (acc[value] ?? 0) + 1;
    }
    return acc;
  }, {} as Record<TValue, number>);
}
