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
import type {
  AssistantContextPreview,
  AssistantContextSettings,
} from "@/ai/assistant/contextPreview";
import {
  Bot,
  Check,
  ChevronDown,
  Cloud,
  Database,
  FileText,
  History,
  KeyRound,
  Layers3,
  ListTree,
  MessageSquare,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Square,
  TextSelect,
  Wrench,
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
}: AssistantPromptBoxProps) {
  const currentMode = assistantModeOption(mode);
  const CurrentModeIcon = MODE_ICONS[mode];
  const canSubmit = Boolean(message.trim()) && !isSubmitting && !isToolRunning;
  const submitLabel = mode === "plan" ? "Create plan" : mode === "agent" ? "Run agent" : "Send";
  const contextLocked = isSubmitting || isToolRunning;
  const updateContextSetting = (
    key: keyof AssistantContextSettings,
    checked: boolean,
  ) => onContextSettingChange(key, checked);

  return (
    <div className="shrink-0 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-2">
      <div className="rounded-[8px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] transition-colors focus-within:border-[hsl(var(--wb-accent))]">
        <textarea
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
          placeholder="Ask about your database or describe a task"
          className="min-h-[72px] w-full resize-none bg-transparent px-2.5 pb-1 pt-2.5 text-[11px] leading-5 text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))]"
          aria-label="Assistant message"
        />

        <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
          <div className="flex min-w-0 items-center gap-0.5">
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
                  title="Workspace context"
                  aria-label="Preview and control assistant context"
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
                  {contextPreview.sendsToolManifest && (
                    <ContextFact
                      icon={Wrench}
                      label="Tool manifest"
                      detail="Names, permissions and input schemas"
                    />
                  )}
                </div>

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
                    frozen when you send; mutations still require approval.
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          </div>

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
              title={submitLabel}
              aria-label={submitLabel}
            >
              <SendHorizontal size={12} />
            </button>
          )}
        </div>
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
  return `${preview.sentCharacters.toLocaleString()} of ${preview.originalCharacters.toLocaleString()} characters${suffix}`;
}

function historyDetail(preview: AssistantContextPreview) {
  const history = preview.history;
  if (history.availableMessages === 0) return "No previous messages";
  if (!history.included) {
    return `${history.availableMessages} messages · excluded`;
  }
  return `${history.sentMessages} of ${history.availableMessages} messages · ${history.sentCharacters.toLocaleString()} characters${history.truncated ? " · truncated" : ""}`;
}
