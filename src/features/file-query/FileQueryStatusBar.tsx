import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import type { TabData } from "@/features/workspace-tabs/model/types";

export function FileQueryStatusBar({ tab, intelligence }: { tab: TabData; intelligence: { ready: boolean; status: string; error: string | null } }) {
  const { t, locale } = useI18n();
  const document = tab.fileQuery!;
  const session = document.session;
  const columns = document.schema ?? [];
  const starting = intelligence.status === "starting" || intelligence.status === "idle";
  const status = intelligence.ready ? t("fileQuery.intelligenceReady") : starting ? t("fileQuery.intelligenceStarting") : t("fileQuery.intelligenceUnavailable");
  return <div className="flex min-h-6 shrink-0 flex-wrap items-center justify-between gap-x-3 border-t border-[hsl(var(--wb-border-subtle))] px-2 text-[10px] text-[hsl(var(--wb-text-muted))]">
    <div className="flex min-w-0 items-center gap-2">
      <span>{session ? t("fileQuery.size", { format: session.format.toUpperCase(), size: (session.sourceBytes / 1024).toLocaleString(locale, { maximumFractionDigits: 1 }) }) : t("fileQuery.closed")}</span>
      {columns.length > 0 && <Popover>
        <PopoverTrigger asChild><button className="wb-text-button h-6 px-1" aria-label={t(session ? "fileQuery.schema" : "fileQuery.lastSchema")}>{t("fileQuery.columns", { count: columns.length })}</button></PopoverTrigger>
        <PopoverContent align="start" aria-label={t(session ? "fileQuery.schema" : "fileQuery.lastSchema")} className="w-80 max-w-[calc(100vw-24px)] p-3">
          <h3 className="mb-2 text-xs font-medium">{t(session ? "fileQuery.schema" : "fileQuery.lastSchema")}</h3>
          <div className="max-h-60 overflow-auto"><table className="w-full table-fixed text-left text-[11px]">
            <thead className="text-[hsl(var(--wb-text-muted))]"><tr><th className="w-1/2 pb-1 font-normal">{t("fileQuery.columnName")}</th><th className="pb-1 font-normal">{t("fileQuery.columnType")}</th></tr></thead>
            <tbody>{columns.map((column, index) => <tr key={index} className="border-t border-[hsl(var(--wb-border-subtle))]"><td className="break-words py-1 pr-2">{column.name}</td><td className="break-words py-1">{column.data_type}</td></tr>)}</tbody>
          </table></div>
        </PopoverContent>
      </Popover>}
      {session && <span role="status" aria-label={status} title={intelligence.error ? `${status}: ${intelligence.error}` : status}>
        {intelligence.ready ? <CircleCheck size={12} /> : starting ? <LoaderCircle size={12} className="animate-spin" /> : <CircleAlert size={12} />}
      </span>}
    </div>
    <span>{t("fileQuery.limits")}</span>
  </div>;
}
