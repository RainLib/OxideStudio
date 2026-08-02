import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Braces,
  Clock3,
  Columns3,
  FunctionSquare,
  TextCursorInput,
} from "lucide-react";
import type { GridColumn } from "@glideapps/glide-data-grid";
import { Input } from "@/components/ui/input";
import { useLspClient } from "@/hooks/useLspClient";
import {
  defaultDatabaseCapabilities,
  lspLanguageIdForCapabilities,
  supportsLspCapabilities,
} from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import {
  loadDataGridConditionHistory,
  type DataGridConditionHistoryScope,
} from "@/features/data-grid/model/conditionHistory";
import {
  buildWhereCompletionDocument,
  localWhereCompletionCandidates,
  mergeWhereCompletionCandidates,
  whereReplacementRange,
  type WhereCompletionCandidate,
} from "@/lib/whereCompletion";
import { getLspDocumentUri } from "@/services/lsp";
import { CompletionItemKind, type CompletionItem } from "@/services/lsp/types";
import type { DatabaseCapabilities, DatabaseDriver } from "@/services/tauri/types";

const COMPLETION_DEBOUNCE_MS = 55;
const COMPLETION_LIMIT = 80;

type WhereCompletionInputProps = {
  value: string;
  columns: readonly GridColumn[];
  onChange: (value: string) => void;
  onApply?: () => void;
  connectionId?: string | null;
  driver?: DatabaseDriver | null;
  /** The resolved, connection-pinned driver contract when available. */
  capabilities?: DatabaseCapabilities | null;
  tabId?: string | null;
  databaseName?: string | null;
  schemaName?: string | null;
  tableName?: string | null;
  /** Bumps after an outer Apply action so the history button stays current. */
  historyRevision?: number;
};

function completionIcon(kind?: number) {
  if (kind === CompletionItemKind.Field || kind === CompletionItemKind.Property) {
    return Columns3;
  }
  if (kind === CompletionItemKind.Function || kind === CompletionItemKind.Method) {
    return FunctionSquare;
  }
  if (kind === CompletionItemKind.Keyword || kind === CompletionItemKind.Operator) {
    return Braces;
  }
  return TextCursorInput;
}

function plainInsertText(value: string) {
  return value
    .replace(/\$\{\d+:([^}]*)\}/gu, "$1")
    .replace(/\$\{\d+\}/gu, "")
    .replace(/\$\d+/gu, "");
}

