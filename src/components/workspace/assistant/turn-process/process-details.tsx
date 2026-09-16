import type {
  AssistantProcessItem,
  AssistantProjectFileChange,
  AssistantProjectFileProposal,
} from "@/ai/assistant/turns";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  ProcessKindIcon,
  ProcessStatusIcon,
  ProjectFileOperationIcon,
  splitOutputPreview,
  type ProjectFileOperation,
} from "./presentation";

export function ProcessDetail({
  item,
  turnId,
  fileChange,
  fileProposal,
  onOpenProjectFile,
  onOpenProjectFileProposal,
}: {
  item: AssistantProcessItem;
  turnId: string;
  fileChange?: AssistantProjectFileChange;
  fileProposal?: AssistantProjectFileProposal;
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
  onOpenProjectFileProposal?: (turnId: string, callId: string) => void;
}) {
  const detail = [item.toolName, item.detail].filter(Boolean).join(" · ");
  const relativePath =
    fileProposal?.relativePath || projectFilePath(item, fileChange);
  if (item.kind === "commentary") {
    return (
      <p
        className="whitespace-pre-wrap break-words py-0.5 text-[10px] leading-4 text-[hsl(var(--wb-text))] [overflow-wrap:anywhere]"
        data-assistant-process-item={item.id}
        data-process-status={item.status}
      >
        {item.detail || item.title}
      </p>
    );
  }
  if (
    isProjectFileTool(item.toolName) &&
    (item.toolName === "project.readFile" || relativePath || fileChange)
  ) {
    return (
      <ProjectFileProcessDetail
        item={item}
        turnId={turnId}
        relativePath={relativePath}
        fileChange={fileChange}
        fileProposal={fileProposal}
        onOpenProjectFile={onOpenProjectFile}
        onOpenProjectFileProposal={onOpenProjectFileProposal}
      />
    );
  }
  if (detail) {
    return (
      <ExpandableProcessDetail item={item} detail={detail} turnId={turnId} />
    );
  }
  return (
    <div
      className="flex min-w-0 items-start gap-2 py-0.5 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]"
      data-assistant-process-item={item.id}
      data-process-status={item.status}
    >
      <ProcessStatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "break-words text-[10px]",
            item.status === "running"
              ? "font-medium text-[hsl(var(--wb-accent))]"
              : "text-[hsl(var(--wb-text))]",
          )}
          data-assistant-process-item-title
        >
          {item.title}
        </div>
      </div>
    </div>
  );
}

function ProjectFileProcessDetail({
  item,
  turnId,
  relativePath,
  fileChange,
  fileProposal,
  onOpenProjectFile,
  onOpenProjectFileProposal,
}: {
  item: AssistantProcessItem;
  turnId: string;
  relativePath?: string;
  fileChange?: AssistantProjectFileChange;
  fileProposal?: AssistantProjectFileProposal;
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
  onOpenProjectFileProposal?: (turnId: string, callId: string) => void;
}) {
  const fileName = relativePath ? projectFileName(relativePath) : null;
  const operation = projectFileOperation(item.toolName);
  const canReviewDiff = Boolean(fileProposal && onOpenProjectFileProposal);
  const additions =
    item.additions ?? fileChange?.additions ?? fileProposal?.additions;
  const deletions =
    item.deletions ?? fileChange?.deletions ?? fileProposal?.deletions;
  const canOpen = Boolean(
    relativePath &&
    (canReviewDiff || (operation !== "delete" && onOpenProjectFile)),
  );
  const tone =
    item.status === "running"
      ? "font-medium text-[hsl(var(--wb-accent))]"
      : "text-[hsl(var(--wb-text))]";

  return (
    <div
      className="min-w-0 py-0.5 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]"
      data-assistant-process-item={item.id}
      data-process-status={item.status}
      data-project-file-process={relativePath || undefined}
      data-project-file-operation={operation}
    >
      <div className="group flex min-w-0 max-w-full items-start gap-2">
        <ProjectFileOperationIcon operation={operation} status={item.status} />
        {relativePath ? (
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 truncate text-left text-[10px] outline-none focus-visible:text-[hsl(var(--wb-accent))]",
              tone,
            )}
            disabled={!canOpen}
            onClick={() => {
              if (canReviewDiff && fileProposal) {
                onOpenProjectFileProposal?.(turnId, fileProposal.callId);
              } else if (operation !== "delete") {
                void onOpenProjectFile?.(relativePath);
              }
            }}
            title={
              canReviewDiff
                ? `Review changes for ${relativePath}`
                : `Open ${relativePath}`
            }
            data-project-file-name
          >
            <span className="min-w-0 truncate">{fileName}</span>
            {canOpen && (
              <ChevronRight
                size={9}
                className="shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
                aria-hidden="true"
              />
            )}
          </button>
        ) : (
          <span className={cn("text-[10px]", tone)}>Project file</span>
        )}
        {typeof additions === "number" && additions > 0 && (
          <span
            className="shrink-0 text-[10px] tabular-nums text-emerald-500"
            aria-label={`${additions} lines added`}
            data-project-file-additions
          >
            +{additions}
          </span>
        )}
        {typeof deletions === "number" && deletions > 0 && (
          <span
            className="shrink-0 text-[10px] tabular-nums text-red-400"
            aria-label={`${deletions} lines deleted`}
            data-project-file-deletions
          >
            -{deletions}
          </span>
        )}
      </div>
    </div>
  );
}

