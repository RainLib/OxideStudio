import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { cn } from "@/lib/utils";
import {
  Plus,
  LayoutGrid,
  Trash2,
  Edit3,
  Palette,
  Briefcase,
  Settings,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import * as LucideIcons from "lucide-react";
import { SettingsDialog } from "@/components/settings/SettingsDialog";

// Predefined colors
const COLORS = [
  "#f39c12", // Orange
  "#e74c3c", // Red
  "#8e44ad", // Purple
  "#3498db", // Blue
  "#2ecc71", // Green
  "#1abc9c", // Teal
  "#34495e", // Navy
  "#95a5a6", // Grey
];

// Predefined icons
const ICONS = [
  "Briefcase",
  "Code",
  "Terminal",
  "Database",
  "Cloud",
  "Server",
  "Folder",
  "Box",
];

export function WorkspaceSidebar() {
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
  } = useWorkspaceStore();

  // Dialog States
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Form States
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [selectedIcon, setSelectedIcon] = useState("Briefcase");
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(
    null
  );
  const [workspaceToDelete, setWorkspaceToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const handleCreate = () => {
    if (workspaceName.trim()) {
      createWorkspace(
        workspaceName.trim(),
        selectedIcon,
        undefined,
        workspaceDescription.trim()
      );
      setWorkspaceName("");
      setWorkspaceDescription("");
      setSelectedIcon("Briefcase");
      setCreateDialogOpen(false);
    }
  };

  const startRename = (
    id: string,
    currentName: string,
    currentDescription?: string
  ) => {
    setEditingWorkspaceId(id);
    setWorkspaceName(currentName);
    setWorkspaceDescription(currentDescription || "");
    setRenameDialogOpen(true);
  };

  const handleRename = () => {
    if (editingWorkspaceId && workspaceName.trim()) {
      updateWorkspace(editingWorkspaceId, {
        name: workspaceName.trim(),
        description: workspaceDescription.trim(),
      });
      setWorkspaceName("");
      setWorkspaceDescription("");
      setEditingWorkspaceId(null);
      setRenameDialogOpen(false);
    }
  };

  const handleDelete = (id: string, name: string) => {
    setWorkspaceToDelete({ id, name });
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (workspaceToDelete) {
      deleteWorkspace(workspaceToDelete.id);
      setWorkspaceToDelete(null);
      setDeleteDialogOpen(false);
    }
  };

  // Helper to render dynamic icon
  const renderIcon = (iconName: string, size: number = 20) => {
    const IconComponent = (LucideIcons as any)[iconName] || LucideIcons.Folder;
    return <IconComponent size={size} strokeWidth={1.5} />;
  };

  return (
    <div
      className={cn(
        "w-10 shrink-0 flex flex-col items-center py-1 gap-1 z-20 h-full transition-colors bg-[hsl(var(--wb-toolbar))] border-r border-[hsl(var(--wb-border-subtle))]"
      )}
    >
      <TooltipProvider delayDuration={0}>
        {/* ALL CONNECTIONS (Default) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              onClick={() => setActiveWorkspace(null)}
              className={cn(
                "w-7 h-7 rounded-[4px] flex items-center justify-center cursor-pointer transition-colors group relative",
                activeWorkspaceId === null
                  ? "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]"
                  : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
              )}
            >
              <LayoutGrid size={20} strokeWidth={1.5} />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            className="ml-3 rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--wb-text))] shadow-md"
            sideOffset={5}
          >
            <p>All Connections</p>
          </TooltipContent>
        </Tooltip>

        <div className="my-1 h-px w-6 bg-[hsl(var(--wb-border-subtle))]" />

        {/* WORKSPACES LIST */}
        <div className="flex-1 w-full flex flex-col items-center gap-1 overflow-y-auto overflow-x-hidden no-scrollbar">
          {workspaces.map((workspace) => (
            <ContextMenu key={workspace.id}>
              <ContextMenuTrigger>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      onClick={() => setActiveWorkspace(workspace.id)}
                      className={cn(
                        "w-7 h-7 rounded-[4px] flex items-center justify-center cursor-pointer transition-colors group relative",
                        activeWorkspaceId === workspace.id
                          ? "text-white"
                          : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                      )}
                      style={
                        activeWorkspaceId === workspace.id
                          ? ({
                              backgroundColor: workspace.color,
                              "--tw-ring-color": workspace.color,
                            } as React.CSSProperties)
                          : {}
                      }
                    >
                      {/* Render Dynamic Icon */}
                      <span
                        className={cn(
                          "transition-colors",
                          activeWorkspaceId === workspace.id ? "text-white" : ""
                        )}
                      >
                        {renderIcon(workspace.icon || "Folder")}
                      </span>

                      {/* Active Indicator Dot (optional, if we want to be very minimal) */}
                      {/* {activeWorkspaceId === workspace.id && (
                         <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-1 h-1 bg-white rounded-full" />
                      )} */}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="ml-2 flex min-w-[150px] flex-col gap-1 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-3 text-[hsl(var(--wb-text))] shadow-lg"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]"
                        style={{
                          color: workspace.color,
                          backgroundColor: workspace.color,
                        }}
                      />
                      <p className="text-sm font-bold text-[hsl(var(--wb-text))]">
                        {workspace.name}
                      </p>
                    </div>
                    {workspace.description && (
                      <p className="mt-1 border-t border-[hsl(var(--wb-border-subtle))] pt-2 text-xs leading-relaxed text-[hsl(var(--wb-text-muted))]">
                        {workspace.description}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-1 text-[10px] italic text-[hsl(var(--wb-text-muted))]">
                      Right-click to edit
                    </div>
                  </TooltipContent>
                </Tooltip>
              </ContextMenuTrigger>

              {/* RIGHT CLICK MENU */}
              <ContextMenuContent className="w-48 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))] shadow-2xl">
                <ContextMenuItem
                  className="cursor-pointer focus:bg-[hsl(var(--wb-hover))] focus:text-[hsl(var(--wb-text))]"
                  onSelect={() =>
                    startRename(
                      workspace.id,
                      workspace.name,
                      workspace.description
                    )
                  }
                >
                  <Edit3 size={14} className="mr-2" /> Rename / Edit
                </ContextMenuItem>

                <ContextMenuSub>
                  <ContextMenuSubTrigger
                    className="cursor-pointer focus:bg-[hsl(var(--wb-hover))] focus:text-[hsl(var(--wb-text))]"
                  >
                    <Palette size={14} className="mr-2" /> Change Color
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent
                    className="grid w-36 grid-cols-4 gap-1 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1"
                  >
                    {COLORS.map((color) => (
                      <ContextMenuItem
                        key={color}
                        className="h-6 w-6 cursor-pointer rounded border border-transparent p-0 transition-transform focus:scale-110 focus:border-[hsl(var(--wb-text))] data-highlighted:scale-110 data-highlighted:border-[hsl(var(--wb-text))]"
                        style={{ backgroundColor: color }}
                        onSelect={() =>
                          updateWorkspace(workspace.id, { color })
                        }
                      >
                        {workspace.color === color && (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-white shadow-sm" />
                          </div>
                        )}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>

                {/* Icon Change Submenu */}
                <ContextMenuSub>
                  <ContextMenuSubTrigger
                    className="cursor-pointer focus:bg-[hsl(var(--wb-hover))] focus:text-[hsl(var(--wb-text))]"
                  >
                    <Briefcase size={14} className="mr-2" /> Change Icon
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent
                    className="grid w-40 grid-cols-4 gap-1 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[hsl(var(--wb-text))]"
                  >
                    {ICONS.map((icon) => (
                      <ContextMenuItem
                        key={icon}
                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-[hsl(var(--wb-text-muted))] transition-colors hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus:bg-[hsl(var(--wb-hover))] focus:text-[hsl(var(--wb-text))]"
                        onSelect={() => updateWorkspace(workspace.id, { icon })}
                      >
                        {renderIcon(icon, 16)}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>

                <ContextMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />

                <ContextMenuItem
                  className="cursor-pointer text-[hsl(var(--destructive))] focus:bg-[hsl(var(--destructive)/0.10)] focus:text-[hsl(var(--destructive))]"
                  onSelect={() => {
                    // Prevent closing immediately so we can handle state if needed,
                    // but for Dialog trigger, standard behavior is fine.
                    // We just call the handler.
                    handleDelete(workspace.id, workspace.name);
                  }}
                >
                  <Trash2 size={14} className="mr-2" /> Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}

          {/* ADD WORKSPACE BUTTON */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                onClick={() => {
                  setWorkspaceName("");
                  setWorkspaceDescription("");
                  setSelectedIcon("Briefcase");
                  setCreateDialogOpen(true);
                }}
                className="mt-2 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border border-dashed border-[hsl(var(--wb-border))] text-[hsl(var(--wb-text-muted))] transition-[color,background-color,border-color,transform] duration-200 hover:scale-105 hover:border-[hsl(var(--wb-accent))] hover:bg-[hsl(var(--wb-accent)/0.10)] hover:text-[hsl(var(--wb-accent))]"
              >
                <Plus size={20} strokeWidth={1.5} />
              </div>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="ml-2 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] font-medium text-[hsl(var(--wb-text))]"
            >
              Create Workspace
            </TooltipContent>
          </Tooltip>
        </div>

        {/* CREATE DIALOG */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent className="w-[448px] max-w-[calc(100vw-32px)] rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
            <DialogHeader>
              <DialogTitle>Create Workspace</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
                  Workspace Name
                </label>
                <Input
                  placeholder="e.g. Production"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] focus-visible:ring-[hsl(var(--wb-accent))]"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
                  Description (Optional)
                </label>
                <Input
                  placeholder="Briefly describe this workspace..."
                  value={workspaceDescription}
                  onChange={(e) => setWorkspaceDescription(e.target.value)} // Using Input as lighter textarea replacement for now
                  className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] focus-visible:ring-[hsl(var(--wb-accent))]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
                  Icon
                </label>
                <div
                  className="flex flex-wrap gap-2 rounded-[6px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-3"
                >
                  {ICONS.map((icon) => (
                    <div
                      key={icon}
                      onClick={() => setSelectedIcon(icon)}
                      className={cn(
                        "w-9 h-9 rounded-md flex items-center justify-center cursor-pointer transition-all",
                        selectedIcon === icon
                          ? "bg-[hsl(var(--wb-accent))] text-[hsl(var(--wb-accent-foreground))] shadow-sm"
                          : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                      )}
                    >
                      {renderIcon(icon, 18)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setCreateDialogOpen(false)}
                className="text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                className="bg-[hsl(var(--wb-accent))] text-[hsl(var(--wb-accent-foreground))] hover:bg-[hsl(var(--wb-accent)/0.88)]"
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* RENAME/EDIT DIALOG */}
        <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
          <DialogContent className="w-[384px] max-w-[calc(100vw-32px)] rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
            <DialogHeader>
              <DialogTitle>Edit Workspace</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
                  Workspace Name
                </label>
                <Input
                  placeholder="e.g. Production"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] focus-visible:ring-[hsl(var(--wb-accent))]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
                  Description
                </label>
                <Input
                  placeholder="Briefly describe this workspace..."
                  value={workspaceDescription}
                  onChange={(e) => setWorkspaceDescription(e.target.value)}
                  className="border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] focus-visible:ring-[hsl(var(--wb-accent))]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setRenameDialogOpen(false)}
                className="text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleRename}
                className="bg-[hsl(var(--wb-accent))] text-[hsl(var(--wb-accent-foreground))] hover:bg-[hsl(var(--wb-accent)/0.88)]"
              >
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* DELETE CONFIRMATION DIALOG */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent className="w-[384px] max-w-[calc(100vw-32px)] rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
            <DialogHeader>
              <DialogTitle>Delete Workspace</DialogTitle>
            </DialogHeader>
            <div className="py-2 text-sm opacity-80">
              Are you sure you want to delete workspace "
              <span className="font-bold">{workspaceToDelete?.name}</span>"?
              <div className="mt-2 text-xs text-muted-foreground">
                This will hide its connections until they are reassigned.
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setDeleteDialogOpen(false)}
                className="text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]"
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDelete}
                className="bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:brightness-110"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Version and Settings Footer */}
        <div className="mt-auto flex w-full flex-col items-center gap-4 border-t border-[hsl(var(--wb-border-subtle))] py-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowSettings(true)}
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-[6px] text-[hsl(var(--wb-text-muted))] transition-colors hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
              >
                <Settings size={20} strokeWidth={1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="ml-2 rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--wb-text))] shadow-md"
              sideOffset={5}
            >
              <p>Settings</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}
