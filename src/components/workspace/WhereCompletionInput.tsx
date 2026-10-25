import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
import { Input } from "@/components/ui/input";
import { useLspClient } from "@/hooks/useLspClient";
import {
  defaultDatabaseCapabilities,
  supportsLspCapabilities,
} from "@/lib/databaseDialect";
import { cn } from "@/lib/utils";
import {
  isDataGridConditionUndoRedoShortcut,
  loadDataGridConditionHistory,
  type DataGridConditionHistoryScope,
} from "@/features/data-grid/model/conditionHistory";
import {
  whereReplacementRange,
  type WhereCompletionCandidate,
} from "@/lib/whereCompletion";
import {useWhereCompletion} from "@/features/data-grid/hooks/useWhereCompletion";
import type {WhereCompletionInteraction} from "@/features/data-grid/model/whereCompletionSession";
import { CompletionItemKind } from "@/services/lsp/types";
import type { DatabaseCapabilities, DatabaseDriver } from "@/services/tauri/types";

const COMPLETION_DEBOUNCE_MS = 55;
const COMPLETION_LIMIT = 80;

type WhereCompletionInputProps = {
  value: string;
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
  const interactionEpochRef=useRef(0);
  const timerRef = useRef<number | null>(null);
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
  const { client, sessionKey } = useLspClient({
    connectionId,
    driver,
    enabled: canUseLsp,
    capabilities: resolvedCapabilities ?? undefined,
  });
  const historyScope = useMemo<DataGridConditionHistoryScope>(
    () => ({ connectionId, databaseName, schemaName, tableName }),
    [connectionId, databaseName, schemaName, tableName],
  );
  const historyScopeKey = useMemo(
    () => [connectionId, databaseName, schemaName, tableName].join("\u0001"),
    [connectionId, databaseName, schemaName, tableName],
  );

  useEffect(() => {
    setHistory(loadDataGridConditionHistory(historyScope));
  }, [historyRevision, historyScope, historyScopeKey]);

  const hideSuggestions=useCallback(()=>{
    const list=inputRef.current?.ownerDocument.getElementById(listboxId);
    if(list)list.hidden=true;
    inputRef.current?.setAttribute("aria-expanded","false");
    inputRef.current?.removeAttribute("aria-activedescendant");
  },[listboxId]);
  const closeSuggestions = useCallback(() => {
    hideSuggestions();
    setIsOpen(false);
    setSuggestions([]);
    setSelectedIndex(0);
  }, [hideSuggestions]);
  useLayoutEffect(()=>{
    if(!isOpen||!suggestions.length)return;
    const list=inputRef.current?.ownerDocument.getElementById(listboxId);
    if(list)list.hidden=false;
    inputRef.current?.setAttribute("aria-expanded","true");
    inputRef.current?.setAttribute("aria-activedescendant",`${listboxId}-${selectedIndex}`);
  },[isOpen,suggestions,listboxId,selectedIndex]);

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

  const publishSuggestions=useCallback((items:WhereCompletionCandidate[])=>{
    if(!items.length)hideSuggestions();
    setSuggestions(items);setSelectedIndex(0);setIsOpen(items.length>0);
  },[hideSuggestions]);
  const isCurrentInteraction=useCallback((interaction:WhereCompletionInteraction)=>
    document.activeElement===inputRef.current&&inputRef.current?.selectionStart===interaction.cursorOffset&&valueRef.current===interaction.condition&&cursorRef.current===interaction.cursorOffset,[]);
  const completion=useWhereCompletion({client,sessionKey,connectionId,tabId,driver,capabilities:resolvedCapabilities,
    owner:listboxId,schema:schemaName,table:tableName,database:databaseName,isCurrent:isCurrentInteraction,publish:publishSuggestions});
  const requestSuggestions=useCallback((condition:string,cursorOffset:number,manual:boolean)=>
    completion.request({condition,cursorOffset,manual}),[completion.request]);
  const cancelCompletion=useCallback(()=>{
    interactionEpochRef.current++;
    if(timerRef.current!==null){window.clearTimeout(timerRef.current);timerRef.current=null;}
    completion.cancel();closeSuggestions();
  },[completion.cancel,closeSuggestions]);
  useLayoutEffect(()=>{
    if(valueRef.current!==value)cancelCompletion();
    valueRef.current=value;cursorRef.current=Math.min(cursorRef.current,value.length);
  },[value,cancelCompletion]);

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
      if(!completion.isCandidateCurrent(candidate)){cancelCompletion();return;}
      completion.cancel();
      const acceptanceEpoch=++interactionEpochRef.current;
      const input = inputRef.current;
      const cursorOffset = input?.selectionStart ?? cursorRef.current;
      const replacement =
        candidate.source === "history"
          ? { start: 0, end: valueRef.current.length }
          : candidate.replacementRange ||
            whereReplacementRange(valueRef.current, cursorOffset);
      const insertText = candidate.snippet?plainInsertText(candidate.insertText):candidate.insertText;
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
        if(interactionEpochRef.current!==acceptanceEpoch||valueRef.current!==nextValue||!inputRef.current)return;
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextCursor, nextCursor);
        scheduleSuggestions(nextValue, nextCursor, true);
      });
    },
    [closeSuggestions, onChange, scheduleSuggestions, completion.isCandidateCurrent, completion.cancel, cancelCompletion],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          cancelCompletion();
          const nextValue = event.target.value;
          const cursorOffset = event.target.selectionStart ?? nextValue.length;
          valueRef.current = nextValue;
          cursorRef.current = cursorOffset;
          onChange(nextValue);
          scheduleSuggestions(nextValue, cursorOffset);
        }}
        onClick={(event) => {
          const next=event.currentTarget.selectionStart??value.length;
          if(next!==cursorRef.current)cancelCompletion();
          cursorRef.current=next;
        }}
        onSelect={(event)=>{const next=event.currentTarget.selectionStart??value.length;if(next!==cursorRef.current){cancelCompletion();cursorRef.current=next;}}}
        onKeyDown={(event) => {
          if (isDataGridConditionUndoRedoShortcut(event)) {
            // Preserve this input's native undo stack without allowing the
            // workbench or SQL editor to consume the same shortcut.
            event.stopPropagation();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
            event.preventDefault();
            const cursorOffset = event.currentTarget.selectionStart ?? value.length;
            cursorRef.current = cursorOffset;
            scheduleSuggestions(valueRef.current, cursorOffset, true);
            return;
          }
          if(event.key==="Escape"){event.preventDefault();cancelCompletion();return;}
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
          }
          if (event.key === "Enter") {
            onApply?.();
          }
        }}
        onBlur={() => {
          cancelCompletion();
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
          onClick={()=>{cancelCompletion();openHistory();}}
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
