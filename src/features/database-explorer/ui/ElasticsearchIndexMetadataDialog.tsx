import { useEffect, useMemo, useState } from "react";
import { Braces, Copy, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { schemaService } from "@/services/tauri";
import type { SearchIndexMetadataKind } from "@/services/tauri/types";

const metadataKinds: Array<{
  kind: SearchIndexMetadataKind;
  label: string;
  description: string;
}> = [
  { kind: "mapping", label: "Mapping", description: "fields and analyzers" },
  { kind: "settings", label: "Settings", description: "shards and index options" },
  { kind: "stats", label: "Stats", description: "documents, storage, and operations" },
];

interface ElasticsearchIndexMetadataDialogProps {
  open: boolean;
  connectionId: string;
  driver: string;
  index: string;
  initialKind: SearchIndexMetadataKind;
  onClose: () => void;
}

export function ElasticsearchIndexMetadataDialog({
  open,
  connectionId,
  driver,
  index,
  initialKind,
  onClose,
}: ElasticsearchIndexMetadataDialogProps) {
  const [kind, setKind] = useState<SearchIndexMetadataKind>(initialKind);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  const activeMetadata = useMemo(
    () => metadataKinds.find((item) => item.kind === kind) ?? metadataKinds[0]!,
    [kind],
  );

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
  }, [initialKind, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent("");
    void schemaService
      .getElasticsearchIndexMetadata(connectionId, driver, index, kind)
      .then((metadata) => {
        if (!cancelled) setContent(JSON.stringify(metadata, null, 2));
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, driver, index, kind, open, reloadVersion]);

  const reload = () => setReloadVersion((version) => version + 1);

  const copy = async () => {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[min(720px,82vh)] w-[min(840px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border))] px-5 py-4">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-[13px] font-semibold tracking-normal">
            <Braces size={15} className="shrink-0 text-cyan-400" />
            <span className="truncate">Index metadata · {index}</span>
          </DialogTitle>
          <p className="mt-1 text-[11px] leading-4 wb-muted">
            Read directly from the active Elasticsearch connection.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-3 border-b border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] px-3 pt-2">
          {metadataKinds.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={cn(
                "relative flex min-w-0 flex-col px-3 py-2 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cyan-400",
                item.kind === kind
                  ? "text-[hsl(var(--wb-text))]"
                  : "wb-muted hover:text-[hsl(var(--wb-text))]",
              )}
              onClick={() => setKind(item.kind)}
            >
              <span className="text-[11px] font-medium">{item.label}</span>
              <span className="truncate text-[9px] opacity-70">{item.description}</span>
              {item.kind === kind && (
                <span className="absolute inset-x-3 bottom-0 h-px bg-cyan-400" />
              )}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 p-3">
          <div className="relative h-full overflow-auto rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))]">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-2 text-[11px] wb-muted">
                <Loader2 size={14} className="animate-spin" />
                Loading {activeMetadata.label.toLowerCase()}…
              </div>
            ) : error ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                <p className="max-w-[520px] text-[11px] leading-5 text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={reload}>
                  <RefreshCw size={13} className="mr-1.5" /> Retry
                </Button>
              </div>
            ) : (
              <textarea
                aria-label={`${activeMetadata.label} JSON`}
                readOnly
                wrap="off"
                value={content}
                className="h-full w-full resize-none border-0 bg-transparent p-4 font-mono text-[11px] leading-[1.65] text-[hsl(var(--wb-text-muted))] outline-none selection:bg-cyan-500/25"
                data-text-selectable="true"
              />
            )}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border))] px-4 py-3 sm:justify-between">
          <span className="text-[10px] wb-muted">
            {copied ? "Copied to clipboard" : `${activeMetadata.label} · JSON`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={loading} onClick={reload}>
              <RefreshCw size={13} className="mr-1.5" /> Refresh
            </Button>
            <Button variant="ghost" size="sm" disabled={!content} onClick={() => void copy()}>
              <Copy size={13} className="mr-1.5" /> Copy
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
