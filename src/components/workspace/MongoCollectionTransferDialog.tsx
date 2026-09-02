import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Check, Loader2, ShieldAlert } from "lucide-react";
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
  MongoCollectionTransferMode,
  MongoCollectionTransferPlan,
  MongoCollectionTransferRequest,
} from "@/services/tauri/types";
import { ensureConnectionReady, type ConnectionConfig } from "@/store/useConnectionStore";

interface MongoCollectionTransferDialogProps {
  open: boolean;
  sourceConnectionId: string;
  sourceConnectionName: string;
  sourceDatabase: string;
  sourceCollection: string;
  connections: ConnectionConfig[];
  onClose: () => void;
  onTransferred: (targetConnectionId: string) => void;
}

const fieldClass =
  "h-8 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[11px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))]";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function targetWarning(connection: ConnectionConfig | undefined) {
  if (!connection) return null;
  if (connection.environment === "production") {
    return "Target is classified as production. Review the migration scope and confirmation phrase carefully.";
  }
  if (!connection.environment || connection.environment === "unclassified") {
    return "Target environment is unclassified. Verify that this is the intended MongoDB target.";
  }
  return null;
}

/** A deliberately compact migration review surface: the source is fixed by
 * the Explorer selection while all target and destructive choices remain
 * visible together before a server-side plan token is issued. */
