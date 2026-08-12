import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { AiCliModelInfo } from "@/services/tauri/ai.service";

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

interface AssistantModelControlProps {
  model: string;
  endpoint: string;
  status: AssistantModelStatus;
  disabled: boolean;
  modelOptions?: readonly AiCliModelInfo[];
  reasoningEffort?: string;
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
  modelOptions,
  reasoningEffort,
  onReasoningEffortChange,
  onModelChange,
  onOpenSettings,
  onRetry,
}: AssistantModelControlProps) {
  const [open, setOpen] = useState(false);
  const [draftModel, setDraftModel] = useState(model);
  const [draftEffort, setDraftEffort] = useState(reasoningEffort || "default");
  const modelInputId = useId();

  useEffect(() => {
    if (!open) {
      setDraftModel(model);
      setDraftEffort(reasoningEffort || "default");
    }
  }, [model, open, reasoningEffort]);

  const normalizedModel = draftModel.trim();
  const modelChanged = normalizedModel !== model.trim();
  const effortChanged = draftEffort !== (reasoningEffort || "default");
  const selectedModel = modelOptions?.find(
    (option) => option.id === normalizedModel,
  );
  const effortOptions = selectedModel?.reasoningEfforts ?? [];
  const triggerLabel =
    status.kind === "missing" ? "Configure AI" : model.trim() || "Configure AI";
  const canRetry =
    status.kind === "unavailable" ||
    status.kind === "authentication-error";

  const applyModel = () => {
    if (!normalizedModel || (!modelChanged && !effortChanged) || disabled) return;
    if (modelChanged) onModelChange(normalizedModel);
    if (effortChanged) onReasoningEffortChange?.(draftEffort);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setDraftModel(model);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "wb-text-button h-6 min-w-0 max-w-[148px] shrink gap-1 px-1.5 text-[10px] data-[state=open]:bg-[hsl(var(--wb-hover))]",
            status.kind === "authentication-error" &&
              "text-[hsl(var(--destructive))]",
            (status.kind === "missing" ||
              status.kind === "unavailable" ||
              status.kind === "incompatible") && "text-amber-400",
          )}
          title={`${triggerLabel} · ${status.label}. ${status.detail}`}
          aria-label={`Assistant model: ${triggerLabel}. ${status.label}`}
        >
          <ModelStatusIcon status={status.kind} />
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown size={10} className="shrink-0 opacity-75" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="top"
        sideOffset={6}
        className="w-[292px] rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[10px] text-[hsl(var(--wb-text))] shadow-[0_4px_8px_rgba(0,0,0,0.34)]"
      >
        <div className="flex items-start gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2.5">
          <ModelStatusIcon status={status.kind} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{status.label}</div>
            <p className="mt-0.5 leading-4 text-[hsl(var(--wb-text-muted))]">
              {status.detail}
            </p>
          </div>
        </div>

        <form
          className="space-y-2 px-3 py-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            applyModel();
          }}
        >
          <label className="block" htmlFor={modelInputId}>
            <span className="mb-1 block text-[hsl(var(--wb-text-muted))]">
              Model
            </span>
            {modelOptions?.length ? (
              <select
                id={modelInputId}
                value={draftModel}
                onChange={(event) => {
                  setDraftModel(event.target.value);
                  const nextModel = modelOptions.find(
                    (option) => option.id === event.target.value,
                  );
                  if (
                    nextModel?.reasoningEfforts?.length &&
                    draftEffort !== "default" &&
                    !nextModel.reasoningEfforts.includes(draftEffort)
                  ) {
                    setDraftEffort("default");
                  }
                }}
                disabled={disabled}
                className="wb-field w-full font-mono text-[10px]"
              >
                {modelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}{option.isDefault ? " · default" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={modelInputId}
                value={draftModel}
                onChange={(event) => setDraftModel(event.target.value)}
                disabled={disabled}
                placeholder="Model identifier"
                autoComplete="off"
                spellCheck={false}
                className="wb-field w-full font-mono text-[10px]"
              />
            )}
          </label>

          {effortOptions.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-[hsl(var(--wb-text-muted))]">
                Reasoning effort
              </span>
              <select
                value={draftEffort}
                onChange={(event) => setDraftEffort(event.target.value)}
                disabled={disabled}
                className="wb-field w-full text-[10px]"
              >
                <option value="default">Provider default</option>
                {effortOptions.map((effort) => (
                  <option key={effort} value={effort}>
                    {formatEffort(effort)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="min-w-0">
            <div className="text-[hsl(var(--wb-text-muted))]">Endpoint</div>
            <div
              className="mt-0.5 truncate font-mono text-[9px] text-[hsl(var(--wb-text-muted))]"
              title={endpoint || "Not configured"}
            >
              {endpoint || "Not configured"}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              className="wb-text-button -ml-1 h-7 px-1.5 text-[10px]"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <Settings2 size={11} />
              AI settings
            </button>

            <div className="flex items-center gap-1">
              {canRetry && (
                <button
                  type="button"
                  className="wb-text-button h-7 px-2 text-[10px]"
                  onClick={() => {
                    setOpen(false);
                    onRetry();
                  }}
                >
                  Retry
                </button>
              )}
              <button
                type="submit"
                className="wb-primary-button h-7 px-2 text-[10px]"
                disabled={
                  !normalizedModel || (!modelChanged && !effortChanged) || disabled
                }
              >
                <Check size={11} />
                Apply
              </button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function formatEffort(value: string) {
  if (value === "enabled") return "On (provider default)";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character: string) => character.toUpperCase());
}

function ModelStatusIcon({
  status,
  className,
}: {
  status: AssistantModelStatusKind;
  className?: string;
}) {
  if (status === "checking") {
    return (
      <LoaderCircle
        size={11}
        className={cn(
          "shrink-0 animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none",
          className,
        )}
      />
    );
  }
  if (status === "authentication-error") {
    return (
      <CircleAlert
        size={11}
        className={cn("shrink-0 text-[hsl(var(--destructive))]", className)}
      />
    );
  }
  if (
    status === "missing" ||
    status === "unavailable" ||
    status === "incompatible"
  ) {
    return (
      <AlertTriangle
        size={11}
        className={cn("shrink-0 text-amber-400", className)}
      />
    );
  }
  return (
    <SlidersHorizontal
      size={11}
      className={cn("shrink-0 text-[hsl(var(--wb-text-muted))]", className)}
    />
  );
}
