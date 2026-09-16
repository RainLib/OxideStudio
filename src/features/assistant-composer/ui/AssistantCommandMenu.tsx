import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AssistantPromptBoxProps } from "@/features/assistant-composer/model/promptTypes";
import { menuContentClass } from "@/features/assistant-composer/ui/composerStyles";
import type { AiCliCommandInfo } from "@/services/tauri/ai.service";
import { SquareTerminal } from "lucide-react";

interface AssistantCommandMenuProps
  extends Pick<AssistantPromptBoxProps, "commandOptions"> {
  contextLocked: boolean;
  acceptCommand: (command: AiCliCommandInfo) => void;
}

export function AssistantCommandMenu({
  contextLocked,
  commandOptions,
  acceptCommand,
}: AssistantCommandMenuProps) {
  return (
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
  );
}
