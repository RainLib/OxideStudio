import { MODEL_SEARCH_THRESHOLD } from "@/features/assistant-composer/model/modelOptions";
import { type AssistantModelCatalogStatus } from "@/features/assistant-composer/model/modelTypes";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AiCliModelInfo } from "@/services/tauri/ai.service";
import { Check, Search } from "lucide-react";

export function ModelMenu({
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
