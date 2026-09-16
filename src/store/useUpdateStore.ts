import { createAppUpdateStore } from "./app-update/createAppUpdateStore";

export type { AppUpdateStatus } from "./app-update/contracts";
export {
  activeUpdateBlockingTaskCount,
  isUpdateVersionIgnored,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_PROGRESS_PUBLISH_INTERVAL_MS,
} from "./app-update/policy";

export const useUpdateStore = createAppUpdateStore();
