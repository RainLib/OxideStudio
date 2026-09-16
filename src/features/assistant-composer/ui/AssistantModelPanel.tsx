import { useAssistantModelPanel } from "@/features/assistant-composer/hooks/useAssistantModelPanel";
import { type AssistantModelPanelProps } from "@/features/assistant-composer/model/modelTypes";
import { formatEffort } from "@/features/assistant-composer/model/reasoningEffort";
import { AdvancedRow } from "@/features/assistant-composer/ui/AdvancedRow";
import { ModelMenu } from "@/features/assistant-composer/ui/ModelMenu";
import { ModelStatusIcon } from "@/features/assistant-composer/ui/ModelStatusIcon";
import { OptionMenu } from "@/features/assistant-composer/ui/OptionMenu";
import { ReasoningTrack } from "@/features/assistant-composer/ui/ReasoningTrack";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ChevronRight,
  ChevronUp,
  LoaderCircle,
  Zap,
} from "lucide-react";

export function AssistantModelPanel({
  model,
  status,
  disabled,
  modelOptions,
  catalogStatus,
  catalogWarning,
  reasoningEffort,
  serviceTier = "default",
  onReasoningEffortChange,
  onServiceTierChange,
  onModelChange,
  onRetry,
}: AssistantModelPanelProps) {
  const { t } = useI18n();
  const {
    modelInputId,
    effortGroupName,
    view,
    setView,
    activeMenu,
    setActiveMenu,
    modelSearch,
    setModelSearch,
    customModel,
    setCustomModel,
    normalizedModel,
    normalizedEffort,
    options,
    matchingOptions,
    visibleModelOptions,
    effortOptions,
    effectiveModelLabel,
    effortLabel,
    supportsPriority,
    canRetry,
    canReset,
    catalogPrimaryMessage,
    selectModel,
    resetDefaults,
    toggleFast,
  } = useAssistantModelPanel({
    model,
    reasoningEffort,
    modelOptions,
    t,
    catalogStatus,
    status,
    catalogWarning,
    serviceTier,
    onServiceTierChange,
    disabled,
    onModelChange,
    onReasoningEffortChange,
  });

  return (
    <section
      aria-label={t("assistant.model.controls")}
      data-assistant-model-panel="true"
      className="relative rounded-[12px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] shadow-[0_8px_18px_rgba(0,0,0,0.36)]"
    >
      {status.kind !== "configured" && (
        <div className="mx-2 mt-2 flex min-h-7 items-center gap-1.5 rounded-[6px] bg-[hsl(var(--wb-hover))] px-2">
          <ModelStatusIcon status={status.kind} />
          <span className="min-w-0 flex-1 truncate text-[9px] text-[hsl(var(--wb-text-muted))]">
            {status.label}
          </span>
          {canRetry && (
            <button
              type="button"
              className="wb-text-button h-6 px-1.5 text-[9px]"
              onClick={onRetry}
            >
              {t("assistant.model.retry")}
            </button>
          )}
        </div>
      )}
      {status.kind === "configured" &&
        (catalogStatus === "loading" ||
          catalogStatus === "error" ||
          catalogStatus === "empty" ||
          catalogWarning) && (
          <div
            role={catalogStatus === "error" ? "alert" : "status"}
            data-assistant-model-catalog-status={catalogStatus}
            className="mx-2 mt-2 flex min-h-7 items-center gap-1.5 rounded-[6px] bg-[hsl(var(--wb-hover))] px-2"
          >
            {catalogStatus === "loading" ? (
              <LoaderCircle
                size={11}
                className="shrink-0 animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none"
              />
            ) : (
              <AlertTriangle size={11} className="shrink-0 text-amber-400" />
            )}
            <div className="min-w-0 flex-1 text-[9px] text-[hsl(var(--wb-text-muted))]">
              <p className="truncate">{catalogPrimaryMessage}</p>
              {catalogWarning && catalogStatus !== "loading" && (
                <details className="mt-0.5 text-current/80">
                  <summary className="cursor-pointer select-none">
                    {t("assistant.error.technicalDetails")}
                  </summary>
                  <p className="mt-1 break-words font-mono leading-4">
                    {catalogWarning}
                  </p>
                </details>
              )}
            </div>
            {catalogStatus !== "loading" && (
              <button
                type="button"
                className="wb-text-button h-6 px-1.5 text-[9px]"
                onClick={onRetry}
              >
                {t("assistant.model.retry")}
              </button>
            )}
          </div>
        )}

      <div className="grid [grid-template-areas:'surface']">
        <div
          data-assistant-model-view="quick"
          aria-hidden={view !== "quick"}
          inert={view !== "quick"}
          className={cn(
            "[grid-area:surface] p-2 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            view === "quick"
              ? "translate-x-0 opacity-100"
              : "pointer-events-none -translate-x-8 opacity-0",
          )}
        >
          <div className="px-1 py-0.5">
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-assistant-quick-advanced-toggle="true"
                className="flex h-7 min-w-0 flex-1 items-center gap-1 px-1 text-left text-[11px] text-[hsl(var(--wb-text-muted))] outline-none transition-colors hover:text-[hsl(var(--wb-text))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
                onClick={() => setView("advanced")}
              >
                <span>{t("assistant.model.advanced")}</span>
                <ChevronRight size={12} aria-hidden="true" />
              </button>
              {supportsPriority && onServiceTierChange && (
                <button
                  type="button"
                  data-assistant-fast-toggle="true"
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[hsl(var(--wb-text-muted))] outline-none transition-[background-color,color,transform] duration-150 hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] active:scale-95 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100",
                    serviceTier === "priority" &&
                      "bg-[hsl(var(--wb-accent)/0.16)] text-[hsl(var(--wb-accent))]",
                  )}
                  onClick={toggleFast}
                  disabled={disabled}
                  aria-label={t("assistant.model.fastToggle")}
                  aria-pressed={serviceTier === "priority"}
                  title={t("assistant.model.fastDescription")}
                >
                  <Zap size={13} aria-hidden="true" />
                </button>
              )}
            </div>
            {effortOptions.length > 0 && onReasoningEffortChange && (
              <ReasoningTrack
                name={effortGroupName}
                options={effortOptions}
                selected={normalizedEffort}
                disabled={disabled}
                onSelect={onReasoningEffortChange}
                accelerated={serviceTier === "priority"}
                motionEnabled={view === "quick"}
                compact
              />
            )}
          </div>
        </div>

        <div
          data-assistant-model-view="advanced"
          aria-hidden={view !== "advanced"}
          inert={view !== "advanced"}
          onPointerLeave={() => setActiveMenu(null)}
          onBlurCapture={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            ) {
              setActiveMenu(null);
            }
          }}
          className={cn(
            "[grid-area:surface] p-2 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            view === "advanced"
              ? "translate-x-0 opacity-100"
              : "pointer-events-none translate-x-8 opacity-0",
          )}
        >
          <div>
            <AdvancedRow
              label={t("assistant.model.label")}
              value={effectiveModelLabel}
              active={activeMenu === "model"}
              menu="model"
              ariaLabel={t("assistant.model.toggleList")}
              onOpen={() => setActiveMenu("model")}
            />
            {effortOptions.length > 0 && onReasoningEffortChange && (
              <AdvancedRow
                label={t("assistant.model.reasoning")}
                value={effortLabel}
                active={activeMenu === "effort"}
                menu="effort"
                ariaLabel={t("assistant.model.reasoningEffort")}
                onOpen={() => setActiveMenu("effort")}
              />
            )}
            {supportsPriority && onServiceTierChange && (
              <AdvancedRow
                label={t("assistant.model.speed")}
                value={
                  serviceTier === "priority"
                    ? t("assistant.model.fast")
                    : t("assistant.model.standard")
                }
                active={activeMenu === "speed"}
                menu="speed"
                ariaLabel={t("assistant.model.speed")}
                onOpen={() => setActiveMenu("speed")}
              />
            )}
            <button
              type="button"
              className="flex h-8 w-full items-center gap-1 rounded-[7px] px-2 text-left text-[10px] text-[hsl(var(--wb-text-muted))] outline-none hover:bg-[hsl(var(--wb-hover))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
              onClick={() => {
                setActiveMenu(null);
                setView("quick");
              }}
              onFocus={() => setActiveMenu(null)}
              data-assistant-advanced-toggle="true"
              aria-label={t("assistant.model.backToReasoning")}
            >
              {t("assistant.model.advanced")}
              <ChevronUp size={11} aria-hidden="true" />
            </button>
          </div>

          {activeMenu && (
            <div
              data-assistant-submenu={activeMenu}
              className="absolute bottom-2 right-full z-10 w-[242px] pr-[6px]"
            >
              <div className="w-[236px] rounded-[11px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 shadow-[0_6px_8px_rgba(0,0,0,0.4)] animate-in fade-in-0 slide-in-from-right-1 duration-150 motion-reduce:animate-none">
                {activeMenu === "model" && (
                  <ModelMenu
                    options={options}
                    visibleOptions={visibleModelOptions}
                    matchingCount={matchingOptions.length}
                    selectedModel={normalizedModel}
                    search={modelSearch}
                    customModel={customModel}
                    customModelInputId={modelInputId}
                    catalogStatus={catalogStatus}
                    catalogWarning={catalogWarning}
                    disabled={disabled}
                    onSearchChange={setModelSearch}
                    onCustomModelChange={setCustomModel}
                    onSelect={selectModel}
                    onApplyCustom={() => {
                      const nextModel = customModel.trim();
                      if (
                        nextModel &&
                        nextModel !== normalizedModel &&
                        !disabled
                      ) {
                        onModelChange(nextModel);
                        setActiveMenu(null);
                      }
                    }}
                  />
                )}
                {activeMenu === "effort" && onReasoningEffortChange && (
                  <OptionMenu
                    ariaLabel={t("assistant.model.reasoningEffort")}
                    options={["default", ...effortOptions].map((value) => ({
                      id: value,
                      label: formatEffort(value, t("assistant.model.default")),
                    }))}
                    selected={normalizedEffort}
                    disabled={disabled}
                    onSelect={(value) => {
                      onReasoningEffortChange(value);
                      setActiveMenu(null);
                    }}
                  />
                )}
                {activeMenu === "speed" &&
                  supportsPriority &&
                  onServiceTierChange && (
                    <OptionMenu
                      ariaLabel={t("assistant.model.speed")}
                      options={[
                        {
                          id: "default",
                          label: t("assistant.model.standard"),
                          description: t("assistant.model.standardDescription"),
                        },
                        {
                          id: "priority",
                          label: t("assistant.model.fast"),
                          description: t("assistant.model.fastDescription"),
                        },
                      ]}
                      selected={serviceTier}
                      disabled={disabled}
                      onSelect={(value) => {
                        onServiceTierChange(value as "default" | "priority");
                        setActiveMenu(null);
                      }}
                    />
                  )}
                <div className="mt-1 flex items-center border-t border-[hsl(var(--wb-border-subtle))] pt-1">
                  <button
                    type="button"
                    className="wb-text-button h-7 px-2 text-[9px]"
                    onClick={resetDefaults}
                    disabled={!canReset}
                  >
                    {t("assistant.model.reset")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
