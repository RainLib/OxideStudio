import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { cn } from "@/lib/utils";
import { Plus, LayoutGrid, Trash2, Edit3, Palette } from "lucide-react";
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

  // Form States
  const [workspaceName, setWorkspaceName] = useState("");
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(
    null
  );

  const handleCreate = () => {
    if (workspaceName.trim()) {
      createWorkspace(workspaceName.trim());
      setWorkspaceName("");
      setCreateDialogOpen(false);
    }
  };

  const startRename = (id: string, currentName: string) => {
    setEditingWorkspaceId(id);
    setWorkspaceName(currentName);
    setRenameDialogOpen(true);
  };

  const handleRename = () => {
    if (editingWorkspaceId && workspaceName.trim()) {
      updateWorkspace(editingWorkspaceId, { name: workspaceName.trim() });
      setWorkspaceName("");
      setEditingWorkspaceId(null);
      setRenameDialogOpen(false);
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (
      confirm(
        `Are you sure you want to delete workspace "${name}"?\nThis will hide its connections until they are reassigned.`
      )
    ) {
      deleteWorkspace(id);
    }
  };

  return (
    <div className="w-[72px] bg-[#0c0c0c] border-r border-[#222] flex flex-col items-center py-6 gap-3 z-20 shadow-2xl h-full">
      <TooltipProvider delayDuration={0}>
        {/* ALL CONNECTIONS (Default) */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              onClick={() => setActiveWorkspace(null)}
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-300 group relative mb-2",
                activeWorkspaceId === null
                  ? "bg-gradient-to-br from-[#f39c12] to-[#d35400] text-white shadow-lg shadow-orange-900/40 scale-105"
                  : "bg-[#1a1a1a] text-gray-500 hover:bg-[#252525] hover:text-gray-200 hover:scale-105"
              )}
            >
              <LayoutGrid size={20} strokeWidth={1.5} />
              {activeWorkspaceId === null && (
                <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-r-full" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="right"
            className="bg-[#1a1a1a] border-[#333] font-medium ml-2"
          >
            <p>All Connections</p>
          </TooltipContent>
        </Tooltip>

        <div className="w-12 h-px bg-[#222] mx-auto rounded-full" />

        {/* WORKSPACES LIST */}
        <div className="flex-1 w-full flex flex-col items-center gap-3 overflow-y-auto px-2 custom-scrollbar no-scrollbar">
          {workspaces.map((workspace) => (
            <ContextMenu key={workspace.id}>
              <ContextMenuTrigger>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      onClick={() => setActiveWorkspace(workspace.id)}
                      className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-300 group relative border-2",
                        activeWorkspaceId === workspace.id
                          ? "border-white/20 scale-105 shadow-xl"
                          : "border-transparent bg-[#1a1a1a] text-gray-400 hover:bg-[#252525] hover:text-gray-200 hover:scale-105 shadow-md"
                      )}
                      style={
                        activeWorkspaceId === workspace.id
                          ? {
                              backgroundColor: workspace.color,
                              color: "white",
                              textShadow: "0 1px 2px rgba(0,0,0,0.3)",
                            }
                          : {}
                      }
                    >
                      <div className="text-xs font-bold tracking-wide">
                        {workspace.name.substring(0, 2).toUpperCase()}
                      </div>

                      {activeWorkspaceId === workspace.id && (
                        <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-r-full" />
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="bg-[#1a1a1a] border-[#333] font-medium ml-2 flex items-center gap-2"
                  >
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: workspace.color }}
                    />
                    <p>{workspace.name}</p>
                    <span className="text-[10px] text-gray-500 bg-[#252525] px-1 rounded border border-[#333]">
                      Right-click to edit
                    </span>
                  </TooltipContent>
                </Tooltip>
              </ContextMenuTrigger>

              {/* RIGHT CLICK MENU */}
              <ContextMenuContent className="w-48 bg-[#1a1a1a] border-[#333] text-gray-200 shadow-2xl">
                <ContextMenuItem
                  className="focus:bg-[#252525] focus:text-white cursor-pointer"
                  onClick={() => startRename(workspace.id, workspace.name)}
                >
                  <Edit3 size={14} className="mr-2" /> Rename
                </ContextMenuItem>

                <ContextMenuSub>
                  <ContextMenuSubTrigger className="focus:bg-[#252525] focus:text-white cursor-pointer">
                    <Palette size={14} className="mr-2" /> Change Color
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-36 bg-[#1a1a1a] border-[#333] p-1 grid grid-cols-4 gap-1">
                    {COLORS.map((color) => (
                      <ContextMenuItem
                        key={color}
                        className="w-6 h-6 rounded cursor-pointer transition-transform border border-transparent focus:scale-110 focus:border-white p-0 data-[highlighted]:scale-110 data-[highlighted]:border-white"
                        style={{ backgroundColor: color }}
                        onSelect={() =>
                          updateWorkspace(workspace.id, { color })
                        }
                      >
                        {/* Visual indicator for active color? Optional. */}
                        {workspace.color === color && (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-white shadow-sm" />
                          </div>
                        )}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>

                <ContextMenuSeparator className="bg-[#333]" />

                <ContextMenuItem
                  className="text-red-500 focus:bg-red-500/10 focus:text-red-400 cursor-pointer"
                  onClick={() => handleDelete(workspace.id, workspace.name)}
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
                  setCreateDialogOpen(true);
                }}
                className="w-10 h-10 rounded-xl border-2 border-dashed border-[#333] text-[#444] flex items-center justify-center cursor-pointer hover:border-[#f39c12] hover:text-[#f39c12] hover:bg-[#f39c12]/10 transition-all duration-300 mt-2 hover:scale-105"
              >
                <Plus size={20} strokeWidth={1.5} />
              </div>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="bg-[#1a1a1a] border-[#333] font-medium ml-2"
            >
              Create Workspace
            </TooltipContent>
          </Tooltip>
        </div>

        {/* DIALOGS */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent className="bg-[#1e1e1e] border-[#333] text-gray-200 sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Workspace</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                placeholder="Workspace Name (e.g. Production)"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                className="bg-[#252525] border-[#444] text-white focus-visible:ring-[#f39c12]"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setCreateDialogOpen(false)}
                className="hover:bg-[#333] text-gray-400"
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

        <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
          <DialogContent className="bg-[#1e1e1e] border-[#333] text-gray-200 sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Rename Workspace</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                placeholder="Workspace Name"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                className="bg-[#252525] border-[#444] text-white focus-visible:ring-[#f39c12]"
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setRenameDialogOpen(false)}
                className="hover:bg-[#333] text-gray-400"
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
      </TooltipProvider>
    </div>
  );
}
