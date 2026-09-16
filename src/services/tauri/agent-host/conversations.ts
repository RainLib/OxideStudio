import { invokeRawCommand } from "../client";
import type {
  AgentConversationSnapshot,
  AgentConversationSummary,
  AgentStartTurnRequest,
} from "./contracts";

export async function saveAgentConversationSnapshot(request: {
  projectId: string;
  conversationId?: string;
  threadId: string;
  turns: unknown[];
  resumeRequests: AgentStartTurnRequest[];
}): Promise<AgentConversationSnapshot> {
  return await invokeRawCommand<AgentConversationSnapshot>(
    "agent_save_conversation_snapshot",
    { request },
  );
}

export async function loadAgentConversationSnapshot(
  projectId: string,
  conversationId?: string,
): Promise<AgentConversationSnapshot | null> {
  return await invokeRawCommand<AgentConversationSnapshot | null>(
    "agent_load_conversation_snapshot",
    { projectId, conversationId },
  );
}

export async function listAgentConversationSnapshots(
  projectId: string,
  conversationScope: string,
): Promise<AgentConversationSummary[]> {
  return await invokeRawCommand<AgentConversationSummary[]>(
    "agent_list_conversation_snapshots",
    { projectId, conversationScope },
  );
}
