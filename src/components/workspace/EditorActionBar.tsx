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
import { TransactionControl } from "./TransactionControl";
import { SchemaSelector } from "./SchemaSelector";
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
import { useRef, useState } from "react";

type TransactionMode = "auto" | "manual";
type TransactionState = "idle" | "active";

interface EditorActionBarProps {
  currentSchema: string | null;
  onSchemaChange: (schema: string) => void;
  transactionMode: TransactionMode;
  transactionState: TransactionState;
  onTransactionModeChange: (mode: TransactionMode) => void;
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
  onRollbackTransaction: () => void;
  onFormat: () => void;
  onRun: () => void;
  isExecuting: boolean;
  isConnected: boolean;
  history: Array<{ id: string; sql: string; timestamp: number }>;
  savedQueries: Array<{ id: string; name: string; sql: string }>;
  onLoadQuery: (sql: string) => void;
  onSaveQuery: (name: string, sql: string) => void;
  onDeleteQuery: (id: string) => void;
}

export function EditorActionBar({
  currentSchema,
  onSchemaChange,
  transactionMode,
  transactionState,
  onTransactionModeChange,
  onBeginTransaction,
  onCommitTransaction,
  onRollbackTransaction,
  onFormat,
  onRun,
  isExecuting,
  isConnected,
  history,
  savedQueries,
  onLoadQuery,
  onSaveQuery,
  onDeleteQuery,
}: EditorActionBarProps) {
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [isRunDropdownOpen, setIsRunDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleSave = () => {
    if (saveName.trim()) {
      onSaveQuery(saveName, ""); // SQL will be passed from parent
      setSaveName("");
      setIsSaveOpen(false);
    }
  };

  return (
    <div className="h-10 shrink-0 bg-background-primary border-t border-border flex items-center justify-between px-3">
      {/* Left Side - Transaction Control */}
      <div className="flex items-center gap-3">
        <TransactionControl
          mode={transactionMode}
          state={transactionState}
          onModeChange={onTransactionModeChange}
          onBegin={onBeginTransaction}
          onCommit={onCommitTransaction}
          onRollback={onRollbackTransaction}
        />
      </div>

      {/* Right Side - Action Buttons */}
      <div className="flex items-center gap-2">
        {/* Schema Selector */}
        <SchemaSelector
          currentSchema={currentSchema}
          onSchemaChange={onSchemaChange}
        />

        {/* Format Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onFormat}
          className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background-elevated"
          title="Format Query"
        >
          <Paintbrush size={14} />
        </Button>

        {/* History Dialog & Button */}
        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-background-elevated"
              title="Query History"
            >
              <History size={14} />
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
                  className="p-3 border-b border-border hover:bg-background-tertiary cursor-pointer flex flex-col gap-1"
                  onClick={() => onLoadQuery(item.sql)}
                >
                  <div className="font-mono text-xs text-muted-foreground/80 whitespace-pre-wrap max-h-20 overflow-hidden text-ellipsis">
                    {item.sql}
                  </div>
                  <div className="text-[10px] text-muted-foreground/50 text-right">
                    {format(new Date(item.timestamp), "MMM d, HH:mm:ss")}
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
              className="h-8 w-8 text-gray-400 hover:text-white hover:bg-[#2a2a2a]"
              title="Saved Queries"
            >
              <Star size={14} />
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
                  className="p-3 border-b border-border hover:bg-background-tertiary flex items-center gap-2 group"
                >
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => onLoadQuery(item.sql)}
                  >
                    <div className="font-medium text-sm text-foreground">
                      {item.name}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground/60 whitespace-pre-wrap max-h-12 overflow-hidden text-ellipsis opacity-75">
                      {item.sql}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                    onClick={() => onDeleteQuery(item.id)}
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
            <Button className="h-8 px-3 text-xs bg-background-elevated hover:bg-background-tertiary text-foreground font-medium border border-border">
              Save
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-background-elevated border-border text-foreground">
            <DialogHeader>
              <DialogTitle>Save Query</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                placeholder="Query Name..."
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="bg-background-tertiary border-border text-foreground focus-visible:ring-primary"
              />
            </div>
            <DialogFooter>
              <Button
                onClick={handleSave}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Run Split Button */}
        <div className="relative flex items-center shadow-sm" ref={dropdownRef}>
          <Button
            onClick={onRun}
            disabled={isExecuting || !isConnected}
            className={cn(
              "h-8 px-3 bg-foreground text-background hover:bg-foreground/90 text-xs font-bold rounded-l-md rounded-r-none border-r border-background/20 transition-all flex items-center gap-1.5",
              isExecuting && "opacity-80 disabled:opacity-80"
            )}
          >
            {isExecuting ? (
              <Loader2 className="animate-spin h-3.5 w-3.5 text-primary" />
            ) : (
              <Play size={14} className="fill-primary text-primary" />
            )}
            RUN
          </Button>
          <Button
            size="icon"
            onClick={() => setIsRunDropdownOpen(!isRunDropdownOpen)}
            disabled={isExecuting || !isConnected}
            className="h-8 w-7 bg-foreground text-background hover:bg-foreground/90 rounded-l-none rounded-r-md transition-all border-l border-background/10"
          >
            <ChevronDown size={14} />
          </Button>

          {/* Custom Dropdown Menu */}
          {isRunDropdownOpen && (
            <div className="absolute bottom-full right-0 mb-2 w-48 bg-background-elevated border border-border rounded-lg shadow-xl overflow-hidden flex flex-col py-1">
              <button
                className="px-4 py-2 text-left text-xs text-foreground hover:bg-background-tertiary flex items-center gap-2 transition-colors"
                onClick={() => {
                  onRun();
                  setIsRunDropdownOpen(false);
                }}
              >
                <Play size={12} className="text-primary" /> Run Selection
              </button>
              <button
                className="px-4 py-2 text-left text-xs text-foreground hover:bg-background-tertiary flex items-center gap-2 transition-colors"
                onClick={() => {
                  setIsRunDropdownOpen(false);
                }}
              >
                <div className="w-3 h-3 rounded-full border border-muted-foreground flex items-center justify-center text-[8px]">
                  ?
                </div>
                Explain Query
              </button>
              <div className="h-px bg-border my-1" />
              <div className="px-4 py-1.5 text-[10px] text-muted-foreground/60 font-medium">
                SHORTCUTS
              </div>
              <div className="px-4 py-1 flex justify-between text-[11px] text-muted-foreground/80">
                <span>Run</span> <span className="opacity-50">Ctrl+Enter</span>
              </div>
              <div className="px-4 py-1 flex justify-between text-[11px] text-muted-foreground/80">
                <span>Format</span>
                <span className="opacity-50">Shift+Alt+F</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
