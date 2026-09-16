import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AssistantPromptBoxProps } from "@/features/assistant-composer/model/promptTypes";
import { menuContentClass } from "@/features/assistant-composer/ui/composerStyles";
import { Check, ChevronDown, Database } from "lucide-react";

interface AssistantNamespaceMenuProps
  extends Pick<
    AssistantPromptBoxProps,
    | "onRequestNamespaceOptions"
    | "selectedNamespace"
    | "onNamespaceChange"
    | "namespaceOptions"
  > {
  contextLocked: boolean;
}

export function AssistantNamespaceMenu({
  onRequestNamespaceOptions,
  contextLocked,
  selectedNamespace,
  onNamespaceChange,
  namespaceOptions,
}: AssistantNamespaceMenuProps) {
  return (
    <DropdownMenu onOpenChange={(open) => open && onRequestNamespaceOptions()}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={contextLocked}
          className="wb-text-button h-6 max-w-28 gap-1 px-1.5 text-[10px] text-[hsl(var(--wb-text))] data-[state=open]:bg-[hsl(var(--wb-hover))]"
          title="Schema context for this assistant request"
          aria-label="Schema context"
        >
          <Database
            size={11}
            className="shrink-0 text-[hsl(var(--wb-text-muted))]"
          />
          <span className="truncate">
            {selectedNamespace || "Default schema"}
          </span>
          <ChevronDown size={10} className="shrink-0 wb-muted" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className={menuContentClass}
      >
        <DropdownMenuItem onClick={() => onNamespaceChange(null)}>
          <span className="min-w-0 flex-1">Workspace default</span>
          {!selectedNamespace && <Check size={11} />}
        </DropdownMenuItem>
        {namespaceOptions.map((namespace) => (
          <DropdownMenuItem
            key={namespace}
            onClick={() => onNamespaceChange(namespace)}
          >
            <span className="min-w-0 flex-1 truncate font-mono">
              {namespace}
            </span>
            {selectedNamespace === namespace && <Check size={11} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
