import { create } from "zustand";
import { persist } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";

export interface Workspace {
  id: string;
  name: string;
  color: string;
}

interface WorkspaceState {
  workspaces: Workspace[];
  workspaceConnections: Record<string, string[]>; // workspaceId -> connectionIds
  activeWorkspaceId: string | null;

  // Actions
  createWorkspace: (name: string, color?: string) => void;
  updateWorkspace: (
    id: string,
    updates: Partial<Omit<Workspace, "id">>
  ) => void;
  deleteWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string | null) => void;
  addConnectionToWorkspace: (workspaceId: string, connectionId: string) => void;
  removeConnectionFromWorkspace: (
    workspaceId: string,
    connectionId: string
  ) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      workspaceConnections: {},
      activeWorkspaceId: null,

      createWorkspace: (name: string, color = "#f39c12") => {
        const newWorkspace: Workspace = {
          id: uuidv4(),
          name,
          color,
        };
        set((state) => ({
          workspaces: [...state.workspaces, newWorkspace],
          activeWorkspaceId: newWorkspace.id,
        }));
      },

      updateWorkspace: (id, updates) => {
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === id ? { ...w, ...updates } : w
          ),
        }));
      },

      deleteWorkspace: (id: string) => {
        set((state) => {
          const newWorkspaces = state.workspaces.filter((w) => w.id !== id);
          const { [id]: deleted, ...restConnections } =
            state.workspaceConnections;
          return {
            workspaces: newWorkspaces,
            workspaceConnections: restConnections,
            activeWorkspaceId:
              state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
          };
        });
      },

      setActiveWorkspace: (id: string | null) => {
        set({ activeWorkspaceId: id });
      },

      addConnectionToWorkspace: (workspaceId: string, connectionId: string) => {
        set((state) => {
          const currentList = state.workspaceConnections[workspaceId] || [];
          if (currentList.includes(connectionId)) return state;

          return {
            workspaceConnections: {
              ...state.workspaceConnections,
              [workspaceId]: [...currentList, connectionId],
            },
          };
        });
      },

      removeConnectionFromWorkspace: (
        workspaceId: string,
        connectionId: string
      ) => {
        set((state) => {
          const currentList = state.workspaceConnections[workspaceId] || [];
          return {
            workspaceConnections: {
              ...state.workspaceConnections,
              [workspaceId]: currentList.filter((id) => id !== connectionId),
            },
          };
        });
      },
    }),
    {
      name: "oxide-workspace-storage",
    }
  )
);
