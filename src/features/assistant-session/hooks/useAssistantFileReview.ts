import {
  type AssistantProjectFileProposal,
  type AssistantTurn,
} from "@/ai/assistant/turns";
import { updateReviewedFileAttribution } from "@/features/assistant-session/model/fileReviewState";
import { fileReviewError } from "@/features/assistant-session/model/sessionErrors";
import { parentProjectPath } from "@/features/assistant-session/runtime/projectFileSync";
import {
  applyLineDiffHunk,
  lineDiffCounts,
  type LineDiffHunk,
} from "@/lib/lineDiff";
import {
  projectFilesService,
  type ProjectFileWriteResult,
} from "@/services/tauri/project-files.service";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";
import { useTabStore } from "@/store/useTabStore";
import { useCallback, useRef } from "react";

interface AssistantFileReviewContext {
  updateTurn: (
    turnId: string,
    update: (turn: AssistantTurn) => AssistantTurn,
  ) => void;
  turnsRef: React.RefObject<AssistantTurn[]>;
}

export function useAssistantFileReview({
  updateTurn,
  turnsRef,
}: AssistantFileReviewContext) {
  const fileProposalWritesRef = useRef(new Set<string>());
  const updateFileProposal = useCallback(
    (
      turnId: string,
      callId: string,
      update: (
        proposal: AssistantProjectFileProposal,
      ) => AssistantProjectFileProposal,
    ) => {
      updateTurn(turnId, (turn) => ({
        ...turn,
        fileProposals: (turn.fileProposals ?? []).map((proposal) =>
          proposal.callId === callId ? update(proposal) : proposal,
        ),
        updatedAt: Date.now(),
      }));
    },
    [updateTurn],
  );

  const writeReviewedFileContent = useCallback(
    async (
      turnId: string,
      callId: string,
      content: string,
      expectedRoot?: string | null,
    ): Promise<ProjectFileWriteResult | null> => {
      const turn = turnsRef.current.find(
        (candidate) => candidate.id === turnId,
      );
      const proposal = turn?.fileProposals?.find(
        (candidate) => candidate.callId === callId,
      );
      if (!turn || !proposal || proposal.status !== "pending") {
        throw new Error("This file change is no longer pending review.");
      }
      if (!expectedRoot) {
        throw new Error("The active project directory is unavailable.");
      }
      const writeKey = `${turnId}:${callId}`;
      if (fileProposalWritesRef.current.has(writeKey)) {
        throw new Error("This file change is already being updated.");
      }
      fileProposalWritesRef.current.add(writeKey);

      updateFileProposal(turnId, callId, (current) => ({
        ...current,
        isApplying: true,
        error: null,
      }));
      try {
        if (!proposal.baseRevision) {
          throw new Error("The applied file revision is unavailable for undo.");
        }
        const deleteCreatedFile =
          proposal.operation === "created" &&
          proposal.createdFileCanBeDeleted !== false &&
          content === proposal.originalContent;
        const result = deleteCreatedFile
          ? await projectFilesService
              .deleteProjectFileIfRevision(
                turn.projectId,
                proposal.relativePath,
                proposal.baseRevision,
                expectedRoot,
              )
              .then(() => null)
          : await projectFilesService.writeProjectFile(
              turn.projectId,
              proposal.relativePath,
              content,
              proposal.baseRevision,
              expectedRoot,
            );
        const tabs = useTabStore.getState();
        const openTab = tabs.tabs.find(
          (tab) =>
            !tab.agentFileDiffPreview &&
            tab.fileProjectId === turn.projectId &&
            tab.fileRelativePath === proposal.relativePath,
        );
        if (openTab && !openTab.isDirty) {
          if (result) {
            tabs.updateTabSql(openTab.id, content);
            tabs.markProjectFileSaved(openTab.id, result.revision, content);
          } else {
            tabs.closeTab(openTab.id);
          }
        }
        useProjectFilesStore.getState().syncActiveProject();
        void useProjectFilesStore
          .getState()
          .refreshDirectory(parentProjectPath(proposal.relativePath))
          .catch(() => undefined);
        fileProposalWritesRef.current.delete(writeKey);
        return result;
      } catch (error) {
        fileProposalWritesRef.current.delete(writeKey);
        const message = fileReviewError(error);
        updateFileProposal(turnId, callId, (current) => ({
          ...current,
          isApplying: false,
          error: message,
        }));
        throw new Error(message);
      }
    },
    [updateFileProposal],
  );

  const keepFileChange = useCallback(
    (turnId: string, callId: string) => {
      updateFileProposal(turnId, callId, (proposal) => ({
        ...proposal,
        status: "accepted",
        isApplying: false,
        error: null,
        resolvedAt: Date.now(),
      }));
    },
    [updateFileProposal],
  );

  const undoFileChange = useCallback(
    async (turnId: string, callId: string, expectedRoot?: string | null) => {
      const turn = turnsRef.current.find(
        (candidate) => candidate.id === turnId,
      );
      const proposal = turn?.fileProposals?.find(
        (candidate) => candidate.callId === callId,
      );
      if (!turn || !proposal || proposal.status !== "pending") return;
      const result = await writeReviewedFileContent(
        turnId,
        callId,
        proposal.originalContent,
        expectedRoot,
      );
      const sourceCallIds = new Set(
        proposal.sourceCallIds ?? [proposal.callId],
      );
      const partiallyKept = proposal.keptChanges === true;
      updateTurn(turnId, (current) => ({
        ...current,
        fileProposals: (current.fileProposals ?? []).map((candidate) =>
          candidate.callId === callId
            ? {
                ...candidate,
                baseRevision: result?.revision ?? candidate.baseRevision,
                status: partiallyKept
                  ? ("mixed" as const)
                  : ("rejected" as const),
                isApplying: false,
                error: null,
                resolvedAt: Date.now(),
              }
            : candidate,
        ),
        fileChanges: partiallyKept
          ? updateReviewedFileAttribution(current.fileChanges, proposal, result)
          : (current.fileChanges ?? []).filter(
              (change) => !sourceCallIds.has(change.callId),
            ),
        updatedAt: Date.now(),
      }));
    },
    [updateTurn, writeReviewedFileContent],
  );

  const keepFileChangeHunk = useCallback(
    (turnId: string, callId: string, hunk: LineDiffHunk) => {
      updateFileProposal(turnId, callId, (proposal) => {
        const originalContent = applyLineDiffHunk(
          proposal.originalContent,
          proposal.proposedContent,
          hunk,
          "accept",
        );
        const counts = lineDiffCounts(
          originalContent,
          proposal.proposedContent,
        );
        const completed = counts.additions === 0 && counts.deletions === 0;
        return {
          ...proposal,
          originalContent,
          keptChanges: true,
          createdFileCanBeDeleted:
            proposal.operation === "created"
              ? false
              : proposal.createdFileCanBeDeleted,
          additions: counts.additions,
          deletions: counts.deletions,
          status: completed ? "accepted" : proposal.status,
          isApplying: false,
          error: null,
          resolvedAt: completed ? Date.now() : null,
        };
      });
    },
    [updateFileProposal],
  );

  const undoFileChangeHunk = useCallback(
    async (
      turnId: string,
      callId: string,
      hunk: LineDiffHunk,
      expectedRoot?: string | null,
    ) => {
      const turn = turnsRef.current.find(
        (candidate) => candidate.id === turnId,
      );
      const proposal = turn?.fileProposals?.find(
        (candidate) => candidate.callId === callId,
      );
      if (!turn || !proposal || proposal.status !== "pending") return;
      const nextContent = applyLineDiffHunk(
        proposal.originalContent,
        proposal.proposedContent,
        hunk,
        "reject",
      );
      const result = await writeReviewedFileContent(
        turnId,
        callId,
        nextContent,
        expectedRoot,
      );
      const counts = lineDiffCounts(proposal.originalContent, nextContent);
      const completed = counts.additions === 0 && counts.deletions === 0;
      const sourceCallIds = new Set(
        proposal.sourceCallIds ?? [proposal.callId],
      );
      const partiallyKept = proposal.keptChanges === true;
      updateTurn(turnId, (current) => ({
        ...current,
        fileProposals: (current.fileProposals ?? []).map((candidate) =>
          candidate.callId === callId
            ? {
                ...candidate,
                proposedContent: nextContent,
                proposedRevision:
                  result?.revision ?? candidate.proposedRevision,
                baseRevision: result?.revision ?? candidate.baseRevision,
                additions: counts.additions,
                deletions: counts.deletions,
                status: completed
                  ? partiallyKept
                    ? ("mixed" as const)
                    : ("rejected" as const)
                  : candidate.status,
                isApplying: false,
                error: null,
                resolvedAt: completed ? Date.now() : null,
              }
            : candidate,
        ),
        fileChanges:
          completed && !partiallyKept
            ? (current.fileChanges ?? []).filter(
                (change) => !sourceCallIds.has(change.callId),
              )
            : updateReviewedFileAttribution(
                current.fileChanges,
                proposal,
                result,
              ),
        updatedAt: Date.now(),
      }));
    },
    [updateTurn, writeReviewedFileContent],
  );

  return {
    keepFileChange,
    undoFileChange,
    keepFileChangeHunk,
    undoFileChangeHunk,
  };
}
