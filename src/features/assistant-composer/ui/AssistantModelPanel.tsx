import { useAssistantModelPanel } from "@/features/assistant-composer/hooks/useAssistantModelPanel";
import { type AssistantModelPanelProps } from "@/features/assistant-composer/model/modelTypes";
import { AssistantModelCatalogNotice } from "@/features/assistant-composer/ui/AssistantModelCatalogNotice";
import { AssistantModelCompactPanel } from "@/features/assistant-composer/ui/AssistantModelCompactPanel";
import { AssistantModelPicker } from "@/features/assistant-composer/ui/AssistantModelPicker";
import { useI18n } from "@/i18n";

/**
 * Composes the single model-and-reasoning popover. The compact view handles
 * quick effort changes; the picker expands inside the same surface for model
 * selection. Provider state remains owned by the parent controller.
 */
export function AssistantModelPanel({
  model,
  status,
  disabled,
  modelOptions,
  catalogStatus,
  catalogWarning,
  catalogRefreshing,
  reasoningEffort,
  serviceTier = "default",
  onReasoningEffortChange,
  onServiceTierChange,
  onModelChange,
  onRetry,
}: AssistantModelPanelProps) {
  const { t } = useI18n();
  const controls = useAssistantModelPanel({
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
      className="overflow-hidden"
    >
      <AssistantModelCatalogNotice
        status={status}
        catalogStatus={catalogStatus}
        catalogWarning={catalogWarning}
        catalogRefreshing={catalogRefreshing}
        canRetry={controls.canRetry}
        onRetry={onRetry}
      />

      {controls.view === "compact" ? (
        <AssistantModelCompactPanel
          modelLabel={controls.effectiveModelLabel}
          effortLabel={controls.effortLabel}
          effortGroupName={controls.effortGroupName}
          effortOptions={controls.effortOptions}
          normalizedEffort={controls.normalizedEffort}
          serviceTier={serviceTier}
          supportsPriority={controls.supportsPriority}
          canReset={controls.canReset}
          canRefreshCatalog={catalogStatus !== undefined}
          catalogRefreshing={Boolean(catalogRefreshing)}
          disabled={disabled}
          onSelectEffort={onReasoningEffortChange}
          onToggleFast={controls.toggleFast}
          onOpenModels={() => controls.setView("models")}
          onRefreshCatalog={onRetry}
          onReset={controls.resetDefaults}
        />
      ) : (
        <AssistantModelPicker
          options={controls.options}
          visibleOptions={controls.visibleModelOptions}
          matchingCount={controls.matchingOptions.length}
          selectedModel={controls.normalizedModel}
          search={controls.modelSearch}
          customModel={controls.customModel}
          customModelInputId={controls.modelInputId}
          catalogStatus={catalogStatus}
          catalogWarning={catalogWarning}
          effortGroupName={controls.effortGroupName}
          effortOptions={controls.effortOptions}
          normalizedEffort={controls.normalizedEffort}
          serviceTier={serviceTier}
          supportsPriority={controls.supportsPriority}
          canReset={controls.canReset}
          canRefreshCatalog={catalogStatus !== undefined}
          catalogRefreshing={Boolean(catalogRefreshing)}
          disabled={disabled}
          onSearchChange={controls.setModelSearch}
          onCustomModelChange={controls.setCustomModel}
          onSelectModel={controls.selectModel}
          onApplyCustomModel={controls.applyCustomModel}
          onSelectEffort={onReasoningEffortChange}
          onToggleFast={controls.toggleFast}
          onOpenCompact={() => controls.setView("compact")}
          onRefreshCatalog={onRetry}
          onReset={controls.resetDefaults}
        />
      )}
    </section>
  );
}
