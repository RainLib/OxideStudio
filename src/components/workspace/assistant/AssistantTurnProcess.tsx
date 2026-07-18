import {
  assistantTurnCanCancel,
  assistantTurnCanResume,
  type AssistantApproval,
  type AssistantProcessItem,
  type AssistantTurn,
} from "@/ai/assistant/turns";
import { cn } from "@/lib/utils";
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
import { useState } from "react";

type AssistantTurnProcessProps = {
  turn: AssistantTurn;
  contextFingerprint: string;
  onDecideApproval: (
    turnId: string,
    approvalId: string,
    decision: "approve" | "reject",
    contextFingerprint: string,
  ) => Promise<void>;
  onCancel: (turnId: string) => Promise<void>;
  onResume: (turnId: string, contextFingerprint: string) => Promise<void>;
};

export function AssistantTurnProcess({
  turn,
  contextFingerprint,
  onDecideApproval,
  onCancel,
  onResume,
}: AssistantTurnProcessProps) {
  const showProcess =
    turn.process.length > 0 ||
    [
      "queued",
      "planning",
      "running",
      "awaiting_input",
      "awaiting_approval",
      "paused",
      "cancelling",
    ].includes(turn.status);
  const pendingApprovals = turn.approvals.filter(
    (approval) => !approval.decision,
  );
  const showStandaloneStatus =
    turn.process.length === 0 ||
    [
      "awaiting_input",
      "awaiting_approval",
      "paused",
      "cancelling",
      "failed",
      "cancelled",
    ].includes(turn.status);

  return (
    <div className="space-y-2" data-assistant-turn-process={turn.id}>
      {showProcess && (
        <section
          className="divide-y divide-[hsl(var(--wb-border-subtle))] border-y border-[hsl(var(--wb-border-subtle))]"
          aria-label="Assistant process"
        >
          {turn.process.map((item) => (
            <ProcessItem key={item.id} item={item} />
          ))}

          {showStandaloneStatus && (
            <div
              className={cn(
                "flex min-h-8 items-center gap-2 px-1.5 py-1 text-[10px] text-[hsl(var(--wb-text-muted))]",
                ["planning", "running", "cancelling"].includes(turn.status) &&
                  "wb-assistant-process-running",
              )}
            >
              <TurnStatusIcon turn={turn} />
              <span className="min-w-0 flex-1 truncate">
                {turnProcessLabel(turn)}
              </span>
              {assistantTurnCanResume(turn) && (
                <button
                  type="button"
                  className="wb-text-button h-6 px-1.5 text-[10px]"
                  onClick={() => void onResume(turn.id, contextFingerprint)}
                >
                  <Play size={10} />
                  Resume
                </button>
              )}
              {assistantTurnCanCancel(turn) && (
                <button
                  type="button"
                  className="wb-text-button h-6 px-1.5 text-[10px] text-[hsl(var(--wb-text-muted))]"
                  onClick={() => void onCancel(turn.id)}
                >
                  <CircleStop size={10} />
                  Cancel
                </button>
              )}
            </div>
          )}
        </section>
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

function ProcessItem({ item }: { item: AssistantProcessItem }) {
  const detail = [item.toolName, item.detail].filter(Boolean).join(" · ");
  const row = (
    <>
      <ProcessStatusIcon status={item.status} />
      <span className="min-w-0 flex-1 truncate text-[hsl(var(--wb-text))]">
        {item.title}
      </span>
    </>
  );

  if (detail) {
    return (
      <details
        className="group"
        data-assistant-process-item={item.id}
        data-process-status={item.status}
      >
        <summary
          className={cn(
            "flex min-h-8 cursor-pointer list-none items-center gap-2 px-1.5 py-1 text-[10px] marker:content-none hover:bg-[hsl(var(--wb-hover)/0.45)] [&::-webkit-details-marker]:hidden",
            item.status === "running" && "wb-assistant-process-running",
          )}
        >
          {row}
          <ChevronRight
            size={11}
            className="shrink-0 text-[hsl(var(--wb-text-muted))] transition-transform duration-150 group-open:rotate-90"
          />
        </summary>
        <div className="whitespace-pre-wrap break-words pb-2 pl-[27px] pr-2 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
          {detail}
        </div>
      </details>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-8 min-w-0 items-center gap-2 px-1.5 py-1 text-[10px]",
        item.status === "running" && "wb-assistant-process-running",
      )}
      data-assistant-process-item={item.id}
      data-process-status={item.status}
    >
      {row}
    </div>
  );
}

function ApprovalPrompt({
  approval,
  onDecision,
}: {
  approval: AssistantApproval;
  onDecision: (decision: "approve" | "reject") => Promise<void>;
}) {
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
              Reject
            </button>
            <button
              type="button"
              className="wb-primary-button h-6 px-2 text-[10px]"
              disabled={isSubmitting}
              onClick={() => void decide("approve")}
            >
              <Check size={10} />
              Approve once
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function TurnStatusIcon({ turn }: { turn: AssistantTurn }) {
  if (["planning", "running", "cancelling"].includes(turn.status)) {
    return (
      <Loader2
        size={11}
        className="shrink-0 animate-spin text-[hsl(var(--wb-accent))]"
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

function ProcessStatusIcon({ status }: { status: AssistantProcessItem["status"] }) {
  if (status === "running") {
    return (
      <Loader2
        size={11}
        className="mt-0.5 shrink-0 animate-spin text-[hsl(var(--wb-accent))]"
      />
    );
  }
  if (status === "failed") {
    return <CircleAlert size={11} className="mt-0.5 shrink-0 text-amber-400" />;
  }
  if (status === "cancelled") {
    return <CircleStop size={11} className="mt-0.5 shrink-0 wb-muted" />;
  }
  return (
    <CheckCircle2
      size={11}
      className={cn(
        "mt-0.5 shrink-0",
        status === "pending" ? "wb-muted" : "text-emerald-500",
      )}
    />
  );
}

function turnProcessLabel(turn: AssistantTurn) {
  if (turn.status === "planning") return "Planning";
  if (turn.status === "running") return "Working";
  if (turn.status === "awaiting_input") return "Waiting for your answer";
  if (turn.status === "awaiting_approval") return "Waiting for approval";
  if (turn.status === "paused") return "Paused · can resume";
  if (turn.status === "cancelling") return "Stopping";
  if (turn.status === "failed") return "Process needs attention";
  if (turn.status === "cancelled") return "Cancelled";
  return `Completed · ${turn.process.length} ${turn.process.length === 1 ? "stage" : "stages"}`;
}
