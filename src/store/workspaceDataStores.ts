import { createConnectionRuntime } from "@/features/connections/runtime/connectionRequests";
import { createConnectionReadiness } from "@/features/connections/runtime/createConnectionReadiness";
import { createConnectionStore } from "@/features/connections/state/createConnectionStore";
import { createSchemaStore } from "@/features/schema-metadata/state/createSchemaStore";

// Cross-store access is resolved at action time. Neither store imports the other;
// both retain one state instance and their existing synchronous snapshot actions.
const connectionRuntime = createConnectionRuntime();
export const useConnectionStore: ReturnType<typeof createConnectionStore> =
  createConnectionStore(
    { getSchemaState: () => useSchemaStore.getState() },
    connectionRuntime,
  );
export const useSchemaStore: ReturnType<typeof createSchemaStore> =
  createSchemaStore({
    getConnectionState: () => useConnectionStore.getState(),
  });

export const {
  ensureConnectionReady,
  ensureConnectionReadyInBackground,
  restoreConnectionSession,
} = createConnectionReadiness(useConnectionStore, connectionRuntime);
