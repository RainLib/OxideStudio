import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { schemaService } from "@/services/tauri";
import type {
  MongoDocumentClonePlan,
  MongoDocumentCloneRequest,
  MongoDocumentCloneReceipt,
} from "@/services/tauri/types";
import {
  CheckCircle2,
  CopyPlus,
  FileDiff,
  Fingerprint,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface MongoDocumentCloneDialogProps {
  open: boolean;
  connectionId: string;
  driver: string;
  database: string;
  collection: string;
  sourceId: unknown;
  onOpenChange: (open: boolean) => void;
  onCloned?: () => void | Promise<void>;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

function formatIdentity(value: unknown) {
  const serialized = JSON.stringify(value);
  if (!serialized) return "Unknown identity";
  return serialized.length > 72 ? `${serialized.slice(0, 69)}…` : serialized;
}

function parseDraft(source: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Clone draft must be one JSON object.");
  }
  return value as Record<string, unknown>;
}

export function MongoDocumentCloneDialog({
  open,
  connectionId,
  driver,
  database,
  collection,
  sourceId,
  onOpenChange,
  onCloned,
}: MongoDocumentCloneDialogProps) {
  const [draftText, setDraftText] = useState("");
  const [plan, setPlan] = useState<MongoDocumentClonePlan | null>(null);
  const [receipt, setReceipt] = useState<MongoDocumentCloneReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const generationRef = useRef(0);

  const baseRequest = useMemo<MongoDocumentCloneRequest>(
    () => ({ database, collection, sourceId, draftDocument: null }),
    [collection, database, sourceId],
  );

  useEffect(() => {
    if (!open) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setDraftText("");
    setPlan(null);
    setReceipt(null);
    setError(null);
    setIsLoading(true);
    void schemaService
      .previewMongoDocumentClone(connectionId, driver, baseRequest)
      .then((nextPlan) => {
        if (generationRef.current !== generation) return;
        setPlan(nextPlan);
        setDraftText(JSON.stringify(nextPlan.draftDocument, null, 2));
      })
      .catch((reason) => {
        if (generationRef.current === generation) setError(errorMessage(reason));
      })
      .finally(() => {
        if (generationRef.current === generation) setIsLoading(false);
      });
    return () => {
      generationRef.current += 1;
    };
  }, [baseRequest, connectionId, driver, open]);

  const preservedFieldCount = useMemo(() => {
    if (!plan) return 0;
    const edited = new Set(plan.editedFields);
    return Object.keys(plan.sourceDocument).filter(
      (field) => field !== "_id" && !edited.has(field),
    ).length;
  }, [plan]);

  const review = async () => {
    let draftDocument: Record<string, unknown>;
    try {
      draftDocument = parseDraft(draftText);
    } catch (reason) {
      setPlan(null);
      setError(errorMessage(reason));
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setIsReviewing(true);
    setPlan(null);
    setReceipt(null);
    setError(null);
    try {
      const nextPlan = await schemaService.previewMongoDocumentClone(
        connectionId,
        driver,
        { ...baseRequest, draftDocument },
      );
      if (generationRef.current !== generation) return;
      setPlan(nextPlan);
      setDraftText(JSON.stringify(nextPlan.draftDocument, null, 2));
    } catch (reason) {
      if (generationRef.current === generation) setError(errorMessage(reason));
    } finally {
      if (generationRef.current === generation) setIsReviewing(false);
    }
  };

  const execute = async () => {
    if (!plan) return;
    setIsExecuting(true);
    setError(null);
    try {
      const nextReceipt = await schemaService.executeMongoDocumentClone(
        connectionId,
        driver,
        {
          ...baseRequest,
          draftDocument: plan.draftDocument,
        },
        plan.confirmationToken,
      );
      setReceipt(nextReceipt);
      // The insert receipt is authoritative. A follow-up grid refresh is
      // useful but must never turn a committed clone into an apparent failure
      // or invite the user to submit it a second time.
      if (onCloned) {
        await Promise.resolve(onCloned()).catch(() => undefined);
      }
    } catch (reason) {
      setPlan(null);
      setError(errorMessage(reason));
    } finally {
      setIsExecuting(false);
    }
  };

  const busy = isLoading || isReviewing || isExecuting;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="flex max-h-[86vh] max-w-[820px] flex-col overflow-hidden border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[13px]">
            <CopyPlus size={15} /> Clone MongoDB document
          </DialogTitle>
          <DialogDescription className="text-[11px] wb-muted">
            {database}.{collection} · a new `_id` is generated unless the draft adds one
          </DialogDescription>
        </DialogHeader>

        {receipt ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-8 py-10 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-[hsl(var(--success)/0.45)] bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]">
              <CheckCircle2 size={20} />
            </span>
            <div className="text-[13px] font-medium">Document cloned</div>
            <div className="max-w-md text-[11px] wb-muted">{receipt.message}</div>
            <code className="max-w-full truncate rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-2 py-1 text-[10px]">
              _id {formatIdentity(receipt.insertedId)}
            </code>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)] overflow-hidden text-[11px]">
            <aside className="min-h-0 overflow-auto border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.55)] p-3">
              <div className="mb-3 flex items-start gap-2">
                <Fingerprint size={13} className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]" />
                <div className="min-w-0">
                  <div className="font-medium">Source identity</div>
                  <div className="mt-1 break-all font-mono text-[9px] wb-muted">
                    {formatIdentity(sourceId)}
                  </div>
                </div>
              </div>

              <div className="border-t border-[hsl(var(--wb-border-subtle))] pt-3">
                <div className="mb-2 flex items-center gap-1.5 font-medium">
                  <FileDiff size={12} /> Field ledger
                </div>
                {isLoading ? (
                  <div className="flex items-center gap-2 wb-muted">
                    <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" />
                    Reading source…
                  </div>
                ) : !plan ? (
                  <div className="leading-5 wb-muted">
                    Review the draft to rebuild its exact change set.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between rounded-[4px] border border-[hsl(var(--wb-border-subtle))] px-2 py-1.5">
                      <span className="wb-muted">Preserved</span>
                      <span className="font-mono text-[10px]">
                        {preservedFieldCount}
                      </span>
                    </div>
                    {plan.editedFields.length === 0 ? (
                      <div className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] px-2 py-2 leading-5 wb-muted">
                        No fields changed. The source BSON is copied without its `_id`.
                      </div>
                    ) : (
                      plan.editedFields.map((field) => (
                        <div
                          key={field}
                          className="flex items-center gap-2 rounded-[4px] border border-[hsl(var(--wb-accent)/0.25)] bg-[hsl(var(--wb-accent)/0.06)] px-2 py-1.5"
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--wb-accent))]" />
                          <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                            {field}
                          </span>
                          <span className="text-[9px] wb-muted">changed</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {plan && (
                <div className="mt-3 border-t border-[hsl(var(--wb-border-subtle))] pt-3">
                  <div className="flex items-start gap-2 leading-5 wb-muted">
                    <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                    <span>
                      Source fingerprint {plan.sourceDigest.slice(0, 10)}… is checked again before insert.
                    </span>
                  </div>
                </div>
              )}
            </aside>

            <section className="flex min-h-0 min-w-0 flex-col p-3">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <label htmlFor="mongodb-clone-draft" className="font-medium">
                  Clone document
                </label>
                <span className="text-[9px] wb-muted">Canonical Extended JSON</span>
              </div>
              <textarea
                id="mongodb-clone-draft"
                aria-label="Clone document JSON"
                className={cn(
                  "min-h-[360px] min-w-0 flex-1 resize-none rounded-[5px] border bg-[hsl(var(--wb-editor))] p-3 font-mono text-[11px] leading-5 text-[hsl(var(--wb-text))] outline-none",
                  error
                    ? "border-[hsl(var(--destructive)/0.65)]"
                    : "border-[hsl(var(--wb-border))] focus:border-[hsl(var(--wb-accent)/0.7)]",
                )}
                value={draftText}
                disabled={busy}
                spellCheck={false}
                onChange={(event) => {
                  setDraftText(event.target.value);
                  setPlan(null);
                  setReceipt(null);
                  setError(null);
                }}
              />
              {error && (
                <div
                  role="alert"
                  className="mt-2 rounded-[4px] border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.08)] px-2.5 py-2 text-[10px] leading-4 text-[hsl(var(--destructive))]"
                >
                  {error}
                </div>
              )}
              <div className="mt-2 leading-5 wb-muted">
                Fields not changed here retain their original BSON type. Removing a key removes it only from the new document.
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="shrink-0 border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {receipt ? "Close" : "Cancel"}
          </Button>
          {!receipt && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !draftText.trim()}
                onClick={() => void review()}
              >
                {isReviewing ? (
                  <RefreshCw size={12} className="mr-1.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <FileDiff size={12} className="mr-1.5" />
                )}
                Review changes
              </Button>
              <Button
                size="sm"
                disabled={busy || !plan}
                onClick={() => void execute()}
              >
                {isExecuting ? (
                  <RefreshCw size={12} className="mr-1.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <CopyPlus size={12} className="mr-1.5" />
                )}
                Insert clone
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
