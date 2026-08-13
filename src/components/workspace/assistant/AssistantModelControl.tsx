import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AiCliModelInfo } from "@/services/tauri/ai.service";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type RefObject } from "react";

export type AssistantModelStatusKind =
  | "configured"
  | "checking"
  | "missing"
  | "unavailable"
  | "authentication-error"
  | "incompatible";

export type AssistantModelStatus = {
  kind: AssistantModelStatusKind;
  label: string;
  detail: string;
};

export type AssistantModelCatalogStatus =
  "idle" | "loading" | "ready" | "empty" | "error";
const MODEL_SEARCH_THRESHOLD = 10;
const MAX_RENDERED_MODEL_OPTIONS = 100;

interface AssistantModelControlProps {
  model: string;
  endpoint: string;
  status: AssistantModelStatus;
  disabled: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  panelId: string;
  modelOptions?: readonly AiCliModelInfo[];
  catalogStatus?: AssistantModelCatalogStatus;
  catalogWarning?: string;
  reasoningEffort?: string;
  onOpenChange: (open: boolean) => void;
  onReasoningEffortChange?: (effort: string) => void;
  onModelChange: (model: string) => void;
  onOpenSettings: () => void;
  onRetry: () => void;
}

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
  onOpenChange,
  onReasoningEffortChange,
  onModelChange,
  onOpenSettings,
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
  const triggerLabel = status.kind === "missing" ? t("assistant.model.configure") : modelLabel;

  return (
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
            <span className={cn("shrink-0", effortToneClass(normalizedEffort))}>
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
        className="w-[min(316px,calc(100vw-20px))] overflow-hidden rounded-[12px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_8px_16px_rgba(0,0,0,0.38)] data-[state=closed]:slide-out-to-bottom-1 data-[state=open]:slide-in-from-bottom-1 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 motion-reduce:duration-0"
      >
        <AssistantModelPanel
          model={model}
          status={status}
          disabled={disabled}
          modelOptions={modelOptions}
          catalogStatus={catalogStatus}
          catalogWarning={catalogWarning}
          reasoningEffort={reasoningEffort}
          onReasoningEffortChange={onReasoningEffortChange}
          onModelChange={onModelChange}
          onOpenSettings={onOpenSettings}
          onRetry={onRetry}
        />
      </PopoverContent>
    </Popover>
  );
}

interface AssistantModelPanelProps {
  model: string;
  status: AssistantModelStatus;
  disabled: boolean;
  modelOptions?: readonly AiCliModelInfo[];
  catalogStatus?: AssistantModelCatalogStatus;
  catalogWarning?: string;
  reasoningEffort?: string;
  onReasoningEffortChange?: (effort: string) => void;
  onModelChange: (model: string) => void;
  onOpenSettings: () => void;
  onRetry: () => void;
}

