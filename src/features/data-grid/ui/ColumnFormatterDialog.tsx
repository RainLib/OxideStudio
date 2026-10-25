import { useEffect, useMemo, useState } from "react";
import { Braces, CalendarClock, EyeOff, WandSparkles } from "lucide-react";
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
import {
  DATA_GRID_DATE_TIME_PATTERNS,
  applyColumnFormatter,
  normalizeColumnFormatter,
  type ColumnFormatterConfig,
} from "../model/columnFormatter";

type FormatterKind = ColumnFormatterConfig["kind"];

interface ColumnFormatterDialogProps {
  open: boolean;
  columnName: string;
  sampleValue: unknown;
  formatter?: ColumnFormatterConfig;
  onOpenChange: (open: boolean) => void;
  onSave: (formatter: ColumnFormatterConfig) => void;
  onClear: () => void;
}

const DEFAULTS: Record<FormatterKind, ColumnFormatterConfig> = {
  datetime: {
    kind: "datetime",
    unit: "auto",
    pattern: "YYYY-MM-DD HH:mm:ss",
    timezone: undefined,
  },
  "json-path": { kind: "json-path", path: "$" },
  mask: { kind: "mask", prefix: 2, suffix: 2 },
  "custom-template": { kind: "custom-template", template: "${value}" },
};

const KINDS = [
  { value: "datetime", label: "Date and time", icon: CalendarClock },
  { value: "json-path", label: "JSON path", icon: Braces },
  { value: "mask", label: "Mask sensitive text", icon: EyeOff },
  { value: "custom-template", label: "Text template", icon: WandSparkles },
] as const;

export function ColumnFormatterDialog({
  open,
  columnName,
  sampleValue,
  formatter,
  onOpenChange,
  onSave,
  onClear,
}: ColumnFormatterDialogProps) {
  const [draft, setDraft] = useState<ColumnFormatterConfig>(
    formatter || DEFAULTS.datetime,
  );
  useEffect(() => {
    if (open) setDraft(formatter || DEFAULTS.datetime);
  }, [formatter, open]);

  const normalized = useMemo(() => normalizeColumnFormatter(draft), [draft]);
  const preview = normalized
    ? applyColumnFormatter(sampleValue, normalized)
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="custom" className="max-w-xl overflow-hidden p-0">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-5 py-4">
          <DialogTitle className="text-base">Format {columnName}</DialogTitle>
          <DialogDescription>
            Change how this physical column is displayed. The stored database value is never modified.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 px-5 py-4 sm:grid-cols-[176px_1fr]">
          <div className="space-y-1" role="radiogroup" aria-label="Formatter type">
            {KINDS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={draft.kind === value}
                onClick={() => setDraft(DEFAULTS[value])}
                className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                  draft.kind === value
                    ? "border-[hsl(var(--wb-accent))] bg-[hsl(var(--wb-accent)/0.12)] text-[hsl(var(--wb-text))]"
                    : "border-transparent text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]"
                }`}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>

          <div className="min-w-0 space-y-3">
            {draft.kind === "datetime" && (
              <>
                <label className="block text-xs">
                  <span className="mb-1 block text-[hsl(var(--wb-text-muted))]">Pattern</span>
                  <select
                    value={draft.pattern}
                    onChange={(event) => setDraft({ ...draft, pattern: event.target.value })}
                    className="h-9 w-full rounded-md border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-surface))] px-2 text-xs outline-none focus:border-[hsl(var(--wb-accent))]"
                  >
                    {DATA_GRID_DATE_TIME_PATTERNS.map((pattern) => (
                      <option key={pattern} value={pattern}>{pattern}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs">
                    <span className="mb-1 block text-[hsl(var(--wb-text-muted))]">Numeric unit</span>
                    <select
                      value={draft.unit}
                      onChange={(event) => setDraft({ ...draft, unit: event.target.value as typeof draft.unit })}
                      className="h-9 w-full rounded-md border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-surface))] px-2 text-xs"
                    >
                      <option value="auto">Auto</option>
                      <option value="seconds">Seconds</option>
                      <option value="milliseconds">Milliseconds</option>
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="mb-1 block text-[hsl(var(--wb-text-muted))]">Time zone</span>
                    <Input
                      value={draft.timezone || ""}
                      onChange={(event) => setDraft({ ...draft, timezone: event.target.value || undefined })}
                      placeholder="Local or UTC"
                      className="h-9 text-xs"
                    />
                  </label>
                </div>
              </>
            )}
            {draft.kind === "json-path" && (
              <label className="block text-xs">
                <span className="mb-1 block text-[hsl(var(--wb-text-muted))]">JSON path</span>
                <Input value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} placeholder="$.user.name" className="h-9 font-mono text-xs" />
              </label>
            )}
            {draft.kind === "mask" && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs"><span className="mb-1 block text-[hsl(var(--wb-text-muted))]">Visible prefix</span><Input type="number" min={0} value={draft.prefix} onChange={(event) => setDraft({ ...draft, prefix: Number(event.target.value) })} className="h-9 text-xs" /></label>
                <label className="text-xs"><span className="mb-1 block text-[hsl(var(--wb-text-muted))]">Visible suffix</span><Input type="number" min={0} value={draft.suffix} onChange={(event) => setDraft({ ...draft, suffix: Number(event.target.value) })} className="h-9 text-xs" /></label>
              </div>
            )}
            {draft.kind === "custom-template" && (
              <label className="block text-xs"><span className="mb-1 block text-[hsl(var(--wb-text-muted))]">Template</span><Input value={draft.template} onChange={(event) => setDraft({ ...draft, template: event.target.value })} placeholder="Status: ${value}" className="h-9 font-mono text-xs" /></label>
            )}

            <div className="rounded-md border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-surface))] p-3">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[hsl(var(--wb-text-muted))]">Live preview</div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono text-xs">
                <span className="truncate text-[hsl(var(--wb-text-muted))]">{String(sampleValue ?? "NULL")}</span>
                <span aria-hidden="true">→</span>
                <span className="truncate text-[hsl(var(--wb-accent))]">{preview ?? "No preview"}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] px-5 py-3">
          {formatter && <Button variant="ghost" className="mr-auto" onClick={onClear}>Clear formatter</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!normalized} onClick={() => normalized && onSave(normalized)}>Save formatter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
