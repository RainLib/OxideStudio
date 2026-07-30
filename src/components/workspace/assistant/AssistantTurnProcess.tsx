import {
  assistantTurnCanResume,
  assistantTurnIsActive,
  type AssistantApproval,
  type AssistantProcessItem,
  type AssistantProjectFileChange,
  type AssistantProjectFileProposal,
  type AssistantTurn,
} from "@/ai/assistant/turns";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleStop,
  FileSearch,
  HelpCircle,
  Loader2,
  Pencil,
  Play,
  Search,
  ShieldAlert,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

type AssistantTurnProcessProps = {
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
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
  onOpenProjectFileProposal?: (turnId: string, callId: string) => void;
};

const VISIBLE_STATUS_WITHOUT_PROCESS = new Set<AssistantTurn["status"]>([
  "queued",
  "planning",
  "running",
  "awaiting_input",
  "awaiting_approval",
  "paused",
  "cancelling",
]);

export function AssistantTurnProcess({
  turn,
  contextFingerprint,
  onDecideApproval,
  onResume,
  onOpenProjectFile,
  onOpenProjectFileProposal,
}: AssistantTurnProcessProps) {
  const pendingApprovals = turn.approvals.filter(
    (approval) => !approval.decision,
  );
  const showActivity =
    turn.process.length > 0 || VISIBLE_STATUS_WITHOUT_PROCESS.has(turn.status);

  return (
    <div className="space-y-2" data-assistant-turn-process={turn.id}>
      {showActivity && (
        assistantTurnIsActive(turn) ? (
          <LiveProcessTimeline
            turn={turn}
            onOpenProjectFile={onOpenProjectFile}
            onOpenProjectFileProposal={onOpenProjectFileProposal}
          />
        ) : (
          <ProcessDisclosure
            turn={turn}
            onResume={() => onResume(turn.id, contextFingerprint)}
            onOpenProjectFile={onOpenProjectFile}
            onOpenProjectFileProposal={onOpenProjectFileProposal}
          />
        )
      )}

      {pendingApprovals.map((approval) => (
        <ApprovalPrompt
          key={approval.approvalId}
          approval={approval}
          onDecision={(decision, confirmationText) =>
            onDecideApproval(
              turn.id,
              approval.approvalId,
              decision,
              contextFingerprint,
              confirmationText,
            )
          }
        />
      ))}
    </div>
  );
}

function LiveProcessTimeline({
  turn,
  onOpenProjectFile,
  onOpenProjectFileProposal,
}: {
  turn: AssistantTurn;
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
  onOpenProjectFileProposal?: (turnId: string, callId: string) => void;
}) {
  const { t } = useI18n();
  const processItems = useMemo(
    () => [...turn.process].sort((left, right) => left.sequence - right.sequence),
    [turn.process],
  );
  const hasRunningItem = processItems.some((item) => item.status === "running");

  return (
    <section
      className="space-y-1"
      aria-label={t("assistant.processAria")}
      data-assistant-live-process={turn.id}
      data-process-status={turn.status}
      data-process-running="true"
      aria-live="polite"
    >
      {processItems.map((item) => (
        <ProcessDetail
          key={item.id}
          item={item}
          turnId={turn.id}
          fileChange={matchingFileChange(item, turn.fileChanges)}
          fileProposal={matchingFileProposal(item, turn.fileProposals)}
          onOpenProjectFile={onOpenProjectFile}
          onOpenProjectFileProposal={onOpenProjectFileProposal}
        />
      ))}
      {!hasRunningItem && (
        <div
          className="flex min-h-6 min-w-0 items-center gap-2 py-0.5 text-[10px] font-medium text-[hsl(var(--wb-accent))]"
          data-assistant-live-status
          role="status"
        >
          <TurnStatusIcon turn={turn} />
          <span className="min-w-0 truncate">
            {turnProcessHeadline(turn, processItems, t)}
          </span>
        </div>
      )}
    </section>
  );
}

