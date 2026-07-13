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
import { cn } from "@/lib/utils";
import {
  Bot,
  Check,
  ChevronDown,
  Database,
  Layers3,
  ListTree,
  MessageSquare,
  SendHorizontal,
  Sparkles,
  Square,
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
  hasSelection: boolean;
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
  hasSelection,
  isSubmitting,
  isToolRunning,
  isCancelling,
}: AssistantPromptBoxProps) {
  const currentMode = assistantModeOption(mode);
  const CurrentModeIcon = MODE_ICONS[mode];
  const canSubmit = Boolean(message.trim()) && !isSubmitting && !isToolRunning;
  const submitLabel = mode === "plan" ? "Create plan" : mode === "agent" ? "Run agent" : "Send";

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
                  aria-label="Show workspace context"
                >
                  <Layers3 size={11} />
                  {hasSelection && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[hsl(var(--wb-accent))]" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="top"
                sideOffset={6}
                className="w-[260px] rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-2.5 text-[10px] text-[hsl(var(--wb-text))] shadow-[0_8px_24px_rgba(0,0,0,0.32)]"
              >
                <div className="font-medium">Workspace context</div>
                <div className="mt-2 flex min-w-0 items-start gap-2">
                  <Database
                    size={12}
                    className="mt-0.5 shrink-0 text-[hsl(var(--wb-text-muted))]"
                  />
                  <div className="min-w-0">
                    <div className="truncate" title={activeContextLabel}>
                      {activeContextLabel}
                    </div>
                    <div className="mt-0.5 text-[hsl(var(--wb-text-muted))]">
                      {hasSelection
                        ? "Editor selection included"
                        : "No editor selection"}
                    </div>
                  </div>
                </div>
                <p className="mt-2 border-t border-[hsl(var(--wb-border-subtle))] pt-2 leading-4 text-[hsl(var(--wb-text-muted))]">
                  Context is captured when you send. Write and destructive tools
                  always require approval.
                </p>
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
