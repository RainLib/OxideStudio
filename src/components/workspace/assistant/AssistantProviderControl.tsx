import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { localizedCliSetupStatus } from "./assistantProviderCopy";
import type { AiProviderKind } from "@/services/tauri/ai.service";
import {
  ASSISTANT_PROVIDER_DEFINITIONS,
  type AssistantProviderDefinition,
} from "@/ai/assistant/providerDefinitions";
import type { AssistantCliSetupState } from "./AssistantProviderSetup";
import {
  Bot,
  Check,
  ChevronDown,
  Code2,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { BsOpenai } from "react-icons/bs";
import { useState } from "react";
import type { AssistantModelStatus } from "./AssistantModelControl";

const PROVIDER_ICONS: Record<AiProviderKind, LucideIcon> = {
  "openai-compatible": Bot,
  "codex-cli": TerminalSquare,
  "codebuddy-cli": Code2,
};

interface AssistantProviderControlProps {
  provider: AiProviderKind;
  enabled: boolean;
  destination: string | null;
  modelStatus: AssistantModelStatus;
  cliSetup: AssistantCliSetupState | null;
  isBusy: boolean;
  inHeader?: boolean;
  onSelect: (provider: AiProviderKind) => void;
}

export function AssistantProviderControl({
  provider,
  enabled,
  destination,
  modelStatus,
  cliSetup,
  isBusy,
  inHeader = false,
  onSelect,
}: AssistantProviderControlProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const status = providerStatus(enabled, modelStatus, cliSetup, t);
  const visibleDestination =
    inHeader || (cliSetup && cliSetup.phase !== "ready")
      ? status.label
      : destination || status.label;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex h-8 w-full shrink-0 items-center gap-2 text-left transition-colors hover:bg-[hsl(var(--wb-hover)/0.58)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))] motion-reduce:transition-none",
            inHeader
              ? "rounded-[4px] px-1.5"
              : "border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3",
          )}
          data-assistant-provider
          title={`${status.label}. ${status.detail}`}
          aria-label={`Assistant provider: ${enabled ? providerSelectorName(provider) : t("assistant.provider.chooseStatus")}`}
        >
          <span
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status.dotClass)}
            aria-hidden="true"
          />
          <ProviderBrandIcon provider={provider} />
          <span className="min-w-0 flex-1 truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
            <span className="font-medium text-[hsl(var(--wb-text))]">
              {enabled
                ? providerSelectorName(provider)
                : t("assistant.provider.choose")}
            </span>
            <span aria-hidden="true"> · </span>
            <span>
              {enabled
                ? visibleDestination
                : t("assistant.provider.notConnected")}
            </span>
          </span>
          {isBusy && (
            <span className="text-[9px] text-[hsl(var(--wb-text-muted))]">
              {t("assistant.provider.active")}
            </span>
          )}
          <ChevronDown
            size={11}
            className="shrink-0 text-[hsl(var(--wb-text-muted))] transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        data-assistant-provider-menu="true"
        align="start"
        side="bottom"
        sideOffset={5}
        role="dialog"
        aria-label={t("assistant.provider.choose")}
        className="w-[220px] p-1 text-[10px]"
      >
        <div className="space-y-0.5">
          {ASSISTANT_PROVIDER_DEFINITIONS.map((candidate) => (
            <ProviderOptionRow
              key={candidate.kind}
              option={candidate}
              selected={enabled && candidate.kind === provider}
              disabled={isBusy}
              onSelect={() => {
                onSelect(candidate.kind);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AssistantProviderWelcome({
  isBusy,
  onSelect,
  onOpenSettings,
}: {
  isBusy: boolean;
  onSelect: (provider: AiProviderKind) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="flex min-h-full items-center justify-center px-4 py-6"
      data-assistant-provider-onboarding
    >
      <div className="w-full max-w-[340px]">
        <Bot size={20} className="mb-3 text-[hsl(var(--wb-accent))]" />
        <h2 className="text-[13px] font-semibold text-[hsl(var(--wb-text))]">
          {t("assistant.provider.welcomeTitle")}
        </h2>
        <p className="mt-1 max-w-[44ch] text-[11px] leading-5 text-[hsl(var(--wb-text-muted))]">
          {t("assistant.provider.welcomeDescription")}
        </p>

        <div className="mt-4 border-y border-[hsl(var(--wb-border-subtle))]">
          {ASSISTANT_PROVIDER_DEFINITIONS.map((option) => (
            <ProviderOptionRow
              key={option.kind}
              option={option}
              selected={false}
              disabled={isBusy}
              roomy
              onSelect={() => onSelect(option.kind)}
            />
          ))}
        </div>

        <div className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          <ShieldCheck
            size={12}
            className="mt-0.5 shrink-0 text-emerald-500"
            aria-hidden="true"
          />
          <p>
            {t("assistant.provider.safety")}
          </p>
        </div>

        <button
          type="button"
          className="wb-text-button mt-3 h-7 px-2 text-[10px]"
          onClick={onOpenSettings}
        >
          <Settings2 size={11} aria-hidden="true" />
          {t("assistant.provider.advancedSetup")}
        </button>
      </div>
    </div>
  );
}

function ProviderOptionRow({
  option,
  selected,
  disabled,
  roomy = false,
  onSelect,
}: {
  option: AssistantProviderDefinition;
  selected: boolean;
  disabled: boolean;
  roomy?: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const Icon = PROVIDER_ICONS[option.kind];
  if (!roomy) {
    const displayName = providerSelectorName(option.kind);
    return (
      <button
        type="button"
        data-assistant-provider-option={option.kind}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-left outline-none transition-colors hover:bg-[hsl(var(--wb-hover))] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none",
          selected && "bg-[hsl(var(--wb-active))]",
        )}
        disabled={disabled}
        aria-label={t("assistant.provider.use", { provider: displayName })}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <ProviderBrandIcon provider={option.kind} />
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-[hsl(var(--wb-text))]">
          {displayName}
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-start gap-2.5 border-b border-[hsl(var(--wb-border-subtle))] px-3 text-left transition-colors last:border-b-0 hover:bg-[hsl(var(--wb-hover)/0.58)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none",
        roomy ? "py-2.5" : "py-2",
        selected && "bg-[hsl(var(--wb-accent)/0.08)]",
      )}
      disabled={disabled}
      aria-label={t("assistant.provider.use", { provider: option.label })}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <Icon
        size={14}
        className={cn(
          "mt-0.5 shrink-0 text-[hsl(var(--wb-text-muted))]",
          selected && "text-[hsl(var(--wb-accent))]",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium text-[hsl(var(--wb-text))]">
            {option.label}
          </span>
          <span className="rounded-[3px] bg-[hsl(var(--wb-hover))] px-1 py-0.5 font-mono text-[8px] text-[hsl(var(--wb-text-muted))]">
            {option.badge}
          </span>
        </span>
        <span className="mt-0.5 block max-w-[42ch] text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
          {localizedProviderDescription(option.kind, t)}
        </span>
        {roomy && (
          <span className="mt-1 block truncate font-mono text-[8px] text-[hsl(var(--wb-text-muted)/0.8)]">
            {option.capabilities.join(" · ")}
          </span>
        )}
      </span>
      {selected ? (
        <Check
          size={12}
          className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]"
          aria-hidden="true"
        />
      ) : (
        <ChevronDown
          size={10}
          className="mt-0.5 shrink-0 -rotate-90 text-[hsl(var(--wb-text-muted))] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

function ProviderBrandIcon({ provider }: { provider: AiProviderKind }) {
  return (
    <span
      data-assistant-provider-brand={provider}
      className="flex h-5 w-5 shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      {provider === "openai-compatible" ? (
        <img
          src="/oxide-logo.png"
          alt=""
          className="h-[18px] w-[18px] object-contain"
        />
      ) : provider === "codex-cli" ? (
        <BsOpenai className="h-[17px] w-[17px] text-[hsl(var(--wb-text))]" />
      ) : (
        <img
          src="/provider-icons/codebuddy.svg"
          alt=""
          className="h-[18px] w-[18px] object-contain"
        />
      )}
    </span>
  );
}

function providerSelectorName(provider: AiProviderKind) {
  if (provider === "openai-compatible") return "Oxide Assistant";
  if (provider === "codex-cli") return "OpenAI Codex";
  return "CodeBuddy Code";
}

function localizedProviderDescription(
  provider: AiProviderKind,
  t: ReturnType<typeof useI18n>["t"],
) {
  return t(
    provider === "openai-compatible"
      ? "assistant.provider.oxideDescription"
      : provider === "codex-cli"
        ? "assistant.provider.codexDescription"
        : "assistant.provider.codebuddyDescription",
  );
}

function providerStatus(
  enabled: boolean,
  modelStatus: AssistantModelStatus,
  cliSetup: AssistantCliSetupState | null,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (!enabled) {
    return {
      label: t("assistant.provider.chooseStatus"),
      detail: t("assistant.provider.chooseDetail"),
      dotClass: "bg-[hsl(var(--wb-text-muted))]",
      canRetry: false,
    };
  }
  if (
    cliSetup?.refreshing ||
    cliSetup?.phase === "checking" ||
    cliSetup?.phase === "installing"
  ) {
    return {
      label:
        cliSetup.phase === "installing"
          ? t("assistant.provider.installing")
          : t("assistant.provider.verifying"),
      detail: localizedCliSetupStatus(cliSetup, t),
      dotClass: "bg-amber-400",
      canRetry: false,
    };
  }
  if (cliSetup && cliSetup.phase !== "ready") {
    return {
      label:
        cliSetup.phase === "auth-required" || cliSetup.phase === "authorizing"
          ? t("assistant.provider.signInRequired")
          : t("assistant.provider.cliSetupRequired"),
      detail: localizedCliSetupStatus(cliSetup, t),
      dotClass:
        cliSetup.phase === "error" ? "bg-red-400" : "bg-amber-400",
      canRetry: cliSetup.phase === "error" || cliSetup.phase === "authorizing",
    };
  }
  if (modelStatus.kind === "configured") {
    return {
      label: t("assistant.provider.ready"),
      detail: cliSetup ? localizedCliSetupStatus(cliSetup, t) : modelStatus.detail,
      dotClass: "bg-emerald-400",
      canRetry: false,
    };
  }
  const checking = modelStatus.kind === "checking";
  return {
    label: modelStatus.label,
    detail: modelStatus.detail,
    dotClass: checking ? "bg-amber-400" : "bg-red-400",
    canRetry:
      modelStatus.kind === "unavailable" ||
      modelStatus.kind === "authentication-error",
  };
}
