import { create } from "zustand";
import { createProjectGitActions } from "./actions";
import {
  createProjectGitSession,
  type ProjectGitState,
} from "./contracts";
import { createProjectGitRuntime } from "./runtime";

export function createProjectGitStore() {
  return create<ProjectGitState>((set, get) => {
    const runtime = createProjectGitRuntime(set, get);
    return {
      sessions: {},
      ensureSession: (projectId, rootPath) => {
        const current = get().sessions[projectId];
        if (!current) {
          set((state) => ({
            sessions: {
              ...state.sessions,
              [projectId]: createProjectGitSession(rootPath),
            },
          }));
        } else if ((rootPath || null) !== current.rootPath) {
          runtime.updateSession(projectId, {
            ...createProjectGitSession(rootPath),
            commitMessage: current.commitMessage,
            versionView: current.versionView,
          });
        }
      },
      updateSession: runtime.updateSession,
      refresh: runtime.refresh,
      ...createProjectGitActions({ get, ...runtime }),
    };
  });
}
