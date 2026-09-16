import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Project } from "@/services/tauri/store.service";
import { Trash2 } from "lucide-react";

interface DeleteProjectDialogProps {
  projectToDelete: Project | null;
  isDeletingProject: boolean;
  setProjectToDelete: React.Dispatch<React.SetStateAction<Project | null>>;
  setProjectDeleteError: React.Dispatch<React.SetStateAction<string | null>>;
  projectDeleteError: string | null;
  handleDeleteProject: () => Promise<void>;
}

export function DeleteProjectDialog({
  projectToDelete,
  isDeletingProject,
  setProjectToDelete,
  setProjectDeleteError,
  projectDeleteError,
  handleDeleteProject,
}: DeleteProjectDialogProps) {
  return (
    <Dialog
      open={Boolean(projectToDelete)}
      onOpenChange={(open) => {
        if (!open && !isDeletingProject) {
          setProjectToDelete(null);
          setProjectDeleteError(null);
        }
      }}
    >
      <DialogContent className="w-[440px] max-w-[calc(100vw-32px)] gap-4 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-5 text-[hsl(var(--wb-text))] shadow-[0_4px_8px_rgba(0,0,0,0.35)]">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Delete project?</DialogTitle>
          <DialogDescription className="text-[12px] leading-5 text-[hsl(var(--wb-text-muted))]">
            Delete <strong>{projectToDelete?.name}</strong> from OxideStudio.
            Its data sources and cached metadata will be removed. Files in the
            linked directory will stay on disk.
          </DialogDescription>
        </DialogHeader>
        {projectToDelete?.root_path && (
          <div
            className="truncate rounded-[4px] bg-[hsl(var(--wb-editor))] px-3 py-2 font-mono text-[11px] text-[hsl(var(--wb-text-muted))]"
            title={projectToDelete.root_path}
          >
            {projectToDelete.root_path}
          </div>
        )}
        {projectDeleteError && (
          <div className="rounded-[4px] bg-[hsl(var(--destructive)/0.10)] px-3 py-2 text-[12px] text-[hsl(var(--destructive))]">
            {projectDeleteError}
          </div>
        )}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-3 text-[12px]"
            disabled={isDeletingProject}
            onClick={() => setProjectToDelete(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-8 px-3 text-[12px]"
            disabled={isDeletingProject}
            onClick={() => void handleDeleteProject()}
          >
            <Trash2 size={13} className="mr-1.5" />
            {isDeletingProject ? "Deleting…" : "Delete Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
