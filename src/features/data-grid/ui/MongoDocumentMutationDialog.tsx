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
  MongoDocumentDeletePlan,
  MongoDocumentEditPlan,
} from "@/services/tauri/types";
import {
  CheckCircle2,
  FileDiff,
  Fingerprint,
  Pencil,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type MongoDocumentMutationMode = "edit" | "delete";

interface MongoDocumentMutationDialogProps {
  open: boolean;
  mode: MongoDocumentMutationMode;
  connectionId: string;
  driver: string;
  database: string;
  collection: string;
  sourceId: unknown;
  onOpenChange: (open: boolean) => void;
  onMutated?: () => void | Promise<void>;
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
    throw new Error("Document draft must be one JSON object.");
  }
  if (Object.prototype.hasOwnProperty.call(value, "_id")) {
    throw new Error("_id is immutable. Edit only the document fields.");
  }
  return value as Record<string, unknown>;
}

export function MongoDocumentMutationDialog({
  open,
  mode,
  connectionId,
  driver,
  database,
  collection,
  sourceId,
  onOpenChange,
  onMutated,
}: MongoDocumentMutationDialogProps) {
  const [editPlan, setEditPlan] = useState<MongoDocumentEditPlan | null>(null);
  const [deletePlan, setDeletePlan] = useState<MongoDocumentDeletePlan | null>(null);
  const [draftText, setDraftText] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const generationRef = useRef(0);

  const baseRequest = useMemo(
    () => ({ database, collection, sourceId }),
    [collection, database, sourceId],
  );

  useEffect(() => {
    if (!open) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setEditPlan(null);
    setDeletePlan(null);
    setDraftText("");
    setConfirmation("");
    setReceipt(null);
    setError(null);
    setIsLoading(true);
    const request =
      mode === "edit"
        ? schemaService.previewMongoDocumentEdit(connectionId, driver, {
            ...baseRequest,
            draftDocument: null,
          })
        : schemaService.previewMongoDocumentDelete(
            connectionId,
            driver,
            baseRequest,
          );
    void request
      .then((nextPlan) => {
        if (generationRef.current !== generation) return;
        if (mode === "edit") {
          const plan = nextPlan as MongoDocumentEditPlan;
          setEditPlan(plan);
          setDraftText(JSON.stringify(plan.draftDocument, null, 2));
        } else {
          setDeletePlan(nextPlan as MongoDocumentDeletePlan);
        }
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
  }, [baseRequest, connectionId, driver, mode, open]);

  const activePlan = mode === "edit" ? editPlan : deletePlan;
  const reviewEdit = async () => {
    let draftDocument: Record<string, unknown>;
    try {
      draftDocument = parseDraft(draftText);
    } catch (reason) {
      setEditPlan(null);
      setError(errorMessage(reason));
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setIsReviewing(true);
    setEditPlan(null);
    setReceipt(null);
    setError(null);
    try {
      const nextPlan = await schemaService.previewMongoDocumentEdit(
        connectionId,
        driver,
        { ...baseRequest, draftDocument },
      );
      if (generationRef.current !== generation) return;
      setEditPlan(nextPlan);
      setDraftText(JSON.stringify(nextPlan.draftDocument, null, 2));
    } catch (reason) {
      if (generationRef.current === generation) setError(errorMessage(reason));
    } finally {
      if (generationRef.current === generation) setIsReviewing(false);
    }
  };

  const execute = async () => {
    if (!activePlan) return;
    setIsExecuting(true);
    setError(null);
    try {
      const result =
        mode === "edit"
          ? await schemaService.executeMongoDocumentEdit(
              connectionId,
              driver,
              { ...baseRequest, draftDocument: editPlan?.draftDocument ?? null },
              activePlan.confirmationToken,
            )
          : await schemaService.executeMongoDocumentDelete(
              connectionId,
              driver,
              baseRequest,
              activePlan.confirmationToken,
              confirmation,
            );
      setReceipt(result.message);
      if (onMutated) await Promise.resolve(onMutated()).catch(() => undefined);
    } catch (reason) {
      setEditPlan(null);
      setDeletePlan(null);
      setError(errorMessage(reason));
    } finally {
      setIsExecuting(false);
    }
  };

  const busy = isLoading || isReviewing || isExecuting;
  const canExecute =
    mode === "edit"
      ? Boolean(editPlan && editPlan.editedFields.length > 0)
      : Boolean(deletePlan && confirmation === deletePlan.confirmationPhrase);
  const sourceDocument = activePlan?.sourceDocument;

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
            {mode === "edit" ? <Pencil size={15} /> : <Trash2 size={15} />}
            {mode === "edit" ? "Edit MongoDB document" : "Delete MongoDB document"}
          </DialogTitle>
          <DialogDescription className="text-[11px] wb-muted">
            {database}.{collection} · `_id` remains immutable
          </DialogDescription>
        </DialogHeader>

        {receipt ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 px-8 py-10 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-[hsl(var(--success)/0.45)] bg-[hsl(var(--success)/0.1)] text-[hsl(var(--success))]">
              <CheckCircle2 size={20} />
            </span>
            <div className="text-[13px] font-medium">
              Document {mode === "edit" ? "saved" : "deleted"}
            </div>
            <div className="max-w-md text-[11px] wb-muted">{receipt}</div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)] overflow-hidden text-[11px]">
            <aside className="min-h-0 overflow-auto border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.55)] p-3">
              <div className="mb-3 flex items-start gap-2">
                <Fingerprint size={13} className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]" />
                <div className="min-w-0">
                  <div className="font-medium">Document identity</div>
                  <div className="mt-1 break-all font-mono text-[9px] wb-muted">
                    {formatIdentity(sourceId)}
                  </div>
                </div>
              </div>
              <div className="border-t border-[hsl(var(--wb-border-subtle))] pt-3">
                <div className="mb-2 flex items-center gap-1.5 font-medium">
                  {mode === "edit" ? <FileDiff size={12} /> : <ShieldAlert size={12} />}
                  {mode === "edit" ? "Field ledger" : "Deletion scope"}
                </div>
                {isLoading ? (
                  <div className="flex items-center gap-2 wb-muted">
                    <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" />
                    Reading source…
                  </div>
                ) : mode === "edit" && editPlan ? (
                  editPlan.editedFields.length === 0 ? (
                    <div className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] px-2 py-2 leading-5 wb-muted">
                      No fields changed.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {editPlan.editedFields.map((field) => (
                        <div key={field} className="flex items-center gap-2 rounded-[4px] border border-[hsl(var(--wb-accent)/0.25)] bg-[hsl(var(--wb-accent)/0.06)] px-2 py-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--wb-accent))]" />
                          <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{field}</span>
                          <span className="text-[9px] wb-muted">changed</span>
                        </div>
                      ))}
                    </div>
                  )
                ) : mode === "delete" && deletePlan ? (
                  <div className="rounded-[4px] border border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.06)] px-2 py-2 leading-5">
                    Exactly one document will be permanently deleted.
                  </div>
                ) : (
                  <div className="leading-5 wb-muted">
                    {error ? "Reload the source before continuing." : "Review the current source."}
                  </div>
                )}
              </div>
              {activePlan && (
                <div className="mt-3 border-t border-[hsl(var(--wb-border-subtle))] pt-3">
                  <div className="flex items-start gap-2 leading-5 wb-muted">
                    <ShieldCheck size={13} className="mt-0.5 shrink-0" />
                    <span>Fingerprint {activePlan.sourceDigest.slice(0, 10)}… is matched atomically.</span>
                  </div>
                </div>
              )}
            </aside>

            <section className="flex min-h-0 min-w-0 flex-col p-3">
              {mode === "edit" ? (
                <>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <label htmlFor="mongodb-edit-draft" className="font-medium">Document fields</label>
                    <span className="text-[9px] wb-muted">Canonical Extended JSON</span>
                  </div>
                  <textarea
                    id="mongodb-edit-draft"
                    aria-label="MongoDB document fields"
                    className={cn(
                      "min-h-[360px] min-w-0 flex-1 resize-none rounded-[5px] border bg-[hsl(var(--wb-editor))] p-3 font-mono text-[11px] leading-5 text-[hsl(var(--wb-text))] outline-none",
                      error ? "border-[hsl(var(--destructive)/0.65)]" : "border-[hsl(var(--wb-border))] focus:border-[hsl(var(--wb-accent)/0.7)]",
                    )}
                    value={draftText}
                    disabled={busy}
                    spellCheck={false}
                    onChange={(event) => {
                      setDraftText(event.target.value);
                      setEditPlan(null);
                      setReceipt(null);
                      setError(null);
                    }}
                  />
                  <div className="mt-2 leading-5 wb-muted">Untouched fields keep their original BSON type. Removing a key removes that field.</div>
                </>
              ) : (
                <>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="font-medium">Document scheduled for deletion</span>
                    <span className="text-[9px] wb-muted">Read-only source</span>
                  </div>
                  <pre className="min-h-[300px] min-w-0 flex-1 overflow-auto rounded-[5px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-3 font-mono text-[10px] leading-5">
                    {sourceDocument ? JSON.stringify(sourceDocument, null, 2) : "Reading source…"}
                  </pre>
                  {deletePlan && (
                    <label className="mt-3 block">
                      <span className="mb-1.5 block text-[10px] wb-muted">Type <code className="text-[hsl(var(--wb-text))]">{deletePlan.confirmationPhrase}</code> to confirm</span>
                      <input
                        aria-label="Delete confirmation phrase"
                        className="h-8 w-full rounded-[4px] border border-[hsl(var(--destructive)/0.4)] bg-[hsl(var(--wb-editor))] px-2.5 font-mono text-[11px] outline-none focus:border-[hsl(var(--destructive)/0.75)]"
                        value={confirmation}
                        disabled={busy}
                        autoComplete="off"
                        onChange={(event) => setConfirmation(event.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
              {error && <div role="alert" className="mt-2 rounded-[4px] border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.08)] px-2.5 py-2 text-[10px] leading-4 text-[hsl(var(--destructive))]">{error}</div>}
            </section>
          </div>
        )}

        <DialogFooter className="shrink-0 border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3 sm:justify-between">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            {receipt ? "Close" : "Cancel"}
          </Button>
          {!receipt && (
            <div className="flex items-center gap-2">
              {mode === "edit" && (
                <Button variant="outline" size="sm" disabled={busy || !draftText.trim()} onClick={() => void reviewEdit()}>
                  {isReviewing ? <RefreshCw size={12} className="mr-1.5 animate-spin motion-reduce:animate-none" /> : <FileDiff size={12} className="mr-1.5" />}
                  Review changes
                </Button>
              )}
              <Button
                size="sm"
                variant={mode === "delete" ? "destructive" : "default"}
                disabled={busy || !canExecute}
                onClick={() => void execute()}
              >
                {isExecuting ? <RefreshCw size={12} className="mr-1.5 animate-spin motion-reduce:animate-none" /> : mode === "edit" ? <Pencil size={12} className="mr-1.5" /> : <Trash2 size={12} className="mr-1.5" />}
                {mode === "edit" ? "Save document" : "Delete document"}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
