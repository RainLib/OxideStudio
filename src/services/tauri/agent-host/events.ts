import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  AGENT_HOST_EVENT_CHANNEL,
  type AgentHostEvent,
  type AgentHostEventListener,
} from "./contracts";
import { isAgentHostEvent } from "./validation";

export async function listenAgentHostEvents(
  listener: AgentHostEventListener,
): Promise<UnlistenFn> {
  return await listen<AgentHostEvent>(AGENT_HOST_EVENT_CHANNEL, (event) => {
    if (!isAgentHostEvent(event.payload)) return;
    listener(event.payload);
  });
}
