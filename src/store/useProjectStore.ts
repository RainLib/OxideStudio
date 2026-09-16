import { createProjectStore } from "./project/createProjectStore";

export type { ProjectState } from "./project/contracts";
export { DEFAULT_PROJECT } from "./project/identity";

export const useProjectStore = createProjectStore();
