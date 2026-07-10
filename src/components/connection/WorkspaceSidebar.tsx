import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { cn } from "@/lib/utils";
import { useTheme } from "@/theme";
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

  const { mode } = useTheme();
  const isDark = mode === "dark";

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
            className={cn(
              "font-medium ml-3 px-3 py-1.5 rounded-lg text-xs",
              isDark
                ? "bg-zinc-800 text-zinc-100 border-zinc-700"
                : "bg-white text-zinc-900 border-zinc-200 shadow-md"
            )}
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
                    className={cn(
                    "ml-2 flex flex-col gap-1 min-w-[150px] p-3 shadow-lg bg-[hsl(var(--wb-panel-raised))] border-[hsl(var(--wb-border))]"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]"
                        style={{
                          color: workspace.color,
                          backgroundColor: workspace.color,
                        }}
                      />
                      <p
                        className={cn(
                          "font-bold text-sm",
                          isDark ? "text-white" : "text-gray-900"
                        )}
                      >
                        {workspace.name}
                      </p>
                    </div>
                    {workspace.description && (
                      <p
                        className={cn(
                          "text-xs leading-relaxed border-t pt-2 mt-1",
                          isDark
                            ? "text-gray-400 border-[#333]"
                            : "text-gray-600 border-gray-200"
                        )}
                      >
                        {workspace.description}
                      </p>
                    )}
                    <div
                      className={cn(
                        "text-[10px] mt-2 italic flex items-center gap-1",
                        isDark ? "text-gray-600" : "text-gray-500"
                      )}
                    >
                      Right-click to edit
                    </div>
                  </TooltipContent>
                </Tooltip>
              </ContextMenuTrigger>

              {/* RIGHT CLICK MENU */}
              <ContextMenuContent
                className={cn(
                  "w-48 shadow-2xl",
                  isDark
                    ? "bg-[#1a1a1a] border-[#333] text-gray-200"
                    : "bg-white border-gray-200 text-gray-900"
                )}
              >
                <ContextMenuItem
                  className={cn(
                    "cursor-pointer",
                    isDark
                      ? "focus:bg-[#252525] focus:text-white"
                      : "focus:bg-gray-100 focus:text-gray-900"
                  )}
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
                    className={cn(
                      "cursor-pointer",
                      isDark
                        ? "focus:bg-[#252525] focus:text-white"
                        : "focus:bg-gray-100 focus:text-gray-900"
                    )}
                  >
                    <Palette size={14} className="mr-2" /> Change Color
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent
                    className={cn(
                      "w-36 p-1 grid grid-cols-4 gap-1",
                      isDark
                        ? "bg-[#1a1a1a] border-[#333]"
                        : "bg-white border-gray-200"
                    )}
                  >
                    {COLORS.map((color) => (
                      <ContextMenuItem
                        key={color}
                        className={cn(
                          "w-6 h-6 rounded cursor-pointer transition-transform border border-transparent focus:scale-110 p-0 data-highlighted:scale-110",
                          isDark
                            ? "focus:border-white data-highlighted:border-white"
                            : "focus:border-gray-900 data-highlighted:border-gray-900"
                        )}
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
                    className={cn(
                      "cursor-pointer",
                      isDark
                        ? "focus:bg-[#252525] focus:text-white"
                        : "focus:bg-gray-100 focus:text-gray-900"
                    )}
                  >
                    <Briefcase size={14} className="mr-2" /> Change Icon
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent
                    className={cn(
                      "w-40 p-1 grid grid-cols-4 gap-1",
                      isDark
                        ? "bg-[#1a1a1a] border-[#333]"
                        : "bg-white border-gray-200"
                    )}
                  >
                    {ICONS.map((icon) => (
                      <ContextMenuItem
                        key={icon}
                        className={cn(
                          "w-8 h-8 rounded cursor-pointer flex items-center justify-center transition-colors",
                          isDark
                            ? "text-gray-400 hover:text-white hover:bg-[#252525] focus:bg-[#252525] focus:text-white"
                            : "text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:bg-gray-100 focus:text-gray-900"
                        )}
                        onSelect={() => updateWorkspace(workspace.id, { icon })}
                      >
                        {renderIcon(icon, 16)}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>

                <ContextMenuSeparator
                  className={isDark ? "bg-[#333]" : "bg-gray-200"}
                />

                <ContextMenuItem
                  className="text-red-500 focus:bg-red-500/10 focus:text-red-400 cursor-pointer"
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
                className={cn(
                  "w-10 h-10 shrink-0 rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer hover:border-[#f39c12] hover:text-[#f39c12] hover:bg-[#f39c12]/10 transition-all duration-300 mt-2 hover:scale-105",
                  isDark
                    ? "border-[#333] text-[#444]"
                    : "border-gray-300 text-gray-400"
                )}
              >
                <Plus size={20} strokeWidth={1.5} />
              </div>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className={cn(
                "font-medium ml-2",
                isDark
                  ? "bg-[#1a1a1a] border-[#333] text-white"
                  : "bg-white border-gray-200 text-gray-900"
              )}
            >
              Create Workspace
            </TooltipContent>
          </Tooltip>
        </div>

        {/* CREATE DIALOG */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent
            className={cn(
              "sm:max-w-md",
              isDark
                ? "bg-[#1e1e1e] border-[#333] text-gray-200"
                : "bg-white border-gray-200 text-gray-900"
            )}
          >
            <DialogHeader>
              <DialogTitle>Create Workspace</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">
                  Workspace Name
                </label>
                <Input
                  placeholder="e.g. Production"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className={cn(
                    "focus-visible:ring-[#f39c12]",
                    isDark
                      ? "bg-[#252525] border-[#444] text-white"
                      : "bg-white border-gray-300 text-gray-900"
                  )}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">
                  Description (Optional)
                </label>
                <Input
                  placeholder="Briefly describe this workspace..."
                  value={workspaceDescription}
                  onChange={(e) => setWorkspaceDescription(e.target.value)} // Using Input as lighter textarea replacement for now
                  className={cn(
                    "focus-visible:ring-[#f39c12]",
                    isDark
                      ? "bg-[#252525] border-[#444] text-white"
                      : "bg-white border-gray-300 text-gray-900"
                  )}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">
                  Icon
                </label>
                <div
                  className={cn(
                    "flex flex-wrap gap-2 p-3 rounded-lg border",
                    isDark
                      ? "bg-[#252525] border-[#444]"
                      : "bg-gray-50 border-gray-300"
                  )}
                >
                  {ICONS.map((icon) => (
                    <div
                      key={icon}
                      onClick={() => setSelectedIcon(icon)}
                      className={cn(
                        "w-9 h-9 rounded-md flex items-center justify-center cursor-pointer transition-all",
                        selectedIcon === icon
                          ? "bg-[#f39c12] text-white shadow-lg scale-110"
                          : isDark
                          ? "text-gray-400 hover:bg-[#333]"
                          : "text-gray-600 hover:bg-gray-200"
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
                className={
                  isDark
                    ? "hover:bg-[#333] text-gray-400"
                    : "hover:bg-gray-100 text-gray-600"
                }
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                className="bg-[#f39c12] hover:bg-[#d35400] text-white"
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* RENAME/EDIT DIALOG */}
        <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
          <DialogContent
            className={cn(
              "sm:max-w-sm",
              isDark
                ? "bg-[#1e1e1e] border-[#333] text-gray-200"
                : "bg-white border-gray-200 text-gray-900"
            )}
          >
            <DialogHeader>
              <DialogTitle>Edit Workspace</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">
                  Workspace Name
                </label>
                <Input
                  placeholder="e.g. Production"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  className={cn(
                    "focus-visible:ring-[#f39c12]",
                    isDark
                      ? "bg-[#252525] border-[#444] text-white"
                      : "bg-white border-gray-300 text-gray-900"
                  )}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">
                  Description
                </label>
                <Input
                  placeholder="Briefly describe this workspace..."
                  value={workspaceDescription}
                  onChange={(e) => setWorkspaceDescription(e.target.value)}
                  className={cn(
                    "focus-visible:ring-[#f39c12]",
                    isDark
                      ? "bg-[#252525] border-[#444] text-white"
                      : "bg-white border-gray-300 text-gray-900"
                  )}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setRenameDialogOpen(false)}
                className={
                  isDark
                    ? "hover:bg-[#333] text-gray-400"
                    : "hover:bg-gray-100 text-gray-600"
                }
              >
                Cancel
              </Button>
              <Button
                onClick={handleRename}
                className="bg-[#f39c12] hover:bg-[#d35400] text-white"
              >
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* DELETE CONFIRMATION DIALOG */}
        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent
            className={cn(
              "sm:max-w-sm",
              isDark
                ? "bg-[#1e1e1e] border-[#333] text-gray-200"
                : "bg-white border-gray-200 text-gray-900"
            )}
          >
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
                className={
                  isDark
                    ? "hover:bg-[#333] text-gray-400"
                    : "hover:bg-gray-100 text-gray-600"
                }
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDelete}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Version and Settings Footer */}
        <div className="w-full mt-auto py-4 border-t border-white/5 flex flex-col items-center gap-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setShowSettings(true)}
                className={cn(
                  "w-10 h-10 rounded-2xl flex items-center justify-center cursor-pointer transition-all duration-300",
                  isDark
                    ? "text-muted-foreground hover:bg-white/10 hover:text-foreground"
                    : "text-muted-foreground hover:bg-black/5 hover:text-foreground"
                )}
              >
                <Settings size={20} strokeWidth={1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className={cn(
                "font-medium ml-2 px-3 py-1.5 rounded-lg text-xs",
                isDark
                  ? "bg-zinc-800 text-zinc-100 border-zinc-700"
                  : "bg-white text-zinc-900 border-zinc-200 shadow-md"
              )}
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
