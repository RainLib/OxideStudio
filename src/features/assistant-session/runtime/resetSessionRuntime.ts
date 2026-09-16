import { assistantHostEventBroker } from "@/features/assistant-session/runtime/hostEventBroker";
import { clearLiveConversationStates } from "@/features/assistant-session/runtime/liveConversationCache";

export async function resetAssistantAgentRuntimeForTests() {
  clearLiveConversationStates();
  await assistantHostEventBroker.resetForTests();
}
