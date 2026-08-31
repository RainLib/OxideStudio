import {
  ASSISTANT_MODE_OPTIONS,
  assistantModeOption,
  type AssistantMode,
} from "@/ai/assistant/modes";
import type { AssistantModeOption } from "@/ai/assistant/modes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";
import { useEffect, useId, useRef, useState } from "react";
import type {
  AssistantContextPreview,
  AssistantContextSettings,
} from "@/ai/assistant/contextPreview";
import type { AssistantDatabaseTableMention } from "@/ai/assistant/databaseTableContext";
import {
  AssistantModelControl,
  type AssistantModelCatalogStatus,
  type AssistantModelStatus,
} from "./AssistantModelControl";
import { AssistantProviderCommandList } from "./AssistantProviderCommandList";
import type {
  AiCliCommandInfo,
  AiCliModelInfo,
} from "@/services/tauri/ai.service";
import {
  ArrowUp,
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
  ShieldCheck,
  Sparkles,
  Square,
  SquareTerminal,
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
  modelOptions?: readonly AiCliModelInfo[];
  modelCatalogStatus?: AssistantModelCatalogStatus;
  modelCatalogWarning?: string;
  reasoningEffort?: string;
  serviceTier?: "default" | "priority";
  accessMode?: "restricted" | "full";
  commandOptions?: readonly AiCliCommandInfo[];
  onModelChange: (model: string) => void;
  onReasoningEffortChange?: (effort: string) => void;
  onServiceTierChange?: (tier: "default" | "priority") => void;
  onAccessModeChange?: (mode: "restricted" | "full") => void;
  onRetryModel: () => void;
  submissionBlockReason: string | null;
  modeOptions?: readonly AssistantModeOption[];
  attachments: Array<{ id: string; fileName: string; byteCount: number }>;
  databaseMentions: readonly AssistantDatabaseTableMention[];
  attachmentError: string | null;
  isAddingAttachment: boolean;
  onAddAttachment: () => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onRemoveDatabaseMention: (mention: AssistantDatabaseTableMention) => void;
}

type SlashCommandToken = {
  start: number;
  end: number;
  query: string;
};

const MODE_ICONS: Record<AssistantMode, LucideIcon> = {
  o2: Sparkles,
  plan: ListTree,
  agent: Bot,
  chat: MessageSquare,
};

