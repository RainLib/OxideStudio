import { assistantModeOption } from "@/ai/assistant/modes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AssistantPromptBoxProps } from "@/features/assistant-composer/model/promptTypes";
import { menuContentClass } from "@/features/assistant-composer/ui/composerStyles";
import { MODE_ICONS } from "@/features/assistant-composer/ui/modePresentation";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";

interface AssistantModeMenuProps
  extends Pick<
    AssistantPromptBoxProps,
    "isSubmitting" | "isToolRunning" | "modeOptions" | "onModeChange" | "mode"
  > {
  modeOptions: NonNullable<AssistantPromptBoxProps["modeOptions"]>;
}

export function AssistantModeMenu({
  isSubmitting,
  isToolRunning,
  modeOptions,
  onModeChange,
  mode,
}: AssistantModeMenuProps) {
  const currentMode =
    modeOptions.find((option) => option.id === mode) ??
    assistantModeOption(mode);
  const CurrentModeIcon = MODE_ICONS[mode];
  return (
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
  );
}
