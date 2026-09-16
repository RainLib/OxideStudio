import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ExplorerConnectionGroupDialogContext {
  connectionGroupDraft: {
    mode: "create" | "rename";
    groupId?: string | undefined;
    name: string;
  } | null;
  setConnectionGroupDraft: React.Dispatch<
    React.SetStateAction<{
      mode: "create" | "rename";
      groupId?: string | undefined;
      name: string;
    } | null>
  >;
  renameExplorerConnectionGroup: ReturnType<
    typeof import("@/store/useDatabaseExplorerStore").useDatabaseExplorerStore.getState
  >["renameConnectionGroup"];
  explorerStateScope: string;
  createExplorerConnectionGroup: ReturnType<
    typeof import("@/store/useDatabaseExplorerStore").useDatabaseExplorerStore.getState
  >["createConnectionGroup"];
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
}

export function ExplorerConnectionGroupDialog({
  connectionGroupDraft,
  setConnectionGroupDraft,
  renameExplorerConnectionGroup,
  explorerStateScope,
  createExplorerConnectionGroup,
  setExpandedObjectGroupKeys,
}: ExplorerConnectionGroupDialogContext) {
  return (
    <Dialog
      open={Boolean(connectionGroupDraft)}
      onOpenChange={(open) => {
        if (!open) setConnectionGroupDraft(null);
      }}
    >
      <DialogContent className="w-[380px] max-w-[calc(100vw-32px)] gap-4 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-5 text-[hsl(var(--wb-text))] shadow-[0_14px_36px_rgba(0,0,0,0.42)]">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!connectionGroupDraft?.name.trim()) return;
            if (
              connectionGroupDraft.mode === "rename" &&
              connectionGroupDraft.groupId
            ) {
              renameExplorerConnectionGroup(
                explorerStateScope,
                connectionGroupDraft.groupId,
                connectionGroupDraft.name,
              );
            } else {
              const groupId = createExplorerConnectionGroup(
                explorerStateScope,
                connectionGroupDraft.name,
                connectionGroupDraft.groupId || null,
              );
              setExpandedObjectGroupKeys((current) =>
                current.includes(groupId) ? current : [...current, groupId],
              );
            }
            setConnectionGroupDraft(null);
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-[14px]">
              {connectionGroupDraft?.mode === "rename"
                ? "Rename Connection Group"
                : connectionGroupDraft?.groupId
                  ? "New Connection Subgroup"
                  : "New Connection Group"}
            </DialogTitle>
            <DialogDescription className="text-[11px] leading-5 wb-muted">
              Groups organize saved data sources only; they do not change the
              database server or credentials.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-[11px] font-medium">
            <span>Name</span>
            <input
              autoFocus
              value={connectionGroupDraft?.name || ""}
              onChange={(event) =>
                setConnectionGroupDraft((current) =>
                  current ? { ...current, name: event.target.value } : null,
                )
              }
              className="h-8 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[12px] outline-none focus:border-[hsl(var(--wb-accent))] focus:ring-1 focus:ring-[hsl(var(--wb-accent)/0.35)]"
              placeholder="e.g. Production, Analytics, Local"
            />
          </label>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConnectionGroupDraft(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!connectionGroupDraft?.name.trim()}>
              {connectionGroupDraft?.mode === "rename" ? "Rename" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
