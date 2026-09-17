import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  displayModelLabel,
  findSelectedModel,
  normalizeModelOptions,
} from "@/features/assistant-composer/model/modelOptions";
import { type AssistantModelControlProps } from "@/features/assistant-composer/model/modelTypes";
import { formatEffort } from "@/features/assistant-composer/model/reasoningEffort";
import { AssistantModelPanel } from "@/features/assistant-composer/ui/AssistantModelPanel";
import { ModelStatusIcon } from "@/features/assistant-composer/ui/ModelStatusIcon";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { useMemo } from "react";

export function AssistantModelControl({
  model,
  endpoint,
  status,
  disabled,
  triggerRef,
  open,
  panelId,
  modelOptions,
  catalogStatus,
  catalogWarning,
  catalogRefreshing,
  reasoningEffort,
  serviceTier,
  onOpenChange,
  onReasoningEffortChange,
  onServiceTierChange,
  onModelChange,
  onRetry,
}: AssistantModelControlProps) {
  const { t } = useI18n();
  const normalizedModel = model.trim();
  const normalizedEffort = reasoningEffort?.trim() || "default";
  const options = useMemo(
    () => normalizeModelOptions(modelOptions),
    [modelOptions],
  );
  const selectedModel = findSelectedModel(options, normalizedModel);
  const modelLabel = displayModelLabel(
    selectedModel,
    normalizedModel,
    t("assistant.model.default"),
  );
  const triggerLabel =
    status.kind === "missing" ? t("assistant.model.configure") : modelLabel;
  const selectorSummary =
    selectedModel?.reasoningEfforts?.length && onReasoningEffortChange
      ? `${triggerLabel} · ${formatEffort(
          normalizedEffort,
          t("assistant.model.default"),
        )}`
      : triggerLabel;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          data-assistant-model-trigger="true"
          className={cn(
            "group inline-flex h-7 min-w-0 max-w-[220px] items-center gap-1 rounded-full px-2 text-[10px] font-medium text-[hsl(var(--wb-text-muted))] outline-none transition-[background-color,color,transform] duration-150 hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none motion-reduce:active:scale-100",
            open && "bg-[hsl(var(--wb-hover))] text-[hsl(var(--wb-text))]",
            status.kind === "authentication-error" &&
              "text-[hsl(var(--destructive))]",
            (status.kind === "missing" ||
              status.kind === "unavailable" ||
              status.kind === "incompatible") &&
              "text-amber-400",
          )}
          disabled={disabled}
          title={`${selectorSummary} · ${status.label}. ${status.detail}${endpoint ? ` · ${endpoint}` : ""}`}
          aria-label={t("assistant.model.aria", {
            model: selectorSummary,
            status: status.label,
          })}
          aria-expanded={open}
          aria-controls={panelId}
        >
          <ModelStatusIcon status={status.kind} />
          <span className="truncate text-[hsl(var(--wb-text))]">
            {selectorSummary}
          </span>
          <ChevronDown
            size={10}
            className={cn(
              "shrink-0 opacity-70 transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        id={panelId}
        data-assistant-model-popover="true"
        align="end"
        side="top"
        sideOffset={7}
        collisionPadding={10}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onOpenChange(false);
          window.requestAnimationFrame(() => triggerRef.current?.focus());
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="w-[min(304px,calc(100vw-20px))] overflow-visible rounded-[12px] border-0 bg-transparent p-0 text-[hsl(var(--wb-text))] shadow-none data-[state=closed]:slide-out-to-bottom-1 data-[state=open]:slide-in-from-bottom-1 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 motion-reduce:duration-0"
      >
        <AssistantModelPanel
          model={model}
          status={status}
          disabled={disabled}
          modelOptions={modelOptions}
          catalogStatus={catalogStatus}
          catalogWarning={catalogWarning}
          catalogRefreshing={catalogRefreshing}
          reasoningEffort={reasoningEffort}
          serviceTier={serviceTier}
          onReasoningEffortChange={onReasoningEffortChange}
          onServiceTierChange={onServiceTierChange}
          onModelChange={onModelChange}
          onRetry={onRetry}
        />
      </PopoverContent>
    </Popover>
  );
}

export type {
  AssistantModelCatalogStatus,
  AssistantModelStatus,
  AssistantModelStatusKind,
} from "@/features/assistant-composer/model/modelTypes";
