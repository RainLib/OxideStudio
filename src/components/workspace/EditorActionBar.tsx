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
  Paintbrush,
  Play,
  Square,
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
  onCancelRun: () => void;
  isExecuting: boolean;
  isConnected: boolean;
  history: Array<{ id: string; sql: string; timestamp: number }>;
  savedQueries: Array<{ id: string; name: string; sql: string }>;
  onLoadQuery: (sql: string) => void;
  onSaveQuery: (name: string, sql: string) => void;
  onDeleteQuery: (id: string) => void;
  supportsTransactions: boolean;
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
  onCancelRun,
  isExecuting,
  isConnected,
  history,
  savedQueries,
  onLoadQuery,
  onSaveQuery,
  onDeleteQuery,
  supportsTransactions,
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
    <div className="wb-toolbar flex items-center justify-between">
      {/* Left Side - Transaction Control */}
      <div className="flex items-center gap-3">
        {supportsTransactions && (
          <TransactionControl
            mode={transactionMode}
            state={transactionState}
            onModeChange={onTransactionModeChange}
            onBegin={onBeginTransaction}
            onCommit={onCommitTransaction}
            onRollback={onRollbackTransaction}
          />
        )}
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
          className="wb-icon-button"
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
            className="wb-icon-button"
              title="Query History"
            >
              <History size={14} />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col bg-[hsl(var(--wb-panel-raised))] border-[hsl(var(--wb-border))] text-[hsl(var(--wb-text))]">
            <DialogHeader>
              <DialogTitle>Query History</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto border border-[hsl(var(--wb-border-subtle))] rounded-[4px] bg-[hsl(var(--wb-panel))]">
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
              className="wb-icon-button"
              title="Saved Queries"
            >
              <Star size={14} />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col bg-[hsl(var(--wb-panel-raised))] border-[hsl(var(--wb-border))] text-[hsl(var(--wb-text))]">
            <DialogHeader>
              <DialogTitle>Saved Queries</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto border border-[hsl(var(--wb-border-subtle))] rounded-[4px] bg-[hsl(var(--wb-panel))]">
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
            <Button className="wb-text-button border border-[hsl(var(--wb-border-subtle))]">
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
            onClick={isExecuting ? onCancelRun : onRun}
            disabled={!isConnected}
            className={cn(
              "h-7 px-3 bg-[hsl(var(--wb-accent))] text-[hsl(var(--wb-accent-foreground))] hover:brightness-110 text-[11px] font-semibold rounded-l-[4px] rounded-r-none transition-all flex items-center gap-1.5 min-w-[70px]",
              isExecuting && "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            )}
          >
            {isExecuting ? (
              <>
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Cancel</span>
              </>
            ) : (
              <>
                <Play size={14} className="fill-primary text-primary" />
                <span>Run</span>
              </>
            )}
          </Button>
          <Button
            size="icon"
            onClick={() => setIsRunDropdownOpen(!isRunDropdownOpen)}
            disabled={isExecuting || !isConnected}
            className="h-7 w-6 bg-[hsl(var(--wb-accent))] text-[hsl(var(--wb-accent-foreground))] hover:brightness-110 rounded-l-none rounded-r-[4px] transition-all border-l border-black/10"
          >
            <ChevronDown size={14} />
          </Button>

          {/* Custom Dropdown Menu */}
          {isRunDropdownOpen && (
            <div className="absolute top-full right-0 mt-1 w-48 bg-background-elevated border border-border rounded-[4px] overflow-hidden flex flex-col py-1 z-50">
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
                Shortcuts
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
