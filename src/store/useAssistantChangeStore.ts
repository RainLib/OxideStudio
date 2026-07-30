import type { AssistantTurn } from "@/ai/assistant/turns";
import { create } from "zustand";

type AssistantChangeState = {
  turnsByProject: Record<string, AssistantTurn[]>;
  setProjectTurns: (projectId: string, turns: readonly AssistantTurn[]) => void;
};

export const useAssistantChangeStore = create<AssistantChangeState>((set) => ({
  turnsByProject: {},
  setProjectTurns: (projectId, turns) =>
    set((state) => ({
      turnsByProject: {
        ...state.turnsByProject,
        [projectId]: [...turns],
      },
    })),
}));
