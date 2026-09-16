import { agentCapabilitySchema } from "@oxide/agent-contract";

export const RUNTIME_VERSION = "1.10.9";

export function supportedCapabilities() {
  return [
    "chat",
    "plan",
    "agent",
    "model-proxy",
    "tool-proxy",
    "checkpoint-proxy",
    "artifact-proxy",
    "clarification",
    "approval",
    "subagents",
    "context-compaction",
  ].map((value) => agentCapabilitySchema.parse(value));
}