const menuContentClass =
  "w-[276px] rounded-[8px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[hsl(var(--wb-text))] shadow-[0_6px_12px_rgba(0,0,0,0.34)]";

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
  modelOptions,
  modelCatalogStatus,
  modelCatalogWarning,
  reasoningEffort,
  serviceTier,
  accessMode,
  commandOptions,
  onModelChange,
  onReasoningEffortChange,
  onServiceTierChange,
  onAccessModeChange,
  onRetryModel,
  submissionBlockReason,
  modeOptions = ASSISTANT_MODE_OPTIONS,
  attachments,
  databaseMentions,
  attachmentError,
  isAddingAttachment,
  onAddAttachment,
  onRemoveAttachment,
  onRemoveDatabaseMention,
}: AssistantPromptBoxProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const isComposingRef = useRef(false);
  const modelPanelId = useId();
  const [modelPanelOpen, setModelPanelOpen] = useState(false);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [commandToken, setCommandToken] = useState<SlashCommandToken | null>(
    null,
  );
  const [isComposing, setIsComposing] = useState(false);
  const [dismissedCommandValue, setDismissedCommandValue] = useState<
    string | null
  >(null);
  const currentMode =
    modeOptions.find((option) => option.id === mode) ??
    assistantModeOption(mode);
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
  const commandQuery = commandToken?.query;
  const commandSuggestions =
    commandQuery === undefined
      ? []
      : [...(commandOptions ?? [])]
          .filter((command) =>
            command.name.toLowerCase().includes(commandQuery),
          )
          .sort((left, right) => {
            const leftStarts = left.name.toLowerCase().startsWith(commandQuery);
            const rightStarts = right.name
              .toLowerCase()
              .startsWith(commandQuery);
            return leftStarts === rightStarts
              ? left.name.localeCompare(right.name)
              : leftStarts
                ? -1
                : 1;
          })
          .slice(0, 8);
  const commandMenuOpen =
    commandSuggestions.length > 0 &&
    !contextLocked &&
    !modelPanelOpen &&
    !isComposing &&
    dismissedCommandValue !== commandTokenKey(message, commandToken);
  const acceptCommand = (command: AiCliCommandInfo) => {
    const token = commandToken;
    if (!token) return;
    const replacement = `/${command.name}${command.argumentHint ? " " : ""}`;
    const nextMessage = `${message.slice(0, token.start)}${replacement}${message.slice(token.end)}`;
    const nextCaret = token.start + replacement.length;
    setDismissedCommandValue(null);
    setCommandToken(null);
    onMessageChange(nextMessage);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const refreshCommandToken = (
    textarea: HTMLTextAreaElement,
    value = textarea.value,
  ) => {
    if (isComposingRef.current) return;
    const nextToken = slashCommandTokenAtCaret(value, textarea.selectionStart);
    setCommandToken((current) =>
      sameSlashCommandToken(current, nextToken) ? current : nextToken,
    );
  };
  const updateContextSetting = (
    key: keyof AssistantContextSettings,
    checked: boolean,
  ) => onContextSettingChange(key, checked);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // Keep the textarea DOM-owned while an IME is composing. Re-applying the
    // controlled value on every pinyin/English composition update makes some
    // WebKit input methods move the composition range and insert spaces.
    if (!isComposingRef.current && textarea.value !== message) {
      textarea.value = message;
    }
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 60), 180);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 180 ? "auto" : "hidden";
  }, [message]);

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [commandQuery]);

  useEffect(() => {
    if (contextLocked) setModelPanelOpen(false);
  }, [contextLocked]);

  useEffect(() => {
    const tokenKey = commandTokenKey(message, commandToken);
    if (dismissedCommandValue !== null && dismissedCommandValue !== tokenKey) {
      setDismissedCommandValue(null);
    }
  }, [commandToken, dismissedCommandValue, message]);

  return (
    <div className="shrink-0 bg-[hsl(var(--wb-panel))] px-2.5 pb-2.5 pt-2">
      <Popover
        open={commandMenuOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDismissedCommandValue(commandTokenKey(message, commandToken));
          }
        }}
      >
        <PopoverAnchor asChild>
          <div
            data-assistant-composer="true"
            className="rounded-[12px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] transition-colors duration-150 focus-within:border-[hsl(var(--wb-accent))] motion-reduce:transition-none"
          >
            {(databaseMentions.length > 0 || attachments.length > 0) && (
              <div
                className="flex flex-wrap gap-1.5 px-2 pt-2"
                aria-label="Assistant context references"
              >
                {databaseMentions.map((mention) => {
                  const qualifiedName = [mention.schema, mention.table]
                    .filter(Boolean)
                    .join(".");
                  const scope = [mention.connectionName, mention.database]
                    .filter(Boolean)
                    .join(" · ");
                  const key = [
                    mention.connectionId,
                    mention.database,
                    mention.schema,
                    mention.table,
                  ].join("\u0000");
                  return (
                    <span
                      key={key}
                      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-[5px] border border-[hsl(var(--wb-accent)/0.28)] bg-[hsl(var(--wb-accent)/0.08)] px-1.5 py-1 text-[9px] text-[hsl(var(--wb-text-muted))]"
                      title={scope ? `${qualifiedName} · ${scope}` : qualifiedName}
                      data-assistant-table-mention={qualifiedName}
                    >
                      <Database
                        size={10}
                        className="shrink-0 text-[hsl(var(--wb-accent))]"
                        aria-hidden="true"
                      />
                      <span className="truncate">{qualifiedName}</span>
                      <button
                        type="button"
                        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
                        onClick={() => onRemoveDatabaseMention(mention)}
                        disabled={contextLocked}
                        aria-label={`Remove table context ${qualifiedName}`}
                      >
                        <X size={9} aria-hidden="true" />
                      </button>
                    </span>
                  );
                })}
                {attachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] px-1.5 py-1 text-[9px] text-[hsl(var(--wb-text-muted))]"
                    title={`${attachment.fileName} · ${attachment.byteCount.toLocaleString()} bytes`}
                  >
                    <FileText
                      size={10}
                      className="shrink-0"
                      aria-hidden="true"
                    />
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
              defaultValue={message}
              onChange={(event) => {
                onMessageChange(event.target.value);
                if (isComposingRef.current) return;
                refreshCommandToken(event.currentTarget);
              }}
              onFocus={(event) => {
                setModelPanelOpen(false);
                setDismissedCommandValue(null);
                refreshCommandToken(event.currentTarget);
              }}
              onClick={(event) => refreshCommandToken(event.currentTarget)}
              onSelect={(event) => refreshCommandToken(event.currentTarget)}
              onCompositionStart={() => {
                isComposingRef.current = true;
                setIsComposing(true);
                setCommandToken(null);
              }}
              onCompositionEnd={(event) => {
                isComposingRef.current = false;
                setIsComposing(false);
                onMessageChange(event.currentTarget.value);
                refreshCommandToken(event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && commandMenuOpen) {
                  event.preventDefault();
                  event.stopPropagation();
                  setDismissedCommandValue(
                    commandTokenKey(message, commandToken),
                  );
                  return;
                }
                if (commandMenuOpen && !isComposingRef.current) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveCommandIndex((current) => {
                      const direction = event.key === "ArrowDown" ? 1 : -1;
                      return (
                        (current + direction + commandSuggestions.length) %
                        commandSuggestions.length
                      );
                    });
                    return;
                  }
                  if (event.key === "Tab" || event.key === "Enter") {
                    event.preventDefault();
                    acceptCommand(
                      commandSuggestions[activeCommandIndex] ??
                        commandSuggestions[0]!,
                    );
                    return;
                  }
                }
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !isComposingRef.current &&
                  !event.nativeEvent.isComposing &&
                  // WebKit reports keyCode 229 for the Enter event that commits an
                  // IME candidate, even when isComposing has already flipped.
                  event.keyCode !== 229
                ) {
                  event.preventDefault();
                  if (canSubmit) onSubmit();
                }
              }}
              placeholder={t("assistant.prompt")}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              rows={1}
              className="custom-scrollbar min-h-[60px] max-h-[180px] w-full resize-none bg-transparent px-3 pb-1.5 pt-3 text-[11px] leading-5 text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))]"
              aria-label={t("assistant.messageAria")}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={commandMenuOpen}
              aria-controls={
                commandMenuOpen ? "assistant-provider-commands" : undefined
              }
              aria-activedescendant={
                commandMenuOpen
                  ? `assistant-provider-command-${activeCommandIndex}`
                  : undefined
              }
            />

            <div className="flex min-h-9 items-center justify-between gap-2 px-2 pb-2 pt-0.5">
              <div className="flex min-w-0 items-center gap-0.5">
                <button
                  type="button"
                  className="wb-icon-button relative h-6 w-6"
                  onClick={onAddAttachment}
                  disabled={
                    contextLocked ||
                    isAddingAttachment ||
                    attachments.length >= 4
                  }
                  title={
                    attachments.length >= 4
                      ? "Up to 4 text attachments per request"
                      : "Attach a text or data file (64 KiB each)"
                  }
                  aria-label="Attach file"
                >
                  <Paperclip size={11} aria-hidden="true" />
                </button>
                {(commandOptions?.length ?? 0) > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="wb-icon-button relative h-6 w-6 data-[state=open]:bg-[hsl(var(--wb-hover))] data-[state=open]:text-[hsl(var(--wb-text))]"
                        disabled={contextLocked}
                        title={`Provider commands (${commandOptions!.length})`}
                        aria-label={`Provider commands (${commandOptions!.length})`}
                      >
                        <SquareTerminal size={11} aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      side="top"
                      sideOffset={6}
                      className={menuContentClass}
                    >
                      <div className="px-2 pb-1 pt-1 text-[9px] font-medium text-[hsl(var(--wb-text-muted))]">
                        Commands available in this provider session
                      </div>
                      {commandOptions!.map((command) => (
                        <DropdownMenuItem
                          key={command.name}
                          className="min-h-10 cursor-default items-start gap-2 rounded-[4px] px-2 py-1.5 focus:bg-[hsl(var(--wb-active))] focus:text-[hsl(var(--wb-text))]"
                          onClick={() => acceptCommand(command)}
                        >
                          <span className="shrink-0 font-mono text-[10px] text-[hsl(var(--wb-accent))]">
                            /{command.name}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                              {command.description}
                            </span>
                            {command.argumentHint && (
                              <span className="mt-0.5 block font-mono text-[8px] text-[hsl(var(--wb-text-muted)/0.78)]">
                                {command.argumentHint}
                              </span>
                            )}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
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
                    {modeOptions.map((option) => {
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
                              option.id !== mode && "opacity-0",
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
                        <div className="font-medium">
                          Context for next request
                        </div>
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
                        disabled={
                          contextLocked || !contextPreview.editor.available
                        }
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
                        Stored passwords, connection URLs and the provider API
                        key are not inserted automatically. Included editor text
                        may itself contain secrets, so review the preview.
                        Context is frozen when you send. Reviewable project file
                        edits apply immediately and can be undone; database and
                        external mutations still require approval.
                      </p>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex min-w-0 items-center gap-0.5">
                <AssistantModelControl
                  triggerRef={modelTriggerRef}
                  model={model}
                  endpoint={modelEndpoint}
                  status={modelStatus}
                  disabled={isSubmitting || isToolRunning}
                  open={modelPanelOpen}
                  panelId={modelPanelId}
                  modelOptions={modelOptions}
                  catalogStatus={modelCatalogStatus}
                  catalogWarning={modelCatalogWarning}
                  reasoningEffort={reasoningEffort}
                  serviceTier={serviceTier}
                  accessMode={accessMode}
                  fullAccessAvailable={mode === "agent"}
                  onOpenChange={(open) => {
                    setModelPanelOpen(open);
                    if (open) {
                      setDismissedCommandValue(
                        commandTokenKey(message, commandToken),
                      );
                    }
                  }}
                  onModelChange={onModelChange}
                  onReasoningEffortChange={onReasoningEffortChange}
                  onServiceTierChange={onServiceTierChange}
                  onAccessModeChange={onAccessModeChange}
                  onRetry={onRetryModel}
                />

                {isSubmitting || isToolRunning ? (
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground outline-none transition-colors hover:bg-destructive/90 focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-50"
                    onClick={onStop}
                    disabled={isCancelling}
                    title="Stop active assistant tool"
                    aria-label={
                      isCancelling ? "Stopping assistant" : "Stop assistant"
                    }
                  >
                    <Square size={10} className="fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="wb-primary-button h-7 w-7 justify-center rounded-full px-0"
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
                    <ArrowUp size={13} strokeWidth={2.2} />
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
        </PopoverAnchor>

        {commandMenuOpen && (
          <PopoverContent
            id="assistant-provider-commands"
            align="start"
            side="top"
            sideOffset={7}
            collisionPadding={10}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="custom-scrollbar max-h-[236px] w-[min(var(--radix-popover-trigger-width),calc(100vw-20px))] overflow-y-auto rounded-[10px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1.5 text-[hsl(var(--wb-text))] shadow-[0_6px_12px_rgba(0,0,0,0.34)]"
            role="listbox"
            aria-label="Provider commands"
          >
            <AssistantProviderCommandList
              commands={commandSuggestions}
              activeIndex={activeCommandIndex}
              onActiveIndexChange={setActiveCommandIndex}
              onAccept={acceptCommand}
            />
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}

function slashCommandTokenAtCaret(
  value: string,
  selectionStart: number | null,
): SlashCommandToken | null {
  const caret = Math.max(
    0,
    Math.min(selectionStart ?? value.length, value.length),
  );
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|\s)(\/[^\s/]*)$/u.exec(beforeCaret);
  if (!match) return null;
  const rawToken = match[1];
  if (!rawToken) return null;
  const start = caret - rawToken.length;
  let end = caret;
  while (end < value.length && !/\s/u.test(value[end] ?? "")) end += 1;
  return {
    start,
    end,
    query: rawToken.slice(1).toLowerCase(),
  };
}

function sameSlashCommandToken(
  left: SlashCommandToken | null,
  right: SlashCommandToken | null,
) {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.start === right.start &&
      left.end === right.end &&
      left.query === right.query)
  );
}

function commandTokenKey(value: string, token: SlashCommandToken | null) {
  return token
    ? `${token.start}:${token.end}:${token.query}:${value.slice(token.start, token.end)}`
    : null;
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
  if (budget.maxInputTokens === null)
    return `${estimate} · model limit unknown`;
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
