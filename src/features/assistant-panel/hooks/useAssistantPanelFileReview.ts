import type { AssistantTurn } from "@/ai/assistant/turns";
import {
  pendingAssistantFileProposals,
  type PendingAssistantFileProposal,
} from "@/components/workspace/assistant/AssistantPendingChangesPanel";
import type { AssistantAgentSession } from "@/features/assistant-session/model/sessionTypes";
import {
  APP_EVENT_AGENT_FILE_REVIEW,
  type AgentFileReviewDecisionDetail,
} from "@/lib/agentFileReview";
import { openProjectFileProposalInEditor } from "@/lib/projectFileOpen";
import { useTabStore } from "@/store/useTabStore";
import { useEffect } from "react";

interface AssistantPanelFileReviewContext {
  activeProjectRoot: string | null;
  session: Pick<
    AssistantAgentSession,
    | "turns"
    | "keepFileChange"
    | "undoFileChange"
    | "keepFileChangeHunk"
    | "undoFileChangeHunk"
  >;
  setProjectTurns: (projectId: string, turns: readonly AssistantTurn[]) => void;
  activeProjectId: string;
}

export function useAssistantPanelFileReview({
  activeProjectRoot,
  session,
  setProjectTurns,
  activeProjectId,
}: AssistantPanelFileReviewContext) {
  const openPendingFileProposal = (item: PendingAssistantFileProposal) => {
    openProjectFileProposalInEditor(
      item.projectId,
      item.turnId,
      item.proposal,
      activeProjectRoot,
    );
  };

  const keepPendingFileChange = (item: PendingAssistantFileProposal) => {
    session.keepFileChange(item.turnId, item.proposal.callId);
  };

  const undoPendingFileChange = (item: PendingAssistantFileProposal) =>
    session.undoFileChange(
      item.turnId,
      item.proposal.callId,
      activeProjectRoot,
    );

  useEffect(() => {
    const listener = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<AgentFileReviewDecisionDetail>;
      const detail = event.detail;
      if (!detail) return;
      const item = pendingAssistantFileProposals(session.turns).find(
        (candidate) =>
          candidate.turnId === detail.turnId &&
          candidate.proposal.callId === detail.callId,
      );
      if (!item) return;
      if (detail.action === "keep-file") {
        keepPendingFileChange(item);
      } else if (detail.action === "undo-file") {
        void undoPendingFileChange(item).catch(() => undefined);
      } else if (detail.action === "keep-hunk" && detail.hunk) {
        session.keepFileChangeHunk(
          item.turnId,
          item.proposal.callId,
          detail.hunk,
        );
      } else if (detail.action === "undo-hunk" && detail.hunk) {
        void session
          .undoFileChangeHunk(
            item.turnId,
            item.proposal.callId,
            detail.hunk,
            activeProjectRoot,
          )
          .catch(() => undefined);
      }
    };
    window.addEventListener(APP_EVENT_AGENT_FILE_REVIEW, listener);
    return () =>
      window.removeEventListener(APP_EVENT_AGENT_FILE_REVIEW, listener);
  }, [activeProjectRoot, session]);

  useEffect(() => {
    setProjectTurns(activeProjectId, session.turns);
  }, [activeProjectId, session.turns, setProjectTurns]);

  useEffect(() => {
    const tabs = useTabStore.getState();
    for (const turn of session.turns) {
      for (const proposal of turn.fileProposals ?? []) {
        tabs.syncAgentFileDiffPreview({
          ...proposal,
          turnId: turn.id,
          projectId: turn.projectId,
          expectedRoot: activeProjectRoot,
        });
      }
    }
  }, [activeProjectRoot, session.turns]);

  return {
    openPendingFileProposal,
    keepPendingFileChange,
    undoPendingFileChange,
  };
}
