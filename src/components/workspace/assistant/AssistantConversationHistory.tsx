import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  agentHostService,
  type AgentConversationSummary,
} from "@/services/tauri/agent-host.service";
import { Check, History, LoaderCircle, MessageSquareText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const HISTORY_CACHE_TTL_MS = 60_000;

type CachedHistory = {
  summaries: AgentConversationSummary[];
  fetchedAt: number;
};

const historyCache = new Map<string, CachedHistory>();

interface AssistantConversationHistoryProps {
  projectId: string;
  conversationScope: string;
  activeConversationId: string;
  disabled?: boolean;
  onSelect: (conversationId: string) => void;
}

export function AssistantConversationHistory({
  projectId,
  conversationScope,
  activeConversationId,
  disabled = false,
  onSelect,
}: AssistantConversationHistoryProps) {
  const { locale, t } = useI18n();
  const cacheKey = conversationHistoryCacheKey(projectId, conversationScope);
  const initialCache = historyCache.get(cacheKey);
  const [open, setOpen] = useState(false);
  const [summaries, setSummaries] = useState<AgentConversationSummary[]>(
    initialCache?.summaries ?? [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    requestSequenceRef.current += 1;
    const cached = historyCache.get(cacheKey);
    setSummaries(cached?.summaries ?? []);
    setIsLoading(false);
    setError(null);
  }, [cacheKey]);

  const loadHistory = useCallback(
    async (force = false) => {
      const cached = historyCache.get(cacheKey);
      if (!force && cached && Date.now() - cached.fetchedAt < HISTORY_CACHE_TTL_MS) {
        setSummaries(cached.summaries);
        setError(null);
        return;
      }

      const requestSequence = ++requestSequenceRef.current;
      setIsLoading(true);
      setError(null);
      try {
        const next = await agentHostService.listConversationSnapshots(
          projectId,
          conversationScope,
        );
        if (requestSequence !== requestSequenceRef.current) return;
        historyCache.set(cacheKey, { summaries: next, fetchedAt: Date.now() });
        setSummaries(next);
      } catch {
        if (requestSequence !== requestSequenceRef.current) return;
        setError(t("assistant.historyLoadFailed"));
      } finally {
        if (requestSequence === requestSequenceRef.current) setIsLoading(false);
      }
    }, [cacheKey, conversationScope, projectId, t],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) void loadHistory();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          disabled={disabled}
          title={t("assistant.history")}
          aria-label={t("assistant.historyAria")}
          data-assistant-history-trigger
        >
          <History size={12} aria-hidden="true" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={5}
        className="w-[304px] p-0 text-[10px]"
        data-assistant-history-menu
      >
        <div className="flex h-9 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3">
          <span className="text-[11px] font-semibold">
            {t("assistant.history")}
          </span>
          {isLoading && summaries.length > 0 && (
            <LoaderCircle
              size={12}
              className="animate-spin text-[hsl(var(--wb-text-muted))] motion-reduce:animate-none"
              aria-label={t("assistant.history")}
            />
          )}
        </div>

        {isLoading && summaries.length === 0 ? (
          <HistorySkeleton />
        ) : error && summaries.length === 0 ? (
          <div className="flex min-h-28 flex-col items-center justify-center gap-2 px-5 py-4 text-center">
            <p className="text-[10px] text-[hsl(var(--wb-text-muted))]">
              {error}
            </p>
            <button
              type="button"
              className="rounded-[4px] px-2 py-1 font-medium text-[hsl(var(--wb-accent))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
              onClick={() => void loadHistory(true)}
            >
              {t("assistant.historyRetry")}
            </button>
          </div>
        ) : summaries.length === 0 ? (
          <div className="flex min-h-32 flex-col items-center justify-center px-6 py-5 text-center">
            <MessageSquareText
              size={17}
              className="mb-2 text-[hsl(var(--wb-text-muted))]"
              aria-hidden="true"
            />
            <p className="font-medium text-[hsl(var(--wb-text))]">
              {t("assistant.historyEmpty")}
            </p>
            <p className="mt-1 max-w-[34ch] leading-4 text-[hsl(var(--wb-text-muted))]">
              {t("assistant.historyEmptyHint")}
            </p>
          </div>
        ) : (
          <div
            className="custom-scrollbar max-h-72 overflow-y-auto py-1"
            role="list"
          >
            {summaries.map((summary) => {
              const selected = summary.conversationId === activeConversationId;
              return (
                <div key={summary.conversationId} role="listitem">
                  <button
                    type="button"
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "group flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[hsl(var(--wb-hover)/0.7)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))] motion-reduce:transition-none",
                      selected && "bg-[hsl(var(--wb-selected)/0.72)]",
                    )}
                    onClick={() => {
                      onSelect(summary.conversationId);
                      setOpen(false);
                    }}
                    data-assistant-history-item={summary.conversationId}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[hsl(var(--wb-text))]">
                        {summary.title || t("assistant.historyUntitled")}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[hsl(var(--wb-text-muted))]">
                        <span>
                          {formatConversationDate(summary.updatedAt, locale)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {t("assistant.historyTurns", {
                            count: summary.turnCount,
                          })}
                        </span>
                      </span>
                    </span>
                    <Check
                      size={12}
                      className={cn(
                        "mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]",
                        !selected && "invisible",
                      )}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function HistorySkeleton() {
  return (
    <div className="space-y-1 px-3 py-2.5" aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-1.5 py-1.5">
          <div className="h-2.5 w-3/4 animate-pulse rounded-[2px] bg-[hsl(var(--wb-hover))] motion-reduce:animate-none" />
          <div className="h-2 w-2/5 animate-pulse rounded-[2px] bg-[hsl(var(--wb-hover)/0.72)] motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function conversationHistoryCacheKey(projectId: string, conversationScope: string) {
  return `${projectId}\u0000${conversationScope}`;
}

function formatConversationDate(updatedAt: number, locale: string) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(updatedAt));
}

export function upsertAssistantConversationHistorySummary(
  projectId: string,
  conversationScope: string,
  summary: AgentConversationSummary,
) {
  const cacheKey = conversationHistoryCacheKey(projectId, conversationScope);
  const cached = historyCache.get(cacheKey);
  if (!cached) return;
  const summaries = [
    summary,
    ...cached.summaries.filter(
      (candidate) => candidate.conversationId !== summary.conversationId,
    ),
  ].sort((left, right) => right.updatedAt - left.updatedAt);
  historyCache.set(cacheKey, { ...cached, summaries });
}

export function resetAssistantConversationHistoryForTests() {
  historyCache.clear();
}
