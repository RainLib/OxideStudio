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
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AiCliModelInfo } from "@/services/tauri/ai.service";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  LoaderCircle,
  Search,
  Zap,
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
  serviceTier?: "default" | "priority";
  accessMode?: "restricted" | "full";
  fullAccessAvailable?: boolean;
  onOpenChange: (open: boolean) => void;
  onReasoningEffortChange?: (effort: string) => void;
  onServiceTierChange?: (tier: "default" | "priority") => void;
  onAccessModeChange?: (mode: "restricted" | "full") => void;
  onModelChange: (model: string) => void;
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
  const triggerLabel = status.kind === "missing" ? t("assistant.model.configure") : modelLabel;
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
    if (
      effort.trim().toLowerCase() !== "ultra" &&
      accessMode === "full"
    ) {
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

interface AssistantModelPanelProps {
  model: string;
  status: AssistantModelStatus;
  disabled: boolean;
  modelOptions?: readonly AiCliModelInfo[];
  catalogStatus?: AssistantModelCatalogStatus;
  catalogWarning?: string;
  reasoningEffort?: string;
  serviceTier?: "default" | "priority";
  onReasoningEffortChange?: (effort: string) => void;
  onServiceTierChange?: (tier: "default" | "priority") => void;
  onModelChange: (model: string) => void;
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
  serviceTier = "default",
  onReasoningEffortChange,
  onServiceTierChange,
  onModelChange,
  onRetry,
}: AssistantModelPanelProps) {
  const { t } = useI18n();
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
                    if (nextModel && nextModel !== normalizedModel && !disabled) {
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
              {activeMenu === "speed" && supportsPriority && onServiceTierChange && (
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

function AdvancedRow({
  label,
  value,
  active,
  menu,
  ariaLabel,
  onOpen,
}: {
  label: string;
  value: string;
  active: boolean;
  menu: "model" | "effort" | "speed";
  ariaLabel?: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-assistant-menu-trigger={menu}
      className={cn(
        "flex h-8 w-full items-center rounded-[7px] px-2 text-[10px] outline-none transition-colors hover:bg-[hsl(var(--wb-hover))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
        active && "bg-[hsl(var(--wb-active))]",
      )}
      onClick={onOpen}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onOpen();
      }}
      onFocus={onOpen}
      aria-label={ariaLabel}
      aria-expanded={active}
    >
      <span className="shrink-0 font-medium">{label}</span>
      <span className="ml-auto max-w-[126px] truncate text-[hsl(var(--wb-text-muted))]">
        {value}
      </span>
      <ChevronRight size={12} className="ml-1 shrink-0" aria-hidden="true" />
    </button>
  );
}

function OptionMenu({
  ariaLabel,
  options,
  selected,
  disabled,
  onSelect,
}: {
  ariaLabel: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }>;
  selected: string;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const checked = option.id === selected;
        return (
          <label
            key={option.id}
            className={cn(
              "flex min-h-10 cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-[10px] outline-none transition-colors hover:bg-[hsl(var(--wb-hover))] focus-within:ring-1 focus-within:ring-[hsl(var(--wb-accent))]",
              checked && "bg-[hsl(var(--wb-active))]",
              (disabled || option.disabled) && "cursor-default opacity-45",
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={ariaLabel}
              value={option.id}
              checked={checked}
              disabled={disabled || option.disabled}
              onChange={() => onSelect(option.id)}
              aria-label={option.label}
            />
            <span className="min-w-0 flex-1">
              <span className="block">{option.label}</span>
              {option.description && (
                <span className="block text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                  {option.description}
                </span>
              )}
            </span>
            {checked && (
              <Check size={12} className="shrink-0 text-[hsl(var(--wb-text-muted))]" />
            )}
          </label>
        );
      })}
    </div>
  );
}

