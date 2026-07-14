import type {
  EditorPatchApplyResult,
  EditorPatchPreview,
} from "@/lib/editorPatch";
import { AlertTriangle, Check, FileDiff, X } from "lucide-react";
import { useState } from "react";

interface EditorPatchPreviewPanelProps {
  patch: EditorPatchPreview;
  stale: boolean;
  onApply: () => EditorPatchApplyResult;
  onDismiss: () => void;
}

export function EditorPatchPreviewPanel({
  patch,
  stale,
  onApply,
  onDismiss,
}: EditorPatchPreviewPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    const result = onApply();
    setError(result.status === "success" ? null : result.message);
  };

  return (
    <section
      className="border-b border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised)/0.92)]"
      aria-label="AI patch preview"
    >
      <div className="flex min-h-8 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-2.5">
        <FileDiff size={13} className="shrink-0 text-[hsl(var(--wb-accent))]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-medium text-[hsl(var(--wb-text))]">
            {patch.title}
          </div>
          <div className="truncate text-[9px] text-[hsl(var(--wb-text-muted))]">
            {patch.rationale || `Lines ${patch.range.startLine}–${patch.range.endLine}`}
          </div>
        </div>
        {stale && (
          <span className="inline-flex items-center gap-1 text-[9px] text-amber-300">
            <AlertTriangle size={10} /> Document changed
          </span>
        )}
        <button
          type="button"
          className="wb-text-button h-6 gap-1 px-2 text-[9px]"
          onClick={apply}
          disabled={stale}
          title={
            stale
              ? "Refresh the proposal against the current document"
              : "Apply this patch"
          }
        >
          <Check size={11} /> Apply
        </button>
        <button
          type="button"
          className="wb-icon-button"
          onClick={onDismiss}
          title="Dismiss patch"
        >
          <X size={12} />
        </button>
      </div>
      <div className="grid max-h-52 grid-cols-2 overflow-auto font-mono text-[10px] leading-4">
        <PatchSide label="Before" value={patch.originalText} tone="remove" />
        <PatchSide label="After" value={patch.replacement} tone="add" />
      </div>
      {error && (
        <div className="border-t border-red-500/25 bg-red-500/10 px-2.5 py-1 text-[9px] text-red-300">
          {error}
        </div>
      )}
    </section>
  );
}

function PatchSide({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "add" | "remove";
}) {
  return (
    <div className="min-w-0 border-r border-[hsl(var(--wb-border-subtle))] last:border-r-0">
      <div className="sticky top-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] px-2 py-0.5 text-[9px] uppercase tracking-wider text-[hsl(var(--wb-text-muted))]">
        {label}
      </div>
      <pre
        className={
          tone === "add"
            ? "min-h-16 whitespace-pre-wrap break-words bg-emerald-500/5 px-2 py-1.5 text-emerald-100"
            : "min-h-16 whitespace-pre-wrap break-words bg-red-500/5 px-2 py-1.5 text-red-100"
        }
      >
        {value || "∅"}
      </pre>
    </div>
  );
}
