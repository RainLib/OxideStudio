import { useI18n } from "@/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoaderCircle, FileSearch } from "lucide-react";
import { APP_EVENT_OPEN_SETTINGS } from "@/lib/actionEvents";
import { useFileQueryStore } from "./store";
import type { CsvHeader } from "@/services/tauri/file-query.service";

export function FileQueryOpenDialog() {
  const { t } = useI18n();
  const state = useFileQueryStore();
  const busy = Boolean(state.requestId);
  const selectClass = "h-8 w-full rounded border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return <Dialog open={Boolean(state.source)} onOpenChange={open => { if (!open) state.cancel(); }}>
    <DialogContent className="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>{t("fileQuery.title")}</DialogTitle>
        <DialogDescription>{t("fileQuery.description")}</DialogDescription>
      </DialogHeader>
      {state.source?.kind === "project" && <div className="truncate text-xs text-muted-foreground" title={state.source.relativePath}>{state.source.relativePath}</div>}
      {state.loading ? <div role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle size={14} className="animate-spin" />{t("fileQuery.loadingDrivers")}</div>
        : state.providers.length === 0 ? <div className="space-y-3 text-xs">
          <p>{t("fileQuery.noProvider")}</p>
          <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { state.cancel(); window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_SETTINGS, { detail: { section: "drivers" } })); }}>{t("fileQuery.manageDrivers")}</Button>
            <Button size="sm" variant="ghost" onClick={() => void state.refresh()}>{t("fileQuery.refresh")}</Button></div>
        </div> : <div className="space-y-3">
          <label className="grid gap-1.5 text-xs">{t("fileQuery.driver")}
            <select aria-label={t("fileQuery.driverLabel")} className={selectClass} disabled={busy} value={state.provider} onChange={event => useFileQueryStore.setState({ provider: event.target.value })}>
              {state.providers.map(provider => <option key={`${provider.driver}@${provider.packageVersion}`} value={`${provider.driver}@${provider.packageVersion}`}>{provider.displayName} · {provider.packageVersion}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs">{t("fileQuery.csvHeader")}
            <select aria-label={t("fileQuery.csvHeader")} className={selectClass} disabled={busy} value={state.csvHeader} onChange={event => useFileQueryStore.setState({ csvHeader: event.target.value as CsvHeader })}>
              <option value="auto">{t("fileQuery.headerAuto")}</option><option value="present">{t("fileQuery.headerPresent")}</option><option value="absent">{t("fileQuery.headerAbsent")}</option>
            </select>
            <span className="text-[11px] text-muted-foreground">{t("fileQuery.headerHelp")}</span>
          </label>
          <p className="text-[11px] text-muted-foreground">{t("fileQuery.budget")}</p>
        </div>}
      {busy && <div role="status" className="flex items-center gap-2 text-xs"><LoaderCircle size={14} className="animate-spin" />{t("fileQuery.opening")}</div>}
      {state.error && <div role="alert" className="break-words text-xs text-[hsl(var(--wb-error-text))]">{state.error}</div>}
      <DialogFooter>
        <Button variant="outline" onClick={state.cancel}>{busy ? t("fileQuery.cancelOpening") : t("common.cancel")}</Button>
        <Button disabled={busy || state.loading || !state.provider} onClick={() => void state.open()}><FileSearch size={14} />{state.source?.kind === "project" ? t("fileQuery.openQuery") : t("fileQuery.chooseFile")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
