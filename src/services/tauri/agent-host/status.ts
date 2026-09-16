import type { AiProviderKind } from "../ai.service";
import { invokeRawCommand } from "../client";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  type AgentContextMetrics,
  type AgentHostStatus,
  type AgentProjectStateCleared,
} from "./contracts";

export async function getAgentHostStatus(
  providerConfigured = false,
  providerKind?: AiProviderKind,
): Promise<AgentHostStatus> {
  return normalizeAgentHostStatus(
    await invokeRawCommand<AgentHostStatus>("agent_get_status", {
      providerConfigured,
      ...(providerKind ? { providerKind } : {}),
    }),
  );
}

export async function getAgentContextMetrics(
  projectId: string,
): Promise<AgentContextMetrics> {
  return await invokeRawCommand<AgentContextMetrics>(
    "agent_get_context_metrics",
    { projectId },
  );
}

export async function clearAgentProjectState(
  projectId: string,
): Promise<AgentProjectStateCleared> {
  return await invokeRawCommand<AgentProjectStateCleared>(
    "agent_clear_project_state",
    { projectId },
  );
}

function normalizeAgentHostStatus(status: AgentHostStatus): AgentHostStatus {
  const normalized = {
    ...status,
    capabilities: Array.isArray(status.capabilities) ? status.capabilities : [],
    installedTools: Array.isArray(status.installedTools)
      ? status.installedTools
      : [],
  };
  if (status.protocolVersion !== AGENT_HOST_PROTOCOL_VERSION) {
    return {
      ...normalized,
      available: false,
      state: "failed",
      lastError: `Unsupported agent host protocol ${status.protocolVersion}; expected ${AGENT_HOST_PROTOCOL_VERSION}.`,
    };
  }
  return normalized;
}
