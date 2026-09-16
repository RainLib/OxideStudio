import type { AssistantApproval } from "@/ai/assistant/turns";
import { useI18n } from "@/i18n";
import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import { useState } from "react";

export function ApprovalPrompt({
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
    !approval.confirmation || confirmationText === approval.confirmation.phrase;
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
                onChange={(event) =>
                  setConfirmationText(event.currentTarget.value)
                }
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
