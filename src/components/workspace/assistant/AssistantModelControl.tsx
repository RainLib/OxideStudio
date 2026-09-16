import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  effortToneClass,
  formatEffort,
} from "@/features/assistant-composer/model/reasoningEffort";
import { AssistantModelPanel } from "@/features/assistant-composer/ui/AssistantModelPanel";
import { ModelStatusIcon } from "@/features/assistant-composer/ui/ModelStatusIcon";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

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
  reasoningEffort,
  serviceTier,
  accessMode,
  fullAccessAvailable = false,
  onOpenChange,
  onReasoningEffortChange,
  onServiceTierChange,
  onAccessModeChange,
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
  const [ultraAccessOpen, setUltraAccessOpen] = useState(false);
  const changeReasoningEffort = (effort: string) => {
    if (!onReasoningEffortChange) return;
    if (
      effort.trim().toLowerCase() === "ultra" &&
      accessMode === "restricted" &&
      onAccessModeChange
    ) {
      setUltraAccessOpen(true);
      return;
    }
    onReasoningEffortChange(effort);
    if (effort.trim().toLowerCase() !== "ultra" && accessMode === "full") {
      onAccessModeChange?.("restricted");
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            data-assistant-model-trigger="true"
            className={cn(
              "group inline-flex h-7 min-w-0 max-w-[196px] items-center gap-1 rounded-full px-2 text-[10px] font-medium text-[hsl(var(--wb-text-muted))] outline-none transition-[background-color,color,transform] duration-150 hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none motion-reduce:active:scale-100",
              open && "bg-[hsl(var(--wb-hover))] text-[hsl(var(--wb-text))]",
              status.kind === "authentication-error" &&
                "text-[hsl(var(--destructive))]",
              (status.kind === "missing" ||
                status.kind === "unavailable" ||
                status.kind === "incompatible") &&
                "text-amber-400",
            )}
            disabled={disabled}
            title={`${triggerLabel} · ${status.label}. ${status.detail}${endpoint ? ` · ${endpoint}` : ""}`}
            aria-label={t("assistant.model.aria", {
              model: triggerLabel,
              status: status.label,
            })}
            aria-expanded={open}
            aria-controls={panelId}
          >
            <ModelStatusIcon status={status.kind} />
            <span className="truncate text-[hsl(var(--wb-text))]">
              {triggerLabel}
            </span>
            {selectedModel?.reasoningEfforts?.length &&
            onReasoningEffortChange ? (
              <span
                className={cn("shrink-0", effortToneClass(normalizedEffort))}
              >
                {formatEffort(normalizedEffort, t("assistant.model.default"))}
              </span>
            ) : null}
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
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
          className="w-[min(236px,calc(100vw-20px))] overflow-visible rounded-[12px] border-0 bg-transparent p-0 text-[hsl(var(--wb-text))] shadow-none data-[state=closed]:slide-out-to-bottom-1 data-[state=open]:slide-in-from-bottom-1 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 motion-reduce:duration-0"
        >
          <AssistantModelPanel
            model={model}
            status={status}
            disabled={disabled}
            modelOptions={modelOptions}
            catalogStatus={catalogStatus}
            catalogWarning={catalogWarning}
            reasoningEffort={reasoningEffort}
            serviceTier={serviceTier}
            onReasoningEffortChange={
              onReasoningEffortChange ? changeReasoningEffort : undefined
            }
            onServiceTierChange={onServiceTierChange}
            onModelChange={onModelChange}
            onRetry={onRetry}
          />
        </PopoverContent>
      </Popover>

      <Dialog open={ultraAccessOpen} onOpenChange={setUltraAccessOpen}>
        <DialogContent
          data-assistant-ultra-access-dialog="true"
          className="w-[500px] max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-[12px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_6px_8px_rgba(0,0,0,0.42)] [&>button]:right-3 [&>button]:top-3 [&>button]:text-[hsl(var(--wb-text-muted))]"
        >
          <DialogHeader className="space-y-2 px-5 pb-4 pt-5 pr-12 text-left">
            <DialogTitle className="text-[15px] font-semibold leading-5 tracking-normal">
              {t("assistant.model.ultraAccessTitle")}
            </DialogTitle>
            <DialogDescription className="text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
              {t("assistant.model.ultraAccessDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2 px-5 pb-5 sm:space-x-0">
            <button
              type="button"
              className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full bg-[hsl(var(--destructive)/0.14)] px-4 text-[11px] font-medium text-[hsl(var(--destructive))] outline-none transition-colors hover:bg-[hsl(var(--destructive)/0.2)] focus-visible:ring-1 focus-visible:ring-[hsl(var(--destructive))] disabled:pointer-events-none disabled:opacity-40"
              onClick={() => {
                onAccessModeChange?.("full");
                onReasoningEffortChange?.("ultra");
                setUltraAccessOpen(false);
              }}
              disabled={!fullAccessAvailable}
              title={
                fullAccessAvailable
                  ? undefined
                  : t("assistant.model.fullAccessAgentOnly")
              }
            >
              <AlertTriangle size={13} aria-hidden="true" />
              {t("assistant.model.useFullAccess")}
            </button>
            <button
              type="button"
              className="h-9 flex-1 rounded-full bg-[hsl(var(--wb-text))] px-4 text-[11px] font-medium text-[hsl(var(--wb-editor))] outline-none transition-opacity hover:opacity-90 focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
              onClick={() => {
                onReasoningEffortChange?.("ultra");
                setUltraAccessOpen(false);
              }}
            >
              {t("assistant.model.continueRestricted")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export type {
  AssistantModelCatalogStatus,
  AssistantModelStatus,
  AssistantModelStatusKind,
} from "@/features/assistant-composer/model/modelTypes";
