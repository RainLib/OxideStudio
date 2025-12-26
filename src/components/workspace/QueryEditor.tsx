import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { useTabStore } from "@/store/useTabStore";
import Editor from "@monaco-editor/react";
import { format } from "date-fns";
import {
  ChevronDown,
  History,
  Loader2,
  Paintbrush,
  Play,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function QueryEditor() {
  const { tabs, activeTabId, updateTabSql, runTabQuery } = useTabStore();
  const { activeConnectionId } = useConnectionStore();
  const history = useHistoryStore((s) => s.history);
  const { savedQueries, saveQuery, deleteQuery } = useSavedQueryStore();

  const [saveName, setSaveName] = useState("");
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [isRunDropdownOpen, setIsRunDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsRunDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleRun = () => {
    if (activeConnectionId && activeTab) {
      runTabQuery(activeTab.id, activeConnectionId);
    }
  };

  const handleSave = () => {
    if (activeTab && saveName.trim()) {
      saveQuery(saveName, activeTab.sql);
      setSaveName("");
      setIsSaveOpen(false);
    }
  };

  const handleFormat = () => {
    if (editorRef.current) {
      editorRef.current.getAction("editor.action.formatDocument").run();
    }
  };

  if (!activeTab) return null;

  return (
    <div className="relative h-full w-full bg-[#1e1e1e] group">
      {/* Editor */}
      <Editor
        height="100%"
        defaultLanguage="sql"
        value={activeTab.sql}
        onChange={(value) => updateTabSql(activeTab.id, value || "")}
        onMount={(editor) => (editorRef.current = editor)}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          fontSize: 16, // Slightly larger for "fashionable" look
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 24, bottom: 24 },
          lineNumbers: "on",
          renderLineHighlight: "all",
          smoothScrolling: true,
          cursorBlinking: "smooth",
        }}
      />

      {/* Floating Action Bar */}
      <div className="absolute bottom-6 right-6 flex items-center gap-3 z-50">
        {/* Format Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleFormat}
          className="h-9 w-9 bg-black/50 hover:bg-black/80 text-gray-400 hover:text-white backdrop-blur-sm transition-all rounded-full border border-white/10"
          title="Format Query"
        >
          <Paintbrush size={16} />
        </Button>

        {/* History Dialog & Button */}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 bg-black/50 hover:bg-black/80 text-gray-400 hover:text-white backdrop-blur-sm transition-all rounded-full border border-white/10"
              title="Query History"
            >
              <History size={16} />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col bg-[#1e1e1e] border-[#333] text-gray-200">
            <DialogHeader>
              <DialogTitle>Query History</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto border border-[#333] rounded-md bg-[#1a1a1a]">
              {history.length === 0 && (
                <div className="p-4 text-center text-gray-500">No history</div>
              )}
              {history.map((item) => (
                <div
                  key={item.id}
                  className="p-3 border-b border-[#333] hover:bg-[#252525] cursor-pointer flex flex-col gap-1"
                  onClick={() => updateTabSql(activeTab.id, item.sql)}
                >
                  <div className="font-mono text-xs text-gray-400 whitespace-pre-wrap max-h-20 overflow-hidden text-ellipsis">
                    {item.sql}
                  </div>
                  <div className="text-[10px] text-gray-500 text-right">
                    {format(item.timestamp, "MMM d, HH:mm:ss")}
                  </div>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Saved Queries Dialog & Button */}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 bg-black/50 hover:bg-black/80 text-gray-400 hover:text-white backdrop-blur-sm transition-all rounded-full border border-white/10"
              title="Saved Queries"
            >
              <Star size={16} />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col bg-[#1e1e1e] border-[#333] text-gray-200">
            <DialogHeader>
              <DialogTitle>Saved Queries</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto border border-[#333] rounded-md bg-[#1a1a1a]">
              {savedQueries.length === 0 && (
                <div className="p-4 text-center text-gray-500">
                  No saved queries
                </div>
              )}
              {savedQueries.map((item) => (
                <div
                  key={item.id}
                  className="p-3 border-b border-[#333] hover:bg-[#252525] flex items-center gap-2 group"
                >
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => updateTabSql(activeTab.id, item.sql)}
                  >
                    <div className="font-medium text-sm text-gray-300">
                      {item.name}
                    </div>
                    <div className="font-mono text-xs text-gray-500 whitespace-pre-wrap max-h-12 overflow-hidden text-ellipsis opacity-75">
                      {item.sql}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                    onClick={() => deleteQuery(item.id)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Save Dialog & Button */}
        <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
          <DialogTrigger asChild>
            <Button className="h-9 px-4 bg-black/50 hover:bg-black/80 text-white backdrop-blur-sm border border-white/10 font-medium transition-all rounded-md">
              Save
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-[#1e1e1e] border-[#333] text-gray-200">
            <DialogHeader>
              <DialogTitle>Save Query</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                placeholder="Query Name..."
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="bg-[#2a2a2a] border-[#444] text-white focus-visible:ring-orange-500"
              />
            </div>
            <DialogFooter>
              <Button
                onClick={handleSave}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Run Split Button */}
        <div
          className="relative flex items-center shadow-lg shadow-orange-900/20"
          ref={dropdownRef}
        >
          <Button
            onClick={handleRun}
            disabled={activeTab.isExecuting || !activeConnectionId}
            className={cn(
              "h-9 px-4 bg-white hover:bg-gray-100 text-black font-bold rounded-l-md rounded-r-none border-r border-gray-200 transition-all flex items-center gap-2",
              activeTab.isExecuting && "opacity-80 disabled:opacity-80"
            )}
          >
            {activeTab.isExecuting ? (
              <Loader2 className="animate-spin h-4 w-4 text-orange-600" />
            ) : (
              <Play size={16} className="fill-orange-600 text-orange-600" />
            )}
            RUN
          </Button>
          <Button
            size="icon"
            onClick={() => setIsRunDropdownOpen(!isRunDropdownOpen)}
            disabled={activeTab.isExecuting || !activeConnectionId}
            className="h-9 w-8 bg-white hover:bg-gray-100 text-gray-600 rounded-l-none rounded-r-md transition-all"
          >
            <ChevronDown size={16} />
          </Button>

          {/* Custom Dropdown Menu */}
          {isRunDropdownOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-48 bg-[#252525] border border-[#333] rounded-lg shadow-xl overflow-hidden flex flex-col py-1 animate-in fade-in slide-in-from-bottom-2">
              <button
                className="px-4 py-2 text-left text-xs text-gray-300 hover:bg-[#333] flex items-center gap-2 transition-colors"
                onClick={() => {
                  handleRun();
                  setIsRunDropdownOpen(false);
                }}
              >
                <Play size={12} /> Run Selection
              </button>
              <button
                className="px-4 py-2 text-left text-xs text-gray-300 hover:bg-[#333] flex items-center gap-2 transition-colors"
                onClick={() => {
                  // Placeholder for explain
                  setIsRunDropdownOpen(false);
                }}
              >
                <div className="w-3 h-3 rounded-full border border-gray-400 flex items-center justify-center text-[8px]">
                  ?
                </div>{" "}
                Explain Query
              </button>
              <div className="h-px bg-[#333] my-1" />
              <div className="px-4 py-1.5 text-[10px] text-gray-500 font-medium">
                SHORTCUTS
              </div>
              <div className="px-4 py-1 flex justify-between text-[11px] text-gray-400">
                <span>Run</span> <span className="opacity-50">Ctrl+Enter</span>
              </div>
              <div className="px-4 py-1 flex justify-between text-[11px] text-gray-400">
                <span>Format</span>{" "}
                <span className="opacity-50">Shift+Alt+F</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
