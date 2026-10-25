import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { APP_EVENT_OPEN_VERSION_CONTROL } from "@/lib/actionEvents";
import type { Project } from "@/services/tauri/store.service";
import { ChevronDown, FolderOpen, GitBranch, Plus, Trash2 } from "lucide-react";
import { Fragment } from "react";

interface ProjectMenuProps {
  projectMenuOpen: boolean;
  setProjectMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeProjectName: string;
  projectGroups: [string, Project[]][];
  activeProjectId: string;
  setActiveProject: (projectId: string) => Promise<boolean>;
  setProjectDeleteError: React.Dispatch<React.SetStateAction<string | null>>;
  setProjectToDelete: React.Dispatch<React.SetStateAction<Project | null>>;
  activeProject: Project | null;
  openProjectDialog: () => void;
}

export function ProjectMenu({
  projectMenuOpen,
  setProjectMenuOpen,
  activeProjectName,
  projectGroups,
  activeProjectId,
  setActiveProject,
  setProjectDeleteError,
  setProjectToDelete,
  activeProject,
  openProjectDialog,
}: ProjectMenuProps) {
  return (
    <Popover open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="wb-text-button h-6 px-1.5 text-[12px] text-[hsl(var(--wb-text))]"
          title="Project"
        >
          <span className="max-w-36 truncate">
            {activeProjectName || "sqls"}
          </span>
          <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-1 text-[12px]"
      >
        <div className="max-h-72 overflow-y-auto">
          {projectGroups.map(([group, groupedProjects]) => (
            <Fragment key={group}>
              <div className="px-2 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-wide wb-muted">
                {group}
              </div>
              {groupedProjects.map((project) => {
                const isActive = project.id === activeProjectId;
                const isDefault = project.id === "sqls";
                const isManaged = project.origin === "managed";
                return (
                  <div
                    key={project.id}
                    className={`group flex min-h-10 items-center rounded-[3px] ${
                      isActive
                        ? "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]"
                        : "hover:bg-[hsl(var(--wb-hover))]"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]"
                      onClick={async () => {
                        if (await setActiveProject(project.id)) {
                          setProjectMenuOpen(false);
                        }
                      }}
                    >
                      <FolderOpen
                        size={14}
                        className={
                          isActive
                            ? "shrink-0 text-[hsl(var(--wb-accent))]"
                            : "shrink-0 text-[hsl(var(--wb-text-muted))]"
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] leading-4">
                          {project.name}
                        </span>
                        <span
                          className="block truncate text-[10px] leading-3 text-[hsl(var(--wb-text-muted))]"
                          title={project.root_path || undefined}
                        >
                          {isManaged
                            ? `${project.managed_data_sources?.length || 0} managed data sources`
                            : project.root_path ||
                              (isDefault
                                ? "Built-in workspace"
                                : "No project directory")}
                        </span>
                      </span>
                    </button>
                    {!isDefault && !isManaged && (
                      <button
                        type="button"
                        className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] text-[hsl(var(--wb-text-muted))] opacity-0 outline-none transition-[color,background-color,opacity] hover:bg-[hsl(var(--destructive)/0.12)] hover:text-[hsl(var(--destructive))] focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[hsl(var(--destructive))] group-hover:opacity-100 group-focus-within:opacity-100"
                        title={`Delete ${project.name}`}
                        aria-label={`Delete project ${project.name}`}
                        onClick={() => {
                          setProjectMenuOpen(false);
                          setProjectDeleteError(null);
                          setProjectToDelete(project);
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
        <div className="my-1 h-px bg-[hsl(var(--wb-border-subtle))]" />
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[12px] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-45"
          disabled={!activeProject || activeProject.origin === "managed"}
          onClick={() => {
            setProjectMenuOpen(false);
            window.dispatchEvent(
              new CustomEvent(APP_EVENT_OPEN_VERSION_CONTROL),
            );
          }}
        >
          <GitBranch size={13} />
          <span>Version Control…</span>
        </button>
        <button
          type="button"
          className="flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[12px] hover:bg-[hsl(var(--wb-hover))]"
          onClick={openProjectDialog}
        >
          <Plus size={13} />
          <span>New Project</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
