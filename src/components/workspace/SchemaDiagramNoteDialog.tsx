import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SchemaDiagramNoteColor } from "@/services/schemaDiagramCanvasStore";

export function SchemaDiagramNoteDialog({
  open,
  mode,
  content,
  color,
  pendingDelete,
  onContentChange,
  onColorChange,
  onDelete,
  onCancel,
  onSave,
}: {
  open: boolean;
  mode: "create" | "edit";
  content: string;
  color: SchemaDiagramNoteColor;
  pendingDelete: boolean;
  onContentChange: (value: string) => void;
  onColorChange: (value: SchemaDiagramNoteColor) => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="w-[520px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <DialogTitle className="text-[13px] font-semibold">
            {mode === "create" ? "Add diagram note" : "Edit diagram note"}
          </DialogTitle>
          <DialogDescription className="text-[10px] text-[hsl(var(--wb-text-muted))]">
            Notes are project annotations and never become schema DDL.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <div className="space-y-3 p-4">
            <label className="block space-y-1.5 text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
              <span>Content</span>
              <textarea
                autoFocus
                value={content}
                onChange={(event) => onContentChange(event.target.value)}
                maxLength={4_000}
                rows={7}
                placeholder="Document a domain rule, ownership boundary, or review note…"
                className="w-full resize-y rounded-[5px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-2.5 text-[11px] leading-5 outline-none focus:border-[hsl(var(--wb-accent)/0.65)]"
              />
            </label>
            <label className="flex items-center gap-2 text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
              <span>Color</span>
              <select
                value={color}
                onChange={(event) =>
                  onColorChange(event.target.value as SchemaDiagramNoteColor)
                }
                className="h-7 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[10px] outline-none"
              >
                <option value="amber">Amber</option>
                <option value="violet">Violet</option>
                <option value="blue">Blue</option>
                <option value="green">Green</option>
                <option value="slate">Slate</option>
              </select>
              <span className="ml-auto text-[9px] font-normal wb-muted">
                {content.length.toLocaleString()} / 4,000
              </span>
            </label>
          </div>
          <DialogFooter className="flex-row items-center border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.56)] px-4 py-2.5 sm:justify-between sm:space-x-0">
            <div>
              {mode === "edit" && (
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-7 text-[11px]",
                    pendingDelete && "text-red-300",
                  )}
                  onClick={onDelete}
                >
                  {pendingDelete ? "Confirm delete" : "Delete note"}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={onCancel}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="h-7 text-[11px]"
                disabled={!content.trim()}
              >
                {mode === "create" ? "Add note" : "Save note"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
