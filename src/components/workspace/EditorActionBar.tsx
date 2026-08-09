import {
  Dialog,
  DialogClose,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import type { QueryHistoryItem } from "@/lib/queryHistory";
import {
  Braces,
  ChevronDown,
  Download,
  BookmarkPlus,
  FileCode2,
  History,
  LineChart,
  LoaderCircle,
  Play,
  Save,
  ScanSearch,
  Square,
  Star,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { useState } from "react";
import type { QueryLanguage } from "@/store/useTabStore";
import { SchemaSelector } from "./SchemaSelector";
import { TransactionControl } from "./TransactionControl";
import { QueryHistoryPanel } from "./QueryHistoryPanel";

type TransactionMode = "auto" | "manual";
type TransactionState = "idle" | "active";
type TransactionOperation = "begin" | "commit" | "rollback" | null;
type EditorFileOperation =
  | "sql-review"
  | "sql-import"
  | "console-import"
  | "console-export"
  | null;

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
  transactionOperation: TransactionOperation;
  onTransactionModeChange: (mode: TransactionMode) => void;
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
  onRollbackTransaction: () => void;
  onFormat: () => void;
  onRun: () => void;
  onRunCurrent: () => void;
  onExplain: (mode: "estimate" | "analyze") => void;
  onCancelRun: () => void;
  onImportSqlScript?: () => void;
  onImportConsoleRequests?: () => void;
  onExportConsoleRequests?: () => void;
  fileOperation: EditorFileOperation;
  isExecuting: boolean;
  isConnected: boolean;
  supportsExplainPlan: boolean;
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
  queryLanguage?: QueryLanguage;
  onQueryLanguageChange?: (language: QueryLanguage) => void;
  elasticsearchVariableNames?: string[];
  elasticsearchVariables?: Record<string, string>;
  onElasticsearchVariableChange?: (name: string, value: string) => void;
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
  transactionOperation,
  onTransactionModeChange,
  onBeginTransaction,
  onCommitTransaction,
  onRollbackTransaction,
  onFormat,
  onRun,
  onRunCurrent,
  onExplain,
  onCancelRun,
  onImportSqlScript,
  onImportConsoleRequests,
  onExportConsoleRequests,
  fileOperation,
  isExecuting,
  isConnected,
  supportsExplainPlan,
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
  queryLanguage,
  onQueryLanguageChange,
  elasticsearchVariableNames = [],
  elasticsearchVariables = {},
  onElasticsearchVariableChange,
}: EditorActionBarProps) {
  const { t } = useI18n();
  const [isSaveOpen, setIsSaveOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const isElasticsearchDsl = queryLanguage === "elasticsearch-dsl";
  const currentExecutionLabel = isElasticsearchDsl
    ? "Run Selected / Current Request"
    : "Run Current Statement";
  const consoleExecutionLabel = isElasticsearchDsl
    ? "Run All Requests"
    : "Run Console";
  const currentExecutionShortcut = isElasticsearchDsl ? "⌘↵" : "⌘⇧↵";
  const consoleExecutionShortcut = isElasticsearchDsl ? "⌘⇧↵" : "⌘↵";
  const missingVariableCount = elasticsearchVariableNames.filter(
    (name) => !Object.prototype.hasOwnProperty.call(elasticsearchVariables, name),
  ).length;

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
            isExecuting ? "text-red-400" : "text-emerald-400",
          )}
          onClick={isExecuting ? onCancelRun : onRunCurrent}
          disabled={!isConnected}
          title={
            isExecuting
              ? "Stop Query"
              : parameterCount > 0
                ? `Set ${parameterCount} SQL ${parameterCount === 1 ? "parameter" : "parameters"} and run`
                : `${currentExecutionLabel} (${currentExecutionShortcut})`
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
              {currentExecutionLabel}
              <span className="ml-auto text-[10px] wb-muted">
                {currentExecutionShortcut}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem className={menuItemClass} onClick={onRun}>
              <FileCode2 size={13} className="mr-2" />
              {consoleExecutionLabel}
              <span className="ml-auto text-[10px] wb-muted">
                {consoleExecutionShortcut}
              </span>
            </DropdownMenuItem>
            {(onImportSqlScript ||
              onImportConsoleRequests ||
              onExportConsoleRequests) && (
              <>
                <div className="my-1 h-px bg-[hsl(var(--wb-border-subtle))]" />
                {onImportSqlScript && (
                  <DropdownMenuItem
                    className={menuItemClass}
                    onClick={onImportSqlScript}
                    disabled={fileOperation !== null}
                  >
                    {fileOperation === "sql-review" ||
                    fileOperation === "sql-import" ? (
                      <LoaderCircle size={13} className="mr-2 animate-spin" />
                    ) : (
                      <Upload size={13} className="mr-2" />
                    )}
                    {fileOperation === "sql-review"
                      ? "Reviewing SQL Script..."
                      : fileOperation === "sql-import"
                        ? "Importing SQL Script..."
                        : "Import SQL Script..."}
                  </DropdownMenuItem>
                )}
                {onImportConsoleRequests && (
                  <DropdownMenuItem
                    className={menuItemClass}
                    onClick={onImportConsoleRequests}
                    disabled={fileOperation !== null}
                  >
                    {fileOperation === "console-import" ? (
                      <LoaderCircle size={13} className="mr-2 animate-spin" />
                    ) : (
                      <Upload size={13} className="mr-2" />
                    )}
                    {fileOperation === "console-import"
                      ? "Importing Console Requests..."
                      : "Import Console Requests..."}
                  </DropdownMenuItem>
                )}
                {onExportConsoleRequests && (
                  <DropdownMenuItem
                    className={menuItemClass}
                    onClick={onExportConsoleRequests}
                    disabled={fileOperation !== null}
                  >
                    {fileOperation === "console-export" ? (
                      <LoaderCircle size={13} className="mr-2 animate-spin" />
                    ) : (
                      <Download size={13} className="mr-2" />
                    )}
                    {fileOperation === "console-export"
                      ? "Exporting Console Requests..."
                      : "Export Console Requests..."}
                  </DropdownMenuItem>
                )}
              </>
            )}
            {supportsExplainPlan && (
              <>
                <div className="my-1 h-px bg-[hsl(var(--wb-border-subtle))]" />
                <DropdownMenuItem
                  className={menuItemClass}
                  onClick={() => onExplain("estimate")}
                  disabled={parameterCount > 0}
                >
                  <LineChart
                    size={13}
                    className="mr-2 text-[hsl(var(--wb-accent))]"
                  />
                  Explain Plan
                  <span className="ml-auto text-[9px] wb-muted">estimates</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className={menuItemClass}
                  onClick={() => onExplain("analyze")}
                  disabled={parameterCount > 0}
                >
                  <ScanSearch size={13} className="mr-2" />
                  Explain Analyze
                  <span className="ml-auto text-[9px] wb-muted">executes</span>
                </DropdownMenuItem>
              </>
            )}
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
          title={
            isElasticsearchDsl
              ? "Auto-indent Current Request (⌘I)"
              : "Format SQL (⌘L)"
          }
        >
          <WandSparkles size={13} />
        </button>

        <span className="wb-editor-optional mx-1 h-4 w-px bg-[hsl(var(--wb-border-subtle))]" />
        {supportsTransactions && (
          <TransactionControl
            mode={transactionMode}
            state={transactionState}
            operation={transactionOperation}
            onModeChange={onTransactionModeChange}
            onBegin={onBeginTransaction}
            onCommit={onCommitTransaction}
            onRollback={onRollbackTransaction}
          />
        )}
      </div>

      <div className="wb-editor-secondary-actions flex min-w-0 shrink-0 items-center gap-0.5">
        {isElasticsearchDsl &&
          elasticsearchVariableNames.length > 0 &&
          onElasticsearchVariableChange && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "wb-text-button h-6 gap-1 px-1.5 text-[10px]",
                    missingVariableCount > 0 && "text-amber-400",
                  )}
                  title={t("elasticsearch.variables.title")}
                >
                  <Braces size={11} />
                  {elasticsearchVariableNames.length}
                  {missingVariableCount > 0 && (
                    <span className="text-[9px]">
                      {t("elasticsearch.variables.missing", {
                        count: missingVariableCount,
                      })}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-80 rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_8px_24px_rgba(0,0,0,0.36)]"
              >
                <div className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2">
                  <div className="text-[11px] font-semibold">
                    {t("elasticsearch.variables.title")}
                  </div>
                  <p className="mt-0.5 text-[10px] leading-4 wb-muted">
                    {t("elasticsearch.variables.description")}
                  </p>
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto p-3">
                  {elasticsearchVariableNames.map((name) => (
                    <label key={name} className="block">
                      <span className="mb-1 block font-mono text-[10px] wb-muted">
                        {"${"}
                        {name}
                        {"}"}
                      </span>
                      <Input
                        value={elasticsearchVariables[name] ?? ""}
                        onChange={(event) =>
                          onElasticsearchVariableChange(name, event.target.value)
                        }
                        placeholder={t("elasticsearch.variables.value", {
                          name,
                        })}
                        className="h-7 rounded-[4px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[11px]"
                      />
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
        {queryLanguage && onQueryLanguageChange && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="wb-text-button h-6 gap-1 px-1.5 text-[10px]"
                title="Elasticsearch query language"
              >
                {queryLanguage === "elasticsearch-eql" ? "EQL" : "Query DSL"}
                <ChevronDown size={10} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={menuClass}>
              <DropdownMenuItem
                className={menuItemClass}
                onClick={() => onQueryLanguageChange("elasticsearch-dsl")}
              >
                Query DSL
                <span className="ml-auto text-[9px] wb-muted">JSON / REST</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className={menuItemClass}
                onClick={() => onQueryLanguageChange("elasticsearch-eql")}
              >
                EQL
                <span className="ml-auto text-[9px] wb-muted">ES 7.9+</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {isProjectFile && (
          <button
            type="button"
            className={cn(
              "wb-editor-library-action wb-icon-button",
              isFileDirty && "text-[hsl(var(--wb-accent))]",
            )}
            title={
              isFileDirty ? "Save Project File (Ctrl+S)" : "Project File Saved"
            }
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
                <div className="p-6 text-center text-[12px] wb-muted">
                  No saved queries
                </div>
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
                      <div className="truncate text-[12px] font-medium">
                        {item.name}
                      </div>
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
          <DialogContent className="w-[360px] max-w-[calc(100vw-32px)] gap-0 overflow-hidden rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_8px_20px_rgba(0,0,0,0.44)] [&>button.absolute]:right-2 [&>button.absolute]:top-2 [&>button.absolute]:flex [&>button.absolute]:h-5 [&>button.absolute]:w-5 [&>button.absolute]:items-center [&>button.absolute]:justify-center">
            <DialogHeader className="flex h-9 flex-row items-center gap-2 space-y-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.72)] px-3">
              <BookmarkPlus size={12} className="text-[hsl(var(--wb-accent))]" />
              <DialogTitle className="text-[12px]">
                Add to Saved Queries
              </DialogTitle>
            </DialogHeader>
            <div className="px-3 py-3">
              <label
                htmlFor="saved-query-name"
                className="mb-1.5 block text-[10px] text-[hsl(var(--wb-text-muted))]"
              >
                Query name
              </label>
              <input
                id="saved-query-name"
                autoFocus
                placeholder="For example, Active customers"
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSave();
                }}
                className="wb-field w-full"
              />
            </div>
            <DialogFooter className="flex h-11 flex-row items-center justify-end gap-1 space-x-0 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.42)] px-3 py-0">
              <DialogClose asChild>
                <button type="button" className="wb-text-button h-7 px-3">
                  Cancel
                </button>
              </DialogClose>
              <button
                type="button"
                className="wb-primary-button"
                onClick={handleSave}
                disabled={!saveName.trim()}
              >
                Add
              </button>
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
