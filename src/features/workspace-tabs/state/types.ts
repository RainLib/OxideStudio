import type { StoreApi } from "zustand";
import type { TabState } from "../model/types";

export type TabSlice<K extends keyof TabState> = (
  set: StoreApi<TabState>["setState"],
  get: StoreApi<TabState>["getState"],
) => Pick<TabState, K>;