function AssistantModelPanel({
  model,
  status,
  disabled,
  modelOptions,
  catalogStatus,
  catalogWarning,
  reasoningEffort,
  onReasoningEffortChange,
  onModelChange,
  onOpenSettings,
  onRetry,
}: AssistantModelPanelProps) {
  const { t } = useI18n();
  const modelInputId = useId();
  const effortGroupName = useId();
  const [view, setView] = useState<"quick" | "advanced">("quick");
  const [modelListOpen, setModelListOpen] = useState(false);
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
  const canRetry =
    status.kind === "unavailable" ||
    status.kind === "authentication-error" ||
    catalogStatus === "error" ||
    Boolean(catalogWarning);
  const canReset =
    normalizedModel !== "default" || normalizedEffort !== "default";
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
    if (!modelListOpen || view !== "advanced") setModelSearch("");
  }, [modelListOpen, view]);

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
  };

  const resetDefaults = () => {
    if (disabled) return;
    if (options.length && normalizedModel !== "default") {
      onModelChange("default");
    }
    if (normalizedEffort !== "default") {
      onReasoningEffortChange?.("default");
    }
  };

  return (
    <section aria-label={t("assistant.model.controls")} className="relative">
      {status.kind !== "configured" && (
        <div className="mx-3 mt-3 flex min-h-7 items-center gap-1.5 rounded-[6px] bg-[hsl(var(--wb-hover))] px-2">
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
            className="mx-3 mt-3 flex min-h-7 items-center gap-1.5 rounded-[6px] bg-[hsl(var(--wb-hover))] px-2"
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

      <div className="grid overflow-hidden [grid-template-areas:'surface']">
        <div
          data-assistant-model-view="quick"
          aria-hidden={view !== "quick"}
          inert={view !== "quick"}
          className={cn(
            "[grid-area:surface] transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            view === "quick"
              ? "translate-x-0 opacity-100"
              : "pointer-events-none -translate-x-8 opacity-0",
          )}
        >
          <div className="px-4 pb-3 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[9px] text-[hsl(var(--wb-text-muted))]">
                  {t("assistant.model.label")}
                </div>
                <div
                  data-assistant-current-model="true"
                  className="mt-0.5 truncate text-[13px] font-medium"
                >
                  {displayEffectiveModelLabel(
                    options,
                    selectedModel,
                    normalizedModel,
                    t("assistant.model.default"),
                  )}
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full bg-[hsl(var(--wb-hover))] px-2 py-1 text-[10px] font-medium",
                  effortToneClass(normalizedEffort),
                )}
              >
                {formatEffort(normalizedEffort, t("assistant.model.default"))}
              </span>
            </div>

            {effortOptions.length > 0 && onReasoningEffortChange && (
              <ReasoningTrack
                name={effortGroupName}
                options={effortOptions}
                selected={normalizedEffort}
                disabled={disabled}
                onSelect={onReasoningEffortChange}
              />
            )}
          </div>

          <div className="flex items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] px-2 py-1.5">
            <button
              type="button"
              className="wb-text-button h-7 px-2 text-[10px]"
              onClick={() => setView("advanced")}
            >
              <SlidersHorizontal size={11} />
              {t("assistant.model.advanced")}
            </button>
            <button
              type="button"
              className="wb-text-button h-7 px-2 text-[9px]"
              onClick={resetDefaults}
              disabled={!canReset}
            >
              <RotateCcw size={10} />
              {t("assistant.model.reset")}
            </button>
          </div>
        </div>

        <div
          data-assistant-model-view="advanced"
          aria-hidden={view !== "advanced"}
          inert={view !== "advanced"}
          className={cn(
            "[grid-area:surface] transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            view === "advanced"
              ? "translate-x-0 opacity-100"
              : "pointer-events-none translate-x-8 opacity-0",
          )}
        >
          <div className="flex min-h-10 items-center gap-1 border-b border-[hsl(var(--wb-border-subtle))] px-2">
            <button
              type="button"
              className="wb-icon-button h-7 w-7"
              onClick={() => setView("quick")}
              aria-label={t("assistant.model.backToReasoning")}
            >
              <ChevronLeft size={13} />
            </button>
            <span className="text-[11px] font-medium">
              {t("assistant.model.advanced")}
            </span>
          </div>

          <div className="p-2.5">
            {options.length > 0 ? (
              <div className="rounded-[8px] border border-[hsl(var(--wb-border-subtle))]">
                <button
                  type="button"
                  className="flex h-10 w-full items-center gap-2 rounded-[8px] px-2.5 text-left outline-none transition-colors hover:bg-[hsl(var(--wb-hover))] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]"
                  onClick={() => setModelListOpen((current) => !current)}
                  aria-label={t("assistant.model.toggleList")}
                  aria-expanded={modelListOpen}
                >
                  <Bot
                    size={12}
                    className="shrink-0 text-[hsl(var(--wb-text-muted))]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9px] text-[hsl(var(--wb-text-muted))]">
                      {t("assistant.model.label")}
                    </span>
                    <span className="block truncate text-[10px]">
                      {displayEffectiveModelLabel(
                        options,
                        selectedModel,
                        normalizedModel,
                        t("assistant.model.default"),
                      )}
                    </span>
                  </span>
                  <ChevronDown
                    size={11}
                    className={cn(
                      "transition-transform duration-150 motion-reduce:transition-none",
                      modelListOpen && "rotate-180",
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                    modelListOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    {modelListOpen && (
                      <div
                        className="border-t border-[hsl(var(--wb-border-subtle))] p-1"
                      >
                        {options.length > MODEL_SEARCH_THRESHOLD && (
                          <label className="mb-1 flex h-8 items-center gap-1.5 rounded-[5px] bg-[hsl(var(--wb-panel))] px-2 text-[hsl(var(--wb-text-muted))] focus-within:ring-1 focus-within:ring-inset focus-within:ring-[hsl(var(--wb-accent))]">
                            <Search size={11} className="shrink-0" aria-hidden="true" />
                            <span className="sr-only">
                              {t("assistant.model.search")}
                            </span>
                            <input
                              value={modelSearch}
                              onChange={(event) => setModelSearch(event.target.value)}
                              placeholder={t("assistant.model.search")}
                              autoComplete="off"
                              spellCheck={false}
                              className="min-w-0 flex-1 bg-transparent text-[10px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))]"
                            />
                          </label>
                        )}
                        <div
                          className="custom-scrollbar max-h-[176px] overflow-y-auto"
                          role="radiogroup"
                          aria-label="Assistant model"
                        >
                          {visibleModelOptions.map((option) => {
                            const checked = option.id === normalizedModel;
                            return (
                              <label
                                key={option.id}
                                className={cn(
                                  "flex h-8 cursor-pointer items-center gap-2 rounded-[5px] px-2 text-[10px] outline-none transition-colors focus-within:ring-1 focus-within:ring-inset focus-within:ring-[hsl(var(--wb-accent))]",
                                  checked
                                    ? "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]"
                                    : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]",
                                )}
                              >
                                <input
                                  type="radio"
                                  className="sr-only"
                                  name="assistant-model"
                                  value={option.id}
                                  checked={checked}
                                  onChange={() => selectModel(option)}
                                  disabled={disabled}
                                  aria-label={
                                    option.id === "default"
                                      ? t("assistant.model.default")
                                      : option.label
                                  }
                                />
                                <span className="min-w-0 flex-1 truncate">
                                  {option.id === "default"
                                    ? t("assistant.model.default")
                                    : option.label}
                                </span>
                                {checked && (
                                  <Check
                                    size={11}
                                    className="shrink-0 text-[hsl(var(--wb-accent))]"
                                  />
                                )}
                              </label>
                            );
                          })}
                          {matchingOptions.length === 0 && (
                            <p
                              className="px-2 py-4 text-center text-[9px] text-[hsl(var(--wb-text-muted))]"
                              role="status"
                            >
                              {t("assistant.model.noSearchResult")}
                            </p>
                          )}
                          {matchingOptions.length > visibleModelOptions.length && (
                            <p
                              className="px-2 py-2 text-center text-[9px] text-[hsl(var(--wb-text-muted))]"
                              role="status"
                            >
                              {t("assistant.model.showing", {
                                visible: visibleModelOptions.length,
                                total: matchingOptions.length,
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : catalogStatus ? (
              <div className="flex min-h-16 items-center justify-center rounded-[8px] border border-[hsl(var(--wb-border-subtle))] px-3 text-center text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                {catalogStatus === "loading"
                  ? t("assistant.model.modelsLoading")
                  : catalogWarning || t("assistant.model.noCatalog")}
              </div>
            ) : (
              <form
                className="flex items-end gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  const nextModel = customModel.trim();
                  if (nextModel && nextModel !== normalizedModel && !disabled) {
                    onModelChange(nextModel);
                  }
                }}
              >
                <label className="min-w-0 flex-1" htmlFor={modelInputId}>
                  <span className="sr-only">
                    {t("assistant.model.identifier")}
                  </span>
                  <input
                    id={modelInputId}
                    value={customModel}
                    onChange={(event) => setCustomModel(event.target.value)}
                    disabled={disabled}
                    placeholder={t("assistant.model.identifier")}
                    autoComplete="off"
                    spellCheck={false}
                    className="wb-field h-8 w-full font-mono text-[10px]"
                  />
                </label>
                <button
                  type="submit"
                  className="wb-primary-button h-8 px-2 text-[9px]"
                  disabled={
                    !customModel.trim() ||
                    customModel.trim() === normalizedModel ||
                    disabled
                  }
                >
                  {t("common.apply")}
                </button>
              </form>
            )}

            {effortOptions.length > 0 && onReasoningEffortChange && (
              <div className="mt-2 rounded-[8px] border border-[hsl(var(--wb-border-subtle))] px-2.5 pb-2.5 pt-2">
                <div className="flex items-center justify-between gap-2 pb-1.5">
                  <span className="text-[10px] font-medium">
                    {t("assistant.model.reasoning")}
                  </span>
                  <span
                    className={cn(
                      "text-[9px]",
                      effortToneClass(normalizedEffort),
                    )}
                  >
                    {formatEffort(normalizedEffort, t("assistant.model.default"))}
                  </span>
                </div>
                <ReasoningTrack
                  name={`${effortGroupName}-advanced`}
                  options={effortOptions}
                  selected={normalizedEffort}
                  disabled={disabled}
                  onSelect={onReasoningEffortChange}
                  compact
                />
              </div>
            )}
          </div>

          <div className="flex items-center border-t border-[hsl(var(--wb-border-subtle))] px-2 py-1.5">
            <button
              type="button"
              className="wb-text-button h-7 px-2 text-[9px]"
              onClick={resetDefaults}
              disabled={!canReset}
            >
              <RotateCcw size={10} />
              {t("assistant.model.reset")}
            </button>
            <button
              type="button"
              className="wb-text-button ml-auto h-7 px-2 text-[9px]"
              onClick={onOpenSettings}
            >
              <Settings2 size={10} />
              {t("common.settings")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReasoningTrack({
  name,
  options,
  selected,
  disabled,
  onSelect,
  compact = false,
}: {
  name: string;
  options: readonly string[];
  selected: string;
  disabled: boolean;
  onSelect: (value: string) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const values = ["default", ...options];
  const selectedIndex = Math.max(0, values.indexOf(selected));
  const fill =
    values.length > 1 ? (selectedIndex / (values.length - 1)) * 100 : 0;
  const activeRank = effortRank(values[selectedIndex] ?? "default");

  return (
    <div className={cn(!compact && "mt-4")}>
      {!compact && (
        <div className="mb-2 flex items-center justify-between text-[9px] text-[hsl(var(--wb-text-muted))]">
          <span>{t("assistant.model.reasoningEffort")}</span>
          <span>{formatEffort(selected, t("assistant.model.default"))}</span>
        </div>
      )}
      <div className="relative h-10 px-1">
        <div className="pointer-events-none absolute left-2 right-2 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-[hsl(var(--wb-hover))]">
          <div
            className={cn(
              "relative h-full rounded-full transition-[width,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              activeRank >= 4 && activeRank < 50
                ? "bg-[hsl(var(--wb-brand))]"
                : "bg-[hsl(var(--wb-accent))]",
            )}
            style={{ width: `${Math.max(fill, 3)}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 opacity-70 motion-reduce:hidden"
            style={{ width: `${fill}%` }}
            aria-hidden="true"
          >
            {[18, 39, 61, 82].map((left, index) => (
              <span
                key={left}
                className="absolute top-1/2 h-0.5 w-0.5 -translate-y-1/2 rounded-full bg-white/80 animate-pulse motion-reduce:animate-none"
                style={{
                  left: `${left}%`,
                  animationDelay: `${index * 120}ms`,
                }}
              />
            ))}
          </div>
        </div>
        <input
          type="range"
          data-assistant-reasoning-track="true"
          name={name}
          min={0}
          max={Math.max(0, values.length - 1)}
          step={1}
          value={selectedIndex}
          disabled={disabled}
          onChange={(event) =>
            onSelect(values[Number(event.target.value)] ?? "default")
          }
          aria-label={t("assistant.model.reasoningEffort")}
          aria-valuetext={formatEffort(
            values[selectedIndex] ?? "default",
            t("assistant.model.default"),
          )}
          className="absolute inset-x-1 top-1/2 z-10 h-8 w-[calc(100%-0.5rem)] -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-default"
        />
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 z-10 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-[hsl(var(--wb-text))] shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-[left,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            !disabled && "hover:scale-105",
          )}
          style={{
            left: `calc(0.5rem + ${fill}% - ${fill / 100}rem)`,
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

function normalizeModelOptions(modelOptions?: readonly AiCliModelInfo[]) {
  if (!modelOptions?.length) return [];
  if (modelOptions.some((option) => option.id === "default")) {
    return modelOptions;
  }
  return [
    {
      id: "default",
      label: "Provider default",
      isDefault: true,
      reasoningEfforts: modelOptions.find((option) => option.isProviderDefault)
        ?.reasoningEfforts,
    },
    ...modelOptions,
  ];
}

function findSelectedModel(options: readonly AiCliModelInfo[], model: string) {
  return options.find((option) => option.id === model);
}

function displayModelLabel(
  selected: AiCliModelInfo | undefined,
  model: string,
  defaultLabel: string,
) {
  if (model === "default") return defaultLabel;
  return selected?.label || model || defaultLabel;
}

function displayEffectiveModelLabel(
  options: readonly AiCliModelInfo[],
  selected: AiCliModelInfo | undefined,
  model: string,
  defaultLabel: string,
) {
  if (model !== "default") return selected?.label || model || defaultLabel;
  const concreteDefault = options.find(
    (option) => option.id !== "default" && option.isProviderDefault,
  );
  return concreteDefault?.label || defaultLabel;
}

function normalizeEffortOptions(values?: readonly string[]) {
  if (!values?.length) return [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function effortRank(value: string) {
  const rank: Record<string, number> = {
    none: 0,
    minimal: 0,
    low: 1,
    medium: 2,
    enabled: 2,
    high: 3,
    xhigh: 4,
    max: 5,
    ultra: 6,
  };
  return rank[value.toLowerCase()] ?? 50;
}

function effortToneClass(value: string) {
  const rank = effortRank(value);
  if (rank >= 4 && rank < 50) return "text-[hsl(var(--wb-brand))]";
  if (rank >= 3 && rank < 50) return "text-[hsl(var(--wb-accent))]";
  return "text-[hsl(var(--wb-text-muted))]";
}

function formatEffort(value: string, defaultLabel = "Default") {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "default") return defaultLabel;
  if (normalized === "xhigh") return "Extra high";
  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character: string) => character.toUpperCase());
}

function ModelStatusIcon({ status }: { status: AssistantModelStatusKind }) {
  if (status === "checking") {
    return (
      <LoaderCircle
        size={11}
        className="shrink-0 animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none"
      />
    );
  }
  if (status === "authentication-error") {
    return (
      <CircleAlert
        size={11}
        className="shrink-0 text-[hsl(var(--destructive))]"
      />
    );
  }
  if (
    status === "missing" ||
    status === "unavailable" ||
    status === "incompatible"
  ) {
    return <AlertTriangle size={11} className="shrink-0 text-amber-400" />;
  }
  return (
    <SlidersHorizontal
      size={11}
      className="shrink-0 text-[hsl(var(--wb-text-muted))]"
    />
  );
}
