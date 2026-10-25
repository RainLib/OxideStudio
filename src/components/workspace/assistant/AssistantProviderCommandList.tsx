import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AiCliCommandInfo } from "@/services/tauri/ai.service";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

interface AssistantProviderCommandListProps {
  commands: readonly AiCliCommandInfo[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onAccept: (command: AiCliCommandInfo) => void;
}

interface AssistantProviderCommandOptionProps {
  command: AiCliCommandInfo;
  index: number;
  active: boolean;
  onActivate: () => void;
  onAccept: () => void;
}

function elementIsOverflowing(element: HTMLElement | null): boolean {
  return Boolean(element && element.scrollWidth > element.clientWidth + 1);
}

function AssistantProviderCommandOption({
  command,
  index,
  active,
  onActivate,
  onAccept,
}: AssistantProviderCommandOptionProps) {
  const commandRef = useRef<HTMLSpanElement | null>(null);
  const detailsRef = useRef<HTMLSpanElement | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const details = [command.description, command.argumentHint]
    .filter(Boolean)
    .join(" · ");
  const measureOverflow = useCallback(() => {
    const nextOverflow =
      elementIsOverflowing(commandRef.current) ||
      elementIsOverflowing(detailsRef.current);
    setIsOverflowing((current) =>
      current === nextOverflow ? current : nextOverflow,
    );
    if (!nextOverflow) setTooltipOpen(false);
  }, []);

  useLayoutEffect(() => {
    measureOverflow();
    const commandNode = commandRef.current;
    const detailsNode = detailsRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measureOverflow);
    if (commandNode) resizeObserver?.observe(commandNode);
    if (detailsNode) resizeObserver?.observe(detailsNode);
    window.addEventListener("resize", measureOverflow);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureOverflow);
    };
  }, [details, measureOverflow]);

  return (
    <Tooltip
      open={isOverflowing && tooltipOpen}
      onOpenChange={(open) => setTooltipOpen(isOverflowing && open)}
    >
      <TooltipTrigger asChild>
        <button
          id={`assistant-provider-command-${index}`}
          type="button"
          role="option"
          aria-selected={active}
          data-assistant-command-option={command.name}
          data-assistant-command-overflow={isOverflowing ? "true" : "false"}
          className={cn(
            "flex w-full items-center gap-2 overflow-hidden rounded-[6px] px-2 py-1.5 text-left outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]",
            active
              ? "bg-[hsl(var(--wb-active))]"
              : "hover:bg-[hsl(var(--wb-hover))]",
          )}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={onActivate}
          onFocus={onActivate}
          onClick={onAccept}
        >
          <span
            ref={commandRef}
            data-assistant-command-name="true"
            className="max-w-[42%] shrink-0 truncate whitespace-nowrap font-mono text-[10px] text-[hsl(var(--wb-accent))]"
          >
            /{command.name}
          </span>
          <span
            ref={detailsRef}
            data-assistant-command-description="true"
            className="min-w-0 flex-1 truncate whitespace-nowrap text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]"
          >
            {details}
          </span>
        </button>
      </TooltipTrigger>
      {isOverflowing && (
        <TooltipPrimitive.Portal>
          <TooltipContent
            side="right"
            align="start"
            sideOffset={7}
            collisionPadding={12}
            className="pointer-events-none max-w-[min(320px,calc(100vw-24px))] whitespace-normal break-words px-2.5 py-2 text-[10px] leading-4"
          >
            <span className="font-mono text-[hsl(var(--wb-accent))]">
              /{command.name}
            </span>{" "}
            <span>{details}</span>
          </TooltipContent>
        </TooltipPrimitive.Portal>
      )}
    </Tooltip>
  );
}

export function AssistantProviderCommandList({
  commands,
  activeIndex,
  onActiveIndexChange,
  onAccept,
}: AssistantProviderCommandListProps) {
  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={100}>
      <div className="flex items-center justify-between gap-3 px-2 pb-1.5 pt-0.5 text-[9px] text-[hsl(var(--wb-text-muted))]">
        <span className="font-medium text-[hsl(var(--wb-text))]">
          Provider commands
        </span>
        <span className="shrink-0 whitespace-nowrap">
          ↑↓ navigate · Enter insert
        </span>
      </div>
      {commands.map((command, index) => (
        <AssistantProviderCommandOption
          key={command.name}
          command={command}
          index={index}
          active={index === activeIndex}
          onActivate={() => onActiveIndexChange(index)}
          onAccept={() => onAccept(command)}
        />
      ))}
    </TooltipProvider>
  );
}