function ModelMenu({
  options,
  visibleOptions,
  matchingCount,
  selectedModel,
  search,
  customModel,
  customModelInputId,
  catalogStatus,
  catalogWarning,
  disabled,
  onSearchChange,
  onCustomModelChange,
  onSelect,
  onApplyCustom,
}: {
  options: readonly AiCliModelInfo[];
  visibleOptions: readonly AiCliModelInfo[];
  matchingCount: number;
  selectedModel: string;
  search: string;
  customModel: string;
  customModelInputId: string;
  catalogStatus?: AssistantModelCatalogStatus;
  catalogWarning?: string;
  disabled: boolean;
  onSearchChange: (value: string) => void;
  onCustomModelChange: (value: string) => void;
  onSelect: (option: AiCliModelInfo) => void;
  onApplyCustom: () => void;
}) {
  const { t } = useI18n();
  if (!options.length && catalogStatus) {
    return (
      <div className="px-3 py-5 text-center text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
        {catalogStatus === "loading"
          ? t("assistant.model.modelsLoading")
          : catalogWarning || t("assistant.model.noCatalog")}
      </div>
    );
  }
  if (!options.length) {
    return (
      <form
        className="flex items-center gap-1 p-1"
        onSubmit={(event) => {
          event.preventDefault();
          onApplyCustom();
        }}
      >
        <label className="min-w-0 flex-1" htmlFor={customModelInputId}>
          <span className="sr-only">{t("assistant.model.identifier")}</span>
          <input
            id={customModelInputId}
            value={customModel}
            onChange={(event) => onCustomModelChange(event.target.value)}
            disabled={disabled}
            placeholder={t("assistant.model.identifier")}
            className="wb-field h-8 w-full font-mono text-[10px]"
          />
        </label>
        <button type="submit" className="wb-primary-button h-8 px-2 text-[9px]">
          {t("common.apply")}
        </button>
      </form>
    );
  }
  return (
    <>
      {options.length > MODEL_SEARCH_THRESHOLD && (
        <label className="mb-1 flex h-8 items-center gap-1.5 rounded-[6px] bg-[hsl(var(--wb-panel))] px-2 text-[hsl(var(--wb-text-muted))] focus-within:ring-1 focus-within:ring-[hsl(var(--wb-accent))]">
          <Search size={11} aria-hidden="true" />
          <span className="sr-only">{t("assistant.model.search")}</span>
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("assistant.model.search")}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[10px] outline-none placeholder:text-[hsl(var(--wb-text-muted))]"
          />
        </label>
      )}
      <div
        className="custom-scrollbar max-h-[208px] overflow-y-auto"
        role="radiogroup"
        aria-label="Assistant model"
      >
        {visibleOptions.map((option) => {
          const checked = option.id === selectedModel;
          return (
            <label
              key={option.id}
              className={cn(
                "flex h-8 cursor-pointer items-center gap-2 rounded-[6px] px-2 text-[10px] hover:bg-[hsl(var(--wb-hover))] focus-within:ring-1 focus-within:ring-[hsl(var(--wb-accent))]",
                checked && "bg-[hsl(var(--wb-active))]",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name="assistant-model"
                value={option.id}
                checked={checked}
                onChange={() => onSelect(option)}
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
              {checked && <Check size={11} className="shrink-0" />}
            </label>
          );
        })}
        {matchingCount === 0 && (
          <p className="px-2 py-4 text-center text-[9px] text-[hsl(var(--wb-text-muted))]">
            {t("assistant.model.noSearchResult")}
          </p>
        )}
        {matchingCount > visibleOptions.length && (
          <p className="px-2 py-2 text-center text-[9px] text-[hsl(var(--wb-text-muted))]">
            {t("assistant.model.showing", {
              visible: visibleOptions.length,
              total: matchingCount,
            })}
          </p>
        )}
      </div>
    </>
  );
}

function ReasoningTrack({
  name,
  options,
  selected,
  disabled,
  onSelect,
  accelerated = false,
  motionEnabled = true,
  compact = false,
}: {
  name: string;
  options: readonly string[];
  selected: string;
  disabled: boolean;
  onSelect: (value: string) => void;
  accelerated?: boolean;
  motionEnabled?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const values = ["default", ...options];
  const selectedIndex = Math.max(0, values.indexOf(selected));
  const fill =
    values.length > 1 ? (selectedIndex / (values.length - 1)) * 100 : 0;
  const selectedRank = effortRank(values[selectedIndex] ?? "default");
  const highestKnownRank = Math.max(
    0,
    ...options.map(effortRank).filter((rank) => rank < 50),
  );
  const maximumSelected =
    selectedIndex > 0 &&
    selectedRank < 50 &&
    selectedRank === highestKnownRank;
  const animated =
    motionEnabled && (accelerated || maximumSelected);

  return (
    <div className={cn(compact ? "mt-1" : "mt-4")}>
      {!compact && (
        <div className="mb-2 flex items-center justify-between text-[9px] text-[hsl(var(--wb-text-muted))]">
          <span>{t("assistant.model.reasoningEffort")}</span>
          <span>{formatEffort(selected, t("assistant.model.default"))}</span>
        </div>
      )}
      <div className="relative h-10 px-1">
        <div
          data-assistant-speed-tier={accelerated ? "priority" : "default"}
          data-assistant-reasoning-animation={
            animated ? (accelerated ? "fast" : "maximum") : "none"
          }
          className="pointer-events-none absolute left-1 right-1 top-1/2 h-6 -translate-y-1/2 overflow-hidden rounded-full bg-[hsl(var(--wb-hover))]"
        >
          <div
            className={cn(
              "relative h-full overflow-hidden rounded-full bg-[hsl(var(--wb-accent))] transition-[width,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              animated && "wb-assistant-energy-track",
            )}
            style={{ width: `${Math.max(fill, 8)}%` }}
          >
            {animated && (
              <div
                data-assistant-fast-particles="true"
                data-assistant-animation-speed={
                  accelerated ? "1.5x" : "standard"
                }
                className="absolute inset-0 motion-reduce:hidden"
                aria-hidden="true"
              >
                {[0, 1, 2, 3, 4, 5, 6].map((index) => (
                  <span
                    key={index}
                    className="wb-assistant-fast-particle"
                    style={{
                      top: `${22 + ((index * 31) % 58)}%`,
                      animationDelay: `${index * -115}ms`,
                      animationDuration: accelerated ? "800ms" : "1200ms",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        {!maximumSelected && (
          <div
            className="pointer-events-none absolute inset-x-4 top-1/2 flex -translate-y-1/2 justify-between"
            aria-hidden="true"
          >
            {values.map((value, index) => (
              <span
                key={`${value}-${index}`}
                data-assistant-reasoning-stop="true"
                className={cn(
                  "h-1 w-1 rounded-full",
                  index <= selectedIndex ? "bg-white/75" : "bg-white/30",
                )}
              />
            ))}
          </div>
        )}
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
          className="absolute inset-x-1 top-1/2 z-20 h-8 w-[calc(100%-0.5rem)] -translate-y-1/2 cursor-pointer opacity-0 disabled:cursor-default"
        />
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-[hsl(var(--wb-text))] shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-[left,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
            !disabled && "hover:scale-105",
          )}
          style={{
            left: `calc(0.25rem + ${fill}% - ${fill / 200}rem)`,
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
      serviceTiers: modelOptions.find((option) => option.isProviderDefault)
        ?.serviceTiers,
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
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter(
          (value) =>
            Boolean(value) && value.toLowerCase() !== "enabled",
        ),
    ),
  ];
}

function effortRank(value: string) {
  const rank: Record<string, number> = {
    none: 0,
    minimal: 0,
    low: 1,
    medium: 2,
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
  return null;
}
