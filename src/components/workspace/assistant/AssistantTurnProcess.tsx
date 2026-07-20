import {
  assistantTurnCanResume,
  type AssistantApproval,
  type AssistantProcessItem,
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
  HelpCircle,
  Loader2,
  Play,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type AssistantTurnProcessProps = {
  turn: AssistantTurn;
  contextFingerprint: string;
  onDecideApproval: (
    turnId: string,
    approvalId: string,
    decision: "approve" | "reject",
    contextFingerprint: string,
  ) => Promise<void>;
  onResume: (turnId: string, contextFingerprint: string) => Promise<void>;
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

const AUTO_EXPAND_STATUS = new Set<AssistantTurn["status"]>([
  "paused",
  "failed",
]);

export function AssistantTurnProcess({
  turn,
  contextFingerprint,
  onDecideApproval,
  onResume,
}: AssistantTurnProcessProps) {
  const pendingApprovals = turn.approvals.filter(
    (approval) => !approval.decision,
  );
  const showActivity =
    turn.process.length > 0 || VISIBLE_STATUS_WITHOUT_PROCESS.has(turn.status);

  return (
    <div className="space-y-2" data-assistant-turn-process={turn.id}>
      {showActivity && (
        <ProcessDisclosure
          turn={turn}
          onResume={() => onResume(turn.id, contextFingerprint)}
        />
      )}

      {pendingApprovals.map((approval) => (
        <ApprovalPrompt
          key={approval.approvalId}
          approval={approval}
          onDecision={(decision) =>
            onDecideApproval(
              turn.id,
              approval.approvalId,
              decision,
              contextFingerprint,
            )
          }
        />
      ))}
    </div>
  );
}

function ProcessDisclosure({
  turn,
  onResume,
}: {
  turn: AssistantTurn;
  onResume: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(() =>
    AUTO_EXPAND_STATUS.has(turn.status),
  );
  const processItems = useMemo(
    () => [...turn.process].sort((left, right) => left.sequence - right.sequence),
    [turn.process],
  );
  const canExpand = processItems.length > 0;
  const running = ["queued", "planning", "running", "cancelling"].includes(
    turn.status,
  );

  useEffect(() => {
    if (AUTO_EXPAND_STATUS.has(turn.status)) setExpanded(true);
  }, [turn.status]);

  return (
    <section
      className="border-y border-[hsl(var(--wb-border-subtle))]"
      aria-label={t("assistant.processAria")}
      data-assistant-process-disclosure={turn.id}
      data-process-status={turn.status}
      data-process-running={running ? "true" : "false"}
    >
      <div
        className={cn(
          "flex min-h-8 items-start",
          running && "wb-assistant-process-running",
        )}
      >
        {canExpand ? (
          <button
            type="button"
            className="group flex min-h-8 min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left text-[10px] outline-none hover:bg-[hsl(var(--wb-hover)/0.4)] focus-visible:bg-[hsl(var(--wb-hover)/0.55)]"
            aria-expanded={expanded}
            aria-controls={`assistant-process-details-${turn.id}`}
            onClick={() => setExpanded((current) => !current)}
          >
            <TurnStatusIcon turn={turn} />
            <span className="min-w-0 flex-1 truncate text-[hsl(var(--wb-text))]">
              {turnProcessHeadline(turn, processItems, t)}
            </span>
            <ChevronRight
              size={11}
              className={cn(
                "shrink-0 text-[hsl(var(--wb-text-muted))] transition-transform duration-150 motion-reduce:transition-none",
                expanded && "rotate-90",
              )}
            />
          </button>
        ) : (
          <div
            className="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-[10px]"
            role="status"
            aria-live="polite"
          >
            <TurnStatusIcon turn={turn} />
            <span className="min-w-0 flex-1 truncate text-[hsl(var(--wb-text))]">
              {turnProcessHeadline(turn, processItems, t)}
            </span>
          </div>
        )}

        {assistantTurnCanResume(turn) && (
          <button
            type="button"
            className="wb-text-button mr-1 mt-1 h-6 shrink-0 px-1.5 text-[10px]"
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
          className="space-y-1 border-t border-[hsl(var(--wb-border-subtle))] py-1.5 pl-6 pr-2"
        >
          {processItems.map((item) => (
            <ProcessDetail key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProcessDetail({ item }: { item: AssistantProcessItem }) {
  const detail = [item.toolName, item.detail].filter(Boolean).join(" · ");
  const [detailSummary, outputPreview] = splitOutputPreview(detail);
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2 py-0.5 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]",
        item.status === "running" && "wb-assistant-process-running",
      )}
      data-assistant-process-item={item.id}
      data-process-status={item.status}
    >
      <ProcessStatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <div className="break-words text-[10px] text-[hsl(var(--wb-text))]">
          {item.title}
        </div>
        {detailSummary && (
          <div className="mt-0.5 whitespace-pre-wrap break-words">
            {detailSummary}
          </div>
        )}
        {outputPreview && (
          <pre className="custom-scrollbar mt-1 max-h-40 overflow-auto rounded-[4px] bg-black/15 px-2 py-1.5 font-mono text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
            {outputPreview}
          </pre>
        )}
      </div>
    </div>
  );
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
  onDecision: (decision: "approve" | "reject") => Promise<void>;
}) {
  const { t } = useI18n();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const decide = async (decision: "approve" | "reject") => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onDecision(decision);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="border-y border-amber-500/25 bg-amber-500/5 px-2 py-2">
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
          <div className="mt-2 flex justify-end gap-1">
            <button
              type="button"
              className="wb-text-button h-6 px-2 text-[10px]"
              disabled={isSubmitting}
              onClick={() => void decide("reject")}
            >
              <X size={10} />
              {t("common.reject")}
            </button>
            <button
              type="button"
              className="wb-primary-button h-6 px-2 text-[10px]"
              disabled={isSubmitting}
              onClick={() => void decide("approve")}
            >
              <Check size={10} />
              {t("common.approveOnce")}
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
