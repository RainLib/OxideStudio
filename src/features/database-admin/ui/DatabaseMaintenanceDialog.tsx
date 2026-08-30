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
  databaseAdminErrorPresentation,
  type DatabaseAdminErrorPresentation,
} from "@/features/database-admin/model/databaseAdminErrors";
import {
  databaseMaintenanceOptions,
  defaultDatabaseMaintenanceOperation,
} from "@/features/database-admin/model/databaseMaintenance";
import { cn } from "@/lib/utils";
import { databaseService } from "@/services/tauri";
import type {
  DatabaseDriver,
  DatabaseMaintenanceOperation,
  DatabaseMaintenancePlan,
} from "@/services/tauri/types";
import { AlertTriangle, CheckCircle2, RefreshCw, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface DatabaseMaintenanceTarget {
  connectionId: string;
  connectionName?: string;
  driver: DatabaseDriver;
  database?: string;
  schema: string;
  table: string;
}

interface DatabaseMaintenanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: DatabaseMaintenanceTarget;
}

export function DatabaseMaintenanceDialog({
  open,
  onOpenChange,
  target,
}: DatabaseMaintenanceDialogProps) {
  const options = useMemo(
    () => databaseMaintenanceOptions(target.driver),
    [target.driver],
  );
  const [operation, setOperation] = useState<DatabaseMaintenanceOperation>(() =>
    defaultDatabaseMaintenanceOperation(target.driver),
  );
  const [plan, setPlan] = useState<DatabaseMaintenancePlan | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<DatabaseAdminErrorPresentation | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const previewGenerationRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const generation = previewGenerationRef.current + 1;
    previewGenerationRef.current = generation;
    setIsPreviewing(true);
    setPlan(null);
    setConfirmation("");
    setResult(null);
    setError(null);
    void databaseService
      .previewDatabaseMaintenance(target.connectionId, target.driver, {
        database: target.database,
        schema: target.schema,
        table: target.table,
        operation,
      })
      .then((nextPlan) => {
        if (previewGenerationRef.current === generation) setPlan(nextPlan);
      })
      .catch((reason) => {
        if (previewGenerationRef.current === generation) {
          setError(databaseAdminErrorPresentation(reason));
        }
      })
      .finally(() => {
        if (previewGenerationRef.current === generation) setIsPreviewing(false);
      });
    return () => {
      previewGenerationRef.current += 1;
    };
  }, [open, operation, previewVersion, target]);

  const execute = async () => {
    if (!plan || confirmation !== plan.confirmationText) return;
    setIsExecuting(true);
    setError(null);
    setResult(null);
    try {
      const message = await databaseService.executeDatabaseMaintenance(
        target.connectionId,
        target.driver,
        {
          maintenance: {
            database: target.database,
            schema: target.schema,
            table: target.table,
            operation,
          },
          confirmationToken: plan.confirmationToken,
          confirmationText: confirmation,
        },
      );
      setResult(message);
    } catch (reason) {
      setError(databaseAdminErrorPresentation(reason));
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isExecuting) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-[620px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[13px]">
            <Wrench size={14} /> Maintain table
          </DialogTitle>
          <DialogDescription className="text-[11px] wb-muted">
            {target.connectionName ? `${target.connectionName} · ` : ""}
            {[target.database, target.schema, target.table].filter(Boolean).join(".")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-4 py-4 text-[11px]">
          <label className="grid gap-1.5">
            <span className="font-medium">Operation</span>
            <select
              className="wb-input h-8"
              value={operation}
              onChange={(event) =>
                setOperation(event.target.value as DatabaseMaintenanceOperation)
              }
              disabled={isExecuting}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.description}
                </option>
              ))}
            </select>
          </label>

          {isPreviewing ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] px-3 py-3 wb-muted"
            >
              <RefreshCw size={13} className="animate-spin" /> Reviewing live target and server capability…
            </div>
          ) : plan ? (
            <div
              className={cn(
                "space-y-2 rounded-[4px] border px-3 py-3",
                plan.risk === "high"
                  ? "border-amber-500/40 bg-amber-500/10"
                  : "border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))]",
              )}
            >
              <div className="flex items-start gap-2">
                {plan.risk === "high" ? (
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />
                ) : (
                  <Wrench size={14} className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]" />
                )}
                <div className="min-w-0">
                  <div className="font-medium">{plan.summary}</div>
                  <div className="mt-1 leading-5 wb-muted">{plan.lockImpact}</div>
                  {plan.requiresMaintenanceWindow && (
                    <div className="mt-1 font-medium text-amber-300">
                      A maintenance window is recommended.
                    </div>
                  )}
                </div>
              </div>
              <pre className="overflow-auto rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2 py-1.5 font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">
                {plan.sqlPreview}
              </pre>
              <div className="grid gap-1.5">
                <span>
                  Type <code className="font-mono text-[hsl(var(--wb-text))]">{plan.confirmationText}</code> to confirm:
                </span>
                <input
                  aria-label="Maintenance confirmation text"
                  className="wb-input h-8 font-mono"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isExecuting || Boolean(result)}
                />
              </div>
            </div>
          ) : null}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[4px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{error.title}</div>
                <div className="mt-0.5 text-red-200/80">{error.message}</div>
                {error.guidance && <div className="mt-0.5 text-red-200/70">{error.guidance}</div>}
              </div>
              {error.retryable && (
                <button
                  type="button"
                  className="wb-toolbar-button h-6 shrink-0 px-2 text-[10px]"
                  onClick={() => setPreviewVersion((current) => current + 1)}
                  disabled={isExecuting}
                >
                  Review again
                </button>
              )}
            </div>
          )}
          {result && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded-[4px] border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-200"
            >
              <CheckCircle2 size={13} /> {result}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3 sm:space-x-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isExecuting}
            onClick={() => onOpenChange(false)}
          >
            {result ? "Done" : "Cancel"}
          </Button>
          {!result && (
            <Button
              type="button"
              variant={plan?.risk === "high" ? "destructive" : "default"}
              size="sm"
              disabled={
                !plan ||
                isPreviewing ||
                isExecuting ||
                confirmation !== plan.confirmationText
              }
              onClick={() => void execute()}
            >
              {isExecuting ? "Running maintenance…" : "Run maintenance"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
