import Editor from "@monaco-editor/react";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { Button } from "@/components/ui/button";
import {
  Play,
  Loader2,
  History,
  Star,
  Save,
  Trash2,
  Paintbrush,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { useState } from "react";

export function QueryEditor() {
  const { tabs, activeTabId, updateTabSql, runTabQuery } = useTabStore();
  const { activeConnectionId } = useConnectionStore();
  const history = useHistoryStore((s) => s.history);
  const { savedQueries, saveQuery, deleteQuery } = useSavedQueryStore();

  const [saveName, setSaveName] = useState("");
  const [isSaveOpen, setIsSaveOpen] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId);

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
    // Placeholder for formatting
  };

  if (!activeTab) return null;

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e]">
      {/* Row 1: Primary Actions */}
      <div className="h-11 border-b border-[#333] flex items-center px-4 bg-[#252525] gap-2 shrink-0">
        <Button
          onClick={handleRun}
          disabled={activeTab.isExecuting || !activeConnectionId}
          size="sm"
          className="h-7 px-4 bg-orange-600 hover:bg-orange-700 text-white border-none text-[11px] gap-1.5 font-bold rounded"
        >
          {activeTab.isExecuting ? (
            <Loader2 className="animate-spin h-3 w-3" />
          ) : (
            <Play size={12} className="fill-white text-white" />
          )}
          RUN
        </Button>

        <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-3 text-gray-400 hover:text-gray-200 hover:bg-[#333] text-[11px] gap-1.5"
            >
              <Save size={12} />
              Save
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save Query</DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <Input
                placeholder="Query Name..."
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button onClick={handleSave}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="ml-auto text-[10px] text-gray-500 font-medium tracking-tight">
          Auto Commit
        </div>
      </div>

      {/* Row 2: Secondary Iconic Actions */}
      <div className="h-9 border-b border-[#333] flex items-center px-2 bg-[#252525] gap-1 shrink-0">
        <Button
          onClick={handleRun}
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-gray-400 hover:text-white hover:bg-[#333] text-[11px] gap-1.5"
          disabled={activeTab.isExecuting || !activeConnectionId}
        >
          <Play size={14} className="fill-gray-400" />
          Run
        </Button>

        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-gray-400 hover:text-white hover:bg-[#333] text-[11px] gap-1.5"
            >
              <History size={14} /> History
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

        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-gray-400 hover:text-white hover:bg-[#333] text-[11px] gap-1.5"
            >
              <Star size={14} /> Saved
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

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-gray-400 hover:text-white hover:bg-[#333] text-[11px] gap-1.5"
          onClick={() => setIsSaveOpen(true)}
        >
          <Save size={14} /> Save
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-gray-400 hover:text-white hover:bg-[#333] text-[11px] gap-1.5"
          onClick={handleFormat}
        >
          <Paintbrush size={14} /> Format
        </Button>

        <div className="h-4 w-px bg-[#333] mx-1" />

        <div className="text-[10px] text-gray-500 ml-2">
          {activeTab.results ? "Results ready" : "No results"}
        </div>

        <div className="text-xs text-gray-600 ml-auto mr-4 italic select-none">
          {activeConnectionId ? "Connected" : "Not connected"}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={activeTab.sql}
          onChange={(value) => updateTabSql(activeTab.id, value || "")}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}
