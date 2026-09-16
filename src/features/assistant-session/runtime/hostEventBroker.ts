import { type AssistantTurn } from "@/ai/assistant/turns";
import { MAX_BUFFERED_HOST_EVENTS } from "@/features/assistant-session/model/sessionPolicy";
import {
  agentHostService,
  type AgentHostEvent,
} from "@/services/tauri/agent-host.service";

export const assistantHostEventBroker = createAssistantHostEventBroker();

function createAssistantHostEventBroker() {
  const subscribers = new Set<(event: AgentHostEvent) => void>();
  let bufferedEvents: AgentHostEvent[] = [];
  let startPromise: Promise<void> | null = null;
  let stopListening: (() => void) | null = null;

  const ensureStarted = () => {
    if (startPromise) return startPromise;
    startPromise = agentHostService
      .listen((event) => {
        bufferedEvents.push(event);
        if (bufferedEvents.length > MAX_BUFFERED_HOST_EVENTS) {
          bufferedEvents = bufferedEvents.slice(-MAX_BUFFERED_HOST_EVENTS);
        }
        for (const subscriber of subscribers) subscriber(event);
      })
      .then((cleanup) => {
        stopListening = cleanup;
      })
      .catch((error) => {
        startPromise = null;
        throw error;
      });
    return startPromise;
  };

  return {
    async subscribe(listener: (event: AgentHostEvent) => void) {
      subscribers.add(listener);
      try {
        await ensureStarted();
      } catch (error) {
        subscribers.delete(listener);
        throw error;
      }
      return () => subscribers.delete(listener);
    },
    replayForTurns(turns: readonly AssistantTurn[]) {
      if (turns.length === 0 || bufferedEvents.length === 0) return [];
      const cursors = new Map(
        turns
          .filter((turn) => Boolean(turn.threadId))
          .map((turn) => [
            `${turn.threadId}\u0000${turn.id}`,
            turn.lastEventSequence ?? 0,
          ]),
      );
      return bufferedEvents.filter((event) => {
        const cursor = cursors.get(`${event.threadId}\u0000${event.turnId}`);
        return cursor !== undefined && event.sequence > cursor;
      });
    },
    async resetForTests() {
      subscribers.clear();
      bufferedEvents = [];
      try {
        await startPromise;
      } catch {
        // A failed test listener has no cleanup to run.
      }
      stopListening?.();
      stopListening = null;
      startPromise = null;
    },
  };
}
