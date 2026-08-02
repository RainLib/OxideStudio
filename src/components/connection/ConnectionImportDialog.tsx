import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, FileUp, Loader2 } from "lucide-react";
import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { databaseService } from "@/services/tauri";
import type { ConnectionConfig } from "@/store/useConnectionStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { defaultConnectionIcon } from "@/lib/databaseDialect";
import type {
  ConnectionImportCandidate,
  ConnectionImportParseResult,
} from "@/features/connection-import";

interface ConnectionImportDialogProps {
  open: boolean;
  fileName: string;
  result: ConnectionImportParseResult | null;
  onClose: () => void;
  onImported: () => void;
}

function newConnectionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function uniqueName(name: string, existingNames: Set<string>) {
  const base = name.trim() || "Imported connection";
  if (!existingNames.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (existingNames.has(`${base} (${suffix})`.toLocaleLowerCase())) suffix += 1;
  return `${base} (${suffix})`;
}

function asConnection(candidate: ConnectionImportCandidate, name: string): ConnectionConfig {
  if (!candidate.driver) throw new Error("A recognized driver is required.");
  return {
    id: newConnectionId(),
    name,
    driver: candidate.driver,
    url: "",
    host: candidate.host,
    port: candidate.port,
    user: candidate.user || "",
    // External passwords are never parsed or persisted by connection import.
    password: "",
    database: candidate.database || "",
    connectionUrl: candidate.connectionUrl || "",
    icon: defaultConnectionIcon(candidate.driver),
    tags: ["imported", candidate.source],
  };
}

export function ConnectionImportDialog({
  open,
  fileName,
  result,
  onClose,
  onImported,
}: ConnectionImportDialogProps) {
  const connections = useConnectionStore((state) => state.connections);
  const importConnections = useConnectionStore((state) => state.importConnections);
  const [availableDrivers, setAvailableDrivers] = useState<Set<string> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);
    void databaseService
      .listDatabaseDriverInstallations()
      .then((installations) => {
        if (!active) return;
        const drivers = new Set(
          installations
            .filter(
              (installation) =>
                installation.distribution === "bundled" ||
                (installation.status === "ready" && installation.active === true),
            )
            .map((installation) => installation.driver.toLocaleLowerCase()),
        );
        setAvailableDrivers(drivers);
        setSelectedIds(
          new Set(
            (result?.candidates || [])
              .filter(
                (candidate) =>
                  candidate.driver && drivers.has(candidate.driver.toLocaleLowerCase()),
              )
              .map((candidate) => candidate.id),
          ),
        );
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [open, result]);

  const candidates = result?.candidates || [];
  const importable = useMemo(
    () =>
      candidates.filter(
        (candidate) =>
          candidate.driver &&
          availableDrivers?.has(candidate.driver.toLocaleLowerCase()),
      ),
    [availableDrivers, candidates],
  );
  const selectableCount = importable.filter((candidate) => selectedIds.has(candidate.id)).length;

  const toggleCandidate = (candidate: ConnectionImportCandidate, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(candidate.id);
      else next.delete(candidate.id);
      return next;
    });
  };

  const saveSelected = async () => {
    const selected = importable.filter((candidate) => selectedIds.has(candidate.id));
    if (!selected.length) return;
    setIsSaving(true);
    setError(null);
    try {
      const existingNames = new Set(connections.map((connection) => connection.name.toLocaleLowerCase()));
      const imported: ConnectionConfig[] = [];
      for (const candidate of selected) {
        const name = uniqueName(candidate.name, existingNames);
        existingNames.add(name.toLocaleLowerCase());
        imported.push(asConnection(candidate, name));
      }
      await importConnections(imported);
      onImported();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !isSaving && onClose()}>
      <DialogContent className="grid h-[min(680px,calc(100vh-32px))] w-[min(840px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]"><FileUp size={15} /></span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-[13px]">Import connection configurations</DialogTitle>
              <DialogDescription className="truncate text-[10px] text-[hsl(var(--wb-text-muted))]">{fileName} · {candidates.length} discovered connection{candidates.length === 1 ? "" : "s"}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <main className="min-h-0 overflow-auto bg-[hsl(var(--wb-editor))]">
          <section className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-[10px] text-amber-100">
            <div className="flex items-center gap-1.5 font-medium"><AlertTriangle size={13} /> Passwords, tokens, SSH keys, and local driver paths are never imported.</div>
            <p className="mt-1 text-amber-100/75">Imported entries are saved only. They are not connected or tested automatically; open each entry to enter credentials and verify it.</p>
          </section>
          {error && <p role="alert" className="border-b border-red-500/25 bg-red-500/10 px-4 py-2 text-[10px] text-red-200">{error}</p>}
          {(result?.diagnostics || []).map((diagnostic) => <p key={diagnostic} className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-2 text-[10px] wb-muted">{diagnostic}</p>)}
          <div className="divide-y divide-[hsl(var(--wb-border-subtle))]">
            {candidates.map((candidate) => {
              const available = Boolean(candidate.driver && availableDrivers?.has(candidate.driver.toLocaleLowerCase()));
              return (
                <label key={candidate.id} className="flex min-h-12 cursor-pointer items-center gap-2.5 px-4 py-2 hover:bg-[hsl(var(--wb-hover))]">
                  <Checkbox checked={selectedIds.has(candidate.id)} disabled={!available || isSaving} onCheckedChange={(checked) => toggleCandidate(candidate, checked === true)} aria-label={`Import ${candidate.name}`} />
                  <DatabaseBrandIcon driver={candidate.driver || "generic"} size={15} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium">{candidate.name}</span>
                    <span className="block truncate font-mono text-[10px] wb-muted">{[candidate.host, candidate.port, candidate.database].filter(Boolean).join(" : ") || candidate.connectionUrl || "No endpoint detected"}</span>
                  </span>
                  <span className={available ? "text-[10px] text-[hsl(var(--wb-accent))]" : "text-[10px] text-amber-300"}>{available ? candidate.driver : candidate.driver ? "Driver package required" : "Unknown driver"}</span>
                </label>
              );
            })}
          </div>
        </main>

        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 sm:justify-between sm:space-x-0">
          <span className="text-[10px] wb-muted">{availableDrivers === null ? "Checking installed drivers…" : `${selectableCount} selected`}</span>
          <div className="flex gap-2">
            <button type="button" className="wb-text-button h-7 px-3 text-[11px]" disabled={isSaving} onClick={onClose}>Cancel</button>
            <button type="button" className="wb-primary-button h-7 min-w-[106px] justify-center px-3 text-[11px]" disabled={isSaving || availableDrivers === null || selectableCount === 0} onClick={() => void saveSelected}>{isSaving ? <Loader2 size={12} className="animate-spin" /> : <><Check size={12} /> Import</>}</button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
