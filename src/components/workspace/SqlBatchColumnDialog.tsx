import { useEffect, useMemo, useState } from "react";
import { Columns3, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  SqlBatchColumnCandidate,
  SqlBatchColumnMode,
} from "@/features/query-editor/model/sqlBatchColumnSelection";

export type SqlBatchColumnDialogSession = {
  id: string;
  mode: SqlBatchColumnMode;
  candidates: SqlBatchColumnCandidate[];
};

export function SqlBatchColumnDialog({
  session,
  onClose,
  onApply,
}: {
  session: SqlBatchColumnDialogSession | null;
  onClose: () => void;
  onApply: (candidateKeys: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setQuery("");
    setSelected(new Set());
  }, [session?.id]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return session?.candidates || [];
    return (session?.candidates || []).filter((candidate) =>
      `${candidate.label} ${candidate.detail || ""}`.toLocaleLowerCase().includes(normalized),
    );
  }, [query, session]);

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Dialog open={Boolean(session)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[520px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
          <div className="flex items-center gap-2">
            <Columns3 size={15} className="text-[hsl(var(--wb-accent))]" />
            <div>
              <DialogTitle className="text-[13px]">Choose columns</DialogTitle>
              <DialogDescription className="text-[10px] wb-muted">
                {session?.mode === "insert"
                  ? "Build the column list and matching VALUES placeholders."
                  : "Insert selected columns in metadata order."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="border-b border-[hsl(var(--wb-border-subtle))] p-3">
          <label className="flex h-8 items-center gap-2 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2.5 focus-within:border-[hsl(var(--wb-accent))]">
            <Search size={12} className="wb-muted" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter columns"
              className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-[hsl(var(--wb-text-muted))]"
            />
            <span className="text-[9px] tabular-nums wb-muted">{selected.size} selected</span>
          </label>
        </div>
        <div className="max-h-[340px] overflow-y-auto p-2">
          {visible.map((candidate) => (
            <label key={candidate.key} className="flex min-h-8 cursor-default items-center gap-2 rounded-[4px] px-2 hover:bg-[hsl(var(--wb-active))] focus-within:bg-[hsl(var(--wb-active-strong))]">
              <input
                type="checkbox"
                checked={selected.has(candidate.key)}
                onChange={() => toggle(candidate.key)}
                className="h-3.5 w-3.5 accent-[hsl(var(--wb-accent))]"
              />
              <code className="min-w-0 flex-1 truncate text-[11px]">{candidate.label}</code>
              {candidate.detail ? <span className="max-w-[44%] truncate text-[9px] wb-muted">{candidate.detail}</span> : null}
            </label>
          ))}
        </div>
        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] px-3 py-2 sm:space-x-0">
          <button type="button" className="wb-text-button h-7 px-2 text-[10px]" onClick={() => setSelected((current) => new Set([...current, ...visible.map((candidate) => candidate.key)]))}>
            Select visible
          </button>
          <div className="flex gap-2">
            <button type="button" className="wb-text-button h-7 px-3 text-[10px]" onClick={onClose}>Cancel</button>
            <button type="button" className="wb-primary-button h-7 px-3 text-[10px]" disabled={selected.size === 0} onClick={() => onApply([...selected])}>
              Insert {selected.size || "selected"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
