import { create } from "zustand";
import type { ProjectState } from "./contracts";
import { DEFAULT_PROJECT, readActiveProjectId } from "./identity";
import { createProjectLoadingActions } from "./loadingActions";
import { createProjectActions } from "./projectActions";

export function createProjectStore() {
  const initialProjectId = readActiveProjectId();
  return create<ProjectState>((set, get) => ({
    projects: [DEFAULT_PROJECT],
    activeProjectId: initialProjectId,
    activeProjectName: DEFAULT_PROJECT.name,
    isLoading: false,
    ...createProjectLoadingActions(set, get),
    ...createProjectActions(set, get),
  }));
}