export function MongoCollectionTransferDialog({
  open,
  sourceConnectionId,
  sourceConnectionName,
  sourceDatabase,
  sourceCollection,
  connections,
  onClose,
  onTransferred,
}: MongoCollectionTransferDialogProps) {
  const candidates = useMemo(
    () => connections.filter((connection) => connection.driver.toLowerCase() === "mongodb"),
    [connections],
  );
  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [targetDatabase, setTargetDatabase] = useState(sourceDatabase);
  const [targetCollection, setTargetCollection] = useState(sourceCollection);
  const [mode, setMode] = useState<MongoCollectionTransferMode>("append");
  const [plan, setPlan] = useState<MongoCollectionTransferPlan | null>(null);
  const [phrase, setPhrase] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const target = candidates.find((candidate) => candidate.id !== sourceConnectionId) ?? candidates[0];
    setTargetConnectionId(target?.id || "");
    setTargetDatabase(sourceDatabase);
    setTargetCollection(sourceCollection);
    setMode("append");
    setPlan(null);
    setPhrase("");
    setStatus(null);
  }, [candidates, open, sourceCollection, sourceConnectionId, sourceDatabase]);

  const target = candidates.find((candidate) => candidate.id === targetConnectionId);
  const warning = targetWarning(target);
  const request = useMemo<MongoCollectionTransferRequest>(
    () => ({
      sourceConnectionId,
      sourceDatabase,
      sourceCollection,
      targetConnectionId,
      targetDatabase,
      targetCollection,
      mode,
    }),
    [mode, sourceCollection, sourceConnectionId, sourceDatabase, targetCollection, targetConnectionId, targetDatabase],
  );
  const requestValid = Boolean(target && targetDatabase.trim() && targetCollection.trim());
  const busy = isPlanning || isExecuting;

  const invalidatePlan = () => {
    setPlan(null);
    setPhrase("");
    setStatus(null);
  };

  const review = async () => {
    if (!requestValid || !target) return;
    invalidatePlan();
    setIsPlanning(true);
    try {
      const [sourceReadiness, targetReadiness] = await Promise.all([
        ensureConnectionReady(sourceConnectionId),
        ensureConnectionReady(target.id),
      ]);
      for (const readiness of [sourceReadiness, targetReadiness]) {
        if (readiness.status !== "ready") {
          throw new Error(readiness.status === "error" ? readiness.message : "A migration connection changed while opening.");
        }
      }
      setPlan(await schemaService.previewMongoCollectionTransfer(request));
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setIsPlanning(false);
    }
  };

  const execute = async () => {
    if (!plan) return;
    setStatus(null);
    setIsExecuting(true);
    try {
      const receipt = await schemaService.executeMongoCollectionTransfer(
        request,
        plan.confirmationToken,
        phrase,
      );
      onTransferred(targetConnectionId);
      setStatus(receipt.message);
      setPlan(null);
      setPhrase("");
    } catch (error) {
      setPlan(null);
      setStatus(errorMessage(error));
    } finally {
      setIsExecuting(false);
    }
  };

  const complete = status?.startsWith("Transferred ");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-xl border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <ArrowRightLeft size={16} className="text-[hsl(var(--wb-accent))]" />
            Transfer MongoDB collection
          </DialogTitle>
          <DialogDescription className="text-[11px] wb-muted">
            Native BSON transfer preserves ObjectId, Date, Decimal128 and binary values.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <div className="rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.55)] px-3 py-2 text-[11px]">
            <div className="wb-muted">Source · {sourceConnectionName}</div>
            <div className="mt-1 font-mono text-[hsl(var(--wb-text))]">{sourceDatabase}.{sourceCollection}</div>
          </div>
          <label className="block space-y-1"><span className="text-[11px] wb-muted">Target MongoDB connection</span>
            <select className={fieldClass} value={targetConnectionId} onChange={(event) => { setTargetConnectionId(event.target.value); invalidatePlan(); }} disabled={busy}>
              <option value="">Select a MongoDB connection…</option>
              {candidates.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1"><span className="text-[11px] wb-muted">Target database</span><input className={fieldClass} value={targetDatabase} onChange={(event) => { setTargetDatabase(event.target.value); invalidatePlan(); }} disabled={busy} /></label>
            <label className="block space-y-1"><span className="text-[11px] wb-muted">Target collection</span><input className={fieldClass} value={targetCollection} onChange={(event) => { setTargetCollection(event.target.value); invalidatePlan(); }} disabled={busy} /></label>
          </div>
          <label className="block space-y-1"><span className="text-[11px] wb-muted">Copy mode</span>
            <select className={fieldClass} value={mode} onChange={(event) => { setMode(event.target.value as MongoCollectionTransferMode); invalidatePlan(); }} disabled={busy}>
              <option value="append">Append documents</option>
              <option value="overwrite">Overwrite target collection</option>
            </select>
          </label>
          {warning && <div className="flex gap-2 rounded-[5px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300"><ShieldAlert size={14} className="mt-0.5 shrink-0" /><span>{warning}</span></div>}
          {plan && <div className="space-y-2 rounded-[5px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor)/0.45)] p-3 text-[11px]">
            <div className="flex items-center gap-2 font-medium"><Check size={14} className="text-emerald-500" /> Reviewed migration plan</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 wb-muted"><span>Source: {plan.sourceDocumentCount.toLocaleString()} docs</span><span>Target: {plan.targetDocumentCount.toLocaleString()} docs</span><span>Batch size: {plan.batchSize}</span><span>BSON type preservation: enabled</span></div>
            {!plan.isSnapshotConsistent && <div className="text-amber-700 dark:text-amber-300">Source is read in stable batches, not a shared cross-connection snapshot. Re-review if the collection changes.</div>}
            {plan.confirmationPhrase && <label className="block space-y-1"><span className="wb-muted">Type <code className="text-[hsl(var(--wb-text))]">{plan.confirmationPhrase}</code> to confirm</span><input className={fieldClass} value={phrase} onChange={(event) => setPhrase(event.target.value)} disabled={busy} /></label>}
          </div>}
          {status && <div className={cn("flex gap-2 rounded-[5px] px-3 py-2 text-[11px]", complete ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>{complete ? <Check size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}<span>{status}</span></div>}
        </div>
        <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] px-5 py-3"><Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>{plan ? <Button onClick={() => void execute()} disabled={busy || Boolean(plan.confirmationPhrase && phrase !== plan.confirmationPhrase)}>{isExecuting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}Apply migration</Button> : <Button onClick={() => void review()} disabled={busy || !requestValid}>{isPlanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}Review migration</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
