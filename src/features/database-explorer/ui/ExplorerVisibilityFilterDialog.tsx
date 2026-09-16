import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseExplorerVisibilityPatterns } from "@/features/database-explorer/model/explorerSidebarPresentation";

interface ExplorerVisibilityFilterDialogContext {
  visibilityFilterDraft: {
    parentNodeId: string;
    label: string;
    includePatterns: string;
    excludePatterns: string;
  } | null;
  setVisibilityFilterDraft: React.Dispatch<
    React.SetStateAction<{
      parentNodeId: string;
      label: string;
      includePatterns: string;
      excludePatterns: string;
    } | null>
  >;
  clearExplorerVisibilityFilter: ReturnType<
    typeof import("@/store/useDatabaseExplorerStore").useDatabaseExplorerStore.getState
  >["clearVisibilityFilter"];
  explorerStateScope: string;
  setExplorerVisibilityPatterns: ReturnType<
    typeof import("@/store/useDatabaseExplorerStore").useDatabaseExplorerStore.getState
  >["setVisibilityPatterns"];
}

export function ExplorerVisibilityFilterDialog({
  visibilityFilterDraft,
  setVisibilityFilterDraft,
  clearExplorerVisibilityFilter,
  explorerStateScope,
  setExplorerVisibilityPatterns,
}: ExplorerVisibilityFilterDialogContext) {
  return (
    <Dialog
      open={Boolean(visibilityFilterDraft)}
      onOpenChange={(open) => {
        if (!open) setVisibilityFilterDraft(null);
      }}
    >
      <DialogContent className="w-[460px] max-w-[calc(100vw-32px)] gap-4 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-5 text-[hsl(var(--wb-text))] shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            Configure object filter
          </DialogTitle>
          <DialogDescription className="text-[12px] leading-5 wb-muted">
            {visibilityFilterDraft?.label}. Enter one case-insensitive pattern
            per line. Use <code>*</code> for any text and <code>?</code> for one
            character. Exclude rules take precedence.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-[11px] font-medium">
          Include patterns
          <textarea
            value={visibilityFilterDraft?.includePatterns ?? ""}
            rows={4}
            spellCheck={false}
            placeholder={"*\nreport_*"}
            className="min-h-20 resize-y rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-surface))] px-2.5 py-2 font-mono text-[11px] font-normal outline-none focus:border-[hsl(var(--wb-accent))]"
            onChange={(event) =>
              setVisibilityFilterDraft((current) =>
                current
                  ? { ...current, includePatterns: event.target.value }
                  : current,
              )
            }
          />
        </label>
        <label className="grid gap-1.5 text-[11px] font-medium">
          Exclude patterns
          <textarea
            value={visibilityFilterDraft?.excludePatterns ?? ""}
            rows={4}
            spellCheck={false}
            placeholder={"tmp_*\n*_archive"}
            className="min-h-20 resize-y rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-surface))] px-2.5 py-2 font-mono text-[11px] font-normal outline-none focus:border-[hsl(var(--wb-accent))]"
            onChange={(event) =>
              setVisibilityFilterDraft((current) =>
                current
                  ? { ...current, excludePatterns: event.target.value }
                  : current,
              )
            }
          />
        </label>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (!visibilityFilterDraft) return;
              clearExplorerVisibilityFilter(
                explorerStateScope,
                visibilityFilterDraft.parentNodeId,
              );
              setVisibilityFilterDraft(null);
            }}
          >
            Clear all
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setVisibilityFilterDraft(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (!visibilityFilterDraft) return;
              setExplorerVisibilityPatterns(
                explorerStateScope,
                visibilityFilterDraft.parentNodeId,
                parseExplorerVisibilityPatterns(
                  visibilityFilterDraft.includePatterns,
                ),
                parseExplorerVisibilityPatterns(
                  visibilityFilterDraft.excludePatterns,
                ),
              );
              setVisibilityFilterDraft(null);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
