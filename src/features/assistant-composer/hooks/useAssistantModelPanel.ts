import {
  displayEffectiveModelLabel,
  findSelectedModel,
  MAX_RENDERED_MODEL_OPTIONS,
  normalizeModelOptions,
} from "@/features/assistant-composer/model/modelOptions";
import type { AssistantModelPanelProps } from "@/features/assistant-composer/model/modelTypes";
import {
  formatEffort,
  normalizeEffortOptions,
} from "@/features/assistant-composer/model/reasoningEffort";
import { useI18n } from "@/i18n";
import type { AiCliModelInfo } from "@/services/tauri/ai.service";
import { useEffect, useId, useMemo, useState } from "react";

interface AssistantModelPanelOptions
  extends Omit<AssistantModelPanelProps, "onRetry"> {
  t: ReturnType<typeof useI18n>["t"];
  serviceTier: "default" | "priority";
}

export function useAssistantModelPanel({
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
}: AssistantModelPanelOptions) {
  const modelInputId = useId();
  const effortGroupName = useId();
  const [view, setView] = useState<"quick" | "advanced">("quick");
  const [activeMenu, setActiveMenu] = useState<
    "model" | "effort" | "speed" | null
  >(null);
  const [modelSearch, setModelSearch] = useState("");
  const [customModel, setCustomModel] = useState(model);
  const normalizedModel = model.trim();
  const normalizedEffort = reasoningEffort?.trim() || "default";
  const options = useMemo(
    () => normalizeModelOptions(modelOptions),
    [modelOptions],
  );
  const selectedModel = findSelectedModel(options, normalizedModel);
  const matchingOptions = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase();
    if (!query) return options;
    return options.filter(
      (option) =>
        option.id.toLocaleLowerCase().includes(query) ||
        option.label.toLocaleLowerCase().includes(query),
    );
  }, [modelSearch, options]);
  const visibleModelOptions = useMemo(() => {
    if (matchingOptions.length <= MAX_RENDERED_MODEL_OPTIONS) {
      return matchingOptions;
    }
    const visible = matchingOptions.slice(0, MAX_RENDERED_MODEL_OPTIONS);
    const selected = matchingOptions.find(
      (option) => option.id === normalizedModel,
    );
    if (selected && !visible.some((option) => option.id === selected.id)) {
      visible[visible.length - 1] = selected;
    }
    return visible;
  }, [matchingOptions, normalizedModel]);
  const effortOptions = useMemo(
    () => normalizeEffortOptions(selectedModel?.reasoningEfforts),
    [selectedModel?.reasoningEfforts],
  );
  const effectiveModelLabel = displayEffectiveModelLabel(
    options,
    selectedModel,
    normalizedModel,
    t("assistant.model.default"),
  );
  const effortLabel = formatEffort(
    normalizedEffort,
    t("assistant.model.default"),
  );
  const supportsPriority = Boolean(
    selectedModel?.serviceTiers?.some((tier) => tier.id === "priority"),
  );
  const priorityCapabilityKnown =
    Boolean(selectedModel) ||
    catalogStatus === "ready" ||
    catalogStatus === "empty";
  const canRetry =
    status.kind === "unavailable" ||
    status.kind === "authentication-error" ||
    catalogStatus === "error" ||
    Boolean(catalogWarning);
  const canReset =
    normalizedModel !== "default" ||
    normalizedEffort !== "default" ||
    serviceTier !== "default";
  const catalogPrimaryMessage =
    catalogStatus === "loading"
      ? t("assistant.model.catalogLoading")
      : catalogStatus === "empty"
        ? t("assistant.model.catalogEmpty")
        : catalogStatus === "error"
          ? t("assistant.model.catalogUnavailable")
          : catalogWarning
            ? t("assistant.model.catalogRefreshWarning")
            : null;

  useEffect(() => setCustomModel(model), [model]);
  useEffect(() => {
    if (activeMenu !== "model" || view !== "advanced") setModelSearch("");
  }, [activeMenu, view]);
  useEffect(() => {
    if (
      priorityCapabilityKnown &&
      !supportsPriority &&
      serviceTier === "priority"
    ) {
      onServiceTierChange?.("default");
    }
  }, [
    onServiceTierChange,
    priorityCapabilityKnown,
    serviceTier,
    supportsPriority,
  ]);

  const selectModel = (option: AiCliModelInfo) => {
    if (disabled || option.id === normalizedModel) return;
    onModelChange(option.id);
    if (
      normalizedEffort !== "default" &&
      (!option.reasoningEfforts?.length ||
        !option.reasoningEfforts.includes(normalizedEffort))
    ) {
      onReasoningEffortChange?.("default");
    }
    if (!option.serviceTiers?.some((tier) => tier.id === "priority")) {
      onServiceTierChange?.("default");
    }
    setActiveMenu(null);
  };

  const resetDefaults = () => {
    if (disabled) return;
    if (options.length && normalizedModel !== "default") {
      onModelChange("default");
    }
    if (normalizedEffort !== "default") {
      onReasoningEffortChange?.("default");
    }
    if (serviceTier !== "default") {
      onServiceTierChange?.("default");
    }
  };

  const toggleFast = () => {
    if (!disabled && supportsPriority) {
      onServiceTierChange?.(
        serviceTier === "priority" ? "default" : "priority",
      );
    }
  };

  return {
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
  };
}