function ExpandableProcessDetail({
  item,
  detail,
  turnId,
}: {
  item: AssistantProcessItem;
  detail: string;
  turnId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [detailSummary, outputPreview] = splitOutputPreview(detail);
  const detailId = `assistant-process-item-details-${turnId}-${item.id}`;

  return (
    <div
      className="min-w-0 py-0.5 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]"
      data-assistant-process-item={item.id}
      data-process-status={item.status}
    >
      <button
        type="button"
        className="group flex min-w-0 max-w-full items-start gap-2 text-left outline-none focus-visible:text-[hsl(var(--wb-text))]"
        aria-expanded={expanded}
        aria-controls={detailId}
        data-assistant-process-item-toggle={item.id}
        onClick={() => setExpanded((current) => !current)}
      >
        <ProcessKindIcon item={item} />
        <span
          className={cn(
            "min-w-0 break-words text-[10px]",
            item.status === "running"
              ? "font-medium text-[hsl(var(--wb-accent))]"
              : "text-[hsl(var(--wb-text))]",
          )}
          data-assistant-process-item-title
        >
          {item.title}
        </span>
        <ChevronRight
          size={9}
          className={cn(
            "mt-0.5 shrink-0 opacity-0 transition-[transform,opacity] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none",
            item.status === "running"
              ? "text-[hsl(var(--wb-accent))]"
              : "text-[hsl(var(--wb-text-muted))]",
            expanded && "rotate-90",
          )}
          aria-hidden="true"
          data-assistant-process-chevron
        />
      </button>

      {expanded && (
        <div id={detailId} className="min-w-0 pl-[18px] pt-0.5">
          {detailSummary && (
            <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {detailSummary}
            </div>
          )}
          {outputPreview && (
            <pre className="no-scrollbar mt-0.5 max-h-40 min-w-0 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words font-mono text-[9px] leading-4 text-[hsl(var(--wb-text-muted))] [overflow-wrap:anywhere]">
              {outputPreview}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export function matchingFileChange(
  item: AssistantProcessItem,
  changes: readonly AssistantProjectFileChange[] | undefined,
) {
  if (!isProjectMutationTool(item.toolName)) return undefined;
  return changes?.find(
    (change) =>
      item.id === change.callId || item.id === `tool:${change.callId}`,
  );
}

export function matchingFileProposal(
  item: AssistantProcessItem,
  proposals: readonly AssistantProjectFileProposal[] | undefined,
) {
  if (!isProjectMutationTool(item.toolName)) return undefined;
  return proposals?.find(
    (proposal) =>
      item.id === proposal.callId ||
      item.id === `tool:${proposal.callId}` ||
      proposal.sourceCallIds?.some(
        (callId) => item.id === callId || item.id === `tool:${callId}`,
      ),
  );
}

function projectFilePath(
  item: AssistantProcessItem,
  change: AssistantProjectFileChange | undefined,
) {
  if (!isProjectFileTool(item.toolName)) {
    return undefined;
  }
  return (
    item.relativePath?.trim() ||
    change?.relativePath ||
    projectFilePathFromDetail(item.detail)
  );
}

function projectFileOperation(
  toolName: string | null | undefined,
): ProjectFileOperation {
  if (toolName === "project.readFile") return "read";
  if (
    toolName === "project.deleteFile" ||
    toolName === "project.removeFile" ||
    toolName === "project.deleteEntry"
  ) {
    return "delete";
  }
  return "edit";
}

function isProjectFileTool(toolName: string | null | undefined) {
  return (
    projectFileOperation(toolName) !== "edit" || isProjectMutationTool(toolName)
  );
}

function isProjectMutationTool(toolName: string | null | undefined) {
  return (
    toolName === "project.writeFile" ||
    toolName === "project.deleteFile" ||
    toolName === "project.removeFile" ||
    toolName === "project.deleteEntry"
  );
}

function projectFilePathFromDetail(detail: string | null | undefined) {
  const match = detail?.match(/"relativePath"\s*:\s*"((?:\\.|[^"\\])*)"/u);
  if (!match?.[1]) return undefined;
  try {
    const path = JSON.parse(`"${match[1]}"`) as unknown;
    if (
      typeof path !== "string" ||
      !path ||
      path.length > 2_000 ||
      path.includes("\0") ||
      /^[\\/]/u.test(path) ||
      /^[a-z]:/iu.test(path) ||
      path.split(/[\\/]/u).some((segment) => segment === "..")
    ) {
      return undefined;
    }
    return path.replace(/\\/gu, "/");
  } catch {
    return undefined;
  }
}

function projectFileName(relativePath: string) {
  const segments = relativePath.split(/[\\/]/u).filter(Boolean);
  return segments[segments.length - 1] || relativePath;
}
