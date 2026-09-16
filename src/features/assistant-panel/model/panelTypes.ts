import { type AgentTextAttachment } from "@/services/tauri/agent-host.service";

export type PendingTextAttachment = AgentTextAttachment & { id: string };

export type AssistantConversationSelection = {
  scopeKey: string;
  conversationId: string;
};
