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
import {
  nacosService,
  type NacosConfigTransferPlan,
  type NacosConfigTransferRequest,
} from "@/services/tauri";
import { ensureConnectionReady, type ConnectionConfig } from "@/store/useConnectionStore";
import { cn } from "@/lib/utils";
import type { NacosConfigLocation } from "@/services/tauri/types";

interface NacosConfigTransferDialogProps {
  open: boolean;
  sourceConnectionId: string;
  sourceConnectionName: string;
  source: NacosConfigLocation;
  connections: ConnectionConfig[];
  onClose: () => void;
  onTransferred: (targetConnectionId: string) => void;
}

const fieldClass =
  "h-8 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[11px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))]";

function targetCandidates(connections: ConnectionConfig[]) {
  return connections.filter((connection) => connection.driver.toLowerCase() === "nacos");
}

function targetEnvironmentWarning(connection: ConnectionConfig | undefined) {
  if (!connection) return null;
  if (connection.environment === "production") return "Target is classified as production. Review this copy carefully.";
  if (!connection.environment || connection.environment === "unclassified") {
    return "Target environment is unclassified. Confirm this is the intended Nacos server.";
  }
  return null;
}

export function NacosConfigTransferDialog({
  open,
  sourceConnectionId,
  sourceConnectionName,
  source,
  connections,
  onClose,
  onTransferred,
}: NacosConfigTransferDialogProps) {
  const candidates = useMemo(() => targetCandidates(connections), [connections]);
  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [dataId, setDataId] = useState(source.dataId);
  const [group, setGroup] = useState(source.group);
  const [tenant, setTenant] = useState(source.tenant || "");
  const [policy, setPolicy] = useState<"abort" | "skip" | "overwrite">("abort");
  const [plan, setPlan] = useState<NacosConfigTransferPlan | null>(null);
  const [phrase, setPhrase] = useState("");
  const [isPlanning, setIsPlanning] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const defaultTarget = candidates.find((connection) => connection.id !== sourceConnectionId) ?? candidates[0];
    setTargetConnectionId(defaultTarget?.id || "");
    setDataId(source.dataId);
    setGroup(source.group);
    setTenant(source.tenant || "");
    setPolicy("abort");
    setPlan(null);
    setPhrase("");
    setError(null);
  }, [open, source, sourceConnectionId, candidates]);

  const target = candidates.find((connection) => connection.id === targetConnectionId);
  const targetWarning = targetEnvironmentWarning(target);
  const request: NacosConfigTransferRequest = {
    sourceConnectionId,
    targetConnectionId,
    items: [{ source, target: { dataId, group, tenant } }],
    conflictPolicy: policy,
  };
  const requestValid = Boolean(targetConnectionId && dataId.trim() && group.trim());

  const preview = async () => {
    if (!requestValid || !target) return;
    setError(null);
    setPlan(null);
    setIsPlanning(true);
    try {
      const readiness = await ensureConnectionReady(target.id);
      if (readiness.status !== "ready") {
        throw new Error(
          readiness.status === "error"
            ? readiness.message
            : "The selected Nacos connection changed while it was opening.",
        );
      }
      setPlan(await nacosService.previewConfigTransfer(request));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsPlanning(false);
    }
  };

  const execute = async () => {
    if (!plan) return;
    setError(null);
    setIsExecuting(true);
    try {
      const receipt = await nacosService.executeConfigTransfer({
        ...request,
        confirmationToken: plan.confirmationToken,
        confirmationPhrase: phrase,
      });
      onTransferred(targetConnectionId);
      setPlan(null);
      setPhrase("");
      setError(
        `Migration completed: ${receipt.created} created, ${receipt.overwritten} overwritten, ${receipt.skipped} skipped.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft size={17} className="text-[hsl(var(--wb-accent))]" />
            Transfer Nacos configuration
          </DialogTitle>
          <DialogDescription>
            Copies one full configuration through Nacos’ native API. The query editor remains read-only for Nacos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-surface-raised))] px-3 py-2 text-[11px]">
            <div className="wb-muted">Source · {sourceConnectionName}</div>
            <div className="mt-0.5 break-all font-mono text-[hsl(var(--wb-text))]">
              {source.dataId} · {source.group}{source.tenant ? ` · ${source.tenant}` : ""}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] wb-muted">Target Nacos connection</span>
            <select
              className={fieldClass}
              value={targetConnectionId}
              onChange={(event) => { setTargetConnectionId(event.target.value); setPlan(null); setPhrase(""); }}
            >
              <option value="">Select a Nacos connection…</option>
              {candidates.map((connection) => (
                <option key={connection.id} value={connection.id}>{connection.name}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-[11px] wb-muted">Target data ID</span>
              <input className={fieldClass} value={dataId} onChange={(event) => { setDataId(event.target.value); setPlan(null); }} />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] wb-muted">Target group</span>
              <input className={fieldClass} value={group} onChange={(event) => { setGroup(event.target.value); setPlan(null); }} />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] wb-muted">Target tenant / namespace</span>
            <input className={fieldClass} value={tenant} onChange={(event) => { setTenant(event.target.value); setPlan(null); }} />
          </label>

          {targetWarning && (
            <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              <span>{targetWarning}</span>
            </div>
          )}

          {plan && (
            <div className="space-y-2 rounded-md border border-[hsl(var(--wb-border))] p-3 text-[11px]">
              <div className="flex items-center gap-2 font-medium text-[hsl(var(--wb-text))]">
                <Check size={14} className="text-emerald-500" /> Reviewed migration plan
              </div>
              <div className="wb-muted">{plan.creates} create · {plan.conflicts} conflict</div>
              {plan.conflicts > 0 && (
                <label className="block space-y-1">
                  <span className="text-[11px] wb-muted">Conflict handling</span>
                  <select className={fieldClass} value={policy} onChange={(event) => { setPolicy(event.target.value as typeof policy); setPlan(null); setPhrase(""); }}>
                    <option value="abort">Abort if target exists</option>
                    <option value="skip">Skip existing target</option>
                    <option value="overwrite">Overwrite existing target</option>
                  </select>
                </label>
              )}
              {plan.confirmationPhrase && policy === "overwrite" && (
                <label className="block space-y-1">
                  <span className="text-[11px] wb-muted">Type <span className="font-mono text-[hsl(var(--wb-text))]">{plan.confirmationPhrase}</span> to confirm</span>
                  <input className={fieldClass} value={phrase} onChange={(event) => setPhrase(event.target.value)} />
                </label>
              )}
            </div>
          )}

          {error && (
            <div className={cn("flex gap-2 rounded-md px-3 py-2 text-[11px]", error.startsWith("Migration completed") ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>
              {error.startsWith("Migration completed") ? <Check size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPlanning || isExecuting}>Cancel</Button>
          {plan ? (
            <Button
              onClick={() => void execute()}
              disabled={isExecuting || Boolean(plan.confirmationPhrase && (policy !== "overwrite" || phrase !== plan.confirmationPhrase))}
            >
              {isExecuting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
              Apply migration
            </Button>
          ) : (
            <Button onClick={() => void preview()} disabled={!requestValid || isPlanning}>
              {isPlanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
              Review migration
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
