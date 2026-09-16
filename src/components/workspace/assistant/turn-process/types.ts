import type { AssistantTurn } from "@/ai/assistant/turns";

export type ProjectFileNavigation = {
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
  onOpenProjectFileProposal?: (turnId: string, callId: string) => void;
};

export type AssistantTurnProcessProps = ProjectFileNavigation & {
  turn: AssistantTurn;
  contextFingerprint: string;
  onDecideApproval: (
    turnId: string,
    approvalId: string,
    decision: "approve" | "reject",
    contextFingerprint: string,
    confirmationText?: string,
  ) => Promise<void>;
  onResume: (turnId: string, contextFingerprint: string) => Promise<void>;
  expectedProjectRoot?: string | null;
};
