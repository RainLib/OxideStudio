import {
  ASSISTANT_MODE_OPTIONS,
  assistantModeOption,
  type AssistantMode,
} from "@/ai/assistant/modes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useEffect, useRef } from "react";
import type {
  AssistantContextPreview,
  AssistantContextSettings,
} from "@/ai/assistant/contextPreview";
import {
  AssistantModelControl,
  type AssistantModelStatus,
} from "./AssistantModelControl";
import {
  Bot,
  Check,
  ChevronDown,
  Cloud,
  Database,
  FileText,
  History,
  Gauge,
  KeyRound,
  Layers3,
  ListTree,
  MessageSquare,
  Paperclip,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Square,
  TextSelect,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

interface AssistantPromptBoxProps {
  message: string;
  onMessageChange: (message: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  activeContextLabel: string;
  contextPreview: AssistantContextPreview;
  contextSettings: AssistantContextSettings;
  onContextSettingChange: (
    key: keyof AssistantContextSettings,
    checked: boolean,
  ) => void;
  isSubmitting: boolean;
  isToolRunning: boolean;
  isCancelling: boolean;
  model: string;
  modelEndpoint: string;
  modelStatus: AssistantModelStatus;
  onModelChange: (model: string) => void;
  onOpenAiSettings: () => void;
  onRetryModel: () => void;
  submissionBlockReason: string | null;
  attachments: Array<{ id: string; fileName: string; byteCount: number }>;
  attachmentError: string | null;
  isAddingAttachment: boolean;
  onAddAttachment: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
}

const MODE_ICONS: Record<AssistantMode, LucideIcon> = {
  o2: Sparkles,
  plan: ListTree,
  agent: Bot,
  chat: MessageSquare,
};

const menuContentClass =
  "w-[276px] rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[hsl(var(--wb-text))] shadow-[0_8px_24px_rgba(0,0,0,0.32)]";

export function AssistantPromptBox({
  message,
  onMessageChange,
  onSubmit,
  onStop,
  mode,
  onModeChange,
  activeContextLabel,
  contextPreview,
  contextSettings,
  onContextSettingChange,
  isSubmitting,
  isToolRunning,
  isCancelling,
  model,
  modelEndpoint,
  modelStatus,
  onModelChange,
  onOpenAiSettings,
  onRetryModel,
  submissionBlockReason,
  attachments,
  attachmentError,
  isAddingAttachment,
  onAddAttachment,
  onRemoveAttachment,
}: AssistantPromptBoxProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const currentMode = assistantModeOption(mode);
  const CurrentModeIcon = MODE_ICONS[mode];
  const canSubmit =
    Boolean(message.trim()) &&
    !isSubmitting &&
    !isToolRunning &&
    !submissionBlockReason;
  const submitLabel =
    mode === "plan"
      ? t("assistant.createPlan")
      : mode === "agent"
        ? t("assistant.runAgent")
        : t("assistant.send");
  const contextLocked = isSubmitting || isToolRunning;
  const updateContextSetting = (
    key: keyof AssistantContextSettings,
    checked: boolean,
  ) => onContextSettingChange(key, checked);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 52), 180);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 180 ? "auto" : "hidden";
  }, [message]);

  return (
    <div className="shrink-0 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-2">
      <div className="rounded-[8px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] transition-colors focus-within:border-[hsl(var(--wb-accent))]">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-2 pt-2" aria-label="Attached files">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] px-1.5 py-1 text-[9px] text-[hsl(var(--wb-text-muted))]"
                title={`${attachment.fileName} · ${attachment.byteCount.toLocaleString()} bytes`}
              >
                <FileText size={10} className="shrink-0" aria-hidden="true" />
                <span className="truncate">{attachment.fileName}</span>
                <button
                  type="button"
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  disabled={contextLocked}
                  aria-label={`Remove ${attachment.fileName}`}
                >
                  <X size={9} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          data-assistant-prompt="true"
          value={message}
          onChange={(event) => onMessageChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (canSubmit) onSubmit();
            }
          }}
          placeholder={t("assistant.prompt")}
          rows={1}
          className="custom-scrollbar min-h-[52px] max-h-[180px] w-full resize-none bg-transparent px-2.5 pb-1 pt-2.5 text-[11px] leading-5 text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))]"
          aria-label={t("assistant.messageAria")}
        />

        <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
          <div className="flex min-w-0 items-center gap-0.5">
            <button
              type="button"
              className="wb-icon-button relative h-6 w-6"
              onClick={onAddAttachment}
              disabled={contextLocked || isAddingAttachment || attachments.length >= 4}
              title={
                attachments.length >= 4
                  ? "Up to 4 text attachments per request"
                  : "Attach a text or data file (64 KiB each)"
              }
              aria-label="Attach file"
            >
              <Paperclip size={11} aria-hidden="true" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={isSubmitting || isToolRunning}
                  className="wb-text-button h-6 min-w-0 px-1.5 text-[10px] text-[hsl(var(--wb-text))] data-[state=open]:bg-[hsl(var(--wb-hover))]"
                  title={currentMode.description}
                  aria-label={`Assistant mode: ${currentMode.label}`}
                >
                  <CurrentModeIcon
                    size={11}
                    className="shrink-0 text-[hsl(var(--wb-accent))]"
                  />
                  <span className="truncate">{currentMode.label}</span>
                  <ChevronDown size={10} className="shrink-0 wb-muted" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="top"
                sideOffset={6}
                className={menuContentClass}
              >
                {ASSISTANT_MODE_OPTIONS.map((option) => {
                  const Icon = MODE_ICONS[option.id];
                  return (
                    <DropdownMenuItem
                      key={option.id}
                      className="min-h-11 cursor-default items-start gap-2 rounded-[4px] px-2 py-1.5 focus:bg-[hsl(var(--wb-active))] focus:text-[hsl(var(--wb-text))]"
                      onClick={() => onModeChange(option.id)}
                    >
                      <Icon
                        size={13}
                        className="mt-0.5 shrink-0 text-[hsl(var(--wb-text-muted))]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[11px] font-medium">
                          {option.label}
                          <span className="font-normal text-[9px] text-[hsl(var(--wb-text-muted))]">
                            {option.shortDescription}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                          {option.description}
                        </span>
                      </span>
                      <Check
                        size={11}
                        className={cn(
                          "mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]",
                          option.id !== mode && "opacity-0"
                        )}
                      />
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="wb-icon-button relative h-6 w-6"
                  title={t("assistant.workspaceContext")}
                  aria-label={t("assistant.workspaceContextAria")}
                >
                  <Layers3 size={11} />
                  {contextPreview.selection.available &&
                    contextSettings.includeSelection && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[hsl(var(--wb-accent))]" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="top"
                sideOffset={6}
                className="max-h-[min(620px,calc(100vh-24px))] w-[360px] overflow-y-auto rounded-[8px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[10px] text-[hsl(var(--wb-text))] shadow-[0_12px_36px_rgba(0,0,0,0.38)]"
              >
                <div className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">Context for next request</div>
                    <span className="rounded-[4px] bg-[hsl(var(--wb-active))] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
                      {contextPreview.resolvedMode}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-start gap-2 text-[hsl(var(--wb-text-muted))]">
                    {contextPreview.destination === "provider" ? (
                      <Cloud size={12} className="mt-0.5 shrink-0" />
                    ) : (
                      <ShieldCheck size={12} className="mt-0.5 shrink-0" />
                    )}
                    <span className="min-w-0 break-words leading-4">
                      {contextPreview.destinationLabel}
                    </span>
                  </div>
                </div>

                <div className="space-y-0.5 px-2 py-2">
                  <ContextFact
                    icon={Database}
                    label="Database identity"
                    detail={contextPreview.databaseIdentity}
                  />
                  <ContextFact
                    icon={MessageSquare}
                    label="Your prompt"
                    detail={characterDetail(contextPreview.prompt)}
                  />
                  <ContextFact
                    icon={Gauge}
                    label="Estimated input"
                    detail={tokenBudgetDetail(contextPreview)}
                  />
                  {contextPreview.sendsToolManifest && (
                    <ContextFact
                      icon={Wrench}
                      label="Tool manifest"
                      detail={`${contextPreview.toolManifestCount} tools · ~${contextPreview.tokenBudget.toolManifestTokens.toLocaleString()} tokens · names, permissions and input schemas`}
                    />
                  )}
                  {contextPreview.previousCompaction && (
                    <ContextFact
                      icon={Layers3}
                      label="Project compaction · 7d"
                      detail={compactionDetail(contextPreview)}
                    />
                  )}
                  {contextPreview.previousModelUsage && (
                    <ContextFact
                      icon={Gauge}
                      label="Provider usage · 7d"
                      detail={modelUsageDetail(contextPreview)}
                    />
                  )}
                  {contextPreview.omissions.length > 0 && (
                    <ContextFact
                      icon={ShieldCheck}
                      label="Omitted sources"
                      detail={omissionDetail(contextPreview)}
                    />
                  )}
                </div>

                {contextPreview.tokenBudget.pressure !== "comfortable" && (
                  <div
                    className={cn(
                      "border-t border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-[9px] leading-4",
                      contextPreview.tokenBudget.pressure ===
                        "compaction-likely"
                        ? "text-amber-300"
                        : "text-[hsl(var(--wb-text-muted))]",
                    )}
                  >
                    {contextPressureDetail(contextPreview)}
                  </div>
                )}

                <div className="border-y border-[hsl(var(--wb-border-subtle))] px-2 py-1.5">
                  <ContextToggle
                    icon={FileText}
                    label="Active editor"
                    detail={contextDetail(
                      contextPreview.editor,
                      activeContextLabel,
                    )}
                    checked={contextSettings.includeEditorContent}
                    disabled={contextLocked || !contextPreview.editor.available}
                    onCheckedChange={(checked) =>
                      updateContextSetting("includeEditorContent", checked)
                    }
                  />
                  <ContextToggle
                    icon={TextSelect}
                    label="Editor selection"
                    detail={`${contextDetail(
                      contextPreview.selection,
                    )} · sent as focused context; active editor may also contain it`}
                    checked={contextSettings.includeSelection}
                    disabled={
                      contextLocked || !contextPreview.selection.available
                    }
                    onCheckedChange={(checked) =>
                      updateContextSetting("includeSelection", checked)
                    }
                  />
                  <ContextToggle
                    icon={History}
                    label="Conversation history"
                    detail={historyDetail(contextPreview)}
                    checked={contextSettings.includeHistory}
                    disabled={
                      contextLocked ||
                      contextPreview.history.availableMessages === 0
                    }
                    onCheckedChange={(checked) =>
                      updateContextSetting("includeHistory", checked)
                    }
                  />
                  <ContextToggle
                    icon={Wrench}
                    label="Tool results to model"
                    detail={contextPreview.toolResultDetail}
                    checked={
                      contextPreview.canShareToolResults &&
                      contextSettings.shareToolResults
                    }
                    disabled={
                      contextLocked || !contextPreview.canShareToolResults
                    }
                    onCheckedChange={(checked) =>
                      updateContextSetting("shareToolResults", checked)
                    }
                  />
                </div>

                {(contextPreview.editor.sample ||
                  contextPreview.selection.sample) && (
                  <div className="space-y-2 px-3 py-2.5">
                    {contextPreview.selection.sample && (
                      <ContextSample
                        label="Selection preview"
                        value={contextPreview.selection.sample}
                      />
                    )}
                    {contextPreview.editor.sample && (
                      <ContextSample
                        label="Editor preview"
                        value={contextPreview.editor.sample}
                      />
                    )}
                  </div>
                )}

                <div className="flex items-start gap-2 border-t border-[hsl(var(--wb-border-subtle))] px-3 py-2.5 leading-4 text-[hsl(var(--wb-text-muted))]">
                  <KeyRound size={12} className="mt-0.5 shrink-0" />
                  <p>
                    Stored passwords, connection URLs and the provider API key
                    are not inserted automatically. Included editor text may
                    itself contain secrets, so review the preview. Context is
                    frozen when you send. Reviewable project file edits apply
                    immediately and can be undone; database and external
                    mutations still require approval.
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex min-w-0 items-center gap-0.5">
            <AssistantModelControl
              model={model}
              endpoint={modelEndpoint}
              status={modelStatus}
              disabled={isSubmitting || isToolRunning}
              onModelChange={onModelChange}
              onOpenSettings={onOpenAiSettings}
              onRetry={onRetryModel}
            />

            {isSubmitting || isToolRunning ? (
              <button
                type="button"
                className="inline-flex h-7 items-center gap-1 rounded-[5px] bg-destructive px-2 text-[10px] font-medium text-destructive-foreground disabled:opacity-50"
                onClick={onStop}
                disabled={isCancelling}
                title="Stop active assistant tool"
              >
                <Square size={10} className="fill-current" />
                {isCancelling ? "Stopping" : "Stop"}
              </button>
            ) : (
              <button
                type="button"
                className="wb-primary-button h-7 w-7 justify-center px-0"
                onClick={onSubmit}
                disabled={!canSubmit}
                title={submissionBlockReason || submitLabel}
                aria-label={submitLabel}
                aria-describedby={
                  submissionBlockReason && message.trim()
                    ? "assistant-submit-block-reason"
                    : undefined
                }
              >
                <SendHorizontal size={12} />
              </button>
            )}
          </div>
        </div>

        {submissionBlockReason && message.trim() && !contextLocked && (
          <div
            id="assistant-submit-block-reason"
            role="status"
            className="border-t border-[hsl(var(--wb-border-subtle))] px-2.5 py-1.5 text-[9px] leading-4 text-amber-400"
          >
            {submissionBlockReason}
          </div>
        )}
        {attachmentError && !contextLocked && (
          <div
            role="alert"
            className="border-t border-[hsl(var(--wb-border-subtle))] px-2.5 py-1.5 text-[9px] leading-4 text-[hsl(var(--destructive))]"
          >
            {attachmentError}
          </div>
        )}
      </div>
    </div>
  );
}

function ContextFact({
  icon: Icon,
  label,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-[5px] px-1 py-1.5">
      <Icon size={12} className="mt-0.5 shrink-0 wb-muted" />
      <div className="min-w-0 flex-1">
        <div>{label}</div>
        <div
          className="mt-0.5 truncate text-[9px] text-[hsl(var(--wb-text-muted))]"
          title={detail}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}

function ContextToggle({
  icon: Icon,
  label,
  detail,
  checked,
  disabled,
  onCheckedChange,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const controlId = `assistant-context-${label
    .toLowerCase()
    .replace(/\s+/gu, "-")}`;
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-[5px] px-1 py-1.5 hover:bg-[hsl(var(--wb-hover)/0.45)]">
      <Icon size={12} className="mt-0.5 shrink-0 wb-muted" />
      <label className="min-w-0 flex-1 cursor-pointer" htmlFor={controlId}>
        <span className="block">{label}</span>
        <span className="mt-0.5 block text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
          {detail}
        </span>
      </label>
      <Switch
        id={controlId}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="mt-0.5 h-4 w-7 border-0 data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=unchecked]:bg-[hsl(var(--wb-border-strong))] [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-3"
      />
    </div>
  );
}

function ContextSample({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-wide text-[hsl(var(--wb-text-muted))]">
        {label}
      </div>
      <div className="max-h-12 overflow-hidden rounded-[4px] bg-[hsl(var(--wb-editor))] px-2 py-1.5 font-mono text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
        {value}
      </div>
    </div>
  );
}

function contextDetail(
  preview: AssistantContextPreview["editor"],
  prefix?: string,
) {
  const availability = preview.available
    ? characterDetail(preview)
    : "Not available";
  return prefix ? `${prefix} · ${availability}` : availability;
}

function characterDetail(preview: AssistantContextPreview["prompt"]) {
  if (!preview.available) return "Empty";
  if (!preview.included) {
    return `${preview.originalCharacters.toLocaleString()} characters · excluded`;
  }
  const suffix = preview.truncated ? " · truncated" : "";
  return `${preview.sentCharacters.toLocaleString()} of ${preview.originalCharacters.toLocaleString()} characters · ~${preview.estimatedTokens.toLocaleString()} tokens${suffix}`;
}

function historyDetail(preview: AssistantContextPreview) {
  const history = preview.history;
  if (history.availableMessages === 0) return "No previous messages";
  if (!history.included) {
    return `${history.availableMessages} messages · excluded`;
  }
  const omitted =
    history.omittedMessages > 0 || history.omittedCharacters > 0
      ? ` · omitted ${history.omittedMessages} messages / ${history.omittedCharacters.toLocaleString()} characters`
      : "";
  return `${history.sentMessages} of ${history.availableMessages} messages · ${history.sentCharacters.toLocaleString()} characters · ~${history.estimatedTokens.toLocaleString()} tokens${omitted}`;
}

function tokenBudgetDetail(preview: AssistantContextPreview) {
  const budget = preview.tokenBudget;
  const estimate = `~${budget.estimatedInputTokens.toLocaleString()} visible tokens`;
  if (budget.maxInputTokens === null) return `${estimate} · model limit unknown`;
  return `${estimate} of ${budget.maxInputTokens.toLocaleString()} · ${budget.utilizationPercent}%`;
}

function contextPressureDetail(preview: AssistantContextPreview) {
  const budget = preview.tokenBudget;
  if (budget.promptCompactionLikely) {
    return `The prompt exceeds the runtime's ${budget.promptCompactionThresholdTokens?.toLocaleString()} token pre-compaction threshold. OxideStudio will preserve all source ranges in a requirements digest before the model runs.`;
  }
  if (budget.pressure === "compaction-likely") {
    return "Visible context is near the model limit. The runtime may offload tool observations or summarize older history.";
  }
  if (budget.pressure === "approaching") {
    return "Visible context is approaching the model limit. Runtime instructions and provider tokenization may increase the final count.";
  }
  return "Token count is an estimate; runtime instructions and provider tokenization are not included.";
}

function compactionDetail(preview: AssistantContextPreview) {
  const stats = preview.previousCompaction;
  if (!stats) return "No previous compaction";
  return `${stats.count} event${stats.count === 1 ? "" : "s"} · last ${stats.lastInputTokens.toLocaleString()} → ${stats.lastRetainedTokens.toLocaleString()} tokens · ${stats.offloadedArtifacts} artifact${stats.offloadedArtifacts === 1 ? "" : "s"} offloaded`;
}

function modelUsageDetail(preview: AssistantContextPreview) {
  const usage = preview.previousModelUsage;
  if (!usage) return "No provider usage reported";
  return `${usage.calls} call${usage.calls === 1 ? "" : "s"} · ${usage.inputTokens.toLocaleString()} input + ${usage.outputTokens.toLocaleString()} output = ${usage.totalTokens.toLocaleString()} actual tokens`;
}

function omissionDetail(preview: AssistantContextPreview) {
  return preview.omissions
    .map((omission) => {
      const source = omission.source.replace("-", " ");
      const amounts = [
        omission.omittedMessages
          ? `${omission.omittedMessages} messages`
          : null,
        omission.omittedCharacters
          ? `${omission.omittedCharacters.toLocaleString()} characters`
          : null,
      ].filter(Boolean);
      return `${source}: ${omission.reason}${amounts.length ? ` (${amounts.join(", ")})` : ""}`;
    })
    .join(" · ");
}
