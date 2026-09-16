import { useAssistantSidebarController } from "@/features/assistant-panel/hooks/useAssistantSidebarController";
import { AssistantSidebarView } from "@/features/assistant-panel/ui/AssistantSidebarView";

export function AssistantSidebar() {
  return <AssistantSidebarView {...useAssistantSidebarController()} />;
}

export {
  assistantConversationBelongsToScope,
  assistantConversationId,
  assistantConversationScopeKey,
  createAssistantConversationId,
} from "@/features/assistant-panel/model/conversationIdentity";
export {
  assistantConversationContentVersion,
  assistantConversationHistoryVersion,
  assistantTurnMetricsVersion,
} from "@/features/assistant-panel/model/conversationVersions";
export { cliSetupForProviderIdentity } from "@/features/assistant-panel/model/providerIdentity";
export { assistantToolManifestForProfile } from "@/features/assistant-panel/model/turnComposition";
