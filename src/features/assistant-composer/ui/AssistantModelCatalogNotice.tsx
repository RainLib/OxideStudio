import { ModelStatusIcon } from "@/features/assistant-composer/ui/ModelStatusIcon";
import { type AssistantModelStatus } from "@/features/assistant-composer/model/modelTypes";
import { useI18n } from "@/i18n";
import { AlertTriangle, LoaderCircle } from "lucide-react";

export function AssistantModelCatalogNotice({
  status,
  catalogStatus,
  catalogWarning,
  catalogRefreshing = false,
  canRetry,
  onRetry,
}: {
  status: AssistantModelStatus;
  catalogStatus: "idle" | "loading" | "ready" | "empty" | "error" | undefined;
  catalogWarning: string | undefined;
  catalogRefreshing?: boolean;
  canRetry: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const catalogMessage =
    catalogRefreshing
      ? t("assistant.model.catalogRefreshing")
      : catalogStatus === "loading"
      ? t("assistant.model.catalogLoading")
      : catalogStatus === "empty"
        ? t("assistant.model.catalogEmpty")
        : catalogStatus === "error"
          ? t("assistant.model.catalogUnavailable")
          : catalogWarning
            ? t("assistant.model.catalogRefreshWarning")
            : null;

  if (status.kind !== "configured") {
    return (
      <div className="mx-2 mt-2 flex min-h-7 items-center gap-1.5 rounded-[6px] bg-[hsl(var(--wb-hover))] px-2">
        <ModelStatusIcon status={status.kind} />
        <span className="min-w-0 flex-1 truncate text-[9px] text-[hsl(var(--wb-text-muted))]">
          {status.label}
        </span>
        {canRetry && (
          <button type="button" className="wb-text-button h-6 px-1.5 text-[9px]" onClick={onRetry}>
            {t("assistant.model.retry")}
          </button>
        )}
      </div>
    );
  }

  if (!catalogMessage) return null;

  return (
    <div
      role={catalogStatus === "error" ? "alert" : "status"}
      data-assistant-model-catalog-status={catalogStatus}
      className="mx-2 mt-2 flex min-h-7 items-center gap-1.5 rounded-[6px] bg-[hsl(var(--wb-hover))] px-2"
    >
      {catalogRefreshing || catalogStatus === "loading" ? (
        <LoaderCircle size={11} className="shrink-0 animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none" />
      ) : (
        <AlertTriangle size={11} className="shrink-0 text-amber-400" />
      )}
      <div className="min-w-0 flex-1 text-[9px] text-[hsl(var(--wb-text-muted))]">
        <p className="truncate">{catalogMessage}</p>
        {catalogWarning && catalogStatus !== "loading" && !catalogRefreshing && (
          <details className="mt-0.5 text-current/80">
            <summary className="cursor-pointer select-none">{t("assistant.error.technicalDetails")}</summary>
            <p className="mt-1 break-words font-mono leading-4">{catalogWarning}</p>
          </details>
        )}
      </div>
      {catalogStatus !== "loading" && !catalogRefreshing && (
        <button type="button" className="wb-text-button h-6 px-1.5 text-[9px]" onClick={onRetry}>
          {t("assistant.model.retry")}
        </button>
      )}
    </div>
  );
}
