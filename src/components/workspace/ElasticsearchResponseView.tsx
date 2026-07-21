import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Braces, Check, Copy, Table2 } from "lucide-react";
import type { QueryResult } from "@/services/tauri";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

interface ElasticsearchResponseViewProps {
  result: QueryResult;
  children: ReactNode;
}

type ResponseView = "table" | "json";

function prefersTable(result: QueryResult) {
  const path = result.responseMeta?.requestPath || "";
  return (
    result.rows.length > 0 &&
    /(?:^|\/)_(?:search|eql\/search)(?:[/?#]|$)/i.test(path)
  );
}

export function ElasticsearchResponseView({
  result,
  children,
}: ElasticsearchResponseViewProps) {
  const { t } = useI18n();
  const [view, setView] = useState<ResponseView>(() =>
    prefersTable(result) ? "table" : "json",
  );
  const [copied, setCopied] = useState(false);
  const responseMeta = result.responseMeta;
  const rawResponse = useMemo(
    () =>
      responseMeta?.rawResponse === undefined
        ? ""
        : JSON.stringify(responseMeta.rawResponse, null, 2),
    [responseMeta?.rawResponse],
  );

  useEffect(() => {
    setView(prefersTable(result) ? "table" : "json");
    setCopied(false);
  }, [result]);

  if (!responseMeta) return children;

  const copyResponse = async () => {
    if (!rawResponse) return;
    await navigator.clipboard.writeText(rawResponse);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-2 text-[10px]">
        <button
          type="button"
          className={cn(
            "wb-text-button h-5 gap-1 px-1.5",
            view === "table" &&
              "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]",
          )}
          onClick={() => setView("table")}
          aria-pressed={view === "table"}
        >
          <Table2 size={11} />
          {t("elasticsearch.response.table")}
        </button>
        <button
          type="button"
          className={cn(
            "wb-text-button h-5 gap-1 px-1.5",
            view === "json" &&
              "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]",
          )}
          onClick={() => setView("json")}
          aria-pressed={view === "json"}
        >
          <Braces size={11} />
          {t("elasticsearch.response.json")}
        </button>
        <span className="mx-1 h-3 w-px bg-[hsl(var(--wb-border-subtle))]" />
        <span className="font-medium text-emerald-400">
          HTTP {responseMeta.status}
        </span>
        <span className="wb-muted">
          {responseMeta.durationMs.toLocaleString()} ms
        </span>
        <span
          className="min-w-0 flex-1 truncate font-mono wb-muted"
          title={`${responseMeta.requestMethod} ${responseMeta.requestPath}`}
        >
          {responseMeta.requestMethod} {responseMeta.requestPath}
        </span>
        <button
          type="button"
          className="wb-icon-button h-5 w-5"
          onClick={() => void copyResponse()}
          disabled={!rawResponse}
          title={
            copied
              ? t("elasticsearch.response.copied")
              : t("elasticsearch.response.copy")
          }
          aria-label={
            copied
              ? t("elasticsearch.response.copied")
              : t("elasticsearch.response.copy")
          }
        >
          {copied ? (
            <Check size={11} className="text-emerald-400" />
          ) : (
            <Copy size={11} />
          )}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {view === "table" ? (
          children
        ) : rawResponse ? (
          <pre
            className="h-full overflow-auto p-3 font-mono text-[11px] leading-5 text-[hsl(var(--wb-text))] selection:bg-[hsl(var(--wb-active-strong))]"
            data-text-selectable="true"
          >
            {rawResponse}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] wb-muted">
            {t("elasticsearch.response.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
