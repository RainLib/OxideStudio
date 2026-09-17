import { PriorityToggle } from "@/features/assistant-composer/ui/PriorityToggle";
import { ReasoningTrack } from "@/features/assistant-composer/ui/ReasoningTrack";
import { useI18n } from "@/i18n";
import { ChevronRight, RefreshCw, RotateCcw } from "lucide-react";

export function AssistantModelCompactPanel({
  modelLabel,
  effortLabel,
  effortGroupName,
  effortOptions,
  normalizedEffort,
  serviceTier,
  supportsPriority,
  canReset,
  canRefreshCatalog,
  catalogRefreshing,
  disabled,
  onSelectEffort,
  onToggleFast,
  onOpenModels,
  onRefreshCatalog,
  onReset,
}: {
  modelLabel: string;
  effortLabel: string;
  effortGroupName: string;
  effortOptions: readonly string[];
  normalizedEffort: string;
  serviceTier: "default" | "priority";
  supportsPriority: boolean;
  canReset: boolean;
  canRefreshCatalog: boolean;
  catalogRefreshing: boolean;
  disabled: boolean;
  onSelectEffort?: (effort: string) => void;
  onToggleFast: () => void;
  onOpenModels: () => void;
  onRefreshCatalog: () => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const canAdjustEffort = effortOptions.length > 0 && onSelectEffort;

  return (
    <div
      data-assistant-model-view="compact"
      className="p-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
    >
      <div className="flex items-center gap-1 px-0.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center">
          {supportsPriority && (
            <PriorityToggle
              enabled={serviceTier === "priority"}
              disabled={disabled}
              label={t("assistant.model.fastToggle")}
              description={t("assistant.model.fastDescription")}
              onToggle={onToggleFast}
            />
          )}
        </div>

        <button
          type="button"
          data-assistant-quick-advanced-toggle="true"
          className="flex min-w-0 flex-1 flex-col items-center rounded-[6px] px-1 py-0.5 leading-tight outline-none transition-colors hover:bg-[hsl(var(--wb-hover))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:pointer-events-none disabled:opacity-45"
          onClick={onOpenModels}
          disabled={disabled}
          aria-label={t("assistant.model.toggleList")}
        >
          <span className="inline-flex items-center text-[12px] font-medium text-[hsl(var(--wb-accent))]">
            {effortLabel}
            <ChevronRight size={12} aria-hidden="true" />
          </span>
          <span className="max-w-full truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
            {modelLabel}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          {canRefreshCatalog && (
            <button
              type="button"
              data-assistant-model-refresh="true"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[hsl(var(--wb-text-muted))] outline-none transition-[background-color,color] duration-150 hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
              onClick={onRefreshCatalog}
              disabled={disabled || catalogRefreshing}
              aria-label={t("assistant.model.refreshCatalog")}
              title={t("assistant.model.refreshCatalog")}
            >
              <RefreshCw
                size={13}
                strokeWidth={1.75}
                className={catalogRefreshing ? "animate-spin motion-reduce:animate-none" : undefined}
                aria-hidden="true"
              />
            </button>
          )}
          <button
            type="button"
            data-assistant-model-reset="true"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[hsl(var(--wb-text-muted))] outline-none transition-[background-color,color] duration-150 hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
            onClick={onReset}
            disabled={disabled || !canReset}
            aria-label={t("assistant.model.reset")}
            title={t("assistant.model.reset")}
          >
            <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>

      {canAdjustEffort ? (
        <ReasoningTrack
          name={effortGroupName}
          options={effortOptions}
          selected={normalizedEffort}
          disabled={disabled}
          onSelect={onSelectEffort}
          accelerated={serviceTier === "priority"}
          compact
        />
      ) : (
        <p className="px-1 py-2 text-[10px] text-[hsl(var(--wb-text-muted))]">
          {t("assistant.model.noReasoningControl")}
        </p>
      )}
    </div>
  );
}
