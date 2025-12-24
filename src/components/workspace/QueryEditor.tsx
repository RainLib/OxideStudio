import Editor from "@monaco-editor/react";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { Button } from "@/components/ui/button";
import { Play, Loader2, History, Star, Save, Trash2, Paintbrush } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { useState } from "react";

export function QueryEditor() {
  const { tabs, activeTabId, updateTabSql, runTabQuery } = useTabStore();
  const { activeConnectionId } = useConnectionStore();
  const history = useHistoryStore(s => s.history);
  const { savedQueries, saveQuery, deleteQuery } = useSavedQueryStore();

  const [saveName, setSaveName] = useState("");
  const [isSaveOpen, setIsSaveOpen] = useState(false);

  const activeTab = tabs.find(t => t.id === activeTabId);

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
    <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="h-10 border-b flex items-center px-2 bg-muted/20 gap-2">
            <Button
                onClick={handleRun}
                disabled={activeTab.isExecuting || !activeConnectionId}
                size="sm"
                className="h-7 text-xs gap-1"
            >
                {activeTab.isExecuting ? <Loader2 className="animate-spin h-3 w-3" /> : <Play className="h-3 w-3 fill-current" />}
                Run
            </Button>

            {/* History Dialog */}
            <Dialog>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                        <History size={14} /> History
                    </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Query History</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto border rounded-md">
                        {history.length === 0 && <div className="p-4 text-center text-muted-foreground">No history</div>}
                        {history.map(item => (
                            <div
                                key={item.id}
                                className="p-3 border-b hover:bg-muted/50 cursor-pointer flex flex-col gap-1"
                                onClick={() => updateTabSql(activeTab.id, item.sql)}
                            >
                                <div className="font-mono text-xs text-muted-foreground whitespace-pre-wrap max-h-20 overflow-hidden text-ellipsis">
                                    {item.sql}
                                </div>
                                <div className="text-[10px] text-muted-foreground text-right">
                                    {format(item.timestamp, "MMM d, HH:mm:ss")}
                                </div>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Saved Queries Dialog */}
             <Dialog>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                        <Star size={14} /> Saved
                    </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Saved Queries</DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto border rounded-md">
                        {savedQueries.length === 0 && <div className="p-4 text-center text-muted-foreground">No saved queries</div>}
                        {savedQueries.map(item => (
                            <div
                                key={item.id}
                                className="p-3 border-b hover:bg-muted/50 flex items-center gap-2 group"
                            >
                                <div
                                    className="flex-1 cursor-pointer"
                                    onClick={() => updateTabSql(activeTab.id, item.sql)}
                                >
                                    <div className="font-medium text-sm">{item.name}</div>
                                    <div className="font-mono text-xs text-muted-foreground whitespace-pre-wrap max-h-12 overflow-hidden text-ellipsis opacity-75">
                                        {item.sql}
                                    </div>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive"
                                    onClick={() => deleteQuery(item.id)}
                                >
                                    <Trash2 size={12} />
                                </Button>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Save Button */}
            <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
                <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                        <Save size={14} /> Save
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
                            onChange={e => setSaveName(e.target.value)}
                        />
                    </div>
                    <DialogFooter>
                        <Button onClick={handleSave}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={handleFormat} disabled>
                <Paintbrush size={14} /> Format
            </Button>

            <div className="text-xs text-muted-foreground ml-auto">
                {activeConnectionId ? "Connected" : "No Connection"}
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
