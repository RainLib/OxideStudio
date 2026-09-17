import { ModelMenu } from "@/features/assistant-composer/ui/ModelMenu";
import { PriorityToggle } from "@/features/assistant-composer/ui/PriorityToggle";
import { ReasoningTrack } from "@/features/assistant-composer/ui/ReasoningTrack";
import { useI18n } from "@/i18n";
import { RefreshCw, RotateCcw } from "lucide-react";
import type { AiCliModelInfo } from "@/services/tauri/ai.service";

export function AssistantModelPicker({
  options,
  visibleOptions,
  matchingCount,
  selectedModel,
  search,
  customModel,
  customModelInputId,
  catalogStatus,
  catalogWarning,
  effortGroupName,
  effortOptions,
  normalizedEffort,
  serviceTier,
  supportsPriority,
  canReset,
  canRefreshCatalog,
  catalogRefreshing,
  disabled,
  onSearchChange,
  onCustomModelChange,
  onSelectModel,
  onApplyCustomModel,
  onSelectEffort,
  onToggleFast,
  onOpenCompact,
  onRefreshCatalog,
  onReset,
}: {
  options: readonly AiCliModelInfo[];
  visibleOptions: readonly AiCliModelInfo[];
  matchingCount: number;
  selectedModel: string;
  search: string;
  customModel: string;
  customModelInputId: string;
  catalogStatus: "idle" | "loading" | "ready" | "empty" | "error" | undefined;
  catalogWarning: string | undefined;
  effortGroupName: string;
  effortOptions: readonly string[];
  normalizedEffort: string;
  serviceTier: "default" | "priority";
  supportsPriority: boolean;
  canReset: boolean;
  canRefreshCatalog: boolean;
  catalogRefreshing: boolean;
  disabled: boolean;
  onSearchChange: (value: string) => void;
  onCustomModelChange: (value: string) => void;
  onSelectModel: (option: AiCliModelInfo) => void;
  onApplyCustomModel: () => void;
  onSelectEffort?: (effort: string) => void;
  onToggleFast: () => void;
  onOpenCompact: () => void;
  onRefreshCatalog: () => void;
  onReset: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      data-assistant-model-view="models"
      className="p-2 animate-in fade-in-0 slide-in-from-right-1 duration-200 motion-reduce:animate-none"
    >
      <div className="mb-1 flex h-7 items-center gap-1 px-0.5">
        <button
          type="button"
          data-assistant-advanced-toggle="true"
          className="wb-text-button h-7 px-1.5 text-[10px]"
          onClick={onOpenCompact}
          disabled={disabled}
        >
          {t("assistant.model.compact")}
        </button>
        <span className="min-w-0 flex-1 truncate px-1 text-center text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
          {t("assistant.model.label")}
        </span>
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

      <ModelMenu
        options={options}
        visibleOptions={visibleOptions}
        matchingCount={matchingCount}
        selectedModel={selectedModel}
        search={search}
        customModel={customModel}
        customModelInputId={customModelInputId}
        catalogStatus={catalogStatus}
        catalogWarning={catalogWarning}
        disabled={disabled}
        onSearchChange={onSearchChange}
        onCustomModelChange={onCustomModelChange}
        onSelect={onSelectModel}
        onApplyCustom={onApplyCustomModel}
      />

      {(effortOptions.length > 0 || supportsPriority) && (
        <div className="mt-2 border-t border-[hsl(var(--wb-border-subtle))] px-1 pt-2">
          <div className="mb-1 flex min-h-7 items-center gap-1">
            <span className="min-w-0 flex-1 text-[10px] text-[hsl(var(--wb-text-muted))]">
              {t("assistant.model.reasoningEffort")}
            </span>
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
          {effortOptions.length > 0 && onSelectEffort && (
            <ReasoningTrack
              name={effortGroupName}
              options={effortOptions}
              selected={normalizedEffort}
              disabled={disabled}
              onSelect={onSelectEffort}
              accelerated={serviceTier === "priority"}
            />
          )}
        </div>
      )}
    </div>
  );
}
