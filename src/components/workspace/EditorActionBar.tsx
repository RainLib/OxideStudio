import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { QueryHistoryItem } from "@/lib/queryHistory";
import {
  Braces,
  ChevronDown,
  BookmarkPlus,
  FileCode2,
  History,
  Play,
  Save,
  Square,
  Star,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";
import { SchemaSelector } from "./SchemaSelector";
import { TransactionControl } from "./TransactionControl";
import { QueryHistoryPanel } from "./QueryHistoryPanel";

type TransactionMode = "auto" | "manual";
type TransactionState = "idle" | "active";

interface EditorActionBarProps {
  connectionId?: string | null;
  currentSchema: string | null;
  onSchemaChange: (schema: string) => void;
  databases?: string[];
  currentDatabase?: string | null;
  onDatabaseChange?: (database: string) => void;
  isDatabaseRefreshing?: boolean;
  databaseSelectionDisabled?: boolean;
  transactionMode: TransactionMode;
  transactionState: TransactionState;
  onTransactionModeChange: (mode: TransactionMode) => void;
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
  onRollbackTransaction: () => void;
  onFormat: () => void;
  onRun: () => void;
  onRunCurrent: () => void;
  onCancelRun: () => void;
  isExecuting: boolean;
  isConnected: boolean;
  savedQueries: Array<{ id: string; name: string; sql: string }>;
  onOpenHistory: (item: QueryHistoryItem) => void;
  onRerunHistory: (item: QueryHistoryItem) => Promise<boolean>;
  onLoadQuery: (sql: string) => void;
  onSaveQuery: (name: string, sql: string) => void;
  onDeleteQuery: (id: string) => void;
  supportsTransactions: boolean;
  isProjectFile: boolean;
  isFileDirty: boolean;
  onSaveFile: () => void;
  parameterCount: number;
  onConfigureParameters: () => void;
}

const dialogClass =
  "flex max-h-[76vh] max-w-2xl flex-col gap-0 overflow-hidden rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]";
const historyDialogClass =
  "flex h-[min(720px,76vh)] max-w-4xl flex-col gap-0 overflow-hidden rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]";
const menuClass =
  "min-w-[230px] rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_16px_40px_rgba(0,0,0,0.42)]";
const menuItemClass =
  "h-7 cursor-default rounded-[3px] px-2 text-[12px] focus:bg-[hsl(var(--wb-active-strong))] focus:text-[hsl(var(--wb-text))]";

export function EditorActionBar({
  connectionId,
  currentSchema,
  onSchemaChange,
  databases,
  currentDatabase,
  onDatabaseChange,
  isDatabaseRefreshing,
  databaseSelectionDisabled,
  transactionMode,
  transactionState,
  onTransactionModeChange,
  onBeginTransaction,
  onCommitTransaction,
  onRollbackTransaction,
  onFormat,
  onRun,
  onRunCurrent,
  onCancelRun,
  isExecuting,
  isConnected,
  savedQueries,
  onOpenHistory,
  onRerunHistory,
  onLoadQuery,
  onSaveQuery,
  onDeleteQuery,
  supportsTransactions,
  isProjectFile,
  isFileDirty,
  onSaveFile,
  parameterCount,
  onConfigureParameters,
}: EditorActionBarProps) {
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const handleSave = () => {
    const normalizedName = saveName.trim();
    if (!normalizedName) return;
    onSaveQuery(normalizedName, "");
    setSaveName("");
    setIsSaveOpen(false);
  };

  return (
    <div className="wb-editor-commandbar justify-between gap-2">
      <div className="wb-editor-primary-actions flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        <button
          type="button"
          className={cn(
            "wb-icon-button",
            isExecuting ? "text-red-400" : "text-emerald-400"
          )}
          onClick={isExecuting ? onCancelRun : onRunCurrent}
          disabled={!isConnected}
          title={
            isExecuting
              ? "Stop Query"
              : parameterCount > 0
                ? `Set ${parameterCount} SQL ${parameterCount === 1 ? "parameter" : "parameters"} and run`
                : "Run Current Statement (⌘⇧Enter)"
          }
        >
          {isExecuting ? (
            <Square size={12} className="fill-current" />
          ) : (
            <Play size={14} className="fill-current" />
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="wb-icon-button h-6 w-4"
              disabled={!isConnected || isExecuting}
              title="Run Options"
            >
              <ChevronDown size={11} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={menuClass}>
            <DropdownMenuItem className={menuItemClass} onClick={onRunCurrent}>
              <Play size={13} className="mr-2 text-emerald-400" />
              Run Current Statement
              <span className="ml-auto text-[10px] wb-muted">⌘⇧↵</span>
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItemClass} onClick={onRun}>
              <FileCode2 size={13} className="mr-2" />
              Run Console
              <span className="ml-auto text-[10px] wb-muted">⌘↵</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {parameterCount > 0 && (
          <button
            type="button"
            className="wb-icon-button gap-1 px-1.5 text-[hsl(var(--wb-accent))]"
            aria-label={`Configure ${parameterCount} SQL ${parameterCount === 1 ? "parameter" : "parameters"}`}
            title="Configure SQL parameters"
            onClick={onConfigureParameters}
            disabled={isExecuting}
          >
            <Braces size={13} />
            <span className="text-[9px] font-semibold tabular-nums">
              {parameterCount}
            </span>
          </button>
        )}

        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="wb-editor-optional wb-icon-button"
              title="Query History"
            >
              <History size={13} />
            </button>
          </DialogTrigger>
          <DialogContent className={historyDialogClass}>
            <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
              <DialogTitle className="text-[13px]">Query History</DialogTitle>
            </DialogHeader>
            <QueryHistoryPanel
              onOpenInEditor={(item) => {
                onOpenHistory(item);
                setIsHistoryOpen(false);
              }}
              onRerun={async (item) => {
                const didRun = await onRerunHistory(item);
                if (didRun) setIsHistoryOpen(false);
                return didRun;
              }}
            />
          </DialogContent>
        </Dialog>

        <button
          type="button"
          className="wb-editor-optional wb-icon-button"
          onClick={onFormat}
          title="Format SQL (⌘L)"
        >
          <WandSparkles size={13} />
        </button>

        <span className="wb-editor-optional mx-1 h-4 w-px bg-[hsl(var(--wb-border-subtle))]" />
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

      <div className="wb-editor-secondary-actions flex min-w-0 shrink-0 items-center gap-0.5">
        {isProjectFile && (
          <button
            type="button"
            className={cn(
              "wb-editor-library-action wb-icon-button",
              isFileDirty && "text-[hsl(var(--wb-accent))]"
            )}
            title={isFileDirty ? "Save Project File (Ctrl+S)" : "Project File Saved"}
            onClick={onSaveFile}
            disabled={!isFileDirty}
          >
            <Save size={13} />
          </button>
        )}
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className="wb-editor-library-action wb-icon-button"
              title="Saved Queries"
            >
              <Star size={13} />
            </button>
          </DialogTrigger>
          <DialogContent className={dialogClass}>
            <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
              <DialogTitle className="text-[13px]">Saved Queries</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
              {savedQueries.length === 0 ? (
                <div className="p-6 text-center text-[12px] wb-muted">No saved queries</div>
              ) : (
                savedQueries.map((item) => (
                  <div
                    key={item.id}
                    className="group mb-1 flex items-center gap-2 rounded-[3px] px-3 py-2 hover:bg-[hsl(var(--wb-hover))]"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onLoadQuery(item.sql)}
                    >
                      <div className="truncate text-[12px] font-medium">{item.name}</div>
                      <div className="max-h-12 overflow-hidden whitespace-pre-wrap font-mono text-[10px] wb-muted">
                        {item.sql}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="wb-icon-button h-6 w-6 opacity-0 group-hover:opacity-100"
                      onClick={() => onDeleteQuery(item.id)}
                      title="Delete Saved Query"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={isSaveOpen} onOpenChange={setIsSaveOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="wb-editor-library-action wb-icon-button"
              title="Add to Saved Queries"
            >
              <BookmarkPlus size={13} />
            </button>
          </DialogTrigger>
          <DialogContent className="w-[420px] max-w-[calc(100vw-32px)] gap-0 rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
            <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
              <DialogTitle className="text-[13px]">Add to Saved Queries</DialogTitle>
            </DialogHeader>
            <div className="px-4 py-4">
              <Input
                autoFocus
                placeholder="Query name"
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSave();
                }}
                className="wb-field w-full"
              />
            </div>
            <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3">
              <Button className="wb-primary-button" onClick={handleSave}>
                Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <span className="wb-editor-library-action mx-1 h-4 w-px bg-[hsl(var(--wb-border-subtle))]" />
        <SchemaSelector
          connectionId={connectionId}
          currentSchema={currentSchema}
          onSchemaChange={onSchemaChange}
          databases={databases}
          currentDatabase={currentDatabase}
          onDatabaseChange={onDatabaseChange}
          isDatabaseRefreshing={isDatabaseRefreshing}
          databaseSelectionDisabled={databaseSelectionDisabled}
        />
      </div>
    </div>
  );
}
