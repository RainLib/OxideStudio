import type { SchemaState } from "@/features/schema-metadata/model/types";
import type { StoreApi } from "zustand";
import type { ConnectionState } from "../model/types";
import type { ConnectionRuntime } from "../runtime/connectionRequests";
export interface ConnectionPorts {
  getSchemaState: () => Pick<
    SchemaState,
    | "snapshotActiveMetadata"
    | "restoreConnectionSnapshot"
    | "clearActiveMetadata"
  >;
}
export type ConnectionSlice<K extends keyof ConnectionState> = (
  set: StoreApi<ConnectionState>["setState"],
  get: StoreApi<ConnectionState>["getState"],
  ports: ConnectionPorts,
  runtime: ConnectionRuntime,
) => Pick<ConnectionState, K>;