export function WhereCompletionInput({
  value,
  columns,
  onChange,
  onApply,
  connectionId,
  driver,
  capabilities,
  tabId,
  databaseName,
  schemaName,
  tableName,
  historyRevision = 0,
}: WhereCompletionInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef(value);
  const cursorRef = useRef(value.length);
  const timerRef = useRef<number | null>(null);
  const blurTimerRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  const versionRef = useRef(0);
  const openedRef = useRef(false);
  const [suggestions, setSuggestions] = useState<WhereCompletionCandidate[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const listboxId = useId();
  const resolvedCapabilities = useMemo(
    () =>
      capabilities && driver && capabilities.driver === driver
        ? capabilities
        : driver
          ? defaultDatabaseCapabilities(driver)
          : null,
    [capabilities, driver],
  );
  const canUseLsp = Boolean(
    connectionId &&
      driver &&
      tabId &&
      tableName &&
      resolvedCapabilities &&
      supportsLspCapabilities(resolvedCapabilities),
  );
  const { isReady, client } = useLspClient({
    connectionId,
    driver,
    enabled: canUseLsp,
    capabilities: resolvedCapabilities ?? undefined,
  });
  const documentUri = useMemo(
    () =>
      driver && tabId && resolvedCapabilities
        ? getLspDocumentUri(
            tabId,
            driver,
            lspLanguageIdForCapabilities(resolvedCapabilities),
          )
        : "",
    [driver, resolvedCapabilities, tabId],
  );
  const localColumns = useMemo(
    () =>
      columns.map((column) => ({
        name: String(column.id || column.title),
        type:
          typeof (column as GridColumn & { dataType?: unknown }).dataType ===
          "string"
            ? String((column as GridColumn & { dataType?: unknown }).dataType)
            : undefined,
      })),
    [columns],
  );
  const historyScope = useMemo<DataGridConditionHistoryScope>(
    () => ({ connectionId, databaseName, schemaName, tableName }),
    [connectionId, databaseName, schemaName, tableName],
  );
  const historyScopeKey = useMemo(
    () => [connectionId, databaseName, schemaName, tableName].join("\u0001"),
    [connectionId, databaseName, schemaName, tableName],
  );

  useEffect(() => {
    valueRef.current = value;
    cursorRef.current = Math.min(cursorRef.current, value.length);
  }, [value]);

  useEffect(() => {
    setHistory(loadDataGridConditionHistory(historyScope));
  }, [historyRevision, historyScope, historyScopeKey]);

  const closeSuggestions = useCallback(() => {
    setIsOpen(false);
    setSuggestions([]);
    setSelectedIndex(0);
  }, []);

  const historyCandidates = useCallback(
    (query = ""): WhereCompletionCandidate[] =>
      history
        .filter(
          (condition) =>
            !query.trim() ||
            condition.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        )
        .slice(0, COMPLETION_LIMIT)
        .map((condition, index) => ({
          label: condition,
          insertText: condition,
          detail: "Previously applied WHERE condition",
          kind: CompletionItemKind.Text,
          sortText: `0:${String(index).padStart(4, "0")}`,
          source: "history",
        })),
    [history],
  );

  const openHistory = useCallback(() => {
    const candidates = historyCandidates();
    setSuggestions(candidates);
    setSelectedIndex(0);
    setIsOpen(candidates.length > 0);
    inputRef.current?.focus();
  }, [historyCandidates]);

  const requestSuggestions = useCallback(
    async (condition: string, cursorOffset: number, manual: boolean) => {
      if (!driver || !tableName) return;
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      const local = localWhereCompletionCandidates({
        condition,
        cursorOffset,
        driver,
        identifierQuote: resolvedCapabilities?.identifierQuote,
        columns: localColumns,
      });

      if (manual || condition.trim()) {
        const visible = local.slice(0, COMPLETION_LIMIT);
        setSuggestions(visible);
        setSelectedIndex(0);
        setIsOpen(visible.length > 0);
      }

      if (!isReady || !documentUri || !connectionId) return;
      const completionDocument = buildWhereCompletionDocument({
        condition,
        cursorOffset,
        driver,
        schema: schemaName,
        table: tableName,
      });
      const version = versionRef.current + 1;
      versionRef.current = version;

      let items: CompletionItem[];
      try {
        if (openedRef.current) {
          await client.didChange(documentUri, completionDocument.text, version);
        } else {
          openedRef.current = true;
          try {
            await client.didOpen(
              documentUri,
              completionDocument.text,
              version,
              lspLanguageIdForCapabilities(resolvedCapabilities!),
            );
          } catch (error) {
            openedRef.current = false;
            throw error;
          }
        }
        items = await client.getCompletions(
          documentUri,
          completionDocument.line,
          completionDocument.character,
          { triggerKind: manual ? 1 : 3 },
        );
      } catch (error) {
        // The current table's columns are already visible as the instant
        // fallback. A cold or restarting LSP session must not interrupt grid
        // filtering, and the next keystroke will retry synchronization.
        console.debug("[WhereCompletion] LSP completion unavailable", error);
        return;
      }

      if (
        requestRef.current !== requestId ||
        valueRef.current !== condition ||
        cursorRef.current !== cursorOffset
      ) {
        return;
      }
      const merged = mergeWhereCompletionCandidates(local, items).slice(
        0,
        COMPLETION_LIMIT,
      );
      setSuggestions(merged);
      setSelectedIndex(0);
      setIsOpen(merged.length > 0);
    },
    [
      client,
      connectionId,
      documentUri,
      driver,
      isReady,
      localColumns,
      resolvedCapabilities,
      schemaName,
      tableName,
    ],
  );

  const scheduleSuggestions = useCallback(
    (condition: string, cursorOffset: number, manual = false) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (manual) {
        void requestSuggestions(condition, cursorOffset, true);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void requestSuggestions(condition, cursorOffset, false);
      }, COMPLETION_DEBOUNCE_MS);
    },
    [requestSuggestions],
  );

  const acceptSuggestion = useCallback(
    (candidate: WhereCompletionCandidate) => {
      const input = inputRef.current;
      const cursorOffset = input?.selectionStart ?? cursorRef.current;
      const replacement =
        candidate.source === "history"
          ? { start: 0, end: valueRef.current.length }
          : whereReplacementRange(valueRef.current, cursorOffset);
      const insertText = plainInsertText(candidate.insertText);
      const nextValue =
        valueRef.current.slice(0, replacement.start) +
        insertText +
        valueRef.current.slice(replacement.end);
      const nextCursor = Math.max(
        replacement.start,
        replacement.start +
          insertText.length -
          (candidate.cursorOffsetFromEnd || 0),
      );
      valueRef.current = nextValue;
      cursorRef.current = nextCursor;
      onChange(nextValue);
      closeSuggestions();
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextCursor, nextCursor);
        scheduleSuggestions(nextValue, nextCursor, true);
      });
    },
    [closeSuggestions, onChange, scheduleSuggestions],
  );

  useEffect(() => {
    return () => {
      requestRef.current += 1;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
      if (openedRef.current && documentUri) void client.didClose(documentUri);
      openedRef.current = false;
    };
  }, [client, documentUri]);

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          const cursorOffset = event.target.selectionStart ?? nextValue.length;
          valueRef.current = nextValue;
          cursorRef.current = cursorOffset;
          onChange(nextValue);
          scheduleSuggestions(nextValue, cursorOffset);
        }}
        onClick={(event) => {
          cursorRef.current = event.currentTarget.selectionStart ?? value.length;
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
            event.preventDefault();
            const cursorOffset = event.currentTarget.selectionStart ?? value.length;
            cursorRef.current = cursorOffset;
            scheduleSuggestions(valueRef.current, cursorOffset, true);
            return;
          }
          if (isOpen && suggestions.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelectedIndex((index) => (index + 1) % suggestions.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelectedIndex(
                (index) => (index - 1 + suggestions.length) % suggestions.length,
              );
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              acceptSuggestion(suggestions[selectedIndex]!);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              closeSuggestions();
              return;
            }
          }
          if (event.key === "Enter") {
            onApply?.();
          }
        }}
        onBlur={() => {
          blurTimerRef.current = window.setTimeout(closeSuggestions, 100);
        }}
        placeholder="SQL condition, for example: status = 'active'"
        aria-label="SQL WHERE condition"
        aria-autocomplete="list"
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-activedescendant={
          isOpen ? `${listboxId}-${selectedIndex}` : undefined
        }
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "h-6 w-full border-transparent bg-transparent px-2 font-mono text-[11px] focus-visible:border-[hsl(var(--wb-border))] focus-visible:ring-0",
          history.length > 0 && "pr-7",
        )}
      />
      {history.length > 0 && (
        <button
          type="button"
          className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-[3px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
          title="Reuse a previously applied WHERE condition"
          aria-label="Show WHERE condition history"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openHistory}
        >
          <Clock3 size={11} />
        </button>
      )}

      {isOpen && suggestions.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+2px)] z-50 max-h-64 overflow-y-auto rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-popover))] py-1 shadow-xl"
          onMouseDown={(event) => event.preventDefault()}
        >
          {suggestions.map((suggestion, index) => {
            const Icon = completionIcon(suggestion.kind);
            return (
              <button
                key={`${suggestion.label}:${suggestion.source}`}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                className={cn(
                  "flex h-7 w-full min-w-0 items-center gap-2 px-2 text-left text-[11px]",
                  index === selectedIndex
                    ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                    : "text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))]",
                )}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => acceptSuggestion(suggestion)}
              >
                <Icon size={12} className="shrink-0 wb-muted" />
                <span className="min-w-0 flex-1 truncate font-mono">
                  {suggestion.label}
                </span>
                {suggestion.detail && (
                  <span className="max-w-[48%] truncate text-[10px] wb-muted">
                    {suggestion.detail}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