function ProcessDisclosure({
  turn,
  onResume,
  onOpenProjectFile,
  onOpenProjectFileProposal,
}: {
  turn: AssistantTurn;
  onResume: () => Promise<void>;
  onOpenProjectFile?: (relativePath: string) => Promise<unknown>;
  onOpenProjectFileProposal?: (turnId: string, callId: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const processItems = useMemo(
    () => [...turn.process].sort((left, right) => left.sequence - right.sequence),
    [turn.process],
  );
  const canExpand = processItems.length > 0;

  return (
    <section
      aria-label={t("assistant.processAria")}
      data-assistant-process-disclosure={turn.id}
      data-process-status={turn.status}
      data-process-running="false"
    >
      <div className="flex min-h-6 items-start">
        {canExpand ? (
          <button
            type="button"
            className="group flex min-h-6 min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-[10px] outline-none focus-visible:text-[hsl(var(--wb-accent))]"
            aria-expanded={expanded}
            aria-controls={`assistant-process-details-${turn.id}`}
            onClick={() => setExpanded((current) => !current)}
          >
            <TurnStatusIcon turn={turn} />
            <span className="flex min-w-0 max-w-full items-center gap-1">
              <span
                className={cn(
                  "min-w-0 truncate",
                  "text-[hsl(var(--wb-text))]",
                )}
                data-assistant-process-headline
              >
                <ProcessDisclosureHeadline
                  turn={turn}
                  processItems={processItems}
                />
              </span>
              <ChevronRight
                size={10}
                className={cn(
                  "shrink-0 opacity-0 transition-[transform,opacity] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none",
                  "text-[hsl(var(--wb-text-muted))]",
                  expanded && "rotate-90",
                )}
                aria-hidden="true"
                data-assistant-process-chevron
              />
            </span>
          </button>
        ) : (
          <div
            className="flex min-h-6 min-w-0 flex-1 items-center gap-2 py-0.5 text-[10px]"
            role="status"
            aria-live="polite"
          >
            <TurnStatusIcon turn={turn} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                "text-[hsl(var(--wb-text))]",
              )}
              data-assistant-process-headline
            >
              <ProcessDisclosureHeadline
                turn={turn}
                processItems={processItems}
              />
            </span>
          </div>
        )}

        {assistantTurnCanResume(turn) && (
          <button
            type="button"
            className="wb-text-button h-6 shrink-0 px-1.5 text-[10px]"
            onClick={() => void onResume()}
          >
            <Play size={10} />
            {t("common.resume")}
          </button>
        )}
      </div>

      {canExpand && expanded && (
        <div
          id={`assistant-process-details-${turn.id}`}
          className="space-y-1 pb-1 pt-1 pl-5"
        >
          {processItems.map((item) => (
            <ProcessDetail
              key={item.id}
              item={item}
              turnId={turn.id}
              fileChange={matchingFileChange(item, turn.fileChanges)}
              fileProposal={matchingFileProposal(item, turn.fileProposals)}
              onOpenProjectFile={onOpenProjectFile}
              onOpenProjectFileProposal={onOpenProjectFileProposal}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ProcessDetail({
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
      <ExpandableProcessDetail
        item={item}
        detail={detail}
        turnId={turnId}
      />
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
  const canReviewDiff = Boolean(
    fileProposal && onOpenProjectFileProposal,
  );
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

function matchingFileChange(
  item: AssistantProcessItem,
  changes: readonly AssistantProjectFileChange[] | undefined,
) {
  if (!isProjectMutationTool(item.toolName)) return undefined;
  return changes?.find(
    (change) =>
      item.id === change.callId || item.id === `tool:${change.callId}`,
  );
}

function matchingFileProposal(
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

type ProjectFileOperation = "read" | "edit" | "delete";

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
    projectFileOperation(toolName) !== "edit" ||
    isProjectMutationTool(toolName)
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
  const match = detail?.match(
    /"relativePath"\s*:\s*"((?:\\.|[^"\\])*)"/u,
  );
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

function ProcessDisclosureHeadline({
  turn,
  processItems,
}: {
  turn: AssistantTurn;
  processItems: AssistantProcessItem[];
}) {
  const { t } = useI18n();
  const duration = formatProcessDuration(
    Math.max(0, turn.updatedAt - turn.createdAt),
  );
  if (turn.status === "completed") {
    return t("assistant.process.workedFor", { duration });
  }
  return turnProcessHeadline(turn, processItems, t);
}

function formatProcessDuration(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function splitOutputPreview(detail: string): [string, string] {
  const marker = "\nOutput preview\n";
  const markerIndex = detail.indexOf(marker);
  if (markerIndex < 0) return [detail, ""];
  return [
    detail.slice(0, markerIndex).trim(),
    detail.slice(markerIndex + marker.length).trim(),
  ];
}

function ApprovalPrompt({
  approval,
  onDecision,
}: {
  approval: AssistantApproval;
  onDecision: (
    decision: "approve" | "reject",
    confirmationText?: string,
  ) => Promise<void>;
}) {
  const { t } = useI18n();
  const [submittingDecision, setSubmittingDecision] = useState<
    "approve" | "reject" | null
  >(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const confirmationMatches =
    !approval.confirmation ||
    confirmationText === approval.confirmation.phrase;
  const decide = async (decision: "approve" | "reject") => {
    if (submittingDecision) return;
    setSubmittingDecision(decision);
    try {
      await onDecision(
        decision,
        decision === "approve" ? confirmationText || undefined : undefined,
      );
    } finally {
      setSubmittingDecision(null);
    }
  };

  return (
    <section
      className="border-y border-amber-500/25 bg-amber-500/5 px-2 py-2"
      aria-busy={submittingDecision !== null}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert size={12} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] leading-4 text-[hsl(var(--wb-text))]">
            {approval.title}
          </div>
          <div className="mt-0.5 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
            {[approval.risk, approval.toolName, approval.summary]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {approval.findings?.length ? (
            <div className="mt-1.5 space-y-1" data-command-policy-findings>
              {approval.findings.map((finding) => (
                <div key={finding.ruleId} className="text-[9px] leading-4">
                  <div className="text-amber-300">{finding.title}</div>
                  <div className="text-[hsl(var(--wb-text-muted))]">
                    {finding.detail}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {approval.confirmation && (
            <label className="mt-2 block text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
              <span>{approval.confirmation.prompt}</span>
              <code className="ml-1 select-all text-amber-300">
                {approval.confirmation.phrase}
              </code>
              <input
                type="text"
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.currentTarget.value)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !isComposing &&
                    !event.nativeEvent.isComposing &&
                    confirmationMatches &&
                    submittingDecision === null
                  ) {
                    event.preventDefault();
                    void decide("approve");
                  }
                }}
                spellCheck={false}
                autoComplete="off"
                aria-label="High-risk command confirmation phrase"
                className="mt-1 h-7 w-full rounded-[3px] border border-amber-500/30 bg-[hsl(var(--wb-editor))] px-2 font-mono text-[10px] text-[hsl(var(--wb-text))] outline-none focus:border-amber-400"
                placeholder={approval.confirmation.phrase}
              />
            </label>
          )}
          <div className="mt-2 flex justify-end gap-1">
            <button
              type="button"
              className="wb-text-button h-6 px-2 text-[10px]"
              disabled={submittingDecision !== null}
              onClick={() => void decide("reject")}
            >
              {submittingDecision === "reject" ? (
                <Loader2
                  size={10}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <X size={10} />
              )}
              {submittingDecision === "reject"
                ? t("common.rejecting")
                : t("common.reject")}
            </button>
            <button
              type="button"
              className="wb-primary-button h-6 px-2 text-[10px]"
              disabled={submittingDecision !== null || !confirmationMatches}
              onClick={() => void decide("approve")}
            >
              {submittingDecision === "approve" ? (
                <Loader2
                  size={10}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Check size={10} />
              )}
              {submittingDecision === "approve"
                ? t("common.approving")
                : t("common.approveOnce")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function TurnStatusIcon({ turn }: { turn: AssistantTurn }) {
  if (["queued", "planning", "running", "cancelling"].includes(turn.status)) {
    return (
      <Loader2
        size={11}
        className="shrink-0 animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none"
      />
    );
  }
  if (["failed", "paused"].includes(turn.status)) {
    return <CircleAlert size={11} className="shrink-0 text-amber-400" />;
  }
  if (turn.status === "awaiting_input") {
    return (
      <HelpCircle
        size={11}
        className="shrink-0 text-[hsl(var(--wb-accent))]"
      />
    );
  }
  if (turn.status === "awaiting_approval") {
    return <ShieldAlert size={11} className="shrink-0 text-amber-400" />;
  }
  if (turn.status === "cancelled") {
    return <CircleStop size={11} className="shrink-0 wb-muted" />;
  }
  return <CheckCircle2 size={11} className="shrink-0 text-emerald-500" />;
}

function ProjectFileOperationIcon({
  operation,
  status,
}: {
  operation: ProjectFileOperation;
  status: AssistantProcessItem["status"];
}) {
  const className = cn(
    "mt-0.5 shrink-0",
    status === "running"
      ? "text-[hsl(var(--wb-accent))]"
      : status === "failed"
        ? "text-amber-400"
        : "text-[hsl(var(--wb-text-muted))]",
  );
  if (operation === "read") {
    return (
      <FileSearch
        size={10}
        className={className}
        aria-hidden="true"
        data-project-file-icon="read"
      />
    );
  }
  if (operation === "delete") {
    return (
      <Trash2
        size={10}
        className={className}
        aria-hidden="true"
        data-project-file-icon="delete"
      />
    );
  }
  return (
    <Pencil
      size={10}
      className={className}
      aria-hidden="true"
      data-project-file-icon="edit"
    />
  );
}

function ProcessKindIcon({ item }: { item: AssistantProcessItem }) {
  const toolName = item.toolName?.toLocaleLowerCase() ?? "";
  const className = cn(
    "mt-0.5 shrink-0",
    item.status === "running"
      ? "text-[hsl(var(--wb-accent))]"
      : item.status === "failed"
        ? "text-amber-400"
        : "text-[hsl(var(--wb-text-muted))]",
  );
  if (
    toolName.includes("command") ||
    toolName.includes("terminal") ||
    toolName.includes("shell") ||
    toolName.startsWith("query.")
  ) {
    return <SquareTerminal size={10} className={className} aria-hidden="true" />;
  }
  if (
    toolName.includes("search") ||
    toolName.includes("find") ||
    toolName.endsWith(".list") ||
    toolName.includes("listfiles")
  ) {
    return <Search size={10} className={className} aria-hidden="true" />;
  }
  return <ProcessStatusIcon status={item.status} />;
}

function ProcessStatusIcon({
  status,
}: {
  status: AssistantProcessItem["status"];
}) {
  if (status === "running") {
    return (
      <Loader2
        size={10}
        className="mt-0.5 shrink-0 animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none"
      />
    );
  }
  if (status === "failed") {
    return <CircleAlert size={10} className="mt-0.5 shrink-0 text-amber-400" />;
  }
  if (status === "cancelled") {
    return <CircleStop size={10} className="mt-0.5 shrink-0 wb-muted" />;
  }
  return <Check size={10} className="mt-0.5 shrink-0 wb-muted" />;
}

function turnProcessHeadline(
  turn: AssistantTurn,
  processItems: AssistantProcessItem[],
  t: ReturnType<typeof useI18n>["t"],
) {
  if (turn.status === "awaiting_input")
    return t("assistant.process.waitingAnswer");
  if (turn.status === "awaiting_approval")
    return t("assistant.process.waitingApproval");
  if (turn.status === "paused") return t("assistant.process.paused");
  if (turn.status === "cancelling") return t("assistant.process.stopping");
  if (turn.status === "failed") return t("assistant.process.needsAttention");
  if (turn.status === "cancelled") return t("assistant.process.cancelled");

  const runningItem = [...processItems]
    .reverse()
    .find((item) => item.status === "running");
  if (runningItem) return runningItem.title;
  if (turn.status === "planning") return t("assistant.process.thinking");
  if (turn.status === "running") {
    if (turn.draft.trim()) return t("assistant.process.writing");
    return processItems.length > 0
      ? completedActivityHeadline(processItems, t)
      : t("assistant.process.working");
  }
  return completedActivityHeadline(processItems, t);
}

function completedActivityHeadline(
  processItems: AssistantProcessItem[],
  t: ReturnType<typeof useI18n>["t"],
) {
  const labels: string[] = [];
  const clarificationItems = processItems.filter(
    (item) => item.kind === "clarification",
  );
  for (const item of processItems) {
    if (item.kind === "clarification") {
      const label =
        clarificationItems.length === 1
          ? item.title.trim()
          : t("assistant.process.confirmedAnswers");
      if (label && !labels.includes(label)) labels.push(label);
      continue;
    }
    const label =
      item.kind === "planning"
        ? t("assistant.process.prepared")
        : item.title.trim();
    if (label && !labels.includes(label)) labels.push(label);
  }

  const substantiveLabels =
    labels.length > 1
      ? labels.filter((label) => label !== t("assistant.process.prepared"))
      : labels;
  if (substantiveLabels.length === 0)
    return t("assistant.process.completed");
  if (substantiveLabels.length <= 2) return substantiveLabels.join(" · ");
  return `${substantiveLabels[0]} · ${substantiveLabels[1]} · ${t(
    "assistant.process.more",
    { count: substantiveLabels.length - 2 },
  )}`;
}
