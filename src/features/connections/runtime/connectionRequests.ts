import type { PendingConnect } from "../model/types";
export function createConnectionRuntime() {
  return {
    latestConnectAttempt: 0,
    pendingConnects: new Map<string, PendingConnect>(),
    pendingConnectionLoad: null as {
      projectId: string;
      promise: Promise<void>;
    } | null,
  };
}
export type ConnectionRuntime = ReturnType<typeof createConnectionRuntime>;
