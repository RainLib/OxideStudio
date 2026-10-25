import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isPartialSearchIndexClear } from "@/features/database-explorer/model/elasticsearchIndexActions";
import { schemaService } from "@/services/tauri";
import type {
  ElasticsearchIndexClearPlan,
  SearchIndexClearResult,
} from "@/services/tauri/types";

interface ElasticsearchIndexClearDialogProps {
  open: boolean;
  connectionId: string;
  driver: string;
  index: string;
  onClose: () => void;
  onCleared: (result: SearchIndexClearResult, index: string) => void;
}

export function ElasticsearchIndexClearDialog({
  open,
  connectionId,
  driver,
  index,
  onClose,
  onCleared,
}: ElasticsearchIndexClearDialogProps) {
  const [plan, setPlan] = useState<ElasticsearchIndexClearPlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState<SearchIndexClearResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPlan(null);
    setConfirmation("");
    setResult(null);
    setError(null);
    setLoading(true);
    void schemaService
      .previewElasticsearchIndexClear(connectionId, driver, index)
      .then((nextPlan) => {
        if (!cancelled) setPlan(nextPlan);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, driver, index, open]);

  const execute = async () => {
    if (!plan) return;
    setExecuting(true);
    setError(null);
    try {
      const receipt = await schemaService.executeElasticsearchIndexClear(
        connectionId,
        driver,
        {
          index: plan.index,
          confirmationToken: plan.confirmationToken,
          confirmationPhrase: confirmation,
        },
      );
      setResult(receipt);
      onCleared(receipt, plan.index);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExecuting(false);
    }
  };

  const confirmed =
    !plan?.confirmationPhrase || confirmation.trim() === plan.confirmationPhrase;
  const partial = result ? isPartialSearchIndexClear(result) : false;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !executing && onClose()}>
      <DialogContent layout="custom" className="w-[min(560px,calc(100vw-32px))] max-w-none gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[hsl(var(--wb-border))] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-[13px] font-semibold tracking-normal">
            {result && !partial ? (
              <CheckCircle2 size={15} className="text-emerald-400" />
            ) : (
              <Trash2 size={15} className="text-rose-400" />
            )}
            {result ? "Index clear result" : "Clear index documents"}
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-5 wb-muted">
            Deletes documents but keeps the index, mapping, settings, and aliases.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {loading ? (
            <div className="flex h-36 items-center justify-center gap-2 text-[11px] wb-muted">
              <Loader2 size={14} className="animate-spin" /> Preparing a reviewed operation…
            </div>
          ) : result ? (
            <>
              <div className={`border-l-2 px-3 py-2 ${partial ? "border-amber-400 bg-amber-500/5" : "border-emerald-400 bg-emerald-500/5"}`}>
                <p className="text-[11px] font-medium">
                  {partial
                    ? "The operation completed with documents that need review."
                    : "All matched documents were deleted."}
                </p>
                <p className="mt-1 text-[10px] wb-muted">Target · {plan?.index ?? index}</p>
              </div>
              <div className="grid grid-cols-4 divide-x divide-[hsl(var(--wb-border))] rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))]">
                {[
                  ["Matched", result.total],
                  ["Deleted", result.deleted],
                  ["Conflicts", result.versionConflicts],
                  ["Failures", result.failures.length],
                ].map(([label, value]) => (
                  <div key={label} className="px-3 py-2.5">
                    <div className="font-mono text-[14px] font-semibold">{value}</div>
                    <div className="mt-0.5 text-[9px] uppercase tracking-[0.08em] wb-muted">{label}</div>
                  </div>
                ))}
              </div>
              {result.timedOut && (
                <p className="text-[11px] text-amber-300">Elasticsearch reported a timeout. Refresh the index before another mutation.</p>
              )}
              {result.failures.length > 0 && (
                <div className="max-h-28 overflow-auto rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-2 font-mono text-[10px] leading-4 text-rose-300">
                  {result.failures.map((failure, index) => (
                    <div key={`${index}:${failure}`}>{failure}</div>
                  ))}
                </div>
              )}
            </>
          ) : plan ? (
            <>
              <div className="flex items-start gap-3 border-l-2 border-rose-400 bg-rose-500/5 px-3 py-2.5">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose-400" />
                <div className="min-w-0">
                  <p className="text-[11px] font-medium">
                    {plan.isPattern
                      ? "This pattern can clear multiple physical indexes."
                      : `This clears every document in ${plan.index}.`}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 wb-muted">
                    {plan.documentCount == null
                      ? "The current document count is unavailable."
                      : `${plan.documentCount.toLocaleString()} documents were visible when this review was prepared.`}
                  </p>
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-[9px] uppercase tracking-[0.08em] wb-muted">Fixed request</div>
                <pre className="overflow-auto rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-3 font-mono text-[10px] leading-5 text-[hsl(var(--wb-text-muted))]">
                  {plan.requestPreview}
                </pre>
              </div>

              {plan.confirmationPhrase && (
                <label className="block">
                  <span className="mb-1.5 block text-[10px] wb-muted">
                    Type <code className="text-[hsl(var(--wb-text))]">{plan.confirmationPhrase}</code> to confirm the full pattern.
                  </span>
                  <Input
                    aria-label="Elasticsearch clear confirmation phrase"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] font-mono text-[11px]"
                  />
                </label>
              )}
            </>
          ) : null}

          {error && (
            <div className="rounded-[4px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] leading-4 text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-end gap-2 border-t border-[hsl(var(--wb-border))] px-4 py-3 sm:space-x-0">
          <Button variant="ghost" size="sm" disabled={executing} onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button
              variant="destructive"
              size="sm"
              disabled={!plan || loading || executing || !confirmed}
              onClick={() => void execute()}
            >
              {executing && <Loader2 size={13} className="mr-1.5 animate-spin" />}
              {executing ? "Clearing…" : "Clear Documents"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
