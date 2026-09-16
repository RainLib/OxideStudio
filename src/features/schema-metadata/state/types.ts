import type { StoreApi } from "zustand";
import type { SchemaState } from "../model/types";
import type { MetadataRuntime } from "../runtime/metadataRequests";
export type SchemaSlice<K extends keyof SchemaState> = (
  set: StoreApi<SchemaState>["setState"],
  get: StoreApi<SchemaState>["getState"],
  runtime: MetadataRuntime,
) => Pick<SchemaState, K>;
