import {
  assistantTurnCanCancel,
  assistantTurnCanResume,
  type AssistantApproval,
  type AssistantClarification,
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
import { useState, type FormEvent } from "react";

type AssistantTurnProcessProps = {
  turn: AssistantTurn;
  contextFingerprint: string;
  onAnswerClarification: (
    turnId: string,
    clarificationId: string,
    questionId: string,
    answer: string,
    contextFingerprint: string,
  ) => Promise<void>;
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
  onAnswerClarification,
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
  const pendingClarifications = turn.clarifications.filter(
    (clarification) => !clarification.answer,
  );
  const pendingApprovals = turn.approvals.filter(
    (approval) => !approval.decision,
  );

  return (
    <div className="space-y-2" data-assistant-turn-process={turn.id}>
      {showProcess && (
        <details
          className="group border-y border-[hsl(var(--wb-border-subtle))]"
          aria-label="Assistant process"
        >
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 px-1.5 py-1 text-[10px] text-[hsl(var(--wb-text-muted))] marker:content-none hover:text-[hsl(var(--wb-text))] [&::-webkit-details-marker]:hidden">
            <ChevronRight
              size={11}
              className="shrink-0 transition-transform duration-150 group-open:rotate-90"
            />
            <TurnStatusIcon turn={turn} />
            <span className="min-w-0 flex-1 truncate">
              {turnProcessLabel(turn)}
            </span>
            {turn.process.length > 0 && (
              <span className="shrink-0 text-[9px] tabular-nums opacity-70">
                {turn.process.length}
              </span>
            )}
          </summary>

          <div className="border-t border-[hsl(var(--wb-border-subtle))]">
            {turn.process.length > 0 ? (
              <ol className="divide-y divide-[hsl(var(--wb-border-subtle))]">
                {turn.process.map((item) => (
                  <ProcessItem key={item.id} item={item} />
                ))}
              </ol>
            ) : (
              <div className="px-2 py-2 text-[10px] text-[hsl(var(--wb-text-muted))]">
                Waiting for Agent Host activity.
              </div>
            )}

            {(assistantTurnCanCancel(turn) || assistantTurnCanResume(turn)) && (
              <div className="flex justify-end gap-1 border-t border-[hsl(var(--wb-border-subtle))] px-1.5 py-1.5">
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
          </div>
        </details>
      )}

      {pendingClarifications.map((clarification) => (
        <ClarificationPrompt
          key={`${clarification.clarificationId}:${clarification.questionId}`}
          clarification={clarification}
          onAnswer={(answer) =>
            onAnswerClarification(
              turn.id,
              clarification.clarificationId,
              clarification.questionId,
              answer,
              contextFingerprint,
            )
          }
        />
      ))}

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
  return (
    <li className="flex min-w-0 items-start gap-2 px-2 py-1.5 text-[10px] leading-4">
      <ProcessStatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <div className="text-[hsl(var(--wb-text))]">{item.title}</div>
        {(item.toolName || item.detail) && (
          <div className="mt-0.5 break-words text-[9px] text-[hsl(var(--wb-text-muted))]">
            {[item.toolName, item.detail].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    </li>
  );
}

function ClarificationPrompt({
  clarification,
  onAnswer,
}: {
  clarification: AssistantClarification;
  onAnswer: (answer: string) => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (value: string) => {
    const normalized = value.trim();
    if (!normalized || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onAnswer(normalized);
    } finally {
      setIsSubmitting(false);
    }
  };
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(answer);
  };

  return (
    <section className="border-y border-[hsl(var(--wb-border-subtle))] px-2 py-2">
      <div className="flex items-start gap-2">
        <HelpCircle
          size={12}
          className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] leading-4 text-[hsl(var(--wb-text))]">
            {clarification.question}
          </div>
          {clarification.context && (
            <div className="mt-0.5 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
              {clarification.context}
            </div>
          )}
        </div>
      </div>

      {clarification.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 pl-5">
          {clarification.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="wb-text-button min-h-6 border border-[hsl(var(--wb-border-subtle))] px-2 text-[10px]"
              title={option.description ?? undefined}
              disabled={isSubmitting}
              onClick={() => void submit(option.value || option.label)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {clarification.allowFreeText && (
        <form className="mt-2 flex gap-1 pl-5" onSubmit={handleSubmit}>
          <input
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[10px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))]"
            placeholder="Answer the agent"
            aria-label="Clarification answer"
            disabled={isSubmitting}
          />
          <button
            type="submit"
            className="wb-primary-button h-7 px-2 text-[10px]"
            disabled={!answer.trim() || isSubmitting}
          >
            Answer
          </button>
        </form>
      )}
    </section>
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
